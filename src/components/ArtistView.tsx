import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Disc3, Play, RefreshCw, Shuffle, User } from "lucide-react";
import type { SpotifyApiClient } from "../lib/spotifyApi";
import type { SpotifyAlbumSimple, SpotifyArtist } from "../types/spotify";
import { getBestImage } from "../lib/format";
import { viewCache } from "../lib/viewCache";
import { LazyCover } from "./LazyCover";

type DiscographyFilter = "all" | "album" | "single";

interface ArtistViewProps {
  artistId: string;
  seedArtist?: SpotifyArtist;
  api: SpotifyApiClient;
  canGoBack: boolean;
  onGoBack: () => void;
  onSelectAlbum: (album: SpotifyAlbumSimple, morphSourceEl?: HTMLElement | null) => void;
  onPlayContext: (options: { contextUri: string; offsetPosition?: number }) => Promise<void>;
  onToggleShuffle: () => Promise<void>;
  shuffle: boolean;
}

function deduplicateAlbums(list: SpotifyAlbumSimple[]): SpotifyAlbumSimple[] {
  const seen = new Set<string>();
  const unique: SpotifyAlbumSimple[] = [];
  for (const album of list) {
    if (!album?.id) continue;
    const key = `${album.album_type ?? "album"}::${album.name.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(album);
  }
  return unique;
}

function formatFollowers(count?: number): string | null {
  if (!count || count <= 0) return null;
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")} M seguidores`;
  }
  if (count >= 1_000) {
    return `${Math.round(count / 1_000)} mil seguidores`;
  }
  return `${count} seguidores`;
}

export function ArtistView({
  artistId,
  seedArtist,
  api,
  canGoBack,
  onGoBack,
  onSelectAlbum,
  onPlayContext,
  onToggleShuffle,
  shuffle,
}: ArtistViewProps) {
  const initialCache = viewCache.getArtist(artistId);

  const [artist, setArtist] = useState<SpotifyArtist | null>(
    () => initialCache?.artist ?? seedArtist ?? null
  );
  const [albums, setAlbums] = useState<SpotifyAlbumSimple[]>(
    () => initialCache?.albums ?? []
  );
  const [hasMore, setHasMore] = useState<boolean>(() => initialCache?.hasMore ?? false);
  const [isLoadingAlbums, setIsLoadingAlbums] = useState<boolean>(
    () => !initialCache
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [filter, setFilter] = useState<DiscographyFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [retryEpoch, setRetryEpoch] = useState(0);

  const offsetRef = useRef(initialCache?.offset ?? 0);

  // Hydrate artist profile + discography silently with zero full-screen reload flash
  useEffect(() => {
    let cancelled = false;
    const cached = viewCache.getArtist(artistId);

    setArtist(cached?.artist ?? seedArtist ?? null);
    setAlbums(cached?.albums ?? []);
    setHasMore(cached?.hasMore ?? false);
    offsetRef.current = cached?.offset ?? 0;
    setFilter("all");
    setError(null);
    setIsLoadingAlbums(!cached);

    // Skip redundant API calls if this artist's discography was fetched recently (< 2 min)
    if (retryEpoch === 0 && cached && cached.artist && viewCache.isFresh(`artist:${artistId}`)) {
      return;
    }

    (async () => {
      try {
        // Reuse seedArtist when it already has artwork/name to save 1 API call per artist visit
        const hasSeedArtwork = Boolean(seedArtist?.images && seedArtist.images.length > 0);
        const resolvedArtist = hasSeedArtwork
          ? seedArtist ?? null
          : await api.getArtist(artistId).catch(() => cached?.artist ?? seedArtist ?? null);
        if (cancelled) return;
        if (resolvedArtist) setArtist(resolvedArtist);

        let combined: SpotifyAlbumSimple[] = [];
        let nextOffset = 0;
        let nextHasMore = false;

        try {
          const firstPage = await api.getArtistAlbums(artistId, 10, 0, "album,single");
          if (cancelled) return;
          combined = (firstPage.items ?? []).filter(Boolean);
          nextOffset = (firstPage.items ?? []).length;
          nextHasMore = Boolean(firstPage.next);
        } catch (albumsErr) {
          // Spotify Development Mode enforces a strict catalog quota on /artists/{id}/albums.
          // If it returns 429, gracefully fall back to /search albums for this artist!
          const artistName = resolvedArtist?.name || seedArtist?.name;
          if (artistName) {
            try {
              const searchRes = await api.search(`artist:"${artistName}"`, 10);
              if (cancelled) return;
              const normTarget = artistName.trim().toLowerCase();
              const matched = (searchRes.albums?.items ?? []).filter(
                (al) =>
                  Boolean(al?.id) &&
                  (al.artists ?? []).some(
                    (a) =>
                      a.id === artistId ||
                      a.name.trim().toLowerCase() === normTarget
                  )
              );
              if (matched.length > 0) {
                combined = matched;
                nextOffset = matched.length;
                nextHasMore = false;
              } else {
                throw albumsErr;
              }
            } catch {
              throw albumsErr;
            }
          } else {
            throw albumsErr;
          }
        }

        if (cancelled) return;
        const deduped = deduplicateAlbums(combined);

        setArtist(resolvedArtist);
        setAlbums(deduped);
        offsetRef.current = nextOffset;
        setHasMore(nextHasMore);

        viewCache.setArtist(artistId, {
          artist: resolvedArtist,
          albums: deduped,
          offset: nextOffset,
          hasMore: nextHasMore,
        });
      } catch (err) {
        if (!cancelled && !cached) {
          setError(
            err instanceof Error ? err.message : "No se pudo cargar la discografía del artista."
          );
        }
      } finally {
        if (!cancelled) setIsLoadingAlbums(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, artistId, retryEpoch, seedArtist]);

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const page = await api.getArtistAlbums(artistId, 10, offsetRef.current, "album,single");
      const rawNext = (page.items ?? []).filter(Boolean);
      const nextOffset = offsetRef.current + rawNext.length;
      const nextHasMore = Boolean(page.next);

      setAlbums((prev) => {
        const merged = deduplicateAlbums([...prev, ...rawNext]);
        viewCache.setArtist(artistId, {
          artist,
          albums: merged,
          offset: nextOffset,
          hasMore: nextHasMore,
        });
        return merged;
      });
      offsetRef.current = nextOffset;
      setHasMore(nextHasMore);
    } catch {
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [api, artist, artistId, hasMore, isLoadingMore]);

  const albumCount = useMemo(
    () => albums.filter((a) => a.album_type === "album").length,
    [albums]
  );
  const singleCount = useMemo(
    () => albums.filter((a) => a.album_type !== "album").length,
    [albums]
  );

  const filteredAlbums = useMemo(() => {
    if (filter === "album") return albums.filter((a) => a.album_type === "album");
    if (filter === "single") return albums.filter((a) => a.album_type !== "album");
    return albums;
  }, [albums, filter]);

  const artistUri = artist?.uri ?? `spotify:artist:${artistId}`;
  const avatarUrl = getBestImage(artist?.images, "large");
  const avatarPlaceholderUrl = getBestImage(artist?.images, "medium");
  const followersLabel = formatFollowers(artist?.followers?.total);
  const genresLabel = artist?.genres?.slice(0, 3).join(" · ");

  const handlePlayArtist = async () => {
    await onPlayContext({ contextUri: artistUri });
  };

  const handlePlayShuffled = async () => {
    if (!shuffle) {
      await onToggleShuffle();
    }
    await onPlayContext({ contextUri: artistUri });
  };

  return (
    <div className="flex-1 overflow-y-auto px-8 pt-5 pb-32 space-y-9">
      {/* Subtle Top Back Bar */}
      {canGoBack && (
        <div className="chrome-no-select flex items-center">
          <button
            type="button"
            onClick={onGoBack}
            className="h-8 pl-2 pr-3.5 rounded-full bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-hairline)] text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1 transition-all duration-200 ease-apple active:scale-95 cursor-pointer"
          >
            <ChevronLeft size={14} strokeWidth={1.7} />
            Volver
          </button>
        </div>
      )}

      {/* Editorial Artist Header (renders at 0ms from seedArtist or cache!) */}
      <section className="flex flex-col sm:flex-row sm:items-end gap-7">
        <div
          data-artist-hero={artistId}
          className="relative shrink-0 w-44 h-44 rounded-full overflow-hidden bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-center"
          style={{ boxShadow: "var(--shadow-artwork)" }}
        >
          {avatarUrl ? (
            <>
              {avatarPlaceholderUrl && avatarPlaceholderUrl !== avatarUrl && (
                <img
                  src={avatarPlaceholderUrl}
                  alt=""
                  aria-hidden="true"
                  decoding="sync"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <img
                src={avatarUrl}
                alt={artist?.name ?? "Artista"}
                loading="eager"
                decoding="sync"
                className="relative z-10 w-full h-full object-cover"
              />
            </>
          ) : (
            <User size={48} strokeWidth={1.3} className="text-[var(--text-tertiary)]" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2.5">
          <span className="inline-block text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            ARTISTA
          </span>

          <h1 className="text-[34px] md:text-[42px] font-semibold tracking-[-0.035em] leading-[1.05] text-[var(--text-primary)] line-clamp-2">
            {artist?.name || "Cargando artista..."}
          </h1>

          {(followersLabel || genresLabel) && (
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--text-secondary)] tabular-nums">
              {followersLabel && (
                <span className="font-medium text-[var(--text-primary)]">{followersLabel}</span>
              )}
              {followersLabel && genresLabel && <span>·</span>}
              {genresLabel && <span className="capitalize">{genresLabel}</span>}
            </div>
          )}

          <div className="pt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handlePlayArtist()}
              className="chrome-no-select h-10 px-6 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] text-[13px] font-medium inline-flex items-center gap-2 transition-all duration-200 ease-apple active:scale-[0.97] cursor-pointer"
            >
              <Play size={14} strokeWidth={1.8} fill="currentColor" />
              Reproducir
            </button>

            <button
              type="button"
              onClick={() => void handlePlayShuffled()}
              className="chrome-no-select h-10 px-5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[13px] font-medium text-[var(--text-primary)] inline-flex items-center gap-2 transition-all duration-200 ease-apple active:scale-[0.97] cursor-pointer"
            >
              <Shuffle size={14} strokeWidth={1.5} />
              Aleatorio
            </button>
          </div>
        </div>
      </section>

      <div className="h-px bg-[var(--border-hairline)]" />

      {/* Discography Section */}
      <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            Discografía
          </h2>

          {/* Filter Pills */}
          {albums.length > 0 && (
            <div className="chrome-no-select flex items-center gap-1.5">
              {(
                [
                  { id: "all", label: "Todos", count: albums.length },
                  { id: "album", label: "Álbumes", count: albumCount },
                  { id: "single", label: "Sencillos y EPs", count: singleCount },
                ] as const
              )
                .filter((tab) => tab.id === "all" || tab.count > 0)
                .map((tab) => {
                  const active = filter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFilter(tab.id)}
                      className={`h-8 px-3.5 rounded-full text-[12px] font-medium inline-flex items-center gap-1.5 transition-all duration-200 ease-apple cursor-pointer ${
                        active
                          ? "bg-[var(--solid-bg)] text-[var(--solid-fg)]"
                          : "bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-hairline)]"
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span className="text-[11px] opacity-70 tabular-nums">{tab.count}</span>
                    </button>
                  );
                })}
            </div>
          )}
        </div>

        {isLoadingAlbums ? (
          /* Lightweight inline shimmer cards — header stays visible, zero full-page reload */
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="p-3.5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] animate-pulse"
              >
                <div className="aspect-square rounded-xl bg-[var(--bg-card)] mb-3.5" />
                <div className="h-3.5 w-3/4 rounded bg-[var(--bg-card)] mb-2" />
                <div className="h-3 w-1/2 rounded bg-[var(--bg-card)]" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="max-w-[540px] p-5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] flex items-center justify-between gap-4 text-[13px] text-[var(--text-secondary)]">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setRetryEpoch((n) => n + 1)}
              className="shrink-0 h-8 px-3.5 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] text-[12px] font-medium inline-flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
            >
              <RefreshCw size={12} strokeWidth={1.8} />
              Reintentar
            </button>
          </div>
        ) : filteredAlbums.length === 0 ? (
          <div className="py-12 flex flex-col items-center text-center gap-2.5 text-[var(--text-secondary)]">
            <Disc3 size={24} strokeWidth={1.4} className="text-[var(--text-tertiary)]" />
            <p className="text-[13px]">No hay lanzamientos en esta categoría.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
              {filteredAlbums.map((album) => {
                const year = album.release_date?.slice(0, 4);
                const typeLabel = album.album_type === "album" ? "Álbum" : "Sencillo";
                return (
                  <div
                    key={album.id}
                    onMouseEnter={() => void viewCache.prefetchAlbum(api, album.id)}
                    onClick={(e) => {
                      const coverEl = e.currentTarget.querySelector<HTMLElement>(
                        "[data-morph-cover]"
                      );
                      onSelectAlbum(album, coverEl);
                    }}
                    className="group playlist-card-zoom p-3.5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] hover:border-[var(--border-subtle)] cursor-pointer"
                  >
                    <div
                      data-morph-cover
                      data-album-cover={album.id}
                      className="playlist-cover-zoom relative aspect-square mb-3.5 rounded-xl overflow-hidden"
                    >
                      <LazyCover
                        src={getBestImage(album.images, "medium")}
                        alt={album.name}
                        className="w-full h-full"
                        iconSize={28}
                        roundedClass="rounded-xl"
                      />
                      <button
                        type="button"
                        aria-label={`Reproducir ${album.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onPlayContext({ contextUri: album.uri, offsetPosition: 0 });
                        }}
                        className="chrome-no-select absolute right-2.5 bottom-2.5 w-9 h-9 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] shadow-lg flex items-center justify-center opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 ease-apple cursor-pointer"
                      >
                        <Play size={14} strokeWidth={1.8} fill="currentColor" />
                      </button>
                    </div>
                    <div className="text-[13.5px] font-medium text-[var(--text-primary)] truncate tracking-[-0.01em]">
                      {album.name}
                    </div>
                    <div className="text-[12px] text-[var(--text-secondary)] truncate mt-0.5 tabular-nums">
                      {year ? `${year} · ${typeLabel}` : typeLabel}
                      {album.total_tracks ? ` · ${album.total_tracks} pistas` : ""}
                    </div>
                  </div>
                );
              })}
            </div>

            {hasMore && (
              <div className="pt-2 flex justify-center">
                <button
                  type="button"
                  disabled={isLoadingMore}
                  onClick={() => void handleLoadMore()}
                  className="h-9 px-5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[12.5px] font-medium text-[var(--text-primary)] transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isLoadingMore ? "Cargando..." : "Cargar más lanzamientos"}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
