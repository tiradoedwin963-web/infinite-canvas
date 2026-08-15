import { assertSameOrigin, requireSessionUser, responseFromError } from "@/app/server/auth";
import { getDatabase } from "@/app/server/database";
import { cleanProjectName, validateGraph, validateViewport } from "@/app/server/workflow-store";
import { parseWorkflowBatchRun } from "@/app/workflow/agent";
import { deleteObject } from "@/app/server/object-storage";
import { assetContentVersion, workflowThumbnailObjectKey } from "@/app/server/storage-rules";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireSessionUser(request);
    const { id } = await context.params;
    const rows = await getDatabase()`
      SELECT projects.id, projects.name, projects.graph, projects.viewport,
        projects.batch, projects.revision, projects.created_at, projects.updated_at,
        conversations.payload AS conversation,
        conversations.revision AS conversation_revision
      FROM canvas_projects AS projects
      JOIN canvas_project_conversations AS conversations ON conversations.project_id = projects.id
      WHERE projects.id = ${id} AND projects.owner_id = ${user.id}
      LIMIT 1
    `;
    if (!rows[0]) return Response.json({ error: "项目不存在。" }, { status: 404 });
    const assets = await getDatabase()<{
      id: string;
      checksum: string | null;
      updated_at: Date | string;
    }[]>`
      SELECT id, checksum, updated_at FROM canvas_assets
      WHERE project_id = ${id} AND owner_id = ${user.id} AND status = 'ready'
    `;
    const assetVersions = Object.fromEntries(assets.map((asset) => [
      asset.id,
      assetContentVersion(asset.checksum, asset.updated_at),
    ]));
    return Response.json(
      { ...rows[0], asset_versions: assetVersions },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return responseFromError(error, "无法读取项目。");
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request);
    const { id } = await context.params;
    const input = await request.json() as {
      name?: unknown;
      graph?: unknown;
      viewport?: unknown;
      batch?: unknown;
      revision?: unknown;
    };
    if (!Number.isInteger(input.revision) || Number(input.revision) < 1) {
      return Response.json({ error: "项目修订号无效。" }, { status: 400 });
    }
    const name = cleanProjectName(input.name);
    const graph = validateGraph(input.graph);
    const viewport = validateViewport(input.viewport);
    const batch = input.batch == null
      ? null
      : parseWorkflowBatchRun(JSON.stringify(input.batch));
    if (input.batch != null && !batch) {
      return Response.json({ error: "批量队列数据无效。" }, { status: 400 });
    }
    const sql = getDatabase();
    const updated = await sql`
      UPDATE canvas_projects
      SET name = ${name}, graph = ${sql.json(graph)}, viewport = ${sql.json(viewport)},
        batch = ${batch ? sql.json(batch) : null}, revision = revision + 1, updated_at = now()
      WHERE id = ${id} AND owner_id = ${user.id} AND revision = ${Number(input.revision)}
      RETURNING revision, updated_at
    `;
    if (updated[0]) return Response.json(updated[0]);
    const exists = await sql`SELECT revision FROM canvas_projects WHERE id = ${id} AND owner_id = ${user.id}`;
    return exists[0]
      ? Response.json({ error: "项目已在其他设备更新。", revision: exists[0].revision }, { status: 409 })
      : Response.json({ error: "项目不存在。" }, { status: 404 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return Response.json({ error: "项目名称已存在。" }, { status: 409 });
    }
    return responseFromError(error, error instanceof Error ? error.message : "无法保存项目。");
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request);
    const { id } = await context.params;
    const sql = getDatabase();
    const assets = await sql<{ object_key: string }[]>`
      SELECT object_key FROM canvas_assets WHERE project_id = ${id} AND owner_id = ${user.id}
    `;
    if (!assets.length) {
      const exists = await sql`SELECT id FROM canvas_projects WHERE id = ${id} AND owner_id = ${user.id}`;
      if (!exists.length) return Response.json({ error: "项目不存在。" }, { status: 404 });
    }
    const deleted = await sql`
      DELETE FROM canvas_projects WHERE id = ${id} AND owner_id = ${user.id} RETURNING id
    `;
    if (!deleted[0]) return Response.json({ error: "项目不存在。" }, { status: 404 });
    await Promise.allSettled(assets.flatMap((asset) => [
      deleteObject(asset.object_key),
      deleteObject(workflowThumbnailObjectKey(asset.object_key)),
    ]));
    await ensureReplacement(user.id);
    return Response.json({ ok: true });
  } catch (error) {
    return responseFromError(error, "无法删除项目。");
  }
}

async function ensureReplacement(userId: string) {
  const { ensureDefaultProject } = await import("@/app/server/workflow-store");
  await ensureDefaultProject(userId);
}
