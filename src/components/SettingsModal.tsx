import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogOut, X } from "lucide-react";
import type { ThemeMode } from "../hooks/useTheme";
import type { NotchPosition } from "./DesktopNotch";
import { SpotiDeskLogo } from "./SpotiDeskLogo";

interface SettingsModalProps {
  theme: ThemeMode;
  ambientEnabled: boolean;
  autoplayEnabled: boolean;
  notchVisible: boolean;
  notchPosition: NotchPosition;
  closeToTray: boolean;
  discordEnabled: boolean;
  discordClientId: string;
  onToggleTheme: () => void;
  onToggleAmbient: () => void;
  onToggleAutoplay: (enabled: boolean) => void;
  onToggleNotch: () => void;
  onChangeNotchPosition: (position: NotchPosition) => void;
  onToggleCloseToTray: (enabled: boolean) => void;
  onToggleDiscord: (enabled: boolean) => void;
  onChangeDiscordClientId: (clientId: string) => void;
  onLogout?: () => void;
  onClose: () => void;
}

function AppleSwitch({
  checked,
  disabled = false,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative w-10 h-6 rounded-full transition-colors duration-250 ease-apple cursor-pointer disabled:opacity-40 shrink-0 ${
        checked ? "bg-[var(--solid-bg)]" : "bg-[var(--slider-track)]"
      }`}
    >
      <span
        className="block w-4 h-4 rounded-full transition-transform duration-250 ease-apple"
        style={{
          backgroundColor: checked ? "var(--solid-fg)" : "var(--text-primary)",
          transform: checked ? "translateX(20px)" : "translateX(4px)",
        }}
      />
    </button>
  );
}

export function SettingsModal({
  theme,
  ambientEnabled,
  autoplayEnabled,
  notchVisible,
  notchPosition,
  closeToTray,
  discordEnabled,
  discordClientId,
  onToggleTheme,
  onToggleAmbient,
  onToggleAutoplay,
  onToggleNotch,
  onChangeNotchPosition,
  onToggleCloseToTray,
  onToggleDiscord,
  onChangeDiscordClientId,
  onLogout,
  onClose,
}: SettingsModalProps) {
  const isMac = /mac/i.test(navigator.platform || navigator.userAgent);
  const osLabel = isMac ? "macOS" : "Windows";
  const [autostart, setAutostart] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(true);
  const [autostartError, setAutostartError] = useState<string | null>(null);

  useEffect(() => {
    void invoke<boolean>("get_autostart_enabled")
      .then((enabled) => setAutostart(enabled))
      .catch(() => {})
      .finally(() => setAutostartLoading(false));

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleToggleAutostart = async () => {
    const next = !autostart;
    setAutostartError(null);
    setAutostartLoading(true);
    try {
      const result = await invoke<boolean>("set_autostart_enabled", { enabled: next });
      setAutostart(result);
    } catch (err) {
      setAutostartError(
        typeof err === "string" ? err : "No se pudo cambiar el inicio automático."
      );
    } finally {
      setAutostartLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Configuración de SpotiDesk"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="anim-stage-backdrop fixed inset-0 top-10 z-50 bg-black/55 backdrop-blur-md flex items-center justify-center p-6"
    >
      <div className="anim-context-menu popover-glass w-full max-w-[460px] rounded-2xl border border-[var(--border-subtle)] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-hairline)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <SpotiDeskLogo size={20} className="text-[var(--text-primary)]" />
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
              Ajustes de SpotiDesk
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ajustes"
            className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <X size={15} strokeWidth={1.6} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 max-h-[72vh] overflow-y-auto">
          {/* Playback */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Reproducción
            </h3>

            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/70 divide-y divide-[var(--border-hairline)]">
              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">
                    Reproducción automática
                  </div>
                  <div className="text-[11.5px] text-[var(--text-secondary)]">
                    Continúa con canciones similares cuando no queden pistas en cola
                  </div>
                </div>
                <AppleSwitch
                  checked={autoplayEnabled}
                  onChange={() => onToggleAutoplay(!autoplayEnabled)}
                  label="Activar reproducción automática"
                />
              </div>
            </div>
          </section>

          {/* Appearance */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Apariencia
            </h3>

            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/70 divide-y divide-[var(--border-hairline)]">
              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">
                    Modo Oscuro (Obsidian)
                  </div>
                  <div className="text-[11.5px] text-[var(--text-secondary)]">
                    Alterna entre Obsidian y Porcelain
                  </div>
                </div>
                <AppleSwitch
                  checked={theme === "dark"}
                  onChange={onToggleTheme}
                  label="Alternar modo oscuro"
                />
              </div>

              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">
                    Resplandor ambiental
                  </div>
                  <div className="text-[11.5px] text-[var(--text-secondary)]">
                    Tinte tenue derivado de la portada activa
                  </div>
                </div>
                <AppleSwitch
                  checked={ambientEnabled}
                  onChange={onToggleAmbient}
                  label="Alternar resplandor ambiental"
                />
              </div>
            </div>
          </section>

          {/* System Integration */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Integración con {osLabel}
            </h3>

            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/70 divide-y divide-[var(--border-hairline)]">
              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">
                    Notch dinámico
                  </div>
                  <div className="text-[11.5px] text-[var(--text-secondary)]">
                    Cápsula flotante siempre visible en el borde de la pantalla
                  </div>
                </div>
                <AppleSwitch
                  checked={notchVisible}
                  onChange={onToggleNotch}
                  label="Alternar Notch dinámico"
                />
              </div>

              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <label
                    htmlFor="notch-position-select"
                    className="block text-[13px] font-medium text-[var(--text-primary)]"
                  >
                    Posición del Notch
                  </label>
                  <div className="text-[11.5px] text-[var(--text-secondary)]">
                    {isMac
                      ? "Superior se sobrepone al notch de macOS"
                      : "Elige en qué borde mostrar el Notch"}
                  </div>
                </div>
                <select
                  id="notch-position-select"
                  name="notch-position"
                  value={notchPosition}
                  onChange={(e) => onChangeNotchPosition(e.target.value as NotchPosition)}
                  className="apple-select shrink-0"
                >
                  <option value="top">Superior</option>
                  <option value="left">Izquierda</option>
                  <option value="right">Derecha</option>
                </select>
              </div>

              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">
                    Minimizar a la bandeja al cerrar
                  </div>
                  <div className="text-[11.5px] text-[var(--text-secondary)]">
                    Mantiene la música sonando en segundo plano
                  </div>
                </div>
                <AppleSwitch
                  checked={closeToTray}
                  onChange={() => onToggleCloseToTray(!closeToTray)}
                  label="Minimizar a la bandeja al cerrar"
                />
              </div>

              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">
                    Iniciar con {osLabel}
                  </div>
                  <div className="text-[11.5px] text-[var(--text-secondary)]">
                    Abrir SpotiDesk automáticamente al iniciar sesión
                  </div>
                </div>
                <AppleSwitch
                  checked={autostart}
                  disabled={autostartLoading}
                  onChange={() => void handleToggleAutostart()}
                  label={`Iniciar con ${osLabel}`}
                />
              </div>
            </div>

            {autostartError && (
              <p className="text-[11.5px] text-[var(--text-secondary)] px-1">{autostartError}</p>
            )}
          </section>

          {/* Discord Rich Presence */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Discord Rich Presence
            </h3>

            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/70 divide-y divide-[var(--border-hairline)]">
              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">
                    Mostrar actividad en Discord
                  </div>
                  <div className="text-[11.5px] text-[var(--text-secondary)]">
                    Muestra canción, portada y tiempo restante en tu perfil
                  </div>
                </div>
                <AppleSwitch
                  checked={discordEnabled}
                  onChange={() => onToggleDiscord(!discordEnabled)}
                  label="Activar Discord Rich Presence"
                />
              </div>

              {discordEnabled && (
                <div className="px-4 py-3 space-y-2">
                  <label
                    htmlFor="discord-app-id"
                    className="block text-[11.5px] font-medium text-[var(--text-secondary)]"
                  >
                    Discord Application ID
                  </label>
                  <input
                    id="discord-app-id"
                    type="text"
                    value={discordClientId}
                    onChange={(e) => onChangeDiscordClientId(e.target.value)}
                    placeholder="Ej. 1234567890123456789"
                    spellCheck={false}
                    className="w-full h-9 px-3 rounded-lg text-[12.5px] font-mono bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--text-primary)] transition-colors"
                  />
                  <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                    Crea una app llamada <strong className="text-[var(--text-secondary)]">SpotiDesk</strong> en{" "}
                    <code>discord.com/developers/applications</code> y pega su Application ID aquí (o en{" "}
                    <code>VITE_DISCORD_CLIENT_ID</code>).
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Shortcuts */}
          <section className="space-y-2.5">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Atajos rápidos
            </h3>
            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/70 px-4 py-3 grid grid-cols-2 gap-y-2 text-[12px]">
              <span className="text-[var(--text-secondary)]">Reproducir / Pausar</span>
              <span className="text-right font-mono text-[11px] text-[var(--text-primary)]">
                Espacio
              </span>
              <span className="text-[var(--text-secondary)]">Vista inmersiva / Letras</span>
              <span className="text-right font-mono text-[11px] text-[var(--text-primary)]">F</span>
              <span className="text-[var(--text-secondary)]">Buscar música</span>
              <span className="text-right font-mono text-[11px] text-[var(--text-primary)]">
                {isMac ? "Cmd + K" : "Ctrl + K"}
              </span>
              <span className="text-[var(--text-secondary)]">Control global {osLabel}</span>
              <span className="text-right font-mono text-[11px] text-[var(--text-primary)]">
                Teclas Media
              </span>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[var(--border-hairline)] flex items-center justify-between bg-[var(--bg-elevated)]/40">
          <span className="text-[11.5px] text-[var(--text-tertiary)]">
            SpotiDesk v0.2.0 · Tauri v2
          </span>
          {onLogout && (
            <button
              type="button"
              onClick={() => {
                onLogout();
                onClose();
              }}
              className="h-8 px-3 rounded-lg text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <LogOut size={13} strokeWidth={1.5} />
              Cerrar sesión
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
