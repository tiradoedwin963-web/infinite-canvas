import { requireSessionUser, responseFromError } from "@/app/server/auth";
import { getDatabase } from "@/app/server/database";
import { deleteObject, readObject, writeObject } from "@/app/server/object-storage";
import { assertSameOrigin } from "@/app/server/auth";
import { assetContentVersion, workflowThumbnailObjectKey } from "@/app/server/storage-rules";
import { createImageThumbnail, objectBodyBytes } from "@/app/server/thumbnails";

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
      checksum: string | null;
      updated_at: Date | string;
    }[]>`
      SELECT object_key, mime_type, byte_size, name, checksum, updated_at
      FROM canvas_assets
      WHERE id = ${id} AND owner_id = ${user.id} AND status = 'ready'
      LIMIT 1
    `;
    const asset = rows[0];
    if (!asset) return Response.json({ error: "素材不存在。" }, { status: 404 });
    const version = assetContentVersion(asset.checksum, asset.updated_at);
    const thumbnail = new URL(request.url).searchParams.get("variant") === "thumbnail" &&
      asset.mime_type.startsWith("image/");
    const etag = `"${thumbnail ? "thumbnail" : "original"}-${version}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, Vary: "Cookie" },
      });
    }

    if (thumbnail) {
      const thumbnailKey = workflowThumbnailObjectKey(asset.object_key);
      let body: Uint8Array;
      let fallback = false;
      try {
        const stored = await readObject(thumbnailKey);
        if (!stored.Body) throw new Error("缩略图不存在。");
        body = objectBodyBytes(stored.Body);
      } catch {
        const original = await readObject(asset.object_key);
        if (!original.Body) return Response.json({ error: "素材内容不存在。" }, { status: 404 });
        const originalBody = objectBodyBytes(original.Body);
        try {
          body = await createImageThumbnail(originalBody);
          await writeObject({ key: thumbnailKey, body, mimeType: "image/webp" });
        } catch {
          body = originalBody;
          fallback = true;
        }
      }
      return new Response(body, {
        headers: {
          "Content-Type": fallback ? asset.mime_type : "image/webp",
          "Content-Length": String(body.byteLength),
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
          "Cache-Control": fallback
            ? "private, max-age=300"
            : "private, max-age=31536000, immutable",
          "X-Canvas-Asset-Variant": fallback ? "original-fallback" : "thumbnail",
          ETag: etag,
          Vary: "Cookie",
        },
      });
    }

    const range = request.headers.get("range") ?? undefined;
    const object = await readObject(asset.object_key, range);
    if (!object.Body) return Response.json({ error: "素材内容不存在。" }, { status: 404 });
    const headers = new Headers({
      "Content-Type": object.headers?.["content-type"] || asset.mime_type,
      "Cache-Control": "private, max-age=3600",
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
      ETag: etag,
      Vary: "Cookie",
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
    await deleteObject(workflowThumbnailObjectKey(rows[0].object_key)).catch(() => undefined);
    await sql`DELETE FROM canvas_assets WHERE id = ${id} AND owner_id = ${user.id}`;
    return Response.json({ ok: true });
  } catch (error) {
    return responseFromError(error, "无法删除素材。");
  }
}
