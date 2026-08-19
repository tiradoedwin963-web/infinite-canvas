import type { ShotPlan } from "../ai/agent.ts";
import type {
  WorkflowGraph,
  WorkflowResultNode,
  WorkflowSourceNode,
} from "./graph.ts";

export const STORYBOARD_TABLE_HEADERS = [
  "镜号",
  "时间码",
  "时长（秒）",
  "参考场景图",
  "场景/时间",
  "景别与焦段",
  "机位与运镜",
  "画面构图",
  "角色动作与表情",
  "旁白",
  "环境声与拟声",
  "转场/切点",
  "连续性与生成限制",
  "光影与质感",
] as const;

export type StoryboardTableRow = {
  shotId: string;
  timecode: string;
  duration: number;
  referenceAssets: string;
  sceneTime: string;
  shotSizeLens: string;
  camera: string;
  composition: string;
  performance: string;
  voiceover: string;
  sound: string;
  transition: string;
  continuity: string;
  lightingTexture: string;
};

export type StoryboardTable = {
  title: string;
  storyId: string;
  tempo: "long-form" | "short-cut";
  productionRule: string;
  rows: StoryboardTableRow[];
  totalDuration: number;
  videoSegmentCount: number;
  validation: "通过" | "需检查";
};

function formatTime(second: number) {
  const hours = Math.floor(second / 3600);
  const minutes = Math.floor((second % 3600) / 60);
  const seconds = second % 60;
  const short = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours ? `${String(hours).padStart(2, "0")}:${short}` : short;
}

function withoutEmpty(values: string[]) {
  return values.filter((value) => value && value !== "无");
}

function shotRows(graph: WorkflowGraph, storyId: string) {
  return graph.nodes.filter(
    (node): node is WorkflowSourceNode =>
      node.type === "source" &&
      node.storyId === storyId &&
      node.storyRole === "shot" &&
      Boolean(node.shotPlan),
  ).sort((left, right) => left.shotPlan!.sequence - right.shotPlan!.sequence);
}

function referenceText(
  shot: ShotPlan,
  byNodeId: Map<string, WorkflowResultNode>,
  imageNumbers: Map<string, number>,
) {
  const assets = shot.referenceNodeIds.flatMap((id) => {
    const node = byNodeId.get(id);
    return node ? [{
      kind: node.assetKind,
      name: node.label || node.assetName || node.assetRef || id,
      number: imageNumbers.get(id),
    }] : [];
  });
  const scene = assets.find((asset) => asset.kind === "scene");
  const characters = assets.filter((asset) => asset.kind === "character");
  const props = assets.filter((asset) => asset.kind === "prop");
  return withoutEmpty([
    scene ? `图${scene.number ?? "?"}｜${scene.name}` : "场景图：未引用",
    characters.length ? `人物：${characters.map((asset) => asset.name).join("、")}` : "",
    props.length ? `道具：${props.map((asset) => asset.name).join("、")}` : "",
  ]).join("；");
}

function sceneTimeText(shot: ShotPlan, byNodeId: Map<string, WorkflowResultNode>) {
  const scene = byNodeId.get(shot.referenceNodeIds.find((id) =>
    byNodeId.get(id)?.assetKind === "scene",
  ) ?? "");
  return `场景：${scene?.label || scene?.assetName || shot.sceneId}；光线：${shot.lighting}`;
}

function hasValidTempoDuration(
  shot: ShotPlan,
  tempo: "long-form" | "short-cut",
) {
  if (tempo === "short-cut") return shot.duration === 2 || shot.duration === 3;
  return shot.duration >= 5 && shot.duration <= 15 &&
    (shot.duration >= 10 || Boolean(shot.durationReason));
}

export function createStoryboardTable(
  graph: WorkflowGraph,
  storyId: string,
): StoryboardTable | null {
  const analysis = graph.nodes.find(
    (node): node is WorkflowSourceNode =>
      node.type === "source" && node.storyId === storyId && node.storyRole === "analysis",
  );
  if (!analysis) return null;
  const tempo = analysis.mangaStoryboardTempo ?? "long-form";
  const rows = shotRows(graph, storyId);
  const assets = graph.nodes.filter(
    (node): node is WorkflowResultNode =>
      node.type === "result" && node.storyId === storyId && node.assetRole === "result",
  );
  const byNodeId = new Map(assets.map((node) => [node.id, node]));
  const imageNumbers = new Map(assets.map((node, index) => [node.id, index + 1]));
  let cursor = 0;
  const tableRows = rows.map((node) => {
    const shot = node.shotPlan!;
    const start = cursor;
    cursor += shot.duration;
    return {
      shotId: shot.shotId,
      timecode: `${formatTime(start)}–${formatTime(cursor)}`,
      duration: shot.duration,
      referenceAssets: referenceText(shot, byNodeId, imageNumbers),
      sceneTime: sceneTimeText(shot, byNodeId),
      shotSizeLens: `${shot.shotSize}｜${shot.lens}`,
      camera: `${shot.cameraAngle}｜${shot.cameraMovement}`,
      composition: shot.composition,
      performance: withoutEmpty([shot.action, shot.characterMovement, shot.emotionalGoal]).join("；") || "无",
      voiceover: shot.voiceover || "无",
      sound: withoutEmpty([shot.soundEffect, shot.musicCue]).join("；") || "无",
      transition: `入：${shot.transitionIn || "无"}；出：${shot.transitionOut || "无"}`,
      continuity: withoutEmpty([
        shot.continuityNotes,
        ...shot.continuityWarnings,
        shot.negativePrompt ? `限制：${shot.negativePrompt}` : "",
      ]).join("；") || "无",
      lightingTexture: withoutEmpty([shot.lighting, shot.colorTone, shot.texture]).join("；"),
    };
  });
  const segments = graph.nodes.filter((node) =>
    node.type === "scheduler" && node.storyId === storyId &&
    node.storyRole === "video-scheduler",
  );
  return {
    title: analysis.label || "漫剧分镜表",
    storyId,
    tempo,
    productionRule: tempo === "short-cut"
      ? "短片剪辑：每行2–3秒；Seedance 2.5按连续场景合并为最长30秒视频片段"
      : "长镜直出：普通镜头10–15秒；短反应、插入或转场镜头可为5–9秒",
    rows: tableRows,
    totalDuration: cursor,
    videoSegmentCount: segments.length,
    validation: tableRows.length && rows.every((node) =>
      hasValidTempoDuration(node.shotPlan!, tempo),
    ) ? "通过" : "需检查",
  };
}
