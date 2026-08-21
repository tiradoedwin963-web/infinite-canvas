import { pathToFileURL } from "node:url";
import postgres from "postgres";

const CURRENT_STORY_ROLES = new Set([
  "project",
  "analysis",
  "asset-spec",
  "asset-scheduler",
  "asset-result",
  "story-beats",
  "scene-plan",
  "shot",
  "storyboard-table",
  "continuity-report",
  "storyboard-scheduler",
  "storyboard",
  "video-scheduler",
  "clip",
]);

const LEGACY_STORY_ROLES = new Set([
  "project",
  "analysis",
  "asset-spec",
  "asset-scheduler",
  "asset-result",
  "shot",
  "storyboard-scheduler",
  "storyboard",
  "video-scheduler",
  "clip",
]);

const DIRECTOR_STORY_ROLES = new Set([
  "story-beats",
  "scene-plan",
  "storyboard-table",
  "continuity-report",
]);

const CURRENT_NODE_STATUSES = new Set([
  "ready",
  "pending",
  "running",
  "success",
  "failed",
  "paused",
  "submission-unknown",
]);

const LEGACY_NODE_STATUSES = new Set([
  "ready",
  "pending",
  "running",
  "success",
  "failed",
  "paused",
]);

const MANGA_METADATA_KEYS = [
  "storyboardMode",
  "mangaStoryboardTempo",
  "mangaPlanningStage",
  "mangaPlanningStatus",
  "mangaPlanningChunkIndex",
  "continuityApprovedAt",
  "storyBeats",
  "scenePlan",
  "shotPlan",
  "continuityReport",
  "videoSegment",
  "storyboardTable",
];

const CURRENT_MANGA_STAGES = new Set([
  "story-beats",
  "scene-plans",
  "shot-plans",
  "continuity",
  "complete",
]);

const CURRENT_MANGA_STATUSES = new Set([
  "planning",
  "stopped",
  "failed",
  "awaiting-continuity-approval",
  "complete",
]);

const CURRENT_MANGA_TEMPOS = new Set(["long-form", "short-cut", "multi-shot"]);
const COMPOSER_MODES = new Set(["text", "image", "video"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isString(value) {
  return typeof value === "string";
}

function isOptionalString(value) {
  return value === undefined || isString(value);
}

function isOptionalFiniteNumber(value) {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalPositiveSize(node) {
  if (node.width === undefined && node.height === undefined) return true;
  return typeof node.width === "number" && Number.isFinite(node.width) && node.width > 0 &&
    typeof node.height === "number" && Number.isFinite(node.height) && node.height > 0;
}

function describeNode(node) {
  return isRecord(node) && isString(node.id) ? `节点 ${node.id}` : "未知节点";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertBaseNodeShape(node, roles, statuses, label) {
  assert(isRecord(node), `${label}不是对象。`);
  assert(isString(node.id) && node.id, `${label}缺少 id。`);
  assert(typeof node.x === "number" && Number.isFinite(node.x), `${describeNode(node)} 的 x 无效。`);
  assert(typeof node.y === "number" && Number.isFinite(node.y), `${describeNode(node)} 的 y 无效。`);
  assert(isOptionalPositiveSize(node), `${describeNode(node)} 的宽高必须同时为正数。`);
  assert(isOptionalString(node.label), `${describeNode(node)} 的 label 无效。`);
  assert(isOptionalString(node.storyId), `${describeNode(node)} 的 storyId 无效。`);
  assert(isOptionalString(node.shotRef), `${describeNode(node)} 的 shotRef 无效。`);
  assert(node.storyRole === undefined || roles.has(node.storyRole), `${describeNode(node)} 的 storyRole 未知。`);
  assert(isOptionalString(node.assetRef), `${describeNode(node)} 的 assetRef 无效。`);
  assert(node.assetKind === undefined || ["character", "scene", "prop"].includes(node.assetKind), `${describeNode(node)} 的 assetKind 无效。`);
  assert(node.assetRole === undefined || ["spec", "scheduler", "result"].includes(node.assetRole), `${describeNode(node)} 的 assetRole 无效。`);
  assert(node.foundationRole === undefined || ["lead", "support"].includes(node.foundationRole), `${describeNode(node)} 的 foundationRole 无效。`);
  assert(node.assetStrategy === undefined || node.assetStrategy === "foundation-pair-v1", `${describeNode(node)} 的 assetStrategy 无效。`);
  assert(isOptionalFiniteNumber(node.foundationApprovedAt), `${describeNode(node)} 的 foundationApprovedAt 无效。`);
  assert(isOptionalString(node.storyVisualStyle), `${describeNode(node)} 的 storyVisualStyle 无效。`);
  assert(node.planningStage === undefined || ["character", "scene", "prop", "complete"].includes(node.planningStage), `${describeNode(node)} 的 planningStage 无效。`);
  assert(node.planningStatus === undefined || ["planning", "awaiting-foundation-generation", "awaiting-foundation-approval", "stopped", "failed", "complete"].includes(node.planningStatus), `${describeNode(node)} 的 planningStatus 无效。`);
  assert(node.planningChunkIndex === undefined || (Number.isInteger(node.planningChunkIndex) && node.planningChunkIndex >= 0), `${describeNode(node)} 的 planningChunkIndex 无效。`);
  assert(isOptionalString(node.projectAspectRatio), `${describeNode(node)} 的 projectAspectRatio 无效。`);
  assert(isOptionalString(node.storyImageModel), `${describeNode(node)} 的 storyImageModel 无效。`);

  if (node.type === "source") {
    assert(COMPOSER_MODES.has(node.kind), `${describeNode(node)} 的 source kind 无效。`);
    assert(isString(node.text), `${describeNode(node)} 的文本无效。`);
    assert(isOptionalString(node.assetId), `${describeNode(node)} 的 assetId 无效。`);
    return;
  }
  if (node.type === "scheduler") {
    assert(COMPOSER_MODES.has(node.outputKind), `${describeNode(node)} 的 scheduler 输出类型无效。`);
    assert(isString(node.model), `${describeNode(node)} 的模型无效。`);
    assert(isString(node.prompt), `${describeNode(node)} 的提示词无效。`);
    assert(isString(node.aspectRatio), `${describeNode(node)} 的比例无效。`);
    assert(isString(node.resolution), `${describeNode(node)} 的清晰度无效。`);
    assert(isString(node.duration), `${describeNode(node)} 的时长无效。`);
    assert(Number.isInteger(node.outputCount) && node.outputCount >= 1 && node.outputCount <= 4, `${describeNode(node)} 的输出数量无效。`);
    assert(isString(node.error), `${describeNode(node)} 的错误信息无效。`);
    return;
  }
  if (node.type === "result") {
    assert(COMPOSER_MODES.has(node.kind), `${describeNode(node)} 的 result kind 无效。`);
    assert(isString(node.schedulerId), `${describeNode(node)} 的 schedulerId 无效。`);
    assert(isString(node.text), `${describeNode(node)} 的文本无效。`);
    assert(isString(node.model), `${describeNode(node)} 的模型无效。`);
    assert(statuses.has(node.status), `${describeNode(node)} 的状态无效。`);
    assert(isString(node.progress), `${describeNode(node)} 的进度无效。`);
    assert(isString(node.error), `${describeNode(node)} 的错误信息无效。`);
    assert(isOptionalString(node.resultUrl), `${describeNode(node)} 的 resultUrl 无效。`);
    assert(isOptionalString(node.assetId), `${describeNode(node)} 的 assetId 无效。`);
    assert(isOptionalString(node.assetName), `${describeNode(node)} 的 assetName 无效。`);
    assert(isOptionalString(node.assetMimeType), `${describeNode(node)} 的 assetMimeType 无效。`);
    assert(isOptionalString(node.taskId), `${describeNode(node)} 的 taskId 无效。`);
    assert(isOptionalFiniteNumber(node.startedAt), `${describeNode(node)} 的 startedAt 无效。`);
    return;
  }
  throw new Error(`${describeNode(node)} 的 type 未知。`);
}

function assertMangaMetadataPlacement(node) {
  const nodeLabel = describeNode(node);
  if (hasOwn(node, "storyboardMode")) {
    assert(node.storyRole === "analysis" && ["comic", "tvc"].includes(node.storyboardMode), `${nodeLabel} 的 storyboardMode 位置或值无效。`);
  }
  if (hasOwn(node, "mangaPlanningStage")) {
    assert(node.storyRole === "analysis" && CURRENT_MANGA_STAGES.has(node.mangaPlanningStage), `${nodeLabel} 的 mangaPlanningStage 位置或值无效。`);
  }
  if (hasOwn(node, "mangaPlanningStatus")) {
    assert(node.storyRole === "analysis" && CURRENT_MANGA_STATUSES.has(node.mangaPlanningStatus), `${nodeLabel} 的 mangaPlanningStatus 位置或值无效。`);
  }
  if (hasOwn(node, "mangaPlanningChunkIndex")) {
    assert(node.storyRole === "analysis" && Number.isInteger(node.mangaPlanningChunkIndex) && node.mangaPlanningChunkIndex >= 0, `${nodeLabel} 的 mangaPlanningChunkIndex 位置或值无效。`);
  }
  if (hasOwn(node, "continuityApprovedAt")) {
    assert(node.storyRole === "analysis" && isOptionalFiniteNumber(node.continuityApprovedAt), `${nodeLabel} 的 continuityApprovedAt 位置或值无效。`);
  }
  if (hasOwn(node, "storyBeats")) {
    assert(node.storyRole === "story-beats" && Array.isArray(node.storyBeats), `${nodeLabel} 的 storyBeats 位置或值无效。`);
  }
  if (hasOwn(node, "scenePlan")) {
    assert(node.storyRole === "scene-plan" && isRecord(node.scenePlan), `${nodeLabel} 的 scenePlan 位置或值无效。`);
  }
  if (hasOwn(node, "shotPlan")) {
    assert(node.storyRole === "shot" && isRecord(node.shotPlan), `${nodeLabel} 的 shotPlan 位置或值无效。`);
  }
  if (hasOwn(node, "continuityReport")) {
    assert(node.storyRole === "continuity-report" && isRecord(node.continuityReport), `${nodeLabel} 的 continuityReport 位置或值无效。`);
  }
  if (hasOwn(node, "mangaStoryboardTempo")) {
    assert(
      ["analysis", "storyboard-table", "video-scheduler", "clip"].includes(node.storyRole) &&
        CURRENT_MANGA_TEMPOS.has(node.mangaStoryboardTempo),
      `${nodeLabel} 的 mangaStoryboardTempo 位置或值无效。`,
    );
  }
  if (hasOwn(node, "videoSegment")) {
    assert(
      ["video-scheduler", "clip"].includes(node.storyRole) && isRecord(node.videoSegment),
      `${nodeLabel} 的 videoSegment 位置或值无效。`,
    );
  }
  if (hasOwn(node, "storyboardTable")) {
    assert(node.storyRole === "storyboard-table" && isRecord(node.storyboardTable), `${nodeLabel} 的 storyboardTable 位置或值无效。`);
  }

  const needsStoryId = DIRECTOR_STORY_ROLES.has(node.storyRole) ||
    (node.storyRole === "shot" && hasOwn(node, "shotPlan")) ||
    hasOwn(node, "mangaStoryboardTempo") ||
    hasOwn(node, "videoSegment");
  if (needsStoryId) assert(isString(node.storyId) && node.storyId, `${nodeLabel} 缺少漫剧 storyId。`);
}

export function assertCurrentWorkflowGraph(graph) {
  assert(isRecord(graph), "工作流图不是对象。");
  assert(graph.version === 1, "工作流图版本不是 v1。");
  assert(Array.isArray(graph.nodes), "工作流图缺少 nodes 数组。");
  assert(Array.isArray(graph.edges), "工作流图缺少 edges 数组。");

  const nodeIds = new Set();
  for (const node of graph.nodes) {
    assertBaseNodeShape(node, CURRENT_STORY_ROLES, CURRENT_NODE_STATUSES, "工作流节点");
    assertMangaMetadataPlacement(node);
    assert(!nodeIds.has(node.id), `工作流图包含重复节点 ID：${node.id}。`);
    nodeIds.add(node.id);
  }

  const edgeIds = new Set();
  for (const edge of graph.edges) {
    assert(isRecord(edge), "工作流连线不是对象。");
    assert(isString(edge.id) && edge.id, "工作流连线缺少 id。");
    assert(isString(edge.sourceId) && edge.sourceId, `连线 ${edge.id} 的 sourceId 无效。`);
    assert(isString(edge.targetId) && edge.targetId, `连线 ${edge.id} 的 targetId 无效。`);
    assert(!edgeIds.has(edge.id), `工作流图包含重复连线 ID：${edge.id}。`);
    edgeIds.add(edge.id);
  }
  return graph;
}

export function assertLegacyWorkflowGraph(graph) {
  assert(isRecord(graph), "旧版工作流图不是对象。");
  assert(graph.version === 1, "旧版工作流图版本不是 v1。");
  assert(Array.isArray(graph.nodes), "旧版工作流图缺少 nodes 数组。");
  assert(Array.isArray(graph.edges), "旧版工作流图缺少 edges 数组。");

  const nodeIds = new Set();
  for (const node of graph.nodes) {
    assertBaseNodeShape(node, LEGACY_STORY_ROLES, LEGACY_NODE_STATUSES, "旧版工作流节点");
    for (const key of MANGA_METADATA_KEYS) {
      assert(!hasOwn(node, key), `${describeNode(node)} 仍保留漫剧字段 ${key}。`);
    }
    assert(!nodeIds.has(node.id), `旧版工作流图包含重复节点 ID：${node.id}。`);
    nodeIds.add(node.id);
  }

  const edgeIds = new Set();
  for (const edge of graph.edges) {
    assert(isRecord(edge), "旧版工作流连线不是对象。");
    assert(isString(edge.id) && edge.id, "旧版工作流连线缺少 id。");
    assert(isString(edge.sourceId) && nodeIds.has(edge.sourceId), `旧版连线 ${edge.id} 的 sourceId 无效。`);
    assert(isString(edge.targetId) && nodeIds.has(edge.targetId), `旧版连线 ${edge.id} 的 targetId 无效。`);
    assert(!edgeIds.has(edge.id), `旧版工作流图包含重复连线 ID：${edge.id}。`);
    edgeIds.add(edge.id);
  }
  return graph;
}

function isMangaAnalysis(node) {
  return node.storyRole === "analysis" && (
    node.storyboardMode === "comic" ||
    hasOwn(node, "mangaPlanningStage") ||
    hasOwn(node, "mangaPlanningStatus") ||
    hasOwn(node, "mangaPlanningChunkIndex") ||
    hasOwn(node, "continuityApprovedAt")
  );
}

function isMangaShot(node) {
  return node.storyRole === "shot" && hasOwn(node, "shotPlan");
}

function isMangaSegmentNode(node) {
  return hasOwn(node, "mangaStoryboardTempo") || hasOwn(node, "videoSegment");
}

function mangaStoryIdsFor(nodes) {
  const storyIds = new Set();
  for (const node of nodes) {
    if (!node.storyId) continue;
    if (
      isMangaAnalysis(node) ||
      DIRECTOR_STORY_ROLES.has(node.storyRole) ||
      isMangaShot(node) ||
      isMangaSegmentNode(node)
    ) {
      storyIds.add(node.storyId);
    }
  }
  return storyIds;
}

function removalPlan(graph) {
  const removed = new Map();
  const mangaStoryIds = mangaStoryIdsFor(graph.nodes);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    const inputs = incoming.get(edge.targetId);
    if (inputs) inputs.push(nodeById.get(edge.sourceId));
  }
  const remove = (node, reason) => {
    if (!removed.has(node.id)) removed.set(node.id, reason);
  };

  for (const node of graph.nodes) {
    if (DIRECTOR_STORY_ROLES.has(node.storyRole)) {
      remove(node, "director");
      continue;
    }
    if (isMangaShot(node)) {
      remove(node, "shot");
      continue;
    }
    if (
      node.type === "scheduler" &&
      node.outputKind === "video" &&
      (isMangaSegmentNode(node) || (incoming.get(node.id) ?? []).some((input) =>
        input && (isMangaShot(input) || input.storyRole === "storyboard-table")
      ))
    ) {
      remove(node, "video-scheduler");
    }
  }

  for (const node of graph.nodes) {
    if (node.type !== "scheduler" || node.outputKind !== "video" ||
      !node.storyId || !mangaStoryIds.has(node.storyId) || removed.has(node.id)) {
      continue;
    }
    const inputs = incoming.get(node.id) ?? [];
    const clearlyLegacy = inputs.some((input) =>
      input && (input.storyRole === "storyboard" ||
        (input.storyRole === "shot" && !hasOwn(input, "shotPlan")))
    );
    if (!clearlyLegacy) {
      throw new Error(`漫剧项目 ${node.storyId} 的视频调度器 ${node.id} 无法确认属于导演流程或旧版工作流。`);
    }
  }

  for (const node of graph.nodes) {
    if (node.type !== "result") continue;
    if (removed.has(node.schedulerId) && node.kind !== "video") {
      throw new Error(`${describeNode(node)} 将图片或文本结果连接到被删除的视频调度器。`);
    }
    if (node.kind !== "video") continue;
    const scheduler = nodeById.get(node.schedulerId);
    if (removed.has(node.schedulerId) || isMangaSegmentNode(node)) {
      remove(node, "video-result");
      continue;
    }
    if (node.storyId && mangaStoryIds.has(node.storyId)) {
      const schedulerIsLegacy = scheduler?.type === "scheduler" &&
        scheduler.outputKind === "video" && !removed.has(scheduler.id) &&
        !isMangaSegmentNode(scheduler);
      if (!schedulerIsLegacy) {
        throw new Error(`漫剧项目 ${node.storyId} 的视频结果 ${node.id} 无法确认属于导演流程或旧版工作流。`);
      }
    }
  }

  return { removed, mangaStoryIds };
}

function normalizeLegacyNode(node) {
  const normalized = { ...node };
  for (const key of MANGA_METADATA_KEYS) delete normalized[key];
  if (normalized.type === "result" && normalized.status === "submission-unknown") {
    normalized.status = "failed";
    normalized.progress = "提交状态未知，已按失败状态保留。";
    normalized.error = normalized.error || "任务提交状态未知。";
  }
  return normalized;
}

export function rollbackMangaVideoGraph(sourceGraph) {
  const graph = structuredClone(sourceGraph);
  assertCurrentWorkflowGraph(graph);

  const { removed } = removalPlan(graph);
  const nodes = graph.nodes
    .filter((node) => !removed.has(node.id))
    .map(normalizeLegacyNode);
  const retainedIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) =>
    retainedIds.has(edge.sourceId) && retainedIds.has(edge.targetId)
  );
  const output = { version: 1, nodes, edges };
  assertLegacyWorkflowGraph(output);

  const reasonCounts = {
    director: 0,
    shot: 0,
    videoSchedulers: 0,
    videoResults: 0,
  };
  for (const reason of removed.values()) {
    if (reason === "director") reasonCounts.director += 1;
    if (reason === "shot") reasonCounts.shot += 1;
    if (reason === "video-scheduler") reasonCounts.videoSchedulers += 1;
    if (reason === "video-result") reasonCounts.videoResults += 1;
  }
  const normalizedSubmissionUnknown = graph.nodes.filter((node) =>
    !removed.has(node.id) && node.type === "result" &&
    node.status === "submission-unknown"
  ).length;
  const strippedMetadataFields = graph.nodes
    .filter((node) => !removed.has(node.id))
    .reduce((count, node) =>
      count + MANGA_METADATA_KEYS.filter((key) => hasOwn(node, key)).length,
    0);

  return {
    graph: output,
    stats: {
      nodesBefore: graph.nodes.length,
      nodesRetained: nodes.length,
      nodesRemoved: graph.nodes.length - nodes.length,
      edgesBefore: graph.edges.length,
      edgesRetained: edges.length,
      edgesRemoved: graph.edges.length - edges.length,
      directorNodesRemoved: reasonCounts.director,
      mangaShotNodesRemoved: reasonCounts.shot,
      videoSchedulersRemoved: reasonCounts.videoSchedulers,
      videoResultsRemoved: reasonCounts.videoResults,
      successfulImageResultsRetained: nodes.filter((node) =>
        node.type === "result" && node.kind === "image" && node.status === "success"
      ).length,
      cloudImageAssetsRetained: nodes.filter((node) =>
        node.type === "result" && node.kind === "image" &&
        node.status === "success" && isString(node.assetId) && node.assetId
      ).length,
      submissionUnknownNormalized: normalizedSubmissionUnknown,
      mangaMetadataFieldsStripped: strippedMetadataFields,
    },
  };
}

export function prepareProjectRollback(project) {
  assert(isRecord(project), "项目记录不是对象。");
  assert(isString(project.id) && project.id, "项目记录缺少 id。");
  assert(isString(project.name), `项目 ${project.id} 的 name 无效。`);
  const migrated = rollbackMangaVideoGraph(project.graph);
  const batchCleared = project.batch !== null && project.batch !== undefined;
  const changed = migrated.stats.nodesRemoved > 0 ||
    migrated.stats.edgesRemoved > 0 ||
    migrated.stats.submissionUnknownNormalized > 0 ||
    migrated.stats.mangaMetadataFieldsStripped > 0 ||
    batchCleared;
  return {
    id: project.id,
    name: project.name,
    graph: migrated.graph,
    changed,
    summary: {
      projectId: project.id,
      name: project.name,
      ...migrated.stats,
      batchCleared,
      changed,
    },
  };
}

function assertAssetRecord(asset) {
  assert(isRecord(asset), "素材记录不是对象。");
  assert(isString(asset.id) && asset.id, "素材记录缺少 id。");
  assert(isString(asset.project_id) && asset.project_id, `素材 ${asset.id} 缺少 project_id。`);
  assert(asset.node_id === null || isString(asset.node_id), `素材 ${asset.id} 的 node_id 无效。`);
  assert(isString(asset.mime_type), `素材 ${asset.id} 的 mime_type 无效。`);
  assert(isString(asset.status), `素材 ${asset.id} 的 status 无效。`);
}

export function validateRetainedImageAssets(projects, assetRows) {
  assert(Array.isArray(assetRows), "素材查询结果不是数组。");
  const assetsByProject = new Map();
  for (const asset of assetRows) {
    assertAssetRecord(asset);
    const byId = assetsByProject.get(asset.project_id) ?? new Map();
    assert(!byId.has(asset.id), `项目 ${asset.project_id} 存在重复素材 ID：${asset.id}。`);
    byId.set(asset.id, asset);
    assetsByProject.set(asset.project_id, byId);
  }

  for (const project of projects) {
    const projectAssets = assetsByProject.get(project.id) ?? new Map();
    const referencedAssetIds = new Set(project.graph.nodes.flatMap((node) =>
      node.type === "result" && node.kind === "image" &&
      node.status === "success" && isString(node.assetId) && node.assetId
        ? [node.assetId]
        : []
    ));
    const mismatches = [];
    for (const assetId of referencedAssetIds) {
      const asset = projectAssets.get(assetId);
      if (!asset) {
        mismatches.push(`${assetId}（缺少数据库记录）`);
        continue;
      }
      if (asset.status !== "ready" || !asset.mime_type.startsWith("image/")) {
        mismatches.push(`${assetId}（素材状态或类型无效）`);
      }
    }
    const readyImageAssets = [...projectAssets.values()].filter((asset) =>
      asset.status === "ready" && asset.mime_type.startsWith("image/")
    );
    const unreferencedImageAssets = readyImageAssets.filter((asset) =>
      !referencedAssetIds.has(asset.id)
    );

    project.summary.imageAssetRecords = readyImageAssets.length;
    project.summary.referencedImageAssetRecords = referencedAssetIds.size;
    project.summary.orphanedImageResultAssets = mismatches.length;
    project.summary.unreferencedImageAssetRecords = unreferencedImageAssets.length;
    if (mismatches.length) {
      throw new Error(`项目 ${project.id} 的成功图片节点存在素材不匹配：${mismatches.join("、")}。`);
    }
  }
  return projects;
}

export function buildRollbackReport(projects, apply) {
  const summaries = projects.map((project) => project.summary);
  const totals = summaries.reduce((result, summary) => {
    for (const [key, value] of Object.entries(summary)) {
      if (typeof value === "number" || typeof value === "boolean") {
        result[key] = (result[key] ?? 0) + Number(value);
      }
    }
    return result;
  }, {});
  return {
    mode: apply ? "apply" : "dry-run",
    projects: summaries,
    totals: {
      projects: summaries.length,
      projectsChanged: summaries.filter((summary) => summary.changed).length,
      ...totals,
    },
  };
}

export function parseRollbackArguments(args) {
  const flags = new Set(args);
  for (const flag of flags) {
    if (flag !== "--dry-run" && flag !== "--apply") {
      throw new Error("Usage: node scripts/rollback-manga-video-projects.mjs [--dry-run|--apply]");
    }
  }
  if (flags.has("--apply") && flags.has("--dry-run")) {
    throw new Error("Choose either --dry-run or --apply, not both.");
  }
  return { apply: flags.has("--apply") };
}

function environment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function runRollbackMigration({ databaseUrl, apply, makeSql = (url) => postgres(url, { max: 1 }) }) {
  if (!isString(databaseUrl) || !databaseUrl.trim()) throw new Error("DATABASE_URL is required");
  const sql = makeSql(databaseUrl);
  try {
    if (!apply) {
      const rows = await sql`
        SELECT id, name, graph, batch
        FROM canvas_projects
        ORDER BY created_at, id
      `;
      const assets = await sql`
        SELECT id, project_id, node_id, mime_type, status
        FROM canvas_assets
        ORDER BY project_id, id
      `;
      const projects = rows.map(prepareProjectRollback);
      validateRetainedImageAssets(projects, assets);
      return buildRollbackReport(projects, false);
    }

    return await sql.begin(async (transaction) => {
      await transaction`
        LOCK TABLE canvas_projects, canvas_assets IN SHARE ROW EXCLUSIVE MODE
      `;
      const rows = await transaction`
        SELECT id, name, graph, batch
        FROM canvas_projects
        ORDER BY created_at, id
        FOR UPDATE
      `;
      const assets = await transaction`
        SELECT id, project_id, node_id, mime_type, status
        FROM canvas_assets
        ORDER BY project_id, id
      `;
      const projects = rows.map(prepareProjectRollback);
      validateRetainedImageAssets(projects, assets);
      for (const project of projects) {
        if (!project.changed) continue;
        await transaction`
          UPDATE canvas_projects
          SET graph = ${transaction.json(project.graph)}, batch = null,
              revision = revision + 1, updated_at = now()
          WHERE id = ${project.id}
        `;
      }
      return buildRollbackReport(projects, true);
    });
  } finally {
    await sql.end();
  }
}

async function main() {
  const { apply } = parseRollbackArguments(process.argv.slice(2));
  const report = await runRollbackMigration({
    databaseUrl: environment("DATABASE_URL"),
    apply,
  });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
