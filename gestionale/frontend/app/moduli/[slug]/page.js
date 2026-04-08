"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { logoutSession } from "../../../lib/authClient";
import ModernAppShell from "../../ModernAppShell";

const LABEL_BY_SLUG = {
  "fogli-rosa-patenti": "Fogli Rosa e Patenti",
  "gestione-guide": "Gestione Guide",
  "fatturazione-pagament": "Fatturazione e Pagament",
  "strumenti-utili": "Strumenti Utili",
  "gestione-corsi": "Gestione Corsi",
  impostazioni: "Impostazioni",
};

const KEY_BY_SLUG = {
  "fogli-rosa-patenti": "fogli-rosa-patenti",
  "gestione-guide": "gestione-guide",
  "fatturazione-pagament": "fatturazione-pagament",
  "strumenti-utili": "strumenti-utili",
  "gestione-corsi": "gestione-corsi",
  impostazioni: "impostazioni",
};

export default function ModuloPlaceholderPage() {
  const router = useRouter();
  const params = useParams();
  const slug = String(params?.slug || "");

  const label = useMemo(() => LABEL_BY_SLUG[slug] || "Modulo", [slug]);
  const activeKey = useMemo(() => KEY_BY_SLUG[slug] || "dashboard", [slug]);

  async function onLogout() {
    await logoutSession();
    router.replace("/login");
  }

  return (
    <ModernAppShell
      title={label}
      subtitle="Modulo in preparazione"
      activeKey={activeKey}
      onLogout={onLogout}
    >
      <h2 className="text-3xl font-black text-slate-900">{label}</h2>
      <p className="mt-1 text-sm text-slate-500">Questa sezione è pronta per essere sviluppata nel prossimo step.</p>

      <div className="mt-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm text-slate-700">
          Struttura del modulo attivata. Possiamo procedere subito con campi, filtri, tabelle e azioni operative specifiche.
        </p>
      </div>
    </ModernAppShell>
  );
}
