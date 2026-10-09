/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type {
  ColumnDef,
  ColumnFiltersState,
  ExpandedState,
  GroupingState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import type { LabStore } from "@plane/shared-state";
import { LabFieldsStore } from "@plane/shared-state";
import { Button, labInputClass } from "@plane/ui";
import { LabFieldEditor, LabFieldManager } from "./field-manager";
import type { LabCustomField, LabTaskRow } from "./fields-types";
import { csvText, downloadText, fieldValueText } from "./fields-types";
// oxlint-disable-next-line import/no-unassigned-import -- local financial and task surfaces
import "./finance-market.css";

type Config = { fields: LabCustomField[]; members: { id: string; name: string }[] };
export const LabTaskTable = observer(function LabTaskTable({
  store,
  refreshKey = 0,
}: {
  store: LabStore;
  refreshKey?: number;
}) {
  const fieldsStore = useMemo(() => new LabFieldsStore(store), [store]);
  const [projectId, setProjectId] = useState("");
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filters, setFilters] = useState<ColumnFiltersState>([]);
  const [grouping, setGrouping] = useState<GroupingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>(true);
  const [visibility, setVisibility] = useState<VisibilityState>({ start_date: false });
  const [configs, setConfigs] = useState<Record<string, Config>>({});
  const [manage, setManage] = useState(false);
  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setConfigs({});
    const data = await fieldsStore.load(projectId);
    if (!data || generation !== loadGeneration.current) return;
    const ids = [...new Set(data.tasks.map((task) => task.project_id))];
    try {
      const pairs = await Promise.all(
        ids.map(async (id) => [id, await store.request<Config>(`projects/${id}/fields/`)] as const)
      );
      if (generation === loadGeneration.current) setConfigs(Object.fromEntries(pairs));
    } catch (error) {
      if (generation === loadGeneration.current) throw error;
    }
  }, [fieldsStore, projectId, store]);
  useEffect(() => {
    void store.execute(load);
    return () => {
      loadGeneration.current += 1;
      fieldsStore.invalidateLoads();
    };
  }, [store, fieldsStore, load, refreshKey]);
  const currentFields = fieldsStore.fields;
  const columns = useMemo<ColumnDef<LabTaskRow>[]>(
    () => [
      {
        accessorKey: "key",
        header: "编号",
        cell: ({ row, getValue }) => (
          <a
            className="text-accent-primary"
            href={`/${store.slug}/projects/${row.original.project_id}/issues/${row.original.id}`}
          >
            {String(getValue())}
          </a>
        ),
      },
      {
        accessorKey: "title",
        header: "任务",
        cell: ({ row, getValue }) => (
          <a
            href={`/${store.slug}/projects/${row.original.project_id}/issues/${row.original.id}`}
            className="hover:text-accent-primary"
          >
            {String(getValue())}
          </a>
        ),
      },
      { accessorKey: "project", header: "项目" },
      { accessorKey: "state", header: "状态" },
      {
        accessorKey: "priority",
        header: "优先级",
        cell: ({ getValue }) =>
          ({ urgent: "紧急", high: "高", medium: "中", low: "低", none: "无" })[
            String(getValue()) as LabTaskRow["priority"]
          ] ?? String(getValue()),
      },
      { accessorKey: "start_date", header: "开始日期" },
      { accessorKey: "target_date", header: "截止日期" },
      ...currentFields.map(
        (field): ColumnDef<LabTaskRow> => ({
          id: `field_${field.id}`,
          header: `${field.name}${field.archived ? "（停用）" : ""}`,
          accessorFn: (row) =>
            field.kind === "number" ? (row.values[field.id] ?? null) : fieldValueText(row.values[field.id]),
          sortingFn: field.kind === "number" ? "basic" : "alphanumeric",
          cell: ({ row }) => {
            const config = configs[row.original.project_id];
            const bound = config?.fields.find((f) => f.id === field.id);
            return (
              <div className="min-w-36">
                <LabFieldEditor
                  field={{ ...field, enabled: bound?.enabled ?? false }}
                  value={row.original.values[field.id]}
                  members={config?.members}
                  disabled={!row.original.editable}
                  save={(value) => fieldsStore.update(row.original.id, field.id, value)}
                />
              </div>
            );
          },
        })
      ),
    ],
    [currentFields, configs, fieldsStore, store.slug]
  );
  const table = useReactTable({
    data: fieldsStore.tasks,
    columns,
    state: { sorting, columnFilters: filters, grouping, expanded, columnVisibility: visibility, globalFilter: query },
    onSortingChange: setSorting,
    onColumnFiltersChange: setFilters,
    onGroupingChange: setGrouping,
    onExpandedChange: setExpanded,
    onColumnVisibilityChange: setVisibility,
    onGlobalFilterChange: setQuery,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
    globalFilterFn: "includesString",
    defaultColumn: { filterFn: "includesString" },
  });
  return (
    <div className="lab-task-table flex flex-col gap-4">
      <div className="lab-task-toolbar flex flex-wrap items-center gap-3">
        <select
          aria-label="项目筛选"
          className={`${labInputClass} max-w-52`}
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">全部项目</option>
          {store.planner?.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <input
          aria-label="搜索任务与字段"
          className={`${labInputClass} max-w-64`}
          placeholder="搜索任务与字段…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="任务分组"
          className={`${labInputClass} max-w-48`}
          value={grouping[0] ?? ""}
          onChange={(event) => {
            setGrouping(event.target.value ? [event.target.value] : []);
            setExpanded(true);
          }}
        >
          <option value="">不分组</option>
          {table
            .getAllLeafColumns()
            .filter((column) => !["key", "title"].includes(column.id))
            .map((column) => (
              <option key={column.id} value={column.id}>
                {String(column.columnDef.header)}
              </option>
            ))}
        </select>
        <details className="relative">
          <summary className="cursor-pointer rounded-md border border-subtle px-3 py-2 text-13">显示列</summary>
          <div className="shadow-overlay absolute right-0 z-20 mt-2 min-w-44 rounded-lg border border-subtle bg-surface-1 p-3">
            {table.getAllLeafColumns().map((column) => (
              <label key={column.id} className="flex gap-2 py-1 text-13">
                <input type="checkbox" checked={column.getIsVisible()} onChange={column.getToggleVisibilityHandler()} />
                {String(column.columnDef.header)}
              </label>
            ))}
          </div>
        </details>
        <Button size="sm" variant="neutral-primary" onClick={() => setManage(!manage)}>
          管理字段
        </Button>
        <Button
          size="sm"
          variant="neutral-primary"
          onClick={() => {
            const visible = table.getVisibleLeafColumns();
            downloadText(
              csvText([
                visible.map((column) => column.columnDef.header),
                ...table.getFilteredRowModel().rows.map((row) => visible.map((column) => row.getValue(column.id))),
              ]),
              "任务表格.csv"
            );
          }}
        >
          导出筛选结果
        </Button>
      </div>
      {manage && <LabFieldManager store={store} projectId={projectId} changed={() => void store.execute(load)} />}
      <div className="lab-task-table-surface overflow-auto rounded-lg border border-subtle">
        <table className="w-full border-collapse text-left text-13">
          <thead className="bg-layer-1">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id} className="min-w-28 border-b border-subtle p-3 font-medium">
                    <button
                      className="flex w-full items-center gap-1 text-left"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === "asc"
                        ? " ↑"
                        : header.column.getIsSorted() === "desc"
                          ? " ↓"
                          : ""}
                    </button>
                    <input
                      aria-label={`筛选 ${String(header.column.columnDef.header)}`}
                      className="font-normal mt-2 w-full rounded border border-subtle bg-surface-1 px-2 py-1 text-11 outline-none"
                      value={String(header.column.getFilterValue() ?? "")}
                      onChange={(event) => header.column.setFilterValue(event.target.value)}
                      placeholder="筛选…"
                    />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                data-grouped={row.getIsGrouped() || undefined}
                className="border-b border-subtle hover:bg-layer-1"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="p-3 align-top">
                    {cell.getIsGrouped() ? (
                      <button className="font-medium" onClick={row.getToggleExpandedHandler()}>
                        {row.getIsExpanded() ? "▾" : "▸"} {String(cell.getValue() ?? "未填写")}（{row.subRows.length}）
                      </button>
                    ) : cell.getIsAggregated() ? (
                      ""
                    ) : cell.getIsPlaceholder() ? (
                      ""
                    ) : (
                      flexRender(
                        cell.column.columnDef.cell ?? ((context) => String(context.getValue() ?? "")),
                        cell.getContext()
                      )
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!fieldsStore.tasks.length && <p className="p-8 text-center text-13 text-secondary">没有可访问的任务</p>}
        {fieldsStore.tasks.length > 0 && !table.getRowModel().rows.length && (
          <p className="p-8 text-center text-13 text-secondary">没有符合筛选条件的任务</p>
        )}
      </div>
      <footer className="flex items-center gap-3 text-13 text-secondary">
        <span className="mr-auto">
          {table.getFilteredRowModel().rows.length} 项任务 · 第 {table.getState().pagination.pageIndex + 1} /{" "}
          {Math.max(1, table.getPageCount())} 页
        </span>
        <Button
          size="sm"
          variant="neutral-primary"
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.previousPage()}
        >
          上一页
        </Button>
        <Button size="sm" variant="neutral-primary" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
          下一页
        </Button>
        <select
          aria-label="每页任务数"
          value={table.getState().pagination.pageSize}
          onChange={(event) => table.setPageSize(Number(event.target.value))}
        >
          {[25, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size} / 页
            </option>
          ))}
        </select>
      </footer>
    </div>
  );
});
