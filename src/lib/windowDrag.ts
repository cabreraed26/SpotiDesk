import { invoke } from "@tauri-apps/api/core";

const INTERACTIVE_SELECTOR =
  "button, a, input, select, textarea, [role='button'], [data-no-drag]";

/**
 * Reliable, 120Hz-smooth native macOS window drag driven by AppKit
 * `NSEvent::mouseLocation()` + `NSWindow::setFrameOrigin` in Rust.
 *
 * Avoids the well-known WKWebView + `titleBarStyle: "Overlay"` failure mode
 * where `data-tauri-drag-region` / `performWindowDragWithEvent:` silently
 * drops drags because `NSApp.currentEvent` is stale across async IPC.
 */
export function startMacWindowDrag(
  e: React.PointerEvent<HTMLElement>,
  onDoubleClick?: () => void
) {
  if (e.button !== 0) return;

  const target = e.target as HTMLElement | null;
  if (target?.closest(INTERACTIVE_SELECTOR)) return;

  if (e.detail === 2) {
    e.preventDefault();
    onDoubleClick?.();
    return;
  }

  e.preventDefault();
  const el = e.currentTarget;
  const pointerId = e.pointerId;

  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Ignore if capture is unavailable
  }

  let active = true;
  let rafPending = false;

  void invoke("begin_window_drag").catch(() => {});

  const handleMove = (ev: PointerEvent) => {
    if (!active || ev.pointerId !== pointerId) return;
    // If the primary mouse button was released outside the window, finish cleanly
    if ((ev.buttons & 1) === 0) {
      cleanup();
      return;
    }
    if (!rafPending) {
      rafPending = true;
      window.requestAnimationFrame(() => {
        rafPending = false;
        if (active) {
          void invoke("drag_window_move").catch(() => {});
        }
      });
    }
  };

  const cleanup = () => {
    if (!active) return;
    active = false;
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleEnd);
    window.removeEventListener("pointercancel", handleEnd);
    window.removeEventListener("blur", cleanup);
    try {
      if (el.hasPointerCapture(pointerId)) {
        el.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore
    }
    void invoke("end_window_drag").catch(() => {});
  };

  const handleEnd = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    cleanup();
  };

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleEnd);
  window.addEventListener("pointercancel", handleEnd);
  window.addEventListener("blur", cleanup);
}
