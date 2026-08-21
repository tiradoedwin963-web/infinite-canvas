import assert from "node:assert/strict";
import test from "node:test";
import {
  SubmissionUnknownError,
  isSubmissionUnknownError,
  readWorkflowGenerateResponse,
} from "../app/workflow/submission-unknown.ts";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("accepts a video response only when it includes a task ID", async () => {
  assert.deepEqual(
    await readWorkflowGenerateResponse(
      jsonResponse({ kind: "task", taskId: "trx:video-1" }),
      "video",
    ),
    { kind: "task", taskId: "trx:video-1" },
  );

  await assert.rejects(
    readWorkflowGenerateResponse(jsonResponse({ kind: "task" }), "video"),
    (error) => error instanceof SubmissionUnknownError,
  );
});

test("classifies malformed video responses and fetch interruptions as unknown submissions", async () => {
  await assert.rejects(
    readWorkflowGenerateResponse(new Response("not-json"), "video"),
    (error) => error instanceof SubmissionUnknownError,
  );
  assert.equal(isSubmissionUnknownError(new TypeError("Failed to fetch")), true);
  assert.equal(isSubmissionUnknownError(new Error("视频参数无效")), false);
});

test("preserves explicit request failures while reading the server unknown code", async () => {
  await assert.rejects(
    readWorkflowGenerateResponse(
      jsonResponse({
        error: "视频平台未确认任务提交结果。",
        code: "submission-unknown",
      }, 502),
      "video",
    ),
    (error) =>
      error instanceof SubmissionUnknownError &&
      error.message === "视频平台未确认任务提交结果。",
  );
  await assert.rejects(
    readWorkflowGenerateResponse(
      jsonResponse({ error: "视频参数无效" }, 400),
      "video",
    ),
    (error) =>
      error instanceof Error &&
      !(error instanceof SubmissionUnknownError) &&
      error.message === "视频参数无效",
  );
});
