import { createHash } from "node:crypto";

export const MIGRATION_IMAGE_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

export function validateWorkflowExport(source) {
  if (
    source?.version !== 1 || source.graph?.version !== 1 ||
    !Array.isArray(source.graph.nodes) || !Array.isArray(source.graph.edges)
  ) {
    throw new Error("Invalid workflow export");
  }
  return source;
}

export function workflowMigrationImageNodes(source) {
  validateWorkflowExport(source);
  return source.graph.nodes.filter((node) =>
    node?.type === "result" && node.kind === "image" &&
    node.status === "success" && typeof node.resultUrl === "string" &&
    Boolean(node.resultUrl)
  );
}

export function detectImageContentType(body) {
  if (
    body.length >= 8 && body[0] === 0x89 && body[1] === 0x50 &&
    body[2] === 0x4e && body[3] === 0x47 && body[4] === 0x0d &&
    body[5] === 0x0a && body[6] === 0x1a && body[7] === 0x0a
  ) return "image/png";
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    body.length >= 12 && body.toString("ascii", 0, 4) === "RIFF" &&
    body.toString("ascii", 8, 12) === "WEBP"
  ) return "image/webp";
  return "";
}

export function imageChecksum(body) {
  return createHash("sha256").update(body).digest("hex");
}

export function validateWorkflowMigrationManifest(source, manifest) {
  const imageNodes = workflowMigrationImageNodes(source);
  if (!Array.isArray(manifest?.assets)) throw new Error("Invalid asset manifest");
  const byNodeId = new Map();
  for (const asset of manifest.assets) {
    if (
      !asset || typeof asset.nodeId !== "string" || !asset.nodeId ||
      typeof asset.url !== "string" || !asset.url ||
      typeof asset.path !== "string" || !asset.path ||
      !MIGRATION_IMAGE_TYPES.has(asset.contentType)
    ) throw new Error("Invalid asset manifest entry");
    if (byNodeId.has(asset.nodeId)) throw new Error(`Duplicate asset mapping: ${asset.nodeId}`);
    byNodeId.set(asset.nodeId, asset);
  }
  if (byNodeId.size !== imageNodes.length) {
    throw new Error(`Expected ${imageNodes.length} image assets, received ${byNodeId.size}`);
  }
  return imageNodes.map((node) => {
    const asset = byNodeId.get(node.id);
    if (!asset || asset.url !== node.resultUrl) {
      throw new Error(`Missing image for result node ${node.id}`);
    }
    return { node, asset };
  });
}

export function prepareImportedWorkflowGraph(sourceGraph, importedAssets) {
  const graph = structuredClone(sourceGraph);
  const byNodeId = new Map(importedAssets.map((asset) => [asset.nodeId, asset]));
  graph.nodes.forEach((node) => {
    const asset = byNodeId.get(node.id);
    if (asset) {
      node.assetId = asset.id;
      node.assetName = asset.name;
      node.assetMimeType = asset.contentType;
      node.resultUrl = `/api/workflow/assets/${asset.id}`;
      node.status = "success";
      node.progress = "";
      node.error = "";
      delete node.taskId;
      delete node.startedAt;
      return;
    }
    if (node.type === "scheduler" && node.outputKind === "video") {
      node.error = "";
      return;
    }
    if (node.type === "result" && node.kind === "video" && node.status !== "success") {
      node.status = "ready";
      node.progress = "待生成";
      node.error = "";
      delete node.taskId;
      delete node.startedAt;
    }
  });
  return graph;
}
