import type { ThemeMode } from "../hooks/useTheme";
import type { UnifiedTrack } from "../types/spotify";

const LYRIC_OFFSETS_KEY = "spotidesk.lyric_offsets_v1";
const MAX_OFFSET_ENTRIES = 120;

function readOffsetMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LYRIC_OFFSETS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getLyricOffsetMs(trackUri?: string): number {
  if (!trackUri) return 0;
  const map = readOffsetMap();
  const val = map[trackUri];
  return typeof val === "number" && Number.isFinite(val) ? val : 0;
}

export function setLyricOffsetMs(trackUri: string, offsetMs: number): number {
  const clamped = Math.max(-5000, Math.min(5000, Math.round(offsetMs)));
  const map = readOffsetMap();
  if (clamped === 0) {
    delete map[trackUri];
  } else {
    map[trackUri] = clamped;
    const keys = Object.keys(map);
    if (keys.length > MAX_OFFSET_ENTRIES) {
      delete map[keys[0]];
    }
  }
  try {
    localStorage.setItem(LYRIC_OFFSETS_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota
  }
  window.dispatchEvent(
    new CustomEvent("spotidesk:lyric-offset-changed", {
      detail: { trackUri, offsetMs: clamped },
    })
  );
  return clamped;
}

function loadCorsImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

/**
 * Generates an Apple Music-inspired high-DPI PNG card for 1–4 selected lyric verses.
 */
export async function renderLyricCardBlob(params: {
  track: UnifiedTrack;
  verses: string[];
  theme: ThemeMode;
  ambientRgb: string | null;
}): Promise<Blob | null> {
  const { track, verses, theme, ambientRgb } = params;
  const width = 1080;
  const paddingX = 92;
  const maxTextWidth = width - paddingX * 2;
  const isDark = theme === "dark";

  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d");
  if (!mctx) return null;

  mctx.font =
    '600 50px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif';
  const wrappedGroups = verses.slice(0, 4).map((v) => wrapText(mctx, v, maxTextWidth));
  const totalLines = wrappedGroups.reduce((acc, g) => acc + g.length, 0);
  const lineHeight = 68;
  const groupGap = 28;
  const textBlockHeight =
    totalLines * lineHeight + Math.max(0, wrappedGroups.length - 1) * groupGap;

  const height = Math.max(820, Math.min(1440, 390 + textBlockHeight + 170));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Base surface
  ctx.fillStyle = isDark ? "#08080A" : "#F7F7F9";
  ctx.fillRect(0, 0, width, height);

  // Ambient radial glow from album artwork
  const rgb = ambientRgb || (isDark ? "134, 134, 139" : "160, 160, 168");
  const grad = ctx.createRadialGradient(
    width * 0.28,
    height * 0.18,
    40,
    width * 0.45,
    height * 0.4,
    width * 0.95
  );
  grad.addColorStop(0, `rgba(${rgb}, ${isDark ? 0.34 : 0.22})`);
  grad.addColorStop(0.55, `rgba(${rgb}, ${isDark ? 0.1 : 0.06})`);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Subtle card frame
  drawRoundedRect(ctx, 28, 28, width - 56, height - 56, 44);
  ctx.strokeStyle = isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.08)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Header: Album art + track info
  const coverSize = 136;
  const coverX = paddingX;
  const coverY = 96;
  const coverUrl = track.albumImageLarge || track.albumImage;
  const coverImg = coverUrl ? await loadCorsImage(coverUrl) : null;

  ctx.save();
  ctx.shadowColor = isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.16)";
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 14;
  drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, 24);
  ctx.fillStyle = isDark ? "#18181C" : "#E5E5EA";
  ctx.fill();
  ctx.restore();

  if (coverImg) {
    ctx.save();
    drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, 24);
    ctx.clip();
    ctx.drawImage(coverImg, coverX, coverY, coverSize, coverSize);
    ctx.restore();
  }

  const metaX = coverX + coverSize + 34;
  const metaMaxW = width - metaX - paddingX;
  ctx.fillStyle = isDark ? "#F5F5F7" : "#111114";
  ctx.font =
    '600 34px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif';
  let titleText = track.name;
  while (titleText.length > 3 && ctx.measureText(titleText).width > metaMaxW) {
    titleText = `${titleText.slice(0, -2)}…`;
  }
  ctx.fillText(titleText, metaX, coverY + 58);

  ctx.fillStyle = isDark ? "rgba(245,245,247,0.62)" : "rgba(17,17,20,0.62)";
  ctx.font =
    '500 26px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';
  let artistText = track.artists;
  while (artistText.length > 3 && ctx.measureText(artistText).width > metaMaxW) {
    artistText = `${artistText.slice(0, -2)}…`;
  }
  ctx.fillText(artistText, metaX, coverY + 102);

  // Verses
  ctx.fillStyle = isDark ? "#FFFFFF" : "#111114";
  ctx.font =
    '600 50px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif';
  let y = coverY + coverSize + 116;
  for (const lines of wrappedGroups) {
    for (const line of lines) {
      ctx.fillText(line, paddingX, y);
      y += lineHeight;
    }
    y += groupGap;
  }

  // Footer signature
  ctx.fillStyle = isDark ? "rgba(245,245,247,0.38)" : "rgba(17,17,20,0.4)";
  ctx.font =
    '600 22px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';
  ctx.fillText("SpotiDesk", paddingX, height - 74);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}
