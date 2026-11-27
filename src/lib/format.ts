import type {
  SpotifyImage,
  SpotifyPlaylist,
  SpotifyTrack,
  UnifiedTrack,
} from "../types/spotify";

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatTotalDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 min";
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours} h ${minutes} min`;
  }
  return `${Math.max(1, minutes)} min`;
}

/**
 * Compatible with both Spotify Web API >= Feb 2026 (`playlist.items.total`)
 * and legacy responses (`playlist.tracks.total`).
 */
export function getPlaylistTrackCount(playlist: SpotifyPlaylist | null | undefined): number {
  if (!playlist) return 0;
  return playlist.items?.total ?? playlist.tracks?.total ?? 0;
}

/**
 * Picks the smallest image that meets the desired pixel size to save RAM and network bandwidth.
 */
export function getBestImage(
  images: SpotifyImage[] | null | undefined,
  targetSize: "small" | "medium" | "large" = "medium"
): string | undefined {
  if (!images || images.length === 0) return undefined;

  const sorted = [...images].sort((a, b) => (a.width ?? 640) - (b.width ?? 640));
  if (targetSize === "small") {
    return sorted[0]?.url;
  }
  if (targetSize === "large") {
    return sorted[sorted.length - 1]?.url;
  }
  const mid = sorted.find((img) => (img.width ?? 300) >= 240);
  return mid?.url ?? sorted[sorted.length - 1]?.url;
}

export function normalizeTrack(track: SpotifyTrack): UnifiedTrack {
  const artistItems = (track.artists ?? [])
    .filter((a) => Boolean(a && a.id && a.name))
    .map((a) => ({ id: a.id, name: a.name }));
  return {
    id: track.id || track.uri,
    uri: track.uri,
    name: track.name || "Sin título",
    artists: (track.artists ?? []).map((a) => a.name).join(", ") || "Artista desconocido",
    artistId: artistItems[0]?.id,
    artistItems,
    albumName: track.album?.name ?? "",
    albumId: track.album?.id,
    albumImage: getBestImage(track.album?.images, "small"),
    albumImageLarge: getBestImage(track.album?.images, "large"),
    durationMs: track.duration_ms ?? 0,
  };
}
