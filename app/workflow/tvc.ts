import type {
  WorkflowGraph,
  WorkflowNode,
  WorkflowResultNode,
  WorkflowSchedulerNode,
  WorkflowSourceNode,
  TvcVideoManualOverride,
} from "./graph.ts";

type IdFactory = () => string;

const WORKFLOW_NODE_WIDTH = 288;
const COLUMN_STEP = WORKFLOW_NODE_WIDTH + 120;
const ROW_STEP = 440;

export const TVC_VIDEO_MODEL = "doubao-seedance-2-5-quannengcankao";
export const TVC_VIDEO_MODEL_LABEL = "SD 2.5 全能参考";
export const TVC_VIDEO_RESOLUTION = "720p";
export const TVC_VIDEO_MIN_DURATION = 4;
export const TVC_VIDEO_MAX_DURATION = 30;
export const TVC_VIDEO_MAX_REFERENCE_IMAGES = 30;
export const TVC_LOGO_DEFAULT_DURATION = 4;
export const TVC_LOGO_IMAGE_MIME_TYPES = [
  "image/png",
  "image/webp",
  "image/jpeg",
] as const;
export const TVC_LOGO_PLACEMENTS = ["opening", "closing", "standalone"] as const;
export const TVC_NARRATION_OPTIONS = ["include", "omit"] as const;

const TVC_VIDEO_HISTORICAL_ERROR = "锁稿已更新，历史视频结果仅保留查看，不能再次运行。";

export const TVC_REFERENCE_ROLES = [
  "character-identity",
  "character-anatomy",
  "scene-geometry",
  "lighting-color",
  "wardrobe",
  "prop-product",
  "first-frame",
  "last-frame",
] as const;

export type TvcReferenceRole = (typeof TVC_REFERENCE_ROLES)[number];
export type TvcLogoPlacement = (typeof TVC_LOGO_PLACEMENTS)[number];
export type TvcNarrationOption = (typeof TVC_NARRATION_OPTIONS)[number];
export type TvcPhase =
  | "intake"
  | "script-draft"
  | "script-locked"
  | "prompt-final";

export type TvcReferenceMapping = {
  nodeId: string;
  roles: TvcReferenceRole[];
  note: string;
};

export type TvcLogoConfig = {
  nodeId: string;
  placement: TvcLogoPlacement;
  durationSeconds: number;
};

export type TvcPromptOptions = {
  narration: TvcNarrationOption;
};

export type TvcLogoSourceInput = {
  assetId: string;
  assetName: string;
  assetMimeType: (typeof TVC_LOGO_IMAGE_MIME_TYPES)[number];
  text?: string;
};

export type TvcBrief = {
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
  referenceMap: TvcReferenceMapping[];
};

export type TvcAssetPlan = {
  ref: string;
  name: string;
  kind: "character" | "scene" | "prop";
  description: string;
  reason: string;
  imagePrompt: string;
};

export type TvcStoryboardDraftRow = {
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
  dialogue?: string;
  sound: string;
  transition: string;
  constraints: string;
  referenceNodeIds: string[];
  kind?: "logo-animation";
};

export type TvcStoryboardTableDraftRow = Omit<
  TvcStoryboardDraftRow,
  "startSecond" | "endSecond"
>;

export type TvcStoryboardRow = Omit<TvcStoryboardDraftRow, "startSecond" | "endSecond"> & {
  timecode: string;
};

export type TvcStoryboard = {
  title: string;
  targetDurationSeconds: number;
  validationStatus: string;
  rows: TvcStoryboardRow[];
};

export type TvcPromptUnit = {
  ref: string;
  startSecond: number;
  endSecond: number;
  shotNumbers: string[];
  referenceNodeIds: string[];
  prompt: string;
};

export type TvcPromptPlanSegment = Omit<TvcPromptUnit, "prompt">;

export type TvcPromptPlanBoundary = {
  startSecond: number;
  endSecond: number;
};

export type TvcStandaloneLogoUnit = {
  ref: "logo-animation";
  durationSeconds: number;
  referenceNodeIds: string[];
  prompt: string;
};

export type TvcWorkflowState = {
  projectId: string;
  phase: TvcPhase;
  title: string;
  revision: number;
  brief?: TvcBrief;
  logo?: TvcLogoConfig;
  promptOptions?: TvcPromptOptions;
  storyboard?: TvcStoryboard;
  lockedAt?: number;
  lockedRevision?: number;
  promptPlan?: TvcPromptPlanSegment[];
  promptUnits?: TvcPromptUnit[];
  standaloneLogoUnit?: TvcStandaloneLogoUnit;
  promptSourceRevision?: number;
};

export type TvcCreateBriefOperation = {
  type: "create_tvc_brief";
  ref: string;
  title: string;
  brief: TvcBrief;
  adjustments?: string[];
};

export type TvcUpdateBriefOperation = {
  type: "update_tvc_brief";
  projectId: string;
  title?: string;
  brief: TvcBrief;
  adjustments?: string[];
};

export type TvcCreateAssetPlanOperation = {
  type: "create_tvc_asset_plan";
  projectId: string;
  assets: TvcAssetPlan[];
  adjustments?: string[];
};

export type TvcWriteStoryboardDraftOperation = {
  type: "write_tvc_storyboard_draft";
  projectId: string;
  rows: TvcStoryboardDraftRow[];
  adjustments?: string[];
};

export type TvcCreatePromptPackageOperation = {
  type: "create_tvc_prompt_package";
  projectId: string;
  sourceRevision: number;
  units: TvcPromptUnit[];
  standaloneLogoUnit?: TvcStandaloneLogoUnit;
  adjustments?: string[];
};

export type TvcOperation =
  | TvcCreateBriefOperation
  | TvcUpdateBriefOperation
  | TvcCreateAssetPlanOperation
  | TvcWriteStoryboardDraftOperation
  | TvcCreatePromptPackageOperation;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isReferenceRole(value: unknown): value is TvcReferenceRole {
  return typeof value === "string" && (TVC_REFERENCE_ROLES as readonly string[]).includes(value);
}

function isTvcLogoPlacement(value: unknown): value is TvcLogoPlacement {
  return typeof value === "string" && (TVC_LOGO_PLACEMENTS as readonly string[]).includes(value);
}

function isTvcNarrationOption(value: unknown): value is TvcNarrationOption {
  return typeof value === "string" && (TVC_NARRATION_OPTIONS as readonly string[]).includes(value);
}

function isTvcLogoConfig(value: unknown): value is TvcLogoConfig {
  return isRecord(value) &&
    isNonEmptyString(value.nodeId) &&
    isTvcLogoPlacement(value.placement) &&
    isFinitePositiveInteger(value.durationSeconds) &&
    value.durationSeconds >= TVC_VIDEO_MIN_DURATION &&
    value.durationSeconds <= TVC_VIDEO_MAX_DURATION;
}

function isTvcPromptOptions(value: unknown): value is TvcPromptOptions {
  return isRecord(value) && isTvcNarrationOption(value.narration);
}

function isTvcStandaloneLogoUnit(value: unknown): value is TvcStandaloneLogoUnit {
  return isRecord(value) &&
    value.ref === "logo-animation" &&
    isFinitePositiveInteger(value.durationSeconds) &&
    value.durationSeconds >= TVC_VIDEO_MIN_DURATION &&
    value.durationSeconds <= TVC_VIDEO_MAX_DURATION &&
    Array.isArray(value.referenceNodeIds) &&
    value.referenceNodeIds.length > 0 &&
    value.referenceNodeIds.every(isNonEmptyString) &&
    new Set(value.referenceNodeIds).size === value.referenceNodeIds.length &&
    isNonEmptyString(value.prompt);
}

function isReferenceMapping(value: unknown): value is TvcReferenceMapping {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.nodeId) &&
    Array.isArray(value.roles) &&
    value.roles.length > 0 &&
    value.roles.every(isReferenceRole) &&
    new Set(value.roles).size === value.roles.length &&
    typeof value.note === "string";
}

export function isTvcBrief(value: unknown): value is TvcBrief {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.goal) &&
    isNonEmptyString(value.audience) &&
    isFinitePositiveInteger(value.targetDuration) &&
    isNonEmptyString(value.aspectRatio) &&
    isNonEmptyString(value.platform) &&
    isFinitePositiveInteger(value.maxDuration) &&
    isNonEmptyString(value.style) &&
    isNonEmptyString(value.narrativeMode) &&
    isNonEmptyString(value.audioPolicy) &&
    typeof value.copy === "string" &&
    Array.isArray(value.referenceMap) &&
    value.referenceMap.every(isReferenceMapping) &&
    new Set(value.referenceMap.map((item) => item.nodeId)).size === value.referenceMap.length;
}

function isStoryboardRow(value: unknown): value is TvcStoryboardRow {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.shotNumber) &&
    isNonEmptyString(value.timecode) &&
    isFinitePositiveInteger(value.durationSeconds) &&
    Array.isArray(value.referenceNodeIds) &&
    value.referenceNodeIds.every(isNonEmptyString) &&
    new Set(value.referenceNodeIds).size === value.referenceNodeIds.length &&
    (value.dialogue === undefined || typeof value.dialogue === "string") &&
    (value.kind === undefined || value.kind === "logo-animation") &&
    [
      value.referenceScene,
      value.sceneTime,
      value.shotSizeLens,
      value.camera,
      value.composition,
      value.performance,
      value.narration,
      value.sound,
      value.transition,
      value.constraints,
    ].every(isNonEmptyString);
}

function isStoryboard(value: unknown): value is TvcStoryboard {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.title) &&
    isFinitePositiveInteger(value.targetDurationSeconds) &&
    typeof value.validationStatus === "string" &&
    Array.isArray(value.rows) &&
    value.rows.length > 0 &&
    value.rows.every(isStoryboardRow) &&
    new Set(value.rows.map((row) => row.shotNumber)).size === value.rows.length;
}

function isPromptUnit(value: unknown): value is TvcPromptUnit {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.ref) &&
    typeof value.startSecond === "number" && Number.isInteger(value.startSecond) && value.startSecond >= 0 &&
    isFinitePositiveInteger(value.endSecond) &&
    value.endSecond > value.startSecond &&
    Array.isArray(value.shotNumbers) && value.shotNumbers.length > 0 && value.shotNumbers.every(isNonEmptyString) &&
    new Set(value.shotNumbers).size === value.shotNumbers.length &&
    Array.isArray(value.referenceNodeIds) && value.referenceNodeIds.every(isNonEmptyString) &&
    new Set(value.referenceNodeIds).size === value.referenceNodeIds.length &&
    isNonEmptyString(value.prompt);
}

function isPromptPlanSegment(value: unknown): value is TvcPromptPlanSegment {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.ref) &&
    typeof value.startSecond === "number" && Number.isInteger(value.startSecond) && value.startSecond >= 0 &&
    isFinitePositiveInteger(value.endSecond) &&
    value.endSecond > value.startSecond &&
    Array.isArray(value.shotNumbers) && value.shotNumbers.length > 0 && value.shotNumbers.every(isNonEmptyString) &&
    new Set(value.shotNumbers).size === value.shotNumbers.length &&
    Array.isArray(value.referenceNodeIds) && value.referenceNodeIds.every(isNonEmptyString) &&
    new Set(value.referenceNodeIds).size === value.referenceNodeIds.length;
}

export function isTvcWorkflowState(value: unknown): value is TvcWorkflowState {
  if (!isRecord(value)) return false;
  const phase = value.phase;
  if (
    !isNonEmptyString(value.projectId) ||
    !["intake", "script-draft", "script-locked", "prompt-final"].includes(String(phase)) ||
    typeof value.title !== "string" ||
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision) ||
    value.revision < 0 ||
    (value.brief !== undefined && !isTvcBrief(value.brief)) ||
    (value.logo !== undefined && !isTvcLogoConfig(value.logo)) ||
    (value.promptOptions !== undefined && !isTvcPromptOptions(value.promptOptions)) ||
    (value.storyboard !== undefined && !isStoryboard(value.storyboard)) ||
    (value.lockedAt !== undefined && (typeof value.lockedAt !== "number" || !Number.isFinite(value.lockedAt))) ||
    (value.lockedRevision !== undefined &&
      (typeof value.lockedRevision !== "number" ||
        !Number.isInteger(value.lockedRevision) ||
        value.lockedRevision < 0)) ||
    (value.promptPlan !== undefined &&
      (!Array.isArray(value.promptPlan) || !value.promptPlan.every(isPromptPlanSegment))) ||
    (value.promptUnits !== undefined && (!Array.isArray(value.promptUnits) || !value.promptUnits.every(isPromptUnit))) ||
    (value.standaloneLogoUnit !== undefined && !isTvcStandaloneLogoUnit(value.standaloneLogoUnit)) ||
    (value.promptSourceRevision !== undefined &&
      (typeof value.promptSourceRevision !== "number" ||
        !Number.isInteger(value.promptSourceRevision) ||
        value.promptSourceRevision < 0))
  ) {
    return false;
  }
  if (phase !== "intake" && !value.brief) return false;
  if (
    (phase === "script-locked" || phase === "prompt-final") &&
    !value.storyboard
  ) return false;
  if (phase === "script-locked" && (value.lockedAt === undefined || value.lockedRevision === undefined)) return false;
  if (phase === "prompt-final" && (
    value.lockedAt === undefined ||
    value.lockedRevision === undefined ||
    value.promptSourceRevision === undefined ||
    !Array.isArray(value.promptUnits) ||
    value.promptUnits.length === 0
  )) return false;
  return true;
}

export function emptyTvcWorkflowGraph(
  idFactory: IdFactory = () => crypto.randomUUID(),
): WorkflowGraph {
  return {
    version: 1,
    nodes: [],
    edges: [],
    tvc: {
      projectId: idFactory(),
      phase: "intake",
      title: "",
      revision: 0,
    },
  };
}

export function isTvcProject(graph: WorkflowGraph) {
  return Boolean(graph.tvc);
}

export function readTvcProject(graph: WorkflowGraph): TvcWorkflowState | null {
  return graph.tvc ?? null;
}

export function tvcAgentSummary(graph: WorkflowGraph) {
  const project = readTvcProject(graph);
  if (!project) return undefined;
  return {
    projectId: project.projectId,
    stage: project.phase,
    revision: project.revision,
    ...(project.lockedRevision !== undefined
      ? { lockedRevision: project.lockedRevision }
      : {}),
    ...(project.promptPlan?.length ? { promptPlan: project.promptPlan } : {}),
    ...(project.logo ? { logo: project.logo } : {}),
    ...(project.promptOptions ? { promptOptions: project.promptOptions } : {}),
    ...(project.standaloneLogoUnit ? { standaloneLogoUnit: project.standaloneLogoUnit } : {}),
    ...(project.title ? { title: project.title } : {}),
    ...(project.brief?.platform ? { targetModel: project.brief.platform } : {}),
    ...(project.brief?.maxDuration ? { targetMaxDuration: project.brief.maxDuration } : {}),
  };
}

function assertTvcProject(graph: WorkflowGraph) {
  if (!graph.tvc) throw new Error("当前项目不是 TVC 工作流。");
  return graph.tvc;
}

function assertProjectId(graph: WorkflowGraph, projectId: string) {
  const project = assertTvcProject(graph);
  if (project.projectId !== projectId) throw new Error("TVC 项目标识不匹配。");
  return project;
}

function nodeName(node: WorkflowNode) {
  return node.label ||
    (node.type === "source" && node.assetName) ||
    (node.type === "result" && node.assetName) ||
    (node.type === "source" ? `${node.kind} 素材` : node.type === "result" ? `${node.kind} 结果` : "调度器");
}

function isUsableImageReference(node: WorkflowNode | undefined) {
  return Boolean(
    node &&
    node.type !== "scheduler" &&
    node.kind === "image" &&
    ((node.type === "source" && node.assetId) ||
      (node.type === "result" && node.status === "success" && (node.assetId || node.resultUrl))),
  );
}

function isTvcLogoMimeType(value: unknown): value is (typeof TVC_LOGO_IMAGE_MIME_TYPES)[number] {
  return typeof value === "string" &&
    (TVC_LOGO_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function isTvcLogoSource(
  node: WorkflowNode | undefined,
  projectId?: string,
): node is WorkflowSourceNode {
  return Boolean(
    node &&
      node.type === "source" &&
      node.kind === "image" &&
      node.storyRole === "tvc-logo" &&
      node.assetId &&
      isTvcLogoMimeType(node.assetMimeType) &&
      (projectId === undefined || node.tvcProjectId === projectId),
  );
}

function isUsableBriefReference(node: WorkflowNode | undefined) {
  return Boolean(
    (node?.type === "source" && node.kind === "text" && node.text.trim()) ||
    isUsableImageReference(node),
  );
}

function assertImageReferences(
  graph: WorkflowGraph,
  nodeIds: readonly string[],
  label: string,
) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const nodeId of nodeIds) {
    if (!isUsableImageReference(nodes.get(nodeId))) {
      throw new Error(`${label}引用了不可用的图片节点 ${nodeId}。`);
    }
  }
}

function assertBriefReferences(graph: WorkflowGraph, brief: TvcBrief) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const item of brief.referenceMap) {
    if (!isUsableBriefReference(nodes.get(item.nodeId))) {
      throw new Error(`TVC 参考资料引用了不可用的节点 ${item.nodeId}。`);
    }
  }
}

function formatTime(second: number) {
  const minute = Math.floor(second / 60);
  const rest = second % 60;
  return `${String(minute).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function rightAppendOrigin(graph: WorkflowGraph) {
  const right = graph.nodes.reduce((maximum, node) => {
    return Math.max(maximum, node.x + (node.width ?? WORKFLOW_NODE_WIDTH));
  }, -160);
  return {
    x: right + 160,
    y: graph.nodes.length ? Math.min(...graph.nodes.map((node) => node.y)) : 0,
  };
}

function tvcNode(graph: WorkflowGraph, role: WorkflowNode["storyRole"], projectId: string) {
  return graph.nodes.find((node) => node.storyRole === role && node.tvcProjectId === projectId);
}

function addOrUpdateTvcNode(
  graph: WorkflowGraph,
  role: NonNullable<WorkflowNode["storyRole"]>,
  projectId: string,
  label: string,
  text: string,
  idFactory: IdFactory,
  size?: { width: number; height: number },
) {
  const existing = tvcNode(graph, role, projectId);
  if (existing && existing.type === "source") {
    return {
      graph: {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === existing.id ? { ...node, label, text, ...(size ?? {}) } : node,
        ) as WorkflowNode[],
      },
      nodeId: existing.id,
    };
  }
  const origin = rightAppendOrigin(graph);
  const node: WorkflowNode = {
    id: idFactory(),
    x: origin.x,
    y: origin.y,
    type: "source",
    kind: "text",
    text,
    label,
    tvcProjectId: projectId,
    storyRole: role,
    ...(size ?? {}),
  };
  return {
    graph: { ...graph, nodes: [...graph.nodes, node] },
    nodeId: node.id,
  };
}

function connectIfMissing(
  graph: WorkflowGraph,
  sourceId: string,
  targetId: string,
  idFactory: IdFactory,
) {
  if (graph.edges.some((edge) => edge.sourceId === sourceId && edge.targetId === targetId)) {
    return graph;
  }
  return {
    ...graph,
    edges: [...graph.edges, { id: idFactory(), sourceId, targetId }],
  };
}

function tvcVideoResultsForScheduler(graph: WorkflowGraph, schedulerId: string) {
  return graph.nodes.filter(
    (node): node is WorkflowResultNode =>
      node.type === "result" &&
      (node.storyRole === "tvc-video-result" || node.storyRole === "tvc-logo-video-result") &&
      node.schedulerId === schedulerId,
  );
}

function tvcVideoHasSubmissionEvidence(node: WorkflowResultNode) {
  return Boolean(
    node.taskId ||
      node.startedAt !== undefined ||
      node.status === "pending" ||
      node.status === "running" ||
      node.status === "success" ||
      node.status === "failed" ||
      node.status === "submission-unknown",
  );
}

export function isTvcVideoReference(
  node: WorkflowNode | undefined,
  projectId: string,
) {
  return Boolean(
    node &&
      (
        (node.type === "result" &&
          node.kind === "image" &&
          node.status === "success" &&
          node.tvcProjectId === projectId &&
          (node.assetId || node.resultUrl)) ||
        isTvcLogoSource(node, projectId)
      ),
  );
}

export function isTvcVideoSchedulerNode(
  node: WorkflowNode | undefined,
): node is WorkflowSchedulerNode & {
  storyRole: "tvc-video-scheduler" | "tvc-logo-video-scheduler";
} {
  return node !== undefined && node.type === "scheduler" &&
    (node.storyRole === "tvc-video-scheduler" || node.storyRole === "tvc-logo-video-scheduler");
}

export function isTvcVideoResultNode(
  node: WorkflowNode | undefined,
): node is WorkflowResultNode & {
  storyRole: "tvc-video-result" | "tvc-logo-video-result";
} {
  return node !== undefined && node.type === "result" &&
    (node.storyRole === "tvc-video-result" || node.storyRole === "tvc-logo-video-result");
}

export function isTvcVideoSchedulerReference(
  graph: WorkflowGraph,
  scheduler: WorkflowNode | undefined,
  source: WorkflowNode | undefined,
) {
  const projectId = scheduler?.tvcProjectId;
  return Boolean(
    graph.tvc &&
      isTvcVideoSchedulerNode(scheduler) &&
      projectId &&
      projectId === graph.tvc.projectId &&
      isTvcVideoReference(source, projectId),
  );
}

function tvcVideoUnitError(
  graph: WorkflowGraph,
  project: TvcWorkflowState,
  unit: TvcPromptUnit,
) {
  const duration = unit.endSecond - unit.startSecond;
  if (duration < TVC_VIDEO_MIN_DURATION || duration > TVC_VIDEO_MAX_DURATION) {
    return `TVC 提示词单元 ${unit.ref} 时长必须为 ${TVC_VIDEO_MIN_DURATION}–${TVC_VIDEO_MAX_DURATION} 秒。`;
  }
  if (unit.referenceNodeIds.length > TVC_VIDEO_MAX_REFERENCE_IMAGES) {
    return `TVC 提示词单元 ${unit.ref} 最多只能引用 ${TVC_VIDEO_MAX_REFERENCE_IMAGES} 张图片。`;
  }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const invalidNodeId = unit.referenceNodeIds.find((nodeId) =>
    !isTvcVideoReference(nodes.get(nodeId), project.projectId)
  );
  if (invalidNodeId) {
    return `TVC 提示词单元 ${unit.ref} 引用了不可用的成功图片资产 ${invalidNodeId}。`;
  }
  return null;
}

function tvcStandaloneLogoUnitError(
  graph: WorkflowGraph,
  project: TvcWorkflowState,
  unit: TvcStandaloneLogoUnit | undefined,
) {
  const logo = project.logo;
  if (!logo || logo.placement !== "standalone" || !unit) {
    return "独立品牌 Logo 动效缺少已确认的 Logo 配置或最终提示词。";
  }
  if (!isTvcStandaloneLogoUnit(unit) || unit.durationSeconds !== logo.durationSeconds) {
    return "独立品牌 Logo 动效的时长无效。";
  }
  if (unit.referenceNodeIds.length !== 1 || unit.referenceNodeIds[0] !== logo.nodeId) {
    return "独立品牌 Logo 动效只能按顺序引用当前品牌 Logo。";
  }
  if (/\b[JL][ -]?cut\b/i.test(unit.prompt)) {
    return "独立品牌 Logo 动效不能使用 J-cut 或 L-cut。";
  }
  const node = graph.nodes.find((candidate) => candidate.id === logo.nodeId);
  if (!isTvcLogoSource(node, project.projectId)) {
    return "独立品牌 Logo 动效引用了不可用的项目 Logo。";
  }
  return null;
}

function promptUnitMatchesPlan(
  project: TvcWorkflowState,
  unit: TvcPromptUnit,
) {
  const segment = project.promptPlan?.find((item) => item.ref === unit.ref);
  return Boolean(
    segment &&
      unit.startSecond === segment.startSecond &&
      unit.endSecond === segment.endSecond &&
      unit.shotNumbers.join("\u0000") === segment.shotNumbers.join("\u0000") &&
      unit.referenceNodeIds.join("\u0000") === segment.referenceNodeIds.join("\u0000"),
  );
}

function promptUnitsMatchPlan(project: TvcWorkflowState) {
  const units = project.promptUnits;
  const plan = project.promptPlan;
  return Boolean(
    units?.length &&
      plan?.length &&
      units.length === plan.length &&
      units.every((unit, index) => unit.ref === plan[index]?.ref && promptUnitMatchesPlan(project, unit)),
  );
}

function schedulerTimelineRows(
  project: TvcWorkflowState,
  unit: TvcPromptUnit,
) {
  const rows = project.storyboard?.rows.filter((row) => unit.shotNumbers.includes(row.shotNumber)) ?? [];
  if (rows.length !== unit.shotNumbers.length ||
      rows.some((row, index) => row.shotNumber !== unit.shotNumbers[index])) {
    return [];
  }
  return rows;
}

function tvcVideoSchedulerPrompt(
  project: TvcWorkflowState,
  unit: TvcPromptUnit,
) {
  const duration = unit.endSecond - unit.startSecond;
  const includeNarration = project.promptOptions?.narration !== "omit";
  let second = 0;
  const timeline = schedulerTimelineRows(project, unit).map((row) => {
    const startSecond = second;
    second += row.durationSeconds;
    return [
      `【${formatTime(startSecond)}–${formatTime(second)}｜镜头 ${row.shotNumber}】`,
      `参考：${row.referenceScene}。`,
      `${row.sceneTime}。${row.shotSizeLens}，${row.camera}。`,
      `${row.composition} ${row.performance}`,
      ...(includeNarration ? [`旁白：${row.narration}`] : []),
      `对白：${row.dialogue?.trim() || "无"}`,
      `声音：${row.sound}`,
      `切点：${row.transition}`,
      `连续性与生成限制：${row.constraints}`,
    ].join(" ");
  });
  return [
    `本视频片段仅生成 0 至 ${duration} 秒内的画面与动作。`,
    `全片位置：${formatTime(unit.startSecond)}–${formatTime(unit.endSecond)}；覆盖镜头：${unit.shotNumbers.join("、")}。`,
    "本地时间轴：",
    ...timeline,
    "最终提示词：",
    unit.prompt.trim(),
  ].join("\n");
}

function videoSchedulerLabel(unit: TvcPromptUnit) {
  return `${unit.ref} · 最终提示词调度`;
}

function videoResultLabel(unit: TvcPromptUnit) {
  return `${unit.ref} · 视频结果占位`;
}

function tvcStandaloneLogoSchedulerPrompt(unit: TvcStandaloneLogoUnit) {
  return [
    `本视频片段仅生成 0 至 ${unit.durationSeconds} 秒内的品牌 Logo 动效。`,
    "严格参考输入的品牌 Logo 形状、配色和比例；以原创简洁的光影与镜头运动呈现，不生成字幕、水印或额外可读文字。",
    "最终提示词：",
    unit.prompt.trim(),
  ].join("\n");
}

function standaloneLogoPromptText(unit: TvcStandaloneLogoUnit) {
  return `【品牌 Logo 动效｜${unit.durationSeconds} 秒】\n${unit.prompt}`;
}

function standaloneLogoSchedulerLabel() {
  return "品牌 Logo · 最终提示词调度";
}

function standaloneLogoResultLabel() {
  return "品牌 Logo · 视频结果占位";
}

function matchesTvcStandaloneLogoSchedulerContext(
  node: WorkflowNode,
  project: TvcWorkflowState,
  unit: TvcStandaloneLogoUnit,
) {
  return node.type === "scheduler" &&
    node.storyRole === "tvc-logo-video-scheduler" &&
    node.outputKind === "video" &&
    node.model === TVC_VIDEO_MODEL &&
    node.prompt === tvcStandaloneLogoSchedulerPrompt(unit) &&
    node.aspectRatio === project.brief?.aspectRatio &&
    node.resolution === TVC_VIDEO_RESOLUTION &&
    node.duration === String(unit.durationSeconds) &&
    node.outputCount === 1 &&
    node.label === standaloneLogoSchedulerLabel() &&
    node.tvcProjectId === project.projectId &&
    node.tvcUnitRef === unit.ref &&
    node.tvcPromptRevision === project.promptSourceRevision &&
    node.tvcVideoManualOverride === undefined &&
    node.tvcVideoHistorical !== true;
}

function isSameTvcStandaloneLogoResult(
  node: WorkflowNode | undefined,
  schedulerId: string,
  project: TvcWorkflowState,
  unit: TvcStandaloneLogoUnit,
) {
  return node?.type === "result" &&
    node.kind === "video" &&
    node.schedulerId === schedulerId &&
    node.text === standaloneLogoResultLabel() &&
    node.model === TVC_VIDEO_MODEL &&
    node.status === "ready" &&
    node.progress === "待生成" &&
    node.error === "" &&
    node.label === standaloneLogoResultLabel() &&
    node.tvcProjectId === project.projectId &&
    node.tvcUnitRef === unit.ref &&
    node.tvcPromptRevision === project.promptSourceRevision &&
    node.tvcVideoHistorical !== true &&
    node.storyRole === "tvc-logo-video-result";
}

function currentTvcVideoUnit(
  project: TvcWorkflowState,
  node: WorkflowSchedulerNode,
) {
  if (
    project.phase !== "prompt-final" ||
    project.promptSourceRevision === undefined ||
    node.tvcProjectId !== project.projectId ||
    node.tvcPromptRevision !== project.promptSourceRevision
  ) {
    return null;
  }
  const unit = project.promptUnits?.find((item) => item.ref === node.tvcUnitRef);
  return unit && promptUnitMatchesPlan(project, unit) ? unit : null;
}

function currentTvcStandaloneLogoUnit(
  project: TvcWorkflowState,
  node: WorkflowSchedulerNode,
) {
  const unit = project.standaloneLogoUnit;
  if (
    unit &&
    project.phase === "prompt-final" &&
    project.promptSourceRevision !== undefined &&
    project.logo?.placement === "standalone" &&
    node.tvcProjectId === project.projectId &&
    node.tvcPromptRevision === project.promptSourceRevision &&
    node.tvcUnitRef === unit.ref
  ) {
    return unit;
  }
  return null;
}

export function isTvcVideoManualOverride(
  node: WorkflowNode,
): node is WorkflowSchedulerNode & { tvcVideoManualOverride: TvcVideoManualOverride } {
  return node.type === "scheduler" &&
    (node.storyRole === "tvc-video-scheduler" || node.storyRole === "tvc-logo-video-scheduler") &&
    node.tvcVideoManualOverride !== undefined;
}

export function markTvcVideoSchedulerManualOverride(
  graph: WorkflowGraph,
  schedulerId: string,
) {
  const scheduler = graph.nodes.find(
    (node): node is WorkflowSchedulerNode =>
      node.id === schedulerId && node.type === "scheduler",
  );
  const project = graph.tvc;
  if (
    !scheduler ||
    !project ||
    (scheduler.storyRole !== "tvc-video-scheduler" && scheduler.storyRole !== "tvc-logo-video-scheduler") ||
    scheduler.outputKind !== "video" ||
    scheduler.tvcVideoHistorical === true ||
    scheduler.tvcVideoManualOverride
  ) {
    return graph;
  }
  const unit = scheduler.storyRole === "tvc-logo-video-scheduler"
    ? currentTvcStandaloneLogoUnit(project, scheduler)
    : currentTvcVideoUnit(project, scheduler);
  if (!unit) return graph;
  const override: TvcVideoManualOverride = {
    sourceRevision: project.promptSourceRevision!,
    sourceUnitRef: unit.ref,
    sourceStartSecond: "durationSeconds" in unit ? 0 : unit.startSecond,
    sourceEndSecond: "durationSeconds" in unit ? unit.durationSeconds : unit.endSecond,
    sourcePrompt: "durationSeconds" in unit
      ? tvcStandaloneLogoSchedulerPrompt(unit)
      : tvcVideoSchedulerPrompt(project, unit),
  };
  return {
    ...graph,
    nodes: graph.nodes.map((node) => node.id === schedulerId
      ? { ...node, tvcVideoManualOverride: override }
      : node),
  };
}

function matchesTvcVideoSchedulerContext(
  node: WorkflowNode,
  unit: TvcPromptUnit,
  project: TvcWorkflowState,
) {
  return node.type === "scheduler" &&
    node.storyRole === "tvc-video-scheduler" &&
    node.outputKind === "video" &&
    node.model === TVC_VIDEO_MODEL &&
    node.prompt === tvcVideoSchedulerPrompt(project, unit) &&
    node.aspectRatio === project.brief?.aspectRatio &&
    node.resolution === TVC_VIDEO_RESOLUTION &&
    node.duration === String(unit.endSecond - unit.startSecond) &&
    node.outputCount === 1 &&
    node.label === videoSchedulerLabel(unit) &&
    node.tvcProjectId === project.projectId &&
    node.tvcUnitRef === unit.ref &&
    node.tvcPromptRevision === project.promptSourceRevision &&
    node.tvcVideoManualOverride === undefined &&
    node.tvcVideoHistorical !== true;
}

function isSameTvcVideoScheduler(
  node: WorkflowNode,
  unit: TvcPromptUnit,
  project: TvcWorkflowState,
) {
  return node.type === "scheduler" &&
    matchesTvcVideoSchedulerContext(node, unit, project) &&
    node.error === "";
}

function isSameTvcVideoResult(
  node: WorkflowNode | undefined,
  schedulerId: string,
  unit: TvcPromptUnit,
  project: TvcWorkflowState,
) {
  return node?.type === "result" &&
    node.kind === "video" &&
    node.schedulerId === schedulerId &&
    node.text === videoResultLabel(unit) &&
    node.model === TVC_VIDEO_MODEL &&
    node.status === "ready" &&
    node.progress === "待生成" &&
    node.error === "" &&
    node.label === videoResultLabel(unit) &&
    node.tvcProjectId === project.projectId &&
    node.tvcUnitRef === unit.ref &&
    node.tvcPromptRevision === project.promptSourceRevision &&
    node.tvcVideoHistorical !== true;
}

function removeOrArchiveTvcVideoSchedulers(
  graph: WorkflowGraph,
  projectId: string,
  isCurrent: (node: WorkflowNode) => boolean,
  role: "tvc-video-scheduler" | "tvc-logo-video-scheduler" = "tvc-video-scheduler",
) {
  const removeIds = new Set<string>();
  const archivedIds = new Set<string>();
  for (const scheduler of graph.nodes) {
    if (
      scheduler.type !== "scheduler" ||
      scheduler.storyRole !== role ||
      scheduler.tvcProjectId !== projectId ||
      isCurrent(scheduler)
    ) {
      continue;
    }
    const results = tvcVideoResultsForScheduler(graph, scheduler.id);
    if (
      isTvcVideoManualOverride(scheduler) ||
      results.some(tvcVideoHasSubmissionEvidence)
    ) {
      archivedIds.add(scheduler.id);
      results.forEach((result) => archivedIds.add(result.id));
    } else {
      removeIds.add(scheduler.id);
      results.forEach((result) => removeIds.add(result.id));
    }
  }
  if (!removeIds.size && !archivedIds.size) return graph;
  return {
    ...graph,
    nodes: graph.nodes
      .filter((node) => !removeIds.has(node.id))
      .map((node) => {
        if (!archivedIds.has(node.id)) return node;
        if (node.type === "scheduler") {
          return {
            ...node,
            tvcVideoHistorical: true,
            error: TVC_VIDEO_HISTORICAL_ERROR,
          };
        }
        return { ...node, tvcVideoHistorical: true };
      }),
    edges: graph.edges.filter(
      (edge) => !removeIds.has(edge.sourceId) && !removeIds.has(edge.targetId),
    ),
  };
}

function removeTvcPromptArtifacts(graph: WorkflowGraph, projectId: string) {
  const withoutMainVideos = removeOrArchiveTvcVideoSchedulers(
    graph,
    projectId,
    () => false,
  );
  const withoutVideos = removeOrArchiveTvcVideoSchedulers(
    withoutMainVideos,
    projectId,
    () => false,
    "tvc-logo-video-scheduler",
  );
  const promptIds = new Set(
    withoutVideos.nodes
      .filter((node) =>
        node.tvcProjectId === projectId &&
        (node.storyRole === "tvc-prompt" || node.storyRole === "tvc-logo-prompt"),
      )
      .map((node) => node.id),
  );
  if (!promptIds.size) return withoutVideos;
  return {
    ...withoutVideos,
    nodes: withoutVideos.nodes.filter((node) => !promptIds.has(node.id)),
    edges: withoutVideos.edges.filter(
      (edge) => !promptIds.has(edge.sourceId) && !promptIds.has(edge.targetId),
    ),
  };
}

export function isActiveTvcVideoScheduler(
  graph: WorkflowGraph,
  node: WorkflowNode,
) {
  const project = graph.tvc;
  if (node.type === "scheduler" && node.storyRole === "tvc-logo-video-scheduler") {
    const unit = project?.standaloneLogoUnit;
    const prompt = project ? tvcNode(graph, "tvc-logo-prompt", project.projectId) : undefined;
    if (
      !project ||
      project.phase !== "prompt-final" ||
      project.promptSourceRevision === undefined ||
      project.logo?.placement !== "standalone" ||
      !unit ||
      !prompt ||
      prompt.type !== "source" ||
      tvcStandaloneLogoUnitError(graph, project, unit)
    ) {
      return false;
    }
    const inputIds = graph.edges
      .filter((edge) => edge.targetId === node.id)
      .map((edge) => edge.sourceId);
    const expectedInputIds = [prompt.id, ...unit.referenceNodeIds];
    return matchesTvcStandaloneLogoSchedulerContext(node, project, unit) &&
      inputIds.length === expectedInputIds.length &&
      inputIds.every((sourceId, index) => sourceId === expectedInputIds[index]);
  }
  return Boolean(
    project &&
      project.phase === "prompt-final" &&
      project.promptSourceRevision !== undefined &&
      project.promptPlan?.length &&
      promptUnitsMatchPlan(project) &&
      node.type === "scheduler" &&
      node.storyRole === "tvc-video-scheduler" &&
      node.tvcProjectId === project.projectId &&
      node.tvcPromptRevision === project.promptSourceRevision &&
      node.tvcVideoHistorical !== true &&
      (() => {
        const unit = project.promptUnits?.find((item) => item.ref === node.tvcUnitRef);
        const prompt = tvcNode(graph, "tvc-prompt", project.projectId);
        if (!unit || !promptUnitMatchesPlan(project, unit) || !prompt || prompt.type !== "source") return false;
        const inputIds = graph.edges
          .filter((edge) => edge.targetId === node.id)
          .map((edge) => edge.sourceId);
        const expectedInputIds = [prompt.id, ...unit.referenceNodeIds];
        return matchesTvcVideoSchedulerContext(node, unit, project) &&
          inputIds.length === expectedInputIds.length &&
          inputIds.every((sourceId, index) => sourceId === expectedInputIds[index]);
      })(),
  );
}

export function tvcVideoSchedulerRunError(
  graph: WorkflowGraph,
  node: WorkflowNode,
) {
  if (!isTvcVideoSchedulerNode(node)) {
    return null;
  }
  if (isActiveTvcVideoScheduler(graph, node)) return null;
  const project = graph.tvc;
  if (
    !project ||
    project.phase !== "prompt-final" ||
    project.promptSourceRevision === undefined ||
    !isTvcVideoManualOverride(node) ||
    node.outputKind !== "video" ||
    node.tvcProjectId !== project.projectId ||
    node.tvcPromptRevision !== project.promptSourceRevision ||
    node.tvcVideoManualOverride.sourceRevision !== project.promptSourceRevision ||
    node.tvcVideoHistorical === true
  ) {
    return TVC_VIDEO_HISTORICAL_ERROR;
  }
  if (
    node.storyRole === "tvc-logo-video-scheduler" &&
    node.tvcVideoManualOverride.sourceUnitRef !== "logo-animation"
  ) {
    return TVC_VIDEO_HISTORICAL_ERROR;
  }
  const expectedPromptRole = node.storyRole === "tvc-logo-video-scheduler"
    ? "tvc-logo-prompt"
    : "tvc-prompt";
  const nodes = new Map(graph.nodes.map((item) => [item.id, item]));
  for (const edge of graph.edges.filter((item) => item.targetId === node.id)) {
    const input = nodes.get(edge.sourceId);
    if (!input) return "TVC 视频调度器包含不存在的参考节点。";
    if (input.type === "scheduler" || input.kind === "video") {
      return "TVC 视频调度器不支持视频参考输入。";
    }
    if (input.kind === "image" && !isTvcVideoReference(input, project.projectId)) {
      return "TVC 视频调度器只能引用当前项目已成功的图片资产。";
    }
    if (
      input.kind === "text" &&
      (input.type !== "source" ||
        input.storyRole !== expectedPromptRole ||
        input.tvcProjectId !== project.projectId)
    ) {
      return "TVC 视频调度器只允许使用当前锁稿的最终提示词文本节点。";
    }
  }
  return null;
}

export function isRunnableTvcVideoScheduler(
  graph: WorkflowGraph,
  node: WorkflowNode,
) {
  return tvcVideoSchedulerRunError(graph, node) === null;
}

export function isHistoricalTvcVideoScheduler(
  graph: WorkflowGraph,
  node: WorkflowNode,
) {
  return node.type === "scheduler" &&
    (node.storyRole === "tvc-video-scheduler" || node.storyRole === "tvc-logo-video-scheduler") &&
    (node.tvcVideoHistorical === true ||
      (!isTvcVideoManualOverride(node) && !isActiveTvcVideoScheduler(graph, node)));
}

export type TvcVideoWorkflowSync = {
  graph: WorkflowGraph;
  schedulerIds: string[];
  skippedUnitRefs: string[];
};

export function syncTvcVideoWorkflow(
  graph: WorkflowGraph,
  idFactory: IdFactory = () => crypto.randomUUID(),
): TvcVideoWorkflowSync {
  const project = graph.tvc;
  if (
    !project ||
    project.phase !== "prompt-final" ||
    !project.brief ||
    project.promptSourceRevision === undefined ||
    !project.promptPlan?.length ||
    !project.promptUnits?.length
  ) {
    return { graph, schedulerIds: [], skippedUnitRefs: [] };
  }

  if (!promptUnitsMatchPlan(project)) {
    return {
      graph,
      schedulerIds: [],
      skippedUnitRefs: project.promptUnits.map((unit) => unit.ref),
    };
  }

  const prompt = tvcNode(graph, "tvc-prompt", project.projectId);
  if (!prompt || prompt.type !== "source") {
    return {
      graph,
      schedulerIds: [],
      skippedUnitRefs: project.promptUnits.map((unit) => unit.ref),
    };
  }

  const validUnits = project.promptUnits.filter((unit) =>
    promptUnitMatchesPlan(project, unit) && !tvcVideoUnitError(graph, project, unit)
  );
  const skippedUnitRefs = project.promptUnits
    .filter((unit) => !promptUnitMatchesPlan(project, unit) || tvcVideoUnitError(graph, project, unit))
    .map((unit) => unit.ref);
  const validRefs = new Set(validUnits.map((unit) => unit.ref));
  let next = removeOrArchiveTvcVideoSchedulers(
    graph,
    project.projectId,
    (node) =>
      isTvcVideoManualOverride(node) ||
      (node.tvcUnitRef !== undefined &&
        validRefs.has(node.tvcUnitRef) &&
        (() => {
          const unit = validUnits.find((item) => item.ref === node.tvcUnitRef);
          return Boolean(unit && matchesTvcVideoSchedulerContext(node, unit, project));
        })()),
  );
  const schedulerIds: string[] = [];

  for (const [index, unit] of validUnits.entries()) {
    const manualScheduler = next.nodes.find(
      (node): node is WorkflowSchedulerNode =>
        isTvcVideoManualOverride(node) &&
        node.tvcProjectId === project.projectId &&
        node.tvcUnitRef === unit.ref &&
        node.tvcPromptRevision === project.promptSourceRevision &&
        node.tvcVideoHistorical !== true,
    );
    if (manualScheduler) {
      schedulerIds.push(manualScheduler.id);
      continue;
    }
    const currentSchedulers = next.nodes.filter(
      (node): node is WorkflowNode =>
        node.type === "scheduler" &&
        node.storyRole === "tvc-video-scheduler" &&
        node.tvcProjectId === project.projectId &&
        node.tvcUnitRef === unit.ref &&
        matchesTvcVideoSchedulerContext(node, unit, project),
    );
    let scheduler = currentSchedulers[0];
    if (!scheduler || scheduler.type !== "scheduler") {
      const promptWidth = prompt.width ?? 760;
      scheduler = {
        id: idFactory(),
        x: prompt.x + promptWidth + 120,
        y: prompt.y + index * ROW_STEP,
        width: WORKFLOW_NODE_WIDTH,
        height: 360,
        type: "scheduler",
        outputKind: "video",
        model: TVC_VIDEO_MODEL,
        prompt: tvcVideoSchedulerPrompt(project, unit),
        aspectRatio: project.brief.aspectRatio,
        resolution: TVC_VIDEO_RESOLUTION,
        duration: String(unit.endSecond - unit.startSecond),
        outputCount: 1,
        error: "",
        label: videoSchedulerLabel(unit),
        tvcProjectId: project.projectId,
        tvcUnitRef: unit.ref,
        tvcPromptRevision: project.promptSourceRevision,
        storyRole: "tvc-video-scheduler",
      };
      next = { ...next, nodes: [...next.nodes, scheduler] };
    } else if (
      !tvcVideoResultsForScheduler(next, scheduler.id).some(tvcVideoHasSubmissionEvidence) &&
      !isSameTvcVideoScheduler(scheduler, unit, project)
    ) {
      const schedulerId = scheduler.id;
      next = {
        ...next,
        nodes: next.nodes.map((node) => node.id === schedulerId
          ? {
              ...node,
              outputKind: "video",
              model: TVC_VIDEO_MODEL,
              prompt: tvcVideoSchedulerPrompt(project, unit),
              aspectRatio: project.brief!.aspectRatio,
              resolution: TVC_VIDEO_RESOLUTION,
              duration: String(unit.endSecond - unit.startSecond),
              outputCount: 1,
              error: "",
              label: videoSchedulerLabel(unit),
              tvcProjectId: project.projectId,
              tvcUnitRef: unit.ref,
              tvcPromptRevision: project.promptSourceRevision,
              tvcVideoHistorical: undefined,
              storyRole: "tvc-video-scheduler",
            } as WorkflowNode
          : node),
      };
      scheduler = next.nodes.find((node) => node.id === schedulerId) as WorkflowNode;
    }

    const duplicateSchedulers = currentSchedulers.slice(1);
    if (duplicateSchedulers.length) {
      const duplicateIds = new Set(duplicateSchedulers.map((node) => node.id));
      next = removeOrArchiveTvcVideoSchedulers(
        next,
        project.projectId,
        (node) => !duplicateIds.has(node.id),
      );
    }

    const schedulerId = scheduler.id;
    const existingResults = tvcVideoResultsForScheduler(next, schedulerId);
    const existingResult = existingResults[0];
    if (!existingResult) {
      const result: WorkflowResultNode = {
        id: idFactory(),
        x: scheduler.x + WORKFLOW_NODE_WIDTH + 120,
        y: scheduler.y,
        type: "result",
        kind: "video",
        schedulerId,
        text: videoResultLabel(unit),
        model: TVC_VIDEO_MODEL,
        status: "ready",
        progress: "待生成",
        error: "",
        label: videoResultLabel(unit),
        tvcProjectId: project.projectId,
        tvcUnitRef: unit.ref,
        tvcPromptRevision: project.promptSourceRevision,
        storyRole: "tvc-video-result",
      };
      next = { ...next, nodes: [...next.nodes, result] };
    } else if (!tvcVideoHasSubmissionEvidence(existingResult) && !isSameTvcVideoResult(existingResult, schedulerId, unit, project)) {
      next = {
        ...next,
        nodes: next.nodes.map((node) => node.id === existingResult.id
          ? {
              ...node,
              kind: "video",
              schedulerId,
              text: videoResultLabel(unit),
              model: TVC_VIDEO_MODEL,
              status: "ready",
              progress: "待生成",
              error: "",
              label: videoResultLabel(unit),
              tvcProjectId: project.projectId,
              tvcUnitRef: unit.ref,
              tvcPromptRevision: project.promptSourceRevision,
              tvcVideoHistorical: undefined,
              storyRole: "tvc-video-result",
            } as WorkflowNode
          : node),
      };
    }

    const expectedInputIds = [prompt.id, ...unit.referenceNodeIds];
    const incoming = next.edges.filter((edge) => edge.targetId === schedulerId);
    const inputIds = incoming.map((edge) => edge.sourceId);
    if (
      inputIds.length !== expectedInputIds.length ||
      inputIds.some((sourceId, inputIndex) => sourceId !== expectedInputIds[inputIndex])
    ) {
      next = {
        ...next,
        edges: [
          ...next.edges.filter((edge) => edge.targetId !== schedulerId),
          ...expectedInputIds.map((sourceId) => ({
            id: idFactory(),
            sourceId,
            targetId: schedulerId,
          })),
        ],
      };
    }
    const result = tvcVideoResultsForScheduler(next, schedulerId)[0];
    if (result && !next.edges.some((edge) => edge.sourceId === schedulerId && edge.targetId === result.id)) {
      next = {
        ...next,
        edges: [...next.edges, { id: idFactory(), sourceId: schedulerId, targetId: result.id }],
      };
    }
    schedulerIds.push(schedulerId);
  }
  return { graph: next, schedulerIds, skippedUnitRefs };
}

export type TvcStandaloneLogoVideoWorkflowSync = {
  graph: WorkflowGraph;
  schedulerId?: string;
  skipped: boolean;
};

function removeTvcStandaloneLogoPrompt(
  graph: WorkflowGraph,
  projectId: string,
) {
  const promptIds = new Set(
    graph.nodes
      .filter((node) => node.tvcProjectId === projectId && node.storyRole === "tvc-logo-prompt")
      .map((node) => node.id),
  );
  if (!promptIds.size) return graph;
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => !promptIds.has(node.id)),
    edges: graph.edges.filter(
      (edge) => !promptIds.has(edge.sourceId) && !promptIds.has(edge.targetId),
    ),
  };
}

export function syncTvcStandaloneLogoVideoWorkflow(
  graph: WorkflowGraph,
  idFactory: IdFactory = () => crypto.randomUUID(),
): TvcStandaloneLogoVideoWorkflowSync {
  const project = graph.tvc;
  const clean = (current: (node: WorkflowNode) => boolean) =>
    removeTvcStandaloneLogoPrompt(
      removeOrArchiveTvcVideoSchedulers(
        graph,
        project?.projectId ?? "",
        current,
        "tvc-logo-video-scheduler",
      ),
      project?.projectId ?? "",
    );
  if (
    !project ||
    project.phase !== "prompt-final" ||
    !project.brief ||
    project.promptSourceRevision === undefined ||
    project.logo?.placement !== "standalone" ||
    !project.standaloneLogoUnit
  ) {
    return { graph: project ? clean(() => false) : graph, skipped: false };
  }
  const unit = project.standaloneLogoUnit;
  if (tvcStandaloneLogoUnitError(graph, project, unit)) {
    return { graph: clean(() => false), skipped: true };
  }
  const expectedPromptText = standaloneLogoPromptText(unit);
  const existingPrompt = tvcNode(graph, "tvc-logo-prompt", project.projectId);
  const promptCreated = existingPrompt?.type === "source" &&
      existingPrompt.label === "品牌 Logo · 最终提示词" &&
      existingPrompt.text === expectedPromptText &&
      existingPrompt.width === 520 &&
      existingPrompt.height === 320
    ? { graph, nodeId: existingPrompt.id }
    : addOrUpdateTvcNode(
      graph,
      "tvc-logo-prompt",
      project.projectId,
      "品牌 Logo · 最终提示词",
      expectedPromptText,
      idFactory,
      { width: 520, height: 320 },
    );
  let next = removeOrArchiveTvcVideoSchedulers(
    promptCreated.graph,
    project.projectId,
    (node) =>
      (isTvcVideoManualOverride(node) &&
        node.tvcProjectId === project.projectId &&
        node.tvcUnitRef === unit.ref &&
        node.tvcPromptRevision === project.promptSourceRevision &&
        node.tvcVideoHistorical !== true) ||
      matchesTvcStandaloneLogoSchedulerContext(node, project, unit),
    "tvc-logo-video-scheduler",
  );
  const manualScheduler = next.nodes.find(
    (node): node is WorkflowSchedulerNode =>
      isTvcVideoManualOverride(node) &&
      node.storyRole === "tvc-logo-video-scheduler" &&
      node.tvcProjectId === project.projectId &&
      node.tvcUnitRef === unit.ref &&
      node.tvcPromptRevision === project.promptSourceRevision &&
      node.tvcVideoHistorical !== true,
  );
  if (manualScheduler) {
    return { graph: next, schedulerId: manualScheduler.id, skipped: false };
  }
  let scheduler = next.nodes.find(
    (node): node is WorkflowSchedulerNode =>
      node.type === "scheduler" &&
      node.storyRole === "tvc-logo-video-scheduler" &&
      node.tvcProjectId === project.projectId &&
      matchesTvcStandaloneLogoSchedulerContext(node, project, unit),
  );
  if (!scheduler) {
    const prompt = next.nodes.find((node) => node.id === promptCreated.nodeId)!;
    const promptWidth = prompt.width ?? 520;
    scheduler = {
      id: idFactory(),
      x: prompt.x + promptWidth + 120,
      y: prompt.y,
      width: WORKFLOW_NODE_WIDTH,
      height: 360,
      type: "scheduler",
      outputKind: "video",
      model: TVC_VIDEO_MODEL,
      prompt: tvcStandaloneLogoSchedulerPrompt(unit),
      aspectRatio: project.brief.aspectRatio,
      resolution: TVC_VIDEO_RESOLUTION,
      duration: String(unit.durationSeconds),
      outputCount: 1,
      error: "",
      label: standaloneLogoSchedulerLabel(),
      tvcProjectId: project.projectId,
      tvcUnitRef: unit.ref,
      tvcPromptRevision: project.promptSourceRevision,
      storyRole: "tvc-logo-video-scheduler",
    };
    next = { ...next, nodes: [...next.nodes, scheduler] };
  }
  const schedulerId = scheduler.id;
  const result = tvcVideoResultsForScheduler(next, schedulerId)[0];
  if (!result) {
    const node: WorkflowResultNode = {
      id: idFactory(),
      x: scheduler.x + WORKFLOW_NODE_WIDTH + 120,
      y: scheduler.y,
      type: "result",
      kind: "video",
      schedulerId,
      text: standaloneLogoResultLabel(),
      model: TVC_VIDEO_MODEL,
      status: "ready",
      progress: "待生成",
      error: "",
      label: standaloneLogoResultLabel(),
      tvcProjectId: project.projectId,
      tvcUnitRef: unit.ref,
      tvcPromptRevision: project.promptSourceRevision,
      storyRole: "tvc-logo-video-result",
    };
    next = { ...next, nodes: [...next.nodes, node] };
  } else if (!tvcVideoHasSubmissionEvidence(result) && !isSameTvcStandaloneLogoResult(result, schedulerId, project, unit)) {
    next = {
      ...next,
      nodes: next.nodes.map((node) => node.id === result.id
        ? {
            ...node,
            kind: "video",
            schedulerId,
            text: standaloneLogoResultLabel(),
            model: TVC_VIDEO_MODEL,
            status: "ready",
            progress: "待生成",
            error: "",
            label: standaloneLogoResultLabel(),
            tvcProjectId: project.projectId,
            tvcUnitRef: unit.ref,
            tvcPromptRevision: project.promptSourceRevision,
            tvcVideoHistorical: undefined,
            storyRole: "tvc-logo-video-result",
          } as WorkflowNode
        : node),
    };
  }
  const expectedInputIds = [promptCreated.nodeId, ...unit.referenceNodeIds];
  const inputIds = next.edges
    .filter((edge) => edge.targetId === schedulerId)
    .map((edge) => edge.sourceId);
  if (
    inputIds.length !== expectedInputIds.length ||
    inputIds.some((sourceId, index) => sourceId !== expectedInputIds[index])
  ) {
    next = {
      ...next,
      edges: [
        ...next.edges.filter((edge) => edge.targetId !== schedulerId),
        ...expectedInputIds.map((sourceId) => ({ id: idFactory(), sourceId, targetId: schedulerId })),
      ],
    };
  }
  const currentResult = tvcVideoResultsForScheduler(next, schedulerId)[0];
  if (currentResult && !next.edges.some((edge) => edge.sourceId === schedulerId && edge.targetId === currentResult.id)) {
    next = {
      ...next,
      edges: [...next.edges, { id: idFactory(), sourceId: schedulerId, targetId: currentResult.id }],
    };
  }
  return { graph: next, schedulerId, skipped: false };
}

function briefText(title: string, brief: TvcBrief, graph: WorkflowGraph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const project = graph.tvc;
  const logo = project?.logo;
  return [
    `项目：${title}`,
    `目标：${brief.goal}`,
    `受众：${brief.audience}`,
    `目标时长：${brief.targetDuration} 秒`,
    `规格：${brief.aspectRatio}；${brief.platform}；单段最长 ${brief.maxDuration} 秒`,
    `风格：${brief.style}`,
    `叙事方式：${brief.narrativeMode}`,
    `音频：${brief.audioPolicy}`,
    `最终提示词旁白：${project?.promptOptions?.narration === "omit" ? "不加入旁白" : project?.promptOptions?.narration === "include" ? "加入旁白" : "未设置（沿用旁白）"}`,
    `品牌 Logo：${logo
      ? `${nodeName(nodes.get(logo.nodeId) ?? { id: logo.nodeId, x: 0, y: 0, type: "source", kind: "text", text: "" })}；${logo.placement === "opening" ? "片头" : logo.placement === "closing" ? "片尾" : "独立动效"}；${logo.durationSeconds} 秒`
      : "未设置"}`,
    `文案：${brief.copy || "未提供"}`,
    "参考图映射：",
    ...(brief.referenceMap.length
      ? brief.referenceMap.map((item, index) =>
          `图${index + 1} · ${nodeName(nodes.get(item.nodeId) ?? { id: item.nodeId, x: 0, y: 0, type: "source", kind: "text", text: "" })}：${item.roles.join("、")}${item.note ? `；${item.note}` : ""}`,
        )
      : ["暂无；缺少的角色、场景或产品可先建立资产计划。"]),
  ].join("\n");
}

function assetPlanText(asset: TvcAssetPlan) {
  const label = asset.kind === "character" ? "角色" : asset.kind === "scene" ? "场景" : "产品/道具";
  return [
    `类型：${label}`,
    `名称：${asset.name}`,
    `说明：${asset.description}`,
    `建立原因：${asset.reason}`,
  ].join("\n");
}

function storyboardText(storyboard: TvcStoryboard) {
  return [
    `${storyboard.title} · ${storyboard.validationStatus}`,
    ...storyboard.rows.map((row) => [
      `镜头 ${row.shotNumber}｜${row.timecode}｜${row.durationSeconds} 秒`,
      `参考场景图：${row.referenceScene}`,
      `场景/时间：${row.sceneTime}`,
      `景别与焦段：${row.shotSizeLens}`,
      `机位与运镜：${row.camera}`,
      `画面构图：${row.composition}`,
      `角色动作与表演：${row.performance}`,
      `旁白 / 对白：${row.narration}${row.dialogue?.trim() ? ` / ${row.dialogue.trim()}` : " / 无"}`,
      `环境声与拟声：${row.sound}`,
      `转场/切点：${row.transition}`,
      `连续性与生成限制：${row.constraints}`,
    ].join("\n")),
  ].join("\n\n");
}

function promptText(units: TvcPromptUnit[]) {
  return units.map((unit) =>
    `【${unit.ref}｜${formatTime(unit.startSecond)}–${formatTime(unit.endSecond)}】\n${unit.prompt}`,
  ).join("\n\n");
}

type TimedStoryboardRow = {
  row: TvcStoryboardRow;
  startSecond: number;
  endSecond: number;
};

function timedStoryboardRows(storyboard: TvcStoryboard): TimedStoryboardRow[] {
  let cursor = 0;
  const timedRows = storyboard.rows.map((row) => {
    const startSecond = cursor;
    const endSecond = startSecond + row.durationSeconds;
    cursor = endSecond;
    return { row, startSecond, endSecond };
  });
  if (cursor !== storyboard.targetDurationSeconds) {
    throw new Error("TVC 已锁定分镜的总时长无效，不能建立视频片段计划。");
  }
  return timedRows;
}

function uniqueReferenceNodeIds(rows: TimedStoryboardRow[]) {
  return [...new Set(rows.flatMap(({ row }) => row.referenceNodeIds))];
}

function promptPlanSegment(
  rows: TimedStoryboardRow[],
  index: number,
): TvcPromptPlanSegment {
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) throw new Error("TVC 视频片段不能为空。");
  const referenceNodeIds = uniqueReferenceNodeIds(rows);
  if (referenceNodeIds.length > TVC_VIDEO_MAX_REFERENCE_IMAGES) {
    throw new Error(`TVC 视频片段最多只能引用 ${TVC_VIDEO_MAX_REFERENCE_IMAGES} 张图片。`);
  }
  return {
    ref: `segment-${String(index + 1).padStart(3, "0")}`,
    startSecond: first.startSecond,
    endSecond: last.endSecond,
    shotNumbers: rows.map(({ row }) => row.shotNumber),
    referenceNodeIds,
  };
}

export function buildTvcPromptPlan(
  storyboard: TvcStoryboard,
): TvcPromptPlanSegment[] {
  const timedRows = timedStoryboardRows(storyboard);
  const groups: TimedStoryboardRow[][] = [];
  let group: TimedStoryboardRow[] = [];
  let duration = 0;
  for (const timedRow of timedRows) {
    const rowDuration = timedRow.row.durationSeconds;
    if (rowDuration > TVC_VIDEO_MAX_DURATION) {
      throw new Error(`镜头 ${timedRow.row.shotNumber} 超过 ${TVC_VIDEO_MAX_DURATION} 秒，不能作为完整视频片段。`);
    }
    if (group.length && duration + rowDuration > TVC_VIDEO_MAX_DURATION) {
      if (duration < TVC_VIDEO_MIN_DURATION) {
        throw new Error(`TVC 视频片段不足 ${TVC_VIDEO_MIN_DURATION} 秒，不能在完整镜头边界建立片段。`);
      }
      groups.push(group);
      group = [];
      duration = 0;
    }
    group.push(timedRow);
    duration += rowDuration;
  }
  if (!group.length) {
    throw new Error("TVC 视频片段计划不能为空。");
  }
  groups.push(group);

  const lastGroup = groups.at(-1)!;
  let lastDuration = lastGroup.reduce((total, item) => total + item.row.durationSeconds, 0);
  const previousGroup = groups.at(-2);
  while (lastDuration < TVC_VIDEO_MIN_DURATION && previousGroup?.length) {
    const moved = previousGroup.at(-1)!;
    const previousDuration = previousGroup.reduce(
      (total, item) => total + item.row.durationSeconds,
      0,
    );
    if (
      previousGroup.length === 1 ||
      previousDuration - moved.row.durationSeconds < TVC_VIDEO_MIN_DURATION ||
      lastDuration + moved.row.durationSeconds > TVC_VIDEO_MAX_DURATION
    ) {
      break;
    }
    previousGroup.pop();
    lastGroup.unshift(moved);
    lastDuration += moved.row.durationSeconds;
  }
  if (lastDuration < TVC_VIDEO_MIN_DURATION) {
    throw new Error(`TVC 最后一个视频片段不足 ${TVC_VIDEO_MIN_DURATION} 秒，不能在完整镜头边界建立片段。`);
  }
  return groups.map((items, index) => promptPlanSegment(items, index));
}

function buildTvcPromptPlanFromBoundaries(
  storyboard: TvcStoryboard,
  boundaries: TvcPromptPlanBoundary[],
): TvcPromptPlanSegment[] {
  const timedRows = timedStoryboardRows(storyboard);
  if (!boundaries.length) throw new Error("TVC 视频片段计划至少需要一个片段。");
  const plan: TvcPromptPlanSegment[] = [];
  let cursor = 0;
  let rowIndex = 0;
  for (const [index, boundary] of boundaries.entries()) {
    if (
      !Number.isInteger(boundary.startSecond) ||
      !Number.isInteger(boundary.endSecond) ||
      boundary.startSecond !== cursor ||
      boundary.endSecond <= boundary.startSecond
    ) {
      throw new Error("TVC 视频片段必须连续覆盖，不能重叠或留空。");
    }
    const duration = boundary.endSecond - boundary.startSecond;
    if (duration < TVC_VIDEO_MIN_DURATION || duration > TVC_VIDEO_MAX_DURATION) {
      throw new Error(`TVC 视频片段时长必须为 ${TVC_VIDEO_MIN_DURATION}–${TVC_VIDEO_MAX_DURATION} 秒。`);
    }
    const rows: TimedStoryboardRow[] = [];
    while (rowIndex < timedRows.length && timedRows[rowIndex]!.endSecond <= boundary.endSecond) {
      const row = timedRows[rowIndex]!;
      if (!rows.length && row.startSecond !== boundary.startSecond) {
        throw new Error("TVC 视频片段不能从镜头中间开始。");
      }
      rows.push(row);
      rowIndex += 1;
    }
    if (!rows.length || rows.at(-1)!.endSecond !== boundary.endSecond) {
      throw new Error("TVC 视频片段不能切开已锁定镜头。");
    }
    plan.push(promptPlanSegment(rows, index));
    cursor = boundary.endSecond;
  }
  if (cursor !== storyboard.targetDurationSeconds || rowIndex !== timedRows.length) {
    throw new Error("TVC 视频片段必须连续覆盖全部锁定分镜。");
  }
  return plan;
}

function assertTvcLogoStoryboardRows(
  graph: WorkflowGraph,
  rows: TvcStoryboardRow[],
  logo: TvcLogoConfig | undefined,
) {
  const logoRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.kind === "logo-animation");
  if (!logo) {
    if (logoRows.length) {
      throw new Error("未设置品牌 Logo，不能添加 Logo 动效镜头。 ");
    }
    return;
  }
  if (logo.placement === "standalone") {
    if (logoRows.length) {
      throw new Error("独立 Logo 动效不能加入正片分镜表。 ");
    }
    return;
  }
  if (logoRows.length !== 1) {
    throw new Error("片头或片尾 Logo 必须有且仅有一个 Logo 动效镜头。 ");
  }
  const item = logoRows[0]!;
  const expectedIndex = logo.placement === "opening" ? 0 : rows.length - 1;
  if (item.index !== expectedIndex) {
    throw new Error(logo.placement === "opening"
      ? "片头 Logo 必须是正片第一镜。"
      : "片尾 Logo 必须是正片最后一镜。");
  }
  if (item.row.durationSeconds !== logo.durationSeconds) {
    throw new Error(`Logo 动效镜头时长必须为 ${logo.durationSeconds} 秒。`);
  }
  if (!item.row.referenceNodeIds.includes(logo.nodeId)) {
    throw new Error("Logo 动效镜头必须引用当前项目的品牌 Logo。 ");
  }
  const node = graph.nodes.find((candidate) => candidate.id === logo.nodeId);
  if (!isTvcLogoSource(node, graph.tvc?.projectId)) {
    throw new Error("品牌 Logo 必须是当前 TVC 项目上传的 PNG、WebP 或 JPEG 图片。 ");
  }
}

function normaliseStoryboard(
  title: string,
  targetDuration: number,
  rows: TvcStoryboardDraftRow[],
  graph: WorkflowGraph,
  logo?: TvcLogoConfig,
) {
  if (!rows.length) throw new Error("TVC 分镜表至少需要一个镜头。");
  const shotNumbers = new Set<string>();
  let cursor = 0;
  const normalised = rows.map((row, index) => {
    if (
      !isNonEmptyString(row.shotNumber) ||
      !Number.isInteger(row.startSecond) ||
      !Number.isInteger(row.endSecond) ||
      !isFinitePositiveInteger(row.durationSeconds) ||
      (row.dialogue !== undefined && typeof row.dialogue !== "string") ||
      (row.kind !== undefined && row.kind !== "logo-animation") ||
      row.startSecond !== cursor ||
      row.endSecond <= row.startSecond ||
      row.endSecond - row.startSecond !== row.durationSeconds ||
      shotNumbers.has(row.shotNumber)
    ) {
      throw new Error(`TVC 分镜第 ${index + 1} 行的镜号或时间码无效。`);
    }
    const content = [
      row.referenceScene,
      row.sceneTime,
      row.shotSizeLens,
      row.camera,
      row.composition,
      row.performance,
      row.narration,
      row.sound,
      row.transition,
      row.constraints,
    ];
    if (!content.every(isNonEmptyString)) {
      throw new Error(`TVC 分镜 ${row.shotNumber} 缺少分镜表字段。`);
    }
    if (!Array.isArray(row.referenceNodeIds) || new Set(row.referenceNodeIds).size !== row.referenceNodeIds.length) {
      throw new Error(`TVC 分镜 ${row.shotNumber} 的参考图重复或无效。`);
    }
    assertImageReferences(graph, row.referenceNodeIds, `TVC 分镜 ${row.shotNumber}`);
    shotNumbers.add(row.shotNumber);
    cursor = row.endSecond;
    return {
      shotNumber: row.shotNumber,
      timecode: `${formatTime(row.startSecond)}–${formatTime(row.endSecond)}`,
      durationSeconds: row.durationSeconds,
      referenceScene: row.referenceScene,
      sceneTime: row.sceneTime,
      shotSizeLens: row.shotSizeLens,
      camera: row.camera,
      composition: row.composition,
      performance: row.performance,
      narration: row.narration,
      ...(row.dialogue !== undefined ? { dialogue: row.dialogue } : {}),
      sound: row.sound,
      transition: row.transition,
      constraints: row.constraints,
      referenceNodeIds: row.referenceNodeIds,
      ...(row.kind ? { kind: row.kind } : {}),
    } satisfies TvcStoryboardRow;
  });
  if (cursor !== targetDuration) {
    throw new Error(`TVC 分镜总时长为 ${cursor} 秒，与目标 ${targetDuration} 秒不一致。`);
  }
  assertTvcLogoStoryboardRows(graph, normalised, logo);
  return {
    title,
    targetDurationSeconds: targetDuration,
    validationStatus: `已校验：${normalised.length} 镜 / ${cursor} 秒`,
    rows: normalised,
  } satisfies TvcStoryboard;
}

function stateWith<T extends TvcWorkflowState>(graph: WorkflowGraph, tvc: T): WorkflowGraph {
  return { ...graph, tvc };
}

export type TvcLogoConfigInput = Omit<TvcLogoConfig, "durationSeconds"> & {
  durationSeconds?: number;
};

function normaliseTvcLogoConfig(
  graph: WorkflowGraph,
  project: TvcWorkflowState,
  value: TvcLogoConfigInput,
): TvcLogoConfig {
  const durationSeconds = value.durationSeconds ?? TVC_LOGO_DEFAULT_DURATION;
  if (
    !isNonEmptyString(value.nodeId) ||
    !isTvcLogoPlacement(value.placement) ||
    !isFinitePositiveInteger(durationSeconds) ||
    durationSeconds < TVC_VIDEO_MIN_DURATION ||
    durationSeconds > TVC_VIDEO_MAX_DURATION
  ) {
    throw new Error(`品牌 Logo 动效时长必须为 ${TVC_VIDEO_MIN_DURATION}–${TVC_VIDEO_MAX_DURATION} 秒。`);
  }
  const node = graph.nodes.find((candidate) => candidate.id === value.nodeId);
  if (!isTvcLogoSource(node, project.projectId)) {
    throw new Error("品牌 Logo 必须使用当前 TVC 项目上传的 PNG、WebP 或 JPEG 图片。 ");
  }
  return { nodeId: value.nodeId, placement: value.placement, durationSeconds };
}

function refreshTvcBriefNode(
  graph: WorkflowGraph,
  project: TvcWorkflowState,
  idFactory: IdFactory,
) {
  if (!project.brief) return graph;
  return addOrUpdateTvcNode(
    graph,
    "tvc-brief",
    project.projectId,
    `${project.title} · TVC 资料梳理`,
    briefText(project.title, project.brief, graph),
    idFactory,
    { width: 520, height: 420 },
  ).graph;
}

export function createTvcLogoSource(
  graph: WorkflowGraph,
  input: TvcLogoSourceInput,
  idFactory: IdFactory = () => crypto.randomUUID(),
) {
  const project = assertTvcProject(graph);
  if (
    !isNonEmptyString(input.assetId) ||
    !isNonEmptyString(input.assetName) ||
    !isTvcLogoMimeType(input.assetMimeType)
  ) {
    throw new Error("品牌 Logo 仅支持不超过 10MB 的 PNG、WebP 或 JPEG 图片。 ");
  }
  const origin = rightAppendOrigin(graph);
  const nodeId = idFactory();
  const node: WorkflowSourceNode = {
    id: nodeId,
    x: origin.x,
    y: origin.y,
    type: "source",
    kind: "image",
    text: input.text?.trim() || "品牌 Logo，仅作为视频动效视觉参考。",
    assetId: input.assetId,
    assetName: input.assetName,
    assetMimeType: input.assetMimeType,
    label: `${input.assetName} · TVC 品牌 Logo`,
    tvcProjectId: project.projectId,
    storyRole: "tvc-logo",
  };
  return {
    graph: { ...graph, nodes: [...graph.nodes, node] },
    nodeId,
  };
}

function clearTvcPromptState() {
  return {
    promptUnits: undefined,
    standaloneLogoUnit: undefined,
    promptSourceRevision: undefined,
  };
}

export function configureTvcLogo(
  graph: WorkflowGraph,
  input: TvcLogoConfigInput | null,
  idFactory: IdFactory = () => crypto.randomUUID(),
) {
  const project = assertTvcProject(graph);
  const logo = input ? normaliseTvcLogoConfig(graph, project, input) : undefined;
  const sameConfig = JSON.stringify(project.logo ?? null) === JSON.stringify(logo ?? null);
  if (sameConfig) return { graph, logo: project.logo };
  const requiresStoryboardRevision =
    project.logo?.placement === "opening" ||
    project.logo?.placement === "closing" ||
    logo?.placement === "opening" ||
    logo?.placement === "closing";
  const revision = project.revision + 1;
  const locked = project.lockedAt !== undefined && project.lockedRevision !== undefined;
  const nextProject: TvcWorkflowState = {
    ...project,
    ...(logo ? { logo } : { logo: undefined }),
    revision,
    ...clearTvcPromptState(),
    ...(requiresStoryboardRevision
      ? {
          phase: project.brief ? "script-draft" as const : project.phase,
          lockedAt: undefined,
          lockedRevision: undefined,
          promptPlan: undefined,
        }
      : locked
        ? {
            phase: "script-locked" as const,
            lockedRevision: revision,
          }
        : {}),
  };
  let next = refreshTvcBriefNode(stateWith(graph, nextProject), nextProject, idFactory);
  if (requiresStoryboardRevision) {
    next = {
      ...next,
      nodes: next.nodes.map((node) =>
        node.storyRole === "tvc-storyboard" && node.tvcProjectId === project.projectId
          ? { ...node, label: `${project.title} · TVC 分镜表 · 草案` }
          : node,
      ) as WorkflowNode[],
    };
  }
  return {
    graph: removeTvcPromptArtifacts(next, project.projectId),
    logo,
  };
}

export function setTvcPromptNarration(
  graph: WorkflowGraph,
  narration: TvcNarrationOption,
  idFactory: IdFactory = () => crypto.randomUUID(),
) {
  const project = assertTvcProject(graph);
  if (!isTvcNarrationOption(narration)) {
    throw new Error("旁白选项必须为加入旁白或不加旁白。 ");
  }
  if (project.promptOptions?.narration === narration) return { graph, narration };
  const revision = project.revision + 1;
  const locked = project.lockedAt !== undefined && project.lockedRevision !== undefined;
  const nextProject: TvcWorkflowState = {
    ...project,
    promptOptions: { narration },
    revision,
    ...clearTvcPromptState(),
    ...(locked ? { phase: "script-locked" as const, lockedRevision: revision } : {}),
  };
  const withBrief = refreshTvcBriefNode(stateWith(graph, nextProject), nextProject, idFactory);
  return {
    graph: removeTvcPromptArtifacts(withBrief, project.projectId),
    narration,
  };
}

export function createTvcBrief(
  graph: WorkflowGraph,
  operation: TvcCreateBriefOperation,
  idFactory: IdFactory = () => crypto.randomUUID(),
) {
  const project = assertTvcProject(graph);
  if (project.brief) throw new Error("当前 TVC 项目已经完成资料梳理。");
  if (!isNonEmptyString(operation.title) || !isTvcBrief(operation.brief)) {
    throw new Error("TVC 资料梳理内容不完整。");
  }
  assertBriefReferences(graph, operation.brief);
  const nextProject: TvcWorkflowState = {
    ...project,
    title: operation.title.trim(),
    brief: operation.brief,
    phase: "script-draft",
    revision: project.revision + 1,
  };
  const withState = stateWith(graph, nextProject);
  const created = addOrUpdateTvcNode(
    withState,
    "tvc-brief",
    project.projectId,
    `${nextProject.title} · TVC 资料梳理`,
    briefText(nextProject.title, operation.brief, withState),
    idFactory,
    { width: 520, height: 420 },
  );
  return { graph: created.graph, projectId: project.projectId, briefNodeId: created.nodeId };
}

export function updateTvcBrief(
  graph: WorkflowGraph,
  operation: TvcUpdateBriefOperation,
  idFactory: IdFactory = () => crypto.randomUUID(),
) {
  const project = assertProjectId(graph, operation.projectId);
  if (!project.brief || !isTvcBrief(operation.brief)) {
    throw new Error("TVC 资料梳理内容不完整。");
  }
  assertBriefReferences(graph, operation.brief);
  const title = operation.title?.trim() || project.title;
  const nextProject: TvcWorkflowState = {
    ...project,
    title,
    brief: operation.brief,
    phase: "script-draft",
    revision: project.revision + 1,
    lockedAt: undefined,
    lockedRevision: undefined,
    promptPlan: undefined,
    promptUnits: undefined,
    standaloneLogoUnit: undefined,
    promptSourceRevision: undefined,
  };
  const withState = stateWith(graph, nextProject);
  const created = addOrUpdateTvcNode(
    withState,
    "tvc-brief",
    project.projectId,
    `${title} · TVC 资料梳理`,
    briefText(title, operation.brief, withState),
    idFactory,
    { width: 520, height: 420 },
  );
  const withoutPrompt = removeTvcPromptArtifacts(created.graph, project.projectId);
  return { graph: withoutPrompt, projectId: project.projectId, briefNodeId: created.nodeId };
}

export function createTvcAssetPlan(
  graph: WorkflowGraph,
  operation: TvcCreateAssetPlanOperation,
  idFactory: IdFactory = () => crypto.randomUUID(),
) {
  const project = assertProjectId(graph, operation.projectId);
  if (!project.brief) throw new Error("请先完成 TVC 资料梳理。");
  if (project.phase === "script-locked" || project.phase === "prompt-final") {
    throw new Error("剧本已锁定，不能再新增 TVC 资产计划。");
  }
  if (!operation.assets.length) throw new Error("TVC 资产计划不能为空。");
  const existing = new Set(
    graph.nodes
      .filter((node) => node.tvcProjectId === project.projectId && node.assetRef)
      .map((node) => node.assetRef),
  );
  operation.assets.forEach((asset) => {
    if (
      !isNonEmptyString(asset.ref) ||
      !isNonEmptyString(asset.name) ||
      !["character", "scene", "prop"].includes(asset.kind) ||
      !isNonEmptyString(asset.description) ||
      !isNonEmptyString(asset.reason) ||
      !isNonEmptyString(asset.imagePrompt) ||
      existing.has(asset.ref)
    ) {
      throw new Error(`TVC 资产 ${asset.ref || "未命名"} 无效或重复。`);
    }
    existing.add(asset.ref);
  });
  const anchor = tvcNode(graph, "tvc-brief", project.projectId);
  const origin = anchor
    ? { x: anchor.x + COLUMN_STEP, y: anchor.y + ROW_STEP }
    : rightAppendOrigin(graph);
  const assetCount = graph.nodes.filter(
    (node) => node.tvcProjectId === project.projectId && node.storyRole === "tvc-asset-spec",
  ).length;
  const createdNodes: WorkflowNode[] = [];
  const createdEdges: WorkflowGraph["edges"] = [];
  operation.assets.forEach((asset, index) => {
    const y = origin.y + ROW_STEP * (assetCount + index);
    const specId = idFactory();
    const schedulerId = idFactory();
    const resultId = idFactory();
    const metadata = {
      tvcProjectId: project.projectId,
      assetRef: asset.ref,
      assetKind: asset.kind,
    } as const;
    createdNodes.push(
      {
        id: specId,
        x: origin.x,
        y,
        type: "source",
        kind: "text",
        text: assetPlanText(asset),
        label: `${asset.name} · TVC 资产说明`,
        ...metadata,
        assetRole: "spec",
        storyRole: "tvc-asset-spec",
      },
      {
        id: schedulerId,
        x: origin.x + COLUMN_STEP,
        y,
        width: WORKFLOW_NODE_WIDTH,
        height: 360,
        type: "scheduler",
        outputKind: "image",
        model: "gpt-image-2",
        prompt: asset.imagePrompt,
        aspectRatio: "16:9",
        resolution: "1K",
        duration: "",
        outputCount: 1,
        error: "",
        label: `${asset.name} · TVC 资产图片`,
        ...metadata,
        assetRole: "scheduler",
        storyRole: "tvc-asset-scheduler",
      },
      {
        id: resultId,
        x: origin.x + COLUMN_STEP * 2,
        y,
        type: "result",
        kind: "image",
        schedulerId,
        text: `${asset.name} TVC 资产图片占位`,
        model: "gpt-image-2",
        status: "ready",
        progress: "待生成",
        error: "",
        label: `${asset.name} · TVC 资产占位`,
        ...metadata,
        assetRole: "result",
        storyRole: "tvc-asset-result",
      },
    );
    createdEdges.push(
      { id: idFactory(), sourceId: specId, targetId: schedulerId },
      { id: idFactory(), sourceId: schedulerId, targetId: resultId },
    );
  });
  return {
    graph: {
      ...graph,
      nodes: [...graph.nodes, ...createdNodes],
      edges: [...graph.edges, ...createdEdges],
    },
    assetRefs: operation.assets.map((asset) => asset.ref),
  };
}

export function writeTvcStoryboardDraft(
  graph: WorkflowGraph,
  operation: TvcWriteStoryboardDraftOperation,
  idFactory: IdFactory = () => crypto.randomUUID(),
) {
  const project = assertProjectId(graph, operation.projectId);
  if (!project.brief) throw new Error("请先完成 TVC 资料梳理。");
  const storyboard = normaliseStoryboard(
    project.title,
    project.brief.targetDuration,
    operation.rows,
    graph,
    project.logo,
  );
  const nextProject: TvcWorkflowState = {
    ...project,
    phase: "script-draft",
    storyboard,
    revision: project.revision + 1,
    lockedAt: undefined,
    lockedRevision: undefined,
    promptPlan: undefined,
    promptUnits: undefined,
    standaloneLogoUnit: undefined,
    promptSourceRevision: undefined,
  };
  const withState = stateWith(graph, nextProject);
  const created = addOrUpdateTvcNode(
    withState,
    "tvc-storyboard",
    project.projectId,
    `${project.title} · TVC 分镜表 · 草案`,
    storyboardText(storyboard),
    idFactory,
    { width: 760, height: 620 },
  );
  const brief = tvcNode(created.graph, "tvc-brief", project.projectId);
  const connected = brief
    ? connectIfMissing(created.graph, brief.id, created.nodeId, idFactory)
    : created.graph;
  const withoutPrompt = removeTvcPromptArtifacts(connected, project.projectId);
  return { graph: withoutPrompt, storyboard, revision: nextProject.revision };
}

export function saveTvcStoryboardTableDraft(
  graph: WorkflowGraph,
  rows: TvcStoryboardTableDraftRow[],
  idFactory: IdFactory = () => crypto.randomUUID(),
) {
  const project = assertTvcProject(graph);
  let startSecond = 0;
  const timedRows = rows.map((row) => {
    const endSecond = startSecond + row.durationSeconds;
    const timedRow: TvcStoryboardDraftRow = {
      ...row,
      startSecond,
      endSecond,
    };
    startSecond = endSecond;
    return timedRow;
  });
  return writeTvcStoryboardDraft(graph, {
    type: "write_tvc_storyboard_draft",
    projectId: project.projectId,
    rows: timedRows,
  }, idFactory);
}

export function lockTvcScript(graph: WorkflowGraph, now = Date.now()) {
  const project = assertTvcProject(graph);
  if (project.phase !== "script-draft" || !project.storyboard) {
    throw new Error("请先完成并校验 TVC 分镜表草案，再锁定剧本。");
  }
  const promptPlan = buildTvcPromptPlan(project.storyboard);
  const nextProject: TvcWorkflowState = {
    ...project,
    phase: "script-locked",
    lockedAt: now,
    lockedRevision: project.revision,
    promptPlan,
    promptUnits: undefined,
    standaloneLogoUnit: undefined,
    promptSourceRevision: undefined,
  };
  const withState = stateWith(graph, nextProject);
  const storyboard = tvcNode(withState, "tvc-storyboard", project.projectId);
  if (!storyboard || storyboard.type !== "source") return withState;
  return {
    ...withState,
    nodes: withState.nodes.map((node) =>
      node.id === storyboard.id
        ? { ...node, label: `${project.title} · TVC 分镜表 · 已锁稿` }
        : node,
    ) as WorkflowNode[],
  };
}

export type TvcPromptPlanSaved = {
  graph: WorkflowGraph;
  plan: TvcPromptPlanSegment[];
  revision: number;
};

function replaceTvcPromptPlan(
  graph: WorkflowGraph,
  project: TvcWorkflowState,
  plan: TvcPromptPlanSegment[],
): TvcPromptPlanSaved {
  const revision = project.revision + 1;
  const nextProject: TvcWorkflowState = {
    ...project,
    phase: "script-locked",
    revision,
    lockedRevision: revision,
    promptPlan: plan,
    promptUnits: undefined,
    standaloneLogoUnit: undefined,
    promptSourceRevision: undefined,
  };
  const withoutPrompt = removeTvcPromptArtifacts(
    stateWith(graph, nextProject),
    project.projectId,
  );
  return { graph: withoutPrompt, plan, revision };
}

export function prepareTvcPromptPlan(
  graph: WorkflowGraph,
): TvcPromptPlanSaved {
  const project = assertTvcProject(graph);
  if (
    (project.phase !== "script-locked" && project.phase !== "prompt-final") ||
    !project.storyboard ||
    project.lockedRevision === undefined
  ) {
    throw new Error("请先锁定 TVC 分镜表，再按 30 秒建立视频片段计划。");
  }
  return replaceTvcPromptPlan(graph, project, buildTvcPromptPlan(project.storyboard));
}

export function saveTvcPromptPlanBoundaries(
  graph: WorkflowGraph,
  boundaries: TvcPromptPlanBoundary[],
): TvcPromptPlanSaved {
  const project = assertTvcProject(graph);
  if (
    (project.phase !== "script-locked" && project.phase !== "prompt-final") ||
    !project.storyboard ||
    project.lockedRevision === undefined
  ) {
    throw new Error("请先锁定 TVC 分镜表，再保存视频片段边界。");
  }
  const plan = buildTvcPromptPlanFromBoundaries(project.storyboard, boundaries);
  return replaceTvcPromptPlan(graph, project, plan);
}

function assertPromptUnits(
  graph: WorkflowGraph,
  project: TvcWorkflowState,
  units: TvcPromptUnit[],
) {
  if (!project.brief || !project.storyboard || !project.promptPlan?.length || !units.length) {
    throw new Error("TVC 最终提示词缺少锁定分镜。");
  }
  if (units.length !== project.promptPlan.length) {
    throw new Error("TVC 最终提示词单元数量必须严格匹配已锁定的视频片段计划。");
  }
  for (const [index, unit] of units.entries()) {
    const segment = project.promptPlan[index]!;
    if (
      !isPromptUnit(unit) ||
      /\b[JL][ -]?cut\b/i.test(unit.prompt)
    ) {
      throw new Error(`TVC 提示词单元 ${unit.ref || "未命名"} 的时长或音频切换规则无效。`);
    }
    if (
      unit.ref !== segment.ref ||
      unit.startSecond !== segment.startSecond ||
      unit.endSecond !== segment.endSecond ||
      unit.shotNumbers.join("\u0000") !== segment.shotNumbers.join("\u0000") ||
      unit.referenceNodeIds.join("\u0000") !== segment.referenceNodeIds.join("\u0000")
    ) {
      throw new Error(`TVC 提示词单元 ${unit.ref} 必须严格匹配已锁定的视频片段计划。`);
    }
    const videoError = tvcVideoUnitError(graph, project, unit);
    if (videoError) throw new Error(videoError);
  }
}

function assertStandaloneLogoUnit(
  graph: WorkflowGraph,
  project: TvcWorkflowState,
  unit: TvcStandaloneLogoUnit | undefined,
) {
  if (project.logo?.placement !== "standalone") {
    if (unit !== undefined) {
      throw new Error("未选择独立 Logo 动效，不能创建独立 Logo 最终提示词。 ");
    }
    return;
  }
  const error = tvcStandaloneLogoUnitError(graph, project, unit);
  if (error) throw new Error(error);
}

export function createTvcPromptPackage(
  graph: WorkflowGraph,
  operation: TvcCreatePromptPackageOperation,
  idFactory: IdFactory = () => crypto.randomUUID(),
) {
  const project = assertProjectId(graph, operation.projectId);
  if (
    (project.phase !== "script-locked" && project.phase !== "prompt-final") ||
    project.lockedRevision === undefined ||
    operation.sourceRevision !== project.lockedRevision ||
    operation.sourceRevision !== project.revision
  ) {
    throw new Error("TVC 剧本尚未锁定或已被修改，不能生成最终提示词。");
  }
  assertPromptUnits(graph, project, operation.units);
  assertStandaloneLogoUnit(graph, project, operation.standaloneLogoUnit);
  const nextProject: TvcWorkflowState = {
    ...project,
    phase: "prompt-final",
    promptUnits: operation.units,
    standaloneLogoUnit: operation.standaloneLogoUnit,
    promptSourceRevision: operation.sourceRevision,
  };
  const withState = stateWith(graph, nextProject);
  const created = addOrUpdateTvcNode(
    withState,
    "tvc-prompt",
    project.projectId,
    `${project.title} · TVC 最终提示词`,
    promptText(operation.units),
    idFactory,
    { width: 760, height: 620 },
  );
  const storyboard = tvcNode(created.graph, "tvc-storyboard", project.projectId);
  const connected = storyboard
    ? connectIfMissing(created.graph, storyboard.id, created.nodeId, idFactory)
    : created.graph;
  const synced = syncTvcVideoWorkflow(connected, idFactory);
  const standalone = syncTvcStandaloneLogoVideoWorkflow(synced.graph, idFactory);
  return {
    graph: standalone.graph,
    promptNodeId: created.nodeId,
    schedulerIds: standalone.schedulerId
      ? [...synced.schedulerIds, standalone.schedulerId]
      : synced.schedulerIds,
  };
}

export function applyTvcOperation(
  graph: WorkflowGraph,
  operation: TvcOperation,
  idFactory: IdFactory = () => crypto.randomUUID(),
) {
  if (operation.type === "create_tvc_brief") return createTvcBrief(graph, operation, idFactory);
  if (operation.type === "update_tvc_brief") return updateTvcBrief(graph, operation, idFactory);
  if (operation.type === "create_tvc_asset_plan") return createTvcAssetPlan(graph, operation, idFactory);
  if (operation.type === "write_tvc_storyboard_draft") return writeTvcStoryboardDraft(graph, operation, idFactory);
  return createTvcPromptPackage(graph, operation, idFactory);
}

export function isTvcOperation(operation: { type: string }): operation is TvcOperation {
  return [
    "create_tvc_brief",
    "update_tvc_brief",
    "create_tvc_asset_plan",
    "write_tvc_storyboard_draft",
    "create_tvc_prompt_package",
  ].includes(operation.type);
}

export function tvcAssetResultNodes(graph: WorkflowGraph, projectId: string) {
  return graph.nodes.filter(
    (node): node is WorkflowResultNode =>
      node.type === "result" &&
      node.tvcProjectId === projectId &&
      node.storyRole === "tvc-asset-result",
  );
}
