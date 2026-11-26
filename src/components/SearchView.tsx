import { useEffect, useRef, useState } from "react";
import { Loader2, MoreHorizontal, Pause, Play, Search, User, X } from "lucide-react";
import type { SpotifyApiClient } from "../lib/spotifyApi";
import type {
  SpotifyAlbumSimple,
  SpotifyArtist,
  SpotifySearchResults,
  UnifiedTrack,
} from "../types/spotify";
import { formatDuration, getBestImage, normalizeTrack } from "../lib/format";
import { LazyCover } from "./LazyCover";

interface SearchViewProps {
  api: SpotifyApiClient;
  currentTrackUri?: string;
  isPlaying: boolean;
  onPlayContext: (options: {
    contextUri?: string;
    uris?: string[];
    offsetPosition?: number;
    offsetUri?: string;
  }) => Promise<void>;
  onTogglePlay: () => void;
  onSelectAlbum: (albumId: string) => void;
  onTrackContextMenu?: (e: React.MouseEvent, track: UnifiedTrack) => void;
}

export function SearchView({
  api,
  currentTrackUri,
  isPlaying,
  onPlayContext,
  onTogglePlay,
  onSelectAlbum,
  onTrackContextMenu,
}: SearchViewProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SpotifySearchResults | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 300ms debounced instant search
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setIsSearching(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    setError(null);

    const timer = window.setTimeout(async () => {
      try {
        const data = await api.search(trimmed, 8);
        if (!cancelled) {
          setResults(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Error buscando en Spotify.");
        }
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, query]);

  const tracks = (results?.tracks?.items ?? []).filter(Boolean).map(normalizeTrack);
  const albums = (results?.albums?.items ?? []).filter(Boolean);
  const artists = (results?.artists?.items ?? []).filter(Boolean);

  const handlePlayArtist = async (artist: SpotifyArtist) => {
    try {
      await onPlayContext({ contextUri: artist.uri });
    } catch {
      try {
        const { tracks: topTracks } = await api.getArtistTopTracks(artist.id);
        if (topTracks.length > 0) {
          await onPlayContext({ uris: topTracks.map((t) => t.uri), offsetPosition: 0 });
        }
      } catch {
        // Ignore
      }
    }
  };

  const handlePlayAlbum = async (album: SpotifyAlbumSimple) => {
    await onPlayContext({ contextUri: album.uri, offsetPosition: 0 });
  };

  return (
    <div className="anim-view-enter flex-1 overflow-y-auto px-8 pt-7 pb-32">
      {/* Minimalist Search Bar */}
      <div className="max-w-[640px]">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-[var(--text-primary)] mb-5">
          Buscar
        </h1>

        <div className="relative flex items-center">
          <Search
            size={16}
            strokeWidth={1.5}
            className="pointer-events-none absolute left-4 text-[var(--text-secondary)]"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Canciones, álbumes o artistas..."
            aria-label="Buscar en Spotify"
            className="w-full h-11 pl-11 pr-10 rounded-xl text-[14px] bg-[var(--bg-elevated)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border border-[var(--border-hairline)] focus:outline-none focus:border-[var(--border-subtle)] transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Limpiar búsqueda"
              className="absolute right-3 w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      {isSearching && (
        <div className="mt-10 flex items-center gap-2.5 text-[13px] text-[var(--text-secondary)]">
          <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
          Buscando...
        </div>
      )}

      {error && (
        <p className="mt-8 text-[13px] text-[var(--text-secondary)]">{error}</p>
      )}

      {!query.trim() && !isSearching && (
        <div className="mt-20 max-w-[360px]">
          <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed">
            Encuentra instantáneamente cualquier pista, disco o artista del catálogo de Spotify.
          </p>
          <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">
            Atajo rápido: <kbd className="px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[11px]">Ctrl + K</kbd>
          </p>
        </div>
      )}

      {results && !isSearching && (
        <div className="mt-9 space-y-11">
          {/* Songs */}
          {tracks.length > 0 && (
            <section>
              <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)] mb-3.5">
                Canciones
              </h2>
              <div className="divide-y divide-[var(--border-hairline)] border-y border-[var(--border-hairline)]">
                {tracks.map((track) => {
                  const isCurrent = currentTrackUri === track.uri;
                  return (
                    <div
                      key={track.id}
                      role="button"
                      tabIndex={0}
                      onContextMenu={(e) => {
                        if (onTrackContextMenu) {
                          e.preventDefault();
                          onTrackContextMenu(e, track);
                        }
                      }}
                      onClick={() => {
                        if (isCurrent) onTogglePlay();
                        else void onPlayContext({ uris: [track.uri] });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (isCurrent) onTogglePlay();
                          else void onPlayContext({ uris: [track.uri] });
                        }
                      }}
                      className={`group flex items-center gap-3.5 px-3 py-2.5 transition-colors duration-150 cursor-pointer ${
                        isCurrent ? "bg-[var(--bg-active)]" : "hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <div className="relative">
                        <LazyCover
                          src={track.albumImage}
                          alt={track.name}
                          className="w-10 h-10"
                          iconSize={14}
                        />
                        <div className="absolute inset-0 rounded-md bg-black/55 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                          {isCurrent && isPlaying ? (
                            <Pause size={14} strokeWidth={1.6} />
                          ) : (
                            <Play size={14} strokeWidth={1.6} />
                          )}
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-medium text-[var(--text-primary)] truncate">
                          {track.name}
                        </div>
                        <div className="text-[12px] text-[var(--text-secondary)] truncate">
                          {track.artists}
                        </div>
                      </div>

                      <div className="hidden md:block min-w-0 max-w-[220px]">
                        {track.albumId ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectAlbum(track.albumId!);
                            }}
                            className="text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline truncate block cursor-pointer"
                          >
                            {track.albumName}
                          </button>
                        ) : (
                          <span className="text-[12px] text-[var(--text-secondary)] truncate block">
                            {track.albumName}
                          </span>
                        )}
                      </div>

                      {onTrackContextMenu && (
                        <button
                          type="button"
                          aria-label={`Más opciones para ${track.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onTrackContextMenu(e, track);
                          }}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-active)] transition-all cursor-pointer"
                        >
                          <MoreHorizontal size={14} strokeWidth={1.6} />
                        </button>
                      )}

                      <span className="text-[12px] tabular-nums text-[var(--text-secondary)] pl-1">
                        {formatDuration(track.durationMs)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Albums */}
          {albums.length > 0 && (
            <section>
              <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)] mb-4">
                Álbumes
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
                {albums.map((album) => (
                  <div
                    key={album.id}
                    onClick={() => onSelectAlbum(album.id)}
                    className="group playlist-card-zoom p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] hover:border-[var(--border-subtle)] cursor-pointer"
                  >
                    <div className="playlist-cover-zoom relative aspect-square mb-3">
                      <LazyCover
                        src={getBestImage(album.images, "medium")}
                        alt={album.name}
                        className="w-full h-full"
                        iconSize={26}
                        roundedClass="rounded-lg"
                      />
                      <button
                        type="button"
                        aria-label={`Reproducir ${album.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handlePlayAlbum(album);
                        }}
                        className="chrome-no-select absolute right-2.5 bottom-2.5 w-9 h-9 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] shadow-lg flex items-center justify-center opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 ease-apple cursor-pointer"
                      >
                        <Play size={14} strokeWidth={1.8} fill="currentColor" />
                      </button>
                    </div>
                    <div className="text-[13px] font-medium text-[var(--text-primary)] truncate tracking-[-0.01em]">
                      {album.name}
                    </div>
                    <div className="text-[12px] text-[var(--text-secondary)] truncate mt-0.5">
                      {(album.artists ?? []).map((a) => a.name).join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Artists */}
          {artists.length > 0 && (
            <section>
              <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)] mb-4">
                Artistas
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-5">
                {artists.map((artist) => {
                  const avatar = getBestImage(artist.images, "medium");
                  return (
                    <button
                      key={artist.id}
                      type="button"
                      onClick={() => void handlePlayArtist(artist)}
                      className="group p-3.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] hover:border-[var(--border-subtle)] flex flex-col items-center text-center transition-all duration-200 ease-apple cursor-pointer"
                    >
                      <div className="relative w-24 h-24 rounded-full overflow-hidden bg-[var(--bg-card)] border border-[var(--border-hairline)] flex items-center justify-center mb-3">
                        {avatar ? (
                          <img
                            src={avatar}
                            alt={artist.name}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ease-apple"
                          />
                        ) : (
                          <User size={28} strokeWidth={1.5} className="text-[var(--text-tertiary)]" />
                        )}
                      </div>
                      <div className="text-[13px] font-medium text-[var(--text-primary)] truncate w-full tracking-[-0.01em]">
                        {artist.name}
                      </div>
                      <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                        Artista · Top tracks
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {tracks.length === 0 && albums.length === 0 && artists.length === 0 && (
            <p className="text-[13px] text-[var(--text-secondary)]">
              No se encontraron resultados para “{query}”.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
