const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

// ─────────────────────────────────────────────────────────────
//  CONFIGURAZIONE — modifica questi valori
// ─────────────────────────────────────────────────────────────
const CONFIG = {
  // Credenziali Portale Automobilista
  pin: '57501485',
  codiceAutoscuola: '660',        // ← codice autoscuola (località)

  // Supabase
  supabaseUrl: 'https://XXXX.supabase.co',       // ← il tuo URL Supabase
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5...',    // ← la tua anon key

  // Comportamento
  intervalloMinuti: 15,           // ogni quanti minuti controllare
  giorniAvanti: 30,               // finestra date: oggi + 30 giorni
  headless: true,                 // true = invisibile in background
  timeout: 25000,
};

// ─────────────────────────────────────────────────────────────
//  SUPABASE CLIENT
// ─────────────────────────────────────────────────────────────
const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// ─────────────────────────────────────────────────────────────
//  UTILITY DATE
// ─────────────────────────────────────────────────────────────
function oggi() {
  return formatData(new Date());
}

function traGiorni(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return formatData(d);
}

function formatData(d) {
  const gg = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${gg}/${mm}/${d.getFullYear()}`;
}

// Converte GG/MM/AAAA → AAAA-MM-GG (formato ISO per Supabase)
function toISO(dataIt) {
  if (!dataIt) return null;
  const [gg, mm, aaaa] = dataIt.split('/');
  return `${aaaa}-${mm}-${gg}`;
}

// ─────────────────────────────────────────────────────────────
//  PUPPETEER HELPERS
// ─────────────────────────────────────────────────────────────
async function impostaValore(page, selettore, valore) {
  await page.waitForSelector(selettore, { timeout: CONFIG.timeout });
  await page.$eval(selettore, (el, val) => {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, valore);
}

async function clickENnaviga(page, selettore) {
  await page.waitForSelector(selettore, { visible: true, timeout: CONFIG.timeout });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: CONFIG.timeout }),
    page.click(selettore),
  ]);
}

// ─────────────────────────────────────────────────────────────
//  LOGIN
// ─────────────────────────────────────────────────────────────
async function login(page) {
  console.log('🔐 Login in corso...');
  await page.goto(
    'https://www.ilportaledellautomobilista.it/SSO/SSOLogin/DispatcherEntry_executeDispatch.action?goto=http%3A%2F%2Fwww.ilportaledellautomobilista.it%2Fprenotazione',
    { waitUntil: 'networkidle2' }
  );
  await impostaValore(page, '#LoginForm_loginView_pin', CONFIG.pin);
  await clickENnaviga(page, '#LoginForm_button_value_confirm');
  console.log('✅ Login effettuato');
}

// ─────────────────────────────────────────────────────────────
//  SCRAPING TABELLA GENERICA
//  Ritorna array di oggetti { colonna: valore, ... }
// ─────────────────────────────────────────────────────────────
async function scrapaTabella(page, idTabella) {
  return await page.evaluate((id) => {
    const tabella = document.querySelector(id || 'table');
    if (!tabella) return [];

    const headers = Array.from(tabella.querySelectorAll('thead th'))
      .map(th => th.innerText.trim());

    const righe = Array.from(tabella.querySelectorAll('tbody tr'));

    return righe.map(riga => {
      const celle = Array.from(riga.querySelectorAll('td'));
      const obj = {};
      celle.forEach((td, i) => {
        const chiave = headers[i] || `col_${i}`;
        obj[chiave] = td.innerText.trim();
      });
      return obj;
    }).filter(r => Object.values(r).some(v => v !== ''));
  }, idTabella);
}

// ─────────────────────────────────────────────────────────────
//  SCRAPING SEDUTE TEORIA
// ─────────────────────────────────────────────────────────────
async function scrapeTeoria(page) {
  console.log('📚 Scraping Sedute Teoria...');
  await clickENnaviga(page, '#Sessioni\\ Quiz\\ Interne');

  const selettoraStato = '#RicercaDisponibilitaSessioneEsameEP_disponibilitaSessioneEsameEPView_disponibilitaSessioneEsameEPFrom_theStatoDisponibilitaSessioneEsameEP_selectRowId';
  const selettoraLocalita = '#RicercaDisponibilitaSessioneEsameEP_disponibilitaSessioneEsameEPView_disponibilitaSessioneEsameEPFrom_theAulaEP_theLocalitaEsameAbilitazioneEP_progressivoLocalitaEsameAbilitazione';

  await impostaValore(page, selettoraStato, 'A|');
  await impostaValore(page, '#datepicker1', oggi());
  await impostaValore(page, '#datepicker2', traGiorni(CONFIG.giorniAvanti));
  await impostaValore(page, selettoraLocalita, CONFIG.codiceAutoscuola);

  await clickENnaviga(page, '#RicercaDisponibilitaSessioneEsameEP_button_value_searchElement');

  const dati = await scrapaTabella(page, 'table');
  console.log(`   ✅ Teoria: ${dati.length} sedute trovate`);
  return dati.map(r => ({ ...r, tipo_seduta: 'TEORIA', codice_autoscuola: CONFIG.codiceAutoscuola }));
}

// ─────────────────────────────────────────────────────────────
//  SCRAPING SEDUTE GUIDA
// ─────────────────────────────────────────────────────────────
async function scrapeGuida(page) {
  console.log('🚗 Scraping Sedute Guida...');

  // Naviga alla sezione guida — adatta il selettore al menu reale
  try {
    await clickENnaviga(page, '#Sessioni\\ Guida');
  } catch {
    // Prova selettore alternativo
    await clickENnaviga(page, 'a:has-text("Guida")');
  }

  const selettoraStato = '#RicercaDisponibilitaSessioneEsameEP_disponibilitaSessioneEsameEPView_disponibilitaSessioneEsameEPFrom_theStatoDisponibilitaSessioneEsameEP_selectRowId';

  await impostaValore(page, selettoraStato, 'A|');
  await impostaValore(page, '#datepicker1', oggi());
  await impostaValore(page, '#datepicker2', traGiorni(CONFIG.giorniAvanti));

  await clickENnaviga(page, '#RicercaDisponibilitaSessioneEsameEP_button_value_searchElement');

  const dati = await scrapaTabella(page, 'table');
  console.log(`   ✅ Guida: ${dati.length} sedute trovate`);
  return dati.map(r => ({ ...r, tipo_seduta: 'GUIDA', codice_autoscuola: CONFIG.codiceAutoscuola }));
}

// ─────────────────────────────────────────────────────────────
//  SCRAPING SEDUTE C.Q.C.
// ─────────────────────────────────────────────────────────────
async function scrapeCQC(page) {
  console.log('🚛 Scraping Sedute C.Q.C....');

  try {
    await clickENnaviga(page, '#Sessioni\\ CQC');
  } catch {
    await clickENnaviga(page, 'a:has-text("CQC")');
  }

  const selettoraStato = '#RicercaDisponibilitaSessioneEsameEP_disponibilitaSessioneEsameEPView_disponibilitaSessioneEsameEPFrom_theStatoDisponibilitaSessioneEsameEP_selectRowId';

  await impostaValore(page, selettoraStato, 'A|');
  await impostaValore(page, '#datepicker1', oggi());
  await impostaValore(page, '#datepicker2', traGiorni(CONFIG.giorniAvanti));

  await clickENnaviga(page, '#RicercaDisponibilitaSessioneEsameEP_button_value_searchElement');

  const dati = await scrapaTabella(page, 'table');
  console.log(`   ✅ CQC: ${dati.length} sedute trovate`);
  return dati.map(r => ({ ...r, tipo_seduta: 'CQC', codice_autoscuola: CONFIG.codiceAutoscuola }));
}

// ─────────────────────────────────────────────────────────────
//  SALVATAGGIO SU SUPABASE
//  Usa UPSERT: aggiorna se esiste, inserisce se è nuova
// ─────────────────────────────────────────────────────────────
async function salvaSupabase(sedute) {
  if (sedute.length === 0) {
    console.log('   ℹ️  Nessuna seduta da salvare');
    return;
  }

  // Normalizza i dati per la tabella Supabase
  const righe = sedute.map(s => ({
    // Chiave univoca per upsert
    id_sessione:        s['Id Sessione'] || s['Codice'] || null,
    tipo_seduta:        s.tipo_seduta,
    codice_autoscuola:  s.codice_autoscuola,

    // Campi data
    data_sessione:      toISO(s['Data Sess.'] || s['Data'] || null),
    data_apertura:      toISO(s['Data Apertura'] || null),
    data_chiusura:      toISO(s['Data Chiusura'] || null),

    // Campi seduta
    stato:              s['Stato'] || null,
    tipo_patente:       s['Tipo'] || s['Categoria'] || null,
    aula:               s['Aula'] || s['Località'] || null,
    posti_totali:       parseInt(s['Posti Tot.'] || s['Tot'] || 0) || 0,
    posti_occupati:     parseInt(s['Posti Occ.'] || s['Occ'] || 0) || 0,
    posti_liberi:       parseInt(s['Posti Lib.'] || s['Lib'] || 0) || 0,

    // Metadati
    raw_data:           JSON.stringify(s),  // salva i dati grezzi per sicurezza
    aggiornato_il:      new Date().toISOString(),
  }));

  const { data, error } = await supabase
    .from('storico_sedute')
    .upsert(righe, {
      onConflict: 'id_sessione,tipo_seduta',   // aggiorna se stessa sessione + tipo
      ignoreDuplicates: false,
    });

  if (error) {
    console.error('❌ Errore Supabase:', error.message);
  } else {
    console.log(`💾 Salvate/aggiornate ${righe.length} sedute su Supabase`);
  }
}

// ─────────────────────────────────────────────────────────────
//  CICLO PRINCIPALE
// ─────────────────────────────────────────────────────────────
async function eseguiAggiornamento() {
  const ora = new Date().toLocaleTimeString('it-IT');
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`🔄 Aggiornamento avviato — ${ora}`);
  console.log(`   📅 Periodo: ${oggi()} → ${traGiorni(CONFIG.giorniAvanti)}`);
  console.log(`   🏫 Autoscuola: ${CONFIG.codiceAutoscuola}`);
  console.log('═'.repeat(55));

  const browser = await puppeteer.launch({
    headless: CONFIG.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 920 },
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(CONFIG.timeout);

  try {
    await login(page);

    // Scraping tutte e tre le sezioni
    const teoria = await scrapeTeoria(page);
    const guida  = await scrapeGuida(page);
    const cqc    = await scrapeCQC(page);

    // Unisci tutto in un unico array
    const tuttiDati = [...teoria, ...guida, ...cqc];
    console.log(`\n📊 Totale sedute raccolte: ${tuttiDati.length}`);

    // Salva su Supabase
    await salvaSupabase(tuttiDati);

    console.log('✅ Aggiornamento completato con successo\n');

  } catch (err) {
    console.error('❌ Errore durante l\'aggiornamento:', err.message);
    await page.screenshot({ path: `errore_${Date.now()}.png`, fullPage: true });
  } finally {
    await browser.close();
  }
}

// ─────────────────────────────────────────────────────────────
//  AVVIO CON SCHEDULER
// ─────────────────────────────────────────────────────────────
(async () => {
  console.log('🚀 Gestionale Autoscuola — Storico Sedute');
  console.log(`⏱️  Aggiornamento ogni ${CONFIG.intervalloMinuti} minuti\n`);

  // Prima esecuzione immediata
  await eseguiAggiornamento();

  // Poi ripeti ogni N minuti
  const ms = CONFIG.intervalloMinuti * 60 * 1000;
  setInterval(async () => {
    await eseguiAggiornamento();
  }, ms);
})();
