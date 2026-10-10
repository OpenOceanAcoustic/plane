import { expect, it } from "vitest";
import { preferencePayload } from "./preferences";
it("saves mobile display choices without removing desktop filters or properties", () => {
  const body = preferencePayload(
    {
      filters: { created_by: ["creator"] },
      display_filters: { show_empty_groups: false },
      display_properties: { desktop_only: true, estimate: true },
    },
    {
      layout: "timeline",
      state: "active",
      priority: "",
      assignees: "",
      labels: "",
      orderBy: "target_date",
      groupBy: "priority",
      fields: ["key", "due_date"],
    }
  );
  expect(body.filters).toEqual({
    created_by: ["creator"],
    state: ["active"],
    priority: null,
    assignees: null,
    labels: null,
  });
  expect(body.display_filters).toEqual({
    show_empty_groups: false,
    layout: "gantt",
    order_by: "target_date",
    group_by: "priority",
  });
  expect(body.display_properties).toMatchObject({
    desktop_only: true,
    estimate: false,
    key: true,
    due_date: true,
    state: false,
  });
});
