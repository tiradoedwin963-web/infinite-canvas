import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkflowGraphPersistence,
  createWorkflowRafBatcher,
  createWorkflowViewportController,
  workflowGridTransform,
} from "../app/workflow/performance.ts";

function scheduler() {
  let nextId = 0;
  const callbacks = new Map();
  return {
    schedule(callback) {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
    },
    runLatest() {
      const entry = [...callbacks.entries()].at(-1);
      if (!entry) return;
      callbacks.delete(entry[0]);
      entry[1]();
    },
    size() {
      return callbacks.size;
    },
  };
}

test("coalesces workflow viewport changes into one frame and one idle commit", () => {
  const frames = scheduler();
  const timers = scheduler();
  const applied = [];
  const committed = [];
  const active = [];
  const controller = createWorkflowViewportController({
    initial: { x: 0, y: 0, scale: 1 },
    apply: (viewport) => applied.push(viewport),
    commit: (viewport) => committed.push(viewport),
    requestFrame: (callback) => frames.schedule(callback),
    cancelFrame: (handle) => frames.cancel(handle),
    setTimer: (callback) => timers.schedule(callback),
    clearTimer: (handle) => timers.cancel(handle),
    onActiveChange: (value) => active.push(value),
  });

  controller.pan(10, -4);
  controller.pan(5, 2);
  assert.equal(frames.size(), 1);
  assert.equal(timers.size(), 1);
  assert.equal(applied.length, 0);
  frames.runLatest();
  assert.deepEqual(applied, [{ x: 15, y: -2, scale: 1 }]);
  assert.equal(committed.length, 0);
  assert.deepEqual(active, [true]);
  timers.runLatest();
  assert.deepEqual(committed, [{ x: 15, y: -2, scale: 1 }]);
  assert.deepEqual(active, [true, false]);

  controller.zoom({ x: 100, y: 60 }, 2);
  controller.flush();
  assert.deepEqual(applied.at(-1), { x: -70, y: -64, scale: 2 });
  assert.deepEqual(committed.at(-1), applied.at(-1));
  assert.equal(frames.size(), 0);
  assert.equal(timers.size(), 0);
  assert.deepEqual(active, [true, false, true, false]);
  controller.replace({ x: 7, y: 9, scale: 0.5 });
  assert.deepEqual(controller.current(), { x: 7, y: 9, scale: 0.5 });
  assert.deepEqual(applied.at(-1), { x: 7, y: 9, scale: 0.5 });
  assert.deepEqual(committed.at(-1), { x: 7, y: 9, scale: 0.5 });
  controller.dispose();
});

test("keeps the transformed workflow grid covering every viewport scale", () => {
  const canvas = { width: 100, height: 50 };
  assert.deepEqual(
    workflowGridTransform({ x: 0, y: 0, scale: 1 }, canvas),
    { x: -24, y: -24, scale: 1, width: 148, height: 98 },
  );
  assert.deepEqual(
    workflowGridTransform({ x: 13, y: -7, scale: 2 }, canvas),
    { x: -35, y: -7, scale: 2, width: 98, height: 73 },
  );
  for (const scale of [0.25, 1, 4]) {
    const frame = workflowGridTransform(
      { x: -347.5, y: 218.25, scale },
      canvas,
    );
    assert.ok(frame.x <= 0 && frame.y <= 0);
    assert.ok(frame.x + frame.width * scale >= canvas.width);
    assert.ok(frame.y + frame.height * scale >= canvas.height);
  }
});

test("coalesces high-frequency workflow interaction state into the latest frame", () => {
  const frames = scheduler();
  const applied = [];
  const batcher = createWorkflowRafBatcher({
    apply: (value) => applied.push(value),
    requestFrame: (callback) => frames.schedule(callback),
    cancelFrame: (handle) => frames.cancel(handle),
  });
  batcher.schedule("first");
  batcher.schedule("second");
  assert.equal(frames.size(), 1);
  frames.runLatest();
  assert.deepEqual(applied, ["second"]);
  batcher.schedule("third");
  batcher.flush();
  assert.deepEqual(applied, ["second", "third"]);
  batcher.schedule("discarded");
  batcher.cancel();
  frames.runLatest();
  assert.deepEqual(applied, ["second", "third"]);
  batcher.dispose();
});

test("disposes pending viewport work without applying a late frame", () => {
  const frames = scheduler();
  const timers = scheduler();
  let applied = 0;
  let committed = 0;
  const controller = createWorkflowViewportController({
    initial: { x: 0, y: 0, scale: 1 },
    apply: () => applied += 1,
    commit: () => committed += 1,
    requestFrame: (callback) => frames.schedule(callback),
    cancelFrame: (handle) => frames.cancel(handle),
    setTimer: (callback) => timers.schedule(callback),
    clearTimer: (handle) => timers.cancel(handle),
  });
  controller.pan(20, 10);
  controller.dispose();
  frames.runLatest();
  timers.runLatest();
  assert.equal(applied, 0);
  assert.equal(committed, 0);
});

test("debounces workflow graph persistence and flushes only the newest graph", () => {
  const timers = scheduler();
  const writes = [];
  const persistence = createWorkflowGraphPersistence({
    write: (graph) => writes.push(graph),
    setTimer: (callback) => timers.schedule(callback),
    clearTimer: (handle) => timers.cancel(handle),
  });
  const first = { version: 1, nodes: [], edges: [] };
  const second = {
    version: 1,
    nodes: [{ id: "node", x: 0, y: 0, type: "source", kind: "text", text: "" }],
    edges: [],
  };
  persistence.schedule(first);
  persistence.schedule(second);
  assert.equal(timers.size(), 1);
  assert.equal(writes.length, 0);
  persistence.flush();
  assert.deepEqual(writes, [second]);
  assert.equal(timers.size(), 0);
  persistence.dispose();
});
