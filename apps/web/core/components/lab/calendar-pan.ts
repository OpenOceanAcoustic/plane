/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect } from "react";
import type { RefObject } from "react";

const DRAG_THRESHOLD = 6;
const PERIOD_THRESHOLD = 80;
const interactive = '[data-lab-calendar-event], button, a[href], input, select, textarea, [role="button"]';

function horizontalScroller(element: HTMLElement, surface: HTMLElement): HTMLElement | undefined {
  for (let current: HTMLElement | null = element; current && current !== surface; current = current.parentElement) {
    if (["auto", "scroll"].includes(getComputedStyle(current).overflowX)) return current;
  }
  return undefined;
}

/** Pan the viewport; task movement and the calendar's explicit selection mode remain native. */
export function useCalendarTimelinePan(
  surfaceRef: RefObject<HTMLDivElement>,
  layoutKey: string | undefined,
  browse: boolean,
  navigate: (direction: -1 | 1) => void
) {
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !layoutKey) return;
    let gesture:
      | {
          pointerId: number;
          x: number;
          y: number;
          left: number;
          top: number;
          scroller: HTMLElement;
          navigated: boolean;
        }
      | undefined;
    const finish = () => {
      if (gesture && surface.hasPointerCapture(gesture.pointerId)) surface.releasePointerCapture(gesture.pointerId);
      gesture = undefined;
      surface.classList.remove("lab-calendar-drag-browsing");
    };
    const down = (event: PointerEvent) => {
      if (
        !event.isPrimary ||
        event.button !== 0 ||
        event.pointerType === "touch" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        !(event.target instanceof Element)
      )
        return;
      const target = event.target;
      if (target.closest(interactive)) return;
      const header = target.closest<HTMLElement>(".lab-calendar-pan-header");
      const lane = target.closest<HTMLElement>("[data-lab-resource]");
      if (!header && (!browse || !lane)) return;
      // Use the body scroll authority even when dragging the synchronized date header.
      const body = surface.querySelector<HTMLElement>("[data-lab-resource]");
      const scroller = horizontalScroller(body ?? header!, surface);
      if (!scroller) return;
      event.preventDefault();
      event.stopPropagation();
      gesture = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: scroller.scrollLeft,
        top: scroller.scrollTop,
        scroller,
        navigated: false,
      };
      surface.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      if (!event.buttons) {
        finish();
        return;
      }
      const dx = gesture.x - event.clientX,
        dy = gesture.y - event.clientY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      event.preventDefault();
      surface.classList.add("lab-calendar-drag-browsing");
      if (gesture.navigated) return;
      const { scroller } = gesture;
      const requested = gesture.left + dx;
      const maximum = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const position = Math.max(0, Math.min(maximum, requested));
      scroller.scrollLeft = position;
      scroller.scrollTop = gesture.top + dy;
      const overflow = requested - position;
      if (Math.abs(overflow) >= PERIOD_THRESHOLD && Math.abs(dx) >= Math.abs(dy)) {
        // An overview fits the whole period. At its edge, load adjacent dates
        // instead of trying to scroll a canvas with no remaining scroll space.
        gesture.navigated = true;
        navigate(overflow > 0 ? 1 : -1);
      }
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === gesture?.pointerId) finish();
    };
    surface.addEventListener("pointerdown", down, { capture: true });
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", finish);
    return () => {
      finish();
      surface.removeEventListener("pointerdown", down, { capture: true });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", finish);
    };
  }, [surfaceRef, layoutKey, browse, navigate]);
}
