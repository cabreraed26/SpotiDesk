import { Heart, Home, Lock, Search } from "lucide-react";
import type { SpotifyPlaylist } from "../types/spotify";
import { getBestImage, getPlaylistTrackCount } from "../lib/format";
import { LazyCover } from "./LazyCover";

export type AppView =
  | { kind: "home" }
  | { kind: "search" }
  | { kind: "liked" }
  | { kind: "playlist"; id: string }
  | { kind: "album"; id: string };

interface SidebarProps {
  activeView: AppView;
  playlists: SpotifyPlaylist[];
  currentUserId?: string;
  isLoadingPlaylists: boolean;
  onSelectView: (view: AppView) => void;
}

export function Sidebar({
  activeView,
  playlists,
  currentUserId,
  isLoadingPlaylists,
  onSelectView,
}: SidebarProps) {
  const navItems: Array<{
    kind: "home" | "search" | "liked";
    label: string;
    icon: typeof Home;
  }> = [
    { kind: "home", label: "Inicio", icon: Home },
    { kind: "search", label: "Buscar", icon: Search },
    { kind: "liked", label: "Tus Me Gusta", icon: Heart },
  ];

  return (
    <aside className="chrome-no-select w-[244px] shrink-0 h-full flex flex-col border-r border-[var(--border-hairline)] sidebar-glass">
      {/* Primary navigation */}
      <nav aria-label="Navegación principal" className="px-3 pt-4 pb-3 space-y-0.5">
        {navItems.map(({ kind, label, icon: Icon }) => {
          const isActive = activeView.kind === kind;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onSelectView({ kind })}
              className={`w-full h-9 px-3 rounded-lg flex items-center gap-3 text-[13px] tracking-[-0.01em] transition-all duration-200 ease-apple active:scale-[0.98] cursor-pointer ${
                isActive
                  ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Icon size={16} strokeWidth={1.5} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mx-4 h-px bg-[var(--border-hairline)]" />

      {/* Playlists section */}
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
          Playlists
        </span>
        {playlists.length > 0 && (
          <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
            {playlists.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-28 space-y-0.5">
        {isLoadingPlaylists ? (
          <div className="px-3 py-2 space-y-2.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 animate-pulse">
                <div className="w-8 h-8 rounded-md bg-[var(--bg-card)]" />
                <div className="h-3 rounded bg-[var(--bg-card)] flex-1" />
              </div>
            ))}
          </div>
        ) : playlists.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-[var(--text-tertiary)]">
            Sin playlists disponibles
          </p>
        ) : (
          playlists.map((playlist) => {
            const isActive =
              activeView.kind === "playlist" && activeView.id === playlist.id;
            const thumb = getBestImage(playlist.images, "small");
            const isThirdParty = Boolean(
              currentUserId &&
                playlist.owner?.id &&
                playlist.owner.id !== currentUserId &&
                !playlist.collaborative
            );
            return (
              <button
                key={playlist.id}
                type="button"
                onClick={() => onSelectView({ kind: "playlist", id: playlist.id })}
                title={
                  isThirdParty
                    ? `${playlist.name} (Playlist de terceros — contenido restringido en Modo Desarrollo)`
                    : playlist.name
                }
                className={`group playlist-row-zoom w-full px-2.5 py-1.5 rounded-lg flex items-center gap-2.5 text-left cursor-pointer ${
                  isActive
                    ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <div className="playlist-cover-zoom shrink-0">
                  <LazyCover
                    src={thumb}
                    alt={playlist.name}
                    className="w-8 h-8"
                    iconSize={13}
                    roundedClass="rounded-md"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-[13px] truncate tracking-[-0.01em] ${
                      isActive ? "font-medium text-[var(--text-primary)]" : ""
                    }`}
                  >
                    {playlist.name}
                  </div>
                  <div className="text-[11px] text-[var(--text-tertiary)] truncate tabular-nums flex items-center gap-1">
                    {isThirdParty && <Lock size={10} strokeWidth={1.6} className="shrink-0" />}
                    <span className="truncate">{getPlaylistTrackCount(playlist)} canciones</span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
