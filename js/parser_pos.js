// Parser per i file POS (Esportazione da portale Nexi)

// Mappatura Terminali in base alle specifiche fornite
const TERMINALI = {
    '85028845': { sede: 'F', tipo: 'pos_cassa' },    // Ferraris - Fisico
    '85074555': { sede: 'F', tipo: 'pos_5g' },       // Ferraris - Mobile 5G
    '85074088': { sede: 'F', tipo: 'pay_by_link' },  // Ferraris - E-commerce
    '85028787': { sede: 'Z', tipo: 'pos_cassa' },    // Spezia - Fisico
    '85074547': { sede: 'Z', tipo: 'pos_5g' },       // Spezia - Mobile 5G
    '85072084': { sede: 'Z', tipo: 'pay_by_link' }   // Spezia - E-commerce
};

window.parseFilesPOS = async function parseFilesPOS(filesList) {
    let allPosTxs = [];
    
    // Supporto per il caricamento multiplo di file POS (se esportati a spizzichi)
    for (let i = 0; i < filesList.length; i++) {
        const d = await parseSinglePOS(filesList[i]);
        allPosTxs = allPosTxs.concat(d);
    }
    
    return allPosTxs;
}

function parseSinglePOS(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[firstSheetName];
                
                // Converte tutto in array per analizzare l'header fluttuante
                let rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
                
                // Cerca l'indice della riga di intestazione (contiene "Data" e "Importo")
                let headerIndex = -1;
                for (let i = 0; i < Math.min(20, rows.length); i++) {
                    const row = rows[i] || [];
                    const rowStr = row.join(' ').toLowerCase();
                    // Alcuni export Nexi non hanno "circuito" ma hanno sicuro data e importo
                    if (rowStr.includes('data') && (rowStr.includes('importo') || rowStr.includes('transazione'))) {
                        headerIndex = i;
                        break;
                    }
                }

                if (headerIndex === -1) {
                    throw new Error("Impossibile trovare la riga d'intestazione sull'esportazione POS.");
                }

                let processedPOS = [];
                const headers = rows[headerIndex].map(h => String(h || '').trim());
                
                // Variabili di debug per aiutare l'utente
                let countSkippedRifiutato = 0;
                let sampleDate = null;
                let sampleTml = null;

                for (let i = headerIndex + 1; i < rows.length; i++) {
                    const rowArray = rows[i];
                    if (!rowArray || rowArray.length === 0 || !rowArray[0]) continue;
                    
                    let rowData = {};
                    headers.forEach((h, idx) => {
                        if (h) rowData[h.toLowerCase()] = rowArray[idx]; // tutte chiavi minuscole!
                    });

                    // Helper per cercare chiavi simili (es. "n° autorizzazione")
                    const getVal = (...keys) => {
                        for (let k of keys) {
                            for (let rowKey in rowData) {
                                if (rowKey.includes(k.toLowerCase())) return rowData[rowKey];
                            }
                        }
                        return undefined;
                    };

                    const stato = String(getVal('stato', 'esito') || '').toLowerCase();
                    if (stato.includes('rifiutat') || stato.includes('negat')) {
                        countSkippedRifiutato++;
                        continue;
                    }

                    // TML
                    let tmlObj = getVal('terminal', 'tml');
                    // Rimuovi eventuali .0 o ' presenti nell'export csv
                    let tml = String(tmlObj || '').replace(/\.0$/, '').replace(/['"]/g, '').trim();
                    if (!sampleTml) sampleTml = tml;
                    
                    const metaTml = TERMINALI[tml] || { sede: 'Sconosciuta', tipo: 'Sconosciuto' };

                    // Se non viene riconosciuta la sede, è un problema per i match
                    const rawDataPos = String(getVal('data') || '');
                    if (!sampleDate) sampleDate = rawDataPos;

                    const rawOraPos = String(getVal('ora') || '00:00:00');
                    const nAutorizzazione = String(getVal('autorizz', 'auth') || 'NA').trim();
                    
                    // Parse Importo con logic universale
                    let strImporto = String(getVal('importo', 'amount') || '0').trim();
                    let importoNum = 0;
                    let lastDot = strImporto.lastIndexOf('.');
                    let lastComma = strImporto.lastIndexOf(',');
                    
                    if (lastComma > lastDot) {
                        strImporto = strImporto.replace(/\./g, '').replace(',', '.');
                    } else if (lastDot > lastComma) {
                        strImporto = strImporto.replace(/,/g, '');
                    } else {
                        if (lastComma !== -1) strImporto = strImporto.replace(',', '.');
                    }
                    importoNum = parseFloat(strImporto);

                    // Parse Data
                    let normalizedDate = '';
                    if (rawDataPos.length >= 8) {
                        const dClean = rawDataPos.replace(/\./g, '/').replace(/-/g, '/');
                        const parts = dClean.split('/');
                        if (parts.length === 3) {
                            // Se il primo valore è > 12 è sicuramente Giorno, altrimenti speriamo sia DD/MM
                            let dd = parts[0];
                            let mm = parts[1];
                            let yyyy = parts[2];
                            // Gestisci anni con 2 cifre
                            if (yyyy.length === 2) yyyy = '20' + yyyy;
                            normalizedDate = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
                        } else {
                            // Cerca di gestire stringhe strane XLSX senza divisori se ci fossero
                            normalizedDate = rawDataPos; 
                        }
                    }

                    const _uid = `${nAutorizzazione}|${normalizedDate}|${importoNum.toFixed(2)}`;

                    processedPOS.push({
                        DataOriginale: rawDataPos,
                        DataParsed: normalizedDate,
                        Ora: rawOraPos,
                        Autorizzazione: nAutorizzazione,
                        Importo: importoNum,
                        Circuito: String(getVal('circuit') || 'NA'),
                        Tml: tml,
                        sede_tml: metaTml.sede,
                        tipo_tml: metaTml.tipo,
                        _uid: _uid
                    });
                }
                
                // Controllo di salute: se appare qualche terminale sconosciuto, avvisa
                const unknownTmls = processedPOS.filter(p => p.sede_tml === 'Sconosciuta');
                if (unknownTmls.length > 0) {
                    const sampleId = unknownTmls[0].Tml;
                    throw new Error(`Letto un terminale sconosciuto (ID: ${sampleId}). Impossibile abbinargli una sede (F/Z). Non posso proseguire.`);
                }

                resolve(processedPOS);
            } catch (err) {
                console.error("Errore parser POS Nexi:", err);
                reject("Errore durante la lettura del file POS Nexi: " + err.message);
            }
        };

        reader.readAsArrayBuffer(file);
    });
}
