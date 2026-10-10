import { PageHeading } from "../../components/ui";
import type { CoreProps } from "./model";
import Projects from "./projects";
import Tasks, { IssueDetail, MyTasks, ArchivedTasks } from "./tasks";
import Collections from "./collections";
import Overview from "./overview";
import Intake from "./intake";
// Feature styles belong to this entrypoint.
// eslint-disable-next-line import/no-unassigned-import
import "./core.css";

export type { CoreProps, CoreRoute } from "./model";
export default function CoreFeature(props: CoreProps) {
  if (props.section === "projects") return <Projects {...props} />;
  if (props.section === "project-overview") return <Overview {...props} />;
  if (props.section === "intake") return <Intake {...props} />;
  if (props.section === "archived-tasks") return <ArchivedTasks {...props} />;
  if (props.section === "my-tasks") return <MyTasks {...props} />;
  if (props.section === "issue") return <IssueDetail {...props} />;
  if (["cycles", "modules", "views"].includes(props.section)) return <Collections {...props} />;
  if (props.section === "tasks") return <Tasks {...props} />;
  return <PageHeading title="项目" />;
}
