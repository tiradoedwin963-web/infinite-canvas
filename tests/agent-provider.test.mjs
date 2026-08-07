import assert from "node:assert/strict";
import test from "node:test";
import {
  CanvasAgentError,
  createCanvasAgentClient,
  validateAgentRequest,
} from "../app/ai/agent-provider.ts";

const canvas = {
  viewport: { x: 0, y: 0, scale: 1, width: 1000, height: 700 },
  nodes: [],
  edges: [],
};

function request(overrides = {}) {
  return {
    messages: [{ role: "user", content: "整理画布" }],
    canvas,
    ...overrides,
  };
}

test("validates agent history and requires a final user message", () => {
  assert.equal(validateAgentRequest(request()).messages[0].content, "整理画布");
  assert.throws(
    () => validateAgentRequest(request({ messages: [{ role: "assistant", content: "ok" }] })),
    /请输入/,
  );
});

test("validates inspected image count, type, and total size", () => {
  const image = {
    nodeId: "image-1",
    name: "one.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,YQ==",
    size: 1,
  };
  assert.equal(validateAgentRequest(request({ inspectedImages: [image] })).inspectedImages.length, 1);
  assert.throws(
    () => validateAgentRequest(request({ inspectedImages: Array(6).fill(image) })),
    /最多读取 5 张/,
  );
  assert.throws(
    () => validateAgentRequest(request({ inspectedImages: [{ ...image, mimeType: "text/plain" }] })),
    /格式无效/,
  );
  assert.throws(
    () => validateAgentRequest(request({ inspectedImages: [{ ...image, size: 2 }] })),
    /格式无效/,
  );
});

test("calls the fixed agent model and parses its JSON response", async () => {
  let upstreamRequest;
  const client = createCanvasAgentClient(
    { baseUrl: "https://lingke.example/", apiKey: "secret" },
    async (url, init) => {
      upstreamRequest = { url, init, body: JSON.parse(init.body) };
      return Response.json({
        choices: [{ message: { content: '{"message":"完成","inspect_image_node_ids":[],"operations":[]}' } }],
      });
    },
  );
  const response = await client.respond(validateAgentRequest(request()));
  assert.equal(response.message, "完成");
  assert.equal(upstreamRequest.url, "https://lingke.example/v1/chat/completions");
  assert.equal(upstreamRequest.body.model, "gpt-5.6-sol");
  assert.equal(upstreamRequest.init.headers.Authorization, "Bearer secret");
  assert.match(JSON.stringify(upstreamRequest.body.messages), /画布快照/);
});

test("sends inspected images only in the current request", async () => {
  let body;
  const client = createCanvasAgentClient(
    { baseUrl: "https://lingke.example", apiKey: "secret" },
    async (_url, init) => {
      body = JSON.parse(init.body);
      return Response.json({
        choices: [{ message: { content: '{"message":"看到了","operations":[]}' } }],
      });
    },
  );
  await client.respond(validateAgentRequest(request({
    inspectedImages: [{
      nodeId: "image-1",
      name: "one.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,YQ==",
      size: 1,
    }],
  })));
  assert.match(JSON.stringify(body.messages), /data:image\/png;base64,YQ==/);
});

test("sanitizes upstream errors and invalid model output", async () => {
  const authClient = createCanvasAgentClient(
    { baseUrl: "https://lingke.example", apiKey: "secret" },
    async () => Response.json({ error: "sk-sensitive" }, { status: 401 }),
  );
  await assert.rejects(
    () => authClient.respond(validateAgentRequest(request())),
    (error) => error instanceof CanvasAgentError && /鉴权失败/.test(error.message) && !/sensitive/.test(error.message),
  );

  const invalidClient = createCanvasAgentClient(
    { baseUrl: "https://lingke.example", apiKey: "secret" },
    async () => Response.json({ choices: [{ message: { content: "not-json" } }] }),
  );
  await assert.rejects(() => invalidClient.respond(validateAgentRequest(request())), /无法识别/);
});
