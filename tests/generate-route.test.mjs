import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  LingkeRequestError,
  toSafeRequestErrorPayload,
} from "../app/ai/provider.ts";

test("generate API returns a safe code only for coded request errors", async () => {
  const route = await readFile(
    new URL("../app/api/ai/generate/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /toSafeRequestErrorPayload\(known\)/);

  const unknown = new LingkeRequestError(
    "任务提交状态未知。",
    502,
    "submission-unknown",
  );
  assert.deepEqual(toSafeRequestErrorPayload(unknown), {
    error: "任务提交状态未知。",
    code: "submission-unknown",
  });
  assert.deepEqual(
    toSafeRequestErrorPayload(new LingkeRequestError("参数无效。", 400)),
    { error: "参数无效。" },
  );
});
