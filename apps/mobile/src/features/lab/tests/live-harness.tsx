/** Real isolated-server browser entry, never imported by the release application. */
import { createRoot } from "react-dom/client";
// oxlint-disable-next-line import/no-unassigned-import -- same presentation as installed app
import "../../../styles.css";
import { MobileClientContext } from "../../../components/rich-editor";
import { ApiClient } from "../../../lib/client";
import LabFeature from "../index";
import WorkspaceFeature from "../../workspace";
const query = new URLSearchParams(location.search),
  slug = query.get("workspace") ?? "",
  section = query.get("section") ?? "planner",
  client = new ApiClient("http://127.0.0.1:18100");
const routes: unknown[] = [];
Object.assign(window, { businessRoutes: routes });
createRoot(document.getElementById("root")!).render(
  <MobileClientContext.Provider value={client}>
    {query.has("workspaceFeature") ? (
      <WorkspaceFeature
        section={section}
        workspaceSlug={slug}
        client={client}
        onNavigate={(route) => routes.push(route)}
      />
    ) : (
      <LabFeature
        section={section}
        workspaceSlug={slug}
        client={client}
        onOpenIssue={(projectId, issueId) => routes.push({ projectId, issueId })}
        onOpenProject={(projectId) => routes.push({ projectId })}
        onOpenDocument={(projectId, pageId) => routes.push({ projectId, pageId })}
      />
    )}
  </MobileClientContext.Provider>
);
