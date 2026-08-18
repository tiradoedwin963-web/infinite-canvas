import { DEFAULT_MODEL_BY_MODE, getModelConfig } from "../ai/models.ts";
import type {
  AgentCreateMangaContinuityReportOperation,
  AgentCreateMangaScenePlansOperation,
  AgentCreateMangaShotBatchOperation,
  AgentCreateMangaStoryBeatsOperation,
  AgentMangaPlanningStage,
  AgentStoryAnalysis,
  ContinuityIssue,
  ContinuityReport,
  ScenePlan,
  ShotPlan,
  StoryBeat,
} from "../ai/agent.ts";
import {
  WORKFLOW_NODE_WIDTH,
  getWorkflowNodeSize,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowResultNode,
  type WorkflowSourceNode,
} from "./graph.ts";

export type ScriptAnalysis = AgentStoryAnalysis;
export type CharacterBible = ReturnType<typeof assetBibles>[number];
export type SceneBible = CharacterBible;
export type PropBible = CharacterBible;
export type CanvasOperation =
  | AgentCreateMangaStoryBeatsOperation
  | AgentCreateMangaScenePlansOperation
  | AgentCreateMangaShotBatchOperation
  | AgentCreateMangaContinuityReportOperation;
export type GenerationTask = WorkflowResultNode;

export type MangaProject = {
  storyId: string;
  analysis: WorkflowSourceNode;
  stage?: AgentMangaPlanningStage;
  beats: StoryBeat[];
  scenes: ScenePlan[];
  shots: ShotPlan[];
  continuity?: ContinuityReport;
};

const COLUMN_STEP = WORKFLOW_NODE_WIDTH + 120;
const ROW_STEP = 440;

function analysisNode(graph: WorkflowGraph, storyId: string) {
  return graph.nodes.find(
    (node): node is WorkflowSourceNode =>
      node.type === "source" &&
      node.storyId === storyId &&
      node.storyRole === "analysis",
  );
}

function assetResults(graph: WorkflowGraph, storyId: string) {
  return graph.nodes.filter(
    (node): node is WorkflowResultNode =>
      node.type === "result" &&
      node.storyId === storyId &&
      node.assetRole === "result" &&
      Boolean(node.assetRef) &&
      node.status === "success" &&
      Boolean(node.resultUrl || node.assetId),
  );
}

function assetBibles(graph: WorkflowGraph, storyId: string) {
  return assetResults(graph, storyId).map((node) => ({
    id: node.assetRef!,
    nodeId: node.id,
    kind: node.assetKind!,
    name: node.label || node.assetName || node.assetRef!,
  }));
}

function updateAnalysis(
  graph: WorkflowGraph,
  storyId: string,
  update: Partial<WorkflowSourceNode>,
) {
  return {
    ...graph,
    nodes: graph.nodes.map((node): WorkflowNode =>
      node.type === "source" &&
      node.storyId === storyId && node.storyRole === "analysis"
        ? { ...node, ...update, type: "source" }
        : node,
    ),
  };
}

function requireStage(
  graph: WorkflowGraph,
  storyId: string,
  stage: AgentMangaPlanningStage,
) {
  const analysis = analysisNode(graph, storyId);
  if (!analysis) throw new Error("未找到对应的剧本分析节点。");
  if (analysis.storyboardMode !== "comic") {
    throw new Error("当前项目没有选择漫剧导演能力。");
  }
  if (analysis.mangaPlanningStage !== stage) {
    throw new Error(
      `漫剧导演阶段不连续：当前为 ${analysis.mangaPlanningStage || "未开始"}，不能写入 ${stage}。`,
    );
  }
  return analysis;
}

function graphRight(graph: WorkflowGraph) {
  return graph.nodes.reduce((right, node) => {
    const size = getWorkflowNodeSize(node);
    return Math.max(right, node.x + size.width);
  }, -160);
}

function graphTop(graph: WorkflowGraph) {
  return graph.nodes.length ? Math.min(...graph.nodes.map((node) => node.y)) : 0;
}

function makeEdge(sourceId: string, targetId: string, idFactory: () => string) {
  return { id: idFactory(), sourceId, targetId } satisfies WorkflowEdge;
}

function formatBeatText(beats: StoryBeat[]) {
  return beats.map((beat) =>
    `${beat.sequence}. ${beat.beatId}｜场景 ${beat.sceneId}\n叙事目的：${beat.narrativePurpose}\n情绪目标：${beat.emotionalGoal}\n${beat.summary}`
  ).join("\n\n");
}

function formatSceneText(plan: ScenePlan) {
  return [
    `场景：${plan.sceneId}`,
    `剧情节拍：${plan.beatIds.join("、")}`,
    `空间：${plan.spatialLayout}`,
    `调度：${plan.blocking}`,
    `视线：${plan.eyeline}`,
    `轴线：${plan.axis}`,
    `进出画：${plan.entrancesExits}`,
    `光线：${plan.lighting}`,
    `色彩：${plan.colorTone}`,
  ].join("\n");
}

export function buildMangaVideoPrompt(shot: ShotPlan) {
  const timeline = shot.timeline.map((segment) =>
    `[${segment.startSecond}-${segment.endSecond}秒] 画面动作：${segment.visualAction}；表演：${segment.performance}；摄影：${segment.camera}；声音：${segment.audio}。`
  ).join("\n");
  return [
    `镜头时长：${shot.duration}秒。叙事目的：${shot.narrativePurpose}。情绪目标：${shot.emotionalGoal}。`,
    `景别与摄影：${shot.shotSize}，${shot.lens}，${shot.perspective}，${shot.cameraAngle}，${shot.cameraMovement}。`,
    `构图与调度：${shot.composition}；${shot.blocking}；人物位置：${shot.characterPosition}；人物移动：${shot.characterMovement}；视线：${shot.eyeline}。`,
    `光影与质感：${shot.lighting}；${shot.colorTone}；${shot.texture}。`,
    `开始画面：${shot.startFrame}。结束画面：${shot.endFrame}。`,
    timeline,
    `对白：${shot.dialogue}。旁白：${shot.voiceover}。音效：${shot.soundEffect}。音乐：${shot.musicCue}。`,
    `连续性：${shot.continuityNotes}。转场：${shot.transitionIn} → ${shot.transitionOut}。`,
    `禁止项：${shot.negativePrompt}。禁止改变人物身份、脸型、发型、服装、场景结构、道具造型、人物数量和原创画面风格。`,
  ].join("\n");
}

function formatShotText(shot: ShotPlan) {
  return [
    `镜头 ${shot.sequence}｜${shot.shotId}｜${shot.duration}秒`,
    `叙事目的：${shot.narrativePurpose}`,
    `情绪目标：${shot.emotionalGoal}`,
    `景别/焦段/机位：${shot.shotSize} / ${shot.lens} / ${shot.cameraAngle}`,
    `人物调度：${shot.blocking}`,
    `动作：${shot.action}`,
    `对白/旁白：${shot.dialogue} / ${shot.voiceover}`,
    `连续性：${shot.continuityNotes}`,
  ].join("\n");
}

function assertReadyAssets(graph: WorkflowGraph, storyId: string) {
  const assets = assetBibles(graph, storyId);
  if (!assets.length) throw new Error("漫剧导演没有可用的资产库。");
  return assets;
}

export function createMangaStoryBeats(
  graph: WorkflowGraph,
  operation: AgentCreateMangaStoryBeatsOperation,
  idFactory = () => crypto.randomUUID(),
) {
  if (operation.stageIndex !== 0) throw new Error("剧情节拍阶段编号必须为 0。");
  const analysis = requireStage(graph, operation.storyId, "story-beats");
  assertReadyAssets(graph, operation.storyId);
  if (graph.nodes.some((node) => node.storyId === operation.storyId && node.storyRole === "story-beats")) {
    throw new Error("当前短剧已经创建剧情节拍，拒绝重复写入。");
  }
  const sceneRefs = new Set(assetBibles(graph, operation.storyId)
    .filter((asset) => asset.kind === "scene").map((asset) => asset.id));
  if (operation.beats.some((beat) => !sceneRefs.has(beat.sceneId))) {
    throw new Error("剧情节拍引用了不存在的场景资产。");
  }
  if (operation.beats.some((beat, index) => beat.sequence !== index + 1)) {
    throw new Error("剧情节拍 sequence 必须从 1 连续递增。");
  }
  const node: WorkflowSourceNode = {
    id: idFactory(),
    x: graphRight(graph) + 160,
    y: graphTop(graph),
    width: WORKFLOW_NODE_WIDTH,
    height: 360,
    type: "source",
    kind: "text",
    text: formatBeatText(operation.beats),
    label: "漫剧导演 · 情绪节拍",
    storyId: operation.storyId,
    storyRole: "story-beats",
    storyBeats: operation.beats,
  };
  const next = {
    ...graph,
    nodes: [...graph.nodes, node],
    edges: [...graph.edges, makeEdge(analysis.id, node.id, idFactory)],
  };
  return updateAnalysis(next, operation.storyId, {
    mangaPlanningStage: "scene-plans",
    mangaPlanningStatus: "planning",
  });
}

export function createMangaScenePlans(
  graph: WorkflowGraph,
  operation: AgentCreateMangaScenePlansOperation,
  idFactory = () => crypto.randomUUID(),
) {
  if (operation.stageIndex !== 1) throw new Error("场面调度阶段编号必须为 1。");
  requireStage(graph, operation.storyId, "scene-plans");
  const beatNode = graph.nodes.find((node) =>
    node.storyId === operation.storyId && node.storyRole === "story-beats"
  );
  const beats = beatNode?.storyBeats ?? [];
  const beatIds = new Set(beats.map((beat) => beat.beatId));
  const sceneIds = new Set(beats.map((beat) => beat.sceneId));
  if (!beatNode || operation.plans.some((plan) =>
    !sceneIds.has(plan.sceneId) || plan.beatIds.some((id) => !beatIds.has(id))
  )) {
    throw new Error("场面调度引用了不存在的场景或剧情节拍。");
  }
  const plannedBeatIds = operation.plans.flatMap((plan) => plan.beatIds);
  if (new Set(plannedBeatIds).size !== plannedBeatIds.length ||
      new Set(plannedBeatIds).size !== beatIds.size) {
    throw new Error("场面调度没有覆盖全部剧情节拍。");
  }
  const x = graphRight(graph) + 160;
  const top = graphTop(graph);
  const nodes = operation.plans.map((plan, index): WorkflowSourceNode => ({
    id: idFactory(),
    x,
    y: top + index * ROW_STEP,
    width: WORKFLOW_NODE_WIDTH,
    height: 360,
    type: "source",
    kind: "text",
    text: formatSceneText(plan),
    label: `场面调度 · ${plan.sceneId}`,
    storyId: operation.storyId,
    storyRole: "scene-plan",
    scenePlan: plan,
  }));
  const next = {
    ...graph,
    nodes: [...graph.nodes, ...nodes],
    edges: [
      ...graph.edges,
      ...nodes.map((node) => makeEdge(beatNode.id, node.id, idFactory)),
    ],
  };
  return updateAnalysis(next, operation.storyId, {
    mangaPlanningStage: "shot-plans",
    mangaPlanningStatus: "planning",
    mangaPlanningChunkIndex: 0,
  });
}

function expectedReferenceIds(
  graph: WorkflowGraph,
  storyId: string,
  shot: ShotPlan,
) {
  const assets = assetBibles(graph, storyId);
  const byRef = new Map(assets.map((asset) => [asset.id, asset]));
  const refs = [
    ...shot.characterIds,
    shot.sceneId,
    ...shot.propIds,
  ].map((ref) => byRef.get(ref));
  if (refs.some((asset) => !asset)) throw new Error(`镜头 ${shot.shotId} 引用了不存在的资产 ID。`);
  if (shot.characterIds.some((ref) => byRef.get(ref)?.kind !== "character") ||
      byRef.get(shot.sceneId)?.kind !== "scene" ||
      shot.propIds.some((ref) => byRef.get(ref)?.kind !== "prop")) {
    throw new Error(`镜头 ${shot.shotId} 的人物、场景或道具类型不匹配。`);
  }
  return refs.map((asset) => asset!.nodeId).slice(0, 5);
}

export function createMangaShotBatch(
  graph: WorkflowGraph,
  operation: AgentCreateMangaShotBatchOperation,
  idFactory = () => crypto.randomUUID(),
) {
  const analysis = requireStage(graph, operation.storyId, "shot-plans");
  const expectedChunk = analysis.mangaPlanningChunkIndex ?? 0;
  if (operation.chunkIndex !== expectedChunk) {
    throw new Error(`漫剧镜头批次不连续：期望 ${expectedChunk}，收到 ${operation.chunkIndex}。`);
  }
  const beats = graph.nodes.find((node) =>
    node.storyId === operation.storyId && node.storyRole === "story-beats"
  )?.storyBeats ?? [];
  const scenes = graph.nodes.flatMap((node) =>
    node.storyId === operation.storyId && node.storyRole === "scene-plan" && node.scenePlan
      ? [node.scenePlan]
      : [],
  );
  const beatIds = new Set(beats.map((beat) => beat.beatId));
  const sceneIds = new Set(scenes.map((scene) => scene.sceneId));
  const existing = graph.nodes.flatMap((node) =>
    node.storyId === operation.storyId && node.shotPlan ? [node.shotPlan] : []
  );
  const existingIds = new Set(existing.map((shot) => shot.shotId));
  if (operation.shots.some((shot) =>
    existingIds.has(shot.shotId) || !beatIds.has(shot.beatId) || !sceneIds.has(shot.sceneId)
  )) {
    throw new Error("镜头批次包含重复镜头或不存在的剧情节拍、场景 ID。");
  }
  const normalizedShots = operation.shots.map((shot, index) => {
    if (shot.sequence !== existing.length + index + 1) {
      throw new Error(`镜头 ${shot.shotId} 的 sequence 不连续。`);
    }
    return {
      ...shot,
      referenceNodeIds: expectedReferenceIds(graph, operation.storyId, shot),
    };
  });
  const coveredBeatIds = new Set([...existing, ...normalizedShots].map((shot) => shot.beatId));
  const missingBeatIds = [...beatIds].filter((beatId) => !coveredBeatIds.has(beatId));
  const planningComplete = missingBeatIds.length === 0;
  const existingShotNodes = graph.nodes.filter((node) =>
    node.storyId === operation.storyId && node.storyRole === "shot"
  );
  const sceneRight = graph.nodes.reduce((right, node) =>
    node.storyId === operation.storyId && node.storyRole === "scene-plan"
      ? Math.max(right, node.x + getWorkflowNodeSize(node).width)
      : right,
    -160,
  );
  const x = existingShotNodes[0]?.x ?? sceneRight + 160;
  const top = graphTop(graph);
  const nodes = normalizedShots.map((rawShot, index): WorkflowSourceNode => {
    const shot = { ...rawShot, videoPrompt: buildMangaVideoPrompt(rawShot) };
    return {
      id: idFactory(),
      x,
      y: top + (existing.length + index) * ROW_STEP,
      width: WORKFLOW_NODE_WIDTH,
      height: 360,
      type: "source",
      kind: "text",
      text: formatShotText(shot),
      label: `${shot.shotId} · ${shot.duration}秒分镜`,
      storyId: operation.storyId,
      shotRef: shot.shotId,
      storyRole: "shot",
      shotPlan: shot,
    };
  });
  const sceneById = new Map(graph.nodes.flatMap((node) =>
    node.storyId === operation.storyId && node.storyRole === "scene-plan" && node.scenePlan
      ? [[node.scenePlan.sceneId, node] as const]
      : [],
  ));
  let next = {
    ...graph,
    nodes: [...graph.nodes, ...nodes],
    edges: [
      ...graph.edges,
      ...nodes.flatMap((node) => {
        const scene = sceneById.get(node.shotPlan!.sceneId);
        return scene ? [makeEdge(scene.id, node.id, idFactory)] : [];
      }),
    ],
  };
  if (planningComplete) {
    const beatOrder = new Map(beats.map((beat) => [beat.beatId, beat.sequence]));
    const orderedNodes = next.nodes
      .filter((node): node is WorkflowSourceNode =>
        node.type === "source" && node.storyId === operation.storyId &&
        node.storyRole === "shot" && Boolean(node.shotPlan)
      )
      .sort((left, right) =>
        (beatOrder.get(left.shotPlan!.beatId) ?? Number.MAX_SAFE_INTEGER) -
          (beatOrder.get(right.shotPlan!.beatId) ?? Number.MAX_SAFE_INTEGER) ||
        left.shotPlan!.sequence - right.shotPlan!.sequence
      );
    const orderedShotIds = orderedNodes.map((_, index) =>
      `shot-${String(index + 1).padStart(3, "0")}`
    );
    const normalizedByNodeId = new Map(orderedNodes.map((node, index) => {
      const shot = {
        ...node.shotPlan!,
        shotId: orderedShotIds[index],
        sequence: index + 1,
        previousShotId: orderedShotIds[index - 1] ?? "无",
        nextShotId: orderedShotIds[index + 1] ?? "无",
      };
      const normalized = { ...shot, videoPrompt: buildMangaVideoPrompt(shot) };
      return [node.id, {
        ...node,
        y: top + index * ROW_STEP,
        text: formatShotText(normalized),
        label: `${normalized.shotId} · ${normalized.duration}秒分镜`,
        shotRef: normalized.shotId,
        shotPlan: normalized,
      }] as const;
    }));
    next = {
      ...next,
      nodes: next.nodes.map((node) => normalizedByNodeId.get(node.id) ?? node),
    };
  }
  return updateAnalysis(next, operation.storyId, {
    mangaPlanningStage: planningComplete ? "continuity" : "shot-plans",
    mangaPlanningStatus: "planning",
    mangaPlanningChunkIndex: planningComplete ? 0 : operation.chunkIndex + 1,
  });
}

function normalizedShotLinks(shots: ShotPlan[]) {
  return [...shots]
    .sort((left, right) => left.sequence - right.sequence)
    .map((shot, index, ordered) => ({
      ...shot,
      previousShotId: ordered[index - 1]?.shotId ?? "无",
      nextShotId: ordered[index + 1]?.shotId ?? "无",
      videoPrompt: buildMangaVideoPrompt(shot),
    }));
}

function reportText(report: ContinuityReport) {
  if (!report.issues.length) return "连续性检查通过，未发现问题。";
  return report.issues.map((issue) =>
    `[${issue.severity === "error" ? "错误" : "警告"}] ${issue.code} · ${issue.shotId}\n原因：${issue.reason}\n建议：${issue.suggestion}`
  ).join("\n\n");
}

export function createMangaContinuityReport(
  graph: WorkflowGraph,
  operation: AgentCreateMangaContinuityReportOperation,
  idFactory = () => crypto.randomUUID(),
) {
  if (operation.stageIndex !== 3) throw new Error("连续性检查阶段编号必须为 3。");
  const analysis = requireStage(graph, operation.storyId, "continuity");
  const shotNodes = graph.nodes.filter(
    (node): node is WorkflowSourceNode =>
      node.type === "source" && node.storyId === operation.storyId &&
      node.storyRole === "shot" && Boolean(node.shotPlan),
  );
  if (!shotNodes.length) throw new Error("没有可检查的漫剧镜头方案。");
  const shotIds = new Set(shotNodes.map((node) => node.shotPlan!.shotId));
  if (operation.report.issues.some((issue) =>
    !shotIds.has(issue.shotId) ||
    (issue.relatedShotId && !shotIds.has(issue.relatedShotId))
  )) {
    throw new Error("连续性报告引用了不存在的镜头 ID。");
  }
  const errors = operation.report.issues.filter((issue) => issue.severity === "error");
  if (errors.length) {
    throw new Error(`连续性检查发现 ${errors.length} 个结构错误，未创建视频工作流。`);
  }
  const ordered = normalizedShotLinks(shotNodes.map((node) => node.shotPlan!));
  const planById = new Map(ordered.map((shot) => [shot.shotId, shot]));
  const warningsByShot = new Map<string, ContinuityIssue[]>();
  operation.report.issues.forEach((issue) => {
    const list = warningsByShot.get(issue.shotId) ?? [];
    list.push(issue);
    warningsByShot.set(issue.shotId, list);
  });
  const model = DEFAULT_MODEL_BY_MODE.video;
  const config = getModelConfig("video", model)!;
  const createdNodes: WorkflowNode[] = [];
  const createdEdges: WorkflowEdge[] = [];
  shotNodes.forEach((shotNode) => {
    const plan = planById.get(shotNode.shotRef!)!;
    const schedulerId = idFactory();
    const resultId = idFactory();
    const x = shotNode.x + COLUMN_STEP;
    createdNodes.push(
      {
        id: schedulerId,
        x,
        y: shotNode.y,
        width: WORKFLOW_NODE_WIDTH,
        height: 360,
        type: "scheduler",
        outputKind: "video",
        model,
        prompt: plan.videoPrompt,
        aspectRatio: analysis.projectAspectRatio || "16:9",
        resolution: config.defaultResolution ?? config.resolutions[0] ?? "720p",
        duration: String(plan.duration),
        outputCount: 1,
        error: "",
        label: `${plan.shotId} · ${plan.duration}秒视频`,
        storyId: operation.storyId,
        shotRef: plan.shotId,
        storyRole: "video-scheduler",
      },
      {
        id: resultId,
        x: x + COLUMN_STEP,
        y: shotNode.y,
        type: "result",
        kind: "video",
        schedulerId,
        text: `${plan.shotId} 视频片段占位`,
        model,
        status: "ready",
        progress: "待生成",
        error: "",
        label: `${plan.shotId} · 视频片段占位`,
        storyId: operation.storyId,
        shotRef: plan.shotId,
        storyRole: "clip",
      },
    );
    createdEdges.push(makeEdge(shotNode.id, schedulerId, idFactory));
    plan.referenceNodeIds.forEach((nodeId) => {
      createdEdges.push(makeEdge(nodeId, schedulerId, idFactory));
    });
    createdEdges.push(makeEdge(schedulerId, resultId, idFactory));
  });
  const reportNode: WorkflowSourceNode = {
    id: idFactory(),
    x: Math.max(...createdNodes.map((node) => node.x)) + COLUMN_STEP,
    y: graphTop(graph),
    width: WORKFLOW_NODE_WIDTH,
    height: 360,
    type: "source",
    kind: "text",
    text: reportText(operation.report),
    label: operation.report.issues.length
      ? `连续性报告 · ${operation.report.issues.length} 个警告`
      : "连续性报告 · 已通过",
    storyId: operation.storyId,
    storyRole: "continuity-report",
    continuityReport: operation.report,
  };
  const warnings = operation.report.issues.filter((issue) => issue.severity === "warning");
  const next = {
    ...graph,
    nodes: [
      ...graph.nodes.map((node): WorkflowNode => {
        if (
          node.type !== "source" || node.storyId !== operation.storyId ||
          node.storyRole !== "shot" || !node.shotPlan
        ) {
          return node;
        }
        const plan = planById.get(node.shotPlan.shotId)!;
        return {
          ...node,
          shotPlan: {
            ...plan,
            continuityWarnings: (warningsByShot.get(plan.shotId) ?? []).map((issue) => issue.reason),
          },
          text: formatShotText(plan),
        };
      }),
      ...createdNodes,
      reportNode,
    ],
    edges: [
      ...graph.edges,
      ...createdEdges,
      ...shotNodes.map((node) => makeEdge(node.id, reportNode.id, idFactory)),
    ],
  };
  return updateAnalysis(next, operation.storyId, {
    mangaPlanningStage: "complete",
    mangaPlanningStatus: warnings.length
      ? "awaiting-continuity-approval"
      : "complete",
    continuityApprovedAt: warnings.length ? undefined : Date.now(),
  });
}

export function acknowledgeMangaContinuity(
  graph: WorkflowGraph,
  storyId: string,
  now = Date.now(),
) {
  const analysis = analysisNode(graph, storyId);
  if (!analysis || analysis.mangaPlanningStatus !== "awaiting-continuity-approval") {
    throw new Error("当前项目没有等待确认的连续性警告。");
  }
  return updateAnalysis(graph, storyId, {
    mangaPlanningStatus: "complete",
    continuityApprovedAt: now,
  });
}

export function markMangaPlanning(
  graph: WorkflowGraph,
  storyId: string,
  status: "planning" | "stopped" | "failed",
) {
  const analysis = analysisNode(graph, storyId);
  if (!analysis || analysis.mangaPlanningStage === "complete") return graph;
  return updateAnalysis(graph, storyId, { mangaPlanningStatus: status });
}

export function mangaProject(graph: WorkflowGraph, storyId: string): MangaProject | null {
  const analysis = analysisNode(graph, storyId);
  if (!analysis) return null;
  const beatNode = graph.nodes.find((node) =>
    node.storyId === storyId && node.storyRole === "story-beats"
  );
  return {
    storyId,
    analysis,
    stage: analysis.mangaPlanningStage,
    beats: beatNode?.storyBeats ?? [],
    scenes: graph.nodes.flatMap((node) => node.storyId === storyId && node.scenePlan ? [node.scenePlan] : []),
    shots: graph.nodes.flatMap((node) => node.storyId === storyId && node.shotPlan ? [node.shotPlan] : []),
    continuity: graph.nodes.find((node) =>
      node.storyId === storyId && node.storyRole === "continuity-report"
    )?.continuityReport,
  };
}

const COMPARISON_ROLES = new Set([
  "analysis",
  "asset-spec",
  "asset-scheduler",
  "asset-result",
  "story-beats",
  "scene-plan",
]);

export function createMangaCinematographyComparisonGraph(graph: WorkflowGraph) {
  const analyses = graph.nodes.filter(
    (node): node is WorkflowSourceNode =>
      node.type === "source" &&
      node.storyRole === "analysis" &&
      node.storyboardMode === "comic" &&
      Boolean(node.storyId),
  );
  if (analyses.length !== 1) {
    throw new Error("当前项目必须且只能包含一个漫剧分析节点。");
  }
  const analysis = analyses[0];
  const storyId = analysis.storyId!;
  const assetNodes = graph.nodes.filter((node) =>
    node.storyId === storyId && Boolean(node.assetRole)
  );
  const assetResultNodes = assetNodes.filter(
    (node): node is WorkflowResultNode =>
      node.type === "result" &&
      node.assetRole === "result" &&
      node.status === "success" &&
      Boolean(node.assetId || node.resultUrl),
  );
  const beats = graph.nodes.find((node) =>
    node.storyId === storyId && node.storyRole === "story-beats"
  )?.storyBeats ?? [];
  const scenePlans = graph.nodes.filter((node) =>
    node.storyId === storyId && node.storyRole === "scene-plan" && node.scenePlan
  );
  const shots = graph.nodes.filter((node) =>
    node.storyId === storyId && node.storyRole === "shot" && node.shotPlan
  );
  if (
    !analysis.foundationApprovedAt ||
    analysis.planningStage !== "complete" ||
    analysis.planningStatus !== "complete" ||
    !assetResultNodes.length ||
    assetResultNodes.length !== assetNodes.filter((node) => node.assetRole === "result").length ||
    !beats.length ||
    !scenePlans.length ||
    !shots.length
  ) {
    throw new Error("当前项目尚未完成资产、剧情节拍、场面调度和原分镜，不能创建对照版。");
  }
  const keptNodes = graph.nodes.flatMap((node): WorkflowNode[] => {
    if (node.storyId !== storyId || !node.storyRole || !COMPARISON_ROLES.has(node.storyRole)) {
      return [];
    }
    if (node.id === analysis.id) {
      return [{
        ...node,
        mangaPlanningStage: "shot-plans",
        mangaPlanningStatus: "planning",
        mangaPlanningChunkIndex: 0,
        continuityApprovedAt: undefined,
      }];
    }
    if (node.type === "result") {
      return [{ ...node, taskId: undefined, startedAt: undefined }];
    }
    return [{ ...node }];
  });
  const keptIds = new Set(keptNodes.map((node) => node.id));
  return {
    version: 1 as const,
    nodes: keptNodes,
    edges: graph.edges.filter((edge) =>
      keptIds.has(edge.sourceId) && keptIds.has(edge.targetId)
    ).map((edge) => ({ ...edge })),
  };
}

export function remapWorkflowAssetIds(
  graph: WorkflowGraph,
  assetIds: ReadonlyMap<string, string>,
) {
  return {
    ...graph,
    nodes: graph.nodes.map((node): WorkflowNode => {
      if (node.type === "scheduler" || !node.assetId) return node;
      const assetId = assetIds.get(node.assetId);
      if (!assetId) throw new Error(`对照版缺少素材 ${node.assetId}。`);
      return {
        ...node,
        assetId,
        ...(node.type === "result"
          ? { resultUrl: `/api/workflow/assets/${assetId}` }
          : {}),
      };
    }),
  };
}
