import { createRequire } from "node:module";

const loadRuntimeDependency = createRequire(`${process.cwd()}/package.json`);
const sharp = loadRuntimeDependency("sharp") as typeof import("sharp");

export const THUMBNAIL_MAX_EDGE = 640;
export const THUMBNAIL_WEBP_QUALITY = 82;

export function objectBodyBytes(body: unknown): Uint8Array {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === "string") return new TextEncoder().encode(body);
  throw new Error("对象存储返回了无法读取的素材内容。");
}

export async function createImageThumbnail(body: Uint8Array) {
  const output = await sharp(body)
    .rotate()
    .resize({
      width: THUMBNAIL_MAX_EDGE,
      height: THUMBNAIL_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: THUMBNAIL_WEBP_QUALITY })
    .toBuffer();
  return new Uint8Array(output);
}
