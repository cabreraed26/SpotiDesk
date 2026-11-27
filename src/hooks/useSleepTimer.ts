import { useCallback, useEffect, useRef, useState } from "react";

export type SleepTimerMode = "off" | "countdown" | "end_of_track";

export interface SleepTimerState {
  mode: SleepTimerMode;
  remainingMs: number;
  label: string | null;
  setMinutes: (minutes: number) => void;
  setEndOfTrack: () => void;
  cancel: () => void;
}

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function useSleepTimer(options: {
  currentTrackUri?: string;
  isPlaying: boolean;
  onExpire: () => void;
}): SleepTimerState {
  const { currentTrackUri, isPlaying, onExpire } = options;
  const [mode, setMode] = useState<SleepTimerMode>("off");
  const [endsAtMs, setEndsAtMs] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);

  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const watchedUriRef = useRef<string | undefined>(undefined);

  const cancel = useCallback(() => {
    setMode("off");
    setEndsAtMs(null);
    setRemainingMs(0);
    watchedUriRef.current = undefined;
  }, []);

  const setMinutes = useCallback((minutes: number) => {
    const durationMs = Math.max(1, minutes) * 60_000;
    setMode("countdown");
    setEndsAtMs(Date.now() + durationMs);
    setRemainingMs(durationMs);
    watchedUriRef.current = undefined;
  }, []);

  const setEndOfTrack = useCallback(() => {
    setMode("end_of_track");
    setEndsAtMs(null);
    setRemainingMs(0);
    watchedUriRef.current = currentTrackUri;
  }, [currentTrackUri]);

  // Countdown tick
  useEffect(() => {
    if (mode !== "countdown" || !endsAtMs) return;

    const tick = () => {
      const left = endsAtMs - Date.now();
      if (left <= 0) {
        setMode("off");
        setEndsAtMs(null);
        setRemainingMs(0);
        onExpireRef.current();
      } else {
        setRemainingMs(left);
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [mode, endsAtMs]);

  // Trigger pause as soon as the tracked song finishes and advances to the next track
  useEffect(() => {
    if (mode !== "end_of_track") return;
    if (!watchedUriRef.current && currentTrackUri) {
      watchedUriRef.current = currentTrackUri;
      return;
    }
    if (
      watchedUriRef.current &&
      currentTrackUri &&
      currentTrackUri !== watchedUriRef.current
    ) {
      setMode("off");
      watchedUriRef.current = undefined;
      if (isPlaying) {
        onExpireRef.current();
      }
    }
  }, [mode, currentTrackUri, isPlaying]);

  const label =
    mode === "countdown"
      ? formatRemaining(remainingMs)
      : mode === "end_of_track"
        ? "Fin"
        : null;

  return {
    mode,
    remainingMs,
    label,
    setMinutes,
    setEndOfTrack,
    cancel,
  };
}
