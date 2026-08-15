import assert from "node:assert/strict";
import test from "node:test";
import { WORKFLOW_AGENT_CONVERSATIONS_STORAGE_KEY } from "../app/ai/agent.ts";
import { WORKFLOW_BATCH_STORAGE_KEY } from "../app/workflow/agent.ts";
import { WORKFLOW_STORAGE_KEY, emptyWorkflowGraph } from "../app/workflow/graph.ts";
import {
  WORKFLOW_PROJECTS_STORAGE_KEY,
  createWorkflowProject,
  ensureWorkflowProjectRegistry,
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
