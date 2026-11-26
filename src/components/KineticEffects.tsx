interface PlayWaterDropEffectProps {
  triggerKey: number;
  size?: "sm" | "lg";
}

/**
 * Renders a crisp monochrome liquid droplet + 3 concentric water ripples radiating out on Play.
 */
export function PlayWaterDropEffect({
  triggerKey,
  size = "sm",
}: PlayWaterDropEffectProps) {
  if (triggerKey <= 0) return null;

  const dropSize = size === "lg" ? "w-2.5 h-3.5" : "w-2 h-2.5";

  return (
    <span
      key={triggerKey}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-visible"
    >
      {/* Falling liquid droplet */}
      <span
        className={`anim-water-drop absolute left-1/2 top-1/2 ${dropSize} rounded-[50%_50%_50%_50%/60%_60%_40%_40%] bg-[var(--solid-bg)]`}
      />
      {/* Concentric water wave rings */}
      <span className="anim-water-ripple-1 absolute inset-0 rounded-full border border-[var(--solid-bg)]/80" />
      <span className="anim-water-ripple-2 absolute inset-0 rounded-full border border-[var(--solid-bg)]/55" />
      <span className="anim-water-ripple-3 absolute inset-0 rounded-full border border-[var(--solid-bg)]/30" />
    </span>
  );
}

/**
 * Renders a sharp inward contracting shockwave ring when playback pauses/stops.
 */
export function StopShockEffect({ triggerKey }: { triggerKey: number }) {
  if (triggerKey <= 0) return null;

  return (
    <span
      key={triggerKey}
      aria-hidden="true"
      className="anim-stop-contract pointer-events-none absolute inset-0 rounded-full border border-[var(--text-secondary)]/70"
    />
  );
}
