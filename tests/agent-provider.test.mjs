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
    phase: "intake",
    ...overrides,
  };
}

const clientConfig = {
  baseUrl: "https://lingke.example",
  apiKey: "secret",
  instructions: "RUNTIME_AGENT_MD_MARKER",
};

test("validates agent history and requires a final user message", () => {
  assert.equal(validateAgentRequest(request()).messages[0].content, "整理画布");
  assert.equal(validateAgentRequest(request({ phase: "active" })).phase, "intake");
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
    { ...clientConfig, baseUrl: "https://lingke.example/" },
    async (url, init) => {
      upstreamRequest = { url, init, body: JSON.parse(init.body) };
      return Response.json({
        choices: [{ message: { content: '{"message":"你希望按什么规则整理？","workflow_state":"clarifying","inspect_image_node_ids":[],"operations":[]}' } }],
      });
    },
  );
  const response = await client.respond(validateAgentRequest(request()));
  assert.equal(response.workflowState, "clarifying");
  assert.equal(upstreamRequest.url, "https://lingke.example/v1/chat/completions");
  assert.equal(upstreamRequest.body.model, "gpt-5.6-sol");
  assert.equal(upstreamRequest.init.headers.Authorization, "Bearer secret");
  assert.match(JSON.stringify(upstreamRequest.body.messages), /画布快照/);
  assert.match(JSON.stringify(upstreamRequest.body.messages), /RUNTIME_AGENT_MD_MARKER/);
  assert.match(JSON.stringify(upstreamRequest.body.messages), /text:gpt-5\.6-sol/);
});

test("rejects model output that tries to execute on the intake turn", async () => {
  const client = createCanvasAgentClient(clientConfig, async () => Response.json({
    choices: [{ message: { content: '{"message":"已创建","workflow_state":"active","operations":[{"type":"create_node","ref":"new-1","kind":"text","text":"x","x":0,"y":0}]}' } }],
  }));
  await assert.rejects(() => client.respond(validateAgentRequest(request())), /首轮必须/);
});

test("sends inspected images only in the current request", async () => {
  let body;
  const client = createCanvasAgentClient(
    clientConfig,
    async (_url, init) => {
      body = JSON.parse(init.body);
      return Response.json({
        choices: [{ message: { content: '{"message":"看到了","workflow_state":"active","operations":[]}' } }],
      });
    },
  );
  await client.respond(validateAgentRequest(request({
    phase: "active",
    messages: [
      { role: "user", content: "看图" },
      { role: "assistant", content: "你想了解什么？" },
      { role: "user", content: "分析构图" },
    ],
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
    clientConfig,
    async () => Response.json({ error: "sk-sensitive" }, { status: 401 }),
  );
  await assert.rejects(
    () => authClient.respond(validateAgentRequest(request())),
    (error) => error instanceof CanvasAgentError && /鉴权失败/.test(error.message) && !/sensitive/.test(error.message),
  );

  const invalidClient = createCanvasAgentClient(
    clientConfig,
    async () => Response.json({ choices: [{ message: { content: "not-json" } }] }),
  );
  await assert.rejects(() => invalidClient.respond(validateAgentRequest(request())), /无法识别/);
});
