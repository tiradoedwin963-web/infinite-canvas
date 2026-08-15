import { randomUUID } from "node:crypto";
import { emptyWorkflowGraph } from "@/app/workflow/graph";
import { assertSameOrigin, requireSessionUser, responseFromError } from "@/app/server/auth";
import { getDatabase } from "@/app/server/database";
import {
  EMPTY_CONVERSATIONS,
  cleanProjectName,
  ensureDefaultProject,
} from "@/app/server/workflow-store";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    await ensureDefaultProject(user.id);
    const sql = getDatabase();
    const [projects, active] = await Promise.all([
      sql`
        SELECT id, name, revision, created_at, updated_at
        FROM canvas_projects
        WHERE owner_id = ${user.id}
        ORDER BY updated_at DESC
      `,
      sql<{ active_project_id: string | null }[]>`
        SELECT active_project_id FROM canvas_users WHERE id = ${user.id}
      `,
    ]);
    const activeProjectId = projects.some((project) => project.id === active[0]?.active_project_id)
      ? active[0]!.active_project_id
      : projects[0]?.id;
    return Response.json({ projects, activeProjectId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responseFromError(error, "无法读取项目列表。");
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request);
    const input = await request.json() as { name?: unknown };
    const name = cleanProjectName(input.name);
    const id = randomUUID();
    const sql = getDatabase();
    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO canvas_projects (id, owner_id, name, graph, viewport)
        VALUES (
          ${id}, ${user.id}, ${name},
          ${transaction.json(emptyWorkflowGraph())},
          ${transaction.json({ x: 0, y: 0, scale: 1 })}
        )
      `;
      await transaction`
        INSERT INTO canvas_project_conversations (project_id, owner_id, payload)
        VALUES (${id}, ${user.id}, ${transaction.json(EMPTY_CONVERSATIONS)})
      `;
      await transaction`
        UPDATE canvas_users SET active_project_id = ${id}, updated_at = now() WHERE id = ${user.id}
      `;
    });
    return Response.json({ id, name, revision: 1 }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return Response.json({ error: "项目名称已存在。" }, { status: 409 });
    }
    return responseFromError(error, error instanceof Error ? error.message : "无法创建项目。");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request);
    const input = await request.json() as { activeProjectId?: unknown };
    const projectId = typeof input.activeProjectId === "string" ? input.activeProjectId : "";
    const updated = await getDatabase()`
      UPDATE canvas_users
      SET active_project_id = ${projectId}, updated_at = now()
      WHERE id = ${user.id}
        AND EXISTS (
          SELECT 1 FROM canvas_projects WHERE id = ${projectId} AND owner_id = ${user.id}
        )
      RETURNING id
    `;
    if (!updated.length) return Response.json({ error: "项目不存在。" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return responseFromError(error, "无法切换项目。");
  }
}
