import { DEFAULT_MODEL_BY_MODE } from "../ai/models.ts";
import type {
  AgentCanvasSnapshot,
  AgentOperation,
} from "../ai/agent.ts";
import { isTvcAgentOperation } from "../ai/agent.ts";
import {
  connectNodes,
  getNodeSize,
  MEDIA_NODE_MIN_SHORT_EDGE,
  moveNode,
  NODE_MAX_EDGE,
  resizeNode,
  TEXT_NODE_MIN_HEIGHT,
  TEXT_NODE_MIN_WIDTH,
  updateOutputNode,
  type CanvasGraph,
  type CanvasNode,
} from "./graph.ts";
import type { Viewport } from "./viewport.ts";

export type AgentOperationResult = {
  operation: AgentOperation;
  applied: boolean;
  message: string;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createAgentCanvasSnapshot(
  graph: CanvasGraph,
  viewport: Viewport,
  viewportSize: { width: number; height: number },
): AgentCanvasSnapshot {
  return {
    mode: "creation",
    viewport: { ...viewport, ...viewportSize },
    nodes: graph.nodes.map((node) => {
      const size = getNodeSize(node);
      return {
        id: node.id,
        kind: node.kind,
        role: node.role,
        x: node.x,
        y: node.y,
        width: size.width,
        height: size.height,
        text: node.text,
        ...(node.prompt ? { prompt: node.prompt } : {}),
        model: node.model,
        status: node.status,
        ...(node.assetName ? { assetName: node.assetName } : {}),
        hasVisual: Boolean(node.assetId || node.resultUrl),
      };
    }),
    edges: graph.edges.map(
      ({ sourceId, targetId, sourceSide, targetSide }) => ({
        sourceId,
        targetId,
        sourceSide,
        targetSide,
      }),
    ),
  };
}

function resolveNodeId(value: string, aliases: Map<string, string>) {
  return value.startsWith("$") ? aliases.get(value.slice(1)) : value;
}

function resizeForAgent(node: CanvasNode, width: number, height: number) {
  const current = getNodeSize(node);
  if (node.kind === "text") {
    return {
      x: node.x,
      y: node.y,
      width: clamp(width, TEXT_NODE_MIN_WIDTH, NODE_MAX_EDGE),
      height: clamp(height, TEXT_NODE_MIN_HEIGHT, NODE_MAX_EDGE),
    };
  }
  const scale = Math.max(width / current.width, height / current.height);
  const rawWidth = current.width * scale;
  const rawHeight = current.height * scale;
  const shortEdge = Math.min(rawWidth, rawHeight);
  const longEdge = Math.max(rawWidth, rawHeight);
  const minimumScale = MEDIA_NODE_MIN_SHORT_EDGE / shortEdge;
  const maximumScale = NODE_MAX_EDGE / longEdge;
  const boundedScale =
    minimumScale > maximumScale
      ? maximumScale
      : clamp(1, minimumScale, maximumScale);
  return {
    x: node.x,
    y: node.y,
    width: rawWidth * boundedScale,
    height: rawHeight * boundedScale,
  };
}

export function applyAgentOperations(
  graph: CanvasGraph,
  operations: AgentOperation[],
  idFactory: () => string = () => crypto.randomUUID(),
): { graph: CanvasGraph; results: AgentOperationResult[] } {
  let current = graph;
  const aliases = new Map<string, string>();
  const results: AgentOperationResult[] = [];

  for (const operation of operations) {
    if (isTvcAgentOperation(operation)) {
      results.push({
        operation,
        applied: false,
        message: "TVC 操作只能在 TVC 工作流项目执行。",
      });
      continue;
    }
    if (
      operation.type === "create_story_workflow" ||
      operation.type === "run_story_workflow"
    ) {
      results.push({
        operation,
        applied: false,
        message: "短剧工作流操作不能在创作画布执行。",
      });
      continue;
    }
    if (operation.type === "delete_node" || operation.type === "generate_content") {
      results.push({ operation, applied: false, message: "此操作需要用户确认。" });
      continue;
    }

    if (operation.type === "create_node") {
      if (aliases.has(operation.ref)) {
        results.push({ operation, applied: false, message: `新节点引用 ${operation.ref} 重复。` });
        continue;
      }
      const id = idFactory();
      aliases.set(operation.ref, id);
      current = {
        ...current,
        nodes: [
          ...current.nodes,
          {
            id,
            kind: operation.kind,
            role: "input",
            x: operation.x,
            y: operation.y,
            text: operation.text,
            model: DEFAULT_MODEL_BY_MODE[operation.kind],
            status: "ready",
            progress: "",
            error: "",
            manual: true,
            prompt: operation.text,
          },
        ],
      };
      results.push({ operation, applied: true, message: `已创建${operation.kind}节点。` });
      continue;
    }

    if (operation.type === "update_node") {
      const nodeId = resolveNodeId(operation.nodeId, aliases);
      if (!nodeId || !current.nodes.some((node) => node.id === nodeId)) {
        results.push({ operation, applied: false, message: `未找到节点 ${operation.nodeId}。` });
        continue;
      }
      current = updateOutputNode(current, nodeId, {
        ...(operation.text !== undefined ? { text: operation.text } : {}),
        ...(operation.prompt !== undefined ? { prompt: operation.prompt } : {}),
      });
      results.push({ operation, applied: true, message: "已更新节点内容。" });
      continue;
    }

    if (operation.type === "move_node") {
      const nodeId = resolveNodeId(operation.nodeId, aliases);
      if (!nodeId || !current.nodes.some((node) => node.id === nodeId)) {
        results.push({ operation, applied: false, message: `未找到节点 ${operation.nodeId}。` });
        continue;
      }
      current = moveNode(current, nodeId, operation.x, operation.y);
      results.push({ operation, applied: true, message: "已移动节点。" });
      continue;
    }

    if (operation.type === "resize_node") {
      const nodeId = resolveNodeId(operation.nodeId, aliases);
      const node = nodeId
        ? current.nodes.find((candidate) => candidate.id === nodeId)
        : undefined;
      if (!node) {
        results.push({ operation, applied: false, message: `未找到节点 ${operation.nodeId}。` });
        continue;
      }
      current = resizeNode(
        current,
        node.id,
        resizeForAgent(node, operation.width, operation.height),
      );
      results.push({ operation, applied: true, message: "已调整节点尺寸。" });
      continue;
    }

    const sourceId = resolveNodeId(operation.sourceId, aliases);
    const targetId = resolveNodeId(operation.targetId, aliases);
    if (
      !sourceId ||
      !targetId ||
      !current.nodes.some((node) => node.id === sourceId) ||
      !current.nodes.some((node) => node.id === targetId)
    ) {
      results.push({ operation, applied: false, message: "连接操作引用了不存在的节点。" });
      continue;
    }
    if (operation.type === "connect_nodes") {
      const next = connectNodes(current, sourceId, targetId, idFactory);
      const applied = next !== current;
      current = next;
      results.push({
        operation,
        applied,
        message: applied ? "已连接节点。" : "节点已连接或连接无效。",
      });
    } else {
      const edgeCount = current.edges.length;
      current = {
        ...current,
        edges: current.edges.filter(
          (edge) => edge.sourceId !== sourceId || edge.targetId !== targetId,
        ),
      };
      const applied = current.edges.length !== edgeCount;
      results.push({
        operation,
        applied,
        message: applied ? "已断开节点连接。" : "未找到指定连接。",
      });
    }
  }

  return { graph: current, results };
}
