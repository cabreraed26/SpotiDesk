import { useEffect, useMemo, useRef, useState } from "react";
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
  PictureInPicture2,
  Play,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Sun,
  Timer,
  Users,
  X,
} from "lucide-react";
import type {
  SpotifyAlbumSimple,
  SpotifyArtist,
  SpotifyDevice,
  SpotifyPlaylist,
  SpotifySearchResults,
  UnifiedTrack,
} from "../types/spotify";
import type { SpotifyApiClient } from "../lib/spotifyApi";
import type { ThemeMode } from "../hooks/useTheme";
import type { SleepTimerState } from "../hooks/useSleepTimer";
import type { AppView } from "./Sidebar";
import { getBestImage, getPlaylistTrackCount, normalizeTrack } from "../lib/format";
import { LazyCover } from "./LazyCover";

interface CommandItem {
  id: string;
  section:
    | "Acciones"
    | "Navegación"
    | "Playlists"
    | "Dispositivos"
    | "Canciones en Spotify"
    | "Artistas en Spotify"
    | "Álbumes en Spotify";
  label: string;
  subtitle?: string;
  keywords?: string;
  coverUrl?: string;
  isRound?: boolean;
  icon: React.ReactNode;
  onSelect: () => void;
}

interface CommandPaletteProps {
  api: SpotifyApiClient;
  playlists: SpotifyPlaylist[];
  devices: SpotifyDevice[];
  isPlaying: boolean;
  hasTrack: boolean;
  theme: ThemeMode;
  ambientEnabled: boolean;
  notchVisible: boolean;
  sleepTimer: SleepTimerState;
  onSelectView: (view: AppView) => void;
  onPlayTrack: (track: UnifiedTrack) => void;
  onSelectArtist: (artist: SpotifyArtist) => void;
  onSelectAlbum: (album: SpotifyAlbumSimple) => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onToggleLikeCurrent: () => void;
  onOpenStage: () => void;
  onToggleQueue: () => void;
  onToggleTheme: () => void;
  onToggleAmbient: () => void;
  onToggleNotch: () => void;
  onToggleMiniPlayer: () => void;
  onOpenStats: () => void;
  onOpenHistory?: () => void;
  onToggleZenMode?: () => void;
  zenMode?: boolean;
  onOpenBlendSession?: () => void;
  onOpenSettings: () => void;
  onTransferDevice: (deviceId: string) => void;
  onClose: () => void;
}

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function CommandPalette({
  api,
  playlists,
  devices,
  isPlaying,
  hasTrack,
  theme,
  ambientEnabled,
  notchVisible,
  sleepTimer,
  onSelectView,
  onPlayTrack,
  onSelectArtist,
  onSelectAlbum,
  onTogglePlay,
  onNext,
  onPrevious,
  onToggleLikeCurrent,
  onOpenStage,
  onToggleQueue,
  onToggleTheme,
  onToggleAmbient,
  onToggleNotch,
  onToggleMiniPlayer,
  onOpenStats,
  onOpenHistory,
  onToggleZenMode,
  zenMode = false,
  onOpenBlendSession,
  onOpenSettings,
  onTransferDevice,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [remoteResults, setRemoteResults] = useState<SpotifySearchResults | null>(null);
  const [isSearchingRemote, setIsSearchingRemote] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced live Spotify Spotlight search when user types >= 2 chars
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setRemoteResults(null);
      setIsSearchingRemote(false);
      return;
    }

    let cancelled = false;
    setIsSearchingRemote(true);
    const timer = window.setTimeout(() => {
      if (api.isRateLimited()) {
        if (!cancelled) setIsSearchingRemote(false);
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
          if (!cancelled) setIsSearchingRemote(false);
        });
    }, 360);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, query]);

  const items = useMemo<CommandItem[]>(() => {
    const actions: CommandItem[] = [
      {
        id: "act-play",
        section: "Acciones",
        label: isPlaying ? "Pausar reproducción" : "Reanudar reproducción",
        subtitle: "Espacio",
        keywords: "play pause musica reproducir",
        icon: isPlaying ? <Pause size={15} strokeWidth={1.6} /> : <Play size={15} strokeWidth={1.6} />,
        onSelect: onTogglePlay,
      },
      {
        id: "act-next",
        section: "Acciones",
        label: "Siguiente canción",
        keywords: "next skip adelantar",
        icon: <SkipForward size={15} strokeWidth={1.6} />,
        onSelect: onNext,
      },
      {
        id: "act-prev",
        section: "Acciones",
        label: "Canción anterior",
        keywords: "previous atras",
        icon: <SkipBack size={15} strokeWidth={1.6} />,
        onSelect: onPrevious,
      },
    ];

    if (hasTrack) {
      actions.push(
        {
          id: "act-like",
          section: "Acciones",
          label: "Alternar Me Gusta en la canción actual",
          keywords: "favorito corazon like",
          icon: <Heart size={15} strokeWidth={1.6} />,
          onSelect: onToggleLikeCurrent,
        },
        {
          id: "act-stage",
          section: "Acciones",
          label: "Abrir Vista Inmersiva, Vinilo y Modo Desk",
          subtitle: "F",
          keywords: "lyrics letra portada pantalla completa vinilo desk reloj standby",
          icon: <Maximize2 size={15} strokeWidth={1.6} />,
          onSelect: onOpenStage,
        }
      );
    }

    if (onOpenBlendSession) {
      actions.push({
        id: "act-blend",
        section: "Acciones",
        label: "Blend Session · Mezclar playlists al vuelo",
        keywords: "mezclar blend combinar playlists mix",
        icon: <Shuffle size={15} strokeWidth={1.6} />,
        onSelect: onOpenBlendSession,
      });
    }

    if (onToggleZenMode) {
      actions.push({
        id: "act-zen",
        section: "Acciones",
        label: zenMode ? "Salir del Modo Enfoque / Zen" : "Activar Modo Enfoque / Zen (1 clic)",
        keywords: "zen enfoque focus concentracion lluvia sidebar",
        icon: <PanelLeftClose size={15} strokeWidth={1.6} />,
        onSelect: onToggleZenMode,
      });
    }

    if (onOpenHistory) {
      actions.push({
        id: "act-history",
        section: "Acciones",
        label: "Abrir Historial completo de reproducción",
        keywords: "historial recientes ayer hoy canciones escuchadas",
        icon: <History size={15} strokeWidth={1.6} />,
        onSelect: onOpenHistory,
      });
    }

    actions.push(
      {
        id: "act-queue",
        section: "Acciones",
        label: "Abrir / cerrar Cola de reproducción",
        keywords: "queue cola siguientes",
        icon: <ListMusic size={15} strokeWidth={1.6} />,
        onSelect: onToggleQueue,
      },
      {
        id: "act-timer-15",
        section: "Acciones",
        label:
          sleepTimer.mode !== "off"
            ? `Desactivar temporizador (${sleepTimer.label})`
            : "Temporizador: pausar en 30 minutos",
        keywords: "sleep timer dormir apagar reloj",
        icon: <Timer size={15} strokeWidth={1.6} />,
        onSelect: () => {
          if (sleepTimer.mode !== "off") sleepTimer.cancel();
          else sleepTimer.setMinutes(30);
        },
      },
      {
        id: "act-timer-end",
        section: "Acciones",
        label: "Temporizador: pausar al terminar esta canción",
        keywords: "sleep timer fin cancion",
        icon: <Timer size={15} strokeWidth={1.6} />,
        onSelect: () => sleepTimer.setEndOfTrack(),
      },
      {
        id: "act-theme",
        section: "Acciones",
        label: theme === "dark" ? "Cambiar a Modo Claro (Porcelain)" : "Cambiar a Modo Oscuro (Obsidian)",
        keywords: "tema claro oscuro dark light",
        icon: theme === "dark" ? <Sun size={15} strokeWidth={1.6} /> : <Moon size={15} strokeWidth={1.6} />,
        onSelect: onToggleTheme,
      },
      {
        id: "act-ambient",
        section: "Acciones",
        label: ambientEnabled ? "Desactivar resplandor ambiental" : "Activar resplandor ambiental",
        keywords: "color glow brillo fondo",
        icon: <Sparkles size={15} strokeWidth={1.6} />,
        onSelect: onToggleAmbient,
      },
      {
        id: "act-notch",
        section: "Acciones",
        label: notchVisible ? "Ocultar Notch flotante" : "Mostrar Notch flotante",
        keywords: "widget isla dinamica burbuja",
        icon: <PanelTop size={15} strokeWidth={1.6} />,
        onSelect: onToggleNotch,
      },
      {
        id: "act-mini",
        section: "Acciones",
        label: "Activar Modo Mini-Reproductor",
        keywords: "mini player pip flotante ventana compacta",
        icon: <PictureInPicture2 size={15} strokeWidth={1.6} />,
        onSelect: onToggleMiniPlayer,
      },
      {
        id: "act-stats",
        section: "Acciones",
        label: "Ver estadísticas (Tu semana en SpotiDesk)",
        keywords: "stats wrapped minutos top artistas canciones",
        icon: <BarChart3 size={15} strokeWidth={1.6} />,
        onSelect: onOpenStats,
      },
      {
        id: "act-settings",
        section: "Acciones",
        label: "Abrir Ajustes de SpotiDesk",
        keywords: "configuracion preferencias cuenta",
        icon: <Settings size={15} strokeWidth={1.6} />,
        onSelect: onOpenSettings,
      }
    );

    const nav: CommandItem[] = [
      {
        id: "nav-home",
        section: "Navegación",
        label: "Ir a Inicio",
        keywords: "home portada",
        icon: <Home size={15} strokeWidth={1.6} />,
        onSelect: () => onSelectView({ kind: "home" }),
      },
      {
        id: "nav-search",
        section: "Navegación",
        label: "Ir a Buscar en Spotify",
        keywords: "search explorar",
        icon: <Search size={15} strokeWidth={1.6} />,
        onSelect: () => onSelectView({ kind: "search" }),
      },
      {
        id: "nav-liked",
        section: "Navegación",
        label: "Ir a Tus Me Gusta",
        keywords: "favoritas biblioteca",
        icon: <Heart size={15} strokeWidth={1.6} />,
        onSelect: () => onSelectView({ kind: "liked" }),
      },
      {
        id: "nav-albums",
        section: "Navegación",
        label: "Ir a Álbumes",
        keywords: "discos biblioteca",
        icon: <Disc3 size={15} strokeWidth={1.6} />,
        onSelect: () => onSelectView({ kind: "albums" }),
      },
      {
        id: "nav-artists",
        section: "Navegación",
        label: "Ir a Artistas",
        keywords: "seguidos cantantes",
        icon: <Users size={15} strokeWidth={1.6} />,
        onSelect: () => onSelectView({ kind: "artists" }),
      },
    ];

    const plItems: CommandItem[] = playlists.map((pl) => ({
      id: `pl-${pl.id}`,
      section: "Playlists",
      label: pl.name,
      subtitle: `${getPlaylistTrackCount(pl)} canciones`,
      keywords: `playlist ${pl.owner?.display_name ?? ""}`,
      coverUrl: getBestImage(pl.images, "small"),
      icon: <ListMusic size={14} strokeWidth={1.6} />,
      onSelect: () => onSelectView({ kind: "playlist", id: pl.id, seedPlaylist: pl }),
    }));

    const devItems: CommandItem[] = devices
      .filter((d) => Boolean(d.id))
      .map((d) => ({
        id: `dev-${d.id}`,
        section: "Dispositivos",
        label: `Reproducir en ${d.name}`,
        subtitle: d.is_active ? "Activo" : d.type,
        keywords: `device connect altavoz ${d.type}`,
        icon: <Laptop size={15} strokeWidth={1.6} />,
        onSelect: () => onTransferDevice(d.id!),
      }));

    return [...actions, ...nav, ...devItems, ...plItems];
  }, [
    ambientEnabled,
    devices,
    hasTrack,
    isPlaying,
    notchVisible,
    onNext,
    onOpenSettings,
    onOpenStage,
    onPrevious,
    onSelectView,
    onToggleAmbient,
    onToggleLikeCurrent,
    onToggleMiniPlayer,
    onToggleNotch,
    onOpenStats,
    onTogglePlay,
    onToggleQueue,
    onToggleTheme,
    onTransferDevice,
    playlists,
    sleepTimer,
    theme,
  ]);

  const filtered = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return items.slice(0, 18);

    const localMatches = items
      .filter((item) => {
        const hay = fold(`${item.label} ${item.subtitle ?? ""} ${item.keywords ?? ""} ${item.section}`);
        return hay.includes(q);
      })
      .slice(0, 10);

    const liveItems: CommandItem[] = [];
    if (remoteResults) {
      const tracks = (remoteResults.tracks?.items ?? [])
        .filter((t) => Boolean(t && t.uri))
        .slice(0, 5);
      for (const t of tracks) {
        const unified = normalizeTrack(t);
        liveItems.push({
          id: `live-track-${unified.uri}`,
          section: "Canciones en Spotify",
          label: unified.name,
          subtitle: unified.artists,
          coverUrl: unified.albumImage,
          icon: <Play size={13} strokeWidth={1.8} />,
          onSelect: () => onPlayTrack(unified),
        });
      }

      const artists = (remoteResults.artists?.items ?? [])
        .filter((a) => Boolean(a && a.id))
        .slice(0, 3);
      for (const a of artists) {
        liveItems.push({
          id: `live-artist-${a.id}`,
          section: "Artistas en Spotify",
          label: a.name,
          subtitle: "Artista",
          coverUrl: getBestImage(a.images, "small"),
          isRound: true,
          icon: <Users size={13} strokeWidth={1.6} />,
          onSelect: () => onSelectArtist(a),
        });
      }

      const albums = (remoteResults.albums?.items ?? [])
        .filter((al) => Boolean(al && al.id))
        .slice(0, 3);
      for (const al of albums) {
        liveItems.push({
          id: `live-album-${al.id}`,
          section: "Álbumes en Spotify",
          label: al.name,
          subtitle: (al.artists ?? []).map((a) => a.name).join(", ") || "Álbum",
          coverUrl: getBestImage(al.images, "small"),
          icon: <Disc3 size={13} strokeWidth={1.6} />,
          onSelect: () => onSelectAlbum(al),
        });
      }
    }

    return [...localMatches, ...liveItems];
  }, [items, onPlayTrack, onSelectAlbum, onSelectArtist, query, remoteResults]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
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
        filtered[activeIndex].onSelect();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, filtered, onClose]);

  useEffect(() => {
    const activeEl = listRef.current?.querySelector<HTMLElement>(
      `[data-cmd-index="${activeIndex}"]`
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Paleta rápida de SpotiDesk"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="anim-stage-backdrop fixed inset-0 top-10 z-55 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
    >
      <div className="anim-context-menu popover-glass w-full max-w-[540px] rounded-2xl border border-[var(--border-subtle)] overflow-hidden shadow-2xl">
        {/* Search Input */}
        <div className="px-4 h-13 border-b border-[var(--border-hairline)] flex items-center gap-3">
          <Search size={16} strokeWidth={1.6} className="text-[var(--text-tertiary)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cualquier canción en Spotify, playlist o acción..."
            aria-label="Buscar comando, canción o playlist"
            className="flex-1 bg-transparent text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
          />
          {isSearchingRemote && (
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
        <div ref={listRef} className="max-h-[54vh] overflow-y-auto p-2 space-y-0.5">
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
                    data-cmd-index={idx}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => {
                      item.onSelect();
                      onClose();
                    }}
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
                      <span className="text-[11px] text-[var(--text-tertiary)] shrink-0 tabular-nums">
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
