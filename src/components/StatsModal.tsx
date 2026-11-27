import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Check,
  Clock,
  Flame,
  Loader2,
  Music2,
  Play,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import type { ThemeMode } from "../hooks/useTheme";
import type { UnifiedTrack } from "../types/spotify";
import { computeWeeklyStats } from "../lib/listeningStats";
import { renderWeeklyStatsPosterBlob } from "../lib/statsPoster";
import { LazyCover } from "./LazyCover";

interface StatsModalProps {
  theme: ThemeMode;
  ambientRgb?: string | null;
  userName?: string | null;
  onPlayTrack: (track: UnifiedTrack) => void;
  onSelectArtist: (artistId: string, artistName?: string) => void;
  onClose: () => void;
}

function formatListeningDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours} h ${mins} m` : `${hours} h`;
}

export function StatsModal({
  theme,
  ambientRgb,
  userName,
  onPlayTrack,
  onSelectArtist,
  onClose,
}: StatsModalProps) {
  const stats = useMemo(() => computeWeeklyStats(), []);
  const maxMinutes = Math.max(1, ...stats.days.map((d) => d.minutes));
  const [exportState, setExportState] = useState<"idle" | "rendering" | "copied" | "downloaded">(
    "idle"
  );

  const handleExportPoster = async () => {
    if (exportState === "rendering") return;
    setExportState("rendering");
    try {
      const blob = await renderWeeklyStatsPosterBlob({
        stats,
        userName,
        theme,
        ambientRgb,
      });
      if (!blob) {
        setExportState("idle");
        return;
      }

      let copied = false;
      if (typeof navigator !== "undefined" && navigator.clipboard && "ClipboardItem" in window) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          copied = true;
        } catch {
          copied = false;
        }
      }

      if (copied) {
        setExportState("copied");
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "tu-semana-spotidesk.png";
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
        setExportState("downloaded");
      }

      window.setTimeout(() => setExportState("idle"), 2200);
    } catch {
      setExportState("idle");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tu semana en SpotiDesk"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="anim-stage-backdrop fixed inset-0 top-10 z-50 bg-black/55 backdrop-blur-md flex items-center justify-center p-6"
    >
      <div className="anim-context-menu popover-glass w-full max-w-[580px] rounded-2xl border border-[var(--border-subtle)] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-hairline)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BarChart3 size={18} strokeWidth={1.6} className="text-[var(--text-primary)]" />
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
                Tu semana en SpotiDesk
              </h2>
              <p className="text-[11px] text-[var(--text-tertiary)]">
                100% privado · Guardado solo en este equipo
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {stats.totalPlays7d > 0 && (
              <button
                type="button"
                disabled={exportState === "rendering"}
                onClick={() => void handleExportPoster()}
                title="Generar póster PNG minimalista de Tu Semana"
                className="h-7 px-3 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[11.5px] font-medium text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {exportState === "rendering" ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Creando...
                  </>
                ) : exportState === "copied" ? (
                  <>
                    <Check size={12} strokeWidth={1.8} />
                    Póster copiado
                  </>
                ) : exportState === "downloaded" ? (
                  <>
                    <Check size={12} strokeWidth={1.8} />
                    PNG guardado
                  </>
                ) : (
                  <>
                    <Share2 size={11.5} strokeWidth={1.6} />
                    Exportar póster
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar estadísticas"
              className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            >
              <X size={15} strokeWidth={1.6} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 max-h-[74vh] overflow-y-auto">
          {/* Metric Pills */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-4 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] space-y-1">
              <div className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1.5">
                <Clock size={12} strokeWidth={1.6} />
                Últimos 7 días
              </div>
              <div className="text-[22px] font-semibold tracking-[-0.03em] tabular-nums text-[var(--text-primary)]">
                {formatListeningDuration(stats.totalMinutes7d)}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] space-y-1">
              <div className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1.5">
                <Music2 size={12} strokeWidth={1.6} />
                Reproducciones
              </div>
              <div className="text-[22px] font-semibold tracking-[-0.03em] tabular-nums text-[var(--text-primary)]">
                {stats.totalPlays7d}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] space-y-1">
              <div className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1.5">
                <Flame size={12} strokeWidth={1.6} />
                Racha activa
              </div>
              <div className="text-[22px] font-semibold tracking-[-0.03em] tabular-nums text-[var(--text-primary)]">
                {stats.streakDays} {stats.streakDays === 1 ? "día" : "días"}
              </div>
            </div>
          </div>

          {/* 7-Day Activity Bar Chart */}
          <section className="p-4 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-[0.09em] text-[var(--text-tertiary)]">
                Actividad diaria
              </span>
              <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums">
                Minutos por día
              </span>
            </div>

            <div className="grid grid-cols-7 gap-2 items-end h-28 pt-2">
              {stats.days.map((day, idx) => {
                const heightPct = day.minutes > 0 ? Math.max(12, (day.minutes / maxMinutes) * 100) : 5;
                const isToday = idx === stats.days.length - 1;
                return (
                  <div
                    key={day.dayKey}
                    className="flex flex-col items-center gap-1.5 h-full justify-end"
                    title={`${day.label}: ${day.minutes} min (${day.plays} canciones)`}
                  >
                    <span className="text-[10px] tabular-nums text-[var(--text-tertiary)]">
                      {day.minutes > 0 ? day.minutes : ""}
                    </span>
                    <div className="w-full max-w-[30px] flex-1 flex items-end">
                      <div
                        className={`w-full rounded-t-lg transition-all duration-700 ease-apple ${
                          isToday
                            ? "bg-[var(--solid-bg)]"
                            : day.minutes > 0
                              ? "bg-[var(--text-primary)]/40"
                              : "bg-[var(--bg-card)]"
                        }`}
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                    <span
                      className={`text-[10.5px] ${
                        isToday
                          ? "font-semibold text-[var(--text-primary)]"
                          : "text-[var(--text-tertiary)]"
                      }`}
                    >
                      {day.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {stats.totalPlays7d === 0 ? (
            <div className="py-6 flex flex-col items-center text-center gap-2 text-[var(--text-secondary)]">
              <Sparkles size={22} strokeWidth={1.4} className="text-[var(--text-tertiary)]" />
              <p className="text-[13px] max-w-[340px]">
                Empieza a escuchar música en SpotiDesk y aquí aparecerán tus artistas y canciones más
                escuchadas de la semana.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Top Artists */}
              <section className="space-y-2.5">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.09em] text-[var(--text-tertiary)]">
                  Top Artistas
                </h3>
                <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/70 divide-y divide-[var(--border-hairline)]">
                  {stats.topArtists.map((artist, idx) => (
                    <button
                      key={artist.name}
                      type="button"
                      onClick={() => {
                        onSelectArtist(artist.artistId || "", artist.name);
                        onClose();
                      }}
                      className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-[var(--bg-hover)] transition-colors first:rounded-t-xl last:rounded-b-xl cursor-pointer"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className="w-4 text-[11px] tabular-nums text-[var(--text-tertiary)]">
                          {idx + 1}
                        </span>
                        <span className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">
                          {artist.name}
                        </span>
                      </span>
                      <span className="text-[11px] tabular-nums text-[var(--text-tertiary)] shrink-0">
                        {artist.plays}×
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Top Tracks */}
              <section className="space-y-2.5">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.09em] text-[var(--text-tertiary)]">
                  Top Canciones
                </h3>
                <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/70 divide-y divide-[var(--border-hairline)]">
                  {stats.topTracks.map(({ track, plays }) => (
                    <button
                      key={track.uri}
                      type="button"
                      onClick={() => {
                        onPlayTrack(track);
                        onClose();
                      }}
                      className="group w-full px-2.5 py-2 flex items-center gap-2.5 text-left hover:bg-[var(--bg-hover)] transition-colors first:rounded-t-xl last:rounded-b-xl cursor-pointer"
                    >
                      <LazyCover
                        src={track.albumImage}
                        alt={track.name}
                        className="w-8 h-8"
                        iconSize={12}
                        roundedClass="rounded-md"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">
                          {track.name}
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)] truncate">
                          {track.artists}
                        </div>
                      </div>
                      <span className="group-hover:hidden text-[11px] tabular-nums text-[var(--text-tertiary)] shrink-0">
                        {plays}×
                      </span>
                      <Play
                        size={12}
                        strokeWidth={1.8}
                        fill="currentColor"
                        className="hidden group-hover:block text-[var(--text-primary)] shrink-0"
                      />
                    </button>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
