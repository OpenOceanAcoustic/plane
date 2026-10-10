/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useContext, useState } from "react";
import { MobileHeaderContext } from "../../components/navigation";
import type { ApiClient } from "../../lib/client";
import { useLabTransport } from "./transport";
import { Planner } from "./planner";
import { Fields } from "./fields";
import { Bounties } from "./bounties";
import { Finance } from "./finance";
import { Analytics } from "./analytics";
import { Contributions } from "./contributions";
import { Documents } from "./documents";
import { LabField, ErrorMessage } from "./ui";
// oxlint-disable-next-line import/no-unassigned-import -- local mobile business surfaces
import "./lab.css";
export { TaskDocuments } from "./documents";
export { useLabTransport } from "./transport";
export type LabFeatureProps = {
  section: string;
  workspaceSlug: string;
  client: ApiClient;
  onOpenIssue?: (project: string, issue: string) => void;
  onOpenProject?: (project: string) => void;
  onOpenDocument?: (project: string, page: string) => void;
};
export default function LabFeature({
  section,
  workspaceSlug,
  client,
  onOpenIssue,
  onOpenProject,
  onOpenDocument,
}: LabFeatureProps) {
  const store = useLabTransport(client, workspaceSlug);
  const header = useContext(MobileHeaderContext);
  const [bounty, setBounty] = useState("");
  const [taskProject, setTaskProject] = useState("");
  const openBounty = (id: string) => setBounty(id);
  return (
    <div className="lab-feature">
      <ErrorMessage error={store.error} />
      <MobileHeaderContext.Provider value={bounty ? null : header}>
        <div style={{ display: bounty ? "none" : "contents" }}>
          {section === "planner" && <Planner store={store} onOpenIssue={onOpenIssue} onOpenBounty={openBounty} />}
          {section === "team" && <Planner store={store} team onOpenIssue={onOpenIssue} onOpenBounty={openBounty} />}
          {section === "tasks" && (
            <>
              <LabField label="项目">
                <select value={taskProject} onChange={(e) => setTaskProject(e.target.value)}>
                  <option value="">全部项目</option>
                  {store.planner?.projects.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </LabField>
              <Fields store={store} projectId={taskProject} onOpenIssue={onOpenIssue} />
            </>
          )}
          {section === "bounties" && (
            <Bounties
              store={store}
              onOpenIssue={onOpenIssue}
              onDownload={async (path, name) => {
                await client.download(path, name);
              }}
            />
          )}
          {["finance", "workflow"].includes(section) && (
            <Finance
              key={section}
              store={store}
              initialTab={section === "workflow" ? "workflow" : "accounts"}
              onOpenIssue={onOpenIssue}
            />
          )}
          {section === "analytics" && (
            <Analytics store={store} onOpenIssue={onOpenIssue} onOpenProject={onOpenProject} />
          )}
          {section === "contributions" && (
            <Contributions
              store={store}
              onOpenIssue={onOpenIssue}
              onOpenProject={onOpenProject}
              onOpenBounty={openBounty}
            />
          )}
          {section === "documents" && (
            <Documents store={store} onOpenDocument={onOpenDocument} onOpenIssue={onOpenIssue} />
          )}
        </div>
      </MobileHeaderContext.Provider>
      {bounty && (
        <Bounties
          key={bounty}
          store={store}
          initialId={bounty}
          onCloseDetail={() => setBounty("")}
          onOpenIssue={onOpenIssue}
          onDownload={async (path, name) => {
            await client.download(path, name);
          }}
        />
      )}
    </div>
  );
}
