"use client";

import { ThemeProvider } from "../lib/ThemeProvider";
import { ToastProvider } from "../lib/ToastContext";

/**
 * Client-side providers wrapper.
 * Contiene ThemeProvider (dark mode) e ToastProvider (notifiche).
 */
export default function Providers({ children }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        {children}
      </ToastProvider>
    </ThemeProvider>
  );
}
