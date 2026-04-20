"use client";

import { useState } from "react";
import Link from "next/link";
import { API_BASE } from "../../lib/authClient";

const API = API_BASE;

export default function RecuperaPasswordPage() {
  // Step 1: richiesta reset (email)
  const [email, setEmail] = useState("");
  const [step, setStep] = useState(1); // 1 = email, 2 = token + nuova password, 3 = fatto
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Step 2: token + nuova password
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  async function handleRequestReset(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/request-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Errore durante la richiesta");
        return;
      }
      // Se il backend restituisce il token direttamente (dev mode), pre-compila
      if (json.resetToken) {
        setResetToken(json.resetToken);
      }
      setSuccessMsg(json.message || "Controlla la tua email per il codice di reset.");
      setStep(2);
    } catch (err) {
      setError("Impossibile contattare il server. Riprova.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 6) {
      setError("La password deve avere almeno 6 caratteri.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Le password non coincidono.");
      return;
    }
    if (!resetToken.trim()) {
      setError("Inserisci il token di reset ricevuto.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken.trim(), newPassword }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Errore durante il reset");
        return;
      }
      setStep(3);
    } catch (err) {
      setError("Impossibile contattare il server. Riprova.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <main className="w-full max-w-md rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 overflow-hidden">
        <div className="rounded-t-2xl bg-linear-to-b from-indigo-800 to-violet-800 p-6 ring-1 ring-indigo-300">
          <h1 className="text-xl font-bold text-white">Recupera password</h1>
          <p className="mt-1 text-sm text-white/90">
            {step === 1 && "Inserisci l'email dell'account per ricevere il codice di reset."}
            {step === 2 && "Inserisci il token ricevuto e la nuova password."}
            {step === 3 && "Password aggiornata con successo!"}
          </p>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {successMsg && step === 2 && (
            <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              {successMsg}
            </div>
          )}

          {/* Step 1: Richiesta email */}
          {step === 1 && (
            <form className="space-y-4" onSubmit={handleRequestReset}>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Email account</label>
                <input
                  type="email"
                  placeholder="tuaemail@esempio.it"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
                  required
                  disabled={loading}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {loading ? "Invio in corso..." : "Richiedi reset password"}
              </button>
            </form>
          )}

          {/* Step 2: Token + nuova password */}
          {step === 2 && (
            <form className="space-y-4" onSubmit={handleResetPassword}>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Token di reset</label>
                <input
                  type="text"
                  placeholder="Incolla il token ricevuto"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-mono text-slate-900"
                  required
                  disabled={loading}
                />
                <p className="mt-1 text-xs text-slate-400">Copialo dall'email o dal log del server (dev mode).</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Nuova password</label>
                <input
                  type="password"
                  placeholder="Almeno 6 caratteri"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
                  required
                  minLength={6}
                  disabled={loading}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Conferma password</label>
                <input
                  type="password"
                  placeholder="Ripeti la nuova password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
                  required
                  minLength={6}
                  disabled={loading}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {loading ? "Aggiornamento..." : "Reimposta password"}
              </button>
              <button
                type="button"
                onClick={() => { setStep(1); setError(""); setSuccessMsg(""); }}
                className="w-full text-sm text-slate-500 hover:text-slate-700"
              >
                Torna indietro
              </button>
            </form>
          )}

          {/* Step 3: Successo */}
          {step === 3 && (
            <div className="text-center space-y-4">
              <div className="text-4xl">✅</div>
              <p className="text-sm text-slate-700 font-semibold">
                La tua password è stata aggiornata con successo.
              </p>
              <p className="text-sm text-slate-500">
                Ora puoi accedere con la nuova password.
              </p>
              <Link
                href="/login"
                className="inline-block w-full rounded-xl bg-indigo-700 py-3 text-sm font-semibold text-white transition hover:bg-indigo-600 text-center"
              >
                Vai al Login
              </Link>
            </div>
          )}

          {step !== 3 && (
            <p className="mt-4 text-sm">
              <Link href="/login" className="font-semibold text-indigo-800 hover:underline">Torna al login</Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
