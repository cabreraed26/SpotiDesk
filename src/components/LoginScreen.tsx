import { useState } from "react";
import { ArrowRight, Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { SpotiDeskLogo } from "./SpotiDeskLogo";

interface LoginScreenProps {
  clientId: string;
  isAuthenticating: boolean;
  error: string | null;
  onLogin: (overrideClientId?: string) => void;
}

const REDIRECT_URI = "http://127.0.0.1:8888/callback";

export function LoginScreen({
  clientId,
  isAuthenticating,
  error,
  onLogin,
}: LoginScreenProps) {
  const [inputClientId, setInputClientId] = useState(clientId);
  const [showConfig, setShowConfig] = useState(!clientId);
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

  return (
    <main className="flex-1 flex items-center justify-center p-8 bg-[var(--bg-primary)] relative overflow-hidden">
      {/* Ultra-subtle radial architectural spotlight */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(620px circle at 50% 35%, rgba(134, 134, 139, 0.08), transparent 70%)",
        }}
      />

      <div className="relative z-10 w-full max-w-[400px] flex flex-col items-center text-center">
        {/* Monochrome SpotiDesk emblem */}
        <div className="w-16 h-16 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] flex items-center justify-center mb-8 shadow-lg">
          <SpotiDeskLogo size={34} className="text-[var(--text-primary)]" />
        </div>

        <h1 className="text-[34px] font-semibold tracking-[-0.035em] leading-tight text-[var(--text-primary)]">
          SpotiDesk
        </h1>

        <p className="mt-3 text-[14px] leading-relaxed text-[var(--text-secondary)] max-w-[320px]">
          Tu música en un cliente nativo ultraligero, silencioso y sin distracciones.
        </p>

        <form onSubmit={handleSubmit} className="w-full mt-9 space-y-4">
          {showConfig && (
            <div className="text-left p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] space-y-3">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="spotify-client-id"
                  className="text-[12px] font-medium text-[var(--text-primary)] flex items-center gap-1.5"
                >
                  <KeyRound size={13} strokeWidth={1.5} />
                  Spotify Client ID (PKCE)
                </label>
                <span className="text-[11px] text-[var(--text-tertiary)]">
                  .env opcional
                </span>
              </div>

              <input
                id="spotify-client-id"
                type="text"
                value={inputClientId}
                onChange={(e) => setInputClientId(e.target.value)}
                placeholder="Pega tu VITE_SPOTIFY_CLIENT_ID"
                autoComplete="off"
                spellCheck={false}
                className="w-full h-9 px-3 rounded-lg text-[13px] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--text-primary)] transition-colors"
              />

              <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px] text-[var(--text-secondary)]">
                <span className="truncate">
                  Redirect URI: <code className="text-[var(--text-primary)]">{REDIRECT_URI}</code>
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyRedirect()}
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors"
                >
                  {copied ? <Check size={12} strokeWidth={1.5} /> : <Copy size={12} strokeWidth={1.5} />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
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

        <p className="mt-8 text-[11px] text-[var(--text-tertiary)]">
          Autenticación OAuth 2.0 PKCE local · Requiere Spotify Premium para reproducción directa
        </p>
      </div>
    </main>
  );
}
