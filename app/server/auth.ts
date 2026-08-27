import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDatabase, type AuthenticatedUser } from "./database";
import {
  canvasAdminUsername,
  canvasAuthenticationDisabled,
  cloudPersistenceEnabled,
} from "./config";
import { requestOrigin } from "./request-origin";

export const SESSION_COOKIE = "canvas_session";
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 30;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (origin !== requestOrigin(request)) {
    throw new Response(JSON.stringify({ error: "请求来源无效。" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function readSessionUser(request: Request): Promise<AuthenticatedUser | null> {
  if (canvasAuthenticationDisabled()) return readConfiguredAdminUser();
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const sql = getDatabase();
  const rows = await sql<{
    id: string;
    username: string;
    is_admin: boolean;
  }[]>`
    SELECT users.id, users.username, users.is_admin
    FROM canvas_sessions AS sessions
    JOIN canvas_users AS users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ${tokenHash(token)}
      AND sessions.expires_at > now()
      AND users.disabled_at IS NULL
    LIMIT 1
  `;
  const user = rows[0];
  return user ? { id: user.id, username: user.username, isAdmin: user.is_admin } : null;
}

async function readConfiguredAdminUser(): Promise<AuthenticatedUser> {
  const username = canvasAdminUsername();
  const rows = await getDatabase()<{
    id: string;
    username: string;
    is_admin: boolean;
  }[]>`
    SELECT id, username, is_admin
    FROM canvas_users
    WHERE lower(username) = lower(${username})
      AND is_admin = true
      AND disabled_at IS NULL
    LIMIT 1
  `;
  const user = rows[0];
  if (!user) {
    throw new Error(`认证已关闭，但未找到可用管理员账号“${username}”。`);
  }
  return { id: user.id, username: user.username, isAdmin: user.is_admin };
}

export async function requireSessionUser(request: Request) {
  const user = await readSessionUser(request);
  if (!user) {
    throw new Response(JSON.stringify({ error: "请先登录。" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return user;
}

export async function requireSessionWhenCloud(request: Request) {
  return cloudPersistenceEnabled() ? requireSessionUser(request) : null;
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const sql = getDatabase();
  await sql`
    INSERT INTO canvas_sessions (id, user_id, token_hash, expires_at)
    VALUES (${randomUUID()}, ${userId}, ${tokenHash(token)}, now() + interval '30 days')
  `;
  return token;
}

export async function deleteSession(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return;
  await getDatabase()`DELETE FROM canvas_sessions WHERE token_hash = ${tokenHash(token)}`;
}

export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_AGE_SECONDS}`;
}

export function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function responseFromError(error: unknown, fallback = "服务端请求失败。") {
  if (error instanceof Response) return error;
  console.error("[canvas-api]", error instanceof Error ? error.message : "Unknown server error");
  return Response.json({ error: fallback }, { status: 500 });
}
