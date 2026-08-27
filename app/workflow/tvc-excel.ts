import ExcelJS from "exceljs";
import type { TvcStoryboard, TvcStoryboardRow } from "./tvc";

export type { TvcStoryboard, TvcStoryboardRow } from "./tvc";

export const TVC_STORYBOARD_HEADERS = [
  "镜号",
  "时间码",
  "时长（秒）",
  "参考场景图",
  "场景/时间",
  "景别与焦段",
  "机位与运镜",
  "画面构图",
  "角色动作与表情",
  "旁白 / 对白",
  "环境声与拟声",
  "转场/切点",
  "连续性与生成限制",
] as const;

const COLORS = {
  deepGreen: "1F4D3C",
  green: "47665B",
  paleGreen: "E9F1ED",
  paper: "F6F8F7",
  border: "C9D5CF",
  darkText: "1F3E35",
  mutedText: "47665B",
};

const COLUMN_WIDTHS = [8, 16, 11, 24, 24, 22, 40, 40, 50, 31, 43, 38, 48];

function fill(color: string) {
  return { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: `FF${color}` } };
}

function border() {
  return {
    top: { style: "thin" as const, color: { argb: `FF${COLORS.border}` } },
    left: { style: "thin" as const, color: { argb: `FF${COLORS.border}` } },
    bottom: { style: "thin" as const, color: { argb: `FF${COLORS.border}` } },
    right: { style: "thin" as const, color: { argb: `FF${COLORS.border}` } },
  };
}

function cellsFor(row: TvcStoryboardRow) {
  return [
    row.shotNumber,
    row.timecode,
    row.durationSeconds,
    row.referenceScene,
    row.sceneTime,
    row.shotSizeLens,
    row.camera,
    row.composition,
    row.performance,
    `旁白：${row.narration || "无"}\n对白：${row.dialogue || "无"}`,
    row.sound,
    row.transition,
    row.constraints,
  ];
}

export async function createTvcStoryboardWorkbook(storyboard: TvcStoryboard): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LingkeAI 无限画布";
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet("TVC分镜表", {
    views: [{ state: "frozen", ySplit: 5, showGridLines: false, zoomScale: 70 }],
  });
  sheet.properties.defaultRowHeight = 16.8;
  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const lastDataRow = Math.max(6, 5 + storyboard.rows.length);
  sheet.mergeCells("A1:M1");
  sheet.getCell("A1").value = `${storyboard.title}分镜表`;
  sheet.getCell("A1").fill = fill(COLORS.deepGreen);
  sheet.getCell("A1").font = { name: "Calibri", size: 18, bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 34;

  const summary = ["镜头数", null, "目标时长", storyboard.targetDurationSeconds, "总时长", null, "校验状态"];
  for (let index = 0; index < summary.length; index += 1) {
    const cell = sheet.getRow(2).getCell(index + 1);
    cell.value = summary[index];
    cell.fill = fill(COLORS.paleGreen);
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: `FF${COLORS.darkText}` } };
    cell.alignment = { horizontal: index % 2 === 0 ? "center" : "left", vertical: "middle" };
  }
  sheet.getCell("B2").value = { formula: `COUNTA(A6:A${lastDataRow})`, result: storyboard.rows.length };
  sheet.getCell("D2").numFmt = '0"秒"';
  sheet.getCell("F2").value = {
    formula: `SUM(C6:C${lastDataRow})`,
    result: storyboard.rows.reduce((sum, row) => sum + row.durationSeconds, 0),
  };
  sheet.getCell("F2").numFmt = '0"秒"';
  sheet.mergeCells("H2:M2");
  sheet.getCell("H2").value = storyboard.validationStatus;
  sheet.getCell("H2").fill = fill(COLORS.paleGreen);
  sheet.getCell("H2").font = { name: "Calibri", size: 11, bold: true, color: { argb: `FF${COLORS.darkText}` } };
  sheet.getCell("H2").alignment = { horizontal: "left", vertical: "middle" };
  sheet.getRow(2).height = 30;

  sheet.mergeCells("A3:M3");
  sheet.getCell("A3").value = "制作规则：一行对应一个剪辑镜头；转场/切点仅记录导演与剪辑意图；默认无 BGM。";
  sheet.getCell("A3").fill = fill(COLORS.paper);
  sheet.getCell("A3").font = { name: "Calibri", size: 11, color: { argb: `FF${COLORS.mutedText}` } };
  sheet.getCell("A3").alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  sheet.getRow(3).height = 32;
  sheet.getRow(4).height = 10;

  const headerRow = sheet.getRow(5);
  headerRow.values = [...TVC_STORYBOARD_HEADERS];
  headerRow.height = 38;
  headerRow.eachCell((cell) => {
    cell.fill = fill(COLORS.green);
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = border();
  });

  for (const [index, row] of storyboard.rows.entries()) {
    const excelRow = sheet.getRow(index + 6);
    excelRow.values = cellsFor(row);
    excelRow.height = 108;
    excelRow.eachCell((cell, column) => {
      cell.fill = fill(index % 2 === 0 ? "FFFFFF" : COLORS.paper);
      cell.font = { name: "Calibri", size: 11, color: { argb: `FF${COLORS.darkText}` } };
      cell.alignment = {
        horizontal: column <= 3 ? "center" : "left",
        vertical: "top",
        wrapText: true,
      };
      cell.border = border();
    });
    excelRow.getCell(3).numFmt = '0"秒"';
  }

  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  return bytes.slice().buffer;
}

export function tvcStoryboardFilename(title: string) {
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 80) || "TVC";
  return `${safeTitle}-分镜表.xlsx`;
}
