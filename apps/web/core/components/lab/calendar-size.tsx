/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

const MIN_HEIGHT = 320;
const FOOTER_SPACE = 64;

export function useCalendarViewportHeight(layoutKey: string): {
  surfaceRef: RefObject<HTMLDivElement>;
  height: number;
} {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(520);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (!surface.getClientRects().length) return;
      const bounds = surface.getBoundingClientRect();
      if (!bounds.width) return;

      // Normalize scrolling so the calendar does not grow as the page moves upward.
      let top = bounds.top + window.scrollY;
      for (let ancestor = surface.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor !== document.scrollingElement) top += ancestor.scrollTop;
      }
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const next = Math.max(MIN_HEIGHT, Math.floor(viewportHeight - top - FOOTER_SPACE));
      setHeight((previous) => (previous === next ? previous : next));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    // Ancestors cover toolbar wrapping and a previously hidden workbench pane.
    for (let ancestor = surface.parentElement; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor);
    }
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    schedule();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [layoutKey]);

  return { surfaceRef, height };
}
