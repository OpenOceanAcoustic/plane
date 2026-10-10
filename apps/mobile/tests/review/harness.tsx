import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FormSheet, Sheet } from "../../src/components/ui";
import { ApiClient } from "../../src/lib/client";
import { useLabTransport, useResource } from "../../src/features/lab/transport";
import { LabDialog } from "../../src/features/lab/ui";
// oxlint-disable-next-line import/no-unassigned-import -- render the real mobile sheet surfaces
import "../../src/styles.css";
let revision = 0;
const client = new ApiClient("https://test.example", {
  request: async () => ({ status: 200, data: { revision: ++revision }, headers: {} }),
  clearSession: async () => {},
});
function Harness() {
  const [parent, setParent] = useState(true),
    [child, setChild] = useState(false);
  const [form, setForm] = useState(false);
  const [lab, setLab] = useState(false);
  const store = useLabTransport(client, "review");
  const resource = useResource<{ revision: number }>(store, "funds/");
  return (
    <>
      <output aria-label="revision">{resource.data?.revision ?? 0}</output>
      <button onClick={() => setForm(true)}>form</button>
      {parent && (
        <Sheet title="parent" onClose={() => setParent(false)}>
          <button onClick={() => setChild(true)}>child</button>
          <button onClick={() => setLab(true)}>lab child</button>
          {child && (
            <Sheet title="child" onClose={() => setChild(false)}>
              nested
            </Sheet>
          )}
          {lab && (
            <LabDialog title="lab child" onClose={() => setLab(false)}>
              nested
            </LabDialog>
          )}
        </Sheet>
      )}
      {form && (
        <FormSheet
          title="saving"
          fields={[]}
          onClose={() => setForm(false)}
          onSubmit={() =>
            new Promise((resolve) => {
              window.addEventListener("completeSave", () => resolve(undefined), { once: true });
            })
          }
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
