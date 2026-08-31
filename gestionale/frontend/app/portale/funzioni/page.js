"use client";

/**
 * /portale/funzioni — Hub navigazione funzioni portale
 *
 * Pagina di landing con 3 tiles macro-categoria. Ogni tile porta alla pagina
 * categoria che elenca tutte le funzioni mappate dal portale.
 *
 * Dati letti da lib/portalCatalog.js (catalogo centralizzato).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ModernAppShell from "../../ModernAppShell";
import { checkSession, logoutSession } from "../../../lib/authClient";
import { listCategories } from "../../../lib/portalCatalog";

export default function PortaleFunzioniHubPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await checkSession();
      if (!session.ok) {
        if (!cancelled) router.replace("/login");
        return;
      }
      if (!cancelled) {
        setUser(session.autoscuola);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function handleLogout() {
    await logoutSession();
    router.replace("/login");
  }

  if (loading) {
    return (
      <ModernAppShell title="Portale - Funzioni" subtitle="Caricamento..." activeKey="portale-funzioni" onLogout={handleLogout} user={user}>
        <div className="flex h-96 items-center justify-center text-slate-500">Caricamento...</div>
      </ModernAppShell>
    );
  }

  const categories = listCategories();
  const totalFunctions = categories.reduce((acc, c) => acc + c.totalItems, 0);
  const totalImplemented = categories.reduce((acc, c) => acc + c.implementedItems, 0);

  return (
    <ModernAppShell
      title="Portale - Funzioni"
      subtitle="Catalogo funzioni mappate dal Portale dell'Automobilista"
      activeKey="portale-funzioni"
      onLogout={handleLogout}
      user={user}
    >
      <div className="space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Link href="/portale" className="hover:text-indigo-600">Portale</Link>
          <span>›</span>
          <span className="font-semibold text-slate-700">Funzioni</span>
        </div>

        {/* Header */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-800">
                Catalogo funzioni del Portale dell'Automobilista
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Tutte le funzioni disponibili sul portale, organizzate in 3 macro-aree.
                Ogni voce porta a una pagina placeholder pronta per l'implementazione.
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 text-right">
              <div className="rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
                {totalImplemented} / {totalFunctions} implementate
              </div>
              <div className="text-xs text-slate-500">
                Progress: {Math.round((totalImplemented / totalFunctions) * 100)}%
              </div>
            </div>
          </div>

          <div className="mt-4 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-linear-to-r from-indigo-500 to-violet-600 transition-all"
              style={{ width: `${(totalImplemented / totalFunctions) * 100}%` }}
            />
          </div>
        </div>

        {/* Tiles macro-categoria */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {categories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/portale/funzioni/${cat.slug}`}
              className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:scale-[1.02] hover:shadow-lg"
            >
              <div className={`absolute inset-x-0 top-0 h-1 bg-linear-to-r ${cat.color}`} />
              <div className="flex items-start gap-4">
                <div className={`text-5xl bg-linear-to-br ${cat.color} bg-clip-text text-transparent`}>
                  {cat.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">
                    {cat.label}
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 line-clamp-3">
                    {cat.desc}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                <div className="text-xs text-slate-500">
                  <span className="font-bold text-slate-700">{cat.totalItems}</span> funzioni totali
                </div>
                {cat.implementedItems > 0 ? (
                  <div className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                    ✓ {cat.implementedItems} pronte
                  </div>
                ) : (
                  <div className="rounded-full bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                    Placeholder
                  </div>
                )}
              </div>

              <div className="mt-3 text-xs text-indigo-600 font-semibold group-hover:underline">
                Esplora →
              </div>
            </Link>
          ))}
        </div>

        {/* Info box */}
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-start gap-3">
            <div className="text-2xl">ℹ️</div>
            <div className="flex-1 text-sm text-blue-900">
              <div className="font-semibold">Come funziona il catalogo</div>
              <p className="mt-1 text-xs leading-relaxed">
                Le funzioni marcate come <span className="font-semibold text-emerald-700">✓ pronte</span> sono gia' integrate
                nel connettore backend (<code className="rounded bg-blue-100 px-1">portalSession.js</code>) e possono essere
                utilizzate dal gestionale. Le funzioni marcate come <span className="font-semibold text-slate-700">placeholder</span>
                sono state mappate durante l'esplorazione del portale ma devono ancora essere implementate.
                Ogni pagina placeholder mostra la URL action del portale, i campi del form e uno stub pronto per lo sviluppo.
              </p>
            </div>
          </div>
        </div>
      </div>
    </ModernAppShell>
  );
}
