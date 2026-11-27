import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  HelpCircle,
  KeyRound,
  Loader2,
} from "lucide-react";
import { SpotiDeskLogo } from "./SpotiDeskLogo";

interface LoginScreenProps {
  clientId: string;
  isAuthenticating: boolean;
  error: string | null;
  onLogin: (overrideClientId?: string) => void;
}

const REDIRECT_URI = "http://127.0.0.1:8888/callback";
const SPOTIFY_DASHBOARD_URL = "https://developer.spotify.com/dashboard";

export function LoginScreen({
  clientId,
  isAuthenticating,
  error,
  onLogin,
}: LoginScreenProps) {
  const [inputClientId, setInputClientId] = useState(clientId);
  const [showConfig, setShowConfig] = useState(!clientId);
  const [showGuide, setShowGuide] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(showConfig ? inputClientId : undefined);
  };

  const handleCopyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(REDIRECT_URI);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleOpenDashboard = async () => {
    try {
      await openUrl(SPOTIFY_DASHBOARD_URL);
    } catch {
      window.open(SPOTIFY_DASHBOARD_URL, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <main className="flex-1 overflow-y-auto flex items-center justify-center p-6 sm:p-8 bg-[var(--bg-primary)] relative">
      {/* Ultra-subtle radial architectural spotlight */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(620px circle at 50% 35%, rgba(134, 134, 139, 0.08), transparent 70%)",
        }}
      />

      <div className="relative z-10 w-full max-w-[440px] my-auto flex flex-col items-center text-center py-4">
        {/* Monochrome SpotiDesk emblem */}
        <div className="w-16 h-16 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] flex items-center justify-center mb-7 shadow-lg">
          <SpotiDeskLogo size={34} className="text-[var(--text-primary)]" />
        </div>

        <h1 className="text-[34px] font-semibold tracking-[-0.035em] leading-tight text-[var(--text-primary)]">
          SpotiDesk
        </h1>

        <p className="mt-2.5 text-[14px] leading-relaxed text-[var(--text-secondary)] max-w-[330px]">
          Tu música en un cliente nativo ultraligero, silencioso y sin distracciones.
        </p>

        <form onSubmit={handleSubmit} className="w-full mt-8 space-y-4">
          {showConfig && (
            <div className="text-left p-4 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="spotify-client-id"
                  className="text-[12.5px] font-medium text-[var(--text-primary)] flex items-center gap-1.5"
                >
                  <KeyRound size={13} strokeWidth={1.5} />
                  Tu Client ID de Spotify
                </label>
                <span className="text-[11px] text-[var(--text-tertiary)]">
                  Solo se hace 1 vez
                </span>
              </div>

              <input
                id="spotify-client-id"
                type="text"
                value={inputClientId}
                onChange={(e) => setInputClientId(e.target.value)}
                placeholder="Pega aquí tu Client ID de Spotify"
                autoComplete="off"
                spellCheck={false}
                className="w-full h-9 px-3 rounded-lg text-[13px] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--text-primary)] transition-colors"
              />

              <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px] text-[var(--text-secondary)]">
                <span className="truncate">
                  Dirección (Redirect URI):{" "}
                  <code className="text-[var(--text-primary)] select-all">{REDIRECT_URI}</code>
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyRedirect()}
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors cursor-pointer"
                >
                  {copied ? (
                    <Check size={12} strokeWidth={1.5} />
                  ) : (
                    <Copy size={12} strokeWidth={1.5} />
                  )}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>

              {/* Non-technical step-by-step guide */}
              <div className="pt-2 border-t border-[var(--border-hairline)]">
                <button
                  type="button"
                  onClick={() => setShowGuide((v) => !v)}
                  aria-expanded={showGuide}
                  className="w-full flex items-center justify-between gap-2 py-1 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <HelpCircle size={13} strokeWidth={1.5} />
                    ¿No tienes uno? Consíguelo gratis en 1 minuto
                  </span>
                  <ChevronDown
                    size={14}
                    strokeWidth={1.5}
                    className={`transition-transform duration-200 ${showGuide ? "rotate-180" : ""}`}
                  />
                </button>

                {showGuide && (
                  <div className="mt-3 space-y-3 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                    <p className="text-[11.5px] text-[var(--text-tertiary)]">
                      Spotify pide que cada persona cree su propia clave gratuita para usar apps
                      externas (requiere cuenta <strong className="text-[var(--text-secondary)]">Spotify Premium</strong>).
                    </p>

                    <ol className="space-y-2.5 list-none">
                      <li className="flex gap-2.5">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-primary)] flex items-center justify-center mt-0.5">
                          1
                        </span>
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <p>
                            Abre la página oficial de Spotify e inicia sesión con tu cuenta normal:
                          </p>
                          <button
                            type="button"
                            onClick={() => void handleOpenDashboard()}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] hover:border-[var(--text-primary)] text-[11.5px] font-medium text-[var(--text-primary)] transition-colors cursor-pointer"
                          >
                            Abrir Spotify Dashboard
                            <ExternalLink size={11} strokeWidth={1.5} />
                          </button>
                        </div>
                      </li>

                      <li className="flex gap-2.5">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-primary)] flex items-center justify-center mt-0.5">
                          2
                        </span>
                        <p className="flex-1 min-w-0">
                          Pulsa el botón <strong className="text-[var(--text-primary)]">Create app</strong>. En{" "}
                          <em>App name</em> y <em>App description</em> escribe cualquier nombre (por
                          ejemplo, <strong className="text-[var(--text-primary)]">SpotiDesk</strong>).
                        </p>
                      </li>

                      <li className="flex gap-2.5">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-primary)] flex items-center justify-center mt-0.5">
                          3
                        </span>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <p>
                            En <strong className="text-[var(--text-primary)]">Redirect URIs</strong>,
                            pega esta dirección exacta y pulsa{" "}
                            <strong className="text-[var(--text-primary)]">Add</strong>:
                          </p>
                          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
                            <code className="text-[11px] text-[var(--text-primary)] truncate select-all">
                              {REDIRECT_URI}
                            </code>
                            <button
                              type="button"
                              onClick={() => void handleCopyRedirect()}
                              className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-primary)] hover:opacity-80 cursor-pointer"
                            >
                              {copied ? (
                                <Check size={11} strokeWidth={1.5} />
                              ) : (
                                <Copy size={11} strokeWidth={1.5} />
                              )}
                              {copied ? "Copiado" : "Copiar"}
                            </button>
                          </div>
                        </div>
                      </li>

                      <li className="flex gap-2.5">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-primary)] flex items-center justify-center mt-0.5">
                          4
                        </span>
                        <p className="flex-1 min-w-0">
                          Más abajo, marca las casillas{" "}
                          <strong className="text-[var(--text-primary)]">Web API</strong> y{" "}
                          <strong className="text-[var(--text-primary)]">Web Playback SDK</strong>,
                          acepta los términos y pulsa{" "}
                          <strong className="text-[var(--text-primary)]">Save</strong>.
                        </p>
                      </li>

                      <li className="flex gap-2.5">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-primary)] flex items-center justify-center mt-0.5">
                          5
                        </span>
                        <p className="flex-1 min-w-0">
                          Entra en <strong className="text-[var(--text-primary)]">Settings</strong>{" "}
                          (arriba a la derecha), copia el código donde dice{" "}
                          <strong className="text-[var(--text-primary)]">Client ID</strong>, pégalo
                          arriba y pulsa <strong className="text-[var(--text-primary)]">Conectar con Spotify</strong>.
                        </p>
                      </li>
                    </ol>

                    <p className="text-[11px] text-[var(--text-tertiary)] pt-1 border-t border-[var(--border-hairline)]">
                      No necesitas el «Client Secret». Si quieres compartir tu clave con familia o
                      amigos (hasta 5 personas), añade sus correos en{" "}
                      <strong className="text-[var(--text-secondary)]">Settings → User Management</strong>.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isAuthenticating}
            className="chrome-no-select w-full h-11 px-6 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] disabled:opacity-60 font-medium text-[14px] tracking-[-0.01em] inline-flex items-center justify-center gap-2 transition-all duration-200 ease-apple active:scale-[0.985] cursor-pointer"
          >
            {isAuthenticating ? (
              <>
                <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
                Esperando autorización en el navegador...
              </>
            ) : (
              <>
                Conectar con Spotify
                <ArrowRight size={15} strokeWidth={1.5} />
              </>
            )}
          </button>

          {!showConfig && (
            <button
              type="button"
              onClick={() => setShowConfig(true)}
              className="text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              Cambiar Client ID
            </button>
          )}
        </form>

        {error && (
          <div
            role="alert"
            className="mt-5 w-full px-4 py-3 rounded-xl text-[12px] leading-relaxed text-left bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)]"
          >
            {error}
          </div>
        )}

        <p className="mt-7 text-[11px] text-[var(--text-tertiary)]">
          Conexión segura directa con Spotify · Requiere Spotify Premium
        </p>
      </div>
    </main>
  );
}
