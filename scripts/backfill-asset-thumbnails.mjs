import COS from "cos-nodejs-sdk-v5";
import postgres from "postgres";
import sharp from "sharp";

function environment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const region = environment("COS_REGION");
const bucket = environment("COS_BUCKET");
const storage = new COS({
  SecretId: environment("COS_SECRET_ID"),
  SecretKey: environment("COS_SECRET_KEY"),
});
const sql = postgres(environment("DATABASE_URL"), { max: 2 });
const assets = await sql`
  SELECT id, object_key FROM canvas_assets
  WHERE status = 'ready' AND mime_type LIKE 'image/%'
  ORDER BY created_at
`;
let nextIndex = 0;
let created = 0;
let skipped = 0;
const failures = [];

async function thumbnailExists(key) {
  try {
    await storage.headObject({ Bucket: bucket, Region: region, Key: key });
    return true;
  } catch (error) {
    if (error?.statusCode === 404 || error?.code === "NoSuchKey") return false;
    throw error;
  }
}

async function processAsset(asset) {
  const thumbnailKey = `${asset.object_key}.thumbnail.webp`;
  if (await thumbnailExists(thumbnailKey)) {
    skipped += 1;
    return;
  }
  const original = await storage.getObject({
    Bucket: bucket,
    Region: region,
    Key: asset.object_key,
  });
  if (!(original.Body instanceof Uint8Array)) throw new Error("Invalid COS image body");
  const thumbnail = await sharp(original.Body)
    .rotate()
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  await storage.putObject({
    Bucket: bucket,
    Region: region,
    Key: thumbnailKey,
    Body: thumbnail,
    ContentType: "image/webp",
    ContentLength: thumbnail.byteLength,
    ServerSideEncryption: "AES256",
  });
  created += 1;
}

async function worker() {
  while (nextIndex < assets.length) {
    const asset = assets[nextIndex++];
    try {
      await processAsset(asset);
    } catch (error) {
      failures.push({ id: asset.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
}

try {
  await Promise.all(Array.from({ length: Math.min(2, assets.length) }, () => worker()));
} finally {
  await sql.end();
}

console.log(JSON.stringify({ total: assets.length, created, skipped, failures }, null, 2));
if (failures.length) process.exitCode = 1;
