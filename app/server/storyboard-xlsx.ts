import {
  createStoryboardTable,
  STORYBOARD_TABLE_HEADERS,
} from "../workflow/storyboard-table.ts";
import type { WorkflowGraph } from "../workflow/graph.ts";

const COLUMN_WIDTHS = [
  13, 16, 11, 34, 28, 22, 24, 30, 34, 22, 26, 27, 36, 30,
];
const VIDEO_TASK_HEADERS = [
  "任务编号",
  "时间码",
  "时长（秒）",
  "包含镜头",
  "场景",
  "参考资产",
  "最终提示词",
  "状态",
];
const VIDEO_TASK_COLUMN_WIDTHS = [18, 16, 11, 28, 24, 42, 72, 12];

function styleHeader(row: import("exceljs").Row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6C5CE7" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFD7D1CB" } } };
  });
}

function styleDataRow(row: import("exceljs").Row) {
  row.height = 84;
  row.eachCell((cell, column) => {
    cell.alignment = {
      vertical: "top",
      horizontal: column <= 3 ? "center" : "left",
      wrapText: true,
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFE4DFD9" } },
      bottom: { style: "thin", color: { argb: "FFE4DFD9" } },
      left: { style: "thin", color: { argb: "FFF0ECE8" } },
      right: { style: "thin", color: { argb: "FFF0ECE8" } },
    };
  });
}

export async function createStoryboardWorkbook(
  graph: WorkflowGraph,
  storyId: string,
) {
  const table = createStoryboardTable(graph, storyId);
  if (!table?.rows.length) throw new Error("当前项目没有可导出的漫剧分镜表。");
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LingkeAI 无限画布";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("漫剧分镜表", {
    views: [{ state: "frozen", ySplit: 5 }],
  });
  sheet.mergeCells("A1:N1");
  sheet.getCell("A1").value = `${table.title}｜漫剧分镜表`;
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF241C19" } };
  sheet.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
  sheet.getRow(1).height = 30;

  sheet.getCell("A2").value = "镜头数";
  sheet.getCell("B2").value = { formula: `COUNTA(A6:A${table.rows.length + 5})` };
  sheet.getCell("D2").value = "总时长（秒）";
  sheet.getCell("E2").value = { formula: `SUM(C6:C${table.rows.length + 5})` };
  sheet.getCell("G2").value = "校验状态";
  sheet.getCell("H2").value = table.validation;
  sheet.getCell("J2").value = "制作规则";
  sheet.mergeCells("K2:N2");
  sheet.getCell("K2").value = table.productionRule;
  sheet.mergeCells("A3:N3");
  sheet.getCell("A3").value = `视频片段：${table.videoSegmentCount} 个｜项目总时长：${table.totalDuration} 秒`;
  sheet.getCell("A3").font = { italic: true, color: { argb: "FF645F59" } };

  const summaryCells = ["A2", "D2", "G2", "J2"];
  summaryCells.forEach((cell) => {
    sheet.getCell(cell).font = { bold: true, color: { argb: "FF4C3B31" } };
  });
  sheet.getRow(2).alignment = { vertical: "middle", wrapText: true };
  sheet.getRow(3).height = 22;

  const headerRow = sheet.getRow(5);
  headerRow.values = [...STORYBOARD_TABLE_HEADERS];
  styleHeader(headerRow);

  table.rows.forEach((row, index) => {
    const worksheetRow = sheet.getRow(index + 6);
    worksheetRow.values = [row.shotId, row.timecode, row.duration, row.referenceAssets,
      row.sceneTime, row.shotSizeLens, row.camera, row.composition, row.performance,
      row.voiceover, row.sound, row.transition, row.continuity, row.lightingTexture];
    styleDataRow(worksheetRow);
  });
  COLUMN_WIDTHS.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  const taskSheet = workbook.addWorksheet("视频任务表", {
    views: [{ state: "frozen", ySplit: 5 }],
  });
  taskSheet.mergeCells("A1:H1");
  taskSheet.getCell("A1").value = `${table.title}｜视频任务表`;
  taskSheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF241C19" } };
  taskSheet.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
  taskSheet.getRow(1).height = 30;
  taskSheet.getCell("A2").value = "视频任务数";
  taskSheet.getCell("B2").value = { formula: `COUNTA(A6:A${table.videoTasks.length + 5})` };
  taskSheet.getCell("D2").value = "总时长（秒）";
  taskSheet.getCell("E2").value = { formula: `SUM(C6:C${table.videoTasks.length + 5})` };
  taskSheet.getCell("G2").value = "制作规则";
  taskSheet.mergeCells("H2:H3");
  taskSheet.getCell("H2").value = table.productionRule;
  taskSheet.mergeCells("A3:F3");
  taskSheet.getCell("A3").value = "每条任务对应一个最终提示词调度器；提示词可在画布调度节点中继续编辑。";
  ["A2", "D2", "G2"].forEach((cell) => {
    taskSheet.getCell(cell).font = { bold: true, color: { argb: "FF4C3B31" } };
  });
  taskSheet.getRow(2).alignment = { vertical: "middle", wrapText: true };
  taskSheet.getRow(3).height = 32;
  const taskHeader = taskSheet.getRow(5);
  taskHeader.values = VIDEO_TASK_HEADERS;
  styleHeader(taskHeader);
  table.videoTasks.forEach((task, index) => {
    const worksheetRow = taskSheet.getRow(index + 6);
    worksheetRow.values = [
      task.segmentId,
      task.timecode,
      task.duration,
      task.shotIds,
      task.sceneIds,
      task.referenceAssets,
      task.finalPrompt,
      task.status,
    ];
    styleDataRow(worksheetRow);
  });
  VIDEO_TASK_COLUMN_WIDTHS.forEach((width, index) => {
    taskSheet.getColumn(index + 1).width = width;
  });
  return workbook.xlsx.writeBuffer();
}
