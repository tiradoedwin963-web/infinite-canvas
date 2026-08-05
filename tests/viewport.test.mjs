import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SCALE,
  MIN_SCALE,
  panViewport,
  zoomViewport,
} from "../app/canvas/viewport.ts";

test("pans the viewport by the pointer delta", () => {
  assert.deepEqual(panViewport({ x: 12, y: -8, scale: 1.5 }, 5, -3), {
    x: 17,
    y: -11,
    scale: 1.5,
  });
});

test("clamps zoom to the supported range", () => {
  const viewport = { x: 0, y: 0, scale: 1 };
  const anchor = { x: 0, y: 0 };

  assert.equal(zoomViewport(viewport, anchor, 0.01).scale, MIN_SCALE);
  assert.equal(zoomViewport(viewport, anchor, 10).scale, MAX_SCALE);
});

test("keeps the world point under the zoom anchor fixed", () => {
  const viewport = { x: 40, y: -20, scale: 1 };
  const anchor = { x: 240, y: 180 };
  const worldPoint = {
    x: (anchor.x - viewport.x) / viewport.scale,
    y: (anchor.y - viewport.y) / viewport.scale,
  };
  const zoomed = zoomViewport(viewport, anchor, 2.5);

  assert.ok(Math.abs(zoomed.x + worldPoint.x * zoomed.scale - anchor.x) < 1e-9);
  assert.ok(Math.abs(zoomed.y + worldPoint.y * zoomed.scale - anchor.y) < 1e-9);
});
