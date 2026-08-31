"use client";

/**
 * /portale/funzioni/[categoria] — Pagina categoria
 *
 * Mostra l'elenco completo di tutte le funzioni della macro-categoria,
 * raggruppate per gruppo (es. Prenotazione Quiz, Richiesta Esame, ecc.).
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ModernAppShell from "../../../ModernAppShell";
import { checkSession, logoutSession } from "../../../../lib/authClient";
import { getCategory } from "../../../../lib/portalCatalog";

export default function CategoriaPage() {
  const router = useRouter();
  const params = useParams();
  const categoriaSlug = params?.categoria;

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

  const categoria = getCategory(categoriaSlug);

  if (loading) {
    return (
      <ModernAppShell title="Portale - Funzioni" subtitle="Caricamento..." activeKey="portale-funzioni" onLogout={handleLogout} user={user}>
        <div className="flex h-96 items-center justify-center text-slate-500">Caricamento...</div>
      </ModernAppShell>
    );
  }

  if (!categoria) {
    return (
      <ModernAppShell title="Categoria non trovata" subtitle="" activeKey="portale-funzioni" onLogout={handleLogout} user={user}>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
          <div className="text-lg font-semibold">Categoria non trovata</div>
          <p className="mt-1 text-sm">
            La categoria "<code>{categoriaSlug}</code>" non esiste nel catalogo.
          </p>
          <Link
            href="/portale/funzioni"
            className="mt-4 inline-block rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            ← Torna al catalogo
          </Link>
        </div>
      </ModernAppShell>
    );
  }

  const totalItems = categoria.groups.reduce((acc, g) => acc + g.items.length, 0);
  const implementedItems = categoria.groups.reduce(
    (acc, g) => acc + g.items.filter(it => it.implemented).length,
    0
  );

  return (
    <ModernAppShell
      title={`Portale - ${categoria.label}`}
      subtitle={categoria.desc}
      activeKey="portale-funzioni"
      onLogout={handleLogout}
      user={user}
    >
      <div className="space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Link href="/portale" className="hover:text-indigo-600">Portale</Link>
          <span>›</span>
          <Link href="/portale/funzioni" className="hover:text-indigo-600">Funzioni</Link>
          <span>›</span>
          <span className="font-semibold text-slate-700">{categoria.label}</span>
        </div>

        {/* Header categoria */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className={`absolute inset-x-0 top-0 h-1.5 bg-linear-to-r ${categoria.color}`} />
          <div className="flex items-start gap-4">
            <div className={`text-6xl bg-linear-to-br ${categoria.color} bg-clip-text text-transparent`}>
              {categoria.icon}
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-slate-800">{categoria.label}</h2>
              <p className="mt-1 text-sm text-slate-600">{categoria.desc}</p>

              <div className="mt-3 flex items-center gap-3">
                <div className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
                  {totalItems} funzioni totali
                </div>
                {implementedItems > 0 && (
                  <div className="rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                    ✓ {implementedItems} implementate
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Gruppi con funzioni */}
        {categoria.groups.map((group) => (
          <div key={group.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-2 text-base font-bold text-slate-800">
              <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{group.items.length}</span>
              {group.label}
            </h3>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => (
                <Link
                  key={item.slug}
                  href={`/portale/funzioni/${categoria.slug}/${item.slug}`}
                  className={`group relative rounded-xl border p-4 transition-all hover:scale-[1.01] hover:shadow-md ${
                    item.implemented
                      ? "border-emerald-200 bg-emerald-50/30 hover:bg-emerald-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="flex-1 text-sm font-semibold text-slate-800 group-hover:text-indigo-600">
                      {item.label}
                    </h4>
                    {item.implemented ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                        ✓ Pronta
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                        TODO
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-slate-600 line-clamp-2">{item.desc}</p>

                  {item.fields && item.fields.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.fields.slice(0, 3).map((f) => (
                        <span
                          key={f}
                          className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                        >
                          {f}
                        </span>
                      ))}
                      {item.fields.length > 3 && (
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                          +{item.fields.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-3 text-[10px] text-indigo-600 font-semibold group-hover:underline">
                    Dettaglio →
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}

        {/* Footer con back */}
        <div className="flex justify-between items-center pt-2">
          <Link
            href="/portale/funzioni"
            className="text-xs text-slate-600 hover:text-indigo-600"
          >
            ← Torna al catalogo
          </Link>
          <div className="text-xs text-slate-500">
            Categoria <code className="rounded bg-slate-100 px-1">{categoria.slug}</code>
          </div>
        </div>
      </div>
    </ModernAppShell>
  );
}
