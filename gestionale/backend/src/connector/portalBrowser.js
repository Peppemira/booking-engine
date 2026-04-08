const puppeteer = require('puppeteer');
const { sendTelegram } = require('../telegram');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseHeadless(v) {
  if (v === undefined) return true;
  return String(v).toLowerCase() !== 'false';
}

async function waitAnySelector(page, selectors, opts = {}) {
  const { timeout = 15000 } = opts;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) return sel;
      } catch (e) {
        // ignore
      }
    }
    await sleep(250);
  }
  throw new Error(`Nessun selettore trovato tra: ${selectors.join(', ')}`);
}

async function handlePinIfPresent(page) {
  // riconoscimento pagina PIN
  const hasPinText = await page.evaluate(() =>
    (document.body && document.body.innerText && document.body.innerText.toLowerCase().includes('codice pin')) ||
    (document.body && document.body.innerText && document.body.innerText.toLowerCase().includes('inserire pin'))
  );

  if (!hasPinText) return false;

  // prova selettori comuni
  const pinSel = await waitAnySelector(page, [
    'input[name="codicePin"]',
    'input#codicePin',
    'input[name*="pin"]',
    'input[id*="pin"]',
  ], { timeout: 15000 });

  await page.click(pinSel, { clickCount: 3 });
  await page.type(pinSel, process.env.PORTAL_PIN || '', { delay: 20 });

  const confirmSel = await waitAnySelector(page, [
    'input[type="submit"][value*="CONFERMA" i]',
    'button[type="submit"]',
    'input[type="submit"]',
    'button',
  ], { timeout: 15000 });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => null),
    page.click(confirmSel),
  ]);

  console.log('PIN inserito. URL:', page.url());
  return true;
}

// Gestione PIN definitiva
async function handlePin(page) {
  console.log("Controllo presenza PIN...");

  // Aspetta campo PIN
  await page.waitForSelector('input[name="loginView.pin"]', { timeout: 15000 });

  console.log("Pagina PIN trovata. Inserisco PIN...");

  // Pulisci campo e inserisci PIN una sola volta
  await page.click('input[name="loginView.pin"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('input[name="loginView.pin"]', process.env.PORTAL_PIN, { delay: 30 });

  // Click su Conferma (no waitForNavigation, il dispatcher spesso non naviga)
  await page.click('input[name="action:Pin_executePinValidation"]');
  await sleep(4000);

  console.log("PIN inviato. URL attuale:", page.url());
}

class PortalBrowser {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: process.env.PORTAL_HEADLESS ? process.env.PORTAL_HEADLESS === 'true' : true,
      defaultViewport: null
    });

    this.page = await this.browser.newPage();
  }

  async login() {
    const headless = parseHeadless(process.env.PORTAL_HEADLESS);

    const browser = await puppeteer.launch({
      headless,
      slowMo: 50,
      defaultViewport: null,
      args: ['--start-maximized'],
      dumpio: true,
    });

    const page = await browser.newPage();

    // utile per debug
    page.on('console', (msg) => console.log('BROWSER:', msg.type(), msg.text()));
    page.on('pageerror', (err) => console.log('PAGEERR:', err.message));
    page.on('error', (err) => console.log('PAGE CRASH:', err.message));
    page.on('requestfailed', (req) => console.log('REQ FAILED:', req.url(), req.failure() && req.failure().errorText));
    page.on('response', (res) => { if (res.status() >= 400) console.log('HTTP', res.status(), res.url()); });

    // 1) Vai alla pagina login (quella con SPID/CIE e sotto user/pass)
    const LOGIN_URL = 'https://www.ilportaledellautomobilista.it/web/portale-automobilista/loginspid';
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

    // 2) Se serve scroll (a volte i campi sono più giù)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));

    // 3) Trova i campi
    const userSel = await waitAnySelector(page, [
      'input[name="loginView.beanUtente.userName"]',
      'input#username',
      'input[name="username"]',
    ], { timeout: 15000 });

    const passSel = await waitAnySelector(page, [
      'input[name="loginView.beanUtente.password"]',
      'input#password',
      'input[name="password"]',
    ], { timeout: 15000 });

    await page.click(userSel, { clickCount: 3 });
    await page.type(userSel, process.env.PORTAL_USERNAME || '', { delay: 20 });

    await page.click(passSel, { clickCount: 3 });
    await page.type(passSel, process.env.PORTAL_PASSWORD || '', { delay: 20 });

    // 4) Clicca "Accedi"
    const btnSel = await waitAnySelector(page, [
      'input[type="submit"][value="Accedi"]',
      'button[type="submit"]',
      'input[type="submit"]',
    ], { timeout: 15000 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => null),
      page.click(btnSel),
    ]);

    // screenshot e URL per verifica
    try { await page.screenshot({ path: 'after-login.png', fullPage: true }); } catch (e) {}
    console.log('URL after login:', page.url());

    // Vai alla homepage professionisti e clicca prenotazione
    try {
      await page.goto('https://www.ilportaledellautomobilista.it/web/portal-automobilista/homepage-professionisti', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('a[href*="prenotazione"]', { timeout: 10000 });
      await page.click('a[href*="prenotazione"]');

      // Gestione PIN sulla pagina di prenotazione
      await handlePin(page);
    } catch (e) {
      console.log('Errore flusso prenotazione/PIN (può essere non critico):', e.message || e);
    }

    // salva istanza
    this.browser = browser;
    this.page = page;
    return { browser, page };
  }

  async getCandidatiAttivi() {
    try {
      console.log('Recupero candidati attivi...');
      
      // Va alla pagina di ricerca candidati
      const searchUrl = 'https://www.ilportaledellautomobilista.it/web/portal-automobilista/ricerca-candidati';
      await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      await sleep(2000);

      // Estrai dati della tabella candidati
      const candidati = await this.page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr');
        const candidatos = [];
        
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 3) {
            candidatos.push({
              nome: cells[0]?.innerText?.trim() || '',
              cognome: cells[1]?.innerText?.trim() || '',
              codice: cells[2]?.innerText?.trim() || '',
              status: cells[3]?.innerText?.trim() || 'attivo',
              data_nascita: cells[4]?.innerText?.trim() || '',
              comune_nascita: cells[5]?.innerText?.trim() || '',
              provincia_nascita: cells[6]?.innerText?.trim() || ''
            });
          }
        });
        
        return candidatos.filter(c => c.nome && c.cognome);
      });

      console.log(`Trovati ${candidati.length} candidati attivi`);
      return candidati;

    } catch (error) {
      console.error('Errore recupero candidati:', error.message);
      return [];
    }
  }

  async close() {
    await this.browser.close();
  }
}

module.exports = PortalBrowser;
