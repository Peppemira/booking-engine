"use client";
import React from "react";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, authHeaders, checkSession, getApiBase, logoutSession } from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";
import SniperPanel from "./SniperPanel";

const DEFAULT_REFRESH_SECONDS = 8;
const SESSIONI_CACHE_KEY = "prenotazioni.sessioni.cache.v1";

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultSessionFilterDates() {
  const from = new Date();
  const to = new Date(from);
  to.setDate(to.getDate() + 29);
  return {
    dataDa: toIsoDate(from),
    dataA: toIsoDate(to),
  };
}

function getPreferredApiBase() {
  const runtimeBase = String(getApiBase() || API_BASE).trim() || API_BASE;
  if (typeof window !== "undefined") {
    const host = String(window.location.hostname || "").toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      const runtimeHost = String(runtimeBase || "").toLowerCase();
      if (runtimeHost.includes("localhost") || runtimeHost.includes("127.0.0.1")) {
        return runtimeBase;
      }
      return `${window.location.protocol}//${window.location.hostname}:3000`;
    }
  }
  return runtimeBase;
}

function readSessioniCache() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSIONI_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.sessioni)) return null;
    return {
      sessioni: parsed.sessioni,
      openCount: Number(parsed.openCount || 0),
      lastUpdatedAt: String(parsed.lastUpdatedAt || "")
    };
  } catch (e) {
    return null;
  }
}

function writeSessioniCache(payload) {
  if (typeof window === "undefined") return;
  try {
    const data = {
      sessioni: Array.isArray(payload?.sessioni) ? payload.sessioni : [],
      openCount: Number(payload?.openCount || 0),
      lastUpdatedAt: String(payload?.lastUpdatedAt || "")
    };
    window.localStorage.setItem(SESSIONI_CACHE_KEY, JSON.stringify(data));
  } catch {
    // ignore cache write errors
  }
}

export default function PrenotazioniPage() {
  const router = useRouter();
  const lastAlertSignatureRef = useRef(null);
  const [sessioni, setSessioni] = useState([]);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const defaultFilters = getDefaultSessionFilterDates();
  const [sessionFilters, setSessionFilters] = useState({
    ...defaultFilters,
    orario: "",
    tipoEsame: "",
    // Mostra solo sedute APERTE (come schermata GeCA "APERTA")
    stato: "APERTA",
    codLocalita: "",
    aula: "",
    propriPrenotati: false,
    nascondiNonPrenotabili: false,
  });
  const [approvedSessioniRows, setApprovedSessioniRows] = useState([]);
  const [status, setStatus] = useState("");
  const [openCount, setOpenCount] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [approvedPortalMessage, setApprovedPortalMessage] = useState(null);
  const [refreshSeconds, setRefreshSeconds] = useState(DEFAULT_REFRESH_SECONDS);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [waitlistRows, setWaitlistRows] = useState([]);
  const [selectedWaitlistId, setSelectedWaitlistId] = useState("");
  const [candidateActionPayload, setCandidateActionPayload] = useState({
    actionType: "new",
    sessionIndex: "0",
    cognome: "",
    cognomePrefix: "",
    codiceFoglioRosa: "",
    marcaOperativa: "",
    turnoEsaminatore: "0",
    codiceLingua: "",
  });
  const [candidateActionStatus, setCandidateActionStatus] = useState("");
  const [candidateActionResult, setCandidateActionResult] = useState(null);
  const [candidateActionBusy, setCandidateActionBusy] = useState(false);
  const [waitlistStatus, setWaitlistStatus] = useState("");
  const [addingToWaitlist, setAddingToWaitlist] = useState(false);
  const [waitlistActionBusy, setWaitlistActionBusy] = useState(false);
  const [newCandidate, setNewCandidate] = useState({ nome: "", cognome: "", codice_fiscale: "" });
  const [candidates, setCandidates] = useState([]);
  const [creatingCandidate, setCreatingCandidate] = useState(false);
  const [candidateStatus, setCandidateStatus] = useState("");
  const [radarData, setRadarData] = useState(null);
  const [radarRefreshSeconds, setRadarRefreshSeconds] = useState(30);

  function buildAlertSignature(openSessions) {
    if (!Array.isArray(openSessions) || !openSessions.length) return "";
    return openSessions.map((s) => `${s?.id ?? s?.sedutaId ?? ""}-${s?.data ?? ""}-${s?.orario ?? ""}`).join("|");
  }

  function normalizePortalBookedRows() {
    if (!Array.isArray(sessioni) || !Array.isArray(approvedSessioniRows)) return [];
    const bySession = new Map();
    for (const s of approvedSessioniRows) {
      const key = `${s?.sedutaId ?? s?.id ?? ""}-${s?.data ?? ""}-${s?.orario ?? ""}`;
      if (!bySession.has(key)) bySession.set(key, []);
      const cands = s?.candidatiPrenotati ?? s?.candidati ?? [];
      for (const c of cands) bySession.get(key).push(c);
    }
    const out = [];
    for (const sess of sessioni) {
      const key = `${sess?.sedutaId ?? sess?.id ?? ""}-${sess?.data ?? sess?.dataEsame ?? ""}-${sess?.orario ?? ""}`;
      out.push({ ...sess, booked: bySession.get(key) || [] });
    }
    return out;
  }

        const [showWaitlistTelegramModal, setShowWaitlistTelegramModal] = useState(false);
        const [showCandidateTelegramHistoryModal, setShowCandidateTelegramHistoryModal] = useState(false);
        const [showWaitlistTelegramHistoryModal, setShowWaitlistTelegramHistoryModal] = useState(false);
        const [showCandidateTelegramSendModal, setShowCandidateTelegramSendModal] = useState(false);
        const [showWaitlistTelegramSendModal, setShowWaitlistTelegramSendModal] = useState(false);
        const [showCandidateTelegramSendAllModal, setShowCandidateTelegramSendAllModal] = useState(false);
        const [showWaitlistTelegramSendAllModal, setShowWaitlistTelegramSendAllModal] = useState(false);
        const [showCandidateTelegramSendCustomModal, setShowCandidateTelegramSendCustomModal] = useState(false);
        const [showWaitlistTelegramSendCustomModal, setShowWaitlistTelegramSendCustomModal] = useState(false);
        const [showCandidateTelegramSendCustomAllModal, setShowCandidateTelegramSendCustomAllModal] = useState(false);
        const [showWaitlistTelegramSendCustomAllModal, setShowWaitlistTelegramSendCustomAllModal] = useState(false);
        const [showCandidateTelegramSendCustomGroupModal, setShowCandidateTelegramSendCustomGroupModal] = useState(false);
        const [showWaitlistTelegramSendCustomGroupModal, setShowWaitlistTelegramSendCustomGroupModal] = useState(false);
        const [showCandidateTelegramSendCustomGroupAllModal, setShowCandidateTelegramSendCustomGroupAllModal] = useState(false);
        const [showWaitlistTelegramSendCustomGroupAllModal, setShowWaitlistTelegramSendCustomGroupAllModal] = useState(false);
        const [showCandidateTelegramSendCustomGroupCustomModal, setShowCandidateTelegramSendCustomGroupCustomModal] = useState(false);
        const [showWaitlistTelegramSendCustomGroupCustomModal, setShowWaitlistTelegramSendCustomGroupCustomModal] = useState(false);
        const [showCandidateTelegramSendCustomGroupCustomAllModal, setShowCandidateTelegramSendCustomGroupCustomAllModal] = useState(false);
        const [showWaitlistTelegramSendCustomGroupCustomAllModal, setShowWaitlistTelegramSendCustomGroupCustomAllModal] = useState(false);
        const [showCandidateTelegramSendCustomGroupCustomGroupModal, setShowCandidateTelegramSendCustomGroupCustomGroupModal] = useState(false);
        const [showWaitlistTelegramSendCustomGroupCustomGroupModal, setShowWaitlistTelegramSendCustomGroupCustomGroupModal] = useState(false);
        const [showCandidateTelegramSendCustomGroupCustomGroupAllModal, setShowCandidateTelegramSendCustomGroupCustomGroupAllModal] = useState(false);
        const [showWaitlistTelegramSendCustomGroupCustomGroupAllModal, setShowWaitlistTelegramSendCustomGroupCustomGroupAllModal] = useState(false);
        const [showCandidateTelegramSendCustomGroupCustomGroupCustomModal, setShowCandidateTelegramSendCustomGroupCustomGroupCustomModal] = useState(false);
        const [showWaitlistTelegramSendCustomGroupCustomGroupCustomModal, setShowWaitlistTelegramSendCustomGroupCustomGroupCustomModal] = useState(false);
        const [showCandidateTelegramSendCustomGroupCustomGroupCustomAllModal, setShowCandidateTelegramSendCustomGroupCustomGroupCustomAllModal] = useState(false);
        const [showWaitlistTelegramSendCustomGroupCustomGroupCustomAllModal, setShowWaitlistTelegramSendCustomGroupCustomGroupCustomAllModal] = useState(false);
        const [showCandidateTelegramSendCustomGroupCustomGroupCustomGroupModal, setShowCandidateTelegramSendCustomGroupCustomGroupCustomGroupModal] = useState(false);
        const [showWaitlistTelegramSendCustomGroupCustomGroupCustomGroupModal, setShowWaitlistTelegramSendCustomGroupCustomGroupCustomGroupModal] = useState(false);
        const [showCandidateTelegramSendCustomGroupCustomGroupCustomGroupAllModal, setShowCandidateTelegramSendCustomGroupCustomGroupCustomGroupAllModal] = useState(false);
        const [showWaitlistTelegramSendCustomGroupCustomGroupCustomGroupAllModal, setShowWaitlistTelegramSendCustomGroupCustomGroupCustomGroupAllModal] = useState(false);
        const [showCandidateTelegramSendCustomGroupCustomGroupCustomGroupCustomModal, setShowCandidateTelegramSendCustomGroupCustomGroupCustomGroupCustomModal] = useState(false);
        const [showWaitlistTelegramSendCustomGroupCustomGroupCustomGroupCustomModal, setShowWaitlistTelegramSendCustomGroupCustomGroupCustomGroupCustomModal] = useState(false);
        const [showCandidateTelegramSendCustomGroupCustomGroupCustomGroupCustomAllModal, setShowCandidateTelegramSendCustomGroupCustomGroupCustomGroupCustomAllModal] = useState(false);
        const [showWaitlistTelegramSendCustomGroupCustomGroupCustomGroupCustomAllModal, setShowWaitlistTelegramSendCustomGroupCustomGroupCustomGroupCustomAllModal] = useState(false);
        const [showCandidateTelegramSendCustomGroupCustomGroupCustomGroupCustomGroupModal, setShowCandidateTelegramSendCustomGroupCustomGroupCustomGroupCustomGroupModal] = useState(false);
        const [showWaitlistTelegramSendCustomGroupCustomGroupCustomGroupCustomGroupModal, setShowWaitlistTelegramSendCustomGroupCustomGroupCustomGroupCustomGroupModal] = useState(false);
        const [showCandidateTelegramSendCustomGroupCustomGroupCustomGroupCustomGroupAllModal, setShowCandidateTelegramSendCustomGroupCustomGroupCustomGroupCustomGroupAllModal] = useState(false);
        const [showWaitlistTelegramSendCustomGroupCustomGroupCustomGroupCustomGroupAllModal, setShowWaitlistTelegramSendCustomGroupCustomGroupCustomGroupCustomGroupAllModal] = useState(false);
        const [showCandidateTelegramSendCustomGroupCustomGroupCustomGroupCustomGroupCustomModal, setShowCandidateTelegramSendCustomGroupCustomGroupCustomGroupCustomGroupCustomModal] = useState(false);
        const [showWaitlistTelegramSendCustomGroupCustomGroupCustomGroupCustomGroupCustomModal, setShowWaitlistTelegramSendCustomGroupCustomGroupCustomGroupCustomGroupCustomModal] = useState(false);

  const portalBookedRows = normalizePortalBookedRows();

  function normalizeRefreshSeconds(value) {
    const parsed = Number.parseInt(String(value || "").trim(), 10);
    if (!Number.isFinite(parsed)) return DEFAULT_REFRESH_SECONDS;
    return Math.min(300, Math.max(5, parsed));
  }

  function normalizeRadarRefreshSeconds(value) {
    const parsed = Number.parseInt(String(value || "").trim(), 10);
    if (!Number.isFinite(parsed)) return 10;
    // Il radar può aggiornare tra 1 e 30 secondi
    return Math.min(30, Math.max(1, parsed));
  }

  async function onLogout() {
    await logoutSession();
    router.replace("/login");
  }

  const sendTelegramAlert = useCallback(async (openSessions) => {
    if (!Array.isArray(openSessions) || !openSessions.length) return;

    const signature = buildAlertSignature(openSessions);
    if (!signature || signature === lastAlertSignatureRef.current) return;

    try {
      const res = await fetch(`${getPreferredApiBase()}/api/telegram/sessioni-alert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          totalOpen: openSessions.length,
          entries: openSessions,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        lastAlertSignatureRef.current = signature;
      }
    } catch {
    }
  }, []);

  const refreshSessioni = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const parseDateOnly = (value) => {
        const raw = String(value || "").trim();
        if (!raw) return null;
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return null;
        return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
      };

      const dataDa = parseDateOnly(sessionFilters.dataDa);
      const dataA = parseDateOnly(sessionFilters.dataA);
      if (dataDa && dataA) {
        if (dataDa.getTime() > dataA.getTime()) {
          throw new Error("La data inizio è successiva alla data fine.");
        }
        const maxEnd = new Date(dataDa.getTime() + 30 * 24 * 60 * 60 * 1000);
        if (dataA.getTime() > maxEnd.getTime()) {
          throw new Error("L'intervallo date non può superare 30 giorni.");
        }
      }

      const res = await fetch(`${getPreferredApiBase()}/api/portal/sessioni-preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        // trace: true per avere maggiori informazioni dal backend (solo diagnostica)
        body: JSON.stringify({ viewOnly: true, includeCandidates: false, trace: true, filters: sessionFilters }),
      });

      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Ricerca sedute non riuscita (HTTP ${res.status})`);
      }

      const rows = Array.isArray(data.sessioni) ? data.sessioni : [];
      const openSessions = rows.filter((item) => item?.canInsertCandidate || item?.sedutaStato === "APERTA");
      const updatedAt = new Date().toLocaleTimeString("it-IT");

      setSessioni(rows);
      setApprovedSessioniRows([]);
      setOpenCount(openSessions.length);
      setLastUpdatedAt(updatedAt);
      setApprovedPortalMessage(null);
      const approvedWarning = "";
      setStatus(`Aggiornato alle ${updatedAt}: ${rows.length} sedute totali, ${openSessions.length} con disponibilità.${approvedWarning}`);
      writeSessioniCache({
        sessioni: rows,
        openCount: openSessions.length,
        lastUpdatedAt: updatedAt,
      });

      if (openSessions.length > 0) {
        await sendTelegramAlert(openSessions);
      }
    } catch (error) {
      setStatus(`Errore aggiornamento sedute: ${error.message || "errore sconosciuto"}`);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [sendTelegramAlert, sessionFilters]);

  const loadCandidates = useCallback(async () => {
    const res = await fetch(`${getPreferredApiBase()}/api/candidates`, {
      headers: { ...authHeaders() },
    });
    const data = await res.json().catch(() => []);
    const rows = Array.isArray(data) ? data : [];
    setCandidates(rows);
    return rows;
  }, []);

  const loadWaitlist = useCallback(async () => {
    const res = await fetch(`${getPreferredApiBase()}/api/waitlist`, {
      headers: { ...authHeaders() },
    });
    const data = await res.json().catch(() => []);
    const rows = Array.isArray(data) ? data : [];
    setWaitlistRows(rows);
    return rows;
  }, []);

  const addCandidateToWaitlist = useCallback(async () => {
    setWaitlistStatus("");
    const candidateId = String(selectedCandidateId || "").trim();
    if (!candidateId) {
      setWaitlistStatus("Seleziona un candidato da inserire in lista di attesa.");
      return;
    }

    setAddingToWaitlist(true);
    try {
      const res = await fetch(`${getPreferredApiBase()}/api/waitlist/select`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ candidateIds: [candidateId] }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Inserimento in lista attesa non riuscito (HTTP ${res.status})`);
      }

      const rows = await loadWaitlist();
      if (Array.isArray(rows) && rows.length) {
        setSelectedWaitlistId(String(rows[0].id || ""));
      }
      setWaitlistStatus("Candidato inserito in lista di attesa.");
    } catch (error) {
      setWaitlistStatus(`Errore lista attesa: ${error.message || "errore sconosciuto"}`);
    } finally {
      setAddingToWaitlist(false);
    }
  }, [loadWaitlist, selectedCandidateId]);

  const createCandidate = useCallback(
    async (e) => {
      e?.preventDefault?.();
      const nome = String(newCandidate.nome || "").trim();
      const cognome = String(newCandidate.cognome || "").trim();
      if (!nome || !cognome) {
        setCandidateStatus("Inserisci almeno nome e cognome.");
        return;
      }
      setCreatingCandidate(true);
      setCandidateStatus("");
      try {
        const res = await fetch(`${getPreferredApiBase()}/api/candidates`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({
            nome,
            cognome,
            codice_fiscale: String(newCandidate.codice_fiscale || "").trim() || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `Creazione candidato fallita (HTTP ${res.status})`);
        }
        setNewCandidate({ nome: "", cognome: "", codice_fiscale: "" });
        const rows = await loadCandidates();
        const newId = data?.candidate?.id;
        if (newId != null && Array.isArray(rows) && rows.length) {
          setSelectedCandidateId(String(newId));
        }
        setCandidateStatus("Candidato creato correttamente.");
      } catch (error) {
        setCandidateStatus(`Errore: ${error.message || "errore sconosciuto"}`);
      } finally {
        setCreatingCandidate(false);
      }
    },
    [newCandidate, loadCandidates],
  );

  const runWaitlistAction = useCallback(async (actionType) => {
    const waitlistId = String(selectedWaitlistId || "").trim();
    if (!waitlistId) {
      setWaitlistStatus("Seleziona una riga della lista di attesa.");
      return;
    }

    setWaitlistActionBusy(true);
    try {
      let res;
      if (actionType === "up" || actionType === "down") {
        res = await fetch(`${getPreferredApiBase()}/api/waitlist/${waitlistId}/priority`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({ direction: actionType }),
        });
      } else if (actionType === "delete") {
        res = await fetch(`${getPreferredApiBase()}/api/waitlist/${waitlistId}`, {
          method: "DELETE",
          headers: {
            ...authHeaders(),
          },
        });
      } else if (actionType === "retry") {
        res = await fetch(`${getPreferredApiBase()}/api/waitlist/${waitlistId}/retry`, {
          method: "POST",
          headers: {
            ...authHeaders(),
          },
        });
      } else {
        throw new Error("Azione lista attesa non supportata");
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `Azione lista attesa non riuscita (HTTP ${res.status})`);
      }

      const rows = await loadWaitlist();
      if (!rows.length) {
        setSelectedWaitlistId("");
      } else if (!rows.some((row) => String(row.id) === waitlistId)) {
        setSelectedWaitlistId(String(rows[0].id || ""));
      }

      if (actionType === "up") setWaitlistStatus("Candidato spostato in alto.");
      if (actionType === "down") setWaitlistStatus("Candidato spostato in basso.");
      if (actionType === "delete") setWaitlistStatus("Candidato rimosso dalla lista attesa.");
      if (actionType === "retry") setWaitlistStatus("Esito resettato: candidato rimesso in pending.");
    } catch (error) {
      setWaitlistStatus(`Errore lista attesa: ${error.message || "errore sconosciuto"}`);
    } finally {
      setWaitlistActionBusy(false);
    }
  }, [loadWaitlist, selectedWaitlistId]);

  const useWaitlistRowInCandidateAction = useCallback(() => {
    const waitlistId = String(selectedWaitlistId || "").trim();
    if (!waitlistId) {
      setWaitlistStatus("Seleziona un candidato in lista attesa.");
      return;
    }
    const row = waitlistRows.find((item) => String(item?.id || "") === waitlistId);
    if (!row) {
      setWaitlistStatus("Riga lista attesa non trovata.");
      return;
    }

    const cognomeValue = String(row?.cognome || "").trim();
    const prefix = cognomeValue.slice(0, 3);
    setCandidateActionPayload((prev) => ({
      ...prev,
      actionType: "new",
      cognome: cognomeValue,
      cognomePrefix: prefix,
      codiceFoglioRosa: String(row?.codice_fiscale || "").trim(),
      turnoEsaminatore: String(row?.turnoPreferito || prev.turnoEsaminatore || "0").trim() || "0",
      codiceLingua: String(row?.lingua || "").trim(),
    }));
    setCandidateActionStatus(`Candidato ${cognomeValue || "selezionato"} caricato nelle azioni portale.`);
  }, [selectedWaitlistId, waitlistRows]);

  const runCandidatePortalAction = useCallback(async () => {
    setCandidateActionStatus("");
    setCandidateActionResult(null);

    const actionType = String(candidateActionPayload.actionType || "search").trim().toLowerCase();
    const sessionIndexParsed = Number.parseInt(String(candidateActionPayload.sessionIndex || "0").trim(), 10);
    const sessionIndex = Number.isFinite(sessionIndexParsed) ? Math.max(0, sessionIndexParsed) : 0;

    const candidate = {
      cognome: String(candidateActionPayload.cognome || "").trim(),
      cognomePrefix: String(candidateActionPayload.cognomePrefix || "").trim(),
      codiceFoglioRosa: String(candidateActionPayload.codiceFoglioRosa || "").trim(),
      marcaOperativa: String(candidateActionPayload.marcaOperativa || "").trim(),
      turnoEsaminatore: String(candidateActionPayload.turnoEsaminatore || "0").trim(),
      codiceLingua: String(candidateActionPayload.codiceLingua || "").trim(),
    };

    if (!candidate.cognome && !candidate.cognomePrefix && !candidate.codiceFoglioRosa && !candidate.marcaOperativa) {
      setCandidateActionStatus("Compila almeno uno tra cognome, prefisso cognome, codice foglio rosa o marca operativa.");
      return;
    }

    setCandidateActionBusy(true);
    try {
      const res = await fetch(`${getPreferredApiBase()}/api/portal/prenotazione-candidato`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          actionType,
          sessionIndex,
          candidate,
          trace: true,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Azione candidato non riuscita (HTTP ${res.status})`);
      }

      setCandidateActionResult(data);
      const indicators = data?.indicators || {};
      const message = data?.portalMessage || "Risposta ricevuta dal portale.";
      const esito = indicators.containsSuccess
        ? "SUCCESSO"
        : indicators.containsAlreadyBooked
          ? "CANDIDATO GIÀ PRENOTATO"
          : indicators.containsNoSeats
            ? "POSTI NON DISPONIBILI"
            : "ESITO NON DETERMINATO";
      setCandidateActionStatus(`${esito} - ${message}`);
    } catch (error) {
      setCandidateActionStatus(`Errore azione candidato: ${error.message || "errore sconosciuto"}`);
    } finally {
      setCandidateActionBusy(false);
    }
  }, [candidateActionPayload]);

  const selectSessionIndexFromRow = useCallback((idx) => {
    const normalized = Number.isFinite(Number(idx)) ? String(Math.max(0, Number(idx))) : "0";
    setCandidateActionPayload((prev) => ({ ...prev, sessionIndex: normalized }));
    setCandidateActionStatus(`Sessione selezionata dalla tabella: indice ${normalized}`);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function verifyAndInit() {
      const session = await checkSession();
      if (!session.ok) {
        if (!cancelled) router.replace("/login");
        return;
      }
      if (!cancelled) {
        setReady(true);

        const cached = readSessioniCache();
        if (cached) {
          setSessioni(cached.sessioni);
          setOpenCount(cached.openCount);
          setLastUpdatedAt(cached.lastUpdatedAt);
          setStatus(`Dati cache caricati (${cached.sessioni.length} sedute). Aggiornamento in corso...`);
        }

        refreshSessioni({ silent: true });
        const [candidateRows] = await Promise.all([
          loadCandidates(),
          loadWaitlist(),
        ]);
        if (Array.isArray(candidateRows) && candidateRows.length) {
          setSelectedCandidateId(String(candidateRows[0]?.id || ""));
        }
      }
    }

    verifyAndInit();
    return () => {
      cancelled = true;
    };
  }, [loadCandidates, loadWaitlist, refreshSessioni, router]);

  useEffect(() => {
    if (!ready) return undefined;

    const timer = setInterval(() => {
      refreshSessioni({ silent: true });
    }, normalizeRefreshSeconds(refreshSeconds) * 1000);

    return () => clearInterval(timer);
  }, [ready, refreshSeconds, refreshSessioni]);

  const fetchRadarDashboard = useCallback(async () => {
    try {
      const res = await fetch(`${getPreferredApiBase()}/api/radar/dashboard`, {
        headers: { ...authHeaders() },
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setRadarData(json);
    } catch {
      setRadarData(null);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    fetchRadarDashboard();
    const t = setInterval(
      fetchRadarDashboard,
      normalizeRadarRefreshSeconds(radarRefreshSeconds) * 1000
    );
    return () => clearInterval(t);
  }, [ready, fetchRadarDashboard, radarRefreshSeconds]);

  const approvedSessioni = Array.isArray(approvedSessioniRows) ? approvedSessioniRows : [];

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-100 p-6">
        <main className="mx-auto max-w-5xl rounded-xl bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-700">Verifica sessione...</p>
        </main>
      </div>
    );
  }




  return (
    <ModernAppShell
      title="Prenotazioni"
      subtitle="Monitor sedute e prenotazioni portale"
      activeKey="prenotazioni"
      onLogout={onLogout}
    >
      <React.Fragment>
        {/* Radar KPIs (unificato con ex-pagina Radar) */}
        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h3 className="mb-3 text-lg font-bold text-slate-900">Stato prenotazioni</h3>
        <div className="flex flex-wrap items-center gap-2">
          {radarData?.radarAttivo && (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
              Radar attivo
            </span>
          )}
          {radarData?.radarOk === false && radarData?.radarAttivo && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              Portale temporaneamente non raggiungibile
            </span>
          )}
          <label className="ml-auto flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200">
            Radar (sec)
            <input
              type="number"
              min={1}
              max={30}
              value={radarRefreshSeconds}
              onChange={(e) => setRadarRefreshSeconds(normalizeRadarRefreshSeconds(e.target.value))}
              className="w-16 rounded border border-slate-300 px-2 py-0.5 text-xs"
            />
            <span className="text-slate-400">
              ogni {normalizeRadarRefreshSeconds(radarRefreshSeconds)}s
            </span>
          </label>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <KpiCard title="Sedute con posti" value={radarData?.seduteDisponibili ?? openCount} subtitle="sessioni aperte" />
            <KpiCard title="Posti liberi" value={radarData?.totalePostiLiberi ?? "–"} subtitle="totale posti" />
            <KpiCard title="In coda attesa" value={radarData?.inCoda ?? "–"} subtitle="lista attesa" />
            <KpiCard title="Prenotati" value={radarData?.prenotazioniEseguite ?? "–"} subtitle={`oggi: ${radarData?.prenotazioniEseguiteOggi ?? 0}`} />
          </div>
        </section>

        <h2 className="text-3xl font-black text-slate-900">Sedute Portale</h2>
        <p className="mt-1 text-sm text-slate-500">Tabella sedute con refresh automatico (5-300 sec). Cerca seduta, seleziona riga, poi esegui azione candidato.</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => refreshSessioni()}
            className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-600"
          >
            {loading ? "Aggiornamento..." : "Aggiorna ora"}
          </button>
          <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200">
            Refresh (sec)
            <input
              type="number"
              min={5}
              max={300}
              value={refreshSeconds}
              onChange={(e) => setRefreshSeconds(normalizeRefreshSeconds(e.target.value))}
              className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <span className="rounded-xl bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800">
            Sedute con disponibilità: {openCount}
          </span>
          {loading ? (
            <span className="inline-flex items-center gap-2 rounded-xl bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-hidden />
              Aggiornamento sedute in corso...
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              Ultimo aggiornamento: {lastUpdatedAt || "-"}
            </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-5">
          <label className="rounded-xl bg-white px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200">
            Mostra dal
            <input
              type="date"
              value={sessionFilters.dataDa}
              onChange={(e) => setSessionFilters((prev) => ({ ...prev, dataDa: e.target.value }))}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>

          <label className="rounded-xl bg-white px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200">
            Mostra al
            <input
              type="date"
              value={sessionFilters.dataA}
              onChange={(e) => setSessionFilters((prev) => ({ ...prev, dataA: e.target.value }))}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>

          <label className="rounded-xl bg-white px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200">
            Orario
            <select
              value={sessionFilters.orario}
              onChange={(e) => setSessionFilters((prev) => ({ ...prev, orario: e.target.value }))}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">Tutti</option>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </label>

          <label className="rounded-xl bg-white px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200">
            Tipo
            <select
              value={sessionFilters.tipoEsame}
              onChange={(e) => setSessionFilters((prev) => ({ ...prev, tipoEsame: e.target.value }))}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">TUTTI</option>
              <option value="QUIZ">QUIZ</option>
              <option value="GUIDA">GUIDA</option>
              <option value="CQC">CQC</option>
            </select>
          </label>

          <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">
            Stato: <span className="font-semibold">APERTA</span> (il gestionale mostra solo sedute aperte, come schermata GeCA APERTA)
          </div>

          <label className="rounded-xl bg-white px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200">
            Cod. Località
            <input
              type="text"
              value={sessionFilters.codLocalita}
              onChange={(e) => setSessionFilters((prev) => ({ ...prev, codLocalita: e.target.value }))}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>

          <label className="rounded-xl bg-white px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200">
            Aula N°
            <input
              type="text"
              value={sessionFilters.aula}
              onChange={(e) => setSessionFilters((prev) => ({ ...prev, aula: e.target.value }))}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>

          <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200">
            <input
              type="checkbox"
              checked={sessionFilters.propriPrenotati}
              onChange={(e) => setSessionFilters((prev) => ({ ...prev, propriPrenotati: e.target.checked }))}
            />
            Propri prenotati
          </label>

          <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200">
            <input
              type="checkbox"
              checked={sessionFilters.nascondiNonPrenotabili}
              onChange={(e) => setSessionFilters((prev) => ({ ...prev, nascondiNonPrenotabili: e.target.checked }))}
            />
            Nascondi non prenotabili
          </label>
        </div>

        <p className={`mt-2 rounded-xl px-3 py-2 text-sm ${status.startsWith('Errore') ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'}`}>{status}</p>

        {/* Sedute Aperte */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-1">
        <div className="max-h-[50vh] overflow-y-auto overflow-x-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-3 py-2">
            <h3 className="text-sm font-bold text-slate-900">Sedute Aperte</h3>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-2 text-left whitespace-nowrap">Data Ses.</th>
                <th className="p-2 text-left whitespace-nowrap">Limite Pren.</th>
                <th className="p-2 text-left whitespace-nowrap">Esame</th>
                <th className="p-2 text-left whitespace-nowrap">F.O</th>
                <th className="p-2 text-left whitespace-nowrap">Aula</th>
                <th className="p-2 text-left whitespace-nowrap">Turni</th>
                <th className="p-2 text-left whitespace-nowrap">Stato</th>
                <th className="p-2 text-left whitespace-nowrap">Posti Liberi</th>
                <th className="p-2 text-left whitespace-nowrap">Prenotati</th>
                <th className="p-2 text-left whitespace-nowrap">Posti Autoscuola</th>
                <th className="p-2 text-left whitespace-nowrap">Proprie Prenotazioni</th>
                <th className="p-2 text-left whitespace-nowrap">Desc. Località</th>
                <th className="p-2 text-left whitespace-nowrap">Disponibilità</th>
              </tr>
            </thead>
            <tbody>
              {sessioni.map((item, idx) => {
              const isSelected = String(candidateActionPayload.sessionIndex || "0") === String(idx);
              const postiLiberiRaw = String(item?.postiLiberi ?? "").trim();
              const postiLiberiNumber = Number.parseInt(postiLiberiRaw, 10);
              const postiLiberi = Number.isFinite(postiLiberiNumber) && postiLiberiNumber >= 0 ? String(postiLiberiNumber) : "0";
              const prenotati = String(item?.postiOccupati ?? "").trim() || "-";
              const postiAutoscuola = String(item?.postiAutoscuola ?? "").trim() || "-";
              const propriePrenotazioni = String(item?.propriePrenotazioni ?? "").trim() || "-";
              const hasSeats = postiLiberiNumber > 0;
              return (
                  <tr
                    key={`${item?.sessionId || item?.data || "row"}-${idx}`}
                    className={`border-t ${isSelected ? "bg-indigo-50" : ""} cursor-pointer hover:bg-slate-50`}
                    onClick={() => selectSessionIndexFromRow(idx)}
                    title={`Seleziona session index ${idx} per azioni candidato`}
                  >
                    <td className="p-2 whitespace-nowrap">{item?.data || item?.dataIpotetica || "-"}</td>
                    <td className="p-2 whitespace-nowrap">{item?.dataLimitePrenotazione || "-"}</td>
                    <td className="p-2 whitespace-nowrap">{item?.tipoEsame || "-"}</td>
                    <td className="p-2 whitespace-nowrap">{item?.amPm || "-"}</td>
                    <td className="p-2 whitespace-nowrap">{item?.aula || "-"}</td>
                    <td className="p-2 whitespace-nowrap">{item?.turni || "-"}</td>
                    <td className="p-2 whitespace-nowrap">{item?.stato || item?.sedutaStato || "-"}</td>
                    <td className="p-2 whitespace-nowrap">{postiLiberi}</td>
                    <td className="p-2 whitespace-nowrap">{prenotati}</td>
                    <td className="p-2 whitespace-nowrap">{postiAutoscuola}</td>
                    <td className="p-2 whitespace-nowrap">{propriePrenotazioni}</td>
                    <td className="p-2 whitespace-nowrap">{item?.localita || item?.autoscuola || "-"}</td>
                    <td className="p-2 whitespace-nowrap">
                      <span className={`rounded px-2 py-1 text-xs font-semibold ${hasSeats ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                        {hasSeats ? "POSTI DISPONIBILI" : "NESSUN POSTO DISPONIBILE"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!sessioni.length && (
                <tr className="border-t">
                  <td className="p-3 text-slate-500" colSpan={14}>Nessuna seduta aperta disponibile al momento.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Sedute Approvate – ora integrate nella tabella principale tramite filtro Stato (APERTA/APPROVATA) */}
        </div>

        {/* Dettaglio seduta selezionata */}
        {(() => {
          const selIdx = Number(candidateActionPayload.sessionIndex || 0);
          const sel = sessioni[selIdx];
          if (!sel) return null;

          const postiLib = parseInt(String(sel?.postiLiberi ?? "0").replace(/\D/g, ""), 10) || 0;
          const postiOcc = parseInt(String(sel?.postiOccupati ?? "0").replace(/\D/g, ""), 10) || 0;
          const postiTot = postiLib + postiOcc;
          const percOcc = postiTot > 0 ? Math.round((postiOcc / postiTot) * 100) : 0;

          // Calcola giorni alla sessione
          const dataStr = sel?.data || sel?.dataIpotetica || "";
          const dm = String(dataStr).match(/(\d{2})\/(\d{2})\/(\d{4})/);
          let giorniInfo = "";
          if (dm) {
            const sessDate = new Date(`${dm[3]}-${dm[2]}-${dm[1]}T00:00:00`);
            const now = new Date(); now.setHours(0, 0, 0, 0);
            const diff = Math.round((sessDate - now) / 86400000);
            giorniInfo = diff === 0 ? "OGGI" : diff === 1 ? "DOMANI" : diff > 0 ? `tra ${diff} giorni` : `${Math.abs(diff)} giorni fa`;
          }

          return (
            <div className="mt-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-bold text-indigo-900">Dettaglio Seduta Selezionata (#{selIdx})</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${postiLib > 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                  {postiLib > 0 ? `${postiLib} POSTI LIBERI` : "COMPLETA"}
                </span>
                {giorniInfo && (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{giorniInfo}</span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
                <div><span className="text-indigo-400 font-medium block">Data Sessione</span><span className="text-indigo-900 font-bold">{sel?.data || sel?.dataIpotetica || "-"}</span></div>
                <div><span className="text-indigo-400 font-medium block">Limite Prenotazione</span><span className="text-indigo-900 font-bold">{sel?.dataLimitePrenotazione || "-"}</span></div>
                <div><span className="text-indigo-400 font-medium block">Tipo Esame</span><span className="text-indigo-900 font-bold">{sel?.tipoEsame || "-"}</span></div>
                <div><span className="text-indigo-400 font-medium block">Fascia Oraria</span><span className="text-indigo-900 font-bold">{sel?.amPm || "-"}</span></div>
                <div><span className="text-indigo-400 font-medium block">Aula</span><span className="text-indigo-900 font-bold">{sel?.aula || "-"}</span></div>
                <div><span className="text-indigo-400 font-medium block">Turni</span><span className="text-indigo-900 font-bold">{sel?.turni || "-"}</span></div>
                <div><span className="text-indigo-400 font-medium block">Stato</span><span className="text-indigo-900 font-bold">{sel?.stato || sel?.sedutaStato || "-"}</span></div>
                <div><span className="text-indigo-400 font-medium block">Posti Liberi</span><span className="text-indigo-900 font-bold">{postiLib}</span></div>
                <div><span className="text-indigo-400 font-medium block">Prenotati</span><span className="text-indigo-900 font-bold">{postiOcc}</span></div>
                <div><span className="text-indigo-400 font-medium block">Occupazione</span><span className="text-indigo-900 font-bold">{postiTot > 0 ? `${percOcc}% (${postiOcc}/${postiTot})` : "-"}</span></div>
                <div><span className="text-indigo-400 font-medium block">Posti Autoscuola</span><span className="text-indigo-900 font-bold">{sel?.postiAutoscuola || "-"}</span></div>
                <div><span className="text-indigo-400 font-medium block">Proprie Prenotazioni</span><span className="text-indigo-900 font-bold">{sel?.propriePrenotazioni || "-"}</span></div>
                <div><span className="text-indigo-400 font-medium block">Località</span><span className="text-indigo-900 font-bold">{sel?.localita || sel?.autoscuola || "-"}</span></div>
                {sel?.codLocalita && <div><span className="text-indigo-400 font-medium block">Cod. Località</span><span className="text-indigo-900 font-bold">{sel.codLocalita}</span></div>}
                {sel?.sessionId && <div><span className="text-indigo-400 font-medium block">Session ID</span><span className="text-indigo-900 font-bold text-[10px]">{sel.sessionId}</span></div>}
              </div>
            </div>
          );
        })()}

        {/* Allievi prenotati + Lista attesa affiancate */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="max-h-[35vh] overflow-y-auto overflow-x-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-3 py-2">
            <h3 className="text-sm font-bold text-slate-900">Allievi prenotati (portale)</h3>
          </div>
          <table className="w-full text-xs [&_th]:whitespace-nowrap [&_th]:truncate [&_td]:whitespace-nowrap [&_td]:truncate">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-2 text-left">Marca Operativa</th>
                <th className="p-2 text-left">Cognome</th>
                <th className="p-2 text-left">Nome</th>
                <th className="p-2 text-left">Codice Statino</th>
                <th className="p-2 text-left">Tipo Esame</th>
              </tr>
            </thead>
            <tbody>
              {portalBookedRows.map((row, i) => (
               <tr key={row.id || row.marca_operativa || i} className="border-t">
                  <td className="p-2">{row.marca_operativa || "-"}</td>
                  <td className="p-2">{row.cognome || "-"}</td>
                  <td className="p-2">{row.nome || "-"}</td>
                  <td className="p-2">{row.codice_statino || "-"}</td>
                  <td className="p-2">{row.tipo_esame || "-"}</td>
                </tr>
              ))}
              {!portalBookedRows.length && (
                <tr className="border-t">
                  <td className="p-3 text-slate-500" colSpan={5}>Nessun candidato prenotato importato dal portale.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Sniper Engine ──────────────────────────────────────────── */}
        <div className="mb-3">
          <SniperPanel />
        </div>

        <div className="max-h-[35vh] overflow-y-auto overflow-x-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-3 py-2">
            <h3 className="text-sm font-bold text-slate-900">Lista di attesa</h3>
          </div>
          <table className="w-full text-xs [&_th]:whitespace-nowrap [&_th]:truncate [&_td]:whitespace-nowrap [&_td]:truncate">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-2 text-left">N°</th>
                <th className="p-2 text-left">Cognome</th>
                <th className="p-2 text-left">Codice Cand.</th>
                <th className="p-2 text-left">Turno Prefer.</th>
                <th className="p-2 text-left">Lingua</th>
                <th className="p-2 text-left">Supp. Audio</th>
                <th className="p-2 text-left">Priorità</th>
                <th className="p-2 text-left">Esito</th>
              </tr>
            </thead>
            <tbody>
              {waitlistRows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-t cursor-pointer hover:bg-slate-50 ${String(selectedWaitlistId || "") === String(row.id || "") ? "bg-indigo-50" : ""}`}
                  onClick={() => setSelectedWaitlistId(String(row.id || ""))}
                >
                  <td className="p-2">{row.queueNr ?? "-"}</td>
                  <td className="p-2">{`${row.cognome || ""} ${row.nome || ""}`.trim() || "-"}</td>
                  <td className="p-2">{row.codice_fiscale || row.candidate_id || "-"}</td>
                  <td className="p-2">{row.turnoPreferito || "-"}</td>
                  <td className="p-2">{row.lingua || "-"}</td>
                  <td className="p-2">{row.supportoAudio || "-"}</td>
                  <td className="p-2">{row.priority ?? "-"}</td>
                  <td className="p-2">{row.esito || row.status || "-"}</td>
                </tr>
              ))}
              {!waitlistRows.length && (
                <tr className="border-t">
                  <td className="p-3 text-slate-500" colSpan={8}>Nessun candidato in lista di attesa.</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="border-t border-slate-200 bg-slate-50 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => runWaitlistAction("up")}
                disabled={waitlistActionBusy || !waitlistRows.length}
                className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sposta su
              </button>
              <button
                onClick={() => runWaitlistAction("down")}
                disabled={waitlistActionBusy || !waitlistRows.length}
                className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sposta giù
              </button>
              <button
                onClick={() => runWaitlistAction("retry")}
                disabled={waitlistActionBusy || !waitlistRows.length}
                className="rounded border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Ripristina pending
              </button>
              <button
                onClick={() => runWaitlistAction("delete")}
                disabled={waitlistActionBusy || !waitlistRows.length}
                className="rounded border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Elimina da lista
              </button>
              <button
                onClick={useWaitlistRowInCandidateAction}
                disabled={!waitlistRows.length}
                className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Usa in azione candidato
              </button>
            </div>
          </div>
        </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h3 className="text-lg font-bold text-slate-900">Aggiungi nuovo candidato</h3>
            <form onSubmit={createCandidate} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                type="text"
                placeholder="Nome"
                value={newCandidate.nome}
                onChange={(e) => setNewCandidate((prev) => ({ ...prev, nome: e.target.value }))}
                className="rounded border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="Cognome"
                value={newCandidate.cognome}
                onChange={(e) => setNewCandidate((prev) => ({ ...prev, cognome: e.target.value }))}
                className="rounded border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="Codice fiscale (opzionale)"
                value={newCandidate.codice_fiscale}
                onChange={(e) => setNewCandidate((prev) => ({ ...prev, codice_fiscale: e.target.value }))}
                className="rounded border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={creatingCandidate}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {creatingCandidate ? "Creazione..." : "Aggiungi nuovo candidato"}
              </button>
            </form>
            <p className="mt-2 text-xs text-slate-600">{candidateStatus || `Candidati disponibili: ${candidates.length}`}</p>
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h3 className="text-lg font-bold text-slate-900">Inserimento in lista di attesa</h3>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={selectedCandidateId}
                onChange={(e) => setSelectedCandidateId(e.target.value)}
                className="min-w-70 rounded border border-slate-300 px-3 py-2 text-sm"
              >
                {!candidates.length && <option value="">Nessun candidato disponibile</option>}
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {`${c.cognome || ""} ${c.nome || ""}`.trim()} {c.codice_fiscale ? `- ${c.codice_fiscale}` : ""}
                  </option>
                ))}
              </select>
              <button
                onClick={addCandidateToWaitlist}
                disabled={addingToWaitlist || !candidates.length}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {addingToWaitlist ? "Inserimento..." : "Inserisci in lista di attesa"}
              </button>
              <button
                onClick={() => loadWaitlist()}
                className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-300"
              >
                Aggiorna lista
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600">{waitlistStatus || `Voci in lista di attesa: ${waitlistRows.length}`}</p>
          </section>
        </div>

        <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h3 className="text-lg font-bold text-slate-900">Prenotazione candidato su portale (flusso GeCA)</h3>
          <p className="mt-1 text-xs text-slate-500">1) Clicca una riga nella tabella Sedute Aperte per selezionare la sessione. 2) Compila Cognome + Codice foglio rosa (o Marca operativa). 3) Azione &quot;new&quot; = prenota nuovo. 4) Clicca &quot;Esegui azione candidato&quot;.</p>

          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
            <label className="text-xs text-slate-600">
              Azione
              <select
                value={candidateActionPayload.actionType}
                onChange={(e) => setCandidateActionPayload((prev) => ({ ...prev, actionType: e.target.value }))}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="search">search</option>
                <option value="new">new</option>
                <option value="edit">edit</option>
                <option value="delete">delete</option>
                <option value="replace">replace</option>
              </select>
            </label>

            <label className="text-xs text-slate-600">
              Session index
              <input
                type="number"
                min={0}
                value={candidateActionPayload.sessionIndex}
                onChange={(e) => setCandidateActionPayload((prev) => ({ ...prev, sessionIndex: e.target.value }))}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs text-slate-600">
              Cognome
              <input
                type="text"
                value={candidateActionPayload.cognome}
                onChange={(e) => {
                  const nextCognome = e.target.value;
                  setCandidateActionPayload((prev) => ({
                    ...prev,
                    cognome: nextCognome,
                    cognomePrefix: String(nextCognome || "").trim().slice(0, 3),
                  }));
                }}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs text-slate-600">
              Prefisso cognome
              <input
                type="text"
                value={candidateActionPayload.cognomePrefix}
                onChange={(e) => setCandidateActionPayload((prev) => ({ ...prev, cognomePrefix: e.target.value }))}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs text-slate-600">
              Codice foglio rosa
              <input
                type="text"
                value={candidateActionPayload.codiceFoglioRosa}
                onChange={(e) => setCandidateActionPayload((prev) => ({ ...prev, codiceFoglioRosa: e.target.value }))}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs text-slate-600">
              Marca operativa
              <input
                type="text"
                value={candidateActionPayload.marcaOperativa}
                onChange={(e) => setCandidateActionPayload((prev) => ({ ...prev, marcaOperativa: e.target.value }))}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs text-slate-600">
              Turno esaminatore
              <input
                type="text"
                value={candidateActionPayload.turnoEsaminatore}
                onChange={(e) => setCandidateActionPayload((prev) => ({ ...prev, turnoEsaminatore: e.target.value }))}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs text-slate-600">
              Codice lingua
              <input
                type="text"
                value={candidateActionPayload.codiceLingua}
                onChange={(e) => setCandidateActionPayload((prev) => ({ ...prev, codiceLingua: e.target.value }))}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={runCandidatePortalAction}
              disabled={candidateActionBusy}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {candidateActionBusy ? "Invio in corso..." : "Esegui azione candidato"}
            </button>
          </div>

          <p className="mt-2 text-xs text-slate-600">{candidateActionStatus || "Nessuna azione eseguita."}</p>
          {candidateActionResult && (
            <p className="mt-1 text-xs text-slate-500">
              Sessione selezionata: {candidateActionResult.selectedSessionIndex ?? "-"} / Totali: {candidateActionResult.sessionsTotal ?? "-"}
            </p>
          )}
        </section>
      </React.Fragment>
    </ModernAppShell>
  );
}

function KpiCard({ title, value, subtitle }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 ring-1 ring-slate-200">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-bold text-emerald-600">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

