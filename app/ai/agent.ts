import type { ComposerMode } from "./models.ts";

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
  storyVisualStyle?: string;
  assetAvailable?: boolean;
  planningStage?: AgentStoryAssetPlanningStage;
  planningStatus?: AgentStoryAssetPlanningStatus;
  planningChunkIndex?: number;
  projectAspectRatio?: string;
  storyImageModel?: string;
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
  tvc?: AgentTvcSnapshot;
};

export type AgentSurfaceSnapshot = AgentCanvasSnapshot | AgentWorkflowSnapshot;

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

export type AgentTvcStage =
  | "intake"
  | "script-draft"
  | "script-locked"
  | "prompt-final";

export type AgentTvcPromptPlanSegment = {
  ref: string;
  startSecond: number;
  endSecond: number;
  shotNumbers: string[];
  referenceNodeIds: string[];
};

export type AgentTvcSnapshot = {
  projectId: string;
  stage: AgentTvcStage;
  revision: number;
  lockedRevision?: number;
  title?: string;
  targetModel?: string;
  targetMaxDuration?: number;
  promptPlan?: AgentTvcPromptPlanSegment[];
};

export type AgentTvcReferenceRole =
  | "character-identity"
  | "character-anatomy"
  | "scene-geometry"
  | "lighting-color"
  | "wardrobe"
  | "prop-product"
  | "first-frame"
  | "last-frame";

export type AgentTvcReferenceMapping = {
  nodeId: string;
  roles: AgentTvcReferenceRole[];
  note: string;
};

export type AgentTvcBrief = {
  goal: string;
  audience: string;
  targetDuration: number;
  aspectRatio: string;
  platform: string;
  maxDuration: number;
  style: string;
  narrativeMode: string;
  audioPolicy: string;
  copy: string;
  referenceMap: AgentTvcReferenceMapping[];
};

export type AgentTvcAssetPlan = {
  ref: string;
  name: string;
  kind: AgentStoryAssetKind;
  description: string;
  reason: string;
  imagePrompt: string;
};

export type AgentTvcStoryboardRow = {
  shotNumber: string;
  startSecond: number;
  endSecond: number;
  durationSeconds: number;
  referenceScene: string;
  sceneTime: string;
  shotSizeLens: string;
  camera: string;
  composition: string;
  performance: string;
  narration: string;
  sound: string;
  transition: string;
  constraints: string;
  referenceNodeIds: string[];
};

export type AgentTvcPromptUnit = AgentTvcPromptPlanSegment & {
  prompt: string;
};

export type AgentCreateTvcBriefOperation = {
  type: "create_tvc_brief";
  ref: string;
  title: string;
  brief: AgentTvcBrief;
};

export type AgentUpdateTvcBriefOperation = {
  type: "update_tvc_brief";
  projectId: string;
  title?: string;
  brief: AgentTvcBrief;
};

export type AgentCreateTvcAssetPlanOperation = {
  type: "create_tvc_asset_plan";
  projectId: string;
  assets: AgentTvcAssetPlan[];
};

export type AgentWriteTvcStoryboardDraftOperation = {
  type: "write_tvc_storyboard_draft";
  projectId: string;
  rows: AgentTvcStoryboardRow[];
};

export type AgentCreateTvcPromptPackageOperation = {
  type: "create_tvc_prompt_package";
  projectId: string;
  sourceRevision: number;
  units: AgentTvcPromptUnit[];
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
  | AgentCreateStoryWorkflowOperation
  | AgentRunStoryWorkflowOperation
  | AgentCreateTvcBriefOperation
  | AgentUpdateTvcBriefOperation
  | AgentCreateTvcAssetPlanOperation
  | AgentWriteTvcStoryboardDraftOperation
  | AgentCreateTvcPromptPackageOperation
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

function readTvcReferenceRole(value: unknown): AgentTvcReferenceRole | null {
  return value === "character-identity" ||
      value === "character-anatomy" ||
      value === "scene-geometry" ||
      value === "lighting-color" ||
      value === "wardrobe" ||
      value === "prop-product" ||
      value === "first-frame" ||
      value === "last-frame"
    ? value
    : null;
}

function parseTvcReferenceMap(value: unknown): AgentTvcReferenceMapping[] | null {
  if (!Array.isArray(value)) return null;
  const mappings = value.map((item) => {
    if (!isRecord(item)) return null;
    const nodeId = readString(item.node_id ?? item.nodeId).trim();
    const roles = Array.isArray(item.roles)
      ? item.roles.map(readTvcReferenceRole)
      : [];
    const note = readString(item.note).trim();
    if (!nodeId || !roles.length || roles.some((role) => !role)) {
      return null;
    }
    const parsedRoles = roles as AgentTvcReferenceRole[];
    return new Set(parsedRoles).size === parsedRoles.length
      ? { nodeId, roles: parsedRoles, note }
      : null;
  });
  if (mappings.some((mapping) => mapping === null)) return null;
  const parsed = mappings as AgentTvcReferenceMapping[];
  return new Set(parsed.map((mapping) => mapping.nodeId)).size === parsed.length
    ? parsed
    : null;
}

function parseTvcBrief(value: unknown): AgentTvcBrief | null {
  if (!isRecord(value)) return null;
  const maxDuration = readFinite(value.max_duration ?? value.maxDuration);
  const referenceMap = parseTvcReferenceMap(
    value.reference_map ?? value.referenceMap,
  );
  const brief = {
    goal: readString(value.goal).trim(),
    audience: readString(value.audience).trim(),
    targetDuration: readFinite(
      value.target_duration ?? value.targetDuration,
    ),
    aspectRatio: readString(value.aspect_ratio ?? value.aspectRatio).trim(),
    platform: readString(value.platform).trim(),
    maxDuration,
    style: readString(value.style).trim(),
    narrativeMode: readString(
      value.narrative_mode ?? value.narrativeMode,
    ).trim(),
    audioPolicy: readString(value.audio_policy ?? value.audioPolicy).trim(),
    copy: readString(value.copy).trim(),
    referenceMap,
  };
  return brief.goal && brief.audience && brief.targetDuration !== null &&
      Number.isInteger(brief.targetDuration) && brief.targetDuration > 0 &&
      brief.aspectRatio && brief.platform &&
      brief.maxDuration !== null && Number.isInteger(brief.maxDuration) &&
      brief.maxDuration > 0 && brief.style && brief.narrativeMode &&
      brief.audioPolicy && brief.referenceMap
    ? {
        ...brief,
        targetDuration: brief.targetDuration,
        maxDuration: brief.maxDuration,
        referenceMap: brief.referenceMap,
      }
    : null;
}

function parseTvcAssetPlans(value: unknown): AgentTvcAssetPlan[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error("create_tvc_asset_plan 缺少至少一项 assets。");
  }
  const refs = new Set<string>();
  return value.map((item, index) => {
    const prefix = `create_tvc_asset_plan 第 ${index + 1} 项资产`;
    if (!isRecord(item)) throw new Error(`${prefix} 格式无效。`);
    const ref = readString(item.ref).trim();
    const name = readString(item.name).trim();
    const rawKind = item.kind ?? item.asset_kind ?? item.assetKind;
    const kind = rawKind === "product" ? "prop" : readAssetKind(rawKind);
    const description = readString(item.description).trim();
    const reason = readString(item.reason).trim();
    const imagePrompt = readString(item.image_prompt ?? item.imagePrompt).trim();
    if (!ref) throw new Error(`${prefix}缺少 ref。`);
    if (refs.has(ref)) throw new Error(`${prefix}的 ref 重复。`);
    if (!name) throw new Error(`${prefix}缺少 name。`);
    if (!kind) {
      throw new Error(`${prefix}的 kind 必须为 character、scene 或 prop。`);
    }
    if (!description) throw new Error(`${prefix}缺少 description。`);
    if (!reason) throw new Error(`${prefix}缺少 reason。`);
    if (!imagePrompt) throw new Error(`${prefix}缺少 image_prompt。`);
    refs.add(ref);
    return { ref, name, kind, description, reason, imagePrompt };
  });
}

function parseTvcStoryboardRows(value: unknown): AgentTvcStoryboardRow[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const rows = value.map((item) => {
    if (!isRecord(item)) return null;
    const shotNumber = readString(item.shot_number ?? item.shotNumber).trim();
    const startSecond = readFinite(item.start_second ?? item.startSecond);
    const endSecond = readFinite(item.end_second ?? item.endSecond);
    const durationSeconds = readFinite(
      item.duration_seconds ?? item.durationSeconds,
    );
    const row = {
      shotNumber,
      startSecond,
      endSecond,
      durationSeconds,
      referenceScene: readString(
        item.reference_scene ?? item.referenceScene,
      ).trim(),
      sceneTime: readString(item.scene_time ?? item.sceneTime).trim(),
      shotSizeLens: readString(
        item.shot_size_lens ?? item.shotSizeLens,
      ).trim(),
      camera: readString(item.camera).trim(),
      composition: readString(item.composition).trim(),
      performance: readString(item.performance).trim(),
      narration: readString(item.narration).trim(),
      sound: readString(item.sound).trim(),
      transition: readString(item.transition).trim(),
      constraints: readString(item.constraints).trim(),
      referenceNodeIds: readNodeIds(
        item.reference_node_ids ?? item.referenceNodeIds,
      ),
    };
    const timeValues = [
      row.startSecond,
      row.endSecond,
      row.durationSeconds,
    ];
    return row.shotNumber && timeValues.every(
      (entry) => entry !== null && Number.isInteger(entry),
    ) &&
        row.startSecond! >= 0 &&
        row.endSecond! > row.startSecond! &&
        row.durationSeconds! === row.endSecond! - row.startSecond! &&
        row.referenceScene && row.sceneTime && row.shotSizeLens && row.camera &&
        row.composition && row.performance && row.narration && row.sound &&
        row.transition && row.constraints
      ? row as AgentTvcStoryboardRow
      : null;
  });
  if (rows.some((row) => row === null)) return null;
  const parsed = rows as AgentTvcStoryboardRow[];
  return new Set(parsed.map((row) => row.shotNumber)).size === parsed.length
    ? parsed
    : null;
}

function parseTvcPromptUnits(value: unknown): AgentTvcPromptUnit[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const units = value.map((item) => {
    if (!isRecord(item)) return null;
    const startSecond = readFinite(item.start_second ?? item.startSecond);
    const endSecond = readFinite(item.end_second ?? item.endSecond);
    const rawShotNumbers = item.shot_numbers ?? item.shotNumbers;
    const shotNumbers = Array.isArray(rawShotNumbers)
      ? rawShotNumbers.map((shotNumber) => readString(shotNumber).trim())
      : [];
    const unit = {
      ref: readString(item.ref).trim(),
      startSecond,
      endSecond,
      shotNumbers,
      referenceNodeIds: readNodeIds(
        item.reference_node_ids ?? item.referenceNodeIds,
      ),
      prompt: readString(item.prompt).trim(),
    };
    const validShotNumbers = unit.shotNumbers.every(Boolean);
    return unit.ref && unit.startSecond !== null &&
        Number.isInteger(unit.startSecond) && unit.startSecond >= 0 &&
        unit.endSecond !== null && Number.isInteger(unit.endSecond) &&
        unit.endSecond > unit.startSecond && validShotNumbers &&
        unit.shotNumbers.length &&
        new Set(unit.shotNumbers).size === unit.shotNumbers.length && unit.prompt
      ? {
          ...unit,
          startSecond: unit.startSecond,
          endSecond: unit.endSecond,
          shotNumbers: unit.shotNumbers,
        }
      : null;
  });
  if (units.some((unit) => unit === null)) return null;
  const parsed = units as AgentTvcPromptUnit[];
  return new Set(parsed.map((unit) => unit.ref)).size === parsed.length
    ? parsed
    : null;
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

function parseStoryShots(value: unknown): AgentStoryShot[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
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

function parseOperation(value: unknown): AgentOperation | null {
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

  if (type === "create_tvc_brief") {
    const ref = readString(value.ref).trim();
    const title = readString(value.title).trim();
    const brief = parseTvcBrief(value.brief);
    return ref && title && brief ? { type, ref, title, brief } : null;
  }

  if (type === "update_tvc_brief") {
    const projectId = readString(value.project_id ?? value.projectId).trim();
    const title = readString(value.title).trim();
    const brief = parseTvcBrief(value.brief);
    return projectId && brief
      ? { type, projectId, ...(title ? { title } : {}), brief }
      : null;
  }

  if (type === "create_tvc_asset_plan") {
    const projectId = readString(value.project_id ?? value.projectId).trim();
    const assets = parseTvcAssetPlans(value.assets);
    if (!projectId) throw new Error("create_tvc_asset_plan 缺少 project_id。");
    return { type, projectId, assets };
  }

  if (type === "write_tvc_storyboard_draft") {
    const projectId = readString(value.project_id ?? value.projectId).trim();
    const rows = parseTvcStoryboardRows(value.rows);
    return projectId && rows ? { type, projectId, rows } : null;
  }

  if (type === "create_tvc_prompt_package") {
    const projectId = readString(value.project_id ?? value.projectId).trim();
    const sourceRevision = readFinite(
      value.source_revision ?? value.sourceRevision,
    );
    const units = parseTvcPromptUnits(value.units);
    return projectId && sourceRevision !== null &&
        Number.isInteger(sourceRevision) && sourceRevision >= 0 && units
      ? { type, projectId, sourceRevision, units }
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

function extractSingleCompleteJsonObject(raw: string): string | null {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (depth === 0) {
      if (character === "{") {
        start = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        candidates.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return depth === 0 && candidates.length === 1 ? candidates[0] : null;
}

function parseAgentResponseJson(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    const embeddedJson = extractSingleCompleteJsonObject(raw);
    if (!embeddedJson) {
      throw new Error("Agent 返回了无法识别的操作格式。");
    }
    try {
      return JSON.parse(embeddedJson);
    } catch {
      throw new Error("Agent 返回了无法识别的操作格式。");
    }
  }
}

export function parseAgentModelResponse(raw: string): AgentResponse {
  const value = parseAgentResponseJson(raw);
  if (!isRecord(value)) throw new Error("Agent 返回了无法识别的操作格式。");
  const message = readString(value.message).trim();
  if (!message) throw new Error("Agent 未返回可显示的回复。");
  const workflowState = readString(
    value.workflow_state ?? value.workflowState,
  );
  if (workflowState !== "clarifying" && workflowState !== "active") {
    throw new Error("Agent 未返回有效的工作流状态。");
  }
  const rawOperations = Array.isArray(value.operations) ? value.operations : [];
  const operations = rawOperations.map(parseOperation);
  if (operations.some((operation) => operation === null)) {
    throw new Error("Agent 返回了不受支持的画布操作。");
  }
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
    operations: operations as AgentOperation[],
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

export function isTvcAgentOperation(
  operation: AgentOperation,
): operation is Extract<
  AgentOperation,
  {
    type:
      | "create_tvc_brief"
      | "update_tvc_brief"
      | "create_tvc_asset_plan"
      | "write_tvc_storyboard_draft"
      | "create_tvc_prompt_package";
  }
> {
  return operation.type === "create_tvc_brief" ||
    operation.type === "update_tvc_brief" ||
    operation.type === "create_tvc_asset_plan" ||
    operation.type === "write_tvc_storyboard_draft" ||
    operation.type === "create_tvc_prompt_package";
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
      operation.type === "create_story_workflow" ||
      operation.type === "run_story_workflow",
  );
  const tvcOperations = operations.filter(isTvcAgentOperation);
  const workflowOperations = [...storyOperations, ...tvcOperations];
  if (mode === "creation" && workflowOperations.length) {
    throw new Error("工作流操作不能在创作画布执行。");
  }
  if (mode === "workflow" && workflowOperations.length !== operations.length) {
    throw new Error("普通创作画布操作不能在工作流画布执行。");
  }
  if (storyOperations.length && tvcOperations.length) {
    throw new Error("TVC 操作不能与短剧工作流操作混用。");
  }
  if (
    operations.some((operation) =>
      operation.type === "create_story_analysis" ||
      operation.type === "create_story_asset_batch" ||
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
