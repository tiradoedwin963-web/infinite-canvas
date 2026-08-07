import assert from "node:assert/strict";
import test from "node:test";
import {
  isDangerousAgentOperation,
  parseAgentMessages,
  parseAgentModelResponse,
  serializeAgentMessages,
} from "../app/ai/agent.ts";
import {
  applyAgentOperations,
  createAgentCanvasSnapshot,
} from "../app/canvas/agent.ts";

function textNode(id, overrides = {}) {
  return {
    id,
    kind: "text",
    role: "input",
    x: 10,
    y: 20,
    text: "hello",
    model: "gpt-5.6-sol",
    status: "ready",
    progress: "",
    error: "",
    ...overrides,
  };
}

test("parses the strict agent response and all operation names", () => {
  const response = parseAgentModelResponse(JSON.stringify({
    message: "已经整理好了。",
    inspect_image_node_ids: [],
    operations: [
      { type: "create_node", ref: "new-1", kind: "text", text: "标题", x: 1, y: 2 },
      { type: "update_node", node_id: "$new-1", text: "新标题" },
      { type: "move_node", node_id: "$new-1", x: 30, y: 40 },
      { type: "resize_node", node_id: "$new-1", width: 320, height: 180 },
      { type: "connect_nodes", source_id: "old", target_id: "$new-1" },
      { type: "disconnect_nodes", source_id: "old", target_id: "$new-1" },
      { type: "delete_node", node_id: "old" },
      {
        type: "generate_content",
        mode: "image",
        model: "gpt-image-2",
        prompt: "海报",
        reference_node_ids: ["old"],
        aspect_ratio: "1:1",
        resolution: "1K",
      },
    ],
  }));
  assert.equal(response.message, "已经整理好了。");
  assert.deepEqual(response.operations.map((operation) => operation.type), [
    "create_node",
    "update_node",
    "move_node",
    "resize_node",
    "connect_nodes",
    "disconnect_nodes",
    "delete_node",
    "generate_content",
  ]);
  assert.equal(response.operations.filter(isDangerousAgentOperation).length, 2);
});

test("rejects unknown or malformed model operations without partial application", () => {
  assert.throws(
    () => parseAgentModelResponse('{"message":"ok","operations":[{"type":"eval"}]}'),
    /不受支持/,
  );
  assert.throws(() => parseAgentModelResponse("not-json"), /无法识别/);
});

test("persists text history but expires pending confirmations and strips payloads", () => {
  const serialized = serializeAgentMessages([
    {
      id: "m1",
      role: "assistant",
      content: "",
      createdAt: 1,
      action: {
        label: "删除节点 a",
        status: "pending",
        operation: { type: "delete_node", nodeId: "a" },
      },
    },
  ]);
  assert.doesNotMatch(serialized, /delete_node|nodeId/);
  assert.equal(parseAgentMessages(serialized)[0].action.status, "expired");
});

test("serializes only the canvas fields the agent needs", () => {
  const snapshot = createAgentCanvasSnapshot(
    {
      version: 1,
      nodes: [
        textNode("a", {
          assetId: "private-indexed-db-key",
          resultUrl: "https://private.example/result.png",
        }),
      ],
      edges: [],
    },
    { x: 1, y: 2, scale: 1.5 },
    { width: 1000, height: 700 },
  );
  const raw = JSON.stringify(snapshot);
  assert.doesNotMatch(raw, /private-indexed-db-key|private\.example/);
  assert.equal(snapshot.nodes[0].hasVisual, true);
  assert.deepEqual(snapshot.viewport, { x: 1, y: 2, scale: 1.5, width: 1000, height: 700 });
});

test("applies safe operations in order and resolves new-node aliases", () => {
  const graph = { version: 1, nodes: [textNode("a")], edges: [] };
  const operations = [
    { type: "create_node", ref: "new-1", kind: "text", text: "draft", x: 100, y: 120 },
    { type: "update_node", nodeId: "$new-1", text: "final" },
    { type: "move_node", nodeId: "$new-1", x: 200, y: 220 },
    { type: "resize_node", nodeId: "$new-1", width: 360, height: 210 },
    { type: "connect_nodes", sourceId: "a", targetId: "$new-1" },
  ];
  let index = 0;
  const result = applyAgentOperations(graph, operations, () => `id-${++index}`);
  const created = result.graph.nodes.find((node) => node.id === "id-1");
  assert.equal(created.text, "final");
  assert.deepEqual(
    { x: created.x, y: created.y, width: created.width, height: created.height },
    { x: 200, y: 220, width: 360, height: 210 },
  );
  assert.deepEqual(result.graph.edges, [{ id: "id-2", sourceId: "a", targetId: "id-1" }]);
  assert.ok(result.results.every((item) => item.applied));

  const disconnected = applyAgentOperations(result.graph, [
    { type: "disconnect_nodes", sourceId: "a", targetId: "id-1" },
  ]);
  assert.equal(disconnected.graph.edges.length, 0);
});

test("does not apply dangerous or stale operations in the pure reducer", () => {
  const graph = { version: 1, nodes: [textNode("a")], edges: [] };
  const result = applyAgentOperations(graph, [
    { type: "delete_node", nodeId: "a" },
    { type: "move_node", nodeId: "missing", x: 1, y: 2 },
    {
      type: "generate_content",
      mode: "text",
      model: "gpt-5.6-sol",
      prompt: "write",
      referenceNodeIds: [],
    },
  ]);
  assert.deepEqual(result.graph, graph);
  assert.ok(result.results.every((item) => !item.applied));
});

test("keeps media aspect ratio and clamps its longest edge", () => {
  const graph = {
    version: 1,
    nodes: [textNode("image", { kind: "image", width: 400, height: 200 })],
    edges: [],
  };
  const result = applyAgentOperations(graph, [
    { type: "resize_node", nodeId: "image", width: 4000, height: 2000 },
  ]);
  const resized = result.graph.nodes[0];
  assert.equal(resized.width, 1200);
  assert.equal(resized.height, 600);
});
