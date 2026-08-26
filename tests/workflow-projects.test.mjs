import assert from "node:assert/strict";
import test from "node:test";
import { WORKFLOW_AGENT_CONVERSATIONS_STORAGE_KEY } from "../app/ai/agent.ts";
import { WORKFLOW_BATCH_STORAGE_KEY } from "../app/workflow/agent.ts";
import { WORKFLOW_STORAGE_KEY, emptyWorkflowGraph } from "../app/workflow/graph.ts";
import { emptyTvcWorkflowGraph } from "../app/workflow/tvc.ts";
import {
  WORKFLOW_PROJECTS_STORAGE_KEY,
  WORKFLOW_ASSET_LAYOUT_MIGRATION_KEY,
  createWorkflowProject,
  ensureWorkflowProjectRegistry,
  importWorkflowProject,
  migrateActiveWorkflowAssetLayout,
  parseWorkflowProjectRegistry,
  parseWorkflowViewport,
  projectSourceAssetIds,
  rebindImportedWorkflowAssets,
  removeWorkflowProject,
  renameWorkflowProject,
  workflowProjectBatchKey,
  workflowProjectConversationKey,
  workflowProjectGraphKey,
} from "../app/workflow/projects.ts";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    values,
  };
}

function importRegistry(projects = [{ id: "existing", name: "已有项目", createdAt: 1, updatedAt: 1 }]) {
  return { version: 1, activeProjectId: projects[0].id, projects };
}

function tvcImportGraph() {
  const graph = emptyTvcWorkflowGraph(() => "tvc-state");
  graph.nodes = [
    {
      id: "image-source",
      x: 0,
      y: 0,
      type: "source",
      kind: "image",
      text: "占位图",
      assetId: "asset-old",
      assetName: "reference.png",
      assetMimeType: "image/png",
    },
    {
      id: "image-result",
      x: 360,
      y: 0,
      type: "result",
      kind: "image",
      schedulerId: "image-scheduler",
      text: "生成图",
      model: "gpt-image-2",
      status: "success",
      progress: "已完成",
      error: "",
      assetId: "asset-old",
      assetName: "reference.png",
      assetMimeType: "image/png",
    },
  ];
  return graph;
}

function exportedProjectPayload(overrides = {}) {
  return {
    version: 1,
    exportedAt: "2026-08-26T00:00:00.000Z",
    project: { id: "exported-id", name: "红色意式超级跑车｜占位TVC验收", createdAt: 10, updatedAt: 20 },
    graph: tvcImportGraph(),
    viewport: { x: 40, y: -30, scale: 1.5 },
    batch: null,
    conversation: { version: 2, activeConversationId: "conversation-1", conversations: [] },
    assets: [{
      id: "asset-old",
      name: "reference.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AQ==",
    }],
    ...overrides,
  };
}

test("imports a v1 TVC project with remapped local image assets", () => {
  const imported = importWorkflowProject(
    importRegistry(),
    JSON.stringify(exportedProjectPayload()),
    () => "project-imported",
    100,
  );
  assert.equal(imported.project.id, "project-imported");
  assert.equal(imported.project.name, "红色意式超级跑车｜占位TVC验收");
  assert.equal(imported.project.createdAt, 100);
  assert.equal(imported.registry.activeProjectId, "project-imported");
  assert.equal(imported.registry.projects.length, 2);
  assert.equal(imported.graph.tvc?.projectId, "tvc-state");
  assert.deepEqual(
    imported.graph.nodes.map((node) => node.assetId),
    ["project-imported-asset-1", "project-imported-asset-1"],
  );
  assert.deepEqual(imported.assets, [{
    id: "project-imported-asset-1",
    name: "reference.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,AQ==",
  }]);
  assert.deepEqual(imported.viewport, { x: 40, y: -30, scale: 1.5 });
  assert.equal(imported.batch, null);
  assert.deepEqual(imported.conversation, {
    version: 2,
    activeConversationId: "conversation-1",
    conversations: [],
  });
});

test("imports and rebinds an export-only asset for a successful generated image result", () => {
  const generatedResult = {
    ...emptyWorkflowGraph(),
    nodes: [{
      id: "generated-image-result",
      x: 0,
      y: 0,
      type: "result",
      kind: "image",
      schedulerId: "generated-image-scheduler",
      text: "真实生成图片",
      model: "gpt-image-2",
      status: "success",
      progress: "已完成",
      error: "",
      // `exportLocalProject` adds this only to its cloned graph after reading
      // the local provider result URL into the embedded asset payload.
      resultUrl: "https://media.example.test/generated.webp",
      assetId: "export-result-generated-image-result",
      assetName: "generated-image.webp",
      assetMimeType: "image/webp",
    }],
  };
  const imported = importWorkflowProject(
    importRegistry(),
    JSON.stringify(exportedProjectPayload({
      graph: generatedResult,
      assets: [{
        id: "export-result-generated-image-result",
        name: "generated-image.webp",
        mimeType: "image/webp",
        dataUrl: "data:image/webp;base64,AQ==",
      }],
    })),
    () => "generated-project",
    100,
  );

  assert.equal(imported.graph.nodes[0]?.assetId, "generated-project-asset-1");
  const rebound = rebindImportedWorkflowAssets(
    imported.graph,
    new Map([["generated-project-asset-1", { assetId: "cloud-generated-asset" }]]),
  );
  const result = rebound.nodes[0];
  assert.equal(result?.assetId, "cloud-generated-asset");
  assert.equal(result?.type, "result");
  assert.equal(result?.resultUrl, "/api/workflow/assets/cloud-generated-asset");
});

test("rebinds imported image assets to cloud IDs without changing TVC state", () => {
  const imported = importWorkflowProject(
    importRegistry(),
    JSON.stringify(exportedProjectPayload()),
    () => "project-imported",
    100,
  );
  const videoResult = {
    id: "segment-002",
    x: 720,
    y: 0,
    type: "result",
    kind: "video",
    schedulerId: "segment-scheduler",
    text: "视频结果占位",
    model: "doubao-seedance-2-5-quannengcankao",
    status: "submission-unknown",
    progress: "提交状态未知",
    error: "未收到任务编号，无法确认媒体平台是否已接收请求。",
    storyRole: "tvc-video-result",
    tvcProjectId: "tvc-state",
    tvcUnitRef: "segment-002",
  };
  const manualScheduler = {
    id: "segment-scheduler",
    x: 360,
    y: 0,
    type: "scheduler",
    outputKind: "video",
    model: "doubao-seedance-2-5-quannengcankao",
    prompt: "已手动调整的最终提示词",
    aspectRatio: "16:9",
    resolution: "720p",
    duration: "30",
    outputCount: 1,
    error: "",
    storyRole: "tvc-video-scheduler",
    tvcProjectId: "tvc-state",
    tvcUnitRef: "segment-002",
    tvcVideoManualOverride: {
      sourceRevision: 3,
      sourceUnitRef: "segment-002",
      sourceStartSecond: 30,
      sourceEndSecond: 60,
      sourcePrompt: "锁稿提示词",
    },
  };
  const graph = {
    ...imported.graph,
    nodes: [...imported.graph.nodes, manualScheduler, videoResult],
  };
  const rebound = rebindImportedWorkflowAssets(
    graph,
    new Map([[
      "project-imported-asset-1",
      {
        assetId: "cloud-asset-1",
        assetUrl: "/api/workflow/assets/cloud-asset-1?v=ready",
      },
    ]]),
  );

  const imageNodes = rebound.nodes.filter((node) => node.kind === "image");
  assert.deepEqual(imageNodes.map((node) => node.assetId), ["cloud-asset-1", "cloud-asset-1"]);
  assert.equal(imageNodes[1].type, "result");
  assert.equal(imageNodes[1].resultUrl, "/api/workflow/assets/cloud-asset-1?v=ready");
  assert.equal(rebound.tvc?.projectId, "tvc-state");
  assert.equal(
    rebound.nodes.find((node) => node.id === "segment-002")?.status,
    "submission-unknown",
  );
  assert.deepEqual(
    rebound.nodes.find((node) => node.id === "segment-scheduler")?.tvcVideoManualOverride,
    manualScheduler.tvcVideoManualOverride,
  );
  assert.equal(imported.graph.nodes[0].assetId, "project-imported-asset-1");
});

test("refuses to save an imported graph until every referenced image has a cloud asset", () => {
  const imported = importWorkflowProject(
    importRegistry(),
    JSON.stringify(exportedProjectPayload()),
    () => "project-imported",
    100,
  );
  assert.throws(
    () => rebindImportedWorkflowAssets(imported.graph, new Map()),
    /未完整上传/,
  );
});

test("uses the authenticated cloud asset route when no result URL is supplied", () => {
  const imported = importWorkflowProject(
    importRegistry(),
    JSON.stringify(exportedProjectPayload()),
    () => "project-imported",
    100,
  );
  const rebound = rebindImportedWorkflowAssets(
    imported.graph,
    new Map([["project-imported-asset-1", { assetId: "cloud asset/1" }]]),
  );
  const imageResult = rebound.nodes.find((node) => node.id === "image-result");
  assert.equal(imageResult?.type, "result");
  assert.equal(imageResult?.resultUrl, "/api/workflow/assets/cloud%20asset%2F1");
});

test("imports choose deterministic project and project-name collisions without overwriting", () => {
  const registry = importRegistry([
    { id: "project-imported", name: "已有项目", createdAt: 1, updatedAt: 1 },
    { id: "other", name: "红色意式超级跑车｜占位TVC验收", createdAt: 2, updatedAt: 2 },
    { id: "third", name: "红色意式超级跑车｜占位TVC验收-导入", createdAt: 3, updatedAt: 3 },
  ]);
  const imported = importWorkflowProject(
    registry,
    JSON.stringify(exportedProjectPayload()),
    () => "project-imported",
    100,
  );
  assert.equal(imported.project.id, "project-imported-import-2");
  assert.equal(imported.project.name, "红色意式超级跑车｜占位TVC验收-导入-2");
  assert.equal(new Set(imported.registry.projects.map((project) => project.id)).size, 4);
  assert.equal(new Set(imported.registry.projects.map((project) => project.name)).size, 4);
});

test("rejects invalid project files without changing the current registry", () => {
  const registry = importRegistry();
  const before = structuredClone(registry);
  const invalidGraph = exportedProjectPayload({
    graph: { version: 1, nodes: [{ id: "bad" }], edges: [] },
  });
  assert.throws(
    () => importWorkflowProject(registry, JSON.stringify(invalidGraph), () => "new-project"),
    /工作流图无效/,
  );
  assert.deepEqual(registry, before);
  const invalidPayload = exportedProjectPayload({ batch: { id: "legacy-batch" } });
  assert.throws(
    () => importWorkflowProject(registry, JSON.stringify(invalidPayload), () => "new-project"),
    /受支持/,
  );
  assert.deepEqual(registry, before);
});

test("uses a safe default viewport and rejects unreferenced imported image data", () => {
  const imported = importWorkflowProject(
    importRegistry(),
    JSON.stringify(exportedProjectPayload({ viewport: { x: 0, y: 0, scale: 8 } })),
    () => "viewport-project",
  );
  assert.deepEqual(imported.viewport, { x: 0, y: 0, scale: 1 });
  const invalidAssets = exportedProjectPayload({
    assets: {
      unused: {
        id: "unused",
        name: "unused.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,AQ==",
      },
    },
  });
  assert.throws(
    () => importWorkflowProject(importRegistry(), JSON.stringify(invalidAssets), () => "asset-project"),
    /图片素材无效/,
  );
});

test("imports SVG image data for a referenced local asset", () => {
  const imported = importWorkflowProject(
    importRegistry(),
    JSON.stringify(exportedProjectPayload({
      assets: {
        "asset-old": {
          id: "asset-old",
        name: "placeholder.svg",
        mimeType: "image/svg+xml",
        dataUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
        },
      },
    })),
    () => "svg-project",
  );
  assert.equal(imported.assets[0].mimeType, "image/svg+xml");
  assert.equal(imported.assets[0].id, "svg-project-asset-1");
});

test("keeps legacy v1 exports without embedded assets importable", () => {
  const payload = exportedProjectPayload();
  delete payload.assets;
  const imported = importWorkflowProject(
    importRegistry(),
    JSON.stringify(payload),
    () => "legacy-project",
  );
  assert.deepEqual(imported.assets, []);
  assert.equal(imported.graph.nodes[0].assetId, "legacy-project-asset-1");
});

test("migrates the legacy workflow graph, queue, and conversation into one named project", () => {
  const graph = {
    ...emptyWorkflowGraph(),
    nodes: [{
      id: "analysis",
      x: 0,
      y: 0,
      type: "source",
      kind: "text",
      text: "剧本分析",
      label: "白雪公主 · 剧本分析 · 已完成",
      storyRole: "analysis",
    }],
  };
  const storage = memoryStorage({
    [WORKFLOW_STORAGE_KEY]: JSON.stringify(graph),
    [WORKFLOW_BATCH_STORAGE_KEY]: JSON.stringify({ version: 1, id: "batch" }),
    [WORKFLOW_AGENT_CONVERSATIONS_STORAGE_KEY]: JSON.stringify({ version: 2 }),
  });
  const registry = ensureWorkflowProjectRegistry(storage, () => "project-old", 100);
  assert.equal(registry.projects[0].name, "白雪公主-旧版");
  assert.deepEqual(
    JSON.parse(storage.getItem(workflowProjectGraphKey("project-old"))),
    graph,
  );
  assert.ok(storage.getItem(workflowProjectBatchKey("project-old")));
  assert.ok(storage.getItem(workflowProjectConversationKey("project-old")));
  assert.equal(storage.getItem(WORKFLOW_STORAGE_KEY), null);
  assert.equal(storage.getItem(WORKFLOW_BATCH_STORAGE_KEY), null);
  assert.equal(storage.getItem(WORKFLOW_AGENT_CONVERSATIONS_STORAGE_KEY), null);
  assert.deepEqual(
    parseWorkflowProjectRegistry(storage.getItem(WORKFLOW_PROJECTS_STORAGE_KEY)),
    registry,
  );
});

test("creates, renames, switches, and replaces the final project without name collisions", () => {
  const storage = memoryStorage();
  const initial = ensureWorkflowProjectRegistry(storage, () => "project-1", 10);
  const created = createWorkflowProject(initial, " 白底资产版 ", () => "project-2", 20);
  assert.equal(created.registry.activeProjectId, "project-2");
  assert.equal(created.project.name, "白底资产版");
  assert.throws(() => createWorkflowProject(created.registry, "白底资产版"), /已存在/);
  const renamed = renameWorkflowProject(created.registry, "project-2", "白雪公主-白底资产版", 30);
  assert.equal(renamed.projects[1].name, "白雪公主-白底资产版");
  const oneLeft = removeWorkflowProject(renamed, "project-1");
  assert.equal(oneLeft.activeProjectId, "project-2");
  const replacement = removeWorkflowProject(oneLeft, "project-2", () => "project-3", 40);
  assert.equal(replacement.activeProjectId, "project-3");
  assert.equal(replacement.projects[0].name, "未命名项目");
});

test("validates project viewports and finds only local uploaded source assets", () => {
  assert.deepEqual(parseWorkflowViewport('{"x":12,"y":-8,"scale":2}'), {
    x: 12,
    y: -8,
    scale: 2,
  });
  assert.deepEqual(parseWorkflowViewport('{"x":0,"y":0,"scale":9}'), {
    x: 0,
    y: 0,
    scale: 1,
  });
  const graph = {
    ...emptyWorkflowGraph(),
    nodes: [
      { id: "source", x: 0, y: 0, type: "source", kind: "image", text: "", assetId: "asset-1" },
      { id: "result", x: 1, y: 1, type: "result", kind: "image", schedulerId: "s", text: "", model: "gpt-image-2", status: "success", progress: "", error: "", resultUrl: "https://example.com/a.png" },
    ],
  };
  assert.deepEqual([...projectSourceAssetIds(graph)], ["asset-1"]);
});

test("migrates only the active project asset layout once", () => {
  const registry = {
    version: 1,
    activeProjectId: "active",
    projects: [
      { id: "active", name: "当前项目", createdAt: 1, updatedAt: 1 },
      { id: "other", name: "其他项目", createdAt: 2, updatedAt: 2 },
    ],
  };
  const graph = {
    ...emptyWorkflowGraph(),
    nodes: [
      { id: "analysis", x: 10, y: 20, type: "source", kind: "text", text: "分析", storyId: "story", storyRole: "analysis" },
      { id: "lead-spec", x: 10, y: 460, type: "source", kind: "text", text: "主角", storyId: "story", assetRef: "lead", assetKind: "character", assetRole: "spec", foundationRole: "lead" },
      { id: "lead-scheduler", x: 418, y: 460, width: 288, height: 360, type: "scheduler", outputKind: "image", model: "gpt-image-2", prompt: "主角", aspectRatio: "16:9", resolution: "1K", duration: "", outputCount: 1, error: "", storyId: "story", assetRef: "lead", assetKind: "character", assetRole: "scheduler", foundationRole: "lead" },
      { id: "lead-result", x: 826, y: 460, type: "result", kind: "image", schedulerId: "lead-scheduler", text: "主角", model: "gpt-image-2", status: "ready", progress: "待生成", error: "", storyId: "story", assetRef: "lead", assetKind: "character", assetRole: "result", foundationRole: "lead" },
      { id: "prop-spec", x: 10, y: 900, type: "source", kind: "text", text: "雨伞", storyId: "story", assetRef: "prop", assetKind: "prop", assetRole: "spec" },
      { id: "prop-scheduler", x: 418, y: 900, width: 288, height: 360, type: "scheduler", outputKind: "image", model: "gpt-image-2", prompt: "雨伞", aspectRatio: "16:9", resolution: "1K", duration: "", outputCount: 1, error: "", storyId: "story", assetRef: "prop", assetKind: "prop", assetRole: "scheduler" },
      { id: "prop-result", x: 826, y: 900, type: "result", kind: "image", schedulerId: "prop-scheduler", text: "雨伞", model: "gpt-image-2", status: "ready", progress: "待生成", error: "", storyId: "story", assetRef: "prop", assetKind: "prop", assetRole: "result" },
    ],
  };
  const storage = memoryStorage({
    [workflowProjectGraphKey("active")]: JSON.stringify(graph),
    [workflowProjectGraphKey("other")]: JSON.stringify(graph),
  });
  assert.equal(migrateActiveWorkflowAssetLayout(storage, registry), true);
  const migrated = JSON.parse(storage.getItem(workflowProjectGraphKey("active")));
  assert.ok(
    migrated.nodes.find((node) => node.id === "lead-result").x <
      migrated.nodes.find((node) => node.id === "prop-spec").x,
  );
  assert.deepEqual(
    JSON.parse(storage.getItem(workflowProjectGraphKey("other"))),
    graph,
  );
  assert.equal(storage.getItem(WORKFLOW_ASSET_LAYOUT_MIGRATION_KEY), "done");
  const once = storage.getItem(workflowProjectGraphKey("active"));
  assert.equal(migrateActiveWorkflowAssetLayout(storage, registry), false);
  assert.equal(storage.getItem(workflowProjectGraphKey("active")), once);
});
