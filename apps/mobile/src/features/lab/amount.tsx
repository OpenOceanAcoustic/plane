/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useId } from "react";
import type { InputHTMLAttributes } from "react";
import { labInputClass } from "./ui";

/** Parse decimal quantities into exact scaled integers without binary floating point. */
export function labDecimalUnits(value: string, precision = 2): bigint | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!match || (!match[2] && !match[3])) return null;
  const fraction = match[3] ?? "";
  if (/[^0]/.test(fraction.slice(precision))) return null;
  const units =
    BigInt(match[2] || "0") * 10n ** BigInt(precision) +
    BigInt(fraction.slice(0, precision).padEnd(precision, "0") || "0");
  return match[1] === "-" ? -units : units;
}

export function labDecimalText(units: bigint, precision = 2): string {
  const sign = units < 0n ? "-" : "";
  const absolute = units < 0n ? -units : units;
  if (!precision) return `${sign}${absolute}`;
  const scale = 10n ** BigInt(precision);
  return `${sign}${absolute / scale}.${String(absolute % scale).padStart(precision, "0")}`;
}

export function labAmountError(
  value: string,
  {
    limit,
    min = "0",
    unit = "元",
    precision = 2,
  }: { limit?: string | null; min?: string; unit?: string; precision?: number } = {}
): string {
  if (!value.trim()) return "";
  const units = labDecimalUnits(value, precision);
  if (units === null) return `请输入有效数值，最多 ${precision} 位小数`;
  const minimum = labDecimalUnits(min, precision);
  if (minimum !== null && units < minimum) return `不能低于 ${min} ${unit}`;
  const maximum = limit === null || limit === undefined ? null : labDecimalUnits(limit, precision);
  if (maximum !== null && units > maximum) return `超过可用额度 ${limit} ${unit}`;
  return "";
}

export function LabAmountInput({
  value,
  onValueChange,
  limit,
  min = "0",
  unit = "元",
  precision = 2,
  error,
  className = labInputClass,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "min" | "max"> & {
  value: string;
  onValueChange: (value: string) => void;
  limit?: string | null;
  min?: string;
  unit?: string;
  precision?: number;
  error?: string;
}) {
  const id = useId();
  const message = error || labAmountError(value, { limit, min, unit, precision });
  return (
    <>
      <input
        {...props}
        type="number"
        value={value}
        min={min}
        max={limit ?? undefined}
        step={props.step ?? (precision ? `0.${"0".repeat(precision - 1)}1` : "1")}
        className={className}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? `${id}-error` : props["aria-describedby"]}
      />
      {message && (
        <span id={`${id}-error`} role="alert" className="text-13 text-danger-primary">
          {message}
        </span>
      )}
    </>
  );
}
