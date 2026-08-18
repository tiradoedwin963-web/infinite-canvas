import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_MODELS,
  DEFAULT_MODEL_BY_MODE,
  getModelConfig,
  MODEL_CONFIGS,
} from "../app/ai/models.ts";

test("configures only models with selectable resolutions for media modes", () => {
  assert.equal(MODEL_CONFIGS.text.length, 5);
  assert.equal(MODEL_CONFIGS.image.length, 4);
  assert.equal(MODEL_CONFIGS.video.length, 3);
  assert.equal(ALL_MODELS.length, 12);
  assert.equal(new Set(ALL_MODELS.map((model) => model.value)).size, 12);
  assert.ok(
    [...MODEL_CONFIGS.image, ...MODEL_CONFIGS.video].every(
      (model) => model.resolutions.length >= 2,
    ),
  );
});

test("uses the requested default model for every mode", () => {
  assert.deepEqual(DEFAULT_MODEL_BY_MODE, {
    text: "gpt-5.6-sol",
    image: "gemini-3-pro-image-preview",
    video: "seedance-2.0",
  });
});

test("uses 16:9 as the preferred ratio for every image model", () => {
  assert.ok(
    MODEL_CONFIGS.image.every((model) => model.aspectRatios[0] === "16:9"),
  );
});

test("keeps media capabilities scoped to the selected model", () => {
  assert.ok(
    MODEL_CONFIGS.text.every((model) => model.maxReferenceImages === 5),
  );
  assert.equal(getModelConfig("image", "gpt-image-2")?.maxReferenceImages, 5);
  assert.deepEqual(getModelConfig("image", "gemini-3-pro-image-preview")?.imageRequest, {
    aspectRatioParam: "aspectRatio",
    aspectRatioFormat: "ratio",
    resolutionParam: "imageSize",
  });
  assert.deepEqual(
    getModelConfig("image", "gemini-3.1-flash-image-preview")?.resolutions,
    ["0.5K", "1K", "2K", "4K"],
  );
  assert.deepEqual(
    getModelConfig("video", "seedance-2.0")?.resolutions,
    ["480p", "720p", "1080p", "4k"],
  );
  assert.equal(
    getModelConfig("video", "seedance-2.0-fast")?.maxReferenceImages,
    9,
  );
  assert.equal(getModelConfig("video", "seedance-2.5")?.maxReferenceImages, 30);
  assert.equal(getModelConfig("image", "qwen-image"), undefined);
  assert.equal(getModelConfig("video", "sora-2"), undefined);
  assert.equal(getModelConfig("video", "grok-video-3"), undefined);
  assert.equal(getModelConfig("video", "veo3.1"), undefined);
  assert.equal(getModelConfig("text", "sora-2"), undefined);
});
