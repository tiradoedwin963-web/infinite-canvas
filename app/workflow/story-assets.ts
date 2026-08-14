import type {
  AgentCreateStoryAnalysisOperation,
  AgentCreateStoryAssetBatchOperation,
  AgentRunStoryAssetsOperation,
  AgentStoryAssetKind,
} from "../ai/agent.ts";
import { DEFAULT_MODEL_BY_MODE } from "../ai/models.ts";
import {
  WORKFLOW_NODE_WIDTH,
  getWorkflowNodeSize,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowResultNode,
  type WorkflowSchedulerNode,
} from "./graph.ts";

type IdFactory = () => string;

const COLUMN_STEP = WORKFLOW_NODE_WIDTH + 120;
const ROW_STEP = 440;

const NEXT_STAGE: Record<AgentStoryAssetKind, AgentStoryAssetKind | "complete"> = {
  character: "scene",
  scene: "prop",
  prop: "complete",
};

const ASSET_KIND_LABEL: Record<AgentStoryAssetKind, string> = {
  character: "人物",
  scene: "场景",
  prop: "道具",
};

function analysisText(operation: AgentCreateStoryAnalysisOperation) {
  return [
    `类型：${operation.analysis.genre}`,
    `主题：${operation.analysis.theme}`,
    `受众：${operation.analysis.audience}`,
    `情绪：${operation.analysis.emotion}`,
    `预计时长：${operation.analysis.estimatedDuration}`,
    `项目比例：${operation.projectAspectRatio}`,
    ...(operation.analysis.visualStyle
      ? [`统一视觉风格：${operation.analysis.visualStyle}`]
      : []),
    operation.analysis.visualStyle
      ? "资产规划：主角与核心配角 → 人物 → 场景 → 道具"
      : "资产规划：人物 → 场景 → 道具",
  ].join("\n");
}

function assetText(
  kind: AgentStoryAssetKind,
  asset: AgentCreateStoryAssetBatchOperation["assets"][number],
) {
  return [
    `类型：${ASSET_KIND_LABEL[kind]}`,
    `名称：${asset.name}`,
    `描述：${asset.description}`,
    `建档原因：${asset.reason}`,
    `出现位置：${asset.occurrences.join("、")}`,
    ...(asset.foundationRole === "lead"
      ? ["基础角色：主角（图1）"]
      : asset.foundationRole === "support"
        ? ["基础角色：核心配角（图2）"]
        : []),
  ].join("\n");
}

function foundationPrompt(
  asset: AgentCreateStoryAssetBatchOperation["assets"][number],
  visualStyle: string,
) {
  return [
    asset.imagePrompt,
    `统一视觉风格：${visualStyle}`,
    "人物综合参考图必须包含正面全身、左侧面全身、右侧面全身、中性表情和剧情中最重要的三种表情；同一图内保持脸型、发型、服装、体型和配色一致。",
  ].filter(Boolean).join("\n\n");
}

function dependentPrompt(
  kind: AgentStoryAssetKind,
  asset: AgentCreateStoryAssetBatchOperation["assets"][number],
  visualStyle: string,
) {
  if (kind === "character") {
    return [
      `将图1中人物换成：${asset.description}。`,
      "该人物与图2属于同一个故事，因此人物特征、时代、服装体系和造型语言保持相似，但身份特征必须清晰区分。",
      `保持图1原创的${visualStyle}，匹配背景、画笔纹理、边缘质量、色彩渲染、光影和分辨率质感。`,
      "不要平滑、锐化、去噪、照片化或改变原创绘画风格。",
      asset.imagePrompt,
    ].join("\n\n");
  }
  if (kind === "scene") {
    return [
      `以图1主角和图2核心配角作为同一故事世界与原创绘画风格参考，生成场景：${asset.description}。`,
      `严格匹配${visualStyle}，以及两张参考图的绘画媒介、笔触、边缘质量、色彩和光影。`,
      "场景中不要复制、出现或突出图1和图2的人物，不要添加照片细节，不要平滑、锐化或去噪。",
      asset.imagePrompt,
    ].join("\n\n");
  }
  return [
    `以图1主角和图2核心配角作为同一故事世界与原创绘画风格参考，生成独立道具：${asset.description}。`,
    `严格匹配${visualStyle}，以及两张参考图的绘画媒介、笔触、边缘质量、色彩、光影和分辨率质感。`,
    "突出道具造型、材质和辨识细节，不要出现人物，不要照片化、平滑、锐化或去噪。",
    asset.imagePrompt,
  ].join("\n\n");
}

function rightAppendOrigin(graph: WorkflowGraph) {
  const right = graph.nodes.reduce((maximum, node) => {
    const size = getWorkflowNodeSize(node);
    return Math.max(maximum, node.x + size.width);
  }, -160);
  return {
    x: right + 160,
    y: graph.nodes.length ? Math.min(...graph.nodes.map((node) => node.y)) : 0,
  };
}

export function createStoryAnalysis(
  graph: WorkflowGraph,
  operation: AgentCreateStoryAnalysisOperation,
  idFactory: IdFactory = () => crypto.randomUUID(),
) {
  const origin = rightAppendOrigin(graph);
  const storyId = idFactory();
  const analysisNodeId = idFactory();
  const foundationStrategy = Boolean(operation.analysis.visualStyle);
  const node: WorkflowNode = {
    id: analysisNodeId,
    x: origin.x,
    y: origin.y,
    type: "source",
    kind: "text",
    text: analysisText(operation),
    label: `${operation.title} · 剧本分析 · ${foundationStrategy ? "基础角色规划中" : "人物资产规划中"}`,
    storyId,
    storyRole: "analysis",
    planningStage: "character",
    planningStatus: "planning",
    planningChunkIndex: 0,
    projectAspectRatio: operation.projectAspectRatio,
    storyImageModel: operation.imageModel,
    ...(foundationStrategy
      ? {
          assetStrategy: "foundation-pair-v1" as const,
          storyVisualStyle: operation.analysis.visualStyle,
        }
      : {}),
  };
  return {
    storyId,
    analysisNodeId,
    graph: { ...graph, nodes: [...graph.nodes, node] },
  };
}

function findAnalysis(graph: WorkflowGraph, storyId: string) {
  return graph.nodes.find(
    (node) => node.storyId === storyId && node.storyRole === "analysis",
  );
}

function foundationResult(
  graph: WorkflowGraph,
  storyId: string,
  role: "lead" | "support",
) {
  return graph.nodes.find(
    (node): node is WorkflowResultNode =>
      node.type === "result" &&
      node.storyId === storyId &&
      node.assetRole === "result" &&
      node.foundationRole === role,
  );
}

export function storyFoundationState(graph: WorkflowGraph, storyId: string) {
  const analysis = findAnalysis(graph, storyId);
  const lead = foundationResult(graph, storyId, "lead");
  const support = foundationResult(graph, storyId, "support");
  const complete = Boolean(
    lead?.status === "success" && lead.resultUrl &&
      support?.status === "success" && support.resultUrl,
  );
  return {
    analysis,
    lead,
    support,
    complete,
    approved: Boolean(analysis?.foundationApprovedAt),
    refs: [lead?.assetRef, support?.assetRef].filter(
      (ref): ref is string => Boolean(ref),
    ),
  };
}

export function syncStoryFoundationStatuses(graph: WorkflowGraph) {
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (
      node.storyRole !== "analysis" ||
      node.assetStrategy !== "foundation-pair-v1" ||
      node.foundationApprovedAt ||
      !node.storyId ||
      (node.planningStatus !== "awaiting-foundation-generation" &&
        node.planningStatus !== "awaiting-foundation-approval")
    ) {
      return node;
    }
    const complete = storyFoundationState(graph, node.storyId).complete;
    const planningStatus = complete
      ? "awaiting-foundation-approval" as const
      : "awaiting-foundation-generation" as const;
    if (node.planningStatus === planningStatus) return node;
    changed = true;
    return {
      ...node,
      planningStatus,
      label: `${String(node.label).split(" · 剧本分析")[0]} · 剧本分析 · ${complete ? "等待确认基础角色" : "等待生成基础角色"}`,
    };
  }) as WorkflowNode[];
  return changed ? { ...graph, nodes } : graph;
}

export function approveStoryFoundation(
  graph: WorkflowGraph,
  storyId: string,
  now = Date.now(),
) {
  const state = storyFoundationState(graph, storyId);
  if (!state.analysis || state.analysis.assetStrategy !== "foundation-pair-v1") {
    throw new Error("当前短剧不使用双基础角色流程。");
  }
  if (!state.complete) throw new Error("主角和核心配角尚未全部生成成功。");
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === state.analysis!.id
        ? {
            ...node,
            foundationApprovedAt: now,
            planningStatus: "planning" as const,
            label: `${String(node.label).split(" · 剧本分析")[0]} · 剧本分析 · 人物资产规划中`,
          }
        : node,
    ) as WorkflowNode[],
  };
}

export function resetStoryFoundationApproval(
  graph: WorkflowGraph,
  storyId: string,
) {
  const analysis = findAnalysis(graph, storyId);
  if (!analysis || analysis.assetStrategy !== "foundation-pair-v1") return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === analysis.id
        ? {
            ...node,
            foundationApprovedAt: undefined,
            planningStatus: "awaiting-foundation-generation" as const,
            label: `${String(node.label).split(" · 剧本分析")[0]} · 剧本分析 · 等待生成基础角色`,
          }
        : node,
    ) as WorkflowNode[],
  };
}

function defaultRatio(kind: AgentStoryAssetKind, projectRatio: string) {
  if (kind === "character") return "16:9";
  if (kind === "prop") return "1:1";
  return projectRatio || "9:16";
}

export function createStoryAssetBatch(
  graph: WorkflowGraph,
  operation: AgentCreateStoryAssetBatchOperation,
  idFactory: IdFactory = () => crypto.randomUUID(),
) {
  const analysis = findAnalysis(graph, operation.storyId);
  if (!analysis) throw new Error("未找到对应的短剧分析节点。");
  if (analysis.planningStage !== operation.assetKind) {
    throw new Error("资产规划阶段不连续，当前批次未创建节点。");
  }
  if ((analysis.planningChunkIndex ?? 0) !== operation.chunkIndex) {
    throw new Error("资产规划批次编号不连续，当前批次未创建节点。");
  }
  const foundationStrategy = analysis.assetStrategy === "foundation-pair-v1";
  const foundationBatch = foundationStrategy &&
    operation.assetKind === "character" &&
    operation.chunkIndex === 0;
  if (foundationBatch) {
    const roles = operation.assets.map((asset) => asset.foundationRole);
    if (
      operation.assetKind !== "character" ||
      operation.isFinal ||
      operation.assets.length !== 2 ||
      roles.filter((role) => role === "lead").length !== 1 ||
      roles.filter((role) => role === "support").length !== 1
    ) {
      throw new Error("首个人物批次必须只包含一个主角和一个核心配角，且 is_final=false。");
    }
  } else if (foundationStrategy) {
    if (!analysis.foundationApprovedAt) {
      throw new Error("主角和核心配角尚未确认，不能创建其他资产。");
    }
    if (operation.assets.some((asset) => asset.foundationRole)) {
      throw new Error("基础角色只能出现在首个人物批次。");
    }
  }
  const existingRefs = new Set(
    graph.nodes
      .filter((node) => node.storyId === operation.storyId && node.assetRef)
      .map((node) => node.assetRef),
  );
  for (const asset of operation.assets) {
    if (existingRefs.has(asset.ref)) {
      throw new Error(`资产 ${asset.ref} 已存在，当前批次未创建节点。`);
    }
    existingRefs.add(asset.ref);
  }

  const existingAssetCount = new Set(
    graph.nodes
      .filter((node) => node.storyId === operation.storyId && node.assetRef)
      .map((node) => node.assetRef),
  ).size;
  const imageModel = analysis.storyImageModel || DEFAULT_MODEL_BY_MODE.image;
  const projectRatio = analysis.projectAspectRatio || "9:16";
  const visualStyle = analysis.storyVisualStyle || "当前项目统一视觉风格";
  const leadResult = foundationStrategy
    ? foundationResult(graph, operation.storyId, "lead")
    : undefined;
  const supportResult = foundationStrategy
    ? foundationResult(graph, operation.storyId, "support")
    : undefined;
  if (!foundationBatch && foundationStrategy && (!leadResult || !supportResult)) {
    throw new Error("未找到已确认的主角或核心配角结果节点。");
  }
  const createdNodes: WorkflowNode[] = [];
  const createdEdges = [] as WorkflowGraph["edges"];

  operation.assets.forEach((asset, index) => {
    const y = analysis.y + ROW_STEP * (existingAssetCount + index + 1);
    const metadata = {
      storyId: operation.storyId,
      assetRef: asset.ref,
      assetKind: operation.assetKind,
      ...(asset.foundationRole ? { foundationRole: asset.foundationRole } : {}),
    } as const;
    const specId = idFactory();
    const schedulerId = idFactory();
    const resultId = idFactory();
    createdNodes.push(
      {
        id: specId,
        x: analysis.x,
        y,
        type: "source",
        kind: "text",
        text: assetText(operation.assetKind, asset),
        label: `${ASSET_KIND_LABEL[operation.assetKind]} · ${asset.name}`,
        ...metadata,
        assetRole: "spec",
        storyRole: "asset-spec",
      },
      {
        id: schedulerId,
        x: analysis.x + COLUMN_STEP,
        y,
        width: WORKFLOW_NODE_WIDTH,
        height: 360,
        type: "scheduler",
        outputKind: "image",
        model: imageModel,
        prompt: foundationBatch
          ? foundationPrompt(asset, visualStyle)
          : foundationStrategy
            ? dependentPrompt(operation.assetKind, asset, visualStyle)
            : asset.imagePrompt,
        aspectRatio: asset.aspectRatio || defaultRatio(operation.assetKind, projectRatio),
        resolution: asset.resolution || "2K",
        duration: "",
        outputCount: 1,
        error: "",
        label: `${asset.name} · 资产图片`,
        ...metadata,
        assetRole: "scheduler",
        storyRole: "asset-scheduler",
      },
      {
        id: resultId,
        x: analysis.x + COLUMN_STEP * 2,
        y,
        type: "result",
        kind: "image",
        schedulerId,
        text: `${asset.name} 资产图片占位`,
        model: imageModel,
        status: "ready",
        progress: "待生成",
        error: "",
        label: `${asset.name} · 资产占位`,
        ...metadata,
        assetRole: "result",
        storyRole: "asset-result",
      },
    );
    createdEdges.push(
      { id: idFactory(), sourceId: specId, targetId: schedulerId },
      ...(!foundationBatch && foundationStrategy
        ? [
            { id: idFactory(), sourceId: leadResult!.id, targetId: schedulerId },
            { id: idFactory(), sourceId: supportResult!.id, targetId: schedulerId },
          ]
        : []),
      { id: idFactory(), sourceId: schedulerId, targetId: resultId },
    );
  });

  const nextStage = foundationBatch
    ? "character"
    : operation.isFinal
    ? NEXT_STAGE[operation.assetKind]
    : operation.assetKind;
  const status = foundationBatch
    ? "awaiting-foundation-generation"
    : nextStage === "complete" ? "complete" : "planning";
  const stageLabel = foundationBatch
    ? "等待生成基础角色"
    : nextStage === "complete"
    ? "资产库已完成"
    : `${ASSET_KIND_LABEL[nextStage]}资产规划中`;
  return {
    graph: {
      ...graph,
      nodes: [
        ...graph.nodes.map((node) =>
          node.id === analysis.id
            ? {
                ...node,
                label: `${String(node.label).split(" · 剧本分析")[0]} · 剧本分析 · ${stageLabel}`,
                planningStage: nextStage,
                planningStatus: status,
                planningChunkIndex: foundationBatch
                  ? 1
                  : operation.isFinal ? 0 : operation.chunkIndex + 1,
              }
            : node,
        ),
        ...createdNodes,
      ] as WorkflowNode[],
      edges: [...graph.edges, ...createdEdges],
    },
    createdAssetRefs: operation.assets.map((asset) => asset.ref),
    planningStage: nextStage,
  };
}

export function markStoryAssetPlanning(
  graph: WorkflowGraph,
  storyId: string,
  status: "planning" | "stopped" | "failed",
) {
  const analysis = findAnalysis(graph, storyId);
  if (!analysis || analysis.planningStatus === "complete") return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === analysis.id
        ? {
            ...node,
            label: `${String(node.label).replace(/ · (已停止|规划失败)$/, "")} · ${
              status === "stopped" ? "已停止" : status === "failed" ? "规划失败" : "规划中"
            }`,
            planningStatus: status,
          }
        : node,
    ) as WorkflowNode[],
  };
}

export function assetRefsForSelection(graph: WorkflowGraph, selectedIds: string[]) {
  return [...new Set(
    selectedIds.flatMap((id) => {
      const node = graph.nodes.find((candidate) => candidate.id === id);
      return node?.assetRef ? [node.assetRef] : [];
    }),
  )];
}

export function assetSchedulersForOperation(
  graph: WorkflowGraph,
  operation: AgentRunStoryAssetsOperation,
) {
  const analysis = findAnalysis(graph, operation.storyId);
  const selected = new Set(operation.assetRefs);
  const schedulers = graph.nodes.filter(
    (node): node is WorkflowSchedulerNode =>
      node.type === "scheduler" &&
      node.storyId === operation.storyId &&
      node.assetRole === "scheduler" &&
      Boolean(node.assetRef) &&
      (!selected.size || selected.has(node.assetRef!)),
  );
  if (selected.size && [...selected].some(
    (ref) => !schedulers.some((node) => node.assetRef === ref),
  )) {
    throw new Error("部分指定资产已不存在，请重新选择。");
  }
  if (
    analysis?.assetStrategy === "foundation-pair-v1" &&
    !analysis.foundationApprovedAt &&
    schedulers.some((node) => !node.foundationRole)
  ) {
    throw new Error("主角和核心配角尚未确认，不能生成其他资产。");
  }
  return schedulers;
}

export function assetResultForScheduler(
  graph: WorkflowGraph,
  schedulerId: string,
) {
  return graph.nodes.find(
    (node): node is WorkflowResultNode =>
      node.type === "result" &&
      node.schedulerId === schedulerId &&
      node.assetRole === "result",
  );
}

export function runnableAssetSchedulers(
  graph: WorkflowGraph,
  operation: AgentRunStoryAssetsOperation,
  includeSuccessful = false,
) {
  return assetSchedulersForOperation(graph, operation).filter((scheduler) => {
    const result = assetResultForScheduler(graph, scheduler.id);
    return result && (
      result.status === "ready" ||
      result.status === "failed" ||
      (includeSuccessful && selectedExplicitly(operation, result) && result.status === "success")
    );
  });
}

function selectedExplicitly(
  operation: AgentRunStoryAssetsOperation,
  result: WorkflowResultNode,
) {
  return Boolean(result.assetRef && operation.assetRefs.includes(result.assetRef));
}

export function describeStoryAssetRun(
  graph: WorkflowGraph,
  operation: AgentRunStoryAssetsOperation,
) {
  const schedulers = runnableAssetSchedulers(graph, operation, true);
  if (!schedulers.length) throw new Error("没有可提交的资产图片任务。");
  const regenerations = schedulers.filter((scheduler) =>
    assetResultForScheduler(graph, scheduler.id)?.status === "success",
  ).length;
  const foundationCount = schedulers.filter((scheduler) =>
    Boolean(scheduler.foundationRole)
  ).length;
  if (foundationCount === schedulers.length) {
    return `生成 ${schedulers.length} 个基础角色资产（图1主角、图2核心配角）；任务将并行提交，可能产生 ${schedulers.length} 笔模型费用${
      regenerations ? `；其中 ${regenerations} 个成功基础角色会被重新生成并重置质量确认` : ""
    }`;
  }
  return `批量生成 ${schedulers.length} 个资产图片；任务将全部并行，可能产生 ${schedulers.length} 笔模型费用${
    regenerations ? `；其中 ${regenerations} 个成功资产会在确认后被重新生成并覆盖原结果` : ""
  }`;
}
