// Parser per il file DDT (Esportazione Zucchetti)

window.parseFileDDT = async function parseFileDDT(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                // Usiamo SheetJS per estrarre direttamente il formato xls legacy
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[firstSheetName];
                
                // Converte in array array per elaborare
                let rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
                
                let processedDDTs = [];

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    if (!row || row.length < 13) continue;

                    // Colonna E (indice 4) = Sede ("F" o "Z")
                    // Se non è F o Z, verifichiamo la Colonna B (indice 1) che contiene "DE1" (Spezia) o "DE2" (Ferraris)
                    const sedeRaw = String(row[4] || '').trim().toUpperCase();
                    let sede = sedeRaw.substring(0, 1); 
                    
                    // Fallback roccioso tramite il prefisso documento Zucchetti
                    const tipoDoc = String(row[1] || '').trim().toUpperCase();
                    if (tipoDoc.includes('DE1')) sede = 'Z';
                    if (tipoDoc.includes('DE2')) sede = 'F';

                    // Se non è F o Z neanche dopo i controlli incrociati, probabilmente è un totale e saltiamo
                    if (sede !== 'F' && sede !== 'Z') continue;

                    // Estrazione e pulizia campi
                    const rawNrDoc = String(row[3] || '').trim();
                    const rawDataDoc = String(row[5] || '').trim();
                    const rawPagamento = String(row[9] || '').trim().toUpperCase();
                    const rawImportoIva = row[11];
                    const rawCliente = row[12];

                    if (!rawNrDoc || !rawDataDoc) continue;

                    // Pulizia Importo: i legacy xls Zucchetti scrivono es. "1.062,49" o "1,062.49"
                    // raw: false usa i formattatori della cella. Se è stringa la converto
                    let importoScrubbed = 0;
                    if (typeof rawImportoIva === 'string') {
                        let iStr = rawImportoIva.trim();
                        let lastDot = iStr.lastIndexOf('.');
                        let lastComma = iStr.lastIndexOf(',');
                        
                        if (lastComma > lastDot) {
                            // formato EU (es. 1.000,50 o 20,42)
                            iStr = iStr.replace(/\./g, '').replace(',', '.');
                        } else if (lastDot > lastComma) {
                            // formato US (es. 1,000.50 o 20.42)
                            iStr = iStr.replace(/,/g, '');
                        } else {
                            // Solo uno dei due è presente
                            if (lastComma !== -1) iStr = iStr.replace(',', '.');
                            // Se ha solo il punto, parseFloat lo leggerà nativamente
                        }
                        importoScrubbed = parseFloat(iStr);
                    } else if (typeof rawImportoIva === 'number') {
                        importoScrubbed = rawImportoIva;
                    }

                    // Scarto i righi a zero
                    if (isNaN(importoScrubbed) || importoScrubbed === 0) continue;

                    // Costruzione data in formato standard YYYY-MM-DD
                    // input Zucchetti: DD/MM/YYYY
                    let normalizedDate = '';
                    if (typeof rawDataDoc === 'string' && rawDataDoc.includes('/')) {
                        const parts = rawDataDoc.split('/');
                        if (parts.length === 3) {
                            normalizedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                        }
                    }

                    // Pulizia Cliente
                    // "Cliente: 12345 - NOME AZIENDA MILANO" -> "12345 - NOME AZIENDA MILANO"
                    let clientePulito = String(rawCliente || '').replace(/^Cliente:\s*/i, '');

                    processedDDTs.push({
                        NrDoc: String(rawNrDoc),
                        Sede: sede, // F o Z
                        DataOriginale: rawDataDoc,
                        DataParsed: normalizedDate,
                        Pagamento: String(rawPagamento).trim(),
                        ImportoConIVA: importoScrubbed,
                        Cliente: clientePulito
                    });
                }
                
                resolve(processedDDTs);
            } catch (err) {
                console.error("Errore parser DDT:", err);
                reject("Errore durante la lettura del file DDT. Verifica che sia l'export Zucchetti originale.");
            }
        };

        reader.readAsArrayBuffer(file);
    });
}
