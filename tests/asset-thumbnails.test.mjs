import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { cloudThumbnailId } from "../app/canvas/assets.ts";
import {
  assetContentVersion,
  workflowThumbnailObjectKey,
} from "../app/server/storage-rules.ts";
import {
  createImageThumbnail,
  THUMBNAIL_MAX_EDGE,
  THUMBNAIL_WEBP_QUALITY,
} from "../app/server/thumbnails.ts";

test("workflow thumbnail keys and browser cache keys stay isolated", () => {
  assert.equal(
    workflowThumbnailObjectKey("users/u/projects/p/assets/a"),
    "users/u/projects/p/assets/a.thumbnail.webp",
  );
  assert.notEqual(cloudThumbnailId("user-a", "asset"), cloudThumbnailId("user-b", "asset"));
  assert.equal(assetContentVersion("checksum", new Date(0)), "checksum");
  assert.equal(assetContentVersion(null, new Date(0)), "1970-01-01T00:00:00.000Z");
});

test("image thumbnails auto-orient, preserve ratio and never exceed 640px", async () => {
  const original = await sharp({
    create: { width: 1200, height: 400, channels: 3, background: "white" },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const thumbnail = await createImageThumbnail(original);
  const metadata = await sharp(thumbnail).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 213);
  assert.equal(metadata.height, THUMBNAIL_MAX_EDGE);
  assert.equal(THUMBNAIL_WEBP_QUALITY, 82);
});

test("small source images are not enlarged", async () => {
  const original = await sharp({
    create: { width: 100, height: 50, channels: 3, background: "white" },
  }).png().toBuffer();
  const metadata = await sharp(await createImageThumbnail(original)).metadata();
  assert.equal(metadata.width, 100);
  assert.equal(metadata.height, 50);
});

test("workflow cloud image cards use cached thumbnails while detail and generation keep originals", async () => {
  const [canvas, client, assetRoute] = await Promise.all([
    readFile(new URL("../components/workflow/workflow-canvas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workflow/cloud-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workflow/assets/[id]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(canvas, /readCloudThumbnail/);
  assert.match(canvas, /readCloudAssetThumbnail/);
  assert.match(canvas, /cloudAssetUrl\(detailNode\.assetId/);
  assert.match(canvas, /readCloudAsset\(assetId, assetVersionsRef\.current\[assetId\]\)/);
  assert.match(canvas, /Math\.min\(6, candidates\.length\)/);
  assert.match(client, /variant.*thumbnail/s);
  assert.match(assetRoute, /X-Canvas-Asset-Variant/);
  assert.match(assetRoute, /max-age=31536000, immutable/);
  assert.match(assetRoute, /workflowThumbnailObjectKey/);
});
