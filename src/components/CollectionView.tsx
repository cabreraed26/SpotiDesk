import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Heart, Loader2, Play, Shuffle } from "lucide-react";
import { SpotifyApiError, type SpotifyApiClient } from "../lib/spotifyApi";
import type {
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
import { LazyCover } from "./LazyCover";
import { VirtualizedTrackList } from "./VirtualizedTrackList";

export type CollectionTarget =
  | { kind: "liked" }
  | { kind: "playlist"; id: string }
  | { kind: "album"; id: string };

interface CollectionMeta {
  badge: string;
  title: string;
  subtitle: string;
  description?: string;
  coverUrl?: string;
  contextUri?: string;
  totalTracks: number;
  isLiked?: boolean;
}

interface CollectionViewProps {
  target: CollectionTarget;
  api: SpotifyApiClient;
  cachedPlaylist?: SpotifyPlaylist;
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
  onSelectAlbum: (albumId: string) => void;
  onTrackContextMenu?: (e: React.MouseEvent, track: UnifiedTrack, index?: number) => void;
  onRestrictedPlaylist?: (playlistName: string) => void;
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
  currentTrackUri,
  activeContextUri,
  sdkWindowTracks = [],
  isPlaying,
  onPlayContext,
  onTogglePlay,
  onToggleShuffle,
  shuffle,
  onSelectAlbum,
  onTrackContextMenu,
  onRestrictedPlaylist,
}: CollectionViewProps) {
  const [meta, setMeta] = useState<CollectionMeta | null>(null);
  const [tracks, setTracks] = useState<UnifiedTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [isRestrictedPlaylist, setIsRestrictedPlaylist] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offsetRef = useRef(0);
  const cachedPlaylistRef = useRef<SpotifyPlaylist | undefined>(cachedPlaylist);
  cachedPlaylistRef.current = cachedPlaylist;
  const onRestrictedRef = useRef(onRestrictedPlaylist);
  onRestrictedRef.current = onRestrictedPlaylist;

  const targetKey = target.kind === "liked" ? "liked" : `${target.kind}:${target.id}`;

  // Initial load for the selected collection
  useEffect(() => {
    let cancelled = false;
    offsetRef.current = 0;
    setIsLoading(true);
    setError(null);
    setIsRestrictedPlaylist(false);
    setTracks([]);
    setMeta(null);
    setHasMore(false);

    (async () => {
      try {
        if (target.kind === "liked") {
          const page = await api.getSavedTracks(50, 0);
          if (cancelled) return;
          const items = (page.items ?? [])
            .map((entry) => entry?.item ?? entry?.track)
            .filter((t): t is NonNullable<typeof t> => Boolean(t && t.uri))
            .map((t) => normalizeTrack(t));
          setMeta({
            badge: "BIBLIOTECA",
            title: "Tus Me Gusta",
            subtitle: "Colección personal",
            totalTracks: page.total ?? items.length,
            isLiked: true,
          });
          setTracks(items);
          offsetRef.current = (page.items ?? []).length;
          setHasMore(Boolean(page.next));
        } else if (target.kind === "playlist") {
          let playlist: SpotifyPlaylist | undefined = cachedPlaylistRef.current;

          try {
            playlist = await api.getPlaylist(target.id);
          } catch {
            // Fall back to cached playlist metadata from /me/playlists
          }

          if (cancelled) return;

          if (!playlist) {
            setError("No se pudo obtener la información de esta playlist.");
            return;
          }

          setMeta({
            badge: "PLAYLIST",
            title: playlist.name,
            subtitle: playlist.owner?.display_name || "Spotify",
            description: playlist.description || undefined,
            coverUrl: getBestImage(playlist.images, "large"),
            contextUri: playlist.uri,
            totalTracks: getPlaylistTrackCount(playlist),
          });

          // Check if the full playlist payload already embedded its first page of items
          const embeddedItems = (
            playlist.items as unknown as { items?: SpotifyPlaylistTrackItem[]; next?: string | null; total?: number } | undefined
          )?.items;

          if (Array.isArray(embeddedItems) && embeddedItems.length > 0) {
            const parsed = extractPlaylistTracks(embeddedItems);
            setTracks(parsed);
            offsetRef.current = embeddedItems.length;
            const nextUrl = (playlist.items as unknown as { next?: string | null })?.next;
            setHasMore(Boolean(nextUrl));
            return;
          }

          try {
            const page = await api.getPlaylistTracks(target.id, 100, 0);
            if (cancelled) return;
            const parsed = extractPlaylistTracks(page.items);
            setTracks(parsed);
            offsetRef.current = (page.items ?? []).length;
            setHasMore(Boolean(page.next));
            if (page.total) {
              setMeta((prev) =>
                prev ? { ...prev, totalTracks: prev.totalTracks || page.total } : prev
              );
            }
          } catch (tracksErr) {
            if (cancelled) return;
            if (tracksErr instanceof SpotifyApiError && tracksErr.status === 403) {
              // Spotify Feb 2026 Dev Mode blocks reading tracks of third-party playlists,
              // but direct playback via context_uri still works!
              setIsRestrictedPlaylist(true);
              onRestrictedRef.current?.(playlist.name);
            } else {
              setError(
                tracksErr instanceof Error
                  ? tracksErr.message
                  : "Error cargando las canciones de la playlist."
              );
            }
          }
        } else if (target.kind === "album") {
          const album = await api.getAlbum(target.id);
          if (cancelled) return;
          const coverSmall = getBestImage(album.images, "small");
          const coverLarge = getBestImage(album.images, "large");
          const items: UnifiedTrack[] = (album.tracks?.items ?? []).map((t) => ({
            id: t.id || t.uri,
            uri: t.uri,
            name: t.name,
            artists: (t.artists ?? []).map((a) => a.name).join(", "),
            albumName: album.name,
            albumId: album.id,
            albumImage: coverSmall,
            albumImageLarge: coverLarge,
            durationMs: t.duration_ms ?? 0,
          }));
          const year = album.release_date?.slice(0, 4);
          setMeta({
            badge: album.album_type?.toUpperCase() || "ÁLBUM",
            title: album.name,
            subtitle: `${(album.artists ?? []).map((a) => a.name).join(", ")}${year ? ` · ${year}` : ""}`,
            coverUrl: coverLarge,
            contextUri: album.uri,
            totalTracks: album.total_tracks ?? items.length,
          });
          setTracks(items);
          offsetRef.current = items.length;
          setHasMore(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Error cargando la colección.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, targetKey, target]);

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
        setTracks((prev) => [...prev, ...nextItems]);
        offsetRef.current += (page.items ?? []).length;
        setHasMore(Boolean(page.next));
      } else if (target.kind === "playlist") {
        const page = await api.getPlaylistTracks(target.id, 100, offsetRef.current);
        const nextItems = extractPlaylistTracks(page.items);
        setTracks((prev) => [...prev, ...nextItems]);
        offsetRef.current += (page.items ?? []).length;
        setHasMore(Boolean(page.next));
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

  const headerSlot = (
    <section key={targetKey} className="pt-8 pb-7 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end gap-7">
        {meta.isLiked ? (
          <div
            className="anim-artwork-reveal w-44 h-44 shrink-0 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-center"
            style={{ boxShadow: "var(--shadow-artwork)" }}
          >
            <Heart size={48} strokeWidth={1.3} className="text-[var(--text-primary)]" />
          </div>
        ) : (
          <div
            className="anim-artwork-reveal shrink-0 rounded-2xl"
            style={{ boxShadow: "var(--shadow-artwork)" }}
          >
            <LazyCover
              src={meta.coverUrl}
              alt={meta.title}
              className="w-44 h-44"
              iconSize={40}
              roundedClass="rounded-2xl"
            />
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-2.5">
          <span className="anim-stagger-1 inline-block text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            {meta.badge}
          </span>

          <h1 className="anim-stagger-2 text-[32px] md:text-[38px] font-semibold tracking-[-0.03em] leading-[1.08] text-[var(--text-primary)] line-clamp-2">
            {meta.title}
          </h1>

          {meta.description && (
            <p
              className="anim-stagger-3 text-[13px] text-[var(--text-secondary)] line-clamp-2 max-w-[600px]"
              dangerouslySetInnerHTML={{
                __html: meta.description.replace(/<a [^>]*>(.*?)<\/a>/g, "$1"),
              }}
            />
          )}

          <div className="anim-stagger-3 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--text-secondary)] tabular-nums">
            <span className="font-medium text-[var(--text-primary)]">{meta.subtitle}</span>
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

          <div className="anim-stagger-4 pt-3 flex items-center gap-3">
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
      onSelectAlbum={onSelectAlbum}
      onTrackContextMenu={onTrackContextMenu}
      headerSlot={headerSlot}
    />
  );
}
