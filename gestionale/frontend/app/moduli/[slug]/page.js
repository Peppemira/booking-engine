"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

// Mapping slug → pagina reale già implementata
const REDIRECT_MAP = {
  "fogli-rosa-patenti": "/fogli-rosa-patenti",
  "gestione-guide":     "/guide",
  "fatturazione-pagament": "/pagamenti",
  "strumenti-utili":    "/strumenti-utili",
  "gestione-corsi":     "/corsi",
  "impostazioni":       "/impostazioni",
  "visite-mediche":     "/visite-mediche",
  "preventivi":         "/preventivi",
  "veicoli":            "/veicoli",
  "committenti":        "/committenti",
  "listino":            "/listino",
  "impegni":            "/impegni",
};

export default function ModuloRedirectPage() {
  const router = useRouter();
  const params = useParams();
  const slug = String(params?.slug || "");

  useEffect(() => {
    const target = REDIRECT_MAP[slug];
    if (target) {
      router.replace(target);
    }
  }, [slug, router]);

  const target = REDIRECT_MAP[slug];

  if (target) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="text-slate-500 animate-pulse">Reindirizzamento...</div>
      </div>
    );
  }

  // Slug non riconosciuto: mostra messaggio
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-md text-center space-y-4">
        <div className="text-4xl">📋</div>
        <h2 className="text-xl font-bold text-slate-800">Modulo: {slug}</h2>
        <p className="text-sm text-slate-500">
          Questo modulo non è ancora disponibile.
        </p>
        <button onClick={() => router.push("/moduli")}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition">
          Torna ai Moduli
        </button>
      </div>
    </div>
  );
}
