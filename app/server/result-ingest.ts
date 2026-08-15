import { createHash, randomUUID } from "node:crypto";
import type { TaskResult } from "../ai/types.ts";
import type { AuthenticatedUser } from "./database";
import { getDatabase } from "./database";
import { deleteObject, workflowObjectKey, writeObject } from "./object-storage";
import { projectBelongsToUser } from "./workflow-store";
import { safeUpstreamUrl } from "./storage-rules.ts";

export { safeUpstreamUrl } from "./storage-rules.ts";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

async function readLimited(response: Response, maximum: number) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maximum) throw new Error("上游素材超过大小限制。");
  if (!response.body) throw new Error("上游素材内容为空。");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new Error("上游素材超过大小限制。");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

export async function persistTaskResults(input: {
  user: AuthenticatedUser;
  projectId: string;
  resultId: string;
  results: TaskResult[];
}) {
  if (!(await projectBelongsToUser(input.projectId, input.user.id))) {
    throw new Response(JSON.stringify({ error: "项目不存在。" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const sql = getDatabase();
  return Promise.all(input.results.map(async (result, index) => {
    const nodeKey = index === 0 ? input.resultId : `${input.resultId}:${index}`;
    const existing = await sql<{
      id: string;
      name: string;
      mime_type: string;
      object_key: string;
    }[]>`
      SELECT id, name, mime_type, object_key FROM canvas_assets
      WHERE owner_id = ${input.user.id} AND project_id = ${input.projectId}
        AND node_id = ${nodeKey} AND status = 'ready'
      LIMIT 1
    `;
    const maximum = result.kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    const response = await fetch(safeUpstreamUrl(result.url), {
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error("无法转存上游生成素材。");
    const mimeType = (response.headers.get("content-type") || (
      result.kind === "video" ? "video/mp4" : "image/png"
    )).split(";")[0].trim().toLowerCase();
    if (!mimeType.startsWith(`${result.kind}/`)) throw new Error("上游素材类型无效。");
    const body = await readLimited(response, maximum);
    const assetId = existing[0]?.id ?? randomUUID();
    const objectKey = existing[0]?.object_key ?? workflowObjectKey(input.user.id, input.projectId, assetId);
    const extension = mimeType.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "bin";
    const name = `${result.kind}-${input.resultId}-${index + 1}.${extension}`;
    await writeObject({ key: objectKey, body, mimeType });
    try {
      const checksum = createHash("sha256").update(body).digest("hex");
      if (existing[0]) {
        await sql`
          UPDATE canvas_assets
          SET name = ${name}, mime_type = ${mimeType}, byte_size = ${body.byteLength},
            checksum = ${checksum}, updated_at = now()
          WHERE id = ${assetId} AND owner_id = ${input.user.id}
        `;
      } else {
        await sql`
          INSERT INTO canvas_assets (
            id, owner_id, project_id, node_id, object_key, name,
            mime_type, byte_size, checksum, status
          ) VALUES (
            ${assetId}, ${input.user.id}, ${input.projectId}, ${nodeKey}, ${objectKey}, ${name},
            ${mimeType}, ${body.byteLength}, ${checksum}, 'ready'
          )
        `;
      }
    } catch (error) {
      if (!existing[0]) await deleteObject(objectKey);
      throw error;
    }
    return {
      ...result,
      url: `/api/workflow/assets/${assetId}`,
      assetId,
      assetName: name,
      assetMimeType: mimeType,
    };
  }));
}
