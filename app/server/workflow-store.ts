import { randomUUID } from "node:crypto";
import { emptyWorkflowGraph, parseWorkflowGraph, type WorkflowGraph } from "../workflow/graph";
import { parseWorkflowViewport } from "../workflow/projects";
import { getDatabase } from "./database";

export const EMPTY_CONVERSATIONS = {
  version: 2,
  activeConversationId: "",
  conversations: [],
};

export function validateGraph(value: unknown): WorkflowGraph {
  if (!value || typeof value !== "object") throw new Error("项目图数据无效。");
  const candidate = value as { version?: unknown; nodes?: unknown; edges?: unknown };
  if (candidate.version !== 1 || !Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) {
    throw new Error("项目图数据无效。");
  }
  const parsed = parseWorkflowGraph(JSON.stringify(value));
  if (parsed.nodes.length !== candidate.nodes.length || parsed.edges.length !== candidate.edges.length) {
    throw new Error("项目图包含无效节点或连线。");
  }
  return parsed;
}

export function validateViewport(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("视口数据无效。");
  const viewport = value as { x?: unknown; y?: unknown; scale?: unknown };
  if (
    typeof viewport.x !== "number" || !Number.isFinite(viewport.x) ||
    typeof viewport.y !== "number" || !Number.isFinite(viewport.y) ||
    typeof viewport.scale !== "number" || !Number.isFinite(viewport.scale) ||
    viewport.scale < 0.25 || viewport.scale > 4
  ) throw new Error("视口数据无效。");
  return parseWorkflowViewport(JSON.stringify(value));
}

export function cleanProjectName(value: unknown) {
  if (typeof value !== "string") throw new Error("项目名称无效。");
  const name = value.trim();
  if (!name || name.length > 120) throw new Error("项目名称长度必须为 1–120 个字符。");
  return name;
}

export async function ensureDefaultProject(userId: string) {
  const sql = getDatabase();
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM canvas_projects WHERE owner_id = ${userId} ORDER BY created_at LIMIT 1
  `;
  if (existing[0]) return existing[0].id;
  const id = randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO canvas_projects (id, owner_id, name, graph, viewport)
      VALUES (
        ${id}, ${userId}, ${"未命名项目"},
        ${transaction.json(emptyWorkflowGraph())},
        ${transaction.json({ x: 0, y: 0, scale: 1 })}
      )
    `;
    await transaction`
      INSERT INTO canvas_project_conversations (project_id, owner_id, payload)
      VALUES (${id}, ${userId}, ${transaction.json(EMPTY_CONVERSATIONS)})
    `;
    await transaction`
      UPDATE canvas_users SET active_project_id = ${id}, updated_at = now() WHERE id = ${userId}
    `;
  });
  return id;
}

export async function projectBelongsToUser(projectId: string, userId: string) {
  const rows = await getDatabase()<[{ exists: boolean }]>`
    SELECT EXISTS(
      SELECT 1 FROM canvas_projects WHERE id = ${projectId} AND owner_id = ${userId}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}
