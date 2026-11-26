import { Heart, Play, Search } from "lucide-react";
import type { SpotifyPlaylist, SpotifyUser } from "../types/spotify";
import type { AppView } from "./Sidebar";
import { getBestImage, getPlaylistTrackCount } from "../lib/format";
import { LazyCover } from "./LazyCover";

interface HomeViewProps {
  user: SpotifyUser | null;
  playlists: SpotifyPlaylist[];
  onSelectView: (view: AppView) => void;
  onPlayPlaylist: (playlistUri: string) => void;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Buenos días";
  if (hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

export function HomeView({
  user,
  playlists,
  onSelectView,
  onPlayPlaylist,
}: HomeViewProps) {
  const firstName = user?.display_name?.split(" ")[0];
  const featured = playlists.slice(0, 10);

  return (
    <div className="anim-view-enter flex-1 overflow-y-auto px-8 pt-8 pb-32 space-y-10">
      {/* Editorial Header */}
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            Tu Espacio Musical
          </p>
          <h1 className="mt-1.5 text-[32px] font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
            {getGreeting()}
            {firstName ? `, ${firstName}` : ""}
          </h1>
        </div>

        <button
          type="button"
          onClick={() => onSelectView({ kind: "search" })}
          className="chrome-no-select self-start sm:self-auto h-9 px-4 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-2 transition-colors cursor-pointer"
        >
          <Search size={14} strokeWidth={1.5} />
          Buscar música
          <span className="ml-1 text-[11px] text-[var(--text-tertiary)]">Ctrl K</span>
        </button>
      </section>

      {/* Quick Access Strip */}
      <section>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Tus Me Gusta Card */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => onSelectView({ kind: "liked" })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectView({ kind: "liked" });
              }
            }}
            className="group playlist-row-zoom h-16 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] hover:border-[var(--border-subtle)] flex items-center gap-3.5 cursor-pointer"
          >
            <div className="w-11 h-11 rounded-lg bg-[var(--bg-card)] border border-[var(--border-hairline)] flex items-center justify-center shrink-0">
              <Heart size={18} strokeWidth={1.5} className="text-[var(--text-primary)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium text-[var(--text-primary)] truncate">
                Tus Me Gusta
              </div>
              <div className="text-[11.5px] text-[var(--text-secondary)]">
                Biblioteca guardada
              </div>
            </div>
          </div>

          {playlists.slice(0, 5).map((playlist) => (
            <div
              key={playlist.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectView({ kind: "playlist", id: playlist.id })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectView({ kind: "playlist", id: playlist.id });
                }
              }}
              className="group playlist-row-zoom h-16 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] hover:border-[var(--border-subtle)] flex items-center gap-3.5 cursor-pointer"
            >
              <div className="playlist-cover-zoom shrink-0">
                <LazyCover
                  src={getBestImage(playlist.images, "small")}
                  alt={playlist.name}
                  className="w-11 h-11"
                  iconSize={16}
                  roundedClass="rounded-lg"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium text-[var(--text-primary)] truncate tracking-[-0.01em]">
                  {playlist.name}
                </div>
                <div className="text-[11.5px] text-[var(--text-secondary)] tabular-nums">
                  {getPlaylistTrackCount(playlist)} canciones
                </div>
              </div>
              <button
                type="button"
                aria-label={`Reproducir ${playlist.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onPlayPlaylist(playlist.uri);
                }}
                className="chrome-no-select w-8 h-8 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-200 ease-apple cursor-pointer"
              >
                <Play size={13} strokeWidth={1.8} fill="currentColor" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Full Playlist Gallery */}
      {featured.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              Tus Playlists
            </h2>
            <span className="text-[12px] tabular-nums text-[var(--text-tertiary)]">
              {playlists.length} en biblioteca
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
            {featured.map((playlist) => (
              <div
                key={playlist.id}
                onClick={() => onSelectView({ kind: "playlist", id: playlist.id })}
                className="group playlist-card-zoom p-3.5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] hover:border-[var(--border-subtle)] cursor-pointer"
              >
                <div className="playlist-cover-zoom relative aspect-square mb-3.5">
                  <LazyCover
                    src={getBestImage(playlist.images, "medium")}
                    alt={playlist.name}
                    className="w-full h-full"
                    iconSize={28}
                    roundedClass="rounded-xl"
                  />
                  <button
                    type="button"
                    aria-label={`Reproducir ${playlist.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayPlaylist(playlist.uri);
                    }}
                    className="chrome-no-select absolute right-2.5 bottom-2.5 w-9 h-9 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] shadow-lg flex items-center justify-center opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 ease-apple cursor-pointer"
                  >
                    <Play size={14} strokeWidth={1.8} fill="currentColor" />
                  </button>
                </div>
                <div className="text-[13.5px] font-medium text-[var(--text-primary)] truncate tracking-[-0.01em]">
                  {playlist.name}
                </div>
                <div className="text-[12px] text-[var(--text-secondary)] truncate mt-0.5">
                  {playlist.owner?.display_name || "Spotify"} · {getPlaylistTrackCount(playlist)} pistas
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
