"use client";

import { createContext, useCallback, useContext, useState, useRef } from "react";

/**
 * Toast notification system — zero dipendenze esterne.
 * Uso:
 *   const toast = useToast();
 *   toast.success("Salvato!");
 *   toast.error("Qualcosa è andato storto");
 *   toast.info("Operazione in corso...");
 */

const ToastContext = createContext(null);

let idCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const removeToast = useCallback((id) => {
    clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = "info", duration = 4000) => {
    const id = ++idCounter;
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]); // max 5

    if (duration > 0) {
      timersRef.current[id] = setTimeout(() => removeToast(id), duration);
    }
    return id;
  }, [removeToast]);

  const api = {
    success: (msg, ms) => addToast(msg, "success", ms ?? 3500),
    error:   (msg, ms) => addToast(msg, "error",   ms ?? 6000),
    info:    (msg, ms) => addToast(msg, "info",     ms ?? 4000),
    warning: (msg, ms) => addToast(msg, "warning",  ms ?? 5000),
    dismiss: removeToast,
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Toast container — fixed in alto a destra */}
      <div
        aria-live="polite"
        className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
        style={{ maxWidth: "380px" }}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback silenzioso: se usato fuori dal provider, non crasha
    return {
      success: () => {},
      error: () => {},
      info: () => {},
      warning: () => {},
      dismiss: () => {},
    };
  }
  return ctx;
}

// ── Toast item con animazione CSS ──────────────────────────────────────────────

const ICONS = {
  success: "\u2705",
  error:   "\u274C",
  warning: "\u26A0\uFE0F",
  info:    "\u2139\uFE0F",
};

const BG_CLASSES = {
  success: "bg-emerald-50 border-emerald-300 text-emerald-800",
  error:   "bg-red-50 border-red-300 text-red-800",
  warning: "bg-amber-50 border-amber-300 text-amber-800",
  info:    "bg-blue-50 border-blue-300 text-blue-800",
};

const DARK_BG_CLASSES = {
  success: "dark:bg-emerald-900/80 dark:border-emerald-600 dark:text-emerald-100",
  error:   "dark:bg-red-900/80 dark:border-red-600 dark:text-red-100",
  warning: "dark:bg-amber-900/80 dark:border-amber-600 dark:text-amber-100",
  info:    "dark:bg-blue-900/80 dark:border-blue-600 dark:text-blue-100",
};

function ToastItem({ toast, onClose }) {
  return (
    <div
      className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm animate-slide-in ${BG_CLASSES[toast.type] || BG_CLASSES.info} ${DARK_BG_CLASSES[toast.type] || DARK_BG_CLASSES.info}`}
      role="alert"
    >
      <span className="text-base mt-0.5 shrink-0">{ICONS[toast.type] || ICONS.info}</span>
      <p className="flex-1 text-sm font-medium leading-snug">{toast.message}</p>
      <button
        onClick={onClose}
        className="shrink-0 ml-2 mt-0.5 text-current opacity-40 hover:opacity-80 transition"
        aria-label="Chiudi notifica"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
