import React from "react";
import { RotateCcw } from "lucide-react";

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message =
      error instanceof Error ? error.message : "Ocurrió un error inesperado al renderizar.";
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown) {
    console.error("[SpotyFast] Runtime error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
            Algo salió mal en esta vista
          </h2>
          <p className="mt-2 text-[13px] text-[var(--text-secondary)] max-w-[440px]">
            {this.state.message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: "" })}
            className="mt-6 h-9 px-5 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] text-[13px] font-medium inline-flex items-center gap-2 cursor-pointer"
          >
            <RotateCcw size={14} strokeWidth={1.5} />
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
