import type { ComposerMode } from "../ai/models.ts";
import type { GenerateResponse } from "../ai/types.ts";

export const SUBMISSION_UNKNOWN_PROGRESS = "提交状态未知";
export const SUBMISSION_UNKNOWN_MESSAGE = "提交状态未知：未收到任务编号，不能确认视频平台是否已接收请求。";

export class SubmissionUnknownError extends Error {
  constructor(message = SUBMISSION_UNKNOWN_MESSAGE) {
    super(message);
    this.name = "SubmissionUnknownError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readGenerateError(response: Response) {
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload)) {
      if (payload.code === "submission-unknown") {
        return new SubmissionUnknownError(
          typeof payload.error === "string" && payload.error
            ? payload.error
            : SUBMISSION_UNKNOWN_MESSAGE,
        );
      }
      if (typeof payload.error === "string") return new Error(payload.error);
    }
  } catch {
    // Keep the safe generic failure below when a non-success body is malformed.
  }
  return new Error("生成请求失败，请稍后重试。");
}

export async function readWorkflowGenerateResponse(
  response: Response,
  outputKind: ComposerMode,
): Promise<GenerateResponse> {
  if (!response.ok) throw await readGenerateError(response);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (outputKind !== "text") throw new SubmissionUnknownError();
    throw new Error("文本服务返回格式无效。");
  }
  if (outputKind === "text") {
    if (
      isRecord(payload) &&
      payload.kind === "text" &&
      typeof payload.content === "string"
    ) {
      return { kind: "text", content: payload.content };
    }
    throw new Error("文本服务返回格式无效。");
  }
  if (
    isRecord(payload) &&
    payload.kind === "task" &&
    typeof payload.taskId === "string" &&
    payload.taskId.trim()
  ) {
    return { kind: "task", taskId: payload.taskId };
  }
  throw new SubmissionUnknownError();
}

export function isSubmissionUnknownError(error: unknown) {
  return error instanceof SubmissionUnknownError ||
    (error instanceof TypeError && /failed to fetch/i.test(error.message));
}
