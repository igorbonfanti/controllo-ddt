// Motore di riconciliazione a due livelli: POS (Nexi) e bonifici (estratto conto BPM).
//
// Per ogni DDT cerca l'incasso che lo ha pagato e confronta il canale trovato con il
// codice pagamento registrato in Zucchetti. Gli abbinamenti procedono per passaggi,
// dal piu' affidabile al meno affidabile: un DDT o un incasso gia' abbinato non viene
// piu' riconsiderato nei passaggi successivi.

(function (root) {
    const U = root.Util || (typeof require !== 'undefined' ? require('./util.js') : null);

    const CONFIG = {
        tolleranza: 0.02,              // euro, arrotondamenti
        posFinestraPrima: 3,           // POS battuto fino a N giorni prima della data DDT
        posFinestraDopo: 10,           // ... o fino a N giorni dopo (DDT del sabato pagato il lunedi')
        posAnticipoMax: 30,            // pagamento anticipato: POS fino a N giorni prima del DDT (merce consegnata dopo)
        posMarginePeriodo: 3,          // DDT a POS negli ultimi N giorni del file Nexi: non ancora verificabili
        bonFinestraPrima: 7,           // bonifico arrivato fino a N giorni prima del DDT (anticipato)
        bonFinestraDopo: 90,           // ... o fino a N giorni dopo
        bonImportoFinestraDopo: 30,    // abbinamento solo per importo: finestra piu' stretta
        bonTolleranzaScadenza: 10,     // bonifico non arrivato: anomalia N giorni dopo la scadenza della fattura
        sommaMaxDDT: 6,                // bonifico cumulativo: al massimo N DDT
        sommaMaxCandidati: 16
    };

    // Codici pagamento Zucchetti:
    //   POS          carta di credito o bancomat
    //   BB, B30, B60 bonifico (immediato o a N giorni)
    //   CAS          contanti o assegno: nessun riscontro elettronico atteso
    //   D, D60       rimessa diretta: puo' essere pagata con POS o con bonifico
    //   W30, W60...  RiBa: incasso tramite presentazione effetti, percorso a parte
    const isPos = (p) => p === 'POS';
    const isBonifico = (p) => /^B/.test(p);
    const isContanti = (p) => p === 'CAS';
    const isRimessa = (p) => /^D/.test(p);
    const isRiba = (p) => /^W/.test(p);
    const giorniScadenzaBonifico = (p) => parseInt(p.slice(1), 10) || 0; // BB, D -> 0; B30 -> 30; D60 -> 60

    // I clienti a bonifico e a rimessa diretta ricevono una fattura cumulativa mensile e pagano "fine mese data fattura".
    // Se la fattura non e' ancora emessa si assume datata a fine mese del DDT.
    function scadenzaBonifico(d) {
        const dataFattura = d.DataFattura || U.fineMese(d.DataParsed);
        const n = giorniScadenzaBonifico(d.Pagamento);
        return { dataFattura, stimata: !d.DataFattura, scadenza: U.fineMese(n ? U.aggiungiGiorni(dataFattura, n) : dataFattura) };
    }
    const dataIt = (iso) => iso.split('-').reverse().join('/');

    // Mantenuta per compatibilita' con la vecchia interfaccia
    const NON_POS_PAG = ['CAS', 'D', 'D60', 'W30', 'W60', 'BB', 'WI6', 'W6N', 'W3+', 'W90', 'B30', 'WI9', 'W03'];

    const CONF_ORDINE = { alta: 3, media: 2, bassa: 1 };

    function eseguiRiconciliazione(listaDdt, listaPos, listaBpm, opzioni) {
        const cfg = Object.assign({}, CONFIG, opzioni || {});
        const T = cfg.tolleranza + 1e-9;
        listaPos = listaPos || [];
        listaBpm = listaBpm || null;

        const ddtValidi = listaDdt.filter(d => d.ImportoConIVA > 0);
        const bonifici = (listaBpm || []).filter(m => m.tipo === 'bonifico');

        const esitoDdt = new Map();   // ddt.id -> esito
        const posUsati = new Map();   // pos._uid -> [ddt.id]
        const bonUsati = new Map();   // bon._uid -> { ddtIds, conf, regola, nota }

        const libero = d => !esitoDdt.has(d.id);
        const priorita = (d, canale) => {
            // A parita' di condizioni vince il DDT che ha gia' il codice giusto
            // (codice coerente, poi rimessa diretta, contanti, l'altro canale, RiBa)
            const p = d.Pagamento;
            if (canale === 'POS') return isPos(p) ? 0 : isRimessa(p) ? 1 : isContanti(p) ? 2 : isBonifico(p) ? 3 : 4;
            return isBonifico(p) ? 0 : isRimessa(p) ? 1 : isContanti(p) ? 2 : isPos(p) ? 3 : 4;
        };
        const ordinati = (canale) => [...ddtValidi].sort((a, b) =>
            priorita(a, canale) - priorita(b, canale) || a.DataParsed.localeCompare(b.DataParsed));

        function assegnaPos(ddts, pos, conf, regola) {
            posUsati.set(pos._uid, ddts.map(d => d.id));
            for (const d of ddts) {
                esitoDdt.set(d.id, { canale: 'POS', pos, conf, regola, gruppo: ddts.length > 1 ? ddts.map(x => x.NrDoc) : null });
            }
        }
        function assegnaBon(ddts, bon, conf, regola, nota) {
            bonUsati.set(bon._uid, { ddtIds: ddts.map(d => d.id), conf, regola, nota: nota || '' });
            for (const d of ddts) {
                esitoDdt.set(d.id, { canale: 'BONIFICO', bon, conf, regola, nota: nota || '', gruppo: ddts.length > 1 ? ddts.map(x => x.NrDoc) : null });
            }
        }

        // --- Passaggi POS -------------------------------------------------------------

        function passPos(regola, condizione, confDi, soloCodici) {
            for (const d of ordinati('POS')) {
                if (!libero(d)) continue;
                if (soloCodici && !soloCodici(d.Pagamento)) continue;
                let migliore = null, distMigliore = Infinity;
                for (const p of listaPos) {
                    if (posUsati.has(p._uid)) continue;
                    if (Math.abs(p.Importo - d.ImportoConIVA) > T) continue;
                    if (!condizione(p, d)) continue;
                    const dist = Math.abs(U.giorniTra(d.DataParsed, p.DataParsed)) * 10 + (p.sede_tml === d.Sede ? 0 : 5);
                    if (dist < distMigliore) { migliore = p; distMigliore = dist; }
                }
                if (migliore) assegnaPos([d], migliore, confDi(d, migliore), regola);
            }
        }

        const stessoGiornoStessaSede = (p, d) => p.DataParsed === d.DataParsed && p.sede_tml === d.Sede;
        const stessoGiornoAltraSede = (p, d) => p.DataParsed === d.DataParsed && p.sede_tml !== d.Sede;
        const inAnticipoPos = (p, d) => {
            const g = U.giorniTra(d.DataParsed, p.DataParsed);
            return p.sede_tml === d.Sede && g < -cfg.posFinestraPrima && g >= -cfg.posAnticipoMax;
        };
        const inFinestraPos = (p, d) => {
            const g = U.giorniTra(d.DataParsed, p.DataParsed);
            return p.sede_tml === d.Sede && g >= -cfg.posFinestraPrima && g <= cfg.posFinestraDopo && g !== 0;
        };

        // Piu' DDT dello stesso cliente pagati con un'unica transazione
        function passPosGruppo() {
            const gruppi = new Map();
            for (const d of ddtValidi) {
                if (!libero(d)) continue;
                const k = `${d.CodiceCliente || d.Cliente}|${d.Sede}|${d.DataParsed}`;
                if (!gruppi.has(k)) gruppi.set(k, []);
                gruppi.get(k).push(d);
            }
            for (const g of gruppi.values()) {
                if (g.length < 2) continue;
                for (const p of listaPos) {
                    if (posUsati.has(p._uid) || p.sede_tml !== g[0].Sede) continue;
                    const dg = U.giorniTra(g[0].DataParsed, p.DataParsed);
                    if (dg < 0 || dg > 3) continue;
                    const sub = cercaSomma(g.filter(libero), p.Importo, 4, T);
                    if (sub) { assegnaPos(sub, p, 'media', 'pos_gruppo'); break; }
                }
            }
        }

        // --- Passaggi bonifici --------------------------------------------------------

        const cacheNome = new Map();
        function stessoCliente(d, bon) {
            const k = d.id + '|' + bon._uid;
            if (cacheNome.has(k)) return cacheNome.get(k);
            const chiavi = U.paroleSignificative(d.NomeCliente || d.Cliente);
            const testo = new Set(U.paroleNome(bon.Ordinante));
            const trovate = chiavi.filter(w => testo.has(w));
            // La prima parola distintiva e' quasi sempre il nome dell'azienda; le ultime spesso la citta'
            const ok = chiavi.length > 0 && (testo.has(chiavi[0]) || (trovate.length >= 2 && trovate.length / chiavi.length >= 0.5));
            cacheNome.set(k, ok);
            return ok;
        }
        const inFinestraBon = (d, bon, dopo = cfg.bonFinestraDopo) => {
            const g = U.giorniTra(d.DataParsed, bon.DataParsed);
            return g >= -cfg.bonFinestraPrima && g <= dopo;
        };

        // 1. La causale cita il numero DDT
        function passBonRiferimento() {
            for (const b of bonifici) {
                if (bonUsati.has(b._uid) || !b.RifDDT || !b.RifDDT.length) continue;
                const trovati = [];
                for (const r of b.RifDDT) {
                    const c = ddtValidi.filter(d => libero(d) && d.NrDoc === r.nr && (!r.sede || d.Sede === r.sede));
                    // Stesso numero in entrambe le sedi e nessuna sede in causale: scelgo il cliente giusto
                    const scelto = c.length === 1 ? c[0] : c.find(d => stessoCliente(d, b));
                    if (scelto && !trovati.includes(scelto)) trovati.push(scelto);
                }
                if (!trovati.length) continue;
                const tot = trovati.reduce((s, d) => s + d.ImportoConIVA, 0);
                const diff = Math.round((b.Importo - tot) * 100) / 100;
                if (Math.abs(diff) <= T) assegnaBon(trovati, b, 'alta', 'bon_rif_ddt');
                else assegnaBon(trovati, b, 'media', 'bon_rif_ddt', `importo diverso di ${diff.toFixed(2)} €`);
            }
        }

        // 1-bis. La causale cita un numero di fattura gia' emessa sui DDT
        function passBonNumeroFattura() {
            for (const b of bonifici) {
                if (bonUsati.has(b._uid) || !b.RifFatture || !b.RifFatture.length) continue;
                const trovati = ddtValidi.filter(d => libero(d) && d.NumFattura && b.RifFatture.includes(d.NumFattura) && stessoCliente(d, b));
                if (!trovati.length) continue;
                const tot = trovati.reduce((s, d) => s + d.ImportoConIVA, 0);
                const diff = Math.round((b.Importo - tot) * 100) / 100;
                if (Math.abs(diff) <= T) assegnaBon(trovati, b, 'alta', 'bon_rif_fattura');
                else assegnaBon(trovati, b, 'media', 'bon_rif_fattura', `importo diverso di ${diff.toFixed(2)} €`);
            }
        }

        // 3-bis. Fattura mensile: il bonifico paga tutti i DDT del cliente di un mese (non gia' pagati altrimenti)
        function passBonFatturaMensile() {
            for (const b of bonifici) {
                if (bonUsati.has(b._uid)) continue;
                const mesi = new Map();
                for (const d of ddtValidi) {
                    if (!libero(d) || isPos(d.Pagamento) || isRiba(d.Pagamento) || isContanti(d.Pagamento)) continue;
                    if (d.DataParsed > b.DataParsed || !stessoCliente(d, b)) continue;
                    const k = d.DataParsed.slice(0, 7);
                    if (!mesi.has(k)) mesi.set(k, []);
                    mesi.get(k).push(d);
                }
                for (const [mese, lista] of mesi) {
                    // La fattura mensile si emette a fine mese: un bonifico di meta' mese non la paga
                    if (b.DataParsed < U.fineMese(lista[0].DataParsed)) continue;
                    // Prima tutti i DDT del mese, poi solo quelli a bonifico
                    const varianti = [lista, lista.filter(d => isBonifico(d.Pagamento))];
                    const ok = varianti.find(v => v.length >= 2 && Math.abs(v.reduce((s, d) => s + d.ImportoConIVA, 0) - b.Importo) <= T);
                    if (ok) { assegnaBon(ok, b, 'alta', 'bon_fattura_mese', `fattura di ${mese.slice(5)}/${mese.slice(0, 4)}`); break; }
                }
            }
        }

        // 2. Stesso cliente e stesso importo di un singolo DDT
        function passBonClienteImporto() {
            for (const b of bonifici) {
                if (bonUsati.has(b._uid)) continue;
                const cand = ddtValidi.filter(d => libero(d) && Math.abs(d.ImportoConIVA - b.Importo) <= T && inFinestraBon(d, b) && stessoCliente(d, b))
                    .sort((x, y) => priorita(x, 'BON') - priorita(y, 'BON') || Math.abs(U.giorniTra(x.DataParsed, b.DataParsed)) - Math.abs(U.giorniTra(y.DataParsed, b.DataParsed)));
                if (cand.length) assegnaBon([cand[0]], b, 'alta', 'bon_cliente_importo');
            }
        }

        // 3. Stesso cliente, bonifico pari alla somma di piu' DDT
        function passBonClienteSomma() {
            for (const b of bonifici) {
                if (bonUsati.has(b._uid)) continue;
                const cand = ddtValidi.filter(d => libero(d) && inFinestraBon(d, b) && stessoCliente(d, b) && d.ImportoConIVA < b.Importo + T)
                    .sort((x, y) => x.DataParsed.localeCompare(y.DataParsed))
                    .slice(-cfg.sommaMaxCandidati);
                if (cand.length < 2) continue;
                const sub = cercaSomma(cand, b.Importo, cfg.sommaMaxDDT, T);
                if (sub) assegnaBon(sub, b, sub.length <= 3 ? 'alta' : 'media', 'bon_cliente_somma');
            }
        }

        // 4. Solo importo (l'ordinante non somiglia a nessun cliente): un solo candidato possibile
        function passBonSoloImporto() {
            for (const b of bonifici) {
                if (bonUsati.has(b._uid)) continue;
                const cand = ddtValidi.filter(d => libero(d) && Math.abs(d.ImportoConIVA - b.Importo) <= T && inFinestraBon(d, b, cfg.bonImportoFinestraDopo));
                if (cand.length !== 1 || isRiba(cand[0].Pagamento)) continue;
                const d = cand[0];
                assegnaBon([d], b, isBonifico(d.Pagamento) ? 'media' : 'bassa', 'bon_solo_importo');
            }
        }

        // --- Sequenza: dal piu' affidabile al meno affidabile ------------------------
        passBonRiferimento();
        passBonNumeroFattura();
        passPos('pos_esatto', stessoGiornoStessaSede, () => 'alta');
        passBonClienteImporto();
        passBonFatturaMensile();
        passPos('pos_altra_sede', stessoGiornoAltraSede, () => 'media');
        passPos('pos_finestra', inFinestraPos, () => 'media', isPos);
        passPos('pos_anticipato', inAnticipoPos, () => 'media', isPos);
        passBonClienteSomma();
        passPosGruppo();
        // Le RiBa seguono un percorso a parte: per loro niente abbinamenti deboli, solo prove forti
        passPos('pos_finestra', inFinestraPos, () => 'bassa', p => !isPos(p) && !isRiba(p));
        passBonSoloImporto();

        // --- Indizi per i DDT a POS senza transazione -----------------------------------
        // Non sono abbinamenti (troppo incerti per decidere da soli), ma piste da verificare a mano.
        const carteCliente = new Map(); // codice cliente -> ultime 4 cifre delle carte usate su altri DDT
        for (const [id, e] of esitoDdt) {
            if (e.canale !== 'POS' || !e.pos.Carta) continue;
            const d = ddtValidi.find(x => x.id === id);
            const k = d.CodiceCliente || d.Cliente;
            if (!carteCliente.has(k)) carteCliente.set(k, new Set());
            carteCliente.get(k).add(e.pos.Carta);
        }
        const euro = n => n.toFixed(2).replace('.', ',') + ' €';
        const descrPos = p => `${euro(p.Importo)} del ${dataIt(p.DataParsed)} ore ${p.Ora.slice(0, 5)} (${p.Circuito} *${p.Carta})`;

        function indiziPos(d) {
            const indizi = [];
            const liberi = listaPos.filter(p => !posUsati.has(p._uid));
            // Pagamento misto: parte con carta, il resto (cifra tonda) in contanti
            for (const p of liberi) {
                if (p.sede_tml !== d.Sede || Math.abs(U.giorniTra(d.DataParsed, p.DataParsed)) > 1 || p.Importo >= d.ImportoConIVA) continue;
                const resto = Math.round((d.ImportoConIVA - p.Importo) * 100);
                if (resto % 500 === 0) indizi.push(`Possibile pagamento misto: POS ${descrPos(p)} + ${euro(resto / 100)} in contanti`);
            }
            // Transazioni non abbinate fatte con una carta che il cliente ha usato per altri DDT
            const carte = carteCliente.get(d.CodiceCliente || d.Cliente);
            if (carte) {
                for (const p of liberi) {
                    if (!carte.has(p.Carta) || Math.abs(U.giorniTra(d.DataParsed, p.DataParsed)) > 15) continue;
                    indizi.push(`Carta *${p.Carta} già usata dal cliente: POS non abbinato ${descrPos(p)}`);
                }
            }
            // Stesso importo gia' abbinato a un altro DDT: possibile DDT doppio o scambio di cliente
            for (const [uid, ids] of posUsati) {
                const p = listaPos.find(x => x._uid === uid);
                if (Math.abs(p.Importo - d.ImportoConIVA) > T || Math.abs(U.giorniTra(d.DataParsed, p.DataParsed)) > 30) continue;
                const altro = ddtValidi.find(x => x.id === ids[0]);
                if (altro) indizi.push(`POS dello stesso importo (${descrPos(p)}) già abbinato al DDT ${altro.NrDoc} di ${altro.NomeCliente}`);
            }
            return indizi;
        }

        // --- Verdetti -----------------------------------------------------------------
        const datePos = listaPos.map(p => p.DataParsed).sort();
        const posMin = datePos[0] || null, posMax = datePos[datePos.length - 1] || null;
        const dateBpm = (listaBpm || []).map(m => m.DataParsed).sort();
        const bpmMin = dateBpm[0] || null, bpmMax = dateBpm[dateBpm.length - 1] || null;

        const righe = listaDdt.map(d => {
            const e = esitoDdt.get(d.id) || null;
            const r = { ddt: d, esito: e, verdetto: null, correggiIn: null, motivo: '', anomaliaId: d.id };
            const pag = d.Pagamento;

            if (d.ImportoConIVA < 0) { r.verdetto = 'reso'; r.motivo = 'Reso / nota di credito'; return r; }

            if (e && e.canale === 'POS') {
                if (isPos(pag)) { r.verdetto = 'ok'; r.motivo = 'Pagato con POS'; }
                else { r.verdetto = 'correggere'; r.correggiIn = 'POS'; r.motivo = `Registrato ${pag}, pagato con POS`; }
                return r;
            }
            if (e && e.canale === 'BONIFICO') {
                if (isBonifico(pag)) { r.verdetto = 'ok'; r.motivo = 'Pagato con bonifico'; }
                else { r.verdetto = 'correggere'; r.correggiIn = 'BB'; r.motivo = `Registrato ${pag}, pagato con bonifico`; }
                return r;
            }

            // Nessun incasso trovato
            if (isPos(pag)) {
                if (!posMax || d.DataParsed < posMin || U.giorniTra(d.DataParsed, posMax) < cfg.posMarginePeriodo) {
                    r.verdetto = 'non_verificabile'; r.motivo = 'Fuori dal periodo del file Nexi';
                } else {
                    r.verdetto = 'mancante'; r.motivo = 'Registrato POS, nessuna transazione POS né bonifico';
                    r.indizi = indiziPos(d);
                }
            } else if (isBonifico(pag) || isRimessa(pag)) {
                // Bonifico e rimessa diretta: fattura cumulativa mensile, pagata fine mese data fattura
                const s = scadenzaBonifico(d);
                const fattura = d.NumFattura ? `fattura n. ${d.NumFattura} del ${dataIt(s.dataFattura)}` : `fattura di fine mese (${dataIt(s.dataFattura)})`;
                r.scadenza = s.scadenza;
                if (!listaBpm) { r.verdetto = 'non_verificabile'; r.motivo = 'Estratto conto BPM non caricato'; }
                else if (U.giorniTra(s.scadenza, bpmMax) <= cfg.bonTolleranzaScadenza) {
                    r.verdetto = 'attesa_fattura';
                    r.motivo = `Attesa pagamento fine mese data fattura: ${fattura}, scade il ${dataIt(s.scadenza)}`;
                } else {
                    r.verdetto = 'mancante';
                    r.motivo = `${fattura} scaduta il ${dataIt(s.scadenza)}, nessun bonifico`;
                }
            } else if (isContanti(pag)) {
                r.verdetto = 'nessun_riscontro'; r.motivo = 'Contanti o assegno: nessun incasso elettronico atteso';
            } else if (isRiba(pag)) {
                r.verdetto = 'riba'; r.motivo = 'RiBa: incasso tramite presentazione effetti';
            } else {
                r.verdetto = 'nessun_riscontro'; r.motivo = `Codice ${pag}: nessun incasso nel periodo`;
            }
            return r;
        });

        // --- Bonifici ricevuti e loro abbinamento --------------------------------------
        const perId = new Map(listaDdt.map(d => [d.id, d]));
        const elencoBonifici = bonifici.map(b => {
            const u = bonUsati.get(b._uid);
            let suggerimento = '';
            if (!u) {
                // Aiuto per la verifica manuale: il cliente che sembra aver pagato
                const clienti = [...new Set(listaDdt.filter(d => stessoCliente(d, b)).map(d => d.Cliente))];
                if (clienti.length) suggerimento = clienti.slice(0, 2).join(' / ');
            }
            return {
                mov: b,
                ddt: u ? u.ddtIds.map(id => perId.get(id)) : [],
                conf: u ? u.conf : null,
                regola: u ? u.regola : null,
                nota: u ? u.nota : '',
                suggerimento
            };
        });

        // --- Quadratura accrediti Nexi in banca -> transazioni del file Nexi -------------
        // Nexi accredita al lordo, un bonifico per sede e per giorno di transazioni:
        //  - Bancomat: la descrizione riporta il giorno delle transazioni;
        //  - Visa/Mastercard ("internaz. e apm"): il giorno non c'e', si cerca il giorno con lo stesso totale
        //    nei 7 giorni precedenti l'accredito. Amex accredita a parte e non rientra.
        const accrediti = (listaBpm || []).filter(m => m.tipo === 'accredito_nexi' && m.sede);
        const tondo = n => Math.round(n * 100) / 100;
        const totaleGiorno = (sede, giorno, bancomat) => tondo(listaPos
            .filter(p => p.sede_tml === sede && p.DataParsed === giorno && (bancomat ? /bancomat/i.test(p.Circuito) : !/bancomat|amex/i.test(p.Circuito)))
            .reduce((s, p) => s + p.Importo, 0));
        const inPeriodo = g => posMin && g >= posMin && g <= posMax;
        const quadraturaNexi = [];

        for (const m of accrediti.filter(m => m.circuitoAccredito === 'BANCOMAT' && m.dataTransazioni)) {
            const ok = inPeriodo(m.dataTransazioni);
            const tot = totaleGiorno(m.sede, m.dataTransazioni, true);
            quadraturaNexi.push({ mov: m, circuito: 'Bancomat', sede: m.sede, dataTransazioni: m.dataTransazioni, dataAccredito: m.DataParsed,
                accredito: m.Importo, totalePos: ok ? tot : null, delta: ok ? tondo(m.Importo - tot) : null });
        }

        for (const sede of ['F', 'Z']) {
            const giorni = [...new Set(listaPos.filter(p => p.sede_tml === sede && !/bancomat|amex/i.test(p.Circuito)).map(p => p.DataParsed))].sort();
            const totali = new Map(giorni.map(g => [g, totaleGiorno(sede, g, false)]));
            const usati = new Set();
            const intl = accrediti.filter(m => m.sede === sede && m.circuitoAccredito === 'INTERNAZIONALI').sort((a, b) => a.DataParsed.localeCompare(b.DataParsed));
            const candidati = m => giorni.filter(g => !usati.has(g) && g < m.DataParsed && U.giorniTra(g, m.DataParsed) <= 7);
            const aggiungi = (m, g) => {
                if (g) usati.add(g);
                quadraturaNexi.push({ mov: m, circuito: 'Visa/Mastercard', sede, dataTransazioni: g, dataAccredito: m.DataParsed,
                    accredito: m.Importo, totalePos: g ? totali.get(g) : null, delta: g ? tondo(m.Importo - totali.get(g)) : null });
            };
            // Prima gli accrediti che trovano un giorno con lo stesso totale, poi gli altri sul giorno piu' vicino
            const sospesi = [];
            for (const m of intl) {
                const g = candidati(m).filter(g => Math.abs(totali.get(g) - m.Importo) <= T).pop();
                if (g) aggiungi(m, g); else sospesi.push(m);
            }
            for (const m of sospesi) aggiungi(m, candidati(m).pop() || null); // null: transazioni prima del file Nexi
            // Giorni con transazioni ma nessun accredito, esclusi gli ultimi (accredito non ancora arrivato)
            const ultimoAccredito = intl.length ? intl[intl.length - 1].DataParsed : null;
            for (const g of giorni) {
                if (usati.has(g) || !ultimoAccredito || U.giorniTra(g, ultimoAccredito) < 3) continue;
                quadraturaNexi.push({ mov: null, circuito: 'Visa/Mastercard', sede, dataTransazioni: g, dataAccredito: null,
                    accredito: null, totalePos: totali.get(g), delta: tondo(-totali.get(g)) });
            }
        }
        quadraturaNexi.sort((a, b) => String(a.dataTransazioni || a.dataAccredito).localeCompare(String(b.dataTransazioni || b.dataAccredito))
            || String(a.sede).localeCompare(String(b.sede)) || a.circuito.localeCompare(b.circuito));

        // --- Corrispettivi giornalieri (logica invariata) -----------------------------
        const giorniDdt = [...new Set(listaDdt.map(d => d.DataParsed))].sort();
        const aggregatiGiornalieri = [];
        for (const giorno of giorniDdt) {
            for (const sede of ['F', 'Z']) {
                const delGiorno = listaPos.filter(p => p.DataParsed === giorno && p.sede_tml === sede);
                const cassa = delGiorno.filter(p => p.tipo_tml === 'pos_cassa');
                const tot = cassa.reduce((s, p) => s + p.Importo, 0);
                const b2b = cassa.filter(p => posUsati.has(p._uid)).reduce((s, p) => s + p.Importo, 0);
                const pbl = delGiorno.filter(p => p.tipo_tml === 'pay_by_link');
                aggregatiGiornalieri.push({
                    data: giorno, sedeChr: sede, sede: sede === 'F' ? 'Ferraris' : 'Spezia',
                    posTotale: tot, b2bAbbinati: b2b, residuo: tot - b2b,
                    pos5g: delGiorno.filter(p => p.tipo_tml === 'pos_5g').reduce((s, p) => s + p.Importo, 0),
                    payByLink: pbl.reduce((s, p) => s + p.Importo, 0),
                    pblSenzaDdt: pbl.filter(p => !posUsati.has(p._uid)).reduce((s, p) => s + p.Importo, 0)
                });
            }
        }

        // Compatibilita': elenco "anomalie" nel formato della v1 (solo correzioni verso POS)
        const anomalie = righe.filter(r => r.verdetto === 'correggere' && r.correggiIn === 'POS')
            .map(r => ({ ddt: r.ddt, pos: r.esito.pos, anomaliaId: r.anomaliaId }));

        return {
            righe,
            bonifici: elencoBonifici,
            quadraturaNexi,
            aggregatiGiornalieri,
            anomalie,
            posUsati,
            periodo: { posMin, posMax, bpmMin, bpmMax, bpmCaricato: !!listaBpm },
            movimentiBpm: listaBpm || []
        };
    }

    // Sottoinsieme di al massimo maxN elementi la cui somma e' pari al target (in centesimi).
    // Preferisce il sottoinsieme piu' piccolo.
    function cercaSomma(items, target, maxN, T) {
        const cent = items.map(d => Math.round((d.ImportoConIVA ?? d.Importo) * 100));
        const tgt = Math.round(target * 100);
        const tol = Math.round(T * 100);
        const n = items.length;
        for (let k = 2; k <= Math.min(maxN, n); k++) {
            const scelta = [];
            const dfs = (start, somma) => {
                if (scelta.length === k) return Math.abs(somma - tgt) <= tol;
                for (let i = start; i < n; i++) {
                    if (somma + cent[i] > tgt + tol) continue;
                    scelta.push(i);
                    if (dfs(i + 1, somma + cent[i])) return true;
                    scelta.pop();
                }
                return false;
            };
            if (dfs(0, 0)) return scelta.map(i => items[i]);
        }
        return null;
    }

    root.RICONCILIAZIONE_CONFIG = CONFIG;
    root.NON_POS_PAG = NON_POS_PAG;
    root.CONF_ORDINE = CONF_ORDINE;
    root.eseguiRiconciliazione = eseguiRiconciliazione;
    if (typeof module !== 'undefined' && module.exports) module.exports = { eseguiRiconciliazione, cercaSomma, CONFIG };
})(typeof window !== 'undefined' ? window : globalThis);
