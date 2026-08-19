import { createStoryboardTable } from "../workflow/storyboard-table.ts";
import type { WorkflowGraph } from "../workflow/graph.ts";

const COLUMN_WIDTHS = [
  13, 16, 11, 34, 28, 22, 24, 30, 34, 22, 26, 27, 36, 30,
];

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
  headerRow.values = [
    "镜号", "时间码", "时长（秒）", "参考场景图", "场景/时间", "景别与焦段",
    "机位与运镜", "画面构图", "角色动作与表情", "旁白", "环境声与拟声",
    "转场/切点", "连续性与生成限制", "光影与质感",
  ];
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6C5CE7" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFD7D1CB" } } };
  });

  table.rows.forEach((row, index) => {
    const worksheetRow = sheet.getRow(index + 6);
    worksheetRow.values = [row.shotId, row.timecode, row.duration, row.referenceAssets,
      row.sceneTime, row.shotSizeLens, row.camera, row.composition, row.performance,
      row.voiceover, row.sound, row.transition, row.continuity, row.lightingTexture];
    worksheetRow.height = 84;
    worksheetRow.eachCell((cell, column) => {
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
  });
  COLUMN_WIDTHS.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  return workbook.xlsx.writeBuffer();
}
