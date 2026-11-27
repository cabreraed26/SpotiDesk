import { useCallback, useEffect, useRef, useState } from "react";
import { ambientAudio } from "../lib/ambientAudio";

export type PomodoroPhase = "idle" | "focus" | "break";

export interface PomodoroPreset {
  id: string;
  label: string;
  focusMin: number;
  breakMin: number;
}

export const POMODORO_PRESETS: PomodoroPreset[] = [
  { id: "classic", label: "25 / 5 min · Clásico", focusMin: 25, breakMin: 5 },
  { id: "deep", label: "50 / 10 min · Profundo", focusMin: 50, breakMin: 10 },
  { id: "sprint", label: "15 / 3 min · Sprint", focusMin: 15, breakMin: 3 },
];

export interface PomodoroState {
  phase: PomodoroPhase;
  remainingMs: number;
  totalMs: number;
  label: string | null;
  completedBlocks: number;
  startFocus: (focusMin: number, breakMin: number) => void;
  stop: () => void;
}

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function usePomodoro(options: {
  onFocusComplete: () => void;
  onBreakComplete: () => void;
}): PomodoroState {
  const [phase, setPhase] = useState<PomodoroPhase>("idle");
  const [endsAtMs, setEndsAtMs] = useState<number | null>(null);
  const [totalMs, setTotalMs] = useState(0);
  const [remainingMs, setRemainingMs] = useState(0);
  const [breakDurationMs, setBreakDurationMs] = useState(5 * 60_000);
  const [completedBlocks, setCompletedBlocks] = useState(0);

  const onFocusCompleteRef = useRef(options.onFocusComplete);
  onFocusCompleteRef.current = options.onFocusComplete;
  const onBreakCompleteRef = useRef(options.onBreakComplete);
  onBreakCompleteRef.current = options.onBreakComplete;

  const startFocus = useCallback((focusMin: number, breakMin: number) => {
    const focusMs = Math.max(1, focusMin) * 60_000;
    const brkMs = Math.max(1, breakMin) * 60_000;
    setPhase("focus");
    setTotalMs(focusMs);
    setBreakDurationMs(brkMs);
    setEndsAtMs(Date.now() + focusMs);
    setRemainingMs(focusMs);
  }, []);

  const stop = useCallback(() => {
    setPhase("idle");
    setEndsAtMs(null);
    setTotalMs(0);
    setRemainingMs(0);
  }, []);

  useEffect(() => {
    if (phase === "idle" || !endsAtMs) return;

    const tick = () => {
      const left = endsAtMs - Date.now();
      if (left <= 0) {
        ambientAudio.playZenChime();
        if (phase === "focus") {
          setCompletedBlocks((c) => c + 1);
          setPhase("break");
          setTotalMs(breakDurationMs);
          setEndsAtMs(Date.now() + breakDurationMs);
          setRemainingMs(breakDurationMs);
          onFocusCompleteRef.current();
        } else {
          setPhase("idle");
          setEndsAtMs(null);
          setTotalMs(0);
          setRemainingMs(0);
          onBreakCompleteRef.current();
        }
      } else {
        setRemainingMs(left);
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase, endsAtMs, breakDurationMs]);

  return {
    phase,
    remainingMs,
    totalMs,
    label: phase !== "idle" ? formatClock(remainingMs) : null,
    completedBlocks,
    startFocus,
    stop,
  };
}
