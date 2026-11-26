import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Heart,
  ListMusic,
  Loader2,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { RepeatMode } from "../hooks/useSpotifyPlayer";
import type { ThemeMode } from "../hooks/useTheme";
import type { UnifiedTrack } from "../types/spotify";
import { useLyrics } from "../hooks/useLyrics";
import { formatDuration } from "../lib/format";
import { LazyCover } from "./LazyCover";
import { PlayWaterDropEffect, StopShockEffect } from "./KineticEffects";

export type TrackTransitionDir = "next" | "prev";
type StagePanelMode = "controls" | "lyrics" | "queue";

interface NowPlayingStageProps {
  currentTrack: UnifiedTrack;
  isPlaying: boolean;
  isCurrentLiked: boolean;
  positionMs: number;
  durationMs: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  volume: number;
  muted: boolean;
  ambientRgb: string | null;
  theme: ThemeMode;
  trackDir: TrackTransitionDir;
  activeDeviceName: string;
  queueTracks: UnifiedTrack[];
  onClose: () => void;
  onToggleLikeCurrent: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (ms: number) => void;
  onSetVolume: (vol: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onPlayQueueTrack: (uri: string) => void;
}

export function NowPlayingStage({
  currentTrack,
  isPlaying,
  isCurrentLiked,
  positionMs,
  durationMs,
  shuffle,
  repeatMode,
  volume,
  muted,
  ambientRgb,
  theme,
  trackDir,
  activeDeviceName,
  queueTracks,
  onClose,
  onToggleLikeCurrent,
  onTogglePlay,
  onNext,
  onPrevious,
  onSeek,
  onSetVolume,
  onToggleMute,
  onToggleShuffle,
  onCycleRepeat,
  onPlayQueueTrack,
}: NowPlayingStageProps) {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0);
  const [panelMode, setPanelMode] = useState<StagePanelMode>("controls");
  const [waterKey, setWaterKey] = useState(0);
  const [tremorKey, setTremorKey] = useState(0);
  const [heartKey, setHeartKey] = useState(0);
  const [skipNudge, setSkipNudge] = useState<"next" | "prev" | null>(null);
  const [hasTrackChanged, setHasTrackChanged] = useState(false);

  const initialTrackUriRef = useRef(currentTrack.uri);
  const prevPlayingRef = useRef<boolean | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const activeLyricRef = useRef<HTMLButtonElement | null>(null);

  const { lyrics, isLoading: isLoadingLyrics } = useLyrics(
    currentTrack,
    panelMode === "lyrics"
  );

  // Accessibility focus routing after View Transition opens
  useEffect(() => {
    stageRef.current?.focus();
  }, []);

  // Trigger Water-Drop on Play and Kinetic Tremor on Pause
  useEffect(() => {
    if (prevPlayingRef.current !== null && prevPlayingRef.current !== isPlaying) {
      if (isPlaying) setWaterKey((k) => k + 1);
      else setTremorKey((k) => k + 1);
    }
    prevPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Only run horizontal slide animation when changing tracks while Stage is already open
  useEffect(() => {
    if (currentTrack.uri !== initialTrackUriRef.current) {
      setHasTrackChanged(true);
    }
  }, [currentTrack.uri]);

  const effectivePosition = isScrubbing ? scrubPosition : positionMs;
  const progressPercent =
    durationMs > 0 ? Math.min(100, (effectivePosition / durationMs) * 100) : 0;
  const volumePercent = muted ? 0 : Math.round(volume * 100);

  // Compute active synced lyric line index
  const activeLyricIndex = useMemo(() => {
    if (!lyrics?.synced?.length) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.synced.length; i++) {
      if (lyrics.synced[i].timeMs <= effectivePosition + 180) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [lyrics?.synced, effectivePosition]);

  // Auto-scroll active synced lyric smoothly to the vertical center (Apple Music style)
  useEffect(() => {
    if (panelMode !== "lyrics" || activeLyricIndex < 0) return;
    activeLyricRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [panelMode, activeLyricIndex]);

  const upcomingTracks = queueTracks.filter((t) => t.uri !== currentTrack.uri);
  const trackKey = currentTrack.uri;
  const coverSlideClass = hasTrackChanged
    ? trackDir === "prev"
      ? "anim-track-prev"
      : "anim-track-next"
    : "";
  const textSlideClass = hasTrackChanged
    ? trackDir === "prev"
      ? "anim-text-prev"
      : "anim-text-next"
    : "";

  const handlePlayClick = () => {
    if (isPlaying) setTremorKey((k) => k + 1);
    else setWaterKey((k) => k + 1);
    onTogglePlay();
  };

  const handleNextClick = () => {
    setSkipNudge("next");
    window.setTimeout(() => setSkipNudge(null), 280);
    onNext();
  };

  const handlePrevClick = () => {
    setSkipNudge("prev");
    window.setTimeout(() => setSkipNudge(null), 280);
    onPrevious();
  };

  const toggleMode = (mode: "lyrics" | "queue") => {
    setPanelMode((prev) => (prev === mode ? "controls" : mode));
  };

  return (
    <div
      ref={stageRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Reproduciendo ${currentTrack.name}`}
      className="anim-stage-backdrop fixed inset-x-0 top-10 bottom-0 z-40 flex flex-col bg-[var(--bg-primary)] overflow-hidden outline-none"
    >
      {/* Atmospheric subtle backdrop glow derived from the active cover */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-opacity duration-700 ease-apple"
        style={{
          opacity: isPlaying ? 1 : 0.55,
          background: ambientRgb
            ? `radial-gradient(640px circle at 50% 38%, rgba(${ambientRgb}, ${
                theme === "dark" ? 0.24 : 0.14
              }), transparent 72%)`
            : `radial-gradient(640px circle at 50% 38%, rgba(134, 134, 139, ${
                theme === "dark" ? 0.12 : 0.08
              }), transparent 72%)`,
        }}
      />

      {/* Top minimal stage header */}
      <div className="chrome-no-select relative z-10 h-14 px-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          title="Minimizar vista (Esc)"
          className="h-9 px-3.5 rounded-full bg-[var(--bg-elevated)]/80 hover:bg-[var(--bg-hover)] border border-[var(--border-hairline)] text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-all duration-200 ease-apple active:scale-95 cursor-pointer"
        >
          <ChevronDown size={15} strokeWidth={1.6} />
          Volver
        </button>

        <div className="text-center hidden sm:block">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            Reproduciendo en {activeDeviceName}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggleMode("lyrics")}
            title="Letras sincronizadas"
            aria-pressed={panelMode === "lyrics"}
            className={`h-9 px-3.5 rounded-full border text-[12.5px] inline-flex items-center gap-1.5 transition-all duration-200 ease-apple active:scale-95 cursor-pointer ${
              panelMode === "lyrics"
                ? "bg-[var(--solid-bg)] border-transparent text-[var(--solid-fg)] font-medium"
                : "bg-[var(--bg-elevated)]/80 border-[var(--border-hairline)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Mic2 size={14} strokeWidth={1.5} />
            <span className="hidden sm:inline">Letras</span>
          </button>

          <button
            type="button"
            onClick={() => toggleMode("queue")}
            disabled={upcomingTracks.length === 0}
            title="Cola en vivo"
            aria-pressed={panelMode === "queue"}
            className={`h-9 px-3.5 rounded-full border text-[12.5px] inline-flex items-center gap-1.5 transition-all duration-200 ease-apple active:scale-95 cursor-pointer disabled:opacity-35 disabled:cursor-default ${
              panelMode === "queue"
                ? "bg-[var(--bg-active)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                : "bg-[var(--bg-elevated)]/80 border-[var(--border-hairline)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <ListMusic size={14} strokeWidth={1.5} />
            <span className="hidden sm:inline">Cola</span>
          </button>
        </div>
      </div>

      {/* Main Stage Body */}
      <div className="relative z-10 flex-1 min-h-0 flex items-center justify-center px-8 pb-8">
        <div className="w-full max-w-[1060px] flex flex-col lg:flex-row items-center justify-center gap-10 lg:gap-16 transition-all duration-500 ease-apple">
          {/* Left Hero Artwork + compact controls when viewing Lyrics */}
          <div className="flex flex-col items-center shrink-0">
            <div
              className="relative transition-transform duration-500 ease-apple"
              style={{
                transform: isPlaying ? "scale(1) translateY(0px)" : "scale(0.91) translateY(4px)",
              }}
            >
              {waterKey > 0 && isPlaying && (
                <span
                  key={`stage-liquid-${waterKey}`}
                  aria-hidden="true"
                  className="anim-artwork-liquid pointer-events-none absolute -inset-2 rounded-3xl border border-[var(--solid-bg)]/45"
                />
              )}
              <div
                key={`${trackKey}-${tremorKey > 0 && !isPlaying ? tremorKey : 0}`}
                className={`${coverSlideClass} ${
                  tremorKey > 0 && !isPlaying ? "anim-kinetic-tremor" : ""
                } rounded-2xl overflow-hidden border border-[var(--border-subtle)] transition-shadow duration-500 ease-apple`}
                style={{
                  viewTransitionName: "now-playing-cover",
                  boxShadow: isPlaying
                    ? "var(--shadow-stage-playing)"
                    : "var(--shadow-stage-paused)",
                }}
              >
                <LazyCover
                  src={currentTrack.albumImageLarge || currentTrack.albumImage}
                  alt={currentTrack.name}
                  className={
                    panelMode === "lyrics"
                      ? "w-[220px] h-[220px] sm:w-[270px] sm:h-[270px] lg:w-[310px] lg:h-[310px] transition-all duration-500 ease-apple"
                      : "w-[260px] h-[260px] sm:w-[330px] sm:h-[330px] lg:w-[380px] lg:h-[380px] transition-all duration-500 ease-apple"
                  }
                  iconSize={64}
                  roundedClass="rounded-2xl"
                />
              </div>
            </div>

            {/* Compact track caption + mini transport under cover when Lyrics are open */}
            {panelMode === "lyrics" && (
              <div className="anim-stagger-1 mt-6 w-[310px] space-y-3 text-center">
                <div>
                  <div className="text-[16px] font-semibold tracking-[-0.02em] text-[var(--text-primary)] truncate">
                    {currentTrack.name}
                  </div>
                  <div className="text-[13px] text-[var(--text-secondary)] truncate">
                    {currentTrack.artists}
                  </div>
                </div>
                <div className="chrome-no-select flex items-center justify-center gap-5 pt-1">
                  <button
                    type="button"
                    onClick={handlePrevClick}
                    aria-label="Pista anterior"
                    className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                  >
                    <SkipBack size={17} strokeWidth={1.6} />
                  </button>
                  <button
                    type="button"
                    onClick={handlePlayClick}
                    aria-label={isPlaying ? "Pausar" : "Reproducir"}
                    className="relative w-11 h-11 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] flex items-center justify-center cursor-pointer active:scale-90 transition-transform"
                  >
                    <PlayWaterDropEffect triggerKey={waterKey} size="sm" />
                    <StopShockEffect triggerKey={tremorKey} />
                    {isPlaying ? (
                      <Pause size={17} strokeWidth={1.8} fill="currentColor" />
                    ) : (
                      <Play size={17} strokeWidth={1.8} fill="currentColor" className="translate-x-[1px]" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleNextClick}
                    aria-label="Siguiente pista"
                    className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                  >
                    <SkipForward size={17} strokeWidth={1.6} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right Panel: Controls / Live Synced Lyrics / Queue */}
          <div className="w-full max-w-[480px] flex flex-col min-h-0">
            {panelMode === "lyrics" ? (
              <div
                className="anim-stagger-1 h-[420px] sm:h-[480px] overflow-y-auto px-2 py-24 space-y-5"
                style={{
                  maskImage:
                    "linear-gradient(to bottom, transparent 0%, black 16%, black 84%, transparent 100%)",
                  WebkitMaskImage:
                    "linear-gradient(to bottom, transparent 0%, black 16%, black 84%, transparent 100%)",
                }}
              >
                {isLoadingLyrics ? (
                  <div className="h-full flex flex-col items-center justify-center gap-3 text-[var(--text-secondary)]">
                    <Loader2 size={20} strokeWidth={1.5} className="animate-spin" />
                    <span className="text-[13px]">Buscando letras sincronizadas...</span>
                  </div>
                ) : lyrics?.instrumental ? (
                  <div className="h-full flex items-center justify-center text-[15px] text-[var(--text-secondary)]">
                    Pista instrumental
                  </div>
                ) : lyrics?.synced ? (
                  lyrics.synced.map((line, i) => {
                    const isActive = i === activeLyricIndex;
                    const isPast = i < activeLyricIndex;
                    return (
                      <button
                        key={`${line.timeMs}-${i}`}
                        ref={isActive ? activeLyricRef : null}
                        type="button"
                        onClick={() => onSeek(line.timeMs)}
                        className={`block w-full text-left font-semibold tracking-[-0.025em] leading-[1.28] transition-all duration-400 ease-apple cursor-pointer ${
                          isActive
                            ? "text-[23px] sm:text-[26px] text-[var(--text-primary)] opacity-100 scale-[1.01] origin-left"
                            : isPast
                              ? "text-[19px] sm:text-[21px] text-[var(--text-secondary)] opacity-35 hover:opacity-75"
                              : "text-[19px] sm:text-[21px] text-[var(--text-secondary)] opacity-45 hover:opacity-80"
                        }`}
                        style={{
                          filter: isActive ? "blur(0px)" : "blur(0.45px)",
                        }}
                      >
                        {line.text}
                      </button>
                    );
                  })
                ) : lyrics?.plain ? (
                  lyrics.plain.map((line, i) => (
                    <p
                      key={i}
                      className="text-[19px] font-medium tracking-[-0.02em] leading-relaxed text-[var(--text-primary)]/85"
                    >
                      {line}
                    </p>
                  ))
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-2">
                    <Mic2 size={24} strokeWidth={1.4} className="text-[var(--text-tertiary)]" />
                    <p className="text-[14px] text-[var(--text-secondary)]">
                      Letras no disponibles para esta canción
                    </p>
                  </div>
                )}
              </div>
            ) : panelMode === "queue" && upcomingTracks.length > 0 ? (
              <div className="anim-stagger-1 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                    A continuación
                  </h2>
                  <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
                    {upcomingTracks.length} pistas
                  </span>
                </div>

                <div className="max-h-[340px] overflow-y-auto pr-1 space-y-1">
                  {upcomingTracks.map((t, i) => (
                    <button
                      key={`${t.uri}-${i}`}
                      type="button"
                      onClick={() => onPlayQueueTrack(t.uri)}
                      className="w-full p-2.5 rounded-xl flex items-center gap-3 text-left hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                    >
                      <LazyCover
                        src={t.albumImage}
                        alt={t.name}
                        className="w-10 h-10"
                        iconSize={14}
                        roundedClass="rounded-lg"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-medium text-[var(--text-primary)] truncate">
                          {t.name}
                        </div>
                        <div className="text-[12px] text-[var(--text-secondary)] truncate">
                          {t.artists}
                        </div>
                      </div>
                      <span className="text-[11.5px] tabular-nums text-[var(--text-tertiary)]">
                        {formatDuration(t.durationMs)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-7">
                {/* Track Typography + Like button */}
                <div
                  key={trackKey}
                  className={`${textSlideClass} flex items-start justify-between gap-4`}
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    {currentTrack.albumName && (
                      <p className="anim-stagger-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-tertiary)] truncate">
                        {currentTrack.albumName}
                      </p>
                    )}

                    <h1
                      className="text-[28px] sm:text-[34px] font-semibold tracking-[-0.03em] leading-[1.12] text-[var(--text-primary)] line-clamp-2"
                      style={{
                        viewTransitionName: "now-playing-title",
                        width: "fit-content",
                      }}
                    >
                      {currentTrack.name}
                    </h1>

                    <p
                      className="text-[16px] sm:text-[18px] font-normal tracking-[-0.01em] text-[var(--text-secondary)] truncate"
                      style={{
                        viewTransitionName: "now-playing-artist",
                        width: "fit-content",
                      }}
                    >
                      {currentTrack.artists}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setHeartKey((k) => k + 1);
                      onToggleLikeCurrent();
                    }}
                    title={isCurrentLiked ? "Quitar de Tus Me Gusta" : "Añadir a Tus Me Gusta"}
                    aria-label={isCurrentLiked ? "Quitar de Tus Me Gusta" : "Añadir a Tus Me Gusta"}
                    className={`mt-5 w-10 h-10 shrink-0 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/80 hover:bg-[var(--bg-hover)] flex items-center justify-center transition-colors cursor-pointer ${
                      isCurrentLiked
                        ? "text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <span key={heartKey} className={heartKey > 0 ? "anim-heart-burst flex" : "flex"}>
                      <Heart
                        size={17}
                        strokeWidth={1.6}
                        fill={isCurrentLiked ? "currentColor" : "none"}
                      />
                    </span>
                  </button>
                </div>

                {/* Progress Bar */}
                <div className="anim-stagger-2 chrome-no-select space-y-2">
                  <div className="apple-slider-wrap">
                    <div className="apple-slider-track">
                      <div
                        className="apple-slider-fill"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(durationMs, 1)}
                      value={effectivePosition}
                      aria-label="Progreso de reproducción"
                      onPointerDown={() => {
                        setIsScrubbing(true);
                        setScrubPosition(positionMs);
                      }}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setScrubPosition(val);
                        if (!isScrubbing) onSeek(val);
                      }}
                      onPointerUp={(e) => {
                        const val = Number((e.target as HTMLInputElement).value);
                        setIsScrubbing(false);
                        onSeek(val);
                      }}
                      className="apple-slider-input"
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11.5px] tabular-nums text-[var(--text-secondary)]">
                    <span>{formatDuration(effectivePosition)}</span>
                    <span>-{formatDuration(Math.max(0, durationMs - effectivePosition))}</span>
                  </div>
                </div>

                {/* Tactile Main Transport Controls */}
                <div className="anim-stagger-3 chrome-no-select flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={onToggleShuffle}
                    title="Aleatorio"
                    aria-label="Alternar aleatorio"
                    aria-pressed={shuffle}
                    className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ease-apple active:scale-90 cursor-pointer ${
                      shuffle
                        ? "text-[var(--text-primary)] bg-[var(--bg-active)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <Shuffle size={17} strokeWidth={1.5} />
                    {shuffle && (
                      <span className="absolute bottom-1.5 w-1 h-1 rounded-full bg-[var(--text-primary)]" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handlePrevClick}
                    title="Anterior"
                    aria-label="Pista anterior"
                    className={`w-11 h-11 rounded-full flex items-center justify-center text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all duration-200 ease-apple active:scale-90 cursor-pointer ${
                      skipNudge === "prev" ? "anim-nudge-left" : ""
                    }`}
                  >
                    <SkipBack size={22} strokeWidth={1.5} />
                  </button>

                  <button
                    type="button"
                    onClick={handlePlayClick}
                    title={isPlaying ? "Pausar" : "Reproducir"}
                    aria-label={isPlaying ? "Pausar" : "Reproducir"}
                    className={`relative w-14 h-14 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] flex items-center justify-center transition-transform duration-200 ease-apple active:scale-90 shadow-lg cursor-pointer ${
                      tremorKey > 0 && !isPlaying ? "anim-kinetic-tremor" : ""
                    }`}
                  >
                    <PlayWaterDropEffect triggerKey={waterKey} size="lg" />
                    <StopShockEffect triggerKey={tremorKey} />
                    <span key={isPlaying ? "pause" : "play"} className="anim-icon-pop flex">
                      {isPlaying ? (
                        <Pause size={22} strokeWidth={1.8} fill="currentColor" />
                      ) : (
                        <Play
                          size={22}
                          strokeWidth={1.8}
                          fill="currentColor"
                          className="translate-x-[1.5px]"
                        />
                      )}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleNextClick}
                    title="Siguiente"
                    aria-label="Siguiente pista"
                    className={`w-11 h-11 rounded-full flex items-center justify-center text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all duration-200 ease-apple active:scale-90 cursor-pointer ${
                      skipNudge === "next" ? "anim-nudge-right" : ""
                    }`}
                  >
                    <SkipForward size={22} strokeWidth={1.5} />
                  </button>

                  <button
                    type="button"
                    onClick={onCycleRepeat}
                    title="Repetir"
                    aria-label="Cambiar repetición"
                    className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ease-apple active:scale-90 cursor-pointer ${
                      repeatMode !== "off"
                        ? "text-[var(--text-primary)] bg-[var(--bg-active)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    {repeatMode === "track" ? (
                      <Repeat1 size={17} strokeWidth={1.5} />
                    ) : (
                      <Repeat size={17} strokeWidth={1.5} />
                    )}
                    {repeatMode !== "off" && (
                      <span className="absolute bottom-1.5 w-1 h-1 rounded-full bg-[var(--text-primary)]" />
                    )}
                  </button>
                </div>

                {/* Minimal Volume Bar */}
                <div className="anim-stagger-4 chrome-no-select flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={onToggleMute}
                    aria-label={muted || volume === 0 ? "Activar sonido" : "Silenciar"}
                    className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  >
                    {muted || volume === 0 ? (
                      <VolumeX size={15} strokeWidth={1.5} />
                    ) : volume < 0.5 ? (
                      <Volume1 size={15} strokeWidth={1.5} />
                    ) : (
                      <Volume2 size={15} strokeWidth={1.5} />
                    )}
                  </button>

                  <div className="apple-slider-wrap flex-1">
                    <div className="apple-slider-track">
                      <div
                        className="apple-slider-fill"
                        style={{ width: `${volumePercent}%` }}
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={volumePercent}
                      aria-label="Volumen"
                      onChange={(e) => onSetVolume(Number(e.target.value) / 100)}
                      className="apple-slider-input"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
