import { useEffect, useState } from "react";
import type { UnifiedTrack } from "../types/spotify";

export interface SyncedLyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsData {
  synced: SyncedLyricLine[] | null;
  plain: string[] | null;
  instrumental: boolean;
}

interface LrcLibResponse {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

const lyricsCache = new Map<string, LyricsData | null>();
const MAX_CACHE = 40;

function parseLrc(lrc: string): SyncedLyricLine[] {
  const lines: SyncedLyricLine[] = [];
  const regex = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/;

  for (const raw of lrc.split(/\r?\n/)) {
    const match = raw.trim().match(regex);
    if (!match) continue;
    const mins = Number(match[1]);
    const secs = Number(match[2]);
    const fracStr = (match[3] ?? "0").padEnd(3, "0").slice(0, 3);
    const ms = Number(fracStr);
    const text = match[4].trim();
    lines.push({
      timeMs: mins * 60_000 + secs * 1000 + ms,
      text: text || "···",
    });
  }

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

function cleanTrackTitle(title: string): string {
  return title
    .replace(/\s*\((?:feat\.|ft\.|with|remaster(?:ed)?|live|deluxe|bonus|radio edit)[^)]*\)/gi, "")
    .replace(/\s*-\s*(?:remaster(?:ed)?|live|radio edit|single version|acoustic|deluxe).*$/gi, "")
    .trim();
}

function cacheSet(key: string, value: LyricsData | null) {
  if (lyricsCache.size >= MAX_CACHE) {
    const oldest = lyricsCache.keys().next().value;
    if (oldest) lyricsCache.delete(oldest);
  }
  lyricsCache.set(key, value);
}

async function fetchFromLrcLib(track: UnifiedTrack, signal: AbortSignal): Promise<LyricsData | null> {
  const primaryArtist = track.artists.split(",")[0]?.trim() || track.artists;
  const cleanedTitle = cleanTrackTitle(track.name);
  const durationSec = Math.round((track.durationMs || 0) / 1000);

  const params = new URLSearchParams({
    track_name: cleanedTitle,
    artist_name: primaryArtist,
  });
  if (track.albumName) params.set("album_name", track.albumName);
  if (durationSec > 0) params.set("duration", String(durationSec));

  // 1. Exact match via /api/get
  try {
    const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, { signal });
    if (res.ok) {
      const data = (await res.json()) as LrcLibResponse;
      return normalizeLrcPayload(data);
    }
  } catch (err) {
    if (signal.aborted) throw err;
  }

  // 2. Fallback search via /api/search
  const searchParams = new URLSearchParams({
    track_name: cleanedTitle,
    artist_name: primaryArtist,
  });
  const searchRes = await fetch(`https://lrclib.net/api/search?${searchParams.toString()}`, {
    signal,
  });
  if (!searchRes.ok) return null;

  const list = (await searchRes.json()) as LrcLibResponse[];
  if (!Array.isArray(list) || list.length === 0) return null;

  const best = list.find((item) => Boolean(item.syncedLyrics)) ?? list[0];
  return normalizeLrcPayload(best);
}

function normalizeLrcPayload(data: LrcLibResponse): LyricsData | null {
  if (data.instrumental) {
    return { synced: null, plain: null, instrumental: true };
  }
  const synced = data.syncedLyrics ? parseLrc(data.syncedLyrics) : null;
  const plain = data.plainLyrics
    ? data.plainLyrics
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
    : null;
  if (!synced?.length && !plain?.length) return null;
  return {
    synced: synced?.length ? synced : null,
    plain,
    instrumental: false,
  };
}

export function useLyrics(track: UnifiedTrack | null, enabled: boolean) {
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const trackKey = track ? `${track.uri}` : "";

  useEffect(() => {
    if (!enabled || !track) {
      setIsLoading(false);
      return;
    }

    if (lyricsCache.has(trackKey)) {
      setLyrics(lyricsCache.get(trackKey) ?? null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setLyrics(null);

    void fetchFromLrcLib(track, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        cacheSet(trackKey, result);
        setLyrics(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLyrics(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [enabled, track, trackKey]);

  return { lyrics, isLoading };
}
