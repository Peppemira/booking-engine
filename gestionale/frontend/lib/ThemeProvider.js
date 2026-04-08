"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * ThemeProvider — gestione dark mode con persistenza localStorage.
 * Supporta: "light" | "dark" | "system"
 *
 * Uso:
 *   const { theme, setTheme, isDark } = useTheme();
 *   <button onClick={() => setTheme(isDark ? "light" : "dark")}>Toggle</button>
 */

const ThemeContext = createContext(null);
const STORAGE_KEY = "gestionale_theme";

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState("system"); // "light" | "dark" | "system"
  const [isDark, setIsDark] = useState(false);

  // Leggi preferenza salvata al mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      setThemeState(saved);
    }
  }, []);

  // Applica il tema reale (risolvendo "system")
  useEffect(() => {
    function applyTheme() {
      let dark = false;
      if (theme === "dark") {
        dark = true;
      } else if (theme === "system") {
        dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      }
      setIsDark(dark);

      const root = document.documentElement;
      if (dark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }

    applyTheme();

    // Ascolta cambi di sistema (per mode "system")
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") applyTheme();
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((newTheme) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return { theme: "light", setTheme: () => {}, isDark: false };
  }
  return ctx;
}

/**
 * ThemeToggle — bottone compatto per sidebar / top-bar.
 * Cicla: light → dark → system → light ...
 */
export function ThemeToggle({ className = "" }) {
  const { theme, setTheme, isDark } = useTheme();

  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const labels = { light: "Chiaro", dark: "Scuro", system: "Auto" };
  const icons = { light: "\u2600\uFE0F", dark: "\uD83C\uDF19", system: "\uD83D\uDCBB" };

  return (
    <button
      onClick={() => setTheme(next)}
      className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${className}`}
      title={`Tema: ${labels[theme]} — clicca per ${labels[next]}`}
    >
      <span>{icons[theme]}</span>
      <span>{labels[theme]}</span>
    </button>
  );
}
