"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Images,
  Send,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_MODEL_BY_MODE,
  getModelConfig,
  MODEL_CONFIGS,
  type ComposerMode,
} from "@/app/ai/models";

export type ComposerSubmission = {
  mode: ComposerMode;
  model: string;
  prompt: string;
  files: File[];
  aspectRatio?: string;
  duration?: string;
  resolution?: string;
};

type AIChatInputProps = {
  onSubmit: (submission: ComposerSubmission) => Promise<void>;
  isSubmitting: boolean;
  lockedMode?: ComposerMode;
  hidden?: boolean;
};

type DraftImage = {
  id: string;
  file: File;
  previewUrl: string;
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;

const MODE_OPTIONS = [
  { value: "text", label: "文本节点", icon: FileText },
  { value: "image", label: "图片节点", icon: ImageIcon },
  { value: "video", label: "视频节点", icon: Video },
] satisfies Array<{
  value: ComposerMode;
  label: string;
  icon: typeof FileText;
}>;

const PLACEHOLDERS: Record<ComposerMode, string[]> = {
  text: ["写下你想让模型完成的内容……", "描述一个观点、故事或场景……"],
  image: ["描述你想生成的画面……", "写下主体、环境、光线与风格……"],
  video: ["描述你想生成的视频……", "写下动作、运镜、节奏与氛围……"],
};

const PLACEHOLDER_CONTAINER_VARIANTS = {
  initial: {},
  animate: { transition: { staggerChildren: 0.025 } },
  exit: { transition: { staggerChildren: 0.015, staggerDirection: -1 } },
};

const LETTER_VARIANTS = {
  initial: { opacity: 0, filter: "blur(12px)", y: 10 },
  animate: {
    opacity: 1,
    filter: "blur(0px)",
    y: 0,
    transition: {
      opacity: { duration: 0.25 },
      filter: { duration: 0.4 },
      y: { type: "spring" as const, stiffness: 80, damping: 20 },
    },
  },
  exit: {
    opacity: 0,
    filter: "blur(12px)",
    y: -10,
    transition: { duration: 0.2 },
  },
};

function initialAspectRatio(mode: ComposerMode, model: string) {
  return getModelConfig(mode, model)?.aspectRatios[0] ?? "";
}

function initialDuration(mode: ComposerMode, model: string) {
  return getModelConfig(mode, model)?.durations[0] ?? "";
}

function initialResolution(mode: ComposerMode, model: string) {
  return getModelConfig(mode, model)?.defaultResolution ?? "";
}

export function AIChatInput({
  onSubmit,
  isSubmitting,
  lockedMode,
  hidden = false,
}: AIChatInputProps) {
  const startingMode = lockedMode ?? "text";
  const startingModel = DEFAULT_MODEL_BY_MODE[startingMode];
  const [isActive, setIsActive] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [mode, setMode] = useState<ComposerMode>(startingMode);
  const [model, setModel] = useState(startingModel);
  const [aspectRatio, setAspectRatio] = useState(() =>
    initialAspectRatio(startingMode, startingModel),
  );
  const [duration, setDuration] = useState(() =>
    initialDuration(startingMode, startingModel),
  );
  const [resolution, setResolution] = useState(() =>
    initialResolution(startingMode, startingModel),
  );
  const [images, setImages] = useState<DraftImage[]>([]);
  const [error, setError] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [showPlaceholder, setShowPlaceholder] = useState(true);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<DraftImage[]>([]);
  const selectedMode = MODE_OPTIONS.find((option) => option.value === mode)!;
  const selectedModel = getModelConfig(mode, model)!;
  const ModeIcon = selectedMode.icon;
  const isExpanded = isActive || Boolean(inputValue) || images.length > 0;
  const tooManyImages = images.length > selectedModel.maxReferenceImages;
  const hasValidResolution =
    selectedModel.resolutions.length === 0 ||
    selectedModel.resolutions.includes(resolution);
  const canSubmit =
    Boolean(inputValue.trim()) &&
    !isSubmitting &&
    !tooManyImages &&
    hasValidResolution;

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
  }, []);

  useEffect(() => {
    if (isExpanded) return;
    const interval = window.setInterval(() => {
      setShowPlaceholder(false);
      window.setTimeout(() => {
        setPlaceholderIndex(
          (current) => (current + 1) % PLACEHOLDERS[mode].length,
        );
        setShowPlaceholder(true);
      }, 300);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [isExpanded, mode]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node) &&
        !inputValue &&
        images.length === 0
      ) {
        setIsActive(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [images.length, inputValue]);

  function clearImages() {
    images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    setImages([]);
  }

  function changeMode(nextMode: ComposerMode) {
    const nextModel = DEFAULT_MODEL_BY_MODE[nextMode];
    setMode(nextMode);
    setModel(nextModel);
    setAspectRatio(initialAspectRatio(nextMode, nextModel));
    setDuration(initialDuration(nextMode, nextModel));
    setResolution(initialResolution(nextMode, nextModel));
    setPlaceholderIndex(0);
    setShowPlaceholder(true);
    setError("");
    clearImages();
  }

  function changeModel(nextModel: string) {
    setModel(nextModel);
    setAspectRatio(initialAspectRatio(mode, nextModel));
    setDuration(initialDuration(mode, nextModel));
    setResolution(initialResolution(mode, nextModel));
    setError("");
  }

  function addImages(files: FileList | null) {
    if (!files) return;
    const nextFiles = [...files];
    if (nextFiles.some((file) => !file.type.startsWith("image/"))) {
      setError("仅支持图片文件。");
      return;
    }
    if (nextFiles.some((file) => file.size > MAX_FILE_BYTES)) {
      setError("单张参考图不能超过 10MB。");
      return;
    }
    const totalBytes = [...images.map((image) => image.file), ...nextFiles].reduce(
      (total, file) => total + file.size,
      0,
    );
    if (totalBytes > MAX_TOTAL_BYTES) {
      setError("参考图总大小不能超过 30MB。");
      return;
    }
    if (images.length + nextFiles.length > 5) {
      setError("首版最多上传 5 张参考图。");
      return;
    }
    setImages((current) => [
      ...current,
      ...nextFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeImage(id: string) {
    setImages((current) => {
      const removed = current.find((image) => image.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((image) => image.id !== id);
    });
    setError("");
  }

  async function submit() {
    if (!canSubmit) return;
    setError("");
    try {
      await onSubmit({
        mode,
        model,
        prompt: inputValue.trim(),
        files: images.map((image) => image.file),
        aspectRatio: aspectRatio || undefined,
        duration: duration || undefined,
        resolution: mode === "text" ? undefined : resolution || undefined,
      });
      setInputValue("");
      clearImages();
      setIsActive(false);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "生成请求失败，请稍后重试。",
      );
    }
  }

  const hasVisibleError = tooManyImages || Boolean(error);
  const expandedHeight =
    102 + (images.length > 0 ? 51 : 0) + (hasVisibleError ? 19 : 0);

  return (
    <motion.div
      aria-hidden={hidden}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-5 pb-5 text-black"
      inert={hidden}
      initial={false}
      animate={{
        y: hidden ? "calc(100% + 24px)" : 0,
        opacity: hidden ? 0 : 1,
      }}
      transition={{ type: "spring", stiffness: 220, damping: 28 }}
    >
      <motion.div
        ref={wrapperRef}
        aria-label="AI 创作输入"
        className="pointer-events-auto relative w-[614px] max-w-full flex-none cursor-auto overflow-hidden rounded-[26px] border border-black/5 bg-white shadow-lg select-text"
        initial={{ height: 54 }}
        animate={{
          height: isExpanded ? expandedHeight : 54,
          boxShadow: isExpanded
            ? "0 14px 42px rgba(0,0,0,0.16)"
            : "0 2px 6px rgba(0,0,0,0.08)",
        }}
        transition={{ type: "spring", stiffness: 120, damping: 18 }}
        onClick={() => setIsActive(true)}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <input
          ref={fileInputRef}
          aria-label="上传参考图"
          className="sr-only"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => addImages(event.target.files)}
        />
        <button
          aria-label="添加参考图"
          className="absolute bottom-[9px] left-2.5 z-10 flex h-9 w-9 items-center justify-center rounded-full text-gray-600 transition hover:bg-gray-100"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            fileInputRef.current?.click();
          }}
        >
          <Images aria-hidden="true" size={15} />
        </button>
        <button
          aria-label={isSubmitting ? "正在提交" : "生成"}
          className="absolute right-2.5 bottom-[9px] z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black text-white transition enabled:hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-30"
          disabled={!canSubmit}
          title={tooManyImages ? `当前模型最多支持 ${selectedModel.maxReferenceImages} 张参考图` : "生成"}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void submit();
          }}
        >
          <Send aria-hidden="true" size={14} />
        </button>

        <div className="flex h-full flex-col justify-end">
          {images.length > 0 ? (
            <div className="flex h-[51px] shrink-0 items-center gap-1.5 overflow-x-auto px-5">
              {images.map((image) => (
                <div
                  className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-[10px] bg-gray-100"
                  key={image.id}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="h-full w-full object-cover"
                    src={image.previewUrl}
                    alt={image.file.name}
                  />
                  <button
                    aria-label={`移除 ${image.file.name}`}
                    className="absolute top-0.5 right-0.5 rounded-full bg-black/65 p-0.5 text-white transition hover:bg-black/80"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeImage(image.id);
                    }}
                  >
                    <Trash2 aria-hidden="true" size={10} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div
            className={`flex w-full shrink-0 items-center px-5 ${
              isExpanded ? "h-[48px]" : "h-[54px]"
            }`}
          >
            <div className="relative min-w-0 flex-1">
              <input
                aria-label="创作内容"
                className={`relative z-10 w-full rounded-md border-0 bg-transparent py-1.5 text-[13px] outline-0 ${
                  isExpanded ? "px-0" : "px-[31px]"
                }`}
                type="text"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onFocus={() => setIsActive(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
              <div className="pointer-events-none absolute inset-0 flex items-center py-1.5">
                <AnimatePresence mode="wait" initial={false}>
                  {showPlaceholder && !isExpanded && !inputValue ? (
                    <motion.span
                      className="pointer-events-none absolute top-1/2 right-[31px] left-[31px] -translate-y-1/2 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-gray-400 select-none"
                      key={`${mode}-${placeholderIndex}`}
                      variants={PLACEHOLDER_CONTAINER_VARIANTS}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                    >
                      {PLACEHOLDERS[mode][placeholderIndex]
                        .split("")
                        .map((character, index) => (
                          <motion.span
                            key={index}
                            variants={LETTER_VARIANTS}
                            style={{ display: "inline-block" }}
                          >
                            {character === " " ? "\u00a0" : character}
                          </motion.span>
                        ))}
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <motion.div
            aria-hidden={!isExpanded}
            className="flex w-full flex-col overflow-hidden text-[11px]"
            inert={!isExpanded}
            initial={false}
            animate={
              isExpanded
                ? { height: "auto", opacity: 1, y: 0 }
                : { height: 0, opacity: 0, y: 16 }
            }
          >
            {tooManyImages ? (
              <p className="h-[19px] shrink-0 truncate px-5 text-[10px] leading-[19px] text-amber-700">
                当前模型最多支持 {selectedModel.maxReferenceImages} 张参考图，请移除多余图片。
              </p>
            ) : error ? (
              <p
                role="alert"
                className="h-[19px] shrink-0 truncate px-5 text-[10px] leading-[19px] text-red-600"
              >
                {error}
              </p>
            ) : null}

            <div className="flex h-[54px] min-w-0 shrink-0 items-center px-[51px]">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
                <SelectControl icon={ModeIcon} label="模式">
                  <select
                    aria-label="模式"
                    className="appearance-none bg-transparent pr-4 outline-none disabled:cursor-not-allowed"
                    disabled={Boolean(lockedMode)}
                    value={mode}
                    onChange={(event) => changeMode(event.target.value as ComposerMode)}
                  >
                    {MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </SelectControl>

                <SelectControl icon={Sparkles} label="模型">
                  <select
                    aria-label="模型"
                    className="max-w-[154px] appearance-none bg-transparent pr-4 outline-none"
                    value={model}
                    onChange={(event) => changeModel(event.target.value)}
                  >
                    {MODEL_CONFIGS[mode].map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </SelectControl>

                {selectedModel.aspectRatios.length > 0 ? (
                  <SelectControl label="比例">
                    <select
                      aria-label="画面比例"
                      className="appearance-none bg-transparent pr-4 outline-none"
                      value={aspectRatio}
                      onChange={(event) => setAspectRatio(event.target.value)}
                    >
                      {selectedModel.aspectRatios.map((ratio) => (
                        <option key={ratio} value={ratio}>
                          {ratio}
                        </option>
                      ))}
                    </select>
                  </SelectControl>
                ) : null}

                {selectedModel.durations.length > 0 ? (
                  <SelectControl label="时长">
                    <select
                      aria-label="视频时长"
                      className="appearance-none bg-transparent pr-4 outline-none"
                      value={duration}
                      onChange={(event) => setDuration(event.target.value)}
                    >
                      {selectedModel.durations.map((seconds) => (
                        <option key={seconds} value={seconds}>
                          {seconds} 秒
                        </option>
                      ))}
                    </select>
                  </SelectControl>
                ) : null}

                {selectedModel.resolutions.length > 0 ? (
                  <SelectControl label="分辨率">
                    <select
                      aria-label="分辨率"
                      className="appearance-none bg-transparent pr-4 outline-none"
                      value={resolution}
                      onChange={(event) => setResolution(event.target.value)}
                    >
                      {selectedModel.resolutions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </SelectControl>
                ) : null}
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SelectControl({
  children,
  icon: Icon,
  label,
}: {
  children: React.ReactNode;
  icon?: typeof Sparkles;
  label: string;
}) {
  return (
    <label className="relative flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1.5 font-medium text-gray-700 transition hover:bg-gray-200">
      {Icon ? <Icon aria-hidden="true" size={12} /> : null}
      <span className="sr-only">{label}</span>
      {children}
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-1.5" size={10} />
    </label>
  );
}
