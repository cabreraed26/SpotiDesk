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
  private inflight = new Set<string>();

  getArtist(id: string): CachedArtistDiscography | undefined {
    return this.artistDiscographies.get(id);
  }

  setArtist(id: string, data: CachedArtistDiscography) {
    setBounded(this.artistDiscographies, id, data);
  }

  getAlbum(id: string): CachedAlbumDetail | undefined {
    return this.albumDetails.get(id);
  }

  setAlbum(id: string, data: CachedAlbumDetail) {
    setBounded(this.albumDetails, id, data);
  }

  getPlaylist(id: string): CachedPlaylistDetail | undefined {
    return this.playlistDetails.get(id);
  }

  setPlaylist(id: string, data: CachedPlaylistDetail) {
    setBounded(this.playlistDetails, id, data);
  }

  invalidatePlaylist(id: string) {
    this.playlistDetails.delete(id);
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
    if (this.likedTracks || this.inflight.has("liked")) return;
    this.inflight.add("liked");
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
    } catch {
      // Silent background prefetch
    } finally {
      this.inflight.delete("liked");
    }
  }

  async prefetchSavedAlbums(api: SpotifyApiClient): Promise<void> {
    if (this.savedAlbums || this.inflight.has("savedAlbums")) return;
    this.inflight.add("savedAlbums");
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
    } catch {
      // Silent background prefetch
    } finally {
      this.inflight.delete("savedAlbums");
    }
  }

  async prefetchFollowedArtists(api: SpotifyApiClient): Promise<void> {
    if (this.followedArtists || this.inflight.has("followedArtists")) return;
    this.inflight.add("followedArtists");
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
    } catch {
      // Silent background prefetch
    } finally {
      this.inflight.delete("followedArtists");
    }
  }

  async prefetchPlaylist(
    api: SpotifyApiClient,
    playlistId: string,
    seedPlaylist?: SpotifyPlaylist
  ): Promise<void> {
    const key = `playlist:${playlistId}`;
    if (this.playlistDetails.has(playlistId) || this.inflight.has(key)) return;
    this.inflight.add(key);
    try {
      let playlist: SpotifyPlaylist | undefined = seedPlaylist;
      try {
        playlist = await api.getPlaylist(playlistId);
      } catch {
        // Fall back to seed playlist metadata
      }
      if (!playlist) return;

      const embeddedItems = (
        playlist.items as unknown as
          | { items?: SpotifyPlaylistTrackItem[]; next?: string | null; total?: number }
          | undefined
      )?.items;

      if (Array.isArray(embeddedItems) && embeddedItems.length > 0) {
        const parsed = extractPlaylistTracks(embeddedItems);
        const nextUrl = (playlist.items as unknown as { next?: string | null })?.next;
        this.setPlaylist(playlistId, {
          playlist,
          tracks: parsed,
          offset: embeddedItems.length,
          hasMore: Boolean(nextUrl),
          isRestricted: false,
        });
        return;
      }

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
      this.inflight.delete(key);
    }
  }

  async prefetchAlbum(api: SpotifyApiClient, albumId: string): Promise<void> {
    const key = `album:${albumId}`;
    if (this.albumDetails.has(albumId) || this.inflight.has(key)) return;
    this.inflight.add(key);
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
      this.inflight.delete(key);
    }
  }

  async prefetchArtist(
    api: SpotifyApiClient,
    artistId: string,
    seedArtist?: SpotifyArtist
  ): Promise<void> {
    const key = `artist:${artistId}`;
    if (this.artistDiscographies.has(artistId) || this.inflight.has(key)) return;
    this.inflight.add(key);
    try {
      const [artistRes, firstPage] = await Promise.all([
        api.getArtist(artistId).catch(() => seedArtist ?? null),
        api.getArtistAlbums(artistId, 10, 0, "album,single"),
      ]);
      const combined = (firstPage.items ?? []).filter(Boolean);
      const nextOffset = combined.length;
      const nextHasMore = Boolean(firstPage.next);
      this.setArtist(artistId, {
        artist: artistRes ?? seedArtist ?? null,
        albums: deduplicateAlbums(combined),
        offset: nextOffset,
        hasMore: nextHasMore,
      });
    } catch {
      // Silent background prefetch
    } finally {
      this.inflight.delete(key);
    }
  }

  clear() {
    this.savedAlbums = null;
    this.followedArtists = null;
    this.likedTracks = null;
    this.lastSearch = null;
    this.lastQueue = null;
    this.artistDiscographies.clear();
    this.albumDetails.clear();
    this.playlistDetails.clear();
    this.inflight.clear();
  }
}

export const viewCache = new ViewCache();
