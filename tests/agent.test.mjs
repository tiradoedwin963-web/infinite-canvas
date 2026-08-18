import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_FIRST_RESPONSE_TIMEOUT_MESSAGE,
  AGENT_INACTIVITY_TIMEOUT_MESSAGE,
  AGENT_TOTAL_TIMEOUT_MESSAGE,
  AgentRequestTimeoutError,
  createAgentConversation,
  createAgentConversationTitle,
  compactMangaPlanningSnapshot,
  describeDangerousOperation,
  expireIncompleteAgentConfirmations,
  getPendingAgentConfirmations,
  isDangerousAgentOperation,
  parseAgentConversationStore,
  parseAgentMessages,
  parseAgentModelResponse,
  runAgentConfirmationsSequentially,
  runAgentConfirmationWithTimeout,
  runAgentRequestWithTimeout,
  serializeAgentConversationStore,
  serializeAgentMessages,
  validateAgentOperationsForSurface,
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
    progress_summary: "已读取剧本并整理安全操作。",
    message: "已经整理好了。",
    workflow_state: "active",
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
        model: "image:gpt-image-2",
        prompt: "海报",
        reference_node_ids: ["old"],
        aspect_ratio: "1:1",
        resolution: "1K",
      },
      {
        type: "create_story_workflow",
        ref: "story-1",
        title: "夜班电梯",
        global_context: "固定角色和电梯场景",
        image_model: "gemini-3-pro-image-preview",
        video_model: "seedance-2.0",
        aspect_ratio: "9:16",
        image_resolution: "1K",
        video_resolution: "720p",
        chunk_index: 0,
        is_final: true,
        shots: [{
          ref: "shot-01",
          title: "停电",
          script: "灯灭了。",
          image_prompt: "电梯内静态关键帧",
          video_prompt: "灯光熄灭，缓慢推镜",
          duration: "5",
          reference_node_ids: ["old"],
        }],
      },
      { type: "run_story_workflow", story_id: "actual-story-id", shot_refs: [] },
      {
        type: "create_story_analysis",
        ref: "asset-story",
        title: "资产剧",
        analysis: {
          genre: "都市",
          theme: "成长",
          audience: "青年用户",
          emotion: "低落到振奋",
          estimated_duration: "60 秒",
          visual_style: "水粉笔触与柔和光影",
        },
        project_aspect_ratio: "9:16",
        image_model: "gemini-3-pro-image-preview",
      },
      {
        type: "create_story_asset_batch",
        story_id: "actual-story-id",
        asset_kind: "character",
        chunk_index: 0,
        is_final: true,
        assets: [{
          ref: "character-01",
          name: "阿宁",
          description: "黑色短发，蓝色外套",
          reason: "主角",
          occurrences: ["全剧"],
          image_prompt: "人物三视图和四种表情",
          aspect_ratio: "16:9",
          resolution: "2K",
          foundation_role: "lead",
        }],
      },
      { type: "run_story_assets", story_id: "actual-story-id", asset_refs: ["character-01"] },
    ],
  }));
  assert.equal(response.message, "已经整理好了。");
  assert.equal(response.progressSummary, "已读取剧本并整理安全操作。");
  assert.deepEqual(response.operations.map((operation) => operation.type), [
    "create_node",
    "update_node",
    "move_node",
    "resize_node",
    "connect_nodes",
    "disconnect_nodes",
    "delete_node",
    "generate_content",
    "create_story_workflow",
    "run_story_workflow",
    "create_story_analysis",
    "create_story_asset_batch",
    "run_story_assets",
  ]);
  assert.equal(response.operations.filter(isDangerousAgentOperation).length, 4);
  assert.equal(response.operations[8].shots[0].referenceNodeIds[0], "old");
  assert.equal(response.operations.at(-2).assets[0].resolution, "2K");
  assert.equal(response.operations.at(-3).analysis.visualStyle, "水粉笔触与柔和光影");
  assert.equal(response.operations.at(-2).assets[0].foundationRole, "lead");
  assert.match(describeDangerousOperation(response.operations.at(-1)), /资产/);
});

test("uses a controlled fallback message when a valid operation omits display text", () => {
  const response = parseAgentModelResponse(JSON.stringify({
    workflow_state: "active",
    operations: [{
      type: "create_node",
      ref: "new-1",
      kind: "text",
      text: "标题",
      x: 1,
      y: 2,
    }],
  }));
  assert.equal(response.message, "已完成当前阶段规划。");
  assert.equal(response.operations.length, 1);
  assert.throws(() => parseAgentModelResponse(JSON.stringify({
    workflow_state: "active",
    operations: [],
  })), /未返回可显示的回复/);
});

test("rejects unknown or malformed model operations without partial application", () => {
  assert.throws(
    () => parseAgentModelResponse('{"message":"ok","workflow_state":"active","operations":[{"type":"eval"}]}'),
    /不受支持/,
  );
  assert.throws(() => parseAgentModelResponse("not-json"), /无法识别/);
  assert.throws(
    () => parseAgentModelResponse('{"message":"请确认？","workflow_state":"clarifying","operations":[{"type":"move_node","node_id":"a","x":1,"y":2}]}'),
    /澄清阶段/,
  );
  const oversizedStory = parseAgentModelResponse(JSON.stringify({
    message: "完整分镜",
    workflow_state: "active",
    operations: [{
      type: "create_story_workflow",
      ref: "story-1",
      title: "测试",
      global_context: "设定",
      chunk_index: 0,
      is_final: true,
      shots: Array.from({ length: 34 }, (_, index) => ({
        ref: `shot-${index}`,
        title: "镜头",
        script: "文本",
        image_prompt: "画面",
        video_prompt: "动作",
        duration: "5",
      })),
    }],
  }));
  assert.deepEqual(
    oversizedStory.operations.map((operation) => operation.shots.length),
    [8, 8, 8, 8, 2],
  );
  assert.deepEqual(
    oversizedStory.operations.map((operation) => operation.chunkIndex),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    oversizedStory.operations.map((operation) => operation.isFinal),
    [false, false, false, false, true],
  );
  const multipleOversizedStory = parseAgentModelResponse(JSON.stringify({
    message: "多操作完整分镜",
    workflow_state: "active",
    operations: [0, 1].map((operationIndex) => ({
      type: "create_story_workflow",
      ref: "story-1",
      title: operationIndex ? "测试（后续批次措辞变化）" : "测试",
      global_context: operationIndex ? "设定，后续批次标点变化。" : "设定",
      chunk_index: operationIndex,
      is_final: operationIndex === 1,
      shots: Array.from({ length: 16 }, (_, shotIndex) => ({
        ref: `shot-${operationIndex * 16 + shotIndex}`,
        title: "镜头",
        script: "文本",
        image_prompt: "画面",
        video_prompt: "动作",
        duration: "5",
      })),
    })),
  }));
  assert.deepEqual(
    multipleOversizedStory.operations.map((operation) => operation.chunkIndex),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    multipleOversizedStory.operations.map((operation) => operation.isFinal),
    [false, false, false, true],
  );
  const continuationStory = parseAgentModelResponse(JSON.stringify({
    message: "续批",
    workflow_state: "active",
    operations: [{
      type: "create_story_workflow",
      ref: "story-1",
      title: "测试",
      global_context: "设定",
      chunk_index: 4,
      is_final: true,
      shots: [{
        ref: "shot-32",
        title: "镜头",
        script: "文本",
        image_prompt: "画面",
        video_prompt: "动作",
        duration: "5",
      }],
    }],
  }));
  assert.equal(continuationStory.operations[0].chunkIndex, 4);
  const assetBatch = (assets, isFinal = true) => JSON.stringify({
    message: "资产",
    workflow_state: "active",
    operations: [{
      type: "create_story_asset_batch",
      story_id: "story-id",
      asset_kind: "character",
      chunk_index: 0,
      is_final: isFinal,
      assets,
    }],
  });
  const validAsset = (index) => ({
    ref: `character-${index}`,
    name: `人物 ${index}`,
    description: "稳定外观",
    reason: "有独立身份",
    occurrences: ["第一场"],
    image_prompt: "三视图和剧情表情",
    aspect_ratio: "16:9",
    resolution: "2K",
  });
  assert.throws(
    () => parseAgentModelResponse(assetBatch(Array.from({ length: 9 }, (_, index) => validAsset(index)))),
    /不受支持/,
  );
  assert.throws(
    () => parseAgentModelResponse(assetBatch([], false)),
    /不受支持/,
  );
  assert.equal(
    parseAgentModelResponse(assetBatch([], true)).operations[0].assets.length,
    0,
  );
});

test("accepts complete agent JSON with surplus trailing closing braces", () => {
  const response = parseAgentModelResponse(
    '{"message":"已完成","workflow_state":"active","operations":[]}}',
  );
  assert.equal(response.message, "已完成");
  assert.deepEqual(response.operations, []);
});

test("parses agent JSON wrapped in invisible boundary characters", () => {
  const response = parseAgentModelResponse(
    `\u200B${JSON.stringify({
      message: "已完成分析。",
      workflow_state: "active",
      operations: [],
    })}\uFEFF`,
  );
  assert.equal(response.message, "已完成分析。");
});

test("parses agent JSON wrapped in zero-width joiners and word joiners", () => {
  const response = parseAgentModelResponse(
    '\u200C\u2060{"message":"已完成","workflow_state":"active","operations":[]}\u2060\u200D',
  );
  assert.equal(response.message, "已完成");
});

test("compacts old manga shots while keeping recent planning context", () => {
  const shotNodes = Array.from({ length: 6 }, (_, index) => ({
    id: `node-${index + 1}`,
    type: "source",
    kind: "text",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    storyId: "story-1",
    storyRole: "shot",
    shotRef: `shot-${index + 1}`,
    text: "完整镜头正文",
    prompt: "",
    model: "",
    status: "ready",
    hasVisual: false,
    shotPlan: {
      shotId: `shot-${index + 1}`,
      sequence: index + 1,
      sceneId: "scene-1",
      beatId: "beat-1",
      duration: 10,
      characterIds: [],
      propIds: [],
      startFrame: "开始",
      endFrame: "结束",
      previousShotId: "",
      nextShotId: "",
      continuityNotes: "连续",
      continuityWarnings: [],
    },
  }));
  const snapshot = {
    mode: "workflow",
    viewport: { x: 0, y: 0, scale: 1, width: 1, height: 1 },
    nodes: [{
      id: "analysis",
      type: "source",
      kind: "text",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      storyId: "story-1",
      storyRole: "analysis",
      storyboardMode: "comic",
      mangaPlanningStage: "shot-plans",
      text: "分析",
      prompt: "",
      model: "",
      status: "ready",
      hasVisual: false,
    }, ...shotNodes],
    edges: [],
  };
  const compact = compactMangaPlanningSnapshot(snapshot);
  assert.equal(compact.nodes[1].shotPlan, undefined);
  assert.match(compact.nodes[1].text, /"shotId":"shot-1"/);
  assert.ok(compact.nodes.at(-1).shotPlan);
});

test("rejects operations on the wrong canvas and create-plus-run responses", () => {
  const createStory = {
    type: "create_story_workflow",
    ref: "story",
    title: "测试",
    globalContext: "设定",
    imageModel: "gemini-3-pro-image-preview",
    videoModel: "seedance-2.0",
    aspectRatio: "9:16",
    imageResolution: "1K",
    videoResolution: "720p",
    chunkIndex: 0,
    isFinal: true,
    shots: [{
      ref: "shot-01",
      title: "镜头",
      script: "剧本",
      imagePrompt: "画面",
      videoPrompt: "动作",
      duration: "5",
      referenceNodeIds: [],
    }],
  };
  assert.throws(
    () => validateAgentOperationsForSurface("creation", [createStory]),
    /不能在创作画布/,
  );
  assert.throws(
    () => validateAgentOperationsForSurface("workflow", [{
      type: "create_node",
      ref: "node",
      kind: "text",
      text: "x",
      x: 0,
      y: 0,
    }]),
    /不能在工作流画布/,
  );
  assert.throws(
    () => validateAgentOperationsForSurface("workflow", [
      createStory,
      { type: "run_story_workflow", storyId: "story-id", shotRefs: [] },
    ]),
    /不能在同一响应/,
  );
  const createAnalysis = {
    type: "create_story_analysis",
    ref: "story-assets",
    title: "测试",
    analysis: {
      genre: "都市",
      theme: "成长",
      audience: "青年",
      emotion: "振奋",
      estimatedDuration: "60 秒",
    },
    projectAspectRatio: "9:16",
    imageModel: "gemini-3-pro-image-preview",
  };
  assert.throws(
    () => validateAgentOperationsForSurface("creation", [createAnalysis]),
    /不能在创作画布/,
  );
  assert.throws(
    () => validateAgentOperationsForSurface("workflow", [
      createAnalysis,
      { type: "run_story_assets", storyId: "story-id", assetRefs: [] },
    ]),
    /不能在同一响应/,
  );
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

test("extracts only complete pending confirmations in message order", () => {
  const messages = [
    {
      id: "delete",
      role: "assistant",
      content: "",
      createdAt: 1,
      action: {
        label: "delete",
        status: "pending",
        operation: { type: "delete_node", nodeId: "a" },
      },
    },
    {
      id: "missing",
      role: "assistant",
      content: "",
      createdAt: 2,
      action: { label: "missing", status: "pending" },
    },
    {
      id: "generate",
      role: "assistant",
      content: "",
      createdAt: 3,
      action: {
        label: "generate",
        status: "pending",
        operation: {
          type: "generate_content",
          mode: "image",
          model: "gpt-image-2",
          prompt: "poster",
          referenceNodeIds: [],
        },
      },
    },
    {
      id: "confirmed",
      role: "assistant",
      content: "",
      createdAt: 4,
      action: {
        label: "confirmed",
        status: "confirmed",
        operation: { type: "delete_node", nodeId: "b" },
      },
    },
  ];
  const confirmations = getPendingAgentConfirmations(messages);

  assert.deepEqual(
    confirmations.map((confirmation) => confirmation.messageId),
    ["delete", "generate"],
  );
  const normalized = expireIncompleteAgentConfirmations(messages);
  assert.equal(normalized[1].action.status, "expired");
  assert.match(normalized[1].details[0], /确认内容已失效/);
  assert.equal(expireIncompleteAgentConfirmations(normalized), normalized);
});

test("describes final image parameters and automatic adjustments", () => {
  const description = describeDangerousOperation({
    type: "generate_content",
    mode: "image",
    model: "gemini-3-pro-image-preview",
    prompt: "portrait",
    referenceNodeIds: [],
    aspectRatio: "3:4",
    resolution: "2K",
    adjustments: ["画面比例由 2:3 调整为 3:4。"],
  });
  assert.match(description, /比例 3:4/);
  assert.match(description, /分辨率 2K/);
  assert.match(description, /画面比例由 2:3 调整为 3:4/);
  assert.doesNotMatch(description, /。；/);
});

test("confirmation timeout aborts the signal and reports the remote-task warning", async () => {
  let taskSignal;
  await assert.rejects(
    runAgentConfirmationWithTimeout(
      (signal) => {
        taskSignal = signal;
        return new Promise(() => {});
      },
      5,
    ),
    /远端任务可能仍在继续.*避免重复计费/,
  );
  assert.equal(taskSignal.aborted, true);

  const result = await runAgentConfirmationWithTimeout(
    async (signal) => {
      assert.equal(signal.aborted, false);
      return "done";
    },
    20,
  );
  assert.equal(result, "done");
});

test("agent request timeout distinguishes first response, inactivity, total, and manual stop", async () => {
  let timeoutSignal;
  await assert.rejects(
    runAgentRequestWithTimeout(
      (signal) => {
        timeoutSignal = signal;
        return new Promise(() => {});
      },
      undefined,
      { firstResponseMs: 5, inactivityMs: 20, totalMs: 40 },
    ),
    (error) =>
      error instanceof AgentRequestTimeoutError &&
      error.kind === "first-response" &&
      error.message === AGENT_FIRST_RESPONSE_TIMEOUT_MESSAGE,
  );
  assert.equal(timeoutSignal.aborted, true);

  let markActivity;
  const inactive = runAgentRequestWithTimeout(
    (_signal, activity) => {
      markActivity = activity;
      return new Promise(() => {});
    },
    undefined,
    { firstResponseMs: 20, inactivityMs: 8, totalMs: 50 },
  );
  markActivity();
  await new Promise((resolve) => setTimeout(resolve, 4));
  markActivity();
  await assert.rejects(
    inactive,
    (error) =>
      error instanceof AgentRequestTimeoutError &&
      error.kind === "inactivity" &&
      error.message === AGENT_INACTIVITY_TIMEOUT_MESSAGE,
  );

  const total = runAgentRequestWithTimeout(
    (signal, activity) => {
      const interval = setInterval(activity, 2);
      signal.addEventListener("abort", () => clearInterval(interval), { once: true });
      return new Promise(() => {});
    },
    undefined,
    { firstResponseMs: 10, inactivityMs: 10, totalMs: 18 },
  );
  await assert.rejects(
    total,
    (error) =>
      error instanceof AgentRequestTimeoutError &&
      error.kind === "total" &&
      error.message === AGENT_TOTAL_TIMEOUT_MESSAGE,
  );

  const manualController = new AbortController();
  const stopped = runAgentRequestWithTimeout(
    () => new Promise(() => {}),
    manualController.signal,
    100,
  );
  manualController.abort();
  await assert.rejects(
    stopped,
    (error) => error instanceof DOMException && error.name === "AbortError",
  );

  const result = await runAgentRequestWithTimeout(
    async (signal, markActivity) => {
      assert.equal(signal.aborted, false);
      markActivity();
      return "done";
    },
    undefined,
    { firstResponseMs: 20, inactivityMs: 20, totalMs: 40 },
  );
  assert.equal(result, "done");
});

test("runs confirmations sequentially and stops at the first failure", async () => {
  const successfulCalls = [];
  const successful = await runAgentConfirmationsSequentially(
    ["a", "b", "c"],
    async (item) => {
      successfulCalls.push(item);
      return true;
    },
  );
  assert.deepEqual(successfulCalls, ["a", "b", "c"]);
  assert.deepEqual(successful, { completed: 3 });

  const failedCalls = [];
  const failed = await runAgentConfirmationsSequentially(
    ["a", "b", "c"],
    async (item) => {
      failedCalls.push(item);
      return item !== "b";
    },
  );
  assert.deepEqual(failedCalls, ["a", "b"]);
  assert.deepEqual(failed, { completed: 1, failedIndex: 1 });
});

test("migrates legacy messages into one active conversation", () => {
  const legacy = serializeAgentMessages([
    { id: "u1", role: "user", content: "  请  整理画布  ", createdAt: 10 },
    { id: "a1", role: "assistant", content: "好", createdAt: 20 },
  ]);
  const store = parseAgentConversationStore(null, legacy, () => "conversation-1", 30);
  assert.equal(store.activeConversationId, "conversation-1");
  assert.equal(store.conversations[0].phase, "active");
  assert.equal(store.conversations[0].title, "请 整理画布");
});

test("limits conversation titles, histories, and pending action payloads", () => {
  assert.equal(createAgentConversationTitle("a".repeat(30)).length, 24);
  const conversations = Array.from({ length: 22 }, (_, index) => {
    const conversation = createAgentConversation(`c-${index}`, index);
    conversation.messages = Array.from({ length: 105 }, (__, messageIndex) => ({
      id: `m-${index}-${messageIndex}`,
      role: "assistant",
      content: "message",
      createdAt: messageIndex,
      ...(messageIndex === 104
        ? {
            action: {
              label: "删除节点 a",
              status: "pending",
              operation: { type: "delete_node", nodeId: "a" },
            },
          }
        : {}),
    }));
    return conversation;
  });
  const serialized = serializeAgentConversationStore({
    version: 2,
    activeConversationId: "c-21",
    conversations,
  });
  const raw = JSON.parse(serialized);
  assert.equal(raw.conversations.length, 20);
  assert.equal(raw.conversations[0].messages.length, 100);
  assert.equal(raw.conversations[0].messages.at(-1).action.status, "expired");
  assert.doesNotMatch(serialized, /delete_node|nodeId/);
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

test("serializes edge port sides for agent canvas inspection", () => {
  const snapshot = createAgentCanvasSnapshot(
    {
      version: 1,
      nodes: [textNode("a"), textNode("b")],
      edges: [
        {
          id: "edge",
          sourceId: "a",
          targetId: "b",
          sourceSide: "left",
          targetSide: "right",
        },
      ],
    },
    { x: 0, y: 0, scale: 1 },
    { width: 1000, height: 700 },
  );
  assert.deepEqual(snapshot.edges, [
    {
      sourceId: "a",
      targetId: "b",
      sourceSide: "left",
      targetSide: "right",
    },
  ]);
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
  assert.deepEqual(result.graph.edges, [
    {
      id: "id-2",
      sourceId: "a",
      targetId: "id-1",
      sourceSide: "right",
      targetSide: "left",
    },
  ]);
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
