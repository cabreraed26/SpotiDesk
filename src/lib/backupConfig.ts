import type { UnifiedTrack } from "../types/spotify";
import { formatDuration } from "./format";

const BACKUP_KEYS = [
  "spotidesk.sidebar_org_v1",
  "spotidesk.shortcuts_v2",
  "spotidesk.track_bookmarks_v1",
  "spotidesk.lyric_offsets_v1",
  "spotyfast.theme",
  "spotyfast.ambient",
  "spotidesk.notch_position",
  "spotidesk.notch_lyrics",
  "spotidesk.notch_auto_peek",
  "spotidesk.autoplay_enabled",
  "spotidesk.soft_glide",
  "spotidesk.vinyl_mode",
  "spotidesk.close_to_tray",
] as const;

export interface SpotiDeskBackupFile {
  app: "SpotiDesk";
  version: 1;
  exportedAt: string;
  data: Record<string, string>;
}

export function downloadSpotiDeskBackup(): number {
  const data: Record<string, string> = {};
  for (const key of BACKUP_KEYS) {
    try {
      const val = localStorage.getItem(key);
      if (val !== null) data[key] = val;
    } catch {
      // Ignore
    }
  }

  const payload: SpotiDeskBackupFile = {
    app: "SpotiDesk",
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const dateStamp = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `spotidesk-backup-${dateStamp}.json`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return Object.keys(data).length;
}

export function restoreSpotiDeskBackup(rawJson: string): { restoredKeys: number } {
  const parsed = JSON.parse(rawJson) as Partial<SpotiDeskBackupFile>;
  if (!parsed || parsed.app !== "SpotiDesk" || !parsed.data || typeof parsed.data !== "object") {
    throw new Error("El archivo no es un respaldo válido de SpotiDesk.");
  }

  const allowed = new Set<string>(BACKUP_KEYS);
  let restoredKeys = 0;
  for (const [key, value] of Object.entries(parsed.data)) {
    if (allowed.has(key) && typeof value === "string") {
      localStorage.setItem(key, value);
      restoredKeys += 1;
    }
  }
  return { restoredKeys };
}

function escapeCsvCell(value: string): string {
  const clean = value.replace(/\r?\n/g, " ");
  if (/[",]/.test(clean)) {
    return `"${clean.replace(/"/g, '""')}"`;
  }
  return clean;
}

export function exportTracksToCsv(collectionName: string, tracks: UnifiedTrack[]) {
  const header = ["#", "Título", "Artista", "Álbum", "Duración", "Enlace Spotify"];
  const rows = tracks.map((t, idx) => {
    const id = t.id || t.uri.split(":").pop() || "";
    const url = id ? `https://open.spotify.com/track/${id}` : t.uri;
    return [
      String(idx + 1),
      escapeCsvCell(t.name),
      escapeCsvCell(t.artists),
      escapeCsvCell(t.albumName || ""),
      formatDuration(t.durationMs),
      url,
    ].join(",");
  });

  // UTF-8 BOM so Excel / Apple Numbers display accents cleanly
  const csv = `\uFEFF${header.join(",")}\n${rows.join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const safeName =
    collectionName
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase() || "playlist";

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName}-spotidesk.csv`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
