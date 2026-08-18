import type {
  AgentCreateStoryWorkflowOperation,
  AgentStoryboardMode,
} from "../ai/agent.ts";
import type {
  WorkflowGraph,
  WorkflowNode,
  WorkflowResultNode,
} from "./graph.ts";

export type StoryboardReadiness = {
  storyId: string;
  mode?: AgentStoryboardMode;
  ready: boolean;
  locked: boolean;
  assetCount: number;
};

function analysisNode(graph: WorkflowGraph, storyId: string) {
  return graph.nodes.find(
    (node) => node.storyId === storyId && node.storyRole === "analysis",
  );
}

function assetResults(graph: WorkflowGraph, storyId: string) {
  return graph.nodes.filter(
    (node): node is WorkflowResultNode =>
      node.type === "result" &&
      node.storyId === storyId &&
      node.assetRole === "result" &&
      Boolean(node.assetRef),
  );
}

function resultAvailable(node: WorkflowResultNode) {
  return node.status === "success" && Boolean(node.resultUrl || node.assetId);
}

export function storyStoryboardReadiness(
  graph: WorkflowGraph,
  storyId: string,
): StoryboardReadiness {
  const analysis = analysisNode(graph, storyId);
  const results = assetResults(graph, storyId);
  const locked = graph.nodes.some(
    (node) => node.storyId === storyId && node.storyRole === "shot",
  );
  return {
    storyId,
    mode: analysis?.storyboardMode,
    ready: Boolean(
      analysis?.planningStage === "complete" &&
      analysis.planningStatus === "complete" &&
      analysis.foundationApprovedAt &&
      results.length &&
      results.every(resultAvailable),
    ),
    locked,
    assetCount: results.length,
  };
}

export function setStoryStoryboardMode(
  graph: WorkflowGraph,
  storyId: string,
  mode: AgentStoryboardMode,
): WorkflowGraph {
  const state = storyStoryboardReadiness(graph, storyId);
  if (!analysisNode(graph, storyId)) throw new Error("未找到对应的剧本分析节点。");
  if (!state.ready) throw new Error("资产库尚未全部生成并确认，不能选择分镜类型。");
  if (state.locked && state.mode !== mode) {
    throw new Error("当前项目已经创建分镜，不能切换分镜类型。");
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node): WorkflowNode =>
      node.storyId === storyId && node.storyRole === "analysis"
        ? {
            ...node,
            storyboardMode: mode,
            ...(mode === "comic" && !node.mangaPlanningStage
              ? {
                  mangaPlanningStage: "story-beats" as const,
                  mangaPlanningStatus: "planning" as const,
                  mangaPlanningChunkIndex: 0,
                  continuityApprovedAt: undefined,
                }
              : {}),
          }
        : node,
    ),
  };
}

export function assertComicStoryboardOperation(
  graph: WorkflowGraph,
  operation: AgentCreateStoryWorkflowOperation,
) {
  if (graph.nodes.some((node) =>
    node.storyRole === "analysis" &&
    node.storyboardMode === "comic" &&
    Boolean(node.mangaPlanningStage)
  )) {
    throw new Error("新漫剧必须使用分阶段导演操作，不能创建旧分镜图片工作流。");
  }
  const referenceIds = operation.shots.flatMap((shot) => shot.referenceNodeIds);
  const referencedNodes = referenceIds.map((nodeId) =>
    graph.nodes.find((node) => node.id === nodeId),
  );
  const storyIds = new Set(
    referencedNodes.flatMap((node) => node?.storyId ? [node.storyId] : []),
  );
  if (!operation.shots.every((shot) =>
    shot.referenceNodeIds.length >= 1 &&
    shot.referenceNodeIds.length <= 5 &&
    new Set(shot.referenceNodeIds).size === shot.referenceNodeIds.length
  )) {
    throw new Error("漫剧每个分镜必须引用 1 至 5 个不重复的成功资产。");
  }
  if (referencedNodes.some((node) =>
    !node ||
    node.type !== "result" ||
    node.assetRole !== "result" ||
    node.status !== "success" ||
    !node.assetRef ||
    !node.resultUrl
  ) || storyIds.size !== 1) {
    throw new Error("漫剧分镜只能引用同一项目中已经成功的资产结果。");
  }
  const storyId = [...storyIds][0]!;
  const state = storyStoryboardReadiness(graph, storyId);
  if (!state.ready) throw new Error("资产库尚未全部生成并确认，不能创建分镜。");
  if (state.mode !== "comic") throw new Error("当前项目没有选择漫剧分镜能力。");
  if (state.locked) throw new Error("当前项目已经创建过分镜。");
  return storyId;
}
