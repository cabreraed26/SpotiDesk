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
  isUserNotRegistered: boolean;
  constructor(status: number, message: string, isUserNotRegistered = false) {
    super(message);
    this.status = status;
    this.isUserNotRegistered = isUserNotRegistered;
    this.name = "SpotifyApiError";
  }
}

export const DEV_MODE_USER_NOT_ALLOWED_MSG =
  "Esta cuenta de Spotify no tiene permiso en este Client ID (Error 403). Si alguien te compartió la app, pídele que añada tu correo de Spotify en «Settings → User Management» de su panel de Spotify, o pulsa «Cambiar Client ID» para crear el tuyo propio en 1 minuto.";

function isDevModeUnregistered403(status: number, rawText: string, endpoint: string): boolean {
  if (status !== 403) return false;
  const lower = rawText.toLowerCase();
  if (
    lower.includes("developer.spotify.com/dashboard") ||
    lower.includes("not be registered") ||
    lower.includes("not registered") ||
    lower.includes("user may not be registered")
  ) {
    return true;
  }
  // Spotify /me returns a plain-text or empty 403 when the account is not allowlisted in Dev Mode
  return endpoint === "/me";
}

export interface SpotifyApiClientOptions {
  getToken: () => Promise<string | null>;
  forceRefresh: () => Promise<string | null>;
}

export class SpotifyApiClient {
  private getToken: () => Promise<string | null>;
  private forceRefresh: () => Promise<string | null>;
  private inflightGets = new Map<string, Promise<unknown>>();
  private rateLimitedUntil = 0;

  constructor(options: SpotifyApiClientOptions) {
    this.getToken = options.getToken;
    this.forceRefresh = options.forceRefresh;
  }

  isRateLimited(): boolean {
    return Date.now() < this.rateLimitedUntil;
  }

  private async request<T>(
    endpoint: string,
    init: RequestInit = {},
    retried = false,
    rateLimitAttempt = 0
  ): Promise<T> {
    const method = (init.method ?? "GET").toUpperCase();
    const isGet = method === "GET";

    if (isGet && !retried && rateLimitAttempt === 0) {
      const existing = this.inflightGets.get(endpoint);
      if (existing) {
        return existing as Promise<T>;
      }
    }

    const execute = async (): Promise<T> => {
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
        return this.request<T>(endpoint, init, true, rateLimitAttempt);
      }

      if (res.status === 429) {
        const retryHeader = Number(res.headers.get("retry-after"));
        const hasHeader = Number.isFinite(retryHeader) && retryHeader > 0;
        const retrySec = hasHeader ? retryHeader : rateLimitAttempt === 0 ? 2 : 4;
        this.rateLimitedUntil = Math.max(
          this.rateLimitedUntil,
          Date.now() + Math.min(retrySec + 1, 30) * 1000
        );

        // Automatically back off & retry up to 2 times for short GET rate-limit windows
        if (isGet && rateLimitAttempt < 2 && retrySec <= 5) {
          const waitMs = Math.min(5500, retrySec * 1000 + 250 + rateLimitAttempt * 1200);
          await new Promise((r) => window.setTimeout(r, waitMs));
          return this.request<T>(endpoint, init, retried, rateLimitAttempt + 1);
        }

        throw new SpotifyApiError(
          429,
          `Spotify limitó temporalmente las peticiones. Espera ${Math.min(retrySec, 30)}s e intenta de nuevo.`
        );
      }

      if (res.status === 204 || res.status === 202) {
        return undefined as T;
      }

      if (!res.ok) {
        let message = `Spotify API error (${res.status})`;
        let rawText = "";
        try {
          rawText = (await res.text()).trim();
          if (rawText) {
            try {
              const errBody = JSON.parse(rawText) as { error?: { message?: string } };
              if (errBody?.error?.message) {
                message = errBody.error.message;
              } else {
                message = rawText;
              }
            } catch {
              // Non-JSON error body (e.g. Spotify Development Mode 403 plain text)
              message = rawText;
            }
          }
        } catch {
          // Ignore body read error
        }

        const notRegistered = isDevModeUnregistered403(res.status, rawText, endpoint);
        if (notRegistered) {
          message = DEV_MODE_USER_NOT_ALLOWED_MSG;
        }
        throw new SpotifyApiError(res.status, message, notRegistered);
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
    };

    if (isGet && !retried && rateLimitAttempt === 0) {
      const promise = execute().finally(() => {
        this.inflightGets.delete(endpoint);
      });
      this.inflightGets.set(endpoint, promise);
      return promise;
    }

    return execute();
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

  getArtist(artistId: string): Promise<SpotifyArtist> {
    return this.request<SpotifyArtist>(`/artists/${encodeURIComponent(artistId)}`);
  }

  getArtistAlbums(
    artistId: string,
    limit = 10,
    offset = 0,
    includeGroups = "album,single"
  ): Promise<SpotifyPaging<SpotifyAlbumSimple>> {
    // Spotify Web API >= Feb 2026 Development Mode caps limit at 10
    const safeLimit = Math.max(1, Math.min(limit, 10));
    const params = new URLSearchParams({
      include_groups: includeGroups,
      limit: String(safeLimit),
      offset: String(Math.max(0, offset)),
    });
    return this.request<SpotifyPaging<SpotifyAlbumSimple>>(
      `/artists/${encodeURIComponent(artistId)}/albums?${params.toString()}`
    );
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

  async searchTracks(query: string, limit = 10): Promise<SpotifyTrack[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const q = encodeURIComponent(trimmed);
    const safeLimit = Math.max(1, Math.min(limit, 10));
    const data = await this.request<{ tracks?: SpotifyPaging<SpotifyTrack> }>(
      `/search?q=${q}&type=track&limit=${safeLimit}`
    );
    return (data?.tracks?.items ?? []).filter((t): t is SpotifyTrack => Boolean(t && t.uri));
  }

  /**
   * Discovers fresh related tracks for seamless endless Autoplay when the queue runs out.
   * Uses search + saved library fallback so it remains reliable under Spotify 2026 Dev Mode.
   */
  async getAutoplayTracks(
    seed: { uri: string; name: string; artists: string },
    excludeUris: Set<string>,
    count = 12
  ): Promise<SpotifyTrack[]> {
    const normalizeTitle = (s: string) =>
      s
        .toLowerCase()
        .replace(/\s*\([^)]*\)/g, "")
        .replace(/\s*-\s*(remaster|live|acoustic|remix|radio edit|version).*$/i, "")
        .trim();

    const seedTitleNorm = normalizeTitle(seed.name);
    const artistList = seed.artists
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const primaryArtist = artistList[0] ?? "";
    const secondaryArtist = artistList[1] ?? "";

    const queries: string[] = [];
    if (primaryArtist) {
      queries.push(`artist:"${primaryArtist}"`);
      if (secondaryArtist) {
        queries.push(`artist:"${secondaryArtist}"`);
      } else {
        queries.push(primaryArtist);
      }
    } else if (seed.name.trim()) {
      queries.push(seed.name.trim());
    }

    const searchResults = await Promise.allSettled(
      queries.map((q) => this.searchTracks(q, 10))
    );

    const pool: SpotifyTrack[] = [];
    for (const res of searchResults) {
      if (res.status === "fulfilled") {
        pool.push(...res.value);
      }
    }

    const seenUris = new Set<string>([...excludeUris, seed.uri]);
    const seenTitles = new Set<string>([seedTitleNorm]);
    const unique: SpotifyTrack[] = [];

    const addCandidate = (t: SpotifyTrack) => {
      if (!t?.uri || seenUris.has(t.uri)) return;
      const norm = normalizeTitle(t.name);
      if (norm && seenTitles.has(norm)) return;
      seenUris.add(t.uri);
      if (norm) seenTitles.add(norm);
      unique.push(t);
    };

    pool.forEach(addCandidate);

    // Fallback to user's Liked Songs if search yielded too few fresh candidates
    if (unique.length < 4) {
      try {
        const firstPage = await this.getSavedTracks(20, 0);
        const total = firstPage.total ?? 0;
        let savedItems = firstPage.items ?? [];
        if (total > 20) {
          const randOffset = Math.floor(Math.random() * Math.max(1, total - 20));
          const randPage = await this.getSavedTracks(20, randOffset);
          savedItems = [...(randPage.items ?? []), ...savedItems];
        }
        savedItems
          .map((entry) => entry?.item ?? entry?.track)
          .filter((t): t is SpotifyTrack => Boolean(t && t.uri))
          .forEach(addCandidate);
      } catch {
        // Ignore fallback failure
      }
    }

    // Fisher-Yates shuffle for variety
    for (let i = unique.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unique[i], unique[j]] = [unique[j], unique[i]];
    }

    return unique.slice(0, count);
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

  async removeTrackFromPlaylist(playlistId: string, uri: string): Promise<void> {
    const id = encodeURIComponent(playlistId);
    const body = JSON.stringify({ tracks: [{ uri }] });
    try {
      await this.request<void>(`/playlists/${id}/items`, {
        method: "DELETE",
        body,
      });
    } catch (err) {
      if (err instanceof SpotifyApiError && (err.status === 404 || err.status === 400)) {
        await this.request<void>(`/playlists/${id}/tracks`, {
          method: "DELETE",
          body,
        });
        return;
      }
      throw err;
    }
  }

  async updatePlaylistDetails(
    playlistId: string,
    params: { name: string; description: string }
  ): Promise<void> {
    const id = encodeURIComponent(playlistId);
    await this.request<void>(`/playlists/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: params.name.trim(),
        description: params.description.trim(),
      }),
    });
  }

  async addTracksToPlaylist(playlistId: string, uris: string[]): Promise<void> {
    if (uris.length === 0) return;
    const id = encodeURIComponent(playlistId);
    const batch = uris.slice(0, 100);
    const body = JSON.stringify({ uris: batch });
    try {
      await this.request<void>(`/playlists/${id}/items`, {
        method: "POST",
        body,
      });
    } catch (err) {
      if (err instanceof SpotifyApiError && (err.status === 404 || err.status === 400)) {
        await this.request<void>(`/playlists/${id}/tracks`, {
          method: "POST",
          body,
        });
        return;
      }
      throw err;
    }
  }

  async reorderPlaylistTrack(
    playlistId: string,
    rangeStart: number,
    insertBefore: number
  ): Promise<void> {
    const id = encodeURIComponent(playlistId);
    const body = JSON.stringify({
      range_start: rangeStart,
      insert_before: insertBefore,
      range_length: 1,
    });
    try {
      await this.request<void>(`/playlists/${id}/items`, {
        method: "PUT",
        body,
      });
    } catch (err) {
      if (err instanceof SpotifyApiError && (err.status === 404 || err.status === 400)) {
        await this.request<void>(`/playlists/${id}/tracks`, {
          method: "PUT",
          body,
        });
        return;
      }
      throw err;
    }
  }

  async removePlaylistPositions(
    playlistId: string,
    items: Array<{ uri: string; positions: number[] }>
  ): Promise<void> {
    const id = encodeURIComponent(playlistId);
    const body = JSON.stringify({ tracks: items });
    try {
      await this.request<void>(`/playlists/${id}/items`, {
        method: "DELETE",
        body,
      });
    } catch (err) {
      if (err instanceof SpotifyApiError && (err.status === 404 || err.status === 400)) {
        await this.request<void>(`/playlists/${id}/tracks`, {
          method: "DELETE",
          body,
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
