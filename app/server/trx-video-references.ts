import { LingkeRequestError } from "../ai/provider.ts";
import { getDatabase } from "./database.ts";
import {
  createReadUrl,
  inspectObject,
} from "./object-storage.ts";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_REFERENCE_IMAGES = 30;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const TRX_VIDEO_REFERENCE_URL_TTL_SECONDS = 60 * 60 * 24;

export type TrxVideoReferenceAsset = {
  id: string;
  objectKey: string;
  mimeType: string;
  byteSize: number;
};

type ReferenceResolverDependencies = {
  projectBelongsToUser?: typeof projectBelongsToUser;
  findProjectAssets?: (input: {
    userId: string;
    projectId: string;
    assetIds: readonly string[];
  }) => Promise<readonly TrxVideoReferenceAsset[]>;
  inspectObject?: typeof inspectObject;
  createReadUrl?: typeof createReadUrl;
};

async function projectBelongsToUser(projectId: string, userId: string) {
  const rows = await getDatabase()<[{ exists: boolean }]>`
    SELECT EXISTS(
      SELECT 1 FROM canvas_projects WHERE id = ${projectId} AND owner_id = ${userId}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

function validateReferenceAssetIds(assetIds: readonly string[]) {
  if (assetIds.length > MAX_REFERENCE_IMAGES) {
    throw new LingkeRequestError(`当前模型最多支持 ${MAX_REFERENCE_IMAGES} 张参考图。`, 400);
  }
  const seen = new Set<string>();
  for (const assetId of assetIds) {
    if (!UUID_PATTERN.test(assetId) || seen.has(assetId)) {
      throw new LingkeRequestError("视频参考素材编号无效。", 400);
    }
    seen.add(assetId);
  }
}

async function findProjectAssets(input: {
  userId: string;
  projectId: string;
  assetIds: readonly string[];
}): Promise<readonly TrxVideoReferenceAsset[]> {
  const sql = getDatabase();
  const rows = await sql<{
    id: string;
    object_key: string;
    mime_type: string;
    byte_size: number | string;
  }[]>`
    SELECT id, object_key, mime_type, byte_size
    FROM canvas_assets
    WHERE owner_id = ${input.userId}
      AND project_id = ${input.projectId}
      AND status = 'ready'
      AND mime_type LIKE 'image/%'
      AND id = ANY(${sql.array([...input.assetIds])}::uuid[])
  `;
  return rows.map((row) => ({
    id: row.id,
    objectKey: row.object_key,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
  }));
}

export async function resolveTrxVideoReferences(
  input: {
    userId: string;
    projectId: string;
    assetIds: readonly string[];
  },
  dependencies: ReferenceResolverDependencies = {},
): Promise<string[]> {
  validateReferenceAssetIds(input.assetIds);
  const belongsToUser = dependencies.projectBelongsToUser ?? projectBelongsToUser;
  if (!(await belongsToUser(input.projectId, input.userId))) {
    throw new LingkeRequestError("项目不存在。", 404);
  }
  if (input.assetIds.length === 0) return [];

  const assets = await (dependencies.findProjectAssets ?? findProjectAssets)(input);
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  if (input.assetIds.some((assetId) => !assetsById.has(assetId))) {
    throw new LingkeRequestError("视频参考素材不属于当前项目或尚未可用。", 400);
  }

  let totalBytes = 0;
  const orderedAssets = input.assetIds.map((assetId) => {
    const asset = assetsById.get(assetId)!;
    if (
      !asset.mimeType.startsWith("image/") ||
      !Number.isInteger(asset.byteSize) ||
      asset.byteSize < 1 ||
      asset.byteSize > MAX_IMAGE_BYTES
    ) {
      throw new LingkeRequestError("单张参考图不能超过 10MB。", 400);
    }
    totalBytes += asset.byteSize;
    return asset;
  });
  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
    throw new LingkeRequestError("参考图总大小不能超过 30MB。", 400);
  }

  const inspect = dependencies.inspectObject ?? inspectObject;
  const signRead = dependencies.createReadUrl ?? createReadUrl;
  const urls: string[] = [];
  for (const asset of orderedAssets) {
    try {
      await inspect(asset.objectKey);
    } catch {
      throw new LingkeRequestError("视频参考素材不存在或无法读取。", 400);
    }
    try {
      urls.push(await signRead({
        key: asset.objectKey,
        expiresSeconds: TRX_VIDEO_REFERENCE_URL_TTL_SECONDS,
      }));
    } catch {
      throw new LingkeRequestError("无法签发视频参考素材地址，请检查对象存储配置。", 502);
    }
  }
  return urls;
}
