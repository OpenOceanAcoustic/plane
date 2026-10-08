/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import assert from "node:assert/strict";
import test from "node:test";
import { createTable, getCoreRowModel, getFilteredRowModel } from "@tanstack/react-table";
import type { LabStore } from "@plane/shared-state";
import { csvText, fieldValueText } from "./fields-types";
import type { LabTaskRow } from "./fields-types";
import { LabFieldsStore } from "@plane/shared-state";
import { ganttDay, ganttLabel } from "./gantt-helpers";

test("task exports preserve quotes and unicode while neutralizing spreadsheet formulas", () => {
  assert.equal(
    csvText([
      ["=SUM(1)", "普通文本", '含"引号'],
      ["@secret", false, 0],
    ]),
    '\ufeff"\'=SUM(1)","普通文本","含""引号"\r\n"\'@secret","false","0"'
  );
  assert.equal(fieldValueText(false), "否");
  assert.equal(fieldValueText(["海试", "水池"]), "海试、水池");
});
test("Frappe SVG labels escape task names and use calendar dates rather than UTC serialization", () => {
  assert.equal(
    ganttLabel("<script>\"实验\" & '记录'</script>"),
    "&lt;script&gt;&quot;实验&quot; &amp; &#39;记录&#39;&lt;/script&gt;"
  );
  assert.equal(ganttDay(new Date(2026, 9, 8, 23, 59)), "2026-10-08");
});

test("an inline field edit refreshes TanStack filtering without reloading the page", async () => {
  const transport = { request: async () => ({ values: { parameter: "42" } }) } as unknown as LabStore;
  const store = new LabFieldsStore(transport);
  store.tasks = [
    {
      id: "task",
      key: "LAB-1",
      title: "实验",
      project_id: "project",
      project: "Lab",
      state: "待做",
      priority: "none",
      start_date: null,
      target_date: null,
      editable: true,
      values: { parameter: "" },
    },
  ];
  const original = store.tasks;
  const table = createTable<LabTaskRow>({
    data: store.tasks,
    columns: [{ id: "parameter", accessorFn: (row) => row.values.parameter, filterFn: "includesString" }],
    state: { columnFilters: [{ id: "parameter", value: "42" }] },
    onStateChange: () => undefined,
    renderFallbackValue: null,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  assert.equal(table.getFilteredRowModel().rows.length, 0);
  await store.update("task", "parameter", "42");
  table.setOptions((options) => ({ ...options, data: store.tasks }));
  assert.equal(table.getFilteredRowModel().rows.length, 1);
  assert.equal(original[0]!.values.parameter, "");
});

function tableRow(project: string): LabTaskRow {
  return {
    id: project,
    key: `${project}-1`,
    title: project,
    project_id: project,
    project,
    state: "待做",
    priority: "none",
    start_date: null,
    target_date: null,
    editable: true,
    values: {},
  };
}

test("a slower project response cannot overwrite the latest project rows or CSV", async () => {
  type Data = { tasks: LabTaskRow[]; fields: [] };
  const resolvers = new Map<string, (value: Data) => void>();
  const transport = {
    request: (path: string) => new Promise<Data>((resolve) => resolvers.set(path, resolve)),
  } as unknown as LabStore;
  const store = new LabFieldsStore(transport);

  const a = store.load("A");
  const b = store.load("B");
  resolvers.get("task-table/?project=B")!({ tasks: [tableRow("B")], fields: [] });
  const latest = await b;
  assert.equal(latest?.tasks[0]!.title, "B");
  resolvers.get("task-table/?project=A")!({ tasks: [tableRow("A")], fields: [] });
  assert.equal(await a, undefined);
  assert.deepEqual(
    store.tasks.map((task) => task.title),
    ["B"]
  );
  assert.equal(csvText(store.tasks.map((task) => [task.title])), '\ufeff"B"');
});

test("unmount cancellation prevents a pending response from applying", async () => {
  let resolve!: (data: { tasks: []; fields: [] }) => void;
  const transport = {
    request: () =>
      new Promise((done) => {
        resolve = done;
      }),
  } as unknown as LabStore;
  const store = new LabFieldsStore(transport);
  const pending = store.load("A");
  store.invalidateLoads();
  resolve({ tasks: [], fields: [] });
  assert.equal(await pending, undefined);
});
