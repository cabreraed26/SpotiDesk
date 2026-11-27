import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, History, Play, Search, Trash2, X } from "lucide-react";
import type { UnifiedTrack } from "../types/spotify";
import {
  clearListeningHistory,
  getListeningHistory,
  type PlayEventRecord,
} from "../lib/listeningStats";
import { LazyCover } from "./LazyCover";

interface HistoryModalProps {
  onPlayTrack: (track: UnifiedTrack) => void;
  onSelectArtist: (artistId: string, artistName?: string) => void;
  onClose: () => void;
}

function getLocalDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDayHeading(dayKey: string, todayKey: string, yesterdayKey: string): string {
  if (dayKey === todayKey) return "Hoy";
  if (dayKey === yesterdayKey) return "Ayer";
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return dayKey;
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatClockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function HistoryModal({
  onPlayTrack,
  onSelectArtist,
  onClose,
}: HistoryModalProps) {
  const [events, setEvents] = useState<PlayEventRecord[]>(() => getListeningHistory());
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const grouped = useMemo(() => {
    const q = fold(query.trim());
    const filtered = q
      ? events.filter(
          (ev) => fold(ev.name).includes(q) || fold(ev.artists).includes(q)
        )
      : events;

    const now = new Date();
    const todayKey = getLocalDayKey(now);
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    const yesterdayKey = getLocalDayKey(yest);

    const map = new Map<string, { heading: string; items: PlayEventRecord[] }>();
    for (const ev of filtered) {
      let bucket = map.get(ev.dayKey);
      if (!bucket) {
        bucket = {
          heading: formatDayHeading(ev.dayKey, todayKey, yesterdayKey),
          items: [],
        };
        map.set(ev.dayKey, bucket);
      }
      bucket.items.push(ev);
    }
    return Array.from(map.entries()).map(([key, val]) => ({ key, ...val }));
  }, [events, query]);

  const handleClear = () => {
    clearListeningHistory();
    setEvents([]);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Historial de reproducción"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="anim-stage-backdrop fixed inset-0 top-10 z-50 bg-black/55 backdrop-blur-md flex items-center justify-center p-6"
    >
      <div className="anim-context-menu popover-glass w-full max-w-[580px] rounded-2xl border border-[var(--border-subtle)] overflow-hidden flex flex-col max-h-[78vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-hairline)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <History size={17} strokeWidth={1.6} className="text-[var(--text-primary)]" />
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
                Historial de reproducción
              </h2>
              <p className="text-[11px] text-[var(--text-tertiary)]">
                {events.length} {events.length === 1 ? "canción registrada" : "canciones registradas"} en este equipo
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {events.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                title="Limpiar historial local"
                className="h-7 px-2.5 rounded-full border border-[var(--border-hairline)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] inline-flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Trash2 size={11.5} strokeWidth={1.6} />
                Limpiar
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar historial"
              className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            >
              <X size={15} strokeWidth={1.6} />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="px-5 py-3 border-b border-[var(--border-hairline)] flex items-center gap-2.5 shrink-0">
          <Search size={14} strokeWidth={1.6} className="text-[var(--text-tertiary)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en tu historial por canción o artista..."
            className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpiar búsqueda"
              className="w-5 h-5 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X size={12} strokeWidth={1.6} />
            </button>
          )}
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {grouped.length === 0 ? (
            <div className="py-12 flex flex-col items-center text-center gap-2 text-[var(--text-secondary)]">
              <Clock size={22} strokeWidth={1.4} className="text-[var(--text-tertiary)]" />
              <p className="text-[13px]">
                {query
                  ? `No se encontraron coincidencias para “${query}”.`
                  : "Todavía no hay canciones en tu historial local."}
              </p>
            </div>
          ) : (
            grouped.map((group) => (
              <section key={group.key} className="space-y-1.5">
                <h3 className="px-2 text-[11px] font-medium uppercase tracking-[0.09em] text-[var(--text-tertiary)]">
                  {group.heading}
                </h3>
                <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/65 divide-y divide-[var(--border-hairline)]">
                  {group.items.map((ev) => {
                    const unified: UnifiedTrack = {
                      id: ev.uri.split(":").pop() || ev.uri,
                      uri: ev.uri,
                      name: ev.name,
                      artists: ev.artists,
                      artistId: ev.artistId,
                      albumName: "",
                      albumImage: ev.albumImage,
                      durationMs: ev.durationMs,
                    };
                    return (
                      <div
                        key={`${ev.ts}-${ev.uri}`}
                        className="group px-3 py-2 flex items-center gap-3 hover:bg-[var(--bg-hover)] transition-colors first:rounded-t-xl last:rounded-b-xl"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onPlayTrack(unified);
                            onClose();
                          }}
                          className="relative shrink-0 cursor-pointer"
                          title={`Reproducir ${ev.name}`}
                        >
                          <LazyCover
                            src={ev.albumImage}
                            alt={ev.name}
                            className="w-9 h-9"
                            iconSize={13}
                            roundedClass="rounded-lg"
                          />
                          <span className="opacity-0 group-hover:opacity-100 absolute inset-0 rounded-lg bg-black/55 text-white flex items-center justify-center transition-opacity">
                            <Play size={13} strokeWidth={2} fill="currentColor" />
                          </span>
                        </button>

                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => {
                              onPlayTrack(unified);
                              onClose();
                            }}
                            className="block max-w-full text-left text-[13px] font-medium text-[var(--text-primary)] truncate cursor-pointer"
                          >
                            {ev.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const primary = ev.artists.split(",")[0]?.trim() || ev.artists;
                              onSelectArtist(ev.artistId || "", primary);
                              onClose();
                            }}
                            className="block max-w-full text-left text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline truncate cursor-pointer"
                          >
                            {ev.artists}
                          </button>
                        </div>

                        <span className="text-[11px] font-mono tabular-nums text-[var(--text-tertiary)] shrink-0">
                          {formatClockTime(ev.ts)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
