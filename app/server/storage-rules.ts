import { isIP } from "node:net";

export function workflowObjectKey(userId: string, projectId: string, assetId: string) {
  return `users/${userId}/projects/${projectId}/assets/${assetId}`;
}

export function workflowThumbnailObjectKey(objectKey: string) {
  return `${objectKey}.thumbnail.webp`;
}

export function assetContentVersion(checksum: string | null | undefined, updatedAt: unknown) {
  if (checksum) return checksum;
  if (updatedAt instanceof Date) return updatedAt.toISOString();
  return String(updatedAt ?? "");
}
export function safeUpstreamUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("上游素材地址不安全。");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) {
    throw new Error("上游素材地址不安全。");
  }
  if (isIP(host)) {
    const parts = host.split(".").map(Number);
    const privateV4 = parts.length === 4 && (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
    const privateV6 = host === "::1" || host.startsWith("fc") ||
      host.startsWith("fd") || host.startsWith("fe80:");
    if (privateV4 || privateV6) throw new Error("上游素材地址不安全。");
  }
  return url;
}
