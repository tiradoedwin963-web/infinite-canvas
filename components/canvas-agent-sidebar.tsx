"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  CircleX,
  History,
  LoaderCircle,
  MessageSquarePlus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AGENT_CHAT_STORAGE_KEY,
  AGENT_CONVERSATIONS_STORAGE_KEY,
  MAX_AGENT_CONVERSATIONS,
  MAX_AGENT_MESSAGES,
  createAgentConversation,
  createAgentConversationTitle,
  describeDangerousOperation,
  isDangerousAgentOperation,
  parseAgentConversationStore,
  serializeAgentConversationStore,
  type AgentCanvasSnapshot,
  type AgentConversation,
  type AgentConversationPhase,
  type AgentConversationStore,
  type AgentDangerousOperation,
  type AgentInspectedImage,
  type AgentMessage,
  type AgentOperation,
  type AgentResponse,
} from "@/app/ai/agent";

const EMPTY_CONVERSATION_STORE: AgentConversationStore = {
  version: 2,
  activeConversationId: "",
  conversations: [],
};

function sortAndLimitConversations(conversations: AgentConversation[]) {
  return [...conversations]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_AGENT_CONVERSATIONS);
}

type CanvasAgentSidebarProps = {
  open: boolean;
  snapshot: AgentCanvasSnapshot;
  focusedNodeId?: string;
  onClose: () => void;
  onClearFocus: () => void;
  onApplyOperations: (operations: AgentOperation[]) => string[];
  onConfirmOperation: (operation: AgentDangerousOperation) => Promise<string>;
  onReadImages: (nodeIds: string[]) => Promise<AgentInspectedImage[]>;
};

async function readApiError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string") return payload.error;
  } catch {
    // Use the local sanitized fallback.
  }
  return "画布 Agent 请求失败，请稍后重试。";
}

export function CanvasAgentSidebar({
  open,
  snapshot,
  focusedNodeId,
  onClose,
  onClearFocus,
  onApplyOperations,
  onConfirmOperation,
  onReadImages,
}: CanvasAgentSidebarProps) {
  const [conversationStore, setConversationStore] = useState<AgentConversationStore>(
    EMPTY_CONVERSATION_STORE,
  );
  const [draft, setDraft] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeConversation = conversationStore.conversations.find(
    (conversation) => conversation.id === conversationStore.activeConversationId,
  );
  const messages = useMemo(
    () => activeConversation?.messages ?? [],
    [activeConversation],
  );
  const focusedNode = focusedNodeId
    ? snapshot.nodes.find((node) => node.id === focusedNodeId)
    : undefined;

  useEffect(() => {
    setConversationStore(
      parseAgentConversationStore(
        window.localStorage.getItem(AGENT_CONVERSATIONS_STORAGE_KEY),
        window.localStorage.getItem(AGENT_CHAT_STORAGE_KEY),
        () => crypto.randomUUID(),
      ),
    );
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    window.localStorage.setItem(
      AGENT_CONVERSATIONS_STORAGE_KEY,
      serializeAgentConversationStore(conversationStore),
    );
    window.localStorage.removeItem(AGENT_CHAT_STORAGE_KEY);
  }, [conversationStore, isHydrated]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 180);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [conversationStore.activeConversationId, messages, isSending]);

  function updateConversation(
    conversationId: string,
    updater: (conversation: AgentConversation) => AgentConversation,
  ) {
    setConversationStore((current) => ({
      ...current,
      conversations: sortAndLimitConversations(
        current.conversations.map((conversation) =>
          conversation.id === conversationId ? updater(conversation) : conversation,
        ),
      ),
    }));
  }

  async function requestAgent(
    history: AgentMessage[],
    phase: AgentConversationPhase,
    inspectedImages?: AgentInspectedImage[],
  ): Promise<AgentResponse> {
    const response = await fetch("/api/ai/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: history
          .filter((message) => message.content.trim())
          .slice(-20)
          .map(({ role, content }) => ({ role, content })),
        canvas: snapshot,
        phase,
        focusedNodeId,
        inspectedImages,
      }),
    });
    if (!response.ok) throw new Error(await readApiError(response));
    return (await response.json()) as AgentResponse;
  }

  async function submit() {
    const content = draft.trim();
    if (!content || isSending || !activeConversation) return;
    const conversationId = activeConversation.id;
    const phase = activeConversation.phase;
    const userMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: Date.now(),
    };
    const history = [...messages, userMessage];
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      title: conversation.messages.some((message) => message.role === "user")
        ? conversation.title
        : createAgentConversationTitle(content),
      messages: history.slice(-MAX_AGENT_MESSAGES),
      updatedAt: Date.now(),
    }));
    setDraft("");
    setIsHistoryOpen(false);
    setIsSending(true);
    try {
      let response = await requestAgent(history, phase);
      if (response.inspectImageNodeIds.length) {
        const images = await onReadImages(response.inspectImageNodeIds);
        if (!images.length) throw new Error("Agent 无法读取请求的画布图片。");
        response = await requestAgent(history, phase, images);
        if (response.inspectImageNodeIds.length) {
          throw new Error("Agent 在单轮对话中重复请求图片，请换一种说法重试。");
        }
      }
      const safe = response.operations.filter(
        (operation) => !isDangerousAgentOperation(operation),
      );
      const dangerous = response.operations.filter(isDangerousAgentOperation);
      const details = onApplyOperations(safe);
      const assistantMessage: AgentMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.message,
        createdAt: Date.now(),
        details: details.length ? details : undefined,
      };
      const confirmations = dangerous.map(
        (operation): AgentMessage => ({
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          createdAt: Date.now(),
          action: {
            label: describeDangerousOperation(operation),
            status: "pending",
            operation,
          },
        }),
      );
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        phase: response.workflowState,
        messages: [...conversation.messages, assistantMessage, ...confirmations].slice(
          -MAX_AGENT_MESSAGES,
        ),
        updatedAt: Date.now(),
      }));
    } catch (error) {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: [
          ...conversation.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: error instanceof Error ? error.message : "画布 Agent 请求失败。",
            createdAt: Date.now(),
          },
        ].slice(-MAX_AGENT_MESSAGES),
        updatedAt: Date.now(),
      }));
    } finally {
      setIsSending(false);
    }
  }

  async function confirm(message: AgentMessage) {
    if (
      !activeConversation ||
      !message.action?.operation ||
      message.action.status !== "pending"
    ) return;
    const conversationId = activeConversation.id;
    setConfirmingId(message.id);
    try {
      const detail = await onConfirmOperation(message.action.operation);
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((item) =>
          item.id === message.id
            ? {
                ...item,
                details: [detail],
                action: item.action ? { ...item.action, status: "confirmed" } : undefined,
              }
            : item,
        ),
        updatedAt: Date.now(),
      }));
    } catch (error) {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((item) =>
          item.id === message.id
            ? {
                ...item,
                details: [error instanceof Error ? error.message : "操作执行失败。"],
              }
            : item,
        ),
        updatedAt: Date.now(),
      }));
    } finally {
      setConfirmingId(null);
    }
  }

  function cancel(messageId: string) {
    if (!activeConversation) return;
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === messageId && message.action
          ? { ...message, action: { ...message.action, status: "cancelled", operation: undefined } }
          : message,
      ),
      updatedAt: Date.now(),
    }));
  }

  function startNewConversation() {
    if (isSending || confirmingId) return;
    if (activeConversation && !activeConversation.messages.length) {
      setIsHistoryOpen(false);
      inputRef.current?.focus();
      return;
    }
    const conversation = createAgentConversation(crypto.randomUUID());
    setConversationStore((current) => ({
      version: 2,
      activeConversationId: conversation.id,
      conversations: sortAndLimitConversations([
        conversation,
        ...current.conversations,
      ]),
    }));
    setDraft("");
    setIsHistoryOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function selectConversation(conversationId: string) {
    if (isSending || confirmingId) return;
    setConversationStore((current) => ({
      ...current,
      activeConversationId: conversationId,
    }));
    setDraft("");
    setIsHistoryOpen(false);
  }

  function deleteConversation(conversationId: string) {
    if (isSending || confirmingId) return;
    setConversationStore((current) => {
      const remaining = current.conversations.filter(
        (conversation) => conversation.id !== conversationId,
      );
      if (!remaining.length) {
        const conversation = createAgentConversation(crypto.randomUUID());
        return {
          version: 2,
          activeConversationId: conversation.id,
          conversations: [conversation],
        };
      }
      return {
        ...current,
        activeConversationId:
          current.activeConversationId === conversationId
            ? remaining[0].id
            : current.activeConversationId,
        conversations: remaining,
      };
    });
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          aria-label="画布 Agent"
          className="fixed inset-y-0 right-0 z-50 flex w-[320px] max-w-full flex-col border-l border-black/10 bg-white text-zinc-900 shadow-[-18px_0_54px_rgba(35,32,28,0.16)] max-[480px]:w-full"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-black/8 px-4">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-zinc-900 text-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="h-7 w-7 rounded-lg object-contain"
                  src="/agent-icon.png"
                />
              </span>
              <div>
                <h2 className="m-0 text-sm font-semibold">画布 Agent</h2>
                <p className="m-0 text-[11px] text-zinc-500">GPT-5.6 Sol · 可读取并编辑画布</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                aria-label="Agent 历史对话"
                className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
                disabled={isSending || Boolean(confirmingId)}
                type="button"
                onClick={() => setIsHistoryOpen((current) => !current)}
              >
                <History aria-hidden="true" size={15} />
              </button>
              <button
                aria-label="新建 Agent 对话"
                className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30"
                disabled={isSending || Boolean(confirmingId)}
                type="button"
                onClick={startNewConversation}
              >
                <MessageSquarePlus aria-hidden="true" size={16} />
              </button>
              <button
                aria-label="关闭画布 Agent"
                className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
                type="button"
                onClick={() => {
                  setIsHistoryOpen(false);
                  onClose();
                }}
              >
                <X aria-hidden="true" size={17} />
              </button>
            </div>
          </header>

          {isHistoryOpen ? (
            <div
              aria-label="Agent 历史对话列表"
              className="absolute top-[70px] right-3 left-3 z-20 max-h-[min(420px,70vh)] overflow-y-auto rounded-2xl border border-black/10 bg-white p-2 shadow-[0_18px_54px_rgba(35,32,28,0.2)]"
            >
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="text-xs font-semibold text-zinc-700">历史对话</span>
                <span className="text-[10px] text-zinc-400">最多 20 个</span>
              </div>
              <div className="space-y-1">
                {conversationStore.conversations.map((conversation) => (
                  <div
                    key={conversation.id}
                    className={`flex items-center gap-1 rounded-xl ${
                      conversation.id === conversationStore.activeConversationId
                        ? "bg-zinc-100"
                        : "hover:bg-zinc-50"
                    }`}
                  >
                    <button
                      className="min-w-0 flex-1 px-3 py-2 text-left"
                      type="button"
                      onClick={() => selectConversation(conversation.id)}
                    >
                      <span className="block truncate text-xs font-medium text-zinc-700">
                        {conversation.title}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-zinc-400">
                        {new Date(conversation.updatedAt).toLocaleString("zh-CN")}
                      </span>
                    </button>
                    <button
                      aria-label={`删除对话 ${conversation.title}`}
                      className="mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-zinc-400 hover:bg-white hover:text-red-500"
                      type="button"
                      onClick={() => deleteConversation(conversation.id)}
                    >
                      <Trash2 aria-hidden="true" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {focusedNode ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-black/6 bg-zinc-50 px-4 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-zinc-600">
                当前引用：{focusedNode.assetName || focusedNode.text || `${focusedNode.kind} 节点`}
              </span>
              <button className="text-zinc-400 hover:text-zinc-800" type="button" onClick={onClearFocus}>
                移除
              </button>
            </div>
          ) : null}

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
            {messages.length === 0 ? (
              <div className="mx-auto mt-[28vh] max-w-[270px] text-center text-sm leading-6 text-zinc-500">
                告诉我你想完成什么。我会先提问确认需求，再编辑画布。
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-5 ${
                      message.role === "user"
                        ? "ml-auto bg-zinc-900 text-white"
                        : "mr-auto border border-black/7 bg-zinc-50 text-zinc-700"
                    }`}
                  >
                    {message.content ? <p className="m-0 whitespace-pre-wrap">{message.content}</p> : null}
                    {message.details?.length ? (
                      <ul className="mt-2 mb-0 list-none space-y-1 border-t border-current/10 pt-2 text-[11px] opacity-75">
                        {message.details.map((detail, index) => <li key={index}>{detail}</li>)}
                      </ul>
                    ) : null}
                    {message.action ? (
                      <div className="space-y-2">
                        <p className="m-0 font-medium">{message.action.label}</p>
                        {message.action.status === "pending" ? (
                          <div className="flex gap-2">
                            <button
                              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-zinc-900 px-3 text-xs text-white disabled:opacity-50"
                              disabled={Boolean(confirmingId)}
                              type="button"
                              onClick={() => void confirm(message)}
                            >
                              {confirmingId === message.id ? (
                                <LoaderCircle className="animate-spin" aria-hidden="true" size={13} />
                              ) : (
                                <Check aria-hidden="true" size={13} />
                              )}
                              确认
                            </button>
                            <button
                              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-zinc-200 px-3 text-xs text-zinc-700"
                              disabled={Boolean(confirmingId)}
                              type="button"
                              onClick={() => cancel(message.id)}
                            >
                              <CircleX aria-hidden="true" size={13} />
                              取消
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-zinc-500">
                            {message.action.status === "confirmed"
                              ? "已确认执行"
                              : message.action.status === "cancelled"
                                ? "已取消"
                                : "确认已失效，请重新提出"}
                          </span>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
                {isSending ? (
                  <div className="mr-auto inline-flex items-center gap-2 rounded-2xl border border-black/7 bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-500">
                    <LoaderCircle className="animate-spin" aria-hidden="true" size={14} />
                    {activeConversation?.phase === "active"
                      ? "正在读取画布并思考…"
                      : "正在梳理需求…"}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-black/8 bg-white p-3.5">
            <div className="relative rounded-2xl border border-black/10 bg-zinc-50 px-3 py-2 pr-12 focus-within:border-zinc-400">
              <textarea
                ref={inputRef}
                aria-label="给画布 Agent 发送消息"
                className="block max-h-32 min-h-12 w-full resize-none border-0 bg-transparent py-1 text-[13px] leading-5 outline-none"
                placeholder={
                  activeConversation?.phase === "active"
                    ? "描述你想对画布做什么…"
                    : "先告诉我你想完成什么…"
                }
                rows={2}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
              <button
                aria-label="发送给画布 Agent"
                className="absolute right-2.5 bottom-2.5 grid h-8 w-8 place-items-center rounded-full bg-zinc-900 text-white disabled:opacity-30"
                disabled={!draft.trim() || isSending}
                type="button"
                onClick={() => void submit()}
              >
                <Send aria-hidden="true" size={13} />
              </button>
            </div>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
