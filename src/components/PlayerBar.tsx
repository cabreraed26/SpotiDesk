import { useEffect, useRef, useState } from "react";
import {
  Check,
  Heart,
  Laptop,
  ListMusic,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Smartphone,
  Speaker,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { RepeatMode } from "../hooks/useSpotifyPlayer";
import type { SpotifyDevice, UnifiedTrack } from "../types/spotify";
import type { TrackTransitionDir } from "./NowPlayingStage";
import { formatDuration } from "../lib/format";
import { LazyCover } from "./LazyCover";
import { PlayWaterDropEffect, StopShockEffect } from "./KineticEffects";

interface PlayerBarProps {
  currentTrack: UnifiedTrack | null;
  isPlaying: boolean;
  isCurrentLiked: boolean;
  positionMs: number;
  durationMs: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  volume: number;
  muted: boolean;
  devices: SpotifyDevice[];
  localDeviceId: string | null;
  activeDeviceName: string;
  isStageOpen: boolean;
  isQueueOpen: boolean;
  trackDir: TrackTransitionDir;
  onOpenStage: () => void;
  onToggleQueue: () => void;
  onToggleLikeCurrent: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (ms: number) => void;
  onSetVolume: (vol: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onRefreshDevices: () => void;
  onTransferDevice: (deviceId: string) => void;
}

function DeviceIcon({ type }: { type: string }) {
  const lowered = type.toLowerCase();
  if (lowered.includes("phone")) return <Smartphone size={14} strokeWidth={1.5} />;
  if (lowered.includes("speaker")) return <Speaker size={14} strokeWidth={1.5} />;
  return <Laptop size={14} strokeWidth={1.5} />;
}

export function PlayerBar({
  currentTrack,
  isPlaying,
  isCurrentLiked,
  positionMs,
  durationMs,
  shuffle,
  repeatMode,
  volume,
  muted,
  devices,
  localDeviceId,
  activeDeviceName,
  isStageOpen,
  isQueueOpen,
  trackDir,
  onOpenStage,
  onToggleQueue,
  onToggleLikeCurrent,
  onTogglePlay,
  onNext,
  onPrevious,
  onSeek,
  onSetVolume,
  onToggleMute,
  onToggleShuffle,
  onCycleRepeat,
  onRefreshDevices,
  onTransferDevice,
}: PlayerBarProps) {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [waterKey, setWaterKey] = useState(0);
  const [tremorKey, setTremorKey] = useState(0);
  const [heartKey, setHeartKey] = useState(0);
  const [skipNudge, setSkipNudge] = useState<"next" | "prev" | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const prevPlayingRef = useRef<boolean | null>(null);

  // React automatically to Play (Water-Drop Ripple) & Pause (Kinetic Tremor)
  useEffect(() => {
    if (prevPlayingRef.current !== null && prevPlayingRef.current !== isPlaying) {
      if (isPlaying) {
        setWaterKey((k) => k + 1);
      } else {
        setTremorKey((k) => k + 1);
      }
    }
    prevPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Close Spotify Connect popover on outside click or Escape
  useEffect(() => {
    if (!devicesOpen) return;
    const handlePointer = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setDevicesOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDevicesOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [devicesOpen]);

  const effectivePosition = isScrubbing ? scrubPosition : positionMs;
  const progressPercent =
    durationMs > 0 ? Math.min(100, (effectivePosition / durationMs) * 100) : 0;
  const volumePercent = muted ? 0 : Math.round(volume * 100);

  const handlePlayClick = () => {
    if (isPlaying) {
      setTremorKey((k) => k + 1);
    } else {
      setWaterKey((k) => k + 1);
    }
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

  const trackTextAnim = trackDir === "prev" ? "anim-text-prev" : "anim-text-next";

  // Keep view-transition-name exclusive to PlayerBar only while Stage is closed
  const assignTransitionNames = Boolean(currentTrack && !isStageOpen);

  return (
    <div className="pointer-events-none fixed bottom-4 left-0 right-0 z-30 flex justify-center px-5">
      <section
        aria-label="Barra de reproducción"
        className={`pointer-events-auto glass-surface w-full max-w-[1060px] h-[78px] px-4 rounded-2xl border border-[var(--border-hairline)] grid grid-cols-[minmax(0,1fr)_minmax(280px,1.35fr)_minmax(0,1fr)] items-center gap-4 transition-transform duration-300 ease-apple ${
          tremorKey > 0 && !isPlaying ? "anim-capsule-tremor" : ""
        }`}
        style={{ boxShadow: "var(--shadow-capsule)" }}
      >
        {/* Left: Current Track (clickable cover morphs smoothly into Full-Screen Stage) */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            disabled={!currentTrack}
            onClick={onOpenStage}
            title={currentTrack ? "Expandir portada en pantalla (F)" : undefined}
            aria-label="Expandir vista de portada"
            className={`group relative shrink-0 rounded-lg transition-transform duration-300 ease-apple ${
              currentTrack ? "cursor-pointer active:scale-95" : "cursor-default"
            }`}
            style={{
              transform: isPlaying ? "scale(1)" : "scale(0.94)",
              viewTransitionName: assignTransitionNames ? "now-playing-cover" : undefined,
            }}
          >
            <LazyCover
              src={currentTrack?.albumImage}
              alt={currentTrack?.name || "Sin reproducción"}
              className="w-12 h-12"
              iconSize={18}
              roundedClass="rounded-lg"
            />
            {waterKey > 0 && isPlaying && (
              <span
                key={`cover-liquid-${waterKey}`}
                aria-hidden="true"
                className="anim-artwork-liquid pointer-events-none absolute inset-0 rounded-lg border border-[var(--solid-bg)]/65"
              />
            )}
            {currentTrack && (
              <span className="absolute inset-0 rounded-lg bg-black/55 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity duration-200 ease-apple">
                <Maximize2 size={14} strokeWidth={1.6} />
              </span>
            )}
          </button>

          <div
            key={currentTrack?.uri ?? "idle"}
            className={`${currentTrack ? trackTextAnim : ""} min-w-0 flex-1`}
          >
            <div
              className="text-[13px] font-medium text-[var(--text-primary)] truncate tracking-[-0.01em] max-w-full"
              style={{
                viewTransitionName: assignTransitionNames ? "now-playing-title" : undefined,
                width: "fit-content",
              }}
            >
              {currentTrack?.name || "Sin reproducción activa"}
            </div>
            <div
              className="text-[11.5px] text-[var(--text-secondary)] truncate mt-0.5 max-w-full"
              style={{
                viewTransitionName: assignTransitionNames ? "now-playing-artist" : undefined,
                width: "fit-content",
              }}
            >
              {currentTrack?.artists || "Selecciona una canción para comenzar"}
            </div>
          </div>

          {currentTrack && (
            <button
              type="button"
              onClick={() => {
                setHeartKey((k) => k + 1);
                onToggleLikeCurrent();
              }}
              title={isCurrentLiked ? "Quitar de Tus Me Gusta" : "Añadir a Tus Me Gusta"}
              aria-label={isCurrentLiked ? "Quitar de Tus Me Gusta" : "Añadir a Tus Me Gusta"}
              className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--bg-hover)] cursor-pointer ${
                isCurrentLiked
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span key={heartKey} className={heartKey > 0 ? "anim-heart-burst flex" : "flex"}>
                <Heart
                  size={14}
                  strokeWidth={1.6}
                  fill={isCurrentLiked ? "currentColor" : "none"}
                />
              </span>
            </button>
          )}
        </div>

        {/* Center: Tactile Controls + Slim Progress Bar */}
        <div className="chrome-no-select flex flex-col items-center justify-center gap-1.5">
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              onClick={onToggleShuffle}
              title="Aleatorio"
              aria-label="Alternar reproducción aleatoria"
              aria-pressed={shuffle}
              className={`relative w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ease-apple active:scale-90 cursor-pointer ${
                shuffle
                  ? "text-[var(--text-primary)] bg-[var(--bg-active)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Shuffle size={14} strokeWidth={1.5} />
              {shuffle && (
                <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-[var(--text-primary)]" />
              )}
            </button>

            <button
              type="button"
              onClick={handlePrevClick}
              title="Anterior"
              aria-label="Pista anterior"
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all duration-150 ease-apple active:scale-90 cursor-pointer ${
                skipNudge === "prev" ? "anim-nudge-left" : ""
              }`}
            >
              <SkipBack size={16} strokeWidth={1.5} />
            </button>

            <button
              type="button"
              onClick={handlePlayClick}
              title={isPlaying ? "Pausar" : "Reproducir"}
              aria-label={isPlaying ? "Pausar" : "Reproducir"}
              className={`relative w-9 h-9 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] flex items-center justify-center transition-transform duration-150 ease-apple active:scale-90 cursor-pointer ${
                tremorKey > 0 && !isPlaying ? "anim-kinetic-tremor" : ""
              }`}
            >
              <PlayWaterDropEffect triggerKey={waterKey} size="sm" />
              <StopShockEffect triggerKey={tremorKey} />
              <span key={isPlaying ? "pause" : "play"} className="anim-icon-pop flex">
                {isPlaying ? (
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
              onClick={handleNextClick}
              title="Siguiente"
              aria-label="Siguiente pista"
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all duration-150 ease-apple active:scale-90 cursor-pointer ${
                skipNudge === "next" ? "anim-nudge-right" : ""
              }`}
            >
              <SkipForward size={16} strokeWidth={1.5} />
            </button>

            <button
              type="button"
              onClick={onCycleRepeat}
              title={
                repeatMode === "track"
                  ? "Repetir canción"
                  : repeatMode === "context"
                    ? "Repetir lista"
                    : "Repetir desactivado"
              }
              aria-label="Cambiar modo de repetición"
              className={`relative w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ease-apple active:scale-90 cursor-pointer ${
                repeatMode !== "off"
                  ? "text-[var(--text-primary)] bg-[var(--bg-active)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {repeatMode === "track" ? (
                <Repeat1 size={14} strokeWidth={1.5} />
              ) : (
                <Repeat size={14} strokeWidth={1.5} />
              )}
              {repeatMode !== "off" && (
                <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-[var(--text-primary)]" />
              )}
            </button>
          </div>

          {/* Interactive slim progress bar with tabular-nums */}
          <div className="w-full flex items-center gap-2.5">
            <span className="w-9 text-right text-[11px] tabular-nums text-[var(--text-secondary)]">
              {formatDuration(effectivePosition)}
            </span>

            <div className="apple-slider-wrap flex-1">
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

            <span className="w-9 text-left text-[11px] tabular-nums text-[var(--text-secondary)]">
              {formatDuration(durationMs)}
            </span>
          </div>
        </div>

        {/* Right: Device Selector + Volume + Expand Cover Stage Button */}
        <div className="chrome-no-select flex items-center justify-end gap-2">
          {/* Device Picker */}
          <div className="relative" ref={popoverRef}>
            <button
              type="button"
              onClick={() => {
                const next = !devicesOpen;
                setDevicesOpen(next);
                if (next) onRefreshDevices();
              }}
              title={`Dispositivo: ${activeDeviceName}`}
              aria-label="Seleccionar dispositivo Spotify Connect"
              aria-expanded={devicesOpen}
              className={`h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-[11.5px] transition-colors cursor-pointer ${
                devicesOpen
                  ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Laptop size={14} strokeWidth={1.5} />
              <span className="hidden lg:inline max-w-[88px] truncate">
                {activeDeviceName}
              </span>
            </button>

            {devicesOpen && (
              <div className="anim-popover-enter popover-glass absolute bottom-12 right-0 w-64 p-2 rounded-xl border border-[var(--border-subtle)] z-50">
                <div className="px-2.5 py-1.5 flex items-center justify-between border-b border-[var(--border-hairline)] mb-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                    Spotify Connect
                  </span>
                  <button
                    type="button"
                    onClick={onRefreshDevices}
                    title="Actualizar dispositivos"
                    className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                  >
                    <RefreshCw size={12} strokeWidth={1.5} />
                  </button>
                </div>

                <div className="space-y-0.5 max-h-52 overflow-y-auto">
                  {devices.length === 0 ? (
                    <p className="px-2.5 py-3 text-[12px] text-[var(--text-secondary)]">
                      No se detectaron dispositivos activos.
                    </p>
                  ) : (
                    devices.map((device) => {
                      if (!device.id) return null;
                      const isThisApp = device.id === localDeviceId;
                      return (
                        <button
                          key={device.id}
                          type="button"
                          onClick={() => {
                            onTransferDevice(device.id!);
                            setDevicesOpen(false);
                          }}
                          className={`w-full px-2.5 py-2 rounded-lg flex items-center justify-between gap-2 text-left text-[12.5px] transition-colors cursor-pointer ${
                            device.is_active
                              ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
                              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <DeviceIcon type={device.type} />
                            <span className="truncate">
                              {device.name}
                              {isThisApp ? " (Este equipo)" : ""}
                            </span>
                          </span>
                          {device.is_active && (
                            <Check size={13} strokeWidth={1.8} className="shrink-0" />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Volume Control */}
          <div className="flex items-center gap-2 w-24">
            <button
              type="button"
              onClick={onToggleMute}
              title={muted || volume === 0 ? "Activar sonido" : "Silenciar"}
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

          {/* Queue Drawer Button */}
          <button
            type="button"
            onClick={onToggleQueue}
            title="Cola de reproducción"
            aria-label="Abrir cola de reproducción"
            aria-pressed={isQueueOpen}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200 ease-apple active:scale-90 cursor-pointer ${
              isQueueOpen
                ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            <ListMusic size={14} strokeWidth={1.5} />
          </button>

          {/* Dedicated button to open Full-Screen Now Playing Cover Stage */}
          {currentTrack && (
            <button
              type="button"
              onClick={onOpenStage}
              title="Ver portada en pantalla completa (F)"
              aria-label="Ver portada en pantalla completa"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all duration-200 ease-apple active:scale-90 cursor-pointer"
            >
              <Maximize2 size={14} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
