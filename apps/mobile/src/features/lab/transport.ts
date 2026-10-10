/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LabPlanner, LabStage, LabBounty } from "@plane/types";
import type { ApiClient } from "../../lib/client";
export type LabStore = {
  slug: string;
  scope: string;
  planner?: LabPlanner;
  stages: LabStage[];
  bounties: LabBounty[];
  busy: boolean;
  error: string;
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  execute: (action: () => Promise<void>) => Promise<void>;
  loadMarket: () => Promise<void>;
  loadPlanner: () => Promise<void>;
};
export function useLabTransport(client: ApiClient, slug: string): LabStore {
  const [planner, setPlanner] = useState<LabPlanner>();
  const [stages, setStages] = useState<LabStage[]>([]);
  const [bounties, setBounties] = useState<LabBounty[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const plannerSerial = useRef(0),
    marketSerial = useRef(0);
  const request = useCallback(
    <T>(path: string, method = "GET", body?: unknown) =>
      client.request<T>(`/api/workspaces/${encodeURIComponent(slug)}/lab/${path}`, method, body),
    [client, slug]
  );
  const loadPlanner = useCallback(async () => {
    const serial = ++plannerSerial.current;
    const value = await request<LabPlanner>("planner/");
    if (serial === plannerSerial.current) setPlanner(value);
  }, [request]);
  const loadMarket = useCallback(async () => {
    const serial = ++marketSerial.current;
    const [nextStages, nextBounties] = await Promise.all([
      request<LabStage[]>("stages/"),
      request<LabBounty[]>("bounties/"),
    ]);
    if (serial === marketSerial.current) {
      setStages(nextStages);
      setBounties(nextBounties);
    }
  }, [request]);
  const execute = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);
  const invalidate = useCallback(() => {
    plannerSerial.current++;
    marketSerial.current++;
  }, []);
  useEffect(() => {
    setPlanner(undefined);
    setStages([]);
    setBounties([]);
    setError("");
    let active = true;
    loadPlanner().catch((e) => {
      if (active) setError(e instanceof Error ? e.message : "规划读取失败");
    });
    return () => {
      active = false;
      invalidate();
    };
  }, [loadPlanner, invalidate]);
  useEffect(() => {
    const refresh = () => {
      void loadPlanner().catch((e) => setError(e instanceof Error ? e.message : "规划读取失败"));
      if (marketSerial.current > 0)
        void loadMarket().catch((e) => setError(e instanceof Error ? e.message : "悬赏读取失败"));
    };
    window.addEventListener("mobileResume", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.removeEventListener("mobileResume", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [loadPlanner, loadMarket]);
  return {
    slug,
    scope: `${client.server}:${slug}`,
    planner,
    stages,
    bounties,
    busy,
    error,
    request,
    loadPlanner,
    loadMarket,
    execute,
  };
}
export function useResource<T>(store: LabStore, path: string | null) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const serial = useRef(0);
  const request = store.request;
  const invalidate = useCallback(() => {
    serial.current++;
  }, []);
  const refresh = useCallback(async () => {
    if (!path) return;
    const current = ++serial.current;
    setLoading(true);
    setError(undefined);
    try {
      const next = await request<T>(path);
      if (current === serial.current) setData(next);
      return next;
    } catch (e) {
      if (current === serial.current) setError(e);
      throw e;
    } finally {
      if (current === serial.current) setLoading(false);
    }
  }, [request, path]);
  useEffect(() => {
    setData(undefined);
    if (path) refresh().catch(() => {});
    return () => {
      invalidate();
    };
  }, [refresh, path, invalidate]);
  useEffect(() => {
    const resume = () => void refresh().catch(() => {});
    window.addEventListener("mobileResume", resume);
    window.addEventListener("online", resume);
    return () => {
      window.removeEventListener("mobileResume", resume);
      window.removeEventListener("online", resume);
    };
  }, [refresh]);
  return { data, error, loading, refresh, setData };
}
