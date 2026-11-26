import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Disc3,
  Heart,
  Maximize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type { UnifiedTrack } from "../types/spotify";
import type { ThemeMode } from "../hooks/useTheme";
import { formatDuration } from "../lib/format";
import { LazyCover } from "./LazyCover";
import { PlayWaterDropEffect, StopShockEffect } from "./KineticEffects";

export interface NotchStatePayload {
  track: UnifiedTrack | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  theme: ThemeMode;
  ambientRgb: string | null;
  isLiked: boolean;
}

function readSavedTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem("spotyfast.theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Ignore storage errors
  }
  return "dark";
}

export function DesktopNotch() {
  const [state, setState] = useState<NotchStatePayload>(() => ({
    track: null,
    isPlaying: false,
    positionMs: 0,
    durationMs: 0,
    theme: readSavedTheme(),
    ambientRgb: null,
    isLiked: false,
  }));

  const [isExpanded, setIsExpanded] = useState(false);
  const [inflateAnimKey, setInflateAnimKey] = useState(0);
  const [livePosition, setLivePosition] = useState(0);
  const [waterKey, setWaterKey] = useState(0);
  const [tremorKey, setTremorKey] = useState(0);
  const [skipNudge, setSkipNudge] = useState<"next" | "prev" | null>(null);
  const [heartKey, setHeartKey] = useState(0);

  const prevPlayingRef = useRef<boolean | null>(null);
  const hasSyncedStateRef = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.window = "notch";
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  // Listen to native Win32 cursor tracking from Rust (zero HWND resize, zero stuck states)
  useEffect(() => {
    let unlistenHover: (() => void) | undefined;
    void listen<boolean>("notch-hover", (event) => {
      const hovered = Boolean(event.payload);
      setIsExpanded(hovered);
      if (hovered) {
        setInflateAnimKey((k) => k + 1);
      }
    }).then((fn) => {
      unlistenHover = fn;
    });

    return () => {
      unlistenHover?.();
    };
  }, []);

  // Listen to real-time playback updates from the main SpotyFast window
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<NotchStatePayload>("notch-state", (event) => {
      hasSyncedStateRef.current = true;
      const next = event.payload;
      if (prevPlayingRef.current !== null && prevPlayingRef.current !== next.isPlaying) {
        if (next.isPlaying) setWaterKey((k) => k + 1);
        else setTremorKey((k) => k + 1);
      }
      prevPlayingRef.current = next.isPlaying;
      setState(next);
      setLivePosition(next.positionMs);
    }).then((fn) => {
      unlisten = fn;
      void invoke("send_notch_action", { action: "request-state" });
    });

    const syncRetry = window.setTimeout(() => {
      if (!hasSyncedStateRef.current) {
        void invoke("send_notch_action", { action: "request-state" });
      }
    }, 900);

    return () => {
      window.clearTimeout(syncRetry);
      unlisten?.();
    };
  }, []);

  // Lightweight local progress interpolation while inflated & playing
  useEffect(() => {
    if (!state.isPlaying || !isExpanded) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      setLivePosition((prev) =>
        state.durationMs > 0 ? Math.min(prev + delta, state.durationMs) : prev + delta
      );
    }, 300);
    return () => window.clearInterval(timer);
  }, [state.isPlaying, state.durationMs, isExpanded]);

  const sendAction = (action: string) => {
    void invoke("send_notch_action", { action });
  };

  const handlePrimaryPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    cb: () => void
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    cb();
  };

  const handleKeyActivate = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    cb: () => void
  ) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      cb();
    }
  };

  const progressPct =
    state.durationMs > 0 ? Math.min(100, (livePosition / state.durationMs) * 100) : 0;

  return (
    <div className="chrome-no-select w-full h-full flex items-start justify-center bg-transparent select-none">
      {/* Top-Center Apple Dynamic Island Notch inflating smoothly downward like a balloon */}
      <div
        className={`relative overflow-hidden border-x border-b border-[var(--border-subtle)] ${
          isExpanded && inflateAnimKey > 0 ? "anim-balloon-inflate" : ""
        } ${tremorKey > 0 && !state.isPlaying ? "anim-capsule-tremor" : ""}`}
        style={{
          width: isExpanded ? "368px" : "196px",
          height: isExpanded ? "158px" : "36px",
          borderRadius: isExpanded ? "0 0 28px 28px" : "0 0 18px 18px",
          transformOrigin: "top center",
          background:
            state.theme === "dark"
              ? "rgba(8, 8, 10, 0.95)"
              : "rgba(255, 255, 255, 0.96)",
          boxShadow: isExpanded
            ? "0 20px 48px rgba(0, 0, 0, 0.52), 0 -1px 0 rgba(255,255,255,0.06) inset"
            : "0 8px 20px rgba(0, 0, 0, 0.34)",
          transition: isExpanded
            ? "width 500ms cubic-bezier(0.34, 1.38, 0.54, 1), height 500ms cubic-bezier(0.34, 1.38, 0.54, 1), border-radius 460ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 420ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "width 380ms cubic-bezier(0.32, 0.72, 0, 1), height 380ms cubic-bezier(0.32, 0.72, 0, 1), border-radius 340ms cubic-bezier(0.32, 0.72, 0, 1), box-shadow 320ms cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        {/* Subtle ambient glow from active track cover */}
        {state.ambientRgb && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 transition-opacity duration-500"
            style={{
              opacity: isExpanded ? 1 : 0.4,
              background: `radial-gradient(280px circle at 50% 0%, rgba(${state.ambientRgb}, ${
                state.theme === "dark" ? 0.28 : 0.16
              }), transparent 72%)`,
            }}
          />
        )}

        {/* Collapsed Top Dynamic Island Pill (horizontal mini bar) */}
        <div
          aria-hidden={isExpanded}
          className="absolute inset-0 px-3 flex items-center justify-between gap-2.5 transition-all duration-200 ease-apple"
          style={{
            opacity: isExpanded ? 0 : 1,
            transform: isExpanded ? "scale(0.84)" : "scale(1)",
            pointerEvents: "none",
          }}
        >
          <div className="relative shrink-0">
            {state.track?.albumImage ? (
              <LazyCover
                src={state.track.albumImage}
                alt={state.track.name}
                className="w-5 h-5"
                iconSize={11}
                roundedClass="rounded-md"
              />
            ) : (
              <div className="w-5 h-5 rounded-md bg-[var(--bg-card)] border border-[var(--border-hairline)] flex items-center justify-center">
                <Disc3 size={11} strokeWidth={1.6} className="text-[var(--text-secondary)]" />
              </div>
            )}
            <PlayWaterDropEffect triggerKey={waterKey} size="sm" />
          </div>

          <span className="text-[11px] font-medium tracking-[-0.01em] text-[var(--text-primary)] truncate flex-1 text-center">
            {state.track?.name || "SpotiDesk"}
          </span>

          {state.track ? (
            <div
              className={`shrink-0 flex items-end gap-[2px] h-2.5 ${
                state.isPlaying ? "" : "eq-paused"
              }`}
            >
              <span className="eq-bar" />
              <span className="eq-bar" />
              <span className="eq-bar" />
            </div>
          ) : (
            <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-[var(--text-tertiary)] anim-notch-breathe" />
          )}
        </div>

        {/* Expanded Dynamic Island Content (blooms smoothly downward during inflation) */}
        <div
          aria-hidden={!isExpanded}
          className={`relative z-10 w-[368px] h-[158px] px-4 py-3.5 flex flex-col justify-between transition-all duration-250 ease-apple ${
            isExpanded ? "anim-balloon-content" : ""
          }`}
          style={{
            opacity: isExpanded ? 1 : 0,
            transform: isExpanded ? "scale(1)" : "scale(0.9)",
            pointerEvents: isExpanded ? "auto" : "none",
          }}
        >
          {/* Top Row: Cover + Track Info + Open Main App */}
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="relative shrink-0 transition-transform duration-300 ease-apple"
              style={{ transform: state.isPlaying ? "scale(1)" : "scale(0.92)" }}
            >
              <LazyCover
                src={state.track?.albumImage}
                alt={state.track?.name || "SpotiDesk"}
                className="w-12 h-12"
                iconSize={17}
                roundedClass="rounded-xl"
              />
              {waterKey > 0 && state.isPlaying && (
                <span
                  key={waterKey}
                  aria-hidden="true"
                  className="anim-artwork-liquid pointer-events-none absolute inset-0 rounded-xl border border-[var(--solid-bg)]/60"
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold tracking-[-0.02em] text-[var(--text-primary)] truncate">
                {state.track?.name || "SpotiDesk"}
              </div>
              <div className="text-[11.5px] text-[var(--text-secondary)] truncate mt-0.5">
                {state.track?.artists || "Sin reproducción activa"}
              </div>
            </div>

            <button
              type="button"
              onPointerDown={(e) => handlePrimaryPointerDown(e, () => sendAction("open-main"))}
              onKeyDown={(e) => handleKeyActivate(e, () => sendAction("open-main"))}
              title="Abrir SpotiDesk"
              aria-label="Abrir ventana principal de SpotiDesk"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer shrink-0"
            >
              <Maximize2 size={13} strokeWidth={1.5} />
            </button>
          </div>

          {/* Slim Progress Indicator */}
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] tabular-nums text-[var(--text-tertiary)] w-7">
              {formatDuration(livePosition)}
            </span>
            <div className="flex-1 h-[3px] rounded-full bg-[var(--slider-track)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--slider-fill)] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-[var(--text-tertiary)] w-7 text-right">
              {formatDuration(state.durationMs)}
            </span>
          </div>

          {/* Bottom Controls: Prev, Play/Pause (Water Drop / Tremor), Next, Like */}
          <div className="flex items-center justify-between px-4">
            <button
              type="button"
              onPointerDown={(e) =>
                handlePrimaryPointerDown(e, () => {
                  setSkipNudge("prev");
                  window.setTimeout(() => setSkipNudge(null), 260);
                  sendAction("previous");
                })
              }
              onKeyDown={(e) =>
                handleKeyActivate(e, () => {
                  setSkipNudge("prev");
                  window.setTimeout(() => setSkipNudge(null), 260);
                  sendAction("previous");
                })
              }
              title="Anterior"
              aria-label="Pista anterior"
              className={`w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all active:scale-90 cursor-pointer ${
                skipNudge === "prev" ? "anim-nudge-left" : ""
              }`}
            >
              <SkipBack size={15} strokeWidth={1.6} />
            </button>

            <button
              type="button"
              onPointerDown={(e) =>
                handlePrimaryPointerDown(e, () => sendAction("play-pause"))
              }
              onKeyDown={(e) =>
                handleKeyActivate(e, () => sendAction("play-pause"))
              }
              title={state.isPlaying ? "Pausar" : "Reproducir"}
              aria-label={state.isPlaying ? "Pausar" : "Reproducir"}
              className={`relative w-10 h-10 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] flex items-center justify-center transition-transform duration-150 ease-apple active:scale-90 cursor-pointer ${
                tremorKey > 0 && !state.isPlaying ? "anim-kinetic-tremor" : ""
              }`}
            >
              <PlayWaterDropEffect triggerKey={waterKey} size="sm" />
              <StopShockEffect triggerKey={tremorKey} />
              <span key={state.isPlaying ? "p" : "r"} className="anim-icon-pop flex">
                {state.isPlaying ? (
                  <Pause size={16} strokeWidth={1.8} fill="currentColor" />
                ) : (
                  <Play
                    size={16}
                    strokeWidth={1.8}
                    fill="currentColor"
                    className="translate-x-[1px]"
                  />
                )}
              </span>
            </button>

            <button
              type="button"
              onPointerDown={(e) =>
                handlePrimaryPointerDown(e, () => {
                  setSkipNudge("next");
                  window.setTimeout(() => setSkipNudge(null), 260);
                  sendAction("next");
                })
              }
              onKeyDown={(e) =>
                handleKeyActivate(e, () => {
                  setSkipNudge("next");
                  window.setTimeout(() => setSkipNudge(null), 260);
                  sendAction("next");
                })
              }
              title="Siguiente"
              aria-label="Siguiente pista"
              className={`w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all active:scale-90 cursor-pointer ${
                skipNudge === "next" ? "anim-nudge-right" : ""
              }`}
            >
              <SkipForward size={15} strokeWidth={1.6} />
            </button>

            <button
              type="button"
              disabled={!state.track}
              onPointerDown={(e) =>
                handlePrimaryPointerDown(e, () => {
                  setHeartKey((k) => k + 1);
                  sendAction("toggle-like");
                })
              }
              onKeyDown={(e) =>
                handleKeyActivate(e, () => {
                  setHeartKey((k) => k + 1);
                  sendAction("toggle-like");
                })
              }
              title={state.isLiked ? "Quitar de Me Gusta" : "Añadir a Me Gusta"}
              aria-label={state.isLiked ? "Quitar de Me Gusta" : "Añadir a Me Gusta"}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-35 cursor-pointer ${
                state.isLiked
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span key={heartKey} className={heartKey > 0 ? "anim-heart-burst flex" : "flex"}>
                <Heart
                  size={15}
                  strokeWidth={1.6}
                  fill={state.isLiked ? "currentColor" : "none"}
                />
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
