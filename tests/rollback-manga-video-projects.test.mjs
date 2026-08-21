import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLegacyWorkflowGraph,
  parseRollbackArguments,
  prepareProjectRollback,
  rollbackMangaVideoGraph,
  runRollbackMigration,
  validateRetainedImageAssets,
} from "../scripts/rollback-manga-video-projects.mjs";

function source(id, overrides = {}) {
  return {
    id,
    x: 0,
    y: 0,
    type: "source",
    kind: "text",
    text: id,
    ...overrides,
  };
}

function scheduler(id, overrides = {}) {
  return {
    id,
    x: 0,
    y: 0,
    type: "scheduler",
    outputKind: "video",
    model: "seedance-2.0",
    prompt: "prompt",
    aspectRatio: "16:9",
    resolution: "720p",
    duration: "10",
    outputCount: 1,
    error: "",
    ...overrides,
  };
}

function result(id, schedulerId, overrides = {}) {
  return {
    id,
    x: 0,
    y: 0,
    type: "result",
    kind: "video",
    schedulerId,
    text: id,
    model: "seedance-2.0",
    status: "ready",
    progress: "待生成",
    error: "",
    ...overrides,
  };
}

function graph(nodes, edges = []) {
  return { version: 1, nodes, edges };
}

function fakeDatabase({ projects, assets }) {
  const calls = [];
  const query = (strings) => strings.join(" ").replace(/\s+/g, " ").trim();
  const execute = (strings) => {
    const text = query(strings);
    calls.push(text);
    if (text.includes("SELECT id, name, graph, batch FROM canvas_projects")) return projects;
    if (text.includes("SELECT id, project_id, node_id, mime_type, status FROM canvas_assets")) return assets;
    return [];
  };
  const sql = (strings) => Promise.resolve(execute(strings));
  sql.json = (value) => value;
  sql.end = async () => { calls.push("END"); };
  sql.begin = async (callback) => {
    calls.push("BEGIN");
    const transaction = (strings) => Promise.resolve(execute(strings));
    transaction.json = (value) => value;
    return callback(transaction);
  };
  return { sql, calls };
}

test("removes manga director and video nodes while retaining assets and a legacy workflow", () => {
  const original = graph([
    source("analysis", {
      storyId: "manga-story",
      storyRole: "analysis",
      storyboardMode: "comic",
      mangaStoryboardTempo: "multi-shot",
      mangaPlanningStage: "complete",
      mangaPlanningStatus: "complete",
      mangaPlanningChunkIndex: 0,
      continuityApprovedAt: 5,
    }),
    source("asset-spec", {
      storyId: "manga-story",
      storyRole: "asset-spec",
      assetRef: "lead",
      assetKind: "character",
      assetRole: "spec",
    }),
    scheduler("asset-scheduler", {
      outputKind: "image",
      model: "gpt-image-2",
      duration: "",
      storyId: "manga-story",
      storyRole: "asset-scheduler",
      assetRef: "lead",
      assetKind: "character",
      assetRole: "scheduler",
    }),
    result("asset-result", "asset-scheduler", {
      kind: "image",
      model: "gpt-image-2",
      status: "success",
      progress: "",
      resultUrl: "/api/workflow/assets/lead-image",
      assetId: "lead-image",
      assetName: "主角",
      assetMimeType: "image/png",
      storyId: "manga-story",
      storyRole: "asset-result",
      assetRef: "lead",
      assetKind: "character",
      assetRole: "result",
    }),
    source("beats", {
      storyId: "manga-story",
      storyRole: "story-beats",
      storyBeats: [],
    }),
    source("scene-plan", {
      storyId: "manga-story",
      storyRole: "scene-plan",
      scenePlan: { sceneId: "scene-1" },
    }),
    source("manga-shot", {
      storyId: "manga-story",
      storyRole: "shot",
      shotPlan: { shotId: "shot-001" },
    }),
    source("storyboard-table", {
      storyId: "manga-story",
      storyRole: "storyboard-table",
      mangaStoryboardTempo: "multi-shot",
      storyboardTable: { version: 1 },
    }),
    scheduler("manga-video", {
      storyId: "manga-story",
      storyRole: "video-scheduler",
      mangaStoryboardTempo: "multi-shot",
      videoSegment: { segmentId: "segment-001" },
    }),
    result("manga-clip", "manga-video", {
      storyId: "manga-story",
      storyRole: "clip",
      mangaStoryboardTempo: "multi-shot",
      videoSegment: { segmentId: "segment-001" },
      status: "submission-unknown",
      progress: "提交状态未知",
      error: "未收到任务编号",
    }),
    source("continuity", {
      storyId: "manga-story",
      storyRole: "continuity-report",
      continuityReport: { issues: [] },
    }),
    source("legacy-project", {
      storyId: "legacy-story",
      storyRole: "project",
    }),
    source("legacy-shot", {
      storyId: "legacy-story",
      storyRole: "shot",
    }),
    scheduler("legacy-video", {
      storyId: "legacy-story",
      storyRole: "video-scheduler",
    }),
    result("legacy-clip", "legacy-video", {
      storyId: "legacy-story",
      storyRole: "clip",
      status: "submission-unknown",
      progress: "提交状态未知",
      error: "网络中断",
    }),
  ], [
    { id: "e-analysis-beats", sourceId: "analysis", targetId: "beats" },
    { id: "e-beats-scene", sourceId: "beats", targetId: "scene-plan" },
    { id: "e-scene-shot", sourceId: "scene-plan", targetId: "manga-shot" },
    { id: "e-shot-video", sourceId: "manga-shot", targetId: "manga-video" },
    { id: "e-asset-video", sourceId: "asset-result", targetId: "manga-video" },
    { id: "e-video-clip", sourceId: "manga-video", targetId: "manga-clip" },
    { id: "e-legacy-shot-video", sourceId: "legacy-shot", targetId: "legacy-video" },
    { id: "e-legacy-video-clip", sourceId: "legacy-video", targetId: "legacy-clip" },
    { id: "e-dangling", sourceId: "asset-result", targetId: "missing" },
  ]);

  const migrated = rollbackMangaVideoGraph(original);
  const retained = new Map(migrated.graph.nodes.map((node) => [node.id, node]));

  assert.deepEqual([...retained.keys()], [
    "analysis",
    "asset-spec",
    "asset-scheduler",
    "asset-result",
    "legacy-project",
    "legacy-shot",
    "legacy-video",
    "legacy-clip",
  ]);
  assert.equal(retained.get("asset-result").assetId, "lead-image");
  assert.equal(retained.get("legacy-clip").status, "failed");
  assert.equal(retained.get("legacy-clip").progress, "提交状态未知，已按失败状态保留。");
  assert.equal(retained.get("analysis").storyboardMode, undefined);
  assert.equal(retained.get("analysis").mangaPlanningStage, undefined);
  assert.deepEqual(migrated.graph.edges, [
    { id: "e-legacy-shot-video", sourceId: "legacy-shot", targetId: "legacy-video" },
    { id: "e-legacy-video-clip", sourceId: "legacy-video", targetId: "legacy-clip" },
  ]);
  assert.equal(migrated.stats.directorNodesRemoved, 4);
  assert.equal(migrated.stats.mangaShotNodesRemoved, 1);
  assert.equal(migrated.stats.videoSchedulersRemoved, 1);
  assert.equal(migrated.stats.videoResultsRemoved, 1);
  assert.equal(migrated.stats.successfulImageResultsRetained, 1);
  assert.equal(migrated.stats.cloudImageAssetsRetained, 1);
  assert.equal(migrated.stats.submissionUnknownNormalized, 1);
  assertLegacyWorkflowGraph(migrated.graph);

  assert.equal(original.nodes.find((node) => node.id === "analysis").mangaPlanningStage, "complete");
  assert.equal(original.nodes.find((node) => node.id === "manga-clip").status, "submission-unknown");
});

test("preserves clearly legacy shots and video nodes that share a manga analysis story", () => {
  const migrated = rollbackMangaVideoGraph(graph([
    source("analysis", {
      storyId: "manga-story",
      storyRole: "analysis",
      storyboardMode: "comic",
    }),
    source("old-shaped-shot", {
      storyId: "manga-story",
      storyRole: "shot",
    }),
    source("legacy-storyboard", {
      storyId: "manga-story",
      storyRole: "storyboard",
    }),
    scheduler("old-shaped-video", {
      storyId: "manga-story",
      storyRole: "video-scheduler",
    }),
    result("old-shaped-clip", "old-shaped-video", {
      storyId: "manga-story",
      storyRole: "clip",
    }),
    scheduler("asset-scheduler", {
      outputKind: "image",
      model: "gpt-image-2",
      duration: "",
      storyId: "manga-story",
      storyRole: "asset-scheduler",
    }),
    result("asset-image", "asset-scheduler", {
      kind: "image",
      model: "gpt-image-2",
      status: "success",
      progress: "",
      storyId: "manga-story",
      storyRole: "asset-result",
      assetId: "asset-id",
    }),
  ], [
    { id: "e-shot-video", sourceId: "old-shaped-shot", targetId: "old-shaped-video" },
    { id: "e-storyboard-video", sourceId: "legacy-storyboard", targetId: "old-shaped-video" },
    { id: "e-video-clip", sourceId: "old-shaped-video", targetId: "old-shaped-clip" },
  ]));

  assert.deepEqual(migrated.graph.nodes.map((node) => node.id), [
    "analysis",
    "old-shaped-shot",
    "legacy-storyboard",
    "old-shaped-video",
    "old-shaped-clip",
    "asset-scheduler",
    "asset-image",
  ]);
  assert.equal(migrated.stats.mangaShotNodesRemoved, 0);
  assert.equal(migrated.stats.videoSchedulersRemoved, 0);
  assert.equal(migrated.stats.videoResultsRemoved, 0);
  assert.equal(migrated.stats.successfulImageResultsRetained, 1);
});

test("rejects unknown, malformed, or ambiguous manga graph shapes before producing a migration", () => {
  assert.throws(
    () => rollbackMangaVideoGraph(graph([
      source("unknown", { storyRole: "future-role" }),
    ])),
    /storyRole 未知/,
  );
  assert.throws(
    () => rollbackMangaVideoGraph(graph([
      source("broken-director", { storyRole: "story-beats", storyBeats: [] }),
    ])),
    /缺少漫剧 storyId/,
  );
  assert.throws(
    () => rollbackMangaVideoGraph(graph([
      source("analysis", {
        storyId: "manga-story",
        storyRole: "analysis",
        storyboardMode: "comic",
      }),
      scheduler("ambiguous-video", {
        storyId: "manga-story",
        storyRole: "video-scheduler",
      }),
    ])),
    /无法确认属于导演流程或旧版工作流/,
  );
});

test("reports dry-run project work without mutating the source graph or batch", () => {
  const project = {
    id: "project-1",
    name: "白雪公主",
    graph: graph([
      source("analysis", {
        storyId: "story-1",
        storyRole: "analysis",
        mangaPlanningStage: "story-beats",
      }),
      source("beats", {
        storyId: "story-1",
        storyRole: "story-beats",
        storyBeats: [],
      }),
    ]),
    batch: { version: 1, id: "video-batch" },
  };

  const prepared = prepareProjectRollback(project);
  assert.equal(prepared.changed, true);
  assert.equal(prepared.summary.batchCleared, true);
  assert.equal(prepared.summary.nodesRemoved, 1);
  assert.deepEqual(prepared.graph.nodes.map((node) => node.id), ["analysis"]);
  assert.equal(project.graph.nodes.length, 2);
  assert.deepEqual(project.batch, { version: 1, id: "video-batch" });
});

test("validates retained cloud image assets and reports unreferenced asset records", () => {
  const prepared = prepareProjectRollback({
    id: "project-assets",
    name: "图片资产",
    graph: graph([
      scheduler("image-scheduler", {
        outputKind: "image",
        model: "gpt-image-2",
        duration: "",
      }),
      result("image-result", "image-scheduler", {
        kind: "image",
        model: "gpt-image-2",
        status: "success",
        progress: "",
        assetId: "image-asset",
        assetMimeType: "image/png",
      }),
    ]),
    batch: null,
  });

  assert.throws(
    () => validateRetainedImageAssets([prepared], []),
    /成功图片节点存在素材不匹配/,
  );
  validateRetainedImageAssets([prepared], [
    {
      id: "image-asset",
      project_id: "project-assets",
      node_id: "image-result",
      mime_type: "image/png",
      status: "ready",
    },
    {
      id: "unreferenced-image",
      project_id: "project-assets",
      node_id: null,
      mime_type: "image/webp",
      status: "ready",
    },
  ]);
  assert.equal(prepared.summary.imageAssetRecords, 2);
  assert.equal(prepared.summary.referencedImageAssetRecords, 1);
  assert.equal(prepared.summary.orphanedImageResultAssets, 0);
  assert.equal(prepared.summary.unreferencedImageAssetRecords, 1);
});

test("uses dry-run by default and accepts only the two migration flags", () => {
  assert.deepEqual(parseRollbackArguments([]), { apply: false });
  assert.deepEqual(parseRollbackArguments(["--dry-run"]), { apply: false });
  assert.deepEqual(parseRollbackArguments(["--apply"]), { apply: true });
  assert.throws(() => parseRollbackArguments(["--apply", "--dry-run"]), /Choose either/);
  assert.throws(() => parseRollbackArguments(["--unsafe"]), /Usage:/);
});

test("dry-run never opens a transaction, and apply validates all assets before updating", async () => {
  const project = {
    id: "project-run",
    name: "运行测试",
    graph: graph([
      source("analysis", {
        storyId: "story-run",
        storyRole: "analysis",
        mangaPlanningStage: "story-beats",
      }),
      source("beats", {
        storyId: "story-run",
        storyRole: "story-beats",
        storyBeats: [],
      }),
      scheduler("image-scheduler", {
        outputKind: "image",
        model: "gpt-image-2",
        duration: "",
      }),
      result("image-result", "image-scheduler", {
        kind: "image",
        model: "gpt-image-2",
        status: "success",
        progress: "",
        assetId: "image-asset",
      }),
    ]),
    batch: null,
  };
  const dryRun = fakeDatabase({
    projects: [project],
    assets: [{
      id: "image-asset",
      project_id: "project-run",
      node_id: "image-result",
      mime_type: "image/png",
      status: "ready",
    }],
  });
  const report = await runRollbackMigration({
    databaseUrl: "postgres://test",
    apply: false,
    makeSql: () => dryRun.sql,
  });
  assert.equal(report.mode, "dry-run");
  assert.ok(!dryRun.calls.includes("BEGIN"));
  assert.equal(dryRun.calls.filter((call) => call.startsWith("UPDATE canvas_projects")).length, 0);

  const invalidApply = fakeDatabase({
    projects: [project],
    assets: [{
      id: "unrelated",
      project_id: "project-run",
      node_id: null,
      mime_type: "image/png",
      status: "ready",
    }],
  });
  await assert.rejects(
    () => runRollbackMigration({
      databaseUrl: "postgres://test",
      apply: true,
      makeSql: () => invalidApply.sql,
    }),
    /成功图片节点存在素材不匹配|素材不匹配/,
  );
  assert.ok(invalidApply.calls.some((call) => call.startsWith("LOCK TABLE canvas_projects")));
  assert.equal(invalidApply.calls.filter((call) => call.startsWith("UPDATE canvas_projects")).length, 0);
});
