import {
  CanvasAgentError,
  createCanvasAgentClient,
  validateAgentRequest,
} from "@/app/ai/agent-provider";

function getClient() {
  const baseUrl = process.env.LINGKE_BASE_URL;
  const apiKey = process.env.LINGKE_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new CanvasAgentError("服务端尚未配置 LingkeAI。", 503);
  }
  return createCanvasAgentClient({ baseUrl, apiKey });
}

export async function POST(request: Request) {
  try {
    const input = validateAgentRequest(await request.json());
    return Response.json(await getClient().respond(input));
  } catch (error) {
    const known =
      error instanceof CanvasAgentError
        ? error
        : new CanvasAgentError("画布 Agent 请求无效。", 400);
    return Response.json({ error: known.message }, { status: known.status });
  }
}
