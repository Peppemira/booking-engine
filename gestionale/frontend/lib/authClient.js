function resolveApiBase() {
  const configured = String(process.env.NEXT_PUBLIC_API_BASE || "").trim();
  if (typeof window !== "undefined") {
    if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      return `${window.location.protocol}//${window.location.hostname}:3000`;
    }
    if (configured) return configured;
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }

  if (configured) return configured;
  return "http://localhost:3000";
}

export const API_BASE = resolveApiBase();

export function getApiBase() {
  if (typeof window !== "undefined") {
    const saved = String(localStorage.getItem("autoscuola_api_base") || "").trim();
    if (saved) return saved;
  }
  return resolveApiBase();
}

export function setApiBase(baseUrl) {
  if (typeof window === "undefined") return;
  const value = String(baseUrl || "").trim();
  if (!value) return;
  localStorage.setItem("autoscuola_api_base", value);
}

export function getToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("autoscuola_token") || "";
}

export function clearToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("autoscuola_token");
}

export function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function checkSession() {
  const token = getToken();
  if (!token) return { ok: false, error: "Token mancante" };
  const apiBase = getApiBase();

  try {
    const res = await fetch(`${apiBase}/api/auth/me`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      return { ok: false, error: data.error || "Sessione non valida" };
    }

    return { ok: true, autoscuola: data.autoscuola };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function logoutSession() {
  const token = getToken();
  const apiBase = getApiBase();
  try {
    if (token) {
      await fetch(`${apiBase}/api/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
    }
  } catch {
  } finally {
    clearToken();
  }
}
