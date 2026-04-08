/**
 * exportTable.js
 * ==============
 * Utility lato-client per esportare array di oggetti come CSV o XLSX.
 * Nessuna dipendenza esterna — CSV puro; XLSX tramite libreria opzionale
 * (se SheetJS è disponibile) oppure fallback a CSV rinominato .xlsx.
 *
 * Uso:
 *   import { exportCSV, exportXLSX } from "../../lib/exportTable";
 *   exportCSV(rows, "candidati");
 *   exportXLSX(rows, "candidati");
 */

"use client";

/**
 * Converte un valore in stringa CSV-safe (escapando le virgolette).
 */
function escapeCell(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // Se contiene virgola, virgolette o newline, racchiudi tra virgolette
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serializza un array di oggetti come stringa CSV.
 * @param {object[]} rows
 * @param {string[]} [columns] — lista di chiavi da includere (default: tutte)
 * @returns {string}
 */
export function toCSVString(rows, columns) {
  if (!rows || rows.length === 0) return "";
  const keys = columns || Object.keys(rows[0]);
  const header = keys.map(escapeCell).join(",");
  const body   = rows.map((r) => keys.map((k) => escapeCell(r[k])).join(",")).join("\n");
  return `${header}\n${body}`;
}

/**
 * Scarica un file CSV nel browser.
 * @param {object[]} rows
 * @param {string} filename — senza estensione
 * @param {string[]} [columns]
 */
export function exportCSV(rows, filename = "export", columns) {
  const csv  = toCSVString(rows, columns);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }); // BOM per Excel italiano
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Scarica un file XLSX nel browser usando SheetJS (se disponibile),
 * altrimenti fa fallback su CSV.
 * @param {object[]} rows
 * @param {string} filename — senza estensione
 * @param {string[]} [columns]
 */
export async function exportXLSX(rows, filename = "export", columns) {
  try {
    // Tenta di caricare SheetJS dinamicamente
    const XLSX = await import("xlsx").catch(() => null);
    if (!XLSX) throw new Error("SheetJS non disponibile");

    const keys = columns || (rows.length ? Object.keys(rows[0]) : []);
    const data  = [keys, ...rows.map((r) => keys.map((k) => r[k] ?? ""))];
    const ws    = XLSX.utils.aoa_to_sheet(data);
    const wb    = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Export");
    XLSX.writeFile(wb, `${filename}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch {
    // Fallback CSV
    exportCSV(rows, filename, columns);
  }
}
