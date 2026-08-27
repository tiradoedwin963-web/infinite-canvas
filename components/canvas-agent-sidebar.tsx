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
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AGENT_CHAT_STORAGE_KEY,
  AGENT_CONVERSATIONS_STORAGE_KEY,
  MAX_AGENT_CONVERSATIONS,
  MAX_AGENT_MESSAGES,
  AgentRequestTimeoutError,
  createAgentConversation,
  createAgentConversationTitle,
  describeDangerousOperation,
  expireIncompleteAgentConfirmations,
  getPendingAgentConfirmations,
  isDangerousAgentOperation,
  parseAgentConversationStore,
  runAgentConfirmationsSequentially,
  runAgentConfirmationWithTimeout,
  runAgentRequestWithTimeout,
  serializeAgentConversationStore,
  validateAgentOperationsForSurface,
  type AgentCreateStoryWorkflowOperation,
  type AgentCreateStoryAnalysisOperation,
  type AgentCreateStoryAssetBatchOperation,
  type AgentConversation,
  type AgentConversationPhase,
  type AgentConversationStore,
  type AgentDangerousOperation,
  type AgentInspectedImage,
  type AgentMessage,
  type AgentOperation,
  type AgentResponse,
  type AgentSurfaceSnapshot,
  type AgentStoryAssetKind,
} from "@/app/ai/agent";
import { readAgentSseResponse } from "@/app/ai/agent-stream";
import { mergeStoryWorkflowChunks } from "@/app/workflow/agent";

const EMPTY_CONVERSATION_STORE: AgentConversationStore = {
  version: 2,
  activeConversationId: "",
  conversations: [],
};

const ASSET_STAGE_LABEL: Record<AgentStoryAssetKind, string> = {
  character: "人物资产",
  scene: "场景资产",
  prop: "道具资产",
};

function sortAndLimitConversations(conversations: AgentConversation[]) {
  return [...conversations]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_AGENT_CONVERSATIONS);
}

type CanvasAgentSidebarProps = {
  open: boolean;
  snapshot: AgentSurfaceSnapshot;
  conversationStorageKey?: string;
  legacyStorageKey?: string;
  subtitle?: string;
  emptyMessage?: string;
  intakePlaceholder?: string;
  focusedNodeId?: string;
  onClose: () => void;
  onClearFocus: () => void;
  onApplyOperations: (operations: AgentOperation[]) => string[];
  getSnapshot?: () => AgentSurfaceSnapshot;
  onPlanningInterrupted?: (
    storyId: string,
    status: "stopped" | "failed",
  ) => void;
  onApproveFoundation?: (storyId: string) => string;
  onConfirmOperation: (
    operation: AgentDangerousOperation,
    signal: AbortSignal,
  ) => Promise<string>;
  onReadImages: (nodeIds: string[]) => Promise<AgentInspectedImage[]>;
  describeOperation?: (operation: AgentDangerousOperation) => string;
  onBusyChange?: (busy: boolean) => void;
  loadConversationStore?: () => Promise<AgentConversationStore>;
  saveConversationStore?: (store: AgentConversationStore) => Promise<void>;
  autoRequest?: CanvasAgentAutoRequest | null;
  onAutoRequestComplete?: (
    requestId: string,
    outcome: CanvasAgentAutoRequestOutcome,
  ) => void;
  contextControls?: ReactNode;
};

export type CanvasAgentAutoRequest = {
  id: string;
  content: string;
  textOnly?: boolean;
};

export type CanvasAgentAutoRequestOutcome =
  | { succeeded: true }
  | { succeeded: false; error: string };

type AgentSubmitOptions = {
  textOnly?: boolean;
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
  conversationStorageKey = AGENT_CONVERSATIONS_STORAGE_KEY,
  legacyStorageKey = AGENT_CHAT_STORAGE_KEY,
  subtitle = "GPT-5.6 Sol · 可读取并编辑画布",
  emptyMessage = "告诉我你想完成什么。我会先提问确认需求，再编辑画布。",
  intakePlaceholder = "先告诉我你想完成什么…",
  focusedNodeId,
  onClose,
  onClearFocus,
  onApplyOperations,
  getSnapshot,
  onPlanningInterrupted,
  onApproveFoundation,
  onConfirmOperation,
  onReadImages,
  describeOperation = describeDangerousOperation,
  onBusyChange,
  loadConversationStore,
  saveConversationStore,
  autoRequest,
  onAutoRequestComplete,
  contextControls,
}: CanvasAgentSidebarProps) {
  const [conversationStore, setConversationStore] = useState<AgentConversationStore>(
    EMPTY_CONVERSATION_STORE,
  );
  const [draft, setDraft] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [batchSummary, setBatchSummary] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [planningProgress, setPlanningProgress] = useState<{
    batch: number;
    count: number;
    label: string;
  } | null>(null);
  const [streamingSummary, setStreamingSummary] = useState("");
  const [requestStartedAt, setRequestStartedAt] = useState<number | null>(null);
  const [requestClock, setRequestClock] = useState(() => Date.now());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const planningAbortRef = useRef<AbortController | null>(null);
  const autoRequestHandledRef = useRef("");
  const submitRef = useRef<((
    contentOverride?: string,
    options?: AgentSubmitOptions,
  ) => Promise<CanvasAgentAutoRequestOutcome | undefined>) | null>(null);
  const activeConversation = conversationStore.conversations.find(
    (conversation) => conversation.id === conversationStore.activeConversationId,
  );
  const messages = useMemo(
    () => activeConversation?.messages ?? [],
    [activeConversation],
  );
  const pendingConfirmations = useMemo(
    () => getPendingAgentConfirmations(messages),
    [messages],
  );
  const pendingAssetConfirmationKeys = useMemo(
    () => new Set(pendingConfirmations.flatMap(({ operation }) =>
      operation.type === "run_story_assets"
        ? [`${operation.storyId}:${[...operation.assetRefs].sort().join(",")}`]
        : [],
    )),
    [pendingConfirmations],
  );
  const foundationControls = useMemo(() => {
    if (snapshot.mode !== "workflow") return [];
    return snapshot.nodes.flatMap((analysis) => {
      if (
        analysis.storyRole !== "analysis" ||
        analysis.assetStrategy !== "foundation-pair-v1" ||
        !analysis.storyId
      ) {
        return [];
      }
      const results = snapshot.nodes.filter((node) =>
        node.storyId === analysis.storyId &&
        node.assetRole === "result" &&
        Boolean(node.assetRef),
      );
      const foundations = results.filter((node) => Boolean(node.foundationRole));
      const readyFoundationRefs = foundations.flatMap((node) =>
        (node.status === "ready" || node.status === "failed") && node.assetRef
          ? [node.assetRef]
          : [],
      );
      const foundationComplete = foundations.length === 2 &&
        foundations.every((node) => node.assetAvailable);
      if (
        analysis.planningStatus === "awaiting-foundation-approval" &&
        foundationComplete
      ) {
        return [{
          kind: "approve" as const,
          storyId: analysis.storyId,
          count: 2,
          refs: [] as string[],
        }];
      }
      if (
        analysis.planningStatus === "awaiting-foundation-generation" &&
        readyFoundationRefs.length
      ) {
        return [{
          kind: "foundation-run" as const,
          storyId: analysis.storyId,
          count: readyFoundationRefs.length,
          refs: readyFoundationRefs,
        }];
      }
      if (analysis.planningStage === "complete" && analysis.foundationApprovedAt) {
        const refs = results.flatMap((node) =>
          !node.foundationRole &&
          (node.status === "ready" || node.status === "failed") &&
          node.assetRef
            ? [node.assetRef]
            : [],
        );
        if (refs.length) {
          return [{
            kind: "remaining-run" as const,
            storyId: analysis.storyId,
            count: refs.length,
            refs,
          }];
        }
      }
      return [];
    });
  }, [snapshot]);
  const isConfirmationBusy = Boolean(confirmingId) || Boolean(batchProgress);
  const focusedNode = focusedNodeId
    ? snapshot.nodes.find((node) => node.id === focusedNodeId)
    : undefined;

  useEffect(() => {
    if (loadConversationStore) {
      let cancelled = false;
      void loadConversationStore()
        .then((store) => {
          if (!cancelled) setConversationStore(store);
        })
        .catch(() => {
          if (!cancelled) setConversationStore(EMPTY_CONVERSATION_STORE);
        })
        .finally(() => {
          if (!cancelled) setIsHydrated(true);
        });
      return () => {
        cancelled = true;
      };
    }
    const restored = parseAgentConversationStore(
      window.localStorage.getItem(conversationStorageKey),
      legacyStorageKey
        ? window.localStorage.getItem(legacyStorageKey)
        : null,
      () => crypto.randomUUID(),
    );
    const timer = window.setTimeout(() => {
      setConversationStore(restored);
      setIsHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [conversationStorageKey, legacyStorageKey, loadConversationStore]);

  useEffect(() => {
    if (!isHydrated) return;
    if (saveConversationStore) {
      const timer = window.setTimeout(() => {
        void saveConversationStore(conversationStore);
      }, 500);
      return () => window.clearTimeout(timer);
    }
    window.localStorage.setItem(
      conversationStorageKey,
      serializeAgentConversationStore(conversationStore),
    );
    if (legacyStorageKey) window.localStorage.removeItem(legacyStorageKey);
  }, [
    conversationStore,
    conversationStorageKey,
    isHydrated,
    legacyStorageKey,
    saveConversationStore,
  ]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 180);
  }, [open]);

  useEffect(() => {
    if (!isSending) return;
    const interval = window.setInterval(() => setRequestClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [isSending]);

  useEffect(() => {
    onBusyChange?.(isSending || isConfirmationBusy);
  }, [isConfirmationBusy, isSending, onBusyChange]);

  useEffect(() => () => {
    planningAbortRef.current?.abort();
    onBusyChange?.(false);
  }, [onBusyChange]);

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

  useEffect(() => {
    if (!activeConversation) return;
    const normalizedMessages = expireIncompleteAgentConfirmations(messages);
    if (normalizedMessages === messages) return;
    const timer = window.setTimeout(() => {
      updateConversation(activeConversation.id, (conversation) => ({
        ...conversation,
        messages: normalizedMessages,
        updatedAt: Date.now(),
      }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeConversation, messages]);

  async function requestAgent(
    history: AgentMessage[],
    phase: AgentConversationPhase,
    inspectedImages?: AgentInspectedImage[],
    signal?: AbortSignal,
  ): Promise<AgentResponse> {
    const relevantHistory = history.filter((message) => message.content.trim());
    const requestHistory = relevantHistory.length <= 20
      ? relevantHistory
      : [relevantHistory[0], ...relevantHistory.slice(-19)];
    setStreamingSummary("");
    setRequestStartedAt(Date.now());
    setRequestClock(Date.now());
    return runAgentRequestWithTimeout(async (requestSignal, markActivity) => {
      const response = await fetch("/api/ai/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: requestHistory
            .map(({ role, content }) => ({ role, content })),
          canvas: getSnapshot?.() ?? snapshot,
          phase,
          focusedNodeId,
          inspectedImages,
        }),
        signal: requestSignal,
      });
      if (!response.ok) throw new Error(await readApiError(response));
      return readAgentSseResponse(
        response,
        setStreamingSummary,
        markActivity,
      );
    }, signal);
  }

  async function submit(
    contentOverride?: string,
    options?: AgentSubmitOptions,
  ): Promise<CanvasAgentAutoRequestOutcome | undefined> {
    const content = (contentOverride ?? draft).trim();
    if (!content || isSending || isConfirmationBusy || !activeConversation) {
      return {
        succeeded: false,
        error: "画布 Agent 当前不可用，请稍后重试。",
      };
    }
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
    const planningController = new AbortController();
    planningAbortRef.current = planningController;
    let activeAssetStoryId = "";
    const planningSummaries: string[] = [];
    const rememberSummary = (response: AgentResponse) => {
      if (
        response.progressSummary &&
        !planningSummaries.includes(response.progressSummary)
      ) {
        planningSummaries.push(response.progressSummary);
      }
    };
    try {
      let response = await requestAgent(
        history,
        phase,
        undefined,
        planningController.signal,
      );
      rememberSummary(response);
      if (response.inspectImageNodeIds.length) {
        if (options?.textOnly) {
          throw new Error("自动重建最终提示词只能使用已锁定的文字分镜，不能读取图片。");
        }
        const images = await onReadImages(response.inspectImageNodeIds);
        if (!images.length) throw new Error("Agent 无法读取请求的画布图片。");
        response = await requestAgent(
          history,
          phase,
          images,
          planningController.signal,
        );
        rememberSummary(response);
        if (response.inspectImageNodeIds.length) {
          throw new Error("Agent 在单轮对话中重复请求图片，请换一种说法重试。");
        }
      }
      validateAgentOperationsForSurface(snapshot.mode, response.operations);
      const planningDetails: string[] = [];
      const storyAnalysis = response.operations.filter(
        (operation): operation is AgentCreateStoryAnalysisOperation =>
          operation.type === "create_story_analysis",
      );
      const initialAssetBatches = response.operations.filter(
        (operation): operation is AgentCreateStoryAssetBatchOperation =>
          operation.type === "create_story_asset_batch",
      );
      if (storyAnalysis.length || initialAssetBatches.length) {
        if (
          storyAnalysis.length + initialAssetBatches.length !== 1 ||
          response.operations.length !== 1
        ) {
          throw new Error("Agent 每次只能返回一个剧本分析或资产批次。");
        }
        const beforeStoryIds = new Set(
          (getSnapshot?.() ?? snapshot).nodes.flatMap((node) =>
            node.storyRole === "analysis" && node.storyId ? [node.storyId] : [],
          ),
        );
        const initialOperation = storyAnalysis[0] ?? initialAssetBatches[0];
        if (initialOperation.type === "create_story_asset_batch") {
          activeAssetStoryId = initialOperation.storyId;
        }
        planningDetails.push(...onApplyOperations([initialOperation]));
        const currentSnapshot = getSnapshot?.() ?? snapshot;
        activeAssetStoryId = activeAssetStoryId || (currentSnapshot.nodes.findLast(
              (node) =>
                node.storyRole === "analysis" &&
                Boolean(node.storyId) &&
                !beforeStoryIds.has(node.storyId!),
            )?.storyId ?? "");
        if (!activeAssetStoryId) {
          throw new Error("资产规划未能获取实际短剧 ID。");
        }

        let planningHistory: AgentMessage[] = [
          ...history,
          {
            id: `asset-planning-assistant-${Date.now()}`,
            role: "assistant",
            content: JSON.stringify({
              progress_summary: response.progressSummary,
              message: response.message,
              workflow_state: response.workflowState,
              operations: [initialOperation],
            }),
            createdAt: Date.now(),
          },
        ];
        let assetCount = (getSnapshot?.() ?? snapshot).nodes.filter(
          (node) =>
            node.storyId === activeAssetStoryId && node.assetRole === "result",
        ).length;

        while (true) {
          const liveSnapshot = getSnapshot?.() ?? snapshot;
          const analysisNode = liveSnapshot.nodes.find(
            (node) =>
              node.storyId === activeAssetStoryId && node.storyRole === "analysis",
          );
          if (!analysisNode) throw new Error("短剧分析节点已不存在。");
          if (
            analysisNode.planningStatus === "awaiting-foundation-generation" ||
            analysisNode.planningStatus === "awaiting-foundation-approval"
          ) {
            break;
          }
          if (analysisNode.planningStage === "complete") break;
          const stage = analysisNode.planningStage;
          if (stage !== "character" && stage !== "scene" && stage !== "prop") {
            throw new Error("资产规划阶段无效。");
          }
          const chunkIndex = analysisNode.planningChunkIndex ?? 0;
          const existingRefs = liveSnapshot.nodes.flatMap((node) =>
            node.storyId === activeAssetStoryId && node.assetRef
              ? [node.assetRef]
              : [],
          );
          setPlanningProgress({
            batch: chunkIndex,
            count: assetCount,
            label: ASSET_STAGE_LABEL[stage],
          });
          const continuationUser: AgentMessage = {
            id: `asset-planning-user-${stage}-${chunkIndex}`,
            role: "user",
            content: `继续当前短剧 ${activeAssetStoryId} 的${ASSET_STAGE_LABEL[stage]}规划，输出 chunk_index=${chunkIndex} 的 create_story_asset_batch。每批最多 8 项；已有资产 ${existingRefs.join("、") || "无"}，不得重复；本阶段完成时 is_final=true。`,
            createdAt: Date.now(),
          };
          const continuationHistory = [...planningHistory, continuationUser];
          const nextResponse = await requestAgent(
            continuationHistory,
            "active",
            undefined,
            planningController.signal,
          );
          rememberSummary(nextResponse);
          validateAgentOperationsForSurface(
            liveSnapshot.mode,
            nextResponse.operations,
          );
          const batches = nextResponse.operations.filter(
            (operation): operation is AgentCreateStoryAssetBatchOperation =>
              operation.type === "create_story_asset_batch",
          );
          if (batches.length !== 1 || nextResponse.operations.length !== 1) {
            throw new Error("Agent 未按要求继续资产规划批次。");
          }
          const batch = batches[0];
          if (
            batch.storyId !== activeAssetStoryId ||
            batch.assetKind !== stage ||
            batch.chunkIndex !== chunkIndex
          ) {
            throw new Error("资产规划批次与当前阶段不连续。");
          }
          planningDetails.push(...onApplyOperations([batch]));
          assetCount += batch.assets.length;
          planningHistory = [
            ...continuationHistory,
            {
              id: `asset-planning-assistant-${stage}-${chunkIndex}`,
              role: "assistant",
              content: JSON.stringify({
                progress_summary: nextResponse.progressSummary,
                message: nextResponse.message,
                workflow_state: nextResponse.workflowState,
                operations: [batch],
              }),
              createdAt: Date.now(),
            },
          ];
          response = nextResponse;
        }
        const finalSnapshot = getSnapshot?.() ?? snapshot;
        const finalAnalysis = finalSnapshot.nodes.find((node) =>
          node.storyId === activeAssetStoryId && node.storyRole === "analysis"
        );
        if (finalAnalysis?.assetStrategy === "foundation-pair-v1") {
          const assetResults = finalSnapshot.nodes.filter((node) =>
            node.storyId === activeAssetStoryId &&
            node.assetRole === "result" &&
            Boolean(node.assetRef)
          );
          if (
            finalAnalysis.planningStatus === "awaiting-foundation-generation" ||
            finalAnalysis.planningStatus === "awaiting-foundation-approval"
          ) {
            const foundationRefs = ["lead", "support"].flatMap((role) => {
              const result = assetResults.find((node) => node.foundationRole === role);
              return result?.assetRef ? [result.assetRef] : [];
            });
            response = {
              ...response,
              message: "已完成剧本分析，并创建主角与核心配角两组基础资产。确认费用后两张图将并行生成；其他资产会等待基础角色质量确认。",
              workflowState: "active",
              operations: foundationRefs.length === 2
                ? [{
                    type: "run_story_assets",
                    storyId: activeAssetStoryId,
                    assetRefs: foundationRefs,
                  }]
                : [],
            };
          } else {
            const remainingRefs = assetResults.flatMap((node) =>
              !node.foundationRole && node.assetRef ? [node.assetRef] : []
            );
            response = {
              ...response,
              message: `已确认基础角色，并完成其余 ${remainingRefs.length} 项人物、场景和道具资产规划。确认费用后将批量生成这些资产。`,
              workflowState: "active",
              operations: remainingRefs.length
                ? [{
                    type: "run_story_assets",
                    storyId: activeAssetStoryId,
                    assetRefs: remainingRefs,
                  }]
                : [],
            };
          }
        } else {
          response = {
            ...response,
            message: `已完成剧本分析和 ${assetCount} 项资产规划，未创建分镜，也未发起付费生成。`,
            workflowState: "active",
            operations: [],
          };
        }
      }
      const chunks: AgentCreateStoryWorkflowOperation[] = response.operations.filter(
        (operation): operation is AgentCreateStoryWorkflowOperation =>
          operation.type === "create_story_workflow",
      );
      if (chunks.length > 1) {
        throw new Error("Agent 单批只能返回一个短剧工作流方案。");
      }
      while (chunks.length && !chunks.at(-1)!.isFinal) {
        const previous = chunks.at(-1)!;
        setPlanningProgress({
          batch: previous.chunkIndex + 1,
          count: chunks.reduce((total, chunk) => total + chunk.shots.length, 0),
          label: "分镜",
        });
        const continuationHistory: AgentMessage[] = [
          ...history,
          {
            id: `continuation-assistant-${previous.chunkIndex}`,
            role: "assistant" as const,
            content: JSON.stringify({
              message: response.message,
              operations: [previous],
            }),
            createdAt: Date.now(),
          },
          {
            id: `continuation-user-${previous.chunkIndex + 1}`,
            role: "user",
            content: `继续输出同一短剧工作流的第 ${previous.chunkIndex + 1} 批。保持 ref、标题、全局设定和模型参数完全一致，从下一个未输出分镜继续；已输出分镜为 ${chunks.flatMap((chunk) => chunk.shots.map((shot) => shot.ref)).join("、")}，不得重复；每批最多 8 镜，最后一批 is_final=true。`,
            createdAt: Date.now(),
          },
        ];
        response = await requestAgent(
          continuationHistory,
          "active",
          undefined,
          planningController.signal,
        );
        rememberSummary(response);
        validateAgentOperationsForSurface(snapshot.mode, response.operations);
        const nextChunks = response.operations.filter(
          (operation): operation is AgentCreateStoryWorkflowOperation =>
            operation.type === "create_story_workflow",
        );
        if (nextChunks.length !== 1 || response.operations.length !== 1) {
          throw new Error("Agent 未按要求继续短剧工作流分批规划。");
        }
        chunks.push(nextChunks[0]);
        mergeStoryWorkflowChunks(
          chunks.at(-1)!.isFinal
            ? chunks
            : [
                ...chunks.slice(0, -1).map((chunk) => ({ ...chunk, isFinal: false })),
                { ...chunks.at(-1)!, isFinal: true },
              ],
        );
      }
      if (chunks.length) {
        const merged = mergeStoryWorkflowChunks(chunks);
        response = {
          ...response,
          operations: [
            merged,
            ...response.operations.filter(
              (operation) => operation.type !== "create_story_workflow",
            ),
          ],
        };
      }
      const safe = response.operations.filter(
        (operation) => !isDangerousAgentOperation(operation),
      );
      const dangerous = response.operations.filter(isDangerousAgentOperation);
      const details = [
        ...planningSummaries.map((summary) => `处理摘要：${summary}`),
        ...planningDetails,
        ...onApplyOperations(safe),
      ];
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
            label: describeOperation(operation),
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
      return { succeeded: true };
    } catch (error) {
      const stopped = error instanceof DOMException && error.name === "AbortError";
      const timedOut = error instanceof AgentRequestTimeoutError;
      if (activeAssetStoryId) {
        onPlanningInterrupted?.(
          activeAssetStoryId,
          stopped ? "stopped" : "failed",
        );
      }
      const errorMessage =
        stopped
          ? activeAssetStoryId
            ? "已停止资产规划，已完成的分析和资产节点已保留。"
            : "已停止画布 Agent 请求，未应用本轮操作。"
          : timedOut
            ? activeAssetStoryId
              ? `${error.message} 已完成的分析和资产节点已保留，可发送“继续资产规划”恢复。`
              : `${error.message} 未应用本轮操作。`
            : error instanceof Error
              ? error.message
              : "画布 Agent 请求失败。";
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: [
          ...conversation.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: errorMessage,
            createdAt: Date.now(),
            details: planningSummaries.length
              ? planningSummaries.map((summary) => `处理摘要：${summary}`)
              : undefined,
          },
        ].slice(-MAX_AGENT_MESSAGES),
        updatedAt: Date.now(),
      }));
      return { succeeded: false, error: errorMessage };
    } finally {
      planningAbortRef.current = null;
      setPlanningProgress(null);
      setStreamingSummary("");
      setRequestStartedAt(null);
      setIsSending(false);
    }
  }

  useEffect(() => {
    submitRef.current = submit;
  });

  useEffect(() => {
    if (
      !open ||
      !autoRequest ||
      !isHydrated ||
      !activeConversation ||
      isSending ||
      isConfirmationBusy ||
      autoRequestHandledRef.current === autoRequest.id
    ) {
      return;
    }
    autoRequestHandledRef.current = autoRequest.id;
    const submitAutoRequest = submitRef.current;
    if (!submitAutoRequest) {
      onAutoRequestComplete?.(autoRequest.id, {
        succeeded: false,
        error: "自动请求未能启动。",
      });
      return;
    }
    void submitAutoRequest(autoRequest.content, {
      textOnly: autoRequest.textOnly,
    }).then((outcome) => {
      onAutoRequestComplete?.(
        autoRequest.id,
        outcome ?? {
          succeeded: false,
          error: "自动请求未能启动。",
        },
      );
    });
  }, [
    activeConversation,
    autoRequest,
    isConfirmationBusy,
    isHydrated,
    isSending,
    onAutoRequestComplete,
    open,
  ]);

  function expireConfirmation(conversationId: string, messageId: string) {
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.id === messageId && message.action
          ? {
              ...message,
              details: ["确认内容已失效，请重新向 Agent 提出要执行的操作。"],
              action: {
                ...message.action,
                status: "expired",
                operation: undefined,
              },
            }
          : message,
      ),
      updatedAt: Date.now(),
    }));
  }

  async function executeConfirmation(
    conversationId: string,
    messageId: string,
    operation: AgentDangerousOperation,
  ) {
    setConfirmingId(messageId);
    try {
      const detail = await runAgentConfirmationWithTimeout((signal) =>
        onConfirmOperation(operation, signal),
      );
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((item) =>
          item.id === messageId
            ? {
                ...item,
                details: [detail],
                action: item.action ? { ...item.action, status: "confirmed" } : undefined,
              }
            : item,
        ),
        updatedAt: Date.now(),
      }));
      return { succeeded: true as const };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "操作执行失败。";
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((item) =>
          item.id === messageId
            ? {
                ...item,
                details: [errorMessage],
              }
            : item,
        ),
        updatedAt: Date.now(),
      }));
      return { succeeded: false as const, error: errorMessage };
    } finally {
      setConfirmingId((current) => (current === messageId ? null : current));
    }
  }

  async function confirm(message: AgentMessage) {
    if (!activeConversation || message.action?.status !== "pending") return;
    if (!message.action.operation) {
      expireConfirmation(activeConversation.id, message.id);
      return;
    }
    setBatchSummary("");
    await executeConfirmation(
      activeConversation.id,
      message.id,
      message.action.operation,
    );
  }

  async function confirmAll() {
    if (!activeConversation || isConfirmationBusy || pendingConfirmations.length < 2) {
      return;
    }
    const conversationId = activeConversation.id;
    const confirmations = [...pendingConfirmations];
    setBatchSummary("");
    setBatchProgress({ current: 1, total: confirmations.length });

    let batchFailureDetail = "";
    const result = await runAgentConfirmationsSequentially(
      confirmations,
      async (confirmation, index, total) => {
        setBatchProgress({ current: index + 1, total });
        const outcome = await executeConfirmation(
          conversationId,
          confirmation.messageId,
          confirmation.operation,
        );
        if (!outcome.succeeded) batchFailureDetail = outcome.error;
        return outcome.succeeded;
      },
    );
    setBatchSummary(
      result.failedIndex === undefined
        ? `已确认全部 ${confirmations.length} 项操作。`
        : `已确认 ${result.completed}/${confirmations.length} 项，第 ${result.failedIndex + 1} 项失败，后续操作未执行。原因：${batchFailureDetail}`,
    );
    setBatchProgress(null);
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

  function queueAssetConfirmation(storyId: string, assetRefs: string[]) {
    if (!activeConversation || isSending || isConfirmationBusy) return;
    const operation: AgentDangerousOperation = {
      type: "run_story_assets",
      storyId,
      assetRefs,
    };
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      messages: [
        ...conversation.messages,
        {
          id: crypto.randomUUID(),
          role: "assistant" as const,
          content: "",
          createdAt: Date.now(),
          action: {
            label: describeOperation(operation),
            status: "pending" as const,
            operation,
          },
        },
      ].slice(-MAX_AGENT_MESSAGES),
      updatedAt: Date.now(),
    }));
  }

  async function approveFoundationAndContinue(storyId: string) {
    if (!onApproveFoundation || isSending || isConfirmationBusy) return;
    try {
      setBatchSummary(onApproveFoundation(storyId));
      await submit(
        `已确认短剧 ${storyId} 的主角与核心配角，继续从人物资产 chunk_index=1 规划其余人物、场景和道具；不得重复基础角色。`,
      );
    } catch (error) {
      setBatchSummary(
        error instanceof Error ? error.message : "无法确认基础角色。",
      );
    }
  }

  function startNewConversation() {
    if (isSending || isConfirmationBusy) return;
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
    setBatchSummary("");
    setIsHistoryOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function selectConversation(conversationId: string) {
    if (isSending || isConfirmationBusy) return;
    setConversationStore((current) => ({
      ...current,
      activeConversationId: conversationId,
    }));
    setDraft("");
    setBatchSummary("");
    setIsHistoryOpen(false);
  }

  function deleteConversation(conversationId: string) {
    if (isSending || isConfirmationBusy) return;
    setBatchSummary("");
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
          data-workflow-isolated
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
                <p className="m-0 text-[11px] text-zinc-500">{subtitle}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                aria-label="Agent 历史对话"
                className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
                disabled={isSending || isConfirmationBusy}
                type="button"
                onClick={() => setIsHistoryOpen((current) => !current)}
              >
                <History aria-hidden="true" size={15} />
              </button>
              <button
                aria-label="新建 Agent 对话"
                className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30"
                disabled={isSending || isConfirmationBusy}
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
              className="absolute top-[70px] right-3 left-3 z-20 max-h-[min(420px,70vh)] overflow-y-auto overscroll-y-contain rounded-2xl border border-black/10 bg-white p-2 shadow-[0_18px_54px_rgba(35,32,28,0.2)]"
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

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-5">
            {messages.length === 0 ? (
              <div className="mx-auto mt-[28vh] max-w-[270px] text-center text-sm leading-6 text-zinc-500">
                {emptyMessage}
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
                              disabled={isConfirmationBusy}
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
                              disabled={isConfirmationBusy}
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
                  <div className="mr-auto flex max-w-[92%] items-start gap-2 rounded-2xl border border-black/7 bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-500">
                    <LoaderCircle className="shrink-0 animate-spin" aria-hidden="true" size={14} />
                    <span className="min-w-0 flex-1">
                      <span className="block">
                        {planningProgress
                          ? `正在规划${planningProgress.label}第 ${planningProgress.batch + 1} 批，已完成 ${planningProgress.count} 项…`
                          : activeConversation?.phase === "active"
                            ? "正在读取画布并处理…"
                            : "正在梳理需求…"}
                        {requestStartedAt !== null
                          ? ` · 已等待 ${Math.max(0, Math.floor((requestClock - requestStartedAt) / 1_000))} 秒`
                          : ""}
                      </span>
                      {streamingSummary ? (
                        <span aria-live="polite" className="mt-1 block leading-5 text-zinc-700">
                          处理摘要：{streamingSummary}
                        </span>
                      ) : null}
                    </span>
                    <button
                      className="ml-1 shrink-0 text-zinc-700 underline underline-offset-2"
                      type="button"
                      onClick={() => planningAbortRef.current?.abort()}
                    >
                      停止
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-black/8 bg-white p-3.5">
            {contextControls}
            {foundationControls.map((control) => {
              const confirmationKey = `${control.storyId}:${[...control.refs].sort().join(",")}`;
              if (
                control.kind !== "approve" &&
                pendingAssetConfirmationKeys.has(confirmationKey)
              ) {
                return null;
              }
              return (
                <div
                  key={`${control.storyId}-${control.kind}`}
                  className="mb-3 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-[11px] leading-4 text-sky-950"
                >
                  <p className="mt-0 mb-2">
                    {control.kind === "approve"
                      ? "主角与核心配角均已生成成功。确认质量后才会继续创建其他资产节点；本操作不产生费用。"
                      : control.kind === "foundation-run"
                        ? `有 ${control.count} 个基础角色图片等待生成或重试，成功结果不会重复提交。`
                        : `有 ${control.count} 个非基础资产图片等待生成或重试。`}
                  </p>
                  <button
                    aria-label={
                      control.kind === "approve"
                        ? "确认主角与核心配角并继续"
                        : control.kind === "foundation-run"
                          ? `准备生成基础角色 ${control.count} 项`
                          : `准备生成其余资产 ${control.count} 项`
                    }
                    className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full bg-zinc-900 px-3 text-xs font-medium text-white disabled:opacity-60"
                    disabled={isSending || isConfirmationBusy}
                    type="button"
                    onClick={() => {
                      if (control.kind === "approve") {
                        void approveFoundationAndContinue(control.storyId);
                      } else {
                        queueAssetConfirmation(control.storyId, control.refs);
                      }
                    }}
                  >
                    <Check aria-hidden="true" size={13} />
                    {control.kind === "approve"
                      ? "确认基础角色并继续"
                      : control.kind === "foundation-run"
                        ? `生成/重试基础角色（${control.count}）`
                        : `生成/重试其余资产（${control.count}）`}
                  </button>
                </div>
              );
            })}
            {pendingConfirmations.length > 1 || batchProgress || batchSummary ? (
              <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-4 text-amber-900">
                {pendingConfirmations.length > 1 || batchProgress ? (
                  <button
                    aria-label={`全部确认 ${batchProgress?.total ?? pendingConfirmations.length} 项操作`}
                    className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full bg-zinc-900 px-3 text-xs font-medium text-white disabled:opacity-60"
                    disabled={isConfirmationBusy}
                    type="button"
                    onClick={() => void confirmAll()}
                  >
                    {batchProgress ? (
                      <>
                        <LoaderCircle className="animate-spin" aria-hidden="true" size={13} />
                        正在确认 {batchProgress.current}/{batchProgress.total}
                      </>
                    ) : (
                      <>
                        <Check aria-hidden="true" size={13} />
                        全部确认（{pendingConfirmations.length}）
                      </>
                    )}
                  </button>
                ) : null}
                {batchSummary ? (
                  <p aria-live="polite" className="mt-2 mb-0">
                    {batchSummary}
                  </p>
                ) : (
                  <p className="mt-2 mb-0">将按消息顺序逐项执行，遇到失败即停止。</p>
                )}
              </div>
            ) : null}
            <div className="relative rounded-2xl border border-black/10 bg-zinc-50 px-3 py-2 pr-12 focus-within:border-zinc-400">
              <textarea
                ref={inputRef}
                aria-label="给画布 Agent 发送消息"
                className="block max-h-32 min-h-12 w-full resize-none border-0 bg-transparent py-1 text-[13px] leading-5 outline-none"
                placeholder={
                  activeConversation?.phase === "active"
                    ? "描述你想对画布做什么…"
                    : intakePlaceholder
                }
                rows={2}
                value={draft}
                disabled={isConfirmationBusy}
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
                disabled={!draft.trim() || isSending || isConfirmationBusy}
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
