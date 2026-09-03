"use client";

import {
  Bot,
  Download,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Video,
  Workflow,
  X,
} from "lucide-react";
import type { CSSProperties, PointerEvent } from "react";
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
  moveWorkflowNodes,
  parseWorkflowGraph,
  readWorkflowInputs,
  removeWorkflowEdge,
  removeWorkflowNode,
  resizedWorkflowNodeBounds,
  resizeWorkflowNode,
  schedulerDefaults,
  updateWorkflowNode,
  updateWorkflowResult,
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
  createWorkflowProject,
  ensureWorkflowProjectRegistry,
  migrateActiveWorkflowAssetLayout,
  parseWorkflowViewport,
  projectSourceAssetIds,
  removeWorkflowProject,
  renameWorkflowProject,
  workflowProjectBatchKey,
  workflowProjectConversationKey,
  workflowProjectGraphKey,
  workflowProjectViewportKey,
  type WorkflowProjectRegistry,
} from "@/app/workflow/projects";
import { CanvasAgentSidebar } from "@/components/canvas-agent-sidebar";
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
  error: string;
};

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

async function readApiError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string") return payload.error;
  } catch {
    // Use the safe local fallback below.
  }
  return "生成请求失败，请稍后重试。";
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
    const safeRestored = {
      ...restored,
      nodes: restored.nodes.map((node) =>
        node.type === "result" && node.status === "pending" && !node.taskId
          ? {
              ...node,
              status: "paused" as const,
              progress: "提交状态未知",
              error: "页面在任务 ID 保存前中断，已停止自动重试以避免重复计费。",
            }
          : node,
      ),
    };
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
    if (!node.taskId || pollingTasks.current.has(node.taskId)) return;
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
      setGraph((value) => connectWorkflowNodes(value, current.nodeId, current.targetId!));
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
    setGraph((current) => updateWorkflowNode(current, node.id, {
      ...schedulerDefaults(outputKind),
      error: "",
    }));
  }

  function updateSchedulerModel(node: WorkflowSchedulerNode, model: string) {
    const config = getModelConfig(node.outputKind, model);
    if (!config) return;
    setGraph((current) => updateWorkflowNode(current, node.id, {
      model,
      aspectRatio: config.aspectRatios[0] ?? "",
      resolution: config.defaultResolution ?? config.resolutions[0] ?? "",
      duration: config.durations[0] ?? "",
      error: "",
    }));
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

  const runScheduler = useCallback(async (schedulerId: string) => {
    if (runningSchedulersRef.current.has(schedulerId)) return;
    const scheduler = graphRef.current.nodes.find(
      (node): node is WorkflowSchedulerNode =>
        node.id === schedulerId && node.type === "scheduler",
    );
    if (!scheduler) return;
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
    runningSchedulersRef.current.add(scheduler.id);
    setRunningSchedulers((current) => new Set(current).add(scheduler.id));
    let createdResultIds: string[] = [];
    try {
      const files = await Promise.all(inputs.images.map((node) =>
        workflowImageToFile(
          node,
          remote
            ? async (assetId) => readCloudAsset(assetId, assetVersionsRef.current[assetId])
            : readAsset,
        )
      ));
      if (files.length > config.maxReferenceImages) {
        throw new Error(`参考图片超过当前模型的 ${config.maxReferenceImages} 张上限。`);
      }
      if (files.some((file) => file.size > MAX_IMAGE_BYTES)) throw new Error("单张参考图片不能超过 10MB。");
      if (files.reduce((sum, file) => sum + file.size, 0) > MAX_IMAGE_TOTAL_BYTES) {
        throw new Error("参考图片合计不能超过 30MB。");
      }
      const images = await Promise.all(files.map(async (file) => ({
        name: file.name,
        mimeType: file.type,
        size: file.size,
        dataUrl: await fileToDataUrl(file),
      } satisfies GenerateReferenceImage)));
      const created = createWorkflowRun(graphRef.current, scheduler.id, Date.now());
      if (!created.resultIds.length) return;
      createdResultIds = created.resultIds;
      graphRef.current = created.graph;
      setGraph(created.graph);
      await Promise.all(created.resultIds.map(async (resultId) => {
        try {
          const response = await fetch("/api/ai/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: scheduler.outputKind,
              model: scheduler.model,
              prompt,
              images,
              aspectRatio: scheduler.aspectRatio || undefined,
              resolution: scheduler.resolution || undefined,
              duration: scheduler.duration || undefined,
            }),
          });
          if (!response.ok) throw new Error(await readApiError(response));
          const result = (await response.json()) as GenerateResponse;
          commitGraph((current) => result.kind === "text"
            ? updateWorkflowResult(current, resultId, {
                status: "success", progress: "", text: result.content,
              })
            : updateWorkflowResult(current, resultId, {
                status: "pending", progress: "排队中", taskId: result.taskId, startedAt: Date.now(),
              }));
        } catch (error) {
          commitGraph((current) => updateWorkflowResult(current, resultId, {
            status: "failed",
            progress: "",
            error: error instanceof Error ? error.message : "生成请求失败，请稍后重试。",
          }));
        }
      }));
      commitGraph((current) => updateWorkflowNode(current, scheduler.id, { error: "" }));
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
  }, [commitGraph, remote]);

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
      error: "",
    });
  }

  async function saveProjectName() {
    if (!projects || !projectEditor) return;
    try {
      if (projectEditor.mode === "create") {
        if (remote) {
          const created = await createCloudProject(projectEditor.value);
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
          JSON.stringify(emptyWorkflowGraph()),
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
    setProjectEditor({ mode: "rename", value: active.name, error: "" });
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
      const created = await createCloudProject(`${active.name}-副本-${Date.now()}`);
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

  function exportLocalProject() {
    if (remote || !projects) return;
    const active = projects.projects.find((project) => project.id === projects.activeProjectId);
    if (!active) return;
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
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      project: active,
      graph: graphRef.current,
      viewport: viewportRef.current,
      batch: null,
      conversation: textConversation,
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
  }

  function deleteNode(node: WorkflowNode) {
    if (node.type === "result" && (node.status === "pending" || node.status === "running")) {
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
            disabled={runningSchedulers.size > 0 || (remote && cloudSyncState !== "idle")}
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
          {!remote ? (
            <button aria-label="导出当前项目" title="导出当前项目" type="button" onClick={exportLocalProject}>
              <Download size={15} />
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
            {projectEditor.error ? <p>{projectEditor.error}</p> : null}
            <div>
              <button type="button" onClick={() => setProjectEditor(null)}>取消</button>
              <button type="submit">保存</button>
            </div>
          </form>
        </div>
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
              setGraph((current) => removeWorkflowEdge(current, hoveredEdge.id));
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

        {graph.nodes.map((node) => (
          <WorkflowNodeCard
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
            onDelete={() => deleteNode(node)}
            onOpen={() => setDetailId(node.id)}
            onChange={(update) => setGraph((current) => updateWorkflowNode(current, node.id, update))}
            onUpload={(file) => node.type === "source" && void uploadSource(node, file)}
            onKindChange={(kind) => node.type === "scheduler" && updateSchedulerKind(node, kind)}
            onModelChange={(model) => node.type === "scheduler" && updateSchedulerModel(node, model)}
            onRun={() => node.type === "scheduler" && void runScheduler(node.id)}
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
          />
        ))}

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
          <WorkflowCreationMenu point={creationMenu} onCreate={createNode} />
        ) : null}

        {schedulerMenu ? (
          <WorkflowSchedulerMenu
            menu={schedulerMenu}
            onCreate={createSchedulerFromMenu}
          />
        ) : null}
      </div>

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
        subtitle="GPT-5.6 Sol · 可规划并运行工作流"
        emptyMessage="粘贴完整剧本后，我会先分析类型、主题、受众、情绪和时长，再逐批搭建人物、场景与道具资产库。"
        intakePlaceholder="粘贴完整剧本或输入资产规划要求…"
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
  onDelete,
  onOpen,
  onChange,
  onUpload,
  onKindChange,
  onModelChange,
  onRun,
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
  onDelete: () => void;
  onOpen: () => void;
  onChange: (update: Partial<WorkflowNode>) => void;
  onUpload: (file?: File) => void;
  onKindChange: (kind: ComposerMode) => void;
  onModelChange: (model: string) => void;
  onRun: () => void;
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
        if (node.type === "result" || (node.type === "source" && node.kind !== "text")) onOpen();
      }}
    >
      <header className="canvas-node-header">
        <span className="canvas-node-kind"><Icon size={15} /><span className="workflow-node-title">{title}</span></span>
        <button
          aria-label="删除节点"
          className="canvas-node-delete"
          data-workflow-control
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); onDelete(); }}
        ><Trash2 size={14} /></button>
      </header>

      {node.type === "source" ? (
        <div className={`workflow-source-body${node.kind === "image" && assetUrl && !assetError ? " workflow-source-body-media" : ""}`}>
          {node.kind === "text" ? (
            <textarea
              aria-label="文本素材内容"
              data-workflow-control
              placeholder="在这里输入提示词或上下文…"
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
              ) : <><Plus size={20} /><span>上传一{node.kind === "image" ? "张图片" : "段视频"}</span></>}
              <input
                type="file"
                accept={node.kind === "image" ? "image/*" : "video/*"}
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
          onChange={onChange}
          onKindChange={onKindChange}
          onModelChange={onModelChange}
          onRun={onRun}
        />
      ) : (
        <ResultBody
          node={node}
          assetUrl={assetUrl}
          assetLoading={assetLoading}
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
  previous.running === next.running,
);

function SchedulerControls({ node, inputPorts, pendingInputKind, running, onChange, onKindChange, onModelChange, onRun }: {
  node: WorkflowSchedulerNode;
  inputPorts: WorkflowInputPort[];
  pendingInputKind?: ComposerMode;
  running: boolean;
  onChange: (update: Partial<WorkflowNode>) => void;
  onKindChange: (kind: ComposerMode) => void;
  onModelChange: (model: string) => void;
  onRun: () => void;
}) {
  const config = getModelConfig(node.outputKind, node.model);
  const taskCount = node.outputKind === "text" ? 1 : node.outputCount;
  return (
    <div className="workflow-scheduler" data-workflow-control onPointerDown={(event) => event.stopPropagation()}>
      <div className="workflow-input-section">
        <span className="workflow-input-title">输入类型</span>
        <div className="workflow-input-list">
          {inputPorts.map((port) => (
            <div
              key={port.edgeId}
              className={`workflow-input-row workflow-input-row-${port.kind}`}
              title={`${port.label} · ${port.sourceName}`}
            >
              <span className="workflow-input-row-port" aria-hidden="true" />
              <strong>{port.label}</strong>
              <span>{port.sourceName}</span>
            </div>
          ))}
          {pendingInputKind ? (
            <div className={`workflow-input-row workflow-input-row-${pendingInputKind} workflow-input-row-pending`}>
              <span className="workflow-input-row-port" aria-hidden="true" />
              <strong>新输入</strong>
              <span>松开后连接</span>
            </div>
          ) : null}
          {!inputPorts.length && !pendingInputKind ? (
            <div className="workflow-input-empty">暂无输入</div>
          ) : null}
        </div>
      </div>
      <div className="workflow-scheduler-fields">
        <div className="workflow-field-row">
          <label>输出类型<select disabled={node.assetRole === "scheduler"} value={node.outputKind} onChange={(event) => onKindChange(event.target.value as ComposerMode)}>
            <option value="text">文本</option><option value="image">图片</option><option value="video">视频</option>
          </select></label>
          <label>模型<select value={node.model} onChange={(event) => onModelChange(event.target.value)}>
            {MODEL_CONFIGS[node.outputKind].map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
          </select></label>
        </div>
        <label className="workflow-prompt">提示词<textarea value={node.prompt} placeholder="描述本节点要生成的内容…" onChange={(event) => onChange({ prompt: event.target.value, error: "" })} /></label>
        {node.outputKind !== "text" ? <div className="workflow-field-row workflow-parameters">
          <label>比例<select value={node.aspectRatio} onChange={(event) => onChange({ aspectRatio: event.target.value })}>{config?.aspectRatios.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>清晰度<select value={node.resolution} onChange={(event) => onChange({ resolution: event.target.value })}>{config?.resolutions.map((value) => <option key={value}>{value}</option>)}</select></label>
          {node.outputKind === "video" ? <label>时长<select value={node.duration} onChange={(event) => onChange({ duration: event.target.value })}>{config?.durations.map((value) => <option key={value} value={value}>{value} 秒</option>)}</select></label> : null}
            <label>数量<select disabled={node.assetRole === "scheduler"} value={node.outputCount} onChange={(event) => onChange({ outputCount: Number(event.target.value) })}>{[1, 2, 3, 4].map((value) => <option key={value}>{value}</option>)}</select></label>
        </div> : null}
        {node.error ? <p className="workflow-scheduler-error">{node.error}</p> : null}
        <button className="workflow-run" disabled={running} type="button" onClick={onRun}>
          {running ? <LoaderCircle className="animate-spin" size={15} /> : <Play size={15} fill="currentColor" />}
          {running ? "正在提交" : `运行 ${taskCount} 个任务`}
        </button>
      </div>
    </div>
  );
}

function ResultBody({ node, assetUrl, assetLoading, onResume, onMediaLoad }: {
  node: WorkflowResultNode;
  assetUrl?: string;
  assetLoading: boolean;
  onResume: () => void;
  onMediaLoad: (width: number, height: number) => void;
}) {
  if (node.status === "failed") return <p className="canvas-node-error">{node.error || "任务失败"}</p>;
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

function WorkflowCreationMenu({ point, onCreate }: { point: CreationMenu; onCreate: (type: ComposerMode | "scheduler") => void }) {
  const items = [
    { type: "text", label: "文本素材", icon: FileText },
    { type: "image", label: "图片素材", icon: ImageIcon },
    { type: "video", label: "视频素材", icon: Video },
    { type: "scheduler", label: "通用调度", icon: Workflow },
  ] as const;
  return <div className="workflow-create-menu" data-workflow-isolated style={{ transform: `translate(${point.x}px, ${point.y}px)` }} onPointerDown={(event) => event.stopPropagation()}>
    {items.map((item) => <button key={item.type} type="button" onClick={() => onCreate(item.type)}><item.icon size={15} />{item.label}</button>)}
  </div>;
}

function WorkflowSchedulerMenu({
  menu,
  onCreate,
}: {
  menu: SchedulerMenu;
  onCreate: (outputKind: ComposerMode) => void;
}) {
  const items = [
    { kind: "text", label: "文本生成", icon: FileText },
    { kind: "image", label: "图片生成", icon: ImageIcon },
    { kind: "video", label: "视频生成", icon: Video },
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
