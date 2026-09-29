// Parser per il file DDT (Esportazione Zucchetti)

(function (root) {
    const U = root.Util || (typeof require !== 'undefined' ? require('./util.js') : null);

    // Colonne fisse dell'export Zucchetti (vedi riconciliazione_pos_ddt_spec.md, par. 3.1)
    const COL = { tipoDoc: 1, nr: 3, sede: 4, data: 5, numFattura: 6, dataFattura: 8, pagamento: 9, imponibile: 10, importo: 11, cliente: 12 };

    function parseDDTRows(rows) {
        const out = [];
        for (const row of rows) {
            if (!row || row.length < 12) continue;

            // Sede: colonna E ("F"/"Z"), con conferma dal codice documento (DE1 = Spezia, DE2 = Ferraris)
            let sede = String(row[COL.sede] || '').trim().toUpperCase().substring(0, 1);
            const tipoDoc = String(row[COL.tipoDoc] || '').trim().toUpperCase();
            if (tipoDoc.includes('DE1')) sede = 'Z';
            if (tipoDoc.includes('DE2')) sede = 'F';
            if (sede !== 'F' && sede !== 'Z') continue; // totali e pie' di pagina

            const nr = String(row[COL.nr] || '').trim();
            const dataIso = U.parseDataIT(row[COL.data]);
            if (!nr || !dataIso) continue;

            const importo = U.parseNumero(row[COL.importo]);
            if (isNaN(importo) || importo === 0) continue;

            // Il DDT stampato calcola l'IVA sul totale (imponibile x 1,22 arrotondato), mentre la colonna
            // "Importo con IVA" dell'export somma le righe gia' arrotondate una per una e puo' differire
            // di qualche centesimo. Il cliente paga la cifra stampata. Se l'IVA non e' tutta al 22%
            // i due valori si allontanano troppo e si tiene quello dell'export.
            const imponibile = U.parseNumero(row[COL.imponibile]);
            const stampato = isNaN(imponibile) ? importo : Math.round(imponibile * 122) / 100;
            const importoDocumento = Math.abs(stampato - importo) <= 0.05 ? stampato : importo;

            // "Cliente: CODICE - NOME CITTA" -> codice + nome
            const cliente = String(row[COL.cliente] || '').replace(/^\s*Cliente:\s*/i, '').replace(/\s+/g, ' ').trim();
            const sepIdx = cliente.indexOf(' - ');
            const codiceCliente = sepIdx > 0 ? cliente.slice(0, sepIdx).trim() : '';
            const nomeCliente = sepIdx > 0 ? cliente.slice(sepIdx + 3).trim() : cliente;

            out.push({
                NrDoc: nr,
                Sede: sede,
                DataOriginale: String(row[COL.data]).trim(),
                DataParsed: dataIso,
                Pagamento: String(row[COL.pagamento] || '').trim().toUpperCase(),
                ImportoConIVA: Math.round(importo * 100) / 100,
                ImportoDocumento: importoDocumento,
                Cliente: cliente,
                CodiceCliente: codiceCliente,
                NomeCliente: nomeCliente,
                NumFattura: String(row[COL.numFattura] || '').trim().replace(/^0+(?=\d)/, ''),
                DataFattura: U.parseDataIT(row[COL.dataFattura]),
                id: `${nr}_${dataIso}_${sede}`
            });
        }
        return out;
    }

    async function parseFileDDT(file) {
        try {
            const rows = await U.leggiRighe(file);
            const ddt = parseDDTRows(rows);
            if (!ddt.length) throw new Error('nessun DDT riconosciuto');
            return ddt;
        } catch (err) {
            console.error('Errore parser DDT:', err);
            throw "Errore durante la lettura del file DDT. Verifica che sia l'export Zucchetti originale.";
        }
    }

    root.parseDDTRows = parseDDTRows;
    root.parseFileDDT = parseFileDDT;
    if (typeof module !== 'undefined' && module.exports) module.exports = { parseDDTRows };
})(typeof window !== 'undefined' ? window : globalThis);
