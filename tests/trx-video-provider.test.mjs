import assert from "node:assert/strict";
import test from "node:test";
import {
  LingkeRequestError,
  toSafeRequestErrorPayload,
} from "../app/ai/provider.ts";
import {
  createTrxVideoClient,
  TRX_TASK_PREFIX,
  TRX_VIDEO_MODEL,
} from "../app/ai/trx-video-provider.ts";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function videoRequest(referenceAssetIds = []) {
  return {
    mode: "video",
    model: "doubao-seedance-2-5-quannengcankao",
    prompt: "private prompt must not enter diagnostics",
    referenceAssetIds,
    aspectRatio: "16:9",
    duration: "12",
    resolution: "720p",
  };
}

const referenceAssetId = "11111111-1111-4111-8111-111111111111";
const secondReferenceAssetId = "22222222-2222-4222-8222-222222222222";

test("submits Seedance 2.5 through the profile-gated TRX video contract", async () => {
  const calls = [];
  const diagnostics = [];
  let resolved = false;
  const client = createTrxVideoClient(
    {
      baseUrl: "https://trx.example.test/",
      apiKey: "private-api-key",
      onDiagnostic: (event) => diagnostics.push(event),
    },
    async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith("/v1/video/profile")) {
        return jsonResponse({ models: [TRX_VIDEO_MODEL] });
      }
      if (url.endsWith("/v1/video/generate")) {
        assert.equal(resolved, true);
        return jsonResponse({ task_id: "task-42" });
      }
      return jsonResponse({ status: "completed", result_url: "https://cdn.test/video.mp4" });
    },
  );

  const generated = await client.generate(videoRequest([referenceAssetId, secondReferenceAssetId]), {
    attemptId: "attempt-42",
    resolveReferenceUrls: async (attemptId) => {
      assert.equal(attemptId, "attempt-42");
      resolved = true;
      return [
        "https://cos.test/private-reference.png?signature=hidden",
        "https://cos.test/second-reference.png?signature=hidden",
      ];
    },
  });

  assert.deepEqual(generated, { kind: "task", taskId: `${TRX_TASK_PREFIX}task-42` });
  assert.equal(calls[0].url, "https://trx.example.test/v1/video/profile");
  assert.equal(calls[0].init.method, undefined);
  assert.equal(calls[1].url, "https://trx.example.test/v1/video/generate");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    model: "seedance-2.5",
    prompt: "private prompt must not enter diagnostics",
    mode: "reference",
    duration: 12,
    aspect_ratio: "16:9",
    resolution: "720p",
    generate_audio: true,
    images: [
      "https://cos.test/private-reference.png?signature=hidden",
      "https://cos.test/second-reference.png?signature=hidden",
    ],
  });

  assert.deepEqual(await client.status(`${TRX_TASK_PREFIX}task-42`), {
    taskId: `${TRX_TASK_PREFIX}task-42`,
    state: "success",
    isFinal: true,
    progress: "",
    results: [{ url: "https://cdn.test/video.mp4", kind: "video" }],
    error: "",
  });
  assert.equal(calls[2].url, "https://trx.example.test/v1/video/tasks/task-42");

  const serialized = JSON.stringify(diagnostics);
  assert.doesNotMatch(serialized, /private prompt|private-reference|private-api-key|signature/i);
  assert.deepEqual(
    diagnostics.map((event) => [event.phase, event.classification]),
    [["profile", "profile-available"], ["submit", "accepted"], ["status", "status"]],
  );
  assert.deepEqual(diagnostics[1].responseKeys, ["task_id"]);
});

test("uses text2video without an empty images field", async () => {
  const calls = [];
  const client = createTrxVideoClient(
    { baseUrl: "https://trx.example.test", apiKey: "key" },
    async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith("/profile")) return jsonResponse({ data: { models: [TRX_VIDEO_MODEL] } });
      return jsonResponse({ task_id: "task-empty" });
    },
  );

  await client.generate(videoRequest(), { attemptId: "attempt-empty" });
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.mode, "text2video");
  assert.equal("images" in body, false);
});

test("never resolves references when the profile does not enable Seedance 2.5", async () => {
  let resolves = 0;
  let submits = 0;
  const client = createTrxVideoClient(
    { baseUrl: "https://trx.example.test", apiKey: "key" },
    async (url) => {
      if (url.endsWith("/profile")) return jsonResponse({ models: ["seedance-2.0"] });
      submits += 1;
      return jsonResponse({ task_id: "unexpected" });
    },
  );

  await assert.rejects(
    client.generate(videoRequest([referenceAssetId]), {
      attemptId: "attempt-profile",
      resolveReferenceUrls: async () => {
        resolves += 1;
        return ["https://cos.test/reference.png"];
      },
    }),
    /未开通 Seedance 2\.5/,
  );
  assert.equal(resolves, 0);
  assert.equal(submits, 0);
});

test("does not mistake another profile model for Seedance 2.5", async () => {
  let resolves = 0;
  let submits = 0;
  const client = createTrxVideoClient(
    { baseUrl: "https://trx.example.test", apiKey: "key" },
    async (url) => {
      if (url.endsWith("/profile")) {
        return jsonResponse({ models: { "other-model": true, "seedance-2.5": false } });
      }
      submits += 1;
      return jsonResponse({ task_id: "unexpected" });
    },
  );

  await assert.rejects(
    client.generate(videoRequest([referenceAssetId]), {
      attemptId: "attempt-other-model",
      resolveReferenceUrls: async () => {
        resolves += 1;
        return ["https://cos.test/reference.png"];
      },
    }),
    /未开通 Seedance 2\.5/,
  );
  assert.equal(resolves, 0);
  assert.equal(submits, 0);
});

test("requires an exact Seedance 2.5 profile entry instead of scanning model-map values", async () => {
  let resolves = 0;
  let submits = 0;
  const client = createTrxVideoClient(
    { baseUrl: "https://trx.example.test", apiKey: "key" },
    async (url) => {
      if (url.endsWith("/profile")) {
        return jsonResponse({
          models: { "other-model": { model: TRX_VIDEO_MODEL, enabled: true } },
        });
      }
      submits += 1;
      return jsonResponse({ task_id: "unexpected" });
    },
  );

  await assert.rejects(
    client.generate(videoRequest([referenceAssetId]), {
      attemptId: "attempt-exact-model",
      resolveReferenceUrls: async () => {
        resolves += 1;
        return ["https://cos.test/reference.png"];
      },
    }),
    /未开通 Seedance 2\.5/,
  );
  assert.equal(resolves, 0);
  assert.equal(submits, 0);
});

test("treats reference resolution failures as explicit failures before video submission", async () => {
  let submits = 0;
  const diagnostics = [];
  const client = createTrxVideoClient(
    {
      baseUrl: "https://trx.example.test",
      apiKey: "key",
      onDiagnostic: (event) => diagnostics.push(event),
    },
    async (url) => {
      if (url.endsWith("/profile")) return jsonResponse({ models: [TRX_VIDEO_MODEL] });
      submits += 1;
      return jsonResponse({ task_id: "unexpected" });
    },
  );

  await assert.rejects(
    client.generate(videoRequest([referenceAssetId]), {
      attemptId: "attempt-stage",
      resolveReferenceUrls: async () => {
        throw new Error("object storage unavailable");
      },
    }),
    (error) =>
      error instanceof LingkeRequestError &&
      error.code === undefined &&
      /已归档的视频参考图/.test(error.message),
  );
  assert.equal(submits, 0);
  assert.deepEqual(
    diagnostics.map((event) => [event.phase, event.classification]),
    [["profile", "profile-available"], ["reference-resolve", "reference-resolution-failed"]],
  );
});

test("classifies only ambiguous TRX submissions as submission-unknown", async () => {
  const cases = [
    { name: "missing root task id", response: jsonResponse({ data: { task_id: "nested" } }), unknown: true },
    { name: "non-json response", response: new Response("not-json", { status: 200 }), unknown: true },
    { name: "server failure", response: jsonResponse({ detail: "temporary" }, 503), unknown: true },
    { name: "business envelope", response: jsonResponse({ code: 400, message: "参数无效" }), unknown: false },
    { name: "rate limited", response: jsonResponse({ message: "slow" }, 429), unknown: false },
  ];

  for (const item of cases) {
    const client = createTrxVideoClient(
      { baseUrl: "https://trx.example.test", apiKey: "key" },
      async (url) => {
        if (url.endsWith("/profile")) return jsonResponse({ models: [TRX_VIDEO_MODEL] });
        return item.response;
      },
    );
    await assert.rejects(
      client.generate(videoRequest(), { attemptId: `attempt-${item.name}` }),
      (error) => {
        assert.ok(error instanceof LingkeRequestError);
        assert.equal(error.code === "submission-unknown", item.unknown);
        if (item.unknown) {
          assert.deepEqual(toSafeRequestErrorPayload(error), {
            error: error.message,
            code: "submission-unknown",
          });
        }
        return true;
      },
    );
  }

  const networkClient = createTrxVideoClient(
    { baseUrl: "https://trx.example.test", apiKey: "key" },
    async (url) => {
      if (url.endsWith("/profile")) return jsonResponse({ models: [TRX_VIDEO_MODEL] });
      throw new TypeError("failed to fetch");
    },
  );
  await assert.rejects(
    networkClient.generate(videoRequest(), { attemptId: "attempt-network" }),
    (error) => error instanceof LingkeRequestError && error.code === "submission-unknown",
  );
});
