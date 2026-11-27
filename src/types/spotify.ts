export interface AuthTokenPayload {
  accessToken: string;
  expiresAt: number;
  scope: string | null;
}

export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

export interface SpotifyUser {
  id: string;
  display_name: string | null;
  email?: string;
  product?: "premium" | "free" | "open" | string;
  images?: SpotifyImage[];
}

export interface SpotifyArtistSimple {
  id: string;
  name: string;
  uri: string;
}

export interface SpotifyArtist extends SpotifyArtistSimple {
  images?: SpotifyImage[];
  followers?: { total: number };
  genres?: string[];
}

export interface SpotifyAlbumSimple {
  id: string;
  name: string;
  uri: string;
  images?: SpotifyImage[];
  release_date?: string;
  album_type?: string;
  total_tracks?: number;
  artists?: SpotifyArtistSimple[];
}

export interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  type?: string;
  duration_ms: number;
  explicit?: boolean;
  track_number?: number;
  is_playable?: boolean;
  artists?: SpotifyArtistSimple[];
  album?: SpotifyAlbumSimple;
}

export interface SpotifyPlaylistCollectionRef {
  total: number;
  href?: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description?: string | null;
  collaborative?: boolean;
  uri: string;
  images?: SpotifyImage[] | null;
  owner?: {
    id?: string;
    display_name?: string | null;
  };
  /** Spotify Web API >= Feb 2026 renamed `tracks` to `items` */
  items?: SpotifyPlaylistCollectionRef | null;
  /** Legacy Spotify Web API field kept for backward compatibility */
  tracks?: SpotifyPlaylistCollectionRef | null;
}

export interface SpotifyPlaylistTrackItem {
  added_at?: string | null;
  /** Spotify Web API >= Feb 2026 renamed `track` to `item` */
  item?: SpotifyTrack | null;
  /** Legacy field */
  track?: SpotifyTrack | null;
}

export interface SpotifySavedTrackItem {
  added_at?: string;
  track?: SpotifyTrack | null;
  item?: SpotifyTrack | null;
}

export interface SpotifySavedAlbumItem {
  added_at?: string;
  album: SpotifyAlbumSimple;
}

export interface SpotifyCursorPaging<T> {
  items: T[];
  total?: number;
  limit: number;
  next: string | null;
  cursors?: {
    after?: string | null;
  };
}

export interface SpotifyPaging<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
  previous: string | null;
}

export interface SpotifySearchResults {
  tracks?: SpotifyPaging<SpotifyTrack>;
  albums?: SpotifyPaging<SpotifyAlbumSimple>;
  artists?: SpotifyPaging<SpotifyArtist>;
}

export interface SpotifyDevice {
  id: string | null;
  is_active: boolean;
  is_private_session: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent: number | null;
}

export interface SpotifyPlaybackStateResponse {
  device: SpotifyDevice;
  repeat_state: "off" | "track" | "context";
  shuffle_state: boolean;
  is_playing: boolean;
  progress_ms: number | null;
  context?: {
    uri: string | null;
  } | null;
  item: SpotifyTrack | null;
}

export interface TrackArtistRef {
  id: string;
  name: string;
}

export interface UnifiedTrack {
  id: string;
  uri: string;
  name: string;
  artists: string;
  artistId?: string;
  artistItems?: TrackArtistRef[];
  albumName: string;
  albumId?: string;
  albumImage?: string;
  albumImageLarge?: string;
  durationMs: number;
}

// Official Spotify Web Playback SDK global types
export interface WebPlaybackImage {
  url: string;
  height?: number;
  width?: number;
}

export interface WebPlaybackArtist {
  name: string;
  uri: string;
}

export interface WebPlaybackAlbum {
  uri: string;
  name: string;
  images: WebPlaybackImage[];
}

export interface WebPlaybackTrack {
  id: string | null;
  uri: string;
  name: string;
  duration_ms: number;
  artists: WebPlaybackArtist[];
  album: WebPlaybackAlbum;
}

export interface WebPlaybackState {
  context: {
    uri: string | null;
    metadata: Record<string, unknown> | null;
  };
  disallows: Record<string, boolean>;
  paused: boolean;
  position: number;
  duration: number;
  repeat_mode: 0 | 1 | 2;
  shuffle: boolean;
  track_window: {
    current_track: WebPlaybackTrack;
    previous_tracks: WebPlaybackTrack[];
    next_tracks: WebPlaybackTrack[];
  };
}

export interface SpotifyWebPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: "ready" | "not_ready", cb: (payload: { device_id: string }) => void): boolean;
  addListener(event: "player_state_changed", cb: (state: WebPlaybackState | null) => void): boolean;
  addListener(
    event: "initialization_error" | "authentication_error" | "account_error" | "playback_error",
    cb: (error: { message: string }) => void
  ): boolean;
  removeListener(event: string): boolean;
  getCurrentState(): Promise<WebPlaybackState | null>;
  setName(name: string): Promise<void>;
  getVolume(): Promise<number>;
  setVolume(volume: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  togglePlay(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  previousTrack(): Promise<void>;
  nextTrack(): Promise<void>;
  activateElement?(): Promise<void>;
}

export interface SpotifySDKNamespace {
  Player: new (options: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }) => SpotifyWebPlayer;
}

declare global {
  interface Window {
    Spotify?: SpotifySDKNamespace;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}
