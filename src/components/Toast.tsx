import { Check, Info } from "lucide-react";

export interface ToastMessage {
  id: number;
  text: string;
  tone?: "default" | "warning";
}

export function Toast({ toast }: { toast: ToastMessage | null }) {
  if (!toast) return null;

  return (
    <div
      key={toast.id}
      role="status"
      aria-live="polite"
      className="anim-toast-in pointer-events-none fixed top-14 left-1/2 z-[70] max-w-[min(560px,90vw)] px-4 py-2.5 rounded-2xl popover-glass border border-[var(--border-subtle)] flex items-center gap-2.5 text-[12.5px] leading-snug font-medium text-[var(--text-primary)] shadow-2xl"
    >
      {toast.tone === "warning" ? (
        <Info size={14} strokeWidth={1.7} className="shrink-0 text-[var(--text-secondary)]" />
      ) : (
        <Check size={14} strokeWidth={1.8} className="shrink-0 text-[var(--text-primary)]" />
      )}
      <span>{toast.text}</span>
    </div>
  );
}
