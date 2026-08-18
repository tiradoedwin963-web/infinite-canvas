import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  detectImageContentType,
  imageChecksum,
  MIGRATION_IMAGE_TYPES,
  validateWorkflowExport,
  workflowMigrationImageNodes,
} from "./workflow-migration-lib.mjs";

const [exportPath, outputPath] = process.argv.slice(2);
if (!exportPath || !outputPath) {
  throw new Error("Usage: node scripts/prepare-workflow-migration.mjs <project.canvas.json> <output-directory>");
}

const source = validateWorkflowExport(JSON.parse(await readFile(resolve(exportPath), "utf8")));
const nodes = workflowMigrationImageNodes(source);
const expectedNodes = Number(process.env.MIGRATION_EXPECTED_NODES || 0);
const expectedSchedulers = Number(process.env.MIGRATION_EXPECTED_SCHEDULERS || 0);
const expectedResults = Number(process.env.MIGRATION_EXPECTED_RESULTS || 0);
const expectedAssets = Number(process.env.MIGRATION_EXPECTED_ASSETS || 0);
const schedulerCount = source.graph.nodes.filter((node) => node.type === "scheduler").length;
const resultCount = source.graph.nodes.filter((node) => node.type === "result").length;
if (expectedNodes && source.graph.nodes.length !== expectedNodes) throw new Error("Unexpected node count");
if (expectedSchedulers && schedulerCount !== expectedSchedulers) throw new Error("Unexpected scheduler count");
if (expectedResults && resultCount !== expectedResults) throw new Error("Unexpected result count");
if (expectedAssets && nodes.length !== expectedAssets) throw new Error("Unexpected image asset count");

const outputDirectory = resolve(outputPath);
const assetsDirectory = resolve(outputDirectory, "assets");
await mkdir(assetsDirectory, { recursive: true });
const assets = [];
for (const [index, node] of nodes.entries()) {
  if (!/^https:\/\//i.test(node.resultUrl)) {
    throw new Error(`Image result is not a downloadable HTTPS URL: ${node.id}`);
  }
  const response = await fetch(node.resultUrl);
  if (!response.ok) throw new Error(`Unable to download image result ${node.id}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (!body.length || body.length > 10 * 1024 * 1024) {
    throw new Error(`Invalid image size for ${node.id}`);
  }
  const contentType = detectImageContentType(body);
  const extension = MIGRATION_IMAGE_TYPES.get(contentType);
  if (!extension) throw new Error(`Unsupported image type for ${node.id}`);
  const filename = `${String(index + 1).padStart(3, "0")}-${node.id}.${extension}`;
  await writeFile(resolve(assetsDirectory, filename), body);
  assets.push({
    nodeId: node.id,
    url: node.resultUrl,
    path: `assets/${filename}`,
    name: node.assetName || node.label || basename(filename),
    contentType,
    byteSize: body.length,
    checksum: imageChecksum(body),
  });
}

await writeFile(resolve(outputDirectory, "project.canvas.json"), JSON.stringify(source));
await writeFile(resolve(outputDirectory, "manifest.json"), JSON.stringify({ version: 1, assets }, null, 2));
console.log(JSON.stringify({
  outputDirectory,
  nodes: source.graph.nodes.length,
  schedulers: schedulerCount,
  results: resultCount,
  assets: assets.length,
}));
