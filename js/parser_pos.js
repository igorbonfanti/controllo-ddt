// Parser per i file POS (Esportazione da portale Nexi, .xlsx o .csv)

(function (root) {
    const U = root.Util || (typeof require !== 'undefined' ? require('./util.js') : null);

    // Mappatura Terminali in base alle specifiche fornite
    const TERMINALI = {
        '85028845': { sede: 'F', tipo: 'pos_cassa' },    // Ferraris - Fisico
        '85074555': { sede: 'F', tipo: 'pos_5g' },       // Ferraris - Mobile 5G
        '85074088': { sede: 'F', tipo: 'pay_by_link' },  // Ferraris - E-commerce
        '85028787': { sede: 'Z', tipo: 'pos_cassa' },    // Spezia - Fisico
        '85074547': { sede: 'Z', tipo: 'pos_5g' },       // Spezia - Mobile 5G
        '85072084': { sede: 'Z', tipo: 'pay_by_link' }   // Spezia - E-commerce
    };

    function parsePOSRows(rows) {
        const hIdx = U.trovaIntestazione(rows, ['data', 'importo']);
        if (hIdx === -1) throw new Error("Impossibile trovare la riga d'intestazione sull'esportazione POS.");

        const h = rows[hIdx];
        const c = {
            data: U.indiceColonna(h, 'data'),
            ora: U.indiceColonna(h, 'ora'),
            auth: U.indiceColonna(h, 'n° autorizzazione', 'n. autorizzazione', 'autorizz'),
            carta: U.indiceColonna(h, 'numero carta'),
            importo: U.indiceColonna(h, 'importo'),
            stato: U.indiceColonna(h, 'stato transazione', 'stato'),
            esito: U.indiceColonna(h, 'esito'),
            canale: U.indiceColonna(h, 'canale'),
            circuito: U.indiceColonna(h, 'circuito'),
            tml: U.indiceColonna(h, 'terminal id (tml)', 'terminal', 'tml'),
            ordine: U.indiceColonna(h, 'numero ordine')
        };
        const v = (r, k) => (c[k] === -1 ? '' : String(r[c[k]] ?? '').trim());

        const out = [];
        const scartate = { rifiutate: 0, stornate: 0 };

        for (let i = hIdx + 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r || !v(r, 'data')) continue;

            // Solo transazioni andate a buon fine e non stornate
            const stato = v(r, 'stato').toLowerCase();
            const esito = v(r, 'esito').toLowerCase();
            if (stato.includes('rifiutat') || stato.includes('negat') || esito.includes('non eseguit')) { scartate.rifiutate++; continue; }
            if (stato.includes('stornat') || stato.includes('annullat')) { scartate.stornate++; continue; }

            const tml = v(r, 'tml').replace(/\.0$/, '').replace(/['"]/g, '');
            const meta = TERMINALI[tml];
            if (!meta) throw new Error(`Letto un terminale sconosciuto (ID: ${tml}). Impossibile abbinargli una sede (F/Z). Non posso proseguire.`);

            const dataIso = U.parseDataIT(v(r, 'data'));
            const importo = U.parseNumero(v(r, 'importo'));
            if (!dataIso || isNaN(importo)) continue;

            const auth = v(r, 'auth') || 'NA';
            out.push({
                DataOriginale: v(r, 'data'),
                DataParsed: dataIso,
                Ora: v(r, 'ora') || '00:00:00',
                Autorizzazione: auth,
                Carta: v(r, 'carta'),
                Importo: Math.round(importo * 100) / 100,
                Circuito: v(r, 'circuito') || 'NA',
                Canale: v(r, 'canale'),
                Tml: tml,
                sede_tml: meta.sede,
                tipo_tml: meta.tipo,
                _uid: `${auth}|${dataIso}|${importo.toFixed(2)}|${v(r, 'ora')}`
            });
        }
        out.scartate = scartate;
        return out;
    }

    async function parseFilesPOS(filesList) {
        let tutte = [];
        const visti = new Set();
        for (const file of filesList) {
            let righe;
            try {
                righe = parsePOSRows(await U.leggiRighe(file));
            } catch (err) {
                console.error('Errore parser POS Nexi:', err);
                throw 'Errore durante la lettura del file POS Nexi: ' + (err.message || err);
            }
            // Due export che si sovrappongono non devono raddoppiare le transazioni
            for (const p of righe) {
                if (visti.has(p._uid)) continue;
                visti.add(p._uid);
                tutte.push(p);
            }
        }
        return tutte;
    }

    root.TERMINALI = TERMINALI;
    root.parsePOSRows = parsePOSRows;
    root.parseFilesPOS = parseFilesPOS;
    if (typeof module !== 'undefined' && module.exports) module.exports = { parsePOSRows, TERMINALI };
})(typeof window !== 'undefined' ? window : globalThis);
