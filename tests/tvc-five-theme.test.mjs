import assert from "node:assert/strict";
import test from "node:test";
import {
  createTvcAssetPlan,
  createTvcBrief,
  createTvcPromptPackage,
  emptyTvcWorkflowGraph,
  lockTvcScript,
  readTvcProject,
  writeTvcStoryboardDraft,
} from "../app/workflow/tvc.ts";

const LEGACY_BRIEF_MAX_DURATION = 12;
const STORYBOARD_COLUMNS = [
  "shotNumber",
  "timecode",
  "durationSeconds",
  "referenceScene",
  "sceneTime",
  "shotSizeLens",
  "camera",
  "composition",
  "performance",
  "narration",
  "sound",
  "transition",
  "constraints",
];

const SCENARIOS = [
  {
    title: "东方茶器·雨后茶室",
    durations: [4, 4, 4, 6, 6, 6],
    expectedUnits: 1,
    assetKinds: ["character", "scene", "prop"],
  },
  {
    title: "极简护肤瓶·晨光",
    durations: [3, 5, 4, 6, 6, 6],
    expectedUnits: 1,
    assetKinds: ["character", "scene", "prop"],
  },
  {
    title: "宠物友好公园·午后",
    durations: [3, 3, 6, 4, 4, 4, 6],
    expectedUnits: 1,
    assetKinds: ["character", "scene", "prop"],
  },
  {
    title: "独立书店·夜读",
    durations: [5, 3, 4, 6, 6, 6],
    expectedUnits: 1,
    assetKinds: ["character", "scene", "prop"],
  },
  {
    title: "山地生态度假村·一日",
    durations: [4, 4, 4, 5, 3, 4, 6, 6, 4, 4, 4, 5, 3, 4],
    expectedUnits: 2,
    assetKinds: ["character", "scene", "scene", "prop"],
  },
];

function ids(prefix) {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

function generatedImageResult(id, label, projectId) {
  return {
    id,
    x: 0,
    y: 0,
    type: "result",
    kind: "image",
    schedulerId: `${id}-scheduler`,
    text: `${label} · GPT Image 2 1K 结果`,
    label,
    model: "gpt-image-2",
    status: "success",
    progress: "已完成",
    error: "",
    assetId: `asset-${id}`,
    assetName: label,
    assetMimeType: "image/png",
    tvcProjectId: projectId,
  };
}

function formatTime(second) {
  return `${String(Math.floor(second / 60)).padStart(2, "0")}:${String(second % 60).padStart(2, "0")}`;
}

function createRows(scenario, imageNodeIds) {
  let cursor = 0;
  return scenario.durations.map((durationSeconds, index) => {
    const startSecond = cursor;
    const endSecond = startSecond + durationSeconds;
    cursor = endSecond;
    const primaryReference = imageNodeIds[index % imageNodeIds.length];
    return {
      shotNumber: String(index + 1).padStart(3, "0"),
      startSecond,
      endSecond,
      durationSeconds,
      referenceScene: `图${(index % imageNodeIds.length) + 1} · 已生成资产参考`,
      sceneTime: `${scenario.title} · 广告场景`,
      shotSizeLens: index % 3 === 0 ? "50mm 中近景" : "28mm 中景",
      camera: index % 2 === 0 ? "眼平缓慢推近" : "侧前方平稳跟随",
      composition: "主体位于三分线，保留清晰的环境层次与产品关系。",
      performance: "主体完成一个明确动作后停顿，保持与参考图一致的姿态和造型。",
      narration: "占位旁白，仅用于验证分镜表字段完整性。",
      sound: "环境声与轻微拟声，无 BGM。",
      transition: index === 0 ? "开场定场" : "HARD CUT",
      constraints: "无品牌、无徽标、无可读文字；参考资产的外观与空间关系保持一致。",
      referenceNodeIds: [primaryReference],
    };
  });
}

function promptUnitsFromPlan(project) {
  return (project?.promptPlan ?? []).map((segment) => ({
    ...segment,
    prompt: `【${formatTime(segment.startSecond)}–${formatTime(segment.endSecond)}】${segment.shotNumbers.join("、")} 的锁定 TVC 最终提示词。`,
  }));
}

function createScenarioGraph(scenario) {
  const idFactory = ids(scenario.title);
  const initial = emptyTvcWorkflowGraph(idFactory);
  const initialVisualId = "initial-visual";
  const createdBrief = createTvcBrief({
    ...initial,
    nodes: [generatedImageResult(
      initialVisualId,
      `${scenario.title} · 初始氛围视觉`,
      initial.tvc?.projectId,
    )],
  }, {
    type: "create_tvc_brief",
    ref: "brief",
    title: scenario.title,
    brief: {
      goal: `用 ${scenario.title} 验证真实资产驱动的 TVC 分镜表。`,
      audience: "通用广告验收受众",
      targetDuration: scenario.durations.reduce((total, duration) => total + duration, 0),
      aspectRatio: "16:9",
      platform: "测试视频平台",
      maxDuration: LEGACY_BRIEF_MAX_DURATION,
      style: "原创广告质感，无品牌、无徽标、无可读文字。",
      narrativeMode: "短片广告",
      audioPolicy: "仅使用旁白、环境声和拟声；无 BGM。",
      copy: "占位文案",
      referenceMap: [{
        nodeId: initialVisualId,
        roles: ["lighting-color", "first-frame"],
        note: "由 GPT Image 2 生成的初始氛围视觉。",
      }],
    },
  }, idFactory);
  const createdAssets = createTvcAssetPlan(createdBrief.graph, {
    type: "create_tvc_asset_plan",
    projectId: createdBrief.projectId,
    assets: scenario.assetKinds.map((kind, index) => ({
      ref: `${kind}-${index + 1}`,
      name: `${scenario.title} · ${kind} 资产 ${index + 1}`,
      kind,
      description: "用于本项目分镜表的稳定视觉参考。",
      reason: "验收 GPT Image 2 资产计划与结果引用。",
      imagePrompt: "原创广告资产图，16:9，无品牌、无徽标、无可读文字。",
    })),
  }, idFactory);
  const graphWithSuccesses = {
    ...createdAssets.graph,
    nodes: createdAssets.graph.nodes.map((node) => (
      node.type === "result" && node.storyRole === "tvc-asset-result"
        ? {
            ...node,
            model: "gpt-image-2",
            status: "success",
            progress: "已完成",
            assetId: `asset-${node.id}`,
            assetName: node.label,
            assetMimeType: "image/png",
          }
        : node
    )),
  };
  const resultNodes = graphWithSuccesses.nodes.filter((node) =>
    node.type === "result" && node.kind === "image" && node.status === "success",
  );
  const assetResultIds = resultNodes
    .filter((node) => node.storyRole === "tvc-asset-result")
    .map((node) => node.id);
  const imageNodeIds = [initialVisualId, ...assetResultIds];
  const rows = createRows(scenario, imageNodeIds);
  const drafted = writeTvcStoryboardDraft(graphWithSuccesses, {
    type: "write_tvc_storyboard_draft",
    projectId: createdBrief.projectId,
    rows,
  }, idFactory);
  const locked = lockTvcScript(drafted.graph, 1);
  const project = readTvcProject(locked);
  assert.ok(project?.storyboard, `${scenario.title} should have a locked storyboard`);
  const promptUnits = promptUnitsFromPlan(project);
  const prompted = createTvcPromptPackage(locked, {
    type: "create_tvc_prompt_package",
    projectId: createdBrief.projectId,
    sourceRevision: project.revision,
    units: promptUnits,
  }, idFactory);
  return { graph: prompted.graph, imageNodeIds, promptUnits };
}

test("keeps the fixed five-theme TVC acceptance matrix continuous, lockable, and GPT Image 2 referenced", () => {
  assert.equal(STORYBOARD_COLUMNS.length, 13);
  assert.deepEqual(SCENARIOS.map((scenario) => scenario.durations.reduce((total, duration) => total + duration, 0)), [
    30, 30, 30, 30, 60,
  ]);

  let videoSchedulerCount = 0;
  for (const scenario of SCENARIOS) {
    const { graph, imageNodeIds, promptUnits } = createScenarioGraph(scenario);
    const project = readTvcProject(graph);
    assert.equal(project?.phase, "prompt-final", `${scenario.title} should finish its prompt package`);
    assert.equal(project?.storyboard?.rows.length, scenario.durations.length);
    assert.equal(project?.storyboard?.targetDurationSeconds, scenario.durations.reduce((total, duration) => total + duration, 0));
    assert.equal(promptUnits.length, scenario.expectedUnits, `${scenario.title} should use the 30-second direct video plan`);

    const videoSchedulers = graph.nodes.filter((node) =>
      node.type === "scheduler" && node.storyRole === "tvc-video-scheduler",
    );
    assert.equal(videoSchedulers.length, scenario.expectedUnits);
    for (const scheduler of videoSchedulers) {
      assert.equal(scheduler.model, "doubao-seedance-2-5-quannengcankao");
      assert.equal(scheduler.resolution, "720p");
      assert.equal(scheduler.outputCount, 1);
    }
    videoSchedulerCount += videoSchedulers.length;

    const imageResults = new Map(graph.nodes
      .filter((node) => node.type === "result" && node.kind === "image")
      .map((node) => [node.id, node]));
    const initialVisual = imageResults.get("initial-visual");
    assert.equal(initialVisual?.model, "gpt-image-2");
    assert.equal(initialVisual?.status, "success");
    assert.ok(initialVisual?.assetId);
    const assetSchedulers = graph.nodes.filter((node) =>
      node.type === "scheduler" && node.storyRole === "tvc-asset-scheduler",
    );
    assert.equal(assetSchedulers.length, scenario.assetKinds.length);
    for (const scheduler of assetSchedulers) {
      assert.equal(scheduler.model, "gpt-image-2");
      assert.equal(scheduler.aspectRatio, "16:9");
      assert.equal(scheduler.resolution, "1K");
    }
    let cursor = 0;
    for (const [index, row] of (project?.storyboard?.rows ?? []).entries()) {
      assert.equal(row.shotNumber, String(index + 1).padStart(3, "0"));
      assert.equal(row.timecode, `${formatTime(cursor)}–${formatTime(cursor + row.durationSeconds)}`);
      for (const column of STORYBOARD_COLUMNS) {
        assert.ok(row[column], `${scenario.title} row ${row.shotNumber} needs ${column}`);
      }
      assert.ok(row.referenceNodeIds.length > 0);
      for (const nodeId of row.referenceNodeIds) {
        const result = imageResults.get(nodeId);
        assert.equal(result?.model, "gpt-image-2");
        assert.equal(result?.status, "success");
        assert.ok(result?.assetId);
      }
      cursor += row.durationSeconds;
    }
    assert.equal(cursor, project?.brief?.targetDuration);

    let promptCursor = 0;
    for (const unit of project?.promptUnits ?? []) {
      assert.equal(unit.startSecond, promptCursor);
      assert.ok(unit.endSecond - unit.startSecond >= 4);
      assert.ok(unit.endSecond - unit.startSecond <= 30);
      assert.doesNotMatch(unit.prompt, /\b[JL][ -]?cut\b/i);
      assert.ok(unit.referenceNodeIds.every((nodeId) => imageNodeIds.includes(nodeId)));
      promptCursor = unit.endSecond;
    }
    assert.equal(promptCursor, project?.brief?.targetDuration);
  }
  assert.equal(videoSchedulerCount, 6, "five rebuilt projects should materialize six direct video tasks");
});
