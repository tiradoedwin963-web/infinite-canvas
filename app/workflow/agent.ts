import type {
  AgentCreateStoryWorkflowOperation,
  AgentDangerousOperation,
  AgentInspectedImage,
  AgentOperation,
  AgentWorkflowSnapshot,
} from "../ai/agent.ts";
import type { Viewport } from "../canvas/viewport.ts";
import {
  createStoryWorkflow,
  getWorkflowNodeSize,
  readWorkflowInputs,
  updateWorkflowNode,
  updateWorkflowResult,
  type WorkflowGraph,
  type WorkflowResultNode,
  type WorkflowSchedulerNode,
} from "./graph.ts";
import {
  assetResultForScheduler,
  assetSchedulersForOperation,
  createStoryAnalysis,
  createStoryAssetBatch,
  describeStoryAssetRun,
  resetStoryFoundationApproval,
  runnableAssetSchedulers,
} from "./story-assets.ts";

export const WORKFLOW_BATCH_STORAGE_KEY = "lingke-workflow-batch-v1";

export type WorkflowBatchRun = {
  version: 1;
  id: string;
  storyId: string;
  shotRefs: string[];
  target?: "story" | "assets";
  assetRefs?: string[];
  schedulerIds: string[];
  status: "running" | "completed" | "partial-failure";
};

export function createWorkflowAgentSnapshot(
  graph: WorkflowGraph,
  viewport: Viewport,
  viewportSize: { width: number; height: number },
): AgentWorkflowSnapshot {
  const availableAssetRefs = new Set(
    graph.nodes.flatMap((node) =>
      node.type === "result" &&
      node.assetRef &&
      node.status === "success" &&
      node.resultUrl
        ? [node.assetRef]
        : [],
    ),
  );
  return {
    mode: "workflow",
    viewport: { ...viewport, ...viewportSize },
    nodes: graph.nodes.map((node) => {
      const size = getWorkflowNodeSize(node);
      const kind = node.type === "scheduler" ? node.outputKind : node.kind;
      const assetAvailable = node.assetRef
        ? availableAssetRefs.has(node.assetRef)
        : undefined;
      return {
        id: node.id,
        type: node.type,
        kind,
        x: node.x,
        y: node.y,
        width: size.width,
        height: size.height,
        ...(node.label ? { label: node.label } : {}),
        ...(node.storyId ? { storyId: node.storyId } : {}),
        ...(node.shotRef ? { shotRef: node.shotRef } : {}),
        ...(node.storyRole ? { storyRole: node.storyRole } : {}),
        ...(node.assetRef ? { assetRef: node.assetRef } : {}),
        ...(node.assetKind ? { assetKind: node.assetKind } : {}),
        ...(node.assetRole ? { assetRole: node.assetRole } : {}),
        ...(node.foundationRole ? { foundationRole: node.foundationRole } : {}),
        ...(node.assetStrategy ? { assetStrategy: node.assetStrategy } : {}),
        ...(node.foundationApprovedAt !== undefined
          ? { foundationApprovedAt: node.foundationApprovedAt }
          : {}),
        ...(node.storyVisualStyle
          ? { storyVisualStyle: node.storyVisualStyle }
          : {}),
        ...(assetAvailable !== undefined ? { assetAvailable } : {}),
        ...(node.planningStage ? { planningStage: node.planningStage } : {}),
        ...(node.planningStatus ? { planningStatus: node.planningStatus } : {}),
        ...(node.planningChunkIndex !== undefined
          ? { planningChunkIndex: node.planningChunkIndex }
          : {}),
        ...(node.projectAspectRatio
          ? { projectAspectRatio: node.projectAspectRatio }
          : {}),
        ...(node.storyImageModel ? { storyImageModel: node.storyImageModel } : {}),
        ...(node.type === "source" && node.assetName
          ? { assetName: node.assetName }
          : {}),
        text: node.type === "scheduler" ? "" : node.text,
        prompt: node.type === "scheduler" ? node.prompt : "",
        model: node.type === "source" ? "" : node.model,
        status: node.type === "result" ? node.status : "ready",
        hasVisual:
          node.type === "source"
            ? Boolean(node.assetId)
            : node.type === "result"
              ? Boolean(node.resultUrl)
              : false,
      };
    }),
    edges: graph.edges.map(({ sourceId, targetId }) => ({ sourceId, targetId })),
  };
}

export function mergeStoryWorkflowChunks(
  chunks: AgentCreateStoryWorkflowOperation[],
): AgentCreateStoryWorkflowOperation {
  if (!chunks.length) throw new Error("Agent 未返回短剧工作流方案。");
  const first = chunks[0];
  const shots = [] as AgentCreateStoryWorkflowOperation["shots"];
  const refs = new Set<string>();
  chunks.forEach((chunk, index) => {
    if (
      chunk.chunkIndex !== index ||
      chunk.ref !== first.ref ||
      chunk.title !== first.title ||
      chunk.globalContext !== first.globalContext ||
      chunk.imageModel !== first.imageModel ||
      chunk.videoModel !== first.videoModel ||
      chunk.aspectRatio !== first.aspectRatio ||
      chunk.imageResolution !== first.imageResolution ||
      chunk.videoResolution !== first.videoResolution ||
      chunk.isFinal !== (index === chunks.length - 1)
    ) {
      throw new Error("短剧工作流分批内容不连续，未创建节点。");
    }
    chunk.shots.forEach((shot) => {
      if (refs.has(shot.ref)) throw new Error(`短剧分镜 ${shot.ref} 重复。`);
      refs.add(shot.ref);
      shots.push(shot);
    });
  });
  if (!chunks.at(-1)?.isFinal) throw new Error("短剧工作流方案尚未完成。");
  return {
    ...first,
    chunkIndex: 0,
    isFinal: true,
    shots,
    adjustments: [...new Set(chunks.flatMap((chunk) => chunk.adjustments ?? []))],
  };
}

export function applyWorkflowAgentOperations(
  graph: WorkflowGraph,
  operations: AgentOperation[],
): { graph: WorkflowGraph; messages: string[] } {
  let next = graph;
  const messages: string[] = [];
  operations.forEach((operation) => {
    if (operation.type === "create_story_analysis") {
      const created = createStoryAnalysis(next, operation);
      next = created.graph;
      messages.push(
        `已创建短剧“${operation.title}”的分析节点。短剧 ID：${created.storyId}。`,
        ...(operation.adjustments ?? []),
      );
      return;
    }
    if (operation.type === "create_story_asset_batch") {
      const created = createStoryAssetBatch(next, operation);
      next = created.graph;
      messages.push(
        `已添加 ${operation.assets.length} 个${operation.assetKind === "character" ? "人物" : operation.assetKind === "scene" ? "场景" : "道具"}资产。`,
        ...(operation.adjustments ?? []),
      );
      return;
    }
    if (operation.type !== "create_story_workflow") {
      messages.push("当前工作流画布不支持此普通操作。");
      return;
    }
    const created = createStoryWorkflow(next, operation);
    next = created.graph;
    messages.push(
      `已创建短剧“${operation.title}”：${operation.shots.length} 个分镜、${operation.shots.length * 5 + 1} 个节点。短剧 ID：${created.storyId}。`,
      ...(operation.adjustments ?? []),
    );
  });
  return { graph: next, messages };
}

export function createWorkflowBatchRun(
  graph: WorkflowGraph,
  operation: Extract<AgentDangerousOperation, { type: "run_story_workflow" }>,
  idFactory = () => crypto.randomUUID(),
): WorkflowBatchRun {
  const selected = new Set(operation.shotRefs);
  const storySchedulers = graph.nodes.filter(
    (node): node is WorkflowSchedulerNode =>
      node.type === "scheduler" &&
      node.storyId === operation.storyId &&
      (node.storyRole === "storyboard-scheduler" ||
        node.storyRole === "video-scheduler"),
  );
  if (!storySchedulers.length) throw new Error("未找到可批量生成的短剧工作流。");
  if (
    selected.size &&
    [...selected].some(
      (shotRef) => !storySchedulers.some((node) => node.shotRef === shotRef),
    )
  ) {
    throw new Error("部分指定分镜已不存在，请重新提出批量生成要求。");
  }
  const schedulers = storySchedulers.filter(
    (node) => !selected.size || Boolean(node.shotRef && selected.has(node.shotRef)),
  );
  return {
    version: 1,
    id: idFactory(),
    storyId: operation.storyId,
    shotRefs: [...selected],
    target: "story",
    schedulerIds: schedulers.map((node) => node.id),
    status: "running",
  };
}

export function createStoryAssetBatchRun(
  graph: WorkflowGraph,
  operation: Extract<AgentDangerousOperation, { type: "run_story_assets" }>,
  idFactory = () => crypto.randomUUID(),
) {
  assetSchedulersForOperation(graph, operation);
  const schedulers = runnableAssetSchedulers(graph, operation, true);
  if (!schedulers.length) throw new Error("没有可提交的资产图片任务。");
  let next = schedulers.some((scheduler) => scheduler.foundationRole)
    ? resetStoryFoundationApproval(graph, operation.storyId)
    : graph;
  schedulers.forEach((scheduler) => {
    const result = assetResultForScheduler(next, scheduler.id);
    if (!result) return;
    next = updateWorkflowResult(next, result.id, {
      status: "ready",
      progress: "待生成",
      error: "",
    });
  });
  return {
    graph: next,
    batch: {
      version: 1 as const,
      id: idFactory(),
      storyId: operation.storyId,
      shotRefs: [],
      target: "assets" as const,
      assetRefs: operation.assetRefs,
      schedulerIds: schedulers.map((node) => node.id),
      status: "running" as const,
    },
  };
}

export function parseWorkflowBatchRun(raw: string | null): WorkflowBatchRun | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<WorkflowBatchRun>;
    return value.version === 1 &&
      typeof value.id === "string" &&
      typeof value.storyId === "string" &&
      Array.isArray(value.shotRefs) &&
      value.shotRefs.every((item) => typeof item === "string") &&
      Array.isArray(value.schedulerIds) &&
      value.schedulerIds.every((item) => typeof item === "string") &&
      (value.target === undefined || value.target === "story" || value.target === "assets") &&
      (value.assetRefs === undefined ||
        (Array.isArray(value.assetRefs) && value.assetRefs.every((item) => typeof item === "string"))) &&
      (value.status === "running" ||
        value.status === "completed" ||
        value.status === "partial-failure")
      ? (value as WorkflowBatchRun)
      : null;
  } catch {
    return null;
  }
}

function resultForScheduler(graph: WorkflowGraph, schedulerId: string) {
  return graph.nodes.find(
    (node): node is WorkflowResultNode =>
      node.type === "result" &&
      node.schedulerId === schedulerId &&
      Boolean(node.storyRole),
  );
}

export function advanceWorkflowBatch(
  graph: WorkflowGraph,
  batch: WorkflowBatchRun,
): {
  graph: WorkflowGraph;
  readySchedulerIds: string[];
  batch: WorkflowBatchRun;
} {
  if (batch.status !== "running") {
    return { graph, readySchedulerIds: [], batch };
  }
  let next = graph;
  const readySchedulerIds: string[] = [];
  batch.schedulerIds.forEach((schedulerId) => {
    const scheduler = next.nodes.find(
      (node): node is WorkflowSchedulerNode =>
        node.id === schedulerId && node.type === "scheduler",
    );
    const result = resultForScheduler(next, schedulerId);
    if (!scheduler || !result || result.status !== "ready") return;
    const inputs = readWorkflowInputs(next, schedulerId);
    const failedUpstream = [...inputs.images, ...inputs.videos].find(
      (node) =>
        node.type === "result" &&
        (node.status === "failed" || node.status === "paused"),
    );
    if (failedUpstream) {
      next = updateWorkflowNode(next, schedulerId, {
        error: "上游分镜生成失败，已停止当前分支。",
      });
      next = updateWorkflowResult(next, result.id, {
        status: "failed",
        progress: "",
        error: "上游分镜生成失败，未提交当前任务。",
      });
      return;
    }
    const waiting = [...inputs.images, ...inputs.videos].some(
      (node) => node.type === "result" && node.status !== "success",
    );
    if (!waiting) readySchedulerIds.push(schedulerId);
  });
  const results = batch.schedulerIds
    .map((schedulerId) => resultForScheduler(next, schedulerId))
    .filter((node): node is WorkflowResultNode => Boolean(node));
  const finished =
    results.length === batch.schedulerIds.length &&
    results.every((node) =>
      ["success", "failed", "paused"].includes(node.status),
    );
  const failed = results.some(
    (node) => node.status === "failed" || node.status === "paused",
  );
  return {
    graph: next,
    readySchedulerIds,
    batch: finished
      ? { ...batch, status: failed ? "partial-failure" : "completed" }
      : batch,
  };
}

export function describeWorkflowRun(
  graph: WorkflowGraph,
  operation: Extract<AgentDangerousOperation, { type: "run_story_workflow" }>,
) {
  const selected = new Set(operation.shotRefs);
  const schedulers = graph.nodes.filter(
    (node): node is WorkflowSchedulerNode =>
      node.type === "scheduler" &&
      node.storyId === operation.storyId &&
      (!selected.size || Boolean(node.shotRef && selected.has(node.shotRef))),
  );
  const images = schedulers.filter((node) => node.outputKind === "image").length;
  const videos = schedulers.filter((node) => node.outputKind === "video").length;
  return `批量生成 ${images} 个分镜图片和 ${videos} 个视频片段；依赖就绪的同层任务将全部并行，可能产生 ${images + videos} 笔模型费用`;
}

export { describeStoryAssetRun };

export type WorkflowReadImages = (
  nodeIds: string[],
) => Promise<AgentInspectedImage[]>;
