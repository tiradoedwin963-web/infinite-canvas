import { randomUUID } from "node:crypto";
import { assertSameOrigin, requireSessionUser, responseFromError } from "@/app/server/auth";
import { getDatabase } from "@/app/server/database";
import {
  copyObject,
  deleteObject,
  inspectObject,
  workflowObjectKey,
} from "@/app/server/object-storage";
import { workflowThumbnailObjectKey } from "@/app/server/storage-rules";
import { EMPTY_CONVERSATIONS, cleanProjectName, validateGraph } from "@/app/server/workflow-store";
import {
  createMangaCinematographyComparisonGraph,
  remapWorkflowAssetIds,
} from "@/app/workflow/manga-director";

type Context = { params: Promise<{ id: string }> };

function missingObject(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; statusCode?: unknown };
  return candidate.code === "NoSuchKey" || candidate.statusCode === 404;
}

export async function POST(request: Request, context: Context) {
  const copiedKeys: string[] = [];
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request);
    const { id: sourceProjectId } = await context.params;
    const input = await request.json() as { name?: unknown };
    const name = cleanProjectName(input.name);
    const sql = getDatabase();
    const projects = await sql<{ graph: unknown }[]>`
      SELECT graph FROM canvas_projects
      WHERE id = ${sourceProjectId} AND owner_id = ${user.id}
      LIMIT 1
    `;
    if (!projects[0]) return Response.json({ error: "项目不存在。" }, { status: 404 });

    const comparison = createMangaCinematographyComparisonGraph(
      validateGraph(projects[0].graph),
    );
    const referencedAssetIds = new Set(comparison.nodes.flatMap((node) =>
      node.type !== "scheduler" && node.assetId ? [node.assetId] : []
    ));
    const sourceAssets = await sql<{
      id: string;
      node_id: string | null;
      object_key: string;
      name: string;
      mime_type: string;
      byte_size: number;
      checksum: string | null;
    }[]>`
      SELECT id, node_id, object_key, name, mime_type, byte_size, checksum
      FROM canvas_assets
      WHERE project_id = ${sourceProjectId} AND owner_id = ${user.id} AND status = 'ready'
    `;
    const assets = sourceAssets.filter((asset) => referencedAssetIds.has(asset.id));
    if (assets.length !== referencedAssetIds.size) {
      throw new Error("原项目存在缺失的云端素材，不能创建对照版。");
    }

    const projectId = randomUUID();
    const assetIdMap = new Map<string, string>();
    const clonedAssets: Array<typeof assets[number] & { id: string; object_key: string }> = [];
    for (const asset of assets) {
      const assetId = randomUUID();
      const objectKey = workflowObjectKey(user.id, projectId, assetId);
      await copyObject(asset.object_key, objectKey);
      copiedKeys.push(objectKey);
      const sourceThumbnail = workflowThumbnailObjectKey(asset.object_key);
      const targetThumbnail = workflowThumbnailObjectKey(objectKey);
      try {
        await inspectObject(sourceThumbnail);
        await copyObject(sourceThumbnail, targetThumbnail);
        copiedKeys.push(targetThumbnail);
      } catch (error) {
        if (!missingObject(error)) throw error;
      }
      assetIdMap.set(asset.id, assetId);
      clonedAssets.push({ ...asset, id: assetId, object_key: objectKey });
    }
    const graph = remapWorkflowAssetIds(comparison, assetIdMap);

    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO canvas_projects (id, owner_id, name, graph, viewport, batch)
        VALUES (
          ${projectId}, ${user.id}, ${name}, ${transaction.json(graph)},
          ${transaction.json({ x: 0, y: 0, scale: 1 })}, null
        )
      `;
      await transaction`
        INSERT INTO canvas_project_conversations (project_id, owner_id, payload)
        VALUES (${projectId}, ${user.id}, ${transaction.json(EMPTY_CONVERSATIONS)})
      `;
      for (const asset of clonedAssets) {
        await transaction`
          INSERT INTO canvas_assets (
            id, owner_id, project_id, node_id, object_key, name,
            mime_type, byte_size, checksum, status
          ) VALUES (
            ${asset.id}, ${user.id}, ${projectId}, ${asset.node_id}, ${asset.object_key},
            ${asset.name}, ${asset.mime_type}, ${asset.byte_size}, ${asset.checksum}, 'ready'
          )
        `;
      }
      await transaction`
        UPDATE canvas_users SET active_project_id = ${projectId}, updated_at = now()
        WHERE id = ${user.id}
      `;
    });
    return Response.json({ id: projectId, name, revision: 1 }, { status: 201 });
  } catch (error) {
    await Promise.allSettled(copiedKeys.map((key) => deleteObject(key)));
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return Response.json({ error: "项目名称已存在。" }, { status: 409 });
    }
    return responseFromError(
      error,
      error instanceof Error ? error.message : "无法创建电影语言对照版。",
    );
  }
}
