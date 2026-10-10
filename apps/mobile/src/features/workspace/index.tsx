import type { WorkspaceProps } from "./business";
import Widgets from "./widgets";
import Drafts from "./drafts";
import Activity from "./activity";
import WorkspaceViews from "./views";
import ActiveCycles from "./cycles";
import WorkspaceAnalytics from "./analytics";
import Commands from "./commands";
// oxlint-disable-next-line import/no-unassigned-import -- mobile workspace presentation
import "./workspace.css";
export default function WorkspaceFeature(props: WorkspaceProps) {
  let content;
  switch (props.section) {
    case "widgets":
      content = <Widgets {...props} />;
      break;
    case "drafts":
      content = <Drafts {...props} />;
      break;
    case "activity":
      content = <Activity {...props} />;
      break;
    case "workspace-views":
      content = <WorkspaceViews {...props} />;
      break;
    case "active-cycles":
      content = <ActiveCycles {...props} />;
      break;
    case "workspace-analytics":
      content = <WorkspaceAnalytics {...props} />;
      break;
    case "commands":
      content = <Commands {...props} />;
      break;
    default:
      content = <p className="error">无法识别工作区页面</p>;
  }
  return (
    <div
      className="lab-feature workspace-feature"
      key={`${props.client.server}:${props.workspaceSlug}:${props.section}`}
    >
      {content}
    </div>
  );
}
