import {
  DEFAULT_MODEL_BY_MODE,
  getModelConfig,
  isComposerMode,
  type ComposerMode,
} from "../ai/models.ts";
import type { TaskStatusResponse } from "../ai/types";
import type {
  AgentCreateStoryWorkflowOperation,
  AgentMangaPlanningStage,
  AgentMangaPlanningStatus,
  AgentMangaStoryboardTempo,
  AgentStoryboardMode,
  ContinuityReport,
  MangaVideoSegment,
  ScenePlan,
  ShotPlan,
  StoryBeat,
} from "../ai/agent.ts";
import {
  isPersistedContinuityReport,
  isPersistedScenePlan,
  isPersistedShotPlan,
  isPersistedStoryBeats,
} from "../ai/agent.ts";

export const WORKFLOW_STORAGE_KEY = "lingke-workflow-canvas-v1";
export const WORKFLOW_VERSION = 1;
export const WORKFLOW_NODE_WIDTH = 288;
export const WORKFLOW_NODE_HEIGHT = 200;
export const WORKFLOW_NODE_HEADER_HEIGHT = 42;
export const WORKFLOW_IMAGE_PREVIEW_EDGE = 288;
export const WORKFLOW_INPUT_PORT_X = 20;
export const WORKFLOW_INPUT_FIRST_Y = 88;
export const WORKFLOW_INPUT_ROW_STEP = 30;
const WORKFLOW_MEDIA_MIN_EDGE = 96;
const WORKFLOW_MEDIA_MAX_EDGE = 1200;

export function workflowImageMimeType(
  blobType: string,
  assetMimeType: string | undefined,
  resultUrl: string | undefined,
) {
  if (blobType.startsWith("image/")) return blobType;
  if (assetMimeType?.startsWith("image/")) return assetMimeType;
  const path = resultUrl?.split(/[?#]/, 1)[0].toLowerCase() ?? "";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  return "";
}

export type WorkflowNodeStatus =
  | "ready"
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "paused";

export type WorkflowStoryRole =
  | "project"
  | "analysis"
  | "asset-spec"
  | "asset-scheduler"
  | "asset-result"
  | "story-beats"
  | "scene-plan"
  | "shot"
  | "continuity-report"
  | "storyboard-scheduler"
  | "storyboard"
  | "video-scheduler"
  | "clip";

export type WorkflowAssetKind = "character" | "scene" | "prop";
export type WorkflowAssetRole = "spec" | "scheduler" | "result";
export type WorkflowAssetPlanningStage =
  | "character"
  | "scene"
  | "prop"
  | "complete";
export type WorkflowAssetPlanningStatus =
  | "planning"
  | "awaiting-foundation-generation"
  | "awaiting-foundation-approval"
  | "stopped"
  | "failed"
  | "complete";

type WorkflowNodeBase = {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  label?: string;
  storyId?: string;
  shotRef?: string;
  storyRole?: WorkflowStoryRole;
  assetRef?: string;
  assetKind?: WorkflowAssetKind;
  assetRole?: WorkflowAssetRole;
  foundationRole?: "lead" | "support";
  assetStrategy?: "foundation-pair-v1";
  foundationApprovedAt?: number;
  storyboardMode?: AgentStoryboardMode;
  mangaStoryboardTempo?: AgentMangaStoryboardTempo;
  storyVisualStyle?: string;
  planningStage?: WorkflowAssetPlanningStage;
  planningStatus?: WorkflowAssetPlanningStatus;
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
};

export type WorkflowSourceNode = WorkflowNodeBase & {
  type: "source";
  kind: ComposerMode;
  text: string;
  assetId?: string;
  assetName?: string;
  assetMimeType?: string;
};

export type WorkflowSchedulerNode = WorkflowNodeBase & {
  type: "scheduler";
  outputKind: ComposerMode;
  model: string;
  prompt: string;
  aspectRatio: string;
  resolution: string;
  duration: string;
  outputCount: number;
  error: string;
};

export type WorkflowResultNode = WorkflowNodeBase & {
  type: "result";
  kind: ComposerMode;
  schedulerId: string;
  text: string;
  model: string;
  status: WorkflowNodeStatus;
  progress: string;
  error: string;
  resultUrl?: string;
  assetId?: string;
  assetName?: string;
  assetMimeType?: string;
  taskId?: string;
  startedAt?: number;
};

export type WorkflowNode =
  | WorkflowSourceNode
  | WorkflowSchedulerNode
  | WorkflowResultNode;

export type WorkflowEdge = {
  id: string;
  sourceId: string;
  targetId: string;
};

export type WorkflowInputPort = {
  edgeId: string;
  sourceId: string;
  targetId: string;
  kind: ComposerMode;
  label: string;
  sourceName: string;
  x: number;
  y: number;
};

export type WorkflowGraph = {
  version: 1;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type WorkflowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WorkflowResizeCorner =
  | "north-west"
  | "north-east"
  | "south-west"
  | "south-east";

export type WorkflowInputs = {
  text: string[];
  images: Array<WorkflowSourceNode | WorkflowResultNode>;
  videos: Array<WorkflowSourceNode | WorkflowResultNode>;
};

type IdFactory = () => string;

export function emptyWorkflowGraph(): WorkflowGraph {
  return { version: WORKFLOW_VERSION, nodes: [], edges: [] };
}

function validBase(node: Partial<WorkflowNode>) {
  return (
    typeof node.id === "string" &&
    typeof node.x === "number" &&
    Number.isFinite(node.x) &&
    typeof node.y === "number" &&
    Number.isFinite(node.y) &&
    ((node.width === undefined && node.height === undefined) ||
      (typeof node.width === "number" &&
        Number.isFinite(node.width) &&
        node.width > 0 &&
        typeof node.height === "number" &&
        Number.isFinite(node.height) &&
        node.height > 0)) &&
    (node.label === undefined || typeof node.label === "string") &&
    (node.storyId === undefined || typeof node.storyId === "string") &&
    (node.shotRef === undefined || typeof node.shotRef === "string") &&
    (node.storyRole === undefined ||
      [
        "project",
        "analysis",
        "asset-spec",
        "asset-scheduler",
        "asset-result",
        "story-beats",
        "scene-plan",
        "shot",
        "continuity-report",
        "storyboard-scheduler",
        "storyboard",
        "video-scheduler",
        "clip",
      ].includes(node.storyRole)) &&
    (node.assetRef === undefined || typeof node.assetRef === "string") &&
    (node.assetKind === undefined ||
      ["character", "scene", "prop"].includes(node.assetKind)) &&
    (node.assetRole === undefined ||
      ["spec", "scheduler", "result"].includes(node.assetRole)) &&
    (node.foundationRole === undefined ||
      ["lead", "support"].includes(node.foundationRole)) &&
    (node.assetStrategy === undefined ||
      node.assetStrategy === "foundation-pair-v1") &&
    (node.foundationApprovedAt === undefined ||
      (typeof node.foundationApprovedAt === "number" &&
        Number.isFinite(node.foundationApprovedAt))) &&
    (node.storyboardMode === undefined ||
      node.storyboardMode === "comic" ||
      node.storyboardMode === "tvc") &&
    (node.mangaStoryboardTempo === undefined ||
      node.mangaStoryboardTempo === "long-form" ||
      node.mangaStoryboardTempo === "short-cut") &&
    (node.storyVisualStyle === undefined ||
      typeof node.storyVisualStyle === "string") &&
    (node.planningStage === undefined ||
      ["character", "scene", "prop", "complete"].includes(node.planningStage)) &&
    (node.planningStatus === undefined ||
      [
        "planning",
        "awaiting-foundation-generation",
        "awaiting-foundation-approval",
        "stopped",
        "failed",
        "complete",
      ].includes(node.planningStatus)) &&
    (node.planningChunkIndex === undefined ||
      (Number.isInteger(node.planningChunkIndex) && node.planningChunkIndex >= 0)) &&
    (node.projectAspectRatio === undefined ||
      typeof node.projectAspectRatio === "string") &&
    (node.storyImageModel === undefined || typeof node.storyImageModel === "string")
    && (node.mangaPlanningStage === undefined || [
      "story-beats",
      "scene-plans",
      "shot-plans",
      "continuity",
      "complete",
    ].includes(node.mangaPlanningStage))
    && (node.mangaPlanningStatus === undefined || [
      "planning",
      "stopped",
      "failed",
      "awaiting-continuity-approval",
      "complete",
    ].includes(node.mangaPlanningStatus))
    && (node.mangaPlanningChunkIndex === undefined ||
      (Number.isInteger(node.mangaPlanningChunkIndex) && node.mangaPlanningChunkIndex >= 0))
    && (node.continuityApprovedAt === undefined ||
      (typeof node.continuityApprovedAt === "number" &&
        Number.isFinite(node.continuityApprovedAt)))
    && (node.storyBeats === undefined || isPersistedStoryBeats(node.storyBeats))
    && (node.scenePlan === undefined || isPersistedScenePlan(node.scenePlan))
    && (node.shotPlan === undefined || isPersistedShotPlan(node.shotPlan))
    && (node.continuityReport === undefined ||
      isPersistedContinuityReport(node.continuityReport))
    && (node.videoSegment === undefined ||
      typeof node.videoSegment.segmentId === "string" &&
      Array.isArray(node.videoSegment.shotIds) &&
      node.videoSegment.shotIds.every((id) => typeof id === "string") &&
      Array.isArray(node.videoSegment.sceneIds) &&
      node.videoSegment.sceneIds.every((id) => typeof id === "string") &&
      Number.isInteger(node.videoSegment.duration) &&
      node.videoSegment.duration >= 4 &&
      node.videoSegment.duration <= 30 &&
      Array.isArray(node.videoSegment.referenceNodeIds) &&
      node.videoSegment.referenceNodeIds.every((id) => typeof id === "string"))
  );
}

function isWorkflowNode(value: unknown): value is WorkflowNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<WorkflowNode>;
  if (!validBase(node)) return false;
  if (node.type === "source") {
    return (
      isComposerMode(node.kind) &&
      typeof node.text === "string" &&
      (node.assetId === undefined || typeof node.assetId === "string")
    );
  }
  if (node.type === "scheduler") {
    return (
      isComposerMode(node.outputKind) &&
      typeof node.model === "string" &&
      typeof node.prompt === "string" &&
      typeof node.aspectRatio === "string" &&
      typeof node.resolution === "string" &&
      typeof node.duration === "string" &&
      typeof node.outputCount === "number" &&
      Number.isInteger(node.outputCount) &&
      node.outputCount >= 1 &&
      node.outputCount <= 4 &&
      typeof node.error === "string"
    );
  }
  if (node.type === "result") {
    return (
      isComposerMode(node.kind) &&
      typeof node.schedulerId === "string" &&
      typeof node.text === "string" &&
      typeof node.model === "string" &&
      ["ready", "pending", "running", "success", "failed", "paused"].includes(
        String(node.status),
      ) &&
      typeof node.progress === "string" &&
      typeof node.error === "string" &&
      (node.assetId === undefined || typeof node.assetId === "string") &&
      (node.assetName === undefined || typeof node.assetName === "string") &&
      (node.assetMimeType === undefined || typeof node.assetMimeType === "string")
    );
  }
  return false;
}

function isWorkflowEdge(value: unknown): value is WorkflowEdge {
  if (!value || typeof value !== "object") return false;
  const edge = value as Partial<WorkflowEdge>;
  return (
    typeof edge.id === "string" &&
    typeof edge.sourceId === "string" &&
    typeof edge.targetId === "string"
  );
}

export function parseWorkflowGraph(raw: string | null): WorkflowGraph {
  if (!raw) return emptyWorkflowGraph();
  try {
    const value = JSON.parse(raw) as Partial<WorkflowGraph>;
    if (
      value.version !== WORKFLOW_VERSION ||
      !Array.isArray(value.nodes) ||
      !value.nodes.every(isWorkflowNode) ||
      !Array.isArray(value.edges) ||
      !value.edges.every(isWorkflowEdge)
    ) {
      return emptyWorkflowGraph();
    }
    const ids = new Set(value.nodes.map((node) => node.id));
    const legacyVideoModels = new Set([
      "doubao-seedance-1-5-pro-251215",
      "viduq3",
    ]);
    const nodes = value.nodes.map((node) => {
      if (
        node.type === "scheduler" &&
        node.outputKind === "video" &&
        legacyVideoModels.has(node.model)
      ) {
        return { ...node, model: DEFAULT_MODEL_BY_MODE.video };
      }
      if (
        node.type === "result" &&
        node.kind === "video" &&
        node.status !== "success" &&
        legacyVideoModels.has(node.model)
      ) {
        return { ...node, model: DEFAULT_MODEL_BY_MODE.video };
      }
      return node;
    });
    return {
      version: WORKFLOW_VERSION,
      nodes,
      edges: value.edges.filter(
        (edge) => ids.has(edge.sourceId) && ids.has(edge.targetId),
      ),
    };
  } catch {
    return emptyWorkflowGraph();
  }
}

export function schedulerDefaults(outputKind: ComposerMode) {
  const model = DEFAULT_MODEL_BY_MODE[outputKind];
  const config = getModelConfig(outputKind, model);
  return {
    outputKind,
    model,
    aspectRatio: config?.aspectRatios[0] ?? "",
    resolution: config?.defaultResolution ?? config?.resolutions[0] ?? "",
    duration: config?.durations[0] ?? "",
    outputCount: 1,
  };
}

export function createWorkflowNode(
  graph: WorkflowGraph,
  type: ComposerMode | "scheduler",
  point: { x: number; y: number },
  idFactory: IdFactory = () => crypto.randomUUID(),
): { graph: WorkflowGraph; nodeId: string } {
  const id = idFactory();
  const base = { id, x: point.x, y: point.y };
  const node: WorkflowNode =
    type === "scheduler"
      ? {
          ...base,
          type: "scheduler",
          ...schedulerDefaults("image"),
          prompt: "",
          error: "",
          height: 360,
        }
      : { ...base, type: "source", kind: type, text: "" };
  return {
    graph: { ...graph, nodes: [...graph.nodes, node] },
    nodeId: id,
  };
}

export function createStoryWorkflow(
  graph: WorkflowGraph,
  operation: AgentCreateStoryWorkflowOperation,
  idFactory: IdFactory = () => crypto.randomUUID(),
  storyIdOverride?: string,
): { graph: WorkflowGraph; storyId: string } {
  if (!operation.isFinal || operation.chunkIndex !== 0 || !operation.shots.length) {
    throw new Error("短剧工作流方案尚未完整，未创建节点。");
  }
  const shotRefs = operation.shots.map((shot) => shot.ref);
  if (new Set(shotRefs).size !== shotRefs.length) {
    throw new Error("短剧工作流包含重复分镜编号。");
  }
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  operation.shots.forEach((shot) => {
    shot.referenceNodeIds.forEach((nodeId) => {
      const node = nodesById.get(nodeId);
      const usable =
        node &&
        node.type !== "scheduler" &&
        node.kind === "image" &&
        ((node.type === "source" && Boolean(node.assetId)) ||
          (node.type === "result" && node.status === "success" && Boolean(node.resultUrl)));
      if (!usable) throw new Error(`分镜 ${shot.ref} 引用了不可用的图片节点 ${nodeId}。`);
    });
  });

  const storyId = storyIdOverride ?? idFactory();
  const right = graph.nodes.reduce((maximum, node) => {
    const size = getWorkflowNodeSize(node);
    return Math.max(maximum, node.x + size.width);
  }, -160);
  const top = graph.nodes.length
    ? Math.min(...graph.nodes.map((node) => node.y))
    : 0;
  const originX = right + 160;
  const originY = top;
  const columnGap = 120;
  const columnStep = WORKFLOW_NODE_WIDTH + columnGap;
  const rowStep = 440;
  const createdNodes: WorkflowNode[] = [];
  const createdEdges: WorkflowEdge[] = [];
  const connect = (sourceId: string, targetId: string) => {
    createdEdges.push({ id: idFactory(), sourceId, targetId });
  };

  const projectId = idFactory();
  createdNodes.push({
    id: projectId,
    x: originX,
    y: originY,
    type: "source",
    kind: "text",
    text: operation.globalContext,
    label: `${operation.title} · 项目设定`,
    storyId,
    storyRole: "project",
  });

  operation.shots.forEach((shot, index) => {
    const y = originY + rowStep * (index + 1);
    const shotId = idFactory();
    const imageSchedulerId = idFactory();
    const imageResultId = idFactory();
    const videoSchedulerId = idFactory();
    const videoResultId = idFactory();
    const metadata = { storyId, shotRef: shot.ref };
    createdNodes.push(
      {
        id: shotId,
        x: originX,
        y,
        type: "source",
        kind: "text",
        text: shot.script,
        label: `${shot.ref} · ${shot.title}`,
        ...metadata,
        storyRole: "shot",
      },
      {
        id: imageSchedulerId,
        x: originX + columnStep,
        y,
        width: WORKFLOW_NODE_WIDTH,
        height: 360,
        type: "scheduler",
        outputKind: "image",
        model: operation.imageModel,
        prompt: shot.imagePrompt,
        aspectRatio: operation.aspectRatio,
        resolution: operation.imageResolution,
        duration: "",
        outputCount: 1,
        error: "",
        label: `${shot.ref} · 分镜图片`,
        ...metadata,
        storyRole: "storyboard-scheduler",
      },
      {
        id: imageResultId,
        x: originX + columnStep * 2,
        y,
        type: "result",
        kind: "image",
        schedulerId: imageSchedulerId,
        text: `${shot.ref} 分镜图片占位`,
        model: operation.imageModel,
        status: "ready",
        progress: "待生成",
        error: "",
        label: `${shot.ref} · 分镜图片占位`,
        ...metadata,
        storyRole: "storyboard",
      },
      {
        id: videoSchedulerId,
        x: originX + columnStep * 3,
        y,
        width: WORKFLOW_NODE_WIDTH,
        height: 360,
        type: "scheduler",
        outputKind: "video",
        model: operation.videoModel,
        prompt: shot.videoPrompt,
        aspectRatio: operation.aspectRatio,
        resolution: operation.videoResolution,
        duration: shot.duration,
        outputCount: 1,
        error: "",
        label: `${shot.ref} · 视频片段`,
        ...metadata,
        storyRole: "video-scheduler",
      },
      {
        id: videoResultId,
        x: originX + columnStep * 4,
        y,
        type: "result",
        kind: "video",
        schedulerId: videoSchedulerId,
        text: `${shot.ref} 视频片段占位`,
        model: operation.videoModel,
        status: "ready",
        progress: "待生成",
        error: "",
        label: `${shot.ref} · 视频片段占位`,
        ...metadata,
        storyRole: "clip",
      },
    );
    connect(projectId, imageSchedulerId);
    connect(shotId, imageSchedulerId);
    shot.referenceNodeIds.forEach((nodeId) => connect(nodeId, imageSchedulerId));
    connect(imageSchedulerId, imageResultId);
    connect(projectId, videoSchedulerId);
    connect(shotId, videoSchedulerId);
    connect(imageResultId, videoSchedulerId);
    shot.referenceNodeIds.forEach((nodeId) => {
      const node = nodesById.get(nodeId);
      if (node?.assetKind === "character" || node?.assetKind === "scene") {
        connect(nodeId, videoSchedulerId);
      }
    });
    connect(videoSchedulerId, videoResultId);
  });

  return {
    storyId,
    graph: {
      ...graph,
      nodes: [...graph.nodes, ...createdNodes],
      edges: [...graph.edges, ...createdEdges],
    },
  };
}

export function getWorkflowNodeSize(node: WorkflowNode) {
  return {
    width: node.width ?? WORKFLOW_NODE_WIDTH,
    height:
      node.height ?? (node.type === "scheduler" ? 360 : WORKFLOW_NODE_HEIGHT),
  };
}

export function getWorkflowNodeBounds(node: WorkflowNode): WorkflowBounds {
  return { x: node.x, y: node.y, ...getWorkflowNodeSize(node) };
}

export function workflowNodesIntersecting(
  graph: WorkflowGraph,
  bounds: WorkflowBounds,
): string[] {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  return graph.nodes
    .filter((node) => {
      const item = getWorkflowNodeBounds(node);
      return (
        item.x <= right &&
        item.x + item.width >= bounds.x &&
        item.y <= bottom &&
        item.y + item.height >= bounds.y
      );
    })
    .map((node) => node.id);
}

export function workflowSelectionBounds(
  graph: WorkflowGraph,
  ids: readonly string[],
): WorkflowBounds | null {
  const selected = graph.nodes.filter((node) => ids.includes(node.id));
  if (!selected.length) return null;
  const bounds = selected.map(getWorkflowNodeBounds);
  const x = Math.min(...bounds.map((item) => item.x));
  const y = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function moveWorkflowNodes(
  graph: WorkflowGraph,
  ids: readonly string[],
  deltaX: number,
  deltaY: number,
): WorkflowGraph {
  const selected = new Set(ids);
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      selected.has(node.id)
        ? { ...node, x: node.x + deltaX, y: node.y + deltaY }
        : node,
    ),
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function constrainWorkflowMediaSize(width: number, height: number) {
  const minimumScale = WORKFLOW_MEDIA_MIN_EDGE / Math.min(width, height);
  const maximumScale = WORKFLOW_MEDIA_MAX_EDGE / Math.max(width, height);
  const scale =
    minimumScale > maximumScale
      ? maximumScale
      : clamp(1, minimumScale, maximumScale);
  return { width: width * scale, height: height * scale };
}

export function fitWorkflowImageNode(
  graph: WorkflowGraph,
  nodeId: string,
  naturalWidth: number,
  naturalHeight: number,
): WorkflowGraph {
  if (
    !Number.isFinite(naturalWidth) ||
    naturalWidth <= 0 ||
    !Number.isFinite(naturalHeight) ||
    naturalHeight <= 0
  ) {
    return graph;
  }
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (
    !node ||
    node.type === "scheduler" ||
    node.kind !== "image" ||
    node.width !== undefined ||
    node.height !== undefined
  ) {
    return graph;
  }
  const current = getWorkflowNodeSize(node);
  const previewScale =
    WORKFLOW_IMAGE_PREVIEW_EDGE / Math.max(naturalWidth, naturalHeight);
  const visual = constrainWorkflowMediaSize(
    naturalWidth * previewScale,
    naturalHeight * previewScale,
  );
  const width = visual.width;
  const height = visual.height + WORKFLOW_NODE_HEADER_HEIGHT;
  return resizeWorkflowNode(graph, nodeId, {
    x: node.x + (current.width - width) / 2,
    y: node.y + (current.height - height) / 2,
    width,
    height,
  });
}

export function resizedWorkflowNodeBounds(
  node: WorkflowNode,
  corner: WorkflowResizeCorner,
  point: { x: number; y: number },
): WorkflowBounds {
  const size = getWorkflowNodeSize(node);
  const west = corner.endsWith("west");
  const north = corner.startsWith("north");
  const oppositeX = west ? node.x + size.width : node.x;
  const oppositeY = north ? node.y + size.height : node.y;
  const rawWidth = Math.max(1, west ? oppositeX - point.x : point.x - oppositeX);
  const rawHeight = Math.max(1, north ? oppositeY - point.y : point.y - oppositeY);
  const image =
    node.type !== "scheduler" && node.kind === "image";
  const media =
    node.type !== "scheduler" &&
    (node.kind === "image" || node.kind === "video");
  let width: number;
  let height: number;
  if (image) {
    const currentVisualWidth = size.width;
    const currentVisualHeight = Math.max(
      1,
      size.height - WORKFLOW_NODE_HEADER_HEIGHT,
    );
    const rawVisualWidth = rawWidth;
    const rawVisualHeight = Math.max(
      1,
      rawHeight - WORKFLOW_NODE_HEADER_HEIGHT,
    );
    const scale = Math.max(
      rawVisualWidth / currentVisualWidth,
      rawVisualHeight / currentVisualHeight,
    );
    const visual = constrainWorkflowMediaSize(
      currentVisualWidth * scale,
      currentVisualHeight * scale,
    );
    width = visual.width;
    height = visual.height + WORKFLOW_NODE_HEADER_HEIGHT;
  } else if (media) {
    const scale = Math.max(rawWidth / size.width, rawHeight / size.height);
    const requestedWidth = size.width * scale;
    const requestedHeight = size.height * scale;
    const minimumScale = 96 / Math.min(requestedWidth, requestedHeight);
    const maximumScale = 1200 / Math.max(requestedWidth, requestedHeight);
    const constrainedScale =
      minimumScale > maximumScale
        ? maximumScale
        : clamp(1, minimumScale, maximumScale);
    width = requestedWidth * constrainedScale;
    height = requestedHeight * constrainedScale;
  } else {
    width = clamp(rawWidth, 180, 1200);
    height = clamp(rawHeight, 120, 1200);
  }
  return {
    x: west ? oppositeX - width : oppositeX,
    y: north ? oppositeY - height : oppositeY,
    width,
    height,
  };
}

export function resizeWorkflowNode(
  graph: WorkflowGraph,
  nodeId: string,
  bounds: WorkflowBounds,
): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === nodeId ? { ...node, ...bounds } : node,
    ),
  };
}

export function updateWorkflowNode(
  graph: WorkflowGraph,
  nodeId: string,
  update: Partial<WorkflowNode>,
): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === nodeId ? ({ ...node, ...update } as WorkflowNode) : node,
    ),
  };
}

export function connectWorkflowNodes(
  graph: WorkflowGraph,
  sourceId: string,
  targetId: string,
  idFactory: IdFactory = () => crypto.randomUUID(),
): WorkflowGraph {
  const source = graph.nodes.find((node) => node.id === sourceId);
  const target = graph.nodes.find((node) => node.id === targetId);
  if (
    !source ||
    !target ||
    sourceId === targetId ||
    source.type === "scheduler" ||
    target.type !== "scheduler" ||
    graph.edges.some(
      (edge) => edge.sourceId === sourceId && edge.targetId === targetId,
    )
  ) {
    return graph;
  }
  return {
    ...graph,
    edges: [...graph.edges, { id: idFactory(), sourceId, targetId }],
  };
}

export function createConnectedScheduler(
  graph: WorkflowGraph,
  anchorId: string,
  outputKind: ComposerMode,
  idFactory: IdFactory = () => crypto.randomUUID(),
): { graph: WorkflowGraph; nodeId: string | null } {
  const anchor = graph.nodes.find((node) => node.id === anchorId);
  if (!anchor || anchor.type === "scheduler") return { graph, nodeId: null };

  const anchorSize = getWorkflowNodeSize(anchor);
  const width = WORKFLOW_NODE_WIDTH;
  const height = 360;
  const x = anchor.x + anchorSize.width + 120;
  const baseY = anchor.y + anchorSize.height / 2 - height / 2;
  let y = baseY;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const direction = attempt === 0 ? 0 : attempt % 2 === 1 ? 1 : -1;
    const distance = Math.ceil(attempt / 2) * (height + 24);
    const candidateY = baseY + direction * distance;
    const occupied = graph.nodes.some((node) => {
      const size = getWorkflowNodeSize(node);
      return (
        x < node.x + size.width + 24 &&
        x + width + 24 > node.x &&
        candidateY < node.y + size.height + 24 &&
        candidateY + height + 24 > node.y
      );
    });
    if (!occupied) {
      y = candidateY;
      break;
    }
  }

  const nodeId = idFactory();
  const scheduler: WorkflowSchedulerNode = {
    id: nodeId,
    x,
    y,
    width,
    height,
    type: "scheduler",
    ...schedulerDefaults(outputKind),
    prompt: "",
    error: "",
  };
  return {
    graph: {
      ...graph,
      nodes: [...graph.nodes, scheduler],
      edges: [
        ...graph.edges,
        { id: idFactory(), sourceId: anchor.id, targetId: nodeId },
      ],
    },
    nodeId,
  };
}

export function readWorkflowInputs(
  graph: WorkflowGraph,
  schedulerId: string,
): WorkflowInputs {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const text: string[] = [];
  const images: WorkflowInputs["images"] = [];
  const videos: WorkflowInputs["videos"] = [];
  graph.edges
    .filter((edge) => edge.targetId === schedulerId)
    .forEach((edge) => {
      const node = nodes.get(edge.sourceId);
      if (!node || node.type === "scheduler") return;
      const kind = node.kind;
      if (kind === "text" && node.text.trim()) text.push(node.text.trim());
      if (kind === "image") images.push(node);
      if (kind === "video") videos.push(node);
    });
  return { text, images, videos };
}

export function buildWorkflowPrompt(
  inputs: WorkflowInputs,
  ownPrompt: string,
): string {
  return [...inputs.text, ownPrompt.trim()].filter(Boolean).join("\n\n");
}

export function buildWorkflowGenerationPrompt(
  inputs: WorkflowInputs,
  scheduler: WorkflowSchedulerNode,
): string {
  if (
    scheduler.storyRole === "asset-scheduler" ||
    scheduler.storyRole === "storyboard-scheduler"
  ) {
    return scheduler.prompt.trim();
  }
  if (scheduler.storyRole === "video-scheduler") {
    const hasStoryReferences = inputs.images.some(
      (node) =>
        node.storyRole === "storyboard" ||
        node.assetKind === "character" ||
        node.assetKind === "scene",
    );
    if (!hasStoryReferences) return scheduler.prompt.trim();
    const references = inputs.images.map((node, index) => {
      const role = node.storyRole === "storyboard"
        ? "分镜首帧"
        : node.assetKind === "character"
          ? "人物资产"
          : node.assetKind === "scene"
            ? "场景资产"
            : "参考图";
      return `图${index + 1}：${role} · ${node.label || node.assetName || node.text}`;
    });
    const guide = references.length
      ? [
          "参考素材顺序：",
          ...references,
          "以图1为镜头起始画面和构图基础；同时严格保持后续人物资产的外观、服装和身份，以及场景资产的空间、陈设、光线与时间特征。",
        ].join("\n")
      : "";
    return [guide, scheduler.prompt.trim()].filter(Boolean).join("\n\n");
  }
  return buildWorkflowPrompt(inputs, scheduler.prompt);
}

function availableResultPosition(
  graph: WorkflowGraph,
  scheduler: WorkflowSchedulerNode,
  index: number,
) {
  const schedulerSize = getWorkflowNodeSize(scheduler);
  const x = scheduler.x + schedulerSize.width + 120;
  const baseY = scheduler.y + index * (WORKFLOW_NODE_HEIGHT + 24);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const y = baseY + attempt * (WORKFLOW_NODE_HEIGHT + 24);
    const occupied = graph.nodes.some((node) => {
      const size = getWorkflowNodeSize(node);
      return (
        x < node.x + size.width + 24 &&
        x + WORKFLOW_NODE_WIDTH + 24 > node.x &&
        y < node.y + size.height + 24 &&
        y + WORKFLOW_NODE_HEIGHT + 24 > node.y
      );
    });
    if (!occupied) return { x, y };
  }
  return { x, y: baseY };
}

export function createWorkflowRun(
  graph: WorkflowGraph,
  schedulerId: string,
  now: number,
  idFactory: IdFactory = () => crypto.randomUUID(),
): { graph: WorkflowGraph; resultIds: string[] } {
  const scheduler = graph.nodes.find(
    (node): node is WorkflowSchedulerNode =>
      node.id === schedulerId && node.type === "scheduler",
  );
  if (!scheduler) return { graph, resultIds: [] };
  const count = scheduler.outputKind === "text" ? 1 : scheduler.outputCount;
  const storyResults = graph.nodes.filter(
    (node): node is WorkflowResultNode =>
      node.type === "result" &&
      node.schedulerId === scheduler.id &&
      Boolean(node.storyId) &&
      (node.storyRole === "storyboard" ||
        node.storyRole === "clip" ||
        node.storyRole === "asset-result"),
  );
  if (storyResults.length) {
    if (
      storyResults.some(
        (node) => node.status === "pending" || node.status === "running",
      )
    ) {
      return { graph, resultIds: [] };
    }
    const reusable = storyResults.slice(0, count);
    return {
      resultIds: reusable.map((node) => node.id),
      graph: {
        ...graph,
        nodes: graph.nodes.map((node) =>
          reusable.some((candidate) => candidate.id === node.id)
            ? {
                ...node,
                ...(node.type === "result" && node.kind === "image"
                  ? { width: undefined, height: undefined }
                  : {}),
                status: "pending" as const,
                progress: "等待提交",
                error: "",
                model: scheduler.model,
                resultUrl: undefined,
                taskId: undefined,
                startedAt: now,
              }
            : node,
        ),
      },
    };
  }
  let next = graph;
  const resultIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = idFactory();
    const point = availableResultPosition(next, scheduler, index);
    const result: WorkflowResultNode = {
      id,
      ...point,
      type: "result",
      kind: scheduler.outputKind,
      schedulerId,
      text: "",
      model: scheduler.model,
      status: "pending",
      progress: "等待提交",
      error: "",
      startedAt: now,
    };
    next = {
      ...next,
      nodes: [...next.nodes, result],
      edges: [
        ...next.edges,
        { id: idFactory(), sourceId: schedulerId, targetId: id },
      ],
    };
    resultIds.push(id);
  }
  return { graph: next, resultIds };
}

export function updateWorkflowResult(
  graph: WorkflowGraph,
  resultId: string,
  update: Partial<WorkflowResultNode>,
): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === resultId && node.type === "result"
        ? { ...node, ...update }
        : node,
    ),
  };
}

export function applyWorkflowTaskStatus(
  graph: WorkflowGraph,
  resultId: string,
  status: TaskStatusResponse,
  idFactory: IdFactory = () => crypto.randomUUID(),
): WorkflowGraph {
  const result = graph.nodes.find(
    (node): node is WorkflowResultNode =>
      node.id === resultId && node.type === "result",
  );
  if (!result) return graph;
  const first = status.results[0];
  let next = updateWorkflowResult(graph, resultId, {
    status:
      status.state === "success"
        ? "success"
        : status.state === "failed"
          ? "failed"
          : status.state,
    progress: status.progress,
    error: status.error,
    resultUrl: first?.url ?? result.resultUrl,
    assetId: first?.assetId ?? result.assetId,
    assetName: first?.assetName ?? result.assetName,
    assetMimeType: first?.assetMimeType ?? result.assetMimeType,
  });
  if (status.state !== "success" || status.results.length <= 1) return next;
  const scheduler = next.nodes.find(
    (node): node is WorkflowSchedulerNode =>
      node.id === result.schedulerId && node.type === "scheduler",
  );
  if (!scheduler) return next;
  status.results.slice(1).forEach((taskResult, index) => {
    const id = idFactory();
    const point = availableResultPosition(next, scheduler, index + 1);
    next = {
      ...next,
      nodes: [
        ...next.nodes,
        {
          ...result,
          id,
          ...point,
          status: "success",
          progress: "",
          error: "",
          resultUrl: taskResult.url,
          assetId: taskResult.assetId,
          assetName: taskResult.assetName,
          assetMimeType: taskResult.assetMimeType,
          taskId: undefined,
        },
      ],
      edges: [
        ...next.edges,
        { id: idFactory(), sourceId: scheduler.id, targetId: id },
      ],
    };
  });
  return next;
}

export function removeWorkflowNode(
  graph: WorkflowGraph,
  nodeId: string,
): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.id !== nodeId),
    edges: graph.edges.filter(
      (edge) => edge.sourceId !== nodeId && edge.targetId !== nodeId,
    ),
  };
}

export function removeWorkflowEdge(
  graph: WorkflowGraph,
  edgeId: string,
): WorkflowGraph {
  if (!graph.edges.some((edge) => edge.id === edgeId)) return graph;
  return {
    ...graph,
    edges: graph.edges.filter((edge) => edge.id !== edgeId),
  };
}

function inputPortLabel(kind: ComposerMode, index: number, total: number) {
  if (kind === "image") return `图${index}`;
  if (kind === "video") return `视频${index}`;
  return total === 1 ? "文本" : `文本${index}`;
}

function workflowNodeDisplayName(node: WorkflowNode) {
  if (node.label?.trim()) return node.label.trim();
  if (node.type === "source" && node.assetName?.trim()) {
    return node.assetName.trim();
  }
  const kind = node.type === "scheduler" ? node.outputKind : node.kind;
  const kindName = kind === "image" ? "图片" : kind === "video" ? "视频" : "文本";
  if (node.type === "source") return `${kindName}素材`;
  if (node.type === "result") return `结果 · ${kindName}`;
  return "通用调度";
}

export function workflowEdgeKinds(graph: WorkflowGraph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return new Map(
    graph.edges.flatMap((edge) => {
      const source = nodes.get(edge.sourceId);
      if (!source) return [];
      return [[
        edge.id,
        source.type === "scheduler" ? source.outputKind : source.kind,
      ] as const];
    }),
  );
}

export function workflowInputPorts(graph: WorkflowGraph): WorkflowInputPort[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const incomingByScheduler = new Map<
    string,
    Array<{ edge: WorkflowEdge; source: WorkflowSourceNode | WorkflowResultNode }>
  >();
  for (const edge of graph.edges) {
    const source = nodes.get(edge.sourceId);
    const target = nodes.get(edge.targetId);
    if (!source || source.type === "scheduler" || target?.type !== "scheduler") continue;
    const incoming = incomingByScheduler.get(target.id) ?? [];
    incoming.push({ edge, source });
    incomingByScheduler.set(target.id, incoming);
  }

  const ports: WorkflowInputPort[] = [];
  for (const [targetId, incoming] of incomingByScheduler) {
    const target = nodes.get(targetId);
    if (!target || target.type !== "scheduler") continue;
    const totals = incoming.reduce<Record<ComposerMode, number>>(
      (counts, { source }) => {
        counts[source.kind] += 1;
        return counts;
      },
      { text: 0, image: 0, video: 0 },
    );
    const indexes: Record<ComposerMode, number> = { text: 0, image: 0, video: 0 };
    incoming.forEach(({ edge, source }, position) => {
      indexes[source.kind] += 1;
      ports.push({
        edgeId: edge.id,
        sourceId: edge.sourceId,
        targetId,
        kind: source.kind,
        label: inputPortLabel(source.kind, indexes[source.kind], totals[source.kind]),
        sourceName: workflowNodeDisplayName(source),
        x: target.x + WORKFLOW_INPUT_PORT_X,
        y: target.y + WORKFLOW_INPUT_FIRST_Y + position * WORKFLOW_INPUT_ROW_STEP,
      });
    });
  }
  return ports;
}

export function workflowPendingInputPoint(
  graph: WorkflowGraph,
  schedulerId: string,
) {
  const scheduler = graph.nodes.find(
    (node): node is WorkflowSchedulerNode =>
      node.id === schedulerId && node.type === "scheduler",
  );
  if (!scheduler) return undefined;
  const count = workflowInputPorts(graph).filter(
    (port) => port.targetId === schedulerId,
  ).length;
  return {
    x: scheduler.x + WORKFLOW_INPUT_PORT_X,
    y: scheduler.y + WORKFLOW_INPUT_FIRST_Y + count * WORKFLOW_INPUT_ROW_STEP,
  };
}

export function workflowEdgeGeometry(
  source: WorkflowNode,
  target: WorkflowNode,
  targetPoint?: { x: number; y: number },
) {
  const sourceSize = getWorkflowNodeSize(source);
  const targetSize = getWorkflowNodeSize(target);
  const start = {
    x: source.x + sourceSize.width,
    y: source.y + sourceSize.height / 2,
  };
  const end = targetPoint ? {
    x: target.x,
    y: targetPoint.y,
  } : {
    x: target.x,
    y: target.y + targetSize.height / 2,
  };
  const bend = Math.max(72, Math.abs(end.x - start.x) * 0.45);
  const firstControl = { x: start.x + bend, y: start.y };
  const secondControl = { x: end.x - bend, y: end.y };
  return {
    path: `M ${start.x} ${start.y} C ${firstControl.x} ${firstControl.y}, ${secondControl.x} ${secondControl.y}, ${end.x} ${end.y}`,
    midpoint: {
      x: (start.x + 3 * firstControl.x + 3 * secondControl.x + end.x) / 8,
      y: (start.y + 3 * firstControl.y + 3 * secondControl.y + end.y) / 8,
    },
  };
}

export function workflowEdgePath(
  source: WorkflowNode,
  target: WorkflowNode,
  targetPoint?: { x: number; y: number },
): string {
  return workflowEdgeGeometry(source, target, targetPoint).path;
}

export function workflowDraftPath(
  source: WorkflowNode,
  point: { x: number; y: number },
): string {
  const size = getWorkflowNodeSize(source);
  const start = { x: source.x + size.width, y: source.y + size.height / 2 };
  const bend = Math.max(72, Math.abs(point.x - start.x) * 0.45);
  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${point.x - bend} ${point.y}, ${point.x} ${point.y}`;
}

export function workflowAutoPollDeadline(node: WorkflowResultNode): number {
  if (!node.startedAt) return 0;
  return node.startedAt + (node.kind === "video" ? 70 : 10) * 60 * 1000;
}
