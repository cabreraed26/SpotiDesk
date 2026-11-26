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

export type NotchPosition = "top" | "left" | "right";

export interface NotchLayoutPayload {
  position: NotchPosition;
  isMacos: boolean;
  hasHardwareNotch: boolean;
  notchWidth: number;
  notchHeight: number;
}

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

function readSavedNotchPosition(): NotchPosition {
  try {
    const saved = localStorage.getItem("spotidesk.notch_position");
    if (saved === "left" || saved === "right" || saved === "top") return saved;
  } catch {
    // Ignore storage errors
  }
  return "top";
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

  const [layout, setLayout] = useState<NotchLayoutPayload>(() => ({
    position: readSavedNotchPosition(),
    isMacos: /mac/i.test(navigator.platform || navigator.userAgent),
    hasHardwareNotch: false,
    notchWidth: 0,
    notchHeight: 0,
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
  const lastPointerActionAtRef = useRef(0);

  // When overlaid on macOS physical black hardware notch, always render in dark obsidian
  // palette so the island merges seamlessly with the black camera bezel.
  const isMacHardwareTop =
    layout.isMacos && layout.position === "top" && layout.hasHardwareNotch;
  const effectiveTheme: ThemeMode = isMacHardwareTop ? "dark" : state.theme;

  useEffect(() => {
    document.documentElement.dataset.window = "notch";
    document.documentElement.dataset.theme = effectiveTheme;
  }, [effectiveTheme]);

  // Sync Notch layout & macOS hardware notch metrics from Rust
  useEffect(() => {
    void invoke<NotchLayoutPayload>("get_notch_layout")
      .then((initial) => {
        if (initial) setLayout(initial);
      })
      .catch(() => {});

    let unlistenLayout: (() => void) | undefined;
    void listen<NotchLayoutPayload>("notch-layout", (event) => {
      if (event.payload) {
        setLayout(event.payload);
      }
    }).then((fn) => {
      unlistenLayout = fn;
    });

    return () => {
      unlistenLayout?.();
    };
  }, []);

  // Listen to native cursor tracking from Rust (zero resize flashes, zero stuck states)
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

  // Listen to real-time playback updates from the main SpotiDesk window
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

  // Lightweight local progress interpolation while playing (expanded or side pill)
  const isSide = layout.position === "left" || layout.position === "right";
  useEffect(() => {
    if (!state.isPlaying || (!isExpanded && !isSide)) return;
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
  }, [state.isPlaying, state.durationMs, isExpanded, isSide]);

  const sendAction = (action: string) => {
    void invoke("send_notch_action", { action });
  };

  const handlePrimaryPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    cb: () => void
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    lastPointerActionAtRef.current = performance.now();
    cb();
  };

  const handleClickFallback = (cb: () => void) => {
    if (performance.now() - lastPointerActionAtRef.current < 350) return;
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

  // Compute geometry per platform & position
  const hwNotchWidth = Math.max(150, layout.notchWidth || 186);
  const hwNotchHeight = Math.max(32, layout.notchHeight || 34);
  const hwWingWidth = 28;

  let collapsedWidth = 148;
  let collapsedHeight = 34;
  let expandedWidth = 368;
  let expandedHeight = 158;
  let collapsedRadius = "0 0 16px 16px";
  let expandedRadius = "0 0 28px 28px";
  let transformOrigin = "top center";
  let borderClasses = "border-x border-b border-[var(--border-subtle)]";
  let containerAlign = "items-start justify-center";
  let inflateClass = "anim-balloon-inflate";
  let expandedTopPad = 14;

  if (layout.position === "left") {
    collapsedWidth = 30;
    collapsedHeight = 100;
    expandedWidth = 368;
    expandedHeight = 158;
    collapsedRadius = "0 15px 15px 0";
    expandedRadius = "0 28px 28px 0";
    transformOrigin = "left center";
    borderClasses = "border-y border-r border-[var(--border-subtle)]";
    containerAlign = "items-center justify-start";
    inflateClass = "anim-balloon-inflate-left";
  } else if (layout.position === "right") {
    collapsedWidth = 30;
    collapsedHeight = 100;
    expandedWidth = 368;
    expandedHeight = 158;
    collapsedRadius = "15px 0 0 15px";
    expandedRadius = "28px 0 0 28px";
    transformOrigin = "right center";
    borderClasses = "border-y border-l border-[var(--border-subtle)]";
    containerAlign = "items-center justify-end";
    inflateClass = "anim-balloon-inflate-right";
  } else if (isMacHardwareTop) {
    collapsedWidth = hwNotchWidth + hwWingWidth * 2;
    collapsedHeight = hwNotchHeight;
    expandedWidth = 384;
    expandedHeight = hwNotchHeight + 150;
    collapsedRadius = "0 0 13px 13px";
    expandedRadius = "0 0 28px 28px";
    transformOrigin = "top center";
    borderClasses = isExpanded
      ? "border-x border-b border-white/10"
      : "border-x border-b border-transparent";
    containerAlign = "items-start justify-center";
    inflateClass = "anim-balloon-inflate";
    expandedTopPad = hwNotchHeight + 6;
  } else if (layout.isMacos && layout.position === "top") {
    // Non-notch macOS display: compact pill flush against top bezel over the menu bar
    collapsedWidth = 148;
    collapsedHeight = Math.max(28, Math.min(layout.notchHeight || 32, 34));
    expandedWidth = 368;
    expandedHeight = 158;
    collapsedRadius = "0 0 15px 15px";
    expandedRadius = "0 0 28px 28px";
  }

  const shellBackground = isMacHardwareTop
    ? "#000000"
    : effectiveTheme === "dark"
      ? "rgba(8, 8, 10, 0.95)"
      : "rgba(255, 255, 255, 0.96)";

  const shellShadow = "none";

  return (
    <div
      className={`chrome-no-select w-full h-full flex ${containerAlign} bg-transparent select-none`}
    >
      {/* Dynamic Island Notch inflating smoothly from its anchored screen edge */}
      <div
        className={`relative overflow-hidden ${borderClasses} ${
          isExpanded && inflateAnimKey > 0 ? inflateClass : ""
        } ${tremorKey > 0 && !state.isPlaying ? "anim-capsule-tremor" : ""}`}
        style={{
          width: `${isExpanded ? expandedWidth : collapsedWidth}px`,
          height: `${isExpanded ? expandedHeight : collapsedHeight}px`,
          borderRadius: isExpanded ? expandedRadius : collapsedRadius,
          transformOrigin,
          background: shellBackground,
          boxShadow: shellShadow,
          transition: isExpanded
            ? "width 500ms cubic-bezier(0.34, 1.38, 0.54, 1), height 500ms cubic-bezier(0.34, 1.38, 0.54, 1), border-radius 460ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 420ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "width 380ms cubic-bezier(0.32, 0.72, 0, 1), height 380ms cubic-bezier(0.32, 0.72, 0, 1), border-radius 340ms cubic-bezier(0.32, 0.72, 0, 1), box-shadow 320ms cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        {/* Collapsed Pill — varies cleanly between macOS hardware-notch wings, vertical side tab, and horizontal bar */}
        {isMacHardwareTop ? (
          <div
            aria-hidden={isExpanded}
            className="absolute inset-0 flex items-center justify-between transition-all duration-200 ease-apple"
            style={{
              opacity: isExpanded ? 0 : 1,
              transform: isExpanded ? "scale(0.9)" : "scale(1)",
              pointerEvents: "none",
            }}
          >
            {/* Left ear next to physical MacBook camera notch */}
            <div
              className="flex items-center justify-center shrink-0"
              style={{ width: `${hwWingWidth}px` }}
            >
              <div className="relative">
                {state.track?.albumImage ? (
                  <LazyCover
                    src={state.track.albumImage}
                    alt={state.track.name}
                    className="w-[18px] h-[18px]"
                    iconSize={10}
                    roundedClass="rounded-[5px]"
                  />
                ) : (
                  <div className="w-[18px] h-[18px] rounded-[5px] bg-white/10 flex items-center justify-center">
                    <Disc3 size={10} strokeWidth={1.6} className="text-white/70" />
                  </div>
                )}
                <PlayWaterDropEffect triggerKey={waterKey} size="sm" />
              </div>
            </div>

            {/* Physical MacBook notch cutout spacer */}
            <div style={{ width: `${hwNotchWidth}px` }} className="shrink-0" />

            {/* Right ear next to physical MacBook camera notch */}
            <div
              className="flex items-center justify-center shrink-0"
              style={{ width: `${hwWingWidth}px` }}
            >
              {state.track ? (
                <div
                  className={`flex items-end gap-[2px] h-2.5 ${
                    state.isPlaying ? "" : "eq-paused"
                  }`}
                >
                  <span className="eq-bar" />
                  <span className="eq-bar" />
                  <span className="eq-bar" />
                </div>
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-white/45 anim-notch-breathe" />
              )}
            </div>
          </div>
        ) : isSide ? (
          <div
            aria-hidden={isExpanded}
            className="absolute inset-0 py-2.5 flex flex-col items-center justify-between transition-all duration-200 ease-apple"
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
                  className="w-[18px] h-[18px]"
                  iconSize={10}
                  roundedClass="rounded-[5px]"
                />
              ) : (
                <div className="w-[18px] h-[18px] rounded-[5px] bg-[var(--bg-card)] border border-[var(--border-hairline)] flex items-center justify-center">
                  <Disc3 size={10} strokeWidth={1.6} className="text-[var(--text-secondary)]" />
                </div>
              )}
              <PlayWaterDropEffect triggerKey={waterKey} size="sm" />
            </div>

            {/* Subtle vertical playback progress bar */}
            <div className="w-[2.5px] h-6 rounded-full bg-[var(--slider-track)] overflow-hidden flex flex-col justify-end">
              <div
                className="w-full rounded-full bg-[var(--slider-fill)] transition-all duration-300"
                style={{ height: `${state.track ? Math.max(8, progressPct) : 0}%` }}
              />
            </div>

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
        ) : (
          <div
            aria-hidden={isExpanded}
            className="absolute inset-0 px-2.5 flex items-center justify-between gap-2 transition-all duration-200 ease-apple"
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
                  className="w-[18px] h-[18px]"
                  iconSize={10}
                  roundedClass="rounded-[5px]"
                />
              ) : (
                <div className="w-[18px] h-[18px] rounded-[5px] bg-[var(--bg-card)] border border-[var(--border-hairline)] flex items-center justify-center">
                  <Disc3 size={10} strokeWidth={1.6} className="text-[var(--text-secondary)]" />
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
        )}

        {/* Expanded Dynamic Island Content (clears the macOS physical camera cutout automatically) */}
        <div
          aria-hidden={!isExpanded}
          className={`relative z-10 px-4 pb-3.5 flex flex-col justify-between transition-all duration-250 ease-apple ${
            isExpanded ? "anim-balloon-content" : ""
          }`}
          style={{
            width: `${expandedWidth}px`,
            height: `${expandedHeight}px`,
            paddingTop: `${expandedTopPad}px`,
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
              onClick={() => handleClickFallback(() => sendAction("open-main"))}
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
              onClick={() =>
                handleClickFallback(() => {
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
              onClick={() => handleClickFallback(() => sendAction("play-pause"))}
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
              onClick={() =>
                handleClickFallback(() => {
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
              onClick={() =>
                handleClickFallback(() => {
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
