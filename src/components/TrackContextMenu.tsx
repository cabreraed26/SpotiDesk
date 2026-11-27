import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Disc3,
  Heart,
  Link2,
  ListPlus,
  Loader2,
  Maximize2,
  Play,
  PlusCircle,
  Radio,
  Trash2,
  User,
} from "lucide-react";
import type { SpotifyApiClient } from "../lib/spotifyApi";
import type { SpotifyPlaylist, UnifiedTrack } from "../types/spotify";
import { getBestImage } from "../lib/format";
import { LazyCover } from "./LazyCover";

export interface ContextMenuState {
  track: UnifiedTrack;
  x: number;
  y: number;
  index?: number;
  sourcePlaylistId?: string;
}

interface TrackContextMenuProps {
  menu: ContextMenuState;
  api: SpotifyApiClient;
  writablePlaylists: SpotifyPlaylist[];
  onClose: () => void;
  onPlayNow: (track: UnifiedTrack) => void;
  onAddToQueue: (track: UnifiedTrack) => void;
  onStartRadio?: (track: UnifiedTrack) => void;
  onToggleLike: (track: UnifiedTrack, currentlyLiked: boolean) => Promise<void>;
  onAddToPlaylist: (playlist: SpotifyPlaylist, track: UnifiedTrack) => Promise<void>;
  onRemoveFromPlaylist?: (playlistId: string, track: UnifiedTrack) => Promise<void>;
  onOpenStageWithTrack: (track: UnifiedTrack) => void;
  onGoToArtist?: (artistId: string, artistName?: string) => void;
  onGoToAlbum?: (albumId: string) => void;
  onCopyLink: (track: UnifiedTrack) => void;
}

export function TrackContextMenu({
  menu,
  api,
  writablePlaylists,
  onClose,
  onPlayNow,
  onAddToQueue,
  onStartRadio,
  onToggleLike,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onOpenStageWithTrack,
  onGoToArtist,
  onGoToAlbum,
  onCopyLink,
}: TrackContextMenuProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState({ left: menu.x, top: menu.y });
  const [isLiked, setIsLiked] = useState<boolean | null>(null);
  const [isTogglingLike, setIsTogglingLike] = useState(false);
  const [showPlaylists, setShowPlaylists] = useState(false);

  // Keep menu cleanly inside viewport bounds
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 12;
    const left = Math.min(
      Math.max(margin, menu.x),
      window.innerWidth - rect.width - margin
    );
    const top = Math.min(
      Math.max(48, menu.y),
      window.innerHeight - rect.height - margin
    );
    setCoords({ left, top });
  }, [menu.x, menu.y, showPlaylists]);

  // Query liked status for the selected track
  useEffect(() => {
    let cancelled = false;
    setIsLiked(null);
    if (!menu.track.id) return;
    void api.checkSavedTrack(menu.track.id, menu.track.uri).then((saved) => {
      if (!cancelled) setIsLiked(saved);
    });
    return () => {
      cancelled = true;
    };
  }, [api, menu.track.id, menu.track.uri]);

  // Dismiss on outside click, Escape, or scroll outside the menu
  useEffect(() => {
    const handlePointer = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleScroll = (e: Event) => {
      if (containerRef.current && containerRef.current.contains(e.target as Node)) {
        return;
      }
      onClose();
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  const handleLikeClick = async () => {
    if (isTogglingLike) return;
    setIsTogglingLike(true);
    try {
      await onToggleLike(menu.track, Boolean(isLiked));
      onClose();
    } finally {
      setIsTogglingLike(false);
    }
  };

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label={`Opciones para ${menu.track.name}`}
      className="anim-context-menu chrome-no-select popover-glass fixed z-50 w-64 p-1.5 rounded-2xl border border-[var(--border-subtle)]"
      style={{ left: coords.left, top: coords.top }}
    >
      {/* Track Mini Header */}
      <div className="px-2.5 py-2 flex items-center gap-2.5 border-b border-[var(--border-hairline)] mb-1">
        <LazyCover
          src={menu.track.albumImage}
          alt={menu.track.name}
          className="w-9 h-9"
          iconSize={13}
          roundedClass="rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">
            {menu.track.name}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] truncate">
            {menu.track.artists}
          </div>
        </div>
      </div>

      {/* Primary Actions */}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onPlayNow(menu.track);
          onClose();
        }}
        className="w-full h-9 px-2.5 rounded-xl flex items-center gap-2.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
      >
        <Play size={14} strokeWidth={1.6} />
        Reproducir ahora
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onAddToQueue(menu.track);
          onClose();
        }}
        className="w-full h-9 px-2.5 rounded-xl flex items-center gap-2.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
      >
        <ListPlus size={14} strokeWidth={1.6} />
        Añadir a la cola
      </button>

      {onStartRadio && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onStartRadio(menu.track);
            onClose();
          }}
          className="w-full h-9 px-2.5 rounded-xl flex items-center gap-2.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
        >
          <Radio size={14} strokeWidth={1.6} />
          Iniciar Radio de esta canción
        </button>
      )}

      <button
        type="button"
        role="menuitem"
        disabled={isTogglingLike}
        onClick={() => void handleLikeClick()}
        className="w-full h-9 px-2.5 rounded-xl flex items-center gap-2.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 transition-colors cursor-pointer"
      >
        {isTogglingLike ? (
          <Loader2 size={14} strokeWidth={1.6} className="animate-spin" />
        ) : (
          <Heart
            size={14}
            strokeWidth={1.6}
            fill={isLiked ? "currentColor" : "none"}
          />
        )}
        {isLiked ? "Quitar de Tus Me Gusta" : "Añadir a Tus Me Gusta"}
      </button>

      {/* Expandable Add to Playlist Submenu */}
      {writablePlaylists.length > 0 && (
        <div>
          <button
            type="button"
            role="menuitem"
            aria-expanded={showPlaylists}
            onClick={() => setShowPlaylists((v) => !v)}
            className="w-full h-9 px-2.5 rounded-xl flex items-center justify-between text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2.5">
              <PlusCircle size={14} strokeWidth={1.6} />
              Añadir a playlist
            </span>
            <ChevronRight
              size={13}
              strokeWidth={1.6}
              className={`text-[var(--text-tertiary)] transition-transform duration-200 ${
                showPlaylists ? "rotate-90" : ""
              }`}
            />
          </button>

          {showPlaylists && (
            <div className="mt-1 mb-1 max-h-40 overflow-y-auto pl-2 pr-1 space-y-0.5 border-l border-[var(--border-hairline)] ml-3.5">
              {writablePlaylists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void onAddToPlaylist(playlist, menu.track);
                    onClose();
                  }}
                  className="w-full py-1.5 px-2 rounded-lg flex items-center gap-2 text-left text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                >
                  <LazyCover
                    src={getBestImage(playlist.images, "small")}
                    alt={playlist.name}
                    className="w-6 h-6"
                    iconSize={11}
                    roundedClass="rounded"
                  />
                  <span className="truncate">{playlist.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {menu.sourcePlaylistId &&
        onRemoveFromPlaylist &&
        writablePlaylists.some((p) => p.id === menu.sourcePlaylistId) && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void onRemoveFromPlaylist(menu.sourcePlaylistId!, menu.track);
              onClose();
            }}
            className="w-full h-9 px-2.5 rounded-xl flex items-center gap-2.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <Trash2 size={14} strokeWidth={1.6} />
            Quitar de esta playlist
          </button>
        )}

      <div className="my-1 mx-2 h-px bg-[var(--border-hairline)]" />

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onOpenStageWithTrack(menu.track);
          onClose();
        }}
        className="w-full h-9 px-2.5 rounded-xl flex items-center gap-2.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
      >
        <Maximize2 size={14} strokeWidth={1.5} />
        Ver portada en pantalla
      </button>

      {menu.track.artistId && onGoToArtist && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            const firstArtistName = menu.track.artists.split(",")[0]?.trim();
            onGoToArtist(menu.track.artistId!, firstArtistName);
            onClose();
          }}
          className="w-full h-9 px-2.5 rounded-xl flex items-center gap-2.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
        >
          <User size={14} strokeWidth={1.5} />
          Ir al artista
        </button>
      )}

      {menu.track.albumId && onGoToAlbum && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onGoToAlbum(menu.track.albumId!);
            onClose();
          }}
          className="w-full h-9 px-2.5 rounded-xl flex items-center gap-2.5 text-[12.5px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
        >
          <Disc3 size={14} strokeWidth={1.5} />
          Ir al álbum
        </button>
      )}

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onCopyLink(menu.track);
          onClose();
        }}
        className="w-full h-9 px-2.5 rounded-xl flex items-center gap-2.5 text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
      >
        <Link2 size={14} strokeWidth={1.5} />
        Copiar enlace de Spotify
      </button>
    </div>
  );
}
