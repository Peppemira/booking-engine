"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

/**
 * Servizi on line – hub allineato al menu "Servizi On Line C.E.D." di GeCA (menuonline).
 * Ogni card corrisponde a un pulsante/servizio del form menuonline.
 */
const SERVIZI = [
  {
    key: "import",
    href: "/import",
    label: "Ricerca CED e Import",
    description: "Ricerca richieste inviate al C.E.D. e import candidati in GeCA",
    icon: "📥",
    available: true,
  },
  {
    key: "punti-patente",
    href: "/punti-patente",
    label: "Saldo punti patente",
    description: "Visualizza il saldo punti patente (Portale dell'automobilista)",
    icon: "🪪",
    available: true,
  },
  {
    key: "portale",
    href: "https://www.ilportaledellautomobilista.it",
    label: "Navigatore Portale",
    description: "Accedi alle sezioni del Portale dell'Automobilista",
    icon: "🌐",
    available: true,
    external: true,
  },
  {
    key: "rinnovabilita",
    href: "/servizi-online/rinnovo-patente",
    label: "Verifica rinnovabilità",
    description: "Effettua la verifica di rinnovabilità patente",
    icon: "🔄",
    available: true,
  },
  {
    key: "cambio-codice",
    href: "/servizi-online/cambio-codice",
    label: "Cambio codice autoscuola",
    description: "Servizio per il cambio codice autoscuola su una pratica",
    icon: "🏫",
    available: true,
  },
  {
    key: "verifica-patente-cqc",
    href: "/servizi-online/verifica-cqc",
    label: "Verifica / Trova patente CQC",
    description: "Risali al titolare di una patente CQC dal codice fiscale",
    icon: "🪪",
    available: true,
  },
  {
    key: "targa",
    label: "Verifica Targa (neopatentati)",
    description: "Verifica possibilità di guida di un veicolo da parte di un neopatentato",
    icon: "🚗",
    available: false,
  },
  {
    key: "prime-fasi",
    label: "Elenco Prime Fasi",
    description: "Richiama dal C.E.D. l'elenco delle prime fasi inviate",
    icon: "📋",
    available: false,
  },
  {
    key: "cambio-password",
    label: "Cambio password portale",
    description: "Cambio password per l'accesso ai servizi del Portale",
    icon: "🔑",
    available: false,
  },
  {
    key: "rca",
    label: "Verifica RCA (targa)",
    description: "Verifica tramite targa se un veicolo è coperto dall'RCA",
    icon: "📄",
    available: false,
  },
  {
    key: "crediti",
    label: "Ricerca crediti",
    description: "Ricerca crediti da recuperare per ogni tipologia",
    icon: "💳",
    available: false,
  },
  {
    key: "anomalia",
    label: "Ricerca anomalia richieste",
    description: "Visualizza l'anomalia riscontrata su una richiesta (protocollo)",
    icon: "⚠️",
    available: false,
  },
];

export default function ServiziOnlinePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const session = await checkSession();
      if (!session.ok) {
        if (!cancelled) router.replace("/login");
        return;
      }
      if (!cancelled) {
        setUser(session.autoscuola);
        setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Caricamento...</p>
      </div>
    );
  }

  return (
    <ModernAppShell
      title="Servizi on line"
      subtitle="Servizi On Line C.E.D. (Portale dell'automobilista)"
      activeKey="servizi-online"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="mx-auto max-w-5xl">
        <p className="mb-6 text-slate-600">
          Accesso ai servizi del Portale dell&apos;Automobilista e del C.E.D., come nel menu &quot;Servizi On Line C.E.D.&quot; di GeCA.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SERVIZI.map((s) => {
            if (s.available && s.external) {
              return (
                <a
                  key={s.key}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:border-emerald-300 hover:shadow-md"
                >
                  <span className="text-2xl" aria-hidden>{s.icon}</span>
                  <h3 className="mt-2 font-semibold text-slate-900">{s.label}</h3>
                  <p className="mt-1 text-sm text-slate-600">{s.description}</p>
                  <span className="mt-3 text-xs font-medium text-emerald-600">Apri link esterno →</span>
                </a>
              );
            }
            if (s.available && s.href) {
              return (
                <Link
                  key={s.key}
                  href={s.href}
                  className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:border-emerald-300 hover:shadow-md"
                >
                  <span className="text-2xl" aria-hidden>{s.icon}</span>
                  <h3 className="mt-2 font-semibold text-slate-900">{s.label}</h3>
                  <p className="mt-1 text-sm text-slate-600">{s.description}</p>
                  <span className="mt-3 text-xs font-medium text-emerald-600">Apri →</span>
                </Link>
              );
            }
            return (
              <div
                key={s.key}
                className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50 p-5 opacity-90"
              >
                <span className="text-2xl text-slate-400" aria-hidden>{s.icon}</span>
                <h3 className="mt-2 font-semibold text-slate-700">{s.label}</h3>
                <p className="mt-1 text-sm text-slate-500">{s.description}</p>
                <span className="mt-3 text-xs font-medium text-slate-400">In preparazione</span>
              </div>
            );
          })}
        </div>
      </div>
    </ModernAppShell>
  );
}
