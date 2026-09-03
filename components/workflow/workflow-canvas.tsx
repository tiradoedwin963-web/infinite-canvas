"use client";

import {
  Bot,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  Video,
  Workflow,
  X,
} from "lucide-react";
import type { ChangeEvent, CSSProperties, PointerEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  describeDangerousOperation,
  type AgentDangerousOperation,
  type AgentInspectedImage,
  type AgentOperation,
} from "@/app/ai/agent";
import {
  MODEL_CONFIGS,
  getModelConfig,
  TRX_SEEDANCE_25_MODEL,
  type ComposerMode,
} from "@/app/ai/models";
import type {
  GenerateReferenceImage,
  GenerateResponse,
  TaskStatusResponse,
} from "@/app/ai/types";
import {
  deleteAsset,
  deleteCloudProjectThumbnails,
  deleteCloudThumbnail,
  readAsset,
  readCloudThumbnail,
  saveAsset,
  saveCloudThumbnail,
} from "@/app/canvas/assets";
import {
  wheelZoomFactor,
  type Viewport,
} from "@/app/canvas/viewport";
import {
  applyWorkflowTaskStatus,
  buildWorkflowGenerationPrompt,
  connectWorkflowNodes,
  createConnectedScheduler,
  createWorkflowNode,
  createWorkflowRun,
  emptyWorkflowGraph,
  fitWorkflowImageNode,
  getWorkflowNodeSize,
  markWorkflowResultSubmissionUnknown,
  migrateWorkflowSubmissionUnknown,
  moveWorkflowNodes,
  parseWorkflowGraph,
  readWorkflowInputs,
  removeWorkflowEdge,
  removeWorkflowNode,
  resizedWorkflowNodeBounds,
  schedulerHasSubmissionUnknownResult,
  resizeWorkflowNode,
  schedulerDefaults,
  updateWorkflowNode,
  updateWorkflowResult,
  WORKFLOW_SUBMISSION_UNKNOWN_ERROR,
  WORKFLOW_SUBMISSION_UNKNOWN_PROGRESS,
  workflowAutoPollDeadline,
  workflowDraftPath,
  workflowEdgeGeometry,
  workflowEdgeKinds,
  workflowEdgePath,
  workflowInputPorts,
  workflowNodesIntersecting,
  workflowPendingInputPoint,
  workflowSelectionBounds,
  type WorkflowBounds,
  type WorkflowGraph,
  type WorkflowInputPort,
  type WorkflowNode,
  type WorkflowResizeCorner,
  type WorkflowResultNode,
  type WorkflowSchedulerNode,
  type WorkflowSourceNode,
} from "@/app/workflow/graph";
import {
  advanceWorkflowBatch,
  applyWorkflowAgentOperations,
  createWorkflowAgentSnapshot,
  createWorkflowBatchRun,
  createStoryAssetBatchRun,
  describeStoryAssetRun,
  describeWorkflowRun,
  parseWorkflowBatchRun,
  type WorkflowBatchRun,
} from "@/app/workflow/agent";
import {
  approveStoryFoundation,
  assetRefsForSelection,
  markStoryAssetPlanning,
  syncStoryFoundationStatuses,
} from "@/app/workflow/story-assets";
import {
  createWorkflowGraphPersistence,
  createWorkflowRafBatcher,
  createWorkflowViewportController,
  workflowGridTransform,
} from "@/app/workflow/performance";
import {
  WORKFLOW_PROJECTS_STORAGE_KEY,
  createWorkflowProjectGraph,
  createWorkflowProject,
  ensureWorkflowProjectRegistry,
  importWorkflowProject,
  migrateActiveWorkflowAssetLayout,
  parseWorkflowViewport,
  projectSourceAssetIds,
  rebindImportedWorkflowAssets,
  removeWorkflowProject,
  renameWorkflowProject,
  workflowProjectBatchKey,
  workflowProjectConversationKey,
  workflowProjectGraphKey,
  workflowProjectViewportKey,
  type WorkflowProjectMode,
  type WorkflowProjectRegistry,
} from "@/app/workflow/projects";
import {
  createTvcStoryboardWorkbook,
  tvcStoryboardFilename,
} from "@/app/workflow/tvc-excel";
import {
  configureTvcLogo,
  createTvcLogoSource,
  isTvcProject,
  isTvcLogoSource,
  isRunnableTvcVideoScheduler,
  isTvcVideoSchedulerNode,
  isTvcVideoSchedulerReference,
  isTvcVideoResultNode,
  isTvcVideoManualOverride,
  lockTvcScript,
  markTvcVideoSchedulerManualOverride,
  prepareTvcPromptPlan,
  readTvcProject,
  saveTvcPromptPlanBoundaries,
  saveTvcStoryboardTableDraft,
  setTvcPromptNarration,
  syncTvcVideoWorkflow,
  tvcVideoSchedulerRunError,
  type TvcLogoPlacement,
  type TvcPromptPlanBoundary,
  type TvcPromptPlanSegment,
  type TvcPromptUnit,
  type TvcStandaloneLogoUnit,
  type TvcStoryboard,
  type TvcStoryboardTableDraftRow,
  type TvcWorkflowState,
} from "@/app/workflow/tvc";
import {
  CanvasAgentSidebar,
  type CanvasAgentAutoRequest,
  type CanvasAgentAutoRequestOutcome,
} from "@/components/canvas-agent-sidebar";
import { useCloudSession } from "@/components/cloud-session-gate";
import {
  activateCloudProject,
  cloudAssetUrl,
  createCloudProject,
  deleteCloudAsset,
  deleteCloudProject,
  loadCloudProject,
  loadCloudProjects,
  readCloudAsset,
  readCloudAssetThumbnail,
  saveCloudConversation,
  saveCloudProject,
  uploadCloudAsset,
  type CloudProjectDocument,
} from "@/app/workflow/cloud-client";
import {
  parseAgentConversationStore,
  type AgentConversationStore,
} from "@/app/ai/agent";

const DOT_SPACING = 24;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 30 * 1024 * 1024;
const WORKFLOW_WORLD_STYLE = {
  transform: "translate3d(0, 0, 0) scale(1)",
} as CSSProperties;
const WORKFLOW_GRID_STYLE = {
  width: `calc(100% + ${DOT_SPACING * 2}px)`,
  height: `calc(100% + ${DOT_SPACING * 2}px)`,
  transform: `translate3d(-${DOT_SPACING}px, -${DOT_SPACING}px, 0) scale(1)`,
} as CSSProperties;

type CreationMenu = { x: number; y: number };
type SchedulerMenu = { nodeId: string; x: number; y: number };
type MarqueeState = {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
};
type DragState = {
  pointerId: number;
  nodeIds: string[];
  clientX: number;
  clientY: number;
  pendingX: number;
  pendingY: number;
  frame: number | null;
};
type ResizeState = {
  pointerId: number;
  nodeId: string;
  corner: WorkflowResizeCorner;
  startNode: WorkflowNode;
};
type ResizeUpdate = {
  nodeId: string;
  bounds: WorkflowBounds;
};
type ConnectionState = {
  pointerId: number;
  nodeId: string;
  startClientX: number;
  startClientY: number;
  point: { x: number; y: number };
  moved: boolean;
  targetId?: string;
};
type ProjectEditorState = {
  mode: "create" | "rename";
  value: string;
  projectMode: WorkflowProjectMode;
  error: string;
};
type TvcStoryboardCanvasView = {
  tab: "storyboard" | "prompt";
  editing: boolean;
  segmentEditing?: boolean;
} | null;
type TvcPromptRegenerationState = {
  projectId: string;
  requestId?: string;
  state: "awaiting" | "saved" | "error";
  message: string;
} | null;
type SubmissionRetryConfirmation = {
  resultId: string;
  schedulerId: string;
} | null;

type GenerateApiFailure = {
  message: string;
  code?: string;
};

class SubmissionUnknownError extends Error {
  constructor(message = WORKFLOW_SUBMISSION_UNKNOWN_ERROR) {
    super(message);
    this.name = "SubmissionUnknownError";
  }
}

function screenToWorld(viewport: Viewport, point: { x: number; y: number }) {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

function applyWorkflowGridTransform(
  grid: HTMLDivElement,
  viewport: Viewport,
  canvasSize: { width: number; height: number },
) {
  const transform = workflowGridTransform(viewport, canvasSize, DOT_SPACING);
  grid.style.width = `${transform.width}px`;
  grid.style.height = `${transform.height}px`;
  grid.style.transform =
    `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取参考图片失败。"));
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取项目图片失败。"));
    reader.readAsDataURL(blob);
  });
}

function projectImageAssets(graph: WorkflowGraph) {
  const assets = new Map<string, { id: string; name: string }>();
  graph.nodes.forEach((node) => {
    if (
      (node.type === "source" || node.type === "result") &&
      node.kind === "image" &&
      node.assetId
    ) {
      assets.set(node.assetId, {
        id: node.assetId,
        name: node.assetName || `${node.label || node.id}.png`,
      });
    }
  });
  return [...assets.values()];
}

async function imageBlobFromDataUrl(dataUrl: string, mimeType: string) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (!response.ok || !blob.type.startsWith("image/") || blob.type !== mimeType) {
    throw new Error("导入文件中的图片数据无效。");
  }
  return blob;
}

async function readApiError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string") return payload.error;
  } catch {
    // Use the safe local fallback below.
  }
  return "生成请求失败，请稍后重试。";
}

async function readGenerateApiFailure(response: Response): Promise<GenerateApiFailure> {
  try {
    const payload = (await response.json()) as { error?: unknown; code?: unknown };
    return {
      message: typeof payload.error === "string"
        ? payload.error
        : "生成请求失败，请稍后重试。",
      ...(typeof payload.code === "string" ? { code: payload.code } : {}),
    };
  } catch {
    return { message: "生成请求失败，请稍后重试。" };
  }
}

async function workflowImageToFile(
  node: WorkflowSourceNode | WorkflowResultNode,
  readStoredAsset: (assetId: string) => Promise<Blob | undefined>,
): Promise<File> {
  let blob: Blob | undefined;
  let name = `workflow-${node.id}.png`;
  if (node.type === "source" && node.assetId) {
    blob = await readStoredAsset(node.assetId);
    name = node.assetName || name;
  }
  if (node.type === "result" && node.assetId) {
    blob = await readStoredAsset(node.assetId);
    name = node.assetName || name;
  }
  if (!blob && node.type === "result" && node.resultUrl) {
    let response: Response;
    try {
      response = await fetch(node.resultUrl);
    } catch {
      throw new Error("无法读取上游生成图片，请下载后重新上传。" );
    }
    if (!response.ok) throw new Error("无法读取上游生成图片，请下载后重新上传。");
    blob = await response.blob();
  }
  if (!blob) throw new Error("上游图片素材已失效，请重新上传。");
  if (!blob.type.startsWith("image/")) throw new Error("上游节点不是可用图片。");
  return new File([blob], name, { type: blob.type });
}

type ExportedWorkflowImageAsset = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

/**
 * Builds an export-only graph copy. Local generated image results normally
 * retain their provider result URL instead of an IndexedDB asset ID, so give
 * each successful result an ephemeral ID and embed its fetched image in the
 * export. The live local graph is never changed.
 */
async function prepareWorkflowProjectExport(
  graph: WorkflowGraph,
  readStoredAsset: (assetId: string) => Promise<Blob | undefined>,
): Promise<{ graph: WorkflowGraph; assets: ExportedWorkflowImageAsset[] }> {
  const exportGraph: WorkflowGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
  const assets: ExportedWorkflowImageAsset[] = [];
  const exportedAssetIds = new Set<string>();

  for (const asset of projectImageAssets(graph)) {
    const node = graph.nodes.find((candidate): candidate is WorkflowSourceNode | WorkflowResultNode =>
      (candidate.type === "source" || candidate.type === "result") &&
      candidate.kind === "image" &&
      candidate.assetId === asset.id
    );
    if (!node) continue;
    let file: File;
    try {
      file = await workflowImageToFile(node, readStoredAsset);
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片素材无法读取。";
      throw new Error(`图片素材“${asset.name}”无法完整导出：${message}`);
    }
    assets.push({
      id: asset.id,
      name: file.name,
      mimeType: file.type,
      dataUrl: await blobToDataUrl(file),
    });
    exportedAssetIds.add(asset.id);
  }

  for (const [index, node] of graph.nodes.entries()) {
    if (
      node.type !== "result" ||
      node.kind !== "image" ||
      node.status !== "success" ||
      node.assetId ||
      !node.resultUrl
    ) {
      continue;
    }
    let exportAssetId = `export-result-${node.id}`;
    let suffix = 2;
    while (exportedAssetIds.has(exportAssetId)) {
      exportAssetId = `export-result-${node.id}-${suffix}`;
      suffix += 1;
    }
    let file: File;
    try {
      file = await workflowImageToFile(node, readStoredAsset);
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片素材无法读取。";
      throw new Error(`生成图片“${node.label || node.id}”无法完整导出：${message}`);
    }
    exportedAssetIds.add(exportAssetId);
    const exportedNode = exportGraph.nodes[index];
    if (!exportedNode || exportedNode.type !== "result") continue;
    exportGraph.nodes[index] = {
      ...exportedNode,
      assetId: exportAssetId,
      assetName: file.name,
      assetMimeType: file.type,
    };
    assets.push({
      id: exportAssetId,
      name: file.name,
      mimeType: file.type,
      dataUrl: await blobToDataUrl(file),
    });
  }

  return { graph: exportGraph, assets };
}

export function WorkflowCanvas() {
  const { remote, user } = useCloudSession();
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [graph, setGraph] = useState<WorkflowGraph>(emptyWorkflowGraph);
  const [hydrated, setHydrated] = useState(false);
  const [creationMenu, setCreationMenu] = useState<CreationMenu | null>(null);
  const [schedulerMenu, setSchedulerMenu] = useState<SchedulerMenu | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [assetVersions, setAssetVersions] = useState<Record<string, string>>({});
  const [assetErrors, setAssetErrors] = useState<Record<string, string>>({});
  const [runningSchedulers, setRunningSchedulers] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [agentContextNodeId, setAgentContextNodeId] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [batchRun, setBatchRun] = useState<WorkflowBatchRun | null>(null);
  const [projects, setProjects] = useState<WorkflowProjectRegistry | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [projectEditor, setProjectEditor] = useState<ProjectEditorState | null>(null);
  const [projectImportError, setProjectImportError] = useState("");
  const [projectImporting, setProjectImporting] = useState(false);
  const [tvcStoryboardView, setTvcStoryboardView] = useState<TvcStoryboardCanvasView>(null);
  const [isTvcLockConfirming, setIsTvcLockConfirming] = useState(false);
  const [tvcPromptAutoRequest, setTvcPromptAutoRequest] =
    useState<CanvasAgentAutoRequest | null>(null);
  const [tvcPromptRegeneration, setTvcPromptRegeneration] =
    useState<TvcPromptRegenerationState>(null);
  const [submissionRetryConfirmation, setSubmissionRetryConfirmation] =
    useState<SubmissionRetryConfirmation>(null);
  const [cloudSyncState, setCloudSyncState] = useState<
    "idle" | "saving" | "unsynced" | "conflict"
  >("idle");
  const mainRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const canvasSizeRef = useRef(canvasSize);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const connectionRef = useRef<ConnectionState | null>(null);
  const marqueeRenderRef = useRef<
    ReturnType<typeof createWorkflowRafBatcher<MarqueeState>> | null
  >(null);
  const connectionRenderRef = useRef<
    ReturnType<typeof createWorkflowRafBatcher<ConnectionState>> | null
  >(null);
  const resizeRenderRef = useRef<
    ReturnType<typeof createWorkflowRafBatcher<ResizeUpdate>> | null
  >(null);
  const pollingTasks = useRef(new Set<string>());
  const loadedAssets = useRef(new Set<string>());
  const assetUrlsRef = useRef<Record<string, string>>({});
  const assetVersionsRef = useRef<Record<string, string>>({});
  const assetRestoreGenerationRef = useRef(0);
  const graphRef = useRef<WorkflowGraph>(emptyWorkflowGraph());
  const selectedIdsRef = useRef<string[]>(selectedIds);
  const isAgentOpenRef = useRef(isAgentOpen);
  const viewportRef = useRef<Viewport>(viewport);
  const viewportControllerRef = useRef<
    ReturnType<typeof createWorkflowViewportController> | null
  >(null);
  const persistenceRef = useRef<
    ReturnType<typeof createWorkflowGraphPersistence> | null
  >(null);
  const runningSchedulersRef = useRef(new Set<string>());
  const activeProjectIdRef = useRef("");
  const cloudRevisionRef = useRef(0);
  const cloudConversationRef = useRef<{
    projectId: string;
    revision: number;
    store: AgentConversationStore;
  } | null>(null);
  const cloudConversationSaveRef = useRef(Promise.resolve());
  const cloudConversationLastSavedRef = useRef("");
  const cloudSaveRef = useRef(Promise.resolve());
  const cloudSaveTimerRef = useRef<number | null>(null);
  const cloudLastSavedRef = useRef("");
  const cloudPendingSerializedRef = useRef("");
  const projectImportInputRef = useRef<HTMLInputElement>(null);

  graphRef.current = graph;
  selectedIdsRef.current = selectedIds;
  isAgentOpenRef.current = isAgentOpen;
  canvasSizeRef.current = canvasSize;
  assetVersionsRef.current = assetVersions;

  const applyProjectState = useCallback((
    restored: WorkflowGraph,
    restoredViewport: Viewport,
    restoredBatch: WorkflowBatchRun | null,
    restoredAssetVersions: Record<string, string> = {},
  ) => {
    const safeRestored = migrateWorkflowSubmissionUnknown(restored);
    Object.values(assetUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    assetUrlsRef.current = {};
    loadedAssets.current.clear();
    assetRestoreGenerationRef.current += 1;
    pollingTasks.current.clear();
    graphRef.current = safeRestored;
    setGraph(safeRestored);
    setAssetUrls({});
    setAssetVersions(restoredAssetVersions);
    setAssetErrors({});
    setSelectedIds([]);
    setCreationMenu(null);
    setSchedulerMenu(null);
    setMarquee(null);
    setConnection(null);
    setHoveredEdgeId(null);
    setDetailId(null);
    setAgentContextNodeId(null);
    setTvcStoryboardView(null);
    setIsTvcLockConfirming(false);
    setTvcPromptAutoRequest(null);
    setTvcPromptRegeneration(null);
    setSubmissionRetryConfirmation(null);
    setBatchRun(restoredBatch);
    viewportRef.current = restoredViewport;
    setViewport(restoredViewport);
    viewportControllerRef.current?.replace(restoredViewport);
  }, []);

  const loadProject = useCallback((projectId: string) => {
    const restored = parseWorkflowGraph(window.localStorage.getItem(
      workflowProjectGraphKey(projectId),
    ));
    applyProjectState(
      restored,
      parseWorkflowViewport(window.localStorage.getItem(
        workflowProjectViewportKey(projectId),
      )),
      parseWorkflowBatchRun(
        window.localStorage.getItem(workflowProjectBatchKey(projectId)),
      ),
      {},
    );
  }, [applyProjectState]);

  const applyCloudProject = useCallback((project: CloudProjectDocument) => {
    cloudRevisionRef.current = project.revision;
    cloudConversationRef.current = {
      projectId: project.id,
      revision: project.conversationRevision,
      store: project.conversation,
    };
    cloudConversationLastSavedRef.current = JSON.stringify(project.conversation);
    setCloudSyncState("idle");
    cloudLastSavedRef.current = JSON.stringify({
      name: project.name,
      graph: project.graph,
      viewport: project.viewport,
      batch: project.batch,
    });
    applyProjectState(
      parseWorkflowGraph(JSON.stringify(project.graph)),
      project.viewport,
      project.batch,
      project.assetVersions,
    );
  }, [applyProjectState]);

  const reloadCloudProject = useCallback(async (projectId: string) => {
    const project = await loadCloudProject(projectId);
    if (activeProjectIdRef.current !== projectId) return;
    applyCloudProject(project);
  }, [applyCloudProject]);

  const loadRemoteConversation = useCallback(async () => {
    const current = cloudConversationRef.current;
    return current?.store ?? {
      version: 2 as const,
      activeConversationId: "",
      conversations: [],
    };
  }, []);

  const saveRemoteConversation = useCallback(async (store: AgentConversationStore) => {
    const serialized = JSON.stringify(store);
    if (serialized === cloudConversationLastSavedRef.current) return;
    cloudConversationSaveRef.current = cloudConversationSaveRef.current.then(async () => {
      const current = cloudConversationRef.current;
      if (!current) return;
      try {
        const saved = await saveCloudConversation({
          projectId: current.projectId,
          conversation: store,
          revision: current.revision,
        });
        if (cloudConversationRef.current?.projectId !== current.projectId) return;
        cloudConversationRef.current = {
          projectId: current.projectId,
          revision: saved.revision,
          store,
        };
        cloudConversationLastSavedRef.current = serialized;
      } catch (error) {
        const status = error && typeof error === "object" && "status" in error
          ? Number(error.status)
          : 0;
        setCloudSyncState(status === 409 ? "conflict" : "unsynced");
      }
    });
    await cloudConversationSaveRef.current;
  }, []);

  useEffect(() => {
    if (remote) {
      let cancelled = false;
      void loadCloudProjects()
        .then(async (registry) => {
          if (cancelled) return;
          activeProjectIdRef.current = registry.activeProjectId;
          setProjects(registry);
          const project = await loadCloudProject(registry.activeProjectId);
          if (cancelled) return;
          applyCloudProject(project);
          setHydrated(true);
        })
        .catch(() => {
          if (!cancelled) setCloudSyncState("unsynced");
        });
      return () => {
        cancelled = true;
      };
    }
    const registry = ensureWorkflowProjectRegistry(window.localStorage);
    migrateActiveWorkflowAssetLayout(window.localStorage, registry);
    activeProjectIdRef.current = registry.activeProjectId;
    setProjects(registry);
    loadProject(registry.activeProjectId);
    setHydrated(true);
  }, [applyCloudProject, loadProject, remote]);

  useEffect(() => {
    const projectId = projects?.activeProjectId;
    if (!projectId || remote) return;
    const persistence = createWorkflowGraphPersistence({
      write: (next) =>
        window.localStorage.setItem(
          workflowProjectGraphKey(projectId),
          JSON.stringify(next),
        ),
    });
    persistenceRef.current = persistence;
    const flush = () => persistence.flush();
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      persistence.flush();
      persistence.dispose();
      if (persistenceRef.current === persistence) persistenceRef.current = null;
    };
  }, [projects?.activeProjectId, remote]);

  useEffect(() => {
    if (!remote && hydrated && projects?.activeProjectId) {
      persistenceRef.current?.schedule(graph);
    }
  }, [graph, hydrated, projects?.activeProjectId, remote]);

  useEffect(() => {
    if (!hydrated) return;
    const synced = syncStoryFoundationStatuses(graph);
    if (synced === graph) return;
    graphRef.current = synced;
    setGraph(synced);
  }, [graph, hydrated]);

  useEffect(() => {
    if (!hydrated || !isTvcProject(graph)) return;
    const synced = syncTvcVideoWorkflow(graph);
    if (synced.graph === graph) return;
    graphRef.current = synced.graph;
    setGraph(synced.graph);
  }, [graph, hydrated]);

  useEffect(() => {
    const projectId = projects?.activeProjectId;
    if (!hydrated || !projectId || remote) return;
    if (batchRun) {
      window.localStorage.setItem(
        workflowProjectBatchKey(projectId),
        JSON.stringify(batchRun),
      );
    } else {
      window.localStorage.removeItem(workflowProjectBatchKey(projectId));
    }
  }, [batchRun, hydrated, projects?.activeProjectId, remote]);

  useEffect(() => {
    const projectId = projects?.activeProjectId;
    if (!hydrated || !projectId || remote) return;
    window.localStorage.setItem(
      workflowProjectViewportKey(projectId),
      JSON.stringify(viewport),
    );
  }, [hydrated, projects?.activeProjectId, remote, viewport]);

  useEffect(() => {
    if (
      !remote ||
      !hydrated ||
      !projects ||
      cloudSyncState === "conflict" ||
      cloudSyncState === "unsynced"
    ) return;
    const projectId = projects.activeProjectId;
    const name = projects.projects.find((project) => project.id === projectId)?.name;
    if (!name) return;
    const payload = {
      name,
      graph,
      viewport,
      batch: batchRun,
    };
    const serialized = JSON.stringify(payload);
    if (
      serialized === cloudLastSavedRef.current ||
      serialized === cloudPendingSerializedRef.current
    ) return;
    if (cloudSaveTimerRef.current !== null) {
      window.clearTimeout(cloudSaveTimerRef.current);
    }
    cloudPendingSerializedRef.current = serialized;
    setCloudSyncState("saving");
    cloudSaveTimerRef.current = window.setTimeout(() => {
      cloudSaveTimerRef.current = null;
      cloudSaveRef.current = cloudSaveRef.current.then(async () => {
        if (activeProjectIdRef.current !== projectId) return;
        try {
          const saved = await saveCloudProject({
            id: projectId,
            ...payload,
            revision: cloudRevisionRef.current,
          });
          if (activeProjectIdRef.current !== projectId) return;
          cloudRevisionRef.current = saved.revision;
          cloudLastSavedRef.current = serialized;
          cloudPendingSerializedRef.current = "";
          setCloudSyncState("idle");
        } catch (error) {
          const status = error && typeof error === "object" && "status" in error
            ? Number(error.status)
            : 0;
          setCloudSyncState(status === 409 ? "conflict" : "unsynced");
          cloudPendingSerializedRef.current = "";
        }
      });
    }, 300);
  }, [batchRun, cloudSyncState, graph, hydrated, projects, remote, viewport]);

  useEffect(() => () => {
    if (cloudSaveTimerRef.current !== null) {
      window.clearTimeout(cloudSaveTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (hydrated && graph.nodes.length === 0 && batchRun) setBatchRun(null);
  }, [batchRun, graph.nodes.length, hydrated]);

  useEffect(() => {
    const canvas = mainRef.current;
    if (!canvas) return;
    const updateSize = () => {
      const bounds = canvas.getBoundingClientRect();
      const next = { width: bounds.width, height: bounds.height };
      canvasSizeRef.current = next;
      setCanvasSize(next);
      const grid = gridRef.current;
      if (grid) applyWorkflowGridTransform(grid, viewportRef.current, next);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    assetUrlsRef.current = assetUrls;
  }, [assetUrls]);

  const restoreAsset = useCallback(async (
    node: WorkflowSourceNode | WorkflowResultNode,
    projectId: string,
    restoreGeneration: number,
  ) => {
    const assetId = node.assetId;
    if (!assetId) return;
    try {
      let blob: Blob | undefined;
      if (remote && node.kind === "image" && user) {
        const version = assetVersionsRef.current[assetId] || "unknown";
        try {
          blob = await readCloudThumbnail({ userId: user.id, assetId, version });
        } catch {
          // A browser cache failure must not prevent the cloud thumbnail fallback.
        }
        if (!blob) {
          const loaded = await readCloudAssetThumbnail(assetId, version);
          blob = loaded.blob;
          if (loaded.cacheable) {
            void saveCloudThumbnail({
              userId: user.id,
              projectId,
              assetId,
              version,
              blob,
            });
          }
        }
      } else {
        blob = remote
          ? await readCloudAsset(assetId, assetVersionsRef.current[assetId])
          : await readAsset(assetId);
      }
      if (!blob) throw new Error();
      if (
        assetRestoreGenerationRef.current !== restoreGeneration ||
        activeProjectIdRef.current !== projectId
      ) return;
      const url = URL.createObjectURL(blob);
      setAssetUrls((current) => {
        if (current[assetId]) URL.revokeObjectURL(current[assetId]);
        return { ...current, [assetId]: url };
      });
      setAssetErrors((current) => {
        const next = { ...current };
        delete next[assetId];
        return next;
      });
    } catch {
      if (
        assetRestoreGenerationRef.current !== restoreGeneration ||
        activeProjectIdRef.current !== projectId
      ) return;
      setAssetErrors((current) => ({ ...current, [assetId]: "素材已失效，请重新上传。" }));
    }
  }, [remote, user]);

  useEffect(() => {
    if (!hydrated) return;
    const projectId = activeProjectIdRef.current;
    const restoreGeneration = assetRestoreGenerationRef.current;
    const viewportCenter = {
      x: (canvasSizeRef.current.width / 2 - viewportRef.current.x) / viewportRef.current.scale,
      y: (canvasSizeRef.current.height / 2 - viewportRef.current.y) / viewportRef.current.scale,
    };
    const candidates = graph.nodes
      .filter((node): node is WorkflowSourceNode | WorkflowResultNode =>
        (node.type === "source" || node.type === "result") &&
        Boolean(node.assetId) &&
        !loadedAssets.current.has(node.assetId!),
      )
      .sort((left, right) => {
        const leftSize = getWorkflowNodeSize(left);
        const rightSize = getWorkflowNodeSize(right);
        const leftDistance = Math.hypot(
          left.x + leftSize.width / 2 - viewportCenter.x,
          left.y + leftSize.height / 2 - viewportCenter.y,
        );
        const rightDistance = Math.hypot(
          right.x + rightSize.width / 2 - viewportCenter.x,
          right.y + rightSize.height / 2 - viewportCenter.y,
        );
        return leftDistance - rightDistance;
      });
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < candidates.length) {
        const node = candidates[nextIndex++];
        if (!node.assetId || loadedAssets.current.has(node.assetId)) continue;
        loadedAssets.current.add(node.assetId);
        await restoreAsset(node, projectId, restoreGeneration);
      }
    }
    void Promise.all(
      Array.from({ length: Math.min(6, candidates.length) }, () => worker()),
    );
  }, [graph.nodes, hydrated, restoreAsset]);

  useEffect(() => () => {
    Object.values(assetUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    loadedAssets.current.clear();
  }, []);

  useEffect(() => {
    const marqueeBatch = createWorkflowRafBatcher<MarqueeState>({
      apply: setMarquee,
    });
    const connectionBatch = createWorkflowRafBatcher<ConnectionState>({
      apply: setConnection,
    });
    const resizeBatch = createWorkflowRafBatcher<ResizeUpdate>({
      apply: ({ nodeId, bounds }) => {
        setGraph((current) => {
          const next = resizeWorkflowNode(current, nodeId, bounds);
          graphRef.current = next;
          return next;
        });
      },
    });
    marqueeRenderRef.current = marqueeBatch;
    connectionRenderRef.current = connectionBatch;
    resizeRenderRef.current = resizeBatch;
    return () => {
      marqueeBatch.dispose();
      connectionBatch.dispose();
      resizeBatch.dispose();
      marqueeRenderRef.current = null;
      connectionRenderRef.current = null;
      resizeRenderRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = mainRef.current;
    const grid = gridRef.current;
    const world = worldRef.current;
    if (!canvas || !grid || !world) return;
    const apply = (next: Viewport) => {
      viewportRef.current = next;
      world.style.transform =
        `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
      applyWorkflowGridTransform(grid, next, canvasSizeRef.current);
    };
    apply(viewportRef.current);
    const controller = createWorkflowViewportController({
      initial: viewportRef.current,
      apply,
      commit: (next) => setViewport(next),
      onActiveChange: (active) =>
        canvas.toggleAttribute("data-workflow-viewport-active", active),
    });
    viewportControllerRef.current = controller;
    return () => {
      controller.dispose();
      canvas.removeAttribute("data-workflow-viewport-active");
      if (viewportControllerRef.current === controller) {
        viewportControllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const canvas = mainRef.current;
    if (!canvas) return;
    function handleWheel(event: globalThis.WheelEvent) {
      if ((event.target as HTMLElement).closest("[data-workflow-isolated]")) return;
      event.preventDefault();
      const bounds = canvas!.getBoundingClientRect();
      const normalize = (delta: number, page: number) =>
        event.deltaMode === globalThis.WheelEvent.DOM_DELTA_LINE
          ? delta * 16
          : event.deltaMode === globalThis.WheelEvent.DOM_DELTA_PAGE
            ? delta * page
            : delta;
      const deltaX = normalize(event.deltaX, bounds.width);
      const deltaY = normalize(event.deltaY, bounds.height);
      const controller = viewportControllerRef.current;
      if (!controller) return;
      if (!event.ctrlKey) {
        controller.pan(-deltaX, -deltaY);
      } else {
        const anchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        controller.zoom(anchor, wheelZoomFactor(deltaY, true));
      }
    }
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (isAgentOpen) {
        setIsAgentOpen(false);
        setAgentContextNodeId(null);
        return;
      }
      setCreationMenu(null);
      setSchedulerMenu(null);
      setDetailId(null);
      setTvcStoryboardView(null);
      setSubmissionRetryConfirmation(null);
      connectionRef.current = null;
      setConnection(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAgentOpen]);

  useEffect(() => {
    function moveWindowConnection(event: globalThis.PointerEvent) {
      const current = connectionRef.current;
      const canvas = mainRef.current;
      if (!current || !canvas) return;
      const bounds = canvas.getBoundingClientRect();
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-workflow-node-type='scheduler']");
      const moved =
        current.moved ||
        Math.hypot(
          event.clientX - current.startClientX,
          event.clientY - current.startClientY,
        ) >= 6;
      const next = {
        ...current,
        point: screenToWorld(viewportRef.current, {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        }),
        moved,
        targetId: moved ? target?.dataset.workflowNodeId : undefined,
      };
      connectionRef.current = next;
      if (connectionRenderRef.current) {
        connectionRenderRef.current.schedule(next);
      } else {
        setConnection(next);
      }
    }
    function finishWindowConnection() {
      const current = connectionRef.current;
      if (!current) return;
      if (current.moved && current.targetId) {
        setGraph((value) =>
          connectWorkflowNodes(value, current.nodeId, current.targetId!),
        );
      } else if (!current.moved) {
        const node = graphRef.current.nodes.find(
          (candidate) => candidate.id === current.nodeId,
        );
        if (node && node.type !== "scheduler") {
          const size = getWorkflowNodeSize(node);
          setSchedulerMenu({
            nodeId: node.id,
            x: node.x + size.width + 52,
            y: node.y + size.height / 2 - 54,
          });
        }
      }
      connectionRenderRef.current?.cancel();
      connectionRef.current = null;
      setConnection(null);
    }
    function cancelWindowConnection() {
      connectionRenderRef.current?.cancel();
      connectionRef.current = null;
      setConnection(null);
    }
    window.addEventListener("pointermove", moveWindowConnection);
    window.addEventListener("pointerup", finishWindowConnection);
    window.addEventListener("pointercancel", cancelWindowConnection);
    return () => {
      window.removeEventListener("pointermove", moveWindowConnection);
      window.removeEventListener("pointerup", finishWindowConnection);
      window.removeEventListener("pointercancel", cancelWindowConnection);
    };
  }, []);

  const pollTask = useCallback(async (node: WorkflowResultNode) => {
    if (
      node.status === "submission-unknown" ||
      !node.taskId ||
      pollingTasks.current.has(node.taskId)
    ) return;
    const projectId = activeProjectIdRef.current;
    if (Date.now() > workflowAutoPollDeadline(node)) {
      setGraph((current) => updateWorkflowResult(current, node.id, {
        status: "paused",
        progress: "已暂停自动查询",
      }));
      return;
    }
    pollingTasks.current.add(node.taskId);
    try {
      const query = new URLSearchParams({ taskId: node.taskId, mode: node.kind });
      if (remote) {
        query.set("projectId", projectId);
        query.set("resultId", node.id);
      }
      const response = await fetch(`/api/ai/status?${query.toString()}`);
      if (!response.ok) throw new Error(await readApiError(response));
      const status = (await response.json()) as TaskStatusResponse;
      if (activeProjectIdRef.current !== projectId) return;
      const versions = status.results.filter((result) => result.assetId && result.assetVersion);
      if (versions.length) {
        const changedAssetIds = versions
          .filter((result) =>
            assetVersionsRef.current[result.assetId!] &&
            assetVersionsRef.current[result.assetId!] !== result.assetVersion,
          )
          .map((result) => result.assetId!);
        changedAssetIds.forEach((assetId) => loadedAssets.current.delete(assetId));
        if (changedAssetIds.length) {
          setAssetUrls((current) => {
            const next = { ...current };
            changedAssetIds.forEach((assetId) => {
              if (next[assetId]) URL.revokeObjectURL(next[assetId]);
              delete next[assetId];
            });
            return next;
          });
        }
        setAssetVersions((current) => ({
          ...current,
          ...Object.fromEntries(versions.map((result) => [result.assetId!, result.assetVersion!])),
        }));
      }
      setGraph((current) => applyWorkflowTaskStatus(current, node.id, status));
    } catch (error) {
      if (activeProjectIdRef.current !== projectId) return;
      setGraph((current) => updateWorkflowResult(current, node.id, {
        progress: error instanceof Error ? error.message : "任务查询失败，稍后重试",
      }));
    } finally {
      pollingTasks.current.delete(node.taskId);
    }
  }, [remote]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setInterval(() => {
      graph.nodes
        .filter((node): node is WorkflowResultNode =>
          node.type === "result" && Boolean(node.taskId) &&
          (node.status === "pending" || node.status === "running"),
        )
        .forEach((node) => void pollTask(node));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [graph.nodes, hydrated, pollTask]);

  function canvasPoint(clientX: number, clientY: number) {
    const bounds = mainRef.current!.getBoundingClientRect();
    return screenToWorld(viewportRef.current, {
      x: clientX - bounds.left,
      y: clientY - bounds.top,
    });
  }

  function handleCanvasDoubleClick(event: React.MouseEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    setSchedulerMenu(null);
    setCreationMenu(canvasPoint(event.clientX, event.clientY));
  }

  function createNode(type: ComposerMode | "scheduler") {
    if (!creationMenu) return;
    if (isTvcProject(graphRef.current) && (type === "video" || type === "scheduler")) {
      window.alert("TVC 项目只接收文字和图片参考；资产图片请从素材节点的右侧加号创建。");
      return;
    }
    const created = createWorkflowNode(graph, type, {
      x: creationMenu.x - 144,
      y: creationMenu.y - (type === "scheduler" ? 180 : 100),
    });
    setGraph(created.graph);
    setSelectedIds([created.nodeId]);
    setCreationMenu(null);
  }

  function beginCanvasPointer(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setSelectedIds([]);
    setAgentContextNodeId(null);
    setCreationMenu(null);
    setSchedulerMenu(null);
    marqueeRenderRef.current?.cancel();
    event.currentTarget.setPointerCapture(event.pointerId);
    const state: MarqueeState = {
      pointerId: event.pointerId,
      startX: event.clientX - bounds.left,
      startY: event.clientY - bounds.top,
      currentX: event.clientX - bounds.left,
      currentY: event.clientY - bounds.top,
      moved: false,
    };
    marqueeRef.current = state;
  }

  function moveCanvasPointer(event: PointerEvent<HTMLElement>) {
    const current = marqueeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const currentX = event.clientX - bounds.left;
    const currentY = event.clientY - bounds.top;
    const moved = current.moved || Math.hypot(currentX - current.startX, currentY - current.startY) >= 6;
    const next = { ...current, currentX, currentY, moved };
    marqueeRef.current = next;
    if (moved) {
      if (marqueeRenderRef.current) {
        marqueeRenderRef.current.schedule(next);
      } else {
        setMarquee(next);
      }
    }
  }

  function finishCanvasPointer(event: PointerEvent<HTMLElement>) {
    const current = marqueeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.moved) {
      const topLeft = screenToWorld(viewportRef.current, {
        x: Math.min(current.startX, current.currentX),
        y: Math.min(current.startY, current.currentY),
      });
      const bottomRight = screenToWorld(viewportRef.current, {
        x: Math.max(current.startX, current.currentX),
        y: Math.max(current.startY, current.currentY),
      });
      setSelectedIds(workflowNodesIntersecting(graph, {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      }));
    }
    marqueeRenderRef.current?.cancel();
    marqueeRef.current = null;
    setMarquee(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function markDraggedNodes(nodeIds: string[], active: boolean) {
    const ids = new Set(nodeIds);
    mainRef.current
      ?.querySelectorAll<HTMLElement>("[data-workflow-node-id]")
      .forEach((element) => {
        if (ids.has(element.dataset.workflowNodeId || "")) {
          element.classList.toggle("workflow-node-transforming", active);
        }
      });
  }

  function beginNodeDrag(event: PointerEvent<HTMLDivElement>, node: WorkflowNode) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-workflow-control]")) return;
    event.stopPropagation();
    const ids = selectedIdsRef.current.includes(node.id)
      ? selectedIdsRef.current
      : [node.id];
    setSelectedIds(ids);
    if (isAgentOpenRef.current) setAgentContextNodeId(node.id);
    setSchedulerMenu(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      nodeIds: ids,
      clientX: event.clientX,
      clientY: event.clientY,
      pendingX: 0,
      pendingY: 0,
      frame: null,
    };
    markDraggedNodes(ids, true);
  }

  function flushNodeDrag(current: DragState) {
    current.frame = null;
    const deltaX = current.pendingX;
    const deltaY = current.pendingY;
    current.pendingX = 0;
    current.pendingY = 0;
    if (!deltaX && !deltaY) return;
    setGraph((value) => {
      const next = moveWorkflowNodes(value, current.nodeIds, deltaX, deltaY);
      graphRef.current = next;
      return next;
    });
  }

  function dragNodes(event: PointerEvent<HTMLDivElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    current.pendingX +=
      (event.clientX - current.clientX) / viewportRef.current.scale;
    current.pendingY +=
      (event.clientY - current.clientY) / viewportRef.current.scale;
    current.clientX = event.clientX;
    current.clientY = event.clientY;
    if (current.frame === null) {
      current.frame = window.requestAnimationFrame(() => flushNodeDrag(current));
    }
  }

  function finishNodeDrag(event: PointerEvent<HTMLDivElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (current.frame !== null) window.cancelAnimationFrame(current.frame);
    flushNodeDrag(current);
    markDraggedNodes(current.nodeIds, false);
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function beginResize(
    event: PointerEvent<HTMLButtonElement>,
    node: WorkflowNode,
    corner: WorkflowResizeCorner,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRenderRef.current?.cancel();
    resizeRef.current = { pointerId: event.pointerId, nodeId: node.id, corner, startNode: { ...node } };
  }

  function resizeFromPointer(event: PointerEvent<HTMLButtonElement>) {
    const current = resizeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const update = {
      nodeId: current.nodeId,
      bounds: resizedWorkflowNodeBounds(
        current.startNode,
        current.corner,
        canvasPoint(event.clientX, event.clientY),
      ),
    };
    if (resizeRenderRef.current) {
      resizeRenderRef.current.schedule(update);
    } else {
      setGraph((value) => resizeWorkflowNode(value, update.nodeId, update.bounds));
    }
  }

  function finishResize(event: PointerEvent<HTMLButtonElement>) {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRenderRef.current?.flush();
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function beginConnection(event: PointerEvent<HTMLButtonElement>, node: WorkflowNode) {
    if (event.button !== 0 || node.type === "scheduler") return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setCreationMenu(null);
    setSchedulerMenu(null);
    connectionRenderRef.current?.cancel();
    const state = {
      pointerId: event.pointerId,
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      point: canvasPoint(event.clientX, event.clientY),
      moved: false,
    };
    connectionRef.current = state;
    setConnection(state);
  }

  function moveConnection(event: PointerEvent<HTMLButtonElement>) {
    const current = connectionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const target = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-workflow-node-type='scheduler']");
    const moved =
      current.moved ||
      Math.hypot(
        event.clientX - current.startClientX,
        event.clientY - current.startClientY,
      ) >= 6;
    const targetId = moved ? target?.dataset.workflowNodeId : undefined;
    const next = {
      ...current,
      point: canvasPoint(event.clientX, event.clientY),
      moved,
      targetId,
    };
    connectionRef.current = next;
    if (connectionRenderRef.current) {
      connectionRenderRef.current.schedule(next);
    } else {
      setConnection(next);
    }
  }

  function finishConnection(event: PointerEvent<HTMLButtonElement>) {
    const current = connectionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    connectionRenderRef.current?.cancel();
    if (event.type === "pointercancel") {
      connectionRef.current = null;
      setConnection(null);
    } else if (current.moved && current.targetId) {
      setGraph((value) => {
        const source = value.nodes.find((node) => node.id === current.nodeId);
        const target = value.nodes.find(
          (node): node is WorkflowSchedulerNode =>
            node.id === current.targetId && node.type === "scheduler",
        );
        if (target && isTvcVideoSchedulerNode(target)) {
          if (target.tvcVideoHistorical === true) {
            const next = updateWorkflowNode(value, target.id, {
              error: "历史 TVC 视频版本仅保留查看，不能修改参考资产。",
            });
            graphRef.current = next;
            return next;
          }
          if (!isTvcVideoSchedulerReference(value, target, source ?? target)) {
            const next = updateWorkflowNode(value, target.id, {
              error: "TVC 视频仅可添加本项目已成功图片资产或已上传品牌 Logo 作为参考图。",
            });
            graphRef.current = next;
            return next;
          }
          const connected = connectWorkflowNodes(value, current.nodeId, target.id);
          if (connected === value) return value;
          const next = markTvcVideoSchedulerManualOverride(
            updateWorkflowNode(connected, target.id, { error: "" }),
            target.id,
          );
          graphRef.current = next;
          return next;
        }
        const next = connectWorkflowNodes(value, current.nodeId, current.targetId!);
        graphRef.current = next;
        return next;
      });
    } else if (!current.moved) {
      const node = graphRef.current.nodes.find(
        (candidate) => candidate.id === current.nodeId,
      );
      if (node && node.type !== "scheduler") {
        const size = getWorkflowNodeSize(node);
        setSchedulerMenu({
          nodeId: node.id,
          x: node.x + size.width + 52,
          y: node.y + size.height / 2 - 54,
        });
      }
    }
    if (event.type !== "pointercancel") {
      connectionRef.current = null;
      setConnection(null);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function createSchedulerFromMenu(outputKind: ComposerMode) {
    if (!schedulerMenu) return;
    if (isTvcProject(graphRef.current) && outputKind === "video") {
      window.alert("TVC 视频任务由锁稿后的最终提示词自动建立，不能手动新建。");
      return;
    }
    const created = createConnectedScheduler(
      graphRef.current,
      schedulerMenu.nodeId,
      outputKind,
    );
    setGraph(created.graph);
    setSelectedIds(created.nodeId ? [created.nodeId] : []);
    setSchedulerMenu(null);
  }

  async function uploadSource(node: WorkflowSourceNode, file: File | undefined) {
    if (!file) return;
    if (
      node.storyRole === "tvc-logo" &&
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      setAssetErrors((current) => ({
        ...current,
        [node.id]: "品牌 Logo 仅支持 PNG、JPEG 或 WebP 图片。",
      }));
      return;
    }
    if (isTvcProject(graphRef.current) && node.kind === "video") {
      setAssetErrors((current) => ({
        ...current,
        [node.id]: "TVC 项目暂不接收视频参考，请上传图片或补充文字资料。",
      }));
      return;
    }
    const maximum = node.kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > maximum) {
      setAssetErrors((current) => ({
        ...current,
        [node.id]: node.kind === "video" ? "视频不能超过 100MB。" : "图片不能超过 10MB。",
      }));
      return;
    }
    const uploaded = remote
      ? await uploadCloudAsset({
          projectId: activeProjectIdRef.current,
          nodeId: node.id,
          file,
        })
      : { assetId: crypto.randomUUID(), assetVersion: "" };
    const { assetId } = uploaded;
    if (!remote) await saveAsset(assetId, file);
    if (node.assetId) {
      const previousUrl = assetUrls[node.assetId];
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      if (remote) {
        void deleteCloudAsset(node.assetId);
        if (user) void deleteCloudThumbnail(user.id, node.assetId);
      } else {
        void deleteAsset(node.assetId);
      }
    }
    const url = URL.createObjectURL(file);
    loadedAssets.current.add(assetId);
    if (remote && uploaded.assetVersion) {
      setAssetVersions((current) => ({ ...current, [assetId]: uploaded.assetVersion }));
    }
    setAssetUrls((current) => ({ ...current, [assetId]: url }));
    setAssetErrors((current) => {
      const next = { ...current };
      delete next[node.id];
      return next;
    });
    setGraph((current) => updateWorkflowNode(current, node.id, {
      assetId,
      assetName: file.name,
      assetMimeType: file.type,
      text: file.name,
      ...(node.kind === "image"
        ? { width: undefined, height: undefined }
        : {}),
    }));
  }

  async function uploadTvcLogo(file: File | undefined) {
    if (!file) return;
    const project = readTvcProject(graphRef.current);
    if (!project) return;
    if (![
      "image/png",
      "image/jpeg",
      "image/webp",
    ].includes(file.type)) {
      setAssetErrors((current) => ({
        ...current,
        "tvc-logo-upload": "品牌 Logo 仅支持 PNG、JPEG 或 WebP 图片。",
      }));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setAssetErrors((current) => ({
        ...current,
        "tvc-logo-upload": "品牌 Logo 图片不能超过 10MB。",
      }));
      return;
    }

    const nodeId = crypto.randomUUID();
    let assetId = "";
    try {
      const uploaded = remote
        ? await uploadCloudAsset({
            projectId: activeProjectIdRef.current,
            nodeId,
            file,
          })
        : { assetId: crypto.randomUUID(), assetVersion: "" };
      assetId = uploaded.assetId;
      if (!remote) await saveAsset(assetId, file);

      const before = graphRef.current;
      const created = createTvcLogoSource(before, {
        assetId,
        assetName: file.name,
        assetMimeType: file.type as "image/png" | "image/jpeg" | "image/webp",
      }, () => nodeId);
      const priorConfig = readTvcProject(before)?.logo;
      const next = priorConfig
        ? configureTvcLogo(created.graph, {
            nodeId: created.nodeId,
            placement: priorConfig.placement,
            durationSeconds: priorConfig.durationSeconds,
          }).graph
        : created.graph;
      graphRef.current = next;
      setGraph(next);
      const url = URL.createObjectURL(file);
      loadedAssets.current.add(assetId);
      if (remote && uploaded.assetVersion) {
        setAssetVersions((current) => ({ ...current, [assetId]: uploaded.assetVersion }));
      }
      setAssetUrls((current) => ({ ...current, [assetId]: url }));
      setAssetErrors((current) => {
        const nextErrors = { ...current };
        delete nextErrors["tvc-logo-upload"];
        return nextErrors;
      });
    } catch (error) {
      if (assetId) {
        if (remote) {
          await deleteCloudAsset(assetId).catch(() => undefined);
        } else {
          await deleteAsset(assetId).catch(() => undefined);
        }
      }
      setAssetErrors((current) => ({
        ...current,
        "tvc-logo-upload": error instanceof Error ? error.message : "无法上传品牌 Logo。",
      }));
    }
  }

  function configureTvcLogoUsage(
    placement: TvcLogoPlacement,
    durationSeconds: number,
  ) {
    try {
      const project = readTvcProject(graphRef.current);
      const logoNode = project
        ? graphRef.current.nodes.find((node) => node.id === project.logo?.nodeId) ??
          [...graphRef.current.nodes].reverse().find(
            (node) => node.type === "source" &&
              node.storyRole === "tvc-logo" &&
              node.tvcProjectId === project.projectId,
          )
        : undefined;
      if (!logoNode || !isTvcLogoSource(logoNode, project?.projectId)) {
        throw new Error("请先上传当前 TVC 项目的 PNG、JPEG 或 WebP 品牌 Logo。");
      }
      const configured = configureTvcLogo(graphRef.current, {
        nodeId: logoNode.id,
        placement,
        durationSeconds,
      });
      graphRef.current = configured.graph;
      setGraph(configured.graph);
      setTvcPromptAutoRequest(null);
      setTvcPromptRegeneration(null);
    } catch (error) {
      setAssetErrors((current) => ({
        ...current,
        "tvc-logo-upload": error instanceof Error ? error.message : "无法设置品牌 Logo 用途。",
      }));
    }
  }

  function setTvcNarrationOption(narration: "include" | "omit") {
    try {
      const saved = setTvcPromptNarration(graphRef.current, narration);
      graphRef.current = saved.graph;
      setGraph(saved.graph);
      const project = readTvcProject(saved.graph);
      if (project?.phase === "script-locked" && project.promptPlan?.length) {
        queueTvcPromptRegeneration(saved.graph);
      }
    } catch (error) {
      const project = readTvcProject(graphRef.current);
      setTvcPromptRegeneration({
        projectId: project?.projectId ?? "",
        state: "error",
        message: error instanceof Error ? error.message : "无法设置旁白选项。",
      });
    }
  }

  function fitImageNodeToMedia(
    nodeId: string,
    naturalWidth: number,
    naturalHeight: number,
  ) {
    setGraph((current) =>
      fitWorkflowImageNode(current, nodeId, naturalWidth, naturalHeight),
    );
  }

  function updateSchedulerKind(node: WorkflowSchedulerNode, outputKind: ComposerMode) {
    if (isTvcVideoSchedulerNode(node)) {
      setGraph((current) => updateWorkflowNode(current, node.id, {
        error: "TVC 最终提示词调度器固定输出视频，可调整其余视频参数。",
      }));
      return;
    }
    if (isTvcProject(graphRef.current) && outputKind === "video") {
      setGraph((current) => updateWorkflowNode(current, node.id, {
        error: "TVC 视频任务由锁稿后的最终提示词自动建立，不能手动转换。",
      }));
      return;
    }
    setGraph((current) => updateWorkflowNode(current, node.id, {
      ...schedulerDefaults(outputKind),
      error: "",
    }));
  }

  function updateSchedulerModel(node: WorkflowSchedulerNode, model: string) {
    const config = getModelConfig(node.outputKind, model);
    if (!config) return;
    updateSchedulerFields(node, {
      model,
      aspectRatio: config.aspectRatios[0] ?? "",
      resolution: config.defaultResolution ?? config.resolutions[0] ?? "",
      duration: config.durations[0] ?? "",
      error: "",
    });
  }

  const commitGraph = useCallback(
    (updater: (current: WorkflowGraph) => WorkflowGraph) => {
      setGraph((current) => {
        const next = updater(current);
        graphRef.current = next;
        return next;
      });
    },
    [],
  );

  const persistMediaSubmissionGraph = useCallback(async (nextGraph: WorkflowGraph) => {
    const projectId = activeProjectIdRef.current;
    if (!projectId) throw new Error("当前项目不存在，未提交媒体任务。");
    if (!remote) {
      const persistence = persistenceRef.current;
      if (persistence) {
        persistence.schedule(nextGraph);
        persistence.flush();
      } else {
        window.localStorage.setItem(
          workflowProjectGraphKey(projectId),
          JSON.stringify(nextGraph),
        );
      }
      return;
    }
    if (cloudSyncState !== "idle") {
      throw new Error("当前项目尚未同步完成，未提交媒体任务。");
    }
    const name = projects?.projects.find((project) => project.id === projectId)?.name;
    if (!name) throw new Error("当前项目不存在，未提交媒体任务。");
    if (cloudSaveTimerRef.current !== null) {
      window.clearTimeout(cloudSaveTimerRef.current);
      cloudSaveTimerRef.current = null;
    }
    const payload = {
      name,
      graph: nextGraph,
      viewport: viewportRef.current,
      batch: batchRun,
    };
    const serialized = JSON.stringify(payload);
    cloudPendingSerializedRef.current = serialized;
    setCloudSyncState("saving");
    const save = cloudSaveRef.current.then(() => saveCloudProject({
      id: projectId,
      ...payload,
      revision: cloudRevisionRef.current,
    }));
    cloudSaveRef.current = save.then(() => undefined, () => undefined);
    try {
      const saved = await save;
      if (activeProjectIdRef.current !== projectId) {
        throw new Error("项目已切换，未提交媒体任务。");
      }
      cloudRevisionRef.current = saved.revision;
      cloudLastSavedRef.current = serialized;
      if (cloudPendingSerializedRef.current === serialized) {
        cloudPendingSerializedRef.current = "";
        setCloudSyncState("idle");
      }
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error
        ? Number(error.status)
        : 0;
      if (cloudPendingSerializedRef.current === serialized) {
        cloudPendingSerializedRef.current = "";
      }
      setCloudSyncState(status === 409 ? "conflict" : "unsynced");
      throw new Error("项目保存失败，未提交媒体任务。");
    }
  }, [batchRun, cloudSyncState, projects, remote]);

  function updateSchedulerFields(
    node: WorkflowSchedulerNode,
    update: Partial<WorkflowSchedulerNode>,
  ) {
    setGraph((current) => {
      const existing = current.nodes.find(
        (candidate): candidate is WorkflowSchedulerNode =>
          candidate.id === node.id && candidate.type === "scheduler",
      );
      if (!existing || existing.tvcVideoHistorical === true) return current;
      const changed = Object.entries(update).some(([key, value]) =>
        existing[key as keyof WorkflowSchedulerNode] !== value,
      );
      if (!changed) return current;
      const updated = updateWorkflowNode(current, node.id, update);
      const next = isTvcVideoSchedulerNode(existing)
        ? markTvcVideoSchedulerManualOverride(updated, node.id)
        : updated;
      graphRef.current = next;
      return next;
    });
  }

  function isRemovableTvcVideoInput(
    graph: WorkflowGraph,
    schedulerId: string,
    edgeId: string,
  ) {
    const scheduler = graph.nodes.find(
      (node): node is WorkflowSchedulerNode =>
        node.id === schedulerId &&
        node.type === "scheduler" &&
        isTvcVideoSchedulerNode(node),
    );
    const edge = graph.edges.find((candidate) => candidate.id === edgeId);
    const source = edge
      ? graph.nodes.find((node) => node.id === edge.sourceId)
      : undefined;
    return Boolean(
      scheduler &&
        edge?.targetId === scheduler.id &&
        source &&
        source.type !== "scheduler" &&
        source.kind !== "text" &&
        scheduler.tvcVideoHistorical !== true,
    );
  }

  function isEditableTvcImageInput(
    graph: WorkflowGraph,
    schedulerId: string,
    edgeId: string,
  ) {
    const scheduler = graph.nodes.find(
      (node): node is WorkflowSchedulerNode =>
        node.id === schedulerId &&
        node.type === "scheduler" &&
        isTvcVideoSchedulerNode(node),
    );
    const edge = graph.edges.find((candidate) => candidate.id === edgeId);
    const source = edge
      ? graph.nodes.find((node) => node.id === edge.sourceId)
      : undefined;
    return Boolean(
      scheduler &&
        edge?.targetId === scheduler.id &&
        scheduler.tvcVideoHistorical !== true &&
        source &&
        isTvcVideoSchedulerReference(graph, scheduler, source),
    );
  }

  function removeTvcVideoImageInput(schedulerId: string, edgeId: string) {
    setGraph((current) => {
      if (!isRemovableTvcVideoInput(current, schedulerId, edgeId)) return current;
      const next = markTvcVideoSchedulerManualOverride(
        updateWorkflowNode(removeWorkflowEdge(current, edgeId), schedulerId, { error: "" }),
        schedulerId,
      );
      graphRef.current = next;
      return next;
    });
  }

  function moveTvcVideoImageInput(
    schedulerId: string,
    edgeId: string,
    direction: "up" | "down",
  ) {
    setGraph((current) => {
      if (!isEditableTvcImageInput(current, schedulerId, edgeId)) return current;
      const incoming = current.edges.filter((edge) => edge.targetId === schedulerId);
      const imageEdges = incoming.filter((edge) =>
        isEditableTvcImageInput(current, schedulerId, edge.id),
      );
      const index = imageEdges.findIndex((edge) => edge.id === edgeId);
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || nextIndex < 0 || nextIndex >= imageEdges.length) return current;
      const reorderedImages = [...imageEdges];
      [reorderedImages[index], reorderedImages[nextIndex]] = [
        reorderedImages[nextIndex]!,
        reorderedImages[index]!,
      ];
      const nonImageEdges = incoming.filter((edge) =>
        !imageEdges.some((imageEdge) => imageEdge.id === edge.id),
      );
      const reorderedIncoming = [...nonImageEdges, ...reorderedImages];
      let incomingIndex = 0;
      const reordered = updateWorkflowNode({
        ...current,
        edges: current.edges.map((edge) =>
          edge.targetId === schedulerId
            ? reorderedIncoming[incomingIndex++]!
            : edge,
        ),
      }, schedulerId, { error: "" });
      const next = markTvcVideoSchedulerManualOverride(reordered, schedulerId);
      graphRef.current = next;
      return next;
    });
  }

  const saveTvcStoryboard = useCallback((rows: TvcStoryboardTableDraftRow[]) => {
    const saved = saveTvcStoryboardTableDraft(graphRef.current, rows);
    commitGraph(() => saved.graph);
    setIsTvcLockConfirming(false);
    setTvcStoryboardView(null);
  }, [commitGraph]);

  const queueTvcPromptRegeneration = useCallback((nextGraph: WorkflowGraph) => {
    const project = readTvcProject(nextGraph);
    if (
      !project ||
      project.phase !== "script-locked" ||
      project.lockedRevision === undefined ||
      !project.promptPlan?.length
    ) {
      throw new Error("镜头段尚未保存为锁稿状态，不能重建最终提示词。");
    }
    if (!project.promptOptions) {
      setTvcPromptRegeneration({
        projectId: project.projectId,
        state: "error",
        message: "请先在 TVC 导演设置中选择“加入旁白”或“不加旁白”，再输出最终提示词。",
      });
      setIsAgentOpen(true);
      return;
    }
    const requestId = crypto.randomUUID();
    setTvcPromptAutoRequest({
      id: requestId,
      textOnly: true,
      content: [
        `当前 TVC 项目 ${project.projectId} 已锁稿，并已保存 30 秒以内的视频镜头段。`,
        `仅返回一项 create_tvc_prompt_package，project_id=${project.projectId}，source_revision=${project.lockedRevision}。`,
        "必须严格使用画布 tvc.promptPlan 中的每个 ref、起止秒数、镜头编号和参考资产顺序；只补全每段最终视频提示词。",
        project.promptOptions.narration === "omit"
          ? "本次选择不加旁白：不得输出旁白描述，但必须保留分镜中的角色对白、环境声和拟声。"
          : "本次选择加入旁白：保留分镜中的旁白、角色对白、环境声和拟声。",
        project.logo?.placement === "standalone"
          ? "必须额外返回 standalone_logo_unit：只引用当前品牌 Logo，时长严格匹配当前 Logo 设置；它不属于 tvc.promptPlan。"
          : "不得返回 standalone_logo_unit。",
        "不得修改 Brief、资产、分镜表或镜头段；不得读取图片；不得提交图片、视频或其他媒体任务。",
      ].join("\n"),
    });
    setTvcPromptRegeneration({
      projectId: project.projectId,
      requestId,
      state: "awaiting",
      message: "镜头段已保存，正在仅用锁定分镜重建最终提示词；不会提交媒体任务。",
    });
    setIsAgentOpen(true);
  }, []);

  const prepareTvc30SecondPromptPlan = useCallback(() => {
    try {
      const prepared = prepareTvcPromptPlan(graphRef.current);
      graphRef.current = prepared.graph;
      setGraph(prepared.graph);
      const project = readTvcProject(prepared.graph);
      setTvcPromptAutoRequest(null);
      setTvcPromptRegeneration({
        projectId: project?.projectId ?? "",
        state: "saved",
        message: "已按 30 秒以内的默认边界建立镜头段。确认切点后点击“保存镜头段并重新输出”。",
      });
      setTvcStoryboardView({
        tab: "prompt",
        editing: false,
        segmentEditing: true,
      });
    } catch (error) {
      const project = readTvcProject(graphRef.current);
      setTvcPromptRegeneration({
        projectId: project?.projectId ?? "",
        state: "error",
        message: error instanceof Error ? error.message : "无法按 30 秒镜头段重新输出。",
      });
    }
  }, []);

  const saveTvcPromptPlan = useCallback((boundaries: TvcPromptPlanBoundary[]) => {
    try {
      const saved = saveTvcPromptPlanBoundaries(graphRef.current, boundaries);
      graphRef.current = saved.graph;
      setGraph(saved.graph);
      queueTvcPromptRegeneration(saved.graph);
    } catch (error) {
      const project = readTvcProject(graphRef.current);
      setTvcPromptRegeneration({
        projectId: project?.projectId ?? "",
        state: "error",
        message: error instanceof Error ? error.message : "无法保存 TVC 镜头段。",
      });
    }
  }, [queueTvcPromptRegeneration]);

  const completeTvcPromptRegeneration = useCallback((
    requestId: string,
    outcome: CanvasAgentAutoRequestOutcome,
  ) => {
    setTvcPromptAutoRequest((current) => current?.id === requestId ? null : current);
    setTvcPromptRegeneration((current) => {
      if (!current || current.requestId !== requestId) return current;
      const project = readTvcProject(graphRef.current);
      if (outcome.succeeded && project?.projectId === current.projectId && project.phase === "prompt-final") {
        return {
          projectId: current.projectId,
          state: "saved",
          message: "最终提示词已更新，已按实际视频调度器建立可运行节点；尚未提交媒体任务。",
        };
      }
      return {
        projectId: current.projectId,
        state: "error",
        message: outcome.succeeded
          ? "Agent 未返回可用的最终提示词包，请检查锁稿分镜后重试。"
          : outcome.error,
      };
    });
  }, []);

  const runScheduler = useCallback(async (schedulerId: string, retryResultId?: string) => {
    if (runningSchedulersRef.current.has(schedulerId)) return;
    const scheduler = graphRef.current.nodes.find(
      (node): node is WorkflowSchedulerNode =>
        node.id === schedulerId && node.type === "scheduler",
    );
    if (!scheduler) return;
    if (
      scheduler.outputKind === "video" &&
      schedulerHasSubmissionUnknownResult(graphRef.current, scheduler.id)
    ) {
      commitGraph((current) => updateWorkflowNode(current, scheduler.id, {
        error: "该视频任务提交状态未知，请先在结果节点确认是否重新提交。",
      }));
      return;
    }
    if (remote && cloudSyncState !== "idle") {
      commitGraph((current) => updateWorkflowNode(current, scheduler.id, {
        error: "当前项目尚未同步完成，未提交媒体任务。",
      }));
      return;
    }
    const tvcRunError = isTvcVideoSchedulerNode(scheduler)
      ? tvcVideoSchedulerRunError(graphRef.current, scheduler)
      : null;
    if (tvcRunError) {
      commitGraph((current) => updateWorkflowNode(current, scheduler.id, {
        error: tvcRunError,
      }));
      return;
    }
    if (
      isTvcProject(graphRef.current) &&
      scheduler.outputKind === "video" &&
      !isTvcVideoSchedulerNode(scheduler)
    ) {
      commitGraph((current) => updateWorkflowNode(current, scheduler.id, {
        error: "TVC 仅允许锁稿后的最终提示词视频调度器提交任务。",
      }));
      return;
    }
    const inputs = readWorkflowInputs(graphRef.current, scheduler.id);
    if (inputs.videos.length) {
      commitGraph((current) => updateWorkflowNode(current, scheduler.id, {
        error: "当前模型不支持视频参考输入。",
      }));
      return;
    }
    if (
      inputs.images.some(
        (node) => node.type === "result" && node.status !== "success",
      )
    ) {
      commitGraph((current) => updateWorkflowNode(current, scheduler.id, {
        error: "上游分镜图尚未生成完成。",
      }));
      return;
    }
    const prompt = buildWorkflowGenerationPrompt(inputs, scheduler);
    if (!prompt) {
      commitGraph((current) => updateWorkflowNode(current, scheduler.id, { error: "请填写提示词或连接文本节点。" }));
      return;
    }
    const config = getModelConfig(scheduler.outputKind, scheduler.model);
    if (!config) {
      commitGraph((current) => updateWorkflowNode(current, scheduler.id, { error: "当前模型配置无效。" }));
      return;
    }
    commitGraph((current) => updateWorkflowNode(current, scheduler.id, { error: "" }));
    runningSchedulersRef.current.add(scheduler.id);
    setRunningSchedulers((current) => new Set(current).add(scheduler.id));
    let createdResultIds: string[] = [];
    try {
      const usesTrxCloudReferences = scheduler.outputKind === "video" &&
        scheduler.model === TRX_SEEDANCE_25_MODEL;
      if (usesTrxCloudReferences && !remote) {
        throw new Error("SD 2.5 视频仅支持云端项目的已归档图片资产。");
      }
      const referenceAssetIds = usesTrxCloudReferences
        ? inputs.images.map((node) => {
            if (!node.assetId) {
              throw new Error("SD 2.5 视频参考图缺少云端资产，请重新上传图片。");
            }
            return node.assetId;
          })
        : [];
      const files = usesTrxCloudReferences
        ? []
        : await Promise.all(inputs.images.map((node) =>
            workflowImageToFile(
              node,
              remote
                ? async (assetId) => readCloudAsset(assetId, assetVersionsRef.current[assetId])
                : readAsset,
            )
          ));
      const referenceCount = usesTrxCloudReferences ? referenceAssetIds.length : files.length;
      if (referenceCount > config.maxReferenceImages) {
        throw new Error(`参考图片超过当前模型的 ${config.maxReferenceImages} 张上限。`);
      }
      if (!usesTrxCloudReferences && files.some((file) => file.size > MAX_IMAGE_BYTES)) {
        throw new Error("单张参考图片不能超过 10MB。");
      }
      if (!usesTrxCloudReferences && files.reduce((sum, file) => sum + file.size, 0) > MAX_IMAGE_TOTAL_BYTES) {
        throw new Error("参考图片合计不能超过 30MB。");
      }
      const images = await Promise.all(files.map(async (file) => ({
        name: file.name,
        mimeType: file.type,
        size: file.size,
        dataUrl: await fileToDataUrl(file),
      } satisfies GenerateReferenceImage)));
      const retryResult = retryResultId
        ? graphRef.current.nodes.find(
            (node): node is WorkflowResultNode =>
              node.id === retryResultId &&
              node.type === "result" &&
              node.schedulerId === scheduler.id &&
              node.status === "ready",
          )
        : undefined;
      const created = retryResult
        ? {
            graph: updateWorkflowResult(graphRef.current, retryResult.id, {
              status: "pending",
              progress: "等待提交",
              error: "",
              model: scheduler.model,
              resultUrl: undefined,
              taskId: undefined,
              startedAt: Date.now(),
            }),
            resultIds: [retryResult.id],
          }
        : createWorkflowRun(graphRef.current, scheduler.id, Date.now());
      if (!created.resultIds.length) return;
      createdResultIds = created.resultIds;
      graphRef.current = created.graph;
      setGraph(created.graph);
      try {
        await persistMediaSubmissionGraph(created.graph);
      } catch (error) {
        const message = error instanceof Error ? error.message : "项目保存失败，未提交媒体任务。";
        const restored = created.resultIds.reduce(
          (current, resultId) => updateWorkflowResult(current, resultId, {
            status: "ready",
            progress: "待生成",
            error: "",
            taskId: undefined,
            startedAt: undefined,
          }),
          created.graph,
        );
        const next = updateWorkflowNode(restored, scheduler.id, { error: message });
        graphRef.current = next;
        setGraph(next);
        return;
      }
      await Promise.all(created.resultIds.map(async (resultId) => {
        try {
          let response: Response;
          try {
            response = await fetch("/api/ai/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode: scheduler.outputKind,
                model: scheduler.model,
                prompt,
                ...(usesTrxCloudReferences
                  ? {
                      projectId: activeProjectIdRef.current,
                      referenceAssetIds,
                    }
                  : { images }),
                aspectRatio: scheduler.aspectRatio || undefined,
                resolution: scheduler.resolution || undefined,
                duration: scheduler.duration || undefined,
              }),
            });
          } catch (error) {
            if (scheduler.outputKind === "video") {
              throw new SubmissionUnknownError("视频提交连接中断，无法确认媒体平台是否已接收请求。");
            }
            throw error;
          }
          if (!response.ok) {
            const failure = await readGenerateApiFailure(response);
            if (
              scheduler.outputKind === "video" &&
              failure.code === "submission-unknown"
            ) {
              throw new SubmissionUnknownError(failure.message);
            }
            throw new Error(failure.message);
          }
          let payload: unknown;
          try {
            payload = await response.json();
          } catch {
            if (scheduler.outputKind === "video") {
              throw new SubmissionUnknownError("媒体服务响应不完整，无法确认是否已创建视频任务。");
            }
            throw new Error("模型服务返回了无法识别的响应。");
          }
          if (
            payload &&
            typeof payload === "object" &&
            !Array.isArray(payload) &&
            typeof (payload as { error?: unknown }).error === "string"
          ) {
            const errorPayload = payload as { error: string; code?: unknown };
            if (scheduler.outputKind === "video" && errorPayload.code === "submission-unknown") {
              throw new SubmissionUnknownError(errorPayload.error);
            }
            throw new Error(errorPayload.error);
          }
          const result = payload as GenerateResponse;
          if (
            scheduler.outputKind === "video" &&
            (result.kind !== "task" ||
              typeof result.taskId !== "string" ||
              !result.taskId.trim())
          ) {
            throw new SubmissionUnknownError("媒体服务未返回任务编号。");
          }
          const next = result.kind === "text"
            ? updateWorkflowResult(graphRef.current, resultId, {
                status: "success", progress: "", text: result.content,
              })
            : updateWorkflowResult(graphRef.current, resultId, {
                status: "pending", progress: "排队中", taskId: result.taskId, startedAt: Date.now(),
              });
          graphRef.current = next;
          setGraph(next);
          if (result.kind === "task") {
            try {
              await persistMediaSubmissionGraph(next);
            } catch {
              commitGraph((current) => updateWorkflowNode(current, scheduler.id, {
                error: "任务编号已收到，但项目保存失败；请保持当前页面，系统不会再次提交。",
              }));
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "生成请求失败，请稍后重试。";
          const next = scheduler.outputKind === "video" && error instanceof SubmissionUnknownError
            ? markWorkflowResultSubmissionUnknown(graphRef.current, resultId, message)
            : updateWorkflowResult(graphRef.current, resultId, {
                status: "failed",
                progress: "",
                error: message,
              });
          graphRef.current = next;
          setGraph(next);
          if (scheduler.outputKind === "video" && error instanceof SubmissionUnknownError) {
            try {
              await persistMediaSubmissionGraph(next);
            } catch {
              commitGraph((current) => updateWorkflowNode(current, scheduler.id, {
                error: "提交状态未知，但项目保存失败；请保持当前页面，系统不会再次提交。",
              }));
            }
          }
        }
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成请求失败，请稍后重试。";
      commitGraph((current) => {
        let next = updateWorkflowNode(current, scheduler.id, { error: message });
        const storyResult = next.nodes.find(
          (node): node is WorkflowResultNode =>
            node.type === "result" &&
            node.schedulerId === scheduler.id &&
            Boolean(node.storyRole),
        );
        if (storyResult && !createdResultIds.length) {
          next = updateWorkflowResult(next, storyResult.id, {
            status: "failed",
            progress: "",
            error: message,
          });
        }
        return next;
      });
    } finally {
      runningSchedulersRef.current.delete(scheduler.id);
      setRunningSchedulers((current) => {
        const next = new Set(current);
        next.delete(scheduler.id);
        return next;
      });
    }
  }, [cloudSyncState, commitGraph, persistMediaSubmissionGraph, remote]);

  useEffect(() => {
    if (!hydrated || !batchRun || batchRun.status !== "running") return;
    const advanced = advanceWorkflowBatch(graph, batchRun);
    if (advanced.graph !== graph) {
      graphRef.current = advanced.graph;
      setGraph(advanced.graph);
    }
    if (advanced.batch !== batchRun) setBatchRun(advanced.batch);
    advanced.readySchedulerIds.forEach((schedulerId) => {
      void runScheduler(schedulerId);
    });
  }, [batchRun, graph, hydrated, runScheduler]);

  function applyAgentOperations(operations: AgentOperation[]) {
    if (!operations.length) return [];
    const outcome = applyWorkflowAgentOperations(graphRef.current, operations);
    graphRef.current = outcome.graph;
    setGraph(outcome.graph);
    return outcome.messages;
  }

  function currentAgentSnapshot() {
    return createWorkflowAgentSnapshot(
      graphRef.current,
      viewportRef.current,
      canvasSize,
    );
  }

  function updateAssetPlanningStatus(
    storyId: string,
    status: "stopped" | "failed",
  ) {
    commitGraph((current) => markStoryAssetPlanning(current, storyId, status));
  }

  function approveFoundation(storyId: string) {
    let message = "";
    commitGraph((current) => {
      const next = approveStoryFoundation(current, storyId);
      message = "已确认主角与核心配角，正在继续规划其余资产。";
      return next;
    });
    return message;
  }

  async function readAgentImages(
    nodeIds: string[],
  ): Promise<AgentInspectedImage[]> {
    return Promise.all(
      [...new Set(nodeIds)].slice(0, 5).map(async (nodeId) => {
        const node = graphRef.current.nodes.find(
          (candidate): candidate is WorkflowSourceNode | WorkflowResultNode =>
            candidate.id === nodeId &&
            candidate.type !== "scheduler" &&
            candidate.kind === "image",
        );
        if (!node) throw new Error(`未找到可读取的工作流图片节点 ${nodeId}。`);
        const file = await workflowImageToFile(
          node,
          remote
            ? async (assetId) => readCloudAsset(assetId, assetVersionsRef.current[assetId])
            : readAsset,
        );
        return {
          nodeId,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          dataUrl: await fileToDataUrl(file),
        };
      }),
    );
  }

  async function confirmAgentOperation(
    operation: AgentDangerousOperation,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    if (operation.type === "run_story_assets") {
      const description = describeStoryAssetRun(graphRef.current, operation);
      const prepared = createStoryAssetBatchRun(graphRef.current, operation);
      graphRef.current = prepared.graph;
      setGraph(prepared.graph);
      setBatchRun(prepared.batch);
      return description;
    }
    if (operation.type !== "run_story_workflow") {
      throw new Error("当前工作流画布不支持此确认操作。");
    }
    const batch = createWorkflowBatchRun(graphRef.current, operation);
    setBatchRun(batch);
    return describeWorkflowRun(graphRef.current, operation);
  }

  function describeAgentOperation(operation: AgentDangerousOperation) {
    if (operation.type === "run_story_workflow") {
      return describeWorkflowRun(graphRef.current, operation);
    }
    if (operation.type === "run_story_assets") {
      return describeStoryAssetRun(graphRef.current, operation);
    }
    return describeDangerousOperation(operation);
  }

  function persistActiveProject() {
    if (remote) return;
    const projectId = activeProjectIdRef.current;
    if (!projectId) return;
    persistenceRef.current?.flush();
    let graphToSave = graphRef.current;
    if (agentBusy) {
      graphRef.current.nodes.forEach((node) => {
        if (
          node.storyRole === "analysis" &&
          node.storyId &&
          node.planningStatus === "planning"
        ) {
          graphToSave = markStoryAssetPlanning(graphToSave, node.storyId, "stopped");
        }
      });
    }
    window.localStorage.setItem(
      workflowProjectGraphKey(projectId),
      JSON.stringify(graphToSave),
    );
    window.localStorage.setItem(
      workflowProjectViewportKey(projectId),
      JSON.stringify(viewportRef.current),
    );
    if (batchRun) {
      window.localStorage.setItem(
        workflowProjectBatchKey(projectId),
        JSON.stringify(batchRun),
      );
    } else {
      window.localStorage.removeItem(workflowProjectBatchKey(projectId));
    }
  }

  async function activateProject(registry: WorkflowProjectRegistry, projectId: string) {
    if (projectId === activeProjectIdRef.current) return;
    if (runningSchedulersRef.current.size) {
      window.alert("生成请求正在提交，请等待任务 ID 保存后再切换项目。");
      return;
    }
    if (remote) {
      if (cloudSyncState !== "idle") {
        window.alert("当前项目尚未同步完成，请先重试保存或处理版本冲突。");
        return;
      }
      try {
        await activateCloudProject(projectId);
        const next = { ...registry, activeProjectId: projectId };
        activeProjectIdRef.current = projectId;
        setProjects(next);
        setHydrated(false);
        await reloadCloudProject(projectId);
        setHydrated(true);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "无法切换项目。");
      }
      return;
    }
    persistActiveProject();
    const next = { ...registry, activeProjectId: projectId };
    window.localStorage.setItem(WORKFLOW_PROJECTS_STORAGE_KEY, JSON.stringify(next));
    activeProjectIdRef.current = projectId;
    setProjects(next);
    setAgentBusy(false);
    loadProject(projectId);
  }

  function addProject() {
    if (!projects) return;
    if (runningSchedulersRef.current.size) {
      window.alert("生成请求正在提交，请等待任务 ID 保存后再新建项目。");
      return;
    }
    if (remote && cloudSyncState !== "idle") {
      window.alert("当前项目尚未同步完成，请先重试保存或处理版本冲突。");
      return;
    }
    setProjectEditor({
      mode: "create",
      value: `新项目 ${projects.projects.length + 1}`,
      projectMode: "workflow",
      error: "",
    });
  }

  async function saveProjectName() {
    if (!projects || !projectEditor) return;
    try {
      if (projectEditor.mode === "create") {
        if (remote) {
          const created = await createCloudProject(
            projectEditor.value,
            projectEditor.projectMode,
          );
          const registry = await loadCloudProjects();
          setProjectEditor(null);
          activeProjectIdRef.current = created.id;
          setProjects(registry);
          setHydrated(false);
          await reloadCloudProject(created.id);
          setHydrated(true);
          return;
        }
        const created = createWorkflowProject(projects, projectEditor.value);
        window.localStorage.setItem(
          workflowProjectGraphKey(created.project.id),
          JSON.stringify(createWorkflowProjectGraph(
            projectEditor.projectMode,
            () => created.project.id,
          )),
        );
        window.localStorage.setItem(
          workflowProjectViewportKey(created.project.id),
          JSON.stringify({ x: 0, y: 0, scale: 1 }),
        );
        setProjectEditor(null);
        activateProject(created.registry, created.project.id);
        return;
      }
      const next = renameWorkflowProject(
        projects,
        projects.activeProjectId,
        projectEditor.value,
      );
      if (remote) {
        setProjects(next);
        setProjectEditor(null);
        return;
      }
      window.localStorage.setItem(WORKFLOW_PROJECTS_STORAGE_KEY, JSON.stringify(next));
      setProjects(next);
      setProjectEditor(null);
    } catch (error) {
      setProjectEditor((current) => current
        ? {
            ...current,
            error: error instanceof Error ? error.message : "无法保存项目名称。",
          }
        : current
      );
    }
  }

  function renameActiveProject() {
    if (!projects) return;
    if (remote && cloudSyncState !== "idle") {
      window.alert("当前项目尚未同步完成，请先重试保存或处理版本冲突。");
      return;
    }
    const active = projects.projects.find(
      (project) => project.id === projects.activeProjectId,
    );
    if (!active) return;
    setProjectEditor({
      mode: "rename",
      value: active.name,
      projectMode: "workflow",
      error: "",
    });
  }

  async function deleteActiveProject() {
    if (!projects) return;
    if (runningSchedulersRef.current.size) {
      window.alert("生成请求正在提交，请等待任务 ID 保存后再删除项目。");
      return;
    }
    if (remote && cloudSyncState !== "idle") {
      window.alert("当前项目尚未同步完成，请先重试保存或处理版本冲突。");
      return;
    }
    const active = projects.projects.find(
      (project) => project.id === projects.activeProjectId,
    );
    if (!active) return;
    const remoteCount = graphRef.current.nodes.filter((node) =>
      node.type === "result" && Boolean(node.taskId) &&
      (node.status === "pending" || node.status === "running")
    ).length;
    const warning = [
      `删除项目“${active.name}”？`,
      `将删除 ${graphRef.current.nodes.length} 个节点及该项目的 Agent 对话。`,
      ...(remoteCount
        ? [`其中 ${remoteCount} 个远端任务可能仍会继续并产生费用，删除只能停止本地查询。`]
        : []),
      "此操作无法撤销。",
    ].join("\n");
    if (!window.confirm(warning)) return;

    if (remote) {
      try {
        await deleteCloudProject(active.id);
        if (user) await deleteCloudProjectThumbnails(user.id, active.id);
        const registry = await loadCloudProjects();
        activeProjectIdRef.current = registry.activeProjectId;
        setProjects(registry);
        setAgentBusy(false);
        setHydrated(false);
        await reloadCloudProject(registry.activeProjectId);
        setHydrated(true);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "无法删除项目。");
      }
      return;
    }

    persistActiveProject();
    const removedAssetIds = projectSourceAssetIds(graphRef.current);
    const remainingProjects = projects.projects.filter((project) => project.id !== active.id);
    const remainingAssetIds = new Set<string>();
    remainingProjects.forEach((project) => {
      const candidate = parseWorkflowGraph(window.localStorage.getItem(
        workflowProjectGraphKey(project.id),
      ));
      projectSourceAssetIds(candidate).forEach((assetId) => remainingAssetIds.add(assetId));
    });
    removedAssetIds.forEach((assetId) => {
      if (!remainingAssetIds.has(assetId)) void deleteAsset(assetId);
    });
    window.localStorage.removeItem(workflowProjectGraphKey(active.id));
    window.localStorage.removeItem(workflowProjectBatchKey(active.id));
    window.localStorage.removeItem(workflowProjectConversationKey(active.id));
    window.localStorage.removeItem(workflowProjectViewportKey(active.id));

    const next = removeWorkflowProject(projects, active.id);
    const replacement = next.projects.find((project) =>
      !projects.projects.some((current) => current.id === project.id)
    );
    if (replacement) {
      window.localStorage.setItem(
        workflowProjectGraphKey(replacement.id),
        JSON.stringify(emptyWorkflowGraph()),
      );
      window.localStorage.setItem(
        workflowProjectViewportKey(replacement.id),
        JSON.stringify({ x: 0, y: 0, scale: 1 }),
      );
    }
    window.localStorage.setItem(WORKFLOW_PROJECTS_STORAGE_KEY, JSON.stringify(next));
    activeProjectIdRef.current = next.activeProjectId;
    setProjects(next);
    setAgentBusy(false);
    loadProject(next.activeProjectId);
  }

  async function saveCloudCopy() {
    if (!projects) return;
    const active = projects.projects.find((project) => project.id === projects.activeProjectId);
    if (!active) return;
    try {
      const created = await createCloudProject(
        `${active.name}-副本-${Date.now()}`,
        isTvcProject(graphRef.current) ? "tvc" : "workflow",
      );
      const blank = await loadCloudProject(created.id);
      await saveCloudProject({
        id: created.id,
        name: `${active.name}-副本`,
        graph: graphRef.current,
        viewport: viewportRef.current,
        batch: batchRun,
        revision: blank.revision,
      });
      const registry = await loadCloudProjects();
      activeProjectIdRef.current = created.id;
      setProjects(registry);
      await reloadCloudProject(created.id);
      setCloudSyncState("idle");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "无法另存项目副本。");
    }
  }

  async function exportLocalProject() {
    if (remote || !projects) return;
    const active = projects.projects.find((project) => project.id === projects.activeProjectId);
    if (!active) return;
    try {
      const conversation = parseAgentConversationStore(
        window.localStorage.getItem(workflowProjectConversationKey(active.id)),
        null,
      );
      const textConversation: AgentConversationStore = {
        ...conversation,
        conversations: conversation.conversations.map((item) => ({
          ...item,
          messages: item.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
            ...(message.details?.length ? { details: message.details } : {}),
          })),
        })),
      };
      const exported = await prepareWorkflowProjectExport(graphRef.current, readAsset);
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        project: active,
        graph: exported.graph,
        viewport: viewportRef.current,
        batch: null,
        conversation: textConversation,
        assets: exported.assets,
      };
      const serialized = JSON.stringify(payload);
      const url = URL.createObjectURL(new Blob([serialized], {
        type: "application/json",
      }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${active.name.replace(/[\\/:*?"<>|]/g, "-")}.canvas.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "无法导出当前项目。");
    }
  }

  function chooseProjectImport() {
    if (projectImporting) return;
    if (runningSchedulersRef.current.size) {
      setProjectImportError("生成请求正在提交，请等待任务 ID 保存后再导入项目。");
      return;
    }
    if (remote && cloudSyncState !== "idle") {
      setProjectImportError("当前项目尚未同步完成，请先重试保存或处理版本冲突。");
      return;
    }
    setProjectImportError("");
    projectImportInputRef.current?.click();
  }

  async function importProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!/\.canvas\.json$/i.test(file.name)) {
      setProjectImportError("请选择 .canvas.json 项目文件。");
      return;
    }
    if (!projects) return;
    if (projectImporting || runningSchedulersRef.current.size) {
      setProjectImportError("生成请求正在提交，请等待任务 ID 保存后再导入项目。");
      return;
    }
    if (remote && cloudSyncState !== "idle") {
      setProjectImportError("当前项目尚未同步完成，请先重试保存或处理版本冲突。");
      return;
    }
    setProjectImporting(true);
    if (remote) {
      const previousProjectId = activeProjectIdRef.current;
      let createdProjectId = "";
      try {
        const imported = importWorkflowProject(projects, await file.text());
        const expectedAssets = projectImageAssets(imported.graph);
        if (expectedAssets.length !== imported.assets.length) {
          throw new Error("云端导入需要文件包含全部图片素材，无法安全迁移缺失图片的项目。");
        }
        const created = await createCloudProject(
          imported.project.name,
          isTvcProject(imported.graph) ? "tvc" : "workflow",
        );
        createdProjectId = created.id;
        const uploadedAssets = new Map<string, { assetId: string; assetUrl: string }>();
        for (const asset of imported.assets) {
          const node = imported.graph.nodes.find((candidate) =>
            (candidate.type === "source" || candidate.type === "result") &&
            candidate.kind === "image" &&
            candidate.assetId === asset.id
          );
          if (!node) throw new Error("导入文件中的图片引用无效。");
          const blob = await imageBlobFromDataUrl(asset.dataUrl, asset.mimeType);
          const uploaded = await uploadCloudAsset({
            projectId: created.id,
            nodeId: node.id,
            file: new File([blob], asset.name, { type: asset.mimeType }),
          });
          uploadedAssets.set(asset.id, {
            assetId: uploaded.assetId,
            assetUrl: cloudAssetUrl(uploaded.assetId),
          });
        }
        const cloudGraph = rebindImportedWorkflowAssets(imported.graph, uploadedAssets);
        await saveCloudProject({
          id: created.id,
          name: created.name,
          graph: cloudGraph,
          viewport: imported.viewport,
          batch: null,
          revision: created.revision,
        });
        await saveCloudConversation({
          projectId: created.id,
          conversation: imported.conversation as AgentConversationStore,
          revision: 1,
        });
        const registry = await loadCloudProjects();
        activeProjectIdRef.current = created.id;
        setProjects(registry);
        setAgentBusy(false);
        setHydrated(false);
        await reloadCloudProject(created.id);
        setHydrated(true);
        setCloudSyncState("idle");
        setProjectImportError("");
      } catch (error) {
        if (createdProjectId) {
          await deleteCloudProject(createdProjectId).catch(() => undefined);
          if (previousProjectId) {
            await activateCloudProject(previousProjectId).catch(() => undefined);
          }
        }
        setProjectImportError(error instanceof Error ? error.message : "无法导入云端项目文件。");
      } finally {
        setProjectImporting(false);
      }
      return;
    }
    const savedAssetIds: string[] = [];
    try {
      const imported = importWorkflowProject(projects, await file.text());
      for (const asset of imported.assets) {
        const blob = await imageBlobFromDataUrl(asset.dataUrl, asset.mimeType);
        await saveAsset(asset.id, blob);
        savedAssetIds.push(asset.id);
      }

      const activeProjectId = activeProjectIdRef.current;
      if (activeProjectId) {
        persistenceRef.current?.flush();
        window.localStorage.setItem(
          workflowProjectGraphKey(activeProjectId),
          JSON.stringify(graphRef.current),
        );
        window.localStorage.setItem(
          workflowProjectViewportKey(activeProjectId),
          JSON.stringify(viewportRef.current),
        );
        if (batchRun) {
          window.localStorage.setItem(
            workflowProjectBatchKey(activeProjectId),
            JSON.stringify(batchRun),
          );
        } else {
          window.localStorage.removeItem(workflowProjectBatchKey(activeProjectId));
        }
      }

      window.localStorage.setItem(
        workflowProjectGraphKey(imported.project.id),
        JSON.stringify(imported.graph),
      );
      window.localStorage.setItem(
        workflowProjectViewportKey(imported.project.id),
        JSON.stringify(imported.viewport),
      );
      window.localStorage.removeItem(workflowProjectBatchKey(imported.project.id));
      window.localStorage.setItem(
        workflowProjectConversationKey(imported.project.id),
        JSON.stringify(imported.conversation),
      );
      window.localStorage.setItem(
        WORKFLOW_PROJECTS_STORAGE_KEY,
        JSON.stringify(imported.registry),
      );
      activeProjectIdRef.current = imported.project.id;
      setProjects(imported.registry);
      setAgentBusy(false);
      const missingImageCount = projectImageAssets(imported.graph).length - imported.assets.length;
      setProjectImportError(
        missingImageCount
          ? `导入完成，但 ${missingImageCount} 项图片未包含在文件中，请在对应节点重新上传。`
          : "",
      );
      loadProject(imported.project.id);
    } catch (error) {
      await Promise.all(savedAssetIds.map((assetId) => deleteAsset(assetId)));
      setProjectImportError(error instanceof Error ? error.message : "无法导入项目文件。");
    } finally {
      setProjectImporting(false);
    }
  }

  async function exportTvcStoryboard() {
    const project = readTvcProject(graphRef.current);
    if (!project?.storyboard || !projects) return;
    if (remote) {
      window.location.assign(
        `/api/workflow/projects/${encodeURIComponent(projects.activeProjectId)}/tvc/storyboard`,
      );
      return;
    }
    try {
      const bytes = await createTvcStoryboardWorkbook(project.storyboard);
      const url = URL.createObjectURL(new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = tvcStoryboardFilename(project.storyboard.title);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "无法导出 TVC 分镜表。");
    }
  }

  function confirmTvcScriptLock() {
    try {
      commitGraph((current) => lockTvcScript(current));
      setIsTvcLockConfirming(false);
      setIsAgentOpen(true);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "无法锁定 TVC 分镜表。");
    }
  }

  function deleteNode(node: WorkflowNode) {
    if (node.type === "result" && node.status === "submission-unknown") {
      window.alert("该视频提交状态未知，不能通过删除绕过重提确认。请在结果节点使用“确认重新提交”。");
      return;
    }
    if (
      node.type === "result" &&
      (node.status === "pending" ||
        node.status === "running")
    ) {
      if (!window.confirm("删除只会停止本地查询，远端任务仍可能继续并产生费用。确定删除吗？")) return;
    }
    setSelectedIds((current) => current.filter((id) => id !== node.id));
    setGraph((current) => removeWorkflowNode(current, node.id));
    if ((node.type === "source" || node.type === "result") && node.assetId) {
      const url = assetUrlsRef.current[node.assetId];
      if (url) URL.revokeObjectURL(url);
      void (remote ? deleteCloudAsset(node.assetId) : deleteAsset(node.assetId));
      if (remote && user) void deleteCloudThumbnail(user.id, node.assetId);
      setAssetUrls((current) => {
        const next = { ...current };
        delete next[node.assetId!];
        return next;
      });
      setAssetVersions((current) => {
        const next = { ...current };
        delete next[node.assetId!];
        return next;
      });
    }
  }

  function requestSubmissionRetry(node: WorkflowResultNode) {
    if (node.status !== "submission-unknown" || !node.schedulerId) return;
    setSubmissionRetryConfirmation({
      resultId: node.id,
      schedulerId: node.schedulerId,
    });
  }

  function confirmSubmissionRetry() {
    const confirmation = submissionRetryConfirmation;
    if (!confirmation) return;
    const result = graphRef.current.nodes.find(
      (node): node is WorkflowResultNode =>
        node.id === confirmation.resultId &&
        node.type === "result",
    );
    const scheduler = graphRef.current.nodes.find(
      (node): node is WorkflowSchedulerNode =>
        node.id === confirmation.schedulerId &&
        node.type === "scheduler",
    );
    if (!result || result.status !== "submission-unknown" || !scheduler) {
      setSubmissionRetryConfirmation(null);
      return;
    }
    const next = updateWorkflowResult(graphRef.current, result.id, {
      status: "ready",
      progress: "待重新提交",
      error: "",
      taskId: undefined,
      startedAt: undefined,
    });
    graphRef.current = next;
    setGraph(next);
    setSubmissionRetryConfirmation(null);
    void runScheduler(scheduler.id, result.id);
  }

  const tvcProject = readTvcProject(graph);
  const tvcLogoNode = tvcProject
    ? graph.nodes.find(
        (node): node is WorkflowSourceNode => node.id === tvcProject.logo?.nodeId && node.type === "source",
      ) ?? [...graph.nodes].reverse().find(
        (node): node is WorkflowSourceNode =>
          node.type === "source" &&
          node.storyRole === "tvc-logo" &&
          node.tvcProjectId === tvcProject.projectId,
      )
    : undefined;
  const tvcVideoSchedulers = tvcProject
    ? graph.nodes.filter(
        (node): node is WorkflowSchedulerNode =>
          node.type === "scheduler" &&
          isTvcVideoSchedulerNode(node) &&
          node.tvcProjectId === tvcProject.projectId,
      )
    : [];
  const tvcSegmentControlsReadOnly = Boolean(
    tvcProject && graph.nodes.some((node) =>
        node.tvcProjectId === tvcProject.projectId && (
          node.tvcVideoHistorical === true ||
        (isTvcVideoResultNode(node) &&
          (Boolean(node.taskId) || node.status !== "ready"))
      ),
    ),
  );
  const tvcPromptStatus = tvcProject && tvcPromptRegeneration?.projectId === tvcProject.projectId
    ? tvcPromptRegeneration
    : null;
  const tvcSystemRoles = new Set([
    "tvc-brief",
    "tvc-logo",
    "tvc-storyboard",
    "tvc-prompt",
    "tvc-logo-prompt",
    "tvc-video-scheduler",
    "tvc-video-result",
    "tvc-logo-video-scheduler",
    "tvc-logo-video-result",
  ]);
  const selection = selectedIds.length > 1 ? workflowSelectionBounds(graph, selectedIds) : null;
  const selectedAssetRefs = assetRefsForSelection(graph, selectedIds);
  const selectedAssetStoryIds = [...new Set(
    graph.nodes.flatMap((node) =>
      selectedIds.includes(node.id) && node.assetRef && node.storyId
        ? [node.storyId]
        : [],
    ),
  )];

  function runSelectedAssets() {
    if (!selectedAssetRefs.length) return;
    if (selectedAssetStoryIds.length !== 1) {
      window.alert("请一次只选择同一短剧项目的资产。");
      return;
    }
    const operation = {
      type: "run_story_assets" as const,
      storyId: selectedAssetStoryIds[0],
      assetRefs: selectedAssetRefs,
    };
    try {
      const description = describeStoryAssetRun(graphRef.current, operation);
      if (!window.confirm(`${description}。确定继续吗？`)) return;
      const prepared = createStoryAssetBatchRun(graphRef.current, operation);
      graphRef.current = prepared.graph;
      setGraph(prepared.graph);
      setBatchRun(prepared.batch);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "无法生成选中资产。");
    }
  }
  const marqueeBounds = marquee ? {
    x: Math.min(marquee.startX, marquee.currentX),
    y: Math.min(marquee.startY, marquee.currentY),
    width: Math.abs(marquee.currentX - marquee.startX),
    height: Math.abs(marquee.currentY - marquee.startY),
  } : null;
  const nodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const inputPorts = useMemo(() => workflowInputPorts(graph), [graph]);
  const edgeKinds = useMemo(() => workflowEdgeKinds(graph), [graph]);
  const inputPortByEdge = useMemo(
    () => new Map(inputPorts.map((port) => [port.edgeId, port])),
    [inputPorts],
  );
  const inputPortsByTarget = useMemo(() => {
    const byTarget = new Map<string, WorkflowInputPort[]>();
    inputPorts.forEach((port) => {
      const targetPorts = byTarget.get(port.targetId) ?? [];
      targetPorts.push(port);
      byTarget.set(port.targetId, targetPorts);
    });
    return byTarget;
  }, [inputPorts]);
  const edgePaths = useMemo(
    () => graph.edges.flatMap((edge) => {
      const source = nodesById.get(edge.sourceId);
      const target = nodesById.get(edge.targetId);
      if (!source || !target) return [];
      const inputPort = inputPortByEdge.get(edge.id);
      return [{
        id: edge.id,
        kind: edgeKinds.get(edge.id) ?? "text",
        ...workflowEdgeGeometry(
          source,
          target,
          inputPort ? { x: inputPort.x, y: inputPort.y } : undefined,
        ),
      }];
    }),
    [edgeKinds, graph.edges, inputPortByEdge, nodesById],
  );
  const connectionSource = connection
    ? nodesById.get(connection.nodeId)
    : undefined;
  const connectionTarget = connection?.targetId
    ? nodesById.get(connection.targetId)
    : undefined;
  const connectionKind = connectionSource?.type === "scheduler"
    ? connectionSource.outputKind
    : connectionSource?.kind;
  const pendingInputPoint = connectionTarget?.type === "scheduler"
    ? workflowPendingInputPoint(graph, connectionTarget.id)
    : undefined;
  const hoveredEdge = hoveredEdgeId
    ? edgePaths.find((edge) => edge.id === hoveredEdgeId)
    : undefined;
  const detailNode = detailId ? nodesById.get(detailId) : undefined;
  const agentSnapshot = useMemo(
    () => isAgentOpen
      ? createWorkflowAgentSnapshot(graph, viewport, canvasSize)
      : {
          mode: "workflow" as const,
          viewport: { ...viewport, ...canvasSize },
          nodes: [],
          edges: [],
        },
    [canvasSize, graph, isAgentOpen, viewport],
  );

  return (
    <main
      ref={mainRef}
      aria-label="LingkeAI 工作流画布"
      className="infinite-canvas workflow-canvas"
      onDoubleClick={handleCanvasDoubleClick}
      onPointerDown={beginCanvasPointer}
      onPointerMove={moveCanvasPointer}
      onPointerUp={finishCanvasPointer}
      onPointerCancel={finishCanvasPointer}
    >
      {projects ? (
        <div className="workflow-project-switcher" data-workflow-isolated>
          <select
            aria-label="当前工作流项目"
            disabled={projectImporting || runningSchedulers.size > 0 || (remote && cloudSyncState !== "idle")}
            value={projects.activeProjectId}
            onChange={(event) => void activateProject(projects, event.target.value)}
          >
            {projects.projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <button aria-label="新建项目" title="新建项目" type="button" onClick={addProject}>
            <Plus size={15} />
          </button>
          <button aria-label="重命名项目" title="重命名项目" type="button" onClick={renameActiveProject}>
            <Pencil size={14} />
          </button>
          <button aria-label="删除项目" title="删除项目" type="button" onClick={deleteActiveProject}>
            <Trash2 size={15} />
          </button>
          <>
            <input
              ref={projectImportInputRef}
              accept=".canvas.json,application/json"
              hidden
              type="file"
              onChange={(event) => void importProject(event)}
            />
            <button
              aria-label={remote ? "导入本地项目到云端" : "导入本地项目"}
              title={remote ? "导入本地项目到云端" : "导入本地项目"}
              disabled={projectImporting}
              type="button"
              onClick={chooseProjectImport}
            >
              <Upload size={15} />
            </button>
          </>
          {!remote ? (
            <>
              <button aria-label="导出当前项目" title="导出当前项目" type="button" onClick={() => void exportLocalProject()}>
                <Download size={15} />
              </button>
            </>
          ) : null}
          {projectImportError ? <span className="workflow-project-import-error" role="alert">{projectImportError}</span> : null}
          {tvcProject ? (
            <span className="workflow-project-status workflow-project-tvc-stage">
              TVC · {tvcStageLabel(tvcProject.phase)}
            </span>
          ) : null}
          {tvcProject?.storyboard ? (
            <button
              aria-label="查看 TVC 分镜表"
              title="查看 TVC 分镜表"
              type="button"
              onClick={() => setTvcStoryboardView({ tab: "storyboard", editing: false })}
            >
              <FileText size={15} />
            </button>
          ) : null}
          {tvcProject?.phase === "script-draft" ? (
            <button
              aria-label="锁定 TVC 分镜稿"
              title="锁定 TVC 分镜稿"
              type="button"
              onClick={() => setIsTvcLockConfirming(true)}
            >
              锁稿
            </button>
          ) : null}
          {agentBusy ? <span className="workflow-project-status">Agent 处理中</span> : null}
          {remote && cloudSyncState === "saving" ? (
            <span className="workflow-project-status">正在同步</span>
          ) : null}
          {remote && cloudSyncState === "unsynced" ? (
            <><span className="workflow-project-status">尚未同步</span><button type="button" onClick={() => setCloudSyncState("idle")}>重试</button></>
          ) : null}
          {remote && cloudSyncState === "conflict" ? (
            <>
              <span className="workflow-project-status">版本冲突</span>
              <button type="button" onClick={() => {
                if (window.confirm("重新加载会放弃当前尚未同步的修改，是否继续？")) {
                  void reloadCloudProject(projects.activeProjectId);
                }
              }}>重新加载</button>
              <button type="button" onClick={() => void saveCloudCopy()}>另存副本</button>
            </>
          ) : null}
        </div>
      ) : null}
      {projectEditor ? (
        <div className="workflow-project-editor-backdrop" data-workflow-isolated>
          <form
            className="workflow-project-editor"
            onSubmit={(event) => {
              event.preventDefault();
              void saveProjectName();
            }}
          >
            <h2>{projectEditor.mode === "create" ? "新建项目" : "重命名项目"}</h2>
            <label>
              项目名称
              <input
                value={projectEditor.value}
                onChange={(event) => setProjectEditor({
                  ...projectEditor,
                  value: event.target.value,
                  error: "",
                })}
              />
            </label>
            {projectEditor.mode === "create" ? (
              <fieldset className="workflow-project-mode">
                <legend>项目类型</legend>
                <label>
                  <input
                    checked={projectEditor.projectMode === "workflow"}
                    name="workflow-project-mode"
                    type="radio"
                    value="workflow"
                    onChange={() => setProjectEditor({
                      ...projectEditor,
                      projectMode: "workflow",
                      error: "",
                    })}
                  />
                  普通工作流
                </label>
                <label>
                  <input
                    checked={projectEditor.projectMode === "tvc"}
                    name="workflow-project-mode"
                    type="radio"
                    value="tvc"
                    onChange={() => setProjectEditor({
                      ...projectEditor,
                      projectMode: "tvc",
                      error: "",
                    })}
                  />
                  TVC 导演
                </label>
                <p>TVC 先整理资料和分镜表；锁稿后才可生成最终提示词，不会自动生成媒体。</p>
              </fieldset>
            ) : null}
            {projectEditor.error ? <p>{projectEditor.error}</p> : null}
            <div>
              <button type="button" onClick={() => setProjectEditor(null)}>取消</button>
              <button type="submit">保存</button>
            </div>
          </form>
        </div>
      ) : null}
      {isTvcLockConfirming && tvcProject?.phase === "script-draft" && tvcProject.storyboard ? (
        <TvcLockDialog
          storyboard={tvcProject.storyboard}
          onCancel={() => setIsTvcLockConfirming(false)}
          onConfirm={confirmTvcScriptLock}
        />
      ) : null}
      <div
        ref={gridRef}
        aria-hidden="true"
        className="workflow-grid"
        style={WORKFLOW_GRID_STYLE}
      />
      <div ref={worldRef} className="canvas-world" style={WORKFLOW_WORLD_STYLE}>
        <svg className="canvas-edges" aria-hidden="true">
          {edgePaths.map((edge) => (
            <g key={edge.id}>
              <path
                className={`canvas-edge canvas-edge-${edge.kind}${hoveredEdgeId === edge.id ? " canvas-edge-hovered" : ""}`}
                d={edge.path}
              />
              <path
                className="canvas-edge-hit"
                d={edge.path}
                onPointerDown={(event) => event.stopPropagation()}
                onPointerEnter={() => setHoveredEdgeId(edge.id)}
                onClick={(event) => {
                  event.stopPropagation();
                  setHoveredEdgeId(edge.id);
                }}
                onPointerLeave={(event) => {
                  if (
                    event.relatedTarget instanceof Element &&
                    event.relatedTarget.closest("[data-workflow-edge-delete]")
                  ) return;
                  setHoveredEdgeId((current) => current === edge.id ? null : current);
                }}
              />
            </g>
          ))}
          {connection?.moved && connectionSource ? (
            <path
              className={`canvas-edge-draft canvas-edge-${connectionKind ?? "text"}`}
              d={connectionTarget
                ? workflowEdgePath(
                    connectionSource,
                    connectionTarget,
                    pendingInputPoint,
                  )
                : workflowDraftPath(connectionSource, connection.point)}
            />
          ) : null}
        </svg>

        {hoveredEdge ? (
          <button
            aria-label="删除连线"
            className="canvas-edge-delete workflow-edge-delete"
            data-workflow-control
            data-workflow-edge-delete
            style={{
              width: 26 / viewport.scale,
              height: 26 / viewport.scale,
              borderWidth: 1 / viewport.scale,
              transform: `translate(${hoveredEdge.midpoint.x}px, ${hoveredEdge.midpoint.y}px) translate(-50%, -50%)`,
            }}
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerEnter={() => setHoveredEdgeId(hoveredEdge.id)}
            onPointerLeave={() => setHoveredEdgeId(null)}
            onClick={(event) => {
              event.stopPropagation();
              setGraph((current) => {
                const edge = current.edges.find((item) => item.id === hoveredEdge.id);
                const source = edge
                  ? current.nodes.find((node) => node.id === edge.sourceId)
                  : undefined;
                const target = edge
                  ? current.nodes.find((node) => node.id === edge.targetId)
                  : undefined;
                if (
                  target?.type === "scheduler" &&
                  isTvcVideoSchedulerNode(target)
                ) {
                  if (isRemovableTvcVideoInput(current, target.id, hoveredEdge.id)) {
                    const next = markTvcVideoSchedulerManualOverride(
                      updateWorkflowNode(
                        removeWorkflowEdge(current, hoveredEdge.id),
                        target.id,
                        { error: "" },
                      ),
                      target.id,
                    );
                    graphRef.current = next;
                    return next;
                  }
                  const next = updateWorkflowNode(current, target.id, {
                    error: "最终提示词文本连线保留；仅可移除参考媒体资产。",
                  });
                  graphRef.current = next;
                  return next;
                }
                if (
                  source?.type === "scheduler" &&
                  isTvcVideoSchedulerNode(source)
                ) {
                  const next = updateWorkflowNode(current, source.id, {
                    error: "TVC 视频结果连线由系统维护，不能手动移除。",
                  });
                  graphRef.current = next;
                  return next;
                }
                const next = removeWorkflowEdge(current, hoveredEdge.id);
                graphRef.current = next;
                return next;
              });
              setHoveredEdgeId(null);
            }}
          >
            <Trash2 aria-hidden="true" size={13 / viewport.scale} />
          </button>
        ) : null}

        {selection ? (
          <div
            className="canvas-selection-frame"
            style={{
              width: selection.width + 16 / viewport.scale,
              height: selection.height + 16 / viewport.scale,
              borderWidth: 1 / viewport.scale,
              transform: `translate(${selection.x - 8 / viewport.scale}px, ${selection.y - 8 / viewport.scale}px)`,
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = {
                pointerId: event.pointerId,
                nodeIds: selectedIds,
                clientX: event.clientX,
                clientY: event.clientY,
                pendingX: 0,
                pendingY: 0,
                frame: null,
              };
            }}
            onPointerMove={dragNodes}
            onPointerUp={finishNodeDrag}
            onPointerCancel={finishNodeDrag}
          />
        ) : null}

        {selection && selectedAssetRefs.length ? (
          <button
            className="workflow-selection-run"
            data-workflow-control
            type="button"
            style={{
              transform: `translate(${selection.x}px, ${selection.y - 48 / viewport.scale}px)`,
              height: 32 / viewport.scale,
              paddingInline: 14 / viewport.scale,
              fontSize: 12 / viewport.scale,
              borderRadius: 16 / viewport.scale,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={runSelectedAssets}
          >
            生成选中资产（{selectedAssetRefs.length}）
          </button>
        ) : null}

        {graph.nodes.map((node) => {
          const protectedTvcNode = Boolean(
            node.tvcProjectId && tvcSystemRoles.has(node.storyRole ?? ""),
          );
          const tvcVideoTask = node.type === "scheduler" && isTvcVideoSchedulerNode(node);
          const canRunTvcVideoTask = !tvcVideoTask ||
            isRunnableTvcVideoScheduler(graph, node);
          const tvcVideoManualOverride = tvcVideoTask && isTvcVideoManualOverride(node);
          const tvcVideoHistorical = tvcVideoTask && node.tvcVideoHistorical === true;
          return <WorkflowNodeCard
            key={node.id}
            node={node}
            assetUrl={(node.type === "source" || node.type === "result") && node.assetId
              ? assetUrls[node.assetId]
              : undefined}
            assetError={(node.type === "source" || node.type === "result") && node.assetId
              ? assetErrors[node.assetId]
              : assetErrors[node.id]}
            assetLoading={(node.type === "source" || node.type === "result") &&
              Boolean(node.assetId) && !assetUrls[node.assetId!] && !assetErrors[node.assetId!]}
            connectionTarget={connection?.targetId === node.id}
            inputPorts={inputPortsByTarget.get(node.id) ?? []}
            pendingInputKind={connection?.targetId === node.id ? connectionKind : undefined}
            running={node.type === "scheduler" && runningSchedulers.has(node.id)}
            protectedNode={protectedTvcNode}
            tvcVideoTask={tvcVideoTask}
            tvcVideoManualOverride={tvcVideoManualOverride}
            tvcVideoHistorical={tvcVideoHistorical}
            canRunTvcVideoTask={canRunTvcVideoTask}
            tvcStoryboard={node.storyRole === "tvc-storyboard" ? tvcProject?.storyboard : undefined}
            tvcPhase={node.storyRole === "tvc-storyboard" ? tvcProject?.phase : undefined}
            tvcPromptPlan={node.storyRole === "tvc-storyboard" ? tvcProject?.promptPlan : undefined}
            tvcSegmentControlsReadOnly={tvcSegmentControlsReadOnly}
            tvcPromptUnits={node.storyRole === "tvc-prompt" ? tvcProject?.promptUnits : undefined}
            tvcStandaloneLogoUnit={node.storyRole === "tvc-logo-prompt" ? tvcProject?.standaloneLogoUnit : undefined}
            onDelete={() => deleteNode(node)}
            onOpen={() => setDetailId(node.id)}
            onOpenTvcStoryboard={() => setTvcStoryboardView({ tab: "storyboard", editing: false })}
            onEditTvcStoryboard={() => setTvcStoryboardView({ tab: "storyboard", editing: true })}
            onAdjustTvcPromptPlan={() => setTvcStoryboardView({
              tab: "prompt",
              editing: false,
              segmentEditing: true,
            })}
            onOpenTvcPrompt={() => setTvcStoryboardView({ tab: "prompt", editing: false })}
            onExportTvcStoryboard={() => void exportTvcStoryboard()}
            onChange={(update) => {
              if (protectedTvcNode && !tvcVideoTask) return;
              if (node.type === "scheduler") {
                updateSchedulerFields(node, update as Partial<WorkflowSchedulerNode>);
                return;
              }
              setGraph((current) => updateWorkflowNode(current, node.id, update));
            }}
            onUpload={(file) => node.type === "source" && void (
              node.storyRole === "tvc-logo"
                ? uploadTvcLogo(file)
                : uploadSource(node, file)
            )}
            onKindChange={(kind) => node.type === "scheduler" && updateSchedulerKind(node, kind)}
            onModelChange={(model) => node.type === "scheduler" && updateSchedulerModel(node, model)}
            onRemoveTvcImageInput={(edgeId) => removeTvcVideoImageInput(node.id, edgeId)}
            onMoveTvcImageInput={(edgeId, direction) =>
              moveTvcVideoImageInput(node.id, edgeId, direction)}
            onRun={() => node.type === "scheduler" && void runScheduler(node.id)}
            onConfirmSubmissionRetry={() =>
              node.type === "result" && requestSubmissionRetry(node)}
            onMediaLoad={(width, height) =>
              fitImageNodeToMedia(node.id, width, height)
            }
          onResume={() => node.type === "result" && (() => {
              const resumed = { ...node, status: "pending" as const, progress: "准备继续查询", startedAt: Date.now() };
              setGraph((current) => updateWorkflowResult(current, node.id, resumed));
              void pollTask(resumed);
            })()}
            onPointerDown={(event) => beginNodeDrag(event, node)}
            onPointerMove={dragNodes}
            onPointerUp={finishNodeDrag}
            onPointerCancel={finishNodeDrag}
          />;
        })}

        {graph.nodes.map((node) => (
          <WorkflowNodeOverlay
            key={`overlay-${node.id}`}
            node={node}
            onConnectDown={(event) => beginConnection(event, node)}
            onConnectMove={moveConnection}
            onConnectUp={finishConnection}
            onResizeDown={(event, corner) => beginResize(event, node, corner)}
            onResizeMove={resizeFromPointer}
            onResizeUp={finishResize}
          />
        ))}

        {creationMenu ? (
          <WorkflowCreationMenu
            point={creationMenu}
            tvc={Boolean(tvcProject)}
            onCreate={createNode}
          />
        ) : null}

        {schedulerMenu ? (
          <WorkflowSchedulerMenu
            menu={schedulerMenu}
            tvc={Boolean(tvcProject)}
            onCreate={createSchedulerFromMenu}
          />
        ) : null}
      </div>

      {tvcStoryboardView && tvcProject?.storyboard ? (
        <TvcStoryboardCanvasPanel
          key={`${tvcProject.projectId}-${tvcProject.revision}-${tvcStoryboardView.tab}-${tvcStoryboardView.editing}-${Boolean(tvcStoryboardView.segmentEditing)}`}
          storyboard={tvcProject.storyboard}
          promptPlan={tvcProject.promptPlan}
          promptUnits={tvcProject.promptUnits}
          standaloneLogoUnit={tvcProject.standaloneLogoUnit}
          videoSchedulers={tvcVideoSchedulers}
          initialTab={tvcStoryboardView.tab}
          initialEditing={tvcStoryboardView.editing}
          initialSegmentEditing={Boolean(tvcStoryboardView.segmentEditing)}
          phase={tvcProject.phase}
          segmentControlsReadOnly={tvcSegmentControlsReadOnly}
          promptRegeneration={tvcPromptStatus}
          onClose={() => setTvcStoryboardView(null)}
          onExport={() => void exportTvcStoryboard()}
          onSave={saveTvcStoryboard}
          onPreparePromptPlan={prepareTvc30SecondPromptPlan}
          onSavePromptPlan={saveTvcPromptPlan}
        />
      ) : null}

      {marqueeBounds ? <div className="canvas-selection-marquee" style={{
        width: marqueeBounds.width,
        height: marqueeBounds.height,
        transform: `translate(${marqueeBounds.x}px, ${marqueeBounds.y}px)`,
      }} /> : null}

      {hydrated && graph.nodes.length === 0 ? (
        <div className="canvas-empty-state" aria-hidden="true">
          <span className="canvas-empty-icon"><Workflow size={18} /></span>
          <p>双击画布，创建素材节点或调度节点</p>
        </div>
      ) : null}

      {detailNode ? (
        <WorkflowDetail
          node={detailNode}
          assetUrl={(detailNode.type === "source" || detailNode.type === "result") && detailNode.assetId
            ? remote
              ? cloudAssetUrl(detailNode.assetId, assetVersions[detailNode.assetId])
              : assetUrls[detailNode.assetId]
            : undefined}
          onClose={() => setDetailId(null)}
        />
      ) : null}

      {submissionRetryConfirmation ? (
        <SubmissionUnknownConfirmationCard
          onCancel={() => setSubmissionRetryConfirmation(null)}
          onConfirm={confirmSubmissionRetry}
        />
      ) : null}

      {!isAgentOpen ? (
        <button
          aria-label="打开工作流 Agent"
          className="absolute top-4 right-4 z-40 inline-flex h-10 items-center gap-2 rounded-full border border-black/8 bg-white px-4 text-xs font-semibold text-zinc-700 shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
          data-workflow-isolated
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setIsAgentOpen(true)}
        >
          <Bot aria-hidden="true" size={16} />
          画布 Agent
        </button>
      ) : null}

      {hydrated ? <CanvasAgentSidebar
        key={projects?.activeProjectId ?? "workflow-agent"}
        open={isAgentOpen}
        snapshot={agentSnapshot}
        conversationStorageKey={projects
          ? workflowProjectConversationKey(projects.activeProjectId)
          : "workflow-agent-conversations-pending"}
        legacyStorageKey=""
        subtitle={tvcProject
          ? "TVC 导演 · 资料梳理、分镜表与锁稿提示词"
          : "GPT-5.6 Sol · 可规划并运行工作流"}
        emptyMessage={tvcProject
          ? "提交 TVC 资料、脚本、产品与参考图后，我会先整理 Brief 和参考图映射，再形成可锁定的分镜表。"
          : "粘贴完整剧本后，我会先分析类型、主题、受众、情绪和时长，再逐批搭建人物、场景与道具资产库。"}
        intakePlaceholder={tvcProject
          ? "粘贴 TVC Brief、脚本或补充参考资料…"
          : "粘贴完整剧本或输入资产规划要求…"}
        focusedNodeId={agentContextNodeId ?? undefined}
        onClose={() => {
          setIsAgentOpen(false);
          setAgentContextNodeId(null);
        }}
        onClearFocus={() => setAgentContextNodeId(null)}
        onApplyOperations={applyAgentOperations}
        getSnapshot={currentAgentSnapshot}
        onPlanningInterrupted={updateAssetPlanningStatus}
        onApproveFoundation={approveFoundation}
        onConfirmOperation={confirmAgentOperation}
        onReadImages={readAgentImages}
        describeOperation={describeAgentOperation}
        onBusyChange={setAgentBusy}
        loadConversationStore={remote ? loadRemoteConversation : undefined}
        saveConversationStore={remote ? saveRemoteConversation : undefined}
        autoRequest={tvcPromptAutoRequest}
        onAutoRequestComplete={completeTvcPromptRegeneration}
        contextControls={tvcProject ? (
          <TvcAgentSettingsCard
            project={tvcProject}
            logoNode={tvcLogoNode}
            disabled={agentBusy}
            error={assetErrors["tvc-logo-upload"]}
            onUploadLogo={(file) => void uploadTvcLogo(file)}
            onConfigureLogo={configureTvcLogoUsage}
            onSetNarration={setTvcNarrationOption}
          />
        ) : null}
      /> : null}
    </main>
  );
}

function sameWorkflowInputPorts(
  left: WorkflowInputPort[],
  right: WorkflowInputPort[],
) {
  return left.length === right.length && left.every((port, index) => {
    const other = right[index];
    if (!other) return false;
    return port.edgeId === other.edgeId &&
      port.kind === other.kind &&
      port.label === other.label &&
      port.sourceName === other.sourceName &&
      port.x === other.x &&
      port.y === other.y;
  });
}

const WorkflowNodeCard = memo(function WorkflowNodeCard({
  node,
  assetUrl,
  assetError,
  assetLoading,
  connectionTarget,
  inputPorts,
  pendingInputKind,
  running,
  protectedNode,
  tvcVideoTask,
  tvcVideoManualOverride,
  tvcVideoHistorical,
  canRunTvcVideoTask,
  tvcStoryboard,
  tvcPhase,
  tvcPromptPlan,
  tvcSegmentControlsReadOnly,
  tvcPromptUnits,
  tvcStandaloneLogoUnit,
  onDelete,
  onOpen,
  onOpenTvcStoryboard,
  onEditTvcStoryboard,
  onAdjustTvcPromptPlan,
  onOpenTvcPrompt,
  onExportTvcStoryboard,
  onChange,
  onUpload,
  onKindChange,
  onModelChange,
  onRemoveTvcImageInput,
  onMoveTvcImageInput,
  onRun,
  onConfirmSubmissionRetry,
  onMediaLoad,
  onResume,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  node: WorkflowNode;
  assetUrl?: string;
  assetError?: string;
  assetLoading: boolean;
  connectionTarget: boolean;
  inputPorts: WorkflowInputPort[];
  pendingInputKind?: ComposerMode;
  running: boolean;
  protectedNode: boolean;
  tvcVideoTask: boolean;
  tvcVideoManualOverride: boolean;
  tvcVideoHistorical: boolean;
  canRunTvcVideoTask: boolean;
  tvcStoryboard?: TvcStoryboard;
  tvcPhase?: "intake" | "script-draft" | "script-locked" | "prompt-final";
  tvcPromptPlan?: TvcPromptPlanSegment[];
  tvcSegmentControlsReadOnly: boolean;
  tvcPromptUnits?: TvcPromptUnit[];
  tvcStandaloneLogoUnit?: TvcStandaloneLogoUnit;
  onDelete: () => void;
  onOpen: () => void;
  onOpenTvcStoryboard: () => void;
  onEditTvcStoryboard: () => void;
  onAdjustTvcPromptPlan: () => void;
  onOpenTvcPrompt: () => void;
  onExportTvcStoryboard: () => void;
  onChange: (update: Partial<WorkflowNode>) => void;
  onUpload: (file?: File) => void;
  onKindChange: (kind: ComposerMode) => void;
  onModelChange: (model: string) => void;
  onRemoveTvcImageInput: (edgeId: string) => void;
  onMoveTvcImageInput: (edgeId: string, direction: "up" | "down") => void;
  onRun: () => void;
  onConfirmSubmissionRetry: () => void;
  onMediaLoad: (width: number, height: number) => void;
  onResume: () => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  const size = getWorkflowNodeSize(node);
  const kind = node.type === "scheduler" ? node.outputKind : node.kind;
  const Icon = kind === "image" ? ImageIcon : kind === "video" ? Video : FileText;
  const title = node.label || (node.type === "scheduler"
    ? "通用调度"
    : node.type === "result"
      ? `结果 · ${kind === "text" ? "文本" : kind === "image" ? "图片" : "视频"}`
      : `${kind === "text" ? "文本" : kind === "image" ? "图片" : "视频"}素材`);

  return (
    <div
      className={`canvas-node workflow-node workflow-node-${node.type}${connectionTarget ? " canvas-node-connection-target" : ""}`}
      style={{ width: size.width, height: size.height, transform: `translate(${node.x}px, ${node.y}px)` }}
      data-workflow-node-id={node.id}
      data-workflow-node-type={node.type}
      data-node-id={node.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-workflow-control]")) return;
        event.stopPropagation();
        if (node.storyRole === "tvc-storyboard" && tvcStoryboard) {
          onOpenTvcStoryboard();
          return;
        }
        if (node.storyRole === "tvc-prompt" || node.storyRole === "tvc-logo-prompt") {
          onOpenTvcPrompt();
          return;
        }
        if (node.type === "result" || (node.type === "source" && node.kind !== "text")) onOpen();
      }}
    >
      <header className="canvas-node-header">
        <span className="canvas-node-kind"><Icon size={15} /><span className="workflow-node-title">{title}</span></span>
        {!protectedNode ? <button
          aria-label="删除节点"
          className="canvas-node-delete"
          data-workflow-control
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); onDelete(); }}
        ><Trash2 size={14} /></button> : null}
      </header>

      {node.storyRole === "tvc-storyboard" && tvcStoryboard ? (
        <TvcStoryboardNodePreview
          storyboard={tvcStoryboard}
          phase={tvcPhase ?? "script-draft"}
          hasPromptPlan={Boolean(tvcPromptPlan?.length)}
          segmentControlsReadOnly={tvcSegmentControlsReadOnly}
          onOpen={onOpenTvcStoryboard}
          onEdit={onEditTvcStoryboard}
          onAdjustSegments={onAdjustTvcPromptPlan}
          onExport={onExportTvcStoryboard}
        />
      ) : node.storyRole === "tvc-prompt" || node.storyRole === "tvc-logo-prompt" ? (
        <TvcPromptNodePreview
          promptUnits={tvcPromptUnits}
          standaloneLogoUnit={tvcStandaloneLogoUnit}
          onOpen={onOpenTvcPrompt}
        />
      ) : node.type === "source" ? (
        <div className={`workflow-source-body${node.kind === "image" && assetUrl && !assetError ? " workflow-source-body-media" : ""}`}>
          {node.kind === "text" ? (
            <textarea
              aria-label="文本素材内容"
              data-workflow-control
              placeholder="在这里输入提示词或上下文…"
              readOnly={protectedNode}
              value={node.text}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => onChange({ text: event.target.value })}
            />
          ) : (
            <label className="workflow-upload" data-workflow-control onPointerDown={(event) => event.stopPropagation()}>
              {assetError ? <span>{assetError}</span> : assetUrl ? (
                node.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={assetUrl}
                    alt={node.assetName || "上传图片"}
                    decoding="async"
                    loading="lazy"
                    onLoad={(event) =>
                      onMediaLoad(
                        event.currentTarget.naturalWidth,
                        event.currentTarget.naturalHeight,
                      )
                    }
                  />
                ) : (
                  // User-uploaded videos do not include a separate captions track.
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video src={assetUrl} controls preload="metadata" />
                )
              ) : assetLoading ? (
                <><LoaderCircle className="animate-spin" size={20} /><span>素材加载中…</span></>
              ) : <><Plus size={20} /><span>{node.storyRole === "tvc-logo" ? "上传品牌 Logo" : `上传一${node.kind === "image" ? "张图片" : "段视频"}`}</span></>}
              <input
                type="file"
                accept={node.storyRole === "tvc-logo"
                  ? "image/png,image/jpeg,image/webp"
                  : node.kind === "image" ? "image/*" : "video/*"}
                onChange={(event) => onUpload(event.target.files?.[0])}
              />
            </label>
          )}
        </div>
      ) : node.type === "scheduler" ? (
        <SchedulerControls
          node={node}
          inputPorts={inputPorts}
          pendingInputKind={pendingInputKind}
          running={running}
          outputKindLocked={tvcVideoTask}
          tvcVideoTask={tvcVideoTask}
          tvcVideoManualOverride={tvcVideoManualOverride}
          tvcVideoHistorical={tvcVideoHistorical}
          canRun={canRunTvcVideoTask}
          onChange={onChange}
          onKindChange={onKindChange}
          onModelChange={onModelChange}
          onRemoveTvcImageInput={onRemoveTvcImageInput}
          onMoveTvcImageInput={onMoveTvcImageInput}
          onRun={onRun}
        />
      ) : (
        <ResultBody
          node={node}
          assetUrl={assetUrl}
          assetLoading={assetLoading}
          onConfirmSubmissionRetry={onConfirmSubmissionRetry}
          onResume={onResume}
          onMediaLoad={onMediaLoad}
        />
      )}
    </div>
  );
}, (previous, next) =>
  previous.node === next.node &&
  previous.assetUrl === next.assetUrl &&
  previous.assetError === next.assetError &&
  previous.assetLoading === next.assetLoading &&
  previous.connectionTarget === next.connectionTarget &&
  previous.pendingInputKind === next.pendingInputKind &&
  sameWorkflowInputPorts(previous.inputPorts, next.inputPorts) &&
  previous.running === next.running &&
  previous.protectedNode === next.protectedNode &&
  previous.tvcVideoTask === next.tvcVideoTask &&
  previous.tvcVideoManualOverride === next.tvcVideoManualOverride &&
  previous.tvcVideoHistorical === next.tvcVideoHistorical &&
  previous.canRunTvcVideoTask === next.canRunTvcVideoTask &&
  previous.tvcStoryboard === next.tvcStoryboard &&
  previous.tvcPhase === next.tvcPhase &&
  previous.tvcPromptPlan === next.tvcPromptPlan &&
  previous.tvcSegmentControlsReadOnly === next.tvcSegmentControlsReadOnly &&
  previous.tvcPromptUnits === next.tvcPromptUnits,
);

function SchedulerControls({
  node,
  inputPorts,
  pendingInputKind,
  running,
  outputKindLocked,
  tvcVideoTask,
  tvcVideoManualOverride,
  tvcVideoHistorical,
  canRun,
  onChange,
  onKindChange,
  onModelChange,
  onRemoveTvcImageInput,
  onMoveTvcImageInput,
  onRun,
}: {
  node: WorkflowSchedulerNode;
  inputPorts: WorkflowInputPort[];
  pendingInputKind?: ComposerMode;
  running: boolean;
  outputKindLocked: boolean;
  tvcVideoTask: boolean;
  tvcVideoManualOverride: boolean;
  tvcVideoHistorical: boolean;
  canRun: boolean;
  onChange: (update: Partial<WorkflowNode>) => void;
  onKindChange: (kind: ComposerMode) => void;
  onModelChange: (model: string) => void;
  onRemoveTvcImageInput: (edgeId: string) => void;
  onMoveTvcImageInput: (edgeId: string, direction: "up" | "down") => void;
  onRun: () => void;
}) {
  const config = getModelConfig(node.outputKind, node.model);
  const taskCount = node.outputKind === "text" ? 1 : node.outputCount;
  return (
    <div className="workflow-scheduler" data-workflow-control onPointerDown={(event) => event.stopPropagation()}>
      <div className="workflow-input-section">
        <span className="workflow-input-title">输入类型</span>
        <div className="workflow-input-list">
          {inputPorts.map((port, index) => {
            const editableImageInput = tvcVideoTask &&
              !tvcVideoHistorical &&
              port.kind === "image";
            const previousImageInput = inputPorts
              .slice(0, index)
              .some((candidate) => candidate.kind === "image");
            const nextImageInput = inputPorts
              .slice(index + 1)
              .some((candidate) => candidate.kind === "image");
            return <div
              key={port.edgeId}
              className={`workflow-input-row workflow-input-row-${port.kind}`}
              title={`${port.label} · ${port.sourceName}`}
              >
              <span className="workflow-input-row-port" aria-hidden="true" />
              <strong>{port.label}</strong>
              <span className="workflow-input-row-name">{port.sourceName}</span>
              {editableImageInput ? <span className="workflow-input-row-actions">
                <button
                  aria-label={`上移 ${port.sourceName}`}
                  data-workflow-control
                  disabled={!previousImageInput}
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMoveTvcImageInput(port.edgeId, "up");
                  }}
                ><ChevronUp size={12} /></button>
                <button
                  aria-label={`下移 ${port.sourceName}`}
                  data-workflow-control
                  disabled={!nextImageInput}
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMoveTvcImageInput(port.edgeId, "down");
                  }}
                ><ChevronDown size={12} /></button>
                <button
                  aria-label={`移除 ${port.sourceName}`}
                  data-workflow-control
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveTvcImageInput(port.edgeId);
                  }}
                ><Trash2 size={11} /></button>
              </span> : null}
            </div>;
          })}
          {pendingInputKind ? (
            <div className={`workflow-input-row workflow-input-row-${pendingInputKind} workflow-input-row-pending`}>
              <span className="workflow-input-row-port" aria-hidden="true" />
              <strong>新输入</strong>
              <span className="workflow-input-row-name">松开后连接</span>
            </div>
          ) : null}
          {!inputPorts.length && !pendingInputKind ? (
            <div className="workflow-input-empty">暂无输入</div>
          ) : null}
        </div>
      </div>
      <div className="workflow-scheduler-fields">
        <div className="workflow-field-row">
          <label>输出类型<select disabled={outputKindLocked || node.assetRole === "scheduler"} value={node.outputKind} onChange={(event) => onKindChange(event.target.value as ComposerMode)}>
            <option value="text">文本</option><option value="image">图片</option><option value="video">视频</option>
          </select></label>
          <label>模型<select disabled={tvcVideoHistorical} value={node.model} onChange={(event) => onModelChange(event.target.value)}>
            {MODEL_CONFIGS[node.outputKind].map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
          </select></label>
        </div>
        <label className="workflow-prompt">提示词<textarea readOnly={tvcVideoHistorical} value={node.prompt} placeholder="描述本节点要生成的内容…" onChange={(event) => onChange({ prompt: event.target.value, error: "" })} /></label>
        {node.outputKind !== "text" ? <div className="workflow-field-row workflow-parameters">
          <label>比例<select disabled={tvcVideoHistorical} value={node.aspectRatio} onChange={(event) => onChange({ aspectRatio: event.target.value })}>{config?.aspectRatios.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>清晰度<select disabled={tvcVideoHistorical} value={node.resolution} onChange={(event) => onChange({ resolution: event.target.value })}>{config?.resolutions.map((value) => <option key={value}>{value}</option>)}</select></label>
          {node.outputKind === "video" ? <label>时长<select disabled={tvcVideoHistorical} value={node.duration} onChange={(event) => onChange({ duration: event.target.value })}>{config?.durations.map((value) => <option key={value} value={value}>{value} 秒</option>)}</select></label> : null}
            <label>数量<select disabled={tvcVideoHistorical || node.assetRole === "scheduler"} value={node.outputCount} onChange={(event) => onChange({ outputCount: Number(event.target.value) })}>{[1, 2, 3, 4].map((value) => <option key={value}>{value}</option>)}</select></label>
        </div> : null}
        {tvcVideoTask ? <p className={`workflow-tvc-video-status${tvcVideoHistorical ? " workflow-tvc-video-status-historical" : ""}`}>
          {tvcVideoHistorical
            ? "历史版本：锁稿已更新，仅保留查看。"
            : tvcVideoManualOverride
              ? "已手动覆盖：可编辑参数、提示词和图片参考资产。"
              : "锁稿版本：修改任一视频参数或图片参考后将成为手动覆盖版本。"}
        </p> : null}
        {node.error ? <p className="workflow-scheduler-error">{node.error}</p> : null}
        {!canRun ? <p className="workflow-scheduler-error">历史版本仅保留查看，不能再次运行。</p> : null}
        <button className="workflow-run" disabled={running || !canRun} type="button" onClick={onRun}>
          {running ? <LoaderCircle className="animate-spin" size={15} /> : <Play size={15} fill="currentColor" />}
          {running ? "正在提交" : `运行 ${taskCount} 个任务`}
        </button>
      </div>
    </div>
  );
}

function ResultBody({ node, assetUrl, assetLoading, onConfirmSubmissionRetry, onResume, onMediaLoad }: {
  node: WorkflowResultNode;
  assetUrl?: string;
  assetLoading: boolean;
  onConfirmSubmissionRetry: () => void;
  onResume: () => void;
  onMediaLoad: (width: number, height: number) => void;
}) {
  if (node.status === "failed") return <p className="canvas-node-error">{node.error || "任务失败"}</p>;
  if (node.status === "submission-unknown") {
    return <div className="workflow-submission-unknown" data-workflow-control>
      <strong>{WORKFLOW_SUBMISSION_UNKNOWN_PROGRESS}</strong>
      <p>{node.error || WORKFLOW_SUBMISSION_UNKNOWN_ERROR}</p>
      <button
        className="workflow-submission-retry"
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onConfirmSubmissionRetry}
      >确认重新提交</button>
    </div>;
  }
  if (node.kind === "text" && node.status === "success") return <p className="canvas-node-text">{node.text}</p>;
  const mediaUrl = assetUrl || (node.assetId ? undefined : node.resultUrl);
  if (node.kind === "image" && mediaUrl) return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="workflow-result-media"
      src={mediaUrl}
      alt="工作流生成图片"
      decoding="async"
      loading="lazy"
      onLoad={(event) =>
        onMediaLoad(
          event.currentTarget.naturalWidth,
          event.currentTarget.naturalHeight,
        )
      }
    />
  );
  if (node.kind === "video" && mediaUrl) return (
    // Generated videos do not include a separate captions track.
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video className="workflow-result-media" src={mediaUrl} controls preload="metadata" />
  );
  if (assetLoading) return <div className="canvas-node-loading"><LoaderCircle className="animate-spin" size={20} /><span>素材加载中…</span></div>;
  if (node.status === "ready") return <div className="canvas-node-loading"><span>{node.progress || "待生成"}</span></div>;
  if (node.status === "paused") return <div className="canvas-node-loading"><span>{node.progress}</span><button className="workflow-resume" type="button" data-workflow-control onClick={onResume}><RotateCcw size={13} />继续查询</button></div>;
  return <div className="canvas-node-loading"><LoaderCircle className="animate-spin" size={20} /><span>{node.progress || "处理中"}</span></div>;
}

function SubmissionUnknownConfirmationCard({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <div
    className="workflow-submission-confirm-backdrop"
    data-workflow-isolated
    onPointerDown={(event) => event.stopPropagation()}
  >
    <section className="workflow-submission-confirm" role="dialog" aria-modal="true" aria-label="确认重新提交视频">
      <h2>确认重新提交视频？</h2>
      <p>首次请求没有返回任务编号，媒体平台可能已经接收并计费。重新提交可能产生重复费用。</p>
      <div>
        <button type="button" onClick={onCancel}>取消</button>
        <button type="button" onClick={onConfirm}>确认重新提交</button>
      </div>
    </section>
  </div>;
}

const WorkflowNodeOverlay = memo(function WorkflowNodeOverlay({ node, onConnectDown, onConnectMove, onConnectUp, onResizeDown, onResizeMove, onResizeUp }: {
  node: WorkflowNode;
  onConnectDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onConnectMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onConnectUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onResizeDown: (event: PointerEvent<HTMLButtonElement>, corner: WorkflowResizeCorner) => void;
  onResizeMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onResizeUp: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  const size = getWorkflowNodeSize(node);
  const corners = ["north-west", "north-east", "south-west", "south-east"] as const;
  return <>
    {node.type !== "scheduler" ? <div className="canvas-node-handle-layer workflow-output-layer" style={{ width: size.width, height: size.height, transform: `translate(${node.x}px, ${node.y}px)` }}>
      <button
        aria-label="连接到调度节点"
        className="canvas-node-handle canvas-node-handle-right workflow-output-handle"
        data-workflow-control
        type="button"
        onPointerDown={onConnectDown}
        onPointerMove={onConnectMove}
        onPointerUp={onConnectUp}
        onPointerCancel={onConnectUp}
      ><Plus size={15} /></button>
    </div> : null}
    <div className="canvas-node-resize-layer" style={{ width: size.width, height: size.height, transform: `translate(${node.x}px, ${node.y}px)` }}>
      {corners.map((corner) => <button
        key={corner}
        aria-label="调整节点大小"
        className={`canvas-node-resize-handle canvas-node-resize-${corner}`}
        data-workflow-control
        type="button"
        onPointerDown={(event) => onResizeDown(event, corner)}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
      />)}
    </div>
  </>;
}, (previous, next) => previous.node === next.node);

function WorkflowCreationMenu({ point, tvc, onCreate }: {
  point: CreationMenu;
  tvc: boolean;
  onCreate: (type: ComposerMode | "scheduler") => void;
}) {
  const items = [
    { type: "text", label: "文本素材", icon: FileText },
    { type: "image", label: "图片素材", icon: ImageIcon },
    ...(tvc
      ? []
      : [
          { type: "video" as const, label: "视频素材", icon: Video },
          { type: "scheduler" as const, label: "通用调度", icon: Workflow },
        ]),
  ] as const;
  return <div className="workflow-create-menu" data-workflow-isolated style={{ transform: `translate(${point.x}px, ${point.y}px)` }} onPointerDown={(event) => event.stopPropagation()}>
    {items.map((item) => <button key={item.type} type="button" onClick={() => onCreate(item.type)}><item.icon size={15} />{item.label}</button>)}
  </div>;
}

function WorkflowSchedulerMenu({
  menu,
  tvc,
  onCreate,
}: {
  menu: SchedulerMenu;
  tvc: boolean;
  onCreate: (outputKind: ComposerMode) => void;
}) {
  const items = [
    { kind: "text", label: "文本生成", icon: FileText },
    { kind: "image", label: "图片生成", icon: ImageIcon },
    ...(tvc ? [] : [{ kind: "video" as const, label: "视频生成", icon: Video }]),
  ] as const;
  return (
    <div
      aria-label="添加下游调度节点"
      className="workflow-create-menu workflow-scheduler-menu"
      data-workflow-isolated
      role="menu"
      style={{ transform: `translate(${menu.x}px, ${menu.y}px)` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.kind}
          role="menuitem"
          type="button"
          onClick={() => onCreate(item.kind)}
        >
          <item.icon size={15} />
          {item.label}
        </button>
      ))}
    </div>
  );
}

function tvcStageLabel(phase: "intake" | "script-draft" | "script-locked" | "prompt-final") {
  return phase === "intake"
    ? "资料梳理"
    : phase === "script-draft"
      ? "分镜草案"
      : phase === "script-locked"
        ? "已锁稿"
        : "提示词完成";
}

function TvcAgentSettingsCard({
  project,
  logoNode,
  disabled,
  error,
  onUploadLogo,
  onConfigureLogo,
  onSetNarration,
}: {
  project: TvcWorkflowState;
  logoNode?: WorkflowSourceNode;
  disabled: boolean;
  error?: string;
  onUploadLogo: (file?: File) => void;
  onConfigureLogo: (placement: TvcLogoPlacement, durationSeconds: number) => void;
  onSetNarration: (narration: "include" | "omit") => void;
}) {
  const logoReady = Boolean(logoNode?.assetId);
  const logo = project.logo;
  const canChooseNarration = project.phase === "script-locked" || project.phase === "prompt-final";
  const standaloneDuration = logo?.placement === "standalone" ? logo.durationSeconds : 4;

  return (
    <section className="mb-3 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-[11px] leading-4 text-violet-950">
      <p className="mt-0 mb-2 font-semibold">TVC 导演设置</p>
      <div className="space-y-2">
        <div>
          <p className="mt-0 mb-1.5">导演 Agent：是否上传品牌 Logo 作为动效参考？</p>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-violet-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
            <Upload aria-hidden="true" size={13} />
            {logoReady ? "替换品牌 Logo" : "上传品牌 Logo"}
            <input
              accept="image/png,image/jpeg,image/webp"
              disabled={disabled}
              hidden
              type="file"
              onChange={(event) => onUploadLogo(event.target.files?.[0])}
            />
          </label>
          <p className="mt-1 mb-0 text-[10px] text-violet-800">建议透明 PNG；仅用作视频参考，无法保证文字或图形像素级还原。</p>
          {error ? <p className="mt-1 mb-0 text-[10px] font-medium text-red-700">{error}</p> : null}
        </div>

        {logoReady ? (
          <div className="border-t border-violet-200 pt-2">
            <p className="mt-0 mb-1.5">导演 Agent：这枚 Logo 如何使用？</p>
            <div className="flex flex-wrap gap-1.5">
              {([
                ["opening", "正片片头"],
                ["closing", "正片片尾"],
                ["standalone", "独立 Logo 视频"],
              ] as const).map(([placement, label]) => (
                <button
                  key={placement}
                  aria-pressed={logo?.placement === placement}
                  className={`rounded-full px-2.5 py-1 text-[11px] ${logo?.placement === placement ? "bg-violet-900 text-white" : "bg-white text-violet-900 ring-1 ring-violet-200"}`}
                  disabled={disabled}
                  type="button"
                  onClick={() => onConfigureLogo(placement, placement === "standalone" ? standaloneDuration : 4)}
                >{label}</button>
              ))}
            </div>
            {logo?.placement === "standalone" ? (
              <label className="mt-2 flex items-center gap-2 text-[11px]">
                独立动效时长
                <select
                  disabled={disabled}
                  value={standaloneDuration}
                  onChange={(event) => onConfigureLogo("standalone", Number(event.target.value))}
                >
                  {Array.from({ length: 27 }, (_, index) => index + 4).map((seconds) => (
                    <option key={seconds} value={seconds}>{seconds} 秒</option>
                  ))}
                </select>
              </label>
            ) : logo ? (
              <p className="mt-2 mb-0 text-[10px] text-violet-800">Logo 动效为正片 {logo.placement === "opening" ? "首镜" : "末镜"}，固定计入全片 4 秒时长。</p>
            ) : null}
          </div>
        ) : null}

        {canChooseNarration ? (
          <div className="border-t border-violet-200 pt-2">
            <p className="mt-0 mb-1.5">导演 Agent：最终提示词是否加入旁白？</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                aria-pressed={project.promptOptions?.narration === "include"}
                className={`rounded-full px-2.5 py-1 text-[11px] ${project.promptOptions?.narration === "include" ? "bg-violet-900 text-white" : "bg-white text-violet-900 ring-1 ring-violet-200"}`}
                disabled={disabled}
                type="button"
                onClick={() => onSetNarration("include")}
              >加入旁白</button>
              <button
                aria-pressed={project.promptOptions?.narration === "omit"}
                className={`rounded-full px-2.5 py-1 text-[11px] ${project.promptOptions?.narration === "omit" ? "bg-violet-900 text-white" : "bg-white text-violet-900 ring-1 ring-violet-200"}`}
                disabled={disabled}
                type="button"
                onClick={() => onSetNarration("omit")}
              >不加旁白</button>
            </div>
            <p className="mt-1 mb-0 text-[10px] text-violet-800">
              {project.promptOptions?.narration === "omit"
                ? "不会输出旁白，但会保留角色对白、环境声和拟声。"
                : project.promptOptions?.narration === "include"
                  ? "会按锁定分镜输出旁白、角色对白、环境声和拟声。"
                  : "选择后才能输出新的最终提示词。"}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TvcLockDialog({
  storyboard,
  onCancel,
  onConfirm,
}: {
  storyboard: TvcStoryboard;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="workflow-project-editor-backdrop" data-workflow-isolated>
      <section className="workflow-project-editor tvc-lock-dialog" role="dialog" aria-modal="true" aria-label="锁定 TVC 分镜稿">
        <h2>锁定 TVC 分镜稿？</h2>
        <p className="tvc-dialog-copy">
          当前分镜表共 {storyboard.rows.length} 镜、{storyboard.targetDurationSeconds} 秒。锁稿不产生图片或视频费用。
        </p>
        <p className="tvc-dialog-copy">
          锁定后，Agent 只能基于这份分镜表转换最终视频提示词；后续修改脚本、镜头、时长、旁白或场景会自动回到草案并作废提示词。
        </p>
        <div>
          <button type="button" onClick={onCancel}>返回检查</button>
          <button type="button" className="tvc-confirm-button" onClick={onConfirm}>确认锁稿</button>
        </div>
      </section>
    </div>
  );
}

type TvcStoryboardEditableTextField =
  | "shotNumber"
  | "referenceScene"
  | "sceneTime"
  | "shotSizeLens"
  | "camera"
  | "composition"
  | "performance"
  | "narration"
  | "dialogue"
  | "sound"
  | "transition"
  | "constraints";

const TVC_STORYBOARD_TEXT_COLUMNS: Array<{
  key: TvcStoryboardEditableTextField;
  label: string;
}> = [
  { key: "referenceScene", label: "参考场景图" },
  { key: "sceneTime", label: "场景/时间" },
  { key: "shotSizeLens", label: "景别与焦段" },
  { key: "camera", label: "机位与运镜" },
  { key: "composition", label: "画面构图" },
  { key: "performance", label: "角色动作与表演" },
  { key: "narration", label: "旁白 / 对白" },
  { key: "sound", label: "环境声与拟声" },
  { key: "transition", label: "转场/切点" },
  { key: "constraints", label: "连续性与生成限制" },
];

function tvcTableDraftRows(storyboard: TvcStoryboard): TvcStoryboardTableDraftRow[] {
  return storyboard.rows.map((row) => ({
    shotNumber: row.shotNumber,
    durationSeconds: row.durationSeconds,
    referenceScene: row.referenceScene,
    sceneTime: row.sceneTime,
    shotSizeLens: row.shotSizeLens,
    camera: row.camera,
    composition: row.composition,
    performance: row.performance,
    narration: row.narration,
    dialogue: row.dialogue ?? "",
    sound: row.sound,
    transition: row.transition,
    constraints: row.constraints,
    referenceNodeIds: [...row.referenceNodeIds],
    ...(row.kind ? { kind: row.kind } : {}),
  }));
}

function tvcTimecode(second: number) {
  const safeSecond = Math.max(0, second);
  return `${String(Math.floor(safeSecond / 60)).padStart(2, "0")}:${String(safeSecond % 60).padStart(2, "0")}`;
}

function TvcStoryboardNodePreview({
  storyboard,
  phase,
  hasPromptPlan,
  segmentControlsReadOnly,
  onOpen,
  onEdit,
  onAdjustSegments,
  onExport,
}: {
  storyboard: TvcStoryboard;
  phase: "intake" | "script-draft" | "script-locked" | "prompt-final";
  hasPromptPlan: boolean;
  segmentControlsReadOnly: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onAdjustSegments: () => void;
  onExport: () => void;
}) {
  return (
    <section
      className="tvc-storyboard-node-preview"
      data-workflow-isolated
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div>
        <strong>{storyboard.title}</strong>
        <p>{tvcStageLabel(phase)} · {storyboard.rows.length} 镜 · {storyboard.targetDurationSeconds} 秒</p>
        <p className="tvc-storyboard-node-status">{storyboard.validationStatus}</p>
      </div>
      <ol>
        {storyboard.rows.slice(0, 3).map((row) => (
          <li key={row.shotNumber}>
            <strong>{row.shotNumber}</strong>
            <span>{row.timecode} · {row.referenceScene}</span>
          </li>
        ))}
      </ol>
      <div className="tvc-storyboard-node-actions">
        <button data-workflow-control type="button" aria-label="展开分镜表" onClick={onOpen}>展开分镜表</button>
        <button data-workflow-control type="button" aria-label="编辑分镜表" onClick={onEdit}>编辑</button>
        {phase === "prompt-final" ? (
          <button
            data-workflow-control
            aria-label="调整镜头段"
            disabled={segmentControlsReadOnly || !hasPromptPlan}
            title={segmentControlsReadOnly
              ? "已有提交或历史视频，镜头段只能查看。"
              : hasPromptPlan
                ? "按锁定分镜调整每个视频段的切点。"
                : "请先按 30 秒重新输出。"}
            type="button"
            onClick={onAdjustSegments}
          >调整镜头段</button>
        ) : null}
        <button data-workflow-control type="button" aria-label="导出 Excel" onClick={onExport}><Download size={14} />导出 Excel</button>
      </div>
    </section>
  );
}

function TvcPromptNodePreview({
  promptUnits,
  standaloneLogoUnit,
  onOpen,
}: {
  promptUnits?: TvcPromptUnit[];
  standaloneLogoUnit?: TvcStandaloneLogoUnit;
  onOpen: () => void;
}) {
  const count = (promptUnits?.length ?? 0) + (standaloneLogoUnit ? 1 : 0);
  return (
    <section
      className="tvc-prompt-node-preview"
      data-workflow-isolated
      onPointerDown={(event) => event.stopPropagation()}
    >
      <p>{count
        ? `已生成 ${count} 个锁稿提示词单元${standaloneLogoUnit ? "，含独立品牌 Logo 动效。" : "。"}`
        : "尚未生成锁稿后的最终提示词。"}</p>
      <button data-workflow-control type="button" aria-label="查看最终提示词" onClick={onOpen}>查看最终提示词</button>
    </section>
  );
}

type TvcStoryboardTimedRow = {
  row: TvcStoryboard["rows"][number];
  index: number;
  startSecond: number;
  endSecond: number;
};

function tvcStoryboardTimedRows(storyboard: TvcStoryboard): TvcStoryboardTimedRow[] {
  let startSecond = 0;
  return storyboard.rows.map((row, index) => {
    const endSecond = startSecond + row.durationSeconds;
    const timed = { row, index, startSecond, endSecond };
    startSecond = endSecond;
    return timed;
  });
}

type TvcPromptPlanPreview = {
  startSecond: number;
  endSecond: number;
  shotNumbers: string[];
  referenceNodeIds: string[];
};

function tvcPromptPlanPreview(
  rows: TvcStoryboardTimedRow[],
  cutAfterShotNumbers: ReadonlySet<string>,
): TvcPromptPlanPreview[] {
  const segments: TvcPromptPlanPreview[] = [];
  let startSecond = 0;
  let shotNumbers: string[] = [];
  let referenceNodeIds: string[] = [];
  for (const timed of rows) {
    shotNumbers.push(timed.row.shotNumber);
    referenceNodeIds = [
      ...referenceNodeIds,
      ...timed.row.referenceNodeIds.filter((nodeId) => !referenceNodeIds.includes(nodeId)),
    ];
    if (!cutAfterShotNumbers.has(timed.row.shotNumber) && timed.index !== rows.length - 1) continue;
    segments.push({
      startSecond,
      endSecond: timed.endSecond,
      shotNumbers,
      referenceNodeIds,
    });
    startSecond = timed.endSecond;
    shotNumbers = [];
    referenceNodeIds = [];
  }
  return segments;
}

function TvcPromptPlanEditor({
  storyboard,
  promptPlan,
  readOnly,
  regeneration,
  onSave,
}: {
  storyboard: TvcStoryboard;
  promptPlan: TvcPromptPlanSegment[];
  readOnly: boolean;
  regeneration: TvcPromptRegenerationState;
  onSave: (boundaries: TvcPromptPlanBoundary[]) => void;
}) {
  const rows = useMemo(() => tvcStoryboardTimedRows(storyboard), [storyboard]);
  const [cutAfterShotNumbers, setCutAfterShotNumbers] = useState(() => new Set(
    promptPlan.map((segment) => segment.endSecond)
      .flatMap((endSecond) => rows.find((item) => item.endSecond === endSecond)?.row.shotNumber ?? []),
  ));
  const segments = useMemo(
    () => tvcPromptPlanPreview(rows, cutAfterShotNumbers),
    [cutAfterShotNumbers, rows],
  );
  const invalidSegment = segments.find((segment) =>
    segment.endSecond - segment.startSecond > 30 ||
    segment.endSecond - segment.startSecond < 4,
  );

  function toggleCut(shotNumber: string, checked: boolean) {
    setCutAfterShotNumbers((current) => {
      const next = new Set(current);
      if (checked) next.add(shotNumber);
      else next.delete(shotNumber);
      return next;
    });
  }

  return (
    <section className="tvc-prompt-plan-editor" aria-label="调整镜头段">
      <header>
        <div>
          <h3>调整镜头段</h3>
          <p>按已锁定的分镜行选择切点。每个视频段必须为 4–30 秒；保存后只会重新请求文字提示词，不会生成媒体。</p>
        </div>
        <p className="tvc-prompt-plan-total">项目范围 {tvcTimecode(0)}–{tvcTimecode(storyboard.targetDurationSeconds)} · {segments.length} 段</p>
      </header>
      {readOnly ? (
        <p className="tvc-prompt-plan-readonly">已有提交或历史视频结果。为避免改写历史任务，镜头段仅可查看。</p>
      ) : null}
      <div className="tvc-prompt-plan-segments" aria-label="当前视频段">
        {segments.map((segment, index) => {
          const duration = segment.endSecond - segment.startSecond;
          const persisted = promptPlan[index];
          return (
            <article key={`${segment.startSecond}-${segment.endSecond}`}>
              <strong>{persisted?.ref ?? `segment-${String(index + 1).padStart(3, "0")}`}</strong>
              <span>项目时间 {tvcTimecode(segment.startSecond)}–{tvcTimecode(segment.endSecond)}</span>
              <span>实际时长 {duration} 秒</span>
              <span>包含镜头 {segment.shotNumbers.join("、")}</span>
            </article>
          );
        })}
      </div>
      <div className="tvc-prompt-plan-rows">
        {rows.map((timed) => {
          const segmentIndex = segments.findIndex((segment) =>
            timed.startSecond >= segment.startSecond && timed.endSecond <= segment.endSecond,
          );
          const isFinalRow = timed.index === rows.length - 1;
          return (
            <label key={timed.row.shotNumber}>
              <input
                aria-label={`在镜头 ${timed.row.shotNumber} 后切段`}
                checked={isFinalRow || cutAfterShotNumbers.has(timed.row.shotNumber)}
                disabled={readOnly || isFinalRow}
                type="checkbox"
                onChange={(event) => toggleCut(timed.row.shotNumber, event.target.checked)}
              />
              <span>{timed.row.shotNumber} · {tvcTimecode(timed.startSecond)}–{tvcTimecode(timed.endSecond)} · {timed.row.durationSeconds} 秒</span>
              <em>视频段 {segmentIndex + 1}</em>
              <small>{isFinalRow ? "项目末镜固定收段" : "在本镜后切段"}</small>
            </label>
          );
        })}
      </div>
      {invalidSegment ? (
        <p className="tvc-storyboard-edit-error">{tvcTimecode(invalidSegment.startSecond)}–{tvcTimecode(invalidSegment.endSecond)} 的视频段不在 4–30 秒范围内。</p>
      ) : null}
      <div className="tvc-prompt-plan-actions">
        <button
          className="tvc-storyboard-save"
          disabled={readOnly || Boolean(invalidSegment) || regeneration?.state === "awaiting"}
          type="button"
          onClick={() => onSave(segments.map(({ startSecond, endSecond }) => ({ startSecond, endSecond })))}
        >{regeneration?.state === "awaiting" ? "正在重建最终提示词…" : "保存镜头段并重新输出"}</button>
      </div>
    </section>
  );
}

function TvcStoryboardCanvasPanel({
  storyboard,
  promptPlan,
  promptUnits,
  standaloneLogoUnit,
  videoSchedulers,
  initialTab,
  initialEditing,
  initialSegmentEditing,
  phase,
  segmentControlsReadOnly,
  promptRegeneration,
  onClose,
  onExport,
  onSave,
  onPreparePromptPlan,
  onSavePromptPlan,
}: {
  storyboard: TvcStoryboard;
  promptPlan?: TvcPromptPlanSegment[];
  promptUnits?: TvcPromptUnit[];
  standaloneLogoUnit?: TvcStandaloneLogoUnit;
  videoSchedulers: WorkflowSchedulerNode[];
  initialTab: "storyboard" | "prompt";
  initialEditing: boolean;
  initialSegmentEditing: boolean;
  phase: "intake" | "script-draft" | "script-locked" | "prompt-final";
  segmentControlsReadOnly: boolean;
  promptRegeneration: TvcPromptRegenerationState;
  onClose: () => void;
  onExport: () => void;
  onSave: (rows: TvcStoryboardTableDraftRow[]) => void;
  onPreparePromptPlan: () => void;
  onSavePromptPlan: (boundaries: TvcPromptPlanBoundary[]) => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [editing, setEditing] = useState(initialEditing);
  const [segmentEditing, setSegmentEditing] = useState(initialSegmentEditing);
  const [draftRows, setDraftRows] = useState<TvcStoryboardTableDraftRow[]>(() =>
    tvcTableDraftRows(storyboard),
  );
  const [error, setError] = useState("");

  const rowsWithTimecode = useMemo(() => {
    return draftRows.reduce<{
      cursor: number;
      rows: Array<{ row: TvcStoryboardTableDraftRow; timecode: string }>;
    }>((state, row) => {
      const duration = Number.isInteger(row.durationSeconds) && row.durationSeconds > 0
        ? row.durationSeconds
        : 0;
      return {
        cursor: state.cursor + duration,
        rows: [...state.rows, {
        row,
          timecode: `${tvcTimecode(state.cursor)}–${tvcTimecode(state.cursor + duration)}`,
        }],
      };
    }, { cursor: 0, rows: [] }).rows;
  }, [draftRows]);

  function updateTextRow(
    index: number,
    field: TvcStoryboardEditableTextField,
    value: string,
  ) {
    setDraftRows((current) => current.map((row, rowIndex) =>
      rowIndex === index ? { ...row, [field]: value } : row,
    ));
  }

  function updateDuration(index: number, value: string) {
    const durationSeconds = Number(value);
    setDraftRows((current) => current.map((row, rowIndex) =>
      rowIndex === index
        ? { ...row, durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0 }
        : row,
    ));
  }

  function cancelEditing() {
    setDraftRows(tvcTableDraftRows(storyboard));
    setError("");
    setEditing(false);
  }

  function saveEditing() {
    try {
      onSave(draftRows);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法保存 TVC 分镜表。");
    }
  }

  return (
    <section
      aria-label="画布内分镜表"
      className="tvc-storyboard-canvas-panel"
      data-workflow-isolated
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="tvc-storyboard-canvas-header">
        <div>
          <h2>{storyboard.title} · 画布内分镜表</h2>
          <p>{tvcStageLabel(phase)} · {storyboard.validationStatus} · 目标 {storyboard.targetDurationSeconds} 秒</p>
        </div>
        <div className="tvc-storyboard-canvas-actions">
          {phase === "prompt-final" ? (
            <button
              aria-label="按30秒重新输出"
              disabled={segmentControlsReadOnly || promptRegeneration?.state === "awaiting"}
              title={segmentControlsReadOnly
                ? "已有提交或历史视频，不能改写镜头段。"
                : "按锁定分镜重建每段不超过 30 秒的最终提示词。"}
              type="button"
              onClick={onPreparePromptPlan}
            >按30秒重新输出</button>
          ) : null}
          {phase === "prompt-final" && promptPlan?.length ? (
            <button
              aria-label="调整镜头段"
              disabled={segmentControlsReadOnly}
              type="button"
              onClick={() => {
                setTab("prompt");
                setSegmentEditing(true);
              }}
            >调整镜头段</button>
          ) : null}
          {tab === "storyboard" && !editing && !segmentEditing ? (
            <button type="button" aria-label="编辑分镜表" onClick={() => setEditing(true)}>编辑</button>
          ) : null}
          {editing ? (
            <>
              <button type="button" aria-label="取消编辑" onClick={cancelEditing}>取消编辑</button>
              <button type="button" aria-label="保存分镜表" className="tvc-storyboard-save" onClick={saveEditing}>保存分镜表</button>
            </>
          ) : null}
          <button type="button" aria-label="导出 Excel" onClick={onExport}><Download size={15} />导出 Excel</button>
          <button type="button" aria-label="关闭画布内分镜表" className="tvc-storyboard-close" onClick={onClose}><X size={17} /></button>
        </div>
      </header>
      <div className="tvc-storyboard-tabs" role="tablist" aria-label="TVC 分镜表视图">
        <button
          aria-selected={tab === "storyboard"}
          role="tab"
          type="button"
          onClick={() => {
            setTab("storyboard");
            setSegmentEditing(false);
          }}
        >镜头分镜表</button>
        <button
          aria-label="最终提示词"
          aria-selected={tab === "prompt"}
          role="tab"
          type="button"
          onClick={() => setTab("prompt")}
        >最终提示词{(promptUnits?.length || standaloneLogoUnit) ? `（${(promptUnits?.length ?? 0) + (standaloneLogoUnit ? 1 : 0)}）` : ""}</button>
      </div>
      <div className="tvc-storyboard-canvas-content">
        {tab === "storyboard" ? (
          <div className="tvc-storyboard-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>镜号</th>
                  <th>时间码</th>
                  <th>时长（秒）</th>
                  {TVC_STORYBOARD_TEXT_COLUMNS.map((column) => <th key={column.key}>{column.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rowsWithTimecode.map(({ row, timecode }, index) => (
                  <tr key={`${index}-${row.shotNumber}`}>
                    <td>
                      {editing ? <input aria-label={`第 ${index + 1} 镜镜号`} value={row.shotNumber} onChange={(event) => updateTextRow(index, "shotNumber", event.target.value)} /> : (
                        <span className="tvc-storyboard-shot-number">
                          {row.shotNumber}
                          {row.kind === "logo-animation" ? <small>Logo 动效</small> : null}
                        </span>
                      )}
                    </td>
                    <td>{editing ? <input aria-label={`第 ${index + 1} 镜时间码`} readOnly value={timecode} /> : timecode}</td>
                    <td>
                      {editing ? <input aria-label={`第 ${index + 1} 镜时长`} min="1" step="1" type="number" value={row.durationSeconds} onChange={(event) => updateDuration(index, event.target.value)} /> : row.durationSeconds}
                    </td>
                    {TVC_STORYBOARD_TEXT_COLUMNS.map((column) => {
                      if (column.key === "narration") {
                        return <td key={column.key} className="tvc-storyboard-audio-cell">
                          {editing ? (
                            <div>
                              <label>
                                <span>旁白</span>
                                <textarea
                                  aria-label={`第 ${index + 1} 镜旁白`}
                                  value={row.narration}
                                  onChange={(event) => updateTextRow(index, "narration", event.target.value)}
                                />
                              </label>
                              <label>
                                <span>对白</span>
                                <textarea
                                  aria-label={`第 ${index + 1} 镜对白`}
                                  value={row.dialogue ?? ""}
                                  onChange={(event) => updateTextRow(index, "dialogue", event.target.value)}
                                />
                              </label>
                            </div>
                          ) : (
                            <>
                              <p>旁白：{row.narration || "无"}</p>
                              <p>对白：{row.dialogue || "无"}</p>
                            </>
                          )}
                        </td>;
                      }
                      return <td key={column.key}>
                        {editing ? <textarea aria-label={`第 ${index + 1} 镜${column.label}`} value={row[column.key] ?? ""} onChange={(event) => updateTextRow(index, column.key, event.target.value)} /> : row[column.key]}
                      </td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : segmentEditing && promptPlan?.length ? (
          <TvcPromptPlanEditor
            storyboard={storyboard}
            promptPlan={promptPlan}
            readOnly={segmentControlsReadOnly}
            regeneration={promptRegeneration}
            onSave={onSavePromptPlan}
          />
        ) : videoSchedulers.length ? (
          <section className="tvc-storyboard-prompt-units">
            {videoSchedulers.map((scheduler) => {
              const unit = scheduler.storyRole === "tvc-logo-video-scheduler"
                ? undefined
                : promptUnits?.find((item) => item.ref === scheduler.tvcUnitRef);
              const logoUnit = scheduler.storyRole === "tvc-logo-video-scheduler"
                ? standaloneLogoUnit
                : undefined;
              return (
                <article key={scheduler.id}>
                  <h3>{scheduler.label || scheduler.tvcUnitRef || "最终提示词调度"}</h3>
                  <p>
                    {logoUnit
                      ? `独立品牌 Logo 动效 · 实际时长 ${logoUnit.durationSeconds} 秒`
                      : `项目时间 ${unit ? `${tvcTimecode(unit.startSecond)}–${tvcTimecode(unit.endSecond)}` : "历史任务"}`}
                    {unit ? ` · 实际时长 ${unit.endSecond - unit.startSecond} 秒 · 镜头 ${unit.shotNumbers.join("、")}` : ""}
                  </p>
                  <p>参考资产：{(unit?.referenceNodeIds ?? logoUnit?.referenceNodeIds ?? []).length
                    ? (unit?.referenceNodeIds ?? logoUnit?.referenceNodeIds ?? []).join("、")
                    : "未使用图片参考"}</p>
                  <pre>{scheduler.prompt}</pre>
                </article>
              );
            })}
          </section>
        ) : (
          <p className="tvc-storyboard-empty-prompt">
            {promptRegeneration?.state === "awaiting"
              ? promptRegeneration.message
              : phase === "script-locked"
                ? "镜头段已锁定，正在等待仅文字的最终提示词输出。"
                : "锁稿后可在此查看按平台时长拆分的最终提示词。"}
          </p>
        )}
      </div>
      {editing ? <p className="tvc-storyboard-edit-note">时间码会随时长自动连续重算；保存后将回到分镜草案并作废已有最终提示词。</p> : null}
      {promptRegeneration ? (
        <p className={`tvc-prompt-regeneration-status tvc-prompt-regeneration-${promptRegeneration.state}`} role="status">
          {promptRegeneration.message}
        </p>
      ) : null}
      {error ? <p className="tvc-storyboard-edit-error">{error}</p> : null}
    </section>
  );
}

function WorkflowDetail({ node, assetUrl, onClose }: { node: WorkflowNode; assetUrl?: string; onClose: () => void }) {
  const url = assetUrl || (node.type === "result" ? node.resultUrl : undefined);
  const kind = node.type === "scheduler" ? node.outputKind : node.kind;
  return <div className="canvas-node-detail-backdrop" data-workflow-isolated>
    <button className="canvas-node-detail-dismiss" aria-label="关闭节点详情" type="button" onClick={onClose} />
    <section className="canvas-node-detail" role="dialog" aria-modal="true">
      <header className="canvas-node-detail-header"><h2>查看{kind === "image" ? "图片" : kind === "video" ? "视频" : "文本"}节点</h2><button type="button" onClick={onClose}><X size={18} /></button></header>
      {kind === "image" && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="canvas-node-detail-media" src={url} alt="工作流图片预览" />
      ) : kind === "video" && url ? (
        // Media sources do not include a separate captions track.
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video className="canvas-node-detail-media" src={url} controls preload="metadata" />
      ) : node.type !== "scheduler" ? <p className="workflow-detail-text">{node.text}</p> : null}
    </section>
  </div>;
}
