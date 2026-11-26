import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";

interface CreatePlaylistModalProps {
  onCreate: (params: {
    name: string;
    description: string;
    isPublic: boolean;
  }) => Promise<void>;
  onClose: () => void;
}

export function CreatePlaylistModal({ onCreate, onClose }: CreatePlaylistModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await onCreate({ name: trimmed, description, isPublic });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la playlist.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Nueva playlist"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="anim-stage-backdrop fixed inset-0 top-10 z-50 bg-black/55 backdrop-blur-md flex items-center justify-center p-6"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="anim-context-menu popover-glass w-full max-w-[420px] rounded-2xl border border-[var(--border-subtle)] overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-[var(--border-hairline)] flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
            Nueva playlist
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            <X size={15} strokeWidth={1.6} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="playlist-name"
              className="text-[12px] font-medium text-[var(--text-secondary)]"
            >
              Nombre
            </label>
            <input
              ref={inputRef}
              id="playlist-name"
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Noche de estudio"
              className="w-full h-10 px-3.5 rounded-xl text-[13.5px] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--text-primary)] transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="playlist-desc"
              className="text-[12px] font-medium text-[var(--text-secondary)]"
            >
              Descripción (opcional)
            </label>
            <textarea
              id="playlist-desc"
              rows={2}
              maxLength={300}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Añade una breve nota..."
              className="w-full p-3 rounded-xl text-[13px] resize-vertical bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--text-primary)] transition-colors"
            />
          </div>

          <div className="px-3.5 py-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-elevated)]/70 flex items-center justify-between">
            <div>
              <div className="text-[13px] font-medium text-[var(--text-primary)]">
                Playlist pública
              </div>
              <div className="text-[11.5px] text-[var(--text-secondary)]">
                {isPublic ? "Visible en tu perfil de Spotify" : "Solo visible para ti"}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isPublic}
              onClick={() => setIsPublic((v) => !v)}
              className={`relative w-10 h-6 rounded-full transition-colors duration-250 ease-apple cursor-pointer shrink-0 ${
                isPublic ? "bg-[var(--solid-bg)]" : "bg-[var(--slider-track)]"
              }`}
            >
              <span
                className="block w-4 h-4 rounded-full transition-transform duration-250 ease-apple"
                style={{
                  backgroundColor: isPublic ? "var(--solid-fg)" : "var(--text-primary)",
                  transform: isPublic ? "translateX(20px)" : "translateX(4px)",
                }}
              />
            </button>
          </div>

          {error && <p className="text-[12px] text-[var(--text-secondary)]">{error}</p>}
        </div>

        <div className="px-6 py-3.5 border-t border-[var(--border-hairline)] flex items-center justify-end gap-2.5 bg-[var(--bg-elevated)]/40">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-full text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!name.trim() || isSubmitting}
            className="h-9 px-5 rounded-full bg-[var(--solid-bg)] text-[var(--solid-fg)] hover:bg-[var(--solid-hover)] disabled:opacity-40 text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
          >
            {isSubmitting ? (
              <Loader2 size={14} strokeWidth={1.6} className="animate-spin" />
            ) : (
              <Plus size={14} strokeWidth={1.8} />
            )}
            Crear playlist
          </button>
        </div>
      </form>
    </div>
  );
}
