const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const supabase = require("../database/supabase");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const MULTI_AUTOSCUOLA = String(process.env.MULTI_AUTOSCUOLA || "false").toLowerCase() === "true";
const AUTH_REQUIRED = String(process.env.AUTH_REQUIRED || "false").toLowerCase() === "true";

/** Codice autoscuola da usare in automatico se non impostato in DB (per sync portale). */
function codiceAutoscuolaFromEnv() {
  return String(process.env.CODICE_AUTOSCUOLA || process.env.ARCHIVIO_CODICE_AUTOSCUOLA || "").trim();
}

function signToken(autoscuola) {
  return jwt.sign(
    {
      sub: autoscuola.id,
      autoscuolaId: autoscuola.id,
      email: autoscuola.email,
      nome: autoscuola.nome,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function readBearerToken(req) {
  const authHeader = req.headers?.authorization || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  return authHeader.slice(7).trim();
}

function attachAuthContext(req, _res, next) {
  const token = readBearerToken(req);
  if (!token) {
    req.auth = null;
    req.autoscuolaId = null;
    return next();
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.auth = payload;
    req.autoscuolaId = payload.autoscuolaId || payload.sub || null;
  } catch {
    req.auth = null;
    req.autoscuolaId = null;
  }

  return next();
}

function requireAuth(req, res, next) {
  if (!req.autoscuolaId) {
    return res.status(401).json({ success: false, error: "Token non valido o mancante" });
  }
  return next();
}

/**
 * requireRole(roles) — Punto 24
 * Middleware che verifica che l'operatore abbia uno dei ruoli indicati.
 * Se il token è dell'autoscuola owner (nessun campo ruolo), è sempre ammesso.
 * @param {string|string[]} roles
 */
function requireRole(...roles) {
  const allowed = roles.flat();
  return function (req, res, next) {
    if (!req.autoscuolaId) {
      return res.status(401).json({ success: false, error: "Token non valido o mancante" });
    }
    // Owner autoscuola (no campo ruolo nel token) = ammesso sempre
    if (!req.auth?.ruolo) return next();
    // Controlla ruolo
    if (allowed.includes(req.auth.ruolo)) return next();
    return res.status(403).json({ success: false, error: `Accesso non autorizzato. Ruolo richiesto: ${allowed.join(" o ")}` });
  };
}

function enforceApiAuth(req, res, next) {
  if (!AUTH_REQUIRED) return next();
  if (req.path.startsWith("/auth")) return next();
  if (!req.autoscuolaId) {
    return res.status(401).json({ success: false, error: "Autenticazione richiesta" });
  }
  return next();
}

function withTenantFilter(query, req, column = "autoscuola_id") {
  if (!MULTI_AUTOSCUOLA) return query;
  if (!req?.autoscuolaId) return query;
  return query.eq(column, req.autoscuolaId);
}

function tenantField(req) {
  if (!MULTI_AUTOSCUOLA || !req?.autoscuolaId) return {};
  return { autoscuola_id: req.autoscuolaId };
}

async function registerAutoscuola(req, res) {
  try {
    const { nome, email, password, portal_user, portal_pass, portal_pin } = req.body || {};
    if (!nome || !email || !password) {
      return res.status(400).json({ success: false, error: "nome, email e password obbligatori" });
    }

    // Se i campi portale sono vuoti, usa le credenziali da .env (vault)
    const portalUser = String(portal_user || "").trim() || process.env.PORTAL_USERNAME || process.env.PORTAL_USER || null;
    const portalPass = String(portal_pass || "").trim() || process.env.PORTAL_PASSWORD || process.env.PORTAL_PASS || null;
    const portalPin = String(portal_pin || "").trim() || process.env.PORTAL_PIN || null;

    const normalizedEmail = String(email).trim().toLowerCase();
    const password_hash = await bcrypt.hash(String(password), 10);

    const { data: existing, error: findError } = await supabase
      .from("autoscuole")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (findError) return res.status(500).json({ success: false, error: findError.message });
    if (existing?.id) return res.status(409).json({ success: false, error: "Email già registrata" });

    const { data, error } = await supabase
      .from("autoscuole")
      .insert([{ nome, email: normalizedEmail, password_hash, portal_user: portalUser, portal_pass: portalPass, portal_pin: portalPin }])
      .select("id,nome,email")
      .single();

    if (error) return res.status(500).json({ success: false, error: error.message });

    const token = signToken(data);
    return res.json({ success: true, token, autoscuola: data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function loginAutoscuola(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "email e password obbligatori" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    let data = null;
    let error = null;
    const { data: d1, error: e1 } = await supabase
      .from("autoscuole")
      .select("id,nome,email,password_hash,portal_user,portal_pass,portal_pin,codice_autoscuola")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (!e1) {
      data = d1;
      error = null;
    } else {
      const { data: d2, error: e2 } = await supabase
        .from("autoscuole")
        .select("id,nome,email,password_hash,portal_user,portal_pass,portal_pin")
        .eq("email", normalizedEmail)
        .maybeSingle();
      data = d2;
      error = e2;
    }

    if (error) return res.status(500).json({ success: false, error: error.message });
    if (!data) return res.status(401).json({ success: false, error: "Credenziali non valide" });

    const ok = await bcrypt.compare(String(password), String(data.password_hash || ""));
    if (!ok) return res.status(401).json({ success: false, error: "Credenziali non valide" });

    const token = signToken(data);
    const codice = (data.codice_autoscuola != null && String(data.codice_autoscuola).trim()) ? String(data.codice_autoscuola).trim() : codiceAutoscuolaFromEnv();
    return res.json({
      success: true,
      token,
      autoscuola: {
        id: data.id,
        nome: data.nome,
        email: data.email,
        codice_autoscuola: codice,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function meAutoscuola(req, res) {
  try {
    if (!req.autoscuolaId) {
      return res.status(401).json({ success: false, error: "Token non valido o mancante" });
    }

    let data = null;
    let error = null;
    const { data: dataWithCodice, error: errWithCodice } = await supabase
      .from("autoscuole")
      .select("id,nome,email,codice_autoscuola,portal_user,portal_pass,portal_pin,indirizzo,partita_iva,telefono")
      .eq("id", req.autoscuolaId)
      .maybeSingle();
    if (!errWithCodice) {
      data = dataWithCodice;
      error = null;
    } else {
      const { data: dataBasic, error: errBasic } = await supabase
        .from("autoscuole")
        .select("id,nome,email,portal_user,portal_pass,portal_pin")
        .eq("id", req.autoscuolaId)
        .maybeSingle();
      data = dataBasic;
      error = errBasic;
    }

    if (error) return res.status(500).json({ success: false, error: error.message });
    if (!data) return res.status(404).json({ success: false, error: "Autoscuola non trovata" });

    const codice = (data.codice_autoscuola != null && String(data.codice_autoscuola).trim()) ? String(data.codice_autoscuola).trim() : codiceAutoscuolaFromEnv();

    // Restituisci stato credenziali portale (non i valori reali - solo se sono configurate)
    const portalUserVal = String(data.portal_user || "").trim();
    const isPlaceholder = ["TUO_USERNAME_PORTALE", "YOUR_USERNAME", "USERNAME", ""].includes(portalUserVal.toUpperCase()) || portalUserVal.toUpperCase() === portalUserVal; // placeholder se tutto maiuscolo

    return res.json({
      success: true,
      autoscuola: {
        id:               data.id,
        nome:             data.nome,
        email:            data.email,
        codice_autoscuola: codice,
        indirizzo:        data.indirizzo || "",
        partita_iva:      data.partita_iva || "",
        telefono:         data.telefono || "",
        // Stato credenziali portale (senza esporre password)
        portal_user:      portalUserVal || null,
        portal_credenziali_ok: !!(portalUserVal && !isPlaceholder && data.portal_pass),
        portal_pass_set:  !!(data.portal_pass),
        portal_pin_set:   !!(data.portal_pin),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function logoutAutoscuola(_req, res) {
  return res.json({ success: true, message: "Logout effettuato" });
}

module.exports = {
  MULTI_AUTOSCUOLA,
  AUTH_REQUIRED,
  attachAuthContext,
  enforceApiAuth,
  requireAuth,
  requireRole,
  withTenantFilter,
  tenantField,
  registerAutoscuola,
  loginAutoscuola,
  meAutoscuola,
  logoutAutoscuola,
};
