import React, { Component, Suspense, lazy, type ComponentType, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { DesktopNotch } from "./components/DesktopNotch";
import { SpotlightWindow } from "./components/SpotlightWindow";
import "./index.css";

const windowMode = new URLSearchParams(window.location.search).get("window");

if (windowMode === "notch") {
  document.documentElement.dataset.window = "notch";
} else if (windowMode === "spotlight") {
  document.documentElement.dataset.window = "spotlight";
}

function lazyWithRetry<T extends ComponentType<object>>(
  loader: () => Promise<{ default: T }>
) {
  return lazy(() =>
    loader().catch(async () => {
      await new Promise((r) => window.setTimeout(r, 400));
      return loader();
    })
  );
}

class WindowErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[SpotiDesk] Window render error:", error);
    if (windowMode === "notch" || windowMode === "spotlight") {
      window.setTimeout(() => window.location.reload(), 1200);
    }
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

// Keep the heavy main application lazily loaded so Notch & Spotlight windows never parse it,
// while Notch & Spotlight themselves mount synchronously on Frame 0 with zero lazy-chunk races.
const MainApp = lazyWithRetry(() => import("./App"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WindowErrorBoundary>
      {windowMode === "notch" ? (
        <DesktopNotch />
      ) : windowMode === "spotlight" ? (
        <SpotlightWindow />
      ) : (
        <Suspense fallback={null}>
          <MainApp />
        </Suspense>
      )}
    </WindowErrorBoundary>
  </React.StrictMode>
);
