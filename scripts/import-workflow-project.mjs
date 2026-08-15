import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import postgres from "postgres";
import COS from "cos-nodejs-sdk-v5";

const [exportPath, manifestPath] = process.argv.slice(2);
if (!exportPath || !manifestPath) {
  throw new Error("Usage: node scripts/import-workflow-project.mjs <project.canvas.json> <manifest.json>");
}

function environment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const source = JSON.parse(await readFile(resolve(exportPath), "utf8"));
const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
if (source.version !== 1 || source.graph?.version !== 1 || !Array.isArray(source.graph.nodes)) {
  throw new Error("Invalid workflow export");
}
if (!Array.isArray(manifest.assets)) throw new Error("Invalid asset manifest");

const expectedNodes = Number(process.env.MIGRATION_EXPECTED_NODES || 0);
const expectedSchedulers = Number(process.env.MIGRATION_EXPECTED_SCHEDULERS || 0);
const expectedResults = Number(process.env.MIGRATION_EXPECTED_RESULTS || 0);
const schedulerCount = source.graph.nodes.filter((node) => node.type === "scheduler").length;
const resultNodes = source.graph.nodes.filter((node) => node.type === "result");
if (expectedNodes && source.graph.nodes.length !== expectedNodes) throw new Error("Unexpected node count");
if (expectedSchedulers && schedulerCount !== expectedSchedulers) throw new Error("Unexpected scheduler count");
if (expectedResults && resultNodes.length !== expectedResults) throw new Error("Unexpected result count");

const byUrl = new Map(manifest.assets.map((asset) => [asset.url, asset]));
const resultAssets = resultNodes.map((node) => {
  const asset = byUrl.get(node.resultUrl);
  if (!asset || asset.contentType !== "image/png") {
    throw new Error(`Missing PNG for result node ${node.id}`);
  }
  return { node, asset };
});
if (new Set(resultAssets.map(({ asset }) => asset.url)).size !== resultAssets.length) {
  throw new Error("Duplicate asset mapping");
}

const databaseUrl = environment("DATABASE_URL");
const region = environment("COS_REGION");
const bucket = environment("COS_BUCKET");
const storage = new COS({
  SecretId: environment("COS_SECRET_ID"),
  SecretKey: environment("COS_SECRET_KEY"),
});
const sql = postgres(databaseUrl, { max: 1 });
const projectId = randomUUID();
const uploaded = [];

try {
  const users = await sql`SELECT id FROM canvas_users WHERE lower(username) = lower('admin') AND is_admin = true LIMIT 1`;
  if (!users[0]) throw new Error("Admin user not found");
  const ownerId = users[0].id;
  const assets = [];
  const graph = structuredClone(source.graph);

  for (const [index, item] of resultAssets.entries()) {
    const path = resolve(dirname(resolve(manifestPath)), basename(item.asset.path));
    const body = await readFile(path);
    if (!body.length || body.length > 10 * 1024 * 1024) throw new Error(`Invalid image size: ${path}`);
    const checksum = createHash("sha256").update(body).digest("hex");
    if (item.asset.nodeId && item.asset.nodeId !== item.node.id) {
      throw new Error(`Unexpected result node mapping: ${path}`);
    }
    if (item.asset.byteSize && Number(item.asset.byteSize) !== body.length) {
      throw new Error(`Unexpected image size: ${path}`);
    }
    if (item.asset.checksum && item.asset.checksum !== checksum) {
      throw new Error(`Unexpected image checksum: ${path}`);
    }
    const assetId = randomUUID();
    const objectKey = `users/${ownerId}/projects/${projectId}/assets/${assetId}`;
    await storage.putObject({
      Bucket: bucket,
      Region: region,
      Key: objectKey,
      Body: body,
      ContentType: "image/png",
      ContentLength: body.length,
      ServerSideEncryption: "AES256",
    });
    const stored = await storage.headObject({ Bucket: bucket, Region: region, Key: objectKey });
    if (
      Number(stored.headers?.["content-length"]) !== body.length ||
      stored.headers?.["content-type"] !== "image/png"
    ) {
      throw new Error(`Uploaded image validation failed: ${path}`);
    }
    uploaded.push(objectKey);
    assets.push({
      id: assetId,
      nodeId: item.node.id,
      objectKey,
      name: item.asset.name || `image-${index + 1}.png`,
      byteSize: body.length,
      checksum,
    });
    const graphNode = graph.nodes.find((node) => node.id === item.node.id);
    graphNode.assetId = assetId;
    graphNode.assetName = assets.at(-1).name;
    graphNode.assetMimeType = "image/png";
    graphNode.resultUrl = `/api/workflow/assets/${assetId}`;
    graphNode.status = "success";
    graphNode.progress = "";
    graphNode.error = "";
    delete graphNode.taskId;
    delete graphNode.startedAt;
  }

  graph.nodes.forEach((node) => {
    if (node.type !== "result") return;
    delete node.taskId;
    delete node.startedAt;
    if (node.status === "pending" || node.status === "running") {
      node.status = "paused";
      node.progress = "迁移后已停止自动查询";
    }
  });

  const conversation = structuredClone(source.conversation);
  conversation.conversations?.forEach((item) => {
    item.messages = (item.messages || []).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      ...(Array.isArray(message.details) ? { details: message.details } : {}),
    }));
  });

  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO canvas_projects (id, owner_id, name, graph, viewport, batch)
      VALUES (
        ${projectId}, ${ownerId}, ${String(source.project?.name || "迁移项目")},
        ${transaction.json(graph)}, ${transaction.json(source.viewport)}, null
      )
    `;
    await transaction`
      INSERT INTO canvas_project_conversations (project_id, owner_id, payload)
      VALUES (${projectId}, ${ownerId}, ${transaction.json(conversation)})
    `;
    for (const asset of assets) {
      await transaction`
        INSERT INTO canvas_assets (
          id, owner_id, project_id, node_id, object_key, name,
          mime_type, byte_size, checksum, status
        ) VALUES (
          ${asset.id}, ${ownerId}, ${projectId}, ${asset.nodeId}, ${asset.objectKey},
          ${asset.name}, 'image/png', ${asset.byteSize}, ${asset.checksum}, 'ready'
        )
      `;
    }
    await transaction`
      UPDATE canvas_users SET active_project_id = ${projectId}, updated_at = now() WHERE id = ${ownerId}
    `;
  });
  console.log(JSON.stringify({
    projectId,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    schedulers: schedulerCount,
    assets: assets.length,
  }));
} catch (error) {
  await Promise.allSettled(uploaded.map((key) => storage.deleteObject({
    Bucket: bucket, Region: region, Key: key,
  })));
  throw error;
} finally {
  await sql.end();
}
