import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceWorkflowBatch,
  createWorkflowAgentSnapshot,
  createWorkflowBatchRun,
  describeWorkflowRun,
  mergeStoryWorkflowChunks,
  parseWorkflowBatchRun,
} from "../app/workflow/agent.ts";
import {
  createStoryWorkflow,
  emptyWorkflowGraph,
  updateWorkflowResult,
} from "../app/workflow/graph.ts";

function ids() {
  let value = 0;
  return () => `story-node-${++value}`;
}

function chunk(chunkIndex, isFinal, shotRefs) {
  return {
    type: "create_story_workflow",
    ref: "story-plan",
    title: "夜班电梯",
    globalContext: "固定角色、电梯场景和冷色光线。",
    imageModel: "gemini-3-pro-image-preview",
    videoModel: "doubao-seedance-1-5-pro-251215",
    aspectRatio: "9:16",
    imageResolution: "1K",
    videoResolution: "720p",
    chunkIndex,
    isFinal,
    shots: shotRefs.map((ref) => ({
      ref,
      title: `${ref} 标题`,
      script: `${ref} 剧本`,
      imagePrompt: `${ref} 静态关键帧`,
      videoPrompt: `${ref} 动作和镜头运动`,
      duration: "5",
      referenceNodeIds: [],
    })),
  };
}

function storyGraph() {
  const operation = mergeStoryWorkflowChunks([
    chunk(0, false, ["shot-01"]),
    chunk(1, true, ["shot-02"]),
  ]);
  return createStoryWorkflow(emptyWorkflowGraph(), operation, ids());
}

test("merges continuous planning chunks and rejects every atomic-failure case", () => {
  const merged = mergeStoryWorkflowChunks([
    chunk(0, false, ["shot-01"]),
    chunk(1, true, ["shot-02"]),
  ]);
  assert.equal(merged.chunkIndex, 0);
  assert.equal(merged.isFinal, true);
  assert.deepEqual(merged.shots.map((shot) => shot.ref), ["shot-01", "shot-02"]);
  assert.throws(
    () => mergeStoryWorkflowChunks([chunk(0, false, ["shot-01"])]),
    /不连续|尚未完成/,
  );
  assert.throws(
    () => mergeStoryWorkflowChunks([
      chunk(0, false, ["shot-01"]),
      chunk(2, true, ["shot-02"]),
    ]),
    /不连续/,
  );
  assert.throws(
    () => mergeStoryWorkflowChunks([
      chunk(0, false, ["shot-01"]),
      chunk(1, true, ["shot-01"]),
    ]),
    /重复/,
  );
});

test("exposes workflow metadata and keeps workflow conversation context separate", () => {
  const created = storyGraph();
  const snapshot = createWorkflowAgentSnapshot(
    created.graph,
    { x: 10, y: 20, scale: 0.8 },
    { width: 1200, height: 800 },
  );
  assert.equal(snapshot.mode, "workflow");
  assert.equal(snapshot.viewport.width, 1200);
  assert.equal(snapshot.nodes.length, 11);
  const placeholder = snapshot.nodes.find((node) => node.storyRole === "storyboard");
  assert.equal(placeholder.status, "ready");
  assert.equal(placeholder.hasVisual, false);
  assert.equal(placeholder.shotRef, "shot-01");
});

test("builds asset availability in linear node passes", () => {
  const rawNodes = Array.from({ length: 100 }, (_, index) => ({
    id: `asset-${index}`,
    x: index * 20,
    y: 0,
    type: "result",
    kind: "image",
    model: "gemini-3-pro-image-preview",
    status: index % 2 ? "ready" : "success",
    progress: "",
    error: "",
    assetRef: `asset-${index}`,
    assetKind: "character",
    assetRole: "result",
    ...(index % 2 ? {} : { resultUrl: `https://example.com/${index}.png` }),
  }));
  let indexedReads = 0;
  const nodes = new Proxy(rawNodes, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) indexedReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const snapshot = createWorkflowAgentSnapshot(
    { version: 1, nodes, edges: [] },
    { x: 0, y: 0, scale: 1 },
    { width: 1200, height: 800 },
  );
  assert.equal(snapshot.nodes.filter((node) => node.assetAvailable).length, 50);
  assert.ok(indexedReads <= rawNodes.length * 3);
});

test("runs ready image layers in parallel then releases only their matching videos", () => {
  const created = storyGraph();
  const operation = {
    type: "run_story_workflow",
    storyId: created.storyId,
    shotRefs: [],
  };
  const batch = createWorkflowBatchRun(created.graph, operation, () => "batch-1");
  assert.equal(batch.schedulerIds.length, 4);
  assert.match(describeWorkflowRun(created.graph, operation), /2 个分镜图片和 2 个视频片段/);
  assert.match(describeWorkflowRun(created.graph, operation), /4 笔模型费用/);
  assert.deepEqual(parseWorkflowBatchRun(JSON.stringify(batch)), batch);

  const initial = advanceWorkflowBatch(created.graph, batch);
  assert.equal(initial.readySchedulerIds.length, 2);
  assert.ok(initial.readySchedulerIds.every((id) =>
    created.graph.nodes.find((node) => node.id === id).storyRole === "storyboard-scheduler"
  ));

  const imageResults = created.graph.nodes.filter((node) => node.storyRole === "storyboard");
  let successfulImages = created.graph;
  for (const node of imageResults) {
    successfulImages = updateWorkflowResult(successfulImages, node.id, {
      status: "success",
      resultUrl: `https://example.com/${node.shotRef}.png`,
      progress: "",
    });
  }
  const released = advanceWorkflowBatch(successfulImages, batch);
  assert.equal(released.readySchedulerIds.length, 2);
  assert.ok(released.readySchedulerIds.every((id) =>
    successfulImages.nodes.find((node) => node.id === id).storyRole === "video-scheduler"
  ));

  let isolatedFailure = updateWorkflowResult(created.graph, imageResults[0].id, {
    status: "failed",
    error: "图片失败",
  });
  isolatedFailure = updateWorkflowResult(isolatedFailure, imageResults[1].id, {
    status: "success",
    resultUrl: "https://example.com/shot-02.png",
  });
  const isolated = advanceWorkflowBatch(isolatedFailure, batch);
  assert.equal(isolated.readySchedulerIds.length, 1);
  const failedClip = isolated.graph.nodes.find(
    (node) => node.storyRole === "clip" && node.shotRef === "shot-01",
  );
  assert.equal(failedClip.status, "failed");
  assert.match(failedClip.error, /未提交/);
  const readyVideo = isolated.graph.nodes.find(
    (node) => node.id === isolated.readySchedulerIds[0],
  );
  assert.equal(readyVideo.shotRef, "shot-02");
});

test("validates selected shots and rejects malformed persisted queues", () => {
  const created = storyGraph();
  const selected = createWorkflowBatchRun(created.graph, {
    type: "run_story_workflow",
    storyId: created.storyId,
    shotRefs: ["shot-02"],
  }, () => "batch-2");
  assert.equal(selected.schedulerIds.length, 2);
  assert.throws(() => createWorkflowBatchRun(created.graph, {
    type: "run_story_workflow",
    storyId: created.storyId,
    shotRefs: ["missing"],
  }), /不存在/);
  assert.equal(parseWorkflowBatchRun('{"version":2}'), null);
  assert.equal(parseWorkflowBatchRun("not-json"), null);
});
