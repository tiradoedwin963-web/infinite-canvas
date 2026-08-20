import assert from "node:assert/strict";
import test from "node:test";
import { createStoryboardWorkbook } from "../app/server/storyboard-xlsx.ts";
import { buildPersistedStoryboardTable } from "../app/workflow/storyboard-table.ts";

function graph() {
  const storyId = "story";
  const plan = {
    shotId: "shot-001",
    sequence: 1,
    sceneId: "scene",
    beatId: "beat-001",
    duration: 12,
    durationReason: "",
    shotSize: "中景",
    lens: "标准焦段",
    cameraAngle: "平视",
    cameraMovement: "缓慢推近",
    composition: "三分法构图",
    action: "主角向前一步",
    characterMovement: "向前一步",
    emotionalGoal: "紧张",
    voiceover: "旁白",
    soundEffect: "脚步声",
    musicCue: "低音弦乐",
    transitionIn: "动作承接",
    transitionOut: "遮挡切点",
    continuityNotes: "保持人物方向",
    continuityWarnings: [],
    negativePrompt: "禁止变脸",
    lighting: "窗边冷光",
    colorTone: "低饱和蓝灰",
    texture: "水粉笔触",
    referenceNodeIds: ["lead", "scene"],
  };
  return {
    version: 1,
    nodes: [
      { id: "analysis", x: 0, y: 0, type: "source", kind: "text", text: "分析", label: "测试项目", storyId, storyRole: "analysis", mangaStoryboardTempo: "long-form" },
      { id: "shot", x: 1, y: 0, type: "source", kind: "text", text: "分镜", storyId, storyRole: "shot", shotPlan: plan },
      { id: "lead", x: 2, y: 0, type: "result", kind: "image", schedulerId: "lead-s", text: "人物", label: "主角", model: "gpt-image-2", status: "success", progress: "", error: "", storyId, assetRole: "result", assetRef: "lead", assetKind: "character" },
      { id: "scene", x: 2, y: 1, type: "result", kind: "image", schedulerId: "scene-s", text: "场景", label: "宫殿", model: "gpt-image-2", status: "success", progress: "", error: "", storyId, assetRole: "result", assetRef: "scene", assetKind: "scene" },
    ],
    edges: [],
  };
}

test("exports a 14-column storyboard workbook with summary formulas", async () => {
  const buffer = await createStoryboardWorkbook(graph(), "story");
  assert.ok(buffer.byteLength > 1_000);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("漫剧分镜表");
  assert.equal(sheet.getCell("A1").value, "测试项目｜漫剧分镜表");
  assert.equal(sheet.getCell("N5").value, "光影与质感");
  assert.equal(sheet.getCell("B2").value.formula, "COUNTA(A6:A6)");
  assert.equal(sheet.getCell("E2").value.formula, "SUM(C6:C6)");
  assert.equal(sheet.getCell("A6").value, "shot-001");
});

test("exports the persisted multi-shot table and final-prompt task sheet", async () => {
  const source = graph();
  const plan = source.nodes.find((node) => node.id === "shot").shotPlan;
  const videoTask = {
    segmentId: "segment-001",
    shotIds: [plan.shotId],
    sceneIds: [plan.sceneId],
    duration: plan.duration,
    referenceNodeIds: plan.referenceNodeIds,
    schedulerId: "final-prompt-scheduler",
  };
  const storyboardTable = buildPersistedStoryboardTable(source, "story", {
    tempo: "multi-shot",
    shotPlans: [plan],
    videoTasks: [videoTask],
  });
  source.nodes.push(
    {
      id: "table",
      x: 3,
      y: 0,
      type: "source",
      kind: "text",
      text: "项目级分镜表",
      storyId: "story",
      storyRole: "storyboard-table",
      storyboardTable,
    },
    {
      id: "final-prompt-scheduler",
      x: 4,
      y: 0,
      type: "scheduler",
      outputKind: "video",
      model: "seedance-2.5",
      prompt: "本片段仅生成 0 至 12 秒内的连续多镜头画面与动作。",
      aspectRatio: "16:9",
      resolution: "720p",
      duration: "12",
      outputCount: 1,
      error: "",
      storyId: "story",
      storyRole: "video-scheduler",
      videoSegment: videoTask,
    },
  );
  const buffer = await createStoryboardWorkbook(source, "story");
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const shots = workbook.getWorksheet("漫剧分镜表");
  const tasks = workbook.getWorksheet("视频任务表");
  assert.equal(shots.getCell("J5").value, "对白 / 旁白");
  assert.equal(tasks.getCell("A1").value, "测试项目｜视频任务表");
  assert.equal(tasks.getCell("G5").value, "最终提示词");
  assert.equal(tasks.getCell("A6").value, "segment-001");
  assert.match(String(tasks.getCell("G6").value), /0 至 12 秒/);
});
