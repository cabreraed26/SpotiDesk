import type { UnifiedTrack } from "../types/spotify";

const STATS_STORAGE_KEY = "spotidesk.listening_stats_v1";
const MAX_PLAY_EVENTS = 600;

export interface PlayEventRecord {
  ts: number;
  dayKey: string; // YYYY-MM-DD local
  uri: string;
  name: string;
  artists: string;
  artistId?: string;
  albumImage?: string;
  durationMs: number;
}

export interface DayListeningBucket {
  dayKey: string;
  label: string;
  minutes: number;
  plays: number;
}

export interface WeeklyStatsSummary {
  totalMinutes7d: number;
  totalPlays7d: number;
  streakDays: number;
  days: DayListeningBucket[];
  topArtists: Array<{ name: string; artistId?: string; plays: number; minutes: number }>;
  topTracks: Array<{ track: UnifiedTrack; plays: number }>;
}

function getLocalDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function loadPlayEvents(): PlayEventRecord[] {
  try {
    const raw = localStorage.getItem(STATS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PlayEventRecord[];
    return Array.isArray(parsed) ? parsed.filter((e) => Boolean(e?.uri && e?.ts)) : [];
  } catch {
    return [];
  }
}

export function getListeningHistory(): PlayEventRecord[] {
  return loadPlayEvents();
}

export function clearListeningHistory() {
  try {
    localStorage.removeItem(STATS_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function recordListeningEvent(track: UnifiedTrack) {
  if (!track?.uri) return;
  const now = new Date();
  const ts = now.getTime();
  const events = loadPlayEvents();

  // Deduplicate accidental double-triggers within 25 seconds for the same track
  const latest = events[0];
  if (latest && latest.uri === track.uri && ts - latest.ts < 25_000) {
    return;
  }

  const next: PlayEventRecord[] = [
    {
      ts,
      dayKey: getLocalDayKey(now),
      uri: track.uri,
      name: track.name,
      artists: track.artists,
      artistId: track.artistId,
      albumImage: track.albumImage,
      durationMs: Math.max(30_000, Math.min(track.durationMs || 180_000, 15 * 60_000)),
    },
    ...events,
  ].slice(0, MAX_PLAY_EVENTS);

  try {
    localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota
  }
}

const WEEKDAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function computeWeeklyStats(): WeeklyStatsSummary {
  const events = loadPlayEvents();
  const now = new Date();

  const days: DayListeningBucket[] = [];
  const dayMap = new Map<string, DayListeningBucket>();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = getLocalDayKey(d);
    const bucket: DayListeningBucket = {
      dayKey: key,
      label: i === 0 ? "Hoy" : WEEKDAY_SHORT[d.getDay()],
      minutes: 0,
      plays: 0,
    };
    days.push(bucket);
    dayMap.set(key, bucket);
  }

  const cutoffMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const recent = events.filter((e) => e.ts >= cutoffMs);

  let totalMs7d = 0;
  const artistMap = new Map<
    string,
    { name: string; artistId?: string; plays: number; ms: number }
  >();
  const trackMap = new Map<string, { record: PlayEventRecord; plays: number }>();

  for (const ev of recent) {
    totalMs7d += ev.durationMs;
    const bucket = dayMap.get(ev.dayKey);
    if (bucket) {
      bucket.plays += 1;
      bucket.minutes += ev.durationMs / 60_000;
    }

    const primaryArtist = ev.artists.split(",")[0]?.trim() || ev.artists;
    const aKey = primaryArtist.toLowerCase();
    const prevA = artistMap.get(aKey);
    if (prevA) {
      prevA.plays += 1;
      prevA.ms += ev.durationMs;
      if (!prevA.artistId && ev.artistId) prevA.artistId = ev.artistId;
    } else {
      artistMap.set(aKey, {
        name: primaryArtist,
        artistId: ev.artistId,
        plays: 1,
        ms: ev.durationMs,
      });
    }

    const prevT = trackMap.get(ev.uri);
    if (prevT) {
      prevT.plays += 1;
    } else {
      trackMap.set(ev.uri, { record: ev, plays: 1 });
    }
  }

  // Round daily minutes cleanly
  for (const b of days) {
    b.minutes = Math.round(b.minutes);
  }

  // Daily listening streak across all recorded days
  const activeDayKeys = new Set(events.map((e) => e.dayKey));
  let streakDays = 0;
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  if (!activeDayKeys.has(getLocalDayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (activeDayKeys.has(getLocalDayKey(cursor))) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const topArtists = [...artistMap.values()]
    .sort((a, b) => b.plays - a.plays || b.ms - a.ms)
    .slice(0, 5)
    .map((a) => ({
      name: a.name,
      artistId: a.artistId,
      plays: a.plays,
      minutes: Math.max(1, Math.round(a.ms / 60_000)),
    }));

  const topTracks = [...trackMap.values()]
    .sort((a, b) => b.plays - a.plays || b.record.ts - a.record.ts)
    .slice(0, 5)
    .map(({ record, plays }) => ({
      plays,
      track: {
        id: record.uri.split(":").pop() || record.uri,
        uri: record.uri,
        name: record.name,
        artists: record.artists,
        artistId: record.artistId,
        albumName: "",
        albumImage: record.albumImage,
        durationMs: record.durationMs,
      },
    }));

  return {
    totalMinutes7d: Math.round(totalMs7d / 60_000),
    totalPlays7d: recent.length,
    streakDays,
    days,
    topArtists,
    topTracks,
  };
}
