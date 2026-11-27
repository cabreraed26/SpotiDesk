import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronLeft,
  ChevronRight,
  FastForward,
  Loader2,
  Rewind,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useSpotifyAuth } from "./hooks/useSpotifyAuth";
import { useSpotifyPlayer, type SoftGlideMode } from "./hooks/useSpotifyPlayer";
import { useSleepTimer } from "./hooks/useSleepTimer";
import { usePomodoro } from "./hooks/usePomodoro";
import { useTrackpadSwipeNav } from "./hooks/useTrackpadSwipeNav";
import { useTheme } from "./hooks/useTheme";
import { useAmbientColor } from "./hooks/useAmbientColor";
import {
  ambientAudio,
  DEFAULT_AMBIENT_LEVELS,
  type AmbientChannelId,
  type AmbientLevels,
} from "./lib/ambientAudio";
import { TitleBar } from "./components/TitleBar";
import { LoginScreen } from "./components/LoginScreen";
import { Sidebar, type AppView } from "./components/Sidebar";
import { HomeView } from "./components/HomeView";
import { SearchView } from "./components/SearchView";
import { CollectionView } from "./components/CollectionView";
import { LibraryView } from "./components/LibraryView";
import { ArtistView } from "./components/ArtistView";
import { PlayerBar } from "./components/PlayerBar";
import type { TrackTransitionDir } from "./components/NowPlayingStage";
import { TrackContextMenu, type ContextMenuState } from "./components/TrackContextMenu";
import {
  TrackDragOverlay,
  registerTrackDropHandler,
} from "./components/TrackDragOverlay";
import { Toast, type ToastMessage } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SpotifyApiError } from "./lib/spotifyApi";
import { viewCache } from "./lib/viewCache";
import {
  loadRecentTracks,
  recordRecentTrack,
  type RecentTrackEntry,
} from "./lib/recentHistory";
import { recordListeningEvent } from "./lib/listeningStats";
import { getLyricOffsetMs } from "./lib/lyricSync";
import {
  loadShortcutsConfig,
  matchesShortcut,
  saveShortcutsConfig,
  type AppShortcutsConfig,
} from "./lib/shortcutsConfig";
import type {
  SpotlightActionPayload,
  SpotlightStatePayload,
} from "./components/SpotlightWindow";
import {
  assignPlaylistToFolderInOrg,
  createFolderInOrg,
  deleteFolderInOrg,
  loadSidebarOrg,
  toggleFolderCollapsedInOrg,
  togglePinInOrg,
  type SidebarOrganization,
} from "./lib/sidebarOrganization";
import { formatDuration } from "./lib/format";
import type {
  SpotifyAlbumSimple,
  SpotifyArtist,
  SpotifyPlaylist,
  UnifiedTrack,
} from "./types/spotify";
import type { NotchPosition, NotchStatePayload } from "./components/DesktopNotch";

// Code-split secondary surfaces (silently preloaded in idle time so opening them is 0ms!)
const loadNowPlayingStage = () =>
  import("./components/NowPlayingStage").then((m) => ({ default: m.NowPlayingStage }));
const loadQueueDrawer = () =>
  import("./components/QueueDrawer").then((m) => ({ default: m.QueueDrawer }));
const loadSettingsModal = () =>
  import("./components/SettingsModal").then((m) => ({ default: m.SettingsModal }));
const loadCreatePlaylistModal = () =>
  import("./components/CreatePlaylistModal").then((m) => ({ default: m.CreatePlaylistModal }));
const loadCommandPalette = () =>
  import("./components/CommandPalette").then((m) => ({ default: m.CommandPalette }));
const loadStatsModal = () =>
  import("./components/StatsModal").then((m) => ({ default: m.StatsModal }));
const loadMiniPlayer = () =>
  import("./components/MiniPlayer").then((m) => ({ default: m.MiniPlayer }));
const loadBlendSessionModal = () =>
  import("./components/BlendSessionModal").then((m) => ({ default: m.BlendSessionModal }));
const loadHistoryModal = () =>
  import("./components/HistoryModal").then((m) => ({ default: m.HistoryModal }));

const NowPlayingStage = lazy(loadNowPlayingStage);
const QueueDrawer = lazy(loadQueueDrawer);
const SettingsModal = lazy(loadSettingsModal);
const CreatePlaylistModal = lazy(loadCreatePlaylistModal);
const CommandPalette = lazy(loadCommandPalette);
const StatsModal = lazy(loadStatsModal);
const MiniPlayer = lazy(loadMiniPlayer);
const BlendSessionModal = lazy(loadBlendSessionModal);
const HistoryModal = lazy(loadHistoryModal);

type NavDir = "forward" | "back" | "tab" | "search-open" | "search-close";

function getViewKey(view: AppView): string {
  switch (view.kind) {
    case "artist":
    case "playlist":
    case "album":
      return `${view.kind}:${view.id}`;
    default:
      return view.kind;
  }
}

const CLOSE_TO_TRAY_KEY = "spotidesk.close_to_tray";
const NOTCH_POSITION_KEY = "spotidesk.notch_position";
const NOTCH_LYRICS_KEY = "spotidesk.notch_lyrics";
const NOTCH_AUTO_PEEK_KEY = "spotidesk.notch_auto_peek";
const AUTOPLAY_ENABLED_KEY = "spotidesk.autoplay_enabled";
const SOFT_GLIDE_KEY = "spotidesk.soft_glide";

function readInitialNotchPosition(): NotchPosition {
  try {
    const saved = localStorage.getItem(NOTCH_POSITION_KEY);
    if (saved === "top" || saved === "left" || saved === "right" || saved === "bubble") {
      return saved;
    }
  } catch {
    // Ignore
  }
  return "top";
}

export function App() {
  const { theme, toggleTheme, ambientEnabled, toggleAmbient } = useTheme();
  const auth = useSpotifyAuth();

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback(
    (text: string, tone: "default" | "warning" = "default", durationMs = 2600) => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      setToast({ id: Date.now(), text, tone });
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
      }, durationMs);
    },
    []
  );

  const [autoplayEnabled, setAutoplayEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(AUTOPLAY_ENABLED_KEY);
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });

  const [softGlideMode, setSoftGlideMode] = useState<SoftGlideMode>(() => {
    try {
      const saved = localStorage.getItem(SOFT_GLIDE_KEY);
      if (saved === "off" || saved === "subtle" || saved === "cinematic") return saved;
    } catch {
      // Ignore
    }
    return "subtle";
  });

  const handleAutoplayTriggered = useCallback(() => {
    showToast("Reproducción automática: continuando con música similar");
  }, [showToast]);

  const player = useSpotifyPlayer({
    isAuthenticated: auth.isAuthenticated,
    getFreshToken: auth.getFreshToken,
    api: auth.api,
    autoplayEnabled,
    softGlideMode,
    onAutoplayTriggered: handleAutoplayTriggered,
  });

  const [navState, setNavState] = useState<{ stack: AppView[]; index: number }>({
    stack: [{ kind: "home" }],
    index: 0,
  });
  const navRef = useRef(navState);
  navRef.current = navState;
  const mainRef = useRef<HTMLElement | null>(null);
  const activeView = navState.stack[navState.index] ?? { kind: "home" };
  const canGoBack = navState.index > 0;
  const canGoForward = navState.index < navState.stack.length - 1;
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [recentTracks, setRecentTracks] = useState<RecentTrackEntry[]>(loadRecentTracks);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [isStageOpen, setIsStageOpen] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isBlendOpen, setIsBlendOpen] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const zenStartedAmbientRef = useRef(false);
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState(false);
  const [reorderedEvent, setReorderedEvent] = useState<{
    playlistId: string;
    fromIndex: number;
    toIndex: number;
    seq: number;
  } | null>(null);
  const [removedTrackUri, setRemovedTrackUri] = useState<{
    playlistId: string;
    uri: string;
    seq: number;
  } | null>(null);
  const [shortcuts, setShortcuts] = useState<AppShortcutsConfig>(loadShortcutsConfig);
  const [sidebarOrg, setSidebarOrg] = useState<SidebarOrganization>(loadSidebarOrg);
  const [hudPill, setHudPill] = useState<{
    kind: "volume" | "mute" | "seek-back" | "seek-fwd";
    label: string;
    percent?: number;
  } | null>(null);
  const hudTimerRef = useRef<number | null>(null);
  const showHudPill = useCallback(
    (pill: {
      kind: "volume" | "mute" | "seek-back" | "seek-fwd";
      label: string;
      percent?: number;
    }) => {
      if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
      setHudPill(pill);
      hudTimerRef.current = window.setTimeout(() => setHudPill(null), 1050);
    },
    []
  );

  const [notchLyricsEnabled, setNotchLyricsEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(NOTCH_LYRICS_KEY);
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });
  const [notchAutoPeek, setNotchAutoPeek] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(NOTCH_AUTO_PEEK_KEY);
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });
  const [trackDir, setTrackDir] = useState<TrackTransitionDir>("next");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isCurrentLiked, setIsCurrentLiked] = useState(false);
  const [notchVisible, setNotchVisible] = useState(true);
  const [notchPosition, setNotchPositionState] = useState<NotchPosition>(readInitialNotchPosition);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const isMac = /mac/i.test(navigator.platform || navigator.userAgent);
  const [closeToTray, setCloseToTray] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(CLOSE_TO_TRAY_KEY);
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });

  const ambientRgb = useAmbientColor(
    player.currentTrack?.albumImage,
    ambientEnabled && auth.isAuthenticated
  );

  // Procedural Ambient Sound Mixer state (Rain, Vinyl Crackle, Brown Noise, Fireplace)
  const [ambientLevels, setAmbientLevels] = useState<AmbientLevels>(DEFAULT_AMBIENT_LEVELS);

  const handleSetAmbientLevel = useCallback((id: AmbientChannelId, level: number) => {
    const clamped = Math.max(0, Math.min(1, level));
    ambientAudio.setChannelLevel(id, clamped);
    setAmbientLevels((prev) => ({ ...prev, [id]: clamped }));
  }, []);

  const handleStopAllAmbient = useCallback(() => {
    ambientAudio.stopAll(400);
    setAmbientLevels({ ...DEFAULT_AMBIENT_LEVELS });
  }, []);

  const handleToggleZenMode = useCallback(() => {
    setZenMode((prev) => {
      const next = !prev;
      if (next) {
        setIsQueueOpen(false);
        const anyAmbientPlaying = Object.values(ambientLevels).some((v) => v > 0.01);
        if (!anyAmbientPlaying) {
          zenStartedAmbientRef.current = true;
          ambientAudio.setChannelLevel("rain", 0.24);
          setAmbientLevels((cur) => ({ ...cur, rain: 0.24 }));
        } else {
          zenStartedAmbientRef.current = false;
        }
        showToast("Modo Enfoque activo · Vista limpia + lluvia suave", "default", 3200);
      } else {
        if (zenStartedAmbientRef.current) {
          zenStartedAmbientRef.current = false;
          ambientAudio.stopAll(500);
          setAmbientLevels({ ...DEFAULT_AMBIENT_LEVELS });
        }
        showToast("Modo Enfoque desactivado", "default", 2200);
      }
      return next;
    });
  }, [ambientLevels, showToast]);

  // Sleep Timer & Musical Pomodoro with smooth 2.2s audio fade-out before pausing
  const isPlayingRef = useRef(player.isPlaying);
  isPlayingRef.current = player.isPlaying;
  const togglePlayRef = useRef(player.togglePlay);
  togglePlayRef.current = player.togglePlay;
  const volumeRef = useRef(player.volume);
  volumeRef.current = player.volume;
  const setVolumeRef = useRef(player.setVolume);
  setVolumeRef.current = player.setVolume;

  const fadeOutAndPause = useCallback(
    (toastMessage: string, fadeAmbient = true) => {
      if (fadeAmbient) {
        ambientAudio.stopAll(2000);
        setAmbientLevels({ ...DEFAULT_AMBIENT_LEVELS });
      }
      if (!isPlayingRef.current) {
        showToast(toastMessage, "default", 3500);
        return;
      }

      const startVol = volumeRef.current;
      const steps = 11;
      let step = 0;
      showToast(`${toastMessage} · Desvaneciendo volumen...`, "default", 3800);

      const fadeInterval = window.setInterval(() => {
        step += 1;
        const progress = step / steps;
        const eased = 1 - progress * progress;
        void setVolumeRef.current(Math.max(0, startVol * eased));
        if (step >= steps) {
          window.clearInterval(fadeInterval);
          if (isPlayingRef.current) {
            void togglePlayRef.current();
          }
          // Restore previous volume quietly after pausing so next Play isn't muted
          window.setTimeout(() => {
            void setVolumeRef.current(startVol);
          }, 450);
        }
      }, 200);
    },
    [showToast]
  );

  const sleepTimer = useSleepTimer({
    currentTrackUri: player.currentTrack?.uri,
    isPlaying: player.isPlaying,
    onExpire: useCallback(() => {
      fadeOutAndPause("Temporizador completado", true);
    }, [fadeOutAndPause]),
  });

  const pomodoro = usePomodoro({
    onFocusComplete: useCallback(() => {
      fadeOutAndPause("Bloque de enfoque completado · Tiempo de descanso", true);
    }, [fadeOutAndPause]),
    onBreakComplete: useCallback(() => {
      showToast("Descanso terminado · Listo para otro bloque de enfoque", "default", 4500);
    }, [showToast]),
  });

  // Silently warm lazy-loaded UI chunks during idle time so opening modals/stage is 0ms
  useEffect(() => {
    if (!auth.isAuthenticated) return;
    const timer = window.setTimeout(() => {
      void loadNowPlayingStage();
      void loadQueueDrawer();
      void loadSettingsModal();
      void loadCommandPalette();
      void loadStatsModal();
      void loadCreatePlaylistModal();
      void loadMiniPlayer();
      void loadBlendSessionModal();
      void loadHistoryModal();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [auth.isAuthenticated]);

  const handleToggleMiniPlayer = useCallback(async () => {
    const next = !isMiniMode;
    try {
      await invoke<boolean>("set_mini_player_mode", { enabled: next });
      setIsStageOpen(false);
      setIsQueueOpen(false);
      setIsSettingsOpen(false);
      setIsPaletteOpen(false);
      setIsStatsOpen(false);
      setIsMiniMode(next);
    } catch {
      showToast("No se pudo cambiar al modo Mini-Reproductor.", "warning");
    }
  }, [isMiniMode, showToast]);

  // Persist Notch lyrics & Auto-Peek preferences
  useEffect(() => {
    try {
      localStorage.setItem(NOTCH_LYRICS_KEY, String(notchLyricsEnabled));
    } catch {
      // Ignore
    }
  }, [notchLyricsEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(NOTCH_AUTO_PEEK_KEY, String(notchAutoPeek));
    } catch {
      // Ignore
    }
  }, [notchAutoPeek]);

  const handleTogglePinPlaylist = useCallback(
    (playlistId: string) => {
      setSidebarOrg((prev) => {
        const wasPinned = prev.pinnedIds.includes(playlistId);
        if (!wasPinned && prev.pinnedIds.length >= 5) {
          showToast("Máximo 5 playlists fijadas (desfija una primero)", "warning");
          return prev;
        }
        const next = togglePinInOrg(prev, playlistId);
        showToast(wasPinned ? "Playlist desfijada" : "Playlist fijada arriba");
        return next;
      });
    },
    [showToast]
  );

  const handleCreateFolder = useCallback(
    (name: string) => {
      setSidebarOrg((prev) => createFolderInOrg(prev, name));
      showToast(`Carpeta "${name}" creada`);
    },
    [showToast]
  );

  const handleDeleteFolder = useCallback(
    (folderId: string) => {
      setSidebarOrg((prev) => deleteFolderInOrg(prev, folderId));
      showToast("Carpeta eliminada");
    },
    [showToast]
  );

  const handleToggleFolderCollapsed = useCallback((folderId: string) => {
    setSidebarOrg((prev) => toggleFolderCollapsedInOrg(prev, folderId));
  }, []);

  const handleAssignPlaylistToFolder = useCallback(
    (playlistId: string, folderId: string | null) => {
      setSidebarOrg((prev) => assignPlaylistToFolderInOrg(prev, playlistId, folderId));
    },
    []
  );

  const handleBackupRestored = useCallback(() => {
    setSidebarOrg(loadSidebarOrg());
    const reloadedShortcuts = loadShortcutsConfig();
    setShortcuts(reloadedShortcuts);
    setNotchPositionState(readInitialNotchPosition());
    try {
      const nl = localStorage.getItem(NOTCH_LYRICS_KEY);
      if (nl !== null) setNotchLyricsEnabled(nl === "true");
      const np = localStorage.getItem(NOTCH_AUTO_PEEK_KEY);
      if (np !== null) setNotchAutoPeek(np === "true");
      const ap = localStorage.getItem(AUTOPLAY_ENABLED_KEY);
      if (ap !== null) setAutoplayEnabled(ap === "true");
      const sg = localStorage.getItem(SOFT_GLIDE_KEY);
      if (sg === "off" || sg === "subtle" || sg === "cinematic") setSoftGlideMode(sg);
      const ct = localStorage.getItem(CLOSE_TO_TRAY_KEY);
      if (ct !== null) setCloseToTray(ct === "true");
    } catch {
      // Ignore
    }
    showToast("Respaldo restaurado y aplicado", "default", 3200);
  }, [showToast]);

  // Keep native OS Tray / Menu Bar Now Playing label & Like status in sync
  useEffect(() => {
    void invoke("update_tray_now_playing", {
      title: player.currentTrack?.name ?? null,
      artist: player.currentTrack?.artists ?? null,
      isPlaying: player.isPlaying,
      isLiked: isCurrentLiked,
    }).catch(() => {});
  }, [
    player.currentTrack?.name,
    player.currentTrack?.artists,
    player.isPlaying,
    isCurrentLiked,
  ]);

  const handleChangeShortcuts = useCallback((next: AppShortcutsConfig) => {
    setShortcuts(next);
    saveShortcutsConfig(next);
  }, []);

  // Sync persisted Global Spotlight shortcut to Rust on boot
  useEffect(() => {
    if (!shortcuts.globalSpotlight) return;
    void invoke("set_spotlight_shortcut", {
      shortcut: shortcuts.globalSpotlight,
    }).catch(() => {});
  }, [shortcuts.globalSpotlight]);

  // Record locally played tracks for HomeView "Continuar escuchando" & Weekly Stats
  useEffect(() => {
    if (!auth.isAuthenticated || !player.currentTrack?.uri) return;
    setRecentTracks(recordRecentTrack(player.currentTrack));
    recordListeningEvent(player.currentTrack);
  }, [auth.isAuthenticated, player.currentTrack]);

  // Silent background check for newer GitHub releases once on boot
  useEffect(() => {
    if (!auth.isAuthenticated) return;
    const timer = window.setTimeout(() => {
      void invoke<{ hasUpdate: boolean; latestVersion: string }>("check_for_updates")
        .then((res) => {
          if (res?.hasUpdate) {
            showToast(
              `Nueva versión v${res.latestVersion} disponible en Ajustes → Actualizaciones`,
              "default",
              5000
            );
          }
        })
        .catch(() => {});
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [auth.isAuthenticated, showToast]);

  // Playlists the user can actually modify (owned or collaborative)
  const writablePlaylists = useMemo(() => {
    const userId = auth.user?.id;
    if (!userId) return [];
    return playlists.filter(
      (p) => p.owner?.id === userId || Boolean(p.collaborative)
    );
  }, [auth.user?.id, playlists]);

  // Sync close-to-tray preference with Rust backend
  useEffect(() => {
    void invoke("set_close_to_tray", { enabled: closeToTray }).catch(() => {});
    try {
      localStorage.setItem(CLOSE_TO_TRAY_KEY, String(closeToTray));
    } catch {
      // Ignore storage errors
    }
  }, [closeToTray]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTOPLAY_ENABLED_KEY, String(autoplayEnabled));
    } catch {
      // Ignore
    }
  }, [autoplayEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(SOFT_GLIDE_KEY, softGlideMode);
    } catch {
      // Ignore
    }
  }, [softGlideMode]);

  // Smooth shared-element View Transition between PlayerBar capsule and Full-Screen Stage
  const setStageWithTransition = useCallback((open: boolean) => {
    if (open) setIsQueueOpen(false);
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> };
    };
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => {
        flushSync(() => {
          setIsStageOpen(open);
        });
      });
    } else {
      setIsStageOpen(open);
    }
  }, []);

  // Close stage automatically if track clears (e.g. logout)
  useEffect(() => {
    if (!player.currentTrack && isStageOpen) {
      setIsStageOpen(false);
    }
  }, [player.currentTrack, isStageOpen]);

  // Check liked status whenever the current playing track changes
  useEffect(() => {
    let cancelled = false;
    const track = player.currentTrack;
    if (!auth.isAuthenticated || !track?.id) {
      setIsCurrentLiked(false);
      return;
    }
    void auth.api.checkSavedTrack(track.id, track.uri).then((saved) => {
      if (!cancelled) setIsCurrentLiked(saved);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.api, auth.isAuthenticated, player.currentTrack]);

  // Track maximized / fullscreen state so rounded window corners flatten cleanly edge-to-edge
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    const syncWindowState = async () => {
      try {
        const [max, full] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
        setIsWindowMaximized(max || full);
      } catch {
        // Ignore
      }
    };

    void syncWindowState();
    void win
      .onResized(() => {
        void syncWindowState();
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, []);

  // Sync saved Notch position with Rust backend on boot & whenever changed
  useEffect(() => {
    void invoke("set_notch_position", { position: notchPosition }).catch(() => {});
    try {
      localStorage.setItem(NOTCH_POSITION_KEY, notchPosition);
    } catch {
      // Ignore storage errors
    }
  }, [notchPosition]);

  const handleChangeNotchPosition = useCallback(
    (position: NotchPosition) => {
      setNotchPositionState(position);
      const label =
        position === "left"
          ? "izquierda"
          : position === "right"
            ? "derecha"
            : position === "bubble"
              ? "burbuja (inferior derecha)"
              : "superior";
      showToast(`Posición del Notch: ${label}`);
    },
    [showToast]
  );

  // Sync Notch visibility status on mount & from tray menu
  useEffect(() => {
    void invoke<boolean>("get_notch_visible")
      .then(setNotchVisible)
      .catch(() => {});

    let unlisten: (() => void) | undefined;
    void listen<boolean>("notch-visibility-changed", (event) => {
      setNotchVisible(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const handleToggleNotch = useCallback(async () => {
    try {
      const visible = await invoke<boolean>("toggle_notch");
      setNotchVisible(visible);
      showToast(visible ? "Notch superior activado" : "Notch superior oculto");
    } catch {
      // Ignore
    }
  }, [showToast]);

  // Push real-time playback state + authoritative timestamp to the native Notch
  const lastNotchSyncRef = useRef<{ pos: number; time: number; uri?: string }>({
    pos: 0,
    time: 0,
  });

  const broadcastNotchState = useCallback(() => {
    const now = Date.now();
    lastNotchSyncRef.current = {
      pos: player.positionMs,
      time: now,
      uri: player.currentTrack?.uri,
    };
    const payload: NotchStatePayload = {
      track: player.currentTrack,
      isPlaying: player.isPlaying,
      positionMs: player.positionMs,
      durationMs: player.durationMs,
      theme,
      ambientRgb,
      isLiked: isCurrentLiked,
      notchLyricsEnabled,
      notchAutoPeek,
      lyricOffsetMs: getLyricOffsetMs(player.currentTrack?.uri),
      syncedAt: now,
      pomodoroLabel: pomodoro.label,
      pomodoroPhase: pomodoro.phase,
      volume: player.volume,
      muted: player.muted,
    };
    void invoke("send_notch_state", { payload }).catch(() => {});
  }, [
    player.currentTrack,
    player.isPlaying,
    player.positionMs,
    player.durationMs,
    player.volume,
    player.muted,
    theme,
    ambientRgb,
    isCurrentLiked,
    notchLyricsEnabled,
    notchAutoPeek,
    pomodoro.label,
    pomodoro.phase,
  ]);

  const broadcastRef = useRef(broadcastNotchState);
  broadcastRef.current = broadcastNotchState;

  useEffect(() => {
    broadcastRef.current();
  }, [
    player.currentTrack?.uri,
    player.isPlaying,
    player.durationMs,
    player.volume,
    player.muted,
    theme,
    ambientRgb,
    isCurrentLiked,
    notchLyricsEnabled,
    notchAutoPeek,
    pomodoro.label,
    pomodoro.phase,
  ]);

  // Re-sync Notch immediately whenever a seek, clock drift (>900ms), or lyric offset adjustment occurs
  useEffect(() => {
    if (!player.currentTrack) return;
    const prev = lastNotchSyncRef.current;
    const elapsed = player.isPlaying ? Math.max(0, Date.now() - prev.time) : 0;
    const expectedPos = prev.pos + elapsed;
    if (
      prev.uri !== player.currentTrack.uri ||
      Math.abs(player.positionMs - expectedPos) > 900
    ) {
      broadcastRef.current();
    }
  }, [player.positionMs, player.isPlaying, player.currentTrack]);

  useEffect(() => {
    const onOffsetChange = () => broadcastRef.current();
    window.addEventListener("spotidesk:lyric-offset-changed", onOffsetChange);
    return () => window.removeEventListener("spotidesk:lyric-offset-changed", onOffsetChange);
  }, []);

  // Fetch user's playlists once authenticated
  useEffect(() => {
    if (!auth.isAuthenticated) {
      viewCache.clear();
      ambientAudio.stopAll(250);
      setAmbientLevels({ ...DEFAULT_AMBIENT_LEVELS });
      setPlaylists([]);
      setNavState({ stack: [{ kind: "home" }], index: 0 });
      setIsStageOpen(false);
      setIsQueueOpen(false);
      return;
    }

    let cancelled = false;
    let prefetchTimer: number | undefined;
    setIsLoadingPlaylists(true);

    (async () => {
      try {
        const page = await auth.api.getUserPlaylists(50, 0);
        if (!cancelled) {
          const valid = (page?.items ?? []).filter(
            (p): p is SpotifyPlaylist => Boolean(p && p.id)
          );
          setPlaylists(valid);

          // Gently warm only "Tus Me Gusta" (1 lightweight request) after boot so we never trigger Spotify 429 rate limits
          prefetchTimer = window.setTimeout(() => {
            if (cancelled) return;
            void viewCache.prefetchLiked(auth.api);
          }, 900);
        }
      } catch (err) {
        console.warn("[SpotiDesk] Error cargando playlists:", err);
      } finally {
        if (!cancelled) setIsLoadingPlaylists(false);
      }
    })();

    return () => {
      cancelled = true;
      if (prefetchTimer) window.clearTimeout(prefetchTimer);
    };
  }, [auth.isAuthenticated, auth.api, auth.user?.id]);

  const handleNextTrack = useCallback(() => {
    setTrackDir("next");
    void player.nextTrack();
  }, [player]);

  const handlePrevTrack = useCallback(() => {
    setTrackDir("prev");
    void player.previousTrack();
  }, [player]);

  const handleAddToQueue = useCallback(
    async (track: UnifiedTrack) => {
      try {
        await auth.api.addToQueue(track.uri, player.deviceId);
        showToast(`Añadida a la cola: ${track.name}`);
        window.dispatchEvent(new CustomEvent("spotidesk:queue-updated"));
      } catch (err) {
        const msg =
          err instanceof SpotifyApiError && err.status === 404
            ? "Inicia una reproducción primero para añadir canciones a la cola."
            : err instanceof Error
              ? err.message
              : "No se pudo añadir a la cola.";
        showToast(msg, "warning");
      }
    },
    [auth.api, player.deviceId, showToast]
  );

  const handleAddTracksToQueue = useCallback(
    async (selected: UnifiedTrack[]) => {
      let added = 0;
      for (const track of selected.slice(0, 20)) {
        try {
          await auth.api.addToQueue(track.uri, player.deviceId);
          added += 1;
        } catch {
          break;
        }
      }
      if (added > 0) {
        showToast(
          `${added} ${added === 1 ? "canción añadida" : "canciones añadidas"} a la cola`
        );
        window.dispatchEvent(new CustomEvent("spotidesk:queue-updated"));
      } else {
        showToast("Inicia una reproducción primero para encolar canciones.", "warning");
      }
    },
    [auth.api, player.deviceId, showToast]
  );

  const handleStartSongRadio = useCallback(
    async (seed: UnifiedTrack) => {
      showToast(`Creando Radio de «${seed.name}»...`, "default", 2200);
      try {
        const related = await auth.api.getAutoplayTracks(seed, new Set([seed.uri]), 18);
        const uris = [seed.uri, ...related.map((t) => t.uri)];
        setTrackDir("next");
        await player.playContext({ uris, offsetPosition: 0 });
        showToast(`Radio iniciada · ${uris.length} canciones afines`, "default", 3400);
      } catch {
        showToast("No se pudo iniciar la radio ahora mismo.", "warning");
      }
    },
    [auth.api, player, showToast]
  );

  const handleAddToPlaylist = useCallback(
    async (playlist: SpotifyPlaylist, track: UnifiedTrack) => {
      // Guard against accidental duplicates using SWR playlist cache
      const cached = viewCache.getPlaylist(playlist.id);
      if (cached && cached.tracks.some((t) => t.uri === track.uri)) {
        showToast(`«${track.name}» ya está en «${playlist.name}»`, "warning", 3200);
        return;
      }

      try {
        await auth.api.addTrackToPlaylist(playlist.id, track.uri);
        viewCache.invalidatePlaylist(playlist.id);
        showToast(`Añadida a "${playlist.name}"`);
      } catch (err) {
        if (err instanceof SpotifyApiError && err.status === 403) {
          showToast(
            "Cierra sesión y vuelve a conectar para conceder permiso de editar playlists.",
            "warning"
          );
        } else {
          showToast("No se pudo añadir a la playlist.", "warning");
        }
      }
    },
    [auth.api, showToast]
  );

  const handleUpdatePlaylistDetails = useCallback(
    async (playlistId: string, name: string, description: string) => {
      try {
        await auth.api.updatePlaylistDetails(playlistId, { name, description });
        setPlaylists((prev) =>
          prev.map((p) => (p.id === playlistId ? { ...p, name, description } : p))
        );
        const existing = viewCache.getPlaylist(playlistId);
        if (existing) {
          viewCache.setPlaylist(playlistId, {
            ...existing,
            playlist: { ...existing.playlist, name, description },
          });
        }
        showToast("Playlist actualizada");
      } catch {
        showToast("No se pudo actualizar la playlist.", "warning");
      }
    },
    [auth.api, showToast]
  );

  const handleReorderPlaylistTrack = useCallback(
    async (playlistId: string, fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      // Optimistic 0ms UI reorder
      setReorderedEvent({ playlistId, fromIndex, toIndex, seq: Date.now() });
      const insertBefore = toIndex > fromIndex ? toIndex + 1 : toIndex;
      try {
        await auth.api.reorderPlaylistTrack(playlistId, fromIndex, insertBefore);
      } catch {
        viewCache.invalidatePlaylist(playlistId);
        showToast("No se pudo guardar el nuevo orden en Spotify.", "warning");
      }
    },
    [auth.api, showToast]
  );

  const handleCreatePlaylist = useCallback(
    async (params: { name: string; description: string; isPublic: boolean }) => {
      const created = await auth.api.createPlaylist({
        name: params.name,
        description: params.description,
        isPublic: params.isPublic,
        userId: auth.user?.id,
      });
      setPlaylists((prev) => [created, ...prev]);
      setNavState((prev) => {
        const nextStack = [
          ...prev.stack.slice(0, prev.index + 1),
          { kind: "playlist" as const, id: created.id, seedPlaylist: created },
        ].slice(-40);
        return { stack: nextStack, index: nextStack.length - 1 };
      });
      showToast(`Playlist "${created.name}" creada`);
    },
    [auth.api, auth.user?.id, showToast]
  );

  const handleToggleLike = useCallback(
    async (track: UnifiedTrack, currentlyLiked: boolean) => {
      try {
        if (currentlyLiked) {
          await auth.api.removeSavedTrack(track.id, track.uri);
          if (player.currentTrack?.uri === track.uri) setIsCurrentLiked(false);
          viewCache.updateLikedOptimistic(track, false);
          showToast("Eliminada de Tus Me Gusta");
        } else {
          await auth.api.saveTrack(track.id, track.uri);
          if (player.currentTrack?.uri === track.uri) setIsCurrentLiked(true);
          viewCache.updateLikedOptimistic(track, true);
          showToast("Guardada en Tus Me Gusta");
        }
      } catch (err) {
        if (err instanceof SpotifyApiError && err.status === 403) {
          showToast(
            "Cierra sesión y vuelve a conectar para conceder permiso de Me Gusta.",
            "warning"
          );
        } else {
          showToast("No se pudo actualizar Tus Me Gusta.", "warning");
        }
      }
    },
    [auth.api, player.currentTrack?.uri, showToast]
  );

  const handleToggleLikeCurrent = useCallback(() => {
    if (!player.currentTrack) return;
    void handleToggleLike(player.currentTrack, isCurrentLiked);
  }, [handleToggleLike, isCurrentLiked, player.currentTrack]);

  const handleCopyLink = useCallback(
    async (track: UnifiedTrack) => {
      const id = track.id || track.uri.split(":").pop();
      const url = id ? `https://open.spotify.com/track/${id}` : track.uri;
      try {
        await navigator.clipboard.writeText(url);
        showToast("Enlace de Spotify copiado");
      } catch {
        showToast("No se pudo copiar el enlace", "warning");
      }
    },
    [showToast]
  );

  const handleRemoveFromPlaylist = useCallback(
    async (playlistId: string, track: UnifiedTrack) => {
      try {
        await auth.api.removeTrackFromPlaylist(playlistId, track.uri);
        viewCache.invalidatePlaylist(playlistId);
        setRemovedTrackUri({ playlistId, uri: track.uri, seq: Date.now() });
        showToast(`Quitada de la playlist: ${track.name}`);
      } catch (err) {
        if (err instanceof SpotifyApiError && err.status === 403) {
          showToast(
            "No tienes permiso para quitar canciones de esta playlist.",
            "warning"
          );
        } else {
          showToast("No se pudo quitar la canción de la playlist.", "warning");
        }
      }
    },
    [auth.api, showToast]
  );

  const handleOpenContextMenu = useCallback(
    (
      e: React.MouseEvent,
      track: UnifiedTrack,
      index?: number,
      sourcePlaylistId?: string
    ) => {
      setContextMenu({
        track,
        x: e.clientX,
        y: e.clientY,
        index,
        sourcePlaylistId,
      });
    },
    []
  );

  // Wire pointer-based track Drag & Drop onto Sidebar playlists, QueueDrawer, and in-playlist reorder
  useEffect(() => {
    registerTrackDropHandler((target, track) => {
      if (target.kind === "playlist") {
        const pl = playlists.find((p) => p.id === target.id);
        if (pl) {
          void handleAddToPlaylist(pl, track);
        }
      } else if (target.kind === "queue") {
        void handleAddToQueue(track);
      } else if (target.kind === "reorder") {
        void handleReorderPlaylistTrack(
          target.playlistId,
          target.fromIndex,
          target.toIndex
        );
      }
    });
    return () => registerTrackDropHandler(null);
  }, [playlists, handleAddToPlaylist, handleAddToQueue, handleReorderPlaylistTrack]);

  // Keep latest handlers in a ref so the Tauri event listener is registered ONCE
  const notchHandlersRef = useRef({
    togglePlay: () => {
      void player.togglePlay();
    },
    next: handleNextTrack,
    previous: handlePrevTrack,
    toggleLike: handleToggleLikeCurrent,
    setVolume: (vol: number) => {
      void player.setVolume(vol);
    },
    requestState: () => broadcastRef.current(),
  });
  notchHandlersRef.current = {
    togglePlay: () => {
      void player.togglePlay();
    },
    next: handleNextTrack,
    previous: handlePrevTrack,
    toggleLike: handleToggleLikeCurrent,
    setVolume: (vol: number) => {
      void player.setVolume(vol);
    },
    requestState: () => broadcastRef.current(),
  };

  // Listen to interactive commands from the native Top-Center Desktop Notch
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<string>("notch-action", (event) => {
      if (event.payload.startsWith("set-volume:")) {
        const pct = Number(event.payload.slice("set-volume:".length));
        if (Number.isFinite(pct)) {
          notchHandlersRef.current.setVolume(Math.max(0, Math.min(1, pct / 100)));
        }
        return;
      }
      switch (event.payload) {
        case "play-pause":
          notchHandlersRef.current.togglePlay();
          break;
        case "next":
          notchHandlersRef.current.next();
          break;
        case "previous":
          notchHandlersRef.current.previous();
          break;
        case "toggle-like":
          notchHandlersRef.current.toggleLike();
          break;
        case "request-state":
          notchHandlersRef.current.requestState();
          break;
      }
    }).then((fn) => {
      if (!active) fn();
      else unlisten = fn;
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  // Fluid, zero-reload View Transition engine with directional canvas glides & shared-element artwork morphing
  const transitionView = useCallback(
    (
      nextState: { stack: AppView[]; index: number },
      dir: NavDir,
      morphSourceEl?: HTMLElement | null
    ) => {
      const prevView = navRef.current.stack[navRef.current.index];
      const nextView = nextState.stack[nextState.index];
      const doc = document as Document & {
        startViewTransition?: (cb: () => void) => { finished: Promise<void> };
      };

      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (typeof doc.startViewTransition !== "function" || reducedMotion) {
        setNavState(nextState);
        return;
      }

      const touched: HTMLElement[] = [];
      const markMorph = (el: HTMLElement | null, name = "hero-artwork-morph") => {
        if (!el) return;
        el.style.viewTransitionName = name;
        touched.push(el);
      };

      // Assign main-canvas ONLY during in-app view navigation so it never lifts above NowPlayingStage
      if (mainRef.current) {
        mainRef.current.style.viewTransitionName = "main-canvas";
        touched.push(mainRef.current);
      }

      // Keep floating persistent chrome (PlayerBar, TitleBar, QueueDrawer) pinned ABOVE main-canvas during view transitions
      markMorph(
        document.querySelector<HTMLElement>("[data-persistent-player-bar]"),
        "persistent-player-bar"
      );
      markMorph(
        document.querySelector<HTMLElement>("[data-persistent-titlebar]"),
        "persistent-titlebar"
      );
      markMorph(
        document.querySelector<HTMLElement>("[data-persistent-queue]"),
        "persistent-queue"
      );

      // Choreographed Search bar expansion & playlist cascade
      let effectiveDir: NavDir = dir;
      let searchMorphTarget: "to-search" | "to-home" | null = null;

      if (nextView.kind === "search" && prevView?.kind !== "search" && dir !== "back") {
        effectiveDir = "search-open";
        const trigger = document.querySelector<HTMLElement>("[data-search-bar-trigger]");
        if (trigger) {
          markMorph(trigger, "search-bar-morph");
          searchMorphTarget = "to-search";
        }
      } else if (prevView?.kind === "search" && nextView.kind === "home") {
        effectiveDir = "search-close";
        const searchBar = document.querySelector<HTMLElement>("[data-search-bar]");
        if (searchBar) {
          markMorph(searchBar, "search-bar-morph");
          searchMorphTarget = "to-home";
        }
      }

      // Assign source artwork morph BEFORE capturing the old snapshot
      let expectingForwardTarget: "artist" | "album" | "playlist" | "liked" | null = null;
      let expectingBackTarget:
        | { kind: "artist" | "album"; id: string }
        | { kind: "playlist"; id: string; coverSlot?: "quick" | "grid" }
        | { kind: "liked" }
        | null = null;

      if (dir === "forward" && morphSourceEl && morphSourceEl.isConnected) {
        if (
          nextView.kind === "artist" ||
          nextView.kind === "album" ||
          nextView.kind === "playlist" ||
          nextView.kind === "liked"
        ) {
          markMorph(morphSourceEl);
          expectingForwardTarget = nextView.kind;
        }
      } else if (dir === "back" && prevView) {
        // Only pair back-morph when target view hydrates synchronously from cache/state
        if (
          prevView.kind === "album" &&
          (nextView.kind === "artist" || nextView.kind === "albums" || nextView.kind === "search")
        ) {
          const hero = document.querySelector<HTMLElement>(
            `[data-album-hero="${CSS.escape(prevView.id)}"]`
          );
          if (hero) {
            markMorph(hero);
            expectingBackTarget = { kind: "album", id: prevView.id };
          }
        } else if (
          prevView.kind === "artist" &&
          (nextView.kind === "artists" || nextView.kind === "search")
        ) {
          const hero = document.querySelector<HTMLElement>(
            `[data-artist-hero="${CSS.escape(prevView.id)}"]`
          );
          if (hero) {
            markMorph(hero);
            expectingBackTarget = { kind: "artist", id: prevView.id };
          }
        } else if (prevView.kind === "playlist" && nextView.kind === "home") {
          const hero = document.querySelector<HTMLElement>(
            `[data-playlist-hero="${CSS.escape(prevView.id)}"]`
          );
          if (hero) {
            markMorph(hero);
            expectingBackTarget = {
              kind: "playlist",
              id: prevView.id,
              coverSlot: prevView.coverSlot,
            };
          }
        } else if (prevView.kind === "liked" && nextView.kind === "home") {
          const hero = document.querySelector<HTMLElement>('[data-liked-hero="liked"]');
          if (hero) {
            markMorph(hero);
            expectingBackTarget = { kind: "liked" };
          }
        }
      }

      document.documentElement.dataset.navDir = effectiveDir;

      try {
        const vt = doc.startViewTransition(() => {
          flushSync(() => {
            setNavState(nextState);
          });

          // Pair destination search bar or artwork BEFORE the browser captures the new snapshot
          if (searchMorphTarget === "to-search") {
            markMorph(
              document.querySelector<HTMLElement>("[data-search-bar]"),
              "search-bar-morph"
            );
          } else if (searchMorphTarget === "to-home") {
            markMorph(
              document.querySelector<HTMLElement>("[data-search-bar-trigger]"),
              "search-bar-morph"
            );
          }

          if (expectingForwardTarget === "artist" && nextView.kind === "artist") {
            markMorph(
              document.querySelector<HTMLElement>(
                `[data-artist-hero="${CSS.escape(nextView.id)}"]`
              )
            );
          } else if (expectingForwardTarget === "album" && nextView.kind === "album") {
            markMorph(
              document.querySelector<HTMLElement>(
                `[data-album-hero="${CSS.escape(nextView.id)}"]`
              )
            );
          } else if (expectingForwardTarget === "playlist" && nextView.kind === "playlist") {
            markMorph(
              document.querySelector<HTMLElement>(
                `[data-playlist-hero="${CSS.escape(nextView.id)}"]`
              )
            );
          } else if (expectingForwardTarget === "liked" && nextView.kind === "liked") {
            markMorph(document.querySelector<HTMLElement>('[data-liked-hero="liked"]'));
          } else if (expectingBackTarget?.kind === "album") {
            markMorph(
              document.querySelector<HTMLElement>(
                `[data-album-cover="${CSS.escape(expectingBackTarget.id)}"]`
              )
            );
          } else if (expectingBackTarget?.kind === "artist") {
            markMorph(
              document.querySelector<HTMLElement>(
                `[data-artist-cover="${CSS.escape(expectingBackTarget.id)}"]`
              )
            );
          } else if (expectingBackTarget?.kind === "playlist") {
            const escapedId = CSS.escape(expectingBackTarget.id);
            const preferredSlot = expectingBackTarget.coverSlot;
            const targetCover =
              (preferredSlot
                ? document.querySelector<HTMLElement>(
                    `[data-playlist-cover="${escapedId}"][data-cover-slot="${preferredSlot}"]`
                  )
                : null) ??
              document.querySelector<HTMLElement>(
                `[data-playlist-cover="${escapedId}"][data-cover-slot="grid"]`
              ) ??
              document.querySelector<HTMLElement>(`[data-playlist-cover="${escapedId}"]`);
            markMorph(targetCover);
          } else if (expectingBackTarget?.kind === "liked") {
            markMorph(document.querySelector<HTMLElement>('[data-liked-cover="liked"]'));
          }
        });

        vt.finished.finally(() => {
          delete document.documentElement.dataset.navDir;
          for (const el of touched) {
            el.style.viewTransitionName = "";
          }
        });
      } catch {
        delete document.documentElement.dataset.navDir;
        for (const el of touched) {
          el.style.viewTransitionName = "";
        }
        setNavState(nextState);
      }
    },
    []
  );

  const navigateView = useCallback(
    (
      view: AppView,
      options?: { dir?: NavDir; morphSourceEl?: HTMLElement | null }
    ) => {
      if (view.kind === "playlist") {
        const targetPlaylist = playlists.find((p) => p.id === view.id);
        const userId = auth.user?.id;
        if (
          targetPlaylist &&
          userId &&
          targetPlaylist.owner?.id &&
          targetPlaylist.owner.id !== userId &&
          !targetPlaylist.collaborative
        ) {
          showToast(
            `No se puede abrir "${targetPlaylist.name}": no es tu playlist (restricción de Spotify en Modo Desarrollo), pero puedes reproducirla.`,
            "warning",
            4500
          );
        }
      }

      const cur = navRef.current;
      const currentView = cur.stack[cur.index];
      const isSameView = Boolean(currentView && getViewKey(currentView) === getViewKey(view));

      if (isStageOpen) {
        const nextState = isSameView
          ? cur
          : (() => {
              const nextStack = [...cur.stack.slice(0, cur.index + 1), view].slice(-40);
              return { stack: nextStack, index: nextStack.length - 1 };
            })();
        const doc = document as Document & {
          startViewTransition?: (cb: () => void) => { finished: Promise<void> };
        };
        if (typeof doc.startViewTransition === "function") {
          doc.startViewTransition(() => {
            flushSync(() => {
              setIsStageOpen(false);
              if (!isSameView) setNavState(nextState);
            });
          });
        } else {
          setIsStageOpen(false);
          if (!isSameView) setNavState(nextState);
        }
        return;
      }

      if (isSameView) {
        return;
      }

      const nextStack = [...cur.stack.slice(0, cur.index + 1), view].slice(-40);
      const nextState = { stack: nextStack, index: nextStack.length - 1 };
      const inferredDir: NavDir =
        options?.dir ??
        (view.kind === "artist" || view.kind === "album" ? "forward" : "tab");

      transitionView(nextState, inferredDir, options?.morphSourceEl);
    },
    [auth.user?.id, isStageOpen, playlists, showToast, transitionView]
  );

  const handleGoBack = useCallback(() => {
    const cur = navRef.current;
    if (cur.index <= 0) return;
    transitionView({ stack: cur.stack, index: cur.index - 1 }, "back");
  }, [transitionView]);

  const handleGoForward = useCallback(() => {
    const cur = navRef.current;
    if (cur.index >= cur.stack.length - 1) return;
    transitionView({ stack: cur.stack, index: cur.index + 1 }, "forward");
  }, [transitionView]);

  const handleSaveBlendPlaylist = useCallback(
    async (name: string, uris: string[]) => {
      const created = await auth.api.createPlaylist({
        name,
        description: "Mezcla creada al instante con SpotiDesk Blend Session",
        isPublic: false,
        userId: auth.user?.id,
      });
      await auth.api.addTracksToPlaylist(created.id, uris);
      setPlaylists((prev) => [created, ...prev]);
      setNavState((prev) => {
        const nextStack = [
          ...prev.stack.slice(0, prev.index + 1),
          { kind: "playlist" as const, id: created.id, seedPlaylist: created },
        ].slice(-40);
        return { stack: nextStack, index: nextStack.length - 1 };
      });
      showToast(`Playlist mezclada "${created.name}" guardada (${uris.length} pistas)`);
    },
    [auth.api, auth.user?.id, showToast]
  );

  // Native-feeling macOS 2-finger horizontal trackpad swipe gesture (Back / Forward)
  const swipeIndicator = useTrackpadSwipeNav({
    enabled:
      auth.isAuthenticated &&
      !isMiniMode &&
      !isStageOpen &&
      !isSettingsOpen &&
      !isPaletteOpen &&
      !isStatsOpen &&
      !isBlendOpen &&
      !isCreatePlaylistOpen,
    canGoBack,
    canGoForward,
    onGoBack: handleGoBack,
    onGoForward: handleGoForward,
  });

  // Global Spotlight shortcut (Alt+Shift+Space / ⌥+⇧+Space) from any application
  const isMiniModeRef = useRef(isMiniMode);
  isMiniModeRef.current = isMiniMode;
  const isAuthenticatedRef = useRef(auth.isAuthenticated);
  isAuthenticatedRef.current = auth.isAuthenticated;

  // Broadcast live state to the standalone floating Spotlight window
  const broadcastSpotlightState = useCallback(() => {
    const payload: SpotlightStatePayload = {
      theme,
      isPlaying: player.isPlaying,
      hasTrack: Boolean(player.currentTrack),
      currentTrack: player.currentTrack,
      playlists,
      devices: player.devices,
      notchVisible,
    };
    void invoke("send_spotlight_state", { payload }).catch(() => {});
  }, [
    theme,
    player.isPlaying,
    player.currentTrack,
    playlists,
    player.devices,
    notchVisible,
  ]);

  const broadcastSpotlightRef = useRef(broadcastSpotlightState);
  broadcastSpotlightRef.current = broadcastSpotlightState;

  useEffect(() => {
    broadcastSpotlightRef.current();
  }, [
    theme,
    player.isPlaying,
    player.currentTrack?.uri,
    playlists,
    player.devices,
    notchVisible,
  ]);

  // Execute actions coming from the standalone floating Spotlight window
  const spotlightHandlersRef = useRef({
    playTrack: (track: UnifiedTrack) => {
      setTrackDir("next");
      void player.playContext({ uris: [track.uri] });
    },
    togglePlay: () => void player.togglePlay(),
    next: handleNextTrack,
    previous: handlePrevTrack,
    toggleLike: handleToggleLikeCurrent,
    startRadio: (track: UnifiedTrack) => void handleStartSongRadio(track),
    transferDevice: (deviceId: string) => void player.transferToDevice(deviceId),
    toggleTheme,
    toggleNotch: () => void handleToggleNotch(),
    openView: (view: { kind: "home" | "search" | "liked" | "albums" | "artists" }) => {
      handleSelectView(view);
    },
    openPlaylist: (pl: SpotifyPlaylist) => {
      handleSelectView({ kind: "playlist", id: pl.id, seedPlaylist: pl });
    },
    openArtist: (artistId: string, artistName?: string) => {
      handleSelectArtist(artistId, null, artistName);
    },
    openAlbum: (albumId: string) => {
      handleSelectAlbum(albumId);
    },
    openStage: () => {
      if (player.currentTrack) setStageWithTransition(true);
    },
    openStats: () => setIsStatsOpen(true),
    openHistory: () => setIsHistoryOpen(true),
    toggleZen: () => handleToggleZenMode(),
    openBlend: () => setIsBlendOpen(true),
    openSettings: () => setIsSettingsOpen(true),
  });
  spotlightHandlersRef.current = {
    playTrack: (track: UnifiedTrack) => {
      setTrackDir("next");
      void player.playContext({ uris: [track.uri] });
    },
    togglePlay: () => void player.togglePlay(),
    next: handleNextTrack,
    previous: handlePrevTrack,
    toggleLike: handleToggleLikeCurrent,
    startRadio: (track: UnifiedTrack) => void handleStartSongRadio(track),
    transferDevice: (deviceId: string) => void player.transferToDevice(deviceId),
    toggleTheme,
    toggleNotch: () => void handleToggleNotch(),
    openView: (view: { kind: "home" | "search" | "liked" | "albums" | "artists" }) => {
      handleSelectView(view);
    },
    openPlaylist: (pl: SpotifyPlaylist) => {
      handleSelectView({ kind: "playlist", id: pl.id, seedPlaylist: pl });
    },
    openArtist: (artistId: string, artistName?: string) => {
      handleSelectArtist(artistId, null, artistName);
    },
    openAlbum: (albumId: string) => {
      handleSelectAlbum(albumId);
    },
    openStage: () => {
      if (player.currentTrack) setStageWithTransition(true);
    },
    openStats: () => setIsStatsOpen(true),
    openHistory: () => setIsHistoryOpen(true),
    toggleZen: () => handleToggleZenMode(),
    openBlend: () => setIsBlendOpen(true),
    openSettings: () => setIsSettingsOpen(true),
  };

  useEffect(() => {
    let active = true;
    let unlistenReq: (() => void) | undefined;
    let unlistenAct: (() => void) | undefined;

    void listen("spotlight-request-state", () => {
      broadcastSpotlightRef.current();
    }).then((fn) => {
      if (!active) fn();
      else unlistenReq = fn;
    });

    void listen<SpotlightActionPayload>("spotlight-action", (event) => {
      if (!isAuthenticatedRef.current) return;
      const act = event.payload;
      if (!act) return;
      const h = spotlightHandlersRef.current;
      switch (act.type) {
        case "play-track":
          h.playTrack(act.track);
          break;
        case "toggle-play":
          h.togglePlay();
          break;
        case "next":
          h.next();
          break;
        case "previous":
          h.previous();
          break;
        case "toggle-like":
          h.toggleLike();
          break;
        case "start-radio":
          h.startRadio(act.track);
          break;
        case "transfer-device":
          h.transferDevice(act.deviceId);
          break;
        case "toggle-theme":
          h.toggleTheme();
          break;
        case "toggle-notch":
          h.toggleNotch();
          break;
        case "open-view":
          h.openView(act.view);
          break;
        case "open-playlist":
          h.openPlaylist(act.playlist);
          break;
        case "open-artist":
          h.openArtist(act.artistId, act.artistName);
          break;
        case "open-album":
          h.openAlbum(act.albumId);
          break;
        case "open-stage":
          h.openStage();
          break;
        case "open-stats":
          h.openStats();
          break;
        case "open-history":
          h.openHistory();
          break;
        case "toggle-zen":
          h.toggleZen();
          break;
        case "open-blend":
          h.openBlend();
          break;
        case "open-settings":
          h.openSettings();
          break;
      }
    }).then((fn) => {
      if (!active) fn();
      else unlistenAct = fn;
    });

    return () => {
      active = false;
      unlistenReq?.();
      unlistenAct?.();
    };
  }, []);

  const handleSelectView = useCallback(
    (view: AppView) => {
      navigateView(view, { dir: "tab" });
    },
    [navigateView]
  );

  const handleSelectArtist = useCallback(
    (artistOrId: SpotifyArtist | string, morphSourceEl?: HTMLElement | null, fallbackName?: string) => {
      if (typeof artistOrId === "string") {
        // Resolve artist by name if only the display name was available (e.g. SDK track without URI)
        if (!artistOrId && fallbackName) {
          void auth.api
            .search(fallbackName, 5)
            .then((res) => {
              const items = (res.artists?.items ?? []).filter(Boolean);
              if (items.length === 0) {
                showToast(`No se encontró el perfil de ${fallbackName}`, "warning");
                return;
              }
              const norm = (s: string) =>
                s
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .toLowerCase()
                  .trim();
              const target = norm(fallbackName);
              const best =
                items.find((a) => norm(a.name) === target) ??
                items.find((a) => norm(a.name).startsWith(target)) ??
                items[0];
              navigateView(
                { kind: "artist", id: best.id, seedArtist: best },
                { dir: "forward", morphSourceEl }
              );
            })
            .catch(() => {
              showToast(`No se pudo abrir el perfil de ${fallbackName}`, "warning");
            });
          return;
        }
        if (!artistOrId) return;
        const seedArtist: SpotifyArtist | undefined = fallbackName
          ? {
              id: artistOrId,
              name: fallbackName,
              uri: `spotify:artist:${artistOrId}`,
            }
          : undefined;
        navigateView(
          { kind: "artist", id: artistOrId, seedArtist },
          { dir: "forward", morphSourceEl }
        );
      } else {
        navigateView(
          { kind: "artist", id: artistOrId.id, seedArtist: artistOrId },
          { dir: "forward", morphSourceEl }
        );
      }
    },
    [auth.api, navigateView, showToast]
  );

  const handleSelectAlbum = useCallback(
    (albumOrId: SpotifyAlbumSimple | string, morphSourceEl?: HTMLElement | null) => {
      if (typeof albumOrId === "string") {
        navigateView({ kind: "album", id: albumOrId }, { dir: "forward", morphSourceEl });
      } else {
        navigateView(
          { kind: "album", id: albumOrId.id, seedAlbum: albumOrId },
          { dir: "forward", morphSourceEl }
        );
      }
    },
    [navigateView]
  );

  const handleSelectPlaylistFromHome = useCallback(
    (
      playlist: SpotifyPlaylist,
      morphSourceEl?: HTMLElement | null,
      coverSlot?: "quick" | "grid"
    ) => {
      navigateView(
        { kind: "playlist", id: playlist.id, seedPlaylist: playlist, coverSlot },
        { dir: "forward", morphSourceEl }
      );
    },
    [navigateView]
  );

  const handleSelectLikedFromHome = useCallback(
    (morphSourceEl?: HTMLElement | null) => {
      navigateView({ kind: "liked" }, { dir: "forward", morphSourceEl });
    },
    [navigateView]
  );

  const handlePrefetchNav = useCallback(
    (kind: "liked" | "albums" | "artists") => {
      if (kind === "liked") {
        void viewCache.prefetchLiked(auth.api);
      } else if (kind === "albums") {
        void viewCache.prefetchSavedAlbums(auth.api);
      } else {
        void viewCache.prefetchFollowedArtists(auth.api);
      }
    },
    [auth.api]
  );

  const handlePrefetchPlaylist = useCallback(
    (playlist: SpotifyPlaylist) => {
      void viewCache.prefetchPlaylist(auth.api, playlist.id, playlist);
    },
    [auth.api]
  );

  // Global in-app keyboard shortcuts (Ctrl+K -> Search, Alt+Left/Right -> Back/Forward, Space -> Play/Pause, F -> Stage, Esc -> Close Stage)
  useEffect(() => {
    if (!auth.isAuthenticated) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (e.key === "Escape" && isStageOpen) {
        e.preventDefault();
        setStageWithTransition(false);
        return;
      }

      const canNavigateHistory = !isInput && !isStageOpen && !isSettingsOpen && !isPaletteOpen;
      if (canNavigateHistory) {
        const isBackKey =
          matchesShortcut(e, shortcuts.navBack, isMac) ||
          (isMac && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && e.key === "[");

        const isForwardKey =
          matchesShortcut(e, shortcuts.navForward, isMac) ||
          (isMac && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && e.key === "]");

        if (isBackKey) {
          e.preventDefault();
          handleGoBack();
          return;
        }
        if (isForwardKey) {
          e.preventDefault();
          handleGoForward();
          return;
        }
      }

      // Filter shortcut outside a playlist/album/liked view opens Search cleanly
      if (!isSettingsOpen && matchesShortcut(e, shortcuts.filterPlaylist, isMac)) {
        const curKind = navRef.current.stack[navRef.current.index]?.kind;
        if (curKind !== "playlist" && curKind !== "liked" && curKind !== "album") {
          e.preventDefault();
          setIsPaletteOpen(false);
          navigateView({ kind: "search" }, { dir: "tab" });
          return;
        }
      }

      if (!isSettingsOpen && matchesShortcut(e, shortcuts.openPalette, isMac)) {
        e.preventDefault();
        setIsSettingsOpen(false);
        setIsPaletteOpen((v) => !v);
        return;
      }

      if (!isSettingsOpen && matchesShortcut(e, shortcuts.openSearch, isMac)) {
        e.preventDefault();
        setIsPaletteOpen(false);
        navigateView({ kind: "search" }, { dir: "tab" });
        return;
      }

      if (!isInput && !isSettingsOpen && !isPaletteOpen && matchesShortcut(e, shortcuts.toggleStage, isMac)) {
        if (player.currentTrack) {
          e.preventDefault();
          setStageWithTransition(!isStageOpen);
        }
        return;
      }

      if (!isInput && !isSettingsOpen && !isPaletteOpen && matchesShortcut(e, shortcuts.toggleLike, isMac)) {
        if (player.currentTrack) {
          e.preventDefault();
          handleToggleLikeCurrent();
        }
        return;
      }

      // Cmd+1..5 (Ctrl+1..5 on Windows) instant jump to Pinned Playlists
      if (
        (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        /^[1-5]$/.test(e.key)
      ) {
        const idx = Number(e.key) - 1;
        const pinnedId = sidebarOrg.pinnedIds[idx];
        const pl = pinnedId ? playlists.find((p) => p.id === pinnedId) : undefined;
        if (pl) {
          e.preventDefault();
          setIsPaletteOpen(false);
          setIsSettingsOpen(false);
          navigateView(
            { kind: "playlist", id: pl.id, seedPlaylist: pl },
            { dir: "tab" }
          );
          return;
        }
      }

      // Pro keyboard playback controls: ←/→ seek ±5s (±15s with Shift), ↑/↓ volume ±5%, M mute
      const canUseProMediaKeys =
        !isInput &&
        !isSettingsOpen &&
        !isPaletteOpen &&
        !isStatsOpen &&
        !isBlendOpen &&
        !isCreatePlaylistOpen &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey;

      if (canUseProMediaKeys) {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          if (player.currentTrack && player.durationMs > 0) {
            e.preventDefault();
            const stepMs = e.shiftKey ? 15_000 : 5_000;
            const delta = e.key === "ArrowRight" ? stepMs : -stepMs;
            const nextPos = Math.max(0, Math.min(player.durationMs, player.positionMs + delta));
            void player.seek(nextPos);
            showHudPill({
              kind: delta > 0 ? "seek-fwd" : "seek-back",
              label: `${delta > 0 ? "+" : "-"}${stepMs / 1000}s · ${formatDuration(nextPos)}`,
            });
          }
          return;
        }

        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          if (target?.tagName !== "SELECT") {
            e.preventDefault();
            const baseVol = player.muted ? 0 : player.volume;
            const nextVol = Math.max(
              0,
              Math.min(1, Math.round((baseVol + (e.key === "ArrowUp" ? 0.05 : -0.05)) * 20) / 20)
            );
            void player.setVolume(nextVol);
            const pct = Math.round(nextVol * 100);
            showHudPill({
              kind: pct === 0 ? "mute" : "volume",
              label: `${pct}%`,
              percent: pct,
            });
          }
          return;
        }
      }

      if (
        !isInput &&
        !isSettingsOpen &&
        !isPaletteOpen &&
        !isStatsOpen &&
        !isBlendOpen &&
        !isCreatePlaylistOpen &&
        matchesShortcut(e, shortcuts.toggleMute, isMac)
      ) {
        e.preventDefault();
        const willMute = !(player.muted || player.volume === 0);
        void player.toggleMute();
        showHudPill({
          kind: willMute ? "mute" : "volume",
          label: willMute ? "Silenciado" : "Sonido activo",
          percent: willMute ? 0 : Math.round((player.volume || 0.7) * 100),
        });
        return;
      }

      if (
        !isInput &&
        !isSettingsOpen &&
        !isPaletteOpen &&
        target?.tagName !== "BUTTON" &&
        matchesShortcut(e, shortcuts.togglePlay, isMac)
      ) {
        e.preventDefault();
        void player.togglePlay();
      }
    };

    // Mouse Back / Forward side buttons (3 & 4)
    const handleMouseUp = (e: MouseEvent) => {
      if (isStageOpen) return;
      if (e.button === 3) {
        e.preventDefault();
        handleGoBack();
      } else if (e.button === 4) {
        e.preventDefault();
        handleGoForward();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    auth.isAuthenticated,
    handleGoBack,
    handleGoForward,
    handleToggleLikeCurrent,
    isBlendOpen,
    isCreatePlaylistOpen,
    isMac,
    isPaletteOpen,
    isSettingsOpen,
    isStageOpen,
    isStatsOpen,
    navigateView,
    player,
    playlists,
    setStageWithTransition,
    shortcuts,
    showHudPill,
    sidebarOrg.pinnedIds,
  ]);

  const windowRadiusClass =
    isWindowMaximized || isMac ? "rounded-none" : "rounded-[8px]";

  if (isMiniMode && auth.isAuthenticated) {
    return (
      <Suspense fallback={null}>
        <MiniPlayer
          currentTrack={player.currentTrack}
          isPlaying={player.isPlaying}
          isCurrentLiked={isCurrentLiked}
          positionMs={player.positionMs}
          durationMs={player.durationMs}
          ambientRgb={ambientRgb}
          theme={theme}
          onTogglePlay={() => void player.togglePlay()}
          onNext={handleNextTrack}
          onPrevious={handlePrevTrack}
          onSeek={(ms) => void player.seek(ms)}
          onToggleLike={handleToggleLikeCurrent}
          onExpand={() => void handleToggleMiniPlayer()}
        />
      </Suspense>
    );
  }

  return (
    <div
      className={`h-screen w-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden relative ${windowRadiusClass}`}
    >
      {/* Crisp subtle window rim matching native rounded corners on frameless Windows */}
      {!isWindowMaximized && !isMac && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed inset-0 z-[60] border border-[var(--border-subtle)] ${windowRadiusClass}`}
        />
      )}

      {/* Optional ultra-subtle ambient glow derived from current album cover */}
      {ambientRgb && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0 transition-all duration-1000 ease-apple"
          style={{
            background: `radial-gradient(720px circle at 58% -6%, rgba(${ambientRgb}, ${
              theme === "dark" ? 0.14 : 0.09
            }), transparent 68%)`,
          }}
        />
      )}

      {/* Frameless custom TitleBar */}
      <TitleBar
        theme={theme}
        onToggleTheme={toggleTheme}
        ambientEnabled={ambientEnabled}
        onToggleAmbient={toggleAmbient}
        notchVisible={notchVisible}
        onToggleNotch={() => void handleToggleNotch()}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenCommandPalette={
          auth.isAuthenticated ? () => setIsPaletteOpen(true) : undefined
        }
        onOpenHistory={
          auth.isAuthenticated ? () => setIsHistoryOpen(true) : undefined
        }
        onToggleMiniPlayer={
          auth.isAuthenticated ? () => void handleToggleMiniPlayer() : undefined
        }
        zenMode={zenMode}
        onToggleZenMode={
          auth.isAuthenticated ? handleToggleZenMode : undefined
        }
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        user={auth.user}
        isSdkReady={player.isSdkReady}
      />

      <Toast toast={toast} />
      <TrackDragOverlay />

      {/* Translucent macOS-style micro-HUD pill for Pro Keyboard volume / seek feedback */}
      {hudPill && (
        <div
          aria-live="polite"
          className="anim-popover-enter pointer-events-none fixed bottom-24 left-1/2 -translate-x-1/2 z-[65] popover-glass px-3.5 py-2 rounded-full border border-[var(--border-subtle)] shadow-xl flex items-center gap-2.5 text-[12px] font-medium tabular-nums text-[var(--text-primary)]"
        >
          {hudPill.kind === "seek-back" ? (
            <Rewind size={14} strokeWidth={1.7} />
          ) : hudPill.kind === "seek-fwd" ? (
            <FastForward size={14} strokeWidth={1.7} />
          ) : hudPill.kind === "mute" ? (
            <VolumeX size={14} strokeWidth={1.7} />
          ) : (hudPill.percent ?? 50) < 50 ? (
            <Volume1 size={14} strokeWidth={1.7} />
          ) : (
            <Volume2 size={14} strokeWidth={1.7} />
          )}
          {typeof hudPill.percent === "number" && (
            <div className="w-20 h-[4px] rounded-full bg-[var(--slider-track)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--text-primary)] transition-all duration-100"
                style={{ width: `${hudPill.percent}%` }}
              />
            </div>
          )}
          <span>{hudPill.label}</span>
        </div>
      )}

      {/* Elastic frosted edge arrow indicator for 2-finger trackpad Back / Forward swipe */}
      {swipeIndicator && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed top-1/2 z-[65] -translate-y-1/2 flex items-center justify-center w-10 h-10 rounded-full popover-glass border border-[var(--border-subtle)] text-[var(--text-primary)] shadow-lg transition-opacity duration-100 ${
            swipeIndicator.dir === "back" ? "left-4" : "right-4"
          }`}
          style={{
            opacity: Math.min(1, 0.25 + swipeIndicator.progress * 0.75),
            transform: `translateY(-50%) translateX(${
              swipeIndicator.dir === "back"
                ? (swipeIndicator.progress - 1) * 18
                : (1 - swipeIndicator.progress) * 18
            }px) scale(${0.86 + swipeIndicator.progress * 0.18})`,
          }}
        >
          {swipeIndicator.dir === "back" ? (
            <ChevronLeft size={18} strokeWidth={1.8} />
          ) : (
            <ChevronRight size={18} strokeWidth={1.8} />
          )}
        </div>
      )}

      <Suspense fallback={null}>
        {isPaletteOpen && auth.isAuthenticated && (
          <CommandPalette
            api={auth.api}
            playlists={playlists}
            devices={player.devices}
            isPlaying={player.isPlaying}
            hasTrack={Boolean(player.currentTrack)}
            theme={theme}
            ambientEnabled={ambientEnabled}
            notchVisible={notchVisible}
            sleepTimer={sleepTimer}
            onSelectView={handleSelectView}
            onPlayTrack={(track) => {
              setTrackDir("next");
              void player.playContext({ uris: [track.uri] });
            }}
            onSelectArtist={(artist) => handleSelectArtist(artist)}
            onSelectAlbum={(album) => handleSelectAlbum(album)}
            onTogglePlay={() => void player.togglePlay()}
            onNext={handleNextTrack}
            onPrevious={handlePrevTrack}
            onToggleLikeCurrent={handleToggleLikeCurrent}
            onOpenStage={() => {
              if (player.currentTrack) setStageWithTransition(true);
            }}
            onToggleQueue={() => setIsQueueOpen((v) => !v)}
            onToggleTheme={toggleTheme}
            onToggleAmbient={toggleAmbient}
            onToggleNotch={() => void handleToggleNotch()}
            onToggleMiniPlayer={() => void handleToggleMiniPlayer()}
            onOpenStats={() => setIsStatsOpen(true)}
            onOpenHistory={() => setIsHistoryOpen(true)}
            onToggleZenMode={handleToggleZenMode}
            zenMode={zenMode}
            onOpenBlendSession={() => setIsBlendOpen(true)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onTransferDevice={(id) => void player.transferToDevice(id)}
            onClose={() => setIsPaletteOpen(false)}
          />
        )}

        {isStatsOpen && auth.isAuthenticated && (
          <StatsModal
            theme={theme}
            ambientRgb={ambientRgb}
            userName={auth.user?.display_name || auth.user?.id}
            onPlayTrack={(track) => {
              setTrackDir("next");
              void player.playContext({ uris: [track.uri] });
            }}
            onSelectArtist={(artistId, artistName) =>
              handleSelectArtist(artistId, null, artistName)
            }
            onClose={() => setIsStatsOpen(false)}
          />
        )}

        {isHistoryOpen && auth.isAuthenticated && (
          <HistoryModal
            onPlayTrack={(track) => {
              setTrackDir("next");
              void player.playContext({ uris: [track.uri] });
            }}
            onSelectArtist={(artistId, artistName) =>
              handleSelectArtist(artistId, null, artistName)
            }
            onClose={() => setIsHistoryOpen(false)}
          />
        )}

        {isBlendOpen && auth.isAuthenticated && (
          <BlendSessionModal
            api={auth.api}
            playlists={playlists}
            currentUserId={auth.user?.id}
            onPlayTracks={async (uris, label) => {
              setTrackDir("next");
              await player.playContext({ uris, offsetPosition: 0 });
              showToast(`Blend Session: ${label} (${uris.length} pistas)`);
            }}
            onSaveAsPlaylist={handleSaveBlendPlaylist}
            onClose={() => setIsBlendOpen(false)}
          />
        )}

        {isSettingsOpen && (
          <SettingsModal
            user={auth.user}
            clientId={auth.clientId}
            onChangeClientId={auth.setClientId}
            theme={theme}
            ambientEnabled={ambientEnabled}
            autoplayEnabled={autoplayEnabled}
            softGlideMode={softGlideMode}
            notchVisible={notchVisible}
            notchLyricsEnabled={notchLyricsEnabled}
            notchAutoPeek={notchAutoPeek}
            notchPosition={notchPosition}
            closeToTray={closeToTray}
            shortcuts={shortcuts}
            onChangeShortcuts={handleChangeShortcuts}
            onToggleTheme={toggleTheme}
            onToggleAmbient={toggleAmbient}
            onToggleAutoplay={setAutoplayEnabled}
            onChangeSoftGlide={setSoftGlideMode}
            onToggleNotch={() => void handleToggleNotch()}
            onToggleNotchLyrics={setNotchLyricsEnabled}
            onToggleNotchAutoPeek={setNotchAutoPeek}
            onChangeNotchPosition={handleChangeNotchPosition}
            onToggleCloseToTray={setCloseToTray}
            onBackupRestored={handleBackupRestored}
            onLogout={auth.isAuthenticated ? () => void auth.logout() : undefined}
            onClose={() => setIsSettingsOpen(false)}
          />
        )}

        {isCreatePlaylistOpen && (
          <CreatePlaylistModal
            onCreate={handleCreatePlaylist}
            onClose={() => setIsCreatePlaylistOpen(false)}
          />
        )}
      </Suspense>

      {auth.isInitializing ? (
        <div className="flex-1 flex items-center justify-center relative z-10">
          <Loader2 size={22} strokeWidth={1.5} className="animate-spin text-[var(--text-secondary)]" />
        </div>
      ) : !auth.isAuthenticated ? (
        <LoginScreen
          clientId={auth.clientId}
          isAuthenticating={auth.isAuthenticating}
          error={auth.error}
          onLogin={(overrideId) => void auth.login(overrideId)}
        />
      ) : (
        <ErrorBoundary>
          <div className="flex-1 flex min-h-0 relative z-10">
            {!zenMode && (
              <Sidebar
                activeView={activeView}
                playlists={playlists}
                currentUserId={auth.user?.id}
                isLoadingPlaylists={isLoadingPlaylists}
                sidebarOrg={sidebarOrg}
                onSelectView={handleSelectView}
                onPrefetchNav={handlePrefetchNav}
                onPrefetchPlaylist={handlePrefetchPlaylist}
                onCreatePlaylist={() => setIsCreatePlaylistOpen(true)}
                onOpenBlendSession={() => setIsBlendOpen(true)}
                onTogglePinPlaylist={handleTogglePinPlaylist}
                onCreateFolder={handleCreateFolder}
                onDeleteFolder={handleDeleteFolder}
                onToggleFolderCollapsed={handleToggleFolderCollapsed}
                onAssignPlaylistToFolder={handleAssignPlaylistToFolder}
              />
            )}

            <main
              ref={mainRef}
              className="flex-1 flex flex-col min-w-0 min-h-0 relative"
            >
              {/* Subtle dismissible SDK status banner */}
              {player.sdkError && (
                <div className="anim-stagger-1 mx-8 mt-4 px-4 py-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-between gap-3 text-[12px] text-[var(--text-primary)]">
                  <span>{player.sdkError}</span>
                  <button
                    type="button"
                    onClick={player.clearSdkError}
                    aria-label="Cerrar aviso"
                    className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    <X size={13} strokeWidth={1.5} />
                  </button>
                </div>
              )}

              {activeView.kind === "home" && (
                <HomeView
                  user={auth.user}
                  playlists={playlists}
                  recentTracks={recentTracks}
                  currentTrackUri={player.currentTrack?.uri}
                  onSelectView={handleSelectView}
                  onSelectPlaylist={handleSelectPlaylistFromHome}
                  onSelectLiked={handleSelectLikedFromHome}
                  onPrefetchPlaylist={handlePrefetchPlaylist}
                  onPrefetchLiked={() => void viewCache.prefetchLiked(auth.api)}
                  onPlayPlaylist={(uri) => {
                    setTrackDir("next");
                    void player.playContext({ contextUri: uri, offsetPosition: 0 });
                  }}
                  onPlayTrack={(track) => {
                    setTrackDir("next");
                    void player.playContext({ uris: [track.uri] });
                  }}
                  onTrackContextMenu={handleOpenContextMenu}
                  onOpenStats={() => setIsStatsOpen(true)}
                />
              )}

              {activeView.kind === "search" && (
                <SearchView
                  api={auth.api}
                  currentTrackUri={player.currentTrack?.uri}
                  isPlaying={player.isPlaying}
                  onPlayContext={async (opts) => {
                    setTrackDir("next");
                    await player.playContext(opts);
                  }}
                  onTogglePlay={() => void player.togglePlay()}
                  onSelectAlbum={handleSelectAlbum}
                  onSelectArtist={(artist, el, fallbackName) =>
                    handleSelectArtist(artist, el, fallbackName)
                  }
                  onTrackContextMenu={handleOpenContextMenu}
                />
              )}

              {(activeView.kind === "albums" || activeView.kind === "artists") && (
                <LibraryView
                  key={activeView.kind}
                  mode={activeView.kind}
                  api={auth.api}
                  onSelectAlbum={handleSelectAlbum}
                  onSelectArtist={(artist, el) => handleSelectArtist(artist, el)}
                  onPlayContext={async (opts) => {
                    setTrackDir("next");
                    await player.playContext(opts);
                  }}
                />
              )}

              {activeView.kind === "artist" && (
                <ArtistView
                  key={activeView.id}
                  artistId={activeView.id}
                  seedArtist={activeView.seedArtist}
                  api={auth.api}
                  canGoBack={canGoBack}
                  onGoBack={handleGoBack}
                  onSelectAlbum={handleSelectAlbum}
                  onPlayContext={async (opts) => {
                    setTrackDir("next");
                    await player.playContext(opts);
                  }}
                  onToggleShuffle={player.toggleShuffle}
                  shuffle={player.shuffle}
                />
              )}

              {(activeView.kind === "liked" ||
                activeView.kind === "playlist" ||
                activeView.kind === "album") && (
                <CollectionView
                  key={getViewKey(activeView)}
                  target={activeView}
                  api={auth.api}
                  cachedPlaylist={
                    activeView.kind === "playlist"
                      ? playlists.find((p) => p.id === activeView.id)
                      : undefined
                  }
                  canGoBack={
                    canGoBack &&
                    (activeView.kind === "album" ||
                      navState.stack[navState.index - 1]?.kind === "home")
                  }
                  onGoBack={handleGoBack}
                  currentTrackUri={player.currentTrack?.uri}
                  activeContextUri={player.contextUri}
                  sdkWindowTracks={player.sdkWindowTracks}
                  isPlaying={player.isPlaying}
                  onPlayContext={async (opts) => {
                    setTrackDir("next");
                    await player.playContext(opts);
                  }}
                  onTogglePlay={() => void player.togglePlay()}
                  onToggleShuffle={player.toggleShuffle}
                  shuffle={player.shuffle}
                  onSelectAlbum={handleSelectAlbum}
                  onSelectArtist={(artist) => handleSelectArtist(artist)}
                  onTrackContextMenu={handleOpenContextMenu}
                  isWritablePlaylist={
                    activeView.kind === "playlist" &&
                    writablePlaylists.some((p) => p.id === activeView.id)
                  }
                  writablePlaylists={writablePlaylists}
                  onAddTracksToQueue={handleAddTracksToQueue}
                  onUpdatePlaylistDetails={handleUpdatePlaylistDetails}
                  reorderedEvent={reorderedEvent}
                  removedTrackUri={removedTrackUri}
                  filterShortcut={shortcuts.filterPlaylist}
                  onShowToast={showToast}
                  onRestrictedPlaylist={(name) =>
                    showToast(
                      `No se puede abrir "${name}": no es tu playlist (restricción de Spotify en Modo Desarrollo), pero puedes reproducirla.`,
                      "warning",
                      4500
                    )
                  }
                />
              )}
            </main>

            <Suspense fallback={null}>
              {isQueueOpen && !isStageOpen && (
                <QueueDrawer
                  api={auth.api}
                  currentTrack={player.currentTrack}
                  isPlaying={player.isPlaying}
                  sdkWindowTracks={player.sdkWindowTracks}
                  onPlayTrack={(track) => {
                    setTrackDir("next");
                    void player.playContext({ uris: [track.uri] });
                  }}
                  onSelectArtist={(artistId, artistName) =>
                    handleSelectArtist(artistId, null, artistName)
                  }
                  onTrackContextMenu={handleOpenContextMenu}
                  onClose={() => setIsQueueOpen(false)}
                />
              )}
            </Suspense>

            {!isStageOpen && (
              <PlayerBar
                currentTrack={player.currentTrack}
                isPlaying={player.isPlaying}
                isCurrentLiked={isCurrentLiked}
                positionMs={player.positionMs}
                durationMs={player.durationMs}
                shuffle={player.shuffle}
                repeatMode={player.repeatMode}
                volume={player.volume}
                muted={player.muted}
                devices={player.devices}
                localDeviceId={player.deviceId}
                activeDeviceName={player.activeDeviceName}
                isStageOpen={isStageOpen}
                isQueueOpen={isQueueOpen}
                sleepTimer={sleepTimer}
                pomodoro={pomodoro}
                ambientLevels={ambientLevels}
                onSetAmbientLevel={handleSetAmbientLevel}
                onStopAllAmbient={handleStopAllAmbient}
                trackDir={trackDir}
                onOpenStage={() => {
                  if (player.currentTrack) setStageWithTransition(true);
                }}
                onToggleQueue={() => setIsQueueOpen((v) => !v)}
                onToggleLikeCurrent={handleToggleLikeCurrent}
                onTogglePlay={() => void player.togglePlay()}
                onNext={handleNextTrack}
                onPrevious={handlePrevTrack}
                onSeek={(ms) => void player.seek(ms)}
                onSetVolume={(v) => void player.setVolume(v)}
                onToggleMute={() => void player.toggleMute()}
                onToggleShuffle={() => void player.toggleShuffle()}
                onCycleRepeat={() => void player.cycleRepeat()}
                onRefreshDevices={() => void player.refreshDevices()}
                onTransferDevice={(id) => void player.transferToDevice(id)}
                onSelectArtist={(artistId, artistName) =>
                  handleSelectArtist(artistId, null, artistName)
                }
              />
            )}

            <Suspense fallback={null}>
              {isStageOpen && player.currentTrack && (
                <NowPlayingStage
                  currentTrack={player.currentTrack}
                  isPlaying={player.isPlaying}
                  isCurrentLiked={isCurrentLiked}
                  positionMs={player.positionMs}
                  durationMs={player.durationMs}
                  shuffle={player.shuffle}
                  repeatMode={player.repeatMode}
                  volume={player.volume}
                  muted={player.muted}
                  ambientRgb={ambientRgb}
                  theme={theme}
                  trackDir={trackDir}
                  activeDeviceName={player.activeDeviceName}
                  queueTracks={player.sdkWindowTracks}
                  onClose={() => setStageWithTransition(false)}
                  onToggleLikeCurrent={handleToggleLikeCurrent}
                  onTogglePlay={() => void player.togglePlay()}
                  onNext={handleNextTrack}
                  onPrevious={handlePrevTrack}
                  onSeek={(ms) => void player.seek(ms)}
                  onSetVolume={(v) => void player.setVolume(v)}
                  onToggleMute={() => void player.toggleMute()}
                  onToggleShuffle={() => void player.toggleShuffle()}
                  onCycleRepeat={() => void player.cycleRepeat()}
                  onPlayQueueTrack={(uri) => {
                    setTrackDir("next");
                    if (player.contextUri) {
                      void player.playContext({ contextUri: player.contextUri, offsetUri: uri });
                    } else {
                      void player.playContext({ uris: [uri] });
                    }
                  }}
                  onStartRadio={(track) => void handleStartSongRadio(track)}
                  onSelectArtist={(artistId, artistName) =>
                    handleSelectArtist(artistId, null, artistName)
                  }
                />
              )}
            </Suspense>

            {contextMenu && (
              <TrackContextMenu
                menu={contextMenu}
                api={auth.api}
                writablePlaylists={writablePlaylists}
                onClose={() => setContextMenu(null)}
                onPlayNow={(track) => {
                  setTrackDir("next");
                  void player.playContext({ uris: [track.uri] });
                }}
                onAddToQueue={(track) => void handleAddToQueue(track)}
                onStartRadio={(track) => void handleStartSongRadio(track)}
                onToggleLike={handleToggleLike}
                onAddToPlaylist={handleAddToPlaylist}
                onRemoveFromPlaylist={handleRemoveFromPlaylist}
                onOpenStageWithTrack={(track) => {
                  setTrackDir("next");
                  void player.playContext({ uris: [track.uri] }).then(() => {
                    setStageWithTransition(true);
                  });
                }}
                onGoToArtist={(artistId, artistName) =>
                  handleSelectArtist(artistId, null, artistName)
                }
                onGoToAlbum={(albumId) => handleSelectAlbum(albumId)}
                onCopyLink={(track) => void handleCopyLink(track)}
              />
            )}
          </div>
        </ErrorBoundary>
      )}
    </div>
  );
}

export default App;
