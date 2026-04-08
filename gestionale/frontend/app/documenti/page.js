"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  API_BASE,
  authHeaders,
  checkSession,
  logoutSession,
} from "../../lib/authClient";
import ModernAppShell from "../ModernAppShell";
import { formatData } from "../../lib/candidatoEditor";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const TIPO_DOC_OPTIONS = [
  { value: "", label: "Tutti i tipi" },
  { value: "carta_identita", label: "Carta d'identità" },
  { value: "patente", label: "Patente posseduta" },
  { value: "codice_fiscale", label: "Tessera sanitaria / CF" },
  { value: "foto", label: "Foto candidato" },
  { value: "certificato_medico", label: "Certificato medico" },
  { value: "foglio_rosa", label: "Foglio rosa" },
  { value: "modulo_iscrizione", label: "Modulo iscrizione" },
  { value: "dichiarazione", label: "Dichiarazione" },
  { value: "ricevuta", label: "Ricevuta" },
  { value: "altro", label: "Altro" },
];

const TIPO_FORM_OPTIONS = TIPO_DOC_OPTIONS.slice(1);

const ACCEPT_TYPES = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.gif,.bmp,.tiff";

function tipoChip(tipo) {
  const map = {
    carta_identita:     "bg-blue-100 text-blue-800",
    patente:            "bg-indigo-100 text-indigo-800",
    codice_fiscale:     "bg-sky-100 text-sky-800",
    foto:               "bg-pink-100 text-pink-800",
    certificato_medico: "bg-red-100 text-red-800",
    foglio_rosa:        "bg-emerald-100 text-emerald-800",
    modulo_iscrizione:  "bg-violet-100 text-violet-800",
    dichiarazione:      "bg-amber-100 text-amber-800",
    ricevuta:           "bg-orange-100 text-orange-800",
    altro:              "bg-slate-100 text-slate-700",
  };
  return map[tipo] || "bg-slate-100 text-slate-700";
}

function tipoLabel(tipo) {
  return TIPO_DOC_OPTIONS.find((o) => o.value === tipo)?.label || tipo || "–";
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isImage(mime = "", nome = "") {
  return /^image\//i.test(mime) || /\.(jpe?g|png|webp|gif|bmp|tiff|heic)$/i.test(nome);
}

function isPdf(mime = "", nome = "") {
  return /pdf/i.test(mime) || /\.pdf$/i.test(nome);
}

// ---------------------------------------------------------------------------
// Hook: carica candidati + documenti (da raw_portale.documenti_acquisiti)
// ---------------------------------------------------------------------------

function useDocs() {
  const [candidati, setCandidati] = useState([]);
  const [docs, setDocs] = useState([]);          // [{...doc, _candidatoLabel, _candidatoId}]
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      // 1. Candidati (source of truth per documenti esistenti)
      const resCand = await fetch(`${API_BASE}/api/candidati-api`, {
        headers: authHeaders(), cache: "no-store",
      });
      if (!resCand.ok) throw new Error(`Candidati HTTP ${resCand.status}`);
      const cands = await resCand.json();
      setCandidati(Array.isArray(cands) ? cands : []);

      // 2. Documenti standalone da /api/documenti (se esistenti)
      let standaloneDocs = [];
      try {
        const resDocs = await fetch(`${API_BASE}/api/documenti`, {
          headers: authHeaders(), cache: "no-store",
        });
        if (resDocs.ok) {
          const d = await resDocs.json();
          standaloneDocs = Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : []);
        }
      } catch { /* endpoint opzionale */ }

      // 3. Documenti da raw_portale.documenti_acquisiti dei candidati
      const embeddedDocs = [];
      (Array.isArray(cands) ? cands : []).forEach((c) => {
        const label = `${c.cognome || ""} ${c.nome || ""}`.trim();
        const arr = Array.isArray(c?.raw_portale?.documenti_acquisiti)
          ? c.raw_portale.documenti_acquisiti
          : [];
        arr.forEach((d, i) => {
          embeddedDocs.push({
            id: d.id || `${c.id}_doc_${i}`,
            _source: "embedded",
            _candidatoId: c.id,
            _candidatoLabel: label,
            tipo: d.tipo || d.tipo_documento || "altro",
            nome: d.nome || d.file_name || d.filename || "documento",
            url: d.url || d.file_url || null,
            mime: d.mime || d.content_type || "",
            dimensione: d.dimensione || d.size || null,
            data: d.data || d.created_at || c.created_at,
            note: d.note || "",
          });
        });
      });

      // Merge: standalone prima, embedded dopo (dedup per id)
      const seen = new Set();
      const merged = [...standaloneDocs.map((d) => ({
        ...d, _source: "api",
        _candidatoLabel: (Array.isArray(cands) ? cands : []).find((c) => c.id === d.candidato_id)
          ? `${cands.find((c) => c.id === d.candidato_id).cognome} ${cands.find((c) => c.id === d.candidato_id).nome}`
          : (d.candidato_id || ""),
        _candidatoId: d.candidato_id,
      })), ...embeddedDocs].filter((d) => {
        if (seen.has(d.id)) return false;
        seen.add(d.id); return true;
      });

      setDocs(merged);
    } catch (e) {
      setError(e.message || "Errore caricamento documenti");
    } finally {
      setLoading(false);
    }
  }, []);

  return { candidati, docs, loading, error, load };
}

// ---------------------------------------------------------------------------
// Componente principale
// ---------------------------------------------------------------------------

export default function DocumentiPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);

  const { candidati, docs, loading, error, load } = useDocs();

  const [selected, setSelected] = useState(null);       // documento selezionato
  const [showUpload, setShowUpload] = useState(false);  // pannello upload

  const [filters, setFilters] = useState({
    search: "",
    tipo: "",
    candidato_id: "",
  });

  // Auth
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const session = await checkSession();
      if (!session.ok) { if (!cancelled) router.replace("/login"); return; }
      if (!cancelled) { setUser(session.autoscuola); setPageLoading(false); }
    }
    init();
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => { if (!pageLoading) load(); }, [pageLoading, load]);

  // Filtro
  const filtered = useMemo(() => {
    const search = filters.search.trim().toUpperCase();
    return docs.filter((d) => {
      if (filters.tipo && d.tipo !== filters.tipo) return false;
      if (filters.candidato_id && d._candidatoId !== filters.candidato_id) return false;
      if (search) {
        const hay = [d._candidatoLabel, d.nome, d.tipo, d.note].join(" ").toUpperCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [docs, filters]);

  function handleSelectDoc(d) {
    if (selected?.id === d.id && !showUpload) { setSelected(null); return; }
    setSelected(d); setShowUpload(false);
  }

  function handleOpenUpload() { setSelected(null); setShowUpload(true); }
  function handlePanelClose() { setSelected(null); setShowUpload(false); }

  const showPanel = selected || showUpload;

  if (pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Caricamento...</p>
      </div>
    );
  }

  return (
    <ModernAppShell
      title="Documenti"
      subtitle="Digitalizzazioni, upload, anteprima e download documenti candidati"
      activeKey="documenti"
      onLogout={() => logoutSession().then(() => router.replace("/login"))}
      user={user}
    >
      <div className="flex h-[calc(100vh-120px)] gap-4">
        {/* ── COLONNA SINISTRA ── */}
        <div className={`flex flex-col ${showPanel ? "w-1/2" : "w-full"} transition-all duration-200`}>

          {/* Filtri */}
          <div className="mb-3 flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Cerca candidato, nome file…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-indigo-400 focus:outline-none w-48"
            />
            <select
              value={filters.tipo}
              onChange={(e) => setFilters((f) => ({ ...f, tipo: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none"
            >
              {TIPO_DOC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={filters.candidato_id}
              onChange={(e) => setFilters((f) => ({ ...f, candidato_id: e.target.value }))}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none max-w-48"
            >
              <option value="">Tutti i candidati</option>
              {candidati.map((c) => (
                <option key={c.id} value={c.id}>{c.cognome} {c.nome}</option>
              ))}
            </select>
            <button
              onClick={load}
              disabled={loading}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? "…" : "Aggiorna"}
            </button>
            <button
              onClick={handleOpenUpload}
              className="h-9 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              + Carica
            </button>
            <span className="ml-auto flex items-center text-sm text-slate-500">
              {filtered.length} documenti
            </span>
          </div>

          {error && (
            <div className="mb-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Tabella */}
          <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Documento</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Candidato</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Tipo</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Data</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600">Dim.</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-600">Anteprima</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      {loading ? "Caricamento…" : "Nessun documento trovato"}
                    </td>
                  </tr>
                ) : (
                  filtered.map((d) => {
                    const isImg = isImage(d.mime, d.nome);
                    const isPDF = isPdf(d.mime, d.nome);
                    const isSelected = selected?.id === d.id;
                    return (
                      <tr
                        key={d.id}
                        onClick={() => handleSelectDoc(d)}
                        className={`cursor-pointer border-b border-slate-100 transition-colors last:border-0 ${
                          isSelected ? "bg-indigo-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base" aria-hidden>
                              {isPDF ? "📄" : isImg ? "🖼" : "📁"}
                            </span>
                            <span className="font-medium text-slate-800 max-w-40 truncate" title={d.nome}>
                              {d.nome}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{d._candidatoLabel || "–"}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tipoChip(d.tipo)}`}>
                            {tipoLabel(d.tipo)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                          {d.data ? formatData(String(d.data).slice(0, 10)) : "–"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">
                          {formatBytes(d.dimensione) || "–"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {d.url ? (
                            <a
                              href={d.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-indigo-600 hover:underline text-xs"
                              title="Apri in nuova scheda"
                            >
                              Apri
                            </a>
                          ) : (
                            <span className="text-slate-300 text-xs">–</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── COLONNA DESTRA ── */}
        {showPanel && (
          <div className="w-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            {selected && !showUpload && (
              <DettaglioDocumento
                doc={selected}
                onClose={handlePanelClose}
                onDeleted={() => { handlePanelClose(); load(); }}
              />
            )}
            {showUpload && (
              <FormUpload
                candidati={candidati}
                defaultCandidatoId={selected?._candidatoId || ""}
                onClose={handlePanelClose}
                onUploaded={() => { handlePanelClose(); load(); }}
              />
            )}
          </div>
        )}
      </div>
    </ModernAppShell>
  );
}

// ---------------------------------------------------------------------------
// Pannello dettaglio documento
// ---------------------------------------------------------------------------

function DettaglioDocumento({ doc, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState("");
  const [blobUrl, setBlobUrl] = useState(null);
  const [blobLoading, setBlobLoading] = useState(false);

  // Carica preview via blob (aggira CORS su URL diretti)
  useEffect(() => {
    if (!doc.url) return;
    let revoked = false;
    setBlobLoading(true);
    fetch(doc.url, { headers: authHeaders() })
      .then((r) => r.ok ? r.blob() : null)
      .then((blob) => {
        if (!revoked && blob) setBlobUrl(URL.createObjectURL(blob));
      })
      .catch(() => {/* usa URL diretto come fallback */ })
      .finally(() => { if (!revoked) setBlobLoading(false); });
    return () => {
      revoked = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, doc.url]);

  async function handleDelete() {
    if (!window.confirm(`Eliminare il documento "${doc.nome}"?\nQuesta azione è irreversibile.`)) return;
    setDeleting(true); setDelErr("");
    try {
      const res = await fetch(`${API_BASE}/api/documenti/${doc.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onDeleted();
    } catch (e) {
      setDelErr(e.message);
      setDeleting(false);
    }
  }

  const previewSrc = blobUrl || doc.url;
  const imgOk = isImage(doc.mime, doc.nome);
  const pdfOk = isPdf(doc.mime, doc.nome);

  const fields = [
    { label: "Nome file", value: doc.nome },
    { label: "Tipo documento", value: tipoLabel(doc.tipo) },
    { label: "Candidato", value: doc._candidatoLabel },
    { label: "Data", value: doc.data ? formatData(String(doc.data).slice(0, 10)) : null },
    { label: "Dimensione", value: formatBytes(doc.dimensione) },
    { label: "Formato", value: doc.mime },
    { label: "Note", value: doc.note },
  ];

  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-800 break-all">{doc.nome}</h2>
          <p className="text-sm text-slate-500">{doc._candidatoLabel || "–"}</p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tipoChip(doc.tipo)}`}>
            {tipoLabel(doc.tipo)}
          </span>
        </div>
        <button onClick={onClose} className="shrink-0 rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-500 hover:bg-slate-50">
          ✕ Chiudi
        </button>
      </div>

      {/* Anteprima */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
        {!doc.url && (
          <p className="py-8 text-center text-sm text-slate-400">Nessun file allegato</p>
        )}
        {doc.url && blobLoading && (
          <p className="py-8 text-center text-sm text-slate-400">Caricamento anteprima…</p>
        )}
        {doc.url && !blobLoading && imgOk && previewSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewSrc}
            alt={doc.nome}
            className="mx-auto max-h-72 object-contain p-2"
          />
        )}
        {doc.url && !blobLoading && pdfOk && previewSrc && (
          <iframe
            src={previewSrc}
            title={doc.nome}
            className="h-72 w-full border-0"
          />
        )}
        {doc.url && !blobLoading && !imgOk && !pdfOk && (
          <p className="py-8 text-center text-sm text-slate-500">
            Anteprima non disponibile per questo formato.
          </p>
        )}
      </div>

      {/* Dati */}
      <Section title="Informazioni documento" fields={fields} />

      {/* Azioni */}
      <div className="mt-4 flex flex-wrap gap-2">
        {doc.url && (
          <a
            href={doc.url}
            download={doc.nome}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            ↓ Download
          </a>
        )}
        {doc.url && (
          <a
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ↗ Apri
          </a>
        )}
        {doc._candidatoId && (
          <a
            href={`/anagrafica-iscrizioni?id=${doc._candidatoId}`}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Candidato
          </a>
        )}
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="ml-auto rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {deleting ? "Eliminazione…" : "🗑 Elimina"}
        </button>
      </div>
      {delErr && (
        <p className="mt-2 rounded bg-red-50 border border-red-200 px-3 py-1 text-xs text-red-700">
          ❌ {delErr}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form upload documento
// ---------------------------------------------------------------------------

function FormUpload({ candidati, defaultCandidatoId, onClose, onUploaded }) {
  const fileRef = useRef(null);
  const [form, setForm] = useState({
    candidato_id: defaultCandidatoId || "",
    tipo: "carta_identita",
    note: "",
  });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [candidatoSearch, setCandidatoSearch] = useState(
    defaultCandidatoId
      ? (candidati.find((c) => c.id === defaultCandidatoId)
          ? `${candidati.find((c) => c.id === defaultCandidatoId).cognome} ${candidati.find((c) => c.id === defaultCandidatoId).nome}`
          : "")
      : ""
  );
  const [showDropdown, setShowDropdown] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [progress, setProgress] = useState(0);

  const candidatiFiltrati = useMemo(() => {
    const q = candidatoSearch.trim().toUpperCase();
    if (!q) return candidati.slice(0, 30);
    return candidati
      .filter((c) => `${c.cognome} ${c.nome} ${c.codice_fiscale}`.toUpperCase().includes(q))
      .slice(0, 20);
  }, [candidati, candidatoSearch]);

  function selectCandidato(c) {
    setForm((f) => ({ ...f, candidato_id: c.id }));
    setCandidatoSearch(`${c.cognome} ${c.nome}`);
    setShowDropdown(false);
  }

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) { setFile(null); setPreview(null); return; }
    setFile(f);
    if (isImage("", f.name) || isPdf("", f.name)) {
      const url = URL.createObjectURL(f);
      setPreview({ url, isImg: isImage("", f.name), isPDF: isPdf("", f.name) });
    } else {
      setPreview(null);
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) { setUploadErr("Seleziona un file."); return; }
    if (!form.candidato_id) { setUploadErr("Seleziona un candidato."); return; }

    setUploading(true); setUploadErr(""); setProgress(10);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("candidato_id", form.candidato_id);
      fd.append("tipo", form.tipo);
      fd.append("note", form.note);

      setProgress(40);
      const res = await fetch(`${API_BASE}/api/documenti/upload`, {
        method: "POST",
        headers: authHeaders(),   // NON impostare Content-Type: FormData lo gestisce
        body: fd,
      });
      setProgress(80);

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

      setProgress(100);
      setTimeout(() => onUploaded(), 300);
    } catch (e) {
      setUploadErr(e.message);
      setProgress(0);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">Carica documento</h2>
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-500 hover:bg-slate-50">
          ✕ Chiudi
        </button>
      </div>

      <form onSubmit={handleUpload} className="space-y-4">
        {/* Candidato */}
        <div className="relative">
          <label className="mb-1 block text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Candidato <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder="Cerca cognome, nome o CF…"
            value={candidatoSearch}
            onChange={(e) => {
              setCandidatoSearch(e.target.value);
              setShowDropdown(true);
              setForm((f) => ({ ...f, candidato_id: "" }));
            }}
            onFocus={() => setShowDropdown(true)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          />
          {showDropdown && candidatiFiltrati.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {candidatiFiltrati.map((c) => (
                <li
                  key={c.id}
                  onMouseDown={() => selectCandidato(c)}
                  className="cursor-pointer px-3 py-2 text-sm hover:bg-indigo-50"
                >
                  <span className="font-medium">{c.cognome} {c.nome}</span>
                  <span className="ml-2 text-xs text-slate-400">{c.codice_fiscale}</span>
                </li>
              ))}
            </ul>
          )}
          {form.candidato_id && (
            <p className="mt-0.5 text-xs text-emerald-700">✓ Candidato selezionato</p>
          )}
        </div>

        {/* Tipo documento */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Tipo documento <span className="text-red-500">*</span>
          </label>
          <select
            value={form.tipo}
            onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
            required
            className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          >
            {TIPO_FORM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* File */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500 uppercase tracking-wide">
            File <span className="text-red-500">*</span>
          </label>
          <div
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) { handleFileChange({ target: { files: [f] } }); }
            }}
          >
            {file ? (
              <div className="text-center">
                <p className="font-medium text-slate-800">{file.name}</p>
                <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
                <p className="mt-1 text-xs text-indigo-600">Clicca per cambiare</p>
              </div>
            ) : (
              <>
                <span className="text-3xl mb-2">📁</span>
                <p className="text-sm font-medium text-slate-600">Trascina qui o clicca per selezionare</p>
                <p className="text-xs text-slate-400 mt-1">PDF, JPG, PNG, WEBP — max 20 MB</p>
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT_TYPES}
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {/* Anteprima file selezionato */}
        {preview && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
            {preview.isImg && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt="anteprima" className="mx-auto max-h-48 object-contain p-2" />
            )}
            {preview.isPDF && (
              <iframe src={preview.url} title="anteprima PDF" className="h-48 w-full border-0" />
            )}
          </div>
        )}

        {/* Note */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Note
          </label>
          <textarea
            rows={2}
            placeholder="Note aggiuntive…"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none resize-none"
          />
        </div>

        {/* Progress bar */}
        {uploading && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {uploadErr && (
          <p className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            ❌ {uploadErr}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={uploading || !file}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {uploading ? `Caricamento ${progress}%…` : "Carica documento"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Annulla
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section helper
// ---------------------------------------------------------------------------

function Section({ title, fields }) {
  const hasValues = fields.some((f) => f.value != null && f.value !== "");
  if (!hasValues) return null;
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {fields.map(({ label, value }) =>
              value != null && value !== "" ? (
                <tr key={label} className="border-b border-slate-100 last:border-0">
                  <td className="w-40 px-3 py-1.5 text-slate-500">{label}</td>
                  <td className="px-3 py-1.5 font-medium text-slate-800 break-all">{value}</td>
                </tr>
              ) : null
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
