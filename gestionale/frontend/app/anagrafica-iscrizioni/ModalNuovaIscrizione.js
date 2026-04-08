'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { API_BASE, authHeaders } from '../../lib/authClient'

const VOCALI = 'AEIOU'
const CONSONANTI = 'BCDFGHJKLMNPQRSTVWXYZ'
const CF_MESI = { '01':'A','02':'B','03':'C','04':'D','05':'E','06':'H','07':'L','08':'M','09':'P','10':'R','11':'S','12':'T' }
const CF_CTRL_PARI  = {0:0,1:1,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,A:0,B:1,C:2,D:3,E:4,F:5,G:6,H:7,I:8,J:9,K:10,L:11,M:12,N:13,O:14,P:15,Q:16,R:17,S:18,T:19,U:20,V:21,W:22,X:23,Y:24,Z:25}
const CF_CTRL_DISP  = {0:1,1:0,2:5,3:7,4:9,5:13,6:15,7:17,8:19,9:21,A:1,B:0,C:5,D:7,E:9,F:13,G:15,H:17,I:19,J:21,K:2,L:4,M:18,N:20,O:11,P:3,Q:6,R:8,S:12,T:14,U:16,V:10,W:22,X:25,Y:24,Z:23}
const CF_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function cfLettereParte(str) {
  const s = str.toUpperCase().replace(/[^A-Z]/g,'')
  const cons = s.split('').filter(c => CONSONANTI.includes(c))
  const voc  = s.split('').filter(c => VOCALI.includes(c))
  return [...cons, ...voc, 'X','X','X'].slice(0,3).join('')
}

function calcolaCodiceFiscale(cognome, nome, sesso, dataNascita, belfiore) {
  if (!cognome||!nome||!sesso||!dataNascita||!belfiore) return ''
  try {
    const cfCog = cfLettereParte(cognome)
    const nUp = nome.toUpperCase().replace(/[^A-Z]/g,'')
    const nCons = nUp.split('').filter(c => CONSONANTI.includes(c))
    const cfNom = nCons.length >= 4 ? nCons[0]+nCons[2]+nCons[3] : cfLettereParte(nome)
    const [anno,mese,giorno] = dataNascita.split('-')
    const cfAnno  = anno.slice(-2)
    const cfMese  = CF_MESI[mese]||'A'
    const g = parseInt(giorno)
    const cfGior  = sesso==='F' ? String(g+40).padStart(2,'0') : String(g).padStart(2,'0')
    const parziale = `${cfCog}${cfNom}${cfAnno}${cfMese}${cfGior}${belfiore.toUpperCase()}`
    let somma = 0
    for(let i=0;i<15;i++){
      const c = parziale[i]
      somma += i%2===0 ? (CF_CTRL_DISP[c]??0) : (CF_CTRL_PARI[c]??0)
    }
    return parziale + CF_CHARS[somma%26]
  } catch { return '' }
}

function validaCF(cf) {
  if(!cf||cf.length!==16) return false
  return /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST]{1}[0-9LMNPQRSTUV]{2}[A-Z]{1}[0-9LMNPQRSTUV]{3}[A-Z]{1}$/i.test(cf)
}

const COMUNI_IT = [
  {nome:'Roma',prov:'RM',belfiore:'H501',cap:'00100'},
  {nome:'Milano',prov:'MI',belfiore:'F205',cap:'20100'},
  {nome:'Napoli',prov:'NA',belfiore:'F839',cap:'80100'},
  {nome:'Torino',prov:'TO',belfiore:'L219',cap:'10100'},
  {nome:'Palermo',prov:'PA',belfiore:'G273',cap:'90100'},
  {nome:'Catania',prov:'CT',belfiore:'C351',cap:'95100'},
  {nome:'Messina',prov:'ME',belfiore:'F158',cap:'98100'},
  {nome:'Taormina',prov:'ME',belfiore:'L042',cap:'98039'},
  {nome:'Nizza di Sicilia',prov:'ME',belfiore:'F901',cap:'98026'},
  {nome:'Siracusa',prov:'SR',belfiore:'I754',cap:'96100'},
  {nome:'Agrigento',prov:'AG',belfiore:'A089',cap:'92100'},
  {nome:'Trapani',prov:'TP',belfiore:'L331',cap:'91100'},
  {nome:'Ragusa',prov:'RG',belfiore:'H163',cap:'97100'},
  {nome:'Caltanissetta',prov:'CL',belfiore:'B429',cap:'93100'},
  {nome:'Enna',prov:'EN',belfiore:'C342',cap:'94100'},
  {nome:'Firenze',prov:'FI',belfiore:'D612',cap:'50100'},
  {nome:'Bologna',prov:'BO',belfiore:'A944',cap:'40100'},
  {nome:'Venezia',prov:'VE',belfiore:'L736',cap:'30100'},
  {nome:'Bari',prov:'BA',belfiore:'A662',cap:'70100'},
  {nome:'Genova',prov:'GE',belfiore:'D969',cap:'16100'},
]

function cercaComuniSync(q) {
  if(!q||q.length<2) return []
  return COMUNI_IT.filter(c=>c.nome.toLowerCase().includes(q.toLowerCase())).slice(0,8)
}

const CATEGORIE_PAT = ['A1','A2','A','B','BE','C','CE','D','DE','CQC','ADR','NAUTICA']
const TIPI_DOC = ['','Carta Identità','Patente','Passaporto','Permesso di Soggiorno','Modello AT/BT','Altro']
const TIPI_CAMBIO = ['**SELEZIONA**','Automatico','Manuale']
const ABILITAZIONI = ['AM','A1','A2','A','B1','B','C1','C','D1','D','BE','C1E','CE','D1E','DE']
const PRESCRIZ = ['****','01-Lenti','02-Udito','03-Protesi','04-Guida automatica','05-Veicolo modificato','06-Velocità limitata','07-Distanza limitata','08-Altro']
const STATI_RICHIESTA = ['','RICHIESTA DA INVIARE','INVIATA','ACCETTATA','RIFIUTATA','SOSPESA','ANNULLATA']
const MODALITA_PAG = ['PAGOPA','CONTANTI','BONIFICO','POS','ALTRO']
const PROV_ITALIA = ['AG','AL','AN','AO','AQ','AR','AP','AT','AV','BA','BT','BL','BN','BG','BI','BO','BZ','BS','BR','CA','CL','CB','CE','CT','CZ','CH','CO','CS','CR','KR','CN','EN','FM','FE','FI','FG','FC','FR','GE','GO','GR','IM','IS','SP','LT','LE','LC','LI','LO','LU','MC','MN','MS','MT','ME','MI','MO','MB','NA','NO','NU','OR','PD','PA','PR','PV','PG','PU','PE','PC','PI','PT','PN','PZ','PO','RG','RA','RC','RE','RI','RN','RO','SA','SS','SV','SI','SR','SO','TA','TE','TR','TO','TP','TN','TV','TS','UD','VA','VE','VB','VC','VR','VV','VI','VT'].sort()

function Inp({label,asterisco,col=3,children,error,hint,...props}){
  return(
    <div className={`col-span-${col}`}>
      {label&&<label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {label}{asterisco&&<span className="ml-0.5 text-red-400">*</span>}
        {hint&&<span className="ml-1 text-[9px] font-normal normal-case text-slate-300">{hint}</span>}
      </label>}
      <input {...props} className={`w-full rounded border px-2 py-1 text-sm focus:outline-none focus:ring-1 ${error?'border-red-400 focus:ring-red-200':'border-slate-600 bg-slate-800 text-slate-100 focus:border-violet-400 focus:ring-violet-900'} disabled:opacity-40 ${props.className||''}`}/>
      {error&&<p className="mt-0.5 text-[10px] text-red-400">{error}</p>}
    </div>
  )
}

function Sel({label,asterisco,col=3,children,error,...props}){
  return(
    <div className={`col-span-${col}`}>
      {label&&<label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {label}{asterisco&&<span className="ml-0.5 text-red-400">*</span>}
      </label>}
      <select {...props} className={`w-full rounded border px-2 py-1 text-sm focus:outline-none focus:ring-1 ${error?'border-red-400':'border-slate-600 bg-slate-800 text-slate-100 focus:border-violet-400 focus:ring-violet-900'} ${props.className||''}`}>
        {children}
      </select>
      {error&&<p className="mt-0.5 text-[10px] text-red-400">{error}</p>}
    </div>
  )
}

function Sez({title,color='violet',children}){
  const colors={
    violet:'border-violet-500 text-violet-300',
    blue:'border-blue-500 text-blue-300',
    green:'border-emerald-500 text-emerald-300',
    orange:'border-orange-400 text-orange-300',
    slate:'border-slate-500 text-slate-300',
  }
  return(
    <fieldset className={`mb-3 rounded-lg border ${colors[color].split(' ')[0]} border-opacity-40`}>
      <legend className={`ml-3 px-2 text-[11px] font-bold uppercase tracking-widest ${colors[color].split(' ')[1]}`}>{title}</legend>
      <div className="grid grid-cols-12 gap-x-2 gap-y-2 p-2">{children}</div>
    </fieldset>
  )
}

function ComuneAC({label,asterisco,col=4,value,onChange,onSelect,error}){
  const [q,setQ]=useState(value||'')
  const [sugg,setSugg]=useState([])
  const [open,setOpen]=useState(false)
  const timer=useRef()
  useEffect(()=>setQ(value||''),[value])
  const search=useCallback(v=>{
    if(v.length<2){setSugg([]);setOpen(false);return}
    const r=cercaComuniSync(v)
    setSugg(r);setOpen(r.length>0)
  },[])
  return(
    <div className={`col-span-${col} relative`}>
      {label&&<label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {label}{asterisco&&<span className="ml-0.5 text-red-400">*</span>}
      </label>}
      <input value={q}
        onChange={e=>{const v=e.target.value;setQ(v);onChange?.(v);clearTimeout(timer.current);timer.current=setTimeout(()=>search(v),150)}}
        onFocus={()=>sugg.length>0&&setOpen(true)}
        onBlur={()=>setTimeout(()=>setOpen(false),150)}
        className={`w-full rounded border px-2 py-1 text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-1 ${error?'border-red-400':'border-slate-600 focus:border-violet-400 focus:ring-violet-900'}`}
      />
      {open&&<ul className="absolute z-50 mt-0.5 w-full overflow-y-auto rounded border border-slate-600 bg-slate-800 shadow-xl" style={{maxHeight:180}}>
        {sugg.map((c,i)=>(
          <li key={i} onMouseDown={()=>{setQ(c.nome);setSugg([]);setOpen(false);onSelect?.(c)}}
            className="flex cursor-pointer justify-between px-2 py-1.5 text-sm text-slate-200 hover:bg-violet-900">
            <span className="font-medium">{c.nome}</span>
            <span className="text-slate-400 text-xs">{c.prov} · {c.belfiore}</span>
          </li>
        ))}
      </ul>}
      {error&&<p className="mt-0.5 text-[10px] text-red-400">{error}</p>}
    </div>
  )
}

function TabIscrizione({d,set,errori,cfCalcolato,usaCF,cfValido}){
  return(
    <div className="space-y-1">
      <Sez title="Autoscuola e Iscrizione" color="violet">
        <Inp label="DATA" asterisco col={2} type="date" value={d.data_iscrizione} onChange={e=>set('data_iscrizione',e.target.value)}/>
        <Inp label="AUTOSC." col={2} value={d.codice_autoscuola} onChange={e=>set('codice_autoscuola',e.target.value)} placeholder="0674"/>
        <Sel label="CAT." col={2} value={d.categoria_patente} onChange={e=>set('categoria_patente',e.target.value)}>
          {CATEGORIE_PAT.map(c=><option key={c}>{c}</option>)}
        </Sel>
        <Sel label="TIPO ISCRIZIONE" asterisco col={6} value={d.tipo_iscrizione} onChange={e=>set('tipo_iscrizione',e.target.value)} error={errori.tipo_iscrizione}>
          <option value="">* SELEZIONA *</option>
          <option value="INTERNO">Interno</option>
          <option value="PRIVATISTA">Privatista</option>
          <option value="REVISIONE">Revisione</option>
          <option value="RINNOVO">Conferma di Validità (Rinnovo)</option>
          <option value="DUPLICATO">Duplicato Patente</option>
          <option value="CONVERSIONE">Conversione Patente</option>
          <option value="CQC">Patente CQC</option>
          <option value="CQC_CARD">CQC Card</option>
          <option value="ARCHIVIO">Archivio Dati</option>
          <option value="ESERCITAZIONE">Esercitazione Guida</option>
          <option value="RECUPERO_PUNTI">Recupero Punti</option>
          <option value="PERMESSO_INTERN">Permesso Internazionale</option>
          <option value="GUIDA_ACCOMPAGNATA">Guida Accompagnata</option>
          <option value="CORSO_CQC">Corso C.Q.C.</option>
          <option value="CERT_MEDICO">Certificato Medico</option>
          <option value="PERMESSO_PROV">Permesso Provvisorio</option>
          <option value="CORSO_ADR">Corso A.D.R.</option>
          <option value="PATENTE_NAUTICA">Patente Nautica</option>
        </Sel>
      </Sez>

      <Sez title="Protocollo e Registro" color="blue">
        <Inp label="PROTOCOLLO" col={2} value={d.numero_registro} onChange={e=>set('numero_registro',e.target.value)}/>
        <Inp label="EMESSO IL" col={2} type="date" value={d.ppg_data_emissione} onChange={e=>set('ppg_data_emissione',e.target.value)}/>
        <Inp label="SCADE IL" col={2} type="date" value={d.ppg_data_scadenza} onChange={e=>set('ppg_data_scadenza',e.target.value)}/>
        <Inp label="N° REG." col={2} value={d.ppg_numero} onChange={e=>set('ppg_numero',e.target.value)}/>
        <Inp label="DATA REGIS." col={2} type="date" value={d.data_registro} onChange={e=>set('data_registro',e.target.value)}/>
        <div className="col-span-2 flex items-end">
          <button className="w-full rounded bg-blue-700 py-1 text-xs font-bold text-white hover:bg-blue-600">🔍 Cerca</button>
        </div>
        <Inp label="COD. CAN." col={2} value={d.cod_candidato||''} onChange={e=>set('cod_candidato',e.target.value)}/>
        <Inp label="EMISS. FOG. ROSA" col={3} type="date" value={d.emiss_foglio_rosa||''} onChange={e=>set('emiss_foglio_rosa',e.target.value)}/>
        <Inp label="SCAD. FOG. ROSA" col={3} type="date" value={d.scad_foglio_rosa||''} onChange={e=>set('scad_foglio_rosa',e.target.value)}/>
        <Sel label="STATO DELLA RICHIESTA" col={4} value={d.stato_richiesta} onChange={e=>set('stato_richiesta',e.target.value)}>
          {STATI_RICHIESTA.map(s=><option key={s} value={s}>{s||'— seleziona —'}</option>)}
        </Sel>
      </Sez>

      <Sez title="Dati Anagrafici e Residenza" color="green">
        <Inp label="COGNOME" asterisco col={3} value={d.cognome} onChange={e=>set('cognome',e.target.value.toUpperCase())} error={errori.cognome}/>
        <Inp label="NOME" asterisco col={3} value={d.nome} onChange={e=>set('nome',e.target.value.toUpperCase())} error={errori.nome}/>
        <Inp label="DIACRITICI" col={2} value={d.diacritici} onChange={e=>set('diacritici',e.target.value)} placeholder="è,à"/>
        <Sel label="SESSO" col={1} value={d.sesso} onChange={e=>set('sesso',e.target.value)}>
          <option value="M">M</option><option value="F">F</option>
        </Sel>
        <Inp label="DATA NASC." asterisco col={2} type="date" value={d.data_nascita} onChange={e=>set('data_nascita',e.target.value)} error={errori.data_nascita}/>
        <Inp label="ETÀ" col={1} value={d.eta||''} readOnly className="bg-slate-700 cursor-not-allowed"/>

        <ComuneAC label="LOCALITÀ NASCITA" asterisco col={3}
          value={d.comune_nascita}
          onChange={v=>set('comune_nascita',v)}
          onSelect={c=>{set('comune_nascita',c.nome);set('prov_nascita',c.prov);set('sigla_nascita',c.belfiore)}}
          error={errori.comune_nascita}
        />
        <Sel label="PROV." col={1} value={d.prov_nascita} onChange={e=>set('prov_nascita',e.target.value)}>
          <option value="">***</option>
          {PROV_ITALIA.map(p=><option key={p}>{p}</option>)}
        </Sel>
        <Sel label="STATO ESTERO NASCITA" col={3} value={d.stato_estero_nascita} onChange={e=>set('stato_estero_nascita',e.target.value)}>
          <option value="">*** SELEZ. STATO DI NASCITA ***</option>
          <option value="ITALIA">ITALIA</option>
          <option value="ALBANIA">ALBANIA</option>
          <option value="MAROCCO">MAROCCO</option>
          <option value="ROMANIA">ROMANIA</option>
          <option value="UCRAINA">UCRAINA</option>
          <option value="ALTRO">ALTRO</option>
        </Sel>
        <Inp label="LOC. ESTERA NASCITA" col={3} value={d.localita_estera_nascita} onChange={e=>set('localita_estera_nascita',e.target.value)}/>
        <Inp label="SIGLA" col={2} value={d.sigla_nascita} onChange={e=>set('sigla_nascita',e.target.value.toUpperCase())} maxLength={4}/>

        <div className="col-span-3">
          <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-slate-400">
            CODICE FISCALE <span className="text-red-400">*</span>
          </label>
          <div className="flex gap-1">
            <div className="relative flex-1">
              <input value={d.codice_fiscale} onChange={e=>set('codice_fiscale',e.target.value.toUpperCase())} maxLength={16}
                className={`w-full rounded border px-2 py-1 font-mono text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-1 ${errori.codice_fiscale?'border-red-400':cfValido===true?'border-emerald-400':cfValido===false?'border-red-400':'border-slate-600 focus:border-violet-400 focus:ring-violet-900'}`}
                placeholder="RSSMRA80A01H501U"/>
              {cfValido===true&&<span className="absolute right-2 top-1.5 text-xs text-emerald-400">✓</span>}
              {cfValido===false&&<span className="absolute right-2 top-1.5 text-xs text-red-400">✗</span>}
            </div>
            <button onClick={()=>set('codice_fiscale','')} title="Pulisci" className="rounded border border-slate-600 bg-slate-700 px-2 text-xs text-slate-300 hover:bg-slate-600">✕</button>
          </div>
          {errori.codice_fiscale&&<p className="mt-0.5 text-[10px] text-red-400">{errori.codice_fiscale}</p>}
          {cfCalcolato&&cfCalcolato!==d.codice_fiscale&&(
            <button onClick={usaCF} className="mt-1 w-full rounded border border-violet-600 bg-violet-900 py-0.5 text-[10px] font-mono font-bold text-violet-200 hover:bg-violet-800">
              ← Usa CF calcolato: {cfCalcolato}
            </button>
          )}
        </div>
        <Inp label="CITTADINANZA" col={2} value={d.cittadinanza} onChange={e=>set('cittadinanza',e.target.value.toUpperCase())}/>
        <ComuneAC label="LOCALITÀ RESIDENZA" col={3}
          value={d.comune_residenza}
          onChange={v=>set('comune_residenza',v)}
          onSelect={c=>{set('comune_residenza',c.nome);set('prov_residenza',c.prov);if(!d.cap_residenza)set('cap_residenza',c.cap||'')}}
        />
        <Sel label="PROV." col={1} value={d.prov_residenza} onChange={e=>set('prov_residenza',e.target.value)}>
          <option value="">***</option>
          {PROV_ITALIA.map(p=><option key={p}>{p}</option>)}
        </Sel>
        <Inp label="C.A.P." col={2} value={d.cap_residenza} onChange={e=>set('cap_residenza',e.target.value)} maxLength={5}/>
        <Inp label="TOPONIMO" col={2} value={d.toponimo_residenza} onChange={e=>set('toponimo_residenza',e.target.value.toUpperCase())} placeholder="VIA / PIAZZA..."/>
        <Inp label="INDIRIZZO" col={6} value={d.indirizzo_residenza} onChange={e=>set('indirizzo_residenza',e.target.value.toUpperCase())}/>
        <Inp label="N° CIVICO" col={2} value={d.numero_civico} onChange={e=>set('numero_civico',e.target.value)}/>
        <div className="col-span-12 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase text-slate-400 whitespace-nowrap">UBICAZIONE E RECAPITI TELEFONICI</span>
        </div>
        <Inp label="UBICAZIONE UNO" col={3} value={d.ubicazione_uno} onChange={e=>set('ubicazione_uno',e.target.value)}/>
        <Inp label="UBICAZIONE DUE" col={3} value={d.ubicazione_due} onChange={e=>set('ubicazione_due',e.target.value)}/>
        <Inp label="TEL. 1" col={2} type="tel" value={d.telefono_1} onChange={e=>set('telefono_1',e.target.value)}/>
        <Inp label="TEL. 2" col={2} type="tel" value={d.telefono_2} onChange={e=>set('telefono_2',e.target.value)}/>
        <Inp label="INDIRIZZO EMAIL" col={2} type="email" value={d.email_contatto} onChange={e=>set('email_contatto',e.target.value.toLowerCase())}/>
      </Sez>

      <div className="grid grid-cols-2 gap-2">
        <Sez title="Documento Riconoscimento" color="orange">
          <Sel label="TIPO DOCUMENTO" col={6} value={d.tipo_documento} onChange={e=>set('tipo_documento',e.target.value)}>
            {TIPI_DOC.map(t=><option key={t} value={t}>{t||'* SELEZIONARE *'}</option>)}
          </Sel>
          <Inp label="NUMERO DOCUMENTO" col={6} value={d.numero_documento} onChange={e=>set('numero_documento',e.target.value.toUpperCase())}/>
          <Inp label="RILASCIATO IL" col={6} type="date" value={d.rilasciato_il_documento} onChange={e=>set('rilasciato_il_documento',e.target.value)}/>
          <Inp label="SCADE IL" col={6} type="date" value={d.scade_il_documento} onChange={e=>set('scade_il_documento',e.target.value)}/>
          <Inp label="ENTE DI RILASCIO" col={12} value={d.ente_rilascio_documento} onChange={e=>set('ente_rilascio_documento',e.target.value)} placeholder="Comune / Questura..."/>
        </Sez>
        <Sez title="Patente Posseduta" color="slate">
          <Inp label="NUMERO PATENTE" col={6} value={d.numero_patente_posseduta} onChange={e=>set('numero_patente_posseduta',e.target.value.toUpperCase())}/>
          <Inp label="RILASCIATA IL" col={6} type="date" value={d.rilasciata_il_patente} onChange={e=>set('rilasciata_il_patente',e.target.value)}/>
          <Inp label="SCADE IL" col={6} type="date" value={d.scade_il_patente} onChange={e=>set('scade_il_patente',e.target.value)}/>
          <Inp label="ENTE DI RILASCIO" col={12} value={d.ente_rilascio_patente} onChange={e=>set('ente_rilascio_patente',e.target.value)}/>
        </Sez>
      </div>

      <Sez title="Note" color="slate">
        <div className="col-span-9">
          <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-slate-400">NOTE</label>
          <textarea value={d.note} onChange={e=>set('note',e.target.value)} rows={2}
            className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 focus:border-violet-400 focus:outline-none resize-none"/>
        </div>
        <Inp label="PRESENZE A2/A" col={3} value={d.presenze_a2_a} onChange={e=>set('presenze_a2_a',e.target.value)}/>
      </Sez>
    </div>
  )
}

function TabRichiesta({d,set}){
  const [abilGrid,setAbilGrid]=useState(
    ABILITAZIONI.reduce((acc,a)=>({...acc,[a]:{richiesta:false,T:false,posseduta:false,data:'',annotazioni:''}}),{})
  )
  const toggleAbil=(abil,campo)=>setAbilGrid(prev=>({...prev,[abil]:{...prev[abil],[campo]:!prev[abil][campo]}}))
  return(
    <div className="space-y-1">
      <Sez title="Dati Patente e Veicoli" color="violet">
        <Sel label="PAT. RICH." col={2} value={d.pat_rich||'****'} onChange={e=>set('pat_rich',e.target.value)}>
          <option>****</option>{CATEGORIE_PAT.map(c=><option key={c}>{c}</option>)}
        </Sel>
        <Sel label="TIPO CAMBIO VEICOLO" col={4} value={d.tipo_cambio||''} onChange={e=>set('tipo_cambio',e.target.value)}>
          {TIPI_CAMBIO.map(t=><option key={t}>{t}</option>)}
        </Sel>
        <div className="col-span-12">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-slate-700">
                <th className="border border-slate-600 px-2 py-1 text-left text-slate-300">TIPO ABILIT.</th>
                <th className="border border-slate-600 px-2 py-1 text-slate-300">Rich.</th>
                <th className="border border-slate-600 px-2 py-1 text-slate-300">T</th>
                <th className="border border-slate-600 px-2 py-1 text-slate-300">Poss.</th>
                <th className="border border-slate-600 px-2 py-1 text-slate-300">Data Conseg.</th>
                <th className="border border-slate-600 px-2 py-1 text-left text-slate-300">ANNOTAZIONI</th>
                <th className="border border-slate-600 px-2 py-1 text-slate-300">✕</th>
              </tr>
            </thead>
            <tbody>
              {ABILITAZIONI.map(a=>(
                <tr key={a} className="border-b border-slate-700 hover:bg-slate-800">
                  <td className="border border-slate-700 px-2 py-0.5 font-bold text-slate-200">{a}</td>
                  <td className="border border-slate-700 px-2 py-0.5 text-center"><input type="checkbox" checked={abilGrid[a].richiesta} onChange={()=>toggleAbil(a,'richiesta')} className="accent-violet-500"/></td>
                  <td className="border border-slate-700 px-2 py-0.5 text-center"><input type="checkbox" checked={abilGrid[a].T} onChange={()=>toggleAbil(a,'T')} className="accent-violet-500"/></td>
                  <td className="border border-slate-700 px-2 py-0.5 text-center"><input type="checkbox" checked={abilGrid[a].posseduta} onChange={()=>toggleAbil(a,'posseduta')} className="accent-violet-500"/></td>
                  <td className="border border-slate-700 px-1 py-0.5">
                    <input type="date" value={abilGrid[a].data} onChange={e=>setAbilGrid(prev=>({...prev,[a]:{...prev[a],data:e.target.value}}))}
                      className="w-full rounded bg-slate-700 px-1 py-0.5 text-[11px] text-slate-200 border-0 focus:outline-none"/>
                  </td>
                  <td className="border border-slate-700 px-1 py-0.5">
                    <input value={abilGrid[a].annotazioni} onChange={e=>setAbilGrid(prev=>({...prev,[a]:{...prev[a],annotazioni:e.target.value}}))}
                      className="w-full rounded bg-slate-700 px-1 py-0.5 text-[11px] text-slate-200 border-0 focus:outline-none"/>
                  </td>
                  <td className="border border-slate-700 px-2 py-0.5 text-center">
                    <button onClick={()=>setAbilGrid(prev=>({...prev,[a]:{richiesta:false,T:false,posseduta:false,data:'',annotazioni:''}}))} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Sel label="ESAME GUIDA" col={3} value={d.esame_guida||''} onChange={e=>set('esame_guida',e.target.value)}>
          <option value="">*SELEZIO*</option>
          <option value="TEORICO">Teorico</option>
          <option value="PRATICO">Pratico</option>
          <option value="ENTRAMBI">Entrambi</option>
        </Sel>
        <Inp label="DATA APPR." col={2} type="date" value={d.data_approvazione||''} onChange={e=>set('data_approvazione',e.target.value)}/>
        <Inp label="ABILITAZIONI RICHIESTE" col={4} value={d.abilitazioni_richieste||''} onChange={e=>set('abilitazioni_richieste',e.target.value)}/>
        <Inp label="ABILITAZIONI POSSEDUTE" col={3} value={d.abilitazioni_possedute||''} onChange={e=>set('abilitazioni_possedute',e.target.value)}/>
        <Inp label="PROTOC. PREC." hint="(riporto teoria)" col={3} value={d.protocollo_precedente||''} onChange={e=>set('protocollo_precedente',e.target.value)}/>
        <Inp label="N. C.Q.C. CARD" col={3} value={d.numero_cqc_card||''} onChange={e=>set('numero_cqc_card',e.target.value)}/>
        <Inp label="DATA INIZIO CORSO C.Q.C." col={3} type="date" value={d.data_inizio_corso_cqc||''} onChange={e=>set('data_inizio_corso_cqc',e.target.value)}/>
      </Sez>
      <Sez title="Dati Conferimento Centro Istruzione" color="blue">
        <Sel label="PROV. CENTRO ISTRUZIONE" col={4} value={d.prov_centro_istruzione||''} onChange={e=>set('prov_centro_istruzione',e.target.value)}>
          <option value="">**************</option>
          {PROV_ITALIA.map(p=><option key={p}>{p}</option>)}
        </Sel>
        <Inp label="SIGLA C.I.A." col={3} value={d.sigla_cia||''} onChange={e=>set('sigla_cia',e.target.value.toUpperCase())}/>
      </Sez>
      <Sez title="Dati Pagamento" color="orange">
        <Sel label="MODALITÀ PAGAMENTO" col={4} value={d.modalita_pagamento||'PAGOPA'} onChange={e=>set('modalita_pagamento',e.target.value)}>
          {MODALITA_PAG.map(m=><option key={m}>{m}</option>)}
        </Sel>
        <Inp label="IDENT. PAGAMENTO" col={4} value={d.ident_pagamento||''} onChange={e=>set('ident_pagamento',e.target.value)}/>
        <div className="col-span-12 grid grid-cols-2 gap-4">
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase text-yellow-400">CONSEGUIMENTO PATENTE</p>
            <div className="grid grid-cols-2 gap-2">
              <Inp label="IDENT. RICHIESTA PAGOPA" col={2} value={d.pagopa_rich_conseguimento||''} onChange={e=>set('pagopa_rich_conseguimento',e.target.value)}/>
              <Inp label="ESTR. DI PAGAMENTO O N° IUV" col={2} value={d.iuv_conseguimento||''} onChange={e=>set('iuv_conseguimento',e.target.value)}/>
            </div>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase text-yellow-400">ESAME DI GUIDA</p>
            <div className="grid grid-cols-2 gap-2">
              <Inp label="IDENT. RICHIESTA PAGOPA" col={2} value={d.pagopa_rich_guida||''} onChange={e=>set('pagopa_rich_guida',e.target.value)}/>
              <div className="col-span-2">
                <button className="w-full rounded bg-blue-700 py-1 text-[10px] font-bold text-white hover:bg-blue-600">📄 GENERAZIONE E PAGAMENTO IUV</button>
              </div>
            </div>
          </div>
        </div>
      </Sez>
    </div>
  )
}

function TabCertMedico({d,set}){
  return(
    <div className="space-y-1">
      <Sez title="Protocollo - Stato Richiesta" color="violet">
        <Inp label="AUTOSC." col={1} value={d.codice_autoscuola} readOnly className="bg-slate-700 cursor-not-allowed"/>
        <Inp label="LOCAL. E PROV. VISITA MEDICA" col={4} value={d.localita_visita_medica||''} onChange={e=>set('localita_visita_medica',e.target.value)}/>
        <Sel label="PROV." col={1} value={d.prov_visita_medica||'ME'} onChange={e=>set('prov_visita_medica',e.target.value)}>
          {PROV_ITALIA.map(p=><option key={p}>{p}</option>)}
        </Sel>
        <Inp label="ID RICHIESTA" col={2} value={d.cert_id_richiesta||''} onChange={e=>set('cert_id_richiesta',e.target.value)}/>
        <Inp label="DATA" col={2} type="date" value={d.cert_data_richiesta||''} onChange={e=>set('cert_data_richiesta',e.target.value)}/>
        <Inp label="PROT. CERTIFICATO" col={2} value={d.prot_certificato||''} onChange={e=>set('prot_certificato',e.target.value)}/>
        <Sel label="STATO DELLA RICHIESTA" col={4} value={d.stato_cert_medico||'RICHIESTA DA INVIARE'} onChange={e=>set('stato_cert_medico',e.target.value)}>
          {STATI_RICHIESTA.map(s=><option key={s} value={s}>{s||'—'}</option>)}
        </Sel>
        <div className="col-span-2 flex items-end">
          <button className="w-full rounded bg-blue-700 py-1 text-xs font-bold text-white hover:bg-blue-600">🔄 Aggiorna</button>
        </div>
      </Sez>
      <Sez title="Dati Medici" color="blue">
        <Inp label="DATA VISITA" col={2} type="date" value={d.data_visita||''} onChange={e=>set('data_visita',e.target.value)}/>
        <Inp label="ABILIT. CERT. MED." col={2} value={d.abilit_cert_med||''} onChange={e=>set('abilit_cert_med',e.target.value)}/>
        <Inp label="ANNOTAZIONI / DISPOSITIVI" col={4} value={d.annotazioni_dispositivi||''} onChange={e=>set('annotazioni_dispositivi',e.target.value)}/>
        <Inp label="SCADENZA (SE RIDOTTA)" col={2} type="date" value={d.scadenza_cert_ridotta||''} onChange={e=>set('scadenza_cert_ridotta',e.target.value)}/>
        <div className="col-span-2 space-y-1 flex flex-col justify-end">
          <label className="flex items-center gap-1 text-[10px] text-slate-300 cursor-pointer"><input type="checkbox" checked={d.elimina_ab_am||false} onChange={e=>set('elimina_ab_am',e.target.checked)} className="accent-violet-500"/>ELIMINA AB. AM</label>
          <label className="flex items-center gap-1 text-[10px] text-slate-300 cursor-pointer"><input type="checkbox" checked={d.elimina_ab_a1||false} onChange={e=>set('elimina_ab_a1',e.target.checked)} className="accent-violet-500"/>ELIMINA AB. A1-A2-A</label>
          <label className="flex items-center gap-1 text-[10px] text-slate-300 cursor-pointer"><input type="checkbox" checked={d.obbligo_esperim_guida||false} onChange={e=>set('obbligo_esperim_guida',e.target.checked)} className="accent-violet-500"/>OBBLIGO ESPERIM. GUIDA</label>
        </div>
        <Sel label="RICLASSIFICAZ. VOLONTARIA" col={2} value={d.riclassificaz_vol||'NO'} onChange={e=>set('riclassificaz_vol',e.target.value)}><option>NO</option><option>SÌ</option></Sel>
        <Sel label="TEMPO EXTRA TEORIA" col={2} value={d.tempo_extra_teoria||'NO'} onChange={e=>set('tempo_extra_teoria',e.target.value)}><option>NO</option><option>SÌ</option></Sel>
        <Sel label="TEMPI DI REAZIONE" col={2} value={d.tempi_reazione||'NO'} onChange={e=>set('tempi_reazione',e.target.value)}><option>NO</option><option>SÌ</option></Sel>
        <Inp label="OBBLIGO C.M.L." col={2} value={d.obbligo_cml||''} onChange={e=>set('obbligo_cml',e.target.value)}/>
        <Inp label="CODICE MEDICO" col={2} value={d.codice_medico||''} onChange={e=>set('codice_medico',e.target.value)}/>
        <div className="col-span-6"><label className="mb-0.5 block text-[10px] font-bold uppercase text-slate-400">NOTE PRESCR. TECNICHE</label><textarea value={d.note_prescr_tecniche||''} onChange={e=>set('note_prescr_tecniche',e.target.value)} rows={3} className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 resize-none focus:outline-none"/></div>
        <div className="col-span-6"><label className="mb-0.5 block text-[10px] font-bold uppercase text-slate-400">NOTE AGGIUNT. RICHIESTA</label><textarea value={d.note_aggiunt_richiesta||''} onChange={e=>set('note_aggiunt_richiesta',e.target.value)} rows={3} className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 resize-none focus:outline-none"/></div>
      </Sez>
      <Sez title="Prescrizioni Tecniche" color="orange">
        <div className="col-span-12 grid grid-cols-4 gap-2">
          {[1,2,3,4,5,6,7,8].map(n=>(
            <div key={n} className="flex items-center gap-1">
              <span className="text-[10px] text-slate-400 font-bold">{n})</span>
              <select value={d[`prescriz_${n}`]||'****'} onChange={e=>set(`prescriz_${n}`,e.target.value)} className="flex-1 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-xs text-slate-200">{PRESCRIZ.map(p=><option key={p}>{p}</option>)}</select>
              <select value={d[`prescriz_${n}_modo`]||'N'} onChange={e=>set(`prescriz_${n}_modo`,e.target.value)} className="w-12 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-xs text-slate-200"><option value="N">N</option><option value="S">S</option></select>
            </div>
          ))}
        </div>
        <Inp label="LIMITE VELOCITÀ" col={2} value={d.limite_velocita||''} onChange={e=>set('limite_velocita',e.target.value)}/>
        <Inp label="LIMITE DISTANZA" col={2} value={d.limite_distanza||''} onChange={e=>set('limite_distanza',e.target.value)}/>
      </Sez>
      <Sez title="Dati Pagamento Certificato Medico" color="slate">
        <Sel label="MOD. PAGAMENTO" col={3} value={d.cert_mod_pagamento||'PAGOPA'} onChange={e=>set('cert_mod_pagamento',e.target.value)}>{MODALITA_PAG.map(m=><option key={m}>{m}</option>)}</Sel>
        <Inp label="IDENT. RICHIESTA PAGOPA" col={3} value={d.cert_pagopa_rich||''} onChange={e=>set('cert_pagopa_rich',e.target.value)}/>
        <Inp label="ESTREMO O N° IUV" col={3} value={d.cert_iuv||''} onChange={e=>set('cert_iuv',e.target.value)}/>
        <div className="col-span-12"><button className="rounded bg-blue-700 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-600">📄 GENERAZIONE E PAGAMENTO IUV</button></div>
      </Sez>
      <Sez title="Opzioni Trasmissione Certificato Medico" color="green">
        <div className="col-span-12"><button className="rounded bg-blue-700 px-6 py-2 text-sm font-bold text-white hover:bg-blue-600">🌐 INVIO I FASE</button></div>
      </Sez>
    </div>
  )
}

function TabContabile({d,set}){
  const [voci,setVoci]=useState([])
  const totale=voci.reduce((s,v)=>s+(parseFloat(v.importo)||0),0)
  return(
    <div className="space-y-1">
      <Sez title="Impostazione Prezzi" color="violet">
        <div className="col-span-12">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-slate-700">
                <th className="border border-slate-600 px-3 py-1.5 text-left text-slate-300">DESCRIZIONE COSTO</th>
                <th className="border border-slate-600 px-3 py-1.5 text-slate-300 w-24">IMPORTO €</th>
                <th className="border border-slate-600 px-3 py-1.5 text-slate-300 w-36">TIPO DI ADDEBITO</th>
                <th className="border border-slate-600 px-3 py-1.5 text-slate-300 w-36">DA ESCLUDERE</th>
                <th className="border border-slate-600 px-2 py-1.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {voci.length===0&&<tr><td colSpan={5} className="border border-slate-700 px-3 py-4 text-center text-xs text-slate-500 italic">Nessuna voce — clicca + per aggiungere</td></tr>}
              {voci.map((v,i)=>(
                <tr key={i}>
                  <td className="border border-slate-700 px-1 py-0.5"><input value={v.descrizione} onChange={e=>setVoci(p=>p.map((x,j)=>j===i?{...x,descrizione:e.target.value}:x))} className="w-full bg-transparent text-slate-200 focus:outline-none px-1"/></td>
                  <td className="border border-slate-700 px-1 py-0.5"><input type="number" step="0.01" value={v.importo} onChange={e=>setVoci(p=>p.map((x,j)=>j===i?{...x,importo:e.target.value}:x))} className="w-full bg-transparent text-right text-slate-200 focus:outline-none px-1"/></td>
                  <td className="border border-slate-700 px-1 py-0.5"><select value={v.tipo_addebito} onChange={e=>setVoci(p=>p.map((x,j)=>j===i?{...x,tipo_addebito:e.target.value}:x))} className="w-full bg-slate-800 text-slate-200 text-xs border-0 focus:outline-none"><option value="">—</option><option>Iscrizione</option><option>Teoria</option><option>Guida</option><option>Esame</option><option>Certificato</option><option>Bollo</option></select></td>
                  <td className="border border-slate-700 px-2 py-0.5 text-center"><input type="checkbox" checked={v.escludi||false} onChange={e=>setVoci(p=>p.map((x,j)=>j===i?{...x,escludi:e.target.checked}:x))} className="accent-violet-500"/></td>
                  <td className="border border-slate-700 px-1 py-0.5 text-center"><button onClick={()=>setVoci(p=>p.filter((_,j)=>j!==i))} className="text-red-400 hover:text-red-300">✕</button></td>
                </tr>
              ))}
              {voci.length>0&&<tr className="bg-slate-700 font-bold"><td className="border border-slate-600 px-3 py-1 text-slate-300">TOTALE</td><td className="border border-slate-600 px-3 py-1 text-right text-emerald-300">€ {totale.toFixed(2)}</td><td colSpan={3}></td></tr>}
            </tbody>
          </table>
          <div className="mt-2 flex gap-2">
            <button onClick={()=>setVoci(p=>[...p,{descrizione:'',importo:'',tipo_addebito:'',escludi:false}])} className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-700 text-lg font-bold text-white hover:bg-emerald-600">+</button>
            <button className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-600 text-sm text-slate-300 hover:bg-slate-500">📝</button>
            <button onClick={()=>setVoci([])} className="flex h-9 w-9 items-center justify-center rounded-full bg-red-800 text-sm text-white hover:bg-red-700">−</button>
            <button className="ml-auto rounded border border-slate-600 bg-slate-700 px-3 py-1 text-xs font-bold text-slate-300 hover:bg-slate-600">📋 IMPOSTA DA LISTINO</button>
          </div>
        </div>
      </Sez>
      <Sez title="Eventuali Variazioni" color="orange">
        <Inp label="IMPORTO VARIAZIONE €" col={3} type="number" step="0.01" value={d.variazione_importo||''} onChange={e=>set('variazione_importo',e.target.value)}/>
        <Inp label="MOTIVO DELLA VARIAZIONE" col={9} value={d.variazione_motivo||''} onChange={e=>set('variazione_motivo',e.target.value)}/>
      </Sez>
    </div>
  )
}

function TabPrivacy({d,set}){
  return(
    <div className="space-y-2">
      <Sez title="Gestione Privacy" color="violet">
        <div className="col-span-12 space-y-6 py-2">
          <div className="rounded-lg border border-slate-600 p-4">
            <p className="mb-3 text-sm text-slate-300 leading-relaxed">Acconsente di ricevere messaggi di cortesia (ad es. avviso scadenza patente, comunicazioni riguardo servizi dell&apos;autoscuola o la propria iscrizione)</p>
            <div className="flex gap-8">
              <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="consenso1" value="SI" checked={d.privacy_consenso_comunicazioni==='SI'} onChange={()=>set('privacy_consenso_comunicazioni','SI')} className="accent-violet-500 w-4 h-4"/><span className="font-bold text-emerald-400">✅ Conferisce il consenso</span></label>
              <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="consenso1" value="NO" checked={d.privacy_consenso_comunicazioni==='NO'} onChange={()=>set('privacy_consenso_comunicazioni','NO')} className="accent-red-500 w-4 h-4"/><span className="font-bold text-red-400">❌ Rifiuta il consenso</span></label>
            </div>
          </div>
          <div className="rounded-lg border border-slate-600 p-4">
            <p className="mb-3 text-sm text-slate-300 leading-relaxed">Acconsente all&apos;utilizzo della propria immagine su foto o video da utilizzare su siti o pagine internet di competenza dell&apos;autoscuola</p>
            <div className="flex gap-8">
              <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="consenso2" value="SI" checked={d.privacy_consenso_immagine==='SI'} onChange={()=>set('privacy_consenso_immagine','SI')} className="accent-violet-500 w-4 h-4"/><span className="font-bold text-emerald-400">✅ Conferisce il consenso</span></label>
              <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="consenso2" value="NO" checked={d.privacy_consenso_immagine==='NO'} onChange={()=>set('privacy_consenso_immagine','NO')} className="accent-red-500 w-4 h-4"/><span className="font-bold text-red-400">❌ Rifiuta il consenso</span></label>
            </div>
          </div>
          <div className="flex justify-center">
            <button className="flex items-center gap-3 rounded-lg border border-slate-600 bg-slate-800 px-6 py-3 text-sm font-bold text-slate-300 hover:bg-slate-700">
              <span className="text-2xl">🇪🇺</span><span>GDPR INFORMATIVA</span><span className="text-xl">🖨</span>
            </button>
          </div>
        </div>
      </Sez>
    </div>
  )
}

function FotoFirma({d,set}){
  const fotoRef=useRef()
  const firmaRef=useRef()
  const leggi=(file,campo)=>{const r=new FileReader();r.onload=e=>set(campo,e.target.result);r.readAsDataURL(file)}
  return(
    <div className="flex w-36 shrink-0 flex-col gap-2">
      <div className="rounded-lg border border-slate-600 bg-slate-800 overflow-hidden">
        <div className="bg-violet-800 px-2 py-1"><span className="text-[10px] font-bold uppercase tracking-widest text-white">Foto</span></div>
        <div className="p-2">
          <div className="relative flex h-28 w-full cursor-pointer items-center justify-center rounded border-2 border-dashed border-slate-600 bg-slate-900 hover:border-violet-500 transition-colors" onDoubleClick={()=>fotoRef.current.click()}>
            {d.foto_data_url
              /* eslint-disable-next-line @next/next/no-img-element */
              ?<img src={d.foto_data_url} className="h-full w-full object-cover rounded" alt="foto"/>
              :<div className="text-center"><div className="text-2xl">📷</div><div className="text-[10px] text-slate-500 mt-1">Doppio click</div></div>}
            <input ref={fotoRef} type="file" accept="image/*" className="hidden" onChange={e=>e.target.files[0]&&leggi(e.target.files[0],'foto_data_url')}/>
          </div>
          {d.foto_data_url&&<button onClick={()=>set('foto_data_url','')} className="mt-1 w-full text-[10px] text-red-400 hover:text-red-300">✕ Rimuovi</button>}
          <button onClick={()=>fotoRef.current.click()} className="mt-1 w-full rounded bg-violet-700 py-1 text-[10px] font-bold text-white hover:bg-violet-600">Scanner</button>
          <p className="mt-0.5 text-center text-[9px] text-slate-500">Doppio click acquisizione</p>
        </div>
      </div>
      <div className="rounded-lg border border-slate-600 bg-slate-800 overflow-hidden">
        <div className="bg-slate-700 px-2 py-1"><span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Firma</span></div>
        <div className="p-2">
          <div className="relative flex h-16 w-full cursor-pointer items-center justify-center rounded border-2 border-dashed border-slate-600 bg-slate-900 hover:border-violet-500 transition-colors" onDoubleClick={()=>firmaRef.current.click()}>
            {d.firma_data_url
              /* eslint-disable-next-line @next/next/no-img-element */
              ?<img src={d.firma_data_url} className="h-full w-full object-contain rounded" alt="firma"/>
              :<div className="text-center"><div className="text-xl">✍️</div><div className="text-[10px] text-slate-500">Doppio click</div></div>}
            <input ref={firmaRef} type="file" accept="image/*" className="hidden" onChange={e=>e.target.files[0]&&leggi(e.target.files[0],'firma_data_url')}/>
          </div>
          {d.firma_data_url&&<button onClick={()=>set('firma_data_url','')} className="mt-1 w-full text-[10px] text-red-400 hover:text-red-300">✕ Rimuovi</button>}
          <p className="mt-1 text-center text-[9px] text-slate-500">Doppio click acquisizione</p>
        </div>
      </div>
      <div className="mt-auto space-y-1.5">
        <button className="w-full rounded bg-slate-700 py-1.5 text-[10px] font-bold text-slate-300 hover:bg-slate-600">🔍 CERCA</button>
        <button className="w-full rounded bg-amber-700 py-1.5 text-[10px] font-bold text-white hover:bg-amber-600">📝 NOTE</button>
        <button className="w-full rounded bg-slate-700 py-1.5 text-[10px] font-bold text-slate-300 hover:bg-slate-600">🖨 STAMPE</button>
        <button className="w-full rounded bg-slate-700 py-1.5 text-[10px] font-bold text-slate-300 hover:bg-slate-600">⚙️ OPZIONI C.E.D.</button>
      </div>
    </div>
  )
}

const TABS=[
  {id:'iscrizione',label:'Dati Iscrizione e Anagrafici'},
  {id:'richiesta', label:'Dati Richiesta e Pagamento'},
  {id:'certmedico',label:'Certificato Medico'},
  {id:'contabile', label:'Scheda Contabile'},
  {id:'privacy',   label:'Privacy'},
]

const STATO_INIZIALE={
  data_iscrizione:new Date().toISOString().split('T')[0],
  codice_autoscuola:'',categoria_patente:'B',tipo_iscrizione:'',
  numero_registro:'',data_registro:new Date().toISOString().split('T')[0],
  ppg_numero:'',ppg_data_emissione:'',ppg_data_scadenza:'',
  stato_richiesta:'',stato_richiesta_testo:'',
  cod_candidato:'',emiss_foglio_rosa:'',scad_foglio_rosa:'',
  cognome:'',nome:'',diacritici:'',sesso:'M',data_nascita:'',eta:'',
  comune_nascita:'',prov_nascita:'',stato_estero_nascita:'',
  localita_estera_nascita:'',sigla_nascita:'',codice_fiscale:'',
  cittadinanza:'ITALIANA',comune_residenza:'',prov_residenza:'',
  cap_residenza:'',localita_residenza:'',toponimo_residenza:'',
  indirizzo_residenza:'',numero_civico:'',ubicazione_uno:'',
  ubicazione_due:'',telefono_1:'',telefono_2:'',email_contatto:'',
  tipo_documento:'',numero_documento:'',ente_rilascio_documento:'',
  rilasciato_il_documento:'',scade_il_documento:'',
  numero_patente_posseduta:'',ente_rilascio_patente:'',
  rilasciata_il_patente:'',scade_il_patente:'',
  foto_data_url:'',firma_data_url:'',
  note:'',presenze_a2_a:'',
  privacy_consenso_comunicazioni:'SI',privacy_consenso_immagine:'SI',
}

export default function ModalNuovaIscrizione({tipo,onClose,onSalva}){
  const [tabAttivo,setTabAttivo]=useState('iscrizione')
  const [dati,setDati]=useState({...STATO_INIZIALE,tipo_iscrizione:tipo||'',acquisition_mode:'portale'})
  const [errori,setErrori]=useState({})
  const [cfCalcolato,setCfCalcolato]=useState('')
  const [cfValido,setCfValido]=useState(null)
  const [salvando,setSalvando]=useState(false)
  const set=useCallback((campo,val)=>setDati(p=>({...p,[campo]:val})),[])

  useEffect(()=>{
    if(!dati.data_nascita)return
    const nasc=new Date(dati.data_nascita),oggi=new Date()
    let eta=oggi.getFullYear()-nasc.getFullYear()
    if(oggi.getMonth()<nasc.getMonth()||(oggi.getMonth()===nasc.getMonth()&&oggi.getDate()<nasc.getDate()))eta--
    set('eta',String(eta))
  },[dati.data_nascita, set])

  useEffect(()=>{
    setCfCalcolato(calcolaCodiceFiscale(dati.cognome,dati.nome,dati.sesso,dati.data_nascita,dati.sigla_nascita))
  },[dati.cognome,dati.nome,dati.sesso,dati.data_nascita,dati.sigla_nascita])

  useEffect(()=>{
    if(dati.codice_fiscale.length===16)setCfValido(validaCF(dati.codice_fiscale))
    else setCfValido(null)
  },[dati.codice_fiscale])

  const usaCF=()=>{if(cfCalcolato)set('codice_fiscale',cfCalcolato)}

  const valida=()=>{
    const e={}
    if(!dati.cognome.trim())e.cognome='Obbligatorio'
    if(!dati.nome.trim())e.nome='Obbligatorio'
    if(!dati.data_nascita)e.data_nascita='Obbligatoria'
    if(!dati.codice_fiscale)e.codice_fiscale='Obbligatorio'
    else if(!validaCF(dati.codice_fiscale))e.codice_fiscale='CF non valido'
    if(!dati.comune_nascita)e.comune_nascita='Obbligatorio'
    if(!dati.tipo_iscrizione)e.tipo_iscrizione='Seleziona un tipo'
    setErrori(e)
    if(Object.keys(e).length>0)setTabAttivo('iscrizione')
    return Object.keys(e).length===0
  }

  const handleConferma=async()=>{
    if(!valida())return
    setSalvando(true)
    try{
      // Controllo omonimi (POST con JSON body)
      try{
        const resOm=await fetch(`${API_BASE}/api/candidati-api/omonimi`,{
          method:'POST',
          headers:{'Content-Type':'application/json',...authHeaders()},
          body:JSON.stringify({cognome:dati.cognome,nome:dati.nome,data_nascita:dati.data_nascita}),
        })
        if(resOm.ok){
          const om=await resOm.json()
          const count=om?.count||om?.omonimi?.length||0
          if(count>0&&!confirm(`⚠️ Trovati ${count} candidati con stesso nome/data.\nProcedere comunque?`)){setSalvando(false);return}
        }
      }catch(_){/* omonimi non bloccanti */}

      // Mappa i dati nel formato atteso dal backend (top-level + raw_portale)
      const s=v=>String(v||'').trim()||null
      const payload={
        // Campi obbligatori
        nome:dati.nome,
        cognome:dati.cognome,
        codice_fiscale:dati.codice_fiscale,
        categoria_patente:dati.categoria_patente||'B',
        // Anagrafica top-level
        sesso:s(dati.sesso),
        data_nascita:s(dati.data_nascita),
        comune_nascita:s(dati.comune_nascita),
        provincia_nascita:s(dati.prov_nascita),
        cittadinanza:s(dati.cittadinanza),
        // Residenza
        indirizzo:s(dati.indirizzo_residenza),
        cap:s(dati.cap_residenza),
        comune:s(dati.comune_residenza),
        provincia:s(dati.prov_residenza),
        // Contatti
        telefono:s(dati.telefono_1),
        email:s(dati.email_contatto),
        telefono_1:s(dati.telefono_1),
        email_contatto:s(dati.email_contatto),
        // Documento
        tipo_documento:s(dati.tipo_documento),
        numero_documento:s(dati.numero_documento),
        luogo_rilascio_doc:s(dati.ente_rilascio_documento),
        data_rilascio_doc:s(dati.rilasciato_il_documento),
        scade_il_documento:s(dati.scade_il_documento),
        // Patente
        patente_numero:s(dati.patente_numero),
        scade_il_patente:s(dati.scade_il_patente),
        categoria_richiesta:s(dati.categoria_richiesta||dati.categoria_patente),
        cambio_automatico:!!dati.cambio_automatico,
        // Pratiche
        codice_autoscuola:s(dati.codice_autoscuola),
        marca_operativa:s(dati.marca_operativa),
        codice_statino:s(dati.codice_statino),
        data_iscrizione:s(dati.data_iscrizione)||new Date().toISOString().slice(0,10),
        stato_iscrizione:'attivo',
        // PPG / foglio rosa
        ppg_data_scadenza:s(dati.ppg_data_scadenza),
        // Visita medica
        data_visita_medica:s(dati.data_visita_medica),
        codice_iscrizione_medico:s(dati.codice_iscrizione_medico),
        luogo_visita_medica:s(dati.luogo_visita_medica),
        // Portale
        turno_prefer:s(dati.turno_prefer),
        lingua:s(dati.lingua),
        supporto_audio:!!dati.supporto_audio,
        // Note
        note:s(dati.note),
        updated_at:new Date().toISOString(),
        // raw_portale per compatibilità con campi extra
        raw_portale:{
          foto_data_url:dati.foto_data_url||null,
          firma_data_url:dati.firma_data_url||null,
          note:dati.note||null,
          ppg_numero:dati.ppg_numero||null,
          ppg_data_emissione:dati.ppg_data_emissione||null,
          ppg_data_scadenza:dati.ppg_data_scadenza||null,
          presenze_a2_a:dati.presenze_a2_a||null,
          anagrafica:{...dati},
        },
      }

      const res=await fetch(`${API_BASE}/api/candidati-api`,{
        method:'POST',
        headers:{'Content-Type':'application/json',...authHeaders()},
        body:JSON.stringify(payload),
      })
      if(!res.ok){const err=await res.json().catch(()=>({}));throw new Error(err?.error||'Errore salvataggio')}
      onSalva?.(await res.json())
      onClose?.()
    }catch(err){alert('Errore salvataggio: '+err.message)}
    finally{setSalvando(false)}
  }

  const titoloTipo={INTERNO:'Interno',PRIVATISTA:'Privatista',REVISIONE:'Revisione',RINNOVO:'Rinnovo Patente',DUPLICATO:'Duplicato',CQC:'Patente CQC'}[tipo]||tipo||'—'

  return(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 py-2">
      <div className="relative mx-2 w-full max-w-6xl rounded-xl bg-slate-900 shadow-2xl ring-1 ring-slate-700">
        <div className="flex items-center justify-between rounded-t-xl bg-linear-to-r from-violet-800 to-violet-600 px-4 py-2.5">
          <div>
            <h2 className="text-sm font-bold text-white">Conseguimento per Esame — Registra Nuova Iscrizione</h2>
            <p className="text-xs text-violet-300">Tipo: <strong className="text-white">{titoloTipo}</strong></p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-violet-200 hover:bg-violet-700 hover:text-white">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="flex border-b border-slate-700 bg-slate-800 overflow-x-auto">
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTabAttivo(t.id)}
              className={`px-3 py-2 text-[11px] font-semibold whitespace-nowrap transition-colors ${tabAttivo===t.id?'border-b-2 border-violet-400 text-violet-300 bg-slate-900':'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>
              {t.label}
              {t.id==='iscrizione'&&Object.keys(errori).length>0&&<span className="ml-1 rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">{Object.keys(errori).length}</span>}
            </button>
          ))}
        </div>
        <div className="flex gap-3 p-3">
          <div className="flex-1 min-w-0 overflow-y-auto" style={{maxHeight:'calc(100vh - 200px)'}}>
            {tabAttivo==='iscrizione'&&<TabIscrizione d={dati} set={set} errori={errori} cfCalcolato={cfCalcolato} usaCF={usaCF} cfValido={cfValido}/>}
            {tabAttivo==='richiesta' &&<TabRichiesta  d={dati} set={set}/>}
            {tabAttivo==='certmedico'&&<TabCertMedico d={dati} set={set}/>}
            {tabAttivo==='contabile' &&<TabContabile  d={dati} set={set}/>}
            {tabAttivo==='privacy'   &&<TabPrivacy    d={dati} set={set}/>}
          </div>
          <div className="w-36 shrink-0 flex flex-col gap-2">
            <FotoFirma d={dati} set={set}/>
            <div className="mt-2 space-y-1.5">
              <button onClick={handleConferma} disabled={salvando} className="w-full rounded-lg bg-emerald-600 py-2.5 text-xs font-bold text-white shadow hover:bg-emerald-500 disabled:opacity-60">{salvando?'⏳ Salvo...':'✓ CONFERMA'}</button>
              <button onClick={()=>setTabAttivo('iscrizione')} className="w-full rounded-lg border border-slate-600 bg-slate-800 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700">← Indietro</button>
              <button onClick={onClose} className="w-full rounded-lg bg-red-800 py-2 text-xs font-bold text-white hover:bg-red-700">ANNULLA</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
