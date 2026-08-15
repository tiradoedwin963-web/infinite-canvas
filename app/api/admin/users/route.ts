import { randomUUID } from "node:crypto";
import { assertSameOrigin, requireSessionUser, responseFromError } from "@/app/server/auth";
import { getDatabase } from "@/app/server/database";
import { hashPassword, randomTemporaryPassword } from "@/app/server/password";

async function requireAdmin(request: Request) {
  const user = await requireSessionUser(request);
  if (!user.isAdmin) {
    throw new Response(JSON.stringify({ error: "没有管理员权限。" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return user;
}
function cleanUsername(value: unknown) {
  if (typeof value !== "string") throw new Error("用户名无效。");
  const username = value.trim();
  if (!/^[a-zA-Z0-9_.-]{3,48}$/.test(username)) {
    throw new Error("用户名必须为 3–48 位字母、数字、点、横线或下划线。");
  }
  return username;
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const users = await getDatabase()`
      SELECT id, username, is_admin, created_at, updated_at, disabled_at
      FROM canvas_users ORDER BY created_at
    `;
    return Response.json({ users }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responseFromError(error, "无法读取账号列表。");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireAdmin(request);
    const input = await request.json() as { username?: unknown; isAdmin?: unknown };
    const username = cleanUsername(input.username);
    const temporaryPassword = randomTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const id = randomUUID();
    await getDatabase()`
      INSERT INTO canvas_users (id, username, password_hash, is_admin)
      VALUES (${id}, ${username}, ${passwordHash}, ${input.isAdmin === true})
    `;
    return Response.json({
      user: { id, username, isAdmin: input.isAdmin === true },
      temporaryPassword,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return Response.json({ error: "用户名已存在。" }, { status: 409 });
    }
    return responseFromError(error, error instanceof Error ? error.message : "无法创建账号。");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const administrator = await requireAdmin(request);
    const input = await request.json() as {
      userId?: unknown;
      action?: unknown;
      disabled?: unknown;
    };
    const userId = typeof input.userId === "string" ? input.userId : "";
    const sql = getDatabase();
    if (input.action === "reset-password") {
      const temporaryPassword = randomTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      const updated = await sql`
        UPDATE canvas_users SET password_hash = ${passwordHash}, updated_at = now()
        WHERE id = ${userId} RETURNING id, username
      `;
      if (!updated[0]) return Response.json({ error: "账号不存在。" }, { status: 404 });
      await sql`DELETE FROM canvas_sessions WHERE user_id = ${userId}`;
      return Response.json({ user: updated[0], temporaryPassword }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (input.action === "set-disabled") {
      if (userId === administrator.id && input.disabled === true) {
        return Response.json({ error: "不能停用当前管理员账号。" }, { status: 400 });
      }
      const updated = await sql`
        UPDATE canvas_users
        SET disabled_at = ${input.disabled === true ? sql`now()` : null}, updated_at = now()
        WHERE id = ${userId} RETURNING id, username, disabled_at
      `;
      if (!updated[0]) return Response.json({ error: "账号不存在。" }, { status: 404 });
      if (input.disabled === true) await sql`DELETE FROM canvas_sessions WHERE user_id = ${userId}`;
      return Response.json({ user: updated[0] });
    }
    return Response.json({ error: "账号操作无效。" }, { status: 400 });
  } catch (error) {
    return responseFromError(error, "无法更新账号。");
  }
}
