import assert from "node:assert/strict";
import test from "node:test";
import {
  createLingkeClient,
  LingkeRequestError,
  validateGenerateRequest,
} from "../app/ai/provider.ts";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("rejects unknown models and invalid reference images", () => {
  assert.throws(
    () => validateGenerateRequest({ mode: "text", model: "unknown", prompt: "x" }),
    LingkeRequestError,
  );
  assert.throws(
    () =>
      validateGenerateRequest({
        mode: "video",
        model: "doubao-seedance-1-5-pro-251215",
        prompt: "x",
        aspectRatio: "16:9",
        duration: "5",
        resolution: "720p",
        images: [
          { name: "a.png", mimeType: "image/png", dataUrl: "bad", size: 20 },
        ],
      }),
    /数据格式无效/,
  );
  const image = {
    name: "a.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,YQ==",
    size: 1,
  };
  assert.throws(
    () =>
      validateGenerateRequest({
        mode: "image",
        model: "qwen-image",
        prompt: "x",
        aspectRatio: "1:1",
        resolution: "1K",
      }),
    /当前模式不支持所选模型/,
  );
  assert.throws(
    () =>
      validateGenerateRequest({
        mode: "image",
        model: "gemini-3-pro-image-preview",
        prompt: "x",
        aspectRatio: "1:1",
        resolution: "1K",
        images: [image, image, image, image, image, image],
      }),
    /最多支持 5 张/,
  );
  assert.throws(
    () =>
      validateGenerateRequest({
        mode: "text",
        model: "gpt-5.6-sol",
        prompt: "x",
        images: [image, image, image, image, image, image],
      }),
    /最多支持 5 张/,
  );
});

test("requires a supported resolution for every media request", () => {
  assert.throws(
    () =>
      validateGenerateRequest({
        mode: "image",
        model: "gemini-3-pro-image-preview",
        prompt: "cat",
        aspectRatio: "1:1",
      }),
    /请选择当前模型支持的分辨率/,
  );
  assert.throws(
    () =>
      validateGenerateRequest({
        mode: "video",
        model: "viduq3",
        prompt: "cat",
        aspectRatio: "16:9",
        duration: "5",
        resolution: "4K",
      }),
    /请选择当前模型支持的分辨率/,
  );
  assert.equal(
    validateGenerateRequest({
      mode: "text",
      model: "gpt-5.6-sol",
      prompt: "cat",
      resolution: "4K",
    }).resolution,
    undefined,
  );
});

test("adapts OpenAI, Anthropic, and Gemini text protocols", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith("/v1/messages")) {
      return jsonResponse({ content: [{ type: "text", text: "Claude reply" }] });
    }
    if (url.includes(":generateContent")) {
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: "Gemini reply" }] } }],
      });
    }
    return jsonResponse({ choices: [{ message: { content: "OpenAI reply" } }] });
  };
  const client = createLingkeClient(
    { baseUrl: "https://example.test", apiKey: "secret" },
    fetcher,
  );

  assert.deepEqual(
    await client.generate({ mode: "text", model: "gpt-5.6-sol", prompt: "Hi" }),
    { kind: "text", content: "OpenAI reply" },
  );
  assert.deepEqual(
    await client.generate({ mode: "text", model: "claude-sonnet-5", prompt: "Hi" }),
    { kind: "text", content: "Claude reply" },
  );
  assert.deepEqual(
    await client.generate({
      mode: "text",
      model: "gemini-3.1-pro-preview",
      prompt: "Hi",
    }),
    { kind: "text", content: "Gemini reply" },
  );
  assert.match(calls[0].url, /\/v1\/chat\/completions$/);
  assert.match(calls[1].url, /\/v1\/messages$/);
  assert.match(calls[2].url, /gemini-3\.1-pro-preview:generateContent$/);
  assert.deepEqual(calls[0].body.messages, [{ role: "user", content: "Hi" }]);
  assert.deepEqual(calls[1].body.messages, [{ role: "user", content: "Hi" }]);
  assert.deepEqual(calls[2].body.contents, [
    { role: "user", parts: [{ text: "Hi" }] },
  ]);
});

test("adapts image attachments for all text protocols", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith("/v1/messages")) {
      return jsonResponse({ content: [{ type: "text", text: "Claude reply" }] });
    }
    if (url.includes(":generateContent")) {
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: "Gemini reply" }] } }],
      });
    }
    return jsonResponse({ choices: [{ message: { content: "OpenAI reply" } }] });
  };
  const client = createLingkeClient(
    { baseUrl: "https://example.test", apiKey: "secret" },
    fetcher,
  );
  const image = {
    name: "red.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,cmVk",
    size: 3,
  };

  await client.generate({
    mode: "text",
    model: "gpt-5.6-sol",
    prompt: "Describe",
    images: [image],
  });
  await client.generate({
    mode: "text",
    model: "claude-sonnet-5",
    prompt: "Describe",
    images: [image],
  });
  await client.generate({
    mode: "text",
    model: "gemini-3.1-pro-preview",
    prompt: "Describe",
    images: [image],
  });

  assert.deepEqual(calls[0].body.messages[0].content, [
    { type: "text", text: "Describe" },
    { type: "image_url", image_url: { url: image.dataUrl } },
  ]);
  assert.deepEqual(calls[1].body.messages[0].content, [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "cmVk",
      },
    },
    { type: "text", text: "Describe" },
  ]);
  assert.deepEqual(calls[2].body.contents[0].parts, [
    {
      inline_data: {
        mime_type: "image/png",
        data: "cmVk",
      },
    },
    { text: "Describe" },
  ]);
});

test("creates media tasks and normalizes completed results", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/status")) {
      return jsonResponse({
        task_id: 42,
        state: "success",
        is_final: true,
        progress: "100%",
        result_urls: ["https://cdn.test/a.png", "https://cdn.test/b.png"],
      });
    }
    return jsonResponse({ task_id: 42 });
  };
  const client = createLingkeClient(
    { baseUrl: "https://example.test/", apiKey: "secret" },
    fetcher,
  );

  assert.deepEqual(
    await client.generate({
      mode: "image",
      model: "gpt-image-2",
      prompt: "cat",
      images: [],
      aspectRatio: "16:9",
      resolution: "1K",
    }),
    { kind: "task", taskId: "42" },
  );
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.params.size, "1920x1088");
  assert.equal(body.params.quality, "auto");

  const status = await client.status("42", "image");
  assert.equal(status.state, "success");
  assert.deepEqual(status.results, [
    { url: "https://cdn.test/a.png", kind: "image" },
    { url: "https://cdn.test/b.png", kind: "image" },
  ]);
});

test("maps each image model to its provider parameter contract", async () => {
  const calls = [];
  const client = createLingkeClient(
    { baseUrl: "https://example.test", apiKey: "secret" },
    async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return jsonResponse({ data: { task_id: calls.length } });
    },
  );
  const reference = {
    name: "a.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,YQ==",
    size: 1,
  };
  const models = [
    { model: "gemini-3-pro-image-preview", resolution: "2K" },
    { model: "gpt-image-2", resolution: "2K" },
    { model: "gemini-3.1-flash-image-preview", resolution: "4K" },
    { model: "doubao-seedream-5-0-pro-260628", resolution: "2K" },
  ];

  for (const { model, resolution } of models) {
    await client.generate({
      mode: "image",
      model,
      prompt: "cat",
      images: [reference],
      aspectRatio: "16:9",
      resolution,
    });
  }

  assert.deepEqual(calls.map((call) => call.params), [
    {
      aspectRatio: "16:9",
      imageSize: "2K",
      images: [reference.dataUrl],
    },
    {
      size: "2560x1440",
      quality: "auto",
      images: [reference.dataUrl],
    },
    {
      aspectRatio: "16:9",
      imageSize: "4K",
      images: [reference.dataUrl],
    },
    {
      aspect_ratio: "16:9",
      size: "2K",
      images: [reference.dataUrl],
    },
  ]);
});

test("maps every GPT Image 2 ratio and resolution pair to pixels", async () => {
  const sizes = {
    "1K": {
      "1:1": "1024x1024",
      "4:3": "1280x960",
      "3:4": "960x1280",
      "16:9": "1920x1088",
      "9:16": "1088x1920",
    },
    "2K": {
      "1:1": "2048x2048",
      "4:3": "2560x1920",
      "3:4": "1920x2560",
      "16:9": "2560x1440",
      "9:16": "1440x2560",
    },
    "4K": {
      "1:1": "2880x2880",
      "4:3": "3200x2400",
      "3:4": "2400x3200",
      "16:9": "3840x2160",
      "9:16": "2160x3840",
    },
  };
  const calls = [];
  const client = createLingkeClient(
    { baseUrl: "https://example.test", apiKey: "secret" },
    async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return jsonResponse({ task_id: calls.length });
    },
  );

  for (const [resolution, ratios] of Object.entries(sizes)) {
    for (const aspectRatio of Object.keys(ratios)) {
      await client.generate({
        mode: "image",
        model: "gpt-image-2",
        prompt: "cat",
        aspectRatio,
        resolution,
      });
    }
  }

  assert.deepEqual(
    calls.map((call) => call.params.size),
    Object.values(sizes).flatMap((ratios) => Object.values(ratios)),
  );
});

test("maps selectable video resolutions to the provider contract", async () => {
  const calls = [];
  const client = createLingkeClient(
    { baseUrl: "https://example.test", apiKey: "secret" },
    async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return jsonResponse({ task_id: calls.length });
    },
  );

  await client.generate({
    mode: "video",
    model: "doubao-seedance-1-5-pro-251215",
    prompt: "cat",
    aspectRatio: "16:9",
    duration: "5",
    resolution: "1080p",
  });
  await client.generate({
    mode: "video",
    model: "viduq3",
    prompt: "cat",
    aspectRatio: "9:16",
    duration: "10",
    resolution: "540p",
  });

  assert.deepEqual(calls.map((call) => call.params), [
    { aspect_ratio: "16:9", duration: "5", resolution: "1080p" },
    { aspect_ratio: "9:16", duration: "10", resolution: "540p" },
  ]);
});

test("normalizes nested media task states and task result images", async () => {
  const client = createLingkeClient(
    { baseUrl: "https://example.test", apiKey: "secret" },
    async () =>
      jsonResponse({
        data: {
          task_status: "succeed",
          progress: 100,
          task_result: {
            images: [
              { index: 0, url: "https://cdn.test/a.png" },
              { index: 1, url: "https://cdn.test/b.png" },
            ],
          },
        },
      }),
  );

  assert.deepEqual(await client.status("42", "image"), {
    taskId: "42",
    state: "success",
    isFinal: true,
    progress: "100%",
    results: [
      { url: "https://cdn.test/a.png", kind: "image" },
      { url: "https://cdn.test/b.png", kind: "image" },
    ],
    error: "",
  });
});

test("sanitizes balance and authentication failures", async () => {
  const balanceClient = createLingkeClient(
    { baseUrl: "https://example.test", apiKey: "secret" },
    async () => jsonResponse({ message: "余额不足" }, 400),
  );
  await assert.rejects(
    balanceClient.generate({ mode: "text", model: "gpt-5.6-sol", prompt: "Hi" }),
    /余额不足/,
  );

  const authClient = createLingkeClient(
    { baseUrl: "https://example.test", apiKey: "secret" },
    async () => jsonResponse({ detail: "no" }, 401),
  );
  await assert.rejects(
    authClient.generate({ mode: "text", model: "gpt-5.6-sol", prompt: "Hi" }),
    /鉴权失败/,
  );

  const validationClient = createLingkeClient(
    { baseUrl: "https://example.test", apiKey: "secret" },
    async () =>
      jsonResponse(
        { code: 400, data: { "详情": "缺少必要参数 imageSize" }, msg: "请求参数有误" },
        400,
      ),
  );
  await assert.rejects(
    validationClient.generate({
      mode: "image",
      model: "gemini-3-pro-image-preview",
      prompt: "cat",
      aspectRatio: "1:1",
      resolution: "1K",
    }),
    /缺少必要参数 imageSize/,
  );

  const secretClient = createLingkeClient(
    { baseUrl: "https://example.test", apiKey: "secret" },
    async () => jsonResponse({ message: "Bearer sk-sensitive-value" }, 400),
  );
  await assert.rejects(
    secretClient.generate({ mode: "text", model: "gpt-5.6-sol", prompt: "Hi" }),
    /模型服务暂时不可用/,
  );
});
