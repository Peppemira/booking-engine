"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Lista Attesa unificata in Prenotazioni.
 * Redirect a /prenotazioni dove è presente la sezione Lista di attesa completa.
 */
export default function ListaAttesaRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/prenotazioni");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <p className="text-slate-600">Reindirizzamento a Prenotazioni...</p>
    </div>
  );
}
