import type { ComposerMode } from "./models";

export type GenerateReferenceImage = {
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
};

export type GenerateRequest = {
  mode: ComposerMode;
  model: string;
  prompt: string;
  images?: GenerateReferenceImage[];
  /** Cloud workflow project that owns SD 2.5 reference assets. */
  projectId?: string;
  /** Ordered cloud asset IDs used as SD 2.5 reference images. */
  referenceAssetIds?: string[];
  aspectRatio?: string;
  duration?: string;
  resolution?: string;
};

export type TextGenerateResponse = {
  kind: "text";
  content: string;
};

export type TaskGenerateResponse = {
  kind: "task";
  taskId: string;
};

export type GenerateResponse = TextGenerateResponse | TaskGenerateResponse;

export type TaskState = "pending" | "running" | "success" | "failed";

export type TaskResult = {
  url: string;
  kind: "image" | "video";
  assetId?: string;
  assetName?: string;
  assetMimeType?: string;
  assetVersion?: string;
};

export type TaskStatusResponse = {
  taskId: string;
  state: TaskState;
  isFinal: boolean;
  progress: string;
  results: TaskResult[];
  error: string;
};
