import { useEffect, useMemo, useRef, useState } from "react";
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
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { UnifiedTrack } from "../types/spotify";
import type { ThemeMode } from "../hooks/useTheme";
import { useLyrics } from "../hooks/useLyrics";
import { formatDuration } from "../lib/format";
import { LazyCover } from "./LazyCover";
import { SpotiDeskLogo } from "./SpotiDeskLogo";
import { PlayWaterDropEffect, StopShockEffect } from "./KineticEffects";

export type NotchPosition = "top" | "left" | "right" | "bubble";

// Radial geometry matching notch.rs (`360 x 360` canvas, centered hub at `(180, 180)`)
const BUBBLE_HUB_CX = 180;
const BUBBLE_HUB_CY = 180;
const BUBBLE_HUB_SIZE = 58;
const BUBBLE_ORBIT_RADIUS = 130;
const BUBBLE_POS_STORAGE_KEY = "spotidesk.bubble_pos";

type BubbleQuadrant = "br" | "bl" | "tr" | "tl";

interface SatelliteSpec {
  id: "previous" | "play-pause" | "next" | "cover" | "like" | "open-main";
  size: number;
  label: string;
}

const BUBBLE_SATELLITES: SatelliteSpec[] = [
  { id: "previous", size: 44, label: "Anterior" },
  { id: "play-pause", size: 52, label: "Reproducir / Pausar" },
  { id: "next", size: 44, label: "Siguiente" },
  { id: "cover", size: 62, label: "Carátula de la canción" },
  { id: "like", size: 44, label: "Me Gusta" },
  { id: "open-main", size: 42, label: "Abrir SpotiDesk" },
];

const QUADRANT_ARC_ANGLES: Record<BubbleQuadrant, number[]> = {
  br: [168, 192, 216, 242, 267, 289],
  bl: [251, 273, 298, 324, 348, 372],
  tr: [71, 93, 118, 144, 168, 192],
  tl: [-12, 12, 36, 62, 87, 109],
};

export interface NotchLayoutPayload {
  position: NotchPosition;
  isMacos: boolean;
  hasHardwareNotch: boolean;
  notchWidth: number;
  notchHeight: number;
  bubbleQuadrant?: BubbleQuadrant;
}

export interface NotchStatePayload {
  track: UnifiedTrack | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  theme: ThemeMode;
  ambientRgb: string | null;
  isLiked: boolean;
  notchLyricsEnabled?: boolean;
  notchAutoPeek?: boolean;
  lyricOffsetMs?: number;
  pomodoroLabel?: string | null;
  pomodoroPhase?: "idle" | "focus" | "break";
  volume?: number;
  muted?: boolean;
  syncedAt?: number;
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
    if (saved === "left" || saved === "right" || saved === "top" || saved === "bubble") {
      return saved;
    }
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
  const [isPeeking, setIsPeeking] = useState(false);
  const [inflateAnimKey, setInflateAnimKey] = useState(0);
  const [livePosition, setLivePosition] = useState(0);
  const lastPeekTrackUriRef = useRef<string | null>(null);
  const peekTimerRef = useRef<number | null>(null);
  const [waterKey, setWaterKey] = useState(0);
  const [tremorKey, setTremorKey] = useState(0);
  const [skipNudge, setSkipNudge] = useState<"next" | "prev" | null>(null);
  const [heartKey, setHeartKey] = useState(0);
  const [volumeHudPct, setVolumeHudPct] = useState<number | null>(null);

  const [isDraggingBubble, setIsDraggingBubble] = useState(false);

  const localVolRef = useRef<number>(0.75);
  const volHideTimerRef = useRef<number | null>(null);
  const lastVolEmitRef = useRef<number>(0);
  const pendingVolTimerRef = useRef<number | null>(null);
  const wheelSwipeAccumRef = useRef<number>(0);
  const wheelSwipeCooldownRef = useRef<number>(0);
  const wheelSwipeResetRef = useRef<number | null>(null);

  const notchLyricsEnabled = state.notchLyricsEnabled ?? true;
  const { lyrics: notchLyrics } = useLyrics(state.track, Boolean(state.track && notchLyricsEnabled));

  const activeLyricLine = useMemo(() => {
    const lines = notchLyrics?.synced;
    if (!lines || lines.length === 0) return null;
    // Match NowPlayingStage's exact 180ms lookahead + per-track calibration offset
    const targetMs = livePosition + 180 + (state.lyricOffsetMs ?? 0);
    let active: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].timeMs <= targetMs) {
        active = lines[i].text;
      } else {
        break;
      }
    }
    return active && active !== "···" ? active : null;
  }, [notchLyrics?.synced, livePosition, state.lyricOffsetMs]);

  const syncAnchorRef = useRef<{ basePos: number; baseTime: number }>({
    basePos: 0,
    baseTime: Date.now(),
  });

  const prevPlayingRef = useRef<boolean | null>(null);
  const hasSyncedStateRef = useRef(false);
  const lastPointerActionAtRef = useRef(0);
  const dragSessionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);
  const dragRafPendingRef = useRef(false);

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
    const fetchLayout = () => {
      void invoke<NotchLayoutPayload>("get_notch_layout")
        .then((initial) => {
          if (initial) setLayout(initial);
        })
        .catch(() => {});
    };

    fetchLayout();
    const bootResyncTimer = window.setTimeout(fetchLayout, 550);

    let unlistenLayout: (() => void) | undefined;
    void listen<NotchLayoutPayload>("notch-layout", (event) => {
      if (event.payload) {
        setLayout(event.payload);
      }
    }).then((fn) => {
      unlistenLayout = fn;
    });

    return () => {
      window.clearTimeout(bootResyncTimer);
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
        // Immediately ask main window for exact authoritative playback clock on expand
        void invoke("send_notch_action", { action: "request-state" });
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

      const anchorTime = next.syncedAt ?? Date.now();
      const elapsedSinceSync = next.isPlaying ? Math.max(0, Date.now() - anchorTime) : 0;
      const computedPos =
        next.durationMs > 0
          ? Math.min(next.positionMs + elapsedSinceSync, next.durationMs)
          : next.positionMs + elapsedSinceSync;

      syncAnchorRef.current = { basePos: next.positionMs, baseTime: anchorTime };
      if (typeof next.volume === "number" && performance.now() - lastVolEmitRef.current > 450) {
        localVolRef.current = next.muted ? 0 : next.volume;
      }

      // Dynamic Island Auto-Peek on track transitions (briefly reveals new cover & title for ~2.8s)
      const nextUri = next.track?.uri ?? null;
      const autoPeekEnabled = next.notchAutoPeek !== false;
      if (
        autoPeekEnabled &&
        nextUri &&
        next.isPlaying &&
        lastPeekTrackUriRef.current !== null &&
        lastPeekTrackUriRef.current !== nextUri
      ) {
        setIsPeeking(true);
        setInflateAnimKey((k) => k + 1);
        if (peekTimerRef.current) window.clearTimeout(peekTimerRef.current);
        peekTimerRef.current = window.setTimeout(() => {
          setIsPeeking(false);
        }, 2800);
      }
      if (nextUri) {
        lastPeekTrackUriRef.current = nextUri;
      }

      setState(next);
      setLivePosition(computedPos);
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

  // Lightweight local progress interpolation while playing (expanded, side pill, or bubble ring)
  const isSide = layout.position === "left" || layout.position === "right";
  const isBubble = layout.position === "bubble";

  // Restore user's last dragged Bubble coordinates from localStorage when entering Bubble mode
  useEffect(() => {
    if (!isBubble) return;
    try {
      const raw = localStorage.getItem(BUBBLE_POS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { x?: number; y?: number };
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        void invoke("set_bubble_position", { x: parsed.x, y: parsed.y }).catch(() => {});
      }
    } catch {
      // Ignore malformed stored coordinates
    }
  }, [isBubble]);

  const handleHubPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors
    }
    dragSessionRef.current = {
      pointerId: e.pointerId,
      startX: e.screenX,
      startY: e.screenY,
      dragging: false,
    };
  };

  const handleHubPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== e.pointerId) return;

    const dx = e.screenX - session.startX;
    const dy = e.screenY - session.startY;
    if (!session.dragging && Math.hypot(dx, dy) >= 5) {
      session.dragging = true;
      setIsDraggingBubble(true);
      setIsExpanded(false);
      void invoke("begin_bubble_drag").catch(() => {});
    }

    if (session.dragging && !dragRafPendingRef.current) {
      dragRafPendingRef.current = true;
      requestAnimationFrame(() => {
        dragRafPendingRef.current = false;
        if (dragSessionRef.current?.dragging) {
          void invoke("drag_bubble_move").catch(() => {});
        }
      });
    }
  };

  const finishHubDrag = (e: React.PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== e.pointerId) return;
    dragSessionRef.current = null;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }

    if (session.dragging) {
      setIsDraggingBubble(false);
      void invoke<[number, number] | null>("end_bubble_drag")
        .then((coords) => {
          if (Array.isArray(coords) && coords.length === 2) {
            try {
              localStorage.setItem(
                BUBBLE_POS_STORAGE_KEY,
                JSON.stringify({ x: coords[0], y: coords[1] })
              );
            } catch {
              // Ignore storage errors
            }
          }
        })
        .catch(() => {});
    } else if (!cancelled) {
      lastPointerActionAtRef.current = performance.now();
      sendAction("play-pause");
    }
  };
  // Drift-free real-time clock derived from authoritative syncAnchorRef (always in sync with song & lyrics)
  useEffect(() => {
    if (!state.isPlaying) return;

    const computeNow = () => {
      const { basePos, baseTime } = syncAnchorRef.current;
      const pos = basePos + Math.max(0, Date.now() - baseTime);
      setLivePosition(state.durationMs > 0 ? Math.min(pos, state.durationMs) : pos);
    };

    computeNow();

    const needsLiveTick =
      isExpanded || isSide || isBubble || (notchLyricsEnabled && !isMacHardwareTop);
    if (!needsLiveTick) return;

    const timer = window.setInterval(computeNow, 150);
    return () => window.clearInterval(timer);
  }, [
    state.isPlaying,
    state.durationMs,
    isExpanded,
    isSide,
    isBubble,
    notchLyricsEnabled,
    isMacHardwareTop,
  ]);

  const sendAction = (action: string) => {
    void invoke("send_notch_action", { action });
  };

  // Scroll vertical over Notch = smooth real-time volume control; horizontal 2-finger swipe = Prev / Next
  const handleNotchWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey) return;
    const absX = Math.abs(e.deltaX);
    const absY = Math.abs(e.deltaY);

    // Horizontal swipe -> Next / Previous track
    if (absX > absY * 1.45 && absX >= 5) {
      const now = performance.now();
      if (now < wheelSwipeCooldownRef.current) return;
      wheelSwipeAccumRef.current += e.deltaX;
      if (wheelSwipeResetRef.current) window.clearTimeout(wheelSwipeResetRef.current);
      wheelSwipeResetRef.current = window.setTimeout(() => {
        wheelSwipeAccumRef.current = 0;
      }, 180);

      if (Math.abs(wheelSwipeAccumRef.current) >= 75) {
        const goNext = wheelSwipeAccumRef.current > 0;
        wheelSwipeAccumRef.current = 0;
        wheelSwipeCooldownRef.current = now + 560;
        setSkipNudge(goNext ? "next" : "prev");
        window.setTimeout(() => setSkipNudge(null), 260);
        sendAction(goNext ? "next" : "previous");
      }
      return;
    }

    // Vertical scroll -> Volume control
    if (absY >= 2) {
      e.preventDefault();
      // Normalize mouse wheel vs trackpad precision scroll
      const step = Math.max(-0.08, Math.min(0.08, -e.deltaY * 0.0014));
      const nextVol = Math.max(0, Math.min(1, localVolRef.current + step));
      localVolRef.current = nextVol;
      const pct = Math.round(nextVol * 100);
      setVolumeHudPct(pct);

      if (volHideTimerRef.current) window.clearTimeout(volHideTimerRef.current);
      volHideTimerRef.current = window.setTimeout(() => {
        setVolumeHudPct(null);
      }, 1150);

      const now = performance.now();
      const emit = (valPct: number) => {
        lastVolEmitRef.current = performance.now();
        sendAction(`set-volume:${valPct}`);
      };

      if (now - lastVolEmitRef.current >= 48) {
        if (pendingVolTimerRef.current) {
          window.clearTimeout(pendingVolTimerRef.current);
          pendingVolTimerRef.current = null;
        }
        emit(pct);
      } else {
        if (pendingVolTimerRef.current) window.clearTimeout(pendingVolTimerRef.current);
        pendingVolTimerRef.current = window.setTimeout(() => {
          pendingVolTimerRef.current = null;
          emit(Math.round(localVolRef.current * 100));
        }, 50);
      }
    }
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

  // ============================================================================
  // OPTION 4: RADIAL BLOOMING BUBBLE (Bottom-Right Corner)
  // ============================================================================
  if (isBubble) {
    const bubbleBg =
      effectiveTheme === "dark" ? "rgba(9, 9, 12, 0.94)" : "rgba(255, 255, 255, 0.96)";
    const ringR = 26.5;
    const circumference = 2 * Math.PI * ringR;
    const dashOffset = circumference * (1 - progressPct / 100);
    const quadrant: BubbleQuadrant = layout.bubbleQuadrant ?? "br";
    const arcAngles = QUADRANT_ARC_ANGLES[quadrant] ?? QUADRANT_ARC_ANGLES.br;
    const showSatellites = isExpanded && !isDraggingBubble;
    const showTrackPill = (showSatellites || isPeeking) && !isDraggingBubble;
    const pillPosClass =
      quadrant === "br"
        ? "left-4 bottom-4"
        : quadrant === "bl"
          ? "right-4 bottom-4"
          : quadrant === "tr"
            ? "left-4 top-4"
            : "right-4 top-4";

    return (
      <div
        onWheel={handleNotchWheel}
        className="chrome-no-select relative w-[360px] h-[360px] bg-transparent select-none overflow-hidden"
      >
        {volumeHudPct !== null && (
          <div
            className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-full border border-[var(--border-subtle)] flex items-center gap-2 text-[11px] font-medium tabular-nums text-[var(--text-primary)]"
            style={{ background: bubbleBg, boxShadow: "0 8px 20px rgba(0,0,0,0.4)" }}
          >
            {volumeHudPct === 0 ? (
              <VolumeX size={12} strokeWidth={1.6} />
            ) : volumeHudPct < 50 ? (
              <Volume1 size={12} strokeWidth={1.6} />
            ) : (
              <Volume2 size={12} strokeWidth={1.6} />
            )}
            <div className="w-16 h-[3px] rounded-full bg-[var(--slider-track)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--slider-fill)]"
                style={{ width: `${volumeHudPct}%` }}
              />
            </div>
            <span>{volumeHudPct}%</span>
          </div>
        )}
        {/* Track title pill fading in softly on the free corner when expanded */}
        {state.track && (
          <div
            className={`pointer-events-none absolute ${pillPosClass} max-w-[168px] px-3 py-1.5 rounded-full border border-[var(--border-subtle)] transition-all duration-350 ease-apple`}
            style={{
              background: bubbleBg,
              boxShadow: "0 10px 26px rgba(0, 0, 0, 0.4)",
              opacity: showTrackPill ? 1 : 0,
              transform: showTrackPill ? "translateY(0) scale(1)" : "translateY(6px) scale(0.9)",
            }}
          >
            <div className="text-[11px] font-semibold text-[var(--text-primary)] truncate">
              {state.track.name}
            </div>
            <div className="text-[10px] text-[var(--text-secondary)] truncate">
              {state.track.artists}
            </div>
          </div>
        )}

        {/* 6 Satellite Bubbles blooming radially out from the central hub bubble */}
        {BUBBLE_SATELLITES.map((sat, idx) => {
          const angleDeg = arcAngles[idx] ?? 180 + idx * 24;
          const rad = (angleDeg * Math.PI) / 180;
          const dx = Math.cos(rad) * BUBBLE_ORBIT_RADIUS;
          const dy = Math.sin(rad) * BUBBLE_ORBIT_RADIUS;
          const delayMs = showSatellites
            ? idx * 36
            : (BUBBLE_SATELLITES.length - 1 - idx) * 24;

          const orbitStyle: React.CSSProperties = {
            position: "absolute",
            left: `${BUBBLE_HUB_CX - sat.size / 2}px`,
            top: `${BUBBLE_HUB_CY - sat.size / 2}px`,
            width: `${sat.size}px`,
            height: `${sat.size}px`,
            opacity: showSatellites ? 1 : 0,
            transform: showSatellites
              ? `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(1)`
              : "translate3d(0px, 0px, 0) scale(0.28)",
            transition: showSatellites
              ? `transform 520ms cubic-bezier(0.34, 1.48, 0.52, 1) ${delayMs}ms, opacity 240ms ease ${delayMs}ms`
              : `transform 280ms cubic-bezier(0.32, 0.72, 0, 1) ${delayMs}ms, opacity 180ms ease ${delayMs}ms`,
            pointerEvents: showSatellites ? "auto" : "none",
          };

          if (sat.id === "cover") {
            return (
              <button
                key={sat.id}
                type="button"
                style={orbitStyle}
                title={
                  state.track
                    ? `${state.track.name} — ${state.track.artists}`
                    : "Abrir SpotiDesk"
                }
                aria-label="Carátula de la canción"
                onPointerDown={(e) =>
                  handlePrimaryPointerDown(e, () => sendAction("open-main"))
                }
                onClick={() => handleClickFallback(() => sendAction("open-main"))}
                onKeyDown={(e) =>
                  handleKeyActivate(e, () => sendAction("open-main"))
                }
                className="group rounded-full p-[3px] border border-[var(--border-subtle)] flex items-center justify-center cursor-pointer"
              >
                <div
                  className="relative w-full h-full rounded-full overflow-hidden flex items-center justify-center transition-transform duration-300 ease-apple group-hover:scale-105"
                  style={{
                    background: bubbleBg,
                    boxShadow: "0 12px 28px rgba(0, 0, 0, 0.48)",
                  }}
                >
                  {state.track?.albumImage ? (
                    <img
                      src={state.track.albumImage}
                      alt={state.track.name}
                      className="w-full h-full object-cover rounded-full"
                    />
                  ) : (
                    <Disc3
                      size={22}
                      strokeWidth={1.5}
                      className="text-[var(--text-secondary)]"
                    />
                  )}
                  {waterKey > 0 && state.isPlaying && (
                    <span
                      key={waterKey}
                      aria-hidden="true"
                      className="anim-artwork-liquid pointer-events-none absolute inset-0 rounded-full border border-[var(--solid-bg)]/70"
                    />
                  )}
                </div>
              </button>
            );
          }

          if (sat.id === "play-pause") {
            return (
              <button
                key={sat.id}
                type="button"
                style={{
                  ...orbitStyle,
                  boxShadow: "0 12px 28px rgba(0, 0, 0, 0.5)",
                }}
                title={state.isPlaying ? "Pausar" : "Reproducir"}
                aria-label={state.isPlaying ? "Pausar" : "Reproducir"}
                onPointerDown={(e) =>
                  handlePrimaryPointerDown(e, () => sendAction("play-pause"))
                }
                onClick={() => handleClickFallback(() => sendAction("play-pause"))}
                onKeyDown={(e) =>
                  handleKeyActivate(e, () => sendAction("play-pause"))
                }
                className="rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] flex items-center justify-center cursor-pointer"
              >
                <span
                  className={`relative flex items-center justify-center w-full h-full rounded-full ${
                    tremorKey > 0 && !state.isPlaying ? "anim-kinetic-tremor" : ""
                  }`}
                >
                  <PlayWaterDropEffect triggerKey={waterKey} size="sm" />
                  <StopShockEffect triggerKey={tremorKey} />
                  <span key={state.isPlaying ? "p" : "r"} className="anim-icon-pop flex">
                    {state.isPlaying ? (
                      <Pause size={19} strokeWidth={1.8} fill="currentColor" />
                    ) : (
                      <Play
                        size={19}
                        strokeWidth={1.8}
                        fill="currentColor"
                        className="translate-x-[1.5px]"
                      />
                    )}
                  </span>
                </span>
              </button>
            );
          }

          const triggerSat = () => {
            if (sat.id === "previous") {
              setSkipNudge("prev");
              window.setTimeout(() => setSkipNudge(null), 260);
              sendAction("previous");
            } else if (sat.id === "next") {
              setSkipNudge("next");
              window.setTimeout(() => setSkipNudge(null), 260);
              sendAction("next");
            } else if (sat.id === "like") {
              if (!state.track) return;
              setHeartKey((k) => k + 1);
              sendAction("toggle-like");
            } else if (sat.id === "open-main") {
              sendAction("open-main");
            }
          };

          return (
            <button
              key={sat.id}
              type="button"
              style={{
                ...orbitStyle,
                background: bubbleBg,
                boxShadow: "0 10px 24px rgba(0, 0, 0, 0.42)",
              }}
              title={sat.label}
              aria-label={sat.label}
              disabled={sat.id === "like" && !state.track}
              onPointerDown={(e) => handlePrimaryPointerDown(e, triggerSat)}
              onClick={() => handleClickFallback(triggerSat)}
              onKeyDown={(e) => handleKeyActivate(e, triggerSat)}
              className="rounded-full border border-[var(--border-subtle)] text-[var(--text-primary)] hover:border-[var(--text-secondary)] flex items-center justify-center cursor-pointer disabled:opacity-40"
            >
              {sat.id === "previous" && (
                <span className={skipNudge === "prev" ? "anim-nudge-left flex" : "flex"}>
                  <SkipBack size={16} strokeWidth={1.6} />
                </span>
              )}
              {sat.id === "next" && (
                <span className={skipNudge === "next" ? "anim-nudge-right flex" : "flex"}>
                  <SkipForward size={16} strokeWidth={1.6} />
                </span>
              )}
              {sat.id === "like" && (
                <span key={heartKey} className={heartKey > 0 ? "anim-heart-burst flex" : "flex"}>
                  <Heart
                    size={16}
                    strokeWidth={1.6}
                    fill={state.isLiked ? "currentColor" : "none"}
                  />
                </span>
              )}
              {sat.id === "open-main" && <Maximize2 size={14} strokeWidth={1.6} />}
            </button>
          );
        })}

        {/* Central Anchor Hub Bubble (draggable anywhere on screen; quick click toggles play) */}
        <button
          type="button"
          onPointerDown={handleHubPointerDown}
          onPointerMove={handleHubPointerMove}
          onPointerUp={(e) => finishHubDrag(e, false)}
          onPointerCancel={(e) => finishHubDrag(e, true)}
          onKeyDown={(e) =>
            handleKeyActivate(e, () => sendAction("play-pause"))
          }
          title={
            state.track
              ? `${state.track.name} — ${state.track.artists} · Arrastra para mover`
              : "SpotiDesk · Arrastra para mover"
          }
          aria-label="Burbuja central de SpotiDesk (arrastra para mover)"
          className={`absolute rounded-full border border-[var(--border-subtle)] flex items-center justify-center transition-transform duration-300 ease-apple ${
            isDraggingBubble ? "cursor-grabbing" : "cursor-grab"
          } ${tremorKey > 0 && !state.isPlaying ? "anim-kinetic-tremor" : ""}`}
          style={{
            left: `${BUBBLE_HUB_CX - BUBBLE_HUB_SIZE / 2}px`,
            top: `${BUBBLE_HUB_CY - BUBBLE_HUB_SIZE / 2}px`,
            width: `${BUBBLE_HUB_SIZE}px`,
            height: `${BUBBLE_HUB_SIZE}px`,
            background: bubbleBg,
            boxShadow: isDraggingBubble
              ? "0 22px 48px rgba(0, 0, 0, 0.65)"
              : showSatellites
                ? "0 16px 36px rgba(0, 0, 0, 0.56)"
                : "0 10px 26px rgba(0, 0, 0, 0.44)",
            transform: isDraggingBubble
              ? "scale(1.1)"
              : showSatellites
                ? "scale(1.05)"
                : "scale(1)",
          }}
        >
          {state.ambientRgb && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{
                background: `radial-gradient(circle at 50% 50%, rgba(${state.ambientRgb}, ${
                  effectiveTheme === "dark" ? 0.34 : 0.18
                }), transparent 72%)`,
              }}
            />
          )}

          {/* Circular live progress ring */}
          <svg
            width={BUBBLE_HUB_SIZE}
            height={BUBBLE_HUB_SIZE}
            viewBox={`0 0 ${BUBBLE_HUB_SIZE} ${BUBBLE_HUB_SIZE}`}
            className="pointer-events-none absolute inset-0 -rotate-90"
            aria-hidden="true"
          >
            <circle
              cx={BUBBLE_HUB_SIZE / 2}
              cy={BUBBLE_HUB_SIZE / 2}
              r={ringR}
              fill="none"
              stroke="var(--slider-track)"
              strokeWidth="2"
            />
            <circle
              cx={BUBBLE_HUB_SIZE / 2}
              cy={BUBBLE_HUB_SIZE / 2}
              r={ringR}
              fill="none"
              stroke="var(--slider-fill)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{ transition: "stroke-dashoffset 280ms linear" }}
            />
          </svg>

          <PlayWaterDropEffect triggerKey={waterKey} size="sm" />

          <span className="relative z-10 flex items-center justify-center">
            {state.track && state.isPlaying ? (
              <span className="flex items-end gap-[2.5px] h-3.5">
                <span className="eq-bar" />
                <span className="eq-bar" />
                <span className="eq-bar" />
              </span>
            ) : (
              <SpotiDeskLogo size={22} className="text-[var(--text-primary)]" />
            )}
          </span>
        </button>
      </div>
    );
  }

  // Compute geometry per platform & position
  const showExpanded = isExpanded || isPeeking;
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
    borderClasses = showExpanded
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
      onWheel={handleNotchWheel}
      className={`chrome-no-select w-full h-full flex ${containerAlign} bg-transparent select-none`}
    >
      {/* Dynamic Island Notch inflating smoothly from its anchored screen edge */}
      <div
        className={`relative overflow-hidden ${borderClasses} ${
          showExpanded && inflateAnimKey > 0 ? inflateClass : ""
        } ${tremorKey > 0 && !state.isPlaying ? "anim-capsule-tremor" : ""}`}
        style={{
          width: `${showExpanded ? expandedWidth : collapsedWidth}px`,
          height: `${showExpanded ? expandedHeight : collapsedHeight}px`,
          borderRadius: showExpanded ? expandedRadius : collapsedRadius,
          transformOrigin,
          background: shellBackground,
          boxShadow: shellShadow,
          transition: showExpanded
            ? "width 500ms cubic-bezier(0.34, 1.38, 0.54, 1), height 500ms cubic-bezier(0.34, 1.38, 0.54, 1), border-radius 460ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 420ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "width 380ms cubic-bezier(0.32, 0.72, 0, 1), height 380ms cubic-bezier(0.32, 0.72, 0, 1), border-radius 340ms cubic-bezier(0.32, 0.72, 0, 1), box-shadow 320ms cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        {/* Collapsed Pill — varies cleanly between macOS hardware-notch wings, vertical side tab, and horizontal bar */}
        {isMacHardwareTop ? (
          <div
            aria-hidden={showExpanded}
            className="absolute inset-0 flex items-center justify-between transition-all duration-200 ease-apple"
            style={{
              opacity: showExpanded ? 0 : 1,
              transform: showExpanded ? "scale(0.9)" : "scale(1)",
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
            aria-hidden={showExpanded}
            className="absolute inset-0 py-2.5 flex flex-col items-center justify-between transition-all duration-200 ease-apple"
            style={{
              opacity: showExpanded ? 0 : 1,
              transform: showExpanded ? "scale(0.84)" : "scale(1)",
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
            aria-hidden={showExpanded}
            className="absolute inset-0 px-2.5 flex items-center justify-between gap-2 transition-all duration-200 ease-apple"
            style={{
              opacity: showExpanded ? 0 : 1,
              transform: showExpanded ? "scale(0.84)" : "scale(1)",
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
              {notchLyricsEnabled && state.isPlaying && activeLyricLine
                ? activeLyricLine
                : state.track?.name || "SpotiDesk"}
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
          aria-hidden={!showExpanded}
          className={`relative z-10 px-4 pb-3.5 flex flex-col justify-between transition-all duration-250 ease-apple ${
            showExpanded ? "anim-balloon-content" : ""
          }`}
          style={{
            width: `${expandedWidth}px`,
            height: `${expandedHeight}px`,
            paddingTop: `${expandedTopPad}px`,
            opacity: showExpanded ? 1 : 0,
            transform: showExpanded ? "scale(1)" : "scale(0.9)",
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
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[13.5px] font-semibold tracking-[-0.02em] text-[var(--text-primary)] truncate">
                  {state.track?.name || "SpotiDesk"}
                </span>
                {state.pomodoroLabel && state.pomodoroPhase && state.pomodoroPhase !== "idle" && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-white/12 text-[9.5px] font-mono tabular-nums text-[var(--text-primary)]">
                    {state.pomodoroPhase === "focus" ? "●" : "○"} {state.pomodoroLabel}
                  </span>
                )}
              </div>
              <div className="text-[11.5px] text-[var(--text-secondary)] truncate mt-0.5">
                {notchLyricsEnabled && activeLyricLine ? (
                  <span
                    key={activeLyricLine}
                    className="inline-block text-[var(--text-primary)]/90 italic truncate max-w-full"
                  >
                    {activeLyricLine}
                  </span>
                ) : (
                  state.track?.artists || "Sin reproducción activa"
                )}
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

          {/* Slim Progress Indicator (morphs smoothly into live Volume HUD when scrolling over Notch) */}
          {volumeHudPct !== null ? (
            <div className="flex items-center gap-2.5 text-[var(--text-primary)]">
              <span className="w-7 flex items-center text-[var(--text-secondary)]">
                {volumeHudPct === 0 ? (
                  <VolumeX size={12} strokeWidth={1.7} />
                ) : volumeHudPct < 50 ? (
                  <Volume1 size={12} strokeWidth={1.7} />
                ) : (
                  <Volume2 size={12} strokeWidth={1.7} />
                )}
              </span>
              <div className="flex-1 h-[4px] rounded-full bg-[var(--slider-track)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--text-primary)] transition-all duration-75"
                  style={{ width: `${volumeHudPct}%` }}
                />
              </div>
              <span className="text-[10px] font-medium tabular-nums text-[var(--text-primary)] w-7 text-right">
                {volumeHudPct}%
              </span>
            </div>
          ) : (
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
          )}

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
