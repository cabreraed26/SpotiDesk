import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Loader2, X } from "lucide-react";
import { useSpotifyAuth } from "./hooks/useSpotifyAuth";
import { useSpotifyPlayer } from "./hooks/useSpotifyPlayer";
import { useTheme } from "./hooks/useTheme";
import { useAmbientColor } from "./hooks/useAmbientColor";
import { TitleBar } from "./components/TitleBar";
import { LoginScreen } from "./components/LoginScreen";
import { Sidebar, type AppView } from "./components/Sidebar";
import { HomeView } from "./components/HomeView";
import { SearchView } from "./components/SearchView";
import { CollectionView } from "./components/CollectionView";
import { LibraryView } from "./components/LibraryView";
import { ArtistView } from "./components/ArtistView";
import { PlayerBar } from "./components/PlayerBar";
import { NowPlayingStage, type TrackTransitionDir } from "./components/NowPlayingStage";
import { TrackContextMenu, type ContextMenuState } from "./components/TrackContextMenu";
import { QueueDrawer } from "./components/QueueDrawer";
import { SettingsModal } from "./components/SettingsModal";
import { CreatePlaylistModal } from "./components/CreatePlaylistModal";
import { Toast, type ToastMessage } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SpotifyApiError } from "./lib/spotifyApi";
import { viewCache } from "./lib/viewCache";
import type {
  SpotifyAlbumSimple,
  SpotifyArtist,
  SpotifyPlaylist,
  UnifiedTrack,
} from "./types/spotify";
import type { NotchPosition, NotchStatePayload } from "./components/DesktopNotch";

type NavDir = "forward" | "back" | "tab";

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
const AUTOPLAY_ENABLED_KEY = "spotidesk.autoplay_enabled";

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

  const handleAutoplayTriggered = useCallback(() => {
    showToast("Reproducción automática: continuando con música similar");
  }, [showToast]);

  const player = useSpotifyPlayer({
    isAuthenticated: auth.isAuthenticated,
    getFreshToken: auth.getFreshToken,
    api: auth.api,
    autoplayEnabled,
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
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [isStageOpen, setIsStageOpen] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState(false);
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

  // Push real-time playback state to the native Windows Top-Center Notch
  const broadcastNotchState = useCallback(() => {
    const payload: NotchStatePayload = {
      track: player.currentTrack,
      isPlaying: player.isPlaying,
      positionMs: player.positionMs,
      durationMs: player.durationMs,
      theme,
      ambientRgb,
      isLiked: isCurrentLiked,
    };
    void invoke("send_notch_state", { payload }).catch(() => {});
  }, [
    player.currentTrack,
    player.isPlaying,
    player.positionMs,
    player.durationMs,
    theme,
    ambientRgb,
    isCurrentLiked,
  ]);

  const broadcastRef = useRef(broadcastNotchState);
  broadcastRef.current = broadcastNotchState;

  useEffect(() => {
    broadcastRef.current();
  }, [
    player.currentTrack?.uri,
    player.isPlaying,
    player.durationMs,
    theme,
    ambientRgb,
    isCurrentLiked,
  ]);

  // Fetch user's playlists once authenticated
  useEffect(() => {
    if (!auth.isAuthenticated) {
      viewCache.clear();
      setPlaylists([]);
      setNavState({ stack: [{ kind: "home" }], index: 0 });
      setIsStageOpen(false);
      setIsQueueOpen(false);
      return;
    }

    let cancelled = false;
    setIsLoadingPlaylists(true);

    (async () => {
      try {
        const page = await auth.api.getUserPlaylists(50, 0);
        if (!cancelled) {
          const valid = (page?.items ?? []).filter(
            (p): p is SpotifyPlaylist => Boolean(p && p.id)
          );
          setPlaylists(valid);
        }
      } catch (err) {
        console.warn("[SpotiDesk] Error cargando playlists:", err);
      } finally {
        if (!cancelled) setIsLoadingPlaylists(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.isAuthenticated, auth.api]);

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

  const handleAddToPlaylist = useCallback(
    async (playlist: SpotifyPlaylist, track: UnifiedTrack) => {
      try {
        await auth.api.addTrackToPlaylist(playlist.id, track.uri);
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
        const nextStack = [...prev.stack.slice(0, prev.index + 1), { kind: "playlist" as const, id: created.id }].slice(-40);
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
          showToast("Eliminada de Tus Me Gusta");
        } else {
          await auth.api.saveTrack(track.id, track.uri);
          if (player.currentTrack?.uri === track.uri) setIsCurrentLiked(true);
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

  const handleOpenContextMenu = useCallback(
    (e: React.MouseEvent, track: UnifiedTrack, index?: number) => {
      setContextMenu({
        track,
        x: e.clientX,
        y: e.clientY,
        index,
      });
    },
    []
  );

  // Keep latest handlers in a ref so the Tauri event listener is registered ONCE
  const notchHandlersRef = useRef({
    togglePlay: () => {
      void player.togglePlay();
    },
    next: handleNextTrack,
    previous: handlePrevTrack,
    toggleLike: handleToggleLikeCurrent,
    requestState: () => broadcastRef.current(),
  });
  notchHandlersRef.current = {
    togglePlay: () => {
      void player.togglePlay();
    },
    next: handleNextTrack,
    previous: handlePrevTrack,
    toggleLike: handleToggleLikeCurrent,
    requestState: () => broadcastRef.current(),
  };

  // Listen to interactive commands from the native Top-Center Desktop Notch
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<string>("notch-action", (event) => {
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
      const markMorph = (el: HTMLElement | null) => {
        if (!el) return;
        el.style.viewTransitionName = "hero-artwork-morph";
        touched.push(el);
      };

      // Assign main-canvas ONLY during in-app view navigation so it never lifts above NowPlayingStage
      if (mainRef.current) {
        mainRef.current.style.viewTransitionName = "main-canvas";
        touched.push(mainRef.current);
      }

      // Assign source artwork morph BEFORE capturing the old snapshot
      let expectingForwardTarget: "artist" | "album" | null = null;
      let expectingBackTarget: { kind: "artist" | "album"; id: string } | null = null;

      if (dir === "forward" && morphSourceEl && morphSourceEl.isConnected) {
        if (nextView.kind === "artist" || nextView.kind === "album") {
          markMorph(morphSourceEl);
          expectingForwardTarget = nextView.kind;
        }
      } else if (dir === "back" && prevView) {
        // Only pair back-morph when target view hydrates synchronously from cache
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
        }
      }

      document.documentElement.dataset.navDir = dir;

      try {
        const vt = doc.startViewTransition(() => {
          flushSync(() => {
            setNavState(nextState);
          });

          // Pair destination artwork BEFORE the browser captures the new snapshot
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

      if (e.altKey && e.key === "ArrowLeft" && !isStageOpen) {
        e.preventDefault();
        handleGoBack();
        return;
      }

      if (e.altKey && e.key === "ArrowRight" && !isStageOpen) {
        e.preventDefault();
        handleGoForward();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        navigateView({ kind: "search" }, { dir: "tab" });
        return;
      }

      if (e.key.toLowerCase() === "f" && !isInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (player.currentTrack && !isSettingsOpen) {
          e.preventDefault();
          setStageWithTransition(!isStageOpen);
        }
        return;
      }

      if (e.code === "Space" && !isInput && target?.tagName !== "BUTTON") {
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
    isSettingsOpen,
    isStageOpen,
    navigateView,
    player,
    setStageWithTransition,
  ]);

  const windowRadiusClass = isWindowMaximized
    ? "rounded-none"
    : isMac
      ? "rounded-[16px]"
      : "rounded-[8px]";

  return (
    <div
      className={`h-screen w-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden relative ${windowRadiusClass}`}
    >
      {/* Crisp subtle window rim matching native rounded corners when windowed */}
      {!isWindowMaximized && (
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
        user={auth.user}
        isSdkReady={player.isSdkReady}
      />

      <Toast toast={toast} />

      {isSettingsOpen && (
        <SettingsModal
          theme={theme}
          ambientEnabled={ambientEnabled}
          autoplayEnabled={autoplayEnabled}
          notchVisible={notchVisible}
          notchPosition={notchPosition}
          closeToTray={closeToTray}
          onToggleTheme={toggleTheme}
          onToggleAmbient={toggleAmbient}
          onToggleAutoplay={setAutoplayEnabled}
          onToggleNotch={() => void handleToggleNotch()}
          onChangeNotchPosition={handleChangeNotchPosition}
          onToggleCloseToTray={setCloseToTray}
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
            <Sidebar
              activeView={activeView}
              playlists={playlists}
              currentUserId={auth.user?.id}
              isLoadingPlaylists={isLoadingPlaylists}
              onSelectView={handleSelectView}
              onCreatePlaylist={() => setIsCreatePlaylistOpen(true)}
            />

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
                  onSelectView={handleSelectView}
                  onPlayPlaylist={(uri) => {
                    setTrackDir("next");
                    void player.playContext({ contextUri: uri, offsetPosition: 0 });
                  }}
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
                  target={activeView}
                  api={auth.api}
                  cachedPlaylist={
                    activeView.kind === "playlist"
                      ? playlists.find((p) => p.id === activeView.id)
                      : undefined
                  }
                  canGoBack={activeView.kind === "album" && canGoBack}
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
                onSelectArtist={(artistId, artistName) =>
                  handleSelectArtist(artistId, null, artistName)
                }
              />
            )}

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
                onToggleLike={handleToggleLike}
                onAddToPlaylist={handleAddToPlaylist}
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
