"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { checkSession } from "../lib/authClient";

const HIDDEN_PATHS = new Set(["/login", "/register"]);

export default function SessionTopBar() {
  const pathname = usePathname();
  const [autoscuolaNome, setAutoscuolaNome] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      if (!pathname || HIDDEN_PATHS.has(pathname)) {
        if (!cancelled) setAutoscuolaNome("");
        return;
      }

      const session = await checkSession();
      if (!cancelled) {
        setAutoscuolaNome(session.ok ? (session.autoscuola?.nome || "") : "");
      }
    }

    loadSession();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!pathname || HIDDEN_PATHS.has(pathname) || !autoscuolaNome) {
    return null;
  }

  return (
    <Link
      href="/"
      className="group flex w-full items-center justify-between border-b bg-white px-6 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
      title="Vai alla dashboard"
    >
      <span>
        Autoscuola: <strong className="text-blue-700">{autoscuolaNome}</strong>
      </span>
      <svg
        aria-hidden="true"
        className="h-4 w-4 text-slate-400 transition-transform duration-150 group-hover:translate-x-0.5"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M7 4L13 10L7 16"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}
