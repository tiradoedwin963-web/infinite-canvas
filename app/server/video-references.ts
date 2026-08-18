import type { GenerateReferenceImage } from "../ai/types.ts";
import { LingkeRequestError } from "../ai/provider.ts";
import type { AuthenticatedUser } from "./database.ts";
import { getDatabase } from "./database.ts";

export async function resolveVideoReferenceUrls(
  user: AuthenticatedUser | null,
  images: GenerateReferenceImage[],
) {
  if (!images.length) return [];
  if (!user || images.some((image) => !image.assetId)) {
    throw new LingkeRequestError(
      "多参考视频需要使用已同步到云端的图片资产。",
      400,
    );
  }
  const { createReadUrl } = await import("./object-storage.ts");
  const sql = getDatabase();
  return Promise.all(images.map(async (image) => {
    const rows = await sql<{ object_key: string; mime_type: string }[]>`
      SELECT object_key, mime_type FROM canvas_assets
      WHERE id = ${image.assetId!} AND owner_id = ${user.id}
        AND status = 'ready'
      LIMIT 1
    `;
    const asset = rows[0];
    if (!asset || !asset.mime_type.startsWith("image/")) {
      throw new LingkeRequestError("视频参考资产不存在或尚未就绪。", 404);
    }
    return createReadUrl(asset.object_key);
  }));
}
