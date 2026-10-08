/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState } from "react";
import { GripHorizontal } from "lucide-react";
import { Button, labInputClass } from "@plane/ui";

const DEFAULT_HEIGHT = 520;
const MIN_HEIGHT = 320;
const MAX_HEIGHT = 1200;
const clamp = (value: number) => Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(value)));

export function useCalendarHeight(key: string) {
  const [saved, setSaved] = useState({ key: "", height: DEFAULT_HEIGHT });
  useEffect(() => {
    let height = DEFAULT_HEIGHT;
    try {
      const value = Number(localStorage.getItem(key));
      if (Number.isFinite(value) && value >= MIN_HEIGHT && value <= MAX_HEIGHT) height = clamp(value);
    } catch {
      // Private browsing can disable storage; resizing remains available.
    }
    setSaved({ key, height });
  }, [key]);
  const setHeight = (value: number) => {
    if (!Number.isFinite(value)) return;
    const height = clamp(value);
    setSaved({ key, height });
    try {
      localStorage.setItem(key, String(height));
    } catch {
      // Preferences are optional, never a condition of planning access.
    }
  };
  return { height: saved.key === key ? saved.height : DEFAULT_HEIGHT, setHeight };
}

export function CalendarHeightControl({ height, setHeight }: { height: number; setHeight: (height: number) => void }) {
  const [draft, setDraft] = useState(String(height));
  useEffect(() => setDraft(String(height)), [height]);
  const commit = () => {
    const value = draft.trim() ? Number(draft) : DEFAULT_HEIGHT;
    const next = Number.isFinite(value) ? clamp(value) : height;
    setHeight(next);
    setDraft(String(next));
  };
  return (
    <div className="flex items-center gap-2 text-12 text-secondary">
      <label htmlFor="lab-calendar-height">高度</label>
      <input
        id="lab-calendar-height"
        type="number"
        aria-label="日历高度"
        className={`${labInputClass} w-20`}
        min={MIN_HEIGHT}
        max={MAX_HEIGHT}
        step={20}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const value = event.target.valueAsNumber;
          if (value >= MIN_HEIGHT && value <= MAX_HEIGHT) setHeight(value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
      <span>px</span>
      <Button size="sm" variant="neutral-primary" onClick={() => setHeight(DEFAULT_HEIGHT)}>
        重置高度
      </Button>
    </div>
  );
}

export function CalendarResizeHandle({ height, setHeight }: { height: number; setHeight: (height: number) => void }) {
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  return (
    <div
      role="separator"
      aria-label="调整日历高度"
      aria-orientation="horizontal"
      aria-valuemin={MIN_HEIGHT}
      aria-valuemax={MAX_HEIGHT}
      aria-valuenow={height}
      tabIndex={0}
      className="lab-calendar-resize"
      title="拖动调整高度，或使用上下方向键"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, y: event.clientY, height };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.pointerId === event.pointerId) setHeight(start.height + event.clientY - start.y);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const next = { ArrowUp: height - 20, ArrowDown: height + 20, Home: MIN_HEIGHT, End: MAX_HEIGHT }[event.key];
        if (next !== undefined) {
          event.preventDefault();
          setHeight(next);
        }
      }}
    >
      <GripHorizontal size={16} aria-hidden />
    </div>
  );
}
