const puppeteer = require("puppeteer");

/**
 * Legge la pagina "Situazione Candidati" dal portale
 * e restituisce righe normalizzate per il backfill conseguimenti:
 * {
 *   codice_fiscale?: string,
 *   cognome: string,
 *   nome: string,
 *   data_iscrizione: string (YYYY-MM-DD),
 *   categoria_patente: string,
 * }
 */
async function readSituazioneCandidatiConseguimentoViaBrowser(options = {}) {
  const trace = Array.isArray(options.trace) ? options.trace : null;

  const username = options.username || process.env.PORTAL_USER || process.env.PORTAL_USERNAME;
  const password = options.password || process.env.PORTAL_PASS || process.env.PORTAL_PASSWORD;
  const pin = options.pin || process.env.PORTAL_PIN;

  if (!username || !password) {
    throw new Error("PORTAL_USER/PORTAL_PASS mancanti nel .env");
  }

  const headless = process.env.PORTAL_HEADLESS === "true";
  const browser = await puppeteer.launch({
    headless,
    defaultViewport: { width: 1366, height: 768 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "font", "stylesheet"].includes(type)) {
        req.abort();
        return;
      }
      req.continue();
    });
    page.setDefaultTimeout(30000);

    // 1) Login al portale (flusso base)
    await page.goto("https://www.ilportaledellautomobilista.it/SSO/SSOLogin/Login_initAction.action", {
      waitUntil: "domcontentloaded",
    });

    const userSelectorCandidates = [
      'input[name="loginView.beanUtente.userName"]',
      'input[name="loginView.username"]',
      'input[name="username"]',
      'input[id*="user" i]',
      'input[type="email"]',
      'input[type="text"]',
    ];
    const passSelectorCandidates = [
      'input[name="loginView.beanUtente.password"]',
      'input[name="loginView.password"]',
      'input[name="password"]',
      'input[id*="pass" i]',
      'input[type="password"]',
    ];

    const resolveFirst = async (selectors) => {
      for (const sel of selectors) {
        const node = await page.$(sel);
        if (node) return sel;
      }
      return null;
    };

    const userSel = await resolveFirst(userSelectorCandidates);
    const passSel = await resolveFirst(passSelectorCandidates);

    if (userSel && passSel) {
      const loginBtnSel =
        'input[name="action:Login_executeLogin"], button[name="action:Login_executeLogin"], input[type="submit"], button[type="submit"]';

      await page.click(userSel, { clickCount: 3 });
      await page.type(userSel, username, { delay: 15 });

      await page.click(passSel, { clickCount: 3 });
      await page.type(passSel, password, { delay: 15 });

      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
        page.click(loginBtnSel),
      ]);
    }

    // Se dopo il login appare il PIN, cerchiamo un campo simile
    const pinField = await page
      .$(
        'input[name="loginView.pin"], input[name="pin"], input[id*="pin" i]',
      )
      .catch(() => null);
    if (pinField && pin) {
      const btnSelector =
        'input[name="action:Pin_executePinValidation"], button[name="action:Pin_executePinValidation"], input[type="submit"], button[type="submit"]';

      await page.click('input[name="loginView.pin"], input[name="pin"], input[id*="pin" i]', { clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.type('input[name="loginView.pin"], input[name="pin"], input[id*="pin" i]', pin, { delay: 15 });

      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
        page.click(btnSelector),
      ]);
    }

    // 2) Vai alla pagina "Situazione Candidati"
    const situazioneUrl =
      "https://www.ilportaledellautomobilista.it/prenotazione/richiestaEmissioneDocumentoAbilitazioneEP/Read_initActionSituazioneCandidati.action?pageStatus=SEARCH";
    await page.goto(situazioneUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // 3) Estrai i candidati dalla tabella (in base alle intestazioni)
    const candidates = await page.evaluate(() => {
      const readText = (node) => String(node?.textContent || "").replace(/\s+/g, " ").trim();
      const normalizeHeader = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
      const splitNominativo = (value) => {
        const raw = String(value || "").replace(/\s+/g, " ").trim();
        if (!raw) return { cognome: "", nome: "" };
        const parts = raw.split(" ").filter(Boolean);
        if (parts.length <= 1) return { cognome: raw, nome: "" };
        return {
          cognome: parts[0] || "",
          nome: parts.slice(1).join(" "),
        };
      };

      const candidateRows = [];
      Array.from(document.querySelectorAll("table")).forEach((table) => {
        const headers = [];
        table.querySelectorAll("thead th").forEach((th) => headers.push(normalizeHeader(readText(th))));
        if (!headers.length) {
          const firstRowHeaders = table.querySelectorAll("tr:first-child th");
          firstRowHeaders.forEach((th) => headers.push(normalizeHeader(readText(th))));
        }

        const hasCognome = headers.some((header) => header.includes("cognome"));
        const hasNome = headers.some((header) => header.includes("nome"));
        const hasNominativo = headers.some((header) => header.includes("nominativo"));
        if (!hasCognome && !hasNominativo) {
          return;
        }

        const idx = {
          cognome: headers.findIndex((header) => header.includes("cognome")),
          nome: headers.findIndex((header) => {
            if (!header) return false;
            if (header.includes("cognome")) return false;
            return header === "nome" || /^nome(\b|\s|$)/.test(header);
          }),
          nominativo: headers.findIndex((header) => header.includes("nominativo")),
          codiceFiscale: headers.findIndex(
            (header) => header.includes("codice fiscale") || header.includes("cod. fisc") || header.includes("cf"),
          ),
          categoriaPatente: headers.findIndex(
            (header) =>
              header.includes("abilitazione") ||
              header.includes("categoria patente") ||
              header.includes("patente richiesta") ||
              header.includes("tipo iscrizione"),
          ),
          dataIscrizione: headers.findIndex(
            (header) =>
              header.includes("data iscrizione") ||
              header.includes("data domanda") ||
              header.includes("data statino") ||
              header.includes("data emissione"),
          ),
        };

        const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
        bodyRows.forEach((row) => {
          const cells = Array.from(row.querySelectorAll("td")).map(readText);
          if (!cells.length) return;

          const nominativoValue = idx.nominativo >= 0 ? cells[idx.nominativo] || "" : "";
          let cognomeValue = idx.cognome >= 0 ? cells[idx.cognome] || "" : "";
          let nomeValue = idx.nome >= 0 ? cells[idx.nome] || "" : "";
          if ((!cognomeValue || !nomeValue) && nominativoValue) {
            const split = splitNominativo(nominativoValue);
            if (!cognomeValue) cognomeValue = split.cognome || "";
            if (!nomeValue) nomeValue = split.nome || "";
          }
          if (!cognomeValue && !nomeValue) return;

          candidateRows.push({
            codice_fiscale: idx.codiceFiscale >= 0 ? cells[idx.codiceFiscale] || "" : "",
            cognome: cognomeValue,
            nome: nomeValue,
            categoria_patente: idx.categoriaPatente >= 0 ? cells[idx.categoriaPatente] || "" : "",
            data_iscrizione: idx.dataIscrizione >= 0 ? cells[idx.dataIscrizione] || "" : "",
          });
        });
      });

      return candidateRows;
    });

    const rows = (Array.isArray(candidates) ? candidates : []).map((row) => {
      const rawCategoria = String(row.categoria_patente || "").trim();
      const rawDataIscrizione = String(row.data_iscrizione || "").trim();

      let dataIscrizione = "";
      const m = rawDataIscrizione.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) {
        dataIscrizione = `${m[3]}-${m[2]}-${m[1]}`;
      } else {
        dataIscrizione = rawDataIscrizione;
      }

      return {
        codice_fiscale: (row.codice_fiscale || "").toString().trim().toUpperCase() || undefined,
        cognome: String(row.cognome || "").trim(),
        nome: String(row.nome || "").trim(),
        data_iscrizione: dataIscrizione,
        categoria_patente: rawCategoria,
        stato_pratica: undefined,
        codice_autoscuola: undefined,
      };
    });

    const filtered = rows.filter(
      (r) => (r.cognome || r.nome || r.codice_fiscale) && r.data_iscrizione && r.categoria_patente,
    );

    return {
      success: true,
      rows: filtered,
    };
  } finally {
    await browser.close();
  }
}

module.exports = {
  readSituazioneCandidatiConseguimentoViaBrowser,
};

