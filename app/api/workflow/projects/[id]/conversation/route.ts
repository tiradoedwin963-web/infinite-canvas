import {
  parseAgentConversationStore,
  serializeAgentConversationStore,
} from "@/app/ai/agent";
import { assertSameOrigin, requireSessionUser, responseFromError } from "@/app/server/auth";
import { getDatabase } from "@/app/server/database";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(request);
    const { id } = await context.params;
    const input = await request.json() as { conversation?: unknown; revision?: unknown };
    if (!Number.isInteger(input.revision) || Number(input.revision) < 1) {
      return Response.json({ error: "对话修订号无效。" }, { status: 400 });
    }
    const parsed = parseAgentConversationStore(JSON.stringify(input.conversation), null);
    const conversation = JSON.parse(serializeAgentConversationStore(parsed)) as unknown;
    const sql = getDatabase();
    const updated = await sql`
      UPDATE canvas_project_conversations
      SET payload = ${sql.json(conversation)}, revision = revision + 1, updated_at = now()
      WHERE project_id = ${id} AND owner_id = ${user.id} AND revision = ${Number(input.revision)}
      RETURNING revision, updated_at
    `;
    if (updated[0]) return Response.json(updated[0]);
    const exists = await sql`
      SELECT revision FROM canvas_project_conversations WHERE project_id = ${id} AND owner_id = ${user.id}
    `;
    return exists[0]
      ? Response.json({ error: "对话已在其他设备更新。", revision: exists[0].revision }, { status: 409 })
      : Response.json({ error: "项目不存在。" }, { status: 404 });
  } catch (error) {
    return responseFromError(error, "无法保存对话。");
  }
}
