"use client";

import {
  Bot,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Video,
  X,
} from "lucide-react";
import type { CSSProperties, PointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentDangerousOperation,
  AgentInspectedImage,
  AgentOperation,
} from "@/app/ai/agent";
import {
  ALL_MODELS,
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
  applyAgentOperations,
  createAgentCanvasSnapshot,
} from "@/app/canvas/agent";
import {
  applyTaskStatus,
  autoPollDeadline,
  buildManualNodeContext,
  connectNodes,
  createConnectedNode,
  createGenerationNodes,
  draftEdgePath,
  edgePath,
  emptyGraph,
  fitMediaNode,
  getNodeSize,
  GRAPH_STORAGE_KEY,
  moveNodes,
  nodesIntersectingBounds,
  parsePersistedGraph,
  removeNode,
  resizeNode,
  resizedNodeBounds,
  screenToWorld,
  selectedNodesBounds,
  updateOutputNode,
  type CanvasGraph,
  type CanvasNode,
  type ConnectionSide,
  type ResizeCorner,
} from "@/app/canvas/graph";
import { AIChatInput, type ComposerSubmission } from "@/components/ui/ai-chat-input";
import { CanvasAgentSidebar } from "@/components/canvas-agent-sidebar";
import {
  panViewport,
  wheelZoomFactor,
  zoomViewport,
  type Viewport,
} from "./canvas/viewport";

const DOT_SPACING = 24;
const MAX_REFERENCE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_REFERENCE_TOTAL_BYTES = 30 * 1024 * 1024;

type MarqueeDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
};

type NodeDragState = {
  pointerId: number;
  nodeIds: string[];
  clientX: number;
  clientY: number;
};

type NodeResizeState = {
  pointerId: number;
  nodeId: string;
  corner: ResizeCorner;
  startNode: CanvasNode;
};

type ConnectionDragState = {
  pointerId: number;
  nodeId: string;
  side: ConnectionSide;
  startClientX: number;
  startClientY: number;
  point: { x: number; y: number };
  moved: boolean;
  targetId?: string;
};

type AddNodeMenuState = {
  nodeId: string;
  side: ConnectionSide;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取参考图失败。"));
    reader.readAsDataURL(file);
  });
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string") return payload.error;
  } catch {
    // Fall through to the sanitized local message.
  }
  return "生成请求失败，请稍后重试。";
}

async function imageNodeToFile(node: CanvasNode): Promise<File> {
  let blob: Blob | null = null;
  if (node.assetId) blob = await readAsset(node.assetId);
  if (!blob && node.resultUrl) {
    let response: Response;
    try {
      response = await fetch(node.resultUrl);
    } catch {
      throw new Error("无法读取上游生成图片，请将图片重新上传后再试。");
    }
    if (!response.ok) {
      throw new Error("无法读取上游生成图片，请将图片重新上传后再试。");
    }
    blob = await response.blob();
  }
  if (!blob) throw new Error("上游图片素材已丢失，请重新上传。");
  const type = blob.type || node.assetMimeType || "image/png";
  if (!type.startsWith("image/")) {
    throw new Error("上游节点不是可用的图片素材。");
  }
  return new File([blob], node.assetName || `upstream-${node.id}`, { type });
}

export default function Home() {
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [graph, setGraph] = useState<CanvasGraph>(emptyGraph);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [assetLoadErrors, setAssetLoadErrors] = useState<Record<string, string>>({});
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [agentContextNodeId, setAgentContextNodeId] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [selectedManualNodeId, setSelectedManualNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectionMarquee, setSelectionMarquee] = useState<MarqueeDragState | null>(null);
  const [revealedNodeId, setRevealedNodeId] = useState<string | null>(null);
  const [addNodeMenu, setAddNodeMenu] = useState<AddNodeMenuState | null>(null);
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDragState | null>(null);
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);
  const [detailTextDraft, setDetailTextDraft] = useState("");
  const marqueeDrag = useRef<MarqueeDragState | null>(null);
  const nodeDrag = useRef<NodeDragState | null>(null);
  const nodeResize = useRef<NodeResizeState | null>(null);
  const connectionDrag = useRef<ConnectionDragState | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const pollingTasks = useRef(new Set<string>());
  const loadedAssets = useRef(new Set<string>());
  const recoveringAssets = useRef(new Set<string>());
  const assetRecoveryAttempts = useRef(new Set<string>());
  const assetUrlsRef = useRef<Record<string, string>>({});

  const restoreAssetUrl = useCallback(async (assetId: string) => {
    if (recoveringAssets.current.has(assetId)) return;
    recoveringAssets.current.add(assetId);
    try {
      const blob = await readAsset(assetId);
      if (!blob) throw new Error("图片素材已失效，请重新上传。");
      const nextUrl = URL.createObjectURL(blob);
      setAssetUrls((current) => {
        const previousUrl = current[assetId];
        if (previousUrl && previousUrl !== nextUrl) {
          URL.revokeObjectURL(previousUrl);
        }
        return { ...current, [assetId]: nextUrl };
      });
      setAssetLoadErrors((current) => {
        if (!current[assetId]) return current;
        const next = { ...current };
        delete next[assetId];
        return next;
      });
      loadedAssets.current.add(assetId);
    } catch {
      setAssetLoadErrors((current) => ({
        ...current,
        [assetId]: "图片素材已失效，请重新上传。",
      }));
    } finally {
      recoveringAssets.current.delete(assetId);
    }
  }, []);

  function handleAssetError(assetId: string) {
    if (assetRecoveryAttempts.current.has(assetId)) {
      setAssetLoadErrors((current) => ({
        ...current,
        [assetId]: "图片素材已失效，请重新上传。",
      }));
      return;
    }
    assetRecoveryAttempts.current.add(assetId);
    void restoreAssetUrl(assetId);
  }

  function handleAssetLoad(assetId: string) {
    assetRecoveryAttempts.current.delete(assetId);
  }

  useEffect(() => {
    setGraph(parsePersistedGraph(window.localStorage.getItem(GRAPH_STORAGE_KEY)));
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    assetUrlsRef.current = assetUrls;
  }, [assetUrls]);

  useEffect(() => {
    const loadedAssetIds = loadedAssets.current;
    const recoveringAssetIds = recoveringAssets.current;
    const recoveryAttempts = assetRecoveryAttempts.current;
    return () => {
      Object.values(assetUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      assetUrlsRef.current = {};
      loadedAssetIds.clear();
      recoveringAssetIds.clear();
      recoveryAttempts.clear();
    };
  }, []);

  useEffect(() => {
    const canvas = mainRef.current;
    if (!canvas) return;

    function handleCanvasWheel(event: globalThis.WheelEvent) {
      const target = event.target as HTMLElement;
      if (
        target !== canvas &&
        !target.closest("[data-node-id], .canvas-selection-frame")
      ) {
        return;
      }
      event.preventDefault();
      const bounds = canvas!.getBoundingClientRect();
      const normalizeDelta = (delta: number, pageSize: number) =>
        event.deltaMode === globalThis.WheelEvent.DOM_DELTA_LINE
          ? delta * 16
          : event.deltaMode === globalThis.WheelEvent.DOM_DELTA_PAGE
            ? delta * pageSize
            : delta;
      const deltaX = normalizeDelta(event.deltaX, bounds.width);
      const deltaY =
        normalizeDelta(event.deltaY, bounds.height);
      if (!event.ctrlKey) {
        setViewport((current) => panViewport(current, -deltaX, -deltaY));
        return;
      }
      const anchor = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      const zoomFactor = wheelZoomFactor(deltaY, true);
      setViewport((current) =>
        zoomViewport(current, anchor, current.scale * zoomFactor),
      );
    }

    canvas.addEventListener("wheel", handleCanvasWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleCanvasWheel);
  }, []);

  useEffect(() => {
    const canvas = mainRef.current;
    if (!canvas) return;
    const updateSize = () => {
      const bounds = canvas.getBoundingClientRect();
      setCanvasSize({ width: bounds.width, height: bounds.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (detailNodeId) {
        setDetailNodeId(null);
        setDetailTextDraft("");
        return;
      }
      if (isAgentOpen) {
        setIsAgentOpen(false);
        setAgentContextNodeId(null);
        return;
      }
      connectionDrag.current = null;
      setConnectionDraft(null);
      setAddNodeMenu(null);
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [detailNodeId, isAgentOpen]);

  useEffect(() => {
    if (!isHydrated) return;
    window.localStorage.setItem(GRAPH_STORAGE_KEY, JSON.stringify(graph));
  }, [graph, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    const assetIds = graph.nodes
      .map((node) => node.assetId)
      .filter((id): id is string => Boolean(id));
    for (const assetId of assetIds) {
      if (loadedAssets.current.has(assetId)) continue;
      loadedAssets.current.add(assetId);
      void restoreAssetUrl(assetId);
    }
  }, [graph.nodes, isHydrated, restoreAssetUrl]);

  const pollTask = useCallback(async (node: CanvasNode) => {
    if (!node.taskId || pollingTasks.current.has(node.taskId)) return;
    if (Date.now() > autoPollDeadline(node)) {
      setGraph((current) =>
        updateOutputNode(current, node.id, {
          status: "paused",
          progress: "已暂停自动查询",
        }),
      );
      return;
    }

    pollingTasks.current.add(node.taskId);
    try {
      const response = await fetch(
        `/api/ai/status?taskId=${encodeURIComponent(node.taskId)}&mode=${node.kind}`,
      );
      if (!response.ok) throw new Error(await readApiError(response));
      const status = (await response.json()) as TaskStatusResponse;
      setGraph((current) => applyTaskStatus(current, node.id, status));
    } catch (error) {
      setGraph((current) =>
        updateOutputNode(current, node.id, {
          progress:
            error instanceof Error ? error.message : "任务查询失败，稍后重试",
        }),
      );
    } finally {
      pollingTasks.current.delete(node.taskId);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    const timer = window.setInterval(() => {
      graph.nodes
        .filter(
          (node) =>
            (node.role === "output" || node.manual) &&
            Boolean(node.taskId) &&
            (node.status === "pending" || node.status === "running"),
        )
        .forEach((node) => void pollTask(node));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [graph.nodes, isHydrated, pollTask]);

  function handleCanvasPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (isAgentOpen) {
      setAgentContextNodeId(null);
    } else {
      setSelectedManualNodeId(null);
    }
    setSelectedNodeIds([]);
    setRevealedNodeId(null);
    setAddNodeMenu(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    const drag = {
      pointerId: event.pointerId,
      startX: event.clientX - bounds.left,
      startY: event.clientY - bounds.top,
      currentX: event.clientX - bounds.left,
      currentY: event.clientY - bounds.top,
      moved: false,
    };
    marqueeDrag.current = drag;
    setSelectionMarquee(null);
  }

  function handleCanvasPointerMove(event: PointerEvent<HTMLElement>) {
    const current = marqueeDrag.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const currentX = event.clientX - bounds.left;
    const currentY = event.clientY - bounds.top;
    const moved =
      current.moved ||
      Math.hypot(currentX - current.startX, currentY - current.startY) >= 6;
    const next = { ...current, currentX, currentY, moved };
    marqueeDrag.current = next;
    setSelectionMarquee(moved ? next : null);
  }

  function finishCanvasSelection(event: PointerEvent<HTMLElement>) {
    const current = marqueeDrag.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    if (current.moved) {
      const topLeft = screenToWorld(viewport, {
        x: Math.min(current.startX, current.currentX),
        y: Math.min(current.startY, current.currentY),
      });
      const bottomRight = screenToWorld(viewport, {
        x: Math.max(current.startX, current.currentX),
        y: Math.max(current.startY, current.currentY),
      });
      setSelectedNodeIds(
        nodesIntersectingBounds(graph, {
          x: topLeft.x,
          y: topLeft.y,
          width: bottomRight.x - topLeft.x,
          height: bottomRight.y - topLeft.y,
        }),
      );
    }
    marqueeDrag.current = null;
    setSelectionMarquee(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function cancelCanvasSelection(event: PointerEvent<HTMLElement>) {
    if (marqueeDrag.current?.pointerId !== event.pointerId) return;
    marqueeDrag.current = null;
    setSelectionMarquee(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function beginNodeDrag(event: PointerEvent<HTMLDivElement>, node: CanvasNode) {
    if (event.button !== 0) return;
    event.stopPropagation();
    setRevealedNodeId(node.id);
    const nodeIds = selectedNodeIds.includes(node.id)
      ? selectedNodeIds
      : [node.id];
    setSelectedNodeIds(nodeIds);
    if (isAgentOpen) {
      setAgentContextNodeId(node.id);
    } else {
      setSelectedManualNodeId(
        nodeIds.length === 1 && node.manual ? node.id : null,
      );
    }
    setAddNodeMenu(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    nodeDrag.current = {
      pointerId: event.pointerId,
      nodeIds,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }

  function beginSelectionDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || selectedNodeIds.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedManualNodeId(null);
    setAddNodeMenu(null);
    nodeDrag.current = {
      pointerId: event.pointerId,
      nodeIds: selectedNodeIds,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }

  function dragNode(event: PointerEvent<HTMLDivElement>) {
    if (!nodeDrag.current || nodeDrag.current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const current = nodeDrag.current;
    const deltaX = (event.clientX - current.clientX) / viewport.scale;
    const deltaY = (event.clientY - current.clientY) / viewport.scale;
    current.clientX = event.clientX;
    current.clientY = event.clientY;
    setGraph((graphValue) =>
      moveNodes(graphValue, current.nodeIds, deltaX, deltaY),
    );
  }

  function finishNodeDrag(event: PointerEvent<HTMLDivElement>) {
    if (!nodeDrag.current || nodeDrag.current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    nodeDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function beginNodeResize(
    event: PointerEvent<HTMLButtonElement>,
    node: CanvasNode,
    corner: ResizeCorner,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setRevealedNodeId(node.id);
    setSelectedNodeIds([node.id]);
    if (isAgentOpen) {
      setAgentContextNodeId(node.id);
    } else {
      setSelectedManualNodeId(node.manual ? node.id : null);
    }
    setAddNodeMenu(null);
    nodeResize.current = {
      pointerId: event.pointerId,
      nodeId: node.id,
      corner,
      startNode: { ...node },
    };
  }

  function resizeNodeFromPointer(event: PointerEvent<HTMLButtonElement>) {
    const current = nodeResize.current;
    if (
      !current ||
      current.pointerId !== event.pointerId ||
      !mainRef.current
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const canvasBounds = mainRef.current.getBoundingClientRect();
    const point = screenToWorld(viewport, {
      x: event.clientX - canvasBounds.left,
      y: event.clientY - canvasBounds.top,
    });
    const nextBounds = resizedNodeBounds(
      current.startNode,
      current.corner,
      point,
    );
    setGraph((value) => resizeNode(value, current.nodeId, nextBounds));
  }

  function finishNodeResize(event: PointerEvent<HTMLButtonElement>) {
    if (
      !nodeResize.current ||
      nodeResize.current.pointerId !== event.pointerId
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    nodeResize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function fitNodeToMedia(
    nodeId: string,
    naturalWidth: number,
    naturalHeight: number,
  ) {
    setGraph((current) =>
      fitMediaNode(current, nodeId, naturalWidth, naturalHeight),
    );
  }

  function beginConnectionDrag(
    event: PointerEvent<HTMLButtonElement>,
    node: CanvasNode,
    side: ConnectionSide,
  ) {
    if (event.button !== 0 || !mainRef.current) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = mainRef.current.getBoundingClientRect();
    const state: ConnectionDragState = {
      pointerId: event.pointerId,
      nodeId: node.id,
      side,
      startClientX: event.clientX,
      startClientY: event.clientY,
      point: screenToWorld(viewport, {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      }),
      moved: false,
    };
    connectionDrag.current = state;
    setConnectionDraft(state);
    setAddNodeMenu(null);
  }

  function moveConnectionDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = connectionDrag.current;
    if (
      !current ||
      current.pointerId !== event.pointerId ||
      !mainRef.current
    ) {
      return;
    }
    event.stopPropagation();
    const bounds = mainRef.current.getBoundingClientRect();
    const moved =
      current.moved ||
      Math.hypot(
        event.clientX - current.startClientX,
        event.clientY - current.startClientY,
      ) >= 6;
    const targetElement = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-node-id]");
    const targetId = targetElement?.dataset.nodeId;
    const sourceId = current.side === "right" ? current.nodeId : targetId;
    const destinationId = current.side === "right" ? targetId : current.nodeId;
    const validTarget =
      targetId &&
      targetId !== current.nodeId &&
      sourceId &&
      destinationId &&
      !graph.edges.some(
        (edge) =>
          edge.sourceId === sourceId && edge.targetId === destinationId,
      )
        ? targetId
        : undefined;
    const next = {
      ...current,
      point: screenToWorld(viewport, {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      }),
      moved,
      targetId: validTarget,
    };
    connectionDrag.current = next;
    setConnectionDraft(next);
  }

  function finishConnectionDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = connectionDrag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (current.moved && current.targetId) {
      const sourceId =
        current.side === "right" ? current.nodeId : current.targetId;
      const targetId =
        current.side === "right" ? current.targetId : current.nodeId;
      setGraph((value) => connectNodes(value, sourceId, targetId));
    } else if (!current.moved) {
      setAddNodeMenu({ nodeId: current.nodeId, side: current.side });
    }
    connectionDrag.current = null;
    setConnectionDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function cancelConnectionDrag(event: PointerEvent<HTMLButtonElement>) {
    if (connectionDrag.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    connectionDrag.current = null;
    setConnectionDraft(null);
  }

  function createNodeFromMenu(kind: "text" | "image" | "video") {
    if (!addNodeMenu) return;
    const created = createConnectedNode(
      graph,
      addNodeMenu.nodeId,
      addNodeMenu.side,
      kind,
    );
    setGraph(created.graph);
    setSelectedNodeIds(created.nodeId ? [created.nodeId] : []);
    setSelectedManualNodeId(created.nodeId);
    setAddNodeMenu(null);
  }

  async function submitManualNode(
    target: CanvasNode,
    submission: ComposerSubmission,
  ) {
    if (submission.mode !== target.kind) {
      throw new Error("当前输入模式与节点类型不一致。");
    }
    setIsSubmitting(true);
    try {
      const context = buildManualNodeContext(
        graph,
        target.id,
        submission.prompt,
      );
      const upstreamFiles = await Promise.all(
        context.imageNodes.map((node) => imageNodeToFile(node)),
      );
      const files = [...upstreamFiles, ...submission.files];
      const modelConfig = ALL_MODELS.find(
        (model) => model.value === submission.model,
      );
      if (!modelConfig || modelConfig.mode !== submission.mode) {
        throw new Error("当前节点模型无效，请重新选择。");
      }
      if (files.length > modelConfig.maxReferenceImages) {
        throw new Error(
          `直接上游与上传图片合计超过当前模型的 ${modelConfig.maxReferenceImages} 张上限。`,
        );
      }
      if (files.some((file) => file.size > MAX_REFERENCE_FILE_BYTES)) {
        throw new Error("单张上游或上传图片不能超过 10MB。");
      }
      if (
        files.reduce((total, file) => total + file.size, 0) >
        MAX_REFERENCE_TOTAL_BYTES
      ) {
        throw new Error("上游与上传图片合计不能超过 30MB。");
      }
      const images = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          mimeType: file.type,
          size: file.size,
          dataUrl: await fileToDataUrl(file),
        } satisfies GenerateReferenceImage)),
      );

      setGraph((current) =>
        updateOutputNode(current, target.id, {
          model: submission.model,
          prompt: submission.prompt,
          text: "",
          status: "pending",
          progress: "等待提交",
          error: "",
          resultUrl: undefined,
          taskId: undefined,
          startedAt: Date.now(),
        }),
      );

      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: submission.mode,
          model: submission.model,
          prompt: context.prompt,
          images,
          aspectRatio: submission.aspectRatio,
          duration: submission.duration,
          resolution: submission.resolution,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const result = (await response.json()) as GenerateResponse;
      if (result.kind === "text") {
        setGraph((current) =>
          updateOutputNode(current, target.id, {
            status: "success",
            progress: "",
            text: result.content,
          }),
        );
      } else {
        setGraph((current) =>
          updateOutputNode(current, target.id, {
            status: "pending",
            progress: "排队中",
            taskId: result.taskId,
            startedAt: Date.now(),
          }),
        );
      }
      setSelectedManualNodeId(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "生成请求失败，请稍后重试。";
      setGraph((current) =>
        updateOutputNode(current, target.id, {
          status: "failed",
          progress: "",
          error: message,
        }),
      );
      throw new Error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitStandaloneGeneration(submission: ComposerSubmission) {
    if (!mainRef.current) return;
    setIsSubmitting(true);
    let outputId = "";
    try {
      const bounds = mainRef.current.getBoundingClientRect();
      const worldCenter = screenToWorld(viewport, {
        x: bounds.width / 2,
        y: Math.max(180, bounds.height / 2 - 80),
      });
      const references = await Promise.all(
        submission.files.map(async (file) => {
          const id = crypto.randomUUID();
          await saveAsset(id, file);
          const localUrl = URL.createObjectURL(file);
          loadedAssets.current.add(id);
          setAssetUrls((current) => ({ ...current, [id]: localUrl }));
          return {
            asset: { id, name: file.name, mimeType: file.type },
            request: {
              name: file.name,
              mimeType: file.type,
              size: file.size,
              dataUrl: await fileToDataUrl(file),
            } satisfies GenerateReferenceImage,
          };
        }),
      );
      const created = createGenerationNodes(
        graph,
        {
          mode: submission.mode,
          model: submission.model,
          prompt: submission.prompt,
          assets: references.map((reference) => reference.asset),
          now: Date.now(),
        },
        worldCenter,
      );
      outputId = created.outputId;
      setGraph(created.graph);

      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: submission.mode,
          model: submission.model,
          prompt: submission.prompt,
          images: references.map((reference) => reference.request),
          aspectRatio: submission.aspectRatio,
          duration: submission.duration,
          resolution: submission.resolution,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const result = (await response.json()) as GenerateResponse;

      if (result.kind === "text") {
        setGraph((current) =>
          updateOutputNode(current, created.outputId, {
            status: "success",
            progress: "",
            text: result.content,
          }),
        );
      } else {
        setGraph((current) =>
          updateOutputNode(current, created.outputId, {
            status: "pending",
            progress: "排队中",
            taskId: result.taskId,
            startedAt: Date.now(),
          }),
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "生成请求失败，请稍后重试。";
      if (outputId) {
        setGraph((current) =>
          updateOutputNode(current, outputId, {
            status: "failed",
            progress: "",
            error: message,
          }),
        );
      }
      throw new Error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitGeneration(submission: ComposerSubmission) {
    if (selectedManualNode) {
      await submitManualNode(selectedManualNode, submission);
      return;
    }
    await submitStandaloneGeneration(submission);
  }

  function openNodeDetails(node: CanvasNode) {
    const mediaUrl =
      node.kind === "image"
        ? node.resultUrl || (node.assetId ? assetUrls[node.assetId] : undefined)
        : node.kind === "video"
          ? node.resultUrl
          : undefined;
    const assetError = node.assetId ? assetLoadErrors[node.assetId] : undefined;
    if (node.kind !== "text" && !mediaUrl && !assetError) return;
    setDetailNodeId(node.id);
    setDetailTextDraft(node.text);
    setAddNodeMenu(null);
  }

  function closeNodeDetails() {
    setDetailNodeId(null);
    setDetailTextDraft("");
  }

  function saveNodeText() {
    if (!detailNodeId) return;
    setGraph((current) =>
      updateOutputNode(current, detailNodeId, { text: detailTextDraft }),
    );
    closeNodeDetails();
  }

  function deleteNode(node: CanvasNode, confirmed = false) {
    if (
      !confirmed &&
      (node.status === "pending" || node.status === "running") &&
      !window.confirm("删除只会停止本地查询，远端任务仍可能继续并产生费用。确定删除吗？")
    ) {
      return;
    }
    if (selectedManualNodeId === node.id) setSelectedManualNodeId(null);
    setSelectedNodeIds((current) => current.filter((id) => id !== node.id));
    if (agentContextNodeId === node.id) setAgentContextNodeId(null);
    if (revealedNodeId === node.id) setRevealedNodeId(null);
    if (addNodeMenu?.nodeId === node.id) setAddNodeMenu(null);
    if (detailNodeId === node.id) closeNodeDetails();
    setGraph((current) => removeNode(current, node.id));
    if (node.assetId) {
      const url = assetUrls[node.assetId];
      if (url) URL.revokeObjectURL(url);
      setAssetUrls((current) => {
        const next = { ...current };
        delete next[node.assetId!];
        return next;
      });
      loadedAssets.current.delete(node.assetId);
      recoveringAssets.current.delete(node.assetId);
      assetRecoveryAttempts.current.delete(node.assetId);
      setAssetLoadErrors((current) => {
        if (!current[node.assetId!]) return current;
        const next = { ...current };
        delete next[node.assetId!];
        return next;
      });
      void deleteAsset(node.assetId);
    }
  }

  function applyCanvasAgentOperations(operations: AgentOperation[]) {
    if (!operations.length) return [];
    const outcome = applyAgentOperations(graph, operations);
    setGraph(outcome.graph);
    return outcome.results.map((result) => result.message);
  }

  async function readAgentImages(nodeIds: string[]): Promise<AgentInspectedImage[]> {
    const uniqueIds = [...new Set(nodeIds)].slice(0, 5);
    return Promise.all(
      uniqueIds.map(async (nodeId) => {
        const node = graph.nodes.find(
          (candidate) => candidate.id === nodeId && candidate.kind === "image",
        );
        if (!node) throw new Error(`未找到可读取的图片节点 ${nodeId}。`);
        const file = await imageNodeToFile(node);
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

  async function confirmAgentOperation(operation: AgentDangerousOperation) {
    if (operation.type === "delete_node") {
      const node = graph.nodes.find((candidate) => candidate.id === operation.nodeId);
      if (!node) throw new Error("节点已不存在，未执行删除。");
      deleteNode(node, true);
      return node.status === "pending" || node.status === "running"
        ? "已删除本地节点并停止查询；远端任务可能仍继续产生费用。"
        : "已删除节点及其连线。";
    }

    const model = getModelConfig(operation.mode, operation.model);
    if (!model) throw new Error("生成模型与模式不匹配，请重新提出生成要求。");
    const referenceNodeIds = [...new Set(operation.referenceNodeIds)];
    const references = referenceNodeIds
      .map((nodeId) => graph.nodes.find((node) => node.id === nodeId))
      .filter((node): node is CanvasNode => Boolean(node));
    if (references.length !== referenceNodeIds.length) {
      throw new Error("部分参考节点已不存在，请重新提出生成要求。");
    }
    const context = references
      .map((node) => {
        if (node.kind === "text") return node.text || node.prompt || "";
        if (node.kind === "video") return node.prompt || "";
        return "";
      })
      .filter(Boolean);
    const files = await Promise.all(
      references
        .filter((node) => node.kind === "image")
        .map((node) => imageNodeToFile(node)),
    );
    if (files.length > model.maxReferenceImages) {
      throw new Error(`当前模型最多支持 ${model.maxReferenceImages} 张参考图。`);
    }
    if (files.some((file) => file.size > MAX_REFERENCE_FILE_BYTES)) {
      throw new Error("单张参考图不能超过 10MB。");
    }
    if (files.reduce((total, file) => total + file.size, 0) > MAX_REFERENCE_TOTAL_BYTES) {
      throw new Error("参考图合计不能超过 30MB。");
    }
    const aspectRatio = operation.aspectRatio || model.aspectRatios[0];
    const duration = operation.duration || model.durations[0];
    const resolution = operation.resolution || model.defaultResolution;
    if (model.aspectRatios.length && !model.aspectRatios.includes(aspectRatio)) {
      throw new Error("Agent 选择了当前模型不支持的画面比例。");
    }
    if (model.durations.length && !model.durations.includes(duration)) {
      throw new Error("Agent 选择了当前模型不支持的视频时长。");
    }
    if (model.resolutions.length && !model.resolutions.includes(resolution)) {
      throw new Error("Agent 选择了当前模型不支持的分辨率。");
    }
    await submitStandaloneGeneration({
      mode: operation.mode,
      model: operation.model,
      prompt: [...context, operation.prompt].join("\n\n"),
      files,
      aspectRatio,
      duration,
      resolution,
    });
    return `已提交${
      operation.mode === "text" ? "文本" : operation.mode === "image" ? "图片" : "视频"
    }生成，结果会写入画布节点。`;
  }

  const selectedManualNode = selectedManualNodeId
    ? graph.nodes.find(
        (node) => node.id === selectedManualNodeId && node.manual,
      )
    : undefined;
  const detailNode = detailNodeId
    ? graph.nodes.find((node) => node.id === detailNodeId)
    : undefined;
  const detailAssetUrl = detailNode?.assetId
    ? assetUrls[detailNode.assetId]
    : undefined;
  const draftSourceNode = connectionDraft
    ? graph.nodes.find((node) => node.id === connectionDraft.nodeId)
    : undefined;
  const draftTargetNode = connectionDraft?.targetId
    ? graph.nodes.find((node) => node.id === connectionDraft.targetId)
    : undefined;
  const addNodeMenuAnchor = addNodeMenu
    ? graph.nodes.find((node) => node.id === addNodeMenu.nodeId)
    : undefined;
  const addNodeMenuAnchorSize = addNodeMenuAnchor
    ? getNodeSize(addNodeMenuAnchor)
    : undefined;
  const validSelectedNodeIds = selectedNodeIds.filter((id) =>
    graph.nodes.some((node) => node.id === id),
  );
  const selectionBounds =
    validSelectedNodeIds.length > 1
      ? selectedNodesBounds(graph, validSelectedNodeIds)
      : null;
  const selectionFrameBounds = selectionBounds
    ? {
        x: selectionBounds.x - 8 / viewport.scale,
        y: selectionBounds.y - 8 / viewport.scale,
        width: selectionBounds.width + 16 / viewport.scale,
        height: selectionBounds.height + 16 / viewport.scale,
      }
    : null;
  const marqueeBounds = selectionMarquee
    ? {
        x: Math.min(selectionMarquee.startX, selectionMarquee.currentX),
        y: Math.min(selectionMarquee.startY, selectionMarquee.currentY),
        width: Math.abs(selectionMarquee.currentX - selectionMarquee.startX),
        height: Math.abs(selectionMarquee.currentY - selectionMarquee.startY),
      }
    : null;
  const agentSnapshot = createAgentCanvasSnapshot(graph, viewport, canvasSize);

  const canvasStyle = {
    "--canvas-x": `${viewport.x}px`,
    "--canvas-y": `${viewport.y}px`,
    "--canvas-grid-size": `${DOT_SPACING * viewport.scale}px`,
  } as CSSProperties;

  const worldStyle = {
    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
  };

  return (
    <main
      ref={mainRef}
      aria-label="LingkeAI 无限画布"
      className="infinite-canvas"
      style={canvasStyle}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={finishCanvasSelection}
      onPointerCancel={cancelCanvasSelection}
      onLostPointerCapture={cancelCanvasSelection}
    >
      <div className="canvas-world" style={worldStyle}>
        <svg className="canvas-edges" aria-hidden="true">
          {graph.edges.map((edge) => {
            const source = graph.nodes.find((node) => node.id === edge.sourceId);
            const target = graph.nodes.find((node) => node.id === edge.targetId);
            if (!source || !target) return null;
            return <path key={edge.id} d={edgePath(source, target)} />;
          })}
          {connectionDraft && draftSourceNode ? (
            <path
              className="canvas-edge-draft"
              d={
                draftTargetNode
                  ? connectionDraft.side === "right"
                    ? edgePath(draftSourceNode, draftTargetNode)
                    : edgePath(draftTargetNode, draftSourceNode)
                  : draftEdgePath(
                      draftSourceNode,
                      connectionDraft.side,
                      connectionDraft.point,
                    )
              }
            />
          ) : null}
        </svg>

        {selectionFrameBounds ? (
          <div
            aria-label="移动已选节点"
            className="canvas-selection-frame"
            style={{
              width: selectionFrameBounds.width,
              height: selectionFrameBounds.height,
              borderWidth: 1 / viewport.scale,
              transform: `translate(${selectionFrameBounds.x}px, ${selectionFrameBounds.y}px)`,
            }}
            onPointerDown={beginSelectionDrag}
            onPointerMove={dragNode}
            onPointerUp={finishNodeDrag}
            onPointerCancel={finishNodeDrag}
          />
        ) : null}

        {graph.nodes.map((node) => (
          <CanvasNodeCard
            key={node.id}
            node={node}
            assetUrl={node.assetId ? assetUrls[node.assetId] : undefined}
            assetError={node.assetId ? assetLoadErrors[node.assetId] : undefined}
            connectionTarget={connectionDraft?.targetId === node.id}
            onDelete={() => deleteNode(node)}
            onOpen={() => openNodeDetails(node)}
            onAssetError={
              node.assetId ? () => handleAssetError(node.assetId!) : undefined
            }
            onAssetLoad={
              node.assetId ? () => handleAssetLoad(node.assetId!) : undefined
            }
            onMediaLoad={(width, height) =>
              fitNodeToMedia(node.id, width, height)
            }
            onPointerDown={(event) => beginNodeDrag(event, node)}
            onPointerMove={dragNode}
            onPointerUp={finishNodeDrag}
            onPointerCancel={finishNodeDrag}
            onPointerEnter={() => setRevealedNodeId(node.id)}
            onPointerLeave={() => {
              if (connectionDrag.current?.nodeId !== node.id) {
                setRevealedNodeId(null);
              }
            }}
            onResume={() => {
              setGraph((current) =>
                updateOutputNode(current, node.id, {
                  status: "pending",
                  progress: "准备继续查询",
                  startedAt: Date.now(),
                }),
              );
              void pollTask({ ...node, status: "pending", startedAt: Date.now() });
            }}
          />
        ))}

        {graph.nodes.map((node) => (
          <CanvasNodeHandles
            key={`handles-${node.id}`}
            node={node}
            visible={revealedNodeId === node.id}
            connectionActive={connectionDraft?.nodeId === node.id}
            onPointerEnter={() => setRevealedNodeId(node.id)}
            onPointerLeave={() => {
              if (connectionDrag.current?.nodeId !== node.id) {
                setRevealedNodeId(null);
              }
            }}
            onConnectionPointerDown={(event, side) =>
              beginConnectionDrag(event, node, side)
            }
            onConnectionPointerMove={moveConnectionDrag}
            onConnectionPointerUp={finishConnectionDrag}
            onConnectionPointerCancel={cancelConnectionDrag}
          />
        ))}

        {graph.nodes.map((node) => (
          <CanvasNodeResizeHandles
            key={`resize-${node.id}`}
            node={node}
            onResizePointerDown={(event, corner) =>
              beginNodeResize(event, node, corner)
            }
            onResizePointerMove={resizeNodeFromPointer}
            onResizePointerUp={finishNodeResize}
            onResizePointerCancel={finishNodeResize}
          />
        ))}

        {addNodeMenu && addNodeMenuAnchor && addNodeMenuAnchorSize ? (
          <CanvasNodeAddMenu
            side={addNodeMenu.side}
            x={
              addNodeMenu.side === "left"
                ? addNodeMenuAnchor.x - 132 - 52
                : addNodeMenuAnchor.x + addNodeMenuAnchorSize.width + 52
            }
            y={
              addNodeMenuAnchor.y + addNodeMenuAnchorSize.height / 2 - 60
            }
            onCreate={createNodeFromMenu}
          />
        ) : null}
      </div>

      {marqueeBounds ? (
        <div
          aria-hidden="true"
          className="canvas-selection-marquee"
          style={{
            width: marqueeBounds.width,
            height: marqueeBounds.height,
            transform: `translate(${marqueeBounds.x}px, ${marqueeBounds.y}px)`,
          }}
        />
      ) : null}

      {graph.nodes.length === 0 && isHydrated ? (
        <div className="canvas-empty-state" aria-hidden="true">
          <SparkleMark />
          <p>在下方输入内容，生成流程会自动出现在画布上</p>
        </div>
      ) : null}

      {detailNode ? (
        <NodeDetailDialog
          node={detailNode}
          assetUrl={detailAssetUrl}
          assetError={
            detailNode.assetId ? assetLoadErrors[detailNode.assetId] : undefined
          }
          textDraft={detailTextDraft}
          onAssetError={
            detailNode.assetId
              ? () => handleAssetError(detailNode.assetId!)
              : undefined
          }
          onAssetLoad={
            detailNode.assetId
              ? () => handleAssetLoad(detailNode.assetId!)
              : undefined
          }
          onTextChange={setDetailTextDraft}
          onSave={saveNodeText}
          onClose={closeNodeDetails}
        />
      ) : null}

      {!isAgentOpen ? (
        <button
          aria-label="打开画布 Agent"
          className="fixed top-4 right-4 z-40 inline-flex h-10 items-center gap-2 rounded-full border border-black/8 bg-white px-4 text-xs font-semibold text-zinc-700 shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setIsAgentOpen(true)}
        >
          <Bot aria-hidden="true" size={16} />
          画布 Agent
        </button>
      ) : null}

      <CanvasAgentSidebar
        open={isAgentOpen}
        snapshot={agentSnapshot}
        focusedNodeId={agentContextNodeId ?? undefined}
        onClose={() => {
          setIsAgentOpen(false);
          setAgentContextNodeId(null);
        }}
        onClearFocus={() => setAgentContextNodeId(null)}
        onApplyOperations={applyCanvasAgentOperations}
        onConfirmOperation={confirmAgentOperation}
        onReadImages={readAgentImages}
      />

      <AIChatInput
        key={selectedManualNode?.id ?? "standalone-composer"}
        lockedMode={selectedManualNode?.kind}
        onSubmit={submitGeneration}
        isSubmitting={isSubmitting}
        hidden={isAgentOpen}
      />
    </main>
  );
}

function CanvasNodeCard({
  node,
  assetUrl,
  assetError,
  connectionTarget,
  onDelete,
  onOpen,
  onAssetError,
  onAssetLoad,
  onMediaLoad,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerEnter,
  onPointerLeave,
  onResume,
}: {
  node: CanvasNode;
  assetUrl?: string;
  assetError?: string;
  connectionTarget: boolean;
  onDelete: () => void;
  onOpen: () => void;
  onAssetError?: () => void;
  onAssetLoad?: () => void;
  onMediaLoad: (width: number, height: number) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onResume: () => void;
}) {
  const modelLabel = ALL_MODELS.find((model) => model.value === node.model)?.label;
  const Icon = node.kind === "image" ? ImageIcon : node.kind === "video" ? Video : FileText;
  const pending = node.status === "pending" || node.status === "running";
  const nodeSize = getNodeSize(node);
  const imageUrl = node.kind === "image" ? node.resultUrl || assetUrl : undefined;
  const hasImageDisplay = Boolean(imageUrl || assetError);
  const deleteButton = (
    <button
      aria-label="删除节点"
      className={`canvas-node-delete${hasImageDisplay ? " canvas-node-image-delete" : ""}`}
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onDelete();
      }}
    >
      <Trash2 aria-hidden="true" size={14} />
    </button>
  );

  return (
    <div
      className={`canvas-node canvas-node-${node.kind}${hasImageDisplay ? " canvas-node-image-only" : ""}${connectionTarget ? " canvas-node-connection-target" : ""}`}
      style={{
        width: nodeSize.width,
        height: nodeSize.height,
        transform: `translate(${node.x}px, ${node.y}px)`,
      }}
      data-node-kind={node.kind}
      data-node-role={node.role}
      data-node-id={node.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
    >
      {hasImageDisplay ? (
        <>
          {assetError ? (
            <div className="canvas-node-image-error">{assetError}</div>
          ) : imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="canvas-node-image-content"
              src={imageUrl}
              alt={node.assetName || "生成图片"}
              draggable={false}
              onError={onAssetError}
              onLoad={(event) => {
                onAssetLoad?.();
                onMediaLoad(
                  event.currentTarget.naturalWidth,
                  event.currentTarget.naturalHeight,
                );
              }}
            />
          ) : null}
          {deleteButton}
        </>
      ) : (
        <>
          <header className="canvas-node-header">
            <span className="canvas-node-kind">
              <Icon aria-hidden="true" size={15} />
              {node.role === "input" ? "输入" : "输出"} · {node.kind === "text" ? "文本" : node.kind === "image" ? "图片" : "视频"}
            </span>
            {deleteButton}
          </header>

          <div className="canvas-node-body">
            {node.kind === "text" ? (
              node.text || node.error || node.progress ? (
                <p className="canvas-node-text">
                  {node.text || node.error || node.progress}
                </p>
              ) : (
                <EmptyNodeStatus kind={node.kind} />
              )
            ) : node.kind === "image" ? (
              <NodeStatus node={node} />
            ) : node.resultUrl ? (
              // Generated videos do not provide a captions track in the provider response.
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                src={node.resultUrl}
                controls
                preload="metadata"
                onLoadedMetadata={(event) =>
                  onMediaLoad(
                    event.currentTarget.videoWidth,
                    event.currentTarget.videoHeight,
                  )
                }
                onPointerDown={(event) => event.stopPropagation()}
              />
            ) : (
              <NodeStatus node={node} />
            )}
          </div>

          <footer className="canvas-node-footer">
            <span title={node.assetName || modelLabel}>
              {node.role === "input" && node.assetName
                ? node.assetName
                : modelLabel || "本地输入"}
            </span>
            {node.status === "paused" ? (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onResume();
                }}
              >
                <RotateCcw aria-hidden="true" size={12} />
                继续查询
              </button>
            ) : (
              <span className={`node-status node-status-${node.status}`}>
                {pending ? node.progress || "处理中" : node.status === "failed" ? "失败" : node.status === "success" ? "完成" : "就绪"}
              </span>
            )}
          </footer>
        </>
      )}

    </div>
  );
}

function NodeDetailDialog({
  node,
  assetUrl,
  assetError,
  textDraft,
  onTextChange,
  onAssetError,
  onAssetLoad,
  onSave,
  onClose,
}: {
  node: CanvasNode;
  assetUrl?: string;
  assetError?: string;
  textDraft: string;
  onTextChange: (value: string) => void;
  onAssetError?: () => void;
  onAssetLoad?: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageUrl = node.kind === "image" ? node.resultUrl || assetUrl : undefined;
  const title =
    node.kind === "text"
      ? "编辑文本节点"
      : node.kind === "image"
        ? "查看图片节点"
        : "查看视频节点";

  useEffect(() => {
    if (node.kind === "text") textareaRef.current?.focus();
  }, [node.id, node.kind]);

  return (
    <div className="canvas-node-detail-backdrop">
      <button
        aria-label="关闭节点详情"
        className="canvas-node-detail-dismiss"
        type="button"
        onClick={onClose}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      />
      <section
        aria-label={title}
        aria-modal="true"
        className={`canvas-node-detail canvas-node-detail-${node.kind}`}
        role="dialog"
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <header className="canvas-node-detail-header">
          <h2>{title}</h2>
          <button aria-label="关闭节点详情" type="button" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        {node.kind === "text" ? (
          <textarea
            ref={textareaRef}
            aria-label="节点文本内容"
            className="canvas-node-detail-textarea"
            value={textDraft}
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                onSave();
              }
            }}
          />
        ) : node.kind === "image" && assetError ? (
          <div className="canvas-node-detail-media-error">{assetError}</div>
        ) : node.kind === "image" && imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="canvas-node-detail-media"
            src={imageUrl}
            alt={node.assetName || "节点图片预览"}
            onError={onAssetError}
            onLoad={onAssetLoad}
          />
        ) : node.kind === "video" && node.resultUrl ? (
          // Generated videos do not provide a captions track in the provider response.
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            className="canvas-node-detail-media"
            src={node.resultUrl}
            controls
            preload="metadata"
          />
        ) : null}

        {node.kind === "text" ? (
          <footer className="canvas-node-detail-actions">
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button className="canvas-node-detail-save" type="button" onClick={onSave}>
              保存
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

function CanvasNodeHandles({
  node,
  visible,
  connectionActive,
  onPointerEnter,
  onPointerLeave,
  onConnectionPointerDown,
  onConnectionPointerMove,
  onConnectionPointerUp,
  onConnectionPointerCancel,
}: {
  node: CanvasNode;
  visible: boolean;
  connectionActive: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onConnectionPointerDown: (
    event: PointerEvent<HTMLButtonElement>,
    side: ConnectionSide,
  ) => void;
  onConnectionPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onConnectionPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onConnectionPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  const nodeSize = getNodeSize(node);
  return (
    <div
      className={`canvas-node-handle-layer${visible ? " canvas-node-handles-visible" : ""}${connectionActive ? " canvas-node-connection-active" : ""}`}
      data-node-id={node.id}
      style={{
        width: nodeSize.width,
        height: nodeSize.height,
        transform: `translate(${node.x}px, ${node.y}px)`,
      }}
    >
      {(["left", "right"] as const).map((side) => (
        <button
          aria-label={side === "left" ? "添加上游节点" : "添加下游节点"}
          className={`canvas-node-handle canvas-node-handle-${side}`}
          key={side}
          type="button"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => onConnectionPointerDown(event, side)}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          onPointerMove={onConnectionPointerMove}
          onPointerUp={onConnectionPointerUp}
          onPointerCancel={onConnectionPointerCancel}
        >
          <Plus aria-hidden="true" size={15} />
        </button>
      ))}
    </div>
  );
}

function CanvasNodeResizeHandles({
  node,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  onResizePointerCancel,
}: {
  node: CanvasNode;
  onResizePointerDown: (
    event: PointerEvent<HTMLButtonElement>,
    corner: ResizeCorner,
  ) => void;
  onResizePointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onResizePointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onResizePointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  const nodeSize = getNodeSize(node);
  const corners = [
    { value: "north-west", label: "左上" },
    { value: "north-east", label: "右上" },
    { value: "south-west", label: "左下" },
    { value: "south-east", label: "右下" },
  ] as const;

  return (
    <div
      className="canvas-node-resize-layer"
      data-node-id={node.id}
      style={{
        width: nodeSize.width,
        height: nodeSize.height,
        transform: `translate(${node.x}px, ${node.y}px)`,
      }}
    >
      {corners.map((corner) => (
        <button
          aria-label={`从${corner.label}调整节点大小`}
          className={`canvas-node-resize-handle canvas-node-resize-${corner.value}`}
          key={corner.value}
          type="button"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) =>
            onResizePointerDown(event, corner.value)
          }
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerCancel}
          onLostPointerCapture={onResizePointerCancel}
        />
      ))}
    </div>
  );
}

function CanvasNodeAddMenu({
  side,
  x,
  y,
  onCreate,
}: {
  side: ConnectionSide;
  x: number;
  y: number;
  onCreate: (kind: ComposerMode) => void;
}) {
  return (
    <div
      aria-label={side === "left" ? "添加上游节点类型" : "添加下游节点类型"}
      className="canvas-node-add-menu"
      role="menu"
      style={{ transform: `translate(${x}px, ${y}px)` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {([
        { kind: "text", label: "文本节点", icon: FileText },
        { kind: "image", label: "图片节点", icon: ImageIcon },
        { kind: "video", label: "视频节点", icon: Video },
      ] as const).map((option) => {
        const OptionIcon = option.icon;
        return (
          <button
            key={option.kind}
            role="menuitem"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onCreate(option.kind);
            }}
          >
            <OptionIcon aria-hidden="true" size={14} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function NodeStatus({ node }: { node: CanvasNode }) {
  if (node.status === "failed") {
    return <p className="canvas-node-error">{node.error}</p>;
  }
  if (node.status === "ready") {
    return <EmptyNodeStatus kind={node.kind} />;
  }
  return (
    <div className="canvas-node-loading">
      <LoaderCircle className="animate-spin" aria-hidden="true" size={22} />
      <span>{node.progress || "准备生成"}</span>
    </div>
  );
}

function EmptyNodeStatus({ kind }: { kind: ComposerMode }) {
  const Icon = kind === "image" ? ImageIcon : kind === "video" ? Video : FileText;
  return (
    <div className="canvas-node-empty">
      <Icon aria-hidden="true" size={24} />
      <span>
        {kind === "text" ? "空文本节点" : kind === "image" ? "空图片节点" : "空视频节点"}
      </span>
    </div>
  );
}

function SparkleMark() {
  return (
    <span className="canvas-empty-icon">
      <Play aria-hidden="true" size={18} fill="currentColor" />
    </span>
  );
}
