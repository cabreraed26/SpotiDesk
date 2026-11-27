import type { ThemeMode } from "../hooks/useTheme";
import type { WeeklyStatsSummary } from "./listeningStats";

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

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let out = text;
  while (out.length > 2 && ctx.measureText(`${out}…`).width > maxW) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function formatDurationShort(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Renders a high-DPI 1080×1350 minimalist monochrome Weekly Stats Poster PNG
 * matching SpotiDesk's Obsidian / Porcelain design language.
 */
export async function renderWeeklyStatsPosterBlob(params: {
  stats: WeeklyStatsSummary;
  userName?: string | null;
  theme: ThemeMode;
  ambientRgb?: string | null;
}): Promise<Blob | null> {
  const { stats, userName, theme, ambientRgb } = params;
  const width = 1080;
  const height = 1350;
  const pad = 76;
  const isDark = theme === "dark";

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const fontSans =
    '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif';

  // Background
  ctx.fillStyle = isDark ? "#08080A" : "#F7F7F9";
  ctx.fillRect(0, 0, width, height);

  // Subtle ambient glow
  const rgb = ambientRgb || (isDark ? "134, 134, 139" : "150, 150, 158");
  const grad = ctx.createRadialGradient(
    width * 0.78,
    height * 0.14,
    30,
    width * 0.55,
    height * 0.25,
    width * 0.85
  );
  grad.addColorStop(0, `rgba(${rgb}, ${isDark ? 0.28 : 0.18})`);
  grad.addColorStop(0.6, `rgba(${rgb}, ${isDark ? 0.07 : 0.04})`);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Outer card frame
  drawRoundedRect(ctx, 28, 28, width - 56, height - 56, 44);
  ctx.strokeStyle = isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.08)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const fg = isDark ? "#F5F5F7" : "#111114";
  const fgMuted = isDark ? "rgba(245,245,247,0.58)" : "rgba(17,17,20,0.58)";
  const fgSoft = isDark ? "rgba(245,245,247,0.34)" : "rgba(17,17,20,0.38)";
  const cardBg = isDark ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.035)";
  const cardBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";

  // Header
  ctx.fillStyle = fgSoft;
  ctx.font = `600 20px ${fontSans}`;
  ctx.fillText("TU SEMANA EN SPOTIDESK", pad, 114);

  ctx.fillStyle = fg;
  ctx.font = `700 54px ${fontSans}`;
  const headline = userName ? `Resumen de ${userName}` : "Resumen Musical";
  ctx.fillText(fitText(ctx, headline, width - pad * 2), pad, 178);

  const dateLabel = new Date().toLocaleDateString("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  ctx.fillStyle = fgMuted;
  ctx.font = `500 22px ${fontSans}`;
  ctx.fillText(`Últimos 7 días · ${dateLabel}`, pad, 218);

  // 3 KPI Metric Cards
  const cardGap = 22;
  const cardW = (width - pad * 2 - cardGap * 2) / 3;
  const cardY = 258;
  const cardH = 148;
  const metrics = [
    { label: "ESCUCHADO", value: formatDurationShort(stats.totalMinutes7d) },
    { label: "REPRODUCCIONES", value: `${stats.totalPlays7d}` },
    {
      label: "RACHA ACTIVA",
      value: `${stats.streakDays} ${stats.streakDays === 1 ? "día" : "días"}`,
    },
  ];

  metrics.forEach((m, i) => {
    const x = pad + i * (cardW + cardGap);
    drawRoundedRect(ctx, x, cardY, cardW, cardH, 24);
    ctx.fillStyle = cardBg;
    ctx.fill();
    ctx.strokeStyle = cardBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = fgSoft;
    ctx.font = `600 17px ${fontSans}`;
    ctx.fillText(m.label, x + 26, cardY + 46);

    ctx.fillStyle = fg;
    ctx.font = `700 44px ${fontSans}`;
    ctx.fillText(fitText(ctx, m.value, cardW - 52), x + 26, cardY + 108);
  });

  // 7-Day Activity Chart Card
  const chartY = cardY + cardH + 28;
  const chartH = 230;
  drawRoundedRect(ctx, pad, chartY, width - pad * 2, chartH, 26);
  ctx.fillStyle = cardBg;
  ctx.fill();
  ctx.strokeStyle = cardBorder;
  ctx.stroke();

  ctx.fillStyle = fgSoft;
  ctx.font = `600 17px ${fontSans}`;
  ctx.fillText("ACTIVIDAD DIARIA (MIN)", pad + 28, chartY + 42);

  const maxMin = Math.max(1, ...stats.days.map((d) => d.minutes));
  const barsTop = chartY + 72;
  const barsBottom = chartY + chartH - 46;
  const maxBarH = barsBottom - barsTop;
  const innerW = width - pad * 2 - 56;
  const colW = innerW / 7;
  const barW = 48;

  stats.days.forEach((d, idx) => {
    const cx = pad + 28 + colW * idx + colW / 2;
    const isToday = idx === stats.days.length - 1;
    const h = d.minutes > 0 ? Math.max(16, (d.minutes / maxMin) * maxBarH) : 8;
    const bx = cx - barW / 2;
    const by = barsBottom - h;

    drawRoundedRect(ctx, bx, by, barW, h, 10);
    ctx.fillStyle = isToday
      ? fg
      : d.minutes > 0
        ? isDark
          ? "rgba(245,245,247,0.38)"
          : "rgba(17,17,20,0.34)"
        : isDark
          ? "rgba(255,255,255,0.08)"
          : "rgba(0,0,0,0.08)";
    ctx.fill();

    ctx.textAlign = "center";
    if (d.minutes > 0) {
      ctx.fillStyle = fgMuted;
      ctx.font = `600 17px ${fontSans}`;
      ctx.fillText(`${d.minutes}`, cx, by - 10);
    }
    ctx.fillStyle = isToday ? fg : fgSoft;
    ctx.font = `${isToday ? "700" : "500"} 18px ${fontSans}`;
    ctx.fillText(d.label, cx, barsBottom + 28);
    ctx.textAlign = "left";
  });

  // Two-column Bottom: Top Artists + Top Tracks
  const listY = chartY + chartH + 34;
  const colGap = 28;
  const halfW = (width - pad * 2 - colGap) / 2;
  const listH = 490;

  // Left: Top Artists
  drawRoundedRect(ctx, pad, listY, halfW, listH, 26);
  ctx.fillStyle = cardBg;
  ctx.fill();
  ctx.strokeStyle = cardBorder;
  ctx.stroke();

  ctx.fillStyle = fgSoft;
  ctx.font = `600 17px ${fontSans}`;
  ctx.fillText("TOP ARTISTAS", pad + 28, listY + 44);

  const artists = stats.topArtists.slice(0, 5);
  artists.forEach((a, idx) => {
    const ry = listY + 104 + idx * 74;
    ctx.fillStyle = fgSoft;
    ctx.font = `600 22px ${fontSans}`;
    ctx.fillText(`${idx + 1}`, pad + 28, ry);

    ctx.fillStyle = fg;
    ctx.font = `600 24px ${fontSans}`;
    ctx.fillText(fitText(ctx, a.name, halfW - 140), pad + 64, ry);

    ctx.textAlign = "right";
    ctx.fillStyle = fgMuted;
    ctx.font = `500 20px ${fontSans}`;
    ctx.fillText(`${a.plays}×`, pad + halfW - 28, ry);
    ctx.textAlign = "left";
  });

  // Right: Top Tracks
  const rightX = pad + halfW + colGap;
  drawRoundedRect(ctx, rightX, listY, halfW, listH, 26);
  ctx.fillStyle = cardBg;
  ctx.fill();
  ctx.strokeStyle = cardBorder;
  ctx.stroke();

  ctx.fillStyle = fgSoft;
  ctx.font = `600 17px ${fontSans}`;
  ctx.fillText("TOP CANCIONES", rightX + 28, listY + 44);

  const tracks = stats.topTracks.slice(0, 5);
  tracks.forEach(({ track, plays }, idx) => {
    const ry = listY + 96 + idx * 76;
    ctx.fillStyle = fg;
    ctx.font = `600 22px ${fontSans}`;
    ctx.fillText(fitText(ctx, track.name, halfW - 108), rightX + 28, ry);

    ctx.fillStyle = fgMuted;
    ctx.font = `400 18px ${fontSans}`;
    ctx.fillText(fitText(ctx, track.artists, halfW - 108), rightX + 28, ry + 26);

    ctx.textAlign = "right";
    ctx.fillStyle = fgSoft;
    ctx.font = `500 19px ${fontSans}`;
    ctx.fillText(`${plays}×`, rightX + halfW - 28, ry + 6);
    ctx.textAlign = "left";
  });

  // Signature Footer
  ctx.fillStyle = fgSoft;
  ctx.font = `600 21px ${fontSans}`;
  ctx.fillText("SpotiDesk", pad, height - 64);

  ctx.textAlign = "right";
  ctx.font = `500 19px ${fontSans}`;
  ctx.fillText("100% local · privado", width - pad, height - 64);
  ctx.textAlign = "left";

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}
