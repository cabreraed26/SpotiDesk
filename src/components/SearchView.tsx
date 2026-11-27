import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MoreHorizontal, Pause, Play, Search, User, X } from "lucide-react";
import type { SpotifyApiClient } from "../lib/spotifyApi";
import type {
  SpotifyAlbumSimple,
  SpotifyArtist,
  SpotifySearchResults,
  UnifiedTrack,
} from "../types/spotify";
import { formatDuration, getBestImage, normalizeTrack } from "../lib/format";
import { viewCache, type SearchFilterTab } from "../lib/viewCache";
import { LazyCover } from "./LazyCover";
import { ArtistLinks } from "./ArtistLinks";

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
  onSelectAlbum: (album: SpotifyAlbumSimple | string, morphSourceEl?: HTMLElement | null) => void;
  onSelectArtist: (
    artist: SpotifyArtist | string,
    morphSourceEl?: HTMLElement | null,
    fallbackName?: string
  ) => void;
  onTrackContextMenu?: (e: React.MouseEvent, track: UnifiedTrack) => void;
}

function normalizeFold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function rankArtistsByQuery(list: SpotifyArtist[], rawQuery: string): SpotifyArtist[] {
  const q = normalizeFold(rawQuery);
  if (!q) return list;

  const score = (artist: SpotifyArtist): number => {
    const name = normalizeFold(artist.name);
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.includes(q)) return 2;
    return 3;
  };

  return [...list].sort((a, b) => score(a) - score(b));
}

export function SearchView({
  api,
  currentTrackUri,
  isPlaying,
  onPlayContext,
  onTogglePlay,
  onSelectAlbum,
  onSelectArtist,
  onTrackContextMenu,
}: SearchViewProps) {
  const initialCache = viewCache.lastSearch;
  const [query, setQuery] = useState(() => initialCache?.query ?? "");
  const [results, setResults] = useState<SpotifySearchResults | null>(
    () => initialCache?.results ?? null
  );
  const [activeFilter, setActiveFilter] = useState<SearchFilterTab>(
    () => initialCache?.filter ?? "all"
  );
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!initialCache) {
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep filter persisted in viewCache for seamless Back transitions
  useEffect(() => {
    if (viewCache.lastSearch) {
      viewCache.lastSearch = { ...viewCache.lastSearch, filter: activeFilter };
    }
  }, [activeFilter]);

  // 280ms debounced instant search (Artists, Albums & Tracks)
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setIsSearching(false);
      setError(null);
      viewCache.lastSearch = null;
      return;
    }

    // Reuse cached results immediately if returning to the exact same query
    if (viewCache.lastSearch && viewCache.lastSearch.query === trimmed) {
      setResults(viewCache.lastSearch.results);
      setIsSearching(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    setError(null);

    const timer = window.setTimeout(async () => {
      try {
        const data = await api.search(trimmed, 10);
        if (!cancelled) {
          setResults(data);
          viewCache.lastSearch = {
            query: trimmed,
            results: data,
            filter: activeFilter,
          };
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Error buscando en Spotify.");
        }
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, query]);

  const tracks = useMemo(
    () => (results?.tracks?.items ?? []).filter(Boolean).map(normalizeTrack),
    [results]
  );
  const albums = useMemo(
    () => (results?.albums?.items ?? []).filter(Boolean),
    [results]
  );
  const artists = useMemo(
    () => rankArtistsByQuery((results?.artists?.items ?? []).filter(Boolean), query),
    [results, query]
  );

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

  const hasAnyResults = artists.length > 0 || tracks.length > 0 || albums.length > 0;
  const showArtists = activeFilter === "all" || activeFilter === "artists";
  const showTracks = activeFilter === "all" || activeFilter === "tracks";
  const showAlbums = activeFilter === "all" || activeFilter === "albums";
  const isMac = /mac/i.test(navigator.platform || navigator.userAgent);

  return (
    <div className="flex-1 overflow-y-auto px-8 pt-7 pb-32">
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
            placeholder="Artistas, canciones o álbumes..."
            aria-label="Buscar en Spotify"
            className="w-full h-11 pl-11 pr-16 rounded-xl text-[14px] bg-[var(--bg-elevated)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border border-[var(--border-hairline)] focus:outline-none focus:border-[var(--border-subtle)] transition-colors"
          />
          <div className="absolute right-3 flex items-center gap-1.5">
            {isSearching && (
              <Loader2
                size={14}
                strokeWidth={1.6}
                className="animate-spin text-[var(--text-tertiary)]"
                aria-label="Buscando"
              />
            )}
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setActiveFilter("all");
                  inputRef.current?.focus();
                }}
                aria-label="Limpiar búsqueda"
                className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
              >
                <X size={14} strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>

        {/* Category Filter Pills — stay visible while refining query */}
        {results && hasAnyResults && (
          <div className="chrome-no-select mt-4 flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: "all", label: "Todo", count: artists.length + tracks.length + albums.length },
                { id: "artists", label: "Artistas", count: artists.length },
                { id: "tracks", label: "Canciones", count: tracks.length },
                { id: "albums", label: "Álbumes", count: albums.length },
              ] as const
            )
              .filter((tab) => tab.id === "all" || tab.count > 0)
              .map((tab) => {
                const isActive = activeFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveFilter(tab.id)}
                    className={`h-8 px-3.5 rounded-full text-[12px] font-medium inline-flex items-center gap-1.5 transition-all duration-200 ease-apple cursor-pointer ${
                      isActive
                        ? "bg-[var(--solid-bg)] text-[var(--solid-fg)]"
                        : "bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-hairline)]"
                    }`}
                  >
                    <span>{tab.label}</span>
                    {tab.id !== "all" && (
                      <span className="text-[11px] opacity-70 tabular-nums">{tab.count}</span>
                    )}
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {/* Subtle skeleton ONLY on initial empty search; subsequent refinements keep previous results visible */}
      {isSearching && !results && (
        <div className="mt-8 space-y-6 animate-pulse">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="p-3.5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] flex flex-col items-center"
              >
                <div className="w-24 h-24 rounded-full bg-[var(--bg-card)] mb-3" />
                <div className="h-3 w-20 rounded bg-[var(--bg-card)] mb-1.5" />
                <div className="h-2.5 w-12 rounded bg-[var(--bg-card)]" />
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-[52px] px-3 flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-md bg-[var(--bg-card)]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-44 rounded bg-[var(--bg-card)]" />
                  <div className="h-2.5 w-28 rounded bg-[var(--bg-card)]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-8 text-[13px] text-[var(--text-secondary)]">{error}</p>
      )}

      {!query.trim() && !isSearching && (
        <div className="mt-20 max-w-[360px]">
          <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed">
            Encuentra instantáneamente cualquier artista, disco o canción del catálogo de Spotify.
          </p>
          <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">
            Atajo rápido:{" "}
            <kbd className="px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[11px]">
              {isMac ? "⌘ + K" : "Ctrl + K"}
            </kbd>
          </p>
        </div>
      )}

      {results && (
        <div
          className={`mt-8 space-y-11 transition-opacity duration-200 ease-apple ${
            isSearching ? "opacity-65" : "opacity-100"
          }`}
        >
          {/* Artists FIRST — immediately visible above the fold when searching by artist name */}
          {showArtists && artists.length > 0 && (
            <section>
              <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)] mb-4">
                Artistas
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-5">
                {(activeFilter === "all" ? artists.slice(0, 6) : artists).map((artist) => {
                  const avatar = getBestImage(artist.images, "medium");
                  return (
                    <div
                      key={artist.id}
                      role="button"
                      tabIndex={0}
                      onMouseEnter={() => void viewCache.prefetchArtist(api, artist.id, artist)}
                      onClick={(e) => {
                        const avatarEl = e.currentTarget.querySelector<HTMLElement>(
                          "[data-morph-avatar]"
                        );
                        onSelectArtist(artist, avatarEl);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectArtist(artist);
                        }
                      }}
                      className="group playlist-card-zoom p-3.5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] hover:border-[var(--border-subtle)] flex flex-col items-center text-center cursor-pointer"
                    >
                      <div className="relative mb-3">
                        <div
                          data-morph-avatar
                          data-artist-cover={artist.id}
                          className="playlist-cover-zoom w-24 h-24 rounded-full overflow-hidden bg-[var(--bg-card)] border border-[var(--border-hairline)] flex items-center justify-center"
                        >
                          {avatar ? (
                            <img
                              src={avatar}
                              alt={artist.name}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <User size={28} strokeWidth={1.5} className="text-[var(--text-tertiary)]" />
                          )}
                        </div>
                        <button
                          type="button"
                          aria-label={`Reproducir ${artist.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handlePlayArtist(artist);
                          }}
                          className="chrome-no-select absolute right-0 bottom-0 w-8 h-8 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] shadow-lg flex items-center justify-center opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 ease-apple cursor-pointer"
                        >
                          <Play size={13} strokeWidth={1.8} fill="currentColor" />
                        </button>
                      </div>
                      <div className="text-[13px] font-medium text-[var(--text-primary)] truncate w-full tracking-[-0.01em]">
                        {artist.name}
                      </div>
                      <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                        Artista · Ver álbumes
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Songs */}
          {showTracks && tracks.length > 0 && (
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
                          <ArtistLinks
                            artistsText={track.artists}
                            artistItems={track.artistItems}
                            fallbackArtistId={track.artistId}
                            onSelectArtist={(id, name) => onSelectArtist(id, null, name)}
                          />
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
          {showAlbums && albums.length > 0 && (
            <section>
              <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)] mb-4">
                Álbumes
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
                {albums.map((album) => (
                  <div
                    key={album.id}
                    onMouseEnter={() => void viewCache.prefetchAlbum(api, album.id)}
                    onClick={(e) => {
                      const coverEl = e.currentTarget.querySelector<HTMLElement>(
                        "[data-morph-cover]"
                      );
                      onSelectAlbum(album, coverEl);
                    }}
                    className="group playlist-card-zoom p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] hover:border-[var(--border-subtle)] cursor-pointer"
                  >
                    <div
                      data-morph-cover
                      data-album-cover={album.id}
                      className="playlist-cover-zoom relative aspect-square mb-3 rounded-lg overflow-hidden"
                    >
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

          {!hasAnyResults && (
            <p className="text-[13px] text-[var(--text-secondary)]">
              No se encontraron resultados para “{query}”.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
