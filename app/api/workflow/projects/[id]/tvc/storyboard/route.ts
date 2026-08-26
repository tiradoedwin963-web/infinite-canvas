import { requireSessionUser, responseFromError } from "@/app/server/auth";
import { getDatabase } from "@/app/server/database";
import { parseWorkflowGraph } from "@/app/workflow/graph";
import { readTvcProject } from "@/app/workflow/tvc";
import { createTvcStoryboardWorkbook, tvcStoryboardFilename } from "@/app/workflow/tvc-excel";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireSessionUser(request);
    const { id } = await context.params;
    const rows = await getDatabase()<{ graph: unknown }[]>`
      SELECT graph
      FROM canvas_projects
      WHERE id = ${id} AND owner_id = ${user.id}
      LIMIT 1
    `;
    if (!rows[0]) return Response.json({ error: "项目不存在。" }, { status: 404 });

    const project = readTvcProject(parseWorkflowGraph(JSON.stringify(rows[0].graph)));
    if (!project?.storyboard) return Response.json({ error: "TVC 分镜表不存在。" }, { status: 404 });

    const file = await createTvcStoryboardWorkbook(project.storyboard);
    return new Response(file, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          tvcStoryboardFilename(project.storyboard.title),
        )}`,
      },
    });
  } catch (error) {
    return responseFromError(error, "无法导出 TVC 分镜表。");
  }
}
