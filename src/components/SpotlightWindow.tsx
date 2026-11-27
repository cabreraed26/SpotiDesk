import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  BarChart3,
  Disc3,
  Heart,
  History,
  Home,
  Laptop,
  ListMusic,
  Loader2,
  Maximize2,
  Moon,
  PanelLeftClose,
  PanelTop,
  Pause,
  Play,
  Radio,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Sun,
  Users,
  X,
} from "lucide-react";
import { SpotifyApiClient } from "../lib/spotifyApi";
import type {
  AuthTokenPayload,
  SpotifyDevice,
  SpotifyPlaylist,
  SpotifySearchResults,
  UnifiedTrack,
} from "../types/spotify";
import type { ThemeMode } from "../hooks/useTheme";
import { getBestImage, getPlaylistTrackCount, normalizeTrack } from "../lib/format";
import { LazyCover } from "./LazyCover";

export interface SpotlightStatePayload {
  theme: ThemeMode;
  isPlaying: boolean;
  hasTrack: boolean;
  currentTrack: UnifiedTrack | null;
  playlists: SpotifyPlaylist[];
  devices: SpotifyDevice[];
  notchVisible: boolean;
}

export type SpotlightActionPayload =
  | { type: "play-track"; track: UnifiedTrack }
  | { type: "toggle-play" }
  | { type: "next" }
  | { type: "previous" }
  | { type: "toggle-like" }
  | { type: "start-radio"; track: UnifiedTrack }
  | { type: "transfer-device"; deviceId: string }
  | { type: "toggle-theme" }
  | { type: "toggle-notch" }
  | { type: "open-view"; view: { kind: "home" | "search" | "liked" | "albums" | "artists" } }
  | { type: "open-playlist"; playlist: SpotifyPlaylist }
  | { type: "open-artist"; artistId: string; artistName?: string }
  | { type: "open-album"; albumId: string }
  | { type: "open-stage" }
  | { type: "open-stats" }
  | { type: "open-history" }
  | { type: "toggle-zen" }
  | { type: "open-blend" }
  | { type: "open-settings" };

interface SpotlightItem {
  id: string;
  section:
    | "Canciones en Spotify"
    | "Artistas en Spotify"
    | "Álbumes en Spotify"
    | "Acciones"
    | "Playlists"
    | "Dispositivos"
    | "Navegación";
  label: string;
  subtitle?: string;
  keywords?: string;
  coverUrl?: string;
  isRound?: boolean;
  opensMainWindow?: boolean;
  icon: React.ReactNode;
  action: SpotlightActionPayload;
}

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function readSavedTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem("spotyfast.theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Ignore
  }
  return "dark";
}

export function SpotlightWindow() {
  const [state, setState] = useState<SpotlightStatePayload>(() => ({
    theme: readSavedTheme(),
    isPlaying: false,
    hasTrack: false,
    currentTrack: null,
    playlists: [],
    devices: [],
    notchVisible: true,
  }));
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [remoteResults, setRemoteResults] = useState<SpotifySearchResults | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const api = useMemo(
    () =>
      new SpotifyApiClient({
        getToken: async () => {
          try {
            const payload = await invoke<AuthTokenPayload | null>("get_valid_token");
            return payload?.accessToken ?? null;
          } catch {
            return null;
          }
        },
        forceRefresh: async () => {
          try {
            const payload = await invoke<AuthTokenPayload>("refresh_spotify_token");
            return payload?.accessToken ?? null;
          } catch {
            return null;
          }
        },
      }),
    []
  );

  useEffect(() => {
    document.documentElement.dataset.window = "spotlight";
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  // Listen to state broadcasts & focus reset whenever Spotlight pops up
  useEffect(() => {
    let unlistenState: (() => void) | undefined;
    let unlistenOpened: (() => void) | undefined;

    void listen<SpotlightStatePayload>("spotlight-state", (e) => {
      if (e.payload) setState(e.payload);
    }).then((fn) => {
      unlistenState = fn;
      // Pull authoritative state immediately on lazy first-mount so playlists/devices appear right away
      void invoke("request_spotlight_state").catch(() => {});
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    });

    void listen("spotlight-opened", () => {
      setQuery("");
      setRemoteResults(null);
      setActiveIndex(0);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }).then((fn) => {
      unlistenOpened = fn;
    });

    return () => {
      unlistenState?.();
      unlistenOpened?.();
    };
  }, []);

  // Debounced live Spotify search right inside the floating Spotlight window
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setRemoteResults(null);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    const timer = window.setTimeout(() => {
      if (api.isRateLimited()) {
        if (!cancelled) setIsSearching(false);
        return;
      }
      void api
        .search(trimmed, 5)
        .then((res) => {
          if (!cancelled) setRemoteResults(res);
        })
        .catch(() => {
          if (!cancelled) setRemoteResults(null);
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, query]);

  const baseItems = useMemo<SpotlightItem[]>(() => {
    const actions: SpotlightItem[] = [
      {
        id: "act-play",
        section: "Acciones",
        label: state.isPlaying ? "Pausar reproducción" : "Reanudar reproducción",
        subtitle: state.currentTrack?.name,
        keywords: "play pause musica reproducir",
        icon: state.isPlaying ? (
          <Pause size={14} strokeWidth={1.6} />
        ) : (
          <Play size={14} strokeWidth={1.6} />
        ),
        action: { type: "toggle-play" },
      },
      {
        id: "act-next",
        section: "Acciones",
        label: "Siguiente canción",
        keywords: "next skip adelantar",
        icon: <SkipForward size={14} strokeWidth={1.6} />,
        action: { type: "next" },
      },
      {
        id: "act-prev",
        section: "Acciones",
        label: "Canción anterior",
        keywords: "previous atras",
        icon: <SkipBack size={14} strokeWidth={1.6} />,
        action: { type: "previous" },
      },
    ];

    if (state.hasTrack && state.currentTrack) {
      actions.push(
        {
          id: "act-like",
          section: "Acciones",
          label: "Alternar Me Gusta en canción actual",
          keywords: "favorito corazon like",
          icon: <Heart size={14} strokeWidth={1.6} />,
          action: { type: "toggle-like" },
        },
        {
          id: "act-radio",
          section: "Acciones",
          label: `Radio instantánea de «${state.currentTrack.name}»`,
          keywords: "radio mix similares",
          icon: <Radio size={14} strokeWidth={1.6} />,
          action: { type: "start-radio", track: state.currentTrack },
        },
        {
          id: "act-stage",
          section: "Acciones",
          label: "Abrir Vista Inmersiva, Vinilo y Desk",
          keywords: "letras lyrics vinilo desk standby",
          opensMainWindow: true,
          icon: <Maximize2 size={14} strokeWidth={1.6} />,
          action: { type: "open-stage" },
        }
      );
    }

    actions.push(
      {
        id: "act-blend",
        section: "Acciones",
        label: "Blend Session · Mezclar playlists",
        keywords: "mezclar blend combinar playlists",
        opensMainWindow: true,
        icon: <Shuffle size={14} strokeWidth={1.6} />,
        action: { type: "open-blend" },
      },
      {
        id: "act-zen",
        section: "Acciones",
        label: "Alternar Modo Enfoque / Zen",
        keywords: "zen focus enfoque concentracion lluvia",
        icon: <PanelLeftClose size={14} strokeWidth={1.6} />,
        action: { type: "toggle-zen" },
      },
      {
        id: "act-history",
        section: "Acciones",
        label: "Historial de reproducción completo",
        keywords: "historial recientes hoy ayer",
        opensMainWindow: true,
        icon: <History size={14} strokeWidth={1.6} />,
        action: { type: "open-history" },
      },
      {
        id: "act-stats",
        section: "Acciones",
        label: "Ver Tu semana en SpotiDesk",
        keywords: "estadisticas wrapped poster",
        opensMainWindow: true,
        icon: <BarChart3 size={14} strokeWidth={1.6} />,
        action: { type: "open-stats" },
      },
      {
        id: "act-theme",
        section: "Acciones",
        label:
          state.theme === "dark"
            ? "Cambiar a Modo Claro (Porcelain)"
            : "Cambiar a Modo Oscuro (Obsidian)",
        keywords: "tema oscuro claro",
        icon:
          state.theme === "dark" ? (
            <Sun size={14} strokeWidth={1.6} />
          ) : (
            <Moon size={14} strokeWidth={1.6} />
          ),
        action: { type: "toggle-theme" },
      },
      {
        id: "act-notch",
        section: "Acciones",
        label: state.notchVisible ? "Ocultar Notch flotante" : "Mostrar Notch flotante",
        keywords: "notch isla burbuja",
        icon: <PanelTop size={14} strokeWidth={1.6} />,
        action: { type: "toggle-notch" },
      },
      {
        id: "act-settings",
        section: "Acciones",
        label: "Abrir Ajustes de SpotiDesk",
        keywords: "ajustes configuracion atajos shortcuts",
        opensMainWindow: true,
        icon: <Settings size={14} strokeWidth={1.6} />,
        action: { type: "open-settings" },
      }
    );

    const nav: SpotlightItem[] = [
      {
        id: "nav-home",
        section: "Navegación",
        label: "Abrir SpotiDesk (Inicio)",
        keywords: "inicio home abrir app",
        opensMainWindow: true,
        icon: <Home size={14} strokeWidth={1.6} />,
        action: { type: "open-view", view: { kind: "home" } },
      },
      {
        id: "nav-liked",
        section: "Navegación",
        label: "Ir a Tus Me Gusta",
        keywords: "favoritas biblioteca",
        opensMainWindow: true,
        icon: <Heart size={14} strokeWidth={1.6} />,
        action: { type: "open-view", view: { kind: "liked" } },
      },
    ];

    const plItems: SpotlightItem[] = state.playlists.map((pl) => ({
      id: `pl-${pl.id}`,
      section: "Playlists",
      label: pl.name,
      subtitle: `${getPlaylistTrackCount(pl)} canciones`,
      keywords: `playlist ${pl.owner?.display_name ?? ""}`,
      coverUrl: getBestImage(pl.images, "small"),
      opensMainWindow: true,
      icon: <ListMusic size={14} strokeWidth={1.6} />,
      action: { type: "open-playlist", playlist: pl },
    }));

    const devItems: SpotlightItem[] = state.devices
      .filter((d) => Boolean(d.id))
      .map((d) => ({
        id: `dev-${d.id}`,
        section: "Dispositivos",
        label: `Reproducir en ${d.name}`,
        subtitle: d.is_active ? "Activo" : d.type,
        keywords: `device connect altavoz ${d.type}`,
        icon: <Laptop size={14} strokeWidth={1.6} />,
        action: { type: "transfer-device", deviceId: d.id! },
      }));

    return [...actions, ...devItems, ...plItems, ...nav];
  }, [state]);

  const filtered = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return baseItems.slice(0, 14);

    const liveItems: SpotlightItem[] = [];
    if (remoteResults) {
      for (const t of (remoteResults.tracks?.items ?? []).filter((x) => Boolean(x?.uri)).slice(0, 5)) {
        const unified = normalizeTrack(t);
        liveItems.push({
          id: `live-track-${unified.uri}`,
          section: "Canciones en Spotify",
          label: unified.name,
          subtitle: unified.artists,
          coverUrl: unified.albumImage,
          icon: <Play size={13} strokeWidth={1.8} />,
          action: { type: "play-track", track: unified },
        });
      }
      for (const a of (remoteResults.artists?.items ?? []).filter((x) => Boolean(x?.id)).slice(0, 3)) {
        liveItems.push({
          id: `live-artist-${a.id}`,
          section: "Artistas en Spotify",
          label: a.name,
          subtitle: "Artista",
          coverUrl: getBestImage(a.images, "small"),
          isRound: true,
          opensMainWindow: true,
          icon: <Users size={13} strokeWidth={1.6} />,
          action: { type: "open-artist", artistId: a.id, artistName: a.name },
        });
      }
      for (const al of (remoteResults.albums?.items ?? []).filter((x) => Boolean(x?.id)).slice(0, 2)) {
        liveItems.push({
          id: `live-album-${al.id}`,
          section: "Álbumes en Spotify",
          label: al.name,
          subtitle: (al.artists ?? []).map((a) => a.name).join(", ") || "Álbum",
          coverUrl: getBestImage(al.images, "small"),
          opensMainWindow: true,
          icon: <Disc3 size={13} strokeWidth={1.6} />,
          action: { type: "open-album", albumId: al.id },
        });
      }
    }

    const localMatches = baseItems
      .filter((item) => {
        const hay = fold(`${item.label} ${item.subtitle ?? ""} ${item.keywords ?? ""} ${item.section}`);
        return hay.includes(q);
      })
      .slice(0, 8);

    // Put live Spotify songs FIRST when typing a query so Enter plays instantly!
    return [...liveItems, ...localMatches];
  }, [baseItems, query, remoteResults]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const executeItem = (item: SpotlightItem) => {
    void invoke("send_spotlight_action", { payload: item.action });
    if (item.opensMainWindow) {
      void invoke("show_main_window");
    } else {
      void invoke("hide_spotlight");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void invoke("hide_spotlight");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) =>
          filtered.length ? (i - 1 + filtered.length) % filtered.length : 0
        );
      } else if (e.key === "Enter" && filtered[activeIndex]) {
        e.preventDefault();
        executeItem(filtered[activeIndex]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, filtered]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-sp-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div className="w-screen h-screen bg-transparent p-3 flex items-start justify-center select-none">
      <div className="anim-context-menu popover-glass w-full max-h-full rounded-2xl border border-[var(--border-subtle)] overflow-hidden shadow-2xl flex flex-col">
        {/* Search Input */}
        <div className="px-4 h-13 shrink-0 border-b border-[var(--border-hairline)] flex items-center gap-3">
          <Search size={16} strokeWidth={1.6} className="text-[var(--text-tertiary)] shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="SpotiDesk Spotlight · Buscar canción, playlist o acción..."
            aria-label="SpotiDesk Spotlight"
            className="flex-1 bg-transparent text-[14.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
          />
          {isSearching && (
            <Loader2 size={14} strokeWidth={1.7} className="animate-spin text-[var(--text-tertiary)] shrink-0" />
          )}
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpiar"
              className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X size={13} strokeWidth={1.6} />
            </button>
          )}
          <kbd className="px-1.5 py-0.5 rounded border border-[var(--border-hairline)] text-[10px] font-mono text-[var(--text-tertiary)]">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="flex-1 min-h-0 max-h-[380px] overflow-y-auto p-2 space-y-0.5">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-[var(--text-secondary)]">
              Sin coincidencias para “{query}”.
            </p>
          ) : (
            filtered.map((item, idx) => {
              const showHeader = idx === 0 || filtered[idx - 1].section !== item.section;
              const isActive = idx === activeIndex;
              return (
                <div key={item.id}>
                  {showHeader && (
                    <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-medium uppercase tracking-[0.09em] text-[var(--text-tertiary)]">
                      {item.section}
                    </div>
                  )}
                  <button
                    type="button"
                    data-sp-index={idx}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => executeItem(item)}
                    className={`w-full px-2.5 py-2 rounded-xl flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                      isActive
                        ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      {item.coverUrl ? (
                        <LazyCover
                          src={item.coverUrl}
                          alt={item.label}
                          className="w-6 h-6"
                          iconSize={11}
                          roundedClass={item.isRound ? "rounded-full" : "rounded"}
                        />
                      ) : (
                        <span className="w-6 h-6 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-hairline)] flex items-center justify-center shrink-0 text-[var(--text-primary)]">
                          {item.icon}
                        </span>
                      )}
                      <span className="text-[13px] font-medium truncate">{item.label}</span>
                    </span>
                    {item.subtitle && (
                      <span className="text-[11px] text-[var(--text-tertiary)] shrink-0 truncate max-w-[170px]">
                        {item.subtitle}
                      </span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
