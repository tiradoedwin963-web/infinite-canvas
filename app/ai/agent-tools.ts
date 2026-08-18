import {
  normalizeAgentModelId,
  type AgentCreateStoryAnalysisOperation,
  type AgentCreateStoryAssetBatchOperation,
  type AgentCreateStoryWorkflowOperation,
  type AgentOperation,
  type AgentResponse,
} from "./agent.ts";
import { DEFAULT_MODEL_BY_MODE, getModelConfig } from "./models.ts";

const STORY_ASSET_DEFAULT_IMAGE_MODEL = "gpt-image-2";

function parseRatio(value: string) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

function ratioDirection(value: number) {
  if (value === 1) return 0;
  return value > 1 ? 1 : -1;
}

function closestRatio(requested: string, supported: readonly string[]) {
  if (supported.includes(requested)) return requested;
  const requestedValue = parseRatio(requested);
  if (requestedValue === null) return supported[0] ?? "";
  const candidates = supported
    .map((value, index) => ({ value, index, ratio: parseRatio(value) }))
    .filter(
      (candidate): candidate is { value: string; index: number; ratio: number } =>
        candidate.ratio !== null,
    );
  const sameDirection = candidates.filter(
    (candidate) =>
      ratioDirection(candidate.ratio) === ratioDirection(requestedValue),
  );
  return [...(sameDirection.length ? sameDirection : candidates)].sort(
    (left, right) =>
      Math.abs(Math.log(left.ratio / requestedValue)) -
        Math.abs(Math.log(right.ratio / requestedValue)) ||
      left.index - right.index,
  )[0]?.value ?? supported[0] ?? "";
}

function parseResolution(value: string) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(K|p)$/i);
  return match
    ? { amount: Number(match[1]), unit: match[2].toLowerCase() }
    : null;
}

function closestResolution(
  requested: string,
  supported: readonly string[],
  fallback: string,
) {
  if (supported.includes(requested)) return requested;
  const requestedValue = parseResolution(requested);
  if (!requestedValue) return fallback;
  const candidates = supported
    .map((value, index) => ({ value, index, parsed: parseResolution(value) }))
    .filter(
      (candidate): candidate is {
        value: string;
        index: number;
        parsed: { amount: number; unit: string };
      } => candidate.parsed?.unit === requestedValue.unit,
    );
  return [...candidates].sort(
    (left, right) =>
      Math.abs(left.parsed.amount - requestedValue.amount) -
        Math.abs(right.parsed.amount - requestedValue.amount) ||
      left.parsed.amount - right.parsed.amount ||
      left.index - right.index,
  )[0]?.value ?? fallback;
}

export function normalizeAgentImageOperation(
  operation: Extract<AgentOperation, { type: "generate_content" }>,
) {
  if (operation.mode !== "image") return operation;
  const modelId = normalizeAgentModelId(operation.mode, operation.model);
  const model = getModelConfig("image", modelId);
  if (!model) {
    throw new Error(`Agent 选择了未知的图片模型 ${modelId}。`);
  }

  const requestedRatio = operation.aspectRatio?.trim() ?? "";
  const aspectRatio = requestedRatio
    ? closestRatio(requestedRatio, model.aspectRatios)
    : model.aspectRatios[0];
  const defaultResolution = model.defaultResolution ?? model.resolutions[0];
  const requestedResolution = operation.resolution?.trim() ?? "";
  const resolution = requestedResolution
    ? closestResolution(
        requestedResolution,
        model.resolutions,
        defaultResolution,
      )
    : defaultResolution;
  const adjustments: string[] = [];
  if (requestedRatio && requestedRatio !== aspectRatio) {
    adjustments.push(`画面比例由 ${requestedRatio} 调整为 ${aspectRatio}。`);
  }
  if (requestedResolution && requestedResolution !== resolution) {
    adjustments.push(
      `分辨率由 ${requestedResolution} 调整为 ${resolution}。`,
    );
  }

  return {
    type: "generate_content" as const,
    mode: "image" as const,
    model: modelId,
    prompt: operation.prompt,
    referenceNodeIds: operation.referenceNodeIds,
    aspectRatio,
    resolution,
    ...(adjustments.length ? { adjustments } : {}),
  };
}

export function normalizeAgentImageResponse(response: AgentResponse): AgentResponse {
  return {
    ...response,
    operations: response.operations.map((operation) =>
      operation.type === "generate_content"
        ? normalizeAgentImageOperation(operation)
        : operation.type === "create_story_analysis"
          ? normalizeAgentStoryAnalysisOperation(operation)
        : operation.type === "create_story_asset_batch"
          ? normalizeAgentStoryAssetBatchOperation(operation)
        : operation.type === "create_story_workflow"
          ? normalizeAgentStoryWorkflowOperation(operation)
        : operation,
    ),
  };
}

export function normalizeAgentStoryAnalysisOperation(
  operation: AgentCreateStoryAnalysisOperation,
): AgentCreateStoryAnalysisOperation {
  const requestedImageModel = operation.imageModel || STORY_ASSET_DEFAULT_IMAGE_MODEL;
  if (!getModelConfig("image", requestedImageModel)) {
    throw new Error(`Agent 选择了未知的图片模型 ${requestedImageModel}。`);
  }
  const imageModel = STORY_ASSET_DEFAULT_IMAGE_MODEL;
  const model = getModelConfig("image", imageModel)!;
  const requestedRatio = operation.projectAspectRatio || "16:9";
  const projectAspectRatio = closestRatio(requestedRatio, model.aspectRatios);
  const adjustments = [
    ...(requestedImageModel === imageModel
      ? []
      : [`资产图片模型由 ${requestedImageModel} 调整为 ${imageModel}。`]),
    ...(requestedRatio === projectAspectRatio
      ? []
      : [`短剧比例由 ${requestedRatio} 调整为 ${projectAspectRatio}。`]),
  ];
  return {
    ...operation,
    imageModel,
    projectAspectRatio,
    ...(adjustments.length ? { adjustments } : {}),
  };
}

export function normalizeAgentStoryAssetBatchOperation(
  operation: AgentCreateStoryAssetBatchOperation,
): AgentCreateStoryAssetBatchOperation {
  const adjustments: string[] = [];
  const assets = operation.assets.map((asset) => {
    const requestedRatio = asset.aspectRatio || "16:9";
    const requestedResolution = asset.resolution || "1K";
    const aspectRatio = "16:9";
    const resolution = "1K";
    if (requestedRatio !== aspectRatio) {
      adjustments.push(`${asset.name} 比例由 ${requestedRatio} 调整为 ${aspectRatio}。`);
    }
    if (requestedResolution !== resolution) {
      adjustments.push(`${asset.name} 分辨率由 ${requestedResolution} 调整为 ${resolution}。`);
    }
    return { ...asset, aspectRatio, resolution };
  });
  return {
    ...operation,
    assets,
    ...(adjustments.length ? { adjustments } : {}),
  };
}

export function normalizeAgentStoryWorkflowOperation(
  operation: AgentCreateStoryWorkflowOperation,
): AgentCreateStoryWorkflowOperation {
  const imageModel = operation.imageModel || DEFAULT_MODEL_BY_MODE.image;
  const videoModel = operation.videoModel || DEFAULT_MODEL_BY_MODE.video;
  const image = getModelConfig("image", imageModel);
  const video = getModelConfig("video", videoModel);
  if (!image) throw new Error(`Agent 选择了未知的图片模型 ${imageModel}。`);
  if (!video) throw new Error(`Agent 选择了未知的视频模型 ${videoModel}。`);

  const requestedRatio = operation.aspectRatio || "16:9";
  const supportedRatios = image.aspectRatios.filter((ratio) =>
    video.aspectRatios.includes(ratio as (typeof video.aspectRatios)[number]),
  );
  const aspectRatio = closestRatio(requestedRatio, supportedRatios);
  const imageFallback = image.defaultResolution ?? image.resolutions[0];
  const videoFallback = video.defaultResolution ?? video.resolutions[0];
  const imageResolution = closestResolution(
    operation.imageResolution || imageFallback,
    image.resolutions,
    imageFallback,
  );
  const videoResolution = closestResolution(
    operation.videoResolution || videoFallback,
    video.resolutions,
    videoFallback,
  );
  const adjustments: string[] = [];
  if (requestedRatio !== aspectRatio) {
    adjustments.push(`短剧比例由 ${requestedRatio} 调整为 ${aspectRatio}。`);
  }
  if (operation.imageResolution && operation.imageResolution !== imageResolution) {
    adjustments.push(
      `图片分辨率由 ${operation.imageResolution} 调整为 ${imageResolution}。`,
    );
  }
  if (operation.videoResolution && operation.videoResolution !== videoResolution) {
    adjustments.push(
      `视频分辨率由 ${operation.videoResolution} 调整为 ${videoResolution}。`,
    );
  }

  return {
    ...operation,
    imageModel,
    videoModel,
    aspectRatio,
    imageResolution,
    videoResolution,
    shots: operation.shots.map((shot) => ({
      ...shot,
      duration: video.durations.includes(
        shot.duration as (typeof video.durations)[number],
      )
        ? shot.duration
        : video.durations[0],
    })),
    ...(adjustments.length ? { adjustments } : {}),
  };
}
