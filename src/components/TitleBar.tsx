import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Copy,
  Minus,
  Moon,
  PanelTop,
  Settings,
  Sparkles,
  Square,
  Sun,
  X,
} from "lucide-react";
import type { SpotifyUser } from "../types/spotify";
import type { ThemeMode } from "../hooks/useTheme";
import { SpotiDeskLogo } from "./SpotiDeskLogo";

interface TitleBarProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
  ambientEnabled: boolean;
  onToggleAmbient: () => void;
  notchVisible: boolean;
  onToggleNotch: () => void;
  onOpenSettings: () => void;
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
  user,
  isSdkReady,
}: TitleBarProps) {
  const isMac = /mac/i.test(navigator.platform || navigator.userAgent);
  const [isMaximized, setIsMaximized] = useState(false);

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

  return (
    <header
      data-tauri-drag-region
      className={`chrome-no-select h-10 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center ${
        isMac ? "px-3" : "px-2.5"
      } border-b border-[var(--border-hairline)] bg-[var(--bg-elevated)]/85 backdrop-blur-xl z-40`}
    >
      {/* Left: Draggable spacer (reserves space for native macOS traffic lights) */}
      <div data-tauri-drag-region className="h-full min-w-0" />

      {/* Center: SpotiDesk Brand mark + wordmark */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-center gap-2 px-3 min-w-0"
      >
        <SpotiDeskLogo size={17} className="text-[var(--text-primary)] shrink-0" />
        <span
          data-tauri-drag-region
          className="text-[12.5px] font-semibold tracking-[-0.025em] text-[var(--text-primary)]"
        >
          SpotiDesk
        </span>
      </div>

      {/* Right: User badge + utility icons + frameless Windows controls */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-end gap-0.5 min-w-0"
      >
        {user && (
          <div
            data-tauri-drag-region
            className="hidden sm:flex items-center gap-1.5 mr-1 min-w-0"
          >
            <div
              data-tauri-drag-region
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
              data-tauri-drag-region
              className="text-[11.5px] text-[var(--text-secondary)] truncate max-w-[160px]"
            >
              {user.display_name || user.id}
            </span>
            <div className="w-px h-3.5 bg-[var(--border-hairline)] ml-1.5" />
          </div>
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
