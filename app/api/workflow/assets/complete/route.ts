import { assertSameOrigin, requireSessionUser, responseFromError } from "@/app/server/auth";
import { getDatabase } from "@/app/server/database";
import { inspectObject } from "@/app/server/object-storage";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request);
    const input = await request.json() as { assetId?: unknown };
    const assetId = typeof input.assetId === "string" ? input.assetId : "";
    const sql = getDatabase();
    const rows = await sql<{
      id: string;
      object_key: string;
      byte_size: number;
      mime_type: string;
      name: string;
    }[]>`
      SELECT id, object_key, byte_size, mime_type, name
      FROM canvas_assets
      WHERE id = ${assetId} AND owner_id = ${user.id} AND status = 'uploading'
      LIMIT 1
    `;
    const asset = rows[0];
    if (!asset) return Response.json({ error: "素材不存在。" }, { status: 404 });
    const object = await inspectObject(asset.object_key);
    if (Number(object.headers?.["content-length"]) !== Number(asset.byte_size)) {
      return Response.json({ error: "素材大小校验失败。" }, { status: 400 });
    }
    if ((object.headers?.["content-type"] || "").toLowerCase() !== asset.mime_type.toLowerCase()) {
      return Response.json({ error: "素材类型校验失败。" }, { status: 400 });
    }
    const updated = await sql`
      UPDATE canvas_assets SET status = 'ready', updated_at = now()
      WHERE id = ${asset.id} AND owner_id = ${user.id}
      RETURNING id, name, mime_type, byte_size
    `;
    return Response.json(updated[0]);
  } catch (error) {
    return responseFromError(error, "无法确认素材上传结果。");
  }
}
