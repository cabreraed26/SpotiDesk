import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DesktopNotch } from "./components/DesktopNotch";
import "./index.css";

const isNotchWindow =
  new URLSearchParams(window.location.search).get("window") === "notch";

if (isNotchWindow) {
  document.documentElement.dataset.window = "notch";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isNotchWindow ? <DesktopNotch /> : <App />}
  </React.StrictMode>
);
