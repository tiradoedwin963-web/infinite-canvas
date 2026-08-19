import { assertSameOrigin, responseFromError } from "@/app/server/auth";
import { cloudPersistenceEnabled } from "@/app/server/config";
import { createStoryboardWorkbook } from "@/app/server/storyboard-xlsx";
import { cleanProjectName, validateGraph } from "@/app/server/workflow-store";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (cloudPersistenceEnabled()) {
      return Response.json({ error: "云端项目请使用受账号保护的导出接口。" }, { status: 404 });
    }
    const input = await request.json() as { name?: unknown; storyId?: unknown; graph?: unknown };
    if (typeof input.storyId !== "string" || !input.storyId) {
      return Response.json({ error: "短剧 ID 无效。" }, { status: 400 });
    }
    const name = cleanProjectName(input.name);
    const workbook = await createStoryboardWorkbook(validateGraph(input.graph), input.storyId);
    const filename = `${name.replace(/[\\/:*?"<>|]/g, "-") || "漫剧分镜表"}.xlsx`;
    return new Response(workbook, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return responseFromError(error, "无法导出分镜表。");
  }
}
