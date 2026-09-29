// Funzioni comuni a parser e motore. Nessuna dipendenza dal DOM, cosi' gli
// stessi file girano anche in Node per i test (vedi test/verifica.js).

(function (root) {

    // "1.062,49" / "1,062.49" / "1062.49" / " 91.80 " / 12.5 -> numero
    function parseNumero(v) {
        if (typeof v === 'number') return v;
        let s = String(v ?? '').trim().replace(/[€\s]/g, '');
        if (!s) return NaN;
        const lastDot = s.lastIndexOf('.');
        const lastComma = s.lastIndexOf(',');
        if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
        else if (lastDot > lastComma && lastComma !== -1) s = s.replace(/,/g, '');
        return parseFloat(s);
    }

    // "29/09/2026", "29.09.2026", "29-09-26" -> "2026-09-29"
    function parseDataIT(v) {
        if (v instanceof Date) {
            return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
        }
        const s = String(v ?? '').trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const p = s.split(/[\/.\-\s]/).filter(Boolean);
        if (p.length < 3) return '';
        let [dd, mm, yyyy] = p;
        if (yyyy.length === 2) yyyy = '20' + yyyy;
        return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }

    // Giorni tra due date ISO (b - a)
    function giorniTra(a, b) {
        return Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
    }

    function aggiungiGiorni(iso, n) {
        const d = new Date(Date.parse(iso) + n * 864e5);
        return d.toISOString().slice(0, 10);
    }

    // "2026-09-14" -> "2026-09-30"
    function fineMese(iso) {
        const [y, m] = iso.split('-').map(Number);
        const d = new Date(Date.UTC(y, m, 0));
        return d.toISOString().slice(0, 10);
    }

    // Parole che non distinguono un cliente dall'altro
    const PAROLE_VUOTE = new Set((
        'srl srls spa sas snc sapa ss soc societa coop cooperativa responsabilita limitata unipersonale ' +
        'di del della dei delle e ed la il lo le gli da de in per con c o ' +
        'costruzioni costruzione edil edile edilizia edili impresa ristrutturazioni ristrutturazione group ' +
        'service services servizi lavori impianti ditta'
    ).split(' '));

    // Ragione sociale -> elenco di parole confrontabili.
    // "M.A.M. COSTRUZIONI S R L" -> ["mam", "costruzioni", "srl"]
    function paroleNome(s) {
        const t = String(s ?? '').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[.']/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim().split(' ').filter(Boolean);
        // Unisce le lettere isolate consecutive: "s r l" -> "srl", "m a m" -> "mam"
        const out = [];
        let buf = '';
        for (const w of t) {
            if (w.length === 1) { buf += w; continue; }
            if (buf) { out.push(buf); buf = ''; }
            out.push(w);
        }
        if (buf) out.push(buf);
        return out;
    }

    function paroleSignificative(s) {
        return paroleNome(s).filter(w => w.length > 2 && !PAROLE_VUOTE.has(w) && !/^\d+$/.test(w));
    }

    // Quota (0..1) delle parole distintive del cliente presenti nel testo
    function punteggioNome(nomeCliente, testo) {
        const chiavi = paroleSignificative(nomeCliente);
        if (!chiavi.length) return 0;
        const bersaglio = new Set(paroleNome(testo));
        return chiavi.filter(w => bersaglio.has(w)).length / chiavi.length;
    }

    // Legge un file (xls, xlsx, csv) e restituisce le righe come array di array di stringhe.
    // Per i CSV disattiva il riconoscimento automatico di date e numeri di SheetJS,
    // che leggerebbe "01.09.2026" come 9 gennaio.
    function leggiRighe(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    resolve(righeDaBuffer(new Uint8Array(e.target.result), file.name));
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('Impossibile leggere il file ' + file.name));
            reader.readAsArrayBuffer(file);
        });
    }

    function righeDaBuffer(data, nomeFile, XLSXlib) {
        const X = XLSXlib || root.XLSX;
        const isCsv = /\.(csv|txt)$/i.test(nomeFile || '');
        let wb;
        if (isCsv) {
            let testo = new TextDecoder('utf-8').decode(data);
            if (testo.includes('�')) testo = new TextDecoder('windows-1252').decode(data);
            testo = testo.replace(/^﻿/, '');
            const primaRiga = testo.split(/\r?\n/)[0] || '';
            const sep = (primaRiga.match(/;/g) || []).length >= (primaRiga.match(/,/g) || []).length ? ';' : ',';
            wb = X.read(testo, { type: 'string', raw: true, FS: sep });
        } else {
            wb = X.read(data, { type: 'array' });
        }
        const sheet = wb.Sheets[wb.SheetNames[0]];
        return X.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    }

    // Trova la riga di intestazione: la prima che contiene tutte le parole richieste
    function trovaIntestazione(rows, parole, maxRighe = 25) {
        for (let i = 0; i < Math.min(maxRighe, rows.length); i++) {
            const txt = (rows[i] || []).join(' ').toLowerCase();
            if (parole.every(p => txt.includes(p))) return i;
        }
        return -1;
    }

    // Indice della prima colonna il cui nome contiene una delle chiavi (in ordine di preferenza)
    function indiceColonna(headers, ...chiavi) {
        const h = headers.map(x => String(x || '').trim().toLowerCase());
        for (const k of chiavi) {
            const i = h.findIndex(x => x === k);
            if (i !== -1) return i;
        }
        for (const k of chiavi) {
            const i = h.findIndex(x => x.includes(k));
            if (i !== -1) return i;
        }
        return -1;
    }

    const Util = {
        parseNumero, parseDataIT, giorniTra, aggiungiGiorni, fineMese,
        paroleNome, paroleSignificative, punteggioNome,
        leggiRighe, righeDaBuffer, trovaIntestazione, indiceColonna
    };

    root.Util = Util;
    if (typeof module !== 'undefined' && module.exports) module.exports = Util;
})(typeof window !== 'undefined' ? window : globalThis);
