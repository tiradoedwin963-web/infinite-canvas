import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAgentModelResponse,
} from "../app/ai/agent.ts";
import {
  createWorkflowBatchRun,
  describeWorkflowRun,
} from "../app/workflow/agent.ts";
import {
  acknowledgeMangaContinuity,
  buildMangaVideoPrompt,
  buildMangaShortCutVideoPrompt,
  createMangaCinematographyComparisonGraph,
  createMangaContinuityReport,
  createMangaScenePlans,
  createMangaShotBatch,
  createMangaStoryBeats,
  refreshMangaVideoSchedulerPrompts,
  remapWorkflowAssetIds,
  groupMangaShortCutSegments,
} from "../app/workflow/manga-director.ts";
import { validateMangaShotCinematography } from "../app/workflow/manga-cinematography.ts";
import { parseWorkflowGraph, readWorkflowInputs } from "../app/workflow/graph.ts";
import { setStoryStoryboardMode } from "../app/workflow/storyboard.ts";
import { createStoryboardTable } from "../app/workflow/storyboard-table.ts";

function ids() {
  let value = 0;
  return () => `manga-${++value}`;
}

function readyGraph(tempo = "long-form") {
  const storyId = "story";
  const result = (id, assetRef, assetKind) => ({
    id,
    x: 0,
    y: 0,
    type: "result",
    kind: "image",
    schedulerId: `${id}-scheduler`,
    text: assetRef,
    model: "gpt-image-2",
    status: "success",
    progress: "",
    error: "",
    resultUrl: `https://example.com/${assetRef}.png`,
    storyId,
    storyRole: "asset-result",
    assetRef,
    assetKind,
    assetRole: "result",
  });
  return setStoryStoryboardMode({
    version: 1,
    nodes: [{
      id: "analysis",
      x: 0,
      y: 0,
      type: "source",
      kind: "text",
      text: "剧本分析",
      storyId,
      storyRole: "analysis",
      storyboardMode: undefined,
      assetStrategy: "foundation-pair-v1",
      foundationApprovedAt: 1,
      planningStage: "complete",
      planningStatus: "complete",
      projectAspectRatio: "16:9",
    },
    result("lead-node", "lead", "character"),
    result("scene-node", "scene", "scene"),
    result("prop-node", "prop", "prop")],
    edges: [],
  }, storyId, "comic", tempo);
}

function shortShot(overrides = {}) {
  return shotPlan({
    duration: 2,
    durationReason: "",
    timeline: [{
      startSecond: 0,
      endSecond: 2,
      visualAction: "主角抬眼并握紧斗篷",
      performance: "短促惊讶后收紧表情",
      camera: "中近景轻推",
      audio: "衣料轻响",
    }],
    ...overrides,
  });
}

function beatOperation() {
  return {
    type: "create_manga_story_beats",
    storyId: "story",
    stageIndex: 0,
    beats: [{
      beatId: "beat-001",
      sequence: 1,
      sceneId: "scene",
      narrativePurpose: "建立人物处境",
      emotionalGoal: "紧张",
      summary: "主角进入房间并察觉异常",
    }],
  };
}

function sceneOperation() {
  return {
    type: "create_manga_scene_plans",
    storyId: "story",
    stageIndex: 1,
    plans: [{
      sceneId: "scene",
      beatIds: ["beat-001"],
      spatialLayout: "门在画面左侧，桌子在右后方",
      blocking: "主角由左向右走到桌前",
      eyeline: "主角看向右后方道具",
      axis: "保持门与桌子的180度轴线",
      entrancesExits: "左侧入画，右侧停下",
      lighting: "右侧窗户提供柔和冷色主光",
      colorTone: "低饱和冷色，人物略亮于背景",
    }],
  };
}

function shotPlan(overrides = {}) {
  return {
    shotId: "shot-001",
    sequence: 1,
    sceneId: "scene",
    beatId: "beat-001",
    duration: 12,
    durationReason: "",
    narrativePurpose: "让观众发现主角察觉异常",
    emotionalGoal: "逐步紧张",
    shotSize: "中景",
    lens: "标准焦段",
    perspective: "自然透视",
    cameraAngle: "平视",
    cameraMovement: "缓慢推近",
    composition: "主角位于左侧三分线，道具位于右后方",
    blocking: "主角从左侧入画并停在桌前",
    characterIds: ["lead"],
    characterPosition: "主角由左向右移动",
    characterMovement: "走三步后停下并转头",
    eyeline: "看向右后方道具",
    propIds: ["prop"],
    action: "主角靠近桌面并察觉道具",
    dialogue: "无",
    voiceover: "无",
    soundEffect: "脚步声和衣料摩擦",
    musicCue: "低频弦乐渐强",
    lighting: "右侧窗户冷色柔光，人物有轻微轮廓光",
    colorTone: "低饱和冷蓝",
    texture: "手绘水粉笔触",
    startFrame: "主角刚从左侧进入中景",
    endFrame: "主角停下看向道具",
    transitionIn: "直接切入",
    transitionOut: "动作切",
    imagePrompt: "主角进入房间的静态构图",
    videoPrompt: "",
    negativePrompt: "禁止人物变脸、跳轴和道具消失",
    previousShotId: "",
    nextShotId: "",
    continuityNotes: "保持主角由左向右及右侧冷光",
    generationStatus: "planned",
    timeline: [
      { startSecond: 0, endSecond: 4, visualAction: "主角入画", performance: "谨慎观察", camera: "中景固定", audio: "脚步声" },
      { startSecond: 4, endSecond: 8, visualAction: "主角走向桌面", performance: "神情收紧", camera: "缓慢推近", audio: "弦乐渐强" },
      { startSecond: 8, endSecond: 12, visualAction: "主角停下转头", performance: "屏住呼吸", camera: "停在中近景", audio: "环境声降低" },
    ],
    referenceNodeIds: ["lead-node", "scene-node", "prop-node"],
    continuityWarnings: [],
    ...overrides,
  };
}

function plannedGraph() {
  const idFactory = ids();
  let graph = createMangaStoryBeats(readyGraph(), beatOperation(), idFactory);
  graph = createMangaScenePlans(graph, sceneOperation(), idFactory);
  graph = createMangaShotBatch(graph, {
    type: "create_manga_shot_batch",
    storyId: "story",
    chunkIndex: 0,
    isFinal: true,
    shots: [shotPlan()],
  }, idFactory);
  return { graph, idFactory };
}

test("normalizes shot reference assets to character, scene, and prop order", () => {
  const idFactory = ids();
  let graph = createMangaStoryBeats(readyGraph(), beatOperation(), idFactory);
  graph = createMangaScenePlans(graph, sceneOperation(), idFactory);
  graph = createMangaShotBatch(graph, {
    type: "create_manga_shot_batch",
    storyId: "story",
    chunkIndex: 0,
    isFinal: true,
    shots: [shotPlan({ referenceNodeIds: ["prop-node", "scene-node", "lead-node"] })],
  }, idFactory);
  const shot = graph.nodes.find((node) => node.storyRole === "shot").shotPlan;
  assert.deepEqual(shot.referenceNodeIds, ["lead-node", "scene-node", "prop-node"]);
});

test("parses numbered manga director stages and rejects a mismatched stage index", () => {
  const payload = {
    message: "导演阶段",
    workflow_state: "active",
    operations: [{
      type: "create_manga_story_beats",
      story_id: "story",
      stage_index: 0,
      beats: [{
        beat_id: "beat-001",
        sequence: 1,
        scene_id: "scene",
        narrative_purpose: "建立处境",
        emotional_goal: "紧张",
        summary: "人物察觉异常",
      }],
    }, {
      type: "create_manga_scene_plans",
      story_id: "story",
      stage_index: 1,
      plans: [{
        scene_id: "scene",
        beat_ids: ["beat-001"],
        spatial_layout: "门左桌右",
        blocking: "人物由左入画",
        eyeline: "看向右侧",
        axis: "保持同侧机位",
        entrances_exits: "左入右停",
        lighting: "右侧冷光",
        color_tone: "低饱和冷色",
      }],
    }, {
      type: "create_manga_continuity_report",
      story_id: "story",
      stage_index: 3,
      report: { issues: [] },
    }],
  };
  assert.deepEqual(
    parseAgentModelResponse(JSON.stringify(payload)).operations.map((operation) =>
      "stageIndex" in operation ? operation.stageIndex : undefined
    ),
    [0, 1, 3],
  );
  payload.operations[1].stage_index = 2;
  assert.throws(
    () => parseAgentModelResponse(JSON.stringify(payload)),
    /场面调度结构校验失败：stage_index 必须为 1/,
  );
});

test("builds staged manga plans and materializes only direct video nodes", () => {
  const { graph: planned, idFactory } = plannedGraph();
  assert.equal(planned.nodes.filter((node) => node.storyRole === "shot").length, 1);
  assert.equal(planned.nodes.filter((node) => node.type === "scheduler").length, 0);
  const completed = createMangaContinuityReport(planned, {
    type: "create_manga_continuity_report",
    storyId: "story",
    stageIndex: 3,
    report: { issues: [] },
  }, idFactory);
  const scheduler = completed.nodes.find((node) => node.storyRole === "video-scheduler");
  assert.equal(completed.nodes.filter((node) => node.storyRole === "storyboard-scheduler").length, 0);
  assert.equal(completed.nodes.filter((node) => node.storyRole === "storyboard").length, 0);
  assert.equal(completed.nodes.filter((node) => node.storyRole === "clip").length, 1);
  assert.equal(scheduler.duration, "12");
  assert.match(scheduler.prompt, /\[0-4秒\][\s\S]*\[4-8秒\][\s\S]*\[8-12秒\]/);
  assert.deepEqual(
    readWorkflowInputs(completed, scheduler.id).images.map((node) => node.id),
    ["lead-node", "scene-node", "prop-node"],
  );
  const batch = createWorkflowBatchRun(completed, {
    type: "run_story_workflow",
    storyId: "story",
    shotRefs: [],
  }, () => "batch");
  assert.equal(batch.schedulerIds.length, 1);
  assert.match(describeWorkflowRun(completed, { type: "run_story_workflow", storyId: "story", shotRefs: [] }), /批量生成 1 个视频片段/);
  assert.doesNotMatch(describeWorkflowRun(completed, { type: "run_story_workflow", storyId: "story", shotRefs: [] }), /分镜图片/);
  assert.equal(parseWorkflowGraph(JSON.stringify(completed)).nodes.length, completed.nodes.length);
});

test("uses 2–3 second storyboard rows and groups them into Seedance 2.5 segments", () => {
  const idFactory = ids();
  let graph = createMangaStoryBeats(readyGraph("short-cut"), beatOperation(), idFactory);
  graph = createMangaScenePlans(graph, sceneOperation(), idFactory);
  graph = createMangaShotBatch(graph, {
    type: "create_manga_shot_batch",
    storyId: "story",
    chunkIndex: 0,
    isFinal: true,
    shots: [
      shortShot({ shotId: "draft-a", sequence: 1 }),
      shortShot({ shotId: "draft-b", sequence: 2, shotSize: "中近景" }),
    ],
  }, idFactory);
  const completed = createMangaContinuityReport(graph, {
    type: "create_manga_continuity_report",
    storyId: "story",
    stageIndex: 3,
    report: { issues: [] },
  }, idFactory);
  const scheduler = completed.nodes.find((node) => node.storyRole === "video-scheduler");
  assert.equal(scheduler.model, "seedance-2.5");
  assert.equal(scheduler.duration, "4");
  assert.deepEqual(scheduler.videoSegment.shotIds, ["shot-001", "shot-002"]);
  assert.equal(completed.nodes.filter((node) => node.storyRole === "video-scheduler").length, 1);
  assert.match(scheduler.prompt, /连续多镜头/);
  assert.match(scheduler.prompt, /\[0-2秒｜shot-001\][\s\S]*\[2-4秒｜shot-002\]/);
  const table = createStoryboardTable(completed, "story");
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows.map((row) => row.timecode), ["00:00–00:02", "00:02–00:04"]);
  assert.equal(table.productionRule.includes("Seedance 2.5"), true);
});

test("merges a short scene into the adjacent segment and rejects an unmergeable tail", () => {
  const shots = [
    shortShot({ shotId: "shot-001", sequence: 1, sceneId: "scene-a", duration: 2 }),
    shortShot({ shotId: "shot-002", sequence: 2, sceneId: "scene-b", duration: 3 }),
    shortShot({ shotId: "shot-003", sequence: 3, sceneId: "scene-b", duration: 3 }),
  ];
  const grouped = groupMangaShortCutSegments(shots);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].duration, 8);
  assert.deepEqual(grouped[0].sceneIds, ["scene-a", "scene-b"]);
  assert.match(buildMangaShortCutVideoPrompt(grouped[0]), /在 2 秒切换画面/);

  const full = Array.from({ length: 10 }, (_, index) => shortShot({
    shotId: `long-${index + 1}`,
    sequence: index + 1,
    sceneId: "scene-a",
    duration: 3,
  }));
  assert.throws(
    () => groupMangaShortCutSegments([...full, shortShot({
      shotId: "tail",
      sequence: 11,
      sceneId: "scene-b",
      duration: 2,
    })]),
    /不足 4 秒/,
  );
});

test("keeps planning after a premature final batch and orders a later missing beat", () => {
  const idFactory = ids();
  const beats = [1, 2, 3].map((sequence) => ({
    beatId: `beat-${String(sequence).padStart(3, "0")}`,
    sequence,
    sceneId: "scene",
    narrativePurpose: `推进第 ${sequence} 个节拍`,
    emotionalGoal: "连续推进",
    summary: `节拍 ${sequence}`,
  }));
  let graph = createMangaStoryBeats(readyGraph(), {
    type: "create_manga_story_beats",
    storyId: "story",
    stageIndex: 0,
    beats,
  }, idFactory);
  graph = createMangaScenePlans(graph, {
    ...sceneOperation(),
    plans: [{ ...sceneOperation().plans[0], beatIds: beats.map((beat) => beat.beatId) }],
  }, idFactory);
  graph = createMangaShotBatch(graph, {
    type: "create_manga_shot_batch",
    storyId: "story",
    chunkIndex: 0,
    isFinal: true,
    shots: [
      shotPlan({ shotId: "shot-001", sequence: 1, beatId: "beat-002" }),
      shotPlan({ shotId: "shot-002", sequence: 2, beatId: "beat-003" }),
    ],
  }, idFactory);
  assert.equal(graph.nodes.find((node) => node.storyRole === "analysis").mangaPlanningStage, "shot-plans");
  assert.equal(graph.nodes.find((node) => node.storyRole === "analysis").mangaPlanningChunkIndex, 1);

  graph = createMangaShotBatch(graph, {
    type: "create_manga_shot_batch",
    storyId: "story",
    chunkIndex: 1,
    isFinal: false,
    shots: [shotPlan({ shotId: "shot-003", sequence: 3, beatId: "beat-001" })],
  }, idFactory);
  const ordered = graph.nodes
    .filter((node) => node.storyRole === "shot")
    .map((node) => node.shotPlan)
    .sort((left, right) => left.sequence - right.sequence);
  assert.deepEqual(ordered.map((shot) => shot.beatId), ["beat-001", "beat-002", "beat-003"]);
  assert.deepEqual(ordered.map((shot) => shot.shotId), ["shot-001", "shot-002", "shot-003"]);
  assert.equal(graph.nodes.find((node) => node.storyRole === "analysis").mangaPlanningStage, "continuity");
});

test("continues a legacy manga project from its greatest existing sequence", () => {
  const idFactory = ids();
  const beats = [1, 2, 3].map((sequence) => ({
    beatId: `beat-${String(sequence).padStart(3, "0")}`,
    sequence,
    sceneId: "scene",
    narrativePurpose: `推进第 ${sequence} 个节拍`,
    emotionalGoal: "连续推进",
    summary: `节拍 ${sequence}`,
  }));
  let graph = createMangaStoryBeats(readyGraph(), {
    type: "create_manga_story_beats",
    storyId: "story",
    stageIndex: 0,
    beats,
  }, idFactory);
  graph = createMangaScenePlans(graph, {
    ...sceneOperation(),
    plans: [{ ...sceneOperation().plans[0], beatIds: beats.map((beat) => beat.beatId) }],
  }, idFactory);
  graph = createMangaShotBatch(graph, {
    type: "create_manga_shot_batch",
    storyId: "story",
    chunkIndex: 0,
    isFinal: false,
    shots: [shotPlan({ shotId: "shot-006", sequence: 1, beatId: "beat-001" })],
  }, idFactory);
  graph = {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.storyRole === "shot" && node.shotPlan
        ? { ...node, shotPlan: { ...node.shotPlan, sequence: 6 } }
        : node,
    ),
  };
  const continued = createMangaShotBatch(graph, {
    type: "create_manga_shot_batch",
    storyId: "story",
    chunkIndex: 1,
    isFinal: false,
    shots: [shotPlan({ shotId: "shot-007", sequence: 7, beatId: "beat-002" })],
  }, idFactory);
  assert.deepEqual(
    continued.nodes
      .filter((node) => node.storyRole === "shot")
      .map((node) => node.shotPlan.sequence),
    [6, 7],
  );
});

test("keeps continuity warnings visible and blocks generation until approval", () => {
  const { graph: planned, idFactory } = plannedGraph();
  const warned = createMangaContinuityReport(planned, {
    type: "create_manga_continuity_report",
    storyId: "story",
    stageIndex: 3,
    report: { issues: [{
      code: "axis-jump",
      severity: "warning",
      shotId: "shot-001",
      reason: "人物方向可能无动机反转",
      suggestion: "保持同侧机位",
      autoFixable: false,
    }] },
  }, idFactory);
  assert.equal(warned.nodes.find((node) => node.storyRole === "analysis").mangaPlanningStatus, "awaiting-continuity-approval");
  assert.throws(() => createWorkflowBatchRun(warned, {
    type: "run_story_workflow", storyId: "story", shotRefs: [],
  }), /尚未确认/);
  const approved = acknowledgeMangaContinuity(warned, "story", 99);
  assert.equal(approved.nodes.find((node) => node.storyRole === "analysis").continuityApprovedAt, 99);
  assert.equal(createWorkflowBatchRun(approved, {
    type: "run_story_workflow", storyId: "story", shotRefs: [],
  }).schedulerIds.length, 1);
});

test("rejects invalid second timelines, short shots without reasons, and continuity errors", () => {
  const response = (shot) => JSON.stringify({
    message: "镜头规划",
    workflow_state: "active",
    operations: [{
      type: "create_manga_shot_batch",
      story_id: "story",
      chunk_index: 0,
      is_final: true,
      shots: [shot],
    }],
  });
  const snake = JSON.parse(JSON.stringify(shotPlan()));
  snake.shot_id = snake.shotId;
  snake.beat_id = snake.beatId;
  snake.scene_id = snake.sceneId;
  snake.reference_node_ids = snake.referenceNodeIds;
  snake.timeline = snake.timeline.map((segment) => ({
    start_second: segment.startSecond,
    end_second: segment.endSecond,
    visual_action: segment.visualAction,
    performance: segment.performance,
    camera: segment.camera,
    audio: segment.audio,
  }));
  delete snake.shotId;
  delete snake.beatId;
  delete snake.sceneId;
  delete snake.referenceNodeIds;
  assert.doesNotThrow(() => parseAgentModelResponse(response(snake)));
  const emptyOptional = structuredClone(snake);
  emptyOptional.characterPosition = "";
  emptyOptional.characterMovement = "";
  emptyOptional.eyeline = "";
  emptyOptional.dialogue = "";
  emptyOptional.voiceover = "";
  emptyOptional.soundEffect = "";
  emptyOptional.musicCue = "";
  emptyOptional.continuityNotes = "";
  emptyOptional.timeline[0].performance = "";
  emptyOptional.timeline[0].audio = "";
  const normalized = parseAgentModelResponse(response(emptyOptional));
  assert.equal(normalized.operations[0].shots[0].dialogue, "无");
  assert.equal(normalized.operations[0].shots[0].timeline[0].audio, "无");
  const gap = structuredClone(snake);
  gap.timeline[1].start_second = 5;
  gap.timeline.at(-1).end_second = 11;
  const normalizedTimeline = parseAgentModelResponse(response(gap))
    .operations[0].shots[0].timeline;
  assert.equal(normalizedTimeline[0].startSecond, 0);
  assert.equal(normalizedTimeline[1].startSecond, normalizedTimeline[0].endSecond);
  assert.equal(normalizedTimeline.at(-1).endSecond, 12);
  const inverted = structuredClone(snake);
  inverted.timeline[0].end_second = 12;
  assert.throws(() => parseAgentModelResponse(response(inverted)), /timeline/);
  const short = structuredClone(snake);
  short.duration = 8;
  short.durationReason = "";
  short.timeline = [{ start_second: 0, end_second: 8, visual_action: "反应", performance: "惊讶", camera: "特写", audio: "无" }];
  assert.throws(() => parseAgentModelResponse(response(short)), /duration_reason/);

  const shortCut = structuredClone(snake);
  shortCut.duration = 2;
  shortCut.duration_reason = "";
  shortCut.timeline = [{ start_second: 0, end_second: 2, visual_action: "主角抬眼", performance: "惊讶", camera: "特写轻推", audio: "无" }];
  assert.doesNotThrow(() => parseAgentModelResponse(response(shortCut), { mangaTempo: "short-cut" }));
  shortCut.duration = 4;
  shortCut.timeline = [{ start_second: 0, end_second: 4, visual_action: "主角抬眼", performance: "惊讶", camera: "特写轻推", audio: "无" }];
  assert.throws(() => parseAgentModelResponse(response(shortCut), { mangaTempo: "short-cut" }), /2 或 3 秒/);

  const crossShot = structuredClone(snake);
  crossShot.end_frame = "切入下一镜的角色眼睛特写";
  assert.throws(
    () => parseAgentModelResponse(response(crossShot)),
    /包含跨镜头场记/,
  );

  const duplicate = structuredClone(snake);
  assert.throws(
    () => parseAgentModelResponse(JSON.stringify({
      message: "镜头规划",
      workflow_state: "active",
      operations: [{
        type: "create_manga_shot_batch",
        story_id: "story",
        chunk_index: 0,
        is_final: false,
        shots: [snake, duplicate],
      }],
    })),
    /shot_id shot-001 在同一批次重复/,
  );

  const optional = structuredClone(snake);
  [
    "durationReason", "characterPosition", "characterMovement", "eyeline",
    "dialogue", "voiceover", "soundEffect", "musicCue", "previousShotId",
    "nextShotId", "continuityNotes", "continuityWarnings",
  ].forEach((key) => delete optional[key]);
  optional.timeline.forEach((segment) => {
    delete segment.performance;
    delete segment.audio;
  });
  assert.doesNotThrow(() => parseAgentModelResponse(response(optional)));

  const { graph: planned, idFactory } = plannedGraph();
  assert.throws(() => createMangaContinuityReport(planned, {
    type: "create_manga_continuity_report",
    storyId: "story",
    stageIndex: 3,
    report: { issues: [{
      code: "missing-prop",
      severity: "error",
      shotId: "shot-001",
      reason: "关键道具无原因消失",
      suggestion: "恢复道具或拆镜说明",
      autoFixable: false,
    }] },
  }, idFactory), /结构错误/);
});

test("keeps only the selected cinematography fields in the deterministic video prompt", () => {
  const prompt = buildMangaVideoPrompt(shotPlan({
    composition: "框中框构图，门框限制人物空间",
    shotSize: "中近景",
    cameraAngle: "眼平正侧面",
    cameraMovement: "缓慢推近，轻微跟随人物呼吸",
    transitionIn: "动作承接",
    transitionOut: "遮挡切换意图",
    previousShotId: "shot-000",
    nextShotId: "shot-002",
  }));
  assert.match(prompt, /框中框构图/);
  assert.match(prompt, /中近景/);
  assert.match(prompt, /眼平正侧面/);
  assert.match(prompt, /缓慢推近/);
  assert.match(prompt, /本镜仅生成 0 至 12 秒内的画面与动作/);
  assert.match(prompt, /脚步声和衣料摩擦/);
  assert.match(prompt, /主角刚从左侧进入中景/);
  assert.match(prompt, /主角停下看向道具/);
  assert.doesNotMatch(prompt, /转场|切镜|前镜|后镜|动作承接|遮挡切换意图|shot-000|shot-002/);
  assert.doesNotMatch(prompt, /点构图|环绕|大远景/);
});

test("keeps cut intentions in the plan while stripping them from the generated video prompt", () => {
  const plan = shotPlan({
    startFrame: "水滴落在叶面，形成清晰的圆形水纹。",
    endFrame: "水纹扩散至满画面；匹配下一镜的眼睛。",
    transitionOut: "相似形状匹配切入下一镜眼睛",
  });
  const prompt = buildMangaVideoPrompt(plan);
  assert.equal(plan.transitionOut, "相似形状匹配切入下一镜眼睛");
  assert.match(prompt, /水滴落在叶面/);
  assert.doesNotMatch(prompt, /匹配下一镜|转场|切镜/);
});

test("rejects dead locked-off shots and repetitive shot-size runs", () => {
  assert.match(validateMangaShotCinematography([shotPlan({ startFrame: "同上" })]), /首尾画面/);
  const staticShot = shotPlan({
    cameraMovement: "固定机位",
    action: "主角静止不动",
    blocking: "主角站在画面中央",
    characterMovement: "无",
    timeline: [{
      startSecond: 0,
      endSecond: 12,
      visualAction: "人物保持静止",
      performance: "无变化",
      camera: "中景固定",
      audio: "无",
    }],
  });
  assert.match(validateMangaShotCinematography([staticShot]), /固定死镜头/);
  assert.equal(validateMangaShotCinematography([shotPlan({
    cameraMovement: "固定机位",
    action: "树叶轻摆",
    characterMovement: "无",
  })]), null);

  const closeShots = Array.from({ length: 4 }, (_, index) => shotPlan({
    shotId: `close-${index + 1}`,
    sequence: index + 1,
    shotSize: index < 3 ? "特写" : "大特写",
  }));
  assert.equal(validateMangaShotCinematography(closeShots.slice(0, 3)), null);
  assert.match(validateMangaShotCinematography(closeShots), /连续 4 个特写/);

  const wideShots = Array.from({ length: 4 }, (_, index) => shotPlan({
    shotId: `wide-${index + 1}`,
    sequence: index + 1,
    shotSize: index === 0 ? "全景" : "中远景",
  }));
  assert.equal(validateMangaShotCinematography(wideShots.slice(0, 3)), null);
  assert.match(validateMangaShotCinematography(wideShots), /连续 4 个中远景/);
});

test("refreshes only unsent manga video scheduler prompts", () => {
  const { graph: planned, idFactory } = plannedGraph();
  const workflow = createMangaContinuityReport(planned, {
    type: "create_manga_continuity_report",
    storyId: "story",
    stageIndex: 3,
    report: { issues: [] },
  }, idFactory);
  const stale = {
    ...workflow,
    nodes: workflow.nodes.map((node) =>
      node.type === "scheduler" && node.storyRole === "video-scheduler"
        ? { ...node, prompt: "旧提示词：转场到下一镜" }
        : node,
    ),
  };
  const refreshed = refreshMangaVideoSchedulerPrompts(stale);
  const scheduler = refreshed.nodes.find((node) =>
    node.type === "scheduler" && node.storyRole === "video-scheduler",
  );
  assert.match(scheduler.prompt, /本镜仅生成 0 至 12 秒内的画面与动作/);
  assert.doesNotMatch(scheduler.prompt, /转场|下一镜/);

  const success = {
    ...stale,
    nodes: stale.nodes.map((node) =>
      node.type === "result" && node.storyRole === "clip"
        ? { ...node, status: "success", taskId: "existing-task" }
        : node,
    ),
  };
  assert.equal(refreshMangaVideoSchedulerPrompts(success), success);
});

test("creates an isolated cinematography comparison graph and remaps its assets", () => {
  const storyId = "snow-white";
  const analysis = {
    id: "analysis",
    x: 0,
    y: 0,
    type: "source",
    kind: "text",
    text: "分析",
    storyId,
    storyRole: "analysis",
    storyboardMode: "comic",
    assetStrategy: "foundation-pair-v1",
    foundationApprovedAt: 1,
    planningStage: "complete",
    planningStatus: "complete",
    mangaPlanningStage: "complete",
    mangaPlanningStatus: "complete",
    mangaPlanningChunkIndex: 0,
    continuityApprovedAt: 2,
  };
  const assetNodes = Array.from({ length: 29 }, (_, index) => {
    const ref = `asset-${index + 1}`;
    return [
      { id: `${ref}-spec`, x: 0, y: index, type: "source", kind: "text", text: ref, storyId, storyRole: "asset-spec", assetRef: ref, assetKind: index < 10 ? "character" : index < 20 ? "scene" : "prop", assetRole: "spec" },
      { id: `${ref}-scheduler`, x: 1, y: index, type: "scheduler", outputKind: "image", model: "gpt-image-2", prompt: ref, aspectRatio: "16:9", resolution: "1K", duration: "", outputCount: 1, error: "", storyId, storyRole: "asset-scheduler", assetRef: ref, assetKind: index < 10 ? "character" : index < 20 ? "scene" : "prop", assetRole: "scheduler" },
      { id: `${ref}-result`, x: 2, y: index, type: "result", kind: "image", schedulerId: `${ref}-scheduler`, text: ref, model: "gpt-image-2", status: "success", progress: "", error: "", resultUrl: `/api/workflow/assets/${ref}`, assetId: ref, storyId, storyRole: "asset-result", assetRef: ref, assetKind: index < 10 ? "character" : index < 20 ? "scene" : "prop", assetRole: "result" },
    ];
  }).flat();
  const beats = Array.from({ length: 40 }, (_, index) => ({
    beatId: `beat-${index + 1}`,
    sequence: index + 1,
    sceneId: `scene-${(index % 8) + 1}`,
    narrativePurpose: "推进剧情",
    emotionalGoal: "保持情绪连续",
    summary: `节拍 ${index + 1}`,
  }));
  const beatNode = { id: "beats", x: 3, y: 0, type: "source", kind: "text", text: "节拍", storyId, storyRole: "story-beats", storyBeats: beats };
  const sceneNodes = Array.from({ length: 8 }, (_, index) => ({
    id: `scene-plan-${index + 1}`,
    x: 4,
    y: index,
    type: "source",
    kind: "text",
    text: "调度",
    storyId,
    storyRole: "scene-plan",
    scenePlan: { sceneId: `scene-${index + 1}` },
  }));
  const shotNodes = Array.from({ length: 98 }, (_, index) => [
    { id: `shot-${index + 1}`, x: 5, y: index, type: "source", kind: "text", text: "分镜", storyId, storyRole: "shot", shotPlan: { shotId: `shot-${index + 1}` } },
    { id: `video-${index + 1}`, x: 6, y: index, type: "scheduler", outputKind: "video", model: "seedance-2.0", prompt: "视频", aspectRatio: "16:9", resolution: "720p", duration: "10", outputCount: 1, error: "", storyId, storyRole: "video-scheduler" },
    { id: `clip-${index + 1}`, x: 7, y: index, type: "result", kind: "video", schedulerId: `video-${index + 1}`, text: "占位", model: "seedance-2.0", status: "ready", progress: "待生成", error: "", storyId, storyRole: "clip" },
  ]).flat();
  const report = { id: "continuity", x: 8, y: 0, type: "source", kind: "text", text: "连续性", storyId, storyRole: "continuity-report", continuityReport: { issues: [] } };
  const original = { version: 1, nodes: [analysis, ...assetNodes, beatNode, ...sceneNodes, ...shotNodes, report], edges: [] };
  const cloned = createMangaCinematographyComparisonGraph(original);
  assert.equal(original.nodes.filter((node) => node.storyRole === "shot").length, 98);
  assert.equal(cloned.nodes.filter((node) => node.assetRole === "result").length, 29);
  assert.equal(cloned.nodes.find((node) => node.storyRole === "story-beats").storyBeats.length, 40);
  assert.equal(cloned.nodes.filter((node) => node.storyRole === "scene-plan").length, 8);
  assert.equal(cloned.nodes.some((node) => ["shot", "video-scheduler", "clip", "continuity-report"].includes(node.storyRole)), false);
  const clonedAnalysis = cloned.nodes.find((node) => node.storyRole === "analysis");
  assert.equal(clonedAnalysis.mangaPlanningStage, "shot-plans");
  assert.equal(clonedAnalysis.mangaPlanningChunkIndex, 0);
  assert.equal(clonedAnalysis.continuityApprovedAt, undefined);
  const mapping = new Map(Array.from({ length: 29 }, (_, index) => [
    `asset-${index + 1}`,
    `copy-${index + 1}`,
  ]));
  const remapped = remapWorkflowAssetIds(cloned, mapping);
  assert.equal(remapped.nodes.filter((node) => node.assetId?.startsWith("copy-")).length, 29);
  assert.match(remapped.nodes.find((node) => node.assetId === "copy-1").resultUrl, /copy-1$/);
});
