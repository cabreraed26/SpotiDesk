import type {
  SpotifyAlbumSimple,
  SpotifyArtist,
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

/**
 * Lightweight in-memory SWR cache so navigating between Artists, Albums, and Back
 * renders instantaneously at 0ms without reload flashes or spinner flicker.
 */
class ViewCache {
  savedAlbums: CachedAlbumsPage | null = null;
  followedArtists: CachedArtistsPage | null = null;
  lastSearch: CachedSearchState | null = null;
  private artistDiscographies = new Map<string, CachedArtistDiscography>();
  private albumDetails = new Map<string, CachedAlbumDetail>();

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

  clear() {
    this.savedAlbums = null;
    this.followedArtists = null;
    this.lastSearch = null;
    this.artistDiscographies.clear();
    this.albumDetails.clear();
  }
}

export const viewCache = new ViewCache();
