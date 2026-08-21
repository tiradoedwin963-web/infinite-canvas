import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAgentSseEvent,
  extractProgressSummary,
  readAgentSseResponse,
  splitSseEvents,
} from "../app/ai/agent-stream.ts";

function byteStream(text) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
}

test("splits SSE blocks and preserves incomplete data", () => {
  const parsed = splitSseEvents(
    "event: progress\r\ndata: {\"text\":\"第一步\"}\r\n\r\nevent: result\ndata: {\"message\":\"完",
  );
  assert.deepEqual(parsed.events, [
    { event: "progress", data: '{"text":"第一步"}' },
  ]);
  assert.match(parsed.remainder, /event: result/);
});

test("extracts only the partial progress summary from streamed JSON", () => {
  assert.equal(
    extractProgressSummary('{"progress_summary":"已读取22场；识别10名独立人物'),
    "已读取22场；识别10名独立人物",
  );
  assert.equal(
    extractProgressSummary(
      '{"progress_summary":"排除\\"匿名人物\\"；处理\\u4e2d","operations":[{"type":"delete_node"}]}',
    ),
    '排除"匿名人物"；处理中',
  );
  assert.equal(
    extractProgressSummary('{"operations":[{"node_id":"secret"}]}'),
    "",
  );
});

test("reads byte-split agent SSE without exposing result before completion", async () => {
  const progress = [];
  let activityCount = 0;
  const result = {
    progressSummary: "已读取完整剧本。",
    message: "已完成分析。",
    workflowState: "active",
    inspectImageNodeIds: [],
    operations: [],
  };
  const body = [
    encodeAgentSseEvent("activity", {}),
    encodeAgentSseEvent("progress", { text: "已读取" }),
    encodeAgentSseEvent("progress", { text: "已读取完整剧本。" }),
    encodeAgentSseEvent("result", result),
  ].join("");
  const response = new Response(byteStream(body), {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
  const parsed = await readAgentSseResponse(
    response,
    (text) => progress.push(text),
    () => { activityCount += 1; },
  );
  assert.deepEqual(progress, ["已读取", "已读取完整剧本。"]);
  assert.equal(activityCount, 4);
  assert.deepEqual(parsed, result);
});

test("reports sanitized SSE errors and incomplete streams", async () => {
  const failed = new Response(
    byteStream(encodeAgentSseEvent("error", { message: "请求超时。" })),
    { headers: { "content-type": "text/event-stream" } },
  );
  await assert.rejects(
    readAgentSseResponse(failed, () => {}),
    /请求超时/,
  );

  const incomplete = new Response(
    byteStream(encodeAgentSseEvent("progress", { text: "处理中" })),
    { headers: { "content-type": "text/event-stream" } },
  );
  await assert.rejects(
    readAgentSseResponse(incomplete, () => {}),
    /流式响应已中断/,
  );
});
