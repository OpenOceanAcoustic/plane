/* oxlint-disable import/no-unassigned-import -- isolated browser harness styles */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ApiClient } from "../../../lib/client";
import { useData, type Entity } from "../../../components/ui";
import Projects from "../projects";
import Space from "../../space";
import { ProjectFeatures } from "../../settings/project-options";
import "../../../styles.css";
import "../core.css";

const params = new URLSearchParams(location.search);
const workspaceSlug = params.get("workspace") ?? "android-lab";
const projectId = params.get("project") ?? "";
const client = new ApiClient("http://127.0.0.1:18100");
function Harness() {
  const [tab, setTab] = useState("projects");
  const base = `/api/workspaces/${workspaceSlug}/projects/${projectId}/`;
  return (
    <main>
      <nav>
        <button onClick={() => setTab("projects")}>项目测试</button>
        <button onClick={() => setTab("features")}>功能测试</button>
        <button onClick={() => setTab("space")}>共享测试</button>
      </nav>
      {tab === "projects" && (
        <Projects section="projects" workspaceSlug={workspaceSlug} client={client} onNavigate={() => {}} />
      )}
      {tab === "features" && <FeaturePanel base={base} />}
      {tab === "space" && <Space client={client} />}
    </main>
  );
}
function FeaturePanel({ base }: { base: string }) {
  const project = useData<Entity>(client, projectId ? base : null);
  return project.data ? (
    <ProjectFeatures client={client} base={base} project={project.data} refresh={project.refresh} manage />
  ) : null;
}
createRoot(document.getElementById("root")!).render(<Harness />);
