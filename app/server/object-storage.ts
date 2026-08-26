import { createRequire } from "node:module";
import type COS from "cos-nodejs-sdk-v5";
import { requireEnvironment } from "./config.ts";

export { workflowObjectKey } from "./storage-rules.ts";

let client: COS | undefined;
const requireNodeModule = createRequire(import.meta.url);

function storageConfig() {
  return {
    region: requireEnvironment("COS_REGION"),
    bucket: requireEnvironment("COS_BUCKET"),
  };
}

function storageClient() {
  const COSClient = requireNodeModule("cos-nodejs-sdk-v5") as typeof COS;
  client ??= new COSClient({
    SecretId: requireEnvironment("COS_SECRET_ID"),
    SecretKey: requireEnvironment("COS_SECRET_KEY"),
  });
  return client;
}

export async function createUploadUrl(input: {
  key: string;
  mimeType: string;
  byteSize: number;
}) {
  const config = storageConfig();
  return storageClient().getObjectUrl({
    Bucket: config.bucket,
    Region: config.region,
    Key: input.key,
    Method: "PUT",
    Sign: true,
    Expires: 10 * 60,
    Headers: {
      "content-type": input.mimeType,
    },
  } as COS.GetObjectUrlParams & { Headers: Record<string, string> });
}

export async function createReadUrl(input: {
  key: string;
  expiresSeconds?: number;
}) {
  const config = storageConfig();
  return storageClient().getObjectUrl({
    Bucket: config.bucket,
    Region: config.region,
    Key: input.key,
    Method: "GET",
    Sign: true,
    Expires: input.expiresSeconds ?? 60 * 60 * 24,
  } as COS.GetObjectUrlParams);
}

export async function inspectObject(key: string) {
  const config = storageConfig();
  return storageClient().headObject({
    Bucket: config.bucket,
    Region: config.region,
    Key: key,
  });
}

export async function readObject(key: string, range?: string) {
  const config = storageConfig();
  return storageClient().getObject({
    Bucket: config.bucket,
    Region: config.region,
    Key: key,
    ...(range ? { Range: range } : {}),
  });
}

export async function deleteObject(key: string) {
  const config = storageConfig();
  await storageClient().deleteObject({
    Bucket: config.bucket,
    Region: config.region,
    Key: key,
  });
}

export async function writeObject(input: {
  key: string;
  body: Uint8Array;
  mimeType: string;
}) {
  const config = storageConfig();
  await storageClient().putObject({
    Bucket: config.bucket,
    Region: config.region,
    Key: input.key,
    Body: Buffer.from(input.body),
    ContentType: input.mimeType,
    ContentLength: input.body.byteLength,
    ServerSideEncryption: "AES256",
  });
}
