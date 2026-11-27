import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Heart,
  Maximize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type { UnifiedTrack } from "../types/spotify";
import type { ThemeMode } from "../hooks/useTheme";
import { useLyrics } from "../hooks/useLyrics";
import { getLyricOffsetMs } from "../lib/lyricSync";
import { formatDuration } from "../lib/format";
import { startMacWindowDrag } from "../lib/windowDrag";
import { LazyCover } from "./LazyCover";
import { PlayWaterDropEffect, StopShockEffect } from "./KineticEffects";

interface MiniPlayerProps {
  currentTrack: UnifiedTrack | null;
  isPlaying: boolean;
  isCurrentLiked: boolean;
  positionMs: number;
  durationMs: number;
  ambientRgb: string | null;
  theme: ThemeMode;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (ms: number) => void;
  onToggleLike: () => void;
  onExpand: () => void;
}

export function MiniPlayer({
  currentTrack,
  isPlaying,
  isCurrentLiked,
  positionMs,
  durationMs,
  ambientRgb,
  theme,
  onTogglePlay,
  onNext,
  onPrevious,
  onSeek,
  onToggleLike,
  onExpand,
}: MiniPlayerProps) {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPos, setScrubPos] = useState(0);
  const [waterKey, setWaterKey] = useState(0);
  const [tremorKey, setTremorKey] = useState(0);

  const { lyrics } = useLyrics(currentTrack, Boolean(currentTrack));
  const lyricOffsetMs = getLyricOffsetMs(currentTrack?.uri);
  const effectivePos = isScrubbing ? scrubPos : positionMs;
  const progressPct = durationMs > 0 ? Math.min(100, (effectivePos / durationMs) * 100) : 0;

  const activeLyric = useMemo(() => {
    const lines = lyrics?.synced;
    if (!lines?.length) return null;
    const target = effectivePos + 180 + lyricOffsetMs;
    let found: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].timeMs <= target) found = lines[i].text;
      else break;
    }
    return found && found !== "···" ? found : null;
  }, [lyrics?.synced, effectivePos, lyricOffsetMs]);

  const isMac = /mac/i.test(navigator.platform || navigator.userAgent);
  const winDragAttr = !isMac ? "" : undefined;
  const miniHeaderRef = useRef<HTMLDivElement | null>(null);
  const expandBtnRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    if (!isMac) return;
    const header = miniHeaderRef.current;
    if (!header) return;

    const syncZone = () => {
      const hRect = header.getBoundingClientRect();
      const btnRect = expandBtnRef.current?.getBoundingClientRect();
      const rightInset = btnRect ? Math.max(12, hRect.right - btnRect.left + 6) : 96;
      void invoke("set_titlebar_drag_zone", {
        height: hRect.height || 40,
        leftInset: 78,
        rightInset,
      }).catch(() => {});
    };

    syncZone();
    const ro = new ResizeObserver(syncZone);
    ro.observe(header);
    return () => ro.disconnect();
  }, [isMac]);

  return (
    <div className="chrome-no-select h-screen w-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden relative select-none">
      {ambientRgb && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 transition-all duration-700"
          style={{
            background: `radial-gradient(280px circle at 24% 20%, rgba(${ambientRgb}, ${
              theme === "dark" ? 0.24 : 0.14
            }), transparent 72%)`,
          }}
        />
      )}

      {/* Draggable mini top strip matching TitleBar 40px height so macOS traffic lights sit dead-center with zero collision */}
      <div
        ref={miniHeaderRef}
        data-tauri-drag-region={winDragAttr}
        onPointerDown={(e) => {
          if (isMac) startMacWindowDrag(e);
        }}
        className="relative z-10 h-10 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center px-3 border-b border-[var(--border-hairline)] bg-[var(--bg-elevated)]/70"
      >
        <div data-tauri-drag-region={winDragAttr} className="h-full min-w-[74px]" />
        <span
          data-tauri-drag-region={winDragAttr}
          className="pointer-events-none text-[10.5px] font-semibold tracking-[0.07em] uppercase text-[var(--text-tertiary)] truncate px-2"
        >
          Mini · SpotiDesk
        </span>
        <div data-tauri-drag-region={winDragAttr} className="flex items-center justify-end">
          <button
            ref={expandBtnRef}
            type="button"
            onClick={onExpand}
            title="Volver a la ventana completa"
            aria-label="Expandir SpotiDesk"
            className="h-6 px-2 rounded-md text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] inline-flex items-center gap-1 transition-colors cursor-pointer"
          >
            <Maximize2 size={11} strokeWidth={1.6} />
            Expandir
          </button>
        </div>
      </div>

      {/* Track + Controls Body */}
      <div className="relative z-10 flex-1 px-3.5 pb-3 pt-2.5 flex flex-col justify-between gap-2 min-h-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <LazyCover
              src={currentTrack?.albumImage}
              alt={currentTrack?.name || "SpotiDesk"}
              className="w-12 h-12"
              iconSize={18}
              roundedClass="rounded-xl"
              eager
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold tracking-[-0.02em] text-[var(--text-primary)] truncate">
              {currentTrack?.name || "Sin reproducción"}
            </div>
            <div className="text-[11.5px] text-[var(--text-secondary)] truncate">
              {activeLyric && isPlaying ? (
                <span className="italic text-[var(--text-primary)]/90">{activeLyric}</span>
              ) : (
                currentTrack?.artists || "Elige una canción"
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onPrevious}
              aria-label="Anterior"
              className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer active:scale-90"
            >
              <SkipBack size={14} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (isPlaying) setTremorKey((k) => k + 1);
                else setWaterKey((k) => k + 1);
                onTogglePlay();
              }}
              aria-label={isPlaying ? "Pausar" : "Reproducir"}
              className="relative w-9 h-9 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] flex items-center justify-center transition-transform active:scale-90 cursor-pointer"
            >
              <PlayWaterDropEffect triggerKey={waterKey} size="sm" />
              <StopShockEffect triggerKey={tremorKey} />
              {isPlaying ? (
                <Pause size={14} strokeWidth={1.8} fill="currentColor" />
              ) : (
                <Play size={14} strokeWidth={1.8} fill="currentColor" className="translate-x-[1px]" />
              )}
            </button>
            <button
              type="button"
              onClick={onNext}
              aria-label="Siguiente"
              className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer active:scale-90"
            >
              <SkipForward size={14} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={onToggleLike}
              disabled={!currentTrack}
              aria-label="Me Gusta"
              className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-35 transition-colors cursor-pointer active:scale-90"
            >
              <Heart
                size={13.5}
                strokeWidth={1.6}
                fill={isCurrentLiked ? "currentColor" : "none"}
                className={isCurrentLiked ? "text-[var(--text-primary)]" : ""}
              />
            </button>
          </div>
        </div>

        {/* Interactive Scrubber */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] tabular-nums text-[var(--text-tertiary)] w-7">
            {formatDuration(effectivePos)}
          </span>
          <div className="apple-slider-wrap flex-1">
            <div className="apple-slider-track">
              <div className="apple-slider-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(durationMs, 1)}
              value={Math.min(effectivePos, Math.max(durationMs, 1))}
              aria-label="Progreso"
              onMouseDown={() => {
                setIsScrubbing(true);
                setScrubPos(positionMs);
              }}
              onChange={(e) => setScrubPos(Number(e.target.value))}
              onMouseUp={(e) => {
                const next = Number((e.target as HTMLInputElement).value);
                setIsScrubbing(false);
                onSeek(next);
              }}
              className="apple-slider-input"
            />
          </div>
          <span className="text-[10px] tabular-nums text-[var(--text-tertiary)] w-7 text-right">
            {formatDuration(durationMs)}
          </span>
        </div>
      </div>
    </div>
  );
}
