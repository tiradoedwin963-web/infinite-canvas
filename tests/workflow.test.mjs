import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkflowTaskStatus,
  buildWorkflowPrompt,
  connectWorkflowNodes,
  createConnectedScheduler,
  createWorkflowNode,
  createWorkflowRun,
  emptyWorkflowGraph,
  moveWorkflowNodes,
  parseWorkflowGraph,
  readWorkflowInputs,
  removeWorkflowNode,
  resizedWorkflowNodeBounds,
  schedulerDefaults,
  workflowEdgePath,
} from "../app/workflow/graph.ts";

function ids() {
  let value = 0;
  return () => `workflow-${++value}`;
}

function source(id, kind, text = "") {
  return { id, x: 0, y: 0, type: "source", kind, text };
}

function scheduler(id = "scheduler") {
  return {
    id,
    x: 400,
    y: 0,
    type: "scheduler",
    ...schedulerDefaults("image"),
    prompt: "节点提示词",
    error: "",
  };
}

test("creates four workflow node types at the requested world coordinate", () => {
  const idFactory = ids();
  let graph = emptyWorkflowGraph();
  for (const type of ["text", "image", "video", "scheduler"]) {
    graph = createWorkflowNode(graph, type, { x: 120, y: 80 }, idFactory).graph;
  }
  assert.deepEqual(graph.nodes.map((node) => node.type), ["source", "source", "source", "scheduler"]);
  assert.deepEqual(graph.nodes.slice(0, 3).map((node) => node.kind), ["text", "image", "video"]);
  assert.equal(graph.nodes[3].outputKind, "image");
  assert.equal(graph.nodes[3].model, "gemini-3-pro-image-preview");
});

test("keeps workflow persistence separate and rejects invalid versions", () => {
  const graph = {
    version: 1,
    nodes: [source("text", "text", "hello"), scheduler()],
    edges: [{ id: "edge", sourceId: "text", targetId: "scheduler" }],
  };
  assert.deepEqual(parseWorkflowGraph(JSON.stringify(graph)), graph);
  assert.deepEqual(parseWorkflowGraph(JSON.stringify({ ...graph, version: 2 })), emptyWorkflowGraph());
});

test("allows only source or result inputs into schedulers and rejects duplicates", () => {
  const graph = {
    version: 1,
    nodes: [source("text", "text"), scheduler(), scheduler("other")],
    edges: [],
  };
  const connected = connectWorkflowNodes(graph, "text", "scheduler", () => "edge");
  assert.equal(connected.edges.length, 1);
  assert.equal(connectWorkflowNodes(connected, "text", "scheduler").edges.length, 1);
  assert.equal(connectWorkflowNodes(connected, "scheduler", "other").edges.length, 1);
  assert.equal(connectWorkflowNodes(connected, "text", "text").edges.length, 1);
});

test("creates a connected scheduler with defaults for the selected output kind", () => {
  for (const outputKind of ["text", "image", "video"]) {
    const anchor = {
      ...source("anchor", "text"),
      width: 200,
      height: 120,
    };
    const created = createConnectedScheduler(
      { version: 1, nodes: [anchor], edges: [] },
      anchor.id,
      outputKind,
      ids(),
    );
    const node = created.graph.nodes.find(
      (candidate) => candidate.id === created.nodeId,
    );
    assert.equal(node.type, "scheduler");
    assert.equal(node.outputKind, outputKind);
    assert.equal(node.model, schedulerDefaults(outputKind).model);
    assert.equal(node.outputCount, 1);
    assert.deepEqual({ x: node.x, y: node.y }, { x: 320, y: -120 });
    assert.deepEqual(created.graph.edges.map(({ sourceId, targetId }) => ({ sourceId, targetId })), [
      { sourceId: anchor.id, targetId: created.nodeId },
    ]);
  }
});

test("moves a connected scheduler vertically when its preferred slot is occupied", () => {
  const anchor = source("anchor", "text");
  const blocker = {
    ...scheduler("blocker"),
    x: 408,
    y: -80,
    width: 288,
    height: 360,
  };
  const created = createConnectedScheduler(
    { version: 1, nodes: [anchor, blocker], edges: [] },
    anchor.id,
    "image",
    ids(),
  );
  const node = created.graph.nodes.find(
    (candidate) => candidate.id === created.nodeId,
  );
  assert.equal(node.x, 408);
  assert.equal(node.y, 304);
  assert.equal(
    createConnectedScheduler(created.graph, "missing", "text").nodeId,
    null,
  );
  assert.equal(
    createConnectedScheduler(created.graph, blocker.id, "text").nodeId,
    null,
  );
});

test("reads direct upstream text, image and video in edge order without recursion", () => {
  const image = { ...source("image", "image"), assetId: "asset" };
  const video = { ...source("video", "video"), assetId: "movie" };
  const graph = {
    version: 1,
    nodes: [source("two", "text", "第二段"), image, source("one", "text", "第一段"), video, scheduler()],
    edges: [
      { id: "1", sourceId: "one", targetId: "scheduler" },
      { id: "2", sourceId: "image", targetId: "scheduler" },
      { id: "3", sourceId: "two", targetId: "scheduler" },
      { id: "4", sourceId: "video", targetId: "scheduler" },
    ],
  };
  const inputs = readWorkflowInputs(graph, "scheduler");
  assert.deepEqual(inputs.text, ["第一段", "第二段"]);
  assert.deepEqual(inputs.images.map((node) => node.id), ["image"]);
  assert.deepEqual(inputs.videos.map((node) => node.id), ["video"]);
  assert.equal(buildWorkflowPrompt(inputs, "节点提示词"), "第一段\n\n第二段\n\n节点提示词");
});

test("creates one text result or one to four independent media results and appends reruns", () => {
  const idFactory = ids();
  const mediaScheduler = { ...scheduler(), outputCount: 3 };
  let graph = { version: 1, nodes: [mediaScheduler], edges: [] };
  const first = createWorkflowRun(graph, mediaScheduler.id, 10, idFactory);
  assert.equal(first.resultIds.length, 3);
  assert.equal(first.graph.edges.length, 3);
  const second = createWorkflowRun(first.graph, mediaScheduler.id, 20, idFactory);
  assert.equal(second.graph.nodes.filter((node) => node.type === "result").length, 6);
  const textScheduler = { ...scheduler("text-job"), ...schedulerDefaults("text") };
  graph = { version: 1, nodes: [textScheduler], edges: [] };
  assert.equal(createWorkflowRun(graph, textScheduler.id, 10, idFactory).resultIds.length, 1);
});

test("keeps completed results when their scheduler is deleted", () => {
  const created = createWorkflowRun(
    { version: 1, nodes: [scheduler()], edges: [] },
    "scheduler",
    10,
    ids(),
  );
  const resultId = created.resultIds[0];
  const removed = removeWorkflowNode(created.graph, "scheduler");
  assert.ok(removed.nodes.some((node) => node.id === resultId));
  assert.equal(removed.edges.length, 0);
});

test("splits an unexpected multi-result provider response into result nodes", () => {
  const idFactory = ids();
  const created = createWorkflowRun(
    { version: 1, nodes: [scheduler()], edges: [] },
    "scheduler",
    10,
    idFactory,
  );
  const next = applyWorkflowTaskStatus(created.graph, created.resultIds[0], {
    taskId: "task",
    state: "success",
    isFinal: true,
    progress: "",
    error: "",
    results: [
      { kind: "image", url: "https://example.com/one.png" },
      { kind: "image", url: "https://example.com/two.png" },
    ],
  }, idFactory);
  const results = next.nodes.filter((node) => node.type === "result");
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((node) => node.resultUrl), [
    "https://example.com/one.png",
    "https://example.com/two.png",
  ]);
});

test("uses actual dimensions for fixed right-out and left-in edges and group movement", () => {
  const sourceNode = { ...source("source", "text"), width: 200, height: 120 };
  const target = { ...scheduler(), x: 600, y: 200, width: 300, height: 400 };
  assert.match(workflowEdgePath(sourceNode, target), /^M 200 60 C/);
  assert.match(workflowEdgePath(sourceNode, target), /, 600 400$/);
  const graph = moveWorkflowNodes(
    { version: 1, nodes: [sourceNode, target], edges: [] },
    ["source", "scheduler"],
    30,
    -10,
  );
  assert.deepEqual(graph.nodes.map(({ x, y }) => ({ x, y })), [
    { x: 30, y: -10 },
    { x: 630, y: 190 },
  ]);
});

test("keeps workflow image and video nodes proportional while text remains freeform", () => {
  const image = { ...source("image", "image"), width: 300, height: 200 };
  const resizedImage = resizedWorkflowNodeBounds(image, "south-east", { x: 600, y: 250 });
  assert.equal(resizedImage.width / resizedImage.height, 1.5);
  const resizedText = resizedWorkflowNodeBounds(
    { ...source("text", "text"), width: 300, height: 200 },
    "south-east",
    { x: 600, y: 250 },
  );
  assert.deepEqual(
    { width: resizedText.width, height: resizedText.height },
    { width: 600, height: 250 },
  );
});
