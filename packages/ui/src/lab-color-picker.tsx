/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useId, useState } from "react";

const swatches = [
  "#1d4ed8",
  "#7c3aed",
  "#15803d",
  "#c2410c",
  "#be185d",
  "#0e7490",
  "#dc2626",
  "#ca8a04",
  "#4f46e5",
  "#059669",
  "#e879f9",
  "#38bdf8",
  "#facc15",
  "#f97316",
  "#94a3b8",
  "#111827",
];
const validColor = (color: string) => /^#[0-9a-f]{6}$/i.test(color);

/** Native color panel plus reusable swatches; only RGB hex values are submitted. */
export function LabColorPicker({
  name = "color",
  label,
  initialValue = "",
  defaultColor = "#64748b",
  automatic = false,
}: {
  name?: string;
  label: string;
  initialValue?: string;
  defaultColor?: string;
  automatic?: boolean;
}) {
  const [value, setValue] = useState(initialValue || (automatic ? "" : defaultColor));
  const fallback = validColor(defaultColor) ? defaultColor : "#64748b";
  const shown = validColor(value) ? value : fallback;
  const id = useId();
  return (
    <fieldset className="rounded-lg border border-subtle p-3">
      <legend className="px-1 text-13 text-secondary">{label}</legend>
      <input type="hidden" name={name} value={value} />
      {automatic && (
        <label className="mb-3 flex items-center gap-2 text-13 text-secondary">
          <input type="checkbox" checked={!value} onChange={(event) => setValue(event.target.checked ? "" : shown)} />
          跟随事项类别
        </label>
      )}
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={`${label}色板`}>
        {swatches.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`取色 ${color}`}
            aria-pressed={value.toLowerCase() === color}
            title={color}
            className="focus-visible:ring-accent-primary h-7 w-7 rounded-md border border-strong outline-none focus-visible:ring-2"
            style={{ backgroundColor: color }}
            onClick={() => setValue(color)}
          />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor={id} className="cursor-pointer text-13 text-secondary">
          自定义取色
        </label>
        <input
          id={id}
          type="color"
          aria-label={`自定义${label}`}
          value={shown}
          onChange={(event) => setValue(event.target.value.toLowerCase())}
          className="h-9 w-14 cursor-pointer rounded-md border border-subtle bg-surface-1 p-1"
        />
        <span aria-hidden className="h-5 w-5 rounded-full border border-subtle" style={{ backgroundColor: shown }} />
      </div>
    </fieldset>
  );
}
