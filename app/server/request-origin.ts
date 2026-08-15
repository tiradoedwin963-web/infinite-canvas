export function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if ((forwardedProtocol === "http" || forwardedProtocol === "https") && forwardedHost) {
    try {
      return new URL(`${forwardedProtocol}://${forwardedHost}`).origin;
    } catch {
      // Invalid proxy headers fall back to the internal request origin and fail closed.
    }
  }
  return url.origin;
}
