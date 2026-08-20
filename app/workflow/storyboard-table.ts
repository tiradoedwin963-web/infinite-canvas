import type { AgentMangaStoryboardTempo, ShotPlan } from "../ai/agent.ts";
import type {
  WorkflowGraph,
  WorkflowResultNode,
  WorkflowSourceNode,
  WorkflowStoryboardTable as PersistedStoryboardTable,
  WorkflowStoryboardTableRow,
  WorkflowStoryboardVideoTask,
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
  "对白 / 旁白",
  "环境声与拟声",
  "转场/切点",
  "连续性与生成限制",
  "光影与质感",
] as const;

export type StoryboardTableRow = WorkflowStoryboardTableRow;

export type StoryboardVideoTaskRow = {
  segmentId: string;
  timecode: string;
  duration: number;
  shotIds: string;
  sceneIds: string;
  referenceAssets: string;
  finalPrompt: string;
  status: string;
};

export type StoryboardTable = {
  title: string;
  storyId: string;
  tempo: AgentMangaStoryboardTempo;
  productionRule: string;
  rows: StoryboardTableRow[];
  videoTasks: StoryboardVideoTaskRow[];
  totalDuration: number;
  videoSegmentCount: number;
  validation: "通过" | "需检查";
};

type TableBuildOptions = {
  tempo: AgentMangaStoryboardTempo;
  shotPlans: ShotPlan[];
  videoTasks: WorkflowStoryboardVideoTask[];
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

function orderedPlans(plans: ShotPlan[]) {
  return [...plans].sort((left, right) => left.sequence - right.sequence);
}

function resultAssets(graph: WorkflowGraph, storyId: string) {
  return graph.nodes.filter(
    (node): node is WorkflowResultNode =>
      node.type === "result" &&
      node.storyId === storyId &&
      node.assetRole === "result",
  );
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

function hasValidTempoDuration(shot: ShotPlan, tempo: AgentMangaStoryboardTempo) {
  if (tempo === "short-cut") return shot.duration === 2 || shot.duration === 3;
  if (tempo === "multi-shot") return shot.duration >= 2 && shot.duration <= 15;
  return shot.duration >= 5 && shot.duration <= 15 &&
    (shot.duration >= 10 || Boolean(shot.durationReason));
}

function productionRule(tempo: AgentMangaStoryboardTempo) {
  if (tempo === "multi-shot") {
    return "影视剪辑：每行短镜为2–5秒、长镜为6–15秒；按顺序合并为4–30秒视频任务，可跨场景使用 HARD CUT、动作接切或匹配切。";
  }
  if (tempo === "short-cut") {
    return "短片剪辑：每行2–3秒；Seedance 2.5按连续场景合并为最长30秒视频片段";
  }
  return "长镜直出：普通镜头10–15秒；短反应、插入或转场镜头可为5–9秒";
}

export function buildStoryboardTableRows(
  graph: WorkflowGraph,
  storyId: string,
  shotPlans: ShotPlan[],
): StoryboardTableRow[] {
  const assets = resultAssets(graph, storyId);
  const byNodeId = new Map(assets.map((node) => [node.id, node]));
  const imageNumbers = new Map(assets.map((node, index) => [node.id, index + 1]));
  let cursor = 0;
  return orderedPlans(shotPlans).map((shot) => {
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
      performance: withoutEmpty([
        shot.action,
        shot.characterMovement,
        shot.emotionalGoal,
      ]).join("；") || "无",
      voiceover: withoutEmpty([
        shot.dialogue ? `对白：${shot.dialogue}` : "",
        shot.voiceover ? `旁白：${shot.voiceover}` : "",
      ]).join("；") || "无",
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
}

export function buildPersistedStoryboardTable(
  graph: WorkflowGraph,
  storyId: string,
  options: TableBuildOptions,
): PersistedStoryboardTable {
  const shotPlans = orderedPlans(options.shotPlans);
  const rows = buildStoryboardTableRows(graph, storyId, shotPlans);
  return {
    version: 1,
    tempo: options.tempo,
    shotPlans,
    rows,
    videoTasks: options.videoTasks,
    totalDuration: shotPlans.reduce((total, shot) => total + shot.duration, 0),
    validation: rows.length && shotPlans.every((shot) =>
      hasValidTempoDuration(shot, options.tempo),
    ) ? "通过" : "需检查",
  };
}

function legacyShotPlans(graph: WorkflowGraph, storyId: string) {
  return graph.nodes.flatMap((node) =>
    node.type === "source" &&
    node.storyId === storyId &&
    node.storyRole === "shot" &&
    node.shotPlan
      ? [node.shotPlan]
      : [],
  );
}

function legacyVideoTasks(graph: WorkflowGraph, storyId: string) {
  return graph.nodes.flatMap((node) =>
    node.type === "scheduler" &&
    node.storyId === storyId &&
    node.storyRole === "video-scheduler" &&
    node.videoSegment
      ? [{ ...node.videoSegment, schedulerId: node.id }]
      : [],
  );
}

function videoTaskRows(
  graph: WorkflowGraph,
  storyId: string,
  rows: StoryboardTableRow[],
  tasks: WorkflowStoryboardVideoTask[],
) {
  const schedulers = new Map(graph.nodes.flatMap((node) =>
    node.type === "scheduler" && node.storyId === storyId
      ? [[node.id, node] as const]
      : [],
  ));
  const results = new Map(graph.nodes.flatMap((node) =>
    node.type === "result" && node.storyId === storyId
      ? [[node.schedulerId, node] as const]
      : [],
  ));
  const rowById = new Map(rows.map((row) => [row.shotId, row]));
  const planOrder = rows.map((row) => row.shotId);
  return tasks.map((task) => {
    const firstIndex = planOrder.indexOf(task.shotIds[0] ?? "");
    const lastIndex = planOrder.indexOf(task.shotIds.at(-1) ?? "");
    const first = firstIndex >= 0 ? rows[firstIndex] : undefined;
    const last = lastIndex >= 0 ? rows[lastIndex] : undefined;
    const references = task.shotIds.flatMap((shotId) => {
      const row = rowById.get(shotId);
      return row ? [row.referenceAssets] : [];
    });
    const scheduler = schedulers.get(task.schedulerId);
    const result = results.get(task.schedulerId);
    return {
      segmentId: task.segmentId,
      timecode: first && last ? `${first.timecode.split("–")[0]}–${last.timecode.split("–")[1]}` : "待规划",
      duration: task.duration,
      shotIds: task.shotIds.join("、"),
      sceneIds: task.sceneIds.join("、"),
      referenceAssets: [...new Set(references)].join("；") || "无",
      finalPrompt: scheduler?.prompt || "最终提示词将在调度节点完成后显示。",
      status: result?.status === "success"
        ? "已完成"
        : result?.status === "failed"
          ? "失败"
          : result?.status === "running" || result?.status === "pending"
            ? "生成中"
            : "待生成",
    } satisfies StoryboardVideoTaskRow;
  });
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
  const persisted = graph.nodes.find(
    (node): node is WorkflowSourceNode =>
      node.type === "source" && node.storyId === storyId &&
      node.storyRole === "storyboard-table" && Boolean(node.storyboardTable),
  )?.storyboardTable;
  const tempo = persisted?.tempo ?? analysis.mangaStoryboardTempo ?? "long-form";
  const shotPlans = persisted?.shotPlans ?? legacyShotPlans(graph, storyId);
  const rows = persisted?.rows ?? buildStoryboardTableRows(graph, storyId, shotPlans);
  const tasks = persisted?.videoTasks ?? legacyVideoTasks(graph, storyId);
  const totalDuration = persisted?.totalDuration ?? shotPlans.reduce(
    (total, shot) => total + shot.duration,
    0,
  );
  const validation = persisted?.validation ?? (
    rows.length && shotPlans.every((shot) => hasValidTempoDuration(shot, tempo))
      ? "通过"
      : "需检查"
  );
  return {
    title: analysis.label || "漫剧分镜表",
    storyId,
    tempo,
    productionRule: productionRule(tempo),
    rows,
    videoTasks: videoTaskRows(graph, storyId, rows, tasks),
    totalDuration,
    videoSegmentCount: tasks.length,
    validation,
  };
}
