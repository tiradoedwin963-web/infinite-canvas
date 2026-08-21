import type { AgentConversationStore } from "../ai/agent.ts";
import type { Viewport } from "../canvas/viewport.ts";
import type { WorkflowBatchRun } from "./agent.ts";
import type { WorkflowGraph } from "./graph.ts";
import type { WorkflowProjectRegistry } from "./projects.ts";

type CloudProjectRow = {
  id: string;
  name: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type CloudProjectDocument = {
  id: string;
  name: string;
  graph: WorkflowGraph;
  viewport: Viewport;
  batch: WorkflowBatchRun | null;
  revision: number;
  conversation: AgentConversationStore;
  conversationRevision: number;
  assetVersions: Record<string, string>;
};

export type CloudRequestErrorCategory =
  | "session-expired"
  | "source-denied"
  | "project-missing"
  | "revision-conflict"
  | "server-unavailable"
  | "network-interruption"
  | "request-rejected";

const CLOUD_REQUEST_ERROR_MESSAGES: Record<CloudRequestErrorCategory, string> = {
  "session-expired": "登录状态已失效，请重新登录后再保存。",
  "source-denied": "当前来源未获允许，无法保存项目。",
  "project-missing": "项目已不存在或无权访问。",
  "revision-conflict": "项目已在其他设备更新，请重新加载或另存副本。",
  "server-unavailable": "云端暂时不可用，请稍后重试。",
  "network-interruption": "网络连接中断，未能保存项目。",
  "request-rejected": "云端请求未被接受，请稍后重试。",
};

export class CloudRequestError extends Error {
  readonly category: CloudRequestErrorCategory;
  readonly status?: number;
  readonly revision?: number;

  constructor(input: {
    category: CloudRequestErrorCategory;
    status?: number;
    revision?: number;
  }) {
    super(CLOUD_REQUEST_ERROR_MESSAGES[input.category]);
    this.name = "CloudRequestError";
    this.category = input.category;
    this.status = input.status;
    this.revision = input.revision;
  }
}

export function isCloudRequestError(error: unknown): error is CloudRequestError {
  return error instanceof CloudRequestError;
}

export function describeCloudRequestError(error: unknown): string {
  return isCloudRequestError(error)
    ? error.message
    : CLOUD_REQUEST_ERROR_MESSAGES["request-rejected"];
}

function cloudRequestErrorCategory(status: number): CloudRequestErrorCategory {
  if (status === 401) return "session-expired";
  if (status === 403) return "source-denied";
  if (status === 404) return "project-missing";
  if (status === 409) return "revision-conflict";
  if (status >= 500) return "server-unavailable";
  return "request-rejected";
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new CloudRequestError({ category: "network-interruption" });
  }
  const payload = await response.json().catch(() => ({})) as T & {
    revision?: number;
  };
  if (!response.ok) {
    throw new CloudRequestError({
      category: cloudRequestErrorCategory(response.status),
      status: response.status,
      revision: payload.revision,
    });
  }
  return payload;
}
function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function loadCloudProjects(): Promise<WorkflowProjectRegistry> {
  const payload = await requestJson<{
    projects: CloudProjectRow[];
    activeProjectId: string;
  }>("/api/workflow/projects", { cache: "no-store" });
  return {
    version: 1,
    activeProjectId: payload.activeProjectId,
    projects: payload.projects.map((project) => ({
      id: project.id,
      name: project.name,
      createdAt: Date.parse(project.created_at),
      updatedAt: Date.parse(project.updated_at),
    })),
  };
}

export async function loadCloudProject(projectId: string): Promise<CloudProjectDocument> {
  const payload = await requestJson<{
    id: string;
    name: string;
    graph: WorkflowGraph;
    viewport: Viewport;
    batch: WorkflowBatchRun | null;
    revision: number;
    conversation: AgentConversationStore;
    conversation_revision: number;
    asset_versions: Record<string, string>;
  }>(`/api/workflow/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
  return {
    ...payload,
    conversationRevision: payload.conversation_revision,
    assetVersions: payload.asset_versions,
  };
}

export function createCloudProject(name: string) {
  return requestJson<{ id: string; name: string; revision: number }>(
    "/api/workflow/projects",
    jsonRequest("POST", { name }),
  );
}

export function cloneCloudStoryboardProject(projectId: string, name: string) {
  return requestJson<{ id: string; name: string; revision: number }>(
    `/api/workflow/projects/${encodeURIComponent(projectId)}/clone-storyboard`,
    jsonRequest("POST", { name }),
  );
}

export function activateCloudProject(activeProjectId: string) {
  return requestJson<{ ok: true }>(
    "/api/workflow/projects",
    jsonRequest("PATCH", { activeProjectId }),
  );
}

export function saveCloudProject(input: {
  id: string;
  name: string;
  graph: WorkflowGraph;
  viewport: Viewport;
  batch: WorkflowBatchRun | null;
  revision: number;
}) {
  return requestJson<{ revision: number; updated_at: string }>(
    `/api/workflow/projects/${encodeURIComponent(input.id)}`,
    jsonRequest("PUT", input),
  );
}

export function deleteCloudProject(projectId: string) {
  return requestJson<{ ok: true }>(
    `/api/workflow/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
  );
}

export function saveCloudConversation(input: {
  projectId: string;
  conversation: AgentConversationStore;
  revision: number;
}) {
  return requestJson<{ revision: number; updated_at: string }>(
    `/api/workflow/projects/${encodeURIComponent(input.projectId)}/conversation`,
    jsonRequest("PUT", input),
  );
}

export async function uploadCloudAsset(input: {
  projectId: string;
  nodeId: string;
  file: File;
}) {
  const ticket = await requestJson<{
    assetId: string;
    uploadUrl: string;
    headers: Record<string, string>;
  }>("/api/workflow/assets/upload-ticket", jsonRequest("POST", {
    projectId: input.projectId,
    nodeId: input.nodeId,
    name: input.file.name,
    mimeType: input.file.type,
    byteSize: input.file.size,
  }));
  const uploaded = await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: ticket.headers,
    body: input.file,
  });
  if (!uploaded.ok) throw new Error("素材上传到对象存储失败。");
  const completed = await requestJson<{ assetVersion: string }>(
    "/api/workflow/assets/complete",
    jsonRequest("POST", {
    assetId: ticket.assetId,
    }),
  );
  return { assetId: ticket.assetId, assetVersion: completed.assetVersion };
}

export async function readCloudAsset(assetId: string, version?: string) {
  const response = await fetch(cloudAssetUrl(assetId, version));
  if (!response.ok) throw new Error("素材已失效，请重新上传。");
  return response.blob();
}

export function cloudAssetUrl(assetId: string, version?: string, thumbnail = false) {
  const query = new URLSearchParams();
  if (version) query.set("v", version);
  if (thumbnail) query.set("variant", "thumbnail");
  const suffix = query.size ? `?${query.toString()}` : "";
  return `/api/workflow/assets/${encodeURIComponent(assetId)}${suffix}`;
}

export async function readCloudAssetThumbnail(assetId: string, version: string) {
  const response = await fetch(cloudAssetUrl(assetId, version, true));
  if (!response.ok) throw new Error("素材缩略图加载失败。");
  return {
    blob: await response.blob(),
    cacheable: response.headers.get("x-canvas-asset-variant") === "thumbnail",
  };
}

export async function deleteCloudAsset(assetId: string) {
  const response = await fetch(`/api/workflow/assets/${encodeURIComponent(assetId)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error("无法删除云端素材。");
  }
}
