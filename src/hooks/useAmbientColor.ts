import { useEffect, useState } from "react";

/**
 * Extracts a very subtle muted RGB tone from the current cover art using a tiny 8x8 canvas.
 * Falls back cleanly to null if disabled or if cross-origin image pixels are unavailable.
 */
export function useAmbientColor(imageUrl: string | undefined, enabled: boolean): string | null {
  const [rgb, setRgb] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !imageUrl) {
      setRgb(null);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";

    img.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 8;
        canvas.height = 8;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;

        ctx.drawImage(img, 0, 0, 8, 8);
        const { data } = ctx.getImageData(0, 0, 8, 8);
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;

        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i];
          const pg = data[i + 1];
          const pb = data[i + 2];
          // Skip near-black / near-white pixels for a richer subtle tint
          const luma = 0.299 * pr + 0.587 * pg + 0.114 * pb;
          if (luma > 24 && luma < 235) {
            r += pr;
            g += pg;
            b += pb;
            count++;
          }
        }

        if (count === 0) {
          setRgb(null);
          return;
        }
        setRgb(`${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)}`);
      } catch {
        setRgb(null);
      }
    };

    img.onerror = () => {
      if (!cancelled) setRgb(null);
    };

    img.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl, enabled]);

  return rgb;
}
