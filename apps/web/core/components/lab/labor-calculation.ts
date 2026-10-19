/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { labDecimalUnits } from "@plane/ui";

export function laborHours(value: string): { units: bigint; days: number } | undefined {
  const text = value.replace(/\s/g, "");
  const multiplied = /^([0-9]{1,3})[xX*×]([0-9]{1,2}(?:\.[0-9]{1,2})?)$/.exec(text);
  if (multiplied) {
    const days = Number(multiplied[1]);
    const daily = labDecimalUnits(multiplied[2]!);
    if (days < 1 || days > 366 || !daily || daily > 2400n) return undefined;
    return { units: BigInt(days) * daily, days };
  }
  if (!/^[0-9]{1,4}(?:\.[0-9]{1,2})?$/.test(text)) return undefined;
  const units = labDecimalUnits(text);
  return units && units <= 878400n ? { units, days: 1 } : undefined;
}

export function dateAfter(date: string, offset: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

export function localToday(timezone = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"].map((kind) => parts.find((part) => part.type === kind)?.value).join("-");
}

export const laborAmount = (hours: string, rate: string) => {
  const units = laborHours(hours)?.units;
  const price = /^[0-9]{1,12}(?:\.[0-9]{1,2})?$/.test(rate) ? labDecimalUnits(rate) : undefined;
  return units && price ? (units * price + 50n) / 100n : 0n;
};
