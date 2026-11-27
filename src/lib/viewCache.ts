import type { SpotifyApiClient } from "./spotifyApi";
import { SpotifyApiError } from "./spotifyApi";
import { getBestImage, normalizeTrack } from "./format";
import type {
  SpotifyAlbumSimple,
  SpotifyArtist,
  SpotifyPlaylist,
  SpotifyPlaylistTrackItem,
  SpotifySearchResults,
  UnifiedTrack,
} from "../types/spotify";

export type SearchFilterTab = "all" | "artists" | "albums" | "tracks";

export interface CachedSearchState {
  query: string;
  results: SpotifySearchResults;
  filter: SearchFilterTab;
}

export interface CachedAlbumsPage {
  items: SpotifyAlbumSimple[];
  total: number;
  offset: number;
  hasMore: boolean;
}

export interface CachedArtistsPage {
  items: SpotifyArtist[];
  total: number;
  after?: string;
  hasMore: boolean;
}

export interface CachedArtistDiscography {
  artist: SpotifyArtist | null;
  albums: SpotifyAlbumSimple[];
  offset: number;
  hasMore: boolean;
}

export interface CachedAlbumDetail {
  album: SpotifyAlbumSimple;
  tracks: UnifiedTrack[];
}

export interface CachedPlaylistDetail {
  playlist: SpotifyPlaylist;
  tracks: UnifiedTrack[];
  offset: number;
  hasMore: boolean;
  isRestricted: boolean;
}

export interface CachedLikedTracks {
  tracks: UnifiedTrack[];
  total: number;
  offset: number;
  hasMore: boolean;
}

const MAX_MAP_ENTRIES = 32;
const CACHE_FRESH_MS = 10 * 60_000; // 10 minutes in-memory freshness for playlists/library
const CATALOG_PERSIST_TTL_MS = 24 * 60 * 60_000; // 24 hours persistent cache for Artists & Albums
const CATALOG_STORAGE_KEY = "spotidesk.catalog_cache_v1";

interface PersistedCatalogStore {
  artists: Record<string, { savedAt: number; data: CachedArtistDiscography }>;
  albums: Record<string, { savedAt: number; data: CachedAlbumDetail }>;
}

function readPersistedCatalog(): PersistedCatalogStore {
  try {
    const raw = localStorage.getItem(CATALOG_STORAGE_KEY);
    if (!raw) return { artists: {}, albums: {} };
    const parsed = JSON.parse(raw) as Partial<PersistedCatalogStore>;
    return {
      artists: parsed.artists && typeof parsed.artists === "object" ? parsed.artists : {},
      albums: parsed.albums && typeof parsed.albums === "object" ? parsed.albums : {},
    };
  } catch {
    return { artists: {}, albums: {} };
  }
}

function writePersistedCatalog(store: PersistedCatalogStore) {
  try {
    // Keep bounded so localStorage stays lean
    const trim = <T extends { savedAt: number }>(rec: Record<string, T>, max: number) => {
      const entries = Object.entries(rec).sort((a, b) => b[1].savedAt - a[1].savedAt);
      return Object.fromEntries(entries.slice(0, max));
    };
    localStorage.setItem(
      CATALOG_STORAGE_KEY,
      JSON.stringify({
        artists: trim(store.artists, 24),
        albums: trim(store.albums, 24),
      })
    );
  } catch {
    // Ignore storage quota errors
  }
}

function setBounded<K, V>(map: Map<K, V>, key: K, value: V) {
  if (map.has(key)) {
    map.delete(key);
  } else if (map.size >= MAX_MAP_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

function extractPlaylistTracks(entries: SpotifyPlaylistTrackItem[] | undefined): UnifiedTrack[] {
  return (entries ?? [])
    .map((entry) => entry?.item ?? entry?.track)
    .filter((t): t is NonNullable<typeof t> => Boolean(t && t.uri))
    .map((t) => normalizeTrack(t));
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

/**
 * Lightweight in-memory SWR cache + deduplicated background prefetcher so
 * navigating between Home, Playlists, Liked, Artists, Albums, Search, Queue,
 * and Back renders instantaneously at 0ms without reload flashes or spinner flicker.
 */
class ViewCache {
  savedAlbums: CachedAlbumsPage | null = null;
  followedArtists: CachedArtistsPage | null = null;
  likedTracks: CachedLikedTracks | null = null;
  lastSearch: CachedSearchState | null = null;
  lastQueue: UnifiedTrack[] | null = null;

  private artistDiscographies = new Map<string, CachedArtistDiscography>();
  private albumDetails = new Map<string, CachedAlbumDetail>();
  private playlistDetails = new Map<string, CachedPlaylistDetail>();
  private fetchedAt = new Map<string, number>();
  private inflight = new Set<string>();
  private pendingHoverTimer: number | null = null;
  private activePrefetches = 0;

  isFresh(key: string): boolean {
    const ts = this.fetchedAt.get(key);
    return typeof ts === "number" && Date.now() - ts < CACHE_FRESH_MS;
  }

  markFresh(key: string) {
    this.fetchedAt.set(key, Date.now());
  }

  private schedulePrefetch(_key: string, _fn: () => Promise<void>) {
    // Intentionally disabled speculative onMouseEnter network prefetching so moving the
    // cursor across playlists/albums never burns Spotify 2026 Development Mode rate-limit quota.
  }

  getArtist(id: string): CachedArtistDiscography | undefined {
    const mem = this.artistDiscographies.get(id);
    if (mem) return mem;
    const persisted = readPersistedCatalog().artists[id];
    if (persisted && Date.now() - persisted.savedAt < CATALOG_PERSIST_TTL_MS) {
      setBounded(this.artistDiscographies, id, persisted.data);
      this.fetchedAt.set(`artist:${id}`, persisted.savedAt);
      return persisted.data;
    }
    return undefined;
  }

  setArtist(id: string, data: CachedArtistDiscography) {
    setBounded(this.artistDiscographies, id, data);
    this.markFresh(`artist:${id}`);
    const store = readPersistedCatalog();
    store.artists[id] = { savedAt: Date.now(), data };
    writePersistedCatalog(store);
  }

  getAlbum(id: string): CachedAlbumDetail | undefined {
    const mem = this.albumDetails.get(id);
    if (mem) return mem;
    const persisted = readPersistedCatalog().albums[id];
    if (persisted && Date.now() - persisted.savedAt < CATALOG_PERSIST_TTL_MS) {
      setBounded(this.albumDetails, id, persisted.data);
      this.fetchedAt.set(`album:${id}`, persisted.savedAt);
      return persisted.data;
    }
    return undefined;
  }

  setAlbum(id: string, data: CachedAlbumDetail) {
    setBounded(this.albumDetails, id, data);
    this.markFresh(`album:${id}`);
    const store = readPersistedCatalog();
    store.albums[id] = { savedAt: Date.now(), data };
    writePersistedCatalog(store);
  }

  getPlaylist(id: string): CachedPlaylistDetail | undefined {
    return this.playlistDetails.get(id);
  }

  setPlaylist(id: string, data: CachedPlaylistDetail) {
    setBounded(this.playlistDetails, id, data);
    this.markFresh(`playlist:${id}`);
  }

  invalidatePlaylist(id: string) {
    this.playlistDetails.delete(id);
    this.fetchedAt.delete(`playlist:${id}`);
  }

  updateLikedOptimistic(track: UnifiedTrack, liked: boolean) {
    if (!this.likedTracks) return;
    if (liked) {
      const exists = this.likedTracks.tracks.some((t) => t.uri === track.uri);
      if (!exists) {
        this.likedTracks = {
          ...this.likedTracks,
          tracks: [track, ...this.likedTracks.tracks],
          total: this.likedTracks.total + 1,
          offset: this.likedTracks.offset + 1,
        };
      }
    } else {
      const next = this.likedTracks.tracks.filter((t) => t.uri !== track.uri);
      if (next.length !== this.likedTracks.tracks.length) {
        this.likedTracks = {
          ...this.likedTracks,
          tracks: next,
          total: Math.max(0, this.likedTracks.total - 1),
          offset: Math.max(0, this.likedTracks.offset - 1),
        };
      }
    }
  }

  async prefetchLiked(api: SpotifyApiClient): Promise<void> {
    if (this.likedTracks || this.inflight.has("liked") || api.isRateLimited()) return;
    this.inflight.add("liked");
    this.activePrefetches += 1;
    try {
      const page = await api.getSavedTracks(50, 0);
      const items = (page.items ?? [])
        .map((entry) => entry?.item ?? entry?.track)
        .filter((t): t is NonNullable<typeof t> => Boolean(t && t.uri))
        .map((t) => normalizeTrack(t));
      this.likedTracks = {
        tracks: items,
        total: page.total ?? items.length,
        offset: (page.items ?? []).length,
        hasMore: Boolean(page.next),
      };
      this.markFresh("liked");
    } catch {
      // Silent background prefetch
    } finally {
      this.activePrefetches = Math.max(0, this.activePrefetches - 1);
      this.inflight.delete("liked");
    }
  }

  async prefetchSavedAlbums(api: SpotifyApiClient): Promise<void> {
    if (this.savedAlbums || this.inflight.has("savedAlbums") || api.isRateLimited()) return;
    this.schedulePrefetch("savedAlbums", async () => {
      if (this.savedAlbums || this.inflight.has("savedAlbums") || api.isRateLimited()) return;
      this.inflight.add("savedAlbums");
      this.activePrefetches += 1;
      try {
        const page = await api.getSavedAlbums(50, 0);
        const items = (page.items ?? [])
          .map((entry) => entry?.album)
          .filter((a): a is SpotifyAlbumSimple => Boolean(a && a.id));
        this.savedAlbums = {
          items,
          total: page.total ?? items.length,
          offset: (page.items ?? []).length,
          hasMore: Boolean(page.next),
        };
        this.markFresh("savedAlbums");
      } catch {
        // Silent background prefetch
      } finally {
        this.activePrefetches = Math.max(0, this.activePrefetches - 1);
        this.inflight.delete("savedAlbums");
      }
    });
  }

  async prefetchFollowedArtists(api: SpotifyApiClient): Promise<void> {
    if (this.followedArtists || this.inflight.has("followedArtists") || api.isRateLimited()) return;
    this.schedulePrefetch("followedArtists", async () => {
      if (this.followedArtists || this.inflight.has("followedArtists") || api.isRateLimited()) return;
      this.inflight.add("followedArtists");
      this.activePrefetches += 1;
      try {
        const page = await api.getFollowedArtists(50);
        const items = (page.items ?? []).filter(Boolean);
        const nextAfter = page.cursors?.after ?? undefined;
        this.followedArtists = {
          items,
          total: page.total ?? items.length,
          after: nextAfter,
          hasMore: Boolean(page.next && nextAfter),
        };
        this.markFresh("followedArtists");
      } catch {
        // Silent background prefetch
      } finally {
        this.activePrefetches = Math.max(0, this.activePrefetches - 1);
        this.inflight.delete("followedArtists");
      }
    });
  }

  async prefetchPlaylist(
    api: SpotifyApiClient,
    playlistId: string,
    seedPlaylist?: SpotifyPlaylist
  ): Promise<void> {
    const key = `playlist:${playlistId}`;
    if (this.playlistDetails.has(playlistId) || this.inflight.has(key) || api.isRateLimited()) return;
    this.schedulePrefetch(key, async () => {
      if (this.playlistDetails.has(playlistId) || this.inflight.has(key) || api.isRateLimited()) return;
      this.inflight.add(key);
      this.activePrefetches += 1;
      try {
        const playlist = seedPlaylist ?? (await api.getPlaylist(playlistId).catch(() => undefined));
        if (!playlist) return;

        // Only 1 API call on hover prefetch: getPlaylistTracks directly using seedPlaylist metadata
        try {
          const page = await api.getPlaylistTracks(playlistId, 100, 0);
          const parsed = extractPlaylistTracks(page.items);
          this.setPlaylist(playlistId, {
            playlist,
            tracks: parsed,
            offset: (page.items ?? []).length,
            hasMore: Boolean(page.next),
            isRestricted: false,
          });
        } catch (err) {
          if (err instanceof SpotifyApiError && err.status === 403) {
            this.setPlaylist(playlistId, {
              playlist,
              tracks: [],
              offset: 0,
              hasMore: false,
              isRestricted: true,
            });
          }
        }
      } catch {
        // Silent background prefetch
      } finally {
        this.activePrefetches = Math.max(0, this.activePrefetches - 1);
        this.inflight.delete(key);
      }
    });
  }

  async prefetchAlbum(api: SpotifyApiClient, albumId: string): Promise<void> {
    const key = `album:${albumId}`;
    if (this.albumDetails.has(albumId) || this.inflight.has(key) || api.isRateLimited()) return;
    this.schedulePrefetch(key, async () => {
      if (this.albumDetails.has(albumId) || this.inflight.has(key) || api.isRateLimited()) return;
      this.inflight.add(key);
      this.activePrefetches += 1;
      try {
        const album = await api.getAlbum(albumId);
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
        this.setAlbum(albumId, { album, tracks: items });
      } catch {
        // Silent background prefetch
      } finally {
        this.activePrefetches = Math.max(0, this.activePrefetches - 1);
        this.inflight.delete(key);
      }
    });
  }

  async prefetchArtist(
    api: SpotifyApiClient,
    artistId: string,
    seedArtist?: SpotifyArtist
  ): Promise<void> {
    const key = `artist:${artistId}`;
    if (this.artistDiscographies.has(artistId) || this.inflight.has(key) || api.isRateLimited()) return;
    this.schedulePrefetch(key, async () => {
      if (this.artistDiscographies.has(artistId) || this.inflight.has(key) || api.isRateLimited()) return;
      this.inflight.add(key);
      this.activePrefetches += 1;
      try {
        const firstPage = await api.getArtistAlbums(artistId, 10, 0, "album,single");
        const combined = (firstPage.items ?? []).filter(Boolean);
        this.setArtist(artistId, {
          artist: seedArtist ?? null,
          albums: deduplicateAlbums(combined),
          offset: combined.length,
          hasMore: Boolean(firstPage.next),
        });
      } catch {
        // Silent background prefetch
      } finally {
        this.activePrefetches = Math.max(0, this.activePrefetches - 1);
        this.inflight.delete(key);
      }
    });
  }

  clear() {
    if (this.pendingHoverTimer !== null) {
      window.clearTimeout(this.pendingHoverTimer);
      this.pendingHoverTimer = null;
    }
    this.savedAlbums = null;
    this.followedArtists = null;
    this.likedTracks = null;
    this.lastSearch = null;
    this.lastQueue = null;
    this.artistDiscographies.clear();
    this.albumDetails.clear();
    this.playlistDetails.clear();
    this.fetchedAt.clear();
    this.inflight.clear();
    this.activePrefetches = 0;
  }
}

export const viewCache = new ViewCache();
