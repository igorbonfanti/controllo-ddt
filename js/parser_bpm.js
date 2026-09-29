// Parser per l'estratto movimenti di conto corrente Banco BPM (export "MovimentiCC_OnLine", .csv o .xlsx)

(function (root) {
    const U = root.Util || (typeof require !== 'undefined' ? require('./util.js') : null);

    // Punto vendita Nexi indicato nella descrizione degli accrediti -> sede.
    // Ricavato confrontando gli accrediti Bancomat con le transazioni dei terminali.
    const PV_NEXI = {
        '1000001535691': 'F',
        '1000001535664': 'Z'
    };

    // Classifica un movimento in entrata dalla sua descrizione e causale ABI
    function classifica(descr, causale) {
        const d = descr.toLowerCase();
        if (d.includes('nexi payments')) return 'accredito_nexi';
        if (d.includes('american express')) return 'accredito_amex';
        if (d.includes('bon.da') || d.includes('bonif')) return 'bonifico';
        if (causale === '292' || causale === '293' || d.includes('disp.elet') || d.includes('ri.ba') || d.includes('riba')) return 'riba';
        if (d.includes('vers. contanti') || d.includes('versamento contanti')) return 'contanti';
        if (/^ass\.?\s|assegn/.test(d)) return 'assegno';
        return 'altro';
    }

    // "bonif. vs. favore - bon.da edilhome srl saldo fatture 2355-2044" -> "edilhome srl saldo fatture 2355-2044"
    function testoOrdinante(descr) {
        const m = descr.match(/bon\.?\s?da\s+(.*)$/i);
        return (m ? m[1] : descr.replace(/^.*? - /, '')).trim();
    }

    // Riferimenti a DDT scritti in causale: "ddt 2376-z", "ddt 4230/f", "ddt n. 2153/z"
    function riferimentiDDT(testo) {
        const refs = [];
        const re = /\bddt\b\D{0,6}(\d{3,6})(?:\s*[\/\-]\s*([fz])\b)?/gi;
        let m;
        while ((m = re.exec(testo))) refs.push({ nr: m[1], sede: m[2] ? m[2].toUpperCase() : null });
        return refs;
    }

    // Numeri di fattura in causale: "saldo fatture 2355-2044", "ft.2189 del", "fattura nr. 1618 del ..."
    function riferimentiFattura(testo) {
        const nums = [];
        // "f attura": la banca spezza la descrizione in blocchi a larghezza fissa
        const re = /\b(?:f\s?att\w*|ft)\s*\.?\s*(?:n[r°o]?\s*\.?\s*)?(\d{2,6}(?:\s*[-\/,e]\s*\d{2,6}\b)*)/gi;
        let m;
        while ((m = re.exec(testo))) {
            for (const n of m[1].split(/\s*[-\/,e]\s*/)) if (n) nums.push(n.replace(/^0+(?=\d)/, ''));
        }
        return nums;
    }

    function parseBPMRows(rows) {
        let hIdx = U.trovaIntestazione(rows, ['data', 'importo']);
        if (hIdx === -1) hIdx = U.trovaIntestazione(rows, ['data', 'descrizione']);
        if (hIdx === -1) throw new Error("Impossibile trovare la riga d'intestazione dell'estratto conto.");

        const h = rows[hIdx];
        const c = {
            data: U.indiceColonna(h, 'data contabile', 'data operazione', 'data'),
            valuta: U.indiceColonna(h, 'data valuta', 'valuta'),
            importo: U.indiceColonna(h, 'importo'),
            avere: U.indiceColonna(h, 'avere', 'entrate', 'accrediti'),
            dare: U.indiceColonna(h, 'dare', 'uscite', 'addebiti'),
            causale: U.indiceColonna(h, 'causale abi', 'causale'),
            descr: U.indiceColonna(h, 'descrizione', 'descrizione operazione')
        };
        const v = (r, k) => (c[k] === -1 ? '' : String(r[c[k]] ?? '').trim());

        const out = [];
        for (let i = hIdx + 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r) continue;
            const dataIso = U.parseDataIT(v(r, 'data'));
            if (!dataIso) continue;

            let importo;
            if (c.importo !== -1) importo = U.parseNumero(v(r, 'importo'));
            else importo = (U.parseNumero(v(r, 'avere')) || 0) - (U.parseNumero(v(r, 'dare')) || 0);
            if (isNaN(importo) || importo <= 0) continue; // interessano solo le entrate

            const descr = v(r, 'descr');
            const causale = v(r, 'causale');
            const tipo = classifica(descr, causale);
            const mov = {
                DataParsed: dataIso,
                DataValuta: U.parseDataIT(v(r, 'valuta')) || dataIso,
                Importo: Math.round(importo * 100) / 100,
                Causale: causale,
                Descrizione: descr,
                tipo,
                _uid: `${dataIso}|${importo.toFixed(2)}|${descr}|${i}`
            };

            if (tipo === 'bonifico') {
                mov.Ordinante = testoOrdinante(descr);
                mov.RifDDT = riferimentiDDT(mov.Ordinante);
                mov.RifFatture = riferimentiFattura(mov.Ordinante);
            }
            if (tipo === 'accredito_nexi') {
                const pv = (descr.match(/pv\s+(\d+)/i) || [])[1] || '';
                const bm = descr.match(/accredito bancomat (\d{2})(\d{2})(\d{2})/i);
                mov.PV = pv;
                mov.sede = PV_NEXI[pv] || null;
                mov.circuitoAccredito = bm ? 'BANCOMAT' : 'INTERNAZIONALI';
                mov.dataTransazioni = bm ? `20${bm[3]}-${bm[2]}-${bm[1]}` : null;
            }
            out.push(mov);
        }
        return out;
    }

    async function parseFilesBPM(filesList) {
        const tutti = [];
        const giaPresi = new Map(); // chiave -> quanti movimenti identici gia' tenuti
        for (const file of filesList) {
            let movs;
            try {
                movs = parseBPMRows(await U.leggiRighe(file));
            } catch (err) {
                console.error('Errore parser BPM:', err);
                throw "Errore durante la lettura dell'estratto conto BPM: " + (err.message || err);
            }
            // Due estratti che si sovrappongono non devono raddoppiare i movimenti, ma due
            // movimenti identici nello stesso estratto sono entrambi veri.
            const nelFile = new Map();
            for (const m of movs) {
                const k = `${m.DataParsed}|${m.Importo}|${m.Descrizione}`;
                const n = (nelFile.get(k) || 0) + 1;
                nelFile.set(k, n);
                if (n <= (giaPresi.get(k) || 0)) continue;
                giaPresi.set(k, n);
                tutti.push(m);
            }
        }
        return tutti;
    }

    root.PV_NEXI = PV_NEXI;
    root.parseBPMRows = parseBPMRows;
    root.parseFilesBPM = parseFilesBPM;
    if (typeof module !== 'undefined' && module.exports) module.exports = { parseBPMRows, riferimentiDDT, riferimentiFattura, PV_NEXI };
})(typeof window !== 'undefined' ? window : globalThis);
