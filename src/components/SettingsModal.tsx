import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  Download,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import {
  downloadSpotiDeskBackup,
  restoreSpotiDeskBackup,
} from "../lib/backupConfig";
import type { ThemeMode } from "../hooks/useTheme";
import type { SoftGlideMode } from "../hooks/useSpotifyPlayer";
import type { SpotifyUser } from "../types/spotify";
import {
  captureShortcutFromEvent,
  formatShortcutLabel,
  getDefaultShortcuts,
  isShortcutsModified,
  type AppShortcutsConfig,
  type ShortcutField,
} from "../lib/shortcutsConfig";
import type { NotchPosition } from "./DesktopNotch";
import { SpotiDeskLogo } from "./SpotiDeskLogo";

interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  notes?: string | null;
}

interface SettingsModalProps {
  user: SpotifyUser | null;
  clientId: string;
  onChangeClientId: (nextId: string) => void;
  theme: ThemeMode;
  ambientEnabled: boolean;
  autoplayEnabled: boolean;
  softGlideMode: SoftGlideMode;
  notchVisible: boolean;
  notchLyricsEnabled: boolean;
  notchAutoPeek: boolean;
  notchPosition: NotchPosition;
  closeToTray: boolean;
  shortcuts: AppShortcutsConfig;
  onChangeShortcuts: (next: AppShortcutsConfig) => void;
  onToggleTheme: () => void;
  onToggleAmbient: () => void;
  onToggleAutoplay: (enabled: boolean) => void;
  onChangeSoftGlide: (mode: SoftGlideMode) => void;
  onToggleNotch: () => void;
  onToggleNotchLyrics: (enabled: boolean) => void;
  onToggleNotchAutoPeek: (enabled: boolean) => void;
  onChangeNotchPosition: (position: NotchPosition) => void;
  onToggleCloseToTray: (enabled: boolean) => void;
  onBackupRestored?: () => void;
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

function maskClientId(id: string): string {
  const clean = id.trim();
  if (!clean) return "No configurado";
  if (clean.length <= 10) return clean;
  return `${clean.slice(0, 6)}••••••${clean.slice(-4)}`;
}

export function SettingsModal({
  user,
  clientId,
  onChangeClientId,
  theme,
  ambientEnabled,
  autoplayEnabled,
  softGlideMode,
  notchVisible,
  notchLyricsEnabled,
  notchAutoPeek,
  notchPosition,
  closeToTray,
  shortcuts,
  onChangeShortcuts,
  onToggleTheme,
  onToggleAmbient,
  onToggleAutoplay,
  onChangeSoftGlide,
  onToggleNotch,
  onToggleNotchLyrics,
  onToggleNotchAutoPeek,
  onChangeNotchPosition,
  onToggleCloseToTray,
  onBackupRestored,
  onLogout,
  onClose,
}: SettingsModalProps) {
  const isMac = /mac/i.test(navigator.platform || navigator.userAgent);
  const osLabel = isMac ? "macOS" : "Windows";
  const modLabel = isMac ? "⌘" : "Ctrl";

  const [autostart, setAutostart] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(true);
  const [autostartError, setAutostartError] = useState<string | null>(null);

  const [editingClientId, setEditingClientId] = useState(false);
  const [clientIdDraft, setClientIdDraft] = useState(clientId);
  const [clientIdSaved, setClientIdSaved] = useState(false);

  const [capturingField, setCapturingField] = useState<ShortcutField | null>(null);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const defaultShortcuts = getDefaultShortcuts(isMac);

  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [backupFeedback, setBackupFeedback] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const handleExportBackup = () => {
    const count = downloadSpotiDeskBackup();
    setBackupFeedback(`Respaldo descargado (${count} ajustes y carpetas guardados).`);
    window.setTimeout(() => setBackupFeedback(null), 3500);
  };

  const handleImportBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const { restoredKeys } = restoreSpotiDeskBackup(text);
      setBackupFeedback(`Respaldo restaurado (${restoredKeys} elementos aplicados).`);
      onBackupRestored?.();
      window.setTimeout(() => setBackupFeedback(null), 4000);
    } catch (err) {
      setBackupFeedback(
        err instanceof Error ? err.message : "No se pudo importar el archivo de respaldo."
      );
    }
  };

  useEffect(() => {
    void invoke<boolean>("get_autostart_enabled")
      .then((enabled) => setAutostart(enabled))
      .catch(() => {})
      .finally(() => setAutostartLoading(false));
  }, []);

  // Escape closes modal unless currently capturing a shortcut key combination
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (capturingField) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          setCapturingField(null);
          setShortcutError(null);
          return;
        }
        const requireModifier = capturingField === "globalSpotlight";
        const combo = captureShortcutFromEvent(e, { requireModifier, isMac });
        if (!combo) {
          if (
            requireModifier &&
            !["Meta", "Control", "Alt", "Shift"].includes(e.key)
          ) {
            setShortcutError(
              `El atajo global requiere al menos un modificador (${isMac ? "⌘, ⌥, ⌃ o ⇧" : "Ctrl, Alt o Shift"}).`
            );
          }
          return;
        }

        const field = capturingField;
        setCapturingField(null);
        setShortcutError(null);

        if (field === "globalSpotlight") {
          void invoke<string>("set_spotlight_shortcut", { shortcut: combo })
            .then(() => {
              onChangeShortcuts({ ...shortcuts, globalSpotlight: combo });
            })
            .catch((err) => {
              setShortcutError(
                typeof err === "string"
                  ? err
                  : "No se pudo registrar ese atajo global (puede estar usado por el sistema)."
              );
            });
        } else {
          onChangeShortcuts({ ...shortcuts, [field]: combo });
        }
        return;
      }
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturingField, isMac, onChangeShortcuts, onClose, shortcuts]);

  const handleResetSingleShortcut = (field: ShortcutField) => {
    setShortcutError(null);
    const defVal = defaultShortcuts[field];
    if (field === "globalSpotlight") {
      void invoke<string>("set_spotlight_shortcut", { shortcut: defVal })
        .then(() => onChangeShortcuts({ ...shortcuts, globalSpotlight: defVal }))
        .catch((err) => {
          setShortcutError(
            typeof err === "string" ? err : "No se pudo restablecer el atajo global."
          );
        });
    } else {
      onChangeShortcuts({ ...shortcuts, [field]: defVal });
    }
  };

  const handleResetAllShortcuts = () => {
    setShortcutError(null);
    setCapturingField(null);
    const fresh = getDefaultShortcuts(isMac);
    void invoke<string>("set_spotlight_shortcut", {
      shortcut: fresh.globalSpotlight,
    }).catch(() => {});
    onChangeShortcuts(fresh);
  };

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

  const handleSaveClientId = () => {
    const trimmed = clientIdDraft.trim();
    onChangeClientId(trimmed);
    setEditingClientId(false);
    setClientIdSaved(true);
    window.setTimeout(() => setClientIdSaved(false), 2400);
  };

  const handleCheckUpdates = async () => {
    setUpdateChecking(true);
    setUpdateError(null);
    try {
      const res = await invoke<UpdateCheckResult>("check_for_updates");
      setUpdateResult(res);
    } catch (err) {
      setUpdateError(
        typeof err === "string" ? err : "No se pudo comprobar actualizaciones."
      );
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleOpenRelease = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const isPremium = user?.product?.toLowerCase() === "premium";
  const shortcutsModified = isShortcutsModified(shortcuts);

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
      <div className="anim-context-menu popover-glass w-full max-w-[480px] rounded-2xl border border-[var(--border-subtle)] overflow-hidden">
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
          {/* Account & Client ID */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Cuenta y conexión
            </h3>

            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/70 divide-y divide-[var(--border-hairline)]">
              {user && (
                <div className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                      {user.display_name || user.id}
                    </div>
                    {user.email && (
                      <div className="text-[11.5px] text-[var(--text-secondary)] truncate">
                        {user.email}
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 px-2.5 py-1 rounded-full text-[10.5px] font-medium border ${
                      isPremium
                        ? "bg-[var(--bg-active)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                        : "bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-secondary)]"
                    }`}
                    title={
                      isPremium
                        ? "Cuenta Spotify Premium compatible con reproducción directa"
                        : "Spotify requiere Premium para reproducir audio directamente en SpotiDesk"
                    }
                  >
                    {isPremium ? "Premium" : user.product ? `Plan ${user.product}` : "Cuenta Free"}
                  </span>
                </div>
              )}

              <div className="px-4 py-3 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                      <KeyRound size={12.5} strokeWidth={1.6} />
                      Client ID de Spotify
                    </div>
                    <div className="text-[11.5px] text-[var(--text-secondary)] font-mono truncate">
                      {maskClientId(clientId)}
                    </div>
                  </div>
                  {!editingClientId && (
                    <button
                      type="button"
                      onClick={() => {
                        setClientIdDraft(clientId);
                        setEditingClientId(true);
                      }}
                      className="h-7 px-2.5 rounded-lg text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-hairline)] transition-colors cursor-pointer shrink-0"
                    >
                      Cambiar
                    </button>
                  )}
                </div>

                {editingClientId && (
                  <div className="space-y-2 pt-1">
                    <input
                      type="text"
                      value={clientIdDraft}
                      onChange={(e) => setClientIdDraft(e.target.value)}
                      placeholder="Pega tu Client ID de Spotify"
                      spellCheck={false}
                      autoComplete="off"
                      className="w-full h-8 px-2.5 rounded-lg text-[12px] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--text-primary)]"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingClientId(false)}
                        className="h-7 px-2.5 rounded-lg text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveClientId}
                        className="h-7 px-3 rounded-lg text-[11.5px] font-medium bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] cursor-pointer"
                      >
                        Guardar
                      </button>
                    </div>
                  </div>
                )}

                {clientIdSaved && (
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    Guardado. Cierra sesión y vuelve a conectar para usar el nuevo Client ID.
                  </p>
                )}
              </div>
            </div>
          </section>

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

              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <label
                    htmlFor="soft-glide-select"
                    className="block text-[13px] font-medium text-[var(--text-primary)]"
                  >
                    Transiciones suaves (Soft Glide)
                  </label>
                  <div className="text-[11.5px] text-[var(--text-secondary)]">
                    Desvanecido logarítmico automático al cambiar entre pistas
                  </div>
                </div>
                <select
                  id="soft-glide-select"
                  name="soft-glide"
                  value={softGlideMode}
                  onChange={(e) => onChangeSoftGlide(e.target.value as SoftGlideMode)}
                  className="apple-select shrink-0"
                >
                  <option value="off">Desactivado</option>
                  <option value="subtle">Sutil</option>
                  <option value="cinematic">Cinemático</option>
                </select>
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
                <div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">
                    Letras en vivo en el Notch
                  </div>
                  <div className="text-[11.5px] text-[var(--text-secondary)]">
                    Muestra el verso sincronizado actual mientras escuchas
                  </div>
                </div>
                <AppleSwitch
                  checked={notchLyricsEnabled}
                  disabled={!notchVisible}
                  onChange={() => onToggleNotchLyrics(!notchLyricsEnabled)}
                  label="Mostrar letras en vivo en el Notch"
                />
              </div>

              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">
                    Auto-Peek al cambiar de canción
                  </div>
                  <div className="text-[11.5px] text-[var(--text-secondary)]">
                    Asoma el Notch brevemente cuando empieza un tema nuevo
                  </div>
                </div>
                <AppleSwitch
                  checked={notchAutoPeek}
                  disabled={!notchVisible}
                  onChange={() => onToggleNotchAutoPeek(!notchAutoPeek)}
                  label="Activar Auto-Peek del Notch"
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
                      ? "Superior se sobrepone al notch de macOS, o elige burbuja flotante"
                      : "Elige el borde del Notch o la burbuja radial flotante"}
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
                  <option value="bubble">Burbuja (abajo der.)</option>
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

          {/* Customizable Shortcuts */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                Atajos personalizables (clic para grabar)
              </h3>
              {shortcutsModified && (
                <button
                  type="button"
                  onClick={handleResetAllShortcuts}
                  className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <RotateCcw size={11} strokeWidth={1.6} />
                  Restablecer todos
                </button>
              )}
            </div>

            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/70 px-4 py-3 space-y-2 text-[12px]">
              {(
                [
                  {
                    field: "globalSpotlight",
                    label: "Spotlight flotante global",
                    hint: "Desde cualquier app",
                  },
                  { field: "openPalette", label: "Paleta rápida (en app)" },
                  { field: "openSearch", label: "Buscar música" },
                  { field: "filterPlaylist", label: "Filtrar dentro de una playlist" },
                  { field: "togglePlay", label: "Reproducir / Pausar" },
                  { field: "toggleStage", label: "Vista inmersiva / Letras" },
                  { field: "toggleLike", label: "Me Gusta canción actual" },
                  { field: "toggleMute", label: "Silenciar sonido" },
                  { field: "navBack", label: "Navegar atrás" },
                  { field: "navForward", label: "Navegar adelante" },
                ] as Array<{ field: ShortcutField; label: string; hint?: string }>
              ).map(({ field, label, hint }, idx) => {
                const isCapturing = capturingField === field;
                const isCustom = shortcuts[field] !== defaultShortcuts[field];
                return (
                  <div
                    key={field}
                    className={`flex items-center justify-between gap-2 ${
                      idx === 1 ? "pt-2 border-t border-[var(--border-hairline)]" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="text-[var(--text-secondary)]">{label}</span>
                      {hint && (
                        <span className="ml-1.5 text-[10.5px] text-[var(--text-tertiary)]">
                          · {hint}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isCustom && !isCapturing && (
                        <button
                          type="button"
                          onClick={() => handleResetSingleShortcut(field)}
                          title={`Restablecer a ${formatShortcutLabel(defaultShortcuts[field], isMac)}`}
                          aria-label={`Restablecer ${label}`}
                          className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                        >
                          <RotateCcw size={11} strokeWidth={1.7} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setShortcutError(null);
                          setCapturingField(isCapturing ? null : field);
                        }}
                        className={`px-2 py-0.5 rounded-md font-mono text-[11px] border transition-colors cursor-pointer ${
                          isCapturing
                            ? "bg-[var(--solid-bg)] text-[var(--solid-fg)] border-transparent"
                            : isCustom
                              ? "bg-[var(--bg-active)] text-[var(--text-primary)] border-[var(--border-subtle)]"
                              : "bg-[var(--bg-primary)] text-[var(--text-primary)] border-[var(--border-hairline)] hover:border-[var(--border-subtle)]"
                        }`}
                      >
                        {isCapturing
                          ? "Pulsa combinación..."
                          : formatShortcutLabel(shortcuts[field], isMac)}
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className="flex items-center justify-between pt-2 border-t border-[var(--border-hairline)]">
                <span className="text-[var(--text-secondary)]">Saltar ±5s / ±15s</span>
                <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                  ← / → (+ ⇧)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">Subir / bajar volumen</span>
                <span className="font-mono text-[11px] text-[var(--text-tertiary)]">↑ / ↓</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">Playlists fijadas</span>
                <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                  {modLabel} + 1–5
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">Control global {osLabel}</span>
                <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                  Teclas Media
                </span>
              </div>
            </div>

            {shortcutError && (
              <p className="text-[11.5px] text-[var(--text-secondary)] px-1">{shortcutError}</p>
            )}
          </section>

          {/* Backup & Sync JSON */}
          <section className="space-y-2.5">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Respaldo (Mac ↔ Windows)
            </h3>
            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/70 px-4 py-3 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium text-[var(--text-primary)]">
                    Carpetas, pines, atajos y momentos
                  </div>
                  <div className="text-[11.5px] text-[var(--text-secondary)]">
                    Exporta o importa tu configuración completa en un archivo JSON
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleExportBackup}
                    className="h-8 px-2.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)] text-[11.5px] text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Download size={12} strokeWidth={1.7} />
                    Exportar
                  </button>
                  <button
                    type="button"
                    onClick={() => importInputRef.current?.click()}
                    className="h-8 px-2.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)] text-[11.5px] text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Upload size={12} strokeWidth={1.7} />
                    Importar
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => void handleImportBackupFile(e)}
                    className="hidden"
                  />
                </div>
              </div>
              {backupFeedback && (
                <p className="text-[11.5px] text-[var(--text-secondary)]">{backupFeedback}</p>
              )}
            </div>
          </section>

          {/* Updates */}
          <section className="space-y-2.5">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Actualizaciones
            </h3>
            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/70 px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-[var(--text-primary)]">
                  SpotiDesk v{updateResult?.currentVersion || "0.2.0"}
                </div>
                <div className="text-[11.5px] text-[var(--text-secondary)]">
                  {updateError
                    ? updateError
                    : updateResult
                      ? updateResult.hasUpdate
                        ? `Nueva versión v${updateResult.latestVersion} disponible`
                        : "Tienes la versión más reciente"
                      : "Comprueba nuevas versiones en GitHub Releases"}
                </div>
              </div>

              {updateResult?.hasUpdate ? (
                <button
                  type="button"
                  onClick={() => void handleOpenRelease(updateResult.releaseUrl)}
                  className="shrink-0 h-8 px-3 rounded-lg bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] text-[12px] font-medium inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download size={12.5} strokeWidth={1.7} />
                  Descargar
                </button>
              ) : (
                <button
                  type="button"
                  disabled={updateChecking}
                  onClick={() => void handleCheckUpdates()}
                  className="shrink-0 h-8 px-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)] text-[12px] text-[var(--text-primary)] inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {updateChecking ? (
                    <Loader2 size={12.5} strokeWidth={1.6} className="animate-spin" />
                  ) : updateResult ? (
                    <Check size={12.5} strokeWidth={1.7} />
                  ) : (
                    <RefreshCw size={12.5} strokeWidth={1.6} />
                  )}
                  {updateChecking ? "Buscando..." : updateResult ? "Al día" : "Comprobar"}
                </button>
              )}
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
