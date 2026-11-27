import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import type { SpotifyApiClient } from "../lib/spotifyApi";
import type { UnifiedTrack } from "../types/spotify";
import { formatDuration, normalizeTrack } from "../lib/format";
import { LazyCover } from "./LazyCover";
import { ArtistLinks } from "./ArtistLinks";

interface QueueDrawerProps {
  api: SpotifyApiClient;
  currentTrack: UnifiedTrack | null;
  isPlaying: boolean;
  sdkWindowTracks: UnifiedTrack[];
  onPlayTrack: (track: UnifiedTrack) => void;
  onSelectArtist?: (artistId: string, artistName?: string) => void;
  onTrackContextMenu?: (e: React.MouseEvent, track: UnifiedTrack) => void;
  onClose: () => void;
}

export function QueueDrawer({
  api,
  currentTrack,
  isPlaying,
  sdkWindowTracks,
  onPlayTrack,
  onSelectArtist,
  onTrackContextMenu,
  onClose,
}: QueueDrawerProps) {
  const [queue, setQueue] = useState<UnifiedTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadQueue = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.getQueue();
      const mapped = data.queue.map(normalizeTrack);
      setQueue(mapped);
    } catch {
      // Fallback to live SDK next tracks if /me/player/queue is unavailable
      setQueue(sdkWindowTracks.filter((t) => t.uri !== currentTrack?.uri));
    } finally {
      setIsLoading(false);
    }
  }, [api, currentTrack?.uri, sdkWindowTracks]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      aria-label="Cola de reproducción"
      className="anim-track-next popover-glass fixed top-10 right-0 bottom-0 w-[336px] z-35 border-l border-[var(--border-hairline)] flex flex-col"
    >
      {/* Header */}
      <div className="chrome-no-select h-13 px-5 border-b border-[var(--border-hairline)] flex items-center justify-between">
        <span className="text-[13px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
          Cola de reproducción
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void loadQueue()}
            title="Actualizar cola"
            aria-label="Actualizar cola"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <RefreshCw size={13} strokeWidth={1.5} className={isLoading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Cerrar cola"
            aria-label="Cerrar cola"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <X size={14} strokeWidth={1.6} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-28 space-y-5">
        {currentTrack && (
          <section className="space-y-2">
            <h3 className="px-1.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Reproduciendo ahora
            </h3>
            <div
              onContextMenu={(e) => {
                if (onTrackContextMenu) {
                  e.preventDefault();
                  onTrackContextMenu(e, currentTrack);
                }
              }}
              className="p-2.5 rounded-xl bg-[var(--bg-active)] border border-[var(--border-hairline)] flex items-center gap-3"
            >
              <LazyCover
                src={currentTrack.albumImage}
                alt={currentTrack.name}
                className="w-10 h-10"
                iconSize={14}
                roundedClass="rounded-lg"
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                  {currentTrack.name}
                </div>
                <div className="text-[11.5px] text-[var(--text-secondary)] truncate">
                  <ArtistLinks
                    artistsText={currentTrack.artists}
                    artistItems={currentTrack.artistItems}
                    fallbackArtistId={currentTrack.artistId}
                    onSelectArtist={(id, name) => {
                      onSelectArtist?.(id, name);
                      onClose();
                    }}
                  />
                </div>
              </div>
              <div className={`flex items-end gap-[2px] h-3 ${isPlaying ? "" : "eq-paused"}`}>
                <span className="eq-bar" />
                <span className="eq-bar" />
                <span className="eq-bar" />
              </div>
            </div>
          </section>
        )}

        <section className="space-y-2">
          <div className="px-1.5 flex items-center justify-between">
            <h3 className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              A continuación
            </h3>
            {queue.length > 0 && (
              <span className="text-[10.5px] tabular-nums text-[var(--text-tertiary)]">
                {queue.length}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="py-10 flex items-center justify-center">
              <Loader2 size={18} strokeWidth={1.5} className="animate-spin text-[var(--text-secondary)]" />
            </div>
          ) : queue.length === 0 ? (
            <p className="px-2 py-6 text-[12.5px] text-[var(--text-secondary)]">
              No hay canciones en cola. Haz clic derecho sobre cualquier pista para añadirla.
            </p>
          ) : (
            <div className="space-y-0.5">
              {queue.map((track, idx) => (
                <div
                  key={`${track.uri}-${idx}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPlayTrack(track)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPlayTrack(track);
                    }
                  }}
                  onContextMenu={(e) => {
                    if (onTrackContextMenu) {
                      e.preventDefault();
                      onTrackContextMenu(e, track);
                    }
                  }}
                  className="w-full p-2 rounded-xl flex items-center gap-2.5 text-left hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                >
                  <LazyCover
                    src={track.albumImage}
                    alt={track.name}
                    className="w-9 h-9"
                    iconSize={13}
                    roundedClass="rounded-lg"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">
                      {track.name}
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)] truncate">
                      <ArtistLinks
                        artistsText={track.artists}
                        artistItems={track.artistItems}
                        fallbackArtistId={track.artistId}
                        onSelectArtist={(id, name) => {
                          onSelectArtist?.(id, name);
                          onClose();
                        }}
                      />
                    </div>
                  </div>
                  <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
                    {formatDuration(track.durationMs)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
