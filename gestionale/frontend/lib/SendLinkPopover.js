"use client";

/**
 * SendLinkPopover — popover ancorato per inviare il link acquisizione remota.
 * Genera un token (TTL 24h) on mount e mostra 2 canali: Email (Brevo) e WhatsApp (wa.me).
 * Più bottone "Copia link" come fallback universale.
 *
 * Spec: docs/superpowers/specs/2026-04-17-p1-link-delivery-design.md
 *
 * Props:
 *   candidate: { id, cognome, nome, email, telefono, autoscuola_nome }
 *   onClose:   () => void
 *   onSent?:   (delivery) => void   // chiamato dopo ogni delivery riuscito
 */
import { useEffect, useState, useCallback } from "react";
import { API_BASE, authHeaders } from "./authClient";
import { useToast } from "./ToastContext";
import { cleanPhone, isValidEmail } from "./phoneUtils";

const TTL_MINUTES = 1440; // 24h

export default function SendLinkPopover({ candidate, onClose, onSent }) {
  const toast = useToast();
  const [session, setSession] = useState(null);     // { token, link, expiresAt }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Genera token on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`${API_BASE}/api/remote-capture/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ mode: "cie_mobile", expiresMinutes: TTL_MINUTES }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (cancelled) return;
        setSession({
          token: j.token,
          link: j.link,
          expiresAt: j.expiresAt || j.expires_at,
        });
      } catch (e) {
        if (!cancelled) setError(e.message || "Errore");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="absolute right-0 top-full mt-2 w-[360px] rounded-xl bg-white shadow-2xl ring-1 ring-violet-300 z-50 p-4 text-slate-800">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm">📲 Invia link acquisizione</div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 text-lg leading-none"
          title="Chiudi"
        >×</button>
      </div>

      {loading && <div className="text-xs text-slate-500">Generazione token in corso…</div>}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 rounded p-2">
          Errore: {error}
        </div>
      )}
      {session && (
        <>
          <div className="text-[10px] text-slate-500 mb-3">
            Token valido fino a {formatExpiry(session.expiresAt)}
          </div>
          <Channels
            candidate={candidate}
            session={session}
            toast={toast}
            onSent={onSent}
          />
          <CopyLink link={session.link} toast={toast} />
        </>
      )}
    </div>
  );
}

function formatExpiry(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function formatTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: Canali (Email + WhatsApp)
// ─────────────────────────────────────────────────────────────────────────────
function Channels({ candidate, session, toast, onSent }) {
  return (
    <div className="space-y-3">
      <EmailRow candidate={candidate} session={session} toast={toast} onSent={onSent} />
      <WhatsAppRow candidate={candidate} session={session} toast={toast} onSent={onSent} />
    </div>
  );
}

function EmailRow({ candidate, session, toast, onSent }) {
  const [email, setEmail] = useState(candidate?.email || "");
  const [emailDelivery, setEmailDelivery] = useState(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState(null);

  const sendEmail = useCallback(async () => {
    if (!isValidEmail(email)) {
      setEmailError("Email non valida");
      return;
    }
    setEmailSending(true);
    setEmailError(null);
    try {
      // Autosave su candidato (silente; non blocca)
      if (email !== candidate.email) {
        fetch(`${API_BASE}/api/candidates/${candidate.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ email }),
        }).catch(() => {});
      }

      const r = await fetch(
        `${API_BASE}/api/remote-capture/sessions/${session.token}/deliver`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            channel: "email",
            recipient: email,
            candidateName: `${candidate?.nome || ""} ${candidate?.cognome || ""}`.trim() || "candidato",
          }),
        }
      );
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);

      if (j.delivery.status === "failed") {
        setEmailError(j.delivery.error_message || "Invio fallito");
        toast.error(`Email NON inviata: ${j.delivery.error_message || "errore"}`);
      } else {
        setEmailDelivery({ sent_at: j.delivery.sent_at });
        toast.success(`Email inviata a ${email}`);
        if (onSent) onSent(j.delivery);
      }
    } catch (e) {
      setEmailError(e.message);
      toast.error(`Errore: ${e.message}`);
    } finally {
      setEmailSending(false);
    }
  }, [email, candidate, session, toast, onSent]);

  const emailValid = isValidEmail(email);

  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
        📧 Email
      </label>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
          placeholder="indirizzo@email.it"
          className={`flex-1 rounded border px-2 py-1 text-xs ${
            emailError ? "border-red-400" : "border-slate-300"
          }`}
          disabled={emailSending}
        />
        <button
          onClick={sendEmail}
          disabled={!emailValid || emailSending}
          className="rounded bg-violet-600 px-3 py-1 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {emailSending ? "..." : (emailDelivery ? "↻ Reinvia" : "Invia")}
        </button>
      </div>
      {emailError && <div className="text-[10px] text-red-600">{emailError}</div>}
      {emailDelivery && (
        <div className="text-[10px] text-emerald-700">
          ✅ Inviata {formatTime(emailDelivery.sent_at)}
        </div>
      )}
    </div>
  );
}

function WhatsAppRow({ candidate, session, toast, onSent }) {
  const [phoneRaw, setPhoneRaw] = useState(candidate?.telefono || "");
  const [waDelivery, setWaDelivery] = useState(null);
  const [waOpening, setWaOpening] = useState(false);

  const cleaned = cleanPhone(phoneRaw);
  const isValid = !!cleaned;

  const openWhatsApp = useCallback(async () => {
    if (!cleaned) return;
    setWaOpening(true);

    // Autosave telefono su candidato (silente)
    if (phoneRaw !== candidate.telefono) {
      fetch(`${API_BASE}/api/candidates/${candidate.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ telefono: phoneRaw }),
      }).catch(() => {});
    }

    // Costruisci messaggio WhatsApp (template duplicato dal backend per semplicità)
    const nome = (candidate?.nome || "").trim() || "ciao";
    const autoscuola = candidate?.autoscuola_nome || "La tua autoscuola";
    const text = `Ciao ${nome}! 👋\n${autoscuola} ti chiede foto, firma e documenti per la pratica.\nCarica tutto dal telefono qui (bastano 5 minuti):\n${session.link}`;
    const waUrl = `https://wa.me/${cleaned}?text=${encodeURIComponent(text)}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");

    // Logging in deliveries (non bloccante)
    try {
      const r = await fetch(
        `${API_BASE}/api/remote-capture/sessions/${session.token}/deliver`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            channel: "whatsapp",
            recipient: cleaned,
            candidateName: `${candidate?.nome || ""} ${candidate?.cognome || ""}`.trim() || "candidato",
          }),
        }
      );
      const j = await r.json();
      if (r.ok && j.ok) {
        setWaDelivery({ sent_at: j.delivery.sent_at });
        toast.info(`Aperto WhatsApp per ${cleaned}`);
        if (onSent) onSent(j.delivery);
      }
    } catch (_) {
      // Logging silente: l'apertura wa.me è già avvenuta
    } finally {
      setWaOpening(false);
    }
  }, [cleaned, phoneRaw, candidate, session, toast, onSent]);

  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
        💬 WhatsApp
      </label>
      <div className="flex gap-2">
        <input
          type="tel"
          value={phoneRaw}
          onChange={(e) => setPhoneRaw(e.target.value)}
          placeholder="+39 333 1234567"
          className={`flex-1 rounded border px-2 py-1 text-xs ${
            isValid || !phoneRaw ? "border-slate-300" : "border-red-400"
          }`}
          disabled={waOpening}
        />
        <button
          onClick={openWhatsApp}
          disabled={!isValid || waOpening}
          title={isValid ? "Apri WhatsApp con messaggio precompilato" : "Telefono non valido (atteso es. +39 333 1234567)"}
          className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {waOpening ? "..." : (waDelivery ? "↻ Riapri" : "Apri WA")}
        </button>
      </div>
      {!isValid && phoneRaw && (
        <div className="text-[10px] text-red-600">
          Numero non valido. Atteso es. +39 333 1234567
        </div>
      )}
      {waDelivery && (
        <div className="text-[10px] text-emerald-700">
          📂 Aperto WA {formatTime(waDelivery.sent_at)}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: Copia link
// ─────────────────────────────────────────────────────────────────────────────
function CopyLink({ link, toast }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copiato negli appunti");
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      toast.error("Impossibile copiare il link");
    }
  }, [link, toast]);

  return (
    <div className="mt-3 pt-3 border-t border-slate-200 space-y-1">
      <div className="text-[11px] font-semibold text-slate-700">🔗 Link diretto</div>
      <div className="flex gap-2 items-center">
        <code className="flex-1 truncate text-[10px] text-slate-600 bg-slate-100 px-2 py-1 rounded">
          {link}
        </code>
        <button
          onClick={handleCopy}
          className="rounded bg-slate-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-slate-700"
        >
          {copied ? "✓ Copiato" : "📋 Copia"}
        </button>
      </div>
    </div>
  );
}
