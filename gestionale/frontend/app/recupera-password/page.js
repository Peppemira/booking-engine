"use client";

import { useState } from "react";
import Link from "next/link";

export default function RecuperaPasswordPage() {
  const [email, setEmail] = useState("");
  const [inviato, setInviato] = useState(false);

  function onSubmit(e) {
    e.preventDefault();
    setInviato(true);
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <main className="w-full max-w-md rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 overflow-hidden">
        <div className="rounded-t-2xl bg-linear-to-b from-indigo-800 to-violet-800 p-6 ring-1 ring-indigo-300">
          <h1 className="text-xl font-bold text-white">Recupera password</h1>
          <p className="mt-1 text-sm text-white/90">Inserisci l’email dell’account per ricevere il link di reset.</p>
        </div>
        <div className="p-6">
          {!inviato ? (
            <form className="space-y-4" onSubmit={onSubmit}>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
                required
              />
              <button type="submit" className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500">Invia link</button>
            </form>
          ) : (
            <p className="text-sm text-slate-700">Se l’email è registrata, riceverai un link per reimpostare la password. Controlla la casella di posta.</p>
          )}
          <p className="mt-4 text-sm">
            <Link href="/login" className="font-semibold text-indigo-800 hover:underline">Torna al login</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
