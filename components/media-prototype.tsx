"use client";

import {
  Check,
  ChevronDown,
  Image as ImageIcon,
  Images,
  LoaderCircle,
  RefreshCw,
  Send,
  TriangleAlert,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MODEL_CONFIGS } from "@/app/ai/models";

export type PrototypeTaskState = "pending" | "running" | "success" | "failed";
type PrototypeMode = "image" | "video";

type PrototypeTask = {
  id: string;
  mode: PrototypeMode;
  prompt: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  duration?: string;
  createdAt: number;
  state: PrototypeTaskState;
  progress: number;
};

const STORAGE_KEYS: Record<PrototypeMode, string> = {
  image: "zora-star-prototype-image-tasks-v2",
  video: "zora-star-prototype-video-tasks-v2",
};

function modelLabel(mode: PrototypeMode, value: string) {
  return MODEL_CONFIGS[mode].find((model) => model.value === value)?.label ?? value;
}

function taskTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(value);
}

export function MediaPrototype({ mode }: { mode: PrototypeMode }) {
  const models = MODEL_CONFIGS[mode];
  const initialModel = models[0];
  const [tasks, setTasks] = useState<PrototypeTask[]>([]);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(initialModel.value);
  const [aspectRatio, setAspectRatio] = useState(initialModel.aspectRatios[0]);
  const [resolution, setResolution] = useState(initialModel.defaultResolution ?? initialModel.resolutions[0]);
  const [duration, setDuration] = useState(initialModel.durations[0] ?? "");
  const [hasReference, setHasReference] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const timers = useRef<number[]>([]);
  const scheduledTaskIds = useRef(new Set<string>());
  const selectedModel = models.find((item) => item.value === model) ?? initialModel;
  const isImage = mode === "image";

  const scheduleSuccess = useCallback((taskId: string) => {
    if (scheduledTaskIds.current.has(taskId)) return;
    scheduledTaskIds.current.add(taskId);
    timers.current.push(window.setTimeout(() => {
      setTasks((current) => current.map((task) => (
        task.id === taskId ? { ...task, state: "running", progress: 46 } : task
      )));
    }, 500));
    timers.current.push(window.setTimeout(() => {
      setTasks((current) => current.map((task) => (
        task.id === taskId ? { ...task, state: "success", progress: 100 } : task
      )));
      scheduledTaskIds.current.delete(taskId);
    }, 2_300));
  }, []);

  useEffect(() => {
    let savedTasks: PrototypeTask[] | undefined;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEYS[mode]);
      if (saved) savedTasks = JSON.parse(saved) as PrototypeTask[];
    } catch {
      // Keep the empty task list when local data is invalid.
    }
    const timer = window.setTimeout(() => {
      if (savedTasks) setTasks(savedTasks);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mode]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEYS[mode], JSON.stringify(tasks));
  }, [hydrated, mode, tasks]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  useEffect(() => {
    if (!hydrated) return;
    tasks
      .filter((task) => task.state === "pending" || task.state === "running")
      .forEach((task) => scheduleSuccess(task.id));
  }, [hydrated, scheduleSuccess, tasks]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = prompt.trim();
    if (!value) return;
    const task: PrototypeTask = {
      id: crypto.randomUUID(),
      mode,
      prompt: value,
      model,
      aspectRatio,
      resolution,
      duration: isImage ? undefined : duration,
      createdAt: Date.now(),
      state: "pending",
      progress: 8,
    };
    setTasks((current) => [task, ...current]);
    setPrompt("");
    setHasReference(false);
    scheduleSuccess(task.id);
  }

  function retry(taskId: string) {
    setTasks((current) => current.map((task) => (
      task.id === taskId ? { ...task, state: "pending", progress: 8 } : task
    )));
    scheduleSuccess(taskId);
  }

  function changeModel(nextModel: string) {
    const config = models.find((item) => item.value === nextModel) ?? initialModel;
    setModel(config.value);
    setAspectRatio(config.aspectRatios[0]);
    setResolution(config.defaultResolution ?? config.resolutions[0]);
    setDuration(config.durations[0] ?? "");
  }

  return (
    <main className="prototype-page">
      <section className="prototype-feed" aria-label={`${isImage ? "图片" : "视频"}任务记录`}>
        {tasks.length ? tasks.map((task) => (
          <article className="prototype-task-group" key={task.id}>
            <div className="prototype-command">
              <span>你的{isImage ? "图片" : "视频"}指令</span>
              <time>{taskTime(task.createdAt)}</time>
              <p>{task.prompt}</p>
              <div className="prototype-task-meta">
                <small>{modelLabel(mode, task.model)}</small>
                <small>{task.aspectRatio}</small>
                {task.duration ? <small>{task.duration} 秒</small> : null}
                <small>{task.resolution}</small>
              </div>
            </div>
            <div className={`prototype-result is-${task.state}`}>
              <div className="prototype-result-header">
                <span className="prototype-status-icon">
                  {task.state === "success" ? <Check /> : task.state === "failed" ? <TriangleAlert /> : <LoaderCircle />}
                </span>
                <div>
                  <strong>{task.state === "success" ? `${isImage ? "图片" : "视频"}任务已完成` : task.state === "failed" ? `${isImage ? "图片" : "视频"}任务生成失败` : "任务正在生成"}</strong>
                  <small>任务 #{task.id.slice(0, 12)}</small>
                </div>
                <span className="prototype-state-label">{task.state === "success" ? "已完成" : task.state === "failed" ? "失败" : `${task.progress}%`}</span>
                {task.state === "failed" ? (
                  <button className="prototype-retry" type="button" onClick={() => retry(task.id)}>
                    <RefreshCw aria-hidden="true" />重新生成
                  </button>
                ) : null}
              </div>
              {task.state === "pending" || task.state === "running" ? (
                <div className="prototype-progress" role="progressbar" aria-valuenow={task.progress} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ width: `${task.progress}%` }} />
                </div>
              ) : null}
              {task.state === "success" ? (
                isImage ? (
                  <div className="prototype-image-results"><div className="prototype-scene" /><div className="prototype-scene is-alt" /></div>
                ) : (
                  <div className="prototype-video-result"><span className="prototype-play">▶</span><small>00:{task.duration?.padStart(2, "0") ?? "05"}</small></div>
                )
              ) : null}
              {task.state === "failed" ? <p className="prototype-error">服务暂时繁忙，本次原型任务未产生真实请求。</p> : null}
            </div>
          </article>
        )) : (
          <div className="prototype-empty">
            {isImage ? <ImageIcon /> : <Video />}
            <h2>{isImage ? "从一句画面描述开始" : "描述你想看到的镜头"}</h2>
            <p>本页面仅模拟{isImage ? "图片" : "视频"}任务，不提供通用聊天，也不会调用真实生成接口。</p>
          </div>
        )}
      </section>

      <form className="prototype-composer" onSubmit={submit}>
        {hasReference ? <div className="prototype-reference"><span>示例参考图</span><button type="button" onClick={() => setHasReference(false)}>移除</button></div> : null}
        <textarea
          aria-label={`描述想生成的${isImage ? "图片" : "视频"}`}
          placeholder={`描述你想生成的${isImage ? "画面" : "视频"}…`}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <div className="prototype-composer-toolbar">
          <button className="prototype-reference-button" type="button" onClick={() => setHasReference((current) => !current)}>
            {isImage ? <Images /> : <ImageIcon />}参考图
          </button>
          <label className="prototype-select"><span>模型</span><select aria-label="模型" value={model} onChange={(event) => changeModel(event.target.value)}>{models.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><ChevronDown /></label>
          <label className="prototype-select"><span>比例</span><select aria-label="画面比例" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{selectedModel.aspectRatios.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown /></label>
          {!isImage ? <label className="prototype-select"><span>时长</span><select aria-label="视频时长" value={duration} onChange={(event) => setDuration(event.target.value)}>{selectedModel.durations.map((item) => <option key={item} value={item}>{item} 秒</option>)}</select><ChevronDown /></label> : null}
          <label className="prototype-select"><span>分辨率</span><select aria-label="分辨率" value={resolution} onChange={(event) => setResolution(event.target.value)}>{selectedModel.resolutions.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown /></label>
          <button aria-label="提交模拟任务" className="prototype-submit" disabled={!prompt.trim()} type="submit"><Send /></button>
        </div>
      </form>
    </main>
  );
}
