export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

export type Viewport = {
  x: number;
  y: number;
  scale: number;
};

export type Point = {
  x: number;
  y: number;
};

export function panViewport(
  viewport: Viewport,
  deltaX: number,
  deltaY: number,
): Viewport {
  return {
    ...viewport,
    x: viewport.x + deltaX,
    y: viewport.y + deltaY,
  };
}

export function zoomViewport(
  viewport: Viewport,
  anchor: Point,
  requestedScale: number,
): Viewport {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, requestedScale));
  const ratio = scale / viewport.scale;

  return {
    x: anchor.x - (anchor.x - viewport.x) * ratio,
    y: anchor.y - (anchor.y - viewport.y) * ratio,
    scale,
  };
}

export function wheelZoomFactor(deltaY: number, isPinch: boolean): number {
  const boundedDelta = Math.min(100, Math.max(-100, deltaY));
  return Math.exp(-boundedDelta * (isPinch ? 0.01 : 0.001));
}
