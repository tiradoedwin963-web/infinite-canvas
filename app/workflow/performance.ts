import {
  panViewport,
  zoomViewport,
  type Point,
  type Viewport,
} from "../canvas/viewport.ts";
import type { WorkflowGraph } from "./graph.ts";

type TimerHandle = ReturnType<typeof setTimeout>;

export type WorkflowGridTransform = {
  x: number;
  y: number;
  scale: number;
  width: number;
  height: number;
};

export function workflowGridTransform(
  viewport: Viewport,
  canvasSize: { width: number; height: number },
  spacing = 24,
): WorkflowGridTransform {
  const tileSize = spacing * viewport.scale;
  const offset = (value: number) =>
    ((value % tileSize) + tileSize) % tileSize - tileSize;
  return {
    x: offset(viewport.x),
    y: offset(viewport.y),
    scale: viewport.scale,
    width: canvasSize.width / viewport.scale + spacing * 2,
    height: canvasSize.height / viewport.scale + spacing * 2,
  };
}

export function createWorkflowRafBatcher<T>(options: {
  apply: (value: T) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}) {
  const requestFrame = options.requestFrame ?? requestAnimationFrame;
  const cancelFrame = options.cancelFrame ?? cancelAnimationFrame;
  let frame: number | null = null;
  let pending: T | undefined;

  const applyFrame = () => {
    frame = null;
    if (pending === undefined) return;
    const value = pending;
    pending = undefined;
    options.apply(value);
  };

  return {
    schedule(value: T) {
      pending = value;
      if (frame === null) frame = requestFrame(applyFrame);
    },
    flush() {
      if (frame !== null) cancelFrame(frame);
      applyFrame();
    },
    cancel() {
      if (frame !== null) cancelFrame(frame);
      frame = null;
      pending = undefined;
    },
    dispose() {
      if (frame !== null) cancelFrame(frame);
      frame = null;
      pending = undefined;
    },
  };
}

export function createWorkflowViewportController(options: {
  initial: Viewport;
  apply: (viewport: Viewport) => void;
  commit: (viewport: Viewport) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  commitDelay?: number;
  onActiveChange?: (active: boolean) => void;
}) {
  const requestFrame = options.requestFrame ?? requestAnimationFrame;
  const cancelFrame = options.cancelFrame ?? cancelAnimationFrame;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const commitDelay = options.commitDelay ?? 120;
  let viewport = options.initial;
  let frame: number | null = null;
  let timer: TimerHandle | null = null;
  let active = false;

  const setActive = (next: boolean) => {
    if (active === next) return;
    active = next;
    options.onActiveChange?.(next);
  };

  const applyFrame = () => {
    frame = null;
    options.apply(viewport);
  };
  const schedule = () => {
    setActive(true);
    if (frame === null) frame = requestFrame(applyFrame);
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      if (frame !== null) {
        cancelFrame(frame);
        applyFrame();
      }
      options.commit(viewport);
      setActive(false);
    }, commitDelay);
  };

  return {
    pan(deltaX: number, deltaY: number) {
      viewport = panViewport(viewport, deltaX, deltaY);
      schedule();
    },
    zoom(anchor: Point, scaleFactor: number) {
      viewport = zoomViewport(viewport, anchor, viewport.scale * scaleFactor);
      schedule();
    },
    current() {
      return viewport;
    },
    flush() {
      if (frame !== null) {
        cancelFrame(frame);
        applyFrame();
      }
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      options.commit(viewport);
      setActive(false);
    },
    dispose() {
      if (frame !== null) cancelFrame(frame);
      if (timer !== null) clearTimer(timer);
      frame = null;
      timer = null;
      setActive(false);
    },
  };
}

export function createWorkflowGraphPersistence(options: {
  write: (graph: WorkflowGraph) => void;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  delay?: number;
}) {
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const delay = options.delay ?? 300;
  let graph: WorkflowGraph | null = null;
  let timer: TimerHandle | null = null;

  const flush = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (!graph) return;
    options.write(graph);
    graph = null;
  };

  return {
    schedule(next: WorkflowGraph) {
      graph = next;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(flush, delay);
    },
    flush,
    dispose() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      graph = null;
    },
  };
}
