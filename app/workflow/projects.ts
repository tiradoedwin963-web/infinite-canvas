import { WORKFLOW_AGENT_CONVERSATIONS_STORAGE_KEY } from "../ai/agent.ts";
import type { Viewport } from "../canvas/viewport.ts";
import { WORKFLOW_BATCH_STORAGE_KEY } from "./agent.ts";
import {
  WORKFLOW_STORAGE_KEY,
  emptyWorkflowGraph,
  parseWorkflowGraph,
  type WorkflowGraph,
} from "./graph.ts";

export const WORKFLOW_PROJECTS_STORAGE_KEY = "lingke-workflow-projects-v1";
export const WORKFLOW_PROJECTS_VERSION = 1;

export type WorkflowProject = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type WorkflowProjectRegistry = {
  version: 1;
  activeProjectId: string;
  projects: WorkflowProject[];
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function workflowProjectGraphKey(projectId: string) {
  return `lingke-workflow-project-${projectId}-canvas-v1`;
}

export function workflowProjectBatchKey(projectId: string) {
  return `lingke-workflow-project-${projectId}-batch-v1`;
}

export function workflowProjectConversationKey(projectId: string) {
  return `lingke-workflow-project-${projectId}-agent-conversations-v1`;
}

export function workflowProjectViewportKey(projectId: string) {
  return `lingke-workflow-project-${projectId}-viewport-v1`;
}

function validProject(value: unknown): value is WorkflowProject {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<WorkflowProject>;
  return typeof project.id === "string" && Boolean(project.id) &&
    typeof project.name === "string" && Boolean(project.name.trim()) &&
    typeof project.createdAt === "number" && Number.isFinite(project.createdAt) &&
    typeof project.updatedAt === "number" && Number.isFinite(project.updatedAt);
}

export function parseWorkflowProjectRegistry(
  raw: string | null,
): WorkflowProjectRegistry | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<WorkflowProjectRegistry>;
    if (value.version !== WORKFLOW_PROJECTS_VERSION || !Array.isArray(value.projects)) {
      return null;
    }
    const projects = value.projects.filter(validProject);
    if (!projects.length || new Set(projects.map((project) => project.id)).size !== projects.length) {
      return null;
    }
    const activeProjectId = projects.some((project) => project.id === value.activeProjectId)
      ? value.activeProjectId!
      : projects[0].id;
    return { version: WORKFLOW_PROJECTS_VERSION, activeProjectId, projects };
  } catch {
    return null;
  }
}

function projectNameFromGraph(graph: WorkflowGraph) {
  const analysis = graph.nodes.find((node) => node.storyRole === "analysis");
  const title = analysis?.label?.split(" · 剧本分析")[0]?.trim();
  return title ? `${title}-旧版` : "默认项目-旧版";
}

export function createWorkflowProject(
  registry: WorkflowProjectRegistry,
  requestedName: string,
  idFactory: () => string = () => crypto.randomUUID(),
  now = Date.now(),
) {
  const name = requestedName.trim();
  if (!name) throw new Error("项目名称不能为空。");
  if (registry.projects.some((project) => project.name === name)) {
    throw new Error("项目名称已存在。");
  }
  const project: WorkflowProject = { id: idFactory(), name, createdAt: now, updatedAt: now };
  return {
    project,
    registry: {
      ...registry,
      activeProjectId: project.id,
      projects: [...registry.projects, project],
    },
  };
}

export function renameWorkflowProject(
  registry: WorkflowProjectRegistry,
  projectId: string,
  requestedName: string,
  now = Date.now(),
) {
  const name = requestedName.trim();
  if (!name) throw new Error("项目名称不能为空。");
  if (registry.projects.some((project) => project.id !== projectId && project.name === name)) {
    throw new Error("项目名称已存在。");
  }
  if (!registry.projects.some((project) => project.id === projectId)) {
    throw new Error("项目已不存在。");
  }
  return {
    ...registry,
    projects: registry.projects.map((project) =>
      project.id === projectId ? { ...project, name, updatedAt: now } : project
    ),
  };
}

export function removeWorkflowProject(
  registry: WorkflowProjectRegistry,
  projectId: string,
  idFactory: () => string = () => crypto.randomUUID(),
  now = Date.now(),
) {
  if (!registry.projects.some((project) => project.id === projectId)) {
    throw new Error("项目已不存在。");
  }
  const remaining = registry.projects.filter((project) => project.id !== projectId);
  if (remaining.length) {
    return {
      version: WORKFLOW_PROJECTS_VERSION,
      activeProjectId: registry.activeProjectId === projectId
        ? remaining[0].id
        : registry.activeProjectId,
      projects: remaining,
    } satisfies WorkflowProjectRegistry;
  }
  const replacement: WorkflowProject = {
    id: idFactory(),
    name: "未命名项目",
    createdAt: now,
    updatedAt: now,
  };
  return {
    version: WORKFLOW_PROJECTS_VERSION,
    activeProjectId: replacement.id,
    projects: [replacement],
  } satisfies WorkflowProjectRegistry;
}

export function parseWorkflowViewport(raw: string | null): Viewport {
  if (!raw) return { x: 0, y: 0, scale: 1 };
  try {
    const value = JSON.parse(raw) as Partial<Viewport>;
    if (
      typeof value.x === "number" && Number.isFinite(value.x) &&
      typeof value.y === "number" && Number.isFinite(value.y) &&
      typeof value.scale === "number" && Number.isFinite(value.scale) &&
      value.scale >= 0.25 && value.scale <= 4
    ) {
      return { x: value.x, y: value.y, scale: value.scale };
    }
  } catch {
    // Use the default viewport.
  }
  return { x: 0, y: 0, scale: 1 };
}

export function ensureWorkflowProjectRegistry(
  storage: StorageLike,
  idFactory: () => string = () => crypto.randomUUID(),
  now = Date.now(),
) {
  const existing = parseWorkflowProjectRegistry(
    storage.getItem(WORKFLOW_PROJECTS_STORAGE_KEY),
  );
  if (existing) return existing;

  const graphRaw = storage.getItem(WORKFLOW_STORAGE_KEY);
  const graph = graphRaw ? parseWorkflowGraph(graphRaw) : emptyWorkflowGraph();
  const project: WorkflowProject = {
    id: idFactory(),
    name: projectNameFromGraph(graph),
    createdAt: now,
    updatedAt: now,
  };
  const registry: WorkflowProjectRegistry = {
    version: WORKFLOW_PROJECTS_VERSION,
    activeProjectId: project.id,
    projects: [project],
  };

  storage.setItem(workflowProjectGraphKey(project.id), JSON.stringify(graph));
  const batch = storage.getItem(WORKFLOW_BATCH_STORAGE_KEY);
  if (batch) storage.setItem(workflowProjectBatchKey(project.id), batch);
  const conversation = storage.getItem(WORKFLOW_AGENT_CONVERSATIONS_STORAGE_KEY);
  if (conversation) storage.setItem(workflowProjectConversationKey(project.id), conversation);
  storage.setItem(WORKFLOW_PROJECTS_STORAGE_KEY, JSON.stringify(registry));
  storage.removeItem(WORKFLOW_STORAGE_KEY);
  storage.removeItem(WORKFLOW_BATCH_STORAGE_KEY);
  storage.removeItem(WORKFLOW_AGENT_CONVERSATIONS_STORAGE_KEY);
  return registry;
}

export function projectSourceAssetIds(graph: WorkflowGraph) {
  return new Set(graph.nodes.flatMap((node) =>
    node.type === "source" && node.assetId ? [node.assetId] : []
  ));
}
