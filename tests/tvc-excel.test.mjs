import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  TVC_STORYBOARD_HEADERS,
  createTvcStoryboardWorkbook,
  tvcStoryboardFilename,
} from "../app/workflow/tvc-excel.ts";
import {
  emptyTvcWorkflowGraph,
  readTvcProject,
  writeTvcStoryboardDraft,
} from "../app/workflow/tvc.ts";

const storyboard = {
  title: "春日园区",
  targetDurationSeconds: 30,
  validationStatus: "通过",
  rows: [
    {
      shotNumber: "001",
      timecode: "00:00–00:03",
      durationSeconds: 3,
      referenceScene: "图1｜园区入口",
      sceneTime: "外景·清晨",
      shotSizeLens: "大全景｜24mm",
      camera: "高空俯拍缓慢下降",
      composition: "入口与山林形成引导线",
      performance: "孩子停在门前抬头",
      narration: "新的探索开始。",
      dialogue: "我们进去看看。",
      sound: "鸟鸣、轻风；无 BGM。",
      transition: "树叶遮挡切",
      constraints: "保持入口结构与角色服装。",
      referenceNodeIds: ["scene-1"],
    },
    {
      shotNumber: "002",
      timecode: "00:03–00:06",
      durationSeconds: 3,
      referenceScene: "图2｜科学教室",
      sceneTime: "内景·上午",
      shotSizeLens: "中近景｜50mm",
      camera: "眼平轻推",
      composition: "角色位于窗边黄金点",
      performance: "角色抬手触碰标本",
      narration: "好奇心正在发光。",
      sound: "环境低语、轻微翻页声；无 BGM。",
      transition: "动作接切",
      constraints: "不新增可读文字或额外主角。",
      referenceNodeIds: ["scene-2"],
    },
  ],
};

test("exports a readable TVC storyboard workbook with summary formulas", async () => {
  const bytes = await createTvcStoryboardWorkbook(storyboard);
  assert.ok(bytes instanceof ArrayBuffer);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet("TVC分镜表");
  assert.ok(sheet);
  assert.equal(sheet.getCell("A1").value, "春日园区分镜表");
  assert.equal(sheet.getCell("B2").value.formula, "COUNTA(A6:A7)");
  assert.equal(sheet.getCell("D2").value, 30);
  assert.equal(sheet.getCell("F2").value.formula, "SUM(C6:C7)");
  assert.equal(sheet.getCell("H2").value, "通过");
  assert.deepEqual(
    sheet.getRow(5).values.slice(1),
    [...TVC_STORYBOARD_HEADERS],
  );
  assert.equal(sheet.getCell("A6").value, "001");
  assert.equal(sheet.getCell("C7").value, 3);
  assert.equal(sheet.getCell("M7").value, "不新增可读文字或额外主角。");
  assert.equal(sheet.getCell("J6").value, "旁白：新的探索开始。\n对白：我们进去看看。");
  assert.equal(sheet.getCell("J7").value, "旁白：好奇心正在发光。\n对白：无");
  assert.equal(sheet.views[0].state, "frozen");
  assert.equal(sheet.views[0].ySplit, 5);
  assert.equal(sheet.getCell("I6").alignment.wrapText, true);
  assert.equal(sheet.getCell("C6").numFmt, '0"秒"');
});

test("uses a safe, descriptive Excel filename", () => {
  assert.equal(tvcStoryboardFilename('春日/园区:第一版'), "春日-园区-第一版-分镜表.xlsx");
  assert.equal(tvcStoryboardFilename("   "), "TVC-分镜表.xlsx");
});

test("exports the public TVC storyboard projection without media work", async () => {
  let nextId = 0;
  const id = () => `id-${++nextId}`;
  let graph = emptyTvcWorkflowGraph(id);
  graph = {
    ...graph,
    tvc: {
      ...graph.tvc,
      title: "接口导出测试",
      revision: 1,
      brief: {
        goal: "建立认知",
        audience: "家庭用户",
        targetDuration: 6,
        aspectRatio: "16:9",
        platform: "测试平台",
        maxDuration: 30,
        style: "清新自然",
        narrativeMode: "TVC",
        audioPolicy: "无 BGM",
        copy: "",
        referenceMap: [],
      },
    },
  };
  const applied = writeTvcStoryboardDraft(graph, {
    type: "write_tvc_storyboard_draft",
    projectId: graph.tvc.projectId,
    rows: storyboard.rows.map((row, index) => ({
      ...row,
      startSecond: index * 3,
      endSecond: (index + 1) * 3,
      referenceNodeIds: [],
    })),
  }, id);
  const project = readTvcProject(applied.graph);
  assert.ok(project?.storyboard);

  const bytes = await createTvcStoryboardWorkbook(project.storyboard);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.equal(workbook.getWorksheet("TVC分镜表").getCell("A6").value, "001");
  assert.equal(applied.graph.nodes.some((node) => node.kind === "video"), false);
});
