export type ComposerMode = "text" | "image" | "video";

export type ModelProtocol = "openai" | "anthropic" | "gemini" | "media";

export type ImageRequestMapping = {
  aspectRatioParam: "aspectRatio" | "aspect_ratio" | "size";
  aspectRatioFormat: "ratio" | "pixels";
  resolutionParam: "imageSize" | "size";
  quality?: "auto";
};

export type ModelConfig = {
  value: string;
  label: string;
  mode: ComposerMode;
  protocol: ModelProtocol;
  maxReferenceImages: number;
  aspectRatios: readonly string[];
  durations: readonly string[];
  resolutions: readonly string[];
  defaultResolution?: string;
  referenceImagesParam?: "images" | "input_reference" | "image_url";
  imageRequest?: ImageRequestMapping;
  videoResolutionParam?: "resolution";
};

const IMAGE_RATIOS = ["16:9", "1:1", "4:3", "3:4", "9:16"] as const;
const VIDEO_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
const SEEDANCE_2_DURATIONS = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
] as const;
const SEEDANCE_2_5_DURATIONS = [
  "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17",
  "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30",
] as const;

export const MODEL_CONFIGS = {
  text: [
    {
      value: "gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      mode: "text",
      protocol: "openai",
      maxReferenceImages: 5,
      aspectRatios: [],
      durations: [],
      resolutions: [],
    },
    {
      value: "claude-sonnet-5",
      label: "Claude Sonnet 5",
      mode: "text",
      protocol: "anthropic",
      maxReferenceImages: 5,
      aspectRatios: [],
      durations: [],
      resolutions: [],
    },
    {
      value: "gemini-3.1-pro-preview",
      label: "Gemini 3.1 Pro Preview",
      mode: "text",
      protocol: "gemini",
      maxReferenceImages: 5,
      aspectRatios: [],
      durations: [],
      resolutions: [],
    },
    {
      value: "deepseek-v4-pro",
      label: "DeepSeek V4 Pro",
      mode: "text",
      protocol: "openai",
      maxReferenceImages: 5,
      aspectRatios: [],
      durations: [],
      resolutions: [],
    },
    {
      value: "qwen3.7-max",
      label: "Qwen 3.7 Max",
      mode: "text",
      protocol: "openai",
      maxReferenceImages: 5,
      aspectRatios: [],
      durations: [],
      resolutions: [],
    },
  ],
  image: [
    {
      value: "gemini-3-pro-image-preview",
      label: "Nano Banana Pro",
      mode: "image",
      protocol: "media",
      maxReferenceImages: 5,
      aspectRatios: IMAGE_RATIOS,
      durations: [],
      resolutions: ["1K", "2K", "4K"],
      defaultResolution: "1K",
      referenceImagesParam: "images",
      imageRequest: {
        aspectRatioParam: "aspectRatio",
        aspectRatioFormat: "ratio",
        resolutionParam: "imageSize",
      },
    },
    {
      value: "gpt-image-2",
      label: "GPT Image 2",
      mode: "image",
      protocol: "media",
      maxReferenceImages: 5,
      aspectRatios: IMAGE_RATIOS,
      durations: [],
      resolutions: ["1K", "2K", "4K"],
      defaultResolution: "1K",
      referenceImagesParam: "images",
      imageRequest: {
        aspectRatioParam: "size",
        aspectRatioFormat: "pixels",
        resolutionParam: "size",
        quality: "auto",
      },
    },
    {
      value: "gemini-3.1-flash-image-preview",
      label: "Nano Banana 2",
      mode: "image",
      protocol: "media",
      maxReferenceImages: 5,
      aspectRatios: IMAGE_RATIOS,
      durations: [],
      resolutions: ["0.5K", "1K", "2K", "4K"],
      defaultResolution: "1K",
      referenceImagesParam: "images",
      imageRequest: {
        aspectRatioParam: "aspectRatio",
        aspectRatioFormat: "ratio",
        resolutionParam: "imageSize",
      },
    },
    {
      value: "doubao-seedream-5-0-pro-260628",
      label: "Seedream 5.0 Pro",
      mode: "image",
      protocol: "media",
      maxReferenceImages: 5,
      aspectRatios: IMAGE_RATIOS,
      durations: [],
      resolutions: ["1K", "2K"],
      defaultResolution: "1K",
      referenceImagesParam: "images",
      imageRequest: {
        aspectRatioParam: "aspect_ratio",
        aspectRatioFormat: "ratio",
        resolutionParam: "size",
      },
    },
  ],
  video: [
    {
      value: "seedance-2.0",
      label: "Seedance 2.0",
      mode: "video",
      protocol: "media",
      maxReferenceImages: 9,
      aspectRatios: VIDEO_RATIOS,
      durations: SEEDANCE_2_DURATIONS,
      resolutions: ["480p", "720p", "1080p", "4k"],
      defaultResolution: "720p",
      referenceImagesParam: "images",
      videoResolutionParam: "resolution",
    },
    {
      value: "seedance-2.0-fast",
      label: "Seedance 2.0 Fast",
      mode: "video",
      protocol: "media",
      maxReferenceImages: 9,
      aspectRatios: VIDEO_RATIOS,
      durations: SEEDANCE_2_DURATIONS,
      resolutions: ["480p", "720p"],
      defaultResolution: "720p",
      referenceImagesParam: "images",
      videoResolutionParam: "resolution",
    },
    {
      value: "seedance-2.5",
      label: "Seedance 2.5",
      mode: "video",
      protocol: "media",
      maxReferenceImages: 30,
      aspectRatios: VIDEO_RATIOS,
      durations: SEEDANCE_2_5_DURATIONS,
      resolutions: ["480p", "720p"],
      defaultResolution: "720p",
      referenceImagesParam: "images",
      videoResolutionParam: "resolution",
    },
  ],
} as const satisfies Record<ComposerMode, readonly ModelConfig[]>;

export const DEFAULT_MODEL_BY_MODE: Record<ComposerMode, string> = {
  text: MODEL_CONFIGS.text[0].value,
  image: MODEL_CONFIGS.image[0].value,
  video: MODEL_CONFIGS.video[0].value,
};

export const ALL_MODELS: readonly ModelConfig[] = [
  ...MODEL_CONFIGS.text,
  ...MODEL_CONFIGS.image,
  ...MODEL_CONFIGS.video,
];

export function getModelConfig(
  mode: ComposerMode,
  model: string,
): ModelConfig | undefined {
  return MODEL_CONFIGS[mode].find((option) => option.value === model);
}

export function isComposerMode(value: unknown): value is ComposerMode {
  return value === "text" || value === "image" || value === "video";
}
