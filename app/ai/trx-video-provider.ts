import type { GenerateRequest, GenerateResponse, TaskStatusResponse } from "./types.ts";
import { LingkeRequestError } from "./provider.ts";

type Fetcher = typeof fetch;

export type TrxVideoClientConfig = {
  baseUrl: string;
  apiKey: string;
};

export const TRX_TASK_PREFIX = "trx:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return isRecord(value) ? value : {};
  } catch {
    throw new LingkeRequestError("视频平台返回了无法识别的响应。", 502);
  }
}

function providerError(status: number, payload: Record<string, unknown>) {
  if (status === 401 || status === 403) {
    return new LingkeRequestError("视频平台鉴权失败，请检查服务端密钥。", 502);
  }
  if (status === 402) {
    return new LingkeRequestError("视频平台账户余额不足。", 402);
  }
  if (status === 429) {
    return new LingkeRequestError("视频请求过于频繁，请稍后重试。", 429);
  }
  const detail = [payload.detail, payload.message, payload.error_message]
    .map(readString)
    .find(Boolean)
    ?.trim()
    .slice(0, 180);
  if (detail && !/bearer\s|api[_ -]?key|ek-[a-z0-9]{12,}|https?:\/\//i.test(detail)) {
    return new LingkeRequestError(detail, status >= 500 ? 502 : status);
  }
  return new LingkeRequestError("视频平台暂时不可用，请稍后重试。", 502);
}

function stateOf(value: unknown): TaskStatusResponse["state"] {
  const status = readString(value).toLowerCase();
  if (status === "completed") return "success";
  if (status === "failed") return "failed";
  if (status === "processing") return "running";
  return "pending";
}

export function createTrxVideoClient(
  config: TrxVideoClientConfig,
  fetcher: Fetcher = fetch,
) {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  return {
    async generate(
      request: GenerateRequest,
      referenceUrls: string[],
    ): Promise<GenerateResponse> {
      let response: Response;
      try {
        response = await fetcher(`${baseUrl}/v1/video/generate`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: request.model,
            prompt: request.prompt,
            mode:
              referenceUrls.length > 1
                ? "reference"
                : referenceUrls.length === 1
                  ? "image2video"
                  : "text2video",
            duration: Number(request.duration || 5),
            aspect_ratio: request.aspectRatio || "16:9",
            resolution: request.resolution || "720p",
            ...(referenceUrls.length ? { images: referenceUrls } : {}),
          }),
        });
      } catch {
        throw new LingkeRequestError(
          "无法连接视频平台。由于提交接口不保证幂等，未确认任务状态前请勿自动重试。",
          502,
        );
      }
      const payload = await readJson(response);
      if (!response.ok) throw providerError(response.status, payload);
      const taskId = readString(payload.task_id);
      if (!taskId) {
        throw new LingkeRequestError("视频平台未返回任务编号。", 502);
      }
      return { kind: "task", taskId: `${TRX_TASK_PREFIX}${taskId}` };
    },

    async status(taskId: string): Promise<TaskStatusResponse> {
      const rawTaskId = taskId.startsWith(TRX_TASK_PREFIX)
        ? taskId.slice(TRX_TASK_PREFIX.length)
        : taskId;
      let response: Response;
      try {
        response = await fetcher(
          `${baseUrl}/v1/video/tasks/${encodeURIComponent(rawTaskId)}`,
          { headers: { Authorization: `Bearer ${config.apiKey}` } },
        );
      } catch {
        throw new LingkeRequestError("无法查询视频任务，请检查网络。", 502);
      }
      const payload = await readJson(response);
      if (!response.ok) throw providerError(response.status, payload);
      const state = stateOf(payload.status);
      const resultUrl = readString(payload.result_url || payload.download_url);
      const error = readString(payload.error_message).trim().slice(0, 180);
      return {
        taskId,
        state,
        isFinal: state === "success" || state === "failed",
        progress: state === "running" ? "生成中" : state === "pending" ? "排队中" : "",
        results: state === "success" && resultUrl
          ? [{ url: resultUrl, kind: "video" }]
          : [],
        error: state === "failed" ? error || "视频生成失败。" : "",
      };
    },
  };
}
