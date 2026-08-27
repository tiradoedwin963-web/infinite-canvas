import { getDatabase } from "@/app/server/database";
import {
  assertSameOrigin,
  createSession,
  responseFromError,
  sessionCookie,
} from "@/app/server/auth";
import { canvasAuthenticationDisabled } from "@/app/server/config";
import { verifyPassword } from "@/app/server/password";

const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: Request) {
  try {
    if (canvasAuthenticationDisabled()) {
      return Response.json({ error: "当前服务器已关闭应用登录。" }, { status: 409 });
    }
    assertSameOrigin(request);
    const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const now = Date.now();
    const current = attempts.get(address);
    if (current && current.resetAt > now && current.count >= 8) {
      return Response.json({ error: "登录尝试过多，请稍后再试。" }, { status: 429 });
    }
    const body = await request.json() as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const rows = await getDatabase()<{
      id: string;
      username: string;
      password_hash: string;
      is_admin: boolean;
    }[]>`
      SELECT id, username, password_hash, is_admin
      FROM canvas_users
      WHERE lower(username) = lower(${username}) AND disabled_at IS NULL
      LIMIT 1
    `;
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      attempts.set(address, {
        count: current && current.resetAt > now ? current.count + 1 : 1,
        resetAt: now + 15 * 60_000,
      });
      return Response.json({ error: "用户名或密码不正确。" }, { status: 401 });
    }
    attempts.delete(address);
    const token = await createSession(user.id);
    return Response.json(
      { user: { id: user.id, username: user.username, isAdmin: user.is_admin } },
      { headers: { "Set-Cookie": sessionCookie(token), "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return responseFromError(error, "登录失败。");
  }
}
