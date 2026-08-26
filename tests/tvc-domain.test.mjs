import assert from "node:assert/strict";
import test from "node:test";
import {
  createTvcAssetPlan,
  createTvcBrief,
  createTvcPromptPackage,
  buildTvcPromptPlan,
  emptyTvcWorkflowGraph,
  isTvcProject,
  lockTvcScript,
  readTvcProject,
  prepareTvcPromptPlan,
  saveTvcPromptPlanBoundaries,
  saveTvcStoryboardTableDraft,
  isActiveTvcVideoScheduler,
  isHistoricalTvcVideoScheduler,
  isRunnableTvcVideoScheduler,
  isTvcVideoManualOverride,
  markTvcVideoSchedulerManualOverride,
  syncTvcVideoWorkflow,
  tvcVideoSchedulerRunError,
  tvcAgentSummary,
  updateTvcBrief,
  writeTvcStoryboardDraft,
} from "../app/workflow/tvc.ts";
import {
  buildWorkflowGenerationPrompt,
  createWorkflowRun,
  parseWorkflowGraph,
  readWorkflowInputs,
} from "../app/workflow/graph.ts";
import {
  applyWorkflowAgentOperations,
  createWorkflowAgentSnapshot,
} from "../app/workflow/agent.ts";

function ids() {
  let index = 0;
  return () => `tvc-${++index}`;
}

function referenceNode(id = "reference", projectId) {
  return {
    id,
    x: 0,
    y: 0,
    type: "result",
    kind: "image",
    text: "",
    schedulerId: `${id}-scheduler`,
    model: "gpt-image-2",
    status: "success",
    progress: "已完成",
    error: "",
    assetId: "asset-reference",
    label: "产品参考图",
    tvcProjectId: projectId,
  };
}

function brief(referenceId = "reference") {
  return {
    goal: "让亲子游客理解园区午后体验。",
    audience: "带幼儿的家庭游客",
    targetDuration: 8,
    aspectRatio: "16:9",
    platform: "Seedance 2.5",
    maxDuration: 30,
    style: "明亮原创动画，柔和自然光。",
    narrativeMode: "引导游览",
    audioPolicy: "只保留旁白、环境声和拟声，绝不出现任何BGM。",
    copy: "周末来公园散步。",
    referenceMap: [{
      nodeId: referenceId,
      roles: ["prop-product", "first-frame"],
      note: "控制产品外观和开场构图。",
    }],
  };
}

function row(shotNumber, startSecond, endSecond) {
  return {
    shotNumber,
    startSecond,
    endSecond,
    durationSeconds: endSecond - startSecond,
    referenceScene: "图1 · 产品参考图",
    sceneTime: "园区湖畔·午后",
    shotSizeLens: "35mm 中景",
    camera: "眼平，缓慢后退",
    composition: "人物与产品位于三分线，湖面作为背景。",
    performance: "角色指向产品后停顿并微笑。",
    narration: "周末来公园散步。",
    sound: "轻风、树叶和远处游客声。",
    transition: "HARD CUT",
    constraints: "角色与产品造型严格服从图1。",
    referenceNodeIds: ["reference"],
  };
}

function tableRow(shotNumber, durationSeconds, referenceNodeIds = ["reference"]) {
  const draft = row(shotNumber, 0, durationSeconds);
  return {
    ...draft,
    durationSeconds,
    referenceNodeIds,
  };
}

function initializedGraph() {
  const idFactory = ids();
  const initial = emptyTvcWorkflowGraph(idFactory);
  const graph = { ...initial, nodes: [referenceNode("reference", initial.tvc?.projectId)] };
  const created = createTvcBrief(graph, {
    type: "create_tvc_brief",
    ref: "brief-1",
    title: "亲子园区午后",
    brief: brief(),
  }, idFactory);
  return { graph: created.graph, idFactory, projectId: created.projectId };
}

function plannedUnits(graph, prompts) {
  const plan = readTvcProject(graph)?.promptPlan;
  assert.ok(plan?.length, "a locked storyboard needs a persisted video segment plan");
  return plan.map((segment, index) => ({
    ...segment,
    prompt: prompts[index] ?? `片段 ${index + 1} 的最终视频提示词。`,
  }));
}

test("keeps v1 graph compatibility while retaining the TVC project state", () => {
  const { graph } = initializedGraph();
  const restored = parseWorkflowGraph(JSON.stringify(graph));
  assert.equal(isTvcProject(restored), true);
  assert.equal(readTvcProject(restored)?.phase, "script-draft");
  assert.deepEqual(tvcAgentSummary(restored), {
    projectId: readTvcProject(restored)?.projectId,
    stage: "script-draft",
    revision: 1,
    title: "亲子园区午后",
    targetModel: "Seedance 2.5",
    targetMaxDuration: 30,
  });
  assert.equal(parseWorkflowGraph(JSON.stringify({ version: 1, nodes: [], edges: [] })).tvc, undefined);
});

test("applies TVC Agent operations only to an initialized TVC graph and exposes its stage", () => {
  const idFactory = ids();
  const graph = {
    ...emptyTvcWorkflowGraph(idFactory),
    nodes: [referenceNode("reference", "tvc-1")],
  };
  const applied = applyWorkflowAgentOperations(graph, [{
    type: "create_tvc_brief",
    ref: "brief-1",
    title: "亲子园区午后",
    brief: brief(),
  }]);
  assert.match(applied.messages[0], /资料梳理/);
  const snapshot = createWorkflowAgentSnapshot(
    applied.graph,
    { x: 0, y: 0, scale: 1 },
    { width: 1200, height: 800 },
  );
  assert.equal(snapshot.tvc?.stage, "script-draft");
  assert.equal(snapshot.tvc?.projectId, readTvcProject(applied.graph)?.projectId);
  assert.equal(snapshot.tvc?.revision, 1);
  assert.throws(
    () => applyWorkflowAgentOperations({ version: 1, nodes: [], edges: [] }, [{
      type: "create_tvc_brief",
      ref: "brief-1",
      title: "不应混入普通项目",
      brief: { ...brief(), referenceMap: [] },
    }]),
    /不是 TVC/,
  );
});

test("creates only reusable TVC asset-plan nodes and never starts media work", () => {
  const { graph, idFactory, projectId } = initializedGraph();
  const created = createTvcAssetPlan(graph, {
    type: "create_tvc_asset_plan",
    projectId,
    assets: [{
      ref: "mascot",
      name: "园区吉祥物",
      kind: "character",
      description: "圆润的蓝色吉祥物。",
      reason: "缺少稳定角色参考。",
      imagePrompt: "原创蓝色园区吉祥物设定图。",
    }],
  }, idFactory);
  const nodes = created.graph.nodes.filter(
    (node) => node.tvcProjectId === projectId && Boolean(node.storyRole),
  );
  assert.deepEqual(nodes.map((node) => node.storyRole), [
    "tvc-brief",
    "tvc-asset-spec",
    "tvc-asset-scheduler",
    "tvc-asset-result",
  ]);
  const placeholder = nodes.find((node) => node.storyRole === "tvc-asset-result");
  const scheduler = nodes.find((node) => node.storyRole === "tvc-asset-scheduler");
  assert.equal(scheduler.model, "gpt-image-2");
  assert.equal(scheduler.aspectRatio, "16:9");
  assert.equal(scheduler.resolution, "1K");
  assert.equal(placeholder.model, "gpt-image-2");
  assert.equal(placeholder.status, "ready");
  assert.equal(placeholder.taskId, undefined);
  assert.equal(created.graph.edges.filter((edge) => edge.targetId === placeholder.id).length, 1);
});

test("requires a continuous 13-column draft, explicit lock, and a locked-revision prompt package", () => {
  const { graph, idFactory, projectId } = initializedGraph();
  const drafted = writeTvcStoryboardDraft(graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 4), row("002", 4, 8)],
  }, idFactory);
  const draft = readTvcProject(drafted.graph);
  assert.equal(draft?.phase, "script-draft");
  assert.equal(draft?.storyboard?.rows[0].timecode, "00:00–00:04");
  assert.deepEqual(draft?.storyboard?.rows[1].referenceNodeIds, ["reference"]);
  assert.throws(
    () => createTvcPromptPackage(drafted.graph, {
      type: "create_tvc_prompt_package",
      projectId,
      sourceRevision: drafted.revision,
      units: [],
    }, idFactory),
    /尚未锁定|缺少锁定/,
  );

  const locked = lockTvcScript(drafted.graph, 100);
  const [unit] = plannedUnits(locked, ["【00:00–00:04】角色指向产品。第4秒 HARD CUT 至湖畔构图。"]);
  const prompted = createTvcPromptPackage(locked, {
    type: "create_tvc_prompt_package",
    projectId,
    sourceRevision: drafted.revision,
    units: [unit],
  }, idFactory);
  assert.equal(readTvcProject(prompted.graph)?.phase, "prompt-final");
  assert.equal(prompted.graph.nodes.filter((node) => node.storyRole === "tvc-prompt").length, 1);
  const revised = createTvcPromptPackage(prompted.graph, {
    type: "create_tvc_prompt_package",
    projectId,
    sourceRevision: drafted.revision,
    units: plannedUnits(prompted.graph, ["【00:00–00:04】角色指向产品。第4秒 HARD CUT 至湖畔构图。只微调措辞，不改变锁定分镜。"]),
  }, idFactory);
  assert.equal(readTvcProject(revised.graph)?.promptUnits?.[0]?.prompt.includes("只微调措辞"), true);
  assert.equal(revised.graph.nodes.filter((node) => node.storyRole === "tvc-prompt").length, 1);
  assert.throws(
    () => createTvcPromptPackage(locked, {
      type: "create_tvc_prompt_package",
      projectId,
      sourceRevision: drafted.revision,
      units: plannedUnits(locked, ["J-cut 进入下一段。"]),
    }, idFactory),
    /音频切换规则/,
  );
});

test("materializes each locked prompt unit as an idempotent SD 2.5 video workflow with ordered image inputs", () => {
  const { graph, idFactory, projectId } = initializedGraph();
  const drafted = writeTvcStoryboardDraft(graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 4), row("002", 4, 8)],
  }, idFactory);
  const locked = lockTvcScript(drafted.graph, 100);
  const [unit] = plannedUnits(locked, ["【00:00–00:04】角色指向产品。第4秒 HARD CUT 至湖畔构图。"]);
  const prompted = createTvcPromptPackage(locked, {
    type: "create_tvc_prompt_package",
    projectId,
    sourceRevision: drafted.revision,
    units: [unit],
  }, idFactory);
  const scheduler = prompted.graph.nodes.find((node) => node.storyRole === "tvc-video-scheduler");
  const result = prompted.graph.nodes.find((node) => node.storyRole === "tvc-video-result");
  const prompt = prompted.graph.nodes.find((node) => node.storyRole === "tvc-prompt");

  assert.equal(prompted.schedulerIds.length, 1);
  assert.equal(scheduler?.type, "scheduler");
  assert.equal(scheduler?.model, "doubao-seedance-2-5-quannengcankao");
  assert.equal(scheduler?.resolution, "720p");
  assert.equal(scheduler?.aspectRatio, "16:9");
  assert.equal(scheduler?.duration, "8");
  assert.equal(scheduler?.outputCount, 1);
  assert.equal(scheduler?.tvcUnitRef, "segment-001");
  assert.equal(scheduler?.tvcPromptRevision, drafted.revision);
  assert.equal(result?.type, "result");
  assert.equal(result?.status, "ready");
  assert.equal(result?.schedulerId, scheduler?.id);
  assert.deepEqual(
    prompted.graph.edges
      .filter((edge) => edge.targetId === scheduler?.id)
      .map((edge) => edge.sourceId),
    [prompt?.id, "reference"],
  );
  assert.equal(
    buildWorkflowGenerationPrompt(
      readWorkflowInputs(prompted.graph, scheduler?.id ?? ""),
      scheduler,
    ),
    scheduler?.prompt,
  );
  assert.match(scheduler?.prompt ?? "", /^本视频片段仅生成 0 至 8 秒内的画面与动作。/);
  assert.match(scheduler?.prompt ?? "", /【00:00–00:04｜镜头 001】/);
  assert.match(scheduler?.prompt ?? "", /【00:04–00:08｜镜头 002】/);
  assert.equal(isActiveTvcVideoScheduler(prompted.graph, scheduler), true);
  assert.equal(isTvcVideoManualOverride(scheduler), false);
  assert.equal(isRunnableTvcVideoScheduler(prompted.graph, scheduler), true);
  assert.equal(isHistoricalTvcVideoScheduler(prompted.graph, scheduler), false);
  const synced = syncTvcVideoWorkflow(prompted.graph, idFactory);
  assert.strictEqual(synced.graph, prompted.graph);
  assert.deepEqual(synced.schedulerIds, [scheduler?.id]);
  assert.equal(synced.skippedUnitRefs.length, 0);
  const unknown = {
    ...prompted.graph,
    nodes: prompted.graph.nodes.map((node) => node.id === result?.id
      ? {
          ...node,
          status: "submission-unknown",
          progress: "提交状态未知",
          error: "媒体服务未返回任务编号。",
        }
      : node),
  };
  const preservedUnknown = syncTvcVideoWorkflow(unknown, idFactory);
  assert.equal(
    preservedUnknown.graph.nodes.find((node) => node.id === result?.id)?.status,
    "submission-unknown",
  );
  assert.equal(parseWorkflowGraph(JSON.stringify(prompted.graph)).nodes.find(
    (node) => node.id === scheduler?.id,
  )?.storyRole, "tvc-video-scheduler");
});

test("keeps a manual TVC video override runnable, traceable, and archived on replanning", () => {
  const { graph, idFactory, projectId } = initializedGraph();
  const drafted = writeTvcStoryboardDraft(graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 4), row("002", 4, 8)],
  }, idFactory);
  const locked = lockTvcScript(drafted.graph, 1);
  const prompted = createTvcPromptPackage(locked, {
    type: "create_tvc_prompt_package",
    projectId,
    sourceRevision: drafted.revision,
    units: plannedUnits(locked, ["八秒产品展示。"]),
  }, idFactory);
  const automatic = prompted.graph.nodes.find(
    (node) => node.storyRole === "tvc-video-scheduler",
  );
  assert.equal(automatic?.type, "scheduler");
  const edited = {
    ...prompted.graph,
    nodes: prompted.graph.nodes.map((node) => node.id === automatic?.id
      ? {
          ...node,
          prompt: "手工改写的 5 秒视频提示词。",
          model: "viduq3",
          aspectRatio: "9:16",
          resolution: "540p",
          duration: "5",
          outputCount: 2,
        }
      : node),
  };
  const overridden = markTvcVideoSchedulerManualOverride(edited, automatic?.id ?? "");
  const withAdditionalAsset = {
    ...overridden,
    nodes: [...overridden.nodes, referenceNode("manual-reference", projectId)],
    edges: [
      ...overridden.edges,
      { id: "manual-reference-edge", sourceId: "manual-reference", targetId: automatic?.id ?? "" },
    ],
  };
  const manual = withAdditionalAsset.nodes.find((node) => node.id === automatic?.id);

  assert.equal(isTvcVideoManualOverride(manual), true);
  assert.equal(manual?.tvcVideoManualOverride?.sourceRevision, drafted.revision);
  assert.equal(manual?.tvcVideoManualOverride?.sourceUnitRef, "segment-001");
  assert.deepEqual([
    manual?.tvcVideoManualOverride?.sourceStartSecond,
    manual?.tvcVideoManualOverride?.sourceEndSecond,
  ], [0, 8]);
  assert.match(manual?.tvcVideoManualOverride?.sourcePrompt ?? "", /^本视频片段仅生成 0 至 8 秒内的画面与动作。/);
  assert.equal(isActiveTvcVideoScheduler(withAdditionalAsset, manual), false);
  assert.equal(isHistoricalTvcVideoScheduler(withAdditionalAsset, manual), false);
  assert.equal(tvcVideoSchedulerRunError(withAdditionalAsset, manual), null);
  assert.equal(isRunnableTvcVideoScheduler(withAdditionalAsset, manual), true);
  assert.equal(
    parseWorkflowGraph(JSON.stringify(withAdditionalAsset)).nodes.find((node) => node.id === automatic?.id)?.tvcVideoManualOverride?.sourceUnitRef,
    "segment-001",
  );

  const synced = syncTvcVideoWorkflow(withAdditionalAsset, idFactory);
  assert.strictEqual(synced.graph, withAdditionalAsset);
  assert.deepEqual(synced.schedulerIds, [automatic?.id]);
  assert.equal(synced.graph.nodes.filter((node) => node.storyRole === "tvc-video-scheduler").length, 1);
  assert.deepEqual(
    synced.graph.edges.filter((edge) => edge.targetId === automatic?.id).map((edge) => edge.sourceId),
    [
      synced.graph.nodes.find((node) => node.storyRole === "tvc-prompt")?.id,
      "reference",
      "manual-reference",
    ],
  );

  const replanned = writeTvcStoryboardDraft(withAdditionalAsset, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 4), row("002", 4, 8)],
  }, idFactory).graph;
  const historical = replanned.nodes.find((node) => node.id === automatic?.id);
  const historicalResult = replanned.nodes.find(
    (node) => node.storyRole === "tvc-video-result",
  );
  assert.equal(historical?.tvcVideoHistorical, true);
  assert.equal(historical?.tvcVideoManualOverride?.sourceUnitRef, "segment-001");
  assert.equal(historicalResult?.tvcVideoHistorical, true);
  assert.equal(isHistoricalTvcVideoScheduler(replanned, historical), true);
  assert.equal(isRunnableTvcVideoScheduler(replanned, historical), false);
});

test("rejects non-current or unfinished image inputs for a manual TVC video override", () => {
  const { graph, idFactory, projectId } = initializedGraph();
  const drafted = writeTvcStoryboardDraft(graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 4), row("002", 4, 8)],
  }, idFactory);
  const locked = lockTvcScript(drafted.graph, 1);
  const prompted = createTvcPromptPackage(locked, {
    type: "create_tvc_prompt_package",
    projectId,
    sourceRevision: drafted.revision,
    units: plannedUnits(locked, ["八秒产品展示。"]),
  }, idFactory);
  const scheduler = prompted.graph.nodes.find(
    (node) => node.storyRole === "tvc-video-scheduler",
  );
  const changed = {
    ...prompted.graph,
    nodes: prompted.graph.nodes.map((node) => node.id === scheduler?.id
      ? { ...node, prompt: "手工版本。" }
      : node),
  };
  const overridden = markTvcVideoSchedulerManualOverride(changed, scheduler?.id ?? "");
  const foreign = {
    ...overridden,
    nodes: [...overridden.nodes, referenceNode("foreign-reference", "other-project")],
    edges: overridden.edges.map((edge) =>
      edge.targetId === scheduler?.id && edge.sourceId === "reference"
        ? { ...edge, sourceId: "foreign-reference" }
        : edge),
  };
  const manual = foreign.nodes.find((node) => node.id === scheduler?.id);
  assert.equal(
    tvcVideoSchedulerRunError(foreign, manual),
    "TVC 视频调度器只能引用当前项目已成功的图片资产。",
  );
  assert.equal(isRunnableTvcVideoScheduler(foreign, manual), false);

  const unfinished = {
    ...overridden,
    nodes: overridden.nodes.map((node) => node.id === "reference"
      ? { ...node, status: "failed" }
      : node),
  };
  assert.equal(
    tvcVideoSchedulerRunError(unfinished, unfinished.nodes.find((node) => node.id === scheduler?.id)),
    "TVC 视频调度器只能引用当前项目已成功的图片资产。",
  );
});

test("creates every requested video result for a manual TVC override without changing the automatic workflow", () => {
  const { graph, idFactory, projectId } = initializedGraph();
  const drafted = writeTvcStoryboardDraft(graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 4), row("002", 4, 8)],
  }, idFactory);
  const locked = lockTvcScript(drafted.graph, 1);
  const prompted = createTvcPromptPackage(locked, {
    type: "create_tvc_prompt_package",
    projectId,
    sourceRevision: drafted.revision,
    units: plannedUnits(locked, ["八秒产品展示。"]),
  }, idFactory);
  const scheduler = prompted.graph.nodes.find(
    (node) => node.storyRole === "tvc-video-scheduler",
  );
  const overridden = markTvcVideoSchedulerManualOverride({
    ...prompted.graph,
    nodes: prompted.graph.nodes.map((node) => node.id === scheduler?.id
      ? { ...node, outputCount: 3 }
      : node),
  }, scheduler?.id ?? "");
  const run = createWorkflowRun(overridden, scheduler?.id ?? "", 100, idFactory);
  const results = run.graph.nodes.filter(
    (node) => node.type === "result" && node.schedulerId === scheduler?.id,
  );

  assert.equal(run.resultIds.length, 3);
  assert.equal(results.length, 3);
  assert.ok(results.every((node) =>
    node.storyRole === "tvc-video-result" &&
    node.tvcProjectId === projectId &&
    node.tvcUnitRef === "segment-001" &&
    node.tvcPromptRevision === drafted.revision &&
    node.kind === "video" &&
    node.model === "doubao-seedance-2-5-quannengcankao" &&
    node.status === "pending" &&
    node.progress === "等待提交" &&
    node.startedAt === 100,
  ));
  assert.equal(
    run.graph.edges.filter((edge) => edge.sourceId === scheduler?.id).length,
    3,
  );
  const blockedByPending = createWorkflowRun(run.graph, scheduler?.id ?? "", 101, idFactory);
  assert.strictEqual(blockedByPending.graph, run.graph);
  assert.deepEqual(blockedByPending.resultIds, []);
});

test("builds a greedy 30-second prompt plan at whole-shot boundaries and rebalances a short tail", () => {
  const { graph, idFactory, projectId } = initializedGraph();
  const configured = updateTvcBrief(graph, {
    type: "update_tvc_brief",
    projectId,
    brief: { ...brief(), targetDuration: 32 },
  }, idFactory);
  const drafted = writeTvcStoryboardDraft(configured.graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 20), row("002", 20, 30), row("003", 30, 32)],
  }, idFactory);
  const storyboard = readTvcProject(drafted.graph)?.storyboard;
  assert.ok(storyboard);
  assert.deepEqual(buildTvcPromptPlan(storyboard), [
    {
      ref: "segment-001",
      startSecond: 0,
      endSecond: 20,
      shotNumbers: ["001"],
      referenceNodeIds: ["reference"],
    },
    {
      ref: "segment-002",
      startSecond: 20,
      endSecond: 32,
      shotNumbers: ["002", "003"],
      referenceNodeIds: ["reference"],
    },
  ]);

  const locked = lockTvcScript(drafted.graph, 1);
  assert.deepEqual(readTvcProject(locked)?.promptPlan, buildTvcPromptPlan(storyboard));

  const impossible = writeTvcStoryboardDraft(configured.graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 30), row("002", 30, 32)],
  }, idFactory);
  assert.throws(
    () => lockTvcScript(impossible.graph, 1),
    /最后一个视频片段不足 4 秒/,
  );
});

test("requires every Agent prompt unit to match the persisted 30-second plan exactly", () => {
  const { graph, idFactory, projectId } = initializedGraph();
  const configured = updateTvcBrief(graph, {
    type: "update_tvc_brief",
    projectId,
    brief: { ...brief(), targetDuration: 12 },
  }, idFactory);
  const drafted = writeTvcStoryboardDraft(configured.graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 4), row("002", 4, 8), row("003", 8, 12)],
  }, idFactory);
  const locked = lockTvcScript(drafted.graph, 1);
  const [unit] = plannedUnits(locked, ["完整的 12 秒片段。"]);
  assert.throws(
    () => createTvcPromptPackage(locked, {
      type: "create_tvc_prompt_package",
      projectId,
      sourceRevision: drafted.revision,
      units: [{ ...unit, shotNumbers: ["001", "003"] }],
    }, idFactory),
    /严格匹配已锁定的视频片段计划/,
  );
  assert.throws(
    () => createTvcPromptPackage(locked, {
      type: "create_tvc_prompt_package",
      projectId,
      sourceRevision: drafted.revision,
      units: [{ ...unit, endSecond: 8 }],
    }, idFactory),
    /严格匹配已锁定的视频片段计划/,
  );
});

test("only explicitly rebuilding a locked TVC project replaces old ready prompt workflow with a 30-second plan", () => {
  const { graph, idFactory, projectId } = initializedGraph();
  const drafted = writeTvcStoryboardDraft(graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 4), row("002", 4, 8)],
  }, idFactory);
  const locked = lockTvcScript(drafted.graph, 1);
  const prompted = createTvcPromptPackage(locked, {
    type: "create_tvc_prompt_package",
    projectId,
    sourceRevision: drafted.revision,
    units: plannedUnits(locked, ["旧片段提示词。"]),
  }, idFactory);
  const legacy = {
    ...prompted.graph,
    tvc: { ...readTvcProject(prompted.graph), promptPlan: undefined },
  };
  assert.strictEqual(syncTvcVideoWorkflow(legacy, idFactory).graph, legacy);

  const rebuilt = prepareTvcPromptPlan(legacy);
  assert.equal(readTvcProject(rebuilt.graph)?.phase, "script-locked");
  assert.equal(readTvcProject(rebuilt.graph)?.promptUnits, undefined);
  assert.equal(readTvcProject(rebuilt.graph)?.promptPlan?.[0]?.endSecond, 8);
  assert.equal(rebuilt.graph.nodes.some((node) => node.storyRole === "tvc-prompt"), false);
  assert.equal(rebuilt.graph.nodes.some((node) => node.storyRole === "tvc-video-scheduler"), false);
});

test("saves complete TVC prompt-plan boundaries without changing locked storyboard and archives submitted history", () => {
  const { graph, idFactory, projectId } = initializedGraph();
  const configured = updateTvcBrief(graph, {
    type: "update_tvc_brief",
    projectId,
    brief: { ...brief(), targetDuration: 60 },
  }, idFactory);
  const drafted = writeTvcStoryboardDraft(configured.graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [
      row("001", 0, 10), row("002", 10, 20), row("003", 20, 30),
      row("004", 30, 40), row("005", 40, 50), row("006", 50, 60),
    ],
  }, idFactory);
  const locked = lockTvcScript(drafted.graph, 1);
  const prompted = createTvcPromptPackage(locked, {
    type: "create_tvc_prompt_package",
    projectId,
    sourceRevision: drafted.revision,
    units: plannedUnits(locked, ["前 30 秒。", "后 30 秒。"]),
  }, idFactory);
  const secondScheduler = prompted.graph.nodes.find((node) =>
    node.type === "scheduler" && node.tvcUnitRef === "segment-002"
  );
  assert.match(secondScheduler?.prompt ?? "", /^本视频片段仅生成 0 至 30 秒内的画面与动作。/);
  assert.match(secondScheduler?.prompt ?? "", /【00:00–00:10｜镜头 004】/);
  assert.doesNotMatch(secondScheduler?.prompt ?? "", /^【00:30/);
  const beforeProject = readTvcProject(prompted.graph);
  const firstResult = prompted.graph.nodes.find((node) =>
    node.type === "result" && node.storyRole === "tvc-video-result"
  );
  const submitted = {
    ...prompted.graph,
    nodes: prompted.graph.nodes.map((node) => node.id === firstResult?.id
      ? { ...node, status: "running", progress: "生成中", taskId: "task-001", startedAt: 1 }
      : node),
  };
  const saved = saveTvcPromptPlanBoundaries(submitted, [
    { startSecond: 0, endSecond: 20 },
    { startSecond: 20, endSecond: 40 },
    { startSecond: 40, endSecond: 60 },
  ]);
  const project = readTvcProject(saved.graph);
  assert.equal(project?.phase, "script-locked");
  assert.equal(project?.revision, (beforeProject?.revision ?? 0) + 1);
  assert.equal(project?.lockedRevision, project?.revision);
  assert.equal(project?.promptUnits, undefined);
  assert.deepEqual(project?.storyboard, beforeProject?.storyboard);
  assert.deepEqual(project?.promptPlan?.map((segment) => [segment.startSecond, segment.endSecond]), [
    [0, 20], [20, 40], [40, 60],
  ]);
  assert.equal(saved.graph.nodes.some((node) => node.storyRole === "tvc-prompt"), false);
  assert.equal(saved.graph.nodes.filter((node) => node.storyRole === "tvc-video-scheduler").length, 1);
  assert.equal(saved.graph.nodes.find((node) => node.storyRole === "tvc-video-scheduler")?.tvcVideoHistorical, true);
  assert.equal(saved.graph.nodes.find((node) => node.storyRole === "tvc-video-result")?.tvcVideoHistorical, true);

  const invalidCases = [
    [{ startSecond: 0, endSecond: 30 }, { startSecond: 31, endSecond: 60 }],
    [{ startSecond: 0, endSecond: 29 }, { startSecond: 29, endSecond: 60 }],
    [{ startSecond: 0, endSecond: 31 }, { startSecond: 31, endSecond: 60 }],
    [{ startSecond: 0, endSecond: 2 }, { startSecond: 2, endSecond: 60 }],
  ];
  for (const boundaries of invalidCases) {
    const snapshot = structuredClone(submitted);
    assert.throws(() => saveTvcPromptPlanBoundaries(submitted, boundaries));
    assert.deepEqual(submitted, snapshot);
  }
});

test("rejects locked TVC video plans outside the SD 2.5 duration and reference limits", () => {
  const shortIds = ids();
  const shortInitial = emptyTvcWorkflowGraph(shortIds);
  const shortCreated = createTvcBrief({
    ...shortInitial,
    nodes: [referenceNode("reference", shortInitial.tvc?.projectId)],
  }, {
    type: "create_tvc_brief",
    ref: "brief-short",
    title: "短片段",
    brief: { ...brief(), targetDuration: 3, maxDuration: 30 },
  }, shortIds);
  const shortDrafted = writeTvcStoryboardDraft(shortCreated.graph, {
    type: "write_tvc_storyboard_draft",
    projectId: shortCreated.projectId,
    rows: [row("001", 0, 3)],
  }, shortIds);
  assert.throws(
    () => lockTvcScript(shortDrafted.graph, 1),
    /不足 4 秒/,
  );

  const { graph, idFactory, projectId } = initializedGraph();
  const references = Array.from({ length: 31 }, (_, index) => `reference-${index + 1}`);
  const manyReferences = {
    ...graph,
    nodes: [
      ...graph.nodes,
      ...references.map((id) => ({
        ...referenceNode(id, projectId),
        assetId: `asset-${id}`,
      })),
    ],
  };
  const manyDrafted = writeTvcStoryboardDraft(manyReferences, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [{ ...row("001", 0, 4), referenceNodeIds: references }, { ...row("002", 4, 8), referenceNodeIds: references }],
  }, idFactory);
  assert.throws(
    () => lockTvcScript(manyDrafted.graph, 1),
    /最多只能引用 30 张图片/,
  );

  const foreign = {
    ...graph,
    nodes: [...graph.nodes, referenceNode("foreign-reference", "other-tvc-project")],
  };
  const foreignDrafted = writeTvcStoryboardDraft(foreign, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [
      { ...row("001", 0, 4), referenceNodeIds: ["foreign-reference"] },
      { ...row("002", 4, 8), referenceNodeIds: ["foreign-reference"] },
    ],
  }, idFactory);
  const foreignLocked = lockTvcScript(foreignDrafted.graph, 1);
  assert.throws(
    () => createTvcPromptPackage(foreignLocked, {
      type: "create_tvc_prompt_package",
      projectId,
      sourceRevision: foreignDrafted.revision,
      units: plannedUnits(foreignLocked, ["不能使用其他项目的图片。"]),
    }, idFactory),
    /不可用的成功图片资产/,
  );
});

test("cleans ready TVC video placeholders after a draft change and preserves submitted results as history", () => {
  const { graph, idFactory, projectId } = initializedGraph();
  const drafted = writeTvcStoryboardDraft(graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 4), row("002", 4, 8)],
  }, idFactory);
  const locked = lockTvcScript(drafted.graph, 1);
  const prompted = createTvcPromptPackage(locked, {
    type: "create_tvc_prompt_package",
    projectId,
    sourceRevision: drafted.revision,
    units: plannedUnits(locked, ["八秒产品展示。"]),
  }, idFactory);
  const readyCleared = writeTvcStoryboardDraft(prompted.graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 4), row("002", 4, 8)],
  }, idFactory);
  assert.equal(readyCleared.graph.nodes.some((node) => node.storyRole === "tvc-video-scheduler"), false);
  assert.equal(readyCleared.graph.nodes.some((node) => node.storyRole === "tvc-video-result"), false);

  const result = prompted.graph.nodes.find((node) => node.storyRole === "tvc-video-result");
  const submitted = {
    ...prompted.graph,
    nodes: prompted.graph.nodes.map((node) => node.id === result?.id
      ? { ...node, status: "success", progress: "已完成", taskId: "task-001" }
      : node),
  };
  const revised = updateTvcBrief(submitted, {
    type: "update_tvc_brief",
    projectId,
    brief: { ...brief(), style: "更新后的广告质感。" },
  }, idFactory);
  const historicalScheduler = revised.graph.nodes.find((node) => node.storyRole === "tvc-video-scheduler");
  const historicalResult = revised.graph.nodes.find((node) => node.storyRole === "tvc-video-result");
  assert.equal(historicalScheduler?.tvcVideoHistorical, true);
  assert.equal(historicalResult?.tvcVideoHistorical, true);
  assert.equal(isHistoricalTvcVideoScheduler(revised.graph, historicalScheduler), true);
  assert.equal(revised.graph.nodes.some((node) => node.storyRole === "tvc-prompt"), false);
});

test("archives a submitted unit before replacing changed prompt text at the same locked revision", () => {
  const { graph, idFactory, projectId } = initializedGraph();
  const drafted = writeTvcStoryboardDraft(graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 4), row("002", 4, 8)],
  }, idFactory);
  const locked = lockTvcScript(drafted.graph, 1);
  const first = createTvcPromptPackage(locked, {
    type: "create_tvc_prompt_package",
    projectId,
    sourceRevision: drafted.revision,
    units: plannedUnits(locked, ["第一版八秒产品展示。"]),
  }, idFactory);
  const firstResult = first.graph.nodes.find((node) => node.storyRole === "tvc-video-result");
  const submitted = {
    ...first.graph,
    nodes: first.graph.nodes.map((node) => node.id === firstResult?.id
      ? { ...node, status: "running", progress: "生成中", taskId: "task-001", startedAt: 1 }
      : node),
  };
  const rewritten = createTvcPromptPackage(submitted, {
    type: "create_tvc_prompt_package",
    projectId,
    sourceRevision: drafted.revision,
    units: plannedUnits(submitted, ["第二版八秒产品展示，保持同一锁稿分镜。"]),
  }, idFactory);
  const schedulers = rewritten.graph.nodes.filter((node) => node.storyRole === "tvc-video-scheduler");
  const results = rewritten.graph.nodes.filter((node) => node.storyRole === "tvc-video-result");
  const historical = schedulers.find((node) => node.tvcVideoHistorical);
  const active = schedulers.find((node) => !node.tvcVideoHistorical);

  assert.equal(schedulers.length, 2);
  assert.equal(results.length, 2);
  assert.match(historical?.prompt ?? "", /第一版八秒产品展示。/);
  assert.equal(historical?.tvcVideoHistorical, true);
  assert.match(active?.prompt ?? "", /第二版八秒产品展示，保持同一锁稿分镜。/);
  assert.equal(isHistoricalTvcVideoScheduler(rewritten.graph, historical), true);
  assert.equal(isActiveTvcVideoScheduler(rewritten.graph, active), true);
});

test("saves editable TVC table rows with derived timecodes and invalidates the locked prompt package", () => {
  const { graph, idFactory, projectId } = initializedGraph();
  const drafted = writeTvcStoryboardDraft(graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 4), row("002", 4, 8)],
  }, idFactory);
  const locked = lockTvcScript(drafted.graph, 100);
  const prompted = createTvcPromptPackage(locked, {
    type: "create_tvc_prompt_package",
    projectId,
    sourceRevision: drafted.revision,
    units: plannedUnits(locked, ["【00:00–00:04】角色指向产品。第4秒 HARD CUT 至湖畔构图。"]),
  }, idFactory);
  const before = readTvcProject(prompted.graph);
  const saved = saveTvcStoryboardTableDraft(prompted.graph, [
    tableRow("001", 3),
    tableRow("002", 5),
  ], idFactory);
  const project = readTvcProject(saved.graph);

  assert.equal(project?.phase, "script-draft");
  assert.equal(project?.revision, before.revision + 1);
  assert.equal(project?.lockedAt, undefined);
  assert.equal(project?.lockedRevision, undefined);
  assert.equal(project?.promptUnits, undefined);
  assert.equal(project?.promptSourceRevision, undefined);
  assert.deepEqual(project?.storyboard?.rows.map((item) => item.timecode), ["00:00–00:03", "00:03–00:08"]);
  assert.equal(saved.graph.nodes.some((node) => node.storyRole === "tvc-prompt"), false);
});

test("rejects invalid editable TVC table rows without mutating the current graph", () => {
  const { graph, idFactory, projectId } = initializedGraph();
  const drafted = writeTvcStoryboardDraft(graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 4), row("002", 4, 8)],
  }, idFactory);
  const invalidCases = [
    {
      label: "zero duration",
      rows: [tableRow("001", 0), tableRow("002", 8)],
      error: /镜号或时间码无效/,
    },
    {
      label: "duplicate shot number",
      rows: [tableRow("001", 4), tableRow("001", 4)],
      error: /镜号或时间码无效/,
    },
    {
      label: "missing reference",
      rows: [tableRow("001", 4, ["missing-reference"]), tableRow("002", 4)],
      error: /不可用的图片节点/,
    },
    {
      label: "target duration mismatch",
      rows: [tableRow("001", 4), tableRow("002", 3)],
      error: /总时长为 7 秒，与目标 8 秒不一致/,
    },
  ];

  for (const invalidCase of invalidCases) {
    const snapshot = structuredClone(drafted.graph);
    assert.throws(
      () => saveTvcStoryboardTableDraft(drafted.graph, invalidCase.rows, idFactory),
      invalidCase.error,
      invalidCase.label,
    );
    assert.deepEqual(drafted.graph, snapshot, `${invalidCase.label} must not mutate the graph`);
  }
});

test("invalid references are rejected atomically and brief revisions revoke the lock", () => {
  const { graph, idFactory, projectId } = initializedGraph();
  const withVideo = {
    ...graph,
    nodes: [...graph.nodes, { id: "video", x: 0, y: 300, type: "source", kind: "video", text: "", assetId: "video-1" }],
  };
  assert.throws(
    () => updateTvcBrief(withVideo, {
      type: "update_tvc_brief",
      projectId,
      brief: brief("video"),
    }, idFactory),
    /不可用/,
  );
  assert.equal(readTvcProject(withVideo)?.phase, "script-draft");

  const drafted = writeTvcStoryboardDraft(graph, {
    type: "write_tvc_storyboard_draft",
    projectId,
    rows: [row("001", 0, 4), row("002", 4, 8)],
  }, idFactory);
  const locked = lockTvcScript(drafted.graph, 100);
  const updated = updateTvcBrief(locked, {
    type: "update_tvc_brief",
    projectId,
    brief: { ...brief(), style: "柔和水彩质感。" },
  }, idFactory);
  assert.equal(readTvcProject(updated.graph)?.phase, "script-draft");
  assert.equal(readTvcProject(updated.graph)?.lockedAt, undefined);
  assert.equal(updated.graph.nodes.some((node) => node.storyRole === "tvc-prompt"), false);
});
