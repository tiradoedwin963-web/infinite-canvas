import { randomUUID } from "node:crypto";
import {
  createLingkeClient,
  LingkeRequestError,
  toSafeRequestErrorPayload,
  validateGenerateRequest,
} from "@/app/ai/provider";
import {
  createTrxVideoClient,
  isTrxVideoModel,
} from "@/app/ai/trx-video-provider";
import { assertSameOrigin, requireSessionWhenCloud } from "@/app/server/auth";
import {
  resolveTrxVideoReferences,
} from "@/app/server/trx-video-references";
import type { GenerateResponse } from "@/app/ai/types";

function getClient() {
  const baseUrl = process.env.LINGKE_BASE_URL;
  const apiKey = process.env.LINGKE_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new LingkeRequestError("服务端尚未配置 LingkeAI。", 503);
  }
  return createLingkeClient({ baseUrl, apiKey });
}

function getTrxVideoClient() {
  const baseUrl = process.env.TRX_VIDEO_BASE_URL;
  const apiKey = process.env.TRX_VIDEO_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new LingkeRequestError("服务端尚未配置 TRX 视频服务。", 503);
  }
  return createTrxVideoClient({
    baseUrl,
    apiKey,
    onDiagnostic: (event) => {
      console.info(JSON.stringify({ event: "trx-video", ...event }));
    },
  });
}

export async function POST(request: Request) {
  let submissionAttemptId: string | undefined;
  try {
    assertSameOrigin(request);
    const user = await requireSessionWhenCloud(request);
    const input = validateGenerateRequest(await request.json());
    let response: GenerateResponse;
    if (input.mode === "video" && isTrxVideoModel(input.model)) {
      if (!user || !input.projectId) {
        throw new LingkeRequestError("SD 2.5 视频仅支持云端项目的已归档图片资产。", 400);
      }
      if ((input.images ?? []).length > 0) {
        throw new LingkeRequestError("SD 2.5 视频仅接受当前云端项目已归档的图片资产。", 400);
      }
      const attemptId = randomUUID();
      submissionAttemptId = attemptId;
      response = await getTrxVideoClient().generate(input, {
        attemptId,
        resolveReferenceUrls: () => resolveTrxVideoReferences({
          userId: user.id,
          projectId: input.projectId!,
          assetIds: input.referenceAssetIds ?? [],
        }),
      });
    } else {
      response = await getClient().generate(input);
    }
    return Response.json(response, {
      headers: submissionAttemptId
        ? { "x-submission-attempt-id": submissionAttemptId }
        : undefined,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const known =
      error instanceof LingkeRequestError
        ? error
        : new LingkeRequestError("生成请求无效。", 400);
    return Response.json(toSafeRequestErrorPayload(known), {
      status: known.status,
      headers: submissionAttemptId
        ? { "x-submission-attempt-id": submissionAttemptId }
        : undefined,
    });
  }
}
