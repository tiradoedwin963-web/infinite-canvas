import { requireSessionUser, responseFromError } from "@/app/server/auth";
import { getDatabase } from "@/app/server/database";
import { deleteObject, readObject } from "@/app/server/object-storage";
import { assertSameOrigin } from "@/app/server/auth";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireSessionUser(request);
    const { id } = await context.params;
    const rows = await getDatabase()<{
      object_key: string;
      mime_type: string;
      byte_size: number;
      name: string;
    }[]>`
      SELECT object_key, mime_type, byte_size, name
      FROM canvas_assets
      WHERE id = ${id} AND owner_id = ${user.id} AND status = 'ready'
      LIMIT 1
    `;
    const asset = rows[0];
    if (!asset) return Response.json({ error: "素材不存在。" }, { status: 404 });
    const range = request.headers.get("range") ?? undefined;
    const object = await readObject(asset.object_key, range);
    if (!object.Body) return Response.json({ error: "素材内容不存在。" }, { status: 404 });
    const headers = new Headers({
      "Content-Type": object.headers?.["content-type"] || asset.mime_type,
      "Cache-Control": "private, max-age=3600",
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
    });
    const contentLength = object.headers?.["content-length"];
    const contentRange = object.headers?.["content-range"];
    if (contentLength != null) headers.set("Content-Length", String(contentLength));
    if (contentRange) headers.set("Content-Range", contentRange);
    return new Response(object.Body, { status: contentRange ? 206 : 200, headers });
  } catch (error) {
    return responseFromError(error, "无法读取素材。");
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request);
    const { id } = await context.params;
    const sql = getDatabase();
    const rows = await sql<{ object_key: string }[]>`
      SELECT object_key FROM canvas_assets WHERE id = ${id} AND owner_id = ${user.id} LIMIT 1
    `;
    if (!rows[0]) return Response.json({ error: "素材不存在。" }, { status: 404 });
    await deleteObject(rows[0].object_key);
    await sql`DELETE FROM canvas_assets WHERE id = ${id} AND owner_id = ${user.id}`;
    return Response.json({ ok: true });
  } catch (error) {
    return responseFromError(error, "无法删除素材。");
  }
}
