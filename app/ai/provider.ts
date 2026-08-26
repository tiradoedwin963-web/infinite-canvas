import {
  getModelConfig,
  isComposerMode,
  TRX_SEEDANCE_25_MODEL,
} from "./models.ts";
import type {
  GenerateReferenceImage,
  GenerateRequest,
  GenerateResponse,
  TaskStatusResponse,
} from "./types";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_SD_25_PROMPT_CODE_POINTS = 5_000;

type Fetcher = typeof fetch;

export type LingkeClientConfig = {
  baseUrl: string;
  apiKey: string;
};

export type LingkeRequestErrorCode = "submission-unknown";

export class LingkeRequestError extends Error {
  readonly status: number;
  readonly code?: LingkeRequestErrorCode;

  constructor(
    message: string,
    status = 502,
    code?: LingkeRequestErrorCode,
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function toSafeRequestErrorPayload(error: LingkeRequestError) {
  return error.code
    ? { error: error.message, code: error.code }
    : { error: error.message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractProviderMessage(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const error = isRecord(payload.error) ? payload.error : undefined;
  const data = isRecord(payload.data) ? payload.data : undefined;
  const candidate =
    readString(data?.["详情"]) ||
    readString(error?.message) ||
    readString(payload.message) ||
    readString(payload.msg);
  const trimmed = candidate.trim().slice(0, 180);
  if (
    /sk-[a-z0-9]{12,}|bearer\s|api[_ -]?key|data:image|https?:\/\//i.test(trimmed)
  ) {
    return "";
  }
  return trimmed;
}

function sanitizeProviderError(status: number, payload: unknown): LingkeRequestError {
  const serialized = JSON.stringify(payload ?? "").toLowerCase();

  if (status === 401 || status === 403) {
    return new LingkeRequestError("LingkeAI 鉴权失败，请检查服务端密钥。", 502);
  }
  if (status === 402 || serialized.includes("余额") || serialized.includes("balance")) {
    return new LingkeRequestError("LingkeAI 账户余额不足。", 402);
  }
  if (status === 429) {
    return new LingkeRequestError("请求过于频繁，请稍后重试。", 429);
  }
  if (status === 400 || status === 404) {
    const message = extractProviderMessage(payload);
    if (message) return new LingkeRequestError(message, status);
  }
  return new LingkeRequestError("模型服务暂时不可用，请稍后重试。", 502);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new LingkeRequestError("模型服务返回了无法识别的响应。", 502);
  }
}

function validateImages(
  images: GenerateReferenceImage[],
  maxReferenceImages: number,
): GenerateReferenceImage[] {
  if (images.length > maxReferenceImages) {
    throw new LingkeRequestError(
      `当前模型最多支持 ${maxReferenceImages} 张参考图。`,
      400,
    );
  }

  let totalBytes = 0;
  for (const image of images) {
    if (!image.mimeType.startsWith("image/")) {
      throw new LingkeRequestError("仅支持图片类型的参考文件。", 400);
    }
    if (!image.dataUrl.startsWith(`data:${image.mimeType};base64,`)) {
      throw new LingkeRequestError("参考图数据格式无效。", 400);
    }
    const encoded = image.dataUrl.slice(image.dataUrl.indexOf(",") + 1);
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const decodedBytes = Math.floor((encoded.length * 3) / 4) - padding;
    if (
      !Number.isFinite(image.size) ||
      image.size <= 0 ||
      decodedBytes <= 0 ||
      decodedBytes > MAX_IMAGE_BYTES
    ) {
      throw new LingkeRequestError("单张参考图不能超过 10MB。", 400);
    }
    totalBytes += decodedBytes;
  }

  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
    throw new LingkeRequestError("参考图总大小不能超过 30MB。", 400);
  }
  return images;
}

export function validateGenerateRequest(value: unknown): GenerateRequest {
  if (!isRecord(value) || !isComposerMode(value.mode)) {
    throw new LingkeRequestError("生成模式无效。", 400);
  }

  const prompt = readString(value.prompt).trim();
  const model = readString(value.model);
  const config = getModelConfig(value.mode, model);
  if (!config) {
    throw new LingkeRequestError("当前模式不支持所选模型。", 400);
  }
  if (!prompt) {
    throw new LingkeRequestError("请输入生成内容。", 400);
  }
  if (
    value.mode === "video" &&
    model === TRX_SEEDANCE_25_MODEL &&
    Array.from(prompt).length > MAX_SD_25_PROMPT_CODE_POINTS
  ) {
    throw new LingkeRequestError("SD 2.5 视频提示词最多支持 5000 个 Unicode 码点。", 400);
  }

  const rawImages = Array.isArray(value.images) ? value.images : [];
  const images = rawImages.map((image) => {
    if (!isRecord(image)) {
      throw new LingkeRequestError("参考图数据无效。", 400);
    }
    return {
      name: readString(image.name),
      mimeType: readString(image.mimeType),
      dataUrl: readString(image.dataUrl),
      size: Number(image.size),
    };
  });
  validateImages(images, config.maxReferenceImages);

  if (value.referenceAssetIds !== undefined && !Array.isArray(value.referenceAssetIds)) {
    throw new LingkeRequestError("参考素材编号无效。", 400);
  }
  const referenceAssetIds = (value.referenceAssetIds ?? []).map((assetId) => {
    const id = readString(assetId).trim();
    if (!id) throw new LingkeRequestError("参考素材编号无效。", 400);
    return id;
  });
  const projectId = value.projectId === undefined
    ? ""
    : readString(value.projectId).trim();
  if (value.projectId !== undefined && !projectId) {
    throw new LingkeRequestError("云端项目编号无效。", 400);
  }

  const aspectRatio = readString(value.aspectRatio);
  if (
    config.aspectRatios.length > 0 &&
    !config.aspectRatios.includes(aspectRatio)
  ) {
    throw new LingkeRequestError("所选画面比例不受当前模型支持。", 400);
  }

  const duration = readString(value.duration);
  if (config.durations.length > 0 && !config.durations.includes(duration)) {
    throw new LingkeRequestError("所选视频时长不受当前模型支持。", 400);
  }

  const resolution = readString(value.resolution);
  if (
    config.resolutions.length > 0 &&
    !config.resolutions.includes(resolution)
  ) {
    throw new LingkeRequestError("请选择当前模型支持的分辨率。", 400);
  }

  return {
    mode: value.mode,
    model,
    prompt,
    images,
    projectId: projectId || undefined,
    referenceAssetIds,
    aspectRatio: aspectRatio || undefined,
    duration: duration || undefined,
    resolution: config.resolutions.length > 0 ? resolution : undefined,
  };
}

function normalizeText(protocol: string, payload: unknown): string {
  if (!isRecord(payload)) return "";

  if (protocol === "anthropic") {
    const content = Array.isArray(payload.content) ? payload.content : [];
    return content
      .filter(isRecord)
      .map((item) => readString(item.text))
      .filter(Boolean)
      .join("\n");
  }

  if (protocol === "gemini") {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const first = candidates.find(isRecord);
    const content = first && isRecord(first.content) ? first.content : undefined;
    const parts = content && Array.isArray(content.parts) ? content.parts : [];
    return parts
      .filter(isRecord)
      .map((part) => readString(part.text))
      .filter(Boolean)
      .join("\n");
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices.find(isRecord);
  const message = first && isRecord(first.message) ? first.message : undefined;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(isRecord)
      .map((item) => readString(item.text))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function base64Data(image: GenerateReferenceImage): string {
  return image.dataUrl.slice(image.dataUrl.indexOf(",") + 1);
}

function createTextMessages(request: GenerateRequest, protocol: string) {
  const images = request.images ?? [];
  if (images.length === 0) {
    if (protocol === "gemini") {
      return [{ role: "user", parts: [{ text: request.prompt }] }];
    }
    return [{ role: "user", content: request.prompt }];
  }

  if (protocol === "anthropic") {
    return [
      {
        role: "user",
        content: [
          ...images.map((image) => ({
            type: "image",
            source: {
              type: "base64",
              media_type: image.mimeType,
              data: base64Data(image),
            },
          })),
          { type: "text", text: request.prompt },
        ],
      },
    ];
  }

  if (protocol === "gemini") {
    return [
      {
        role: "user",
        parts: [
          ...images.map((image) => ({
            inline_data: {
              mime_type: image.mimeType,
              data: base64Data(image),
            },
          })),
          { text: request.prompt },
        ],
      },
    ];
  }

  return [
    {
      role: "user",
      content: [
        { type: "text", text: request.prompt },
        ...images.map((image) => ({
          type: "image_url",
          image_url: { url: image.dataUrl },
        })),
      ],
    },
  ];
}

function imageSizeForRatio(aspectRatio: string, resolution: string): string {
  const sizes: Record<string, Record<string, string>> = {
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
  return sizes[resolution]?.[aspectRatio] ?? "1024x1024";
}

function createMediaParams(request: GenerateRequest): Record<string, unknown> {
  const config = getModelConfig(request.mode, request.model)!;
  const images = (request.images ?? []).map((image) => image.dataUrl);

  if (request.mode === "image") {
    const mapping = config.imageRequest!;
    const aspectRatio = request.aspectRatio ?? "1:1";
    const resolution = request.resolution ?? config.defaultResolution ?? "1K";
    const params: Record<string, unknown> = {};
    if (mapping.aspectRatioFormat === "pixels") {
      params[mapping.aspectRatioParam] = imageSizeForRatio(
        aspectRatio,
        resolution,
      );
    } else {
      params[mapping.aspectRatioParam] = aspectRatio;
      params[mapping.resolutionParam] = resolution;
    }
    if (mapping.quality) params.quality = mapping.quality;
    if (images.length && config.referenceImagesParam) {
      params[config.referenceImagesParam] = images;
    }
    return params;
  }

  const params: Record<string, unknown> = {
    aspect_ratio: request.aspectRatio,
    duration: request.duration,
  };
  if (config.videoResolutionParam) {
    params[config.videoResolutionParam] =
      request.resolution ?? config.defaultResolution;
  }
  if (images.length && config.referenceImagesParam) {
    params[config.referenceImagesParam] =
      config.referenceImagesParam === "input_reference" ? images[0] : images;
  }
  return params;
}

function urlsFromCandidate(candidate: unknown): string[] {
  if (typeof candidate === "string" && candidate) return [candidate];
  if (!Array.isArray(candidate)) return [];
  return candidate
    .map((item) => {
      if (typeof item === "string") return item;
      return isRecord(item) ? readString(item.url || item.result_url) : "";
    })
    .filter(Boolean);
}

function normalizeResultUrls(payload: Record<string, unknown>): string[] {
  const data = isRecord(payload.data) ? payload.data : {};
  const topTaskResult = isRecord(payload.task_result) ? payload.task_result : {};
  const nestedTaskResult = isRecord(data.task_result) ? data.task_result : {};
  const candidates = [
    payload.result_url,
    payload.result_urls,
    payload.results,
    data.result_url,
    data.result_urls,
    data.results,
    topTaskResult.images,
    topTaskResult.videos,
    nestedTaskResult.images,
    nestedTaskResult.videos,
  ];

  for (const candidate of candidates) {
    const urls = urlsFromCandidate(candidate);
    if (urls.length) return urls;
  }
  return [];
}

function normalizeTaskState(value: unknown): TaskStatusResponse["state"] {
  const state = readString(value).toLowerCase();
  if (["success", "succeed", "succeeded", "completed"].includes(state)) {
    return "success";
  }
  if (["failed", "failure", "error", "canceled", "cancelled"].includes(state)) {
    return "failed";
  }
  if (["running", "processing", "in_progress"].includes(state)) {
    return "running";
  }
  return "pending";
}

export function createLingkeClient(
  config: LingkeClientConfig,
  fetcher: Fetcher = fetch,
) {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  async function post(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch {
      throw new LingkeRequestError("无法连接 LingkeAI，请检查网络。", 502);
    }
    const payload = await readJson(response);
    if (!response.ok) throw sanitizeProviderError(response.status, payload);
    return payload;
  }

  return {
    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      const model = getModelConfig(request.mode, request.model)!;
      if (request.mode === "text") {
        let path = "/v1/chat/completions";
        let body: Record<string, unknown> = {
          model: request.model,
          messages: createTextMessages(request, model.protocol),
        };
        if (model.protocol === "anthropic") {
          path = "/v1/messages";
          body = {
            model: request.model,
            max_tokens: 4096,
            messages: createTextMessages(request, model.protocol),
          };
        } else if (model.protocol === "gemini") {
          path = `/v1beta/models/${encodeURIComponent(request.model)}:generateContent`;
          body = {
            contents: createTextMessages(request, model.protocol),
          };
        }
        const payload = await post(path, body);
        const content = normalizeText(model.protocol, payload);
        if (!content) {
          throw new LingkeRequestError("模型未返回可显示的文本。", 502);
        }
        return { kind: "text", content };
      }

      if (
        request.mode === "video" &&
        request.model === TRX_SEEDANCE_25_MODEL
      ) {
        throw new LingkeRequestError(
          "SD 2.5 视频必须通过专用视频服务提交。",
          500,
        );
      }

      const payload = await post("/v1/media/generate", {
        model: request.model,
        prompt: request.prompt,
        params: createMediaParams(request),
      });
      const record = isRecord(payload) ? payload : {};
      const nested = isRecord(record.data) ? record.data : {};
      const taskId = String(
        record.task_id ?? record.taskId ?? nested.task_id ?? nested.taskId ?? nested.id ?? "",
      );
      if (!taskId) {
        throw new LingkeRequestError("媒体服务未返回任务编号。", 502);
      }
      return { kind: "task", taskId };
    },

    async status(
      taskId: string,
      mode: "image" | "video",
    ): Promise<TaskStatusResponse> {
      let response: Response;
      try {
        response = await fetcher(
          `${baseUrl}/v1/media/status?task_id=${encodeURIComponent(taskId)}`,
          { headers: { Authorization: `Bearer ${config.apiKey}` } },
        );
      } catch {
        throw new LingkeRequestError("无法查询生成任务，请检查网络。", 502);
      }
      const payload = await readJson(response);
      if (!response.ok) throw sanitizeProviderError(response.status, payload);
      const record = isRecord(payload) ? payload : {};
      const nested = isRecord(record.data) ? record.data : {};
      const rawState =
        nested.state ??
        nested.status ??
        nested.task_status ??
        record.state ??
        record.status ??
        record.task_status;
      const state = normalizeTaskState(rawState);
      const rawProgress = nested.progress ?? record.progress;
      const progress =
        typeof rawProgress === "number"
          ? `${rawProgress}%`
          : readString(rawProgress);
      const failureMessage =
        readString(nested.task_status_msg) ||
        readString(record.task_status_msg) ||
        readString(nested.error) ||
        readString(record.error);
      return {
        taskId,
        state,
        isFinal:
          nested.is_final === true ||
          record.is_final === true ||
          state === "success" ||
          state === "failed",
        progress,
        results: normalizeResultUrls(record).map((url) => ({ url, kind: mode })),
        error:
          state === "failed"
            ? failureMessage.slice(0, 180) || "生成失败，请检查提示词或稍后重试。"
            : "",
      };
    },
  };
}
