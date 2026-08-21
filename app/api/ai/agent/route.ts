import {
  CanvasAgentError,
  createCanvasAgentClient,
  validateAgentRequest,
} from "@/app/ai/agent-provider";
import { encodeAgentSseEvent } from "@/app/ai/agent-stream";
import agentInstructions from "@/agent.md?raw";
import toolManual from "@/tools.md?raw";
import workflowToolManual from "@/workflow-tools.md?raw";
import storyAssetToolManual from "@/story-asset-tools.md?raw";
import { assertSameOrigin, requireSessionWhenCloud, responseFromError } from "@/app/server/auth";

const AGENT_ACTIVITY_EVENT_INTERVAL_MS = 5_000;

function getClient() {
  const baseUrl = process.env.LINGKE_BASE_URL;
  const apiKey = process.env.LINGKE_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new CanvasAgentError("服务端尚未配置 LingkeAI。", 503);
  }
  return createCanvasAgentClient({
    baseUrl,
    apiKey,
    instructions: agentInstructions,
    toolManual,
    workflowToolManual,
    storyAssetToolManual,
  });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireSessionWhenCloud(request);
  } catch (error) {
    return responseFromError(error, "请先登录。");
  }
  let input;
  try {
    input = validateAgentRequest(await request.json());
  } catch (error) {
    const known =
      error instanceof CanvasAgentError
        ? error
        : new CanvasAgentError("画布 Agent 请求无效。", 400);
    return Response.json({ error: known.message }, { status: known.status });
  }

  const encoder = new TextEncoder();
  const upstreamController = new AbortController();
  const signal = AbortSignal.any([request.signal, upstreamController.signal]);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastActivitySentAt = 0;
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(encodeAgentSseEvent(event, data)));
      };
      const sendActivity = () => {
        const now = Date.now();
        if (now - lastActivitySentAt < AGENT_ACTIVITY_EVENT_INTERVAL_MS) return;
        lastActivitySentAt = now;
        send("activity", {});
      };
      void Promise.resolve()
        .then(() =>
          getClient().respond(input, {
            signal,
            onActivity: sendActivity,
            onProgress: (text) => send("progress", { text }),
          }),
        )
        .then((result) => send("result", result))
        .catch((error) => {
          if (signal.aborted) return;
          const known =
            error instanceof CanvasAgentError
              ? error
              : new CanvasAgentError(
                  error instanceof Error
                    ? error.message
                    : "画布 Agent 请求失败，请稍后重试。",
                );
          send("error", { message: known.message });
        })
        .finally(() => {
          if (!signal.aborted) controller.close();
        });
    },
    cancel() {
      upstreamController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
