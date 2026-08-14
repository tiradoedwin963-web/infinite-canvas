import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceWorkflowBatch,
  createStoryAssetBatchRun,
  createWorkflowAgentSnapshot,
  describeStoryAssetRun,
  parseWorkflowBatchRun,
} from "../app/workflow/agent.ts";
import {
  createWorkflowRun,
  emptyWorkflowGraph,
  parseWorkflowGraph,
  readWorkflowInputs,
  updateWorkflowResult,
  updateWorkflowNode,
} from "../app/workflow/graph.ts";
import {
  approveStoryFoundation,
  assetRefsForSelection,
  createStoryAnalysis,
  createStoryAssetBatch,
  markStoryAssetPlanning,
  storyFoundationState,
  syncStoryFoundationStatuses,
} from "../app/workflow/story-assets.ts";

function ids() {
  let value = 0;
  return () => `asset-node-${++value}`;
}

function analysisOperation() {
  return {
    type: "create_story_analysis",
    ref: "story-plan",
    title: "雨夜归人",
    analysis: {
      genre: "都市悬疑",
      theme: "信任与选择",
      audience: "18-35 岁短剧用户",
      emotion: "紧张到释然",
      estimatedDuration: "90 秒",
    },
    projectAspectRatio: "9:16",
    imageModel: "gemini-3-pro-image-preview",
  };
}

function foundationAnalysisOperation() {
  const operation = analysisOperation();
  return {
    ...operation,
    analysis: {
      ...operation.analysis,
      visualStyle: "粗粝水粉笔触、柔和边缘、低饱和暖色与漫射光",
    },
  };
}

function batch(storyId, assetKind, chunkIndex, isFinal, assets) {
  return {
    type: "create_story_asset_batch",
    storyId,
    assetKind,
    chunkIndex,
    isFinal,
    assets,
  };
}

function asset(ref, name, overrides = {}) {
  return {
    ref,
    name,
    description: `${name}的稳定视觉设定`,
    reason: "推动剧情或多次出现",
    occurrences: ["第一场"],
    imagePrompt: `${name}资产参考图`,
    aspectRatio: "16:9",
    resolution: "2K",
    ...overrides,
  };
}

function plannedGraph() {
  const idFactory = ids();
  const analysis = createStoryAnalysis(
    emptyWorkflowGraph(),
    analysisOperation(),
    idFactory,
  );
  const characters = createStoryAssetBatch(
    analysis.graph,
    batch(analysis.storyId, "character", 0, true, [
      asset("character-01", "阿宁"),
    ]),
    idFactory,
  );
  const scenes = createStoryAssetBatch(
    characters.graph,
    batch(analysis.storyId, "scene", 0, true, [
      asset("scene-01", "雨夜路口", { aspectRatio: "9:16" }),
    ]),
    idFactory,
  );
  const props = createStoryAssetBatch(
    scenes.graph,
    batch(analysis.storyId, "prop", 0, true, [
      asset("prop-01", "红伞", { aspectRatio: "1:1" }),
    ]),
    idFactory,
  );
  return { ...analysis, graph: props.graph };
}

test("creates a persisted analysis node and three-node asset groups by stage", () => {
  const created = plannedGraph();
  const analysis = created.graph.nodes.find((node) => node.storyRole === "analysis");
  assert.match(analysis.text, /类型：都市悬疑/);
  assert.equal(analysis.planningStage, "complete");
  assert.equal(analysis.planningStatus, "complete");
  assert.equal(analysis.projectAspectRatio, "9:16");

  for (const [ref, kind] of [
    ["character-01", "character"],
    ["scene-01", "scene"],
    ["prop-01", "prop"],
  ]) {
    const nodes = created.graph.nodes.filter((node) => node.assetRef === ref);
    assert.deepEqual(nodes.map((node) => node.assetRole), ["spec", "scheduler", "result"]);
    assert.ok(nodes.every((node) => node.assetKind === kind));
    const scheduler = nodes.find((node) => node.assetRole === "scheduler");
    const result = nodes.find((node) => node.assetRole === "result");
    assert.equal(scheduler.resolution, "2K");
    assert.equal(result.status, "ready");
    assert.ok(created.graph.edges.some((edge) => edge.sourceId === scheduler.id && edge.targetId === result.id));
  }

  const restored = parseWorkflowGraph(JSON.stringify(created.graph));
  assert.equal(restored.version, 1);
  assert.equal(restored.nodes.find((node) => node.assetRef === "prop-01").assetKind, "prop");
});

test("commits valid batches independently and rejects discontinuity without mutation", () => {
  const idFactory = ids();
  const analysis = createStoryAnalysis(emptyWorkflowGraph(), analysisOperation(), idFactory);
  const first = createStoryAssetBatch(
    analysis.graph,
    batch(analysis.storyId, "character", 0, false, [asset("character-01", "阿宁")]),
    idFactory,
  );
  assert.equal(first.graph.nodes.find((node) => node.storyRole === "analysis").planningChunkIndex, 1);
  assert.throws(
    () => createStoryAssetBatch(
      first.graph,
      batch(analysis.storyId, "character", 2, true, [asset("character-02", "阿海")]),
      idFactory,
    ),
    /批次编号不连续/,
  );
  assert.throws(
    () => createStoryAssetBatch(
      first.graph,
      batch(analysis.storyId, "character", 1, true, [asset("character-01", "重复")]),
      idFactory,
    ),
    /已存在/,
  );
  assert.throws(
    () => createStoryAssetBatch(
      first.graph,
      batch("other-story", "character", 1, true, []),
      idFactory,
    ),
    /未找到/,
  );
  assert.equal(first.graph.nodes.filter((node) => node.assetRef).length, 3);

  const characterDone = createStoryAssetBatch(
    first.graph,
    batch(analysis.storyId, "character", 1, true, []),
    idFactory,
  );
  assert.equal(characterDone.graph.nodes.find((node) => node.storyRole === "analysis").planningStage, "scene");
  assert.equal(markStoryAssetPlanning(characterDone.graph, analysis.storyId, "stopped").nodes.find(
    (node) => node.storyRole === "analysis",
  ).planningStatus, "stopped");
});

test("exposes asset availability and resolves any selected group node to one asset", () => {
  const created = plannedGraph();
  const characterNodes = created.graph.nodes.filter((node) => node.assetRef === "character-01");
  assert.deepEqual(
    assetRefsForSelection(created.graph, characterNodes.map((node) => node.id)),
    ["character-01"],
  );
  const snapshot = createWorkflowAgentSnapshot(
    created.graph,
    { x: 0, y: 0, scale: 1 },
    { width: 1200, height: 800 },
  );
  const result = snapshot.nodes.find((node) => node.assetRole === "result");
  assert.equal(result.hasVisual, false);
  assert.equal(result.assetKind, "character");
  assert.equal(snapshot.nodes.find((node) => node.storyRole === "analysis").planningStage, "complete");
});

test("runs incomplete assets in parallel and explicitly regenerates a successful placeholder", () => {
  const created = plannedGraph();
  const characterResult = created.graph.nodes.find(
    (node) => node.assetRef === "character-01" && node.assetRole === "result",
  );
  let graph = updateWorkflowResult(created.graph, characterResult.id, {
    status: "success",
    resultUrl: "https://example.com/character.png",
    width: 288,
    height: 204,
  });
  const allPending = {
    type: "run_story_assets",
    storyId: created.storyId,
    assetRefs: [],
  };
  const preparedPending = createStoryAssetBatchRun(graph, allPending, () => "batch-pending");
  assert.equal(preparedPending.batch.schedulerIds.length, 2);
  assert.deepEqual(
    parseWorkflowBatchRun(JSON.stringify(preparedPending.batch)),
    preparedPending.batch,
  );
  assert.doesNotMatch(describeStoryAssetRun(graph, allPending), /覆盖原结果/);

  const regenerate = {
    type: "run_story_assets",
    storyId: created.storyId,
    assetRefs: ["character-01"],
  };
  assert.match(describeStoryAssetRun(graph, regenerate), /1 个成功资产.*覆盖原结果/);
  const prepared = createStoryAssetBatchRun(graph, regenerate, () => "batch-regenerate");
  const schedulerId = prepared.batch.schedulerIds[0];
  const changedModel = updateWorkflowNode(prepared.graph, schedulerId, {
    model: "gpt-image-2",
  });
  const rerun = createWorkflowRun(changedModel, schedulerId, Date.now(), ids());
  const reused = rerun.graph.nodes.find((node) => node.id === characterResult.id);
  assert.deepEqual(rerun.resultIds, [characterResult.id]);
  assert.equal(reused.resultUrl, undefined);
  assert.equal(reused.width, undefined);
  assert.equal(reused.height, undefined);
  assert.equal(reused.model, "gpt-image-2");
});

test("gates new stories behind a parallel lead and support foundation pair", () => {
  const idFactory = ids();
  const analysis = createStoryAnalysis(
    emptyWorkflowGraph(),
    foundationAnalysisOperation(),
    idFactory,
  );
  const analysisNode = analysis.graph.nodes.find((node) => node.storyRole === "analysis");
  assert.equal(analysisNode.assetStrategy, "foundation-pair-v1");
  assert.match(analysisNode.text, /统一视觉风格：粗粝水粉笔触/);

  assert.throws(() => createStoryAssetBatch(
    analysis.graph,
    batch(analysis.storyId, "character", 0, false, [
      asset("lead", "阿宁", { foundationRole: "lead" }),
    ]),
    idFactory,
  ), /一个主角和一个核心配角/);

  const foundations = createStoryAssetBatch(
    analysis.graph,
    batch(analysis.storyId, "character", 0, false, [
      asset("lead", "阿宁", { foundationRole: "lead", reason: "主角" }),
      asset("support", "阿海", { foundationRole: "support", reason: "与主角互动最多" }),
    ]),
    idFactory,
  );
  const waiting = foundations.graph.nodes.find((node) => node.storyRole === "analysis");
  assert.equal(waiting.planningStatus, "awaiting-foundation-generation");
  assert.equal(waiting.planningChunkIndex, 1);
  const foundationSchedulers = foundations.graph.nodes.filter((node) =>
    node.type === "scheduler" && node.foundationRole
  );
  assert.equal(foundationSchedulers.length, 2);
  assert.ok(foundationSchedulers.every((node) =>
    readWorkflowInputs(foundations.graph, node.id).images.length === 0
  ));
  assert.ok(foundationSchedulers.every((node) => /粗粝水粉笔触/.test(node.prompt)));
  assert.throws(() => createStoryAssetBatch(
    foundations.graph,
    batch(analysis.storyId, "character", 1, true, [asset("other", "村民")]),
    idFactory,
  ), /尚未确认/);

  const operation = {
    type: "run_story_assets",
    storyId: analysis.storyId,
    assetRefs: ["lead", "support"],
  };
  const prepared = createStoryAssetBatchRun(foundations.graph, operation, () => "foundation-run");
  const parallel = advanceWorkflowBatch(prepared.graph, prepared.batch);
  assert.equal(parallel.readySchedulerIds.length, 2);
  assert.match(describeStoryAssetRun(foundations.graph, operation), /并行/);
});

test("approves both foundation images before wiring every later asset as image 1 and image 2", () => {
  const idFactory = ids();
  const analysis = createStoryAnalysis(
    emptyWorkflowGraph(),
    foundationAnalysisOperation(),
    idFactory,
  );
  const foundations = createStoryAssetBatch(
    analysis.graph,
    batch(analysis.storyId, "character", 0, false, [
      asset("lead", "阿宁", { foundationRole: "lead" }),
      asset("support", "阿海", { foundationRole: "support" }),
    ]),
    idFactory,
  );
  const lead = storyFoundationState(foundations.graph, analysis.storyId).lead;
  const support = storyFoundationState(foundations.graph, analysis.storyId).support;
  let generated = updateWorkflowResult(foundations.graph, lead.id, {
    status: "success",
    resultUrl: "https://example.com/lead.png",
  });
  assert.throws(() => approveStoryFoundation(generated, analysis.storyId), /尚未全部/);
  generated = updateWorkflowResult(generated, support.id, {
    status: "success",
    resultUrl: "https://example.com/support.png",
  });
  generated = syncStoryFoundationStatuses(generated);
  assert.equal(
    generated.nodes.find((node) => node.storyRole === "analysis").planningStatus,
    "awaiting-foundation-approval",
  );
  let graph = approveStoryFoundation(generated, analysis.storyId, 123);
  assert.equal(
    graph.nodes.find((node) => node.storyRole === "analysis").foundationApprovedAt,
    123,
  );

  graph = createStoryAssetBatch(
    graph,
    batch(analysis.storyId, "character", 1, true, [asset("villager", "年轻村民")]),
    idFactory,
  ).graph;
  graph = createStoryAssetBatch(
    graph,
    batch(analysis.storyId, "scene", 0, true, [asset("scene", "村庄广场")]),
    idFactory,
  ).graph;
  graph = createStoryAssetBatch(
    graph,
    batch(analysis.storyId, "prop", 0, true, [asset("prop", "旧雨伞")]),
    idFactory,
  ).graph;

  for (const [ref, pattern] of [
    ["villager", /将图1中人物换成/],
    ["scene", /不要复制、出现或突出图1和图2的人物/],
    ["prop", /不要出现人物/],
  ]) {
    const scheduler = graph.nodes.find((node) =>
      node.type === "scheduler" && node.assetRef === ref
    );
    const inputs = readWorkflowInputs(graph, scheduler.id);
    assert.deepEqual(inputs.images.map((node) => node.assetRef), ["lead", "support"]);
    assert.match(scheduler.prompt, pattern);
    assert.match(scheduler.prompt, /粗粝水粉笔触/);
  }

  const restored = parseWorkflowGraph(JSON.stringify(graph));
  assert.equal(restored.version, 1);
  assert.equal(restored.nodes.find((node) => node.assetRef === "lead").foundationRole, "lead");
  assert.equal(restored.nodes.find((node) => node.storyRole === "analysis").assetStrategy, "foundation-pair-v1");

  const remainingOperation = {
    type: "run_story_assets",
    storyId: analysis.storyId,
    assetRefs: ["villager", "scene", "prop"],
  };
  const remaining = createStoryAssetBatchRun(graph, remainingOperation, () => "remaining-run");
  assert.equal(advanceWorkflowBatch(remaining.graph, remaining.batch).readySchedulerIds.length, 3);
  assert.match(describeStoryAssetRun(graph, remainingOperation), /3 个资产图片/);

  const rerun = createStoryAssetBatchRun(graph, {
    type: "run_story_assets",
    storyId: analysis.storyId,
    assetRefs: ["lead"],
  }, () => "rerun-foundation");
  const rerunAnalysis = rerun.graph.nodes.find((node) => node.storyRole === "analysis");
  assert.equal(rerunAnalysis.foundationApprovedAt, undefined);
  assert.equal(rerunAnalysis.planningStatus, "awaiting-foundation-generation");
  assert.equal(rerun.graph.nodes.filter((node) => !node.foundationRole && node.assetRef).length, 9);
});
