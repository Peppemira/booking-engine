"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { API_BASE, checkSession, getApiBase, setApiBase } from "../../lib/authClient";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function verify() {
      const session = await checkSession();
      if (session.ok && !cancelled) router.replace("/");
    }
    verify();
    return () => { cancelled = true; };
  }, [router]);

  async function onLogin(e) {
    e.preventDefault();
    setStatus("Accesso in corso...");
    setError(false);

    try {
      const payload = JSON.stringify({ email, password });
      const runtimeBase = getApiBase();
      const currentHostBase = typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}` : "";
      const bases = [
        runtimeBase,
        API_BASE,
        currentHostBase ? `${currentHostBase}:3000` : "",
        currentHostBase ? `${currentHostBase}:3001` : "",
        "http://localhost:3000",
        "http://localhost:3001",
      ].map((v) => String(v || "").trim()).filter(Boolean);
      const uniqueBases = Array.from(new Set(bases));

      let data = null;
      let selectedBase = "";
      let authError = "";

      for (const base of uniqueBases) {
        try {
          const res = await fetch(`${base}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
          });
          const raw = await res.text();
          let parsed = {};
          try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = {}; }
          if (res.ok && parsed?.success && parsed?.token) {
            data = parsed;
            selectedBase = base;
            break;
          }
          if (parsed?.error) authError = String(parsed.error);
          else if (res.status === 401) authError = "Credenziali non valide";
        } catch { }
      }

      if (!data?.token) {
        setError(true);
        throw new Error(authError || "Backend non raggiungibile");
      }

      localStorage.removeItem("autoscuola_api_base");
      localStorage.setItem("autoscuola_token", data.token);
      if (selectedBase) setApiBase(selectedBase);
      setStatus("Accesso riuscito");
      window.location.href = "/";
    } catch (err) {
      setError(true);
      setStatus(err.message || "Errore di connessione");
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 flex items-center justify-center">
      <main className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="rounded-t-2xl bg-linear-to-b from-indigo-800 to-violet-800 p-6 ring-1 ring-indigo-300">
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-200">Gestionale</p>
          <h1 className="mt-2 text-2xl font-bold text-white">Login Autoscuola</h1>
          <p className="mt-1 text-sm text-white/90">Inserisci email e password per accedere.</p>
        </div>

        <section className="p-6">
          <form className="space-y-4" onSubmit={onLogin}>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Email</label>
              <input
                type="email"
                placeholder="nome@autoscuola.it"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
            >
              Accedi
            </button>
          </form>

          <p className={`mt-3 text-sm ${error ? "text-red-600 font-semibold" : "text-slate-600"}`}>{status}</p>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
            <Link href="/recupera-password" className="font-semibold text-indigo-800 hover:underline" title="Recupera password">
              Recupera password
            </Link>
            <Link href="/register" className="font-semibold text-indigo-800 hover:underline" title="Registrati">
              Registrati
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
