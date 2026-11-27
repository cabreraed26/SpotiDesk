import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Heart, Loader2, Play, Shuffle } from "lucide-react";
import { SpotifyApiError, type SpotifyApiClient } from "../lib/spotifyApi";
import type {
  SpotifyAlbumSimple,
  SpotifyArtist,
  SpotifyPlaylist,
  SpotifyPlaylistTrackItem,
  UnifiedTrack,
} from "../types/spotify";
import {
  formatTotalDuration,
  getBestImage,
  getPlaylistTrackCount,
  normalizeTrack,
} from "../lib/format";
import { viewCache } from "../lib/viewCache";
import { LazyCover } from "./LazyCover";
import { VirtualizedTrackList } from "./VirtualizedTrackList";

export type CollectionTarget =
  | { kind: "liked" }
  | { kind: "playlist"; id: string; seedPlaylist?: SpotifyPlaylist }
  | { kind: "album"; id: string; seedAlbum?: SpotifyAlbumSimple };

interface CollectionMeta {
  badge: string;
  title: string;
  subtitle: string;
  albumArtists?: SpotifyArtist[];
  year?: string;
  description?: string;
  coverUrl?: string;
  placeholderCoverUrl?: string;
  contextUri?: string;
  totalTracks: number;
  isLiked?: boolean;
}

interface CollectionViewProps {
  target: CollectionTarget;
  api: SpotifyApiClient;
  cachedPlaylist?: SpotifyPlaylist;
  canGoBack?: boolean;
  onGoBack?: () => void;
  currentTrackUri?: string;
  activeContextUri?: string | null;
  sdkWindowTracks?: UnifiedTrack[];
  isPlaying: boolean;
  onPlayContext: (options: {
    contextUri?: string;
    uris?: string[];
    offsetPosition?: number;
    offsetUri?: string;
  }) => Promise<void>;
  onTogglePlay: () => void;
  onToggleShuffle: () => Promise<void>;
  shuffle: boolean;
  onSelectAlbum: (album: SpotifyAlbumSimple | string, morphSourceEl?: HTMLElement | null) => void;
  onSelectArtist?: (artist: SpotifyArtist) => void;
  onTrackContextMenu?: (e: React.MouseEvent, track: UnifiedTrack, index?: number) => void;
  onRestrictedPlaylist?: (playlistName: string) => void;
}

function buildAlbumMeta(album: SpotifyAlbumSimple, fallbackTrackCount = 0): CollectionMeta {
  const year = album.release_date?.slice(0, 4);
  const badge =
    album.album_type === "single"
      ? "SENCILLO"
      : album.album_type === "compilation"
        ? "RECOPILACIÓN"
        : "ÁLBUM";
  const artistsText = (album.artists ?? []).map((a) => a.name).join(", ");
  return {
    badge,
    title: album.name,
    subtitle: artistsText,
    albumArtists: album.artists ?? [],
    year,
    coverUrl: getBestImage(album.images, "large"),
    placeholderCoverUrl:
      getBestImage(album.images, "medium") ?? getBestImage(album.images, "small"),
    contextUri: album.uri,
    totalTracks: album.total_tracks ?? fallbackTrackCount,
  };
}

function buildPlaylistMeta(
  playlist: SpotifyPlaylist,
  fallbackTrackCount = 0
): CollectionMeta {
  return {
    badge: "PLAYLIST",
    title: playlist.name,
    subtitle: playlist.owner?.display_name || "Spotify",
    description: playlist.description || undefined,
    coverUrl: getBestImage(playlist.images, "large"),
    placeholderCoverUrl:
      getBestImage(playlist.images, "medium") ?? getBestImage(playlist.images, "small"),
    contextUri: playlist.uri,
    totalTracks: getPlaylistTrackCount(playlist) || fallbackTrackCount,
  };
}

function buildLikedMeta(totalTracks = 0): CollectionMeta {
  return {
    badge: "BIBLIOTECA",
    title: "Tus Me Gusta",
    subtitle: "Colección personal",
    totalTracks,
    isLiked: true,
  };
}

function resolveInitialCollectionState(
  target: CollectionTarget,
  cachedPlaylist?: SpotifyPlaylist
): {
  meta: CollectionMeta | null;
  tracks: UnifiedTrack[];
  offset: number;
  hasMore: boolean;
  isRestricted: boolean;
  isLoading: boolean;
  isTracksLoading: boolean;
  hasFullCache: boolean;
} {
  if (target.kind === "album") {
    const cached = viewCache.getAlbum(target.id);
    if (cached) {
      return {
        meta: buildAlbumMeta(cached.album, cached.tracks.length),
        tracks: cached.tracks,
        offset: cached.tracks.length,
        hasMore: false,
        isRestricted: false,
        isLoading: false,
        isTracksLoading: false,
        hasFullCache: true,
      };
    }
    if (target.seedAlbum) {
      return {
        meta: buildAlbumMeta(target.seedAlbum),
        tracks: [],
        offset: 0,
        hasMore: false,
        isRestricted: false,
        isLoading: false,
        isTracksLoading: true,
        hasFullCache: false,
      };
    }
    return {
      meta: null,
      tracks: [],
      offset: 0,
      hasMore: false,
      isRestricted: false,
      isLoading: true,
      isTracksLoading: false,
      hasFullCache: false,
    };
  }

  if (target.kind === "playlist") {
    const cached = viewCache.getPlaylist(target.id);
    if (cached) {
      return {
        meta: buildPlaylistMeta(cached.playlist, cached.tracks.length),
        tracks: cached.tracks,
        offset: cached.offset,
        hasMore: cached.hasMore,
        isRestricted: cached.isRestricted,
        isLoading: false,
        isTracksLoading: false,
        hasFullCache: true,
      };
    }
    const seed = target.seedPlaylist ?? cachedPlaylist;
    if (seed) {
      return {
        meta: buildPlaylistMeta(seed),
        tracks: [],
        offset: 0,
        hasMore: false,
        isRestricted: false,
        isLoading: false,
        isTracksLoading: true,
        hasFullCache: false,
      };
    }
    return {
      meta: null,
      tracks: [],
      offset: 0,
      hasMore: false,
      isRestricted: false,
      isLoading: true,
      isTracksLoading: false,
      hasFullCache: false,
    };
  }

  // target.kind === "liked" — always render editorial header at 0ms!
  const cachedLiked = viewCache.likedTracks;
  if (cachedLiked) {
    return {
      meta: buildLikedMeta(cachedLiked.total),
      tracks: cachedLiked.tracks,
      offset: cachedLiked.offset,
      hasMore: cachedLiked.hasMore,
      isRestricted: false,
      isLoading: false,
      isTracksLoading: false,
      hasFullCache: true,
    };
  }
  return {
    meta: buildLikedMeta(0),
    tracks: [],
    offset: 0,
    hasMore: false,
    isRestricted: false,
    isLoading: false,
    isTracksLoading: true,
    hasFullCache: false,
  };
}

function extractPlaylistTracks(entries: SpotifyPlaylistTrackItem[] | undefined): UnifiedTrack[] {
  return (entries ?? [])
    .map((entry) => entry?.item ?? entry?.track)
    .filter((t): t is NonNullable<typeof t> => Boolean(t && t.uri))
    .map((t) => normalizeTrack(t));
}

export function CollectionView({
  target,
  api,
  cachedPlaylist,
  canGoBack = false,
  onGoBack,
  currentTrackUri,
  activeContextUri,
  sdkWindowTracks = [],
  isPlaying,
  onPlayContext,
  onTogglePlay,
  onToggleShuffle,
  shuffle,
  onSelectAlbum,
  onSelectArtist,
  onTrackContextMenu,
  onRestrictedPlaylist,
}: CollectionViewProps) {
  const initial = resolveInitialCollectionState(target, cachedPlaylist);
  const [meta, setMeta] = useState<CollectionMeta | null>(() => initial.meta);
  const [tracks, setTracks] = useState<UnifiedTrack[]>(() => initial.tracks);
  const [isLoading, setIsLoading] = useState<boolean>(() => initial.isLoading);
  const [isTracksLoading, setIsTracksLoading] = useState<boolean>(() => initial.isTracksLoading);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState<boolean>(() => initial.hasMore);
  const [isRestrictedPlaylist, setIsRestrictedPlaylist] = useState<boolean>(
    () => initial.isRestricted
  );
  const [error, setError] = useState<string | null>(null);

  const offsetRef = useRef(initial.offset);
  const targetRef = useRef(target);
  targetRef.current = target;
  const cachedPlaylistRef = useRef<SpotifyPlaylist | undefined>(cachedPlaylist);
  cachedPlaylistRef.current = cachedPlaylist;
  const onRestrictedRef = useRef(onRestrictedPlaylist);
  onRestrictedRef.current = onRestrictedPlaylist;

  const targetKey = target.kind === "liked" ? "liked" : `${target.kind}:${target.id}`;

  // Initial load + silent SWR revalidation for the selected collection
  useEffect(() => {
    let cancelled = false;
    const currentTarget = targetRef.current;
    const snap = resolveInitialCollectionState(currentTarget, cachedPlaylistRef.current);

    offsetRef.current = snap.offset;
    setError(null);
    setMeta(snap.meta);
    setTracks(snap.tracks);
    setHasMore(snap.hasMore);
    setIsRestrictedPlaylist(snap.isRestricted);
    setIsLoading(snap.isLoading);
    setIsTracksLoading(snap.isTracksLoading);

    (async () => {
      try {
        if (currentTarget.kind === "liked") {
          const page = await api.getSavedTracks(50, 0);
          if (cancelled) return;
          const items = (page.items ?? [])
            .map((entry) => entry?.item ?? entry?.track)
            .filter((t): t is NonNullable<typeof t> => Boolean(t && t.uri))
            .map((t) => normalizeTrack(t));
          const total = page.total ?? items.length;
          const nextOffset = (page.items ?? []).length;
          const nextMore = Boolean(page.next);

          setMeta(buildLikedMeta(total));
          setTracks(items);
          offsetRef.current = nextOffset;
          setHasMore(nextMore);
          viewCache.likedTracks = {
            tracks: items,
            total,
            offset: nextOffset,
            hasMore: nextMore,
          };
        } else if (currentTarget.kind === "playlist") {
          let playlist: SpotifyPlaylist | undefined =
            currentTarget.seedPlaylist ?? cachedPlaylistRef.current;

          try {
            playlist = await api.getPlaylist(currentTarget.id);
          } catch {
            // Fall back to cached playlist metadata from /me/playlists
          }

          if (cancelled) return;

          if (!playlist) {
            if (!snap.hasFullCache) {
              setError("No se pudo obtener la información de esta playlist.");
            }
            return;
          }

          setMeta(buildPlaylistMeta(playlist));

          // Check if the full playlist payload already embedded its first page of items
          const embeddedItems = (
            playlist.items as unknown as
              | { items?: SpotifyPlaylistTrackItem[]; next?: string | null; total?: number }
              | undefined
          )?.items;

          if (Array.isArray(embeddedItems) && embeddedItems.length > 0) {
            const parsed = extractPlaylistTracks(embeddedItems);
            const nextOffset = embeddedItems.length;
            const nextUrl = (playlist.items as unknown as { next?: string | null })?.next;
            const nextMore = Boolean(nextUrl);

            setTracks(parsed);
            offsetRef.current = nextOffset;
            setHasMore(nextMore);
            setIsRestrictedPlaylist(false);
            viewCache.setPlaylist(currentTarget.id, {
              playlist,
              tracks: parsed,
              offset: nextOffset,
              hasMore: nextMore,
              isRestricted: false,
            });
            return;
          }

          try {
            const page = await api.getPlaylistTracks(currentTarget.id, 100, 0);
            if (cancelled) return;
            const parsed = extractPlaylistTracks(page.items);
            const nextOffset = (page.items ?? []).length;
            const nextMore = Boolean(page.next);

            setTracks(parsed);
            offsetRef.current = nextOffset;
            setHasMore(nextMore);
            setIsRestrictedPlaylist(false);
            if (page.total) {
              setMeta((prev) =>
                prev ? { ...prev, totalTracks: prev.totalTracks || page.total } : prev
              );
            }
            viewCache.setPlaylist(currentTarget.id, {
              playlist,
              tracks: parsed,
              offset: nextOffset,
              hasMore: nextMore,
              isRestricted: false,
            });
          } catch (tracksErr) {
            if (cancelled) return;
            if (tracksErr instanceof SpotifyApiError && tracksErr.status === 403) {
              // Spotify Feb 2026 Dev Mode blocks reading tracks of third-party playlists,
              // but direct playback via context_uri still works!
              setIsRestrictedPlaylist(true);
              viewCache.setPlaylist(currentTarget.id, {
                playlist,
                tracks: [],
                offset: 0,
                hasMore: false,
                isRestricted: true,
              });
              if (!snap.isRestricted) {
                onRestrictedRef.current?.(playlist.name);
              }
            } else if (!snap.hasFullCache) {
              setError(
                tracksErr instanceof Error
                  ? tracksErr.message
                  : "Error cargando las canciones de la playlist."
              );
            }
          }
        } else if (currentTarget.kind === "album") {
          const album = await api.getAlbum(currentTarget.id);
          if (cancelled) return;
          const coverSmall = getBestImage(album.images, "small");
          const coverLarge = getBestImage(album.images, "large");
          const items: UnifiedTrack[] = (album.tracks?.items ?? []).map((t) => {
            const artistItems = (t.artists ?? [])
              .filter((a) => Boolean(a && a.id && a.name))
              .map((a) => ({ id: a.id, name: a.name }));
            return {
              id: t.id || t.uri,
              uri: t.uri,
              name: t.name,
              artists: (t.artists ?? []).map((a) => a.name).join(", "),
              artistId: artistItems[0]?.id ?? album.artists?.[0]?.id,
              artistItems,
              albumName: album.name,
              albumId: album.id,
              albumImage: coverSmall,
              albumImageLarge: coverLarge,
              durationMs: t.duration_ms ?? 0,
            };
          });
          setMeta(buildAlbumMeta(album, items.length));
          setTracks(items);
          offsetRef.current = items.length;
          setHasMore(false);
          viewCache.setAlbum(currentTarget.id, { album, tracks: items });
        }
      } catch (err) {
        if (!cancelled && !snap.hasFullCache) {
          setError(err instanceof Error ? err.message : "Error cargando la colección.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsTracksLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, targetKey]);

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || isRestrictedPlaylist) return;
    setIsLoadingMore(true);
    try {
      if (target.kind === "liked") {
        const page = await api.getSavedTracks(50, offsetRef.current);
        const nextItems = (page.items ?? [])
          .map((entry) => entry?.item ?? entry?.track)
          .filter((t): t is NonNullable<typeof t> => Boolean(t && t.uri))
          .map((t) => normalizeTrack(t));
        const nextOffset = offsetRef.current + (page.items ?? []).length;
        const nextMore = Boolean(page.next);

        setTracks((prev) => {
          const merged = [...prev, ...nextItems];
          viewCache.likedTracks = {
            tracks: merged,
            total: page.total ?? merged.length,
            offset: nextOffset,
            hasMore: nextMore,
          };
          return merged;
        });
        offsetRef.current = nextOffset;
        setHasMore(nextMore);
      } else if (target.kind === "playlist") {
        const page = await api.getPlaylistTracks(target.id, 100, offsetRef.current);
        const nextItems = extractPlaylistTracks(page.items);
        const nextOffset = offsetRef.current + (page.items ?? []).length;
        const nextMore = Boolean(page.next);

        setTracks((prev) => {
          const merged = [...prev, ...nextItems];
          const existing = viewCache.getPlaylist(target.id);
          if (existing) {
            viewCache.setPlaylist(target.id, {
              ...existing,
              tracks: merged,
              offset: nextOffset,
              hasMore: nextMore,
            });
          }
          return merged;
        });
        offsetRef.current = nextOffset;
        setHasMore(nextMore);
      }
    } catch {
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [api, hasMore, isLoadingMore, isRestrictedPlaylist, target]);

  const isThisContextPlaying = Boolean(meta?.contextUri && activeContextUri === meta.contextUri);
  const displayedTracks =
    isRestrictedPlaylist && isThisContextPlaying && sdkWindowTracks.length > 0
      ? sdkWindowTracks
      : tracks;

  const totalLoadedDurationMs = useMemo(
    () => tracks.reduce((sum, t) => sum + t.durationMs, 0),
    [tracks]
  );

  const canPlay = displayedTracks.length > 0 || Boolean(meta?.contextUri);

  const handlePlayAll = async () => {
    if (!canPlay) return;
    if (meta?.contextUri) {
      await onPlayContext({
        contextUri: meta.contextUri,
        offsetPosition: isRestrictedPlaylist ? undefined : 0,
      });
    } else if (tracks.length > 0) {
      await onPlayContext({ uris: tracks.slice(0, 100).map((t) => t.uri), offsetPosition: 0 });
    }
  };

  const handlePlayShuffled = async () => {
    if (!canPlay) return;
    if (!shuffle) {
      await onToggleShuffle();
    }
    if (meta?.contextUri) {
      const randomPos =
        !isRestrictedPlaylist && tracks.length > 0
          ? Math.floor(Math.random() * tracks.length)
          : undefined;
      await onPlayContext({ contextUri: meta.contextUri, offsetPosition: randomPos });
    } else if (tracks.length > 0) {
      const randomIndex = Math.floor(Math.random() * tracks.length);
      const start = Math.max(0, randomIndex - 10);
      const slice = tracks.slice(start, start + 100).map((t) => t.uri);
      await onPlayContext({ uris: slice, offsetUri: tracks[randomIndex].uri });
    }
  };

  const handlePlayTrack = async (track: UnifiedTrack, index: number) => {
    if (meta?.contextUri) {
      await onPlayContext({ contextUri: meta.contextUri, offsetUri: track.uri });
    } else {
      const start = Math.max(0, index - 20);
      const slice = tracks.slice(start, start + 100).map((t) => t.uri);
      await onPlayContext({ uris: slice, offsetUri: track.uri });
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={22} strokeWidth={1.5} className="animate-spin text-[var(--text-secondary)]" />
      </div>
    );
  }

  if (error || !meta) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-[13px] text-[var(--text-secondary)]">
          {error || "No se pudo cargar la colección."}
        </p>
      </div>
    );
  }

  const isAlbumView = target.kind === "album";
  const isPlaylistView = target.kind === "playlist";

  const headerSlot = (
    <section key={targetKey} className={`${canGoBack ? "pt-5" : "pt-8"} pb-7 space-y-6`}>
      {canGoBack && onGoBack && (
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

      <div className="flex flex-col sm:flex-row sm:items-end gap-7">
        {meta.isLiked ? (
          <div
            data-liked-hero="liked"
            className="w-44 h-44 shrink-0 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-center"
            style={{ boxShadow: "var(--shadow-artwork)" }}
          >
            <Heart size={48} strokeWidth={1.3} className="text-[var(--text-primary)]" />
          </div>
        ) : (
          <div
            data-album-hero={isAlbumView ? target.id : undefined}
            data-playlist-hero={isPlaylistView ? target.id : undefined}
            className="shrink-0 rounded-2xl overflow-hidden"
            style={{ boxShadow: "var(--shadow-artwork)" }}
          >
            <LazyCover
              src={meta.coverUrl}
              placeholderSrc={meta.placeholderCoverUrl}
              alt={meta.title}
              className="w-44 h-44"
              iconSize={40}
              roundedClass="rounded-2xl"
              eager
            />
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-2.5">
          <span className="inline-block text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            {meta.badge}
          </span>

          <h1 className="text-[32px] md:text-[38px] font-semibold tracking-[-0.03em] leading-[1.08] text-[var(--text-primary)] line-clamp-2">
            {meta.title}
          </h1>

          {meta.description && (
            <p
              className="text-[13px] text-[var(--text-secondary)] line-clamp-2 max-w-[600px]"
              dangerouslySetInnerHTML={{
                __html: meta.description.replace(/<a [^>]*>(.*?)<\/a>/g, "$1"),
              }}
            />
          )}

          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--text-secondary)] tabular-nums">
            {meta.albumArtists && meta.albumArtists.length > 0 && onSelectArtist ? (
              <span className="inline-flex flex-wrap items-center gap-1 font-medium text-[var(--text-primary)]">
                {meta.albumArtists.map((artist, idx) => (
                  <span key={artist.id || artist.name} className="inline-flex items-center">
                    {idx > 0 && <span className="mr-1 text-[var(--text-secondary)]">,</span>}
                    {artist.id ? (
                      <button
                        type="button"
                        onClick={() => onSelectArtist(artist)}
                        className="hover:underline underline-offset-4 cursor-pointer"
                      >
                        {artist.name}
                      </button>
                    ) : (
                      <span>{artist.name}</span>
                    )}
                  </span>
                ))}
              </span>
            ) : (
              <span className="font-medium text-[var(--text-primary)]">{meta.subtitle}</span>
            )}
            {meta.year && (
              <>
                <span>·</span>
                <span>{meta.year}</span>
              </>
            )}
            {meta.totalTracks > 0 && (
              <>
                <span>·</span>
                <span>{meta.totalTracks} canciones</span>
              </>
            )}
            {totalLoadedDurationMs > 0 && (
              <>
                <span>·</span>
                <span>{formatTotalDuration(totalLoadedDurationMs)}</span>
              </>
            )}
          </div>

          <div className="pt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handlePlayAll()}
              disabled={!canPlay}
              className="chrome-no-select h-10 px-6 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] disabled:opacity-40 text-[13px] font-medium inline-flex items-center gap-2 transition-all duration-200 ease-apple active:scale-[0.97] cursor-pointer"
            >
              <Play size={14} strokeWidth={1.8} fill="currentColor" />
              Reproducir
            </button>

            <button
              type="button"
              onClick={() => void handlePlayShuffled()}
              disabled={!canPlay}
              className="chrome-no-select h-10 px-5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] disabled:opacity-40 text-[13px] font-medium text-[var(--text-primary)] inline-flex items-center gap-2 transition-all duration-200 ease-apple active:scale-[0.97] cursor-pointer"
            >
              <Shuffle size={14} strokeWidth={1.5} />
              Aleatorio
            </button>
          </div>
        </div>
      </div>
    </section>
  );

  if (isTracksLoading && displayedTracks.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-8 pb-32">
        {headerSlot}
        <div className="mt-2 divide-y divide-[var(--border-hairline)] border-t border-[var(--border-hairline)]">
          {Array.from({ length: Math.min(Math.max(meta.totalTracks || 6, 4), 10) }).map((_, i) => (
            <div key={i} className="h-[54px] px-3 flex items-center gap-4 animate-pulse">
              <div className="w-5 h-3 rounded bg-[var(--bg-card)]" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-48 rounded bg-[var(--bg-card)]" />
                <div className="h-2.5 w-28 rounded bg-[var(--bg-card)]" />
              </div>
              <div className="w-10 h-3 rounded bg-[var(--bg-card)]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isRestrictedPlaylist && displayedTracks.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-8 pb-32">
        {headerSlot}
      </div>
    );
  }

  return (
    <VirtualizedTrackList
      tracks={displayedTracks}
      currentTrackUri={currentTrackUri}
      isPlaying={isPlaying}
      showAlbumColumn={target.kind !== "album"}
      showCover={target.kind !== "album"}
      hasMore={!isRestrictedPlaylist && hasMore}
      isLoadingMore={isLoadingMore}
      onLoadMore={() => void handleLoadMore()}
      onPlayTrack={(track, idx) => void handlePlayTrack(track, idx)}
      onTogglePlay={onTogglePlay}
      onSelectAlbum={(albumId) => onSelectAlbum(albumId)}
      onSelectArtist={
        onSelectArtist
          ? (artistId, artistName) =>
              onSelectArtist({
                id: artistId,
                name: artistName || "Artista",
                uri: `spotify:artist:${artistId}`,
              })
          : undefined
      }
      onTrackContextMenu={onTrackContextMenu}
      headerSlot={headerSlot}
    />
  );
}
