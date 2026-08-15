import { randomUUID } from "node:crypto";
import { assertSameOrigin, requireSessionUser, responseFromError } from "@/app/server/auth";
import { getDatabase } from "@/app/server/database";
import { createUploadUrl, workflowObjectKey } from "@/app/server/object-storage";
import { projectBelongsToUser } from "@/app/server/workflow-store";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request);
    const input = await request.json() as {
      projectId?: unknown;
      nodeId?: unknown;
      name?: unknown;
      mimeType?: unknown;
      byteSize?: unknown;
    };
    const projectId = typeof input.projectId === "string" ? input.projectId : "";
    const nodeId = typeof input.nodeId === "string" ? input.nodeId.slice(0, 200) : null;
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 240) : "";
    const mimeType = typeof input.mimeType === "string" ? input.mimeType.trim().toLowerCase() : "";
    const byteSize = Number(input.byteSize);
    const maximum = mimeType.startsWith("image/")
      ? MAX_IMAGE_BYTES
      : mimeType.startsWith("video/")
        ? MAX_VIDEO_BYTES
        : 0;
    if (!projectId || !name || !maximum || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > maximum) {
      return Response.json({ error: "素材上传参数无效。" }, { status: 400 });
    }
    if (!(await projectBelongsToUser(projectId, user.id))) {
      return Response.json({ error: "项目不存在。" }, { status: 404 });
    }
    const assetId = randomUUID();
    const objectKey = workflowObjectKey(user.id, projectId, assetId);
    const sql = getDatabase();
    await sql`
      INSERT INTO canvas_assets (
        id, owner_id, project_id, node_id, object_key, name, mime_type, byte_size, status
      ) VALUES (
        ${assetId}, ${user.id}, ${projectId}, ${nodeId}, ${objectKey},
        ${name}, ${mimeType}, ${byteSize}, 'uploading'
      )
    `;
    try {
      const uploadUrl = await createUploadUrl({ key: objectKey, mimeType, byteSize });
      return Response.json({
        assetId,
        uploadUrl,
        expiresAt: Date.now() + 10 * 60_000,
        headers: {
          "Content-Type": mimeType,
        },
      }, { status: 201 });
    } catch (error) {
      await sql`DELETE FROM canvas_assets WHERE id = ${assetId} AND owner_id = ${user.id}`;
      throw error;
    }
  } catch (error) {
    return responseFromError(error, "无法创建素材上传任务。");
  }
}
