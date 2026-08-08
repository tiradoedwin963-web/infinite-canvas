import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManualNodeContext,
  connectNodes,
  createConnectedNode,
  createGenerationNodes,
  directUpstreamNodes,
  draftEdgePath,
  edgeMidpoint,
  edgePath,
  emptyGraph,
  fitMediaNode,
  getNodeSize,
  moveNodes,
  nodesIntersectingBounds,
  parsePersistedGraph,
  removeEdge,
  removeNode,
  replaceOutputWithResults,
  resizeNode,
  resizedNodeBounds,
  selectedNodesBounds,
  updateOutputNode,
} from "../app/canvas/graph.ts";

function idFactory() {
  let id = 0;
  return () => `id-${++id}`;
}

function readyNode(id, x = 0, y = 0) {
  return {
    id,
    kind: "text",
    role: "input",
    x,
    y,
    text: id,
    model: "gpt-5.6-sol",
    status: "ready",
    progress: "",
    error: "",
  };
}

test("splits prompt and reference images into input nodes", () => {
  const created = createGenerationNodes(
    emptyGraph(),
    {
      mode: "image",
      model: "gpt-image-2",
      prompt: "A cat",
      assets: [
        { id: "asset-1", name: "one.png", mimeType: "image/png" },
        { id: "asset-2", name: "two.png", mimeType: "image/png" },
      ],
      now: 10,
    },
    { x: 500, y: 400 },
    idFactory(),
  );

  assert.equal(created.graph.nodes.length, 4);
  assert.equal(created.graph.nodes.filter((node) => node.role === "input").length, 3);
  assert.equal(created.graph.edges.length, 3);
  assert.deepEqual(
    created.graph.nodes.filter((node) => node.assetId).map((node) => node.assetId),
    ["asset-1", "asset-2"],
  );
});

test("deleting an input removes only its connected edge", () => {
  const created = createGenerationNodes(
    emptyGraph(),
    {
      mode: "text",
      model: "gpt-5.6-sol",
      prompt: "Hello",
      assets: [],
      now: 10,
    },
    { x: 0, y: 0 },
    idFactory(),
  );
  const next = removeNode(created.graph, created.inputIds[0]);
  assert.equal(next.nodes.length, 1);
  assert.equal(next.nodes[0].id, created.outputId);
  assert.equal(next.edges.length, 0);
});

test("edits one text node without changing its other fields and persists it", () => {
  const first = readyNode("first");
  const second = readyNode("second", 320, 0);
  const graph = {
    version: 1,
    nodes: [first, second],
    edges: [{ id: "edge", sourceId: "first", targetId: "second" }],
  };
  const updated = updateOutputNode(graph, "first", { text: "编辑后的内容" });

  assert.deepEqual(updated.nodes[0], { ...first, text: "编辑后的内容" });
  assert.deepEqual(updated.nodes[1], second);
  assert.deepEqual(updated.edges, graph.edges);
  assert.equal(
    parsePersistedGraph(JSON.stringify(updated)).nodes[0].text,
    "编辑后的内容",
  );
});

test("places a later generation outside the occupied node group", () => {
  const ids = idFactory();
  const first = createGenerationNodes(
    emptyGraph(),
    {
      mode: "text",
      model: "gpt-5.6-sol",
      prompt: "First",
      assets: [],
      now: 10,
    },
    { x: 300, y: 300 },
    ids,
  );
  const second = createGenerationNodes(
    first.graph,
    {
      mode: "text",
      model: "gpt-5.6-sol",
      prompt: "Second",
      assets: [],
      now: 20,
    },
    { x: 300, y: 300 },
    ids,
  );
  const firstOutput = first.graph.nodes.find((node) => node.id === first.outputId);
  const secondOutput = second.graph.nodes.find((node) => node.id === second.outputId);
  assert.notEqual(firstOutput.y, secondOutput.y);
});

test("creates one output node per returned result", () => {
  const created = createGenerationNodes(
    emptyGraph(),
    {
      mode: "image",
      model: "gpt-image-2",
      prompt: "Hello",
      assets: [{ id: "asset", name: "a.png", mimeType: "image/png" }],
      now: 10,
    },
    { x: 0, y: 0 },
    idFactory(),
  );
  const completed = replaceOutputWithResults(
    created.graph,
    created.outputId,
    [
      { url: "https://cdn.test/1.png", kind: "image" },
      { url: "https://cdn.test/2.png", kind: "image" },
    ],
    idFactory(),
  );
  assert.equal(completed.nodes.filter((node) => node.role === "output").length, 2);
  assert.equal(completed.edges.length, 4);
  assert.ok(completed.nodes.every((node) => node.role === "input" || node.status === "success"));
});

test("rejects invalid persisted data and removes orphan edges", () => {
  assert.deepEqual(parsePersistedGraph('{"version":2}'), emptyGraph());
  const valid = {
    version: 1,
    nodes: [
      {
        id: "a",
        kind: "text",
        role: "input",
        x: 0,
        y: 0,
        text: "x",
        model: "gpt-5.6-sol",
        status: "ready",
        progress: "",
        error: "",
      },
    ],
    edges: [{ id: "e", sourceId: "a", targetId: "missing" }],
  };
  assert.equal(parsePersistedGraph(JSON.stringify(valid)).edges.length, 0);
});

test("restores legacy edge sides without changing the graph storage version", () => {
  const graph = {
    version: 1,
    nodes: [readyNode("a"), readyNode("b")],
    edges: [{ id: "edge", sourceId: "a", targetId: "b" }],
  };
  const restored = parsePersistedGraph(JSON.stringify(graph));
  assert.deepEqual(restored.edges, [
    {
      id: "edge",
      sourceId: "a",
      targetId: "b",
      sourceSide: "right",
      targetSide: "left",
    },
  ]);
  assert.deepEqual(
    parsePersistedGraph(
      JSON.stringify({
        ...graph,
        edges: [{ ...graph.edges[0], sourceSide: "top" }],
      }),
    ),
    emptyGraph(),
  );
});

test("restores optional node dimensions while keeping old graphs compatible", () => {
  const oldNode = readyNode("old");
  const sizedNode = { ...readyNode("sized"), width: 420, height: 260 };
  const restored = parsePersistedGraph(
    JSON.stringify({ version: 1, nodes: [oldNode, sizedNode], edges: [] }),
  );
  assert.deepEqual(getNodeSize(restored.nodes[0]), { width: 272, height: 184 });
  assert.deepEqual(getNodeSize(restored.nodes[1]), { width: 420, height: 260 });

  assert.deepEqual(
    parsePersistedGraph(
      JSON.stringify({
        version: 1,
        nodes: [{ ...oldNode, width: 420 }],
        edges: [],
      }),
    ),
    emptyGraph(),
  );
});

test("resizes text nodes from corners while keeping the opposite corner fixed", () => {
  const node = { ...readyNode("text", 100, 100), width: 300, height: 200 };
  assert.deepEqual(
    resizedNodeBounds(node, "north-west", { x: 0, y: 20 }),
    { x: 0, y: 20, width: 400, height: 280 },
  );
  assert.deepEqual(
    resizedNodeBounds(node, "south-east", { x: 110, y: 110 }),
    { x: 100, y: 100, width: 180, height: 120 },
  );

  const graph = resizeNode(
    { version: 1, nodes: [node], edges: [] },
    node.id,
    { x: 0, y: 20, width: 400, height: 280 },
  );
  assert.equal(
    parsePersistedGraph(JSON.stringify(graph)).nodes[0].width,
    400,
  );
});

test("keeps media aspect ratios while enforcing resize limits", () => {
  const image = {
    ...readyNode("image", 0, 0),
    kind: "image",
    width: 200,
    height: 100,
  };
  assert.deepEqual(
    resizedNodeBounds(image, "south-east", { x: 500, y: 200 }),
    { x: 0, y: 0, width: 500, height: 250 },
  );
  assert.deepEqual(
    resizedNodeBounds(image, "south-east", { x: 1, y: 1 }),
    { x: 0, y: 0, width: 192, height: 96 },
  );
  assert.deepEqual(
    resizedNodeBounds(image, "south-east", { x: 5000, y: 5000 }),
    { x: 0, y: 0, width: 1200, height: 600 },
  );
});

test("fits loaded media to the existing visual box and centers it", () => {
  const image = { ...readyNode("image", 100, 100), kind: "image" };
  const graph = { version: 1, nodes: [image], edges: [] };
  const fitted = fitMediaNode(graph, image.id, 400, 400);
  assert.deepEqual(fitted.nodes[0], {
    ...image,
    x: 144,
    y: 100,
    width: 184,
    height: 184,
  });
  assert.equal(fitMediaNode(fitted, image.id, 400, 400), fitted);
});

test("selects nodes whose actual bounds intersect a marquee", () => {
  const first = { ...readyNode("first", 10, 20), width: 300, height: 160 };
  const second = { ...readyNode("second", 500, 400), width: 120, height: 100 };
  const graph = { version: 1, nodes: [first, second], edges: [] };

  assert.deepEqual(
    nodesIntersectingBounds(graph, { x: 300, y: 100, width: 40, height: 40 }),
    ["first"],
  );
  assert.deepEqual(
    nodesIntersectingBounds(graph, { x: 350, y: 200, width: 100, height: 100 }),
    [],
  );
});

test("computes selected bounds and moves only the selected nodes together", () => {
  const first = { ...readyNode("first", 10, 20), width: 300, height: 160 };
  const second = { ...readyNode("second", 500, 400), width: 120, height: 100 };
  const third = readyNode("third", 900, 900);
  const graph = {
    version: 1,
    nodes: [first, second, third],
    edges: [{ id: "edge", sourceId: "first", targetId: "second" }],
  };

  assert.deepEqual(selectedNodesBounds(graph, ["first", "second"]), {
    x: 10,
    y: 20,
    width: 610,
    height: 480,
  });
  assert.equal(selectedNodesBounds(graph, ["missing"]), null);

  const moved = moveNodes(graph, ["first", "second"], 25, -15);
  assert.deepEqual(
    moved.nodes.map(({ id, x, y }) => ({ id, x, y })),
    [
      { id: "first", x: 35, y: 5 },
      { id: "second", x: 525, y: 385 },
      { id: "third", x: 900, y: 900 },
    ],
  );
  assert.deepEqual(moved.edges, graph.edges);
});

test("computes settled paths and midpoints for all four port combinations", () => {
  const base = {
    id: "a",
    kind: "text",
    role: "input",
    x: 0,
    y: 0,
    text: "",
    model: "",
    status: "ready",
    progress: "",
    error: "",
  };
  const target = { ...base, id: "b", x: 500 };
  const rightLeft = edgePath(base, target, "right", "left");
  const rightRight = edgePath(base, target, "right", "right");
  const leftLeft = edgePath(base, target, "left", "left");
  const leftRight = edgePath(base, target, "left", "right");
  assert.match(rightLeft, /^M 272 92 C/);
  assert.match(rightLeft, /, 500 92$/);
  assert.match(rightRight, /^M 272 92 C/);
  assert.match(rightRight, /, 772 92$/);
  assert.match(leftLeft, /^M 0 92 C/);
  assert.match(leftLeft, /, 500 92$/);
  assert.match(leftRight, /^M 0 92 C/);
  assert.match(leftRight, /, 772 92$/);
  assert.notDeepEqual(
    edgeMidpoint(base, target, "right", "left"),
    edgeMidpoint(base, target, "right", "right"),
  );
});

test("uses actual node dimensions for settled and draft edge endpoints", () => {
  const source = {
    ...readyNode("source", 0, 0),
    width: 400,
    height: 200,
  };
  const target = {
    ...readyNode("target", 600, 50),
    width: 200,
    height: 100,
  };
  assert.match(edgePath(source, target), /^M 400 100 C/);
  assert.match(edgePath(source, target), /, 600 100$/);
  assert.match(draftEdgePath(source, "right", { x: 700, y: 100 }), /^M 400 100 C/);
  assert.match(draftEdgePath(source, "left", { x: -100, y: 100 }), /^M 0 100 C/);
});

test("creates typed manual nodes on the requested connection side", () => {
  const base = { version: 1, nodes: [readyNode("anchor")], edges: [] };
  const right = createConnectedNode(
    base,
    "anchor",
    "right",
    "image",
    idFactory(),
  );
  const rightNode = right.graph.nodes.find((node) => node.id === right.nodeId);
  assert.equal(rightNode.kind, "image");
  assert.equal(rightNode.manual, true);
  assert.equal(rightNode.model, "gemini-3-pro-image-preview");
  assert.equal(rightNode.x, 368);
  assert.deepEqual(
    right.graph.edges.map(({ sourceId, targetId }) => ({ sourceId, targetId })),
    [{ sourceId: "anchor", targetId: right.nodeId }],
  );

  const left = createConnectedNode(
    base,
    "anchor",
    "left",
    "video",
    idFactory(),
  );
  const leftNode = left.graph.nodes.find((node) => node.id === left.nodeId);
  assert.equal(leftNode.x, -368);
  assert.deepEqual(
    left.graph.edges.map(({ sourceId, targetId }) => ({ sourceId, targetId })),
    [{ sourceId: left.nodeId, targetId: "anchor" }],
  );
});

test("places adjacent nodes after a resized anchor boundary", () => {
  const anchor = { ...readyNode("anchor"), width: 400, height: 240 };
  const created = createConnectedNode(
    { version: 1, nodes: [anchor], edges: [] },
    anchor.id,
    "right",
    "text",
    idFactory(),
  );
  const node = created.graph.nodes.find((candidate) => candidate.id === created.nodeId);
  assert.equal(node.x, 496);
});

test("moves adjacent manual nodes vertically when the desired slot is occupied", () => {
  const base = { version: 1, nodes: [readyNode("anchor")], edges: [] };
  const ids = idFactory();
  const first = createConnectedNode(base, "anchor", "right", "text", ids);
  const second = createConnectedNode(
    first.graph,
    "anchor",
    "right",
    "text",
    ids,
  );
  const firstNode = first.graph.nodes.find((node) => node.id === first.nodeId);
  const secondNode = second.graph.nodes.find((node) => node.id === second.nodeId);
  assert.notEqual(firstNode.y, secondNode.y);
});

test("rejects self and duplicate edges while allowing cycles and multiple inputs", () => {
  const base = {
    version: 1,
    nodes: [readyNode("a"), readyNode("b"), readyNode("c")],
    edges: [],
  };
  const ids = idFactory();
  const ab = connectNodes(base, "a", "b", ids);
  assert.equal(connectNodes(ab, "a", "a", ids), ab);
  assert.equal(connectNodes(ab, "a", "b", ids), ab);
  const cycle = connectNodes(ab, "b", "a", ids);
  const multiple = connectNodes(cycle, "c", "b", ids);
  assert.equal(multiple.edges.length, 3);
});

test("stores selected port sides and removes only the requested edge", () => {
  const base = {
    version: 1,
    nodes: [readyNode("a"), readyNode("b"), readyNode("c")],
    edges: [],
  };
  const ids = idFactory();
  const first = connectNodes(base, "a", "b", ids, "left", "right");
  const second = connectNodes(first, "b", "c", ids);
  assert.deepEqual(first.edges[0], {
    id: "id-1",
    sourceId: "a",
    targetId: "b",
    sourceSide: "left",
    targetSide: "right",
  });
  const removed = removeEdge(second, first.edges[0].id);
  assert.deepEqual(removed.edges, [second.edges[1]]);
  assert.equal(removeEdge(removed, "missing"), removed);
});

test("reads direct upstream nodes in edge creation order without recursion", () => {
  const graph = {
    version: 1,
    nodes: [readyNode("a"), readyNode("b"), readyNode("c")],
    edges: [
      { id: "bc", sourceId: "b", targetId: "c" },
      { id: "ab", sourceId: "a", targetId: "b" },
    ],
  };
  assert.deepEqual(
    directUpstreamNodes(graph, "c").map((node) => node.id),
    ["b"],
  );
  assert.match(draftEdgePath(graph.nodes[0], "right", { x: 500, y: 200 }), /^M 272 92 C/);
});

test("builds manual generation context from direct text, video and image inputs", () => {
  const text = { ...readyNode("text"), text: "first instruction" };
  const image = {
    ...readyNode("image"),
    kind: "image",
    text: "reference.png",
    assetId: "asset-1",
  };
  const video = {
    ...readyNode("video"),
    kind: "video",
    text: "rendered video",
    prompt: "camera moves slowly",
  };
  const indirect = { ...readyNode("indirect"), text: "must not be included" };
  const target = readyNode("target");
  const graph = {
    version: 1,
    nodes: [text, image, video, indirect, target],
    edges: [
      { id: "indirect-text", sourceId: "indirect", targetId: "text" },
      { id: "text-target", sourceId: "text", targetId: "target" },
      { id: "image-target", sourceId: "image", targetId: "target" },
      { id: "video-target", sourceId: "video", targetId: "target" },
    ],
  };

  const context = buildManualNodeContext(graph, "target", "current prompt");
  assert.equal(
    context.prompt,
    "first instruction\n\ncamera moves slowly\n\ncurrent prompt",
  );
  assert.deepEqual(context.imageNodes.map((node) => node.id), ["image"]);
  assert.doesNotMatch(context.prompt, /must not be included|rendered video/);
});

test("restores optional manual node metadata without changing graph version", () => {
  const graph = {
    version: 1,
    nodes: [{ ...readyNode("manual"), manual: true, prompt: "draw a cat" }],
    edges: [],
  };
  assert.deepEqual(parsePersistedGraph(JSON.stringify(graph)), graph);
});
