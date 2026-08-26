import { WORKFLOW_AGENT_CONVERSATIONS_STORAGE_KEY } from "../ai/agent.ts";
import type { Viewport } from "../canvas/viewport.ts";
import { WORKFLOW_BATCH_STORAGE_KEY } from "./agent.ts";
import {
  WORKFLOW_STORAGE_KEY,
  emptyWorkflowGraph,
  parseWorkflowGraph,
  type WorkflowGraph,
} from "./graph.ts";
import { relayoutStoryAssets } from "./story-assets.ts";
import { emptyTvcWorkflowGraph } from "./tvc.ts";

export const WORKFLOW_PROJECTS_STORAGE_KEY = "lingke-workflow-projects-v1";
export const WORKFLOW_ASSET_LAYOUT_MIGRATION_KEY =
  "lingke-workflow-asset-kind-layout-v1";
export const WORKFLOW_PROJECTS_VERSION = 1;

export type WorkflowProjectMode = "workflow" | "tvc";

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

export type ImportedWorkflowProjectAsset = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type ImportedWorkflowProject = {
  project: WorkflowProject;
  registry: WorkflowProjectRegistry;
  graph: WorkflowGraph;
  viewport: Viewport;
  batch: null;
  conversation: unknown;
  assets: ImportedWorkflowProjectAsset[];
};

export type ImportedWorkflowAssetRemap = {
  assetId: string;
  assetUrl?: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const LOCAL_PROJECT_EXPORT_KEYS = new Set([
  "version",
  "exportedAt",
  "project",
  "graph",
  "viewport",
  "batch",
  "conversation",
  "assets",
]);
const IMPORTABLE_IMAGE_MIME_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);
const MAX_IMPORTED_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_IMPORTED_ASSET_TOTAL_BYTES = 100 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

export function createWorkflowProjectGraph(
  mode: WorkflowProjectMode,
  idFactory: () => string = () => crypto.randomUUID(),
): WorkflowGraph {
  return mode === "tvc" ? emptyTvcWorkflowGraph(idFactory) : emptyWorkflowGraph();
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

function parseImportedGraph(value: unknown): WorkflowGraph {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error("导入文件中的工作流图无效。");
  }
  const graph = parseWorkflowGraph(JSON.stringify(value));
  const rawNodeIds = value.nodes.map((node) => isRecord(node) ? node.id : undefined);
  const rawEdgeIds = value.edges.map((edge) => isRecord(edge) ? edge.id : undefined);
  if (
    graph.nodes.length !== value.nodes.length ||
    graph.edges.length !== value.edges.length ||
    new Set(rawNodeIds).size !== rawNodeIds.length ||
    new Set(rawEdgeIds).size !== rawEdgeIds.length ||
    (value.tvc !== undefined && graph.tvc === undefined)
  ) {
    throw new Error("导入文件中的工作流图无效。");
  }
  return graph;
}

function referencedImageAssetIds(graph: WorkflowGraph) {
  const ids = new Set<string>();
  graph.nodes.forEach((node) => {
    if (
      (node.type === "source" || node.type === "result") &&
      node.kind === "image" &&
      node.assetId
    ) {
      ids.add(node.assetId);
    }
  });
  return ids;
}

function remapImportedGraphAssets(graph: WorkflowGraph, projectId: string) {
  const assetIds = referencedImageAssetIds(graph);
  const remappedAssetIds = new Map<string, string>();
  [...assetIds].forEach((assetId, index) => {
    remappedAssetIds.set(assetId, `${projectId}-asset-${index + 1}`);
  });
  return {
    graph: {
      ...graph,
      nodes: graph.nodes.map((node) => {
        if (
          (node.type !== "source" && node.type !== "result") ||
          node.kind !== "image" ||
          !node.assetId
        ) {
          return node;
        }
        const assetId = remappedAssetIds.get(node.assetId);
        return assetId ? { ...node, assetId } : node;
      }),
    },
    remappedAssetIds,
  };
}

function defaultCloudAssetUrl(assetId: string) {
  return `/api/workflow/assets/${encodeURIComponent(assetId)}`;
}

/**
 * Rebinds an already validated local import to the asset IDs allocated by the
 * cloud upload-ticket flow. The importer deliberately keeps TVC's logical
 * project ID untouched: it is part of the locked brief/shot data rather than
 * the cloud project's database ID.
 */
export function rebindImportedWorkflowAssets(
  graph: WorkflowGraph,
  uploadedAssets: ReadonlyMap<string, ImportedWorkflowAssetRemap>,
): WorkflowGraph {
  const referencedAssetIds = referencedImageAssetIds(graph);
  for (const assetId of referencedAssetIds) {
    const uploaded = uploadedAssets.get(assetId);
    if (!uploaded || !uploaded.assetId.trim()) {
      throw new Error("导入图片素材未完整上传，无法创建云端项目。");
    }
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (
        (node.type !== "source" && node.type !== "result") ||
        node.kind !== "image" ||
        !node.assetId
      ) {
        return node;
      }
      const uploaded = uploadedAssets.get(node.assetId)!;
      if (node.type === "source") {
        return { ...node, assetId: uploaded.assetId };
      }
      return {
        ...node,
        assetId: uploaded.assetId,
        resultUrl: uploaded.assetUrl || defaultCloudAssetUrl(uploaded.assetId),
      };
    }),
  };
}

function assetEntries(value: unknown): Array<[string | undefined, unknown]> {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map((asset) => [undefined, asset]);
  if (isRecord(value)) return Object.entries(value);
  throw new Error("导入文件中的图片素材无效。");
}

function importedAssetSize(dataUrl: string, mimeType: string) {
  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix)) throw new Error("导入文件中的图片素材无效。");
  const encoded = dataUrl.slice(prefix.length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("导入文件中的图片素材无效。");
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return (encoded.length / 4) * 3 - padding;
}

function parseImportedAssets(
  value: unknown,
  importedGraph: WorkflowGraph,
  remappedAssetIds: ReadonlyMap<string, string>,
) {
  const referenced = referencedImageAssetIds(importedGraph);
  const seen = new Set<string>();
  let totalBytes = 0;
  return assetEntries(value).map(([mapKey, candidate]) => {
    if (!isRecord(candidate)) throw new Error("导入文件中的图片素材无效。");
    const id = typeof candidate.id === "string" && candidate.id
      ? candidate.id
      : mapKey;
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const mimeType = typeof candidate.mimeType === "string" ? candidate.mimeType : "";
    const dataUrl = typeof candidate.dataUrl === "string" ? candidate.dataUrl : "";
    if (
      !id ||
      (mapKey !== undefined && typeof candidate.id === "string" && candidate.id !== mapKey) ||
      !name ||
      !IMPORTABLE_IMAGE_MIME_TYPES.has(mimeType) ||
      !referenced.has(id) ||
      seen.has(id)
    ) {
      throw new Error("导入文件中的图片素材无效。");
    }
    const size = importedAssetSize(dataUrl, mimeType);
    if (size > MAX_IMPORTED_ASSET_BYTES || totalBytes + size > MAX_IMPORTED_ASSET_TOTAL_BYTES) {
      throw new Error("导入文件中的图片素材超过大小限制。");
    }
    seen.add(id);
    totalBytes += size;
    return {
      id: remappedAssetIds.get(id)!,
      name,
      mimeType,
      dataUrl,
    } satisfies ImportedWorkflowProjectAsset;
  });
}

function importedProjectName(registry: WorkflowProjectRegistry, requestedName: string) {
  const name = requestedName.trim();
  if (!registry.projects.some((project) => project.name === name)) return name;
  const base = `${name}-导入`;
  if (!registry.projects.some((project) => project.name === base)) return base;
  let index = 2;
  while (registry.projects.some((project) => project.name === `${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function importedProjectId(
  registry: WorkflowProjectRegistry,
  idFactory: () => string,
) {
  const base = idFactory().trim();
  if (!base) throw new Error("无法创建导入项目。请重试。");
  if (!registry.projects.some((project) => project.id === base)) return base;
  let index = 2;
  while (registry.projects.some((project) => project.id === `${base}-import-${index}`)) {
    index += 1;
  }
  return `${base}-import-${index}`;
}

export function importWorkflowProject(
  registry: WorkflowProjectRegistry,
  raw: string,
  idFactory: () => string = () => crypto.randomUUID(),
  now = Date.now(),
): ImportedWorkflowProject {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("导入文件不是有效的 JSON。");
  }
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !LOCAL_PROJECT_EXPORT_KEYS.has(key)) ||
    value.version !== 1 ||
    typeof value.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(value.exportedAt)) ||
    !validProject(value.project) ||
    value.batch !== null ||
    !isRecord(value.conversation)
  ) {
    throw new Error("导入文件不是受支持的 .canvas.json 项目。");
  }
  const importedGraph = parseImportedGraph(value.graph);
  const projectId = importedProjectId(registry, idFactory);
  const remapped = remapImportedGraphAssets(importedGraph, projectId);
  const project: WorkflowProject = {
    id: projectId,
    name: importedProjectName(registry, value.project.name),
    createdAt: now,
    updatedAt: now,
  };
  const assets = parseImportedAssets(value.assets, importedGraph, remapped.remappedAssetIds);
  return {
    project,
    registry: {
      ...registry,
      activeProjectId: project.id,
      projects: [...registry.projects, project],
    },
    graph: remapped.graph,
    viewport: parseWorkflowViewport(JSON.stringify(value.viewport)),
    batch: null,
    conversation: value.conversation,
    assets,
  };
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

export function migrateActiveWorkflowAssetLayout(
  storage: StorageLike,
  registry: WorkflowProjectRegistry,
) {
  if (storage.getItem(WORKFLOW_ASSET_LAYOUT_MIGRATION_KEY) === "done") {
    return false;
  }
  const graphKey = workflowProjectGraphKey(registry.activeProjectId);
  const graph = parseWorkflowGraph(storage.getItem(graphKey));
  const migrated = relayoutStoryAssets(graph);
  if (migrated !== graph) {
    storage.setItem(graphKey, JSON.stringify(migrated));
  }
  storage.setItem(WORKFLOW_ASSET_LAYOUT_MIGRATION_KEY, "done");
  return true;
}

export function projectSourceAssetIds(graph: WorkflowGraph) {
  return new Set(graph.nodes.flatMap((node) =>
    node.type === "source" && node.assetId ? [node.assetId] : []
  ));
}
