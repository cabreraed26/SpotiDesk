import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Bookmark,
  BookmarkPlus,
  Check,
  ChevronDown,
  Clock,
  Disc3,
  Heart,
  Languages,
  ListMusic,
  Loader2,
  Mic2,
  Minus,
  Pause,
  Play,
  Plus,
  Radio,
  Repeat,
  Repeat1,
  Repeat2,
  Search,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { RepeatMode } from "../hooks/useSpotifyPlayer";
import type { ThemeMode } from "../hooks/useTheme";
import type { UnifiedTrack } from "../types/spotify";
import { useLyrics } from "../hooks/useLyrics";
import {
  getLyricOffsetMs,
  renderLyricCardBlob,
  setLyricOffsetMs,
} from "../lib/lyricSync";
import {
  addTrackBookmark,
  getTrackBookmarks,
  removeTrackBookmark,
  type TrackBookmark,
} from "../lib/trackBookmarks";
import { formatDuration } from "../lib/format";
import { LazyCover } from "./LazyCover";
import { ArtistLinks } from "./ArtistLinks";
import { PlayWaterDropEffect, StopShockEffect } from "./KineticEffects";

export type TrackTransitionDir = "next" | "prev";
type StagePanelMode = "controls" | "lyrics" | "queue";

// In-memory cache of translated lyric lines keyed by track URI
const lyricsTranslationCache = new Map<string, string[]>();

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
  onStartRadio?: (track: UnifiedTrack) => void;
  onSelectArtist?: (artistId: string, artistName?: string) => void;
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
  onStartRadio,
  onSelectArtist,
}: NowPlayingStageProps) {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0);
  const [panelMode, setPanelMode] = useState<StagePanelMode>("controls");
  const [vinylMode, setVinylMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem("spotidesk.vinyl_mode") === "true";
    } catch {
      return false;
    }
  });

  const handleToggleVinyl = () => {
    setVinylMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("spotidesk.vinyl_mode", String(next));
      } catch {
        // Ignore
      }
      return next;
    });
  };
  const [waterKey, setWaterKey] = useState(0);
  const [tremorKey, setTremorKey] = useState(0);
  const [heartKey, setHeartKey] = useState(0);
  const [skipNudge, setSkipNudge] = useState<"next" | "prev" | null>(null);
  const [hasTrackChanged, setHasTrackChanged] = useState(false);
  const [lyricOffsetMs, setLyricOffsetState] = useState<number>(() =>
    getLyricOffsetMs(currentTrack.uri)
  );
  const [isSelectingVerses, setIsSelectingVerses] = useState(false);
  const [selectedVerseIndices, setSelectedVerseIndices] = useState<number[]>([]);
  const [shareStatus, setShareStatus] = useState<
    "idle" | "rendering" | "copied" | "downloaded"
  >("idle");

  // Live Lyrics Translation + Search inside Lyrics
  const [showTranslation, setShowTranslation] = useState(false);
  const [translatedLines, setTranslatedLines] = useState<string[] | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [lyricSearchOpen, setLyricSearchOpen] = useState(false);
  const [lyricSearchQuery, setLyricSearchQuery] = useState("");

  // Apple StandBy / Desk Clock Mode with auto-hiding chrome
  const [deskMode, setDeskMode] = useState(false);
  const [deskChromeVisible, setDeskChromeVisible] = useState(true);
  const [nowDate, setNowDate] = useState(() => new Date());
  const deskIdleTimerRef = useRef<number | null>(null);

  // Precision A-B Loop & Per-Track Timestamp Bookmarks
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const lastLoopSeekRef = useRef(0);
  const [bookmarks, setBookmarks] = useState<TrackBookmark[]>(() =>
    getTrackBookmarks(currentTrack.uri)
  );
  const [addingBookmark, setAddingBookmark] = useState(false);
  const [bookmarkDraft, setBookmarkDraft] = useState("");
  const [bookmarkTimeMs, setBookmarkTimeMs] = useState(0);

  const initialTrackUriRef = useRef(currentTrack.uri);
  const prevPlayingRef = useRef<boolean | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const activeLyricRef = useRef<HTMLButtonElement | null>(null);

  // Sync per-track lyric offset, bookmarks, A-B loop, and share selection on track change
  useEffect(() => {
    setLyricOffsetState(getLyricOffsetMs(currentTrack.uri));
    setBookmarks(getTrackBookmarks(currentTrack.uri));
    setLoopA(null);
    setLoopB(null);
    setAddingBookmark(false);
    setBookmarkDraft("");
    setIsSelectingVerses(false);
    setSelectedVerseIndices([]);
    setShareStatus("idle");
    setShowTranslation(false);
    setTranslatedLines(lyricsTranslationCache.get(currentTrack.uri) ?? null);
    setIsTranslating(false);
    setLyricSearchOpen(false);
    setLyricSearchQuery("");
  }, [currentTrack.uri]);

  // Precision A-B Loop auto-seek watcher
  useEffect(() => {
    if (
      !isPlaying ||
      isScrubbing ||
      loopA === null ||
      loopB === null ||
      loopB <= loopA + 400
    ) {
      return;
    }
    if (positionMs >= loopB && performance.now() - lastLoopSeekRef.current > 650) {
      lastLoopSeekRef.current = performance.now();
      onSeek(loopA);
    }
  }, [isPlaying, isScrubbing, loopA, loopB, positionMs, onSeek]);

  // Desk StandBy live clock & auto-hide controls after 3.2s of cursor idle
  useEffect(() => {
    if (!deskMode) {
      setDeskChromeVisible(true);
      if (deskIdleTimerRef.current) window.clearTimeout(deskIdleTimerRef.current);
      return;
    }

    setNowDate(new Date());
    const clockInterval = window.setInterval(() => setNowDate(new Date()), 10_000);

    const wakeChrome = () => {
      setDeskChromeVisible(true);
      if (deskIdleTimerRef.current) window.clearTimeout(deskIdleTimerRef.current);
      deskIdleTimerRef.current = window.setTimeout(() => {
        setDeskChromeVisible(false);
      }, 3200);
    };

    wakeChrome();
    window.addEventListener("pointermove", wakeChrome);
    window.addEventListener("keydown", wakeChrome);
    return () => {
      window.clearInterval(clockInterval);
      if (deskIdleTimerRef.current) window.clearTimeout(deskIdleTimerRef.current);
      window.removeEventListener("pointermove", wakeChrome);
      window.removeEventListener("keydown", wakeChrome);
    };
  }, [deskMode]);

  const handleCycleABLoop = () => {
    if (loopA === null) {
      setLoopA(Math.round(effectivePosition));
      setLoopB(null);
    } else if (loopB === null) {
      const candidate = Math.round(effectivePosition);
      if (candidate > loopA + 500) {
        setLoopB(candidate);
        lastLoopSeekRef.current = performance.now();
        onSeek(loopA);
      } else {
        setLoopA(candidate);
      }
    } else {
      setLoopA(null);
      setLoopB(null);
    }
  };

  const handleSaveBookmark = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = addTrackBookmark(currentTrack.uri, bookmarkTimeMs, bookmarkDraft);
    setBookmarks(updated);
    setAddingBookmark(false);
    setBookmarkDraft("");
  };

  const handleDeleteBookmark = (id: string) => {
    setBookmarks(removeTrackBookmark(currentTrack.uri, id));
  };

  const handleAdjustLyricOffset = (deltaMs: number) => {
    const next = deltaMs === 0 ? 0 : lyricOffsetMs + deltaMs;
    const saved = setLyricOffsetMs(currentTrack.uri, next);
    setLyricOffsetState(saved);
  };

  const toggleVerseIndex = (idx: number) => {
    setSelectedVerseIndices((prev) => {
      if (prev.includes(idx)) return prev.filter((i) => i !== idx);
      if (prev.length >= 4) return [...prev.slice(1), idx].sort((a, b) => a - b);
      return [...prev, idx].sort((a, b) => a - b);
    });
  };

  const handleExportLyricCard = async () => {
    const allLines = lyrics?.synced
      ? lyrics.synced.map((l) => l.text)
      : lyrics?.plain ?? [];
    const verses = selectedVerseIndices
      .map((i) => allLines[i])
      .filter((t): t is string => Boolean(t && t !== "···"));
    if (verses.length === 0) return;

    setShareStatus("rendering");
    try {
      const blob = await renderLyricCardBlob({
        track: currentTrack,
        verses,
        theme,
        ambientRgb,
      });
      if (!blob) {
        setShareStatus("idle");
        return;
      }

      let copied = false;
      if (typeof navigator !== "undefined" && navigator.clipboard && "ClipboardItem" in window) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          copied = true;
        } catch {
          copied = false;
        }
      }

      if (copied) {
        setShareStatus("copied");
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${currentTrack.name.replace(/[^\w\s-]/g, "").trim() || "verso"}-spotidesk.png`;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
        setShareStatus("downloaded");
      }

      window.setTimeout(() => {
        setShareStatus("idle");
        setIsSelectingVerses(false);
        setSelectedVerseIndices([]);
      }, 1800);
    } catch {
      setShareStatus("idle");
    }
  };

  const { lyrics, isLoading: isLoadingLyrics } = useLyrics(
    currentTrack,
    panelMode === "lyrics" || deskMode
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

  // Compute active synced lyric line index (incorporating per-track calibration offset)
  const activeLyricIndex = useMemo(() => {
    if (!lyrics?.synced?.length) return -1;
    const adjustedPos = effectivePosition + 180 + lyricOffsetMs;
    let idx = -1;
    for (let i = 0; i < lyrics.synced.length; i++) {
      if (lyrics.synced[i].timeMs <= adjustedPos) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [lyrics?.synced, effectivePosition, lyricOffsetMs]);

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

  const handleToggleTranslation = async () => {
    if (showTranslation) {
      setShowTranslation(false);
      return;
    }
    const cached = lyricsTranslationCache.get(currentTrack.uri);
    if (cached) {
      setTranslatedLines(cached);
      setShowTranslation(true);
      return;
    }
    const rawLines = lyrics?.synced
      ? lyrics.synced.map((l) => l.text)
      : lyrics?.plain ?? [];
    if (rawLines.length === 0 || isTranslating) return;

    setIsTranslating(true);
    try {
      const res = await invoke<string[]>("translate_lyrics", {
        lines: rawLines,
        targetLang: "es",
      });
      lyricsTranslationCache.set(currentTrack.uri, res);
      setTranslatedLines(res);
      setShowTranslation(true);
    } catch {
      // Silent fail if offline
    } finally {
      setIsTranslating(false);
    }
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

      {/* Top minimal stage header (auto-fades gently during idle Desk StandBy mode) */}
      <div
        className={`chrome-no-select relative z-10 h-14 px-8 flex items-center justify-between transition-opacity duration-500 ease-apple ${
          deskMode && !deskChromeVisible ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
      >
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
            {deskMode ? "Modo Desk · StandBy" : `Reproduciendo en ${activeDeviceName}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!deskMode && onStartRadio && (
            <button
              type="button"
              onClick={() => onStartRadio(currentTrack)}
              title="Iniciar Radio instantánea basada en esta canción"
              className="h-9 px-3.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/80 hover:bg-[var(--bg-hover)] text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-all duration-200 ease-apple active:scale-95 cursor-pointer"
            >
              <Radio size={14} strokeWidth={1.5} />
              <span className="hidden md:inline">Radio</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setDeskMode((v) => !v)}
            title={deskMode ? "Salir del Modo Desk" : "Modo Desk / StandBy (reloj minimalista)"}
            aria-pressed={deskMode}
            className={`h-9 px-3.5 rounded-full border text-[12.5px] inline-flex items-center gap-1.5 transition-all duration-200 ease-apple active:scale-95 cursor-pointer ${
              deskMode
                ? "bg-[var(--solid-bg)] border-transparent text-[var(--solid-fg)] font-medium"
                : "bg-[var(--bg-elevated)]/80 border-[var(--border-hairline)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Clock size={14} strokeWidth={1.5} />
            <span className="hidden sm:inline">Desk</span>
          </button>

          <button
            type="button"
            onClick={handleToggleVinyl}
            title={vinylMode ? "Cambiar a Portada" : "Activar Modo Vinilo"}
            aria-pressed={vinylMode}
            className={`h-9 px-3.5 rounded-full border text-[12.5px] inline-flex items-center gap-1.5 transition-all duration-200 ease-apple active:scale-95 cursor-pointer ${
              vinylMode
                ? "bg-[var(--bg-active)] border-[var(--border-subtle)] text-[var(--text-primary)] font-medium"
                : "bg-[var(--bg-elevated)]/80 border-[var(--border-hairline)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Disc3
              size={14}
              strokeWidth={1.5}
              className={vinylMode && isPlaying ? "animate-spin" : ""}
              style={vinylMode && isPlaying ? { animationDuration: "4.5s" } : undefined}
            />
            <span className="hidden sm:inline">Vinilo</span>
          </button>

          {!deskMode && (
            <>
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
            </>
          )}
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
              {vinylMode ? (
                <div
                  key={`${trackKey}-vinyl`}
                  className={`${coverSlideClass} relative flex items-center justify-center ${
                    panelMode === "lyrics"
                      ? "w-[236px] h-[236px] sm:w-[280px] sm:h-[280px] lg:w-[320px] lg:h-[320px]"
                      : "w-[276px] h-[276px] sm:w-[344px] sm:h-[344px] lg:w-[392px] lg:h-[392px]"
                  } transition-all duration-500 ease-apple`}
                >
                  {/* Spinning Vinyl Record */}
                  <div
                    className={`vinyl-disc vinyl-spinning ${
                      isPlaying ? "" : "vinyl-paused"
                    } relative w-full h-full rounded-full flex items-center justify-center overflow-hidden`}
                    style={{ viewTransitionName: "now-playing-cover" }}
                  >
                    <div
                      aria-hidden="true"
                      className="vinyl-sheen pointer-events-none absolute inset-0 rounded-full"
                    />
                    {/* Center Album Art Label */}
                    <div className="relative z-10 w-[44%] h-[44%] rounded-full overflow-hidden border-2 border-black/80 shadow-xl">
                      <LazyCover
                        src={currentTrack.albumImageLarge || currentTrack.albumImage}
                        alt={currentTrack.name}
                        className="w-full h-full"
                        iconSize={32}
                        roundedClass="rounded-full"
                        eager
                      />
                      {/* Metallic Spindle Hole */}
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[var(--bg-primary)] border border-white/30 shadow-inner"
                      />
                    </div>
                  </div>

                  {/* Minimalist Pivoting Tonearm */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-2 -right-3 z-20 origin-[82%_14%] transition-transform duration-700 ease-apple"
                    style={{
                      transform: isPlaying ? "rotate(22deg)" : "rotate(0deg)",
                    }}
                  >
                    <div className="relative w-16 h-40">
                      {/* Pivot Base */}
                      <div className="absolute top-2 right-1.5 w-7 h-7 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shadow-md flex items-center justify-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-[var(--text-tertiary)]" />
                      </div>
                      {/* Slim Metallic Arm */}
                      <div className="absolute top-6 right-[18px] w-[3px] h-28 rounded-full bg-gradient-to-b from-zinc-300 to-zinc-500 shadow" />
                      {/* Cartridge Head */}
                      <div className="absolute bottom-3 right-[13px] w-3 h-6 rounded-sm bg-zinc-700 border border-zinc-400/50 rotate-[14deg] shadow-md" />
                    </div>
                  </div>
                </div>
              ) : (
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
                    eager
                  />
                </div>
              )}
            </div>

            {/* Compact track caption + mini transport under cover when Lyrics are open */}
            {panelMode === "lyrics" && (
              <div className="anim-stagger-1 mt-6 w-[310px] space-y-3 text-center">
                <div>
                  <div className="text-[16px] font-semibold tracking-[-0.02em] text-[var(--text-primary)] truncate">
                    {currentTrack.name}
                  </div>
                  <div className="text-[13px] text-[var(--text-secondary)] truncate">
                    <ArtistLinks
                      artistsText={currentTrack.artists}
                      artistItems={currentTrack.artistItems}
                      fallbackArtistId={currentTrack.artistId}
                      onSelectArtist={onSelectArtist}
                    />
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

          {/* Right Panel: StandBy Desk Clock / Controls / Live Synced Lyrics / Queue */}
          <div className="w-full max-w-[480px] flex flex-col min-h-0">
            {deskMode ? (
              <div className="anim-stagger-1 flex flex-col items-center lg:items-start text-center lg:text-left space-y-6">
                {/* Large Apple StandBy Clock */}
                <div className="space-y-1">
                  <div className="text-[76px] sm:text-[96px] font-semibold tracking-[-0.055em] leading-[0.95] tabular-nums text-[var(--text-primary)] select-none">
                    {nowDate.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </div>
                  <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                    {nowDate.toLocaleDateString("es", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </p>
                </div>

                {/* Minimal track & live synced lyric line */}
                <div className="space-y-1.5 max-w-full">
                  <div className="text-[20px] font-semibold tracking-[-0.025em] text-[var(--text-primary)] truncate">
                    {currentTrack.name}
                  </div>
                  <div className="text-[14px] text-[var(--text-secondary)] truncate">
                    {currentTrack.artists}
                  </div>
                  {lyrics?.synced &&
                    activeLyricIndex >= 0 &&
                    lyrics.synced[activeLyricIndex]?.text &&
                    lyrics.synced[activeLyricIndex].text !== "···" && (
                      <p
                        key={activeLyricIndex}
                        className="anim-stagger-1 pt-2 text-[15px] italic text-[var(--text-primary)]/80 leading-relaxed line-clamp-2"
                      >
                        “{lyrics.synced[activeLyricIndex].text}”
                      </p>
                    )}
                </div>

                {/* Hairline ambient progress */}
                <div className="w-full max-w-[340px] h-[2px] rounded-full bg-[var(--slider-track)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--text-primary)]/75 transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                {/* Discreet controls that wake on mouse move */}
                <div
                  className={`chrome-no-select flex items-center gap-4 pt-1 transition-opacity duration-500 ease-apple ${
                    deskChromeVisible ? "opacity-100" : "opacity-0 pointer-events-none"
                  }`}
                >
                  <button
                    type="button"
                    onClick={handlePrevClick}
                    aria-label="Anterior"
                    className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                  >
                    <SkipBack size={17} strokeWidth={1.6} />
                  </button>
                  <button
                    type="button"
                    onClick={handlePlayClick}
                    aria-label={isPlaying ? "Pausar" : "Reproducir"}
                    className="w-11 h-11 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] flex items-center justify-center transition-transform active:scale-90 cursor-pointer"
                  >
                    {isPlaying ? (
                      <Pause size={17} strokeWidth={1.8} fill="currentColor" />
                    ) : (
                      <Play size={17} strokeWidth={1.8} fill="currentColor" className="translate-x-[1px]" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleNextClick}
                    aria-label="Siguiente"
                    className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                  >
                    <SkipForward size={17} strokeWidth={1.6} />
                  </button>
                </div>
              </div>
            ) : panelMode === "lyrics" ? (
              <div className="anim-stagger-1 flex flex-col">
                {/* Discreet Lyrics Calibration & Share Verse Toolbar */}
                {(lyrics?.synced || lyrics?.plain) && !lyrics.instrumental && (
                  <div className="chrome-no-select mb-2 flex items-center justify-between gap-2 px-1">
                    {lyrics.synced ? (
                      <div
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--bg-elevated)]/80 border border-[var(--border-hairline)] text-[11px] text-[var(--text-secondary)]"
                        title="Ajusta el desfase de las letras para esta canción"
                      >
                        <button
                          type="button"
                          onClick={() => handleAdjustLyricOffset(-250)}
                          aria-label="Retrasar letra 0.25s"
                          className="w-5 h-5 rounded-full hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] flex items-center justify-center cursor-pointer"
                        >
                          <Minus size={11} strokeWidth={1.7} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAdjustLyricOffset(0)}
                          title="Restablecer desfase a 0.0s"
                          className="px-1.5 font-mono tabular-nums hover:text-[var(--text-primary)] cursor-pointer"
                        >
                          {lyricOffsetMs === 0
                            ? "Sincronía 0.0s"
                            : `${lyricOffsetMs > 0 ? "+" : ""}${(lyricOffsetMs / 1000).toFixed(2)}s`}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAdjustLyricOffset(250)}
                          aria-label="Adelantar letra 0.25s"
                          className="w-5 h-5 rounded-full hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] flex items-center justify-center cursor-pointer"
                        >
                          <Plus size={11} strokeWidth={1.7} />
                        </button>
                      </div>
                    ) : (
                      <span />
                    )}

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setLyricSearchOpen((v) => !v);
                          if (lyricSearchOpen) setLyricSearchQuery("");
                        }}
                        title="Buscar frase dentro de la letra"
                        aria-label="Buscar dentro de la letra"
                        className={`w-7 h-7 rounded-full border flex items-center justify-center transition-colors cursor-pointer ${
                          lyricSearchOpen
                            ? "bg-[var(--bg-active)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                            : "bg-[var(--bg-elevated)]/80 border-[var(--border-hairline)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        <Search size={11.5} strokeWidth={1.7} />
                      </button>

                      <button
                        type="button"
                        disabled={isTranslating}
                        onClick={() => void handleToggleTranslation()}
                        title={
                          showTranslation
                            ? "Ocultar traducción al español"
                            : "Traducir letra al español"
                        }
                        className={`h-7 px-2.5 rounded-full text-[11.5px] font-medium inline-flex items-center gap-1 border transition-colors cursor-pointer disabled:opacity-50 ${
                          showTranslation
                            ? "bg-[var(--solid-bg)] border-transparent text-[var(--solid-fg)]"
                            : "bg-[var(--bg-elevated)]/80 border-[var(--border-hairline)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        {isTranslating ? (
                          <Loader2 size={11.5} className="animate-spin" />
                        ) : (
                          <Languages size={11.5} strokeWidth={1.6} />
                        )}
                        <span className="hidden sm:inline">Traducir</span>
                      </button>

                      {isSelectingVerses && selectedVerseIndices.length > 0 && (
                        <button
                          type="button"
                          disabled={shareStatus === "rendering"}
                          onClick={() => void handleExportLyricCard()}
                          className="h-7 px-3 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                        >
                          {shareStatus === "copied" ? (
                            <>
                              <Check size={12} strokeWidth={1.8} />
                              Tarjeta copiada
                            </>
                          ) : shareStatus === "downloaded" ? (
                            <>
                              <Check size={12} strokeWidth={1.8} />
                              PNG guardado
                            </>
                          ) : shareStatus === "rendering" ? (
                            <>
                              <Loader2 size={12} strokeWidth={1.6} className="animate-spin" />
                              Creando...
                            </>
                          ) : (
                            <>
                              <Share2 size={11.5} strokeWidth={1.7} />
                              Copiar tarjeta ({selectedVerseIndices.length})
                            </>
                          )}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setIsSelectingVerses((v) => !v);
                          setSelectedVerseIndices([]);
                        }}
                        className={`h-7 px-3 rounded-full text-[11.5px] font-medium inline-flex items-center gap-1.5 border transition-colors cursor-pointer ${
                          isSelectingVerses
                            ? "bg-[var(--bg-active)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                            : "bg-[var(--bg-elevated)]/80 border-[var(--border-hairline)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        <Share2 size={11.5} strokeWidth={1.6} />
                        {isSelectingVerses ? "Cancelar" : "Compartir verso"}
                      </button>
                    </div>
                  </div>
                )}

                {lyricSearchOpen && (
                  <div className="anim-stagger-1 mb-2 px-1 flex items-center gap-1.5">
                    <div className="relative flex-1 flex items-center">
                      <Search
                        size={12}
                        strokeWidth={1.7}
                        className="pointer-events-none absolute left-2.5 text-[var(--text-tertiary)]"
                      />
                      <input
                        type="text"
                        autoFocus
                        value={lyricSearchQuery}
                        onChange={(e) => setLyricSearchQuery(e.target.value)}
                        placeholder="Buscar palabra o frase en la letra (clic para saltar)..."
                        className="w-full h-8 pl-8 pr-7 rounded-full text-[12px] bg-[var(--bg-elevated)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--text-primary)]"
                      />
                      {lyricSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setLyricSearchQuery("")}
                          aria-label="Limpiar búsqueda"
                          className="absolute right-2 w-5 h-5 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
                        >
                          <X size={11} strokeWidth={1.7} />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {isSelectingVerses && (
                  <p className="px-2 pb-1 text-[11px] text-[var(--text-tertiary)]">
                    Selecciona de 1 a 4 versos para generar tu tarjeta visual.
                  </p>
                )}

                <div
                  className="h-[400px] sm:h-[450px] overflow-y-auto px-2 py-20 space-y-4"
                  style={{
                    maskImage:
                      "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)",
                    WebkitMaskImage:
                      "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)",
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
                      const q = lyricSearchQuery.trim().toLowerCase();
                      const tr = showTranslation ? translatedLines?.[i] : undefined;
                      if (
                        q &&
                        !line.text.toLowerCase().includes(q) &&
                        !(tr && tr.toLowerCase().includes(q))
                      ) {
                        return null;
                      }
                      const isActive = i === activeLyricIndex;
                      const isPast = i < activeLyricIndex;
                      const isPicked = selectedVerseIndices.includes(i);
                      return (
                        <button
                          key={`${line.timeMs}-${i}`}
                          ref={isActive && !isSelectingVerses && !q ? activeLyricRef : null}
                          type="button"
                          onClick={() => {
                            if (isSelectingVerses) {
                              toggleVerseIndex(i);
                            } else {
                              onSeek(Math.max(0, line.timeMs - lyricOffsetMs));
                            }
                          }}
                          className={`block w-full text-left font-semibold tracking-[-0.025em] leading-[1.28] transition-[opacity,transform,color,background-color] duration-300 ease-apple cursor-pointer rounded-xl ${
                            isSelectingVerses
                              ? isPicked
                                ? "px-3 py-2 bg-[var(--solid-bg)] text-[var(--solid-fg)] text-[20px] sm:text-[22px] opacity-100 scale-[1.01]"
                                : "px-3 py-1.5 text-[18px] sm:text-[20px] text-[var(--text-secondary)] opacity-70 hover:opacity-100 hover:bg-[var(--bg-hover)]"
                              : q
                                ? "px-3 py-2 bg-[var(--bg-elevated)]/80 border border-[var(--border-hairline)] text-[19px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                                : isActive
                                  ? "text-[23px] sm:text-[26px] text-[var(--text-primary)] opacity-100 scale-[1.01] origin-left"
                                  : isPast
                                    ? "text-[19px] sm:text-[21px] text-[var(--text-secondary)] opacity-30 hover:opacity-75"
                                    : "text-[19px] sm:text-[21px] text-[var(--text-secondary)] opacity-42 hover:opacity-80"
                          }`}
                        >
                          <span className="block">{line.text}</span>
                          {tr && (
                            <span className="block mt-0.5 text-[13.5px] sm:text-[14.5px] font-normal tracking-normal opacity-70">
                              {tr}
                            </span>
                          )}
                        </button>
                      );
                    })
                  ) : lyrics?.plain ? (
                    lyrics.plain.map((line, i) => {
                      const q = lyricSearchQuery.trim().toLowerCase();
                      const tr = showTranslation ? translatedLines?.[i] : undefined;
                      if (
                        q &&
                        !line.toLowerCase().includes(q) &&
                        !(tr && tr.toLowerCase().includes(q))
                      ) {
                        return null;
                      }
                      const isPicked = selectedVerseIndices.includes(i);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            if (isSelectingVerses) toggleVerseIndex(i);
                          }}
                          className={`block w-full text-left font-medium tracking-[-0.02em] leading-relaxed transition-all rounded-xl ${
                            isSelectingVerses
                              ? isPicked
                                ? "px-3 py-2 bg-[var(--solid-bg)] text-[var(--solid-fg)] text-[19px] cursor-pointer"
                                : "px-3 py-1.5 text-[18px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                              : "text-[19px] text-[var(--text-primary)]/85 cursor-default"
                          }`}
                        >
                          <span className="block">{line}</span>
                          {tr && (
                            <span className="block mt-0.5 text-[13.5px] font-normal opacity-65">
                              {tr}
                            </span>
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center gap-2">
                      <Mic2 size={24} strokeWidth={1.4} className="text-[var(--text-tertiary)]" />
                      <p className="text-[14px] text-[var(--text-secondary)]">
                        Letras no disponibles para esta canción
                      </p>
                    </div>
                  )}
                </div>
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
                    <div
                      key={`${t.uri}-${i}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onPlayQueueTrack(t.uri)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onPlayQueueTrack(t.uri);
                        }
                      }}
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
                          <ArtistLinks
                            artistsText={t.artists}
                            artistItems={t.artistItems}
                            fallbackArtistId={t.artistId}
                            onSelectArtist={onSelectArtist}
                          />
                        </div>
                      </div>
                      <span className="text-[11.5px] tabular-nums text-[var(--text-tertiary)]">
                        {formatDuration(t.durationMs)}
                      </span>
                    </div>
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
                      <ArtistLinks
                        artistsText={currentTrack.artists}
                        artistItems={currentTrack.artistItems}
                        fallbackArtistId={currentTrack.artistId}
                        onSelectArtist={onSelectArtist}
                      />
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

                {/* Progress Bar + Precision A-B Loop Range + Bookmark Dots */}
                <div className="anim-stagger-2 chrome-no-select space-y-2.5">
                  <div className="apple-slider-wrap relative">
                    <div className="apple-slider-track relative overflow-visible">
                      {/* Highlighted A-B Loop segment */}
                      {loopA !== null && durationMs > 0 && (
                        <>
                          {loopB !== null && loopB > loopA && (
                            <div
                              aria-hidden="true"
                              className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-[6px] rounded-full bg-[var(--text-primary)]/35"
                              style={{
                                left: `${Math.min(100, (loopA / durationMs) * 100)}%`,
                                width: `${Math.min(100, ((loopB - loopA) / durationMs) * 100)}%`,
                              }}
                            />
                          )}
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[3px] h-3 rounded-full bg-[var(--text-primary)]"
                            style={{ left: `${Math.min(100, (loopA / durationMs) * 100)}%` }}
                          />
                          {loopB !== null && (
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[3px] h-3 rounded-full bg-[var(--text-primary)]"
                              style={{ left: `${Math.min(100, (loopB / durationMs) * 100)}%` }}
                            />
                          )}
                        </>
                      )}

                      <div
                        className="apple-slider-fill"
                        style={{ width: `${progressPercent}%` }}
                      />

                      {/* Saved Timestamp Bookmark Dots */}
                      {durationMs > 0 &&
                        bookmarks.map((bm) => (
                          <span
                            key={bm.id}
                            aria-hidden="true"
                            className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[var(--text-primary)] ring-2 ring-[var(--bg-primary)]"
                            style={{ left: `${Math.min(100, (bm.timeMs / durationMs) * 100)}%` }}
                          />
                        ))}
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
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleCycleABLoop}
                        title={
                          loopA === null
                            ? "Marcar punto A para bucle"
                            : loopB === null
                              ? "Marcar punto B para repetir sección"
                              : "Desactivar bucle A-B"
                        }
                        className={`h-6 px-2 rounded-full text-[10.5px] font-medium border inline-flex items-center gap-1 transition-all cursor-pointer ${
                          loopA !== null
                            ? "bg-[var(--bg-active)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                            : "bg-transparent border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        <Repeat2 size={11} strokeWidth={1.7} />
                        {loopA === null
                          ? "A–B"
                          : loopB === null
                            ? `A ${formatDuration(loopA)} · Marca B`
                            : `${formatDuration(loopA)}–${formatDuration(loopB)}`}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setBookmarkTimeMs(Math.round(effectivePosition));
                          setAddingBookmark((v) => !v);
                        }}
                        title="Guardar momento exacto de esta canción"
                        className={`h-6 px-2 rounded-full text-[10.5px] font-medium border inline-flex items-center gap-1 transition-all cursor-pointer ${
                          addingBookmark || bookmarks.length > 0
                            ? "bg-[var(--bg-elevated)]/80 border-[var(--border-hairline)] text-[var(--text-primary)]"
                            : "bg-transparent border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        <BookmarkPlus size={11} strokeWidth={1.7} />
                        Momento
                      </button>
                    </div>
                    <span>-{formatDuration(Math.max(0, durationMs - effectivePosition))}</span>
                  </div>

                  {/* Inline Bookmark Composer */}
                  {addingBookmark && (
                    <form
                      onSubmit={handleSaveBookmark}
                      className="anim-stagger-1 flex items-center gap-1.5 pt-0.5"
                    >
                      <span className="px-2 h-7 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-hairline)] text-[11px] font-mono tabular-nums text-[var(--text-secondary)] flex items-center shrink-0">
                        {formatDuration(bookmarkTimeMs)}
                      </span>
                      <input
                        type="text"
                        autoFocus
                        value={bookmarkDraft}
                        onChange={(e) => setBookmarkDraft(e.target.value)}
                        placeholder="Nota breve (ej. Solo de guitarra, Drop...)"
                        className="flex-1 h-7 px-2.5 rounded-lg text-[11.5px] bg-[var(--bg-elevated)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--text-primary)]"
                      />
                      <button
                        type="submit"
                        className="h-7 px-2.5 rounded-lg bg-[var(--solid-bg)] text-[var(--solid-fg)] text-[11px] font-medium cursor-pointer shrink-0"
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddingBookmark(false)}
                        aria-label="Cancelar"
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
                      >
                        <X size={12} strokeWidth={1.7} />
                      </button>
                    </form>
                  )}

                  {/* Saved Bookmarks Chips */}
                  {bookmarks.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {bookmarks.map((bm) => (
                        <div
                          key={bm.id}
                          className="group inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-[var(--bg-elevated)]/85 border border-[var(--border-hairline)] hover:border-[var(--border-subtle)] text-[11px] transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => onSeek(bm.timeMs)}
                            title={`Saltar a ${formatDuration(bm.timeMs)}`}
                            className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                          >
                            <Bookmark size={10} strokeWidth={1.7} />
                            <span className="font-mono tabular-nums text-[var(--text-primary)]">
                              {formatDuration(bm.timeMs)}
                            </span>
                            <span className="max-w-[130px] truncate">{bm.note}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteBookmark(bm.id)}
                            aria-label="Eliminar momento"
                            className="w-4 h-4 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                          >
                            <X size={10} strokeWidth={1.8} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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
