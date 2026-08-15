import {
  assertSameOrigin,
  deleteSession,
  expiredSessionCookie,
  responseFromError,
} from "@/app/server/auth";

export async function POST(request: Request) {
  try {
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
