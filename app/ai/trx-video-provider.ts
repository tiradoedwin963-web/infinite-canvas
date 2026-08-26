import { TRX_SEEDANCE_25_MODEL } from "./models.ts";
import { LingkeRequestError } from "./provider.ts";
import type {
  GenerateRequest,
  GenerateResponse,
  TaskStatusResponse,
} from "./types.ts";
import type { LingkeRequestError as LingkeRequestErrorType } from "./provider.ts";

type Fetcher = typeof fetch;

export const TRX_VIDEO_MODEL = "seedance-2.5";
export const TRX_TASK_PREFIX = "trx-video:";

export type TrxVideoClientConfig = {
  baseUrl: string;
  apiKey: string;
  onDiagnostic?: (event: TrxVideoDiagnostic) => void;
};

export type TrxVideoDiagnostic = {
  attemptId?: string;
  model: typeof TRX_VIDEO_MODEL;
  phase: "profile" | "reference-resolve" | "submit" | "status";
  httpStatus?: number;
  elapsedMs: number;
  responseKeys: string[];
  dataKeys: string[];
  classification:
    | "profile-available"
    | "profile-unavailable"
    | "provider-rejected"
    | "reference-resolution-failed"
    | "network-error"
    | "submission-unknown"
    | "accepted"
    | "status";
};

export type TrxVideoReferenceResolver = (
  attemptId: string,
) => Promise<readonly string[]>;

export type TrxVideoGenerateOptions = {
  attemptId: string;
  referenceUrls?: readonly string[];
  resolveReferenceUrls?: TrxVideoReferenceResolver;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readSafeMessage(payload: Record<string, unknown>): string {
  const error = isRecord(payload.error) ? payload.error : undefined;
  const data = isRecord(payload.data) ? payload.data : undefined;
  const candidates = [
    payload.detail,
    payload.message,
    payload.msg,
    payload.error_message,
    typeof payload.error === "string" ? payload.error : undefined,
    error?.message,
    data?.detail,
    data?.message,
    data?.error_message,
  ];
  const message = candidates
    .map(readString)
    .find((value) => value.trim())
    ?.trim()
    .slice(0, 180) ?? "";
  return /bearer\s|api[_ -]?key|sk-[a-z0-9]{12,}|https?:\/\//i.test(message)
    ? ""
    : message;
}

function isExplicitBusinessRejection(payload: Record<string, unknown>): boolean {
  if (payload.success === false || payload.ok === false) return true;
  if (payload.error) return true;
  if (["error", "failed", "rejected"].includes(readString(payload.status).toLowerCase())) {
    return true;
  }

  const code = payload.code;
  if (typeof code === "number") return code !== 0 && code !== 200;
  if (typeof code === "string") {
    return !["", "0", "200", "ok", "success"].includes(code.toLowerCase());
  }
  return false;
}

function isExplicitStatusLookupRejection(payload: Record<string, unknown>): boolean {
  if (payload.success === false || payload.ok === false) return true;
  const code = payload.code;
  if (typeof code === "number") return code !== 0 && code !== 200;
  if (typeof code === "string") {
    return !["", "0", "200", "ok", "success"].includes(code.toLowerCase());
  }
  return false;
}

function providerError(status: number, payload: Record<string, unknown>): LingkeRequestErrorType {
  const serialized = JSON.stringify(payload).toLowerCase();
  if (status === 401 || status === 403) {
    return new LingkeRequestError("视频平台鉴权失败，请检查服务端密钥。", 502);
  }
  if (status === 402 || serialized.includes("余额") || serialized.includes("balance")) {
    return new LingkeRequestError("视频平台账户余额不足。", 402);
  }
  if (status === 429) {
    return new LingkeRequestError("视频请求过于频繁，请稍后重试。", 429);
  }
  if (status >= 400 && status < 500) {
    return new LingkeRequestError(
      readSafeMessage(payload) || "视频平台拒绝了请求。",
      status,
    );
  }
  return new LingkeRequestError("视频平台暂时不可用，请稍后重试。", 502);
}

function businessRejection(payload: Record<string, unknown>): LingkeRequestErrorType {
  const serialized = JSON.stringify(payload).toLowerCase();
  if (serialized.includes("余额") || serialized.includes("balance")) {
    return new LingkeRequestError("视频平台账户余额不足。", 402);
  }
  if (serialized.includes("rate limit") || serialized.includes("too many")) {
    return new LingkeRequestError("视频请求过于频繁，请稍后重试。", 429);
  }
  return new LingkeRequestError(
    readSafeMessage(payload) || "视频平台拒绝了请求。",
    400,
  );
}

function submissionUnknown(message: string): LingkeRequestErrorType {
  return new LingkeRequestError(message, 502, "submission-unknown");
}

async function readJsonRecord(response: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const payload: unknown = await response.json();
    return isRecord(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
}

function responseShape(payload: Record<string, unknown> | undefined) {
  const data = payload && isRecord(payload.data) ? payload.data : undefined;
  return {
    responseKeys: payload ? Object.keys(payload).sort().slice(0, 20) : [],
    dataKeys: data ? Object.keys(data).sort().slice(0, 20) : [],
  };
}

function profileEntryAvailable(value: unknown): boolean {
  if (typeof value === "string") return value === TRX_VIDEO_MODEL;
  if (!isRecord(value)) return false;
  const model = readString(value.model || value.id || value.name);
  if (model !== TRX_VIDEO_MODEL) return false;
  if (value.enabled === false || value.available === false || value.active === false) {
    return false;
  }
  return !["disabled", "unavailable", "inactive"].includes(
    readString(value.status).toLowerCase(),
  );
}

function profileModelsInclude(container: Record<string, unknown>): boolean {
  const models = container.models;
  if (Array.isArray(models)) return models.some(profileEntryAvailable);
  if (!isRecord(models)) return false;
  const entry = models[TRX_VIDEO_MODEL];
  if (entry === true) return true;
  if (entry === TRX_VIDEO_MODEL) return true;
  if (isRecord(entry)) {
    if (entry.enabled === false || entry.available === false || entry.active === false) {
      return false;
    }
    return !["disabled", "unavailable", "inactive"].includes(
      readString(entry.status).toLowerCase(),
    );
  }
  return false;
}

function profileSupportsModel(payload: Record<string, unknown>): boolean {
  return profileModelsInclude(payload) ||
    (isRecord(payload.data) && profileModelsInclude(payload.data));
}

function validateReferenceUrls(
  urls: readonly string[],
  referenceAssetCount: number,
): string[] {
  if (urls.length !== referenceAssetCount) {
    throw new LingkeRequestError("视频参考图数量与已归档素材不一致。", 502);
  }
  return urls.map((url) => {
    const value = url.trim();
    if (!/^https:\/\//i.test(value)) {
      throw new LingkeRequestError("视频参考图签名地址无效。", 502);
    }
    return value;
  });
}

function normalizeTaskState(value: unknown): TaskStatusResponse["state"] {
  const status = readString(value).toLowerCase();
  if (["completed", "success", "succeeded", "done"].includes(status)) {
    return "success";
  }
  if (["failed", "failure", "error", "cancelled", "canceled"].includes(status)) {
    return "failed";
  }
  if (["processing", "running", "generating", "in_progress"].includes(status)) {
    return "running";
  }
  return "pending";
}

function resultUrl(payload: Record<string, unknown>): string {
  const data = isRecord(payload.data) ? payload.data : {};
  const output = isRecord(payload.output) ? payload.output : {};
  const nestedOutput = isRecord(data.output) ? data.output : {};
  return [
    payload.result_url,
    payload.download_url,
    output.url,
    data.result_url,
    data.download_url,
    nestedOutput.url,
  ].map(readString).find(Boolean) ?? "";
}

function rawTaskId(taskId: string): string {
  const value = taskId.startsWith(TRX_TASK_PREFIX)
    ? taskId.slice(TRX_TASK_PREFIX.length)
    : "";
  if (!value) throw new LingkeRequestError("视频任务编号无效。", 400);
  return value;
}

export function isTrxVideoModel(model: string): boolean {
  return model === TRX_SEEDANCE_25_MODEL;
}

export function isTrxVideoTaskId(taskId: string): boolean {
  return taskId.startsWith(TRX_TASK_PREFIX) && taskId.length > TRX_TASK_PREFIX.length;
}

export function createTrxVideoClient(
  config: TrxVideoClientConfig,
  fetcher: Fetcher = fetch,
) {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const authHeaders = { Authorization: `Bearer ${config.apiKey}` };
  const jsonHeaders = { ...authHeaders, "Content-Type": "application/json" };

  function diagnostic(
    event: Omit<TrxVideoDiagnostic, "model" | "responseKeys" | "dataKeys">,
    payload?: Record<string, unknown>,
  ) {
    try {
      config.onDiagnostic?.({
        ...event,
        model: TRX_VIDEO_MODEL,
        ...responseShape(payload),
      });
    } catch {
      // Diagnostics must never change a video submission outcome.
    }
  }

  async function profile(attemptId?: string): Promise<void> {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}/v1/video/profile`, { headers: authHeaders });
    } catch {
      diagnostic({
        attemptId,
        phase: "profile",
        elapsedMs: Date.now() - startedAt,
        classification: "network-error",
      });
      throw new LingkeRequestError("无法获取视频平台能力信息，请检查网络。", 502);
    }
    const payload = await readJsonRecord(response);
    if (!response.ok) {
      diagnostic({
        attemptId,
        phase: "profile",
        httpStatus: response.status,
        elapsedMs: Date.now() - startedAt,
        classification: "provider-rejected",
      }, payload);
      throw providerError(response.status, payload ?? {});
    }
    if (!payload || isExplicitBusinessRejection(payload)) {
      diagnostic({
        attemptId,
        phase: "profile",
        httpStatus: response.status,
        elapsedMs: Date.now() - startedAt,
        classification: "provider-rejected",
      }, payload);
      throw payload
        ? businessRejection(payload)
        : new LingkeRequestError("视频平台能力信息无法识别。", 502);
    }
    if (!profileSupportsModel(payload)) {
      diagnostic({
        attemptId,
        phase: "profile",
        httpStatus: response.status,
        elapsedMs: Date.now() - startedAt,
        classification: "profile-unavailable",
      }, payload);
      throw new LingkeRequestError("当前视频平台未开通 Seedance 2.5。", 400);
    }
    diagnostic({
      attemptId,
      phase: "profile",
      httpStatus: response.status,
      elapsedMs: Date.now() - startedAt,
      classification: "profile-available",
    }, payload);
  }

  return {
    profile,

    async generate(
      request: GenerateRequest,
      options: TrxVideoGenerateOptions,
    ): Promise<GenerateResponse> {
      if (request.mode !== "video" || !isTrxVideoModel(request.model)) {
        throw new LingkeRequestError("当前模型不支持 TRX 视频提交。", 400);
      }
      const attemptId = options.attemptId.trim();
      if (!attemptId) throw new LingkeRequestError("视频提交记录无效。", 400);

      await profile(attemptId);

      const referenceAssetIds = request.referenceAssetIds ?? [];
      let referenceUrls: string[];
      if (options.referenceUrls !== undefined) {
        referenceUrls = validateReferenceUrls(options.referenceUrls, referenceAssetIds.length);
      } else if (referenceAssetIds.length > 0 && options.resolveReferenceUrls) {
        const resolutionStartedAt = Date.now();
        let resolved: readonly string[];
        try {
          resolved = await options.resolveReferenceUrls(attemptId);
        } catch (error) {
          diagnostic({
            attemptId,
            phase: "reference-resolve",
            elapsedMs: Date.now() - resolutionStartedAt,
            classification: "reference-resolution-failed",
          });
          if (error instanceof LingkeRequestError) throw error;
          throw new LingkeRequestError("无法读取已归档的视频参考图，请检查对象存储配置。", 502);
        }
        referenceUrls = validateReferenceUrls(resolved, referenceAssetIds.length);
      } else if (referenceAssetIds.length > 0) {
        throw new LingkeRequestError("视频参考图签名服务未配置。", 503);
      } else {
        referenceUrls = [];
      }

      const startedAt = Date.now();
      let response: Response;
      try {
        response = await fetcher(`${baseUrl}/v1/video/generate`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            model: TRX_VIDEO_MODEL,
            prompt: request.prompt,
            mode: referenceUrls.length ? "reference" : "text2video",
            duration: Number(request.duration),
            aspect_ratio: request.aspectRatio,
            resolution: request.resolution,
            generate_audio: true,
            ...(referenceUrls.length ? { images: referenceUrls } : {}),
          }),
        });
      } catch {
        diagnostic({
          attemptId,
          phase: "submit",
          elapsedMs: Date.now() - startedAt,
          classification: "network-error",
        });
        throw submissionUnknown(
          "无法确认视频平台是否已收到请求。为避免重复计费，请先核实后再重新提交。",
        );
      }
      const payload = await readJsonRecord(response);
      if (!response.ok) {
        if (response.status >= 500) {
          diagnostic({
            attemptId,
            phase: "submit",
            httpStatus: response.status,
            elapsedMs: Date.now() - startedAt,
            classification: "submission-unknown",
          }, payload);
          throw submissionUnknown(
            "视频平台未确认任务提交结果。为避免重复计费，请先核实后再重新提交。",
          );
        }
        diagnostic({
          attemptId,
          phase: "submit",
          httpStatus: response.status,
          elapsedMs: Date.now() - startedAt,
          classification: "provider-rejected",
        }, payload);
        throw providerError(response.status, payload ?? {});
      }
      if (!payload) {
        diagnostic({
          attemptId,
          phase: "submit",
          httpStatus: response.status,
          elapsedMs: Date.now() - startedAt,
          classification: "submission-unknown",
        });
        throw submissionUnknown(
          "视频平台返回无法识别的提交结果。为避免重复计费，请先核实后再重新提交。",
        );
      }
      if (isExplicitBusinessRejection(payload)) {
        diagnostic({
          attemptId,
          phase: "submit",
          httpStatus: response.status,
          elapsedMs: Date.now() - startedAt,
          classification: "provider-rejected",
        }, payload);
        throw businessRejection(payload);
      }
      const taskId = readString(payload.task_id).trim();
      if (!taskId) {
        diagnostic({
          attemptId,
          phase: "submit",
          httpStatus: response.status,
          elapsedMs: Date.now() - startedAt,
          classification: "submission-unknown",
        }, payload);
        throw submissionUnknown(
          "视频平台未返回任务编号，无法确认任务是否已提交。为避免重复计费，请先核实后再重新提交。",
        );
      }
      diagnostic({
        attemptId,
        phase: "submit",
        httpStatus: response.status,
        elapsedMs: Date.now() - startedAt,
        classification: "accepted",
      }, payload);
      return { kind: "task", taskId: `${TRX_TASK_PREFIX}${taskId}` };
    },

    async status(taskId: string): Promise<TaskStatusResponse> {
      const externalTaskId = rawTaskId(taskId);
      const startedAt = Date.now();
      let response: Response;
      try {
        response = await fetcher(
          `${baseUrl}/v1/video/tasks/${encodeURIComponent(externalTaskId)}`,
          { headers: authHeaders },
        );
      } catch {
        diagnostic({
          phase: "status",
          elapsedMs: Date.now() - startedAt,
          classification: "network-error",
        });
        throw new LingkeRequestError("无法查询视频任务，请检查网络。", 502);
      }
      const payload = await readJsonRecord(response);
      if (!response.ok) {
        diagnostic({
          phase: "status",
          httpStatus: response.status,
          elapsedMs: Date.now() - startedAt,
          classification: "provider-rejected",
        }, payload);
        throw providerError(response.status, payload ?? {});
      }
      if (!payload || isExplicitStatusLookupRejection(payload)) {
        diagnostic({
          phase: "status",
          httpStatus: response.status,
          elapsedMs: Date.now() - startedAt,
          classification: "provider-rejected",
        }, payload);
        throw payload
          ? businessRejection(payload)
          : new LingkeRequestError("视频平台返回了无法识别的响应。", 502);
      }
      const data = isRecord(payload.data) ? payload.data : {};
      const state = normalizeTaskState(data.status ?? payload.status);
      const rawProgress = data.progress ?? payload.progress;
      const progress = typeof rawProgress === "number"
        ? `${rawProgress}%`
        : readString(rawProgress);
      const error = state === "failed"
        ? readSafeMessage(data).trim() || readSafeMessage(payload).trim() || "视频生成失败。"
        : "";
      const url = resultUrl(payload);
      diagnostic({
        phase: "status",
        httpStatus: response.status,
        elapsedMs: Date.now() - startedAt,
        classification: "status",
      }, payload);
      return {
        taskId,
        state,
        isFinal: state === "success" || state === "failed",
        progress,
        results: state === "success" && url ? [{ url, kind: "video" }] : [],
        error,
      };
    },
  };
}
