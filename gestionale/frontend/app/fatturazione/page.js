"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { API_BASE, authHeaders, checkSession, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------

function euro(v) {
  const n = Number(v || 0);
  return n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function data(v) {
  if (!v) return "–";
  return new Date(v).toLocaleDateString("it-IT");
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}/api/billing${path}`, {
    cache: "no-store",
    ...options,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error || `Errore ${res.status}`);
  return body;
}

const STATO_LABEL = {
  attiva: { text: "Attivo", cls: "bg-emerald-100 text-emerald-800" },
  in_sospeso: { text: "Pagamento in sospeso", cls: "bg-amber-100 text-amber-800" },
  bloccata: { text: "Nuovi PagoPA sospesi", cls: "bg-red-100 text-red-800" },
  non_attivo: { text: "Da attivare", cls: "bg-slate-100 text-slate-700" },
  esente: { text: "Esente", cls: "bg-sky-100 text-sky-800" },
};

const PAGAMENTO_LABEL = {
  pagata: { text: "Pagata", cls: "bg-emerald-100 text-emerald-800" },
  in_attesa: { text: "In attesa", cls: "bg-slate-100 text-slate-700" },
  fallita: { text: "Non pagata", cls: "bg-red-100 text-red-800" },
  annullata: { text: "Annullata", cls: "bg-slate-100 text-slate-500" },
};

const SDI_LABEL = {
  da_emettere: "Da emettere",
  inviata: "Inviata allo SDI",
  consegnata: "Consegnata",
  scartata: "Scartata",
  errore: "Errore invio",
};

function Chip({ map, value }) {
  const item = map[value] || { text: value || "–", cls: "bg-slate-100 text-slate-700" };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${item.cls}`}>{item.text}</span>;
}

function Card({ title, children, className = "" }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>}
      {children}
    </section>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  );
}

const CAMPI_FISCALI = [
  { key: "ragione_sociale", label: "Ragione sociale", full: true },
  { key: "partita_iva", label: "Partita IVA" },
  { key: "codice_fiscale", label: "Codice fiscale" },
  { key: "codice_sdi", label: "Codice destinatario SDI" },
  { key: "pec", label: "PEC" },
  { key: "indirizzo", label: "Indirizzo", full: true },
  { key: "cap", label: "CAP" },
  { key: "comune", label: "Comune" },
  { key: "provincia", label: "Provincia (sigla)" },
  { key: "telefono", label: "Cellulare per avvisi WhatsApp" },
];

// ---------------------------------------------------------------------------
// Vista autoscuola
// ---------------------------------------------------------------------------

function VistaAutoscuola({ stato, fatture, onReload, notify }) {
  const [form, setForm] = useState(stato.datiFiscali || {});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => setForm(stato.datiFiscali || {}), [stato.datiFiscali]);

  async function salva(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/dati-fiscali", { method: "PUT", body: JSON.stringify(form) });
      notify("Dati di fatturazione salvati", "ok");
      await onReload();
    } catch (err) {
      notify(err.message, "err");
    } finally {
      setSaving(false);
    }
  }

  async function vaiA(path) {
    setBusy(true);
    try {
      const r = await api(path, { method: "POST" });
      if (r.url) window.location.href = r.url;
    } catch (err) {
      notify(err.message, "err");
      setBusy(false);
    }
  }

  const fallita = fatture.find((f) => f.stato_pagamento === "fallita");

  return (
    <div className="space-y-4">
      {stato.stato === "bloccata" && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          La creazione di nuovi PagoPA è sospesa perché la fattura delle commissioni non è stata pagata.
          Puoi consultare tutti i dati. {fallita?.link_pagamento && (
            <a className="font-semibold underline" href={fallita.link_pagamento} target="_blank" rel="noreferrer">Paga ora</a>
          )}
        </div>
      )}
      {stato.stato === "in_sospeso" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          L&apos;ultimo addebito non è riuscito: riproveremo in automatico. Se il pagamento non arriva entro {stato.giorniTolleranza} giorni,
          i nuovi PagoPA verranno sospesi. {fallita?.link_pagamento && (
            <a className="font-semibold underline" href={fallita.link_pagamento} target="_blank" rel="noreferrer">Paga subito</a>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="PagoPA oggi" value={stato.pagopaOggi} />
        <Stat label="PagoPA questa settimana" value={stato.pagopaSettimana} />
        <Stat label="Maturato settimana" value={euro(stato.maturatoSettimanaEuro)} hint={`${euro(stato.tariffaEuro)} a PagoPA + IVA ${stato.aliquotaIva}%`} />
        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">Stato</div>
          <div className="mt-2"><Chip map={STATO_LABEL} value={stato.stato} /></div>
        </div>
      </div>

      <Card title="Metodo di pagamento delle commissioni">
        {stato.metodoPagamentoSalvato ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
            <span>Carta o conto salvati: le commissioni vengono addebitate ogni settimana in automatico.</span>
            <button disabled={busy} onClick={() => vaiA("/portale-pagamento")}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800">
              Cambia carta o conto
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
            <span>
              Salva una carta (anche Postepay o la carta del conto) oppure un addebito SEPA. Ogni settimana verrà
              addebitato solo il numero di PagoPA effettivamente usati.
            </span>
            <button disabled={busy || !stato.datiFiscaliCompleti || !stato.billingAttivo} onClick={() => vaiA("/attiva")}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              Attiva pagamento
            </button>
            {!stato.datiFiscaliCompleti && <span className="text-xs text-amber-700">Completa prima i dati di fatturazione qui sotto.</span>}
            {!stato.billingAttivo && <span className="text-xs text-slate-500">Servizio non ancora attivo sulla piattaforma.</span>}
          </div>
        )}
      </Card>

      <Card title="Fatture">
        {fatture.length === 0 ? (
          <p className="text-sm text-slate-500">Nessuna fattura ancora. La prima arriverà a fine settimana.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700">
                  <th className="py-2 pr-3">Periodo</th>
                  <th className="py-2 pr-3 text-right">PagoPA</th>
                  <th className="py-2 pr-3 text-right">Totale</th>
                  <th className="py-2 pr-3">Pagamento</th>
                  <th className="py-2 pr-3">Fattura elettronica</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {fatture.map((f) => (
                  <tr key={f.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 pr-3">{data(f.periodo_inizio)} – {data(f.periodo_fine)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{f.numero_pagopa ?? 0}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{euro(f.totale)}</td>
                    <td className="py-2 pr-3"><Chip map={PAGAMENTO_LABEL} value={f.stato_pagamento} /></td>
                    <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">
                      {Number(f.totale) > 0 ? `${SDI_LABEL[f.stato_sdi] || f.stato_sdi}${f.numero_sdi ? ` n. ${f.numero_sdi}` : ""}` : "–"}
                    </td>
                    <td className="py-2 text-right">
                      {f.pdf_url && <a className="text-indigo-600 underline" href={f.pdf_url} target="_blank" rel="noreferrer">PDF</a>}
                      {f.stato_pagamento === "fallita" && f.link_pagamento && (
                        <a className="ml-3 font-semibold text-red-700 underline" href={f.link_pagamento} target="_blank" rel="noreferrer">Paga</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Dati di fatturazione">
        <form onSubmit={salva} className="grid gap-3 sm:grid-cols-2">
          {CAMPI_FISCALI.map((c) => (
            <label key={c.key} className={`text-sm ${c.full ? "sm:col-span-2" : ""}`}>
              <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">{c.label}</span>
              <input
                value={form[c.key] || ""}
                onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-indigo-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
          ))}
          <div className="sm:col-span-2 flex items-center gap-3">
            <button type="submit" disabled={saving}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {saving ? "Salvataggio…" : "Salva dati"}
            </button>
            <span className="text-xs text-slate-500">Serve il codice SDI oppure la PEC per ricevere la fattura elettronica.</span>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista amministratore BLUEFOX
// ---------------------------------------------------------------------------

function VistaAdmin({ notify }) {
  const [scuole, setScuole] = useState([]);
  const [riepilogo, setRiepilogo] = useState(null);
  const [daEmettere, setDaEmettere] = useState([]);
  const [errore, setErrore] = useState("");

  const carica = useCallback(async () => {
    setErrore("");
    try {
      const [a, r, f] = await Promise.all([
        api("/admin/autoscuole"),
        api("/admin/riepilogo?settimane=8"),
        api("/admin/fatture-da-emettere"),
      ]);
      setScuole(a.autoscuole || []);
      setRiepilogo(r);
      setDaEmettere(f.fatture || []);
    } catch (e) {
      setErrore(e.message);
    }
  }, []);

  useEffect(() => { carica(); }, [carica]);

  async function azione(path, body, messaggio) {
    try {
      await api(path, { method: "POST", body: JSON.stringify(body || {}) });
      notify(messaggio, "ok");
      await carica();
    } catch (e) {
      notify(e.message, "err");
    }
  }

  const nomeScuola = (id) => scuole.find((s) => s.id === id)?.nome || id;

  if (errore) return <p className="text-sm text-red-700">{errore}</p>;

  const settimane = riepilogo?.settimane || [];
  const totPagopa = settimane.reduce((s, r) => s + r.pagopa, 0);
  const totIncassato = settimane.reduce((s, r) => s + r.incassato, 0);
  const totInsoluto = scuole.reduce((s, r) => s + r.insolutoEuro, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="PagoPA ultime 8 settimane" value={totPagopa} />
        <Stat label="Incassato ultime 8 settimane" value={euro(totIncassato)} />
        <Stat label="Insoluti aperti" value={euro(totInsoluto)} />
        <Stat label="Fatture SDI da emettere" value={riepilogo?.fattureDaEmettere ?? 0} />
      </div>

      <Card title="Settimane">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700">
                <th className="py-2 pr-3">Settimana dal</th>
                <th className="py-2 pr-3 text-right">PagoPA</th>
                <th className="py-2 pr-3 text-right">Incassato</th>
                <th className="py-2 text-right">Insoluto</th>
              </tr>
            </thead>
            <tbody>
              {settimane.slice().reverse().map((r) => (
                <tr key={r.settimana} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-3">{data(r.settimana)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.pagopa}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{euro(r.incassato)}</td>
                  <td className="py-2 text-right tabular-nums">{r.insoluto ? euro(r.insoluto) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Autoscuole">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700">
                <th className="py-2 pr-3">Autoscuola</th>
                <th className="py-2 pr-3">Stato</th>
                <th className="py-2 pr-3 text-right">PagoPA settimana</th>
                <th className="py-2 pr-3 text-right">Insoluto</th>
                <th className="py-2 pr-3">Pagamento</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {scuole.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{s.nome}</div>
                    <div className="text-xs text-slate-500">{s.email}{!s.datiFiscaliCompleti && " · dati fiscali incompleti"}</div>
                  </td>
                  <td className="py-2 pr-3"><Chip map={STATO_LABEL} value={s.stato} /></td>
                  <td className="py-2 pr-3 text-right tabular-nums">{s.pagopaSettimana}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{s.insolutoEuro ? euro(s.insolutoEuro) : "–"}</td>
                  <td className="py-2 pr-3">{s.metodoPagamento ? "Salvato" : "Mancante"}</td>
                  <td className="space-x-2 whitespace-nowrap py-2 text-right">
                    {(s.stato === "bloccata" || s.stato === "in_sospeso") && (
                      <button onClick={() => azione(`/admin/autoscuole/${s.id}/sblocca`, {}, "Autoscuola sbloccata")}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
                        Sblocca
                      </button>
                    )}
                    <button onClick={() => azione(`/admin/autoscuole/${s.id}/esente`, { esente: s.stato !== "esente" }, "Impostazione aggiornata")}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
                      {s.stato === "esente" ? "Togli esenzione" : "Rendi esente"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Fatture elettroniche da emettere">
        {daEmettere.length === 0 ? (
          <p className="text-sm text-slate-500">Nessuna fattura in attesa.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700">
                  <th className="py-2 pr-3">Autoscuola</th>
                  <th className="py-2 pr-3">Periodo</th>
                  <th className="py-2 pr-3 text-right">PagoPA</th>
                  <th className="py-2 pr-3 text-right">Imponibile</th>
                  <th className="py-2 pr-3 text-right">Totale</th>
                  <th className="py-2 pr-3">Stato</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {daEmettere.map((f) => (
                  <tr key={f.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 pr-3">{nomeScuola(f.autoscuola_id)}</td>
                    <td className="py-2 pr-3">{data(f.periodo_inizio)} – {data(f.periodo_fine)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{f.numero_pagopa}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{euro(f.imponibile)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{euro(f.totale)}</td>
                    <td className="py-2 pr-3" title={f.errore_sdi || ""}>{SDI_LABEL[f.stato_sdi] || f.stato_sdi}</td>
                    <td className="space-x-2 whitespace-nowrap py-2 text-right">
                      <button onClick={() => azione(`/admin/fatture/${f.id}/riemetti-sdi`, {}, "Invio allo SDI eseguito")}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
                        Invia allo SDI
                      </button>
                      <button onClick={() => {
                        const numero = window.prompt("Numero della fattura emessa a mano:");
                        if (numero) azione(`/admin/fatture/${f.id}/segna-emessa`, { numero }, "Fattura segnata come emessa");
                      }}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
                        Emessa a mano
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

function FatturazioneContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stato, setStato] = useState(null);
  const [fatture, setFatture] = useState([]);
  const [errore, setErrore] = useState("");
  const [tab, setTab] = useState("autoscuola");
  const [toast, setToast] = useState(null);

  const notify = useCallback((text, kind = "ok") => {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await checkSession();
      if (!session.ok) { if (!cancelled) router.replace("/login"); return; }
      if (!cancelled) { setUser(session.autoscuola); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const carica = useCallback(async () => {
    setErrore("");
    try {
      const [s, f] = await Promise.all([api("/stato"), api("/fatture")]);
      setStato(s);
      setFatture(f.fatture || []);
    } catch (e) {
      setErrore(e.message);
    }
  }, []);

  useEffect(() => { if (!loading) carica(); }, [loading, carica]);

  useEffect(() => {
    const esito = searchParams.get("attivazione");
    if (esito === "ok") notify("Metodo di pagamento salvato. L'attivazione può richiedere qualche secondo.", "ok");
    if (esito === "annullata") notify("Attivazione annullata", "err");
  }, [searchParams, notify]);

  return (
    <ModernAppShell
      title="Fatturazione"
      subtitle="Commissioni PagoPA della piattaforma, metodo di pagamento e fatture"
      activeKey="fatturazione"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      {toast && (
        <div className={`fixed right-4 top-4 z-50 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${toast.kind === "err" ? "bg-red-600" : "bg-emerald-600"}`}>
          {toast.text}
        </div>
      )}

      {stato?.isAdmin && (
        <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm dark:border-slate-700 dark:bg-slate-900">
          {[["autoscuola", "La mia autoscuola"], ["admin", "Amministrazione piattaforma"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1.5 ${tab === k ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
              {l}
            </button>
          ))}
        </div>
      )}

      {errore && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{errore}</p>}
      {!stato && !errore && <p className="text-sm text-slate-500">Caricamento…</p>}

      {stato && tab === "autoscuola" && (
        <VistaAutoscuola stato={stato} fatture={fatture} onReload={carica} notify={notify} />
      )}
      {stato?.isAdmin && tab === "admin" && <VistaAdmin notify={notify} />}
    </ModernAppShell>
  );
}

export default function FatturazionePage() {
  return (
    <Suspense fallback={null}>
      <FatturazioneContent />
    </Suspense>
  );
}
