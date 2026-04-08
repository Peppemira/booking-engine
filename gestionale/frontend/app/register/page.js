"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, checkSession } from "../../lib/authClient";

export default function RegisterPage() {
  const router = useRouter();
  const fieldTooltips = {
    nome: "Nome visualizzato dell'autoscuola",
    email: "Email usata per accedere al gestionale",
    password: "Password dell'account autoscuola",
    portal_user: "Username del portale ministeriale",
    portal_pass: "Password del portale ministeriale",
    portal_pin: "PIN del portale ministeriale"
  };
  const [form, setForm] = useState({
    nome: "",
    email: "",
    password: "",
    portal_user: "",
    portal_pass: "",
    portal_pin: "",
  });
  const [status, setStatus] = useState("");
  const [portalFromVault, setPortalFromVault] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      const session = await checkSession();
      if (session.ok && !cancelled) {
        router.replace("/");
      }
    }

    verify();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/portal-defaults`);
        const data = await res.json();
        if (!cancelled && data.hasDefaults) setPortalFromVault(true);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleRegister() {
    setStatus("Registrazione in corso...");

    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const raw = await res.text();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`Risposta non JSON dal server (${res.status}). Verifica NEXT_PUBLIC_API_BASE e backend attivo.`);
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Registrazione fallita");
      }

      localStorage.setItem("autoscuola_token", data.token);
      setStatus("Registrazione completata");
      router.replace("/");
    } catch (error) {
      const msg = error?.message || "";
      const hint =
        msg.includes("Failed to fetch") || msg.includes("NetworkError")
          ? " — Avvia il backend: nella root del progetto (booking-engine) esegui  npm run backend  . In alternativa:  cd gestionale\\backend   poi  npm start  ."
          : "";
      setStatus(`Errore: ${msg}${hint}`);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 lg:p-8">
      <main className="mx-auto mt-8 max-w-5xl overflow-hidden rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr]">
          <section className="rounded-2xl bg-linear-to-b from-indigo-800 to-violet-800 p-8 shadow-lg ring-1 ring-indigo-300 lg:p-10">
            <p className="text-xs font-bold uppercase tracking-wide text-indigo-200">Gestionale</p>
            <h1 className="mt-4 text-2xl font-extrabold leading-tight text-white" title="Crea un nuovo account autoscuola">Registrazione Autoscuola</h1>
            <p className="mt-2 text-sm text-white/90">Configura account e credenziali portale ministeriale.</p>
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 lg:p-8">
            {portalFromVault && (
              <p className="mb-4 rounded-xl border border-indigo-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-indigo-800">
                Le credenziali del portale sono già nel backend (cartella <strong>vault</strong>). Puoi lasciare vuoti i campi <em>portal_user</em>, <em>portal_pass</em> e <em>portal_pin</em>: verranno usate quelle.
              </p>
            )}
            <div>
          {[
            "nome",
            "email",
            "password",
            "portal_user",
            "portal_pass",
            "portal_pin",
          ].map((field) => (
            <input
              key={field}
              className="mb-2 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm font-semibold"
              placeholder={portalFromVault && field.startsWith("portal_") ? `${field} (opzionale, già in vault)` : field}
              title={fieldTooltips[field] || field}
              type={field === "password" || field === "portal_pass" ? "password" : "text"}
              value={form[field] || ""}
              onChange={(e) =>
                setForm({ ...form, [field]: e.target.value })
              }
            />
          ))}

          <button
            onClick={handleRegister}
            className="mt-2 w-full rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
            title="Registra l'autoscuola e accedi alla dashboard"
          >
            Registrati
          </button>
        </div>

            <p className="mt-3 rounded-xl bg-slate-100 px-3 py-1.5 text-xs text-slate-700" title="Messaggio di stato della registrazione">{status}</p>
            <p className="mt-2 text-sm text-slate-700">
              Hai già un account? <a className="font-semibold text-indigo-800 hover:underline" href="/login" title="Torna alla pagina di login">Vai al login</a>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
