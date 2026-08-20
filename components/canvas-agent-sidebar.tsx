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
  AgentRequestTimeoutError,
  createMangaRecoveryInstruction,
  getMangaShotPlanningContext,
  createAgentConversation,
  createAgentConversationTitle,
  compactMangaPlanningSnapshot,
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
  type AgentCreateMangaContinuityReportOperation,
  type AgentCreateMangaScenePlansOperation,
  type AgentCreateMangaShotBatchOperation,
  type AgentCreateMangaStoryBeatsOperation,
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
  type AgentStoryboardMode,
  type AgentMangaStoryboardTempo,
  type AgentMangaPlanningStage,
  type AgentWorkflowSnapshot,
} from "@/app/ai/agent";
import { AgentSseError, readAgentSseResponse } from "@/app/ai/agent-stream";
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

const MANGA_STAGE_LABEL: Record<Exclude<AgentMangaPlanningStage, "complete">, string> = {
  "story-beats": "剧情与情绪节拍",
  "scene-plans": "场面调度",
  "shot-plans": "镜头规划",
  continuity: "连续性检查",
};

type MangaPlanningOperation =
  | AgentCreateMangaStoryBeatsOperation
  | AgentCreateMangaScenePlansOperation
  | AgentCreateMangaShotBatchOperation
  | AgentCreateMangaContinuityReportOperation;

function isMangaPlanningOperation(
  operation: AgentOperation,
): operation is MangaPlanningOperation {
  return operation.type === "create_manga_story_beats" ||
    operation.type === "create_manga_scene_plans" ||
    operation.type === "create_manga_shot_batch" ||
    operation.type === "create_manga_continuity_report";
}

function requireWorkflowSnapshot(snapshot: AgentSurfaceSnapshot): AgentWorkflowSnapshot {
  if (snapshot.mode !== "workflow") {
    throw new Error("漫剧导演只能在工作流画布运行。");
  }
  return snapshot;
}

function isActiveMangaDirector(snapshot: AgentSurfaceSnapshot) {
  return snapshot.mode === "workflow" && snapshot.nodes.some((node) =>
    node.storyRole === "analysis" &&
    node.storyboardMode === "comic" &&
    node.mangaPlanningStage &&
    node.mangaPlanningStage !== "complete",
  );
}

function mangaDirectorHistory(
  history: AgentMessage[],
  snapshot: AgentSurfaceSnapshot,
) {
  const stage = snapshot.mode === "workflow"
    ? snapshot.nodes.find((node) =>
      node.storyRole === "analysis" &&
      node.storyboardMode === "comic" &&
      node.mangaPlanningStage &&
      node.mangaPlanningStage !== "complete"
    )?.mangaPlanningStage
    : undefined;
  if (stage && stage !== "story-beats") return history.slice(-1);
  const scriptMessage = history.find((message) => message.role === "user");
  return scriptMessage ? [scriptMessage] : history.slice(-1);
}

function isRecoverableMangaResponseError(error: unknown) {
  return error instanceof AgentSseError &&
    (error.code === "response-envelope" || error.code === "missing-operations");
}

function mangaRecoveryHistory(
  history: AgentMessage[],
  snapshot: AgentSurfaceSnapshot,
) {
  const instruction = createMangaRecoveryInstruction(snapshot);
  if (!instruction || snapshot.mode !== "workflow") return null;
  const analysis = snapshot.nodes.find((node) =>
    node.storyRole === "analysis" &&
    node.storyboardMode === "comic" &&
    node.mangaPlanningStage &&
    node.mangaPlanningStage !== "complete"
  );
  const recovery: AgentMessage = {
    id: `manga-recovery-${analysis?.mangaPlanningStage ?? "unknown"}-${Date.now()}`,
    role: "user",
    content: instruction,
    createdAt: Date.now(),
  };
  if (analysis?.mangaPlanningStage !== "story-beats") return [recovery];
  const scriptMessage = history.find((message) => message.role === "user");
  return scriptMessage ? [scriptMessage, recovery] : [recovery];
}

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
  onSelectStoryboardMode?: (
    storyId: string,
    mode: AgentStoryboardMode,
    tempo?: AgentMangaStoryboardTempo,
  ) => void;
  onApproveContinuity?: (storyId: string) => void;
  onConfirmOperation: (
    operation: AgentDangerousOperation,
    signal: AbortSignal,
  ) => Promise<string>;
  onReadImages: (nodeIds: string[]) => Promise<AgentInspectedImage[]>;
  describeOperation?: (operation: AgentDangerousOperation) => string;
  onBusyChange?: (busy: boolean) => void;
  loadConversationStore?: () => Promise<AgentConversationStore>;
  saveConversationStore?: (store: AgentConversationStore) => Promise<void>;
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
  onSelectStoryboardMode,
  onApproveContinuity,
  onConfirmOperation,
  onReadImages,
  describeOperation = describeDangerousOperation,
  onBusyChange,
  loadConversationStore,
  saveConversationStore,
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
  const [mangaTempoByStory, setMangaTempoByStory] = useState<
    Record<string, AgentMangaStoryboardTempo>
  >({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const planningAbortRef = useRef<AbortController | null>(null);
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
  const storyboardControls = useMemo(() => {
    if (snapshot.mode !== "workflow") return [];
    return snapshot.nodes.flatMap((analysis) => {
      if (
        analysis.storyRole !== "analysis" ||
        !analysis.storyId ||
        analysis.planningStage !== "complete" ||
        analysis.planningStatus !== "complete" ||
        !analysis.foundationApprovedAt
      ) {
        return [];
      }
      const results = snapshot.nodes.filter((node) =>
        node.storyId === analysis.storyId &&
        node.assetRole === "result" &&
        Boolean(node.assetRef),
      );
      if (!results.length || results.some((node) => !node.assetAvailable)) return [];
      return [{
        storyId: analysis.storyId,
        mode: analysis.storyboardMode,
        mangaStoryboardTempo: analysis.mangaStoryboardTempo ?? "long-form",
        assetCount: results.length,
        mangaPlanningStage: analysis.mangaPlanningStage,
        mangaPlanningStatus: analysis.mangaPlanningStatus,
        warningCount: snapshot.nodes.find((node) =>
          node.storyId === analysis.storyId && node.storyRole === "continuity-report"
        )?.continuityReport?.issues.filter((issue) => issue.severity === "warning").length ?? 0,
        locked: snapshot.nodes.some((node) =>
          node.storyId === analysis.storyId && node.storyRole === "video-scheduler"
        ),
      }];
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
    setConversationStore(
      parseAgentConversationStore(
        window.localStorage.getItem(conversationStorageKey),
        legacyStorageKey
          ? window.localStorage.getItem(legacyStorageKey)
          : null,
        () => crypto.randomUUID(),
      ),
    );
    setIsHydrated(true);
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
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      messages: normalizedMessages,
      updatedAt: Date.now(),
    }));
  }, [activeConversation, messages]);

  async function requestAgent(
    history: AgentMessage[],
    phase: AgentConversationPhase,
    inspectedImages?: AgentInspectedImage[],
    signal?: AbortSignal,
    allowMangaRecovery = true,
  ): Promise<AgentResponse> {
    const relevantHistory = history.filter((message) => message.content.trim());
    const requestHistory = relevantHistory.length <= 20
      ? relevantHistory
      : [relevantHistory[0], ...relevantHistory.slice(-19)];
    setStreamingSummary("");
    setRequestStartedAt(Date.now());
    setRequestClock(Date.now());
    try {
      const result = await runAgentRequestWithTimeout(async (requestSignal, markActivity) => {
        const response = await fetch("/api/ai/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: requestHistory
              .map(({ role, content }) => ({ role, content })),
            canvas: compactMangaPlanningSnapshot(getSnapshot?.() ?? snapshot),
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
      if (
        !inspectedImages?.length &&
        createMangaRecoveryInstruction(getSnapshot?.() ?? snapshot) &&
        !result.operations.length
      ) {
        throw new AgentSseError(
          "Agent 未返回当前漫剧导演阶段所需的操作。",
          "missing-operations",
        );
      }
      return result;
    } catch (error) {
      const recoveryHistory = allowMangaRecovery && !inspectedImages?.length &&
        isRecoverableMangaResponseError(error)
        ? mangaRecoveryHistory(history, getSnapshot?.() ?? snapshot)
        : null;
      if (!recoveryHistory) throw error;
      setStreamingSummary("上游响应未形成可校验操作，正在使用精简上下文恢复本批规划…");
      try {
        return await requestAgent(
          recoveryHistory,
          "active",
          undefined,
          signal,
          false,
        );
      } catch (recoveryError) {
        if (recoveryError instanceof AgentSseError) {
          throw new AgentSseError(
            `漫剧导演恢复续批仍未返回有效操作：${recoveryError.message} 已停止本批，未创建节点。`,
            "manga-recovery-failed",
          );
        }
        throw recoveryError;
      }
    }
  }

  async function submit(contentOverride?: string) {
    const content = (contentOverride ?? draft).trim();
    if (!content || isSending || isConfirmationBusy || !activeConversation) return;
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
    let activeMangaStoryId = "";
    const planningSummaries: string[] = [];
    const planningDetails: string[] = [];
    const rememberSummary = (response: AgentResponse) => {
      if (
        response.progressSummary &&
        !planningSummaries.includes(response.progressSummary)
      ) {
        planningSummaries.push(response.progressSummary);
      }
    };
    try {
      const initialSnapshot = getSnapshot?.() ?? snapshot;
      if (isActiveMangaDirector(initialSnapshot) && initialSnapshot.mode === "workflow") {
        activeMangaStoryId = initialSnapshot.nodes.find((node) =>
          node.storyRole === "analysis" &&
          node.storyboardMode === "comic" &&
          node.mangaPlanningStage &&
          node.mangaPlanningStage !== "complete" &&
          Boolean(node.storyId)
        )?.storyId ?? "";
      }
      const initialHistory = isActiveMangaDirector(initialSnapshot)
        ? mangaDirectorHistory(history, initialSnapshot)
        : history;
      let response = await requestAgent(
        initialHistory,
        phase,
        undefined,
        planningController.signal,
      );
      rememberSummary(response);
      if (response.inspectImageNodeIds.length) {
        const images = await onReadImages(response.inspectImageNodeIds);
        if (!images.length) throw new Error("Agent 无法读取请求的画布图片。");
        response = await requestAgent(
          initialHistory,
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
      const initialMangaOperations = response.operations.filter(
        isMangaPlanningOperation,
      );
      if (initialMangaOperations.length) {
        requireWorkflowSnapshot(snapshot);
        if (
          initialMangaOperations.length !== 1 ||
          response.operations.length !== 1
        ) {
          throw new Error("Agent 每次只能返回一个漫剧导演阶段操作。");
        }
        let mangaOperation = initialMangaOperations[0];
        const mangaStoryId = mangaOperation.storyId;
        activeMangaStoryId = mangaStoryId;
        planningDetails.push(...onApplyOperations([mangaOperation]));
        const mangaHistory = mangaDirectorHistory(
          history,
          requireWorkflowSnapshot(getSnapshot?.() ?? snapshot),
        );

        while (true) {
          const liveSnapshot = requireWorkflowSnapshot(getSnapshot?.() ?? snapshot);
          const analysis = liveSnapshot.nodes.find((node) =>
            node.storyId === mangaStoryId && node.storyRole === "analysis"
          );
          if (!analysis?.mangaPlanningStage) {
            throw new Error("漫剧导演规划状态未能写入分析节点。");
          }
          if (analysis.mangaPlanningStage === "complete") break;
          const stage = analysis.mangaPlanningStage;
          const chunkIndex = analysis.mangaPlanningChunkIndex ?? 0;
          const shotContext = getMangaShotPlanningContext(
            liveSnapshot,
            mangaStoryId,
          );
          if (!shotContext) {
            throw new Error("无法读取当前漫剧镜头续批状态。");
          }
          const shotCount = shotContext.shotCount;
          setPlanningProgress({
            batch: chunkIndex,
            count: shotCount,
            label: MANGA_STAGE_LABEL[stage],
          });
          const expectedType = stage === "story-beats"
            ? "create_manga_story_beats"
            : stage === "scene-plans"
              ? "create_manga_scene_plans"
              : stage === "shot-plans"
                ? "create_manga_shot_batch"
                : "create_manga_continuity_report";
          const continuationUser: AgentMessage = {
            id: `manga-director-user-${stage}-${chunkIndex}`,
            role: "user",
            content: stage === "shot-plans"
              ? `继续短剧 ${mangaStoryId} 的镜头规划，只返回 ${expectedType}。操作字段 chunk_index 必须严格等于 ${chunkIndex}，这是批次编号，不是镜头编号；已有 ${shotCount} 镜。本批仅规划 1 至 2 镜：若返回 1 镜，shots[0] 必须为 shot_id=${shotContext.nextShotRef}、sequence=${shotContext.nextSequence}；若返回 2 镜，必须依次为 ${shotContext.nextShotRef}/${shotContext.nextSequence} 和 ${shotContext.followingShotRef}/${shotContext.nextSequence + 1}，不得重复、跳号或改写既有镜头。当前尚未覆盖的剧情节拍为：${shotContext.uncoveredBeatIds.join("、") || "无"}；本批必须优先覆盖这些节拍，不得用已覆盖节拍替代。核心摄影、资产、时长、时间轴和禁止项字段必须完整；无对白、旁白或声音等可推导字段可省略，由系统填“无”。仅输出 Schema 允许的蛇形字段，不要输出 video_prompt 或其他额外字段。${analysis.mangaStoryboardTempo === "short-cut" ? "当前为短片剪辑：每镜严格为2或3秒，时间轴用连续整数秒区间；视频将按场景合并为最长30秒片段。" : "当前为长镜直出：普通镜头10至15秒，5至9秒必须说明原因，时间轴用连续整数秒区间。"}只有尚未覆盖列表在本批后变为空时 is_final=true。`
              : `继续短剧 ${mangaStoryId} 的 ${MANGA_STAGE_LABEL[stage]} 阶段，只返回 ${expectedType}，不得返回其他操作或运行生成。`,
            createdAt: Date.now(),
          };
          const continuationHistory = [...mangaHistory, continuationUser];
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
          const nextOperations = nextResponse.operations.filter(
            isMangaPlanningOperation,
          );
          if (
            nextOperations.length !== 1 ||
            nextResponse.operations.length !== 1 ||
            nextOperations[0].storyId !== mangaStoryId ||
            nextOperations[0].type !== expectedType
          ) {
            throw new Error("Agent 未按当前阶段返回连续的漫剧导演操作。");
          }
          mangaOperation = nextOperations[0];
          planningDetails.push(...onApplyOperations([mangaOperation]));
          response = nextResponse;
        }
        const finalAnalysis = requireWorkflowSnapshot(getSnapshot?.() ?? snapshot).nodes.find((node) =>
          node.storyId === mangaStoryId && node.storyRole === "analysis"
        );
        response = {
          ...response,
          message: finalAnalysis?.mangaPlanningStatus === "awaiting-continuity-approval"
            ? "秒级漫剧视频工作流已创建。连续性报告仍有警告，请检查并确认后再生成视频。"
            : "秒级漫剧视频工作流已创建并通过连续性检查。未运行任何图片或视频生成。",
          operations: [],
        };
      }
      const chunks: AgentCreateStoryWorkflowOperation[] = response.operations.filter(
        (operation): operation is AgentCreateStoryWorkflowOperation =>
          operation.type === "create_story_workflow",
      );
      if (chunks.length && chunks.length !== response.operations.length) {
        throw new Error("Agent 分镜规划响应中包含了其他操作。");
      }
      if (chunks.length) {
        mergeStoryWorkflowChunks(chunks, Boolean(chunks.at(-1)?.isFinal));
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
        if (!nextChunks.length || nextChunks.length !== response.operations.length) {
          throw new Error("Agent 未按要求继续短剧工作流分批规划。");
        }
        chunks.push(...nextChunks);
        mergeStoryWorkflowChunks(chunks, Boolean(chunks.at(-1)?.isFinal));
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
    } catch (error) {
      const stopped = error instanceof DOMException && error.name === "AbortError";
      const timedOut = error instanceof AgentRequestTimeoutError;
      if (activeAssetStoryId || activeMangaStoryId) {
        onPlanningInterrupted?.(
          activeAssetStoryId || activeMangaStoryId,
          stopped ? "stopped" : "failed",
        );
      }
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: [
          ...conversation.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content:
              stopped
                ? activeAssetStoryId
                  ? "已停止资产规划，已完成的分析和资产节点已保留。"
                  : activeMangaStoryId
                    ? "已停止漫剧导演规划，已完成的阶段节点已保留。"
                  : "已停止画布 Agent 请求，未应用本轮操作。"
                : timedOut
                  ? activeAssetStoryId
                    ? `${error.message} 已完成的分析和资产节点已保留，可发送“继续资产规划”恢复。`
                    : activeMangaStoryId
                      ? `${error.message} 已完成的导演阶段节点已保留，可点击“继续漫剧导演规划”恢复。`
                    : `${error.message} 未应用本轮操作。`
                : error instanceof Error
                  ? error.message
                  : "画布 Agent 请求失败。",
            createdAt: Date.now(),
            details: planningSummaries.length
              ? planningSummaries.map((summary) => `处理摘要：${summary}`)
              : undefined,
          },
        ].slice(-MAX_AGENT_MESSAGES),
        updatedAt: Date.now(),
      }));
    } finally {
      planningAbortRef.current = null;
      setPlanningProgress(null);
      setStreamingSummary("");
      setRequestStartedAt(null);
      setIsSending(false);
    }
  }

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
            {storyboardControls.map((control) => (
              <div
                key={`${control.storyId}-storyboard-mode`}
                className="mb-3 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-[11px] leading-4 text-violet-950"
              >
                <p className="mt-0 mb-2">
                  {control.mangaPlanningStatus === "awaiting-continuity-approval"
                    ? `视频工作流已经创建，但连续性报告仍有 ${control.warningCount} 个警告；确认前禁止提交生成。`
                    : control.locked
                      ? "当前项目已经创建秒级漫剧视频工作流，分镜类型已锁定。"
                    : `资产库已就绪（${control.assetCount} 项）。请选择本项目的分镜能力。`}
                </p>
                {control.mode !== "comic" ? (
                  <>
                    <p className="mt-0 mb-2">先选择漫剧的项目级镜头节奏；创建首个镜头后不能切换。</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        ["long-form", "长镜直出"],
                        ["short-cut", "短片剪辑"],
                      ] as const).map(([tempo, label]) => (
                        <button
                          key={tempo}
                          aria-label={`选择${label}`}
                          className={`inline-flex h-8 items-center justify-center rounded-full border px-3 text-xs font-medium ${
                            (mangaTempoByStory[control.storyId] ?? "long-form") === tempo
                              ? "border-zinc-900 bg-zinc-900 text-white"
                              : "border-violet-200 bg-white text-violet-950"
                          }`}
                          disabled={control.locked || isSending || isConfirmationBusy}
                          type="button"
                          onClick={() => setMangaTempoByStory((current) => ({
                            ...current,
                            [control.storyId]: tempo,
                          }))}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      aria-label="确认漫剧节奏并开始导演规划"
                      className="mt-2 inline-flex h-8 w-full items-center justify-center rounded-full bg-zinc-900 px-3 text-xs font-medium text-white disabled:opacity-60"
                      disabled={control.locked || isSending || isConfirmationBusy}
                      type="button"
                      onClick={() => onSelectStoryboardMode?.(
                        control.storyId,
                        "comic",
                        mangaTempoByStory[control.storyId] ?? "long-form",
                      )}
                    >
                      确认漫剧节奏并开始规划
                    </button>
                  </>
                ) : (
                  <p className="mt-0 mb-2">当前制作规则：{control.mangaStoryboardTempo === "short-cut" ? "短片剪辑（每行2–3秒，按场景合并视频片段）" : "长镜直出（普通镜头10–15秒）"}。</p>
                )}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    aria-label="TVC 分镜待开发"
                    className="inline-flex h-8 items-center justify-center rounded-full border border-violet-200 bg-white px-3 text-xs font-medium text-violet-500 opacity-70"
                    disabled
                    type="button"
                  >
                    TVC · 待开发
                  </button>
                </div>
                {control.mode === "comic" &&
                control.mangaPlanningStage &&
                control.mangaPlanningStage !== "complete" &&
                !control.locked ? (
                  <button
                    aria-label="开始规划漫剧分镜"
                    className="mt-2 inline-flex h-8 w-full items-center justify-center rounded-full bg-violet-700 px-3 text-xs font-medium text-white disabled:opacity-60"
                    disabled={isSending || isConfirmationBusy}
                    type="button"
                    onClick={() => void submit(
                      control.mangaPlanningStage === "story-beats"
                        ? "请启动当前短剧的漫剧导演流程。当前只完成剧情与情绪节拍阶段，返回 create_manga_story_beats；后续阶段由客户端按顺序继续。不得运行图片或视频生成。"
                        : `继续当前短剧的漫剧导演流程，从 ${control.mangaPlanningStage} 阶段恢复；只返回当前阶段对应的专用操作，不得运行图片或视频生成。`,
                    )}
                  >
                    {control.mangaPlanningStage === "story-beats"
                      ? "开始规划漫剧分镜"
                      : "继续漫剧导演规划"}
                  </button>
                ) : null}
                {control.mangaPlanningStatus === "awaiting-continuity-approval" ? (
                  <button
                    aria-label="确认连续性警告并允许生成"
                    className="mt-2 inline-flex h-8 w-full items-center justify-center rounded-full bg-amber-700 px-3 text-xs font-medium text-white disabled:opacity-60"
                    disabled={isSending || isConfirmationBusy}
                    type="button"
                    onClick={() => onApproveContinuity?.(control.storyId)}
                  >
                    确认警告并允许生成
                  </button>
                ) : null}
              </div>
            ))}
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
