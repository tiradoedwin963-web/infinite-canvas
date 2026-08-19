import assert from "node:assert/strict";
import test from "node:test";
import { applyWorkflowAgentOperations } from "../app/workflow/agent.ts";
import { parseWorkflowGraph } from "../app/workflow/graph.ts";
import {
  setStoryStoryboardMode,
  storyStoryboardReadiness,
} from "../app/workflow/storyboard.ts";

function readyAssetGraph() {
  const storyId = "asset-story";
  const analysis = {
    id: "analysis",
    x: 0,
    y: 0,
    type: "source",
    kind: "text",
    text: "剧本分析",
    storyId,
    storyRole: "analysis",
    assetStrategy: "foundation-pair-v1",
    foundationApprovedAt: 123,
    planningStage: "complete",
    planningStatus: "complete",
    planningChunkIndex: 0,
  };
  const result = (id, assetRef, assetKind) => ({
    id,
    x: 0,
    y: 0,
    type: "result",
    kind: "image",
    schedulerId: `${id}-scheduler`,
    text: assetRef,
    model: "gpt-image-2",
    status: "success",
    progress: "",
    error: "",
    resultUrl: `https://example.com/${assetRef}.png`,
    storyId,
    storyRole: "asset-result",
    assetRef,
    assetKind,
    assetRole: "result",
  });
  return {
    version: 1,
    nodes: [
      analysis,
      result("lead-result", "lead", "character"),
      result("scene-result", "scene", "scene"),
      result("prop-result", "prop", "prop"),
    ],
    edges: [],
  };
}

function storyboardOperation(referenceNodeIds = ["lead-result", "scene-result"]) {
  return {
    type: "create_story_workflow",
    ref: "comic-plan",
    title: "雨夜归人",
    globalContext: "保持角色、雨夜场景和低饱和水粉风格连续。",
    imageModel: "gemini-3-pro-image-preview",
    videoModel: "seedance-2.0",
    aspectRatio: "9:16",
    imageResolution: "1K",
    videoResolution: "720p",
    chunkIndex: 0,
    isFinal: true,
    shots: [{
      ref: "shot-01",
      title: "雨中回望",
      script: "镜头目的：建立悬念\n出镜资产：主角、雨夜场景\n景别/机位/构图：中景平视\n动作与表演：主角停步回望\n对白/旁白：无\n连续性：保持右手持伞\n转场：切",
      imagePrompt: "雨夜中景静态首帧",
      videoPrompt: "主角停步并缓慢回望，镜头轻推，保持人物和场景不变",
      duration: "5",
      referenceNodeIds,
    }],
  };
}

test("persists an optional storyboard mode without upgrading workflow v1", () => {
  const selected = setStoryStoryboardMode(readyAssetGraph(), "asset-story", "comic", "short-cut");
  const restored = parseWorkflowGraph(JSON.stringify(selected));
  assert.equal(restored.version, 1);
  assert.equal(
    restored.nodes.find((node) => node.storyRole === "analysis").storyboardMode,
    "comic",
  );
  assert.equal(
    restored.nodes.find((node) => node.storyRole === "analysis").mangaPlanningStage,
    "story-beats",
  );
  assert.equal(
    restored.nodes.find((node) => node.storyRole === "analysis").mangaStoryboardTempo,
    "short-cut",
  );
  assert.equal(storyStoryboardReadiness(restored, "asset-story").ready, true);
});

test("locks the selected manga tempo after the first shot", () => {
  const graph = setStoryStoryboardMode(readyAssetGraph(), "asset-story", "comic", "short-cut");
  graph.nodes.push({
    id: "shot",
    x: 0,
    y: 0,
    type: "source",
    kind: "text",
    text: "分镜",
    storyId: "asset-story",
    storyRole: "shot",
  });
  assert.throws(
    () => setStoryStoryboardMode(graph, "asset-story", "comic", "long-form"),
    /不能切换制作节奏/,
  );
});

test("requires every planned asset before selecting a storyboard mode", () => {
  const graph = readyAssetGraph();
  graph.nodes.find((node) => node.id === "prop-result").status = "ready";
  assert.equal(storyStoryboardReadiness(graph, "asset-story").ready, false);
  assert.throws(
    () => setStoryStoryboardMode(graph, "asset-story", "comic"),
    /尚未全部生成并确认/,
  );
});

test("starts the staged manga director and rejects the legacy image workflow", () => {
  const selected = setStoryStoryboardMode(readyAssetGraph(), "asset-story", "comic");
  assert.throws(
    () => applyWorkflowAgentOperations(selected, [storyboardOperation()]),
    /分阶段导演操作/,
  );
});

test("rejects TVC, cross-project, missing, duplicate, and excessive references", () => {
  const tvc = setStoryStoryboardMode(readyAssetGraph(), "asset-story", "tvc");
  assert.throws(
    () => applyWorkflowAgentOperations(tvc, [storyboardOperation()]),
    /没有选择漫剧/,
  );

  const comic = setStoryStoryboardMode(readyAssetGraph(), "asset-story", "comic");
  assert.throws(
    () => applyWorkflowAgentOperations(comic, [storyboardOperation([])]),
    /分阶段导演操作/,
  );
});
