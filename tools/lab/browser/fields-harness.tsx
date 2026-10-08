/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { observer } from "mobx-react";
import { LabStore } from "../../../packages/shared-state/src/lab.store";
import { LabFieldManager } from "../../../apps/web/core/components/lab/field-manager";
import { LabFrappeGantt } from "../../../apps/web/core/components/lab/frappe-gantt";

const Fields = observer(function Fields() {
  const store = useMemo(() => new LabStore("", "lab"), []);
  const [project, setProject] = useState("A");
  const [visible, setVisible] = useState(true);
  const [notice, setNotice] = useState("");
  return (
    <>
      <select aria-label="选择项目" value={project} onChange={(event) => setProject(event.target.value)}>
        <option value="A">项目 A</option>
        <option value="B">项目 B</option>
      </select>
      <button onClick={() => setVisible((value) => !value)}>切换字段管理</button>
      {store.error && <p role="alert">{store.error}</p>}
      {notice && <p role="status">{notice}</p>}
      {visible && <LabFieldManager store={store} projectId={project} changed={() => setNotice(`已保存 ${project}`)} />}
    </>
  );
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.pathname === "/gantt" ? (
      <LabFrappeGantt
        workspaceSlug="lab"
        projectId="A"
        issueIds={["predecessor", "successor"]}
        editable
        openTask={() => undefined}
        updated={() => undefined}
      />
    ) : (
      <Fields />
    )}
  </StrictMode>
);
