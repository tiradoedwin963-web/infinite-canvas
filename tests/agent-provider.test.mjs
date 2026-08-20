import assert from "node:assert/strict";
import test from "node:test";
import {
  CanvasAgentError,
  createCanvasAgentClient,
  validateAgentRequest,
} from "../app/ai/agent-provider.ts";
import { parseAgentModelResponse } from "../app/ai/agent.ts";

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

function comicWorkflowCanvas({ mode = "comic", assetAvailable = true } = {}) {
  return {
    ...canvas,
    mode: "workflow",
    nodes: [
      {
        id: "analysis",
        type: "source",
        kind: "text",
        storyId: "story-1",
        storyRole: "analysis",
        assetStrategy: "foundation-pair-v1",
        foundationApprovedAt: 123,
        storyboardMode: mode,
        planningStage: "complete",
        planningStatus: "complete",
        text: "分析",
      },
      {
        id: "asset-result",
        type: "result",
        kind: "image",
        storyId: "story-1",
        storyRole: "asset-result",
        assetRef: "lead",
        assetRole: "result",
        assetAvailable,
        status: assetAvailable ? "success" : "ready",
      },
    ],
  };
}

const clientConfig = {
  baseUrl: "https://lingke.example",
  apiKey: "secret",
  instructions: "RUNTIME_AGENT_MD_MARKER",
  toolManual: "RUNTIME_IMAGE_TOOL_MANUAL_MARKER",
  workflowToolManual: "RUNTIME_WORKFLOW_TOOL_MANUAL_MARKER",
  storyAssetToolManual: "RUNTIME_STORY_ASSET_TOOL_MANUAL_MARKER",
  commonShotManual: "RUNTIME_COMMON_SHOT_MANUAL_MARKER",
  comicStoryboardManual: "RUNTIME_COMIC_STORYBOARD_MANUAL_MARKER",
  mangaDirectorCoreManual: "RUNTIME_MANGA_DIRECTOR_CORE_MARKER",
  mangaStageManuals: {
    "story-beats": "RUNTIME_MANGA_STORY_BEATS_MARKER",
    "scene-plans": "RUNTIME_MANGA_SCENE_PLANS_MARKER",
    "shot-plans": "RUNTIME_MANGA_SHOT_PLANS_MARKER",
    continuity: "RUNTIME_MANGA_CONTINUITY_MARKER",
  },
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

function assertStrictSchemaRequiresEveryProperty(schema, path = "schema") {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  if (schema.type === "object" && schema.additionalProperties === false && schema.properties) {
    assert.deepEqual(
      [...(schema.required ?? [])].sort(),
      Object.keys(schema.properties).sort(),
      `${path} 的严格对象字段必须全部 required`,
    );
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key === "required" || key === "enum") continue;
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertStrictSchemaRequiresEveryProperty(
        item,
        `${path}.${key}[${index}]`,
      ));
    } else {
      assertStrictSchemaRequiresEveryProperty(value, `${path}.${key}`);
    }
  }
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
  assert.equal(upstreamRequest.body.max_tokens, undefined);
  assert.equal(upstreamRequest.init.headers.Authorization, "Bearer secret");
  assert.match(JSON.stringify(upstreamRequest.body.messages), /画布快照/);
  assert.match(JSON.stringify(upstreamRequest.body.messages), /RUNTIME_AGENT_MD_MARKER/);
  const systemMessage = upstreamRequest.body.messages[0].content;
  assert.match(systemMessage, /RUNTIME_IMAGE_TOOL_MANUAL_MARKER/);
  assert.match(systemMessage, /RUNTIME_WORKFLOW_TOOL_MANUAL_MARKER/);
  assert.match(systemMessage, /RUNTIME_STORY_ASSET_TOOL_MANUAL_MARKER/);
  assert.doesNotMatch(systemMessage, /RUNTIME_COMMON_SHOT_MANUAL_MARKER/);
  assert.doesNotMatch(systemMessage, /RUNTIME_COMIC_STORYBOARD_MANUAL_MARKER/);
  assert.match(systemMessage, /"mode":"text","model":"gpt-5\.6-sol"/);
  assert.match(systemMessage, /"model":"gemini-3-pro-image-preview"/);
  assert.match(systemMessage, /"aspectRatios":\["16:9","1:1","4:3","3:4","9:16"\]/);
  assert.match(systemMessage, /model 字段只能填写 model 值/);
  assert.doesNotMatch(systemMessage, /text:gpt-5\.6-sol/);
});

test("reads OpenAI-compatible text-part responses without losing the JSON envelope", async () => {
  const raw = JSON.stringify({
    message: "已完成当前批次。",
    workflow_state: "active",
    operations: [],
  });
  const client = createCanvasAgentClient(clientConfig, async () => Response.json({
    choices: [{
      message: {
        content: [
          { type: "text", text: raw.slice(0, 18) },
          { type: "text", text: { value: raw.slice(18) } },
        ],
      },
    }],
  }));
  const response = await client.respond(validateAgentRequest(request({
    phase: "active",
    messages: [
      { role: "user", content: "整理画布" },
      { role: "assistant", content: "继续" },
      { role: "user", content: "继续" },
    ],
  })));
  assert.equal(response.message, "已完成当前批次。");
});

test("reads streamed OpenAI-compatible text parts without losing the JSON envelope", async () => {
  const raw = JSON.stringify({
    message: "已完成当前批次。",
    workflow_state: "active",
    operations: [],
  });
  const encoder = new TextEncoder();
  const client = createCanvasAgentClient(clientConfig, async () => new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          choices: [{ delta: { content: [{ type: "text", text: raw.slice(0, 18) }] } }],
        })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          choices: [{ delta: { content: [{ type: "text", text: { value: raw.slice(18) } }] } }],
        })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  ));
  const response = await client.respond(validateAgentRequest(request({
    phase: "active",
    messages: [
      { role: "user", content: "整理画布" },
      { role: "assistant", content: "继续" },
      { role: "user", content: "继续" },
    ],
  })));
  assert.equal(response.message, "已完成当前批次。");
});

test("uses a bounded structured output budget for two-shot manga batches", async () => {
  let body;
  const client = createCanvasAgentClient(clientConfig, async (_url, init) => {
    body = JSON.parse(init.body);
    return Response.json({
      choices: [{ message: { content: '{"message":"继续","workflow_state":"active","operations":[]}' } }],
    });
  });
  const mangaCanvas = comicWorkflowCanvas();
  mangaCanvas.nodes[0].mangaPlanningStage = "shot-plans";
  await client.respond(validateAgentRequest(request({
    canvas: mangaCanvas,
    phase: "active",
    messages: [
      { role: "user", content: "开始" },
      { role: "assistant", content: "已进入镜头规划" },
      { role: "user", content: "继续" },
    ],
  })));
  assert.equal(body.max_tokens, 8_192);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  const shotSchema = body.response_format.json_schema.schema.properties.operations
    .items.properties.shots.items;
  assert.equal(shotSchema.additionalProperties, false);
  assert.ok(shotSchema.required.includes("camera_movement"));
  assert.ok(shotSchema.required.includes("character_ids"));
  assert.ok(shotSchema.required.includes("prop_ids"));
  assert.ok(shotSchema.required.includes("transition_in"));
  assert.ok(shotSchema.required.includes("transition_out"));
  assert.ok(shotSchema.required.includes("duration_reason"));
  assert.ok(shotSchema.required.includes("timeline"));
  assert.ok(!shotSchema.required.includes("previous_shot_id"));
  assert.ok(!shotSchema.required.includes("next_shot_id"));
  assert.ok(!shotSchema.required.includes("dialogue"));
  assert.ok(!Object.hasOwn(shotSchema.properties, "continuity_warnings"));
  assert.ok(!Object.hasOwn(shotSchema.properties, "dialogue"));
  assert.ok(!Object.hasOwn(shotSchema.properties.timeline.items.properties, "performance"));
  assert.ok(!Object.hasOwn(shotSchema.properties.timeline.items.properties, "audio"));
  assert.deepEqual(
    [...shotSchema.required].sort(),
    Object.keys(shotSchema.properties).sort(),
  );
  assert.deepEqual(
    [...shotSchema.properties.timeline.items.required].sort(),
    Object.keys(shotSchema.properties.timeline.items.properties).sort(),
  );
});

test("keeps every manga strict schema object fully required", async () => {
  let body;
  const client = createCanvasAgentClient(clientConfig, async (_url, init) => {
    body = JSON.parse(init.body);
    return Response.json({
      choices: [{ message: { content: '{"message":"继续","workflow_state":"active","operations":[]}' } }],
    });
  });
  for (const stage of ["story-beats", "scene-plans", "shot-plans", "continuity"]) {
    const mangaCanvas = comicWorkflowCanvas();
    mangaCanvas.nodes[0].mangaPlanningStage = stage;
    await client.respond(validateAgentRequest(request({
      canvas: mangaCanvas,
      phase: "active",
      messages: [
        { role: "user", content: "开始" },
        { role: "assistant", content: "继续" },
        { role: "user", content: "继续" },
      ],
    })));
    assertStrictSchemaRequiresEveryProperty(body.response_format.json_schema.schema);
  }
});

test("uses the short-cut duration schema only for a short-cut project", async () => {
  let body;
  const client = createCanvasAgentClient(clientConfig, async (_url, init) => {
    body = JSON.parse(init.body);
    return Response.json({
      choices: [{ message: { content: '{"message":"继续","workflow_state":"active","operations":[]}' } }],
    });
  });
  const mangaCanvas = comicWorkflowCanvas();
  mangaCanvas.nodes[0].mangaPlanningStage = "shot-plans";
  mangaCanvas.nodes[0].mangaStoryboardTempo = "short-cut";
  await client.respond(validateAgentRequest(request({
    canvas: mangaCanvas,
    phase: "active",
    messages: [
      { role: "user", content: "开始" },
      { role: "assistant", content: "已进入镜头规划" },
      { role: "user", content: "继续" },
    ],
  })));
  const duration = body.response_format.json_schema.schema.properties.operations
    .items.properties.shots.items.properties.duration;
  assert.deepEqual(duration.enum, [2, 3]);
  assert.match(body.messages[0].content, /短片剪辑；每行分镜严格为 2 或 3 秒/);
});

test("uses one strict response schema for every manga director stage", async () => {
  const stages = [
    ["story-beats", "create_manga_story_beats", "beats"],
    ["scene-plans", "create_manga_scene_plans", "plans"],
    ["shot-plans", "create_manga_shot_batch", "shots"],
    ["continuity", "create_manga_continuity_report", "report"],
  ];
  for (const [stage, operationType, payloadField] of stages) {
    let body;
    const client = createCanvasAgentClient(clientConfig, async (_url, init) => {
      body = JSON.parse(init.body);
      return Response.json({
        choices: [{ message: { content: JSON.stringify({
          message: "继续规划。",
          workflow_state: "active",
          operations: [],
        }) } }],
      });
    });
    const mangaCanvas = comicWorkflowCanvas();
    mangaCanvas.nodes[0].mangaPlanningStage = stage;
    mangaCanvas.nodes[0].mangaPlanningStatus = "planning";
    await client.respond(validateAgentRequest(request({
      canvas: mangaCanvas,
      phase: "active",
      messages: [
        { role: "user", content: "继续" },
        { role: "assistant", content: "当前阶段已准备" },
        { role: "user", content: "继续规划" },
      ],
    })));
    const schema = body.response_format.json_schema.schema;
    const operation = schema.properties.operations;
    assert.equal(body.max_tokens, stage === "shot-plans" ? 8_192 : 16_384);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(operation.minItems, 1);
    assert.equal(operation.maxItems, 1);
    assert.deepEqual(operation.items.properties.type.enum, [operationType]);
    assert.ok(operation.items.required.includes(payloadField));
  }
});

test("reports the failed manga director field instead of an unsupported operation", () => {
  const response = (operation) => JSON.stringify({
    message: "继续规划。",
    workflow_state: "active",
    operations: [operation],
  });
  assert.throws(
    () => parseAgentModelResponse(response({
      type: "create_manga_story_beats",
      story_id: "story-1",
      stage_index: 0,
      beats: [{
        beat_id: "beat-001",
        sequence: 1,
        scene_id: "scene-1",
        narrative_purpose: "建立处境",
        emotional_goal: "紧张",
      }],
    })),
    /剧情节拍结构校验失败：beats\[0\] 的 summary 不能为空/,
  );
  assert.throws(
    () => parseAgentModelResponse(response({
      type: "create_manga_scene_plans",
      story_id: "story-1",
      stage_index: 1,
      plans: [{
        scene_id: "scene-1",
        beat_ids: ["beat-001"],
        blocking: "角色对峙",
        eyeline: "相互注视",
        axis: "保持同侧",
        entrances_exits: "无人进出",
        lighting: "侧光",
        color_tone: "冷色",
      }],
    })),
    /场面调度结构校验失败：plans\[0\] 的 spatial_layout 不能为空/,
  );
  assert.throws(
    () => parseAgentModelResponse(response({
      type: "create_manga_continuity_report",
      story_id: "story-1",
      stage_index: 3,
      report: { issues: [{
        code: "axis-jump",
        severity: "warning",
        shot_id: "shot-001",
        reason: "人物方向反转",
        suggestion: "增加过轴镜头",
      }] },
    })),
    /连续性报告结构校验失败：report\.issues\[0\] 的 auto_fixable 必须是布尔值/,
  );
});

test("loads comic stage rules without the detailed cinematography manual before shot planning", async () => {
  let body;
  const client = createCanvasAgentClient(clientConfig, async (_url, init) => {
    body = JSON.parse(init.body);
    return Response.json({
      choices: [{ message: { content: JSON.stringify({
        message: "资产库已就绪。",
        workflow_state: "active",
        operations: [],
      }) } }],
    });
  });
  await client.respond(validateAgentRequest(request({
    phase: "active",
    messages: [
      { role: "user", content: "完整剧本" },
      { role: "assistant", content: "资产已完成" },
      { role: "user", content: "开始漫剧分镜" },
    ],
    canvas: {
      ...canvas,
      mode: "workflow",
      nodes: [{
        id: "analysis",
        type: "source",
        kind: "text",
        x: 0,
        y: 0,
        width: 288,
        height: 200,
        storyId: "story-1",
        storyRole: "analysis",
        assetStrategy: "foundation-pair-v1",
        foundationApprovedAt: 123,
        storyboardMode: "comic",
        planningStage: "complete",
        planningStatus: "complete",
        mangaPlanningStage: "story-beats",
        mangaPlanningStatus: "planning",
        text: "分析",
        prompt: "",
        model: "",
        status: "ready",
        hasVisual: false,
      }],
    },
  })));
  const systemMessage = body.messages[0].content;
  assert.doesNotMatch(systemMessage, /RUNTIME_COMMON_SHOT_MANUAL_MARKER/);
  assert.match(systemMessage, /RUNTIME_COMIC_STORYBOARD_MANUAL_MARKER/);
  assert.match(systemMessage, /RUNTIME_MANGA_DIRECTOR_CORE_MARKER/);
  assert.match(systemMessage, /RUNTIME_MANGA_STORY_BEATS_MARKER/);
  assert.doesNotMatch(systemMessage, /RUNTIME_IMAGE_TOOL_MANUAL_MARKER/);
  assert.doesNotMatch(systemMessage, /RUNTIME_WORKFLOW_TOOL_MANUAL_MARKER/);
  assert.doesNotMatch(systemMessage, /RUNTIME_STORY_ASSET_TOOL_MANUAL_MARKER/);
  assert.doesNotMatch(systemMessage, /RUNTIME_MANGA_SCENE_PLANS_MARKER/);
  assert.doesNotMatch(systemMessage, /RUNTIME_MANGA_SHOT_PLANS_MARKER/);
  assert.doesNotMatch(systemMessage, /RUNTIME_MANGA_CONTINUITY_MARKER/);
});

test("loads the detailed cinematography manual only during manga shot planning", async () => {
  let body;
  const client = createCanvasAgentClient(clientConfig, async (_url, init) => {
    body = JSON.parse(init.body);
    return Response.json({
      choices: [{ message: { content: JSON.stringify({
        message: "镜头规划准备就绪。",
        workflow_state: "active",
        operations: [],
      }) } }],
    });
  });
  const stagedCanvas = comicWorkflowCanvas();
  stagedCanvas.nodes[0].mangaPlanningStage = "shot-plans";
  stagedCanvas.nodes[0].mangaPlanningStatus = "planning";
  await client.respond(validateAgentRequest(request({ canvas: stagedCanvas })));
  const systemMessage = body.messages[0].content;
  assert.match(systemMessage, /RUNTIME_COMMON_SHOT_MANUAL_MARKER/);
  assert.match(systemMessage, /RUNTIME_MANGA_SHOT_PLANS_MARKER/);
  assert.doesNotMatch(systemMessage, /RUNTIME_IMAGE_TOOL_MANUAL_MARKER/);
  assert.doesNotMatch(systemMessage, /RUNTIME_WORKFLOW_TOOL_MANUAL_MARKER/);
  assert.doesNotMatch(systemMessage, /RUNTIME_STORY_ASSET_TOOL_MANUAL_MARKER/);
  assert.doesNotMatch(systemMessage, /RUNTIME_MANGA_CONTINUITY_MARKER/);
});

test("rejects a manga director operation from the wrong project stage", async () => {
  const client = createCanvasAgentClient(clientConfig, async () => Response.json({
    choices: [{ message: { content: JSON.stringify({
      message: "情绪节拍已整理。",
      workflow_state: "active",
      operations: [{
        type: "create_manga_story_beats",
        story_id: "story-1",
        stage_index: 0,
        beats: [{
          beat_id: "beat-001",
          sequence: 1,
          scene_id: "scene-1",
          narrative_purpose: "建立人物处境",
          emotional_goal: "紧张",
          summary: "人物进入房间并察觉异常",
        }],
      }],
    }) } }],
  }));
  const stagedCanvas = comicWorkflowCanvas();
  stagedCanvas.nodes[0].mangaPlanningStage = "scene-plans";
  stagedCanvas.nodes[0].mangaPlanningStatus = "planning";
  await assert.rejects(
    () => client.respond(validateAgentRequest(request({ canvas: stagedCanvas }))),
    /当前项目阶段不一致/,
  );
});

test("rejects storyboard output until the selected comic asset library is ready", async () => {
  const operation = {
    type: "create_story_workflow",
    ref: "comic-plan",
    title: "雨夜归人",
    global_context: "保持资产连续",
    image_model: "gemini-3-pro-image-preview",
    video_model: "seedance-2.0",
    aspect_ratio: "9:16",
    image_resolution: "1K",
    video_resolution: "720p",
    chunk_index: 0,
    is_final: true,
    shots: [{
      ref: "shot-01",
      title: "回望",
      script: "结构化分镜文本",
      image_prompt: "静态首帧",
      video_prompt: "回望动作",
      duration: "5",
      reference_node_ids: ["asset-result"],
    }],
  };
  const client = createCanvasAgentClient(clientConfig, async () => Response.json({
    choices: [{ message: { content: JSON.stringify({
      message: "已规划分镜。",
      workflow_state: "active",
      operations: [operation],
    }) } }],
  }));
  const history = [
    { role: "user", content: "完整剧本" },
    { role: "assistant", content: "资产已完成" },
    { role: "user", content: "开始漫剧分镜" },
  ];
  const accepted = await client.respond(validateAgentRequest(request({
    phase: "active",
    messages: history,
    canvas: comicWorkflowCanvas(),
  })));
  assert.equal(accepted.operations[0].type, "create_story_workflow");

  await assert.rejects(
    () => client.respond(validateAgentRequest(request({
      phase: "active",
      messages: history,
      canvas: comicWorkflowCanvas({ assetAvailable: false }),
    }))),
    /成功的资产结果|尚未全部生成/,
  );
  await assert.rejects(
    () => client.respond(validateAgentRequest(request({
      phase: "active",
      messages: history,
      canvas: comicWorkflowCanvas({ mode: "tvc" }),
    }))),
    /选择漫剧能力/,
  );
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
  await assert.rejects(
    () => invalidClient.respond(validateAgentRequest(request())),
    (error) =>
      error instanceof CanvasAgentError &&
      error.code === "response-envelope" &&
      /JSON 操作对象/.test(error.message),
  );

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

  const responseFormatClient = createCanvasAgentClient(
    clientConfig,
    async () => new Response(
      "Invalid schema for response_format: strict schema requires every property.",
      { status: 400 },
    ),
  );
  await assert.rejects(
    () => responseFormatClient.respond(validateAgentRequest(request())),
    (error) =>
      error instanceof CanvasAgentError &&
      error.code === "response-format" &&
      /严格结构化输出格式/.test(error.message),
  );
});
