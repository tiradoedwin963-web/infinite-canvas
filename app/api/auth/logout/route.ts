import {
  assertSameOrigin,
  deleteSession,
  expiredSessionCookie,
  responseFromError,
} from "@/app/server/auth";
import { canvasAuthenticationDisabled } from "@/app/server/config";

export async function POST(request: Request) {
  try {
    if (canvasAuthenticationDisabled()) {
      return Response.json(
        { ok: true },
        { headers: { "Set-Cookie": expiredSessionCookie(), "Cache-Control": "no-store" } },
      );
    }
    assertSameOrigin(request);
    await deleteSession(request);
    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": expiredSessionCookie(), "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return responseFromError(error, "退出失败。");
  }
}
