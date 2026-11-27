import { useEffect, useRef, useState } from "react";

export interface SwipeEdgeIndicator {
  dir: "back" | "forward";
  /** 0..1 visual pull progress */
  progress: number;
}

function hasHorizontalScrollableAncestor(el: HTMLElement | null): boolean {
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.body) {
    const style = window.getComputedStyle(cur);
    const overflowX = style.overflowX;
    if (
      (overflowX === "auto" || overflowX === "scroll") &&
      cur.scrollWidth > cur.clientWidth + 4
    ) {
      return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

/**
 * Native-feeling macOS 2-finger horizontal trackpad swipe gesture for Back / Forward
 * with elastic edge visual feedback and momentum-inertia lock to avoid double triggers.
 */
export function useTrackpadSwipeNav(options: {
  enabled: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
}): SwipeEdgeIndicator | null {
  const { enabled, canGoBack, canGoForward, onGoBack, onGoForward } = options;
  const [indicator, setIndicator] = useState<SwipeEdgeIndicator | null>(null);

  const accumRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);
  const cooldownUntilRef = useRef(0);

  const cbRef = useRef({ canGoBack, canGoForward, onGoBack, onGoForward });
  cbRef.current = { canGoBack, canGoForward, onGoBack, onGoForward };

  useEffect(() => {
    if (!enabled) {
      setIndicator(null);
      return;
    }

    const THRESHOLD = 115;

    const clearIndicatorSoon = () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => {
        accumRef.current = 0;
        setIndicator(null);
      }, 170);
    };

    const handleWheel = (e: WheelEvent) => {
      const now = performance.now();
      if (now < cooldownUntilRef.current) return;

      // Only respond to clear horizontal 2-finger swipes (ignore vertical scrolling & pinch zoom)
      if (e.ctrlKey || Math.abs(e.deltaX) < 4 || Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.45) {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (hasHorizontalScrollableAncestor(target)) return;

      // On macOS trackpad: swiping fingers RIGHT produces negative deltaX -> Go Back
      // Swiping fingers LEFT produces positive deltaX -> Go Forward
      accumRef.current += e.deltaX;
      const dir: "back" | "forward" = accumRef.current < 0 ? "back" : "forward";

      const allowed = dir === "back" ? cbRef.current.canGoBack : cbRef.current.canGoForward;
      if (!allowed) {
        accumRef.current = 0;
        setIndicator(null);
        return;
      }

      const progress = Math.min(1, Math.abs(accumRef.current) / THRESHOLD);
      setIndicator({ dir, progress });
      clearIndicatorSoon();

      if (progress >= 1) {
        cooldownUntilRef.current = now + 620;
        accumRef.current = 0;
        if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
        setIndicator(null);
        if (dir === "back") cbRef.current.onGoBack();
        else cbRef.current.onGoForward();
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      window.removeEventListener("wheel", handleWheel);
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    };
  }, [enabled]);

  return indicator;
}
