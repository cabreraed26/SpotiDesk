import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";

const THEME_STORAGE_KEY = "spotyfast.theme";
const AMBIENT_STORAGE_KEY = "spotyfast.ambient_glow";

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      // Default to Obsidian dark mode
    }
    return "dark";
  });

  const [ambientEnabled, setAmbientEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(AMBIENT_STORAGE_KEY);
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(AMBIENT_STORAGE_KEY, String(ambientEnabled));
    } catch {
      // Ignore storage errors
    }
  }, [ambientEnabled]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const toggleAmbient = useCallback(() => {
    setAmbientEnabled((prev) => !prev);
  }, []);

  return { theme, toggleTheme, ambientEnabled, toggleAmbient };
}
