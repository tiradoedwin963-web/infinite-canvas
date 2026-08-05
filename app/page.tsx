"use client";

import type { CSSProperties, PointerEvent, WheelEvent } from "react";
import { useRef, useState } from "react";
import {
  panViewport,
  zoomViewport,
  type Viewport,
} from "./canvas/viewport";

const DOT_SPACING = 24;

type DragState = {
  pointerId: number;
  x: number;
  y: number;
};

export default function Home() {
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const drag = useRef<DragState | null>(null);

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.current.x;
    const deltaY = event.clientY - drag.current.y;
    drag.current.x = event.clientX;
    drag.current.y = event.clientY;
    setViewport((current) => panViewport(current, deltaX, deltaY));
  }

  function finishDrag(event: PointerEvent<HTMLElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;

    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleWheel(event: WheelEvent<HTMLElement>) {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const anchor = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    const zoomFactor = Math.exp(-event.deltaY * 0.001);
    setViewport((current) =>
      zoomViewport(current, anchor, current.scale * zoomFactor),
    );
  }

  const canvasStyle = {
    "--canvas-x": `${viewport.x}px`,
    "--canvas-y": `${viewport.y}px`,
    "--canvas-grid-size": `${DOT_SPACING * viewport.scale}px`,
  } as CSSProperties;

  return (
    <main
      aria-label="空白无限画布"
      className="infinite-canvas"
      style={canvasStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onWheel={handleWheel}
    />
  );
}
