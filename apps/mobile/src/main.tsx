import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// oxlint-disable-next-line import/no-unassigned-import -- application stylesheet
import "./styles.css";
// oxlint-disable-next-line import/no-unassigned-import -- fixed reference typefaces
import "./v6-fonts.css";
// oxlint-disable-next-line import/no-unassigned-import -- approved V6 reference composition
import "./v6-reference.css";
// oxlint-disable-next-line import/no-unassigned-import -- adaptations for live business records
import "./features/lab/v6.css";
// oxlint-disable-next-line import/no-unassigned-import -- native layout and shared V6 controls
import "./v6.css";

// oxlint-disable-next-line import/no-unassigned-import -- Material selection surfaces
import "./components/select.css";

// oxlint-disable-next-line import/no-unassigned-import -- Material typography and compact planner labels
import "./m3-refinements.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
