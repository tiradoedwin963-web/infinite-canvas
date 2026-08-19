import type { ComposerMode } from "./models.ts";
import { validateMangaShotCinematography } from "../workflow/manga-cinematography.ts";

export const AGENT_MODEL = "gpt-5.6-sol";
export const AGENT_CHAT_STORAGE_KEY = "canvas-agent-chat-v1";
export const AGENT_CONVERSATIONS_STORAGE_KEY = "canvas-agent-conversations-v2";
export const WORKFLOW_AGENT_CONVERSATIONS_STORAGE_KEY =
  "workflow-agent-conversations-v1";
export const MAX_AGENT_MESSAGES = 100;
export const MAX_AGENT_CONVERSATIONS = 20;
export const MAX_AGENT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_AGENT_IMAGE_TOTAL_BYTES = 30 * 1024 * 1024;
export const AGENT_CONFIRM_TIMEOUT_MS = 60_000;
export const AGENT_CONFIRM_TIMEOUT_MESSAGE =
  "确认请求超过 60 秒，已停止本地等待。远端任务可能仍在继续，请先检查画布再重试，避免重复计费。";
export const AGENT_FIRST_RESPONSE_TIMEOUT_MS = 180_000;
export const AGENT_INACTIVITY_TIMEOUT_MS = 120_000;
export const AGENT_TOTAL_TIMEOUT_MS = 600_000;
export const AGENT_FIRST_RESPONSE_TIMEOUT_MESSAGE =
  "画布 Agent 180 秒内未开始返回结果，已停止等待。";
export const AGENT_INACTIVITY_TIMEOUT_MESSAGE =
  "画布 Agent 连续 120 秒未返回新内容，已停止等待。";
export const AGENT_TOTAL_TIMEOUT_MESSAGE =
  "画布 Agent 单批处理超过 10 分钟，已停止等待。";

export type AgentRequestTimeoutKind =
  | "first-response"
  | "inactivity"
  | "total";

export class AgentRequestTimeoutError extends Error {
  readonly kind: AgentRequestTimeoutKind;

  constructor(kind: AgentRequestTimeoutKind, message: string) {
    super(message);
    this.name = "AgentRequestTimeoutError";
    this.kind = kind;
  }
}

export type AgentMessageRole = "user" | "assistant";
export type AgentConversationPhase = "intake" | "clarifying" | "active";
export type AgentWorkflowState = "clarifying" | "active";
export type AgentMangaStoryboardTempo = "long-form" | "short-cut";

export type AgentStoredAction = {
  label: string;
  status: "pending" | "confirmed" | "cancelled" | "expired";
  operation?: AgentDangerousOperation;
};

export type AgentMessage = {
  id: string;
  role: AgentMessageRole;
  content: string;
  createdAt: number;
  details?: string[];
  action?: AgentStoredAction;
};

export type AgentConversation = {
  id: string;
  title: string;
  phase: AgentConversationPhase;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
};

export type AgentConversationStore = {
  version: 2;
  activeConversationId: string;
  conversations: AgentConversation[];
};

export type AgentCanvasNodeSnapshot = {
  id: string;
  kind: ComposerMode;
  role: "input" | "output";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  prompt?: string;
  model: string;
  status: string;
  assetName?: string;
  hasVisual: boolean;
};

export type AgentCanvasSnapshot = {
  mode: "creation";
  viewport: { x: number; y: number; scale: number; width: number; height: number };
  nodes: AgentCanvasNodeSnapshot[];
  edges: Array<{
    sourceId: string;
    targetId: string;
    sourceSide: "left" | "right";
    targetSide: "left" | "right";
  }>;
};

export type AgentWorkflowNodeSnapshot = {
  id: string;
  type: "source" | "scheduler" | "result";
  kind: ComposerMode;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  storyId?: string;
  shotRef?: string;
  storyRole?: string;
  assetRef?: string;
  assetKind?: AgentStoryAssetKind;
  assetRole?: AgentStoryAssetRole;
  foundationRole?: AgentStoryFoundationRole;
  assetStrategy?: "foundation-pair-v1";
  foundationApprovedAt?: number;
  storyboardMode?: AgentStoryboardMode;
  mangaStoryboardTempo?: AgentMangaStoryboardTempo;
  storyVisualStyle?: string;
  assetAvailable?: boolean;
  planningStage?: AgentStoryAssetPlanningStage;
  planningStatus?: AgentStoryAssetPlanningStatus;
  planningChunkIndex?: number;
  projectAspectRatio?: string;
  storyImageModel?: string;
  mangaPlanningStage?: AgentMangaPlanningStage;
  mangaPlanningStatus?: AgentMangaPlanningStatus;
  mangaPlanningChunkIndex?: number;
  continuityApprovedAt?: number;
  storyBeats?: StoryBeat[];
  scenePlan?: ScenePlan;
  shotPlan?: ShotPlan;
  continuityReport?: ContinuityReport;
  videoSegment?: MangaVideoSegment;
  assetName?: string;
  text: string;
  prompt: string;
  model: string;
  status: string;
  hasVisual: boolean;
};

export type AgentWorkflowSnapshot = {
  mode: "workflow";
  viewport: { x: number; y: number; scale: number; width: number; height: number };
  nodes: AgentWorkflowNodeSnapshot[];
  edges: Array<{ sourceId: string; targetId: string }>;
};

export type AgentSurfaceSnapshot = AgentCanvasSnapshot | AgentWorkflowSnapshot;

function compactShotPlanText(plan: ShotPlan) {
  return JSON.stringify({
    shotId: plan.shotId,
    sequence: plan.sequence,
    sceneId: plan.sceneId,
    beatId: plan.beatId,
    duration: plan.duration,
    characterIds: plan.characterIds,
    propIds: plan.propIds,
    startFrame: plan.startFrame,
    endFrame: plan.endFrame,
    previousShotId: plan.previousShotId,
    nextShotId: plan.nextShotId,
    continuityNotes: plan.continuityNotes,
    continuityWarnings: plan.continuityWarnings,
  });
}

export function compactMangaPlanningSnapshot(
  snapshot: AgentSurfaceSnapshot,
): AgentSurfaceSnapshot {
  if (snapshot.mode !== "workflow") return snapshot;
  const analysis = snapshot.nodes.find((node) =>
    node.storyRole === "analysis" &&
    node.storyboardMode === "comic" &&
    (node.mangaPlanningStage === "shot-plans" ||
      node.mangaPlanningStage === "continuity")
  );
  if (!analysis?.storyId) return snapshot;

  const shots = snapshot.nodes
    .filter((node) =>
      node.storyId === analysis.storyId &&
      node.storyRole === "shot" &&
      node.shotPlan
    )
    .sort((left, right) =>
      (left.shotPlan?.sequence ?? 0) - (right.shotPlan?.sequence ?? 0)
    );
  const fullShotIds = new Set(
    analysis.mangaPlanningStage === "shot-plans"
      ? shots.slice(-4).map((node) => node.id)
      : [],
  );

  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => {
      if (
        node.storyId !== analysis.storyId ||
        node.storyRole !== "shot" ||
        !node.shotPlan ||
        fullShotIds.has(node.id)
      ) {
        return node;
      }
      return {
        ...node,
        shotPlan: undefined,
        text: compactShotPlanText(node.shotPlan),
      };
    }),
  };
}

export type AgentInspectedImage = {
  nodeId: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
};

export type AgentCreateNodeOperation = {
  type: "create_node";
  ref: string;
  kind: ComposerMode;
  text: string;
  x: number;
  y: number;
};

export type AgentStoryShot = {
  ref: string;
  title: string;
  script: string;
  imagePrompt: string;
  videoPrompt: string;
  duration: string;
  referenceNodeIds: string[];
};

export type AgentCreateStoryWorkflowOperation = {
  type: "create_story_workflow";
  ref: string;
  title: string;
  globalContext: string;
  imageModel: string;
  videoModel: string;
  aspectRatio: string;
  imageResolution: string;
  videoResolution: string;
  chunkIndex: number;
  isFinal: boolean;
  shots: AgentStoryShot[];
  adjustments?: string[];
};

export type AgentRunStoryWorkflowOperation = {
  type: "run_story_workflow";
  storyId: string;
  shotRefs: string[];
};

export type AgentStoryAssetKind = "character" | "scene" | "prop";
export type AgentStoryAssetRole = "spec" | "scheduler" | "result";
export type AgentStoryAssetPlanningStage =
  | "character"
  | "scene"
  | "prop"
  | "complete";
export type AgentStoryAssetPlanningStatus =
  | "planning"
  | "awaiting-foundation-generation"
  | "awaiting-foundation-approval"
  | "stopped"
  | "failed"
  | "complete";

export type AgentStoryAnalysis = {
  genre: string;
  theme: string;
  audience: string;
  emotion: string;
  estimatedDuration: string;
  visualStyle?: string;
};

export type AgentStoryFoundationRole = "lead" | "support";
export type AgentStoryboardMode = "comic" | "tvc";
export type AgentMangaPlanningStage =
  | "story-beats"
  | "scene-plans"
  | "shot-plans"
  | "continuity"
  | "complete";
export type AgentMangaPlanningStatus =
  | "planning"
  | "stopped"
  | "failed"
  | "awaiting-continuity-approval"
  | "complete";

export type StoryBeat = {
  beatId: string;
  sequence: number;
  sceneId: string;
  narrativePurpose: string;
  emotionalGoal: string;
  summary: string;
};

export type ScenePlan = {
  sceneId: string;
  beatIds: string[];
  spatialLayout: string;
  blocking: string;
  eyeline: string;
  axis: string;
  entrancesExits: string;
  lighting: string;
  colorTone: string;
};

export type ShotTimelineSegment = {
  startSecond: number;
  endSecond: number;
  visualAction: string;
  performance: string;
  camera: string;
  audio: string;
};

export type ShotPlan = {
  shotId: string;
  sequence: number;
  sceneId: string;
  beatId: string;
  duration: number;
  durationReason: string;
  narrativePurpose: string;
  emotionalGoal: string;
  shotSize: string;
  lens: string;
  perspective: string;
  cameraAngle: string;
  cameraMovement: string;
  composition: string;
  blocking: string;
  characterIds: string[];
  characterPosition: string;
  characterMovement: string;
  eyeline: string;
  propIds: string[];
  action: string;
  dialogue: string;
  voiceover: string;
  soundEffect: string;
  musicCue: string;
  lighting: string;
  colorTone: string;
  texture: string;
  startFrame: string;
  endFrame: string;
  transitionIn: string;
  transitionOut: string;
  imagePrompt: string;
  videoPrompt: string;
  negativePrompt: string;
  previousShotId: string;
  nextShotId: string;
  continuityNotes: string;
  generationStatus: "planned";
  timeline: ShotTimelineSegment[];
  referenceNodeIds: string[];
  continuityWarnings: string[];
};

export type MangaVideoSegment = {
  segmentId: string;
  shotIds: string[];
  sceneIds: string[];
  duration: number;
  referenceNodeIds: string[];
};

export type ContinuityIssue = {
  code: string;
  severity: "error" | "warning";
  shotId: string;
  relatedShotId?: string;
  reason: string;
  suggestion: string;
  autoFixable: boolean;
};

export type ContinuityReport = {
  issues: ContinuityIssue[];
};

export type AgentCreateMangaStoryBeatsOperation = {
  type: "create_manga_story_beats";
  storyId: string;
  stageIndex: 0;
  beats: StoryBeat[];
};

export type AgentCreateMangaScenePlansOperation = {
  type: "create_manga_scene_plans";
  storyId: string;
  stageIndex: 1;
  plans: ScenePlan[];
};

export type AgentCreateMangaShotBatchOperation = {
  type: "create_manga_shot_batch";
  storyId: string;
  chunkIndex: number;
  isFinal: boolean;
  shots: ShotPlan[];
};

export type AgentCreateMangaContinuityReportOperation = {
  type: "create_manga_continuity_report";
  storyId: string;
  stageIndex: 3;
  report: ContinuityReport;
};

export type AgentCreateStoryAnalysisOperation = {
  type: "create_story_analysis";
  ref: string;
  title: string;
  analysis: AgentStoryAnalysis;
  projectAspectRatio: string;
  imageModel: string;
  adjustments?: string[];
};

export type AgentStoryAsset = {
  ref: string;
  name: string;
  description: string;
  reason: string;
  occurrences: string[];
  imagePrompt: string;
  aspectRatio: string;
  resolution: string;
  foundationRole?: AgentStoryFoundationRole;
};

export type AgentCreateStoryAssetBatchOperation = {
  type: "create_story_asset_batch";
  storyId: string;
  assetKind: AgentStoryAssetKind;
  chunkIndex: number;
  isFinal: boolean;
  assets: AgentStoryAsset[];
  adjustments?: string[];
};

export type AgentRunStoryAssetsOperation = {
  type: "run_story_assets";
  storyId: string;
  assetRefs: string[];
};

export type AgentOperation =
  | AgentCreateNodeOperation
  | { type: "update_node"; nodeId: string; text?: string; prompt?: string }
  | { type: "move_node"; nodeId: string; x: number; y: number }
  | { type: "resize_node"; nodeId: string; width: number; height: number }
  | { type: "connect_nodes"; sourceId: string; targetId: string }
  | { type: "disconnect_nodes"; sourceId: string; targetId: string }
  | { type: "delete_node"; nodeId: string }
  | AgentCreateStoryAnalysisOperation
  | AgentCreateStoryAssetBatchOperation
  | AgentRunStoryAssetsOperation
  | AgentCreateMangaStoryBeatsOperation
  | AgentCreateMangaScenePlansOperation
  | AgentCreateMangaShotBatchOperation
  | AgentCreateMangaContinuityReportOperation
  | AgentCreateStoryWorkflowOperation
  | AgentRunStoryWorkflowOperation
  | {
      type: "generate_content";
      mode: ComposerMode;
      model: string;
      prompt: string;
      referenceNodeIds: string[];
      aspectRatio?: string;
      duration?: string;
      resolution?: string;
      adjustments?: string[];
    };

export type AgentDangerousOperation = Extract<
  AgentOperation,
  {
    type:
      | "delete_node"
      | "generate_content"
      | "run_story_workflow"
      | "run_story_assets";
  }
>;

export type AgentPendingConfirmation = {
  messageId: string;
  operation: AgentDangerousOperation;
};

export function normalizeAgentModelId(mode: ComposerMode, model: string) {
  const prefix = `${mode}:`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

export type AgentRequest = {
  messages: Array<{ role: AgentMessageRole; content: string }>;
  canvas: AgentSurfaceSnapshot;
  phase: AgentConversationPhase;
  focusedNodeId?: string;
  inspectedImages?: AgentInspectedImage[];
};

export type AgentResponse = {
  progressSummary?: string;
  message: string;
  workflowState: AgentWorkflowState;
  inspectImageNodeIds: string[];
  operations: AgentOperation[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readMode(value: unknown): ComposerMode | null {
  return value === "text" || value === "image" || value === "video"
    ? value
    : null;
}

function readNodeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readAssetKind(value: unknown): AgentStoryAssetKind | null {
  return value === "character" || value === "scene" || value === "prop"
    ? value
    : null;
}

function readFoundationRole(value: unknown): AgentStoryFoundationRole | null {
  return value === "lead" || value === "support" ? value : null;
}

function parseStoryAnalysis(value: unknown): AgentStoryAnalysis | null {
  if (!isRecord(value)) return null;
  const analysis = {
    genre: readString(value.genre).trim(),
    theme: readString(value.theme).trim(),
    audience: readString(value.audience).trim(),
    emotion: readString(value.emotion).trim(),
    estimatedDuration: readString(
      value.estimated_duration ?? value.estimatedDuration,
    ).trim(),
    visualStyle: readString(value.visual_style ?? value.visualStyle).trim(),
  };
  return [
    analysis.genre,
    analysis.theme,
    analysis.audience,
    analysis.emotion,
    analysis.estimatedDuration,
    analysis.visualStyle,
  ].every(Boolean)
    ? analysis
    : null;
}

function parseStoryAssets(value: unknown, isFinal: boolean): AgentStoryAsset[] | null {
  if (!Array.isArray(value) || value.length > 8 || (!value.length && !isFinal)) {
    return null;
  }
  const assets = value.map((item) => {
    if (!isRecord(item)) return null;
    const asset = {
      ref: readString(item.ref).trim(),
      name: readString(item.name).trim(),
      description: readString(item.description).trim(),
      reason: readString(item.reason).trim(),
      occurrences: readNodeIds(item.occurrences).map((entry) => entry.trim()).filter(Boolean),
      imagePrompt: readString(item.image_prompt ?? item.imagePrompt).trim(),
      aspectRatio: readString(item.aspect_ratio ?? item.aspectRatio).trim(),
      resolution: readString(item.resolution).trim(),
      foundationRole: readFoundationRole(
        item.foundation_role ?? item.foundationRole,
      ) ?? undefined,
    };
    return asset.ref && asset.name && asset.description && asset.reason &&
      asset.occurrences.length && asset.imagePrompt
      ? asset
      : null;
  });
  if (assets.some((asset) => asset === null)) return null;
  const parsed = assets as AgentStoryAsset[];
  return new Set(parsed.map((asset) => asset.ref)).size === parsed.length
    ? parsed
    : null;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => readString(item).trim()).filter(Boolean)
    : [];
}

function parseStoryBeats(value: unknown): StoryBeat[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const beats = value.map((item) => {
    if (!isRecord(item)) return null;
    const beat: StoryBeat = {
      beatId: readString(item.beat_id ?? item.beatId).trim(),
      sequence: Number(item.sequence),
      sceneId: readString(item.scene_id ?? item.sceneId).trim(),
      narrativePurpose: readString(
        item.narrative_purpose ?? item.narrativePurpose,
      ).trim(),
      emotionalGoal: readString(item.emotional_goal ?? item.emotionalGoal).trim(),
      summary: readString(item.summary).trim(),
    };
    return beat.beatId && Number.isInteger(beat.sequence) && beat.sequence >= 1 &&
        beat.sceneId && beat.narrativePurpose && beat.emotionalGoal && beat.summary
      ? beat
      : null;
  });
  if (beats.some((beat) => beat === null)) return null;
  const parsed = beats as StoryBeat[];
  return new Set(parsed.map((beat) => beat.beatId)).size === parsed.length
    ? parsed
    : null;
}

function parseScenePlans(value: unknown): ScenePlan[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const plans = value.map((item) => {
    if (!isRecord(item)) return null;
    const plan: ScenePlan = {
      sceneId: readString(item.scene_id ?? item.sceneId).trim(),
      beatIds: readStringList(item.beat_ids ?? item.beatIds),
      spatialLayout: readString(item.spatial_layout ?? item.spatialLayout).trim(),
      blocking: readString(item.blocking).trim(),
      eyeline: readString(item.eyeline).trim(),
      axis: readString(item.axis).trim(),
      entrancesExits: readString(
        item.entrances_exits ?? item.entrancesExits,
      ).trim(),
      lighting: readString(item.lighting).trim(),
      colorTone: readString(item.color_tone ?? item.colorTone).trim(),
    };
    return plan.sceneId && plan.beatIds.length && plan.spatialLayout &&
        plan.blocking && plan.eyeline && plan.axis && plan.entrancesExits &&
        plan.lighting && plan.colorTone
      ? plan
      : null;
  });
  if (plans.some((plan) => plan === null)) return null;
  const parsed = plans as ScenePlan[];
  return new Set(parsed.map((plan) => plan.sceneId)).size === parsed.length
    ? parsed
    : null;
}

function missingStringField(
  value: Record<string, unknown>,
  fields: string[],
) {
  return fields.find((field) => {
    const camel = field.replace(/_([a-z])/g, (_, character: string) =>
      character.toUpperCase()
    );
    return !readString(value[field] ?? value[camel]).trim();
  });
}

function describeInvalidMangaStoryBeats(value: unknown) {
  if (!Array.isArray(value) || !value.length) {
    return "beats 必须包含至少一个剧情节拍";
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return `beats[${index}] 必须是对象`;
    const missing = missingStringField(item, [
      "beat_id",
      "scene_id",
      "narrative_purpose",
      "emotional_goal",
      "summary",
    ]);
    if (missing) return `beats[${index}] 的 ${missing} 不能为空`;
    if (!Number.isInteger(Number(item.sequence)) || Number(item.sequence) < 1) {
      return `beats[${index}] 的 sequence 必须是正整数`;
    }
  }
  return "beats 的 beat_id 不能重复";
}

function describeInvalidMangaScenePlans(value: unknown) {
  if (!Array.isArray(value) || !value.length) {
    return "plans 必须包含至少一个场面调度";
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return `plans[${index}] 必须是对象`;
    const missing = missingStringField(item, [
      "scene_id",
      "spatial_layout",
      "blocking",
      "eyeline",
      "axis",
      "entrances_exits",
      "lighting",
      "color_tone",
    ]);
    if (missing) return `plans[${index}] 的 ${missing} 不能为空`;
    if (!readStringList(item.beat_ids ?? item.beatIds).length) {
      return `plans[${index}] 的 beat_ids 必须包含至少一个剧情节拍 ID`;
    }
  }
  return "plans 的 scene_id 不能重复";
}

function describeInvalidMangaContinuityReport(value: unknown) {
  if (!isRecord(value)) return "report 必须是对象";
  if (!Array.isArray(value.issues)) return "report.issues 必须是数组";
  for (const [index, item] of value.issues.entries()) {
    if (!isRecord(item)) return `report.issues[${index}] 必须是对象`;
    const missing = missingStringField(item, ["code", "shot_id", "reason", "suggestion"]);
    if (missing) return `report.issues[${index}] 的 ${missing} 不能为空`;
    if (item.severity !== "error" && item.severity !== "warning") {
      return `report.issues[${index}] 的 severity 必须是 error 或 warning`;
    }
    if (typeof (item.auto_fixable ?? item.autoFixable) !== "boolean") {
      return `report.issues[${index}] 的 auto_fixable 必须是布尔值`;
    }
  }
  return "连续性报告字段无效";
}

function parseShotTimeline(value: unknown, duration: number) {
  if (!Array.isArray(value) || !value.length) return null;
  const timeline = value.map((item) => {
    if (!isRecord(item)) return null;
    const segment: ShotTimelineSegment = {
      startSecond: Number(item.start_second ?? item.startSecond),
      endSecond: Number(item.end_second ?? item.endSecond),
      visualAction: readString(item.visual_action ?? item.visualAction).trim(),
      performance: readString(item.performance).trim() || "无",
      camera: readString(item.camera).trim(),
      audio: readString(item.audio).trim() || "无",
    };
    return Number.isInteger(segment.startSecond) &&
        Number.isInteger(segment.endSecond) &&
        segment.visualAction && segment.performance && segment.camera && segment.audio
      ? segment
      : null;
  });
  if (timeline.some((segment) => segment === null)) return null;
  let previousEnd = 0;
  const parsed = (timeline as ShotTimelineSegment[]).map((segment, index, all) => {
    const normalized = {
      ...segment,
      startSecond: previousEnd,
      endSecond: index === all.length - 1 ? duration : segment.endSecond,
    };
    previousEnd = normalized.endSecond;
    return normalized;
  });
  return parsed.every((segment) =>
    segment.startSecond >= 0 && segment.endSecond > segment.startSecond &&
    segment.endSecond <= duration
  ) ? parsed : null;
}

function validMangaShotDuration(
  duration: number,
  durationReason: string,
  tempo: AgentMangaStoryboardTempo,
) {
  if (tempo === "short-cut") return duration === 2 || duration === 3;
  return duration >= 5 && duration <= 15 && (duration >= 10 || Boolean(durationReason));
}

function parseMangaShots(
  value: unknown,
  tempo: AgentMangaStoryboardTempo = "long-form",
): ShotPlan[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 8) return null;
  const shots = value.map((item) => {
    if (!isRecord(item)) return null;
    const duration = Number(item.duration);
    const durationReason = readString(
      item.duration_reason ?? item.durationReason,
    ).trim();
    const timeline = parseShotTimeline(item.timeline, duration);
    const referenceNodeIds = readNodeIds(
      item.reference_node_ids ?? item.referenceNodeIds,
    );
    const shot: ShotPlan = {
      shotId: readString(item.shot_id ?? item.shotId).trim(),
      sequence: Number(item.sequence),
      sceneId: readString(item.scene_id ?? item.sceneId).trim(),
      beatId: readString(item.beat_id ?? item.beatId).trim(),
      duration,
      durationReason,
      narrativePurpose: readString(
        item.narrative_purpose ?? item.narrativePurpose,
      ).trim(),
      emotionalGoal: readString(item.emotional_goal ?? item.emotionalGoal).trim(),
      shotSize: readString(item.shot_size ?? item.shotSize).trim(),
      lens: readString(item.lens).trim(),
      perspective: readString(item.perspective).trim(),
      cameraAngle: readString(item.camera_angle ?? item.cameraAngle).trim(),
      cameraMovement: readString(
        item.camera_movement ?? item.cameraMovement,
      ).trim(),
      composition: readString(item.composition).trim(),
      blocking: readString(item.blocking).trim(),
      characterIds: readStringList(item.character_ids ?? item.characterIds),
      characterPosition: readString(
        item.character_position ?? item.characterPosition,
      ).trim() || "无",
      characterMovement: readString(
        item.character_movement ?? item.characterMovement,
      ).trim() || "无",
      eyeline: readString(item.eyeline).trim() || "无",
      propIds: readStringList(item.prop_ids ?? item.propIds),
      action: readString(item.action).trim(),
      dialogue: readString(item.dialogue).trim() || "无",
      voiceover: readString(item.voiceover).trim() || "无",
      soundEffect: readString(item.sound_effect ?? item.soundEffect).trim() || "无",
      musicCue: readString(item.music_cue ?? item.musicCue).trim() || "无",
      lighting: readString(item.lighting).trim(),
      colorTone: readString(item.color_tone ?? item.colorTone).trim(),
      texture: readString(item.texture).trim(),
      startFrame: readString(item.start_frame ?? item.startFrame).trim(),
      endFrame: readString(item.end_frame ?? item.endFrame).trim(),
      transitionIn: readString(item.transition_in ?? item.transitionIn).trim(),
      transitionOut: readString(item.transition_out ?? item.transitionOut).trim(),
      imagePrompt: readString(item.image_prompt ?? item.imagePrompt).trim(),
      videoPrompt: "",
      negativePrompt: readString(
        item.negative_prompt ?? item.negativePrompt,
      ).trim(),
      previousShotId: readString(
        item.previous_shot_id ?? item.previousShotId,
      ).trim(),
      nextShotId: readString(item.next_shot_id ?? item.nextShotId).trim(),
      continuityNotes: readString(
        item.continuity_notes ?? item.continuityNotes,
      ).trim() || "无",
      generationStatus: "planned",
      timeline: timeline ?? [],
      referenceNodeIds,
      continuityWarnings: readStringList(
        item.continuity_warnings ?? item.continuityWarnings,
      ),
    };
    const required = [
      shot.shotId, shot.sceneId, shot.beatId, shot.narrativePurpose,
      shot.emotionalGoal, shot.shotSize, shot.lens, shot.perspective,
      shot.cameraAngle, shot.cameraMovement, shot.composition, shot.blocking,
      shot.characterPosition, shot.characterMovement, shot.eyeline, shot.action,
      shot.dialogue, shot.voiceover, shot.soundEffect, shot.musicCue,
      shot.lighting, shot.colorTone, shot.texture, shot.startFrame,
      shot.endFrame, shot.transitionIn, shot.transitionOut, shot.imagePrompt,
      shot.negativePrompt, shot.continuityNotes,
    ];
    return Number.isInteger(shot.sequence) && shot.sequence >= 1 &&
        Number.isInteger(duration) && validMangaShotDuration(duration, durationReason, tempo) && timeline &&
        referenceNodeIds.length >= 1 && referenceNodeIds.length <= 5 &&
        new Set(referenceNodeIds).size === referenceNodeIds.length &&
        required.every(Boolean)
      ? shot
      : null;
  });
  if (shots.some((shot) => shot === null)) return null;
  const parsed = shots as ShotPlan[];
  if (new Set(parsed.map((shot) => shot.shotId)).size !== parsed.length) return null;
  return validateMangaShotCinematography(parsed) ? null : parsed;
}

function describeInvalidMangaShots(
  value: unknown,
  tempo: AgentMangaStoryboardTempo = "long-form",
) {
  if (!Array.isArray(value) || !value.length || value.length > 8) {
    return "镜头批次必须包含 1 至 8 镜";
  }
  const requiredStrings = [
    "shot_id", "scene_id", "beat_id", "narrative_purpose", "emotional_goal",
    "shot_size", "lens", "perspective", "camera_angle", "camera_movement",
    "composition", "blocking", "character_position", "character_movement",
    "eyeline", "action", "dialogue", "voiceover", "sound_effect", "music_cue",
    "lighting", "color_tone", "texture", "start_frame", "end_frame",
    "transition_in", "transition_out", "image_prompt", "negative_prompt",
    "continuity_notes",
  ];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return `第 ${index + 1} 镜不是对象`;
    const shotId = readString(item.shot_id ?? item.shotId).trim() || `第 ${index + 1} 镜`;
    const missing = requiredStrings.find((field) => {
      const camel = field.replace(/_([a-z])/g, (_, character: string) =>
        character.toUpperCase()
      );
      return !readString(item[field] ?? item[camel]).trim();
    });
    if (missing) return `${shotId} 的 ${missing} 不能为空；无内容时填写“无”`;
    const sequence = Number(item.sequence);
    if (!Number.isInteger(sequence) || sequence < 1) return `${shotId} 的 sequence 必须为正整数`;
    const duration = Number(item.duration);
    if (!Number.isInteger(duration) || !validMangaShotDuration(
      duration,
      readString(item.duration_reason ?? item.durationReason).trim(),
      tempo,
    )) {
      return tempo === "short-cut"
        ? `${shotId} 的 duration 必须为 2 或 3 秒`
        : `${shotId} 的 duration 必须为 5 至 15 的整数；5 至 9 秒必须填写 duration_reason`;
    }
    if (!parseShotTimeline(item.timeline, duration)) {
      return `${shotId} 的 timeline 必须从 0 秒连续覆盖到 ${duration} 秒`;
    }
    const references = readNodeIds(
      item.reference_node_ids ?? item.referenceNodeIds,
    );
    if (
      references.length < 1 || references.length > 5 ||
      new Set(references).size !== references.length
    ) {
      return `${shotId} 必须引用 1 至 5 个不重复的成功资产节点`;
    }
  }
  return "镜头 ID 重复或存在未识别的字段约束";
}

function parseContinuityReport(value: unknown): ContinuityReport | null {
  if (!isRecord(value) || !Array.isArray(value.issues)) return null;
  const issues = value.issues.map((item) => {
    if (!isRecord(item)) return null;
    const severity = item.severity === "error" || item.severity === "warning"
      ? item.severity
      : null;
    const autoFixable = item.auto_fixable ?? item.autoFixable;
    const issue: ContinuityIssue = {
      code: readString(item.code).trim(),
      severity: severity ?? "error",
      shotId: readString(item.shot_id ?? item.shotId).trim(),
      ...(readString(item.related_shot_id ?? item.relatedShotId).trim()
        ? { relatedShotId: readString(item.related_shot_id ?? item.relatedShotId).trim() }
        : {}),
      reason: readString(item.reason).trim(),
      suggestion: readString(item.suggestion).trim(),
      autoFixable: autoFixable === true,
    };
    return severity && typeof autoFixable === "boolean" && issue.code && issue.shotId && issue.reason && issue.suggestion
      ? issue
      : null;
  });
  return issues.some((issue) => issue === null)
    ? null
    : { issues: issues as ContinuityIssue[] };
}

export function isPersistedStoryBeats(value: unknown): value is StoryBeat[] {
  return parseStoryBeats(value) !== null;
}

export function isPersistedScenePlan(value: unknown): value is ScenePlan {
  return parseScenePlans([value]) !== null;
}

export function isPersistedShotPlan(value: unknown): value is ShotPlan {
  return parseMangaShots([value], "long-form") !== null ||
    parseMangaShots([value], "short-cut") !== null;
}

export function isPersistedContinuityReport(
  value: unknown,
): value is ContinuityReport {
  return parseContinuityReport(value) !== null;
}

function parseStoryShots(value: unknown): AgentStoryShot[] | null {
  if (!Array.isArray(value) || value.length < 1) return null;
  const shots = value.map((item) => {
    if (!isRecord(item)) return null;
    const ref = readString(item.ref).trim();
    const title = readString(item.title).trim();
    const script = readString(item.script).trim();
    const imagePrompt = readString(item.image_prompt ?? item.imagePrompt).trim();
    const videoPrompt = readString(item.video_prompt ?? item.videoPrompt).trim();
    const duration = readString(item.duration).trim() || "5";
    if (!ref || !title || !script || !imagePrompt || !videoPrompt) return null;
    return {
      ref,
      title,
      script,
      imagePrompt,
      videoPrompt,
      duration,
      referenceNodeIds: readNodeIds(
        item.reference_node_ids ?? item.referenceNodeIds,
      ),
    };
  });
  if (shots.some((shot) => shot === null)) return null;
  const parsed = shots as AgentStoryShot[];
  return new Set(parsed.map((shot) => shot.ref)).size === parsed.length
    ? parsed
    : null;
}

const STORY_WORKFLOW_CHUNK_SIZE = 8;

function normalizeStoryWorkflowBatches(
  operations: AgentOperation[],
): AgentOperation[] {
  let nextChunkIndex: number | undefined;
  return operations.flatMap((operation): AgentOperation[] => {
    if (operation.type !== "create_story_workflow") return [operation];
    const chunkIndex = nextChunkIndex ?? operation.chunkIndex;
    const chunkCount = Math.ceil(
      operation.shots.length / STORY_WORKFLOW_CHUNK_SIZE,
    );
    nextChunkIndex = chunkIndex + chunkCount;
    return Array.from({ length: chunkCount }, (_, index) => ({
      ...operation,
      chunkIndex: chunkIndex + index,
      isFinal: operation.isFinal && index === chunkCount - 1,
      shots: operation.shots.slice(
        index * STORY_WORKFLOW_CHUNK_SIZE,
        (index + 1) * STORY_WORKFLOW_CHUNK_SIZE,
      ),
    }));
  });
}

function parseOperation(
  value: unknown,
  mangaTempo: AgentMangaStoryboardTempo = "long-form",
): AgentOperation | null {
  if (!isRecord(value)) return null;
  const type = readString(value.type);

  if (type === "create_node") {
    const kind = readMode(value.kind);
    const x = readFinite(value.x);
    const y = readFinite(value.y);
    const ref = readString(value.ref);
    if (!kind || x === null || y === null || !ref) return null;
    return { type, ref, kind, text: readString(value.text), x, y };
  }

  if (type === "update_node") {
    const nodeId = readString(value.node_id ?? value.nodeId);
    const hasText = typeof value.text === "string";
    const hasPrompt = typeof value.prompt === "string";
    if (!nodeId || (!hasText && !hasPrompt)) return null;
    return {
      type,
      nodeId,
      ...(hasText ? { text: String(value.text) } : {}),
      ...(hasPrompt ? { prompt: String(value.prompt) } : {}),
    };
  }

  if (type === "move_node") {
    const nodeId = readString(value.node_id ?? value.nodeId);
    const x = readFinite(value.x);
    const y = readFinite(value.y);
    return nodeId && x !== null && y !== null ? { type, nodeId, x, y } : null;
  }

  if (type === "resize_node") {
    const nodeId = readString(value.node_id ?? value.nodeId);
    const width = readFinite(value.width);
    const height = readFinite(value.height);
    return nodeId && width !== null && height !== null
      ? { type, nodeId, width, height }
      : null;
  }

  if (type === "connect_nodes" || type === "disconnect_nodes") {
    const sourceId = readString(value.source_id ?? value.sourceId);
    const targetId = readString(value.target_id ?? value.targetId);
    return sourceId && targetId ? { type, sourceId, targetId } : null;
  }

  if (type === "delete_node") {
    const nodeId = readString(value.node_id ?? value.nodeId);
    return nodeId ? { type, nodeId } : null;
  }

  if (type === "create_story_analysis") {
    const ref = readString(value.ref).trim();
    const title = readString(value.title).trim();
    const analysis = parseStoryAnalysis(value.analysis);
    if (!ref || !title || !analysis) return null;
    return {
      type,
      ref,
      title,
      analysis,
      projectAspectRatio: readString(
        value.project_aspect_ratio ?? value.projectAspectRatio,
      ).trim(),
      imageModel: readString(value.image_model ?? value.imageModel).trim(),
    };
  }

  if (type === "create_story_asset_batch") {
    const storyId = readString(value.story_id ?? value.storyId).trim();
    const assetKind = readAssetKind(value.asset_kind ?? value.assetKind);
    const chunkIndex = readFinite(value.chunk_index ?? value.chunkIndex);
    const isFinal = readBoolean(value.is_final ?? value.isFinal);
    const assets = isFinal === null ? null : parseStoryAssets(value.assets, isFinal);
    if (
      !storyId ||
      !assetKind ||
      chunkIndex === null ||
      !Number.isInteger(chunkIndex) ||
      chunkIndex < 0 ||
      isFinal === null ||
      !assets
    ) {
      return null;
    }
    return { type, storyId, assetKind, chunkIndex, isFinal, assets };
  }

  if (type === "run_story_assets") {
    const storyId = readString(value.story_id ?? value.storyId).trim();
    return storyId
      ? {
          type,
          storyId,
          assetRefs: readNodeIds(value.asset_refs ?? value.assetRefs),
        }
      : null;
  }

  if (type === "create_manga_story_beats") {
    const storyId = readString(value.story_id ?? value.storyId).trim();
    const stageIndex = readFinite(value.stage_index ?? value.stageIndex);
    const beats = parseStoryBeats(value.beats);
    if (!storyId) throw new Error("Agent 剧情节拍结构校验失败：story_id 不能为空。");
    if (stageIndex !== 0) {
      throw new Error("Agent 剧情节拍结构校验失败：stage_index 必须为 0。");
    }
    if (!beats) {
      throw new Error(`Agent 剧情节拍结构校验失败：${describeInvalidMangaStoryBeats(value.beats)}。`);
    }
    return { type, storyId, stageIndex, beats };
  }

  if (type === "create_manga_scene_plans") {
    const storyId = readString(value.story_id ?? value.storyId).trim();
    const stageIndex = readFinite(value.stage_index ?? value.stageIndex);
    const plans = parseScenePlans(value.plans);
    if (!storyId) throw new Error("Agent 场面调度结构校验失败：story_id 不能为空。");
    if (stageIndex !== 1) {
      throw new Error("Agent 场面调度结构校验失败：stage_index 必须为 1。");
    }
    if (!plans) {
      throw new Error(`Agent 场面调度结构校验失败：${describeInvalidMangaScenePlans(value.plans)}。`);
    }
    return { type, storyId, stageIndex, plans };
  }

  if (type === "create_manga_shot_batch") {
    const storyId = readString(value.story_id ?? value.storyId).trim();
    const chunkIndex = readFinite(value.chunk_index ?? value.chunkIndex);
    const isFinal = readBoolean(value.is_final ?? value.isFinal);
    const shots = parseMangaShots(value.shots, mangaTempo);
    if (!shots) {
      throw new Error(`Agent 镜头结构校验失败：${describeInvalidMangaShots(value.shots, mangaTempo)}`);
    }
    return storyId && chunkIndex !== null && Number.isInteger(chunkIndex) &&
        chunkIndex >= 0 && isFinal !== null
      ? { type, storyId, chunkIndex, isFinal, shots }
      : null;
  }

  if (type === "create_manga_continuity_report") {
    const storyId = readString(value.story_id ?? value.storyId).trim();
    const stageIndex = readFinite(value.stage_index ?? value.stageIndex);
    const report = parseContinuityReport(value.report);
    if (!storyId) throw new Error("Agent 连续性报告结构校验失败：story_id 不能为空。");
    if (stageIndex !== 3) {
      throw new Error("Agent 连续性报告结构校验失败：stage_index 必须为 3。");
    }
    if (!report) {
      throw new Error(`Agent 连续性报告结构校验失败：${describeInvalidMangaContinuityReport(value.report)}。`);
    }
    return { type, storyId, stageIndex, report };
  }

  if (type === "create_story_workflow") {
    const ref = readString(value.ref).trim();
    const title = readString(value.title).trim();
    const globalContext = readString(
      value.global_context ?? value.globalContext,
    ).trim();
    const chunkIndex = readFinite(value.chunk_index ?? value.chunkIndex);
    const isFinal = readBoolean(value.is_final ?? value.isFinal);
    const shots = parseStoryShots(value.shots);
    if (
      !ref ||
      !title ||
      !globalContext ||
      chunkIndex === null ||
      !Number.isInteger(chunkIndex) ||
      chunkIndex < 0 ||
      isFinal === null ||
      !shots
    ) {
      return null;
    }
    return {
      type,
      ref,
      title,
      globalContext,
      imageModel: readString(value.image_model ?? value.imageModel).trim(),
      videoModel: readString(value.video_model ?? value.videoModel).trim(),
      aspectRatio: readString(value.aspect_ratio ?? value.aspectRatio).trim(),
      imageResolution: readString(
        value.image_resolution ?? value.imageResolution,
      ).trim(),
      videoResolution: readString(
        value.video_resolution ?? value.videoResolution,
      ).trim(),
      chunkIndex,
      isFinal,
      shots,
    };
  }

  if (type === "run_story_workflow") {
    const storyId = readString(value.story_id ?? value.storyId).trim();
    return storyId
      ? {
          type,
          storyId,
          shotRefs: readNodeIds(value.shot_refs ?? value.shotRefs),
        }
      : null;
  }

  if (type === "generate_content") {
    const mode = readMode(value.mode);
    const model = mode
      ? normalizeAgentModelId(mode, readString(value.model))
      : "";
    const prompt = readString(value.prompt).trim();
    if (!mode || !model || !prompt) return null;
    return {
      type,
      mode,
      model,
      prompt,
      referenceNodeIds: readNodeIds(
        value.reference_node_ids ?? value.referenceNodeIds,
      ),
      ...(readString(value.aspect_ratio ?? value.aspectRatio)
        ? { aspectRatio: readString(value.aspect_ratio ?? value.aspectRatio) }
        : {}),
      ...(readString(value.duration)
        ? { duration: readString(value.duration) }
        : {}),
      ...(readString(value.resolution)
        ? { resolution: readString(value.resolution) }
        : {}),
    };
  }

  return null;
}

export function parseAgentModelResponse(
  raw: string,
  options: { mangaTempo?: AgentMangaStoryboardTempo } = {},
): AgentResponse {
  const cleaned = raw
    .replace(/^[\u200B-\u200D\u2060\uFEFF]+|[\u200B-\u200D\u2060\uFEFF]+$/g, "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    let repaired = cleaned;
    for (let removed = 0; removed < 3 && repaired.endsWith("}"); removed += 1) {
      repaired = repaired.slice(0, -1).trimEnd();
      try {
        value = JSON.parse(repaired);
        break;
      } catch {
        // Only tolerate surplus closing braces at the very end.
      }
    }
    if (value === undefined) {
      throw new Error("Agent 返回了无法识别的操作格式。");
    }
  }
  if (!isRecord(value)) throw new Error("Agent 返回了无法识别的操作格式。");
  const rawMessage = readString(value.message).trim();
  const workflowState = readString(
    value.workflow_state ?? value.workflowState,
  );
  if (workflowState !== "clarifying" && workflowState !== "active") {
    throw new Error("Agent 未返回有效的工作流状态。");
  }
  const rawOperations = Array.isArray(value.operations) ? value.operations : [];
  const parsedOperations = rawOperations.map((operation) =>
    parseOperation(operation, options.mangaTempo),
  );
  if (parsedOperations.some((operation) => operation === null)) {
    throw new Error("Agent 返回了不受支持的画布操作。");
  }
  const operations = normalizeStoryWorkflowBatches(
    parsedOperations as AgentOperation[],
  );
  const message = rawMessage || (operations.length ? "已完成当前阶段规划。" : "");
  if (!message) throw new Error("Agent 未返回可显示的回复。");
  const inspectImageNodeIds = readNodeIds(
    value.inspect_image_node_ids ?? value.inspectImageNodeIds,
  ).slice(0, 5);
  if (
    workflowState === "clarifying" &&
    (operations.length || inspectImageNodeIds.length)
  ) {
    throw new Error("Agent 在需求澄清阶段不得执行画布操作。");
  }
  return {
    ...(readString(value.progress_summary ?? value.progressSummary).trim()
      ? {
          progressSummary: readString(
            value.progress_summary ?? value.progressSummary,
          ).trim(),
        }
      : {}),
    message,
    workflowState,
    inspectImageNodeIds,
    operations,
  };
}

export function isDangerousAgentOperation(
  operation: AgentOperation,
): operation is AgentDangerousOperation {
  return (
    operation.type === "delete_node" ||
    operation.type === "generate_content" ||
    operation.type === "run_story_workflow" ||
    operation.type === "run_story_assets"
  );
}

export function validateAgentOperationsForSurface(
  mode: AgentSurfaceSnapshot["mode"],
  operations: AgentOperation[],
) {
  const storyOperations = operations.filter(
    (operation) =>
      operation.type === "create_story_analysis" ||
      operation.type === "create_story_asset_batch" ||
      operation.type === "run_story_assets" ||
      operation.type === "create_manga_story_beats" ||
      operation.type === "create_manga_scene_plans" ||
      operation.type === "create_manga_shot_batch" ||
      operation.type === "create_manga_continuity_report" ||
      operation.type === "create_story_workflow" ||
      operation.type === "run_story_workflow",
  );
  if (mode === "creation" && storyOperations.length) {
    throw new Error("短剧工作流操作不能在创作画布执行。");
  }
  if (mode === "workflow" && storyOperations.length !== operations.length) {
    throw new Error("普通创作画布操作不能在工作流画布执行。");
  }
  if (
    operations.some((operation) =>
      operation.type === "create_story_analysis" ||
      operation.type === "create_story_asset_batch" ||
      operation.type === "create_manga_story_beats" ||
      operation.type === "create_manga_scene_plans" ||
      operation.type === "create_manga_shot_batch" ||
      operation.type === "create_manga_continuity_report" ||
      operation.type === "create_story_workflow",
    ) &&
    operations.some((operation) =>
      operation.type === "run_story_assets" ||
      operation.type === "run_story_workflow",
    )
  ) {
    throw new Error("创建或规划操作和批量生成不能在同一响应中执行。");
  }
}

export function getPendingAgentConfirmations(
  messages: AgentMessage[],
): AgentPendingConfirmation[] {
  return messages.flatMap((message) =>
    message.action?.status === "pending" && message.action.operation
      ? [{ messageId: message.id, operation: message.action.operation }]
      : [],
  );
}

export function expireIncompleteAgentConfirmations(messages: AgentMessage[]) {
  let changed = false;
  const normalized = messages.map((message) => {
    if (message.action?.status !== "pending" || message.action.operation) {
      return message;
    }
    changed = true;
    return {
      ...message,
      details: ["确认内容已失效，请重新向 Agent 提出要执行的操作。"],
      action: { ...message.action, status: "expired" as const },
    };
  });
  return changed ? normalized : messages;
}

export async function runAgentConfirmationWithTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs = AGENT_CONFIRM_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error(AGENT_CONFIRM_TIMEOUT_MESSAGE));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function runAgentRequestWithTimeout<T>(
  task: (signal: AbortSignal, markActivity: () => void) => Promise<T>,
  parentSignal?: AbortSignal,
  timeout = {
    firstResponseMs: AGENT_FIRST_RESPONSE_TIMEOUT_MS,
    inactivityMs: AGENT_INACTIVITY_TIMEOUT_MS,
    totalMs: AGENT_TOTAL_TIMEOUT_MS,
  },
): Promise<T> {
  const controller = new AbortController();
  let firstResponseTimer: ReturnType<typeof setTimeout> | undefined;
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutError: AgentRequestTimeoutError | undefined;
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const abort = () => controller.abort(parentSignal?.reason);

  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
    controller.signal.addEventListener(
      "abort",
      () => {
        reject(timeoutError ?? controller.signal.reason);
      },
      { once: true },
    );
  });

  const abortForTimeout = (
    kind: AgentRequestTimeoutKind,
    message: string,
  ) => {
    if (controller.signal.aborted) return;
    timeoutError = new AgentRequestTimeoutError(kind, message);
    controller.abort(timeoutError);
  };
  const markActivity = () => {
    if (controller.signal.aborted) return;
    if (firstResponseTimer) {
      clearTimeout(firstResponseTimer);
      firstResponseTimer = undefined;
    }
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(
      () => abortForTimeout("inactivity", AGENT_INACTIVITY_TIMEOUT_MESSAGE),
      timeout.inactivityMs,
    );
  };

  firstResponseTimer = setTimeout(
    () => abortForTimeout("first-response", AGENT_FIRST_RESPONSE_TIMEOUT_MESSAGE),
    timeout.firstResponseMs,
  );
  const totalTimer = setTimeout(
    () => abortForTimeout("total", AGENT_TOTAL_TIMEOUT_MESSAGE),
    timeout.totalMs,
  );

  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });

  try {
    if (controller.signal.aborted) {
      rejectAbort?.(timeoutError ?? controller.signal.reason);
    }
    return await Promise.race([
      task(controller.signal, markActivity),
      aborted,
    ]);
  } finally {
    if (firstResponseTimer) clearTimeout(firstResponseTimer);
    if (inactivityTimer) clearTimeout(inactivityTimer);
    clearTimeout(totalTimer);
    parentSignal?.removeEventListener("abort", abort);
  }
}

export async function runAgentConfirmationsSequentially<T>(
  confirmations: T[],
  execute: (confirmation: T, index: number, total: number) => Promise<boolean>,
) {
  for (let index = 0; index < confirmations.length; index += 1) {
    const succeeded = await execute(
      confirmations[index],
      index,
      confirmations.length,
    );
    if (!succeeded) return { completed: index, failedIndex: index };
  }
  return { completed: confirmations.length };
}

export function serializeAgentMessages(messages: AgentMessage[]): string {
  return JSON.stringify(
    messages.slice(-MAX_AGENT_MESSAGES).map((message) => ({
      ...message,
      action: message.action
        ? {
            label: message.action.label,
            status:
              message.action.status === "pending"
                ? ("expired" as const)
                : message.action.status,
          }
        : undefined,
    })),
  );
}

export function parseAgentMessages(raw: string | null): AgentMessage[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(isRecord)
      .map((item) => {
        const role = item.role === "user" ? "user" : item.role === "assistant" ? "assistant" : null;
        const action = isRecord(item.action) ? item.action : undefined;
        if (!role || typeof item.id !== "string" || typeof item.content !== "string") {
          return null;
        }
        const status = action?.status;
        const parsedAction =
          action &&
          typeof action.label === "string" &&
          (status === "confirmed" || status === "cancelled" || status === "expired")
            ? { label: action.label, status }
            : undefined;
        return {
          id: item.id,
          role,
          content: item.content,
          createdAt:
            typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
              ? item.createdAt
              : Date.now(),
          details: Array.isArray(item.details)
            ? item.details.filter((detail): detail is string => typeof detail === "string")
            : undefined,
          action: parsedAction,
        } satisfies AgentMessage;
      })
      .filter((message): message is AgentMessage => Boolean(message))
      .slice(-MAX_AGENT_MESSAGES);
  } catch {
    return [];
  }
}

export function createAgentConversation(
  id: string,
  now = Date.now(),
): AgentConversation {
  return {
    id,
    title: "新对话",
    phase: "intake",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createAgentConversationTitle(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 24) || "新对话";
}

function serializeMessages(messages: AgentMessage[]) {
  return messages.slice(-MAX_AGENT_MESSAGES).map((message) => ({
    ...message,
    action: message.action
      ? {
          label: message.action.label,
          status:
            message.action.status === "pending"
              ? ("expired" as const)
              : message.action.status,
        }
      : undefined,
  }));
}

function sortAndLimitConversations(conversations: AgentConversation[]) {
  return [...conversations]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_AGENT_CONVERSATIONS);
}

export function serializeAgentConversationStore(store: AgentConversationStore) {
  const conversations = sortAndLimitConversations(store.conversations).map(
    (conversation) => ({
      ...conversation,
      title: createAgentConversationTitle(conversation.title),
      messages: serializeMessages(conversation.messages),
    }),
  );
  const activeConversationId = conversations.some(
    (conversation) => conversation.id === store.activeConversationId,
  )
    ? store.activeConversationId
    : conversations[0]?.id ?? "";
  return JSON.stringify({ version: 2, activeConversationId, conversations });
}

function readConversation(value: unknown): AgentConversation | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const phase = value.phase;
  if (phase !== "intake" && phase !== "clarifying" && phase !== "active") {
    return null;
  }
  const messages = parseAgentMessages(
    Array.isArray(value.messages) ? JSON.stringify(value.messages) : null,
  );
  const createdAt = readFinite(value.createdAt) ?? Date.now();
  const updatedAt = readFinite(value.updatedAt) ?? createdAt;
  const firstUserMessage = messages.find((message) => message.role === "user");
  return {
    id: value.id,
    title: createAgentConversationTitle(
      readString(value.title) || firstUserMessage?.content || "",
    ),
    phase,
    messages,
    createdAt,
    updatedAt,
  };
}

export function parseAgentConversationStore(
  raw: string | null,
  legacyRaw: string | null,
  idFactory: () => string = () => crypto.randomUUID(),
  now = Date.now(),
): AgentConversationStore {
  try {
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    if (isRecord(value) && value.version === 2 && Array.isArray(value.conversations)) {
      const seen = new Set<string>();
      const conversations = sortAndLimitConversations(
        value.conversations
          .map(readConversation)
          .filter((conversation): conversation is AgentConversation => {
            if (!conversation || seen.has(conversation.id)) return false;
            seen.add(conversation.id);
            return true;
          }),
      );
      if (conversations.length) {
        const activeConversationId = conversations.some(
          (conversation) => conversation.id === value.activeConversationId,
        )
          ? String(value.activeConversationId)
          : conversations[0].id;
        return { version: 2, activeConversationId, conversations };
      }
    }
  } catch {
    // Fall through to legacy migration or a new conversation.
  }

  const legacyMessages = parseAgentMessages(legacyRaw);
  const conversation = createAgentConversation(idFactory(), now);
  if (legacyMessages.length) {
    conversation.messages = legacyMessages;
    conversation.phase = "active";
    conversation.title = createAgentConversationTitle(
      legacyMessages.find((message) => message.role === "user")?.content || "",
    );
    conversation.createdAt = legacyMessages[0]?.createdAt ?? now;
    conversation.updatedAt = legacyMessages.at(-1)?.createdAt ?? now;
  }
  return {
    version: 2,
    activeConversationId: conversation.id,
    conversations: [conversation],
  };
}

export function describeDangerousOperation(operation: AgentDangerousOperation) {
  if (operation.type === "delete_node") return `删除节点 ${operation.nodeId}`;
  if (operation.type === "run_story_workflow") {
    return `批量生成短剧工作流 ${operation.storyId}${
      operation.shotRefs.length
        ? `（${operation.shotRefs.length} 个指定分镜）`
        : "（全部分镜）"
    }；同层任务将全部并行并可能产生多笔费用`;
  }
  if (operation.type === "run_story_assets") {
    return `批量生成短剧资产 ${operation.storyId}${
      operation.assetRefs.length
        ? `（${operation.assetRefs.length} 个指定资产）`
        : "（全部未完成资产）"
    }；任务将并行提交并可能产生多笔费用`;
  }
  const parameters =
    operation.mode === "image"
      ? [
          operation.aspectRatio ? `比例 ${operation.aspectRatio}` : "",
          operation.resolution ? `分辨率 ${operation.resolution}` : "",
          ...(operation.adjustments ?? []).map((item) =>
            item.replace(/[。；]+$/, ""),
          ),
        ].filter(Boolean)
      : [];
  return `使用 ${normalizeAgentModelId(operation.mode, operation.model)} 生成${
    operation.mode === "text" ? "文本" : operation.mode === "image" ? "图片" : "视频"
  }${parameters.length ? `（${parameters.join("；")}）` : ""}：${operation.prompt}`;
}
