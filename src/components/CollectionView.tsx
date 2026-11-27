import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  Check,
  ChevronLeft,
  CopyMinus,
  Download,
  Heart,
  ListPlus,
  Loader2,
  Pencil,
  Play,
  PlusCircle,
  Search,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
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
import { matchesShortcut } from "../lib/shortcutsConfig";
import { exportTracksToCsv } from "../lib/backupConfig";
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
  onTrackContextMenu?: (
    e: React.MouseEvent,
    track: UnifiedTrack,
    index?: number,
    sourcePlaylistId?: string
  ) => void;
  isWritablePlaylist?: boolean;
  writablePlaylists?: SpotifyPlaylist[];
  onAddTracksToQueue?: (tracks: UnifiedTrack[]) => Promise<void>;
  onUpdatePlaylistDetails?: (
    playlistId: string,
    name: string,
    description: string
  ) => Promise<void>;
  onPlaylistReordered?: (
    playlistId: string,
    fromIndex: number,
    toIndex: number
  ) => void;
  reorderedEvent?: { playlistId: string; fromIndex: number; toIndex: number; seq: number } | null;
  removedTrackUri?: { playlistId: string; uri: string; seq: number } | null;
  filterShortcut?: string;
  onShowToast?: (text: string, tone?: "default" | "warning") => void;
  onRestrictedPlaylist?: (playlistName: string) => void;
}

type TrackSortMode = "default" | "title" | "artist" | "album" | "duration";

function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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
  isWritablePlaylist = false,
  writablePlaylists = [],
  onAddTracksToQueue,
  onUpdatePlaylistDetails,
  reorderedEvent,
  removedTrackUri,
  filterShortcut = "Mod+F",
  onShowToast,
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
  const [filterQuery, setFilterQuery] = useState("");
  const [sortMode, setSortMode] = useState<TrackSortMode>("default");
  const [showFilterInput, setShowFilterInput] = useState(false);
  const [isEditingMeta, setIsEditingMeta] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [isCleaningDuplicates, setIsCleaningDuplicates] = useState(false);
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  // Multi-select state (Shift+click range & Cmd/Ctrl+click toggle)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => new Set());
  const [bulkPlaylistMenuOpen, setBulkPlaylistMenuOpen] = useState(false);
  const [isBulkWorking, setIsBulkWorking] = useState(false);
  const anchorIndexRef = useRef<number | null>(null);

  // Reset multi-select when view, filter, or sort changes
  useEffect(() => {
    setSelectedIndices(new Set());
    setBulkPlaylistMenuOpen(false);
    anchorIndexRef.current = null;
  }, [target, filterQuery, sortMode]);

  useEffect(() => {
    if (selectedIndices.size === 0) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedIndices(new Set());
        setBulkPlaylistMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [selectedIndices.size]);

  // Optimistically reorder track when dragged inside this playlist
  useEffect(() => {
    if (!reorderedEvent) return;
    if (target.kind !== "playlist" || target.id !== reorderedEvent.playlistId) return;
    const { fromIndex, toIndex } = reorderedEvent;
    if (fromIndex === toIndex) return;

    setTracks((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      const existing = viewCache.getPlaylist(target.id);
      if (existing) {
        viewCache.setPlaylist(target.id, { ...existing, tracks: next });
      }
      return next;
    });
  }, [reorderedEvent, target]);

  // Optimistically remove track if deleted from this playlist via context menu
  useEffect(() => {
    if (!removedTrackUri) return;
    if (target.kind === "playlist" && target.id === removedTrackUri.playlistId) {
      setTracks((prev) => {
        const next = prev.filter((t) => t.uri !== removedTrackUri.uri);
        const existing = viewCache.getPlaylist(target.id);
        if (existing) {
          viewCache.setPlaylist(target.id, { ...existing, tracks: next });
        }
        return next;
      });
      setMeta((prev) =>
        prev ? { ...prev, totalTracks: Math.max(0, prev.totalTracks - 1) } : prev
      );
    }
  }, [removedTrackUri, target]);

  // Focus filter input right after React renders it
  useEffect(() => {
    if (showFilterInput) {
      filterInputRef.current?.focus();
      filterInputRef.current?.select();
    }
  }, [showFilterInput]);

  // Filter shortcut (default Cmd+F / Ctrl+F) opens and focuses the instant in-playlist filter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesShortcut(e, filterShortcut)) {
        e.preventDefault();
        e.stopPropagation();
        setShowFilterInput(true);
        window.setTimeout(() => {
          filterInputRef.current?.focus();
        }, 0);
      } else if (e.key === "Escape" && (showFilterInput || filterQuery)) {
        if (document.activeElement === filterInputRef.current || filterQuery) {
          e.preventDefault();
          setFilterQuery("");
          setShowFilterInput(false);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [filterQuery, filterShortcut, showFilterInput]);

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

    // Skip redundant network revalidation if our SWR cache is still fresh (< 2 min)
    if (snap.hasFullCache && viewCache.isFresh(targetKey)) {
      return;
    }

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
          viewCache.markFresh("liked");
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
  const rawDisplayedTracks =
    isRestrictedPlaylist && isThisContextPlaying && sdkWindowTracks.length > 0
      ? sdkWindowTracks
      : tracks;

  const displayedTracks = useMemo(() => {
    const q = foldText(filterQuery.trim());
    let list = q
      ? rawDisplayedTracks.filter(
          (t) =>
            foldText(t.name).includes(q) ||
            foldText(t.artists).includes(q) ||
            foldText(t.albumName).includes(q)
        )
      : rawDisplayedTracks;

    if (sortMode !== "default") {
      list = [...list].sort((a, b) => {
        switch (sortMode) {
          case "title":
            return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
          case "artist":
            return a.artists.localeCompare(b.artists, "es", { sensitivity: "base" });
          case "album":
            return a.albumName.localeCompare(b.albumName, "es", { sensitivity: "base" });
          case "duration":
            return b.durationMs - a.durationMs;
          default:
            return 0;
        }
      });
    }
    return list;
  }, [rawDisplayedTracks, filterQuery, sortMode]);

  const handleRowSelect = useCallback(
    (e: React.MouseEvent, index: number): boolean => {
      if (e.shiftKey) {
        e.preventDefault();
        const anchor = anchorIndexRef.current ?? index;
        const start = Math.min(anchor, index);
        const end = Math.max(anchor, index);
        setSelectedIndices((prev) => {
          const next = new Set(e.metaKey || e.ctrlKey ? prev : []);
          for (let i = start; i <= end; i++) next.add(i);
          return next;
        });
        return true;
      }
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        anchorIndexRef.current = index;
        setSelectedIndices((prev) => {
          const next = new Set(prev);
          if (next.has(index)) next.delete(index);
          else next.add(index);
          return next;
        });
        return true;
      }
      // Plain click clears any existing selection and records anchor for future Shift+click
      anchorIndexRef.current = index;
      if (selectedIndices.size > 0) {
        setSelectedIndices(new Set());
        setBulkPlaylistMenuOpen(false);
      }
      return false;
    },
    [selectedIndices.size]
  );

  const selectedTracks = useMemo(() => {
    if (selectedIndices.size === 0) return [];
    return [...selectedIndices]
      .sort((a, b) => a - b)
      .map((i) => displayedTracks[i])
      .filter((t): t is UnifiedTrack => Boolean(t));
  }, [displayedTracks, selectedIndices]);

  const duplicateEntries = useMemo(() => {
    if (!isWritablePlaylist || target.kind !== "playlist") return [];
    const seen = new Set<string>();
    const dupMap = new Map<string, number[]>();
    tracks.forEach((t, idx) => {
      if (seen.has(t.uri)) {
        const list = dupMap.get(t.uri) ?? [];
        list.push(idx);
        dupMap.set(t.uri, list);
      } else {
        seen.add(t.uri);
      }
    });
    return [...dupMap.entries()].map(([uri, positions]) => ({ uri, positions }));
  }, [isWritablePlaylist, target.kind, tracks]);

  const duplicateCount = useMemo(
    () => duplicateEntries.reduce((acc, e) => acc + e.positions.length, 0),
    [duplicateEntries]
  );

  const handleSavePlaylistMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (target.kind !== "playlist" || !editName.trim() || !onUpdatePlaylistDetails) return;
    setIsSavingMeta(true);
    try {
      await onUpdatePlaylistDetails(target.id, editName.trim(), editDesc.trim());
      setMeta((prev) =>
        prev
          ? {
              ...prev,
              title: editName.trim(),
              description: editDesc.trim() || undefined,
            }
          : prev
      );
      setIsEditingMeta(false);
    } finally {
      setIsSavingMeta(false);
    }
  };

  const handleCleanDuplicates = async () => {
    if (target.kind !== "playlist" || duplicateEntries.length === 0 || isCleaningDuplicates) return;
    setIsCleaningDuplicates(true);
    const dupIndexSet = new Set(duplicateEntries.flatMap((d) => d.positions));
    const cleaned = tracks.filter((_, idx) => !dupIndexSet.has(idx));
    const prevTracks = tracks;

    // Optimistic 0ms cleanup
    setTracks(cleaned);
    setMeta((prev) => (prev ? { ...prev, totalTracks: cleaned.length } : prev));
    const existing = viewCache.getPlaylist(target.id);
    if (existing) {
      viewCache.setPlaylist(target.id, { ...existing, tracks: cleaned });
    }

    try {
      await api.removePlaylistPositions(target.id, duplicateEntries);
      onShowToast?.(
        duplicateCount === 1
          ? "1 duplicado eliminado de la playlist"
          : `${duplicateCount} duplicados eliminados de la playlist`
      );
    } catch {
      setTracks(prevTracks);
      onShowToast?.("No se pudieron limpiar los duplicados.", "warning");
    } finally {
      setIsCleaningDuplicates(false);
    }
  };

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

          {isEditingMeta && target.kind === "playlist" ? (
            <form onSubmit={(e) => void handleSavePlaylistMeta(e)} className="space-y-2.5 max-w-[440px]">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Nombre de la playlist"
                autoFocus
                className="w-full h-10 px-3 rounded-xl text-[15px] font-semibold bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--text-primary)]"
              />
              <input
                type="text"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Descripción (opcional)"
                className="w-full h-9 px-3 rounded-xl text-[12.5px] bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-hairline)] focus:outline-none focus:border-[var(--text-primary)]"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={isSavingMeta || !editName.trim()}
                  className="h-8 px-3.5 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] text-[12px] font-medium inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <Check size={13} strokeWidth={1.8} />
                  {isSavingMeta ? "Guardando..." : "Guardar"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingMeta(false)}
                  className="h-8 px-3 rounded-full text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                <h1 className="text-[32px] md:text-[38px] font-semibold tracking-[-0.03em] leading-[1.08] text-[var(--text-primary)] line-clamp-2">
                  {meta.title}
                </h1>
                {isWritablePlaylist && target.kind === "playlist" && onUpdatePlaylistDetails && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditName(meta.title);
                      setEditDesc(meta.description || "");
                      setIsEditingMeta(true);
                    }}
                    title="Editar nombre y descripción"
                    aria-label="Editar detalles de la playlist"
                    className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                  >
                    <Pencil size={14} strokeWidth={1.6} />
                  </button>
                )}
              </div>

              {meta.description && (
                <p
                  className="text-[13px] text-[var(--text-secondary)] line-clamp-2 max-w-[600px]"
                  dangerouslySetInnerHTML={{
                    __html: meta.description.replace(/<a [^>]*>(.*?)<\/a>/g, "$1"),
                  }}
                />
              )}
            </>
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

          <div className="pt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
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

            {rawDisplayedTracks.length > 0 && (
              <div className="chrome-no-select flex items-center gap-2">
                {showFilterInput || filterQuery ? (
                  <div className="relative flex items-center">
                    <Search
                      size={13}
                      strokeWidth={1.6}
                      className="pointer-events-none absolute left-3 text-[var(--text-tertiary)]"
                    />
                    <input
                      ref={filterInputRef}
                      type="text"
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                      onBlur={() => {
                        if (!filterQuery.trim()) setShowFilterInput(false);
                      }}
                      placeholder="Filtrar lista..."
                      aria-label="Filtrar canciones en esta colección"
                      className="h-9 w-48 sm:w-56 pl-8 pr-7 rounded-full text-[12px] bg-[var(--bg-elevated)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--text-primary)] transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setFilterQuery("");
                        setShowFilterInput(false);
                      }}
                      aria-label="Limpiar filtro"
                      className="absolute right-2 w-5 h-5 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      <X size={12} strokeWidth={1.6} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setShowFilterInput(true);
                      window.requestAnimationFrame(() => filterInputRef.current?.focus());
                    }}
                    title="Filtrar en esta lista (⌘F / Ctrl+F)"
                    aria-label="Filtrar canciones"
                    className="h-9 w-9 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <Search size={14} strokeWidth={1.5} />
                  </button>
                )}

                {duplicateCount > 0 && (
                  <button
                    type="button"
                    disabled={isCleaningDuplicates}
                    onClick={() => void handleCleanDuplicates()}
                    title="Eliminar canciones duplicadas de esta playlist"
                    className="h-9 px-3 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[11.5px] font-medium text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <CopyMinus size={13} strokeWidth={1.6} />
                    Limpiar {duplicateCount} {duplicateCount === 1 ? "duplicado" : "duplicados"}
                  </button>
                )}

                <div className="relative inline-flex items-center">
                  <ArrowUpDown
                    size={12}
                    strokeWidth={1.6}
                    className="pointer-events-none absolute left-2.5 text-[var(--text-tertiary)]"
                  />
                  <select
                    aria-label="Ordenar canciones"
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as TrackSortMode)}
                    className="apple-select h-9 !pl-7 !pr-7 !rounded-full !text-[12px]"
                  >
                    <option value="default">Orden original</option>
                    <option value="title">Título (A–Z)</option>
                    <option value="artist">Artista (A–Z)</option>
                    {target.kind !== "album" && <option value="album">Álbum (A–Z)</option>}
                    <option value="duration">Duración</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    exportTracksToCsv(meta.title, displayedTracks);
                    onShowToast?.(
                      `Lista exportada (${displayedTracks.length} canciones en CSV)`
                    );
                  }}
                  title="Exportar lista en CSV (Excel / Numbers)"
                  aria-label="Exportar lista en CSV"
                  className="h-9 w-9 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors cursor-pointer"
                >
                  <Download size={14} strokeWidth={1.5} />
                </button>
              </div>
            )}
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

  const handleBulkQueue = async () => {
    if (selectedTracks.length === 0 || !onAddTracksToQueue || isBulkWorking) return;
    setIsBulkWorking(true);
    try {
      await onAddTracksToQueue(selectedTracks);
      setSelectedIndices(new Set());
    } finally {
      setIsBulkWorking(false);
    }
  };

  const handleBulkAddToPlaylist = async (playlist: SpotifyPlaylist) => {
    if (selectedTracks.length === 0 || isBulkWorking) return;
    setIsBulkWorking(true);
    setBulkPlaylistMenuOpen(false);
    try {
      const uris = selectedTracks.map((t) => t.uri);
      await api.addTracksToPlaylist(playlist.id, uris);
      viewCache.invalidatePlaylist(playlist.id);
      onShowToast?.(
        `${uris.length} ${uris.length === 1 ? "canción añadida" : "canciones añadidas"} a "${playlist.name}"`
      );
      setSelectedIndices(new Set());
    } catch {
      onShowToast?.("No se pudieron añadir las canciones a esa playlist.", "warning");
    } finally {
      setIsBulkWorking(false);
    }
  };

  const handleBulkRemoveFromCurrent = async () => {
    if (
      target.kind !== "playlist" ||
      !isWritablePlaylist ||
      selectedTracks.length === 0 ||
      isBulkWorking
    ) {
      return;
    }
    setIsBulkWorking(true);
    try {
      const grouped = new Map<string, number[]>();
      const positionsToRemove = new Set<number>();
      for (const t of selectedTracks) {
        const origIdx = tracks.findIndex(
          (orig, idx) => orig.uri === t.uri && !positionsToRemove.has(idx)
        );
        if (origIdx >= 0) {
          positionsToRemove.add(origIdx);
          const list = grouped.get(t.uri) ?? [];
          list.push(origIdx);
          grouped.set(t.uri, list);
        }
      }
      const payload = Array.from(grouped.entries()).map(([uri, positions]) => ({
        uri,
        positions,
      }));
      if (payload.length === 0) return;

      await api.removePlaylistPositions(target.id, payload);
      setTracks((prev) => prev.filter((_, idx) => !positionsToRemove.has(idx)));
      viewCache.invalidatePlaylist(target.id);
      onShowToast?.(
        `${positionsToRemove.size} ${
          positionsToRemove.size === 1 ? "canción quitada" : "canciones quitadas"
        } de la playlist`
      );
      setSelectedIndices(new Set());
    } catch {
      onShowToast?.("No se pudieron quitar las canciones seleccionadas.", "warning");
    } finally {
      setIsBulkWorking(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <VirtualizedTrackList
        tracks={displayedTracks}
        currentTrackUri={currentTrackUri}
        isPlaying={isPlaying}
        showAlbumColumn={target.kind !== "album"}
        showCover={target.kind !== "album"}
        hasMore={!isRestrictedPlaylist && !filterQuery.trim() && hasMore}
        isLoadingMore={isLoadingMore}
        emptyMessage={
          filterQuery.trim()
            ? `No se encontraron canciones para “${filterQuery.trim()}”.`
            : undefined
        }
        reorderPlaylistId={
          isWritablePlaylist &&
          target.kind === "playlist" &&
          sortMode === "default" &&
          !filterQuery.trim()
            ? target.id
            : undefined
        }
        selectedIndices={selectedIndices}
        onRowSelect={handleRowSelect}
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
        onTrackContextMenu={
          onTrackContextMenu
            ? (e, track, idx) =>
                onTrackContextMenu(
                  e,
                  track,
                  idx,
                  target.kind === "playlist" ? target.id : undefined
                )
            : undefined
        }
        headerSlot={headerSlot}
      />

      {/* Floating Multi-Select Bulk Action Bar */}
      {selectedTracks.length > 0 && (
        <div className="anim-popover-enter chrome-no-select fixed bottom-[92px] left-1/2 -translate-x-1/2 z-40 popover-glass rounded-full border border-[var(--border-subtle)] px-3 py-1.5 shadow-2xl flex items-center gap-1.5">
          <span className="px-2 text-[12px] font-medium tabular-nums text-[var(--text-primary)]">
            {selectedTracks.length}{" "}
            {selectedTracks.length === 1 ? "seleccionada" : "seleccionadas"}
          </span>

          <div className="w-px h-4 bg-[var(--border-hairline)]" />

          {onAddTracksToQueue && (
            <button
              type="button"
              disabled={isBulkWorking}
              onClick={() => void handleBulkQueue()}
              className="h-7 px-2.5 rounded-full text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <ListPlus size={13} strokeWidth={1.6} />
              Cola
            </button>
          )}

          {writablePlaylists.length > 0 && (
            <div className="relative">
              <button
                type="button"
                disabled={isBulkWorking}
                onClick={() => setBulkPlaylistMenuOpen((v) => !v)}
                className="h-7 px-2.5 rounded-full text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
              >
                <PlusCircle size={13} strokeWidth={1.6} />
                Añadir a playlist
              </button>

              {bulkPlaylistMenuOpen && (
                <div className="anim-popover-enter popover-glass absolute bottom-10 left-0 w-56 max-h-52 overflow-y-auto p-1.5 rounded-2xl border border-[var(--border-subtle)] shadow-2xl space-y-0.5">
                  {writablePlaylists.map((pl) => (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => void handleBulkAddToPlaylist(pl)}
                      className="w-full px-2.5 py-1.5 rounded-xl flex items-center gap-2 text-left text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                    >
                      <LazyCover
                        src={getBestImage(pl.images, "small")}
                        alt={pl.name}
                        className="w-6 h-6 shrink-0"
                        iconSize={11}
                        roundedClass="rounded"
                      />
                      <span className="truncate">{pl.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {isWritablePlaylist && target.kind === "playlist" && (
            <button
              type="button"
              disabled={isBulkWorking}
              onClick={() => void handleBulkRemoveFromCurrent()}
              className="h-7 px-2.5 rounded-full text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <Trash2 size={13} strokeWidth={1.6} />
              Quitar
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setSelectedIndices(new Set());
              setBulkPlaylistMenuOpen(false);
            }}
            title="Limpiar selección (Esc)"
            aria-label="Limpiar selección"
            className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <X size={13} strokeWidth={1.7} />
          </button>
        </div>
      )}
    </div>
  );
}
