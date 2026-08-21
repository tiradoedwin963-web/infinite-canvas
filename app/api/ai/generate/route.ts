import {
  createLingkeClient,
  LingkeRequestError,
  validateGenerateRequest,
} from "@/app/ai/provider";
import { assertSameOrigin, requireSessionWhenCloud } from "@/app/server/auth";

function getClient() {
  const baseUrl = process.env.LINGKE_BASE_URL;
  const apiKey = process.env.LINGKE_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new LingkeRequestError("服务端尚未配置 LingkeAI。", 503);
  }
  return createLingkeClient({ baseUrl, apiKey });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireSessionWhenCloud(request);
    const input = validateGenerateRequest(await request.json());
    const response = await getClient().generate(input);
    return Response.json(response);
  } catch (error) {
    if (error instanceof Response) return error;
    const known =
      error instanceof LingkeRequestError
        ? error
        : new LingkeRequestError("生成请求无效。", 400);
    return Response.json({ error: known.message }, { status: known.status });
  }
}
