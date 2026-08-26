import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  parseAgentModelResponse,
  validateAgentOperationsForSurface,
} from "../app/ai/agent.ts";
import {
  CanvasAgentError,
  createCanvasAgentClient,
  validateAgentRequest,
  validateTvcAgentOperations,
} from "../app/ai/agent-provider.ts";

const workflowCanvas = {
  mode: "workflow",
  viewport: { x: 0, y: 0, scale: 1, width: 1200, height: 800 },
  nodes: [],
  edges: [],
};

const tvcBrief = {
  goal: "让家庭了解园区的陪伴体验",
  audience: "有学龄前儿童的家庭",
  target_duration: 30,
  aspect_ratio: "16:9",
  platform: "Seedance 2.5",
  max_duration: 30,
  style: "温暖手绘动画、低饱和日光",
  narrative_mode: "导览蒙太奇",
  audio_policy: "只保留旁白、环境声和拟声，无 BGM",
  copy: "无",
  reference_map: [],
};

const tvcPromptPlan = [{
  ref: "plan-01",
  startSecond: 0,
  endSecond: 4,
  shotNumbers: ["001"],
  referenceNodeIds: [],
}];

function tvcCanvas(stage) {
  const revision = stage === "intake" ? 0 : 2;
  return {
    ...workflowCanvas,
    tvc: {
      projectId: "project-1",
      stage,
      revision,
      ...((stage === "script-locked" || stage === "prompt-final")
        ? { lockedRevision: revision, promptPlan: tvcPromptPlan }
        : {}),
      title: "虹桥公园 TVC",
      targetModel: "Seedance 2.5",
      targetMaxDuration: 30,
    },
  };
}

function request(canvas, overrides = {}) {
  return validateAgentRequest({
    messages: [{ role: "user", content: "开始 TVC 规划" }],
    canvas,
    phase: "active",
    ...overrides,
  });
}

function response(operations) {
  return Response.json({
    choices: [{
      message: {
        content: JSON.stringify({
          progress_summary: "已完成当前 TVC 阶段资料整理。",
          message: "已完成。",
          workflow_state: "active",
          operations,
        }),
      },
    }],
  });
}

const clientConfig = {
  baseUrl: "https://lingke.example",
  apiKey: "secret",
  instructions: "BASE_AGENT_MARKER",
  toolManual: "IMAGE_TOOL_MARKER",
  workflowToolManual: "LEGACY_WORKFLOW_MARKER",
  storyAssetToolManual: "LEGACY_ASSET_MARKER",
  tvcDirectorManuals: {
    core: "TVC_CORE_MARKER",
    intake: "TVC_INTAKE_MARKER",
    storyboard: "TVC_STORYBOARD_MARKER",
    promptPackage: "TVC_PROMPT_MARKER",
  },
};

test("parses all restricted TVC operations but never accepts an Agent lock operation", () => {
  const parsed = parseAgentModelResponse(JSON.stringify({
    message: "TVC 资料已整理。",
    workflow_state: "active",
    operations: [
      { type: "create_tvc_brief", ref: "tvc-1", title: "虹桥", brief: tvcBrief },
      { type: "update_tvc_brief", project_id: "project-1", brief: tvcBrief },
      {
        type: "create_tvc_asset_plan",
        project_id: "project-1",
        assets: [{
          ref: "prop-1",
          name: "红桥模型",
          kind: "prop",
          description: "红色拱桥的稳定造型",
          reason: "跨镜重复出现",
          image_prompt: "纯白背景上的红桥模型细节板",
        }],
      },
      {
        type: "write_tvc_storyboard_draft",
        project_id: "project-1",
        rows: [{
          shot_number: "001",
          start_second: 0,
          end_second: 4,
          duration_seconds: 4,
          reference_scene: "湖畔草地",
          scene_time: "午后",
          shot_size_lens: "中景 / 35mm",
          camera: "眼平缓慢后退",
          composition: "角色与红桥同框",
          performance: "角色看向远处红桥",
          narration: "欢迎来到虹桥公园。",
          sound: "轻风和鸟鸣，无 BGM",
          transition: "起镜",
          constraints: "保持角色与红桥造型一致",
          reference_node_ids: ["asset-1"],
        }],
      },
      {
        type: "create_tvc_prompt_package",
        project_id: "project-1",
        source_revision: 2,
        units: [{
          ref: "unit-1",
          start_second: 0,
          end_second: 4,
          shot_numbers: ["001"],
          reference_node_ids: ["asset-1"],
          prompt: "00:00 至 00:04，午后湖畔草地。",
        }],
      },
    ],
  }));
  assert.deepEqual(parsed.operations.map((operation) => operation.type), [
    "create_tvc_brief",
    "update_tvc_brief",
    "create_tvc_asset_plan",
    "write_tvc_storyboard_draft",
    "create_tvc_prompt_package",
  ]);
  assert.equal(parsed.operations[3].rows[0].durationSeconds, 4);
  assert.throws(
    () => parseAgentModelResponse(JSON.stringify({
      message: "锁稿",
      workflow_state: "active",
      operations: [{ type: "lock_tvc_script", project_id: "project-1" }],
    })),
    /不受支持/,
  );
});

test("parses the narrow TVC asset kind aliases and reports invalid asset fields", () => {
  const parsed = parseAgentModelResponse(JSON.stringify({
    message: "已整理缺失资产。",
    workflow_state: "active",
    operations: [{
      type: "create_tvc_asset_plan",
      project_id: "project-1",
      assets: [
        {
          ref: "car-01",
          name: "红色跑车",
          kind: "product",
          description: "低趴红色中置引擎跑车的稳定外形。",
          reason: "跨镜持续出现。",
          image_prompt: "无徽标的红色意式超级跑车资产参考图。",
        },
        {
          ref: "track-01",
          name: "湿地赛道",
          asset_kind: "scene",
          description: "雨后山地赛道与金属护栏。",
          reason: "控制空间关系与光影。",
          imagePrompt: "湿地赛道空间资产参考图。",
        },
        {
          ref: "cockpit-01",
          name: "驾驶舱细节",
          assetKind: "prop",
          description: "无文字按键与方向盘材质细节。",
          reason: "控制近景道具一致性。",
          image_prompt: "无文字驾驶舱细节资产参考图。",
        },
      ],
    }],
  }));
  assert.deepEqual(
    parsed.operations[0].assets.map((asset) => asset.kind),
    ["prop", "scene", "prop"],
  );

  assert.throws(
    () => parseAgentModelResponse(JSON.stringify({
      message: "已整理缺失资产。",
      workflow_state: "active",
      operations: [{
        type: "create_tvc_asset_plan",
        project_id: "project-1",
        assets: [{
          ref: "car-01",
          name: "红色跑车",
          kind: "vehicle",
          description: "低趴红色中置引擎跑车的稳定外形。",
          reason: "跨镜持续出现。",
          image_prompt: "无徽标的红色意式超级跑车资产参考图。",
        }],
      }],
    })),
    /create_tvc_asset_plan 第 1 项资产的 kind 必须为 character、scene 或 prop/,
  );
});

test("surfaces TVC asset parse errors through the Agent provider", async () => {
  const client = createCanvasAgentClient(clientConfig, async () => response([{
    type: "create_tvc_asset_plan",
    project_id: "project-1",
    assets: [{
      ref: "car-01",
      name: "红色跑车",
      kind: "vehicle",
      description: "低趴红色中置引擎跑车的稳定外形。",
      reason: "跨镜持续出现。",
      image_prompt: "无徽标的红色意式超级跑车资产参考图。",
    }],
  }]));
  await assert.rejects(
    () => client.respond(request(tvcCanvas("script-draft"))),
    (error) => error instanceof CanvasAgentError &&
      /create_tvc_asset_plan 第 1 项资产的 kind 必须为 character、scene 或 prop/.test(error.message),
  );
});

test("routes a TVC request to only the core and current stage manuals", async () => {
  let body;
  const client = createCanvasAgentClient(clientConfig, async (_url, init) => {
    body = JSON.parse(init.body);
    return response([{ type: "create_tvc_brief", ref: "tvc-1", title: "虹桥", brief: tvcBrief }]);
  });
  const result = await client.respond(request(tvcCanvas("intake")));
  assert.equal(result.operations[0].type, "create_tvc_brief");
  const system = body.messages[0].content;
  assert.match(system, /TVC_CORE_MARKER/);
  assert.match(system, /TVC_INTAKE_MARKER/);
  assert.doesNotMatch(system, /TVC_STORYBOARD_MARKER|TVC_PROMPT_MARKER/);
  assert.doesNotMatch(system, /LEGACY_WORKFLOW_MARKER|LEGACY_ASSET_MARKER/);
});

test("loads the storyboard or prompt handbook only for its matching TVC stage", async () => {
  const scenarios = [
    {
      stage: "script-draft",
      operation: { type: "update_tvc_brief", project_id: "project-1", brief: tvcBrief },
      expected: "TVC_STORYBOARD_MARKER",
      excluded: /TVC_INTAKE_MARKER|TVC_PROMPT_MARKER/,
    },
    {
      stage: "script-locked",
      operation: {
        type: "create_tvc_prompt_package",
        project_id: "project-1",
        source_revision: 2,
        units: [{
          ref: "plan-01",
          start_second: 0,
          end_second: 4,
          shot_numbers: ["001"],
          reference_node_ids: [],
          prompt: "【00:00–00:04】当前视频片段的批准镜头。",
        }],
      },
      expected: "TVC_PROMPT_MARKER",
      excluded: /TVC_INTAKE_MARKER|TVC_STORYBOARD_MARKER/,
    },
  ];
  for (const scenario of scenarios) {
    let body;
    const client = createCanvasAgentClient(clientConfig, async (_url, init) => {
      body = JSON.parse(init.body);
      return response([scenario.operation]);
    });
    await client.respond(request(tvcCanvas(scenario.stage)));
    const system = body.messages[0].content;
    assert.match(system, new RegExp(scenario.expected));
    assert.doesNotMatch(system, scenario.excluded);
    assert.match(system, /当前 TVC 修订号：2。/);
    if (scenario.stage === "script-locked") {
      assert.match(system, /当前锁定分镜修订号：2。/);
    }
  }
});

test("sends the persisted 30-second prompt plan and only accepts its exact prompt units", async () => {
  let body;
  const matchingOperation = {
    type: "create_tvc_prompt_package",
    project_id: "project-1",
    source_revision: 2,
    units: [{
      ref: "plan-01",
      start_second: 0,
      end_second: 4,
      shot_numbers: ["001"],
      reference_node_ids: [],
      prompt: "【00:00–00:04】只生成当前视频片段内的批准镜头。",
    }],
  };
  const client = createCanvasAgentClient(clientConfig, async (_url, init) => {
    body = JSON.parse(init.body);
    return response([matchingOperation]);
  });
  await client.respond(request(tvcCanvas("script-locked")));
  const system = body.messages[0].content;
  assert.match(system, /已持久化的 30 秒提示词段计划/);
  assert.match(system, /"ref":"plan-01"/);
  assert.match(JSON.stringify(body.messages), /promptPlan/);

  const mismatchClient = createCanvasAgentClient(clientConfig, async () => response([{
    ...matchingOperation,
    units: [{
      ...matchingOperation.units[0],
      end_second: 5,
      prompt: "【00:00–00:05】不应改变计划时长。",
    }],
  }]));
  await assert.rejects(
    () => mismatchClient.respond(request(tvcCanvas("script-locked"))),
    (error) => error instanceof CanvasAgentError && /片段计划不匹配/.test(error.message),
  );

  const jCutClient = createCanvasAgentClient(clientConfig, async () => response([{
    ...matchingOperation,
    units: [{
      ...matchingOperation.units[0],
      prompt: "【00:00–00:04】J-cut 不应进入当前视频片段。",
    }],
  }]));
  await assert.rejects(
    () => jCutClient.respond(request(tvcCanvas("script-locked"))),
    (error) => error instanceof CanvasAgentError && /不得包含 J-cut 或 L-cut/.test(error.message),
  );

  assert.throws(
    () => validateTvcAgentOperations(tvcCanvas("script-locked").tvc, parseAgentModelResponse(JSON.stringify({
      message: "重复提示词包",
      workflow_state: "active",
      operations: [matchingOperation, matchingOperation],
    })).operations),
    /每次只能返回一个最终提示词包操作/,
  );
});

test("loads the exact asset-plan contract with the script-draft handbook", async () => {
  const storyboard = await readFile(
    new URL("../tvc-director/storyboard.md", import.meta.url),
    "utf8",
  );
  let body;
  const client = createCanvasAgentClient({
    ...clientConfig,
    tvcDirectorManuals: { ...clientConfig.tvcDirectorManuals, storyboard },
  }, async (_url, init) => {
    body = JSON.parse(init.body);
    return response([{
      type: "create_tvc_asset_plan",
      project_id: "project-1",
      assets: [{
        ref: "car-01",
        name: "红色跑车",
        kind: "prop",
        description: "低趴红色中置引擎跑车的稳定外形。",
        reason: "跨镜持续出现。",
        image_prompt: "无徽标的红色意式超级跑车资产参考图。",
      }],
    }]);
  });
  await client.respond(request(tvcCanvas("script-draft")));
  const system = body.messages[0].content;
  assert.match(system, /"type": "create_tvc_asset_plan"/);
  assert.match(system, /"kind": "prop"/);
  assert.match(system, /"image_prompt"/);
  assert.match(system, /"type": "update_tvc_brief"/);
  assert.match(system, /"reference_map"/);
  assert.doesNotMatch(system, /TVC_INTAKE_MARKER/);
});

test("enforces TVC phase gates before any operation reaches the canvas", async () => {
  const promptOperation = {
    type: "create_tvc_prompt_package",
    project_id: "project-1",
    source_revision: 2,
    units: [{
      ref: "plan-01",
      start_second: 0,
      end_second: 4,
      shot_numbers: ["001"],
      reference_node_ids: [],
      prompt: "【00:00–00:04】当前视频片段的批准镜头。",
    }],
  };
  const client = createCanvasAgentClient(clientConfig, async () => response([promptOperation]));
  await assert.rejects(
    () => client.respond(request(tvcCanvas("script-draft"))),
    (error) => error instanceof CanvasAgentError && /阶段不匹配/.test(error.message),
  );

  assert.throws(
    () => validateTvcAgentOperations(tvcCanvas("script-locked").tvc, parseAgentModelResponse(JSON.stringify({
      message: "草案",
      workflow_state: "active",
      operations: [{
        type: "write_tvc_storyboard_draft",
        project_id: "project-1",
        rows: [{
          shot_number: "001",
          start_second: 0,
          end_second: 4,
          duration_seconds: 4,
          reference_scene: "湖畔",
          scene_time: "午后",
          shot_size_lens: "中景 / 35mm",
          camera: "缓慢推近",
          composition: "角色居中",
          performance: "角色微笑",
          narration: "无",
          sound: "鸟鸣，无 BGM",
          transition: "起镜",
          constraints: "保持角色一致",
          reference_node_ids: [],
        }],
      }],
    })).operations),
    /阶段不匹配/,
  );

  assert.throws(
    () => validateTvcAgentOperations(tvcCanvas("script-draft").tvc, parseAgentModelResponse(JSON.stringify({
      message: "草案",
      workflow_state: "active",
      operations: [{ type: "update_tvc_brief", project_id: "other-project", brief: tvcBrief }],
    })).operations),
    /项目标识不匹配/,
  );

  assert.throws(
    () => validateTvcAgentOperations(tvcCanvas("script-locked").tvc, parseAgentModelResponse(JSON.stringify({
      message: "提示词包",
      workflow_state: "active",
      operations: [{ ...promptOperation, source_revision: 1 }],
    })).operations),
    /当前锁定分镜修订号/,
  );
});

test("requires a valid revision and lock revision in TVC snapshots", () => {
  const missingRevision = tvcCanvas("script-draft");
  delete missingRevision.tvc.revision;
  assert.throws(
    () => request(missingRevision),
    (error) => error instanceof CanvasAgentError && /项目修订号无效/.test(error.message),
  );

  const missingLockRevision = tvcCanvas("script-locked");
  delete missingLockRevision.tvc.lockedRevision;
  assert.throws(
    () => request(missingLockRevision),
    (error) => error instanceof CanvasAgentError && /锁稿修订号无效/.test(error.message),
  );

  const missingPromptPlan = tvcCanvas("script-locked");
  delete missingPromptPlan.tvc.promptPlan;
  assert.equal(request(missingPromptPlan).canvas.tvc.promptPlan, undefined);
  assert.throws(
    () => validateTvcAgentOperations(missingPromptPlan.tvc, parseAgentModelResponse(JSON.stringify({
      message: "提示词包",
      workflow_state: "active",
      operations: [{
        type: "create_tvc_prompt_package",
        project_id: "project-1",
        source_revision: 2,
        units: [{
          ref: "plan-01",
          start_second: 0,
          end_second: 4,
          shot_numbers: ["001"],
          reference_node_ids: [],
          prompt: "【00:00–00:04】当前视频片段。",
        }],
      }],
    })).operations),
    /30 秒提示词段计划缺失/,
  );
});

test("rejects TVC operations outside a TVC workflow and media generation inside one", async () => {
  const client = createCanvasAgentClient(clientConfig, async () => response([
    { type: "create_tvc_brief", ref: "tvc-1", title: "虹桥", brief: tvcBrief },
  ]));
  await assert.rejects(
    () => client.respond(request(workflowCanvas)),
    (error) => error instanceof CanvasAgentError && /只能在 TVC 项目/.test(error.message),
  );

  const mediaClient = createCanvasAgentClient(clientConfig, async () => response([{
    type: "generate_content",
    mode: "image",
    model: "gpt-image-2",
    prompt: "不应生成",
    reference_node_ids: [],
  }]));
  await assert.rejects(
    () => mediaClient.respond(request(tvcCanvas("script-draft"))),
    (error) => error instanceof CanvasAgentError && /只能返回当前阶段/.test(error.message),
  );

  assert.throws(
    () => validateAgentOperationsForSurface("creation", [
      parseAgentModelResponse(JSON.stringify({
        message: "TVC",
        workflow_state: "active",
        operations: [{ type: "create_tvc_brief", ref: "tvc-1", title: "虹桥", brief: tvcBrief }],
      })).operations[0],
    ]),
    /不能在创作画布/,
  );
});

test("documents TVC as an application capability rather than a Codex Skill", async () => {
  const [core, intake, storyboard, promptPackage] = await Promise.all([
    readFile(new URL("../tvc-director/core.md", import.meta.url), "utf8"),
    readFile(new URL("../tvc-director/intake.md", import.meta.url), "utf8"),
    readFile(new URL("../tvc-director/storyboard.md", import.meta.url), "utf8"),
    readFile(new URL("../tvc-director/prompt-package.md", import.meta.url), "utf8"),
  ]);
  assert.match(core, /不是本机 Codex Skill/);
  assert.match(core, /不得自行锁稿/);
  assert.match(intake, /不得擅自选择/);
  assert.match(storyboard, /镜号、时间码、时长/);
  assert.match(promptPackage, /不得包含 J-cut、L-cut/);
  assert.match(promptPackage, /完整 Agent JSON 对象/);
  assert.match(promptPackage, /"progress_summary"/);
  assert.match(promptPackage, /"operations"/);
  assert.match(promptPackage, /当前锁稿修订号/);
  assert.match(promptPackage, /`promptPlan` 是唯一权威的 30 秒视频段计划/);
  assert.match(promptPackage, /`【00:00–00:24】`/);
  assert.match(promptPackage, /不得在锁稿阶段返回 `update_tvc_brief` 或 `write_tvc_storyboard_draft`/);
  assert.match(core, /`workflow_state: "clarifying"` 与空 `operations`/);
});
