import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// oxlint-disable-next-line import/no-unassigned-import -- application stylesheet
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
