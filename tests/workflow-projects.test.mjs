import assert from "node:assert/strict";
import test from "node:test";
import { WORKFLOW_AGENT_CONVERSATIONS_STORAGE_KEY } from "../app/ai/agent.ts";
import { WORKFLOW_BATCH_STORAGE_KEY } from "../app/workflow/agent.ts";
import { WORKFLOW_STORAGE_KEY, emptyWorkflowGraph } from "../app/workflow/graph.ts";
import {
  WORKFLOW_PROJECTS_STORAGE_KEY,
  WORKFLOW_ASSET_LAYOUT_MIGRATION_KEY,
  createWorkflowProject,
  ensureWorkflowProjectRegistry,
  migrateActiveWorkflowAssetLayout,
  parseWorkflowProjectRegistry,
  parseWorkflowViewport,
  projectSourceAssetIds,
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
