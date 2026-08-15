import { createHash } from "node:crypto";
import { assertSameOrigin, requireSessionUser, responseFromError } from "@/app/server/auth";
import { getDatabase } from "@/app/server/database";
import { inspectObject, readObject, writeObject } from "@/app/server/object-storage";
import { assetContentVersion, workflowThumbnailObjectKey } from "@/app/server/storage-rules";
import { createImageThumbnail, objectBodyBytes } from "@/app/server/thumbnails";

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
    let checksum: string | null = null;
    if (asset.mime_type.startsWith("image/")) {
      try {
        const original = await readObject(asset.object_key);
        const body = objectBodyBytes(original.Body);
        checksum = createHash("sha256").update(body).digest("hex");
        const thumbnail = await createImageThumbnail(body);
        await writeObject({
          key: workflowThumbnailObjectKey(asset.object_key),
          body: thumbnail,
          mimeType: "image/webp",
        });
      } catch {
        // The verified original remains authoritative; the read route can repair its thumbnail later.
      }
    }
    const updated = await sql`
      UPDATE canvas_assets
      SET status = 'ready', checksum = ${checksum}, updated_at = now()
      WHERE id = ${asset.id} AND owner_id = ${user.id}
      RETURNING id, name, mime_type, byte_size, checksum, updated_at
    `;
    return Response.json({
      ...updated[0],
      assetVersion: assetContentVersion(updated[0].checksum, updated[0].updated_at),
    });
  } catch (error) {
    return responseFromError(error, "无法确认素材上传结果。");
  }
}
