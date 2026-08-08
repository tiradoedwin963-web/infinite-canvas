import { DEFAULT_MODEL_BY_MODE, type ComposerMode } from "../ai/models.ts";
import type { TaskResult, TaskStatusResponse } from "../ai/types";
import type { Viewport } from "./viewport";

export const GRAPH_STORAGE_KEY = "lingke-generation-canvas-v1";
export const GRAPH_VERSION = 1;
export const NODE_WIDTH = 272;
export const NODE_HEIGHT = 184;
export const TEXT_NODE_MIN_WIDTH = 180;
export const TEXT_NODE_MIN_HEIGHT = 120;
export const MEDIA_NODE_MIN_SHORT_EDGE = 96;
export const NODE_MAX_EDGE = 1200;

export type CanvasNodeRole = "input" | "output";
export type CanvasNodeStatus =
  | "ready"
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "paused";

export type CanvasNode = {
  id: string;
  kind: ComposerMode;
  role: CanvasNodeRole;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text: string;
  model: string;
  status: CanvasNodeStatus;
  progress: string;
  error: string;
  assetId?: string;
  assetName?: string;
  assetMimeType?: string;
  resultUrl?: string;
  taskId?: string;
  startedAt?: number;
  manual?: true;
  prompt?: string;
};

export type ConnectionSide = "left" | "right";
export type ResizeCorner = "north-west" | "north-east" | "south-west" | "south-east";

export type NodeBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  sourceSide: ConnectionSide;
  targetSide: ConnectionSide;
};

export type CanvasGraph = {
  version: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
};

export type ReferenceAsset = {
  id: string;
  name: string;
  mimeType: string;
};

export type GenerationDraft = {
  mode: ComposerMode;
  model: string;
  prompt: string;
  assets: ReferenceAsset[];
  taskId?: string;
  now: number;
};

export type ManualNodeContext = {
  prompt: string;
  imageNodes: CanvasNode[];
};

type IdFactory = () => string;

export function emptyGraph(): CanvasGraph {
  return { version: GRAPH_VERSION, nodes: [], edges: [] };
}

function isNode(value: unknown): value is CanvasNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<CanvasNode>;
  return (
    typeof node.id === "string" &&
    (node.kind === "text" || node.kind === "image" || node.kind === "video") &&
    (node.role === "input" || node.role === "output") &&
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
    typeof node.text === "string" &&
    typeof node.model === "string" &&
    (node.status === "ready" ||
      node.status === "pending" ||
      node.status === "running" ||
      node.status === "success" ||
      node.status === "failed" ||
      node.status === "paused") &&
    typeof node.progress === "string" &&
    typeof node.error === "string" &&
    (node.manual === undefined || node.manual === true) &&
    (node.prompt === undefined || typeof node.prompt === "string")
  );
}

type PersistedCanvasEdge = Omit<CanvasEdge, "sourceSide" | "targetSide"> & {
  sourceSide?: ConnectionSide;
  targetSide?: ConnectionSide;
};

function isConnectionSide(value: unknown): value is ConnectionSide {
  return value === "left" || value === "right";
}

function isEdge(value: unknown): value is PersistedCanvasEdge {
  if (!value || typeof value !== "object") return false;
  const edge = value as Partial<PersistedCanvasEdge>;
  return (
    typeof edge.id === "string" &&
    typeof edge.sourceId === "string" &&
    typeof edge.targetId === "string" &&
    (edge.sourceSide === undefined || isConnectionSide(edge.sourceSide)) &&
    (edge.targetSide === undefined || isConnectionSide(edge.targetSide))
  );
}

export function parsePersistedGraph(raw: string | null): CanvasGraph {
  if (!raw) return emptyGraph();
  try {
    const value = JSON.parse(raw) as Partial<CanvasGraph>;
    if (
      value.version !== GRAPH_VERSION ||
      !Array.isArray(value.nodes) ||
      !value.nodes.every(isNode) ||
      !Array.isArray(value.edges) ||
      !value.edges.every(isEdge)
    ) {
      return emptyGraph();
    }
    const ids = new Set(value.nodes.map((node) => node.id));
    return {
      version: GRAPH_VERSION,
      nodes: value.nodes,
      edges: value.edges
        .filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId))
        .map((edge) => ({
          ...edge,
          sourceSide: edge.sourceSide ?? "right",
          targetSide: edge.targetSide ?? "left",
        })),
    };
  } catch {
    return emptyGraph();
  }
}

export function screenToWorld(
  viewport: Viewport,
  point: { x: number; y: number },
) {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

export function getNodeSize(node: CanvasNode) {
  return {
    width: node.width ?? NODE_WIDTH,
    height: node.height ?? NODE_HEIGHT,
  };
}

export function getNodeBounds(node: CanvasNode): NodeBounds {
  const size = getNodeSize(node);
  return { x: node.x, y: node.y, ...size };
}

export function nodesIntersectingBounds(
  graph: CanvasGraph,
  bounds: NodeBounds,
): string[] {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  return graph.nodes
    .filter((node) => {
      const nodeBounds = getNodeBounds(node);
      return (
        nodeBounds.x <= right &&
        nodeBounds.x + nodeBounds.width >= bounds.x &&
        nodeBounds.y <= bottom &&
        nodeBounds.y + nodeBounds.height >= bounds.y
      );
    })
    .map((node) => node.id);
}

export function selectedNodesBounds(
  graph: CanvasGraph,
  nodeIds: readonly string[],
): NodeBounds | null {
  const selected = graph.nodes.filter((node) => nodeIds.includes(node.id));
  if (selected.length === 0) return null;
  const bounds = selected.map(getNodeBounds);
  const x = Math.min(...bounds.map((item) => item.x));
  const y = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x, y, width: right - x, height: bottom - y };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function constrainMediaSize(width: number, height: number) {
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const minimumScale = MEDIA_NODE_MIN_SHORT_EDGE / shortEdge;
  const maximumScale = NODE_MAX_EDGE / longEdge;
  const scale =
    minimumScale > maximumScale
      ? maximumScale
      : clamp(1, minimumScale, maximumScale);
  return { width: width * scale, height: height * scale };
}

export function resizedNodeBounds(
  node: CanvasNode,
  corner: ResizeCorner,
  point: { x: number; y: number },
): NodeBounds {
  const size = getNodeSize(node);
  const west = corner.endsWith("west");
  const north = corner.startsWith("north");
  const oppositeX = west ? node.x + size.width : node.x;
  const oppositeY = north ? node.y + size.height : node.y;
  const rawWidth = Math.max(1, west ? oppositeX - point.x : point.x - oppositeX);
  const rawHeight = Math.max(1, north ? oppositeY - point.y : point.y - oppositeY);

  let width: number;
  let height: number;
  if (node.kind === "image" || node.kind === "video") {
    const widthScale = rawWidth / size.width;
    const heightScale = rawHeight / size.height;
    const scale =
      Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
        ? widthScale
        : heightScale;
    const constrained = constrainMediaSize(
      size.width * Math.max(scale, 0.01),
      size.height * Math.max(scale, 0.01),
    );
    width = constrained.width;
    height = constrained.height;
  } else {
    width = clamp(rawWidth, TEXT_NODE_MIN_WIDTH, NODE_MAX_EDGE);
    height = clamp(rawHeight, TEXT_NODE_MIN_HEIGHT, NODE_MAX_EDGE);
  }

  return {
    x: west ? oppositeX - width : oppositeX,
    y: north ? oppositeY - height : oppositeY,
    width,
    height,
  };
}

export function resizeNode(
  graph: CanvasGraph,
  nodeId: string,
  bounds: NodeBounds,
): CanvasGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === nodeId ? { ...node, ...bounds } : node,
    ),
  };
}

export function fitMediaNode(
  graph: CanvasGraph,
  nodeId: string,
  naturalWidth: number,
  naturalHeight: number,
): CanvasGraph {
  if (
    !Number.isFinite(naturalWidth) ||
    naturalWidth <= 0 ||
    !Number.isFinite(naturalHeight) ||
    naturalHeight <= 0
  ) {
    return graph;
  }
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || (node.kind !== "image" && node.kind !== "video")) return graph;
  const current = getNodeSize(node);
  const scale = Math.min(
    current.width / naturalWidth,
    current.height / naturalHeight,
  );
  const fitted = constrainMediaSize(
    naturalWidth * scale,
    naturalHeight * scale,
  );
  if (
    Math.abs(fitted.width - current.width) < 0.01 &&
    Math.abs(fitted.height - current.height) < 0.01
  ) {
    return graph;
  }
  return resizeNode(graph, nodeId, {
    x: node.x + (current.width - fitted.width) / 2,
    y: node.y + (current.height - fitted.height) / 2,
    width: fitted.width,
    height: fitted.height,
  });
}

export function createGenerationNodes(
  graph: CanvasGraph,
  draft: GenerationDraft,
  worldCenter: { x: number; y: number },
  idFactory: IdFactory = () => crypto.randomUUID(),
): { graph: CanvasGraph; inputIds: string[]; outputId: string } {
  const inputCount = 1 + draft.assets.length;
  const center = findAvailableGenerationCenter(graph, inputCount, worldCenter);
  const inputStartY = center.y - ((inputCount - 1) * (NODE_HEIGHT + 24)) / 2;
  const inputX = center.x - NODE_WIDTH - 116;
  const outputX = center.x + 116;
  const nodes = [...graph.nodes];
  const inputIds: string[] = [];

  const textId = idFactory();
  inputIds.push(textId);
  nodes.push({
    id: textId,
    kind: "text",
    role: "input",
    x: inputX,
    y: inputStartY,
    text: draft.prompt,
    model: draft.model,
    status: "ready",
    progress: "",
    error: "",
  });

  draft.assets.forEach((asset, index) => {
    const id = idFactory();
    inputIds.push(id);
    nodes.push({
      id,
      kind: "image",
      role: "input",
      x: inputX,
      y: inputStartY + (index + 1) * (NODE_HEIGHT + 24),
      text: asset.name,
      model: draft.model,
      status: "ready",
      progress: "",
      error: "",
      assetId: asset.id,
      assetName: asset.name,
      assetMimeType: asset.mimeType,
    });
  });

  const outputId = idFactory();
  nodes.push({
    id: outputId,
    kind: draft.mode,
    role: "output",
    x: outputX,
    y: center.y - NODE_HEIGHT / 2,
    text: "",
    model: draft.model,
    status: "pending",
    progress: "等待提交",
    error: "",
    taskId: draft.taskId,
    startedAt: draft.now,
  });

  const edges = [
    ...graph.edges,
    ...inputIds.map((sourceId) => ({
      id: idFactory(),
      sourceId,
      targetId: outputId,
      sourceSide: "right" as const,
      targetSide: "left" as const,
    })),
  ];

  return { graph: { version: GRAPH_VERSION, nodes, edges }, inputIds, outputId };
}

function findAvailableGenerationCenter(
  graph: CanvasGraph,
  inputCount: number,
  desired: { x: number; y: number },
) {
  const groupHeight = Math.max(
    NODE_HEIGHT,
    inputCount * NODE_HEIGHT + (inputCount - 1) * 24,
  );
  const groupWidth = NODE_WIDTH * 2 + 232;
  const gap = 36;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const direction = attempt === 0 ? 0 : attempt % 2 === 1 ? 1 : -1;
    const distance = Math.ceil(attempt / 2) * (groupHeight + gap);
    const center = { x: desired.x, y: desired.y + direction * distance };
    const bounds = {
      left: center.x - NODE_WIDTH - 116,
      right: center.x - NODE_WIDTH - 116 + groupWidth,
      top: center.y - groupHeight / 2,
      bottom: center.y + groupHeight / 2,
    };
    const occupied = graph.nodes.some(
      (node) => {
        const size = getNodeSize(node);
        return (
          node.x < bounds.right + gap &&
          node.x + size.width > bounds.left - gap &&
          node.y < bounds.bottom + gap &&
          node.y + size.height > bounds.top - gap
        );
      },
    );
    if (!occupied) return center;
  }
  return desired;
}

export function moveNode(
  graph: CanvasGraph,
  nodeId: string,
  x: number,
  y: number,
): CanvasGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === nodeId ? { ...node, x, y } : node,
    ),
  };
}

export function moveNodes(
  graph: CanvasGraph,
  nodeIds: readonly string[],
  deltaX: number,
  deltaY: number,
): CanvasGraph {
  const selected = new Set(nodeIds);
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      selected.has(node.id)
        ? { ...node, x: node.x + deltaX, y: node.y + deltaY }
        : node,
    ),
  };
}

export function connectNodes(
  graph: CanvasGraph,
  sourceId: string,
  targetId: string,
  idFactory: IdFactory = () => crypto.randomUUID(),
  sourceSide: ConnectionSide = "right",
  targetSide: ConnectionSide = "left",
): CanvasGraph {
  if (
    sourceId === targetId ||
    !graph.nodes.some((node) => node.id === sourceId) ||
    !graph.nodes.some((node) => node.id === targetId) ||
    graph.edges.some(
      (edge) => edge.sourceId === sourceId && edge.targetId === targetId,
    )
  ) {
    return graph;
  }
  return {
    ...graph,
    edges: [
      ...graph.edges,
      { id: idFactory(), sourceId, targetId, sourceSide, targetSide },
    ],
  };
}

export function removeEdge(graph: CanvasGraph, edgeId: string): CanvasGraph {
  if (!graph.edges.some((edge) => edge.id === edgeId)) return graph;
  return {
    ...graph,
    edges: graph.edges.filter((edge) => edge.id !== edgeId),
  };
}

export function createConnectedNode(
  graph: CanvasGraph,
  anchorId: string,
  side: ConnectionSide,
  kind: ComposerMode,
  idFactory: IdFactory = () => crypto.randomUUID(),
): { graph: CanvasGraph; nodeId: string | null } {
  const anchor = graph.nodes.find((node) => node.id === anchorId);
  if (!anchor) return { graph, nodeId: null };
  const anchorSize = getNodeSize(anchor);

  const desiredX =
    side === "left"
      ? anchor.x - NODE_WIDTH - 96
      : anchor.x + anchorSize.width + 96;
  let y = anchor.y;
  let foundSlot = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const direction = attempt === 0 ? 0 : attempt % 2 === 1 ? 1 : -1;
    const distance = Math.ceil(attempt / 2) * (NODE_HEIGHT + 24);
    const candidateY = anchor.y + direction * distance;
    const occupied = graph.nodes.some(
      (node) => {
        const size = getNodeSize(node);
        return (
          desiredX < node.x + size.width + 24 &&
          desiredX + NODE_WIDTH > node.x - 24 &&
          candidateY < node.y + size.height + 24 &&
          candidateY + NODE_HEIGHT > node.y - 24
        );
      },
    );
    if (!occupied) {
      y = candidateY;
      foundSlot = true;
      break;
    }
  }
  if (!foundSlot) y = anchor.y + 10 * (NODE_HEIGHT + 24);

  const nodeId = idFactory();
  const node: CanvasNode = {
    id: nodeId,
    kind,
    role: side === "left" ? "input" : "output",
    x: desiredX,
    y,
    text: "",
    model: DEFAULT_MODEL_BY_MODE[kind],
    status: "ready",
    progress: "",
    error: "",
    manual: true,
    prompt: "",
  };
  const withNode = { ...graph, nodes: [...graph.nodes, node] };
  return {
    graph:
      side === "left"
        ? connectNodes(withNode, nodeId, anchorId, idFactory)
        : connectNodes(withNode, anchorId, nodeId, idFactory),
    nodeId,
  };
}

export function directUpstreamNodes(
  graph: CanvasGraph,
  targetId: string,
): CanvasNode[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.edges
    .filter((edge) => edge.targetId === targetId)
    .map((edge) => nodes.get(edge.sourceId))
    .filter((node): node is CanvasNode => Boolean(node));
}

export function buildManualNodeContext(
  graph: CanvasGraph,
  targetId: string,
  currentPrompt: string,
): ManualNodeContext {
  const upstream = directUpstreamNodes(graph, targetId);
  const upstreamText = upstream
    .map((node) => {
      if (node.kind === "text") return node.text || node.prompt || "";
      if (node.kind === "video") return node.prompt || "";
      return "";
    })
    .filter(Boolean);
  return {
    prompt: [...upstreamText, currentPrompt].join("\n\n"),
    imageNodes: upstream.filter((node) => node.kind === "image"),
  };
}

export function removeNode(graph: CanvasGraph, nodeId: string): CanvasGraph {
  return {
    version: GRAPH_VERSION,
    nodes: graph.nodes.filter((node) => node.id !== nodeId),
    edges: graph.edges.filter(
      (edge) => edge.sourceId !== nodeId && edge.targetId !== nodeId,
    ),
  };
}

export function updateOutputNode(
  graph: CanvasGraph,
  outputId: string,
  patch: Partial<CanvasNode>,
): CanvasGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === outputId ? { ...node, ...patch } : node,
    ),
  };
}

export function applyTaskStatus(
  graph: CanvasGraph,
  outputId: string,
  status: TaskStatusResponse,
  idFactory: IdFactory = () => crypto.randomUUID(),
): CanvasGraph {
  const output = graph.nodes.find((node) => node.id === outputId);
  if (!output) return graph;

  if (!status.isFinal) {
    return updateOutputNode(graph, outputId, {
      status: status.state === "running" ? "running" : "pending",
      progress: status.progress || "处理中",
    });
  }

  if (status.state === "failed" || status.results.length === 0) {
    return updateOutputNode(graph, outputId, {
      status: "failed",
      progress: "",
      error: status.error || "生成失败。",
    });
  }

  return replaceOutputWithResults(graph, outputId, status.results, idFactory);
}

export function replaceOutputWithResults(
  graph: CanvasGraph,
  outputId: string,
  results: TaskResult[],
  idFactory: IdFactory = () => crypto.randomUUID(),
): CanvasGraph {
  const output = graph.nodes.find((node) => node.id === outputId);
  if (!output || results.length === 0) return graph;
  const outputSize = getNodeSize(output);
  const incoming = graph.edges.filter((edge) => edge.targetId === outputId);
  const remainingNodes = graph.nodes.filter((node) => node.id !== outputId);
  const remainingEdges = graph.edges.filter((edge) => edge.targetId !== outputId);

  const resultNodes = results.map((result, index) => ({
    ...output,
    id: index === 0 ? outputId : idFactory(),
    kind: result.kind,
    y: output.y + index * (outputSize.height + 24),
    status: "success" as const,
    progress: "",
    error: "",
    resultUrl: result.url,
    taskId: undefined,
  }));
  const resultEdges = resultNodes.flatMap((node) =>
    incoming.map((edge) => ({
      id: node.id === outputId ? edge.id : idFactory(),
      sourceId: edge.sourceId,
      targetId: node.id,
      sourceSide: edge.sourceSide,
      targetSide: edge.targetSide,
    })),
  );

  return {
    version: GRAPH_VERSION,
    nodes: [...remainingNodes, ...resultNodes],
    edges: [...remainingEdges, ...resultEdges],
  };
}

export function connectionPoint(node: CanvasNode, side: ConnectionSide) {
  const size = getNodeSize(node);
  return {
    x: side === "right" ? node.x + size.width : node.x,
    y: node.y + size.height / 2,
  };
}

function edgeGeometry(
  source: CanvasNode,
  target: CanvasNode,
  sourceSide: ConnectionSide,
  targetSide: ConnectionSide,
) {
  const start = connectionPoint(source, sourceSide);
  const end = connectionPoint(target, targetSide);
  const control = Math.max(48, Math.abs(end.x - start.x) * 0.45);
  const sourceDirection = sourceSide === "right" ? 1 : -1;
  const targetDirection = targetSide === "right" ? 1 : -1;
  return {
    start,
    firstControl: {
      x: start.x + control * sourceDirection,
      y: start.y,
    },
    secondControl: {
      x: end.x + control * targetDirection,
      y: end.y,
    },
    end,
  };
}

export function edgePath(
  source: CanvasNode,
  target: CanvasNode,
  sourceSide: ConnectionSide = "right",
  targetSide: ConnectionSide = "left",
): string {
  const geometry = edgeGeometry(source, target, sourceSide, targetSide);
  return `M ${geometry.start.x} ${geometry.start.y} C ${geometry.firstControl.x} ${geometry.firstControl.y}, ${geometry.secondControl.x} ${geometry.secondControl.y}, ${geometry.end.x} ${geometry.end.y}`;
}

export function edgeMidpoint(
  source: CanvasNode,
  target: CanvasNode,
  sourceSide: ConnectionSide = "right",
  targetSide: ConnectionSide = "left",
) {
  const geometry = edgeGeometry(source, target, sourceSide, targetSide);
  return {
    x:
      (geometry.start.x +
        3 * geometry.firstControl.x +
        3 * geometry.secondControl.x +
        geometry.end.x) /
      8,
    y:
      (geometry.start.y +
        3 * geometry.firstControl.y +
        3 * geometry.secondControl.y +
        geometry.end.y) /
      8,
  };
}

export function draftEdgePath(
  node: CanvasNode,
  side: ConnectionSide,
  point: { x: number; y: number },
): string {
  const size = getNodeSize(node);
  const direction = side === "right" ? 1 : -1;
  const start = {
    x: side === "right" ? node.x + size.width : node.x,
    y: node.y + size.height / 2,
  };
  const control = Math.max(48, Math.abs(point.x - start.x) * 0.45);
  return `M ${start.x} ${start.y} C ${start.x + control * direction} ${start.y}, ${point.x - control * direction} ${point.y}, ${point.x} ${point.y}`;
}

export function autoPollDeadline(node: CanvasNode): number {
  const duration = node.kind === "video" ? 70 * 60_000 : 10 * 60_000;
  return (node.startedAt ?? Date.now()) + duration;
}
