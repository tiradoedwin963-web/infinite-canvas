import { requireSessionUser, responseFromError } from "@/app/server/auth";
import { getDatabase } from "@/app/server/database";
import { createStoryboardWorkbook } from "@/app/server/storyboard-xlsx";
import { validateGraph } from "@/app/server/workflow-store";

type Context = { params: Promise<{ id: string }> };

function downloadName(value: string) {
  return `${value.replace(/[\\/:*?"<>|]/g, "-") || "漫剧分镜表"}.xlsx`;
}

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireSessionUser(request);
    const { id } = await context.params;
    const rows = await getDatabase()<{ name: string; graph: unknown }[]>`
      SELECT name, graph FROM canvas_projects
      WHERE id = ${id} AND owner_id = ${user.id}
      LIMIT 1
    `;
    const project = rows[0];
    if (!project) return Response.json({ error: "项目不存在。" }, { status: 404 });
    const workbook = await createStoryboardWorkbook(validateGraph(project.graph), id);
    return new Response(workbook, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName(project.name))}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return responseFromError(error, "无法导出分镜表。");
  }
}
