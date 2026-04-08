"use client";

import Link from "next/link";
import { ThemeToggle } from "../lib/ThemeProvider";

const NAV_ITEMS = [
  { href: "/", key: "dashboard", label: "Dashboard", icon: "⌂" },
  { href: "/prenotazioni", key: "prenotazioni", label: "Prenotazioni e Radar", icon: "📡" },
  { href: "/portale", key: "portale", label: "Portale Automobilista", icon: "🌐" },
  { href: "/anagrafica-iscrizioni", key: "anagrafica-iscrizioni", label: "Anagrafica ed Iscrizioni", icon: "👤" },
  { href: "/pratiche", key: "pratiche", label: "Pratiche", icon: "📂" },
  { href: "/trasmiss", key: "trasmiss", label: "Trasmissioni CED", icon: "📤" },
  { href: "/trasmissione-portale", key: "trasmissione-portale", label: "Trasmissione Portale", icon: "🏛️" },
  { href: "/portal-sync", key: "portal-sync", label: "Lettura Portale", icon: "🌐" },
  { href: "/sessioni-esame", key: "sessioni-esame", label: "Sessioni Esame", icon: "📅" },
  { href: "/fogli-rosa-patenti", key: "fogli-rosa-patenti", label: "Fogli Rosa e Patenti", icon: "📄" },
  { href: "/esami", key: "esami", label: "Esami", icon: "📅" },
  { href: "/richieste-esame", key: "richieste-esame", label: "Richieste Esame", icon: "📝" },
  { href: "/moduli", key: "moduli", label: "Moduli", icon: "📋" },
  { href: "/guide", key: "guide", label: "Guide", icon: "🚗" },
  { href: "/corsi", key: "corsi", label: "Corsi", icon: "📚" },
  { href: "/pagamenti", key: "pagamenti", label: "Pagamenti", icon: "💰" },
  { href: "/documenti", key: "documenti", label: "Documenti", icon: "📁" },
  { href: "/statistiche", key: "statistiche", label: "Statistiche", icon: "📈" },
  { href: "/servizi-online", key: "servizi-online", label: "Servizi on line", icon: "🌐" },
  { href: "/calendar", key: "calendar", label: "Calendario", icon: "🗓" },
  { href: "/punti-patente", key: "punti-patente", label: "Punti patente", icon: "🪪" },
  // ── Nuove sezioni ispirate a iPatenteCloud ──────────────────────────────
  { href: "/veicoli", key: "veicoli", label: "Parco Veicoli", icon: "🚘" },
  { href: "/listino", key: "listino", label: "Listino Prezzi", icon: "💶" },
  { href: "/committenti", key: "committenti", label: "Committenti", icon: "🏢" },
  { href: "/impegni", key: "impegni", label: "Impegni e Scadenze", icon: "📌" },
  { href: "/visite-mediche", key: "visite-mediche", label: "Visite Mediche", icon: "🩺" },
  { href: "/preventivi", key: "preventivi", label: "Preventivi", icon: "📝" },
  // ────────────────────────────────────────────────────────────────────────
  { href: "/strumenti-utili", key: "strumenti-utili", label: "Strumenti Utili", icon: "🔧" },
  { href: "/impostazioni", key: "impostazioni", label: "Impostazioni", icon: "⚙️" },
];

export default function ModernAppShell({ title, subtitle, activeKey, onLogout, children, menuTextSize = "normal", sidebarAction = null, user }) {
  const menuTextClass = menuTextSize === "xlarge"
    ? "ui-font-xlarge"
    : (menuTextSize === "large" ? "ui-font-large" : "");

  async function handleLogoutClick() {
    const ok = typeof window !== "undefined"
      ? window.confirm("Confermi di voler uscire dal gestionale?")
      : true;
    if (!ok) return;
    await onLogout?.();
  }

  return (
    <div className={`desktop-fit min-h-screen bg-slate-100 p-2 lg:p-4 ${menuTextClass}`}>
      <main className="mx-auto w-full max-w-[calc(100vw-1rem)] lg:max-w-[calc(100vw-2rem)] overflow-hidden rounded-3xl bg-white shadow-xl ring-1 ring-slate-200">
        <div className="grid min-h-[calc(100vh-1rem)] grid-cols-1 lg:min-h-[calc(100vh-2rem)] lg:grid-cols-[300px_1fr]">
          <aside className="shell-sidebar relative border-r border-slate-200 bg-linear-to-br from-indigo-600 via-violet-600 to-fuchsia-500 p-4 text-white">
            <div className="absolute inset-0 opacity-20">
              <div className="absolute -left-12 top-4 h-52 w-52 rounded-full bg-white blur-3xl" />
              <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-pink-200 blur-3xl" />
            </div>

            <div className="relative z-10 flex h-full flex-col">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  {user?.nome && (
                    <span className="truncate text-xs text-white/90" title="Utente connesso">{user.nome}</span>
                  )}
                  <button
                    onClick={handleLogoutClick}
                    className="shell-logout ml-auto rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                    title="Esci dall'account corrente"
                  >
                    Logout
                  </button>
                </div>
                <p className="shell-brand text-xs font-semibold uppercase tracking-[0.16em] text-white/80">Gestionale iPatente Cloud</p>
                <h1 className="shell-title mt-2 text-2xl font-extrabold leading-tight">{title}</h1>
                <p className="shell-subtitle mt-1 text-xs text-white/90">{subtitle || "Interfaccia operativa"}</p>
              </div>

              <nav className="mt-4 flex-1 space-y-1 overflow-y-auto pr-1">
                {NAV_ITEMS.map((item) => {
                  const isActive = item.key === activeKey;
                  const classes = isActive
                    ? "bg-white text-emerald-700 shadow"
                    : "bg-white/10 text-white hover:bg-white/20";

                  if (item.external) {
                    return (
                      <a
                        key={item.key}
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`shell-nav-link flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs font-semibold transition ${classes}`}
                        title={`Apri ${item.label} in una nuova scheda`}
                      >
                        <span>{item.icon}</span>
                        <span>{item.label}</span>
                      </a>
                    );
                  }

                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      className={`shell-nav-link flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs font-semibold transition ${classes}`}
                    >
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>

              <div className="mt-auto space-y-2">
                {sidebarAction && (
                  <button
                    onClick={sidebarAction.onClick}
                    className="shell-sidebar-action w-full rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                    title={sidebarAction.title || sidebarAction.label}
                  >
                    <span className="mr-2">{sidebarAction.icon || "\uD83D\uDCAC"}</span>
                    <span>{sidebarAction.label}</span>
                  </button>
                )}
                <ThemeToggle className="w-full bg-white/10 text-white hover:bg-white/20" />
              </div>
            </div>
          </aside>

          <section className="bg-slate-50 p-4 lg:p-5 min-w-0">{children}</section>
        </div>
      </main>
    </div>
  );
}
