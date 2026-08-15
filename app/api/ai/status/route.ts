import { createLingkeClient, LingkeRequestError } from "@/app/ai/provider";
import { requireSessionWhenCloud } from "@/app/server/auth";
import { persistTaskResults } from "@/app/server/result-ingest";

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
    const user = await requireSessionWhenCloud(request);
    const url = new URL(request.url);
    const taskId = url.searchParams.get("taskId")?.trim() ?? "";
    const mode = url.searchParams.get("mode");
    if (!taskId || (mode !== "image" && mode !== "video")) {
      throw new LingkeRequestError("任务查询参数无效。", 400);
    }
    const status = await getClient().status(taskId, mode);
    const projectId = url.searchParams.get("projectId")?.trim() ?? "";
    const resultId = url.searchParams.get("resultId")?.trim() ?? "";
    if (user && status.state === "success" && status.results.length) {
      if (!projectId || !resultId) {
        throw new LingkeRequestError("云端任务缺少项目参数。", 400);
      }
      status.results = await persistTaskResults({
        user,
        projectId,
        resultId,
        results: status.results,
      });
    }
    return Response.json(status);
  } catch (error) {
    if (error instanceof Response) return error;
    const known =
      error instanceof LingkeRequestError
        ? error
        : new LingkeRequestError("任务状态查询失败。", 502);
    return Response.json({ error: known.message }, { status: known.status });
  }
}
