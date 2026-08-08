"use client";

import {
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Video,
  Workflow,
  X,
} from "lucide-react";
import type { CSSProperties, PointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { deleteAsset, readAsset, saveAsset } from "@/app/canvas/assets";
import {
  panViewport,
  wheelZoomFactor,
  zoomViewport,
  type Viewport,
} from "@/app/canvas/viewport";
import {
  applyWorkflowTaskStatus,
  buildWorkflowPrompt,
  connectWorkflowNodes,
  createConnectedScheduler,
  createWorkflowNode,
  createWorkflowRun,
  emptyWorkflowGraph,
  getWorkflowNodeSize,
  moveWorkflowNodes,
  parseWorkflowGraph,
  readWorkflowInputs,
  removeWorkflowNode,
  resizedWorkflowNodeBounds,
  resizeWorkflowNode,
  schedulerDefaults,
  updateWorkflowNode,
  updateWorkflowResult,
  workflowAutoPollDeadline,
  workflowDraftPath,
  workflowEdgePath,
  workflowNodesIntersecting,
  workflowSelectionBounds,
  WORKFLOW_STORAGE_KEY,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowResizeCorner,
  type WorkflowResultNode,
  type WorkflowSchedulerNode,
  type WorkflowSourceNode,
} from "@/app/workflow/graph";

const DOT_SPACING = 24;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 30 * 1024 * 1024;

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
};
type ResizeState = {
  pointerId: number;
  nodeId: string;
  corner: WorkflowResizeCorner;
  startNode: WorkflowNode;
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

function screenToWorld(viewport: Viewport, point: { x: number; y: number }) {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
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
): Promise<File> {
  let blob: Blob | undefined;
  let name = `workflow-${node.id}.png`;
  if (node.type === "source" && node.assetId) {
    blob = await readAsset(node.assetId);
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
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [graph, setGraph] = useState<WorkflowGraph>(emptyWorkflowGraph);
  const [hydrated, setHydrated] = useState(false);
  const [creationMenu, setCreationMenu] = useState<CreationMenu | null>(null);
  const [schedulerMenu, setSchedulerMenu] = useState<SchedulerMenu | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [assetErrors, setAssetErrors] = useState<Record<string, string>>({});
  const [runningSchedulers, setRunningSchedulers] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const connectionRef = useRef<ConnectionState | null>(null);
  const pollingTasks = useRef(new Set<string>());
  const loadedAssets = useRef(new Set<string>());
  const assetUrlsRef = useRef<Record<string, string>>({});
  const graphRef = useRef<WorkflowGraph>(emptyWorkflowGraph());

  graphRef.current = graph;

  useEffect(() => {
    setGraph(parseWorkflowGraph(window.localStorage.getItem(WORKFLOW_STORAGE_KEY)));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(graph));
  }, [graph, hydrated]);

  useEffect(() => {
    assetUrlsRef.current = assetUrls;
  }, [assetUrls]);

  const restoreAsset = useCallback(async (assetId: string) => {
    try {
      const blob = await readAsset(assetId);
      if (!blob) throw new Error();
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
      setAssetErrors((current) => ({ ...current, [assetId]: "素材已失效，请重新上传。" }));
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    graph.nodes.forEach((node) => {
      if (node.type !== "source" || !node.assetId || loadedAssets.current.has(node.assetId)) return;
      loadedAssets.current.add(node.assetId);
      void restoreAsset(node.assetId);
    });
  }, [graph.nodes, hydrated, restoreAsset]);

  useEffect(() => () => {
    window.localStorage.setItem(
      WORKFLOW_STORAGE_KEY,
      JSON.stringify(graphRef.current),
    );
    Object.values(assetUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    loadedAssets.current.clear();
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
      if (!event.ctrlKey) {
        setViewport((current) => panViewport(current, -deltaX, -deltaY));
      } else {
        const anchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        setViewport((current) =>
          zoomViewport(current, anchor, current.scale * wheelZoomFactor(deltaY, true)),
        );
      }
    }
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setCreationMenu(null);
      setSchedulerMenu(null);
      setDetailId(null);
      connectionRef.current = null;
      setConnection(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
        point: screenToWorld(viewport, {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        }),
        moved,
        targetId: moved ? target?.dataset.workflowNodeId : undefined,
      };
      connectionRef.current = next;
      setConnection(next);
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
      connectionRef.current = null;
      setConnection(null);
    }
    function cancelWindowConnection() {
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
  }, [viewport]);

  const pollTask = useCallback(async (node: WorkflowResultNode) => {
    if (!node.taskId || pollingTasks.current.has(node.taskId)) return;
    if (Date.now() > workflowAutoPollDeadline(node)) {
      setGraph((current) => updateWorkflowResult(current, node.id, {
        status: "paused",
        progress: "已暂停自动查询",
      }));
      return;
    }
    pollingTasks.current.add(node.taskId);
    try {
      const response = await fetch(
        `/api/ai/status?taskId=${encodeURIComponent(node.taskId)}&mode=${node.kind}`,
      );
      if (!response.ok) throw new Error(await readApiError(response));
      const status = (await response.json()) as TaskStatusResponse;
      setGraph((current) => applyWorkflowTaskStatus(current, node.id, status));
    } catch (error) {
      setGraph((current) => updateWorkflowResult(current, node.id, {
        progress: error instanceof Error ? error.message : "任务查询失败，稍后重试",
      }));
    } finally {
      pollingTasks.current.delete(node.taskId);
    }
  }, []);

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
    return screenToWorld(viewport, { x: clientX - bounds.left, y: clientY - bounds.top });
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
    setCreationMenu(null);
    setSchedulerMenu(null);
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
    setMarquee(moved ? next : null);
  }

  function finishCanvasPointer(event: PointerEvent<HTMLElement>) {
    const current = marqueeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.moved) {
      const topLeft = screenToWorld(viewport, {
        x: Math.min(current.startX, current.currentX),
        y: Math.min(current.startY, current.currentY),
      });
      const bottomRight = screenToWorld(viewport, {
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
    marqueeRef.current = null;
    setMarquee(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function beginNodeDrag(event: PointerEvent<HTMLDivElement>, node: WorkflowNode) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-workflow-control]")) return;
    event.stopPropagation();
    const ids = selectedIds.includes(node.id) ? selectedIds : [node.id];
    setSelectedIds(ids);
    setSchedulerMenu(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      nodeIds: ids,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }

  function dragNodes(event: PointerEvent<HTMLDivElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const deltaX = (event.clientX - current.clientX) / viewport.scale;
    const deltaY = (event.clientY - current.clientY) / viewport.scale;
    current.clientX = event.clientX;
    current.clientY = event.clientY;
    setGraph((value) => moveWorkflowNodes(value, current.nodeIds, deltaX, deltaY));
  }

  function finishNodeDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
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
    resizeRef.current = { pointerId: event.pointerId, nodeId: node.id, corner, startNode: { ...node } };
  }

  function resizeFromPointer(event: PointerEvent<HTMLButtonElement>) {
    const current = resizeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setGraph((value) => resizeWorkflowNode(
      value,
      current.nodeId,
      resizedWorkflowNodeBounds(current.startNode, current.corner, canvasPoint(event.clientX, event.clientY)),
    ));
  }

  function finishResize(event: PointerEvent<HTMLButtonElement>) {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
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
    setConnection(next);
  }

  function finishConnection(event: PointerEvent<HTMLButtonElement>) {
    const current = connectionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
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
    const assetId = crypto.randomUUID();
    await saveAsset(assetId, file);
    if (node.assetId) {
      const previousUrl = assetUrls[node.assetId];
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      void deleteAsset(node.assetId);
    }
    const url = URL.createObjectURL(file);
    loadedAssets.current.add(assetId);
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
    }));
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

  async function runScheduler(scheduler: WorkflowSchedulerNode) {
    if (runningSchedulers.has(scheduler.id)) return;
    const inputs = readWorkflowInputs(graph, scheduler.id);
    if (inputs.videos.length) {
      setGraph((current) => updateWorkflowNode(current, scheduler.id, {
        error: "当前模型不支持视频参考输入。",
      }));
      return;
    }
    const prompt = buildWorkflowPrompt(inputs, scheduler.prompt);
    if (!prompt) {
      setGraph((current) => updateWorkflowNode(current, scheduler.id, { error: "请填写提示词或连接文本节点。" }));
      return;
    }
    const config = getModelConfig(scheduler.outputKind, scheduler.model);
    if (!config) {
      setGraph((current) => updateWorkflowNode(current, scheduler.id, { error: "当前模型配置无效。" }));
      return;
    }
    setRunningSchedulers((current) => new Set(current).add(scheduler.id));
    try {
      const files = await Promise.all(inputs.images.map(workflowImageToFile));
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
      const created = createWorkflowRun(graph, scheduler.id, Date.now());
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
          setGraph((current) => result.kind === "text"
            ? updateWorkflowResult(current, resultId, {
                status: "success", progress: "", text: result.content,
              })
            : updateWorkflowResult(current, resultId, {
                status: "pending", progress: "排队中", taskId: result.taskId, startedAt: Date.now(),
              }));
        } catch (error) {
          setGraph((current) => updateWorkflowResult(current, resultId, {
            status: "failed",
            progress: "",
            error: error instanceof Error ? error.message : "生成请求失败，请稍后重试。",
          }));
        }
      }));
      setGraph((current) => updateWorkflowNode(current, scheduler.id, { error: "" }));
    } catch (error) {
      setGraph((current) => updateWorkflowNode(current, scheduler.id, {
        error: error instanceof Error ? error.message : "生成请求失败，请稍后重试。",
      }));
    } finally {
      setRunningSchedulers((current) => {
        const next = new Set(current);
        next.delete(scheduler.id);
        return next;
      });
    }
  }

  function deleteNode(node: WorkflowNode) {
    if (node.type === "result" && (node.status === "pending" || node.status === "running")) {
      if (!window.confirm("删除只会停止本地查询，远端任务仍可能继续并产生费用。确定删除吗？")) return;
    }
    setSelectedIds((current) => current.filter((id) => id !== node.id));
    setGraph((current) => removeWorkflowNode(current, node.id));
    if (node.type === "source" && node.assetId) {
      const url = assetUrls[node.assetId];
      if (url) URL.revokeObjectURL(url);
      void deleteAsset(node.assetId);
      setAssetUrls((current) => {
        const next = { ...current };
        delete next[node.assetId!];
        return next;
      });
    }
  }

  const selection = selectedIds.length > 1 ? workflowSelectionBounds(graph, selectedIds) : null;
  const marqueeBounds = marquee ? {
    x: Math.min(marquee.startX, marquee.currentX),
    y: Math.min(marquee.startY, marquee.currentY),
    width: Math.abs(marquee.currentX - marquee.startX),
    height: Math.abs(marquee.currentY - marquee.startY),
  } : null;
  const connectionSource = connection ? graph.nodes.find((node) => node.id === connection.nodeId) : undefined;
  const connectionTarget = connection?.targetId ? graph.nodes.find((node) => node.id === connection.targetId) : undefined;
  const detailNode = detailId ? graph.nodes.find((node) => node.id === detailId) : undefined;
  const canvasStyle = {
    "--canvas-x": `${viewport.x}px`,
    "--canvas-y": `${viewport.y}px`,
    "--canvas-grid-size": `${DOT_SPACING * viewport.scale}px`,
  } as CSSProperties;
  const worldStyle = { transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` };

  return (
    <main
      ref={mainRef}
      aria-label="LingkeAI 工作流画布"
      className="infinite-canvas workflow-canvas"
      style={canvasStyle}
      onDoubleClick={handleCanvasDoubleClick}
      onPointerDown={beginCanvasPointer}
      onPointerMove={moveCanvasPointer}
      onPointerUp={finishCanvasPointer}
      onPointerCancel={finishCanvasPointer}
    >
      <div className="canvas-world" style={worldStyle}>
        <svg className="canvas-edges" aria-hidden="true">
          {graph.edges.map((edge) => {
            const source = graph.nodes.find((node) => node.id === edge.sourceId);
            const target = graph.nodes.find((node) => node.id === edge.targetId);
            return source && target ? <path key={edge.id} d={workflowEdgePath(source, target)} /> : null;
          })}
          {connection?.moved && connectionSource ? (
            <path
              className="canvas-edge-draft"
              d={connectionTarget
                ? workflowEdgePath(connectionSource, connectionTarget)
                : workflowDraftPath(connectionSource, connection.point)}
            />
          ) : null}
        </svg>

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
              dragRef.current = { pointerId: event.pointerId, nodeIds: selectedIds, clientX: event.clientX, clientY: event.clientY };
            }}
            onPointerMove={dragNodes}
            onPointerUp={finishNodeDrag}
            onPointerCancel={finishNodeDrag}
          />
        ) : null}

        {graph.nodes.map((node) => (
          <WorkflowNodeCard
            key={node.id}
            node={node}
            assetUrl={node.type === "source" && node.assetId ? assetUrls[node.assetId] : undefined}
            assetError={node.type === "source" && node.assetId ? assetErrors[node.assetId] : assetErrors[node.id]}
            connectionTarget={connection?.targetId === node.id}
            running={node.type === "scheduler" && runningSchedulers.has(node.id)}
            onDelete={() => deleteNode(node)}
            onOpen={() => setDetailId(node.id)}
            onChange={(update) => setGraph((current) => updateWorkflowNode(current, node.id, update))}
            onUpload={(file) => node.type === "source" && void uploadSource(node, file)}
            onKindChange={(kind) => node.type === "scheduler" && updateSchedulerKind(node, kind)}
            onModelChange={(model) => node.type === "scheduler" && updateSchedulerModel(node, model)}
            onRun={() => node.type === "scheduler" && void runScheduler(node)}
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
          assetUrl={detailNode.type === "source" && detailNode.assetId ? assetUrls[detailNode.assetId] : undefined}
          onClose={() => setDetailId(null)}
        />
      ) : null}
    </main>
  );
}

function WorkflowNodeCard({
  node,
  assetUrl,
  assetError,
  connectionTarget,
  running,
  onDelete,
  onOpen,
  onChange,
  onUpload,
  onKindChange,
  onModelChange,
  onRun,
  onResume,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  node: WorkflowNode;
  assetUrl?: string;
  assetError?: string;
  connectionTarget: boolean;
  running: boolean;
  onDelete: () => void;
  onOpen: () => void;
  onChange: (update: Partial<WorkflowNode>) => void;
  onUpload: (file?: File) => void;
  onKindChange: (kind: ComposerMode) => void;
  onModelChange: (model: string) => void;
  onRun: () => void;
  onResume: () => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  const size = getWorkflowNodeSize(node);
  const kind = node.type === "scheduler" ? node.outputKind : node.kind;
  const Icon = kind === "image" ? ImageIcon : kind === "video" ? Video : FileText;
  const title = node.type === "scheduler"
    ? "通用调度"
    : node.type === "result"
      ? `结果 · ${kind === "text" ? "文本" : kind === "image" ? "图片" : "视频"}`
      : `${kind === "text" ? "文本" : kind === "image" ? "图片" : "视频"}素材`;

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
        <span className="canvas-node-kind"><Icon size={15} />{title}</span>
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
        <div className="workflow-source-body">
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
                  <img src={assetUrl} alt={node.assetName || "上传图片"} />
                ) : (
                  // User-uploaded videos do not include a separate captions track.
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video src={assetUrl} controls preload="metadata" />
                )
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
          running={running}
          onChange={onChange}
          onKindChange={onKindChange}
          onModelChange={onModelChange}
          onRun={onRun}
        />
      ) : (
        <ResultBody node={node} onResume={onResume} />
      )}
    </div>
  );
}

function SchedulerControls({ node, running, onChange, onKindChange, onModelChange, onRun }: {
  node: WorkflowSchedulerNode;
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
      <div className="workflow-field-row">
        <label>输出类型<select value={node.outputKind} onChange={(event) => onKindChange(event.target.value as ComposerMode)}>
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
        <label>数量<select value={node.outputCount} onChange={(event) => onChange({ outputCount: Number(event.target.value) })}>{[1, 2, 3, 4].map((value) => <option key={value}>{value}</option>)}</select></label>
      </div> : null}
      {node.error ? <p className="workflow-scheduler-error">{node.error}</p> : null}
      <button className="workflow-run" disabled={running} type="button" onClick={onRun}>
        {running ? <LoaderCircle className="animate-spin" size={15} /> : <Play size={15} fill="currentColor" />}
        {running ? "正在提交" : `运行 ${taskCount} 个任务`}
      </button>
    </div>
  );
}

function ResultBody({ node, onResume }: { node: WorkflowResultNode; onResume: () => void }) {
  if (node.status === "failed") return <p className="canvas-node-error">{node.error || "任务失败"}</p>;
  if (node.kind === "text" && node.status === "success") return <p className="canvas-node-text">{node.text}</p>;
  if (node.kind === "image" && node.resultUrl) return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="workflow-result-media" src={node.resultUrl} alt="工作流生成图片" />
  );
  if (node.kind === "video" && node.resultUrl) return (
    // Generated videos do not include a separate captions track.
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video className="workflow-result-media" src={node.resultUrl} controls preload="metadata" />
  );
  if (node.status === "paused") return <div className="canvas-node-loading"><span>{node.progress}</span><button className="workflow-resume" type="button" data-workflow-control onClick={onResume}><RotateCcw size={13} />继续查询</button></div>;
  return <div className="canvas-node-loading"><LoaderCircle className="animate-spin" size={20} /><span>{node.progress || "处理中"}</span></div>;
}

function WorkflowNodeOverlay({ node, onConnectDown, onConnectMove, onConnectUp, onResizeDown, onResizeMove, onResizeUp }: {
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
    </div> : <div className="workflow-input-port" aria-hidden="true" style={{ transform: `translate(${node.x - 6}px, ${node.y + size.height / 2 - 6}px)` }} />}
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
}

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
  const url = node.type === "result" ? node.resultUrl : assetUrl;
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
