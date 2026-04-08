"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Radar Sedute unificato con Prenotazioni.
 * Redirect a /prenotazioni dove sono presenti KPIs Radar + sedute + prenotazioni.
 */
export default function RadarRedirectPage() {
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
