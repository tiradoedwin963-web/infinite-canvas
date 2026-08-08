import type { ComposerMode } from "./models.ts";

export const AGENT_MODEL = "gpt-5.6-sol";
export const AGENT_CHAT_STORAGE_KEY = "canvas-agent-chat-v1";
export const AGENT_CONVERSATIONS_STORAGE_KEY = "canvas-agent-conversations-v2";
export const MAX_AGENT_MESSAGES = 100;
export const MAX_AGENT_CONVERSATIONS = 20;
export const MAX_AGENT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_AGENT_IMAGE_TOTAL_BYTES = 30 * 1024 * 1024;

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
  viewport: { x: number; y: number; scale: number; width: number; height: number };
  nodes: AgentCanvasNodeSnapshot[];
  edges: Array<{
    sourceId: string;
    targetId: string;
    sourceSide: "left" | "right";
    targetSide: "left" | "right";
  }>;
};

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

export type AgentOperation =
  | AgentCreateNodeOperation
  | { type: "update_node"; nodeId: string; text?: string; prompt?: string }
  | { type: "move_node"; nodeId: string; x: number; y: number }
  | { type: "resize_node"; nodeId: string; width: number; height: number }
  | { type: "connect_nodes"; sourceId: string; targetId: string }
  | { type: "disconnect_nodes"; sourceId: string; targetId: string }
  | { type: "delete_node"; nodeId: string }
  | {
      type: "generate_content";
      mode: ComposerMode;
      model: string;
      prompt: string;
      referenceNodeIds: string[];
      aspectRatio?: string;
      duration?: string;
      resolution?: string;
    };

export type AgentDangerousOperation = Extract<
  AgentOperation,
  { type: "delete_node" | "generate_content" }
>;

export type AgentRequest = {
  messages: Array<{ role: AgentMessageRole; content: string }>;
  canvas: AgentCanvasSnapshot;
  phase: AgentConversationPhase;
  focusedNodeId?: string;
  inspectedImages?: AgentInspectedImage[];
};

export type AgentResponse = {
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

  if (type === "generate_content") {
    const mode = readMode(value.mode);
    const model = readString(value.model);
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

export function parseAgentModelResponse(raw: string): AgentResponse {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    throw new Error("Agent 返回了无法识别的操作格式。");
  }
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
    message,
    workflowState,
    inspectImageNodeIds,
    operations: operations as AgentOperation[],
  };
}

export function isDangerousAgentOperation(
  operation: AgentOperation,
): operation is AgentDangerousOperation {
  return operation.type === "delete_node" || operation.type === "generate_content";
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
  return `使用 ${operation.model} 生成${
    operation.mode === "text" ? "文本" : operation.mode === "image" ? "图片" : "视频"
  }：${operation.prompt}`;
}
