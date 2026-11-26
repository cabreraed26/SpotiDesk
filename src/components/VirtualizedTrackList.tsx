import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Clock3, MoreHorizontal, Pause, Play } from "lucide-react";
import type { UnifiedTrack } from "../types/spotify";
import { formatDuration } from "../lib/format";
import { LazyCover } from "./LazyCover";

interface VirtualizedTrackListProps {
  tracks: UnifiedTrack[];
  currentTrackUri?: string;
  isPlaying: boolean;
  showAlbumColumn?: boolean;
  showCover?: boolean;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  onPlayTrack: (track: UnifiedTrack, index: number) => void;
  onTogglePlay: () => void;
  onSelectAlbum?: (albumId: string) => void;
  onTrackContextMenu?: (e: React.MouseEvent, track: UnifiedTrack, index: number) => void;
  headerSlot?: React.ReactNode;
}

const ROW_HEIGHT = 56;

export function VirtualizedTrackList({
  tracks,
  currentTrackUri,
  isPlaying,
  showAlbumColumn = true,
  showCover = true,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  onPlayTrack,
  onTogglePlay,
  onSelectAlbum,
  onTrackContextMenu,
  headerSlot,
}: VirtualizedTrackListProps) {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Trigger lazy pagination when approaching the end of loaded tracks
  useEffect(() => {
    if (!hasMore || isLoadingMore || !onLoadMore) return;
    const last = virtualItems[virtualItems.length - 1];
    if (last && last.index >= tracks.length - 15) {
      onLoadMore();
    }
  }, [virtualItems, tracks.length, hasMore, isLoadingMore, onLoadMore]);

  return (
    <div
      ref={scrollParentRef}
      className="anim-view-enter flex-1 overflow-y-auto px-8 pb-32 scroll-smooth"
    >
      {headerSlot}

      {/* Table Header */}
      <div
        className={`chrome-no-select sticky top-0 z-10 grid items-center gap-4 px-3 h-9 text-[11px] uppercase tracking-[0.06em] text-[var(--text-tertiary)] border-b border-[var(--border-hairline)] bg-[var(--bg-primary)]/85 backdrop-blur-md ${
          showAlbumColumn
            ? "grid-cols-[36px_minmax(0,2fr)_minmax(0,1.2fr)_88px]"
            : "grid-cols-[36px_minmax(0,1fr)_88px]"
        }`}
      >
        <span className="text-center">#</span>
        <span>Título</span>
        {showAlbumColumn && <span>Álbum</span>}
        <span className="flex justify-end pr-1" aria-label="Duración">
          <Clock3 size={13} strokeWidth={1.5} />
        </span>
      </div>

      {/* Virtualized rows container */}
      {tracks.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-[var(--text-secondary)]">
          No hay canciones en esta lista.
        </div>
      ) : (
        <div
          className="relative w-full mt-1"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualItems.map((virtualRow) => {
            const track = tracks[virtualRow.index];
            const isCurrent = currentTrackUri === track.uri;

            return (
              <div
                key={`${track.uri}-${virtualRow.index}`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onContextMenu={(e) => {
                    if (onTrackContextMenu) {
                      e.preventDefault();
                      onTrackContextMenu(e, track, virtualRow.index);
                    }
                  }}
                  onClick={() => {
                    if (isCurrent) {
                      onTogglePlay();
                    } else {
                      onPlayTrack(track, virtualRow.index);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (isCurrent) onTogglePlay();
                      else onPlayTrack(track, virtualRow.index);
                    }
                  }}
                  className={`group h-full px-3 rounded-lg grid items-center gap-4 transition-all duration-150 ease-apple active:scale-[0.992] cursor-pointer ${
                    showAlbumColumn
                      ? "grid-cols-[36px_minmax(0,2fr)_minmax(0,1.2fr)_88px]"
                      : "grid-cols-[36px_minmax(0,1fr)_88px]"
                  } ${
                    isCurrent
                      ? "bg-[var(--bg-active)]"
                      : "hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  {/* Track index / Play indicator */}
                  <div className="flex items-center justify-center w-9">
                    {isCurrent ? (
                      <>
                        <div
                          className={`group-hover:hidden flex items-end gap-[2px] h-3.5 ${
                            isPlaying ? "" : "eq-paused"
                          }`}
                          aria-label={isPlaying ? "Reproduciendo" : "En pausa"}
                        >
                          <span className="eq-bar" />
                          <span className="eq-bar" />
                          <span className="eq-bar" />
                        </div>
                        <span className="hidden group-hover:flex text-[var(--text-primary)]">
                          {isPlaying ? (
                            <Pause size={14} strokeWidth={1.5} />
                          ) : (
                            <Play size={14} strokeWidth={1.5} />
                          )}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="group-hover:hidden text-[12px] tabular-nums text-[var(--text-tertiary)]">
                          {virtualRow.index + 1}
                        </span>
                        <span className="hidden group-hover:flex text-[var(--text-primary)]">
                          <Play size={14} strokeWidth={1.5} />
                        </span>
                      </>
                    )}
                  </div>

                  {/* Cover + Title + Artist */}
                  <div className="flex items-center gap-3 min-w-0">
                    {showCover && (
                      <LazyCover
                        src={track.albumImage}
                        alt={track.albumName || track.name}
                        className="w-10 h-10"
                        iconSize={14}
                        roundedClass="rounded-md"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-[13.5px] truncate tracking-[-0.01em] ${
                          isCurrent
                            ? "font-semibold text-[var(--text-primary)]"
                            : "font-medium text-[var(--text-primary)]"
                        }`}
                      >
                        {track.name}
                      </div>
                      <div className="text-[12px] truncate text-[var(--text-secondary)]">
                        {track.artists}
                      </div>
                    </div>
                  </div>

                  {/* Album */}
                  {showAlbumColumn && (
                    <div className="min-w-0">
                      {track.albumId && onSelectAlbum ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectAlbum(track.albumId!);
                          }}
                          className="text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline truncate max-w-full block text-left transition-colors cursor-pointer"
                        >
                          {track.albumName}
                        </button>
                      ) : (
                        <span className="text-[12.5px] text-[var(--text-secondary)] truncate block">
                          {track.albumName}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Duration + discreet menu trigger */}
                  <div className="flex items-center justify-end gap-2 pr-1">
                    {onTrackContextMenu && (
                      <button
                        type="button"
                        aria-label={`Más opciones para ${track.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTrackContextMenu(e, track, virtualRow.index);
                        }}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-active)] transition-all cursor-pointer"
                      >
                        <MoreHorizontal size={14} strokeWidth={1.6} />
                      </button>
                    )}
                    <span className="text-[12px] tabular-nums text-[var(--text-secondary)]">
                      {formatDuration(track.durationMs)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isLoadingMore && (
        <div className="py-6 text-center text-[12px] text-[var(--text-tertiary)]">
          Cargando más canciones...
        </div>
      )}
    </div>
  );
}
