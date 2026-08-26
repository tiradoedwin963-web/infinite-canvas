import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseWorkflowGraph } from "../app/workflow/graph.ts";
import {
  createTvcBrief,
  createTvcPromptPackage,
  emptyTvcWorkflowGraph,
  lockTvcScript,
  readTvcProject,
  saveTvcPromptPlanBoundaries,
  saveTvcStoryboardTableDraft,
  writeTvcStoryboardDraft,
} from "../app/workflow/tvc.ts";

function ids() {
  let serial = 0;
  return () => `table-${++serial}`;
}

function referenceNode(projectId) {
  return {
    id: "reference",
    x: 0,
    y: 0,
    type: "result",
    kind: "image",
    text: "",
    schedulerId: "reference-scheduler",
    model: "gpt-image-2",
    status: "success",
    progress: "已完成",
    error: "",
    assetId: "asset-reference",
    label: "产品参考图",
    tvcProjectId: projectId,
  };
}

function brief() {
  return {
    goal: "建立产品的午后印象。",
    audience: "家庭游客",
    targetDuration: 8,
    aspectRatio: "16:9",
    platform: "测试平台",
    maxDuration: 8,
    style: "明亮自然的原创广告质感。",
    narrativeMode: "产品展示",
    audioPolicy: "旁白和环境声，无 BGM。",
    copy: "占位文案",
    referenceMap: [{
      nodeId: "reference",
      roles: ["prop-product", "first-frame"],
      note: "控制产品外观与开场构图。",
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
    sceneTime: "湖畔·午后",
    shotSizeLens: "35mm 中景",
    camera: "眼平缓慢后退",
    composition: "产品与角色位于三分线。",
    performance: "角色指向产品后停顿。",
    narration: "周末来公园散步。",
    sound: "轻风与远处游客声。",
    transition: "动作接切",
    constraints: "保持产品和场景结构。",
    referenceNodeIds: ["reference"],
  };
}

function tableRow(source, update = {}) {
  const draft = { ...source };
  delete draft.timecode;
  return { ...draft, ...update };
}

function promptFinalGraph() {
  const idFactory = ids();
  const initial = emptyTvcWorkflowGraph(idFactory);
  const withReference = {
    ...initial,
    nodes: [referenceNode(initial.tvc?.projectId)],
  };
  const created = createTvcBrief(withReference, {
    type: "create_tvc_brief",
    ref: "brief",
    title: "画布内分镜表验收",
    brief: brief(),
  }, idFactory);
  const drafted = writeTvcStoryboardDraft(created.graph, {
    type: "write_tvc_storyboard_draft",
    projectId: created.projectId,
    rows: [row("001", 0, 4), row("002", 4, 8)],
  }, idFactory);
  const locked = lockTvcScript(drafted.graph, 1);
  const prompted = createTvcPromptPackage(locked, {
    type: "create_tvc_prompt_package",
    projectId: created.projectId,
    sourceRevision: drafted.revision,
    units: [{
      ref: "segment-001",
      startSecond: 0,
      endSecond: 8,
      shotNumbers: ["001", "002"],
      referenceNodeIds: ["reference"],
      prompt: "【00:00–00:04】角色指向产品。第4秒 HARD CUT 至湖畔构图。",
    }],
  }, idFactory);
  return { graph: prompted.graph, idFactory };
}

test("saves canvas table rows through the existing draft path and derives timecodes", () => {
  const { graph, idFactory } = promptFinalGraph();
  const original = JSON.stringify(graph);
  const project = readTvcProject(graph);
  assert.ok(project?.storyboard);

  const saved = saveTvcStoryboardTableDraft(graph, [
    tableRow(project.storyboard.rows[0], { durationSeconds: 3 }),
    tableRow(project.storyboard.rows[1], { durationSeconds: 5 }),
  ], idFactory);
  const next = readTvcProject(saved.graph);

  assert.equal(next?.phase, "script-draft");
  assert.equal(next?.revision, project.revision + 1);
  assert.equal(next?.lockedAt, undefined);
  assert.equal(next?.promptUnits, undefined);
  assert.deepEqual(next?.storyboard?.rows.map((item) => item.timecode), [
    "00:00–00:03",
    "00:03–00:08",
  ]);
  assert.equal(saved.graph.nodes.some((node) => node.storyRole === "tvc-prompt"), false);
  assert.equal(readTvcProject(graph)?.phase, "prompt-final");
  assert.equal(JSON.stringify(graph), original);
});

test("rejects invalid canvas-table edits without changing the locked project", () => {
  const { graph, idFactory } = promptFinalGraph();
  const project = readTvcProject(graph);
  assert.ok(project?.storyboard);
  const rows = project.storyboard.rows.map((item) => tableRow(item));
  const before = JSON.stringify(graph);

  assert.throws(
    () => saveTvcStoryboardTableDraft(graph, [
      { ...rows[0], durationSeconds: 0 },
      { ...rows[1], durationSeconds: 8 },
    ], idFactory),
    /镜号或时间码无效/,
  );
  assert.throws(
    () => saveTvcStoryboardTableDraft(graph, [
      rows[0],
      { ...rows[1], shotNumber: rows[0].shotNumber },
    ], idFactory),
    /镜号或时间码无效/,
  );
  assert.throws(
    () => saveTvcStoryboardTableDraft(graph, [
      { ...rows[0], durationSeconds: 3 },
      { ...rows[1], durationSeconds: 4 },
    ], idFactory),
    /总时长/,
  );
  assert.throws(
    () => saveTvcStoryboardTableDraft(graph, [
      { ...rows[0], referenceNodeIds: ["missing-reference"] },
      rows[1],
    ], idFactory),
    /不可用的图片节点/,
  );
  assert.equal(JSON.stringify(graph), before);
  assert.equal(readTvcProject(graph)?.phase, "prompt-final");
});

test("keeps TVC video-segment cuts on locked storyboard boundaries before text-only prompt rebuilding", () => {
  const { graph } = promptFinalGraph();
  const project = readTvcProject(graph);
  assert.ok(project?.promptPlan?.length);

  const saved = saveTvcPromptPlanBoundaries(graph, [
    { startSecond: 0, endSecond: 4 },
    { startSecond: 4, endSecond: 8 },
  ]);
  const next = readTvcProject(saved.graph);

  assert.equal(next?.phase, "script-locked");
  assert.deepEqual(next?.promptPlan?.map((segment) => ({
    startSecond: segment.startSecond,
    endSecond: segment.endSecond,
    shotNumbers: segment.shotNumbers,
  })), [
    { startSecond: 0, endSecond: 4, shotNumbers: ["001"] },
    { startSecond: 4, endSecond: 8, shotNumbers: ["002"] },
  ]);
  assert.equal(next?.promptUnits, undefined);
  assert.equal(saved.graph.nodes.some((node) => node.storyRole === "tvc-prompt"), false);
});

test("keeps ordinary v1 workflow data outside the TVC-only table flow", () => {
  const ordinary = parseWorkflowGraph(JSON.stringify({ version: 1, nodes: [], edges: [] }));
  assert.equal(readTvcProject(ordinary), null);
  assert.equal(ordinary.tvc, undefined);
});

test("renders an isolated screen-space editable 13-column storyboard panel from TVC nodes", async () => {
  const [canvas, styles] = await Promise.all([
    readFile(new URL("../components/workflow/workflow-canvas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const panelStart = canvas.indexOf("function TvcStoryboardCanvasPanel");
  const panel = canvas.slice(panelStart);
  const worldStart = canvas.indexOf('<div ref={worldRef} className="canvas-world"');
  const worldEnd = canvas.indexOf("\n      </div>\n\n      {tvcStoryboardView", worldStart);
  const renderedPanelStart = canvas.indexOf("{tvcStoryboardView && tvcProject?.storyboard ? (");

  assert.ok(panelStart >= 0, "expected the dedicated canvas storyboard panel");
  assert.ok(worldStart >= 0, "expected the canvas world");
  assert.ok(worldEnd > worldStart, "expected the storyboard panel to render after the canvas world");
  assert.ok(
    renderedPanelStart > worldEnd,
    "expected the expanded storyboard panel to be a screen-space sibling of the canvas world",
  );
  for (const header of [
    "镜号", "时间码", "时长（秒）", "参考场景图", "场景/时间", "景别与焦段",
    "机位与运镜", "画面构图", "角色动作与表演", "旁白", "环境声与拟声",
    "转场/切点", "连续性与生成限制",
  ]) {
    assert.ok(canvas.includes(header), `expected storyboard header ${header}`);
  }
  for (const label of [
    "展开分镜表", "编辑分镜表", "取消编辑", "保存分镜表", "导出 Excel", "最终提示词",
    "调整镜头段", "按30秒重新输出", "保存镜头段并重新输出",
  ]) {
    assert.ok(canvas.includes(label), `expected canvas affordance ${label}`);
  }
  assert.match(canvas, /storyboard\.rows\.slice\(0, 3\)/);
  assert.match(canvas, /storyRole === "tvc-storyboard"/);
  assert.match(canvas, /storyRole === "tvc-prompt"/);
  assert.match(canvas, /onOpenTvcPrompt\(\)/);
  assert.match(canvas, /saveTvcStoryboardTableDraft/);
  assert.match(canvas, /saveTvcPromptPlanBoundaries/);
  assert.match(canvas, /prepareTvcPromptPlan/);
  assert.match(canvas, /TvcPromptPlanEditor/);
  assert.match(canvas, /在镜头 \$\{timed\.row\.shotNumber\} 后切段/);
  assert.match(canvas, /segmentControlsReadOnly/);
  assert.match(canvas, /videoSchedulers\.map\(\(scheduler\)/);
  assert.match(canvas, /onSave\(draftRows\)/);
  assert.match(panel, /data-workflow-isolated/);
  assert.match(panel, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.doesNotMatch(panel, /origin:/);
  assert.doesNotMatch(panel, /translate\(\$\{origin/);
  assert.match(panel, /readOnly value=\{timecode\}/);
  assert.match(panel, /rowsWithTimecode/);
  assert.match(panel, /setTab\("prompt"\)/);
  assert.match(
    styles,
    /\.tvc-storyboard-canvas-panel \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?z-index: 90;[\s\S]*?width: min\(1400px, calc\(100% - 32px\)\);[\s\S]*?height: min\(820px, calc\(100% - 32px\)\);[\s\S]*?margin: auto;/,
  );
  assert.match(styles, /\.tvc-storyboard-table-scroll \{[\s\S]*?overscroll-behavior: contain/);
  assert.match(styles, /\.tvc-prompt-plan-editor \{[\s\S]*?overscroll-behavior: contain/);
  assert.match(styles, /\.tvc-prompt-plan-rows label \{/);
});
