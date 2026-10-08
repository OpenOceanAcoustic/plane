/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LabFolder } from "@plane/types";

const FOLDER_COLORS = ["indigo", "emerald", "orange", "purple", "pink", "crimson", "yellow"] as const;
const GOLDEN_ANGLE = 137.50776405003785;

function customColorIndex(color: unknown): number | null {
  if (typeof color !== "string" || !/^custom-(0|[1-9][0-9]*)$/.test(color)) return null;
  const index = Number(color.slice("custom-".length));
  return Number.isSafeInteger(index) ? index : null;
}

export function calendarFolderColors(color: string | undefined): {
  marker: string;
  background: string;
  foreground: string;
} {
  const customIndex = customColorIndex(color);
  if (customIndex !== null) {
    const hue = ((25 + customIndex * GOLDEN_ANGLE) % 360).toFixed(6);
    const marker = `oklch(0.67 0.16 ${hue})`;
    return {
      marker,
      background: `color-mix(in oklch, ${marker} 18%, var(--background-color-surface-1))`,
      foreground: `color-mix(in oklch, ${marker} 18%, var(--text-color-primary))`,
    };
  }
  const preset = FOLDER_COLORS.find((candidate) => candidate === color) ?? "grey";
  return {
    marker: `var(--label-${preset}-bg-strong)`,
    background: `var(--label-${preset}-bg)`,
    foreground: `var(--label-${preset}-text)`,
  };
}

type FolderPreferences = {
  version: 1;
  folderColors: Record<string, string>;
  nextColorIndex: number;
  hiddenFolderIds: string[];
};

type ScopedFolderPreferences = FolderPreferences & { key: string };

function emptyPreferences(key: string): ScopedFolderPreferences {
  return { key, version: 1, folderColors: {}, nextColorIndex: 0, hiddenFolderIds: [] };
}

function readPreferences(key: string): ScopedFolderPreferences {
  const defaults = emptyPreferences(key);
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return defaults;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
    const preferences = value as Partial<FolderPreferences>;
    const colors = preferences.folderColors;
    const nextColorIndex = preferences.nextColorIndex;
    if (
      preferences.version !== 1 ||
      !colors ||
      typeof colors !== "object" ||
      Array.isArray(colors) ||
      Object.entries(colors).some(
        ([id, color]) =>
          !id || (!FOLDER_COLORS.some((candidate) => candidate === color) && customColorIndex(color) === null)
      ) ||
      typeof nextColorIndex !== "number" ||
      !Number.isSafeInteger(nextColorIndex) ||
      nextColorIndex < Object.keys(colors).length ||
      !Array.isArray(preferences.hiddenFolderIds) ||
      preferences.hiddenFolderIds.some((id) => typeof id !== "string" || !id)
    ) {
      return defaults;
    }
    return {
      key,
      version: 1,
      folderColors: colors,
      nextColorIndex,
      hiddenFolderIds: [...new Set(preferences.hiddenFolderIds)],
    };
  } catch {
    // Preferences are optional; corrupt values or disabled storage never prevent planning.
    return defaults;
  }
}

function assignFolderColors(preferences: ScopedFolderPreferences, folders: LabFolder[]): ScopedFolderPreferences {
  if (folders.every((folder) => Object.prototype.hasOwnProperty.call(preferences.folderColors, folder.id))) {
    return preferences;
  }
  const folderColors = { ...preferences.folderColors };
  let nextColorIndex = preferences.nextColorIndex;
  for (const folder of folders) {
    if (Object.prototype.hasOwnProperty.call(folderColors, folder.id)) continue;
    Object.defineProperty(folderColors, folder.id, {
      value:
        nextColorIndex < FOLDER_COLORS.length
          ? FOLDER_COLORS[nextColorIndex]
          : `custom-${nextColorIndex - FOLDER_COLORS.length}`,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    nextColorIndex += 1;
  }
  // Retain deleted IDs and the counter so removing or reordering folders never recycles their colors.
  return { ...preferences, folderColors, nextColorIndex };
}

export function useCalendarFolders(
  key: string,
  folders: LabFolder[]
): {
  folderColors: Record<string, string>;
  hiddenFolderIds: string[];
  setHiddenFolderIds: (ids: string[]) => void;
} {
  const [saved, setSaved] = useState<ScopedFolderPreferences | null>(null);
  const preferences = useMemo(
    () => assignFolderColors(saved?.key === key ? saved : emptyPreferences(key), folders),
    [saved, key, folders]
  );

  useEffect(() => {
    setSaved((current) => assignFolderColors(current?.key === key ? current : readPreferences(key), folders));
  }, [key, folders]);

  useEffect(() => {
    if (saved?.key !== key) return;
    const { version, folderColors, nextColorIndex, hiddenFolderIds } = saved;
    try {
      window.localStorage.setItem(key, JSON.stringify({ version, folderColors, nextColorIndex, hiddenFolderIds }));
    } catch {
      // Keep in-memory choices available when private browsing or storage quotas reject writes.
    }
  }, [saved, key]);

  const setHiddenFolderIds = useCallback(
    (ids: string[]) => {
      const hiddenFolderIds = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
      setSaved((current) => {
        const next = assignFolderColors(current?.key === key ? current : readPreferences(key), folders);
        if (
          next.hiddenFolderIds.length === hiddenFolderIds.length &&
          next.hiddenFolderIds.every((id, index) => id === hiddenFolderIds[index])
        ) {
          return next;
        }
        // Unknown IDs can include the caller's unclassified row; new folders remain visible by default.
        return { ...next, hiddenFolderIds };
      });
    },
    [key, folders]
  );

  return {
    folderColors: preferences.folderColors,
    hiddenFolderIds: preferences.hiddenFolderIds,
    setHiddenFolderIds,
  };
}
