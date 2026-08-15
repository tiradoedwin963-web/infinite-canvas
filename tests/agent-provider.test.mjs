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
  toolManual: "RUNTIME_IMAGE_TOOL_MANUAL_MARKER",
  workflowToolManual: "RUNTIME_WORKFLOW_TOOL_MANUAL_MARKER",
  storyAssetToolManual: "RUNTIME_STORY_ASSET_TOOL_MANUAL_MARKER",
};

function upstreamSseResponse(content) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const character of content) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: character } }] })}\n\n`,
        ));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

test("validates agent history and requires a final user message", () => {
  assert.equal(validateAgentRequest(request()).messages[0].content, "整理画布");
  assert.equal(validateAgentRequest(request({ phase: "active" })).phase, "intake");
  assert.throws(
    () => validateAgentRequest(request({ messages: [{ role: "assistant", content: "ok" }] })),
    /请输入/,
  );
});

test("preserves a complete long script while keeping only the last 20 messages", () => {
  const completeScript = `${"剧".repeat(25_326)}剧本已完`;
  assert.equal(completeScript.length, 25_330);
  const messages = Array.from({ length: 21 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: index === 20 ? `  ${completeScript}  ` : `消息 ${index}`,
  }));
  const validated = validateAgentRequest(request({ messages, phase: "active" }));
  assert.equal(validated.messages.length, 20);
  assert.equal(validated.messages[0].content, "消息 1");
  assert.equal(validated.messages.at(-1).content, completeScript);
  assert.match(validated.messages.at(-1).content, /剧本已完$/);
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
  const summaries = [];
  const client = createCanvasAgentClient(
    { ...clientConfig, baseUrl: "https://lingke.example/" },
    async (url, init) => {
      upstreamRequest = { url, init, body: JSON.parse(init.body) };
      return Response.json({
        choices: [{ message: { content: '{"message":"你希望按什么规则整理？","workflow_state":"clarifying","inspect_image_node_ids":[],"operations":[]}' } }],
      });
    },
  );
  const response = await client.respond(validateAgentRequest(request()), {
    onProgress: (text) => summaries.push(text),
  });
  assert.equal(response.workflowState, "clarifying");
  assert.equal(response.progressSummary, "已完成当前阶段处理，正在校验可应用结果。");
  assert.deepEqual(summaries, [response.progressSummary]);
  assert.equal(upstreamRequest.url, "https://lingke.example/v1/chat/completions");
  assert.equal(upstreamRequest.body.model, "gpt-5.6-sol");
  assert.equal(upstreamRequest.body.stream, true);
  assert.equal(upstreamRequest.init.headers.Authorization, "Bearer secret");
  assert.match(JSON.stringify(upstreamRequest.body.messages), /画布快照/);
  assert.match(JSON.stringify(upstreamRequest.body.messages), /RUNTIME_AGENT_MD_MARKER/);
  const systemMessage = upstreamRequest.body.messages[0].content;
  assert.match(systemMessage, /RUNTIME_IMAGE_TOOL_MANUAL_MARKER/);
  assert.match(systemMessage, /RUNTIME_WORKFLOW_TOOL_MANUAL_MARKER/);
  assert.match(systemMessage, /RUNTIME_STORY_ASSET_TOOL_MANUAL_MARKER/);
  assert.match(systemMessage, /"mode":"text","model":"gpt-5\.6-sol"/);
  assert.match(systemMessage, /"model":"gemini-3-pro-image-preview"/);
  assert.match(systemMessage, /"aspectRatios":\["1:1","4:3","3:4","16:9","9:16"\]/);
  assert.match(systemMessage, /model 字段只能填写 model 值/);
  assert.doesNotMatch(systemMessage, /text:gpt-5\.6-sol/);
});

test("streams only the controlled progress summary and returns the validated result", async () => {
  const summaries = [];
  let activityCount = 0;
  const raw = JSON.stringify({
    progress_summary: "已读取22场；识别10名独立人物。",
    message: "已完成分析。",
    workflow_state: "active",
    operations: [],
  });
  const client = createCanvasAgentClient(
    clientConfig,
    async (_url, init) => {
      assert.equal(init.signal.aborted, false);
      return upstreamSseResponse(raw);
    },
  );
  const controller = new AbortController();
  const response = await client.respond(
    validateAgentRequest(request({
      phase: "active",
      messages: [
        { role: "user", content: "剧本" },
        { role: "assistant", content: "请补充" },
        { role: "user", content: "剧本已完" },
      ],
    })),
    {
      signal: controller.signal,
      onProgress: (text) => summaries.push(text),
      onActivity: () => { activityCount += 1; },
    },
  );
  assert.equal(response.progressSummary, "已读取22场；识别10名独立人物。");
  assert.equal(response.message, "已完成分析。");
  assert.equal(summaries.at(-1), response.progressSummary);
  assert.ok(summaries.length > 2);
  assert.ok(activityCount > raw.length);
  assert.ok(summaries.every((summary) => !/operations|node_id/.test(summary)));
});

test("reports activity for a non-streaming fallback response", async () => {
  let activityCount = 0;
  const client = createCanvasAgentClient(clientConfig, async () => Response.json({
    choices: [{ message: { content: JSON.stringify({
      message: "请补充需求。",
      workflow_state: "clarifying",
      operations: [],
    }) } }],
  }));
  await client.respond(validateAgentRequest(request()), {
    onActivity: () => { activityCount += 1; },
  });
  assert.equal(activityCount, 1);
});

test("normalizes an image draft without making a second agent request", async () => {
  let calls = 0;
  const client = createCanvasAgentClient(clientConfig, async () => {
    calls += 1;
    return Response.json({
      choices: [{
        message: {
          content: JSON.stringify({
            message: "请确认生图",
            workflow_state: "active",
            operations: [{
              type: "generate_content",
              mode: "image",
              model: "image:gemini-3-pro-image-preview",
              prompt: "portrait",
              reference_node_ids: [],
              aspect_ratio: "2:3",
              resolution: "3K",
            }],
          }),
        },
      }],
    });
  });
  const response = await client.respond(validateAgentRequest(request({
    phase: "active",
    messages: [
      { role: "user", content: "生成人像" },
      { role: "assistant", content: "需要什么比例？" },
      { role: "user", content: "2:3，3K" },
    ],
  })));
  assert.equal(calls, 1);
  assert.equal(response.operations[0].model, "gemini-3-pro-image-preview");
  assert.equal(response.operations[0].aspectRatio, "3:4");
  assert.equal(response.operations[0].resolution, "2K");
  assert.equal(response.operations[0].adjustments.length, 2);
});

test("rejects model output that tries to execute on the intake turn", async () => {
  const client = createCanvasAgentClient(clientConfig, async () => Response.json({
    choices: [{ message: { content: '{"message":"已创建","workflow_state":"active","operations":[{"type":"create_node","ref":"new-1","kind":"text","text":"x","x":0,"y":0}]}' } }],
  }));
  await assert.rejects(() => client.respond(validateAgentRequest(request())), /首轮必须/);
});

test("requires a complete script to create analysis before storyboards", async () => {
  const client = createCanvasAgentClient(clientConfig, async () => Response.json({
    choices: [{ message: { content: JSON.stringify({
      message: "已完成剧本分析。",
      workflow_state: "active",
      operations: [{
        type: "create_story_analysis",
        ref: "story-1",
        title: "夜班电梯",
        analysis: {
          genre: "悬疑",
          theme: "信任",
          audience: "短剧用户",
          emotion: "紧张到释然",
          estimated_duration: "90 秒",
          visual_style: "写实水粉、柔和边缘与低饱和夜景",
        },
        project_aspect_ratio: "9:16",
        image_model: "gemini-3-pro-image-preview",
      }],
    }) } }],
  }));
  const response = await client.respond(validateAgentRequest(request({
    canvas: { ...canvas, mode: "workflow" },
  })));
  assert.equal(response.operations[0].type, "create_story_analysis");
  assert.equal(response.operations[0].imageModel, "gpt-image-2");
  assert.match(response.operations[0].adjustments.join(" "), /gemini-3-pro-image-preview.*gpt-image-2/);
  assert.equal(response.operations[0].projectAspectRatio, "9:16");

  const legacyClient = createCanvasAgentClient(clientConfig, async () => Response.json({
    choices: [{ message: { content: JSON.stringify({
      message: "直接建分镜",
      workflow_state: "active",
      operations: [{
        type: "create_story_workflow",
        ref: "story-1",
        title: "夜班电梯",
        global_context: "固定角色和场景",
        chunk_index: 0,
        is_final: true,
        shots: [{
          ref: "shot-01",
          title: "停电",
          script: "灯灭了。",
          image_prompt: "电梯内静态关键帧",
          video_prompt: "灯光熄灭",
        }],
      }],
    }) } }],
  }));
  await assert.rejects(
    () => legacyClient.respond(validateAgentRequest(request({ canvas: { ...canvas, mode: "workflow" } }))),
    /必须先进行剧本分析/,
  );
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

  const contextClient = createCanvasAgentClient(
    clientConfig,
    async () => Response.json(
      { error: { message: "context_length_exceeded", secret: "sk-sensitive" } },
      { status: 400 },
    ),
  );
  await assert.rejects(
    () => contextClient.respond(validateAgentRequest(request())),
    (error) =>
      error instanceof CanvasAgentError &&
      /超过上游模型上下文限制/.test(error.message) &&
      !/sensitive/.test(error.message),
  );

  const bodyClient = createCanvasAgentClient(
    clientConfig,
    async () => Response.json({ error: "too large" }, { status: 413 }),
  );
  await assert.rejects(
    () => bodyClient.respond(validateAgentRequest(request())),
    /超过上游模型上下文限制/,
  );
});
