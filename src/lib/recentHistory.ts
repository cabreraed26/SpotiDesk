import type { UnifiedTrack } from "../types/spotify";

const RECENT_TRACKS_KEY = "spotidesk.recent_tracks_v1";
const MAX_RECENT_TRACKS = 12;

export interface RecentTrackEntry {
  track: UnifiedTrack;
  playedAt: number;
}

export function loadRecentTracks(): RecentTrackEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_TRACKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentTrackEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => Boolean(entry?.track?.uri && entry?.track?.name));
  } catch {
    return [];
  }
}

export function recordRecentTrack(track: UnifiedTrack): RecentTrackEntry[] {
  if (!track?.uri) return loadRecentTracks();
  const prev = loadRecentTracks();
  const next: RecentTrackEntry[] = [
    { track, playedAt: Date.now() },
    ...prev.filter((entry) => entry.track.uri !== track.uri),
  ].slice(0, MAX_RECENT_TRACKS);

  try {
    localStorage.setItem(RECENT_TRACKS_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
  return next;
}

export function clearRecentTracks() {
  try {
    localStorage.removeItem(RECENT_TRACKS_KEY);
  } catch {
    // Ignore
  }
}
