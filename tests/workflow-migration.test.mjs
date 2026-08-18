import assert from "node:assert/strict";
import test from "node:test";
import {
  detectImageContentType,
  imageChecksum,
  prepareImportedWorkflowGraph,
  validateWorkflowMigrationManifest,
  workflowMigrationImageNodes,
} from "../scripts/workflow-migration-lib.mjs";

function workflowExport() {
  return {
    version: 1,
    project: { id: "local", name: "迁移测试" },
    graph: {
      version: 1,
      nodes: [
        {
          id: "image-result",
          type: "result",
          kind: "image",
          status: "success",
          resultUrl: "https://example.com/image.png",
          error: "",
          progress: "",
        },
        {
          id: "video-scheduler",
          type: "scheduler",
          outputKind: "video",
          error: "视频参考图尚未同步到云端资产库。",
        },
        {
          id: "video-result",
          type: "result",
          kind: "video",
          status: "ready",
          progress: "待生成",
          error: "视频参考图尚未同步到云端资产库。",
          taskId: "stale",
        },
      ],
      edges: [],
    },
    viewport: { x: 0, y: 0, scale: 1 },
    conversation: { version: 2, activeConversationId: null, conversations: [] },
  };
}

test("selects only successful image results and excludes video placeholders", () => {
  const source = workflowExport();
  assert.deepEqual(workflowMigrationImageNodes(source).map((node) => node.id), ["image-result"]);
  const pairs = validateWorkflowMigrationManifest(source, {
    assets: [{
      nodeId: "image-result",
      url: "https://example.com/image.png",
      path: "assets/image.png",
      contentType: "image/png",
    }],
  });
  assert.equal(pairs.length, 1);
  assert.throws(() => validateWorkflowMigrationManifest(source, { assets: [] }), /Expected 1 image assets/);
});

test("detects PNG, JPEG, and WebP content and computes stable checksums", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const webp = Buffer.from("RIFF0000WEBP", "ascii");
  assert.equal(detectImageContentType(png), "image/png");
  assert.equal(detectImageContentType(jpeg), "image/jpeg");
  assert.equal(detectImageContentType(webp), "image/webp");
  assert.equal(imageChecksum(png), imageChecksum(Buffer.from(png)));
  assert.equal(detectImageContentType(Buffer.from("not-an-image")), "");
});

test("writes cloud asset metadata and resets only unfinished video nodes", () => {
  const source = workflowExport();
  const graph = prepareImportedWorkflowGraph(source.graph, [{
    id: "cloud-asset",
    nodeId: "image-result",
    name: "reference.webp",
    contentType: "image/webp",
  }]);
  const image = graph.nodes.find((node) => node.id === "image-result");
  const scheduler = graph.nodes.find((node) => node.id === "video-scheduler");
  const video = graph.nodes.find((node) => node.id === "video-result");
  assert.equal(image.assetId, "cloud-asset");
  assert.equal(image.resultUrl, "/api/workflow/assets/cloud-asset");
  assert.equal(image.assetMimeType, "image/webp");
  assert.equal(scheduler.error, "");
  assert.equal(video.status, "ready");
  assert.equal(video.progress, "待生成");
  assert.equal(video.error, "");
  assert.equal(video.taskId, undefined);
});
