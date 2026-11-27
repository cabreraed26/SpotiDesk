import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Disc3,
  Folder,
  FolderOpen,
  FolderPlus,
  Heart,
  Home,
  Lock,
  Pin,
  PinOff,
  Plus,
  Search,
  Shuffle,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type {
  SpotifyAlbumSimple,
  SpotifyArtist,
  SpotifyPlaylist,
} from "../types/spotify";
import type { SidebarOrganization } from "../lib/sidebarOrganization";
import { getBestImage, getPlaylistTrackCount } from "../lib/format";
import { LazyCover } from "./LazyCover";
import { subscribeTrackDrag } from "./TrackDragOverlay";

export type AppView =
  | { kind: "home" }
  | { kind: "search" }
  | { kind: "liked" }
  | { kind: "albums" }
  | { kind: "artists" }
  | { kind: "artist"; id: string; seedArtist?: SpotifyArtist }
  | { kind: "playlist"; id: string; seedPlaylist?: SpotifyPlaylist; coverSlot?: "quick" | "grid" }
  | { kind: "album"; id: string; seedAlbum?: SpotifyAlbumSimple };

interface SidebarProps {
  activeView: AppView;
  playlists: SpotifyPlaylist[];
  currentUserId?: string;
  isLoadingPlaylists: boolean;
  sidebarOrg: SidebarOrganization;
  onSelectView: (view: AppView) => void;
  onPrefetchNav?: (kind: "liked" | "albums" | "artists") => void;
  onPrefetchPlaylist?: (playlist: SpotifyPlaylist) => void;
  onCreatePlaylist: () => void;
  onOpenBlendSession?: () => void;
  onTogglePinPlaylist: (playlistId: string) => void;
  onCreateFolder: (name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onToggleFolderCollapsed: (folderId: string) => void;
  onAssignPlaylistToFolder: (playlistId: string, folderId: string | null) => void;
}

interface PlaylistMenuState {
  playlist: SpotifyPlaylist;
  x: number;
  y: number;
}

export function Sidebar({
  activeView,
  playlists,
  currentUserId,
  isLoadingPlaylists,
  sidebarOrg,
  onSelectView,
  onPrefetchNav,
  onPrefetchPlaylist,
  onCreatePlaylist,
  onOpenBlendSession,
  onTogglePinPlaylist,
  onCreateFolder,
  onDeleteFolder,
  onToggleFolderCollapsed,
  onAssignPlaylistToFolder,
}: SidebarProps) {
  const isMac = /mac/i.test(navigator.platform || navigator.userAgent);
  const modSymbol = isMac ? "⌘" : "Ctrl+";

  const [dragOverPlaylistId, setDragOverPlaylistId] = useState<string | null>(null);
  const [isDraggingTrack, setIsDraggingTrack] = useState(false);
  const [draggingPlaylist, setDraggingPlaylist] = useState<{
    id: string;
    name: string;
    x: number;
    y: number;
    hoverFolderId: string | null;
  } | null>(null);
  const recentPlaylistDragAtRef = useRef(0);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const [plMenu, setPlMenu] = useState<PlaylistMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return subscribeTrackDrag((drag) => {
      setIsDraggingTrack(Boolean(drag));
      setDragOverPlaylistId(
        drag?.target?.kind === "playlist" ? drag.target.id : null
      );
    });
  }, []);

  useEffect(() => {
    if (!plMenu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setPlMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPlMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [plMenu]);

  const playlistById = useMemo(() => {
    const map = new Map<string, SpotifyPlaylist>();
    for (const pl of playlists) map.set(pl.id, pl);
    return map;
  }, [playlists]);

  const pinnedPlaylists = useMemo(
    () =>
      sidebarOrg.pinnedIds
        .map((id) => playlistById.get(id))
        .filter((p): p is SpotifyPlaylist => Boolean(p)),
    [playlistById, sidebarOrg.pinnedIds]
  );

  const folderedIdSet = useMemo(() => {
    const s = new Set<string>();
    for (const f of sidebarOrg.folders) {
      for (const id of f.playlistIds) s.add(id);
    }
    return s;
  }, [sidebarOrg.folders]);

  const pinnedIdSet = useMemo(
    () => new Set(sidebarOrg.pinnedIds),
    [sidebarOrg.pinnedIds]
  );

  const ungroupedPlaylists = useMemo(
    () => playlists.filter((p) => !folderedIdSet.has(p.id) && !pinnedIdSet.has(p.id)),
    [folderedIdSet, pinnedIdSet, playlists]
  );

  const handleCreateFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (folderDraft.trim()) {
      onCreateFolder(folderDraft.trim());
    }
    setFolderDraft("");
    setCreatingFolder(false);
  };

  const navItems: Array<{
    kind: "home" | "search" | "liked" | "albums" | "artists";
    label: string;
    icon: typeof Home;
  }> = [
    { kind: "home", label: "Inicio", icon: Home },
    { kind: "search", label: "Buscar", icon: Search },
    { kind: "liked", label: "Tus Me Gusta", icon: Heart },
    { kind: "albums", label: "Álbumes", icon: Disc3 },
    { kind: "artists", label: "Artistas", icon: Users },
  ];

  const handlePlaylistPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    playlist: SpotifyPlaylist
  ) => {
    if (e.button !== 0 || sidebarOrg.folders.length === 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let latestFolderId: string | null = null;

    const onMove = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) >= 6) {
        active = true;
      }
      if (!active) return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const folderEl = el?.closest<HTMLElement>("[data-drop-folder-id]");
      latestFolderId = folderEl?.dataset.dropFolderId ?? null;
      setDraggingPlaylist({
        id: playlist.id,
        name: playlist.name,
        x: ev.clientX,
        y: ev.clientY,
        hoverFolderId: latestFolderId,
      });
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      setDraggingPlaylist(null);
    };

    const onUp = () => {
      if (active) {
        recentPlaylistDragAtRef.current = performance.now();
        if (latestFolderId) {
          onAssignPlaylistToFolder(playlist.id, latestFolderId);
        }
      }
      cleanup();
    };

    const onCancel = () => cleanup();

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const renderPlaylistRow = (
    playlist: SpotifyPlaylist,
    options?: { pinIndex?: number; compact?: boolean }
  ) => {
    const isActive = activeView.kind === "playlist" && activeView.id === playlist.id;
    const thumb = getBestImage(playlist.images, "small");
    const isThirdParty = Boolean(
      currentUserId &&
        playlist.owner?.id &&
        playlist.owner.id !== currentUserId &&
        !playlist.collaborative
    );
    const isDropTarget = dragOverPlaylistId === playlist.id;
    const canDrop = !isThirdParty;

    return (
      <button
        key={`${options?.pinIndex !== undefined ? "pin-" : ""}${playlist.id}`}
        type="button"
        data-drop-playlist-id={canDrop ? playlist.id : undefined}
        data-drop-playlist-name={canDrop ? playlist.name : undefined}
        onPointerDown={(e) => handlePlaylistPointerDown(e, playlist)}
        onMouseEnter={() => onPrefetchPlaylist?.(playlist)}
        onFocus={() => onPrefetchPlaylist?.(playlist)}
        onClick={() => {
          if (performance.now() - recentPlaylistDragAtRef.current < 260) return;
          onSelectView({ kind: "playlist", id: playlist.id, seedPlaylist: playlist });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setPlMenu({
            playlist,
            x: Math.min(e.clientX, window.innerWidth - 220),
            y: Math.min(e.clientY, window.innerHeight - 240),
          });
        }}
        title={
          isThirdParty
            ? `${playlist.name} (Clic derecho para fijar u organizar)`
            : `${playlist.name} (Arrastra canciones aquí · Clic derecho para fijar o mover a carpeta)`
        }
        className={`group playlist-row-zoom w-full px-2.5 ${
          options?.compact ? "py-1" : "py-1.5"
        } rounded-lg flex items-center gap-2.5 text-left cursor-pointer transition-all duration-150 ${
          isDropTarget
            ? "bg-[var(--bg-active)] text-[var(--text-primary)] ring-1 ring-[var(--text-primary)]/60 scale-[1.015]"
            : isDraggingTrack && isThirdParty
              ? "opacity-40"
              : isActive
                ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        }`}
      >
        <div className="playlist-cover-zoom shrink-0">
          <LazyCover
            src={thumb}
            alt={playlist.name}
            className={options?.compact ? "w-7 h-7" : "w-8 h-8"}
            iconSize={12}
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
          {!options?.compact && (
            <div className="text-[11px] text-[var(--text-tertiary)] truncate tabular-nums flex items-center gap-1">
              {isThirdParty && <Lock size={10} strokeWidth={1.6} className="shrink-0" />}
              <span className="truncate">{getPlaylistTrackCount(playlist)} canciones</span>
            </div>
          )}
        </div>
        {options?.pinIndex !== undefined && (
          <kbd className="shrink-0 px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-hairline)] text-[9.5px] font-mono text-[var(--text-tertiary)]">
            {modSymbol}
            {options.pinIndex + 1}
          </kbd>
        )}
      </button>
    );
  };

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
              onMouseEnter={() => {
                if (kind === "liked" || kind === "albums" || kind === "artists") {
                  onPrefetchNav?.(kind);
                }
              }}
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

      {/* Playlists Header */}
      <div className="px-4 pt-3.5 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 pl-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            Playlists
          </span>
          {playlists.length > 0 && (
            <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
              {playlists.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {playlists.length > 0 && (
            <button
              type="button"
              onClick={() => setCreatingFolder((v) => !v)}
              title="Crear carpeta local para organizar playlists"
              aria-label="Crear carpeta de playlists"
              className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all duration-200 active:scale-90 cursor-pointer"
            >
              <FolderPlus size={13} strokeWidth={1.6} />
            </button>
          )}
          {onOpenBlendSession && playlists.length > 0 && (
            <button
              type="button"
              onClick={onOpenBlendSession}
              title="Blend Session · Mezclar varias playlists al vuelo"
              aria-label="Mezclar playlists"
              className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all duration-200 active:scale-90 cursor-pointer"
            >
              <Shuffle size={13} strokeWidth={1.7} />
            </button>
          )}
          <button
            type="button"
            onClick={onCreatePlaylist}
            title="Crear nueva playlist"
            aria-label="Crear nueva playlist"
            className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all duration-200 active:scale-90 cursor-pointer"
          >
            <Plus size={14} strokeWidth={1.7} />
          </button>
        </div>
      </div>

      {/* Inline New Folder Composer */}
      {creatingFolder && (
        <form onSubmit={handleCreateFolderSubmit} className="px-3 pb-2 flex items-center gap-1">
          <input
            type="text"
            autoFocus
            value={folderDraft}
            onChange={(e) => setFolderDraft(e.target.value)}
            placeholder="Nombre de carpeta..."
            className="flex-1 min-w-0 h-7 px-2 rounded-lg text-[11.5px] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--text-primary)]"
          />
          <button
            type="submit"
            className="h-7 px-2 rounded-lg bg-[var(--solid-bg)] text-[var(--solid-fg)] text-[11px] font-medium cursor-pointer"
          >
            Ok
          </button>
          <button
            type="button"
            onClick={() => {
              setCreatingFolder(false);
              setFolderDraft("");
            }}
            aria-label="Cancelar"
            className="w-6 h-7 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X size={12} strokeWidth={1.7} />
          </button>
        </form>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-28 space-y-2">
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
          <>
            {/* Pinned Favorites with Cmd+1..5 quick jump */}
            {pinnedPlaylists.length > 0 && (
              <div className="space-y-0.5 pb-1 border-b border-[var(--border-hairline)]">
                <div className="px-2.5 pt-0.5 pb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.09em] text-[var(--text-tertiary)]">
                  <Pin size={10} strokeWidth={1.8} />
                  Fijadas
                </div>
                {pinnedPlaylists.map((pl, idx) => renderPlaylistRow(pl, { pinIndex: idx }))}
              </div>
            )}

            {/* Collapsible Local Folders */}
            {sidebarOrg.folders.length > 0 && (
              <div className="space-y-1 pb-1 border-b border-[var(--border-hairline)]">
                {sidebarOrg.folders.map((folder) => {
                  const items = folder.playlistIds
                    .map((id) => playlistById.get(id))
                    .filter((p): p is SpotifyPlaylist => Boolean(p));
                  const isCollapsed = Boolean(folder.collapsed);
                  const isFolderDropTarget = draggingPlaylist?.hoverFolderId === folder.id;
                  return (
                    <div
                      key={folder.id}
                      data-drop-folder-id={folder.id}
                      className={`space-y-0.5 rounded-lg transition-all duration-150 ${
                        isFolderDropTarget
                          ? "bg-[var(--bg-active)] ring-1 ring-[var(--text-primary)]/60"
                          : ""
                      }`}
                    >
                      <div className="group flex items-center justify-between px-2 py-1 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
                        <button
                          type="button"
                          onClick={() => onToggleFolderCollapsed(folder.id)}
                          className="flex-1 flex items-center gap-1.5 min-w-0 text-left text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                        >
                          <ChevronRight
                            size={12}
                            strokeWidth={1.8}
                            className={`shrink-0 transition-transform duration-200 ${
                              isCollapsed ? "" : "rotate-90"
                            }`}
                          />
                          {isCollapsed ? (
                            <Folder size={13} strokeWidth={1.6} className="shrink-0" />
                          ) : (
                            <FolderOpen size={13} strokeWidth={1.6} className="shrink-0" />
                          )}
                          <span className="truncate">{folder.name}</span>
                          <span className="text-[10.5px] tabular-nums text-[var(--text-tertiary)]">
                            {items.length}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteFolder(folder.id)}
                          title="Eliminar carpeta (tus playlists no se borran)"
                          aria-label={`Eliminar carpeta ${folder.name}`}
                          className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-opacity cursor-pointer"
                        >
                          <Trash2 size={11} strokeWidth={1.6} />
                        </button>
                      </div>

                      {!isCollapsed && (
                        <div className="pl-3 space-y-0.5 border-l border-[var(--border-hairline)] ml-3.5">
                          {items.length === 0 ? (
                            <p className="px-2 py-1 text-[11px] text-[var(--text-tertiary)]">
                              Clic derecho en una playlist para moverla aquí
                            </p>
                          ) : (
                            items.map((pl) => renderPlaylistRow(pl, { compact: true }))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* All other playlists */}
            <div className="space-y-0.5">
              {ungroupedPlaylists.map((pl) => renderPlaylistRow(pl))}
            </div>
          </>
        )}
      </div>

      {/* Floating drag pill when moving a playlist onto a folder */}
      {draggingPlaylist && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[90] popover-glass px-3 py-1.5 rounded-full border border-[var(--border-subtle)] shadow-2xl flex items-center gap-2 text-[12px] font-medium text-[var(--text-primary)]"
          style={{
            left: draggingPlaylist.x + 14,
            top: draggingPlaylist.y - 14,
          }}
        >
          <Folder size={12.5} strokeWidth={1.7} />
          <span className="max-w-[160px] truncate">{draggingPlaylist.name}</span>
        </div>
      )}

      {/* Playlist Right-Click Organization Menu */}
      {plMenu && (
        <div
          ref={menuRef}
          role="menu"
          className="anim-context-menu popover-glass fixed z-55 w-52 p-1.5 rounded-2xl border border-[var(--border-subtle)] shadow-2xl"
          style={{ left: plMenu.x, top: plMenu.y }}
        >
          <div className="px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--text-primary)] truncate border-b border-[var(--border-hairline)] mb-1">
            {plMenu.playlist.name}
          </div>

          {(() => {
            const isPinned = pinnedIdSet.has(plMenu.playlist.id);
            const currentFolder = sidebarOrg.folders.find((f) =>
              f.playlistIds.includes(plMenu.playlist.id)
            );
            return (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onTogglePinPlaylist(plMenu.playlist.id);
                    setPlMenu(null);
                  }}
                  className="w-full h-8 px-2.5 rounded-xl flex items-center gap-2 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                >
                  {isPinned ? (
                    <>
                      <PinOff size={13} strokeWidth={1.6} />
                      Desfijar
                    </>
                  ) : (
                    <>
                      <Pin size={13} strokeWidth={1.6} />
                      Fijar arriba ({modSymbol}1–5)
                    </>
                  )}
                </button>

                {sidebarOrg.folders.length > 0 && (
                  <div className="mt-1 pt-1 border-t border-[var(--border-hairline)] space-y-0.5">
                    <div className="px-2.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                      Mover a carpeta
                    </div>
                    {sidebarOrg.folders.map((folder) => {
                      const inThis = currentFolder?.id === folder.id;
                      return (
                        <button
                          key={folder.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onAssignPlaylistToFolder(
                              plMenu.playlist.id,
                              inThis ? null : folder.id
                            );
                            setPlMenu(null);
                          }}
                          className={`w-full h-8 px-2.5 rounded-xl flex items-center justify-between gap-2 text-[12px] transition-colors cursor-pointer ${
                            inThis
                              ? "bg-[var(--bg-active)] text-[var(--text-primary)] font-medium"
                              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                          }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <Folder size={12.5} strokeWidth={1.6} />
                            <span className="truncate">{folder.name}</span>
                          </span>
                          {inThis && <span className="text-[10px]">✓</span>}
                        </button>
                      );
                    })}
                    {currentFolder && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onAssignPlaylistToFolder(plMenu.playlist.id, null);
                          setPlMenu(null);
                        }}
                        className="w-full h-8 px-2.5 rounded-xl flex items-center gap-2 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                      >
                        <X size={12.5} strokeWidth={1.6} />
                        Sacar de carpeta
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPlMenu(null);
                    setCreatingFolder(true);
                  }}
                  className="w-full mt-1 pt-1 border-t border-[var(--border-hairline)] h-8 px-2.5 rounded-xl flex items-center gap-2 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                >
                  <FolderPlus size={13} strokeWidth={1.6} />
                  Nueva carpeta...
                </button>
              </>
            );
          })()}
        </div>
      )}
    </aside>
  );
}
