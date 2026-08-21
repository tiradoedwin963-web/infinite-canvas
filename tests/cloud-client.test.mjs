import assert from "node:assert/strict";
import test from "node:test";
import {
  CloudRequestError,
  describeCloudRequestError,
  isCloudRequestError,
  saveCloudProject,
} from "../app/workflow/cloud-client.ts";

const saveInput = {
  id: "project-1",
  name: "项目",
  graph: { version: 1, nodes: [], edges: [] },
  viewport: { x: 0, y: 0, zoom: 1 },
  batch: null,
  revision: 3,
};

async function withFetch(fetcher, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("classifies cloud save HTTP failures without exposing server error text", async () => {
  const cases = [
    [401, "session-expired", "登录状态已失效，请重新登录后再保存。"],
    [403, "source-denied", "当前来源未获允许，无法保存项目。"],
    [404, "project-missing", "项目已不存在或无权访问。"],
    [409, "revision-conflict", "项目已在其他设备更新，请重新加载或另存副本。"],
    [503, "server-unavailable", "云端暂时不可用，请稍后重试。"],
    [422, "request-rejected", "云端请求未被接受，请稍后重试。"],
  ];

  for (const [status, category, message] of cases) {
    await withFetch(
      async () => jsonResponse({ error: "internal token: do-not-display", revision: 9 }, status),
      async () => {
        await assert.rejects(saveCloudProject(saveInput), (error) => {
          assert.ok(error instanceof CloudRequestError);
          assert.equal(error.status, status);
          assert.equal(error.category, category);
          assert.equal(error.revision, 9);
          assert.equal(error.message, message);
          assert.equal(describeCloudRequestError(error), message);
          assert.doesNotMatch(error.message, /token|display/i);
          return true;
        });
      },
    );
  }
});

test("classifies a rejected cloud save connection as a safe network interruption", async () => {
  await withFetch(
    async () => {
      throw new TypeError("Failed to fetch https://canvas.example/with-secret");
    },
    async () => {
      await assert.rejects(saveCloudProject(saveInput), (error) => {
        assert.ok(isCloudRequestError(error));
        assert.equal(error.category, "network-interruption");
        assert.equal(error.status, undefined);
        assert.equal(error.message, "网络连接中断，未能保存项目。");
        assert.doesNotMatch(describeCloudRequestError(error), /secret|example/i);
        return true;
      });
    },
  );
});

test("keeps successful cloud save responses compatible", async () => {
  await withFetch(
    async () => jsonResponse({ revision: 4, updated_at: "2026-08-21T00:00:00.000Z" }),
    async () => {
      assert.deepEqual(await saveCloudProject(saveInput), {
        revision: 4,
        updated_at: "2026-08-21T00:00:00.000Z",
      });
    },
  );
});

test("uses a safe fallback for unexpected errors", () => {
  assert.equal(
    describeCloudRequestError(new Error("untrusted server error: secret")),
    "云端请求未被接受，请稍后重试。",
  );
});
