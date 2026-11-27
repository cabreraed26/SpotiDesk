import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronLeft,
  ChevronRight,
  Command,
  Copy,
  History,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTop,
  PictureInPicture2,
  Settings,
  Sparkles,
  Square,
  Sun,
  X,
} from "lucide-react";
import type { SpotifyUser } from "../types/spotify";
import type { ThemeMode } from "../hooks/useTheme";
import { SpotiDeskLogo } from "./SpotiDeskLogo";
import { startMacWindowDrag } from "../lib/windowDrag";

interface TitleBarProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
  ambientEnabled: boolean;
  onToggleAmbient: () => void;
  notchVisible: boolean;
  onToggleNotch: () => void;
  onOpenSettings: () => void;
  onOpenCommandPalette?: () => void;
  onOpenHistory?: () => void;
  onToggleMiniPlayer?: () => void;
  zenMode?: boolean;
  onToggleZenMode?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  user: SpotifyUser | null;
  isSdkReady: boolean;
}

export function TitleBar({
  theme,
  onToggleTheme,
  ambientEnabled,
  onToggleAmbient,
  notchVisible,
  onToggleNotch,
  onOpenSettings,
  onOpenCommandPalette,
  onOpenHistory,
  onToggleMiniPlayer,
  zenMode = false,
  onToggleZenMode,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  user,
  isSdkReady,
}: TitleBarProps) {
  const isMac = /mac/i.test(navigator.platform || navigator.userAgent);
  const [isMaximized, setIsMaximized] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const leftZoneRef = useRef<HTMLDivElement | null>(null);
  const rightZoneRef = useRef<HTMLDivElement | null>(null);

  // Sync exact non-button TitleBar bounds to macOS native WindowServer drag monitor
  // so macOS Sequoia/Tahoe edge snapping (top fill, left/right half split) works natively.
  useLayoutEffect(() => {
    if (!isMac) return;
    const header = headerRef.current;
    if (!header) return;

    const syncZone = () => {
      const hRect = header.getBoundingClientRect();
      let leftInset = 78; // clears macOS traffic lights
      if (leftZoneRef.current) {
        const buttons = leftZoneRef.current.querySelectorAll("button");
        for (const btn of buttons) {
          const r = btn.getBoundingClientRect();
          if (r.width > 0) leftInset = Math.max(leftInset, r.right - hRect.left + 6);
        }
      }

      let rightInset = 12;
      if (rightZoneRef.current) {
        const buttons = rightZoneRef.current.querySelectorAll("button");
        let minLeft = hRect.right;
        for (const btn of buttons) {
          const r = btn.getBoundingClientRect();
          if (r.width > 0) minLeft = Math.min(minLeft, r.left);
        }
        rightInset = Math.max(12, hRect.right - minLeft + 6);
      }

      void invoke("set_titlebar_drag_zone", {
        height: hRect.height || 40,
        leftInset,
        rightInset,
      }).catch(() => {});
    };

    syncZone();
    const ro = new ResizeObserver(syncZone);
    ro.observe(header);
    return () => ro.disconnect();
  }, [
    isMac,
    Boolean(user),
    Boolean(onToggleZenMode),
    Boolean(onGoBack),
    Boolean(onOpenCommandPalette),
    Boolean(onOpenHistory),
    Boolean(onToggleMiniPlayer),
  ]);

  useEffect(() => {
    if (isMac) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    void win.isMaximized().then(setIsMaximized).catch(() => {});
    void win
      .onResized(() => {
        void win.isMaximized().then(setIsMaximized).catch(() => {});
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [isMac]);

  const handleMinimize = () => {
    void getCurrentWindow().minimize();
  };

  const handleToggleMaximize = async () => {
    const win = getCurrentWindow();
    await win.toggleMaximize();
    setIsMaximized(await win.isMaximized());
  };

  const handleCloseToTray = () => {
    // Rust intercepts close and minimizes to system tray so music keeps playing
    void getCurrentWindow().close();
  };

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!isMac) return;
    startMacWindowDrag(e, () => {
      void handleToggleMaximize();
    });
  };

  const winDragAttr = !isMac ? "" : undefined;

  return (
    <header
      ref={headerRef}
      data-tauri-drag-region={winDragAttr}
      data-persistent-titlebar
      onPointerDown={handleHeaderPointerDown}
      className={`chrome-no-select h-10 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center ${
        isMac ? "px-3" : "px-2.5"
      } border-b border-[var(--border-hairline)] bg-[var(--bg-elevated)]/85 backdrop-blur-xl z-40`}
    >
      {/* Left: Discreet Back/Forward navigation arrows (clears macOS traffic lights cleanly) */}
      <div
        ref={leftZoneRef}
        data-tauri-drag-region={winDragAttr}
        className={`h-full min-w-0 flex items-center gap-0.5 ${isMac ? "pl-[72px]" : "pl-1"}`}
      >
        {user && onToggleZenMode && (
          <button
            type="button"
            onClick={onToggleZenMode}
            title={
              zenMode
                ? "Salir del Modo Enfoque / Zen"
                : "Modo Enfoque / Zen (oculta barra lateral y activa lluvia suave)"
            }
            aria-label="Alternar Modo Enfoque / Zen"
            aria-pressed={zenMode}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors duration-150 cursor-pointer ${
              zenMode
                ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            {zenMode ? (
              <PanelLeftOpen size={14} strokeWidth={1.6} />
            ) : (
              <PanelLeftClose size={14} strokeWidth={1.6} />
            )}
          </button>
        )}
        {user && onGoBack && onGoForward && (
          <>
            <button
              type="button"
              onClick={onGoBack}
              disabled={!canGoBack}
              title={isMac ? "Atrás (⌘←)" : "Atrás (Alt+←)"}
              aria-label="Ir atrás"
              className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-25 disabled:pointer-events-none transition-colors duration-150 cursor-pointer"
            >
              <ChevronLeft size={15} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={onGoForward}
              disabled={!canGoForward}
              title={isMac ? "Adelante (⌘→)" : "Adelante (Alt+→)"}
              aria-label="Ir adelante"
              className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-25 disabled:pointer-events-none transition-colors duration-150 cursor-pointer"
            >
              <ChevronRight size={15} strokeWidth={1.6} />
            </button>
          </>
        )}
      </div>

      {/* Center: SpotiDesk Brand mark + wordmark */}
      <div
        data-tauri-drag-region={winDragAttr}
        className="flex items-center justify-center gap-2 px-3 min-w-0"
      >
        <SpotiDeskLogo size={17} className="pointer-events-none text-[var(--text-primary)] shrink-0" />
        <span
          data-tauri-drag-region={winDragAttr}
          className="pointer-events-none text-[12.5px] font-semibold tracking-[-0.025em] text-[var(--text-primary)]"
        >
          SpotiDesk
        </span>
      </div>

      {/* Right: User badge + utility icons + frameless Windows controls */}
      <div
        ref={rightZoneRef}
        data-tauri-drag-region={winDragAttr}
        className="flex items-center justify-end gap-0.5 min-w-0"
      >
        {user && (
          <div
            data-tauri-drag-region={winDragAttr}
            className="hidden sm:flex items-center gap-1.5 mr-1 min-w-0"
          >
            <div
              data-tauri-drag-region={winDragAttr}
              className="w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500"
              style={{
                backgroundColor: isSdkReady
                  ? "var(--text-primary)"
                  : "var(--text-tertiary)",
              }}
              title={
                isSdkReady
                  ? "Spotify Web Playback SDK activo"
                  : "Conectando motor de audio..."
              }
            />
            <span
              data-tauri-drag-region={winDragAttr}
              className="pointer-events-none text-[11.5px] text-[var(--text-secondary)] truncate max-w-[160px]"
            >
              {user.display_name || user.id}
            </span>
            <div className="pointer-events-none w-px h-3.5 bg-[var(--border-hairline)] ml-1.5" />
          </div>
        )}
        {user && onOpenCommandPalette && (
          <button
            type="button"
            onClick={onOpenCommandPalette}
            title={isMac ? "Paleta rápida (⌘P)" : "Paleta rápida (Ctrl+P)"}
            aria-label="Abrir paleta de comandos rápida"
            className="w-8 h-7 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-200 ease-apple cursor-pointer"
          >
            <Command size={13.5} strokeWidth={1.5} />
          </button>
        )}

        {user && onOpenHistory && (
          <button
            type="button"
            onClick={onOpenHistory}
            title="Historial de reproducción"
            aria-label="Abrir historial de reproducción"
            className="w-8 h-7 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-200 ease-apple cursor-pointer"
          >
            <History size={13.5} strokeWidth={1.5} />
          </button>
        )}

        {user && onToggleMiniPlayer && (
          <button
            type="button"
            onClick={onToggleMiniPlayer}
            title="Modo Mini-Reproductor flotante"
            aria-label="Activar modo Mini-Reproductor"
            className="w-8 h-7 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-200 ease-apple cursor-pointer"
          >
            <PictureInPicture2 size={14} strokeWidth={1.5} />
          </button>
        )}

        <button
          type="button"
          onClick={onToggleNotch}
          title={
            notchVisible
              ? "Ocultar Notch superior"
              : "Mostrar Notch superior"
          }
          className={`w-8 h-7 rounded-md flex items-center justify-center transition-colors duration-200 ease-apple hover:bg-[var(--bg-hover)] cursor-pointer ${
            notchVisible ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"
          }`}
          aria-label="Alternar Notch superior"
          aria-pressed={notchVisible}
        >
          <PanelTop size={14} strokeWidth={1.5} />
        </button>

        {user && (
          <button
            type="button"
            onClick={onToggleAmbient}
            title={
              ambientEnabled
                ? "Desactivar resplandor ambiental"
                : "Activar resplandor ambiental"
            }
            className={`w-8 h-7 rounded-md flex items-center justify-center transition-colors duration-200 ease-apple hover:bg-[var(--bg-hover)] ${
              ambientEnabled ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"
            }`}
            aria-label="Alternar resplandor ambiental"
          >
            <Sparkles size={14} strokeWidth={1.5} />
          </button>
        )}

        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Cambiar a Modo Claro (Porcelain)" : "Cambiar a Modo Oscuro (Obsidian)"}
          className="w-8 h-7 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-200 ease-apple"
          aria-label="Cambiar tema"
        >
          {theme === "dark" ? (
            <Sun size={14} strokeWidth={1.5} />
          ) : (
            <Moon size={14} strokeWidth={1.5} />
          )}
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          title="Ajustes de SpotiDesk"
          className="w-8 h-7 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-200 ease-apple cursor-pointer"
          aria-label="Abrir ajustes"
        >
          <Settings size={14} strokeWidth={1.5} />
        </button>

        {!isMac && (
          <>
            <div className="w-px h-3.5 bg-[var(--border-hairline)] mx-1.5" />

            <button
              type="button"
              onClick={handleMinimize}
              title="Minimizar"
              className="w-8 h-7 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-150"
              aria-label="Minimizar ventana"
            >
              <Minus size={14} strokeWidth={1.5} />
            </button>

            <button
              type="button"
              onClick={() => void handleToggleMaximize()}
              title={isMaximized ? "Restaurar" : "Maximizar"}
              className="w-8 h-7 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-150"
              aria-label={isMaximized ? "Restaurar ventana" : "Maximizar ventana"}
            >
              {isMaximized ? (
                <Copy size={12} strokeWidth={1.5} />
              ) : (
                <Square size={12} strokeWidth={1.5} />
              )}
            </button>

            <button
              type="button"
              onClick={handleCloseToTray}
              title="Minimizar a la bandeja del sistema"
              className="w-8 h-7 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-150"
              aria-label="Ocultar en la bandeja del sistema"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
