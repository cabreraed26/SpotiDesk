export interface AppShortcutsConfig {
  /** OS-wide global shortcut that pops up ONLY the floating Spotlight palette */
  globalSpotlight: string;
  /** Open Command Palette inside the app */
  openPalette: string;
  /** Jump to Search view */
  openSearch: string;
  /** Open instant filter inside a playlist / album / liked list */
  filterPlaylist: string;
  /** Toggle Play / Pause */
  togglePlay: string;
  /** Toggle Full-Screen Stage / Lyrics */
  toggleStage: string;
  /** Toggle Like on current track */
  toggleLike: string;
  /** Mute / Unmute */
  toggleMute: string;
  /** Navigate Back */
  navBack: string;
  /** Navigate Forward */
  navForward: string;
}

export type ShortcutField = keyof AppShortcutsConfig;

const SHORTCUTS_V2_KEY = "spotidesk.shortcuts_v2";
const SHORTCUTS_V1_KEY = "spotidesk.shortcuts_v1";

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(navigator.platform || navigator.userAgent);
}

export function getDefaultShortcuts(isMac = isMacPlatform()): AppShortcutsConfig {
  return {
    globalSpotlight: "Alt+Shift+Space",
    openPalette: "Mod+K",
    openSearch: "Mod+L",
    filterPlaylist: "Mod+F",
    togglePlay: "Space",
    toggleStage: "F",
    toggleLike: "L",
    toggleMute: "M",
    navBack: isMac ? "Mod+ArrowLeft" : "Alt+ArrowLeft",
    navForward: isMac ? "Mod+ArrowRight" : "Alt+ArrowRight",
  };
}

export const DEFAULT_SHORTCUTS: AppShortcutsConfig = getDefaultShortcuts();

const MODIFIER_NAMES = new Set(["mod", "cmd", "meta", "ctrl", "control", "alt", "option", "shift"]);

function normalizeKeyToken(raw: string): string {
  const t = raw.trim();
  const lower = t.toLowerCase();
  if (lower === " " || lower === "space" || lower === "spacebar") return "Space";
  if (lower === "arrowleft" || lower === "left") return "ArrowLeft";
  if (lower === "arrowright" || lower === "right") return "ArrowRight";
  if (lower === "arrowup" || lower === "up") return "ArrowUp";
  if (lower === "arrowdown" || lower === "down") return "ArrowDown";
  if (t.length === 1 && /^[a-z0-9[\]\\;',./`-]$/i.test(t)) return t.toUpperCase();
  if (/^f([1-9]|1[0-2])$/i.test(t)) return t.toUpperCase();
  return "";
}

export function sanitizeCombo(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const tokens = raw
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
  if (tokens.length === 0) return fallback;

  let hasMod = false;
  let hasCtrl = false;
  let hasAlt = false;
  let hasShift = false;
  let mainKey = "";

  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (low === "mod" || low === "cmdorctrl" || low === "cmd" || low === "meta") {
      hasMod = true;
    } else if (low === "ctrl" || low === "control") {
      hasCtrl = true;
    } else if (low === "alt" || low === "option") {
      hasAlt = true;
    } else if (low === "shift") {
      hasShift = true;
    } else {
      mainKey = normalizeKeyToken(tok);
    }
  }

  if (!mainKey) return fallback;

  const out: string[] = [];
  if (hasMod) out.push("Mod");
  if (hasCtrl) out.push("Ctrl");
  if (hasAlt) out.push("Alt");
  if (hasShift) out.push("Shift");
  out.push(mainKey);
  return out.join("+");
}

export function loadShortcutsConfig(): AppShortcutsConfig {
  const defaults = getDefaultShortcuts();
  try {
    const rawV2 = localStorage.getItem(SHORTCUTS_V2_KEY);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as Partial<AppShortcutsConfig>;
      return {
        globalSpotlight: sanitizeCombo(parsed.globalSpotlight, defaults.globalSpotlight),
        openPalette: sanitizeCombo(parsed.openPalette, defaults.openPalette),
        openSearch: sanitizeCombo(parsed.openSearch, defaults.openSearch),
        filterPlaylist: sanitizeCombo(parsed.filterPlaylist, defaults.filterPlaylist),
        togglePlay: sanitizeCombo(parsed.togglePlay, defaults.togglePlay),
        toggleStage: sanitizeCombo(parsed.toggleStage, defaults.toggleStage),
        toggleLike: sanitizeCombo(parsed.toggleLike, defaults.toggleLike),
        toggleMute: sanitizeCombo(parsed.toggleMute, defaults.toggleMute),
        navBack: sanitizeCombo(parsed.navBack, defaults.navBack),
        navForward: sanitizeCombo(parsed.navForward, defaults.navForward),
      };
    }

    // Migrate legacy v1 keys gracefully
    const rawV1 = localStorage.getItem(SHORTCUTS_V1_KEY);
    if (rawV1) {
      const legacy = JSON.parse(rawV1) as {
        toggleStage?: string;
        toggleLike?: string;
        openSearchModKey?: string;
        openPaletteModKey?: string;
      };
      return {
        ...defaults,
        toggleStage: sanitizeCombo(legacy.toggleStage, defaults.toggleStage),
        toggleLike: sanitizeCombo(legacy.toggleLike, defaults.toggleLike),
        openSearch: sanitizeCombo(
          legacy.openSearchModKey ? `Mod+${legacy.openSearchModKey}` : undefined,
          defaults.openSearch
        ),
        openPalette: sanitizeCombo(
          legacy.openPaletteModKey ? `Mod+${legacy.openPaletteModKey}` : undefined,
          defaults.openPalette
        ),
      };
    }
  } catch {
    // Ignore parse errors
  }
  return defaults;
}

export function saveShortcutsConfig(cfg: AppShortcutsConfig) {
  try {
    localStorage.setItem(SHORTCUTS_V2_KEY, JSON.stringify(cfg));
  } catch {
    // Ignore storage errors
  }
}

function eventToCanonicalKey(e: KeyboardEvent): string {
  if (e.code === "Space" || e.key === " ") return "Space";
  if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
    return e.key;
  }
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(e.key)) return e.key;
  if (e.key.length === 1 && !MODIFIER_NAMES.has(e.key.toLowerCase())) {
    return normalizeKeyToken(e.key);
  }
  return "";
}

/**
 * Captures a user-pressed KeyboardEvent into our canonical portable shortcut string
 * (e.g. "Alt+Shift+Space", "Mod+K", "F", "Mod+ArrowLeft").
 */
export function captureShortcutFromEvent(
  e: KeyboardEvent,
  options?: { requireModifier?: boolean; isMac?: boolean }
): string | null {
  const isMac = options?.isMac ?? isMacPlatform();
  if (
    e.key === "Meta" ||
    e.key === "Control" ||
    e.key === "Alt" ||
    e.key === "Shift" ||
    e.key === "CapsLock" ||
    e.key === "Tab" ||
    e.key === "Enter" ||
    e.key === "Backspace" ||
    e.key === "Delete"
  ) {
    return null;
  }

  const key = eventToCanonicalKey(e);
  if (!key) return null;

  const mods: string[] = [];
  if (isMac) {
    if (e.metaKey) mods.push("Mod");
    if (e.ctrlKey) mods.push("Ctrl");
  } else {
    if (e.ctrlKey) mods.push("Mod");
    if (e.metaKey) mods.push("Mod");
  }
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");

  if (options?.requireModifier && mods.length === 0) {
    return null;
  }

  // Deduplicate Mod if needed
  const uniqueMods = Array.from(new Set(mods));
  return [...uniqueMods, key].join("+");
}

/**
 * Checks whether a KeyboardEvent matches a canonical shortcut string.
 */
export function matchesShortcut(
  e: KeyboardEvent,
  combo: string,
  isMac = isMacPlatform()
): boolean {
  const tokens = combo.split("+").filter(Boolean);
  if (tokens.length === 0) return false;
  const targetKey = tokens[tokens.length - 1];
  const modTokens = new Set(tokens.slice(0, -1));

  const wantMod = modTokens.has("Mod");
  const wantCtrl = modTokens.has("Ctrl");
  const wantAlt = modTokens.has("Alt");
  const wantShift = modTokens.has("Shift");

  if (isMac) {
    if (e.metaKey !== wantMod) return false;
    if (e.ctrlKey !== wantCtrl) return false;
  } else {
    const needCtrl = wantMod || wantCtrl;
    if (e.ctrlKey !== needCtrl) return false;
    if (e.metaKey) return false;
  }
  if (e.altKey !== wantAlt) return false;
  if (e.shiftKey !== wantShift) return false;

  const pressedKey = eventToCanonicalKey(e);
  return pressedKey === targetKey;
}

/**
 * Formats a canonical combo into native Apple / Windows keycap labels.
 */
export function formatShortcutLabel(combo: string, isMac = isMacPlatform()): string {
  const tokens = combo.split("+").filter(Boolean);
  const formatted = tokens.map((tok) => {
    switch (tok) {
      case "Mod":
        return isMac ? "⌘" : "Ctrl";
      case "Ctrl":
        return isMac ? "⌃" : "Ctrl";
      case "Alt":
        return isMac ? "⌥" : "Alt";
      case "Shift":
        return isMac ? "⇧" : "Shift";
      case "Space":
        return "Espacio";
      case "ArrowLeft":
        return "←";
      case "ArrowRight":
        return "→";
      case "ArrowUp":
        return "↑";
      case "ArrowDown":
        return "↓";
      default:
        return tok;
    }
  });
  return formatted.join(" + ");
}

export function isShortcutsModified(cfg: AppShortcutsConfig): boolean {
  const defaults = getDefaultShortcuts();
  return (Object.keys(defaults) as ShortcutField[]).some(
    (k) => cfg[k] !== defaults[k]
  );
}
