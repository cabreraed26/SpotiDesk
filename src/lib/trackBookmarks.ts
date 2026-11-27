export interface TrackBookmark {
  id: string;
  timeMs: number;
  note: string;
  createdAt: number;
}

const BOOKMARKS_KEY = "spotidesk.track_bookmarks_v1";
const MAX_TRACKS = 250;
const MAX_PER_TRACK = 12;

type BookmarkMap = Record<string, TrackBookmark[]>;

function readMap(): BookmarkMap {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as BookmarkMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: BookmarkMap) {
  try {
    const keys = Object.keys(map);
    if (keys.length > MAX_TRACKS) {
      for (const k of keys.slice(0, keys.length - MAX_TRACKS)) {
        delete map[k];
      }
    }
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

export function getTrackBookmarks(trackUri?: string): TrackBookmark[] {
  if (!trackUri) return [];
  const list = readMap()[trackUri];
  return Array.isArray(list) ? [...list].sort((a, b) => a.timeMs - b.timeMs) : [];
}

export function addTrackBookmark(
  trackUri: string,
  timeMs: number,
  note: string
): TrackBookmark[] {
  const map = readMap();
  const existing = Array.isArray(map[trackUri]) ? map[trackUri] : [];
  const clampedMs = Math.max(0, Math.round(timeMs));
  const cleanNote = note.trim().slice(0, 60);

  const entry: TrackBookmark = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timeMs: clampedMs,
    note: cleanNote || "Momento guardado",
    createdAt: Date.now(),
  };

  const next = [...existing, entry]
    .sort((a, b) => a.timeMs - b.timeMs)
    .slice(-MAX_PER_TRACK);

  map[trackUri] = next;
  writeMap(map);
  return next;
}

export function removeTrackBookmark(trackUri: string, id: string): TrackBookmark[] {
  const map = readMap();
  const existing = Array.isArray(map[trackUri]) ? map[trackUri] : [];
  const next = existing.filter((b) => b.id !== id);
  if (next.length === 0) {
    delete map[trackUri];
  } else {
    map[trackUri] = next;
  }
  writeMap(map);
  return next;
}
