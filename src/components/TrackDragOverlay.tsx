import { useEffect, useState } from "react";
import { ArrowUpDown, ListPlus, Plus } from "lucide-react";
import type { UnifiedTrack } from "../types/spotify";
import { LazyCover } from "./LazyCover";

export interface DragSourceMeta {
  playlistId: string;
  index: number;
}

export type DropTarget =
  | { kind: "playlist"; id: string; name: string }
  | { kind: "queue" }
  | { kind: "reorder"; playlistId: string; fromIndex: number; toIndex: number };

export interface ActiveTrackDrag {
  track: UnifiedTrack;
  source?: DragSourceMeta;
  x: number;
  y: number;
  target: DropTarget | null;
}

type DragListener = (state: ActiveTrackDrag | null) => void;
type DropHandler = (target: DropTarget, track: UnifiedTrack) => void;

let currentDrag: ActiveTrackDrag | null = null;
let dropHandler: DropHandler | null = null;
let lastDragEndedAt = 0;
const listeners = new Set<DragListener>();

function emitDrag(next: ActiveTrackDrag | null) {
  currentDrag = next;
  for (const fn of listeners) fn(next);
}

export function registerTrackDropHandler(handler: DropHandler | null) {
  dropHandler = handler;
}

export function subscribeTrackDrag(listener: DragListener): () => void {
  listeners.add(listener);
  listener(currentDrag);
  return () => {
    listeners.delete(listener);
  };
}

export function wasRecentTrackDrag(): boolean {
  return performance.now() - lastDragEndedAt < 260;
}

function findDropTarget(
  x: number,
  y: number,
  source?: DragSourceMeta
): DropTarget | null {
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    if (!(el instanceof HTMLElement)) continue;

    const playlistEl = el.closest<HTMLElement>("[data-drop-playlist-id]");
    if (playlistEl) {
      const id = playlistEl.dataset.dropPlaylistId;
      if (id) {
        return {
          kind: "playlist",
          id,
          name: playlistEl.dataset.dropPlaylistName || "playlist",
        };
      }
    }

    const queueEl = el.closest<HTMLElement>("[data-drop-queue]");
    if (queueEl) {
      return { kind: "queue" };
    }

    if (source) {
      const rowEl = el.closest<HTMLElement>("[data-reorder-playlist-id]");
      if (rowEl && rowEl.dataset.reorderPlaylistId === source.playlistId) {
        const idx = Number(rowEl.dataset.reorderIndex);
        if (Number.isInteger(idx) && idx >= 0 && idx !== source.index) {
          return {
            kind: "reorder",
            playlistId: source.playlistId,
            fromIndex: source.index,
            toIndex: idx,
          };
        }
      }
    }
  }
  return null;
}

function setGlobalSelectionDisabled(disabled: boolean) {
  const style = document.body.style as CSSStyleDeclaration & {
    webkitUserSelect?: string;
  };
  style.userSelect = disabled ? "none" : "";
  style.webkitUserSelect = disabled ? "none" : "";
  style.cursor = disabled ? "grabbing" : "";
  if (disabled) {
    window.getSelection()?.removeAllRanges();
  }
}

/**
 * Initiates a smooth, WKWebView-safe pointer drag for any track row.
 * Prevents native WebKit text selection immediately on pointerdown and
 * activates the drag overlay after moving >= 7px so normal clicks work normally.
 */
export function startTrackPointerDrag(
  e: React.PointerEvent,
  track: UnifiedTrack,
  source?: DragSourceMeta
) {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest("button, a, input, select")) return;

  // Prevent macOS WKWebView from starting text selection before drag threshold is met
  e.preventDefault();
  window.getSelection()?.removeAllRanges();

  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;

  const preventSelect = (ev: Event) => {
    ev.preventDefault();
  };

  const handleMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragging) {
      if (Math.hypot(dx, dy) < 7) return;
      dragging = true;
      setGlobalSelectionDisabled(true);
    }
    ev.preventDefault();
    const hit = findDropTarget(ev.clientX, ev.clientY, source);
    emitDrag({
      track,
      source,
      x: ev.clientX,
      y: ev.clientY,
      target: hit,
    });
  };

  const cleanup = () => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleCancel);
    window.removeEventListener("keydown", handleKey);
    document.removeEventListener("selectstart", preventSelect);
    setGlobalSelectionDisabled(false);
  };

  const handleUp = (ev: PointerEvent) => {
    cleanup();
    if (!dragging) return;
    lastDragEndedAt = performance.now();
    const hit = findDropTarget(ev.clientX, ev.clientY, source);
    emitDrag(null);
    if (hit && dropHandler) {
      dropHandler(hit, track);
    }
  };

  const handleCancel = () => {
    cleanup();
    if (dragging) {
      lastDragEndedAt = performance.now();
      emitDrag(null);
    }
  };

  const handleKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      handleCancel();
    }
  };

  document.addEventListener("selectstart", preventSelect);
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleCancel);
  window.addEventListener("keydown", handleKey);
}

export function TrackDragOverlay() {
  const [drag, setDrag] = useState<ActiveTrackDrag | null>(null);

  useEffect(() => subscribeTrackDrag(setDrag), []);

  if (!drag) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 z-[90] will-change-transform"
      style={{
        transform: `translate3d(${drag.x + 14}px, ${drag.y + 14}px, 0)`,
      }}
    >
      <div className="popover-glass flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl border border-[var(--border-subtle)] shadow-2xl max-w-[270px]">
        <LazyCover
          src={drag.track.albumImage}
          alt={drag.track.name}
          className="w-8 h-8"
          iconSize={12}
          roundedClass="rounded-md"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-[var(--text-primary)] truncate">
            {drag.track.name}
          </div>
          <div className="text-[10.5px] text-[var(--text-secondary)] truncate flex items-center gap-1">
            {drag.target?.kind === "playlist" ? (
              <>
                <Plus size={10} strokeWidth={2} className="shrink-0 text-[var(--text-primary)]" />
                <span className="truncate text-[var(--text-primary)] font-medium">
                  Añadir a {drag.target.name}
                </span>
              </>
            ) : drag.target?.kind === "queue" ? (
              <>
                <ListPlus size={10} strokeWidth={2} className="shrink-0 text-[var(--text-primary)]" />
                <span className="truncate text-[var(--text-primary)] font-medium">
                  Añadir a la cola
                </span>
              </>
            ) : drag.target?.kind === "reorder" ? (
              <>
                <ArrowUpDown size={10} strokeWidth={2} className="shrink-0 text-[var(--text-primary)]" />
                <span className="truncate text-[var(--text-primary)] font-medium">
                  Mover a la posición #{drag.target.toIndex + 1}
                </span>
              </>
            ) : (
              <span className="truncate">Suelta en una playlist o en la cola</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
