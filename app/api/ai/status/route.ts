import { createLingkeClient, LingkeRequestError } from "@/app/ai/provider";

function getClient() {
  const baseUrl = process.env.LINGKE_BASE_URL;
  const apiKey = process.env.LINGKE_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new LingkeRequestError("服务端尚未配置 LingkeAI。", 503);
  }
  return createLingkeClient({ baseUrl, apiKey });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const taskId = url.searchParams.get("taskId")?.trim() ?? "";
    const mode = url.searchParams.get("mode");
    if (!taskId || (mode !== "image" && mode !== "video")) {
      throw new LingkeRequestError("任务查询参数无效。", 400);
    }
    return Response.json(await getClient().status(taskId, mode));
  } catch (error) {
    const known =
      error instanceof LingkeRequestError
        ? error
        : new LingkeRequestError("任务状态查询失败。", 502);
    return Response.json({ error: known.message }, { status: known.status });
  }
}
