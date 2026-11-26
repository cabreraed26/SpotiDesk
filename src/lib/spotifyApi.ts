import type {
  SpotifyAlbumSimple,
  SpotifyArtist,
  SpotifyCursorPaging,
  SpotifyDevice,
  SpotifyPaging,
  SpotifyPlaybackStateResponse,
  SpotifyPlaylist,
  SpotifyPlaylistTrackItem,
  SpotifySavedAlbumItem,
  SpotifySavedTrackItem,
  SpotifySearchResults,
  SpotifyTrack,
  SpotifyUser,
} from "../types/spotify";

const API_BASE = "https://api.spotify.com/v1";

export class SpotifyApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "SpotifyApiError";
  }
}

export interface SpotifyApiClientOptions {
  getToken: () => Promise<string | null>;
  forceRefresh: () => Promise<string | null>;
}

export class SpotifyApiClient {
  private getToken: () => Promise<string | null>;
  private forceRefresh: () => Promise<string | null>;

  constructor(options: SpotifyApiClientOptions) {
    this.getToken = options.getToken;
    this.forceRefresh = options.forceRefresh;
  }

  private async request<T>(
    endpoint: string,
    init: RequestInit = {},
    retried = false
  ): Promise<T> {
    const token = retried ? await this.forceRefresh() : await this.getToken();
    if (!token) {
      throw new SpotifyApiError(401, "Sesión no autenticada.");
    }

    const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(url, { ...init, headers });

    if (res.status === 401 && !retried) {
      return this.request<T>(endpoint, init, true);
    }

    if (res.status === 204 || res.status === 202) {
      return undefined as T;
    }

    if (!res.ok) {
      let message = `Spotify API error (${res.status})`;
      try {
        const errBody = await res.json();
        if (errBody?.error?.message) {
          message = errBody.error.message;
        }
      } catch {
        // Ignore parse error on non-JSON responses
      }
      throw new SpotifyApiError(res.status, message);
    }

    const text = await res.text();
    if (!text) return undefined as T;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      // Spotify playback/queue endpoints sometimes return a plain snapshot ID string with 200 OK
      return undefined as T;
    }
  }

  getMe(): Promise<SpotifyUser> {
    return this.request<SpotifyUser>("/me");
  }

  getUserPlaylists(limit = 50, offset = 0): Promise<SpotifyPaging<SpotifyPlaylist>> {
    return this.request<SpotifyPaging<SpotifyPlaylist>>(
      `/me/playlists?limit=${limit}&offset=${offset}`
    );
  }

  getPlaylist(playlistId: string): Promise<SpotifyPlaylist> {
    return this.request<SpotifyPlaylist>(
      `/playlists/${encodeURIComponent(playlistId)}`
    );
  }

  async getPlaylistTracks(
    playlistId: string,
    limit = 100,
    offset = 0
  ): Promise<SpotifyPaging<SpotifyPlaylistTrackItem>> {
    const id = encodeURIComponent(playlistId);
    try {
      // Spotify Web API >= Feb 2026 uses /playlists/{id}/items
      return await this.request<SpotifyPaging<SpotifyPlaylistTrackItem>>(
        `/playlists/${id}/items?limit=${limit}&offset=${offset}`
      );
    } catch (err) {
      if (err instanceof SpotifyApiError && (err.status === 404 || err.status === 400)) {
        return this.request<SpotifyPaging<SpotifyPlaylistTrackItem>>(
          `/playlists/${id}/tracks?limit=${limit}&offset=${offset}`
        );
      }
      throw err;
    }
  }

  getSavedTracks(limit = 50, offset = 0): Promise<SpotifyPaging<SpotifySavedTrackItem>> {
    return this.request<SpotifyPaging<SpotifySavedTrackItem>>(
      `/me/tracks?limit=${limit}&offset=${offset}`
    );
  }

  getSavedAlbums(limit = 50, offset = 0): Promise<SpotifyPaging<SpotifySavedAlbumItem>> {
    return this.request<SpotifyPaging<SpotifySavedAlbumItem>>(
      `/me/albums?limit=${limit}&offset=${offset}`
    );
  }

  async getFollowedArtists(
    limit = 50,
    after?: string
  ): Promise<SpotifyCursorPaging<SpotifyArtist>> {
    const params = new URLSearchParams({ type: "artist", limit: String(limit) });
    if (after) params.set("after", after);
    const data = await this.request<{ artists: SpotifyCursorPaging<SpotifyArtist> }>(
      `/me/following?${params.toString()}`
    );
    return (
      data?.artists ?? {
        items: [],
        limit,
        next: null,
      }
    );
  }

  async createPlaylist(params: {
    name: string;
    description?: string;
    isPublic?: boolean;
    userId?: string;
  }): Promise<SpotifyPlaylist> {
    const body = JSON.stringify({
      name: params.name.trim(),
      description: params.description?.trim() || "",
      public: Boolean(params.isPublic),
    });

    try {
      // Spotify Web API >= Feb 2026 uses POST /me/playlists
      return await this.request<SpotifyPlaylist>("/me/playlists", {
        method: "POST",
        body,
      });
    } catch (err) {
      if (
        params.userId &&
        err instanceof SpotifyApiError &&
        (err.status === 404 || err.status === 405)
      ) {
        return this.request<SpotifyPlaylist>(
          `/users/${encodeURIComponent(params.userId)}/playlists`,
          { method: "POST", body }
        );
      }
      throw err;
    }
  }

  getAlbum(albumId: string): Promise<
    SpotifyAlbumSimple & {
      tracks: SpotifyPaging<Omit<SpotifyTrack, "album">>;
    }
  > {
    return this.request(`/albums/${encodeURIComponent(albumId)}`);
  }

  getArtistTopTracks(artistId: string): Promise<{ tracks: SpotifyTrack[] }> {
    return this.request(`/artists/${encodeURIComponent(artistId)}/top-tracks`);
  }

  search(query: string, limit = 8): Promise<SpotifySearchResults> {
    const q = encodeURIComponent(query.trim());
    const safeLimit = Math.max(1, Math.min(limit, 10));
    return this.request<SpotifySearchResults>(
      `/search?q=${q}&type=track,album,artist&limit=${safeLimit}`
    );
  }

  async getDevices(): Promise<SpotifyDevice[]> {
    const data = await this.request<{ devices: SpotifyDevice[] }>("/me/player/devices");
    return data?.devices ?? [];
  }

  getPlaybackState(): Promise<SpotifyPlaybackStateResponse | undefined> {
    return this.request<SpotifyPlaybackStateResponse | undefined>("/me/player");
  }

  transferPlayback(deviceId: string, play = false): Promise<void> {
    return this.request<void>("/me/player", {
      method: "PUT",
      body: JSON.stringify({ device_ids: [deviceId], play }),
    });
  }

  play(params: {
    deviceId?: string | null;
    contextUri?: string;
    uris?: string[];
    offset?: { position?: number; uri?: string };
    positionMs?: number;
  }): Promise<void> {
    const query = params.deviceId
      ? `?device_id=${encodeURIComponent(params.deviceId)}`
      : "";
    const body: Record<string, unknown> = {};
    if (params.contextUri) body.context_uri = params.contextUri;
    if (params.uris) body.uris = params.uris;
    if (params.offset) body.offset = params.offset;
    if (typeof params.positionMs === "number") body.position_ms = params.positionMs;

    return this.request<void>(`/me/player/play${query}`, {
      method: "PUT",
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    });
  }

  pause(deviceId?: string | null): Promise<void> {
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
    return this.request<void>(`/me/player/pause${query}`, { method: "PUT" });
  }

  nextTrack(deviceId?: string | null): Promise<void> {
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
    return this.request<void>(`/me/player/next${query}`, { method: "POST" });
  }

  previousTrack(deviceId?: string | null): Promise<void> {
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
    return this.request<void>(`/me/player/previous${query}`, { method: "POST" });
  }

  seek(positionMs: number, deviceId?: string | null): Promise<void> {
    const params = new URLSearchParams({ position_ms: String(Math.max(0, Math.round(positionMs))) });
    if (deviceId) params.set("device_id", deviceId);
    return this.request<void>(`/me/player/seek?${params.toString()}`, { method: "PUT" });
  }

  setShuffle(state: boolean, deviceId?: string | null): Promise<void> {
    const params = new URLSearchParams({ state: String(state) });
    if (deviceId) params.set("device_id", deviceId);
    return this.request<void>(`/me/player/shuffle?${params.toString()}`, { method: "PUT" });
  }

  setRepeat(state: "off" | "context" | "track", deviceId?: string | null): Promise<void> {
    const params = new URLSearchParams({ state });
    if (deviceId) params.set("device_id", deviceId);
    return this.request<void>(`/me/player/repeat?${params.toString()}`, { method: "PUT" });
  }

  setVolume(volumePercent: number, deviceId?: string | null): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(volumePercent)));
    const params = new URLSearchParams({ volume_percent: String(clamped) });
    if (deviceId) params.set("device_id", deviceId);
    return this.request<void>(`/me/player/volume?${params.toString()}`, { method: "PUT" });
  }

  addToQueue(uri: string, deviceId?: string | null): Promise<void> {
    const params = new URLSearchParams({ uri });
    if (deviceId) params.set("device_id", deviceId);
    return this.request<void>(`/me/player/queue?${params.toString()}`, { method: "POST" });
  }

  async getQueue(): Promise<{ currently_playing: SpotifyTrack | null; queue: SpotifyTrack[] }> {
    const data = await this.request<{
      currently_playing?: SpotifyTrack | null;
      queue?: SpotifyTrack[];
    }>("/me/player/queue");
    return {
      currently_playing: data?.currently_playing ?? null,
      queue: (data?.queue ?? []).filter(Boolean),
    };
  }

  async addTrackToPlaylist(playlistId: string, uri: string): Promise<void> {
    const id = encodeURIComponent(playlistId);
    try {
      // Spotify Web API >= Feb 2026 uses /playlists/{id}/items
      await this.request<void>(`/playlists/${id}/items`, {
        method: "POST",
        body: JSON.stringify({ uris: [uri] }),
      });
    } catch (err) {
      if (err instanceof SpotifyApiError && (err.status === 404 || err.status === 400)) {
        await this.request<void>(`/playlists/${id}/tracks`, {
          method: "POST",
          body: JSON.stringify({ uris: [uri] }),
        });
        return;
      }
      throw err;
    }
  }

  async checkSavedTrack(trackId: string, uri?: string): Promise<boolean> {
    const trackUri = uri || `spotify:track:${trackId}`;
    try {
      // Spotify Web API >= Feb 2026 unified library endpoint
      const res = await this.request<boolean[]>(
        `/me/library/contains?uris=${encodeURIComponent(trackUri)}`
      );
      return Boolean(res?.[0]);
    } catch (err) {
      if (err instanceof SpotifyApiError && (err.status === 404 || err.status === 400)) {
        try {
          const res = await this.request<boolean[]>(
            `/me/tracks/contains?ids=${encodeURIComponent(trackId)}`
          );
          return Boolean(res?.[0]);
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  async saveTrack(trackId: string, uri: string): Promise<void> {
    const trackUri = uri || `spotify:track:${trackId}`;
    try {
      // Spotify Web API >= Feb 2026 unified library endpoint (PUT /me/tracks now returns 403)
      await this.request<void>(`/me/library?uris=${encodeURIComponent(trackUri)}`, {
        method: "PUT",
      });
    } catch (err) {
      if (err instanceof SpotifyApiError && (err.status === 404 || err.status === 400)) {
        await this.request<void>(`/me/tracks?ids=${encodeURIComponent(trackId)}`, {
          method: "PUT",
        });
        return;
      }
      throw err;
    }
  }

  async removeSavedTrack(trackId: string, uri: string): Promise<void> {
    const trackUri = uri || `spotify:track:${trackId}`;
    try {
      // Spotify Web API >= Feb 2026 unified library endpoint (DELETE /me/tracks now returns 403)
      await this.request<void>(`/me/library?uris=${encodeURIComponent(trackUri)}`, {
        method: "DELETE",
      });
    } catch (err) {
      if (err instanceof SpotifyApiError && (err.status === 404 || err.status === 400)) {
        await this.request<void>(`/me/tracks?ids=${encodeURIComponent(trackId)}`, {
          method: "DELETE",
        });
        return;
      }
      throw err;
    }
  }
}
