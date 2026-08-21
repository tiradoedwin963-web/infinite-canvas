import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkflowTaskStatus,
  buildWorkflowGenerationPrompt,
  buildWorkflowPrompt,
  connectWorkflowNodes,
  createConnectedScheduler,
  createWorkflowNode,
  createWorkflowRun,
  createStoryWorkflow,
  emptyWorkflowGraph,
  fitWorkflowImageNode,
  moveWorkflowNodes,
  parseWorkflowGraph,
  readWorkflowInputs,
  removeWorkflowEdge,
  removeWorkflowNode,
  retryWorkflowSubmissionUnknown,
  resizedWorkflowNodeBounds,
  schedulerDefaults,
  workflowEdgeKinds,
  workflowEdgeGeometry,
  workflowEdgePath,
  workflowInputPorts,
  workflowImageMimeType,
  workflowPendingInputPoint,
} from "../app/workflow/graph.ts";

function ids() {
  let value = 0;
  return () => `workflow-${++value}`;
}

test("infers generated image MIME types from stable result URLs", () => {
  assert.equal(workflowImageMimeType("image/png", undefined, undefined), "image/png");
  assert.equal(
    workflowImageMimeType("application/octet-stream", undefined, "https://cdn.example/result.png?token=1"),
    "image/png",
  );
  assert.equal(workflowImageMimeType("application/octet-stream", undefined, "https://cdn.example/result.bin"), "");
});

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

function storyOperation(overrides = {}) {
  return {
    type: "create_story_workflow",
    ref: "story-1",
    title: "夜班电梯",
    globalContext: "角色造型、场景光线和画面风格必须统一。",
    imageModel: "gemini-3-pro-image-preview",
    videoModel: "seedance-2.0",
    aspectRatio: "9:16",
    imageResolution: "1K",
    videoResolution: "720p",
    chunkIndex: 0,
    isFinal: true,
    shots: [
      {
        ref: "shot-01",
        title: "停电",
        script: "灯灭了。",
        imagePrompt: "电梯内停电瞬间的静态关键帧",
        videoPrompt: "灯光熄灭，缓慢推镜，角色外观不变",
        duration: "5",
        referenceNodeIds: [],
      },
      {
        ref: "shot-02",
        title: "来电",
        script: "灯又亮了。",
        imagePrompt: "电梯重新亮起的静态关键帧",
        videoPrompt: "灯光闪烁后亮起，固定镜头，服装不变",
        duration: "10",
        referenceNodeIds: [],
      },
    ],
    ...overrides,
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
  assert.equal(graph.nodes[3].aspectRatio, "16:9");
});

test("keeps workflow persistence separate and rejects invalid versions", () => {
  const persistedScheduler = { ...scheduler(), aspectRatio: "9:16" };
  const graph = {
    version: 1,
    nodes: [source("text", "text", "hello"), persistedScheduler],
    edges: [{ id: "edge", sourceId: "text", targetId: "scheduler" }],
  };
  assert.deepEqual(parseWorkflowGraph(JSON.stringify(graph)), graph);
  assert.equal(parseWorkflowGraph(JSON.stringify(graph)).nodes[1].aspectRatio, "9:16");
  assert.deepEqual(parseWorkflowGraph(JSON.stringify({ ...graph, version: 2 })), emptyWorkflowGraph());
});

test("moves unfinished legacy video nodes to the current video provider", () => {
  const legacyScheduler = {
    ...scheduler("legacy-video"),
    ...schedulerDefaults("video"),
    model: "doubao-seedance-1-5-pro-251215",
  };
  const legacyResult = {
    id: "legacy-result",
    x: 0,
    y: 0,
    type: "result",
    kind: "video",
    schedulerId: legacyScheduler.id,
    text: "",
    model: "doubao-seedance-1-5-pro-251215",
    status: "ready",
    progress: "",
    error: "",
  };
  const parsed = parseWorkflowGraph(JSON.stringify({
    version: 1,
    nodes: [legacyScheduler, legacyResult],
    edges: [],
  }));
  assert.deepEqual(parsed.nodes.map((node) => node.model), [
    "seedance-2.0",
    "seedance-2.0",
  ]);
});

test("persists submission-unknown results and protects legacy fetch interruptions", () => {
  const videoScheduler = {
    ...scheduler("video-scheduler"),
    ...schedulerDefaults("video"),
  };
  const unknown = {
    id: "unknown",
    x: 0,
    y: 0,
    type: "result",
    kind: "video",
    schedulerId: videoScheduler.id,
    text: "",
    model: videoScheduler.model,
    status: "submission-unknown",
    progress: "提交状态未知：未收到任务编号，不能确认视频平台是否已接收请求。",
    error: "提交状态未知：未收到任务编号，不能确认视频平台是否已接收请求。",
  };
  const persisted = parseWorkflowGraph(JSON.stringify({
    version: 1,
    nodes: [videoScheduler, unknown],
    edges: [],
  }));
  assert.equal(persisted.nodes.find((node) => node.id === unknown.id).status, "submission-unknown");

  const legacy = parseWorkflowGraph(JSON.stringify({
    version: 1,
    nodes: [{
      ...unknown,
      id: "legacy-fetch-error",
      model: "viduq3",
      status: "failed",
      progress: "",
      error: "Failed to fetch",
    }],
    edges: [],
  }));
  const migrated = legacy.nodes[0];
  assert.equal(migrated.status, "submission-unknown");
  assert.match(migrated.error, /未收到任务编号/);
  assert.equal(migrated.model, "seedance-2.0");

  const explicitFailure = parseWorkflowGraph(JSON.stringify({
    version: 1,
    nodes: [{
      ...unknown,
      id: "explicit-failure",
      status: "failed",
      progress: "",
      error: "余额不足",
    }],
    edges: [],
  }));
  assert.equal(explicitFailure.nodes[0].status, "failed");
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
  assert.equal(
    buildWorkflowGenerationPrompt(inputs, scheduler()),
    "第一段\n\n第二段\n\n节点提示词",
  );
  for (const storyRole of [
    "asset-scheduler",
    "storyboard-scheduler",
    "video-scheduler",
  ]) {
    assert.equal(
      buildWorkflowGenerationPrompt(inputs, { ...scheduler(), storyRole }),
      "节点提示词",
    );
  }
});

test("uses all multi-shot image assets as references without assigning a single start frame", () => {
  const inputs = {
    text: [],
    images: [
      { ...source("lead", "image"), label: "主角", assetKind: "character" },
      { ...source("scene", "image"), label: "湖畔", assetKind: "scene" },
    ],
    videos: [],
  };
  const prompt = buildWorkflowGenerationPrompt(inputs, {
    ...scheduler("multi-shot"),
    ...schedulerDefaults("video"),
    storyRole: "video-scheduler",
    mangaStoryboardTempo: "multi-shot",
  });
  assert.match(prompt, /图1：人物资产 · 主角[\s\S]*图2：场景资产 · 湖畔/);
  assert.match(prompt, /全部图片仅作为本视频片段的资产参考/);
  assert.doesNotMatch(prompt, /以图1为镜头起始画面/);
});

test("places scheduler input rows inside the card by persisted connection order and media kind", () => {
  const target = { ...scheduler(), width: 300 };
  const graph = {
    version: 1,
    nodes: [
      { ...source("text-one", "text", "A"), label: "剧本分析" },
      { ...source("image-two", "image"), assetId: "image-two", assetName: "主角.png" },
      { ...source("video", "video"), assetId: "video" },
      { ...source("image-one", "image"), assetId: "image-one" },
      source("text-two", "text", "B"),
      target,
    ],
    edges: [
      { id: "text-one-edge", sourceId: "text-one", targetId: target.id },
      { id: "image-two-edge", sourceId: "image-two", targetId: target.id },
      { id: "video-edge", sourceId: "video", targetId: target.id },
      { id: "image-one-edge", sourceId: "image-one", targetId: target.id },
      { id: "text-two-edge", sourceId: "text-two", targetId: target.id },
    ],
  };
  const ports = workflowInputPorts(graph);
  assert.deepEqual(ports.map((port) => port.label), [
    "文本1",
    "图1",
    "视频1",
    "图2",
    "文本2",
  ]);
  assert.deepEqual(ports.map((port) => port.sourceName), [
    "剧本分析",
    "主角.png",
    "视频素材",
    "图片素材",
    "文本素材",
  ]);
  assert.deepEqual(ports.map((port) => port.edgeId), graph.edges.map((edge) => edge.id));
  assert.deepEqual(ports.map(({ x, y }) => ({ x, y })), [
    { x: 420, y: 88 },
    { x: 420, y: 118 },
    { x: 420, y: 148 },
    { x: 420, y: 178 },
    { x: 420, y: 208 },
  ]);
  assert.ok(ports.every((port) => port.x > target.x && port.x < target.x + target.width));
  assert.deepEqual(
    readWorkflowInputs(graph, target.id).images.map((node) => node.id),
    ["image-two", "image-one"],
  );
  assert.deepEqual(workflowPendingInputPoint(graph, target.id), { x: 420, y: 238 });
});

test("removes only the requested workflow edge and reindexes remaining image inputs", () => {
  const target = scheduler();
  const result = {
    id: "result",
    x: 800,
    y: 0,
    type: "result",
    kind: "image",
    schedulerId: target.id,
    taskId: "task-1",
    status: "success",
    resultUrl: "https://example.com/result.png",
    progress: "已完成",
  };
  const graph = {
    version: 1,
    nodes: [
      { ...source("image-one", "image"), assetId: "one" },
      { ...source("image-two", "image"), assetId: "two" },
      target,
      result,
    ],
    edges: [
      { id: "first", sourceId: "image-one", targetId: target.id },
      { id: "second", sourceId: "image-two", targetId: target.id },
      { id: "output", sourceId: target.id, targetId: result.id },
    ],
  };
  const removed = removeWorkflowEdge(graph, "first");
  assert.deepEqual([...workflowEdgeKinds(graph)], [
    ["first", "image"],
    ["second", "image"],
    ["output", "image"],
  ]);
  assert.deepEqual(removed.nodes, graph.nodes);
  assert.deepEqual(removed.edges, [graph.edges[1], graph.edges[2]]);
  assert.deepEqual(workflowInputPorts(removed).map((port) => port.label), ["图1"]);
  const withoutOutput = removeWorkflowEdge(removed, "output");
  assert.deepEqual(withoutOutput.nodes, graph.nodes);
  assert.deepEqual(withoutOutput.edges, [graph.edges[1]]);
  assert.equal(withoutOutput.nodes.at(-1).taskId, "task-1");
  assert.equal(workflowInputPorts({
    ...graph,
    edges: [{ id: "text", sourceId: "text-one", targetId: target.id }],
    nodes: [source("text-one", "text", "A"), target],
  })[0]?.label, "文本");
  assert.equal(removeWorkflowEdge(removed, "missing"), removed);
});

test("keeps Agent-authored story prompts separate from IP names in source text", () => {
  const created = createStoryWorkflow(emptyWorkflowGraph(), storyOperation({
    globalContext: "使用迪士尼版白雪公主造型。",
    shots: [{
      ref: "shot-01",
      title: "出场",
      script: "迪士尼版白雪公主走进森林。",
      imagePrompt: "年轻女性，短黑卷发，原创蓝灰旅行裙，走进森林。",
      videoPrompt: "年轻女性缓慢前行，镜头平稳跟随。",
      duration: "5",
      referenceNodeIds: [],
    }],
  }), ids());
  for (const storyRole of ["storyboard-scheduler", "video-scheduler"]) {
    const node = created.graph.nodes.find((candidate) =>
      candidate.type === "scheduler" && candidate.storyRole === storyRole
    );
    const prompt = buildWorkflowGenerationPrompt(
      readWorkflowInputs(created.graph, node.id),
      node,
    );
    assert.doesNotMatch(prompt, /迪士尼|白雪公主/);
  }
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

test("requires explicit confirmation before reusing a submission-unknown result", () => {
  const videoScheduler = {
    ...scheduler("video-scheduler"),
    ...schedulerDefaults("video"),
  };
  const unknown = {
    id: "unknown-result",
    x: 800,
    y: 0,
    type: "result",
    kind: "video",
    schedulerId: videoScheduler.id,
    text: "",
    model: videoScheduler.model,
    status: "submission-unknown",
    progress: "提交状态未知：未收到任务编号，不能确认视频平台是否已接收请求。",
    error: "提交状态未知：未收到任务编号，不能确认视频平台是否已接收请求。",
    startedAt: 1,
  };
  const graph = { version: 1, nodes: [videoScheduler, unknown], edges: [] };

  const blocked = createWorkflowRun(graph, videoScheduler.id, 10, ids());
  assert.strictEqual(blocked.graph, graph);
  assert.deepEqual(blocked.resultIds, []);

  const retried = retryWorkflowSubmissionUnknown(graph, videoScheduler.id, 20, ids());
  assert.deepEqual(retried.resultIds, [unknown.id]);
  const reset = retried.graph.nodes.find((node) => node.id === unknown.id);
  assert.equal(reset.status, "pending");
  assert.equal(reset.progress, "等待提交");
  assert.equal(reset.error, "");
  assert.equal(reset.startedAt, 20);
  assert.equal(retryWorkflowSubmissionUnknown(retried.graph, videoScheduler.id, 30, ids()).resultIds.length, 0);
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
  const inputGeometry = workflowEdgeGeometry(sourceNode, target, { x: 620, y: 288 });
  assert.match(inputGeometry.path, /^M 200 60 C/);
  assert.match(inputGeometry.path, /, 600 288$/);
  assert.ok(inputGeometry.midpoint.x > 200 && inputGeometry.midpoint.x < 600);
  assert.ok(inputGeometry.midpoint.y < 288);
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
  const image = { ...source("image", "image"), width: 162, height: 330 };
  const resizedImage = resizedWorkflowNodeBounds(image, "south-east", { x: 324, y: 618 });
  assert.equal(resizedImage.width / (resizedImage.height - 42), 9 / 16);
  assert.deepEqual(
    { width: resizedImage.width, height: resizedImage.height },
    { width: 324, height: 618 },
  );
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

test("fits generated and imported image nodes to their natural ratios", () => {
  const nodes = [
    { ...source("square", "image"), x: 0, y: 0 },
    { ...source("portrait", "image"), x: 400, y: 0 },
    {
      id: "landscape",
      x: 800,
      y: 0,
      type: "result",
      kind: "image",
      schedulerId: "scheduler",
      text: "",
      model: "gemini-3-pro-image-preview",
      status: "success",
      progress: "",
      error: "",
      resultUrl: "https://example.com/landscape.png",
    },
  ];
  let graph = { version: 1, nodes, edges: [] };
  graph = fitWorkflowImageNode(graph, "square", 1000, 1000);
  graph = fitWorkflowImageNode(graph, "portrait", 900, 1600);
  graph = fitWorkflowImageNode(graph, "landscape", 1600, 900);
  const square = graph.nodes.find((node) => node.id === "square");
  const portrait = graph.nodes.find((node) => node.id === "portrait");
  const landscape = graph.nodes.find((node) => node.id === "landscape");
  assert.deepEqual(
    { x: square.x, y: square.y, width: square.width, height: square.height },
    { x: 0, y: -65, width: 288, height: 330 },
  );
  assert.deepEqual(
    { x: portrait.x, y: portrait.y, width: portrait.width, height: portrait.height },
    { x: 463, y: -65, width: 162, height: 330 },
  );
  assert.deepEqual(
    { x: landscape.x, y: landscape.y, width: landscape.width, height: landscape.height },
    { x: 800, y: -2, width: 288, height: 204 },
  );
  assert.equal(portrait.width / (portrait.height - 42), 9 / 16);
  assert.equal(landscape.width / (landscape.height - 42), 16 / 9);
});

test("keeps explicit image sizes and rejects invalid or non-image fit requests", () => {
  const explicit = { ...source("explicit", "image"), width: 400, height: 442 };
  const video = source("video", "video");
  const graph = { version: 1, nodes: [explicit, video, source("text", "text")], edges: [] };
  assert.equal(fitWorkflowImageNode(graph, "explicit", 1000, 1000), graph);
  assert.equal(fitWorkflowImageNode(graph, "video", 1920, 1080), graph);
  assert.equal(fitWorkflowImageNode(graph, "text", 1000, 1000), graph);
  assert.equal(fitWorkflowImageNode(graph, "missing", 1000, 1000), graph);
  assert.equal(fitWorkflowImageNode(graph, "explicit", 0, 1000), graph);
  assert.equal(fitWorkflowImageNode(graph, "explicit", Number.NaN, 1000), graph);
});

test("keeps extreme image ratios natural while applying preview edge limits", () => {
  const graph = { version: 1, nodes: [source("panorama", "image")], edges: [] };
  const fitted = fitWorkflowImageNode(graph, "panorama", 1000, 100);
  const node = fitted.nodes[0];
  assert.equal(node.width, 960);
  assert.equal(node.height, 138);
  assert.equal(node.width / (node.height - 42), 10);

  const minimum = resizedWorkflowNodeBounds(
    { ...source("portrait", "image"), width: 162, height: 330 },
    "south-east",
    { x: 1, y: 1 },
  );
  assert.equal(minimum.width, 96);
  assert.ok(Math.abs(minimum.width / (minimum.height - 42) - 9 / 16) < 1e-10);
  const maximum = resizedWorkflowNodeBounds(
    { ...source("portrait", "image"), width: 162, height: 330 },
    "south-east",
    { x: 2000, y: 2000 },
  );
  assert.equal(maximum.height - 42, 1200);
  assert.ok(Math.abs(maximum.width / (maximum.height - 42) - 9 / 16) < 1e-10);
});

test("creates an atomic short-drama graph to the right with reusable placeholders", () => {
  const character = {
    ...source("character", "image"),
    x: 500,
    label: "白雪公主",
    assetId: "asset-character",
    assetKind: "character",
  };
  const scene = {
    ...source("scene", "image"),
    x: 500,
    label: "王宫寝室",
    assetId: "asset-scene",
    assetKind: "scene",
  };
  const prop = {
    ...source("prop", "image"),
    x: 500,
    label: "毒苹果",
    assetId: "asset-prop",
    assetKind: "prop",
  };
  const operation = storyOperation({
    shots: storyOperation().shots.map((shot, index) => ({
      ...shot,
      referenceNodeIds: index === 0 ? [character.id, scene.id, prop.id] : [],
    })),
  });
  const created = createStoryWorkflow(
    { version: 1, nodes: [character, scene, prop], edges: [] },
    operation,
    ids(),
  );
  const storyNodes = created.graph.nodes.filter((node) => node.storyId === created.storyId);
  assert.equal(storyNodes.length, 11);
  assert.equal(created.graph.edges.length, 19);
  assert.ok(storyNodes.every((node) => node.x > character.x));
  assert.deepEqual(
    storyNodes.filter((node) => node.shotRef === "shot-01").map((node) => node.storyRole),
    ["shot", "storyboard-scheduler", "storyboard", "video-scheduler", "clip"],
  );
  const imagePlaceholder = storyNodes.find((node) => node.storyRole === "storyboard");
  const imageScheduler = storyNodes.find((node) => node.storyRole === "storyboard-scheduler");
  const videoScheduler = storyNodes.find((node) => node.storyRole === "video-scheduler");
  assert.equal(imagePlaceholder.status, "ready");
  assert.ok(created.graph.edges.some((edge) => edge.sourceId === character.id && edge.targetId === imageScheduler.id));
  assert.ok(created.graph.edges.some((edge) => edge.sourceId === imagePlaceholder.id && edge.targetId === videoScheduler.id));
  assert.ok(created.graph.edges.some((edge) => edge.sourceId === character.id && edge.targetId === videoScheduler.id));
  assert.ok(created.graph.edges.some((edge) => edge.sourceId === scene.id && edge.targetId === videoScheduler.id));
  assert.ok(!created.graph.edges.some((edge) => edge.sourceId === prop.id && edge.targetId === videoScheduler.id));
  const videoInputs = readWorkflowInputs(created.graph, videoScheduler.id);
  assert.deepEqual(videoInputs.images.map((node) => node.id), [
    imagePlaceholder.id,
    character.id,
    scene.id,
  ]);
  assert.match(
    buildWorkflowGenerationPrompt(videoInputs, videoScheduler),
    /图1：分镜首帧[\s\S]*图2：人物资产 · 白雪公主[\s\S]*图3：场景资产 · 王宫寝室/,
  );
  const sizedGraph = {
    ...created.graph,
    nodes: created.graph.nodes.map((node) =>
      node.id === imagePlaceholder.id
        ? { ...node, width: 162, height: 330 }
        : node,
    ),
  };
  const rerun = createWorkflowRun(sizedGraph, imageScheduler.id, 123, ids());
  assert.deepEqual(rerun.resultIds, [imagePlaceholder.id]);
  assert.equal(rerun.graph.nodes.find((node) => node.id === imagePlaceholder.id).status, "pending");
  assert.equal(rerun.graph.nodes.find((node) => node.id === imagePlaceholder.id).width, undefined);
  assert.equal(rerun.graph.nodes.find((node) => node.id === imagePlaceholder.id).height, undefined);
  assert.equal(rerun.graph.nodes.filter((node) => node.type === "result").length, 4);
  const restored = parseWorkflowGraph(JSON.stringify(created.graph));
  assert.equal(restored.nodes.find((node) => node.id === imagePlaceholder.id).storyRole, "storyboard");
});

test("rejects incomplete, duplicate, and invalid-reference story plans without mutation", () => {
  const graph = emptyWorkflowGraph();
  assert.throws(
    () => createStoryWorkflow(graph, storyOperation({ isFinal: false })),
    /尚未完整/,
  );
  assert.throws(
    () => createStoryWorkflow(graph, storyOperation({
      shots: storyOperation().shots.map((shot) => ({ ...shot, ref: "same" })),
    })),
    /重复分镜/,
  );
  assert.throws(
    () => createStoryWorkflow(graph, storyOperation({
      shots: [{ ...storyOperation().shots[0], referenceNodeIds: ["missing"] }],
    })),
    /不可用的图片节点/,
  );
  assert.deepEqual(graph, emptyWorkflowGraph());
});
