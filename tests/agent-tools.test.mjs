import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeAgentImageOperation,
  normalizeAgentStoryAnalysisOperation,
  normalizeAgentStoryAssetBatchOperation,
  normalizeAgentStoryWorkflowOperation,
} from "../app/ai/agent-tools.ts";
import { MODEL_CONFIGS } from "../app/ai/models.ts";

function imageOperation(overrides = {}) {
  return {
    type: "generate_content",
    mode: "image",
    model: "gemini-3-pro-image-preview",
    prompt: "portrait",
    referenceNodeIds: [],
    ...overrides,
  };
}

test("keeps legal image parameters and fills missing defaults", () => {
  const legal = normalizeAgentImageOperation(
    imageOperation({ aspectRatio: "16:9", resolution: "4K" }),
  );
  assert.equal(legal.aspectRatio, "16:9");
  assert.equal(legal.resolution, "4K");
  assert.equal(legal.adjustments, undefined);

  const defaults = normalizeAgentImageOperation(imageOperation());
  assert.equal(defaults.aspectRatio, "16:9");
  assert.equal(defaults.resolution, "1K");
  assert.equal(defaults.adjustments, undefined);
});

test("maps unsupported ratios to the closest value in the same direction", () => {
  const portrait = normalizeAgentImageOperation(
    imageOperation({ aspectRatio: "2:3", resolution: "1K" }),
  );
  assert.equal(portrait.aspectRatio, "3:4");
  assert.deepEqual(portrait.adjustments, ["画面比例由 2:3 调整为 3:4。"]);

  const landscape = normalizeAgentImageOperation(
    imageOperation({ aspectRatio: "3:2", resolution: "1K" }),
  );
  assert.equal(landscape.aspectRatio, "4:3");
});

test("uses the nearest lower resolution on a tie and defaults invalid values", () => {
  const tied = normalizeAgentImageOperation(
    imageOperation({ aspectRatio: "1:1", resolution: "3K" }),
  );
  assert.equal(tied.resolution, "2K");
  assert.deepEqual(tied.adjustments, ["分辨率由 3K 调整为 2K。"]);

  const invalid = normalizeAgentImageOperation(
    imageOperation({ aspectRatio: "portrait", resolution: "large" }),
  );
  assert.equal(invalid.aspectRatio, "16:9");
  assert.equal(invalid.resolution, "1K");
  assert.equal(invalid.adjustments.length, 2);
});

test("rejects unknown image models instead of silently changing models", () => {
  assert.throws(
    () => normalizeAgentImageOperation(imageOperation({ model: "unknown-image" })),
    /未知的图片模型/,
  );
});

test("normalizes short-drama defaults and unsupported generation parameters", () => {
  const normalized = normalizeAgentStoryWorkflowOperation({
    type: "create_story_workflow",
    ref: "story-1",
    title: "夜班电梯",
    globalContext: "统一角色和场景",
    imageModel: "",
    videoModel: "",
    aspectRatio: "2:3",
    imageResolution: "3K",
    videoResolution: "900p",
    chunkIndex: 0,
    isFinal: true,
    shots: [{
      ref: "shot-01",
      title: "停电",
      script: "灯灭了。",
      imagePrompt: "电梯内静态关键帧",
      videoPrompt: "灯光熄灭，缓慢推镜",
      duration: "7",
      referenceNodeIds: [],
    }],
  });
  assert.equal(normalized.imageModel, "gemini-3-pro-image-preview");
  assert.equal(normalized.videoModel, "seedance-2.0");
  assert.equal(normalized.aspectRatio, "3:4");
  assert.equal(normalized.imageResolution, "2K");
  assert.equal(normalized.videoResolution, "720p");
  assert.equal(normalized.shots[0].duration, "7");
  assert.equal(normalized.adjustments.length, 3);

  const defaults = normalizeAgentStoryWorkflowOperation({
    ...storyOperationWithoutRatio(),
  });
  assert.equal(defaults.aspectRatio, "16:9");
});

function storyOperationWithoutRatio() {
  return {
    type: "create_story_workflow",
    ref: "story-default",
    title: "默认比例",
    globalContext: "统一角色和场景",
    imageModel: "gemini-3-pro-image-preview",
    videoModel: "seedance-2.0",
    imageResolution: "1K",
    videoResolution: "720p",
    chunkIndex: 0,
    isFinal: true,
    shots: [{
      ref: "shot-01",
      title: "开场",
      script: "角色入场。",
      imagePrompt: "角色入场静态关键帧",
      videoPrompt: "角色走入画面",
      duration: "5",
      referenceNodeIds: [],
    }],
  };
}

test("normalizes story analysis and asset image defaults", () => {
  const analysis = normalizeAgentStoryAnalysisOperation({
    type: "create_story_analysis",
    ref: "story",
    title: "测试",
    analysis: {
      genre: "都市",
      theme: "成长",
      audience: "青年",
      emotion: "振奋",
      estimatedDuration: "60 秒",
    },
    projectAspectRatio: "2:3",
    imageModel: "",
  });
  assert.equal(analysis.imageModel, "gpt-image-2");
  assert.equal(analysis.projectAspectRatio, "3:4");

  const analysisDefaults = normalizeAgentStoryAnalysisOperation({
    ...analysis,
    projectAspectRatio: "",
  });
  assert.equal(analysisDefaults.projectAspectRatio, "16:9");

  const batch = normalizeAgentStoryAssetBatchOperation({
    type: "create_story_asset_batch",
    storyId: "story-id",
    assetKind: "prop",
    chunkIndex: 0,
    isFinal: true,
    assets: [{
      ref: "prop-01",
      name: "雨伞",
      description: "红色长柄伞",
      reason: "多次出现",
      occurrences: ["第一场"],
      imagePrompt: "干净背景上的红伞",
      aspectRatio: "",
      resolution: "3K",
    }],
  });
  assert.equal(batch.assets[0].aspectRatio, "16:9");
  assert.equal(batch.assets[0].resolution, "1K");

  const defaults = normalizeAgentStoryAssetBatchOperation({
    ...batch,
    assets: [{ ...batch.assets[0], aspectRatio: "", resolution: "" }],
  });
  assert.equal(defaults.assets[0].aspectRatio, "16:9");
  assert.equal(defaults.assets[0].resolution, "1K");

  const legacyModel = normalizeAgentStoryAnalysisOperation({
    ...analysis,
    imageModel: "gemini-3-pro-image-preview",
  });
  assert.equal(legacyModel.imageModel, "gpt-image-2");
  assert.match(legacyModel.adjustments.join(" "), /gemini-3-pro-image-preview.*gpt-image-2/);
});

test("keeps the tool manual aligned with every configured image model", async () => {
  const manual = await readFile(new URL("../tools.md", import.meta.url), "utf8");
  for (const model of MODEL_CONFIGS.image) {
    assert.match(manual, new RegExp(model.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(manual, new RegExp(model.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const resolution of model.resolutions) {
      assert.match(manual, new RegExp(`\\b${resolution.replace(".", "\\.")}\\b`));
    }
  }
  for (const ratio of MODEL_CONFIGS.image[0].aspectRatios) {
    assert.match(manual, new RegExp(ratio.replace(":", "\\:")));
  }
  assert.match(manual, /最多使用 5 张参考图/);
});

test("keeps the workflow manual aligned with the default image and video models", async () => {
  const manual = await readFile(new URL("../workflow-tools.md", import.meta.url), "utf8");
  assert.match(manual, /create_story_workflow/);
  assert.match(manual, /run_story_workflow/);
  assert.match(manual, /gemini-3-pro-image-preview/);
  assert.match(manual, /seedance-2\.0/);
  assert.match(manual, /每批最多 8 个分镜/);
  assert.match(manual, /同一响应/);
});

test("documents the complete asset planning rules", async () => {
  const manual = await readFile(new URL("../story-asset-tools.md", import.meta.url), "utf8");
  assert.match(manual, /create_story_analysis/);
  assert.match(manual, /create_story_asset_batch/);
  assert.match(manual, /run_story_assets/);
  assert.match(manual, /正面全身.*左侧面全身.*右侧面全身/s);
  assert.match(manual, /同一地点跨场次只建立一个空间母版/);
  assert.match(manual, /45° 鸟瞰/);
  assert.match(manual, /不得只输出单一平面图/);
  assert.match(manual, /gpt-image-2/);
  assert.match(manual, /品牌商品.*汽车/);
  assert.match(manual, /16:9 \/ 1K/);
});
