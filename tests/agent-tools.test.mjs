import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeAgentImageOperation } from "../app/ai/agent-tools.ts";
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
  assert.equal(defaults.aspectRatio, "1:1");
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
  assert.equal(invalid.aspectRatio, "1:1");
  assert.equal(invalid.resolution, "1K");
  assert.equal(invalid.adjustments.length, 2);
});

test("rejects unknown image models instead of silently changing models", () => {
  assert.throws(
    () => normalizeAgentImageOperation(imageOperation({ model: "unknown-image" })),
    /未知的图片模型/,
  );
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
