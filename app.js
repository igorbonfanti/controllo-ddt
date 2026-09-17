// --- Export Excel ---

function esportaExcel() {
    if (!state.risultati) return;

    const { anomalie, aggregatiGiornalieri } = state.risultati;
    const correttiIDs = Store.getCorretti();
    const db = Store.getCorrispettivi();
    const wb = XLSX.utils.book_new();
    const oggi = new Date().toLocaleDateString('it-IT');

    // ---- Foglio 1: Riepilogo ----
    const anomF = anomalie.filter(a => a.ddt.Sede === 'F');
    const anomZ = anomalie.filter(a => a.ddt.Sede === 'Z');
    const totF = anomF.reduce((s, a) => s + a.ddt.ImportoConIVA, 0);
    const totZ = anomZ.reduce((s, a) => s + a.ddt.ImportoConIVA, 0);

    const riepilogo = [
        ['RICONCILIAZIONE POS / DDT — Il Magazzino Edile S.r.l.'],
        ['Generato il:', oggi],
        [],
        ['DDT DA CORREGGERE'],
        ['Sede', 'N° DDT', 'Importo totale (€)'],
        ['Ferraris', anomF.length, totF],
        ['Spezia',   anomZ.length, totZ],
        ['TOTALE',   anomF.length + anomZ.length, totF + totZ],
        [],
        ['ANOMALIE CORRISPETTIVI'],
        ['Data', 'Sede', 'Residuo POS (€)', 'Dichiarato RT el. (€)', 'Delta (€)', 'Stato'],
    ];

    aggregatiGiornalieri.forEach(gg => {
        const rec = db[`${gg.data}_${gg.sedeChr}`] || {};
        const rtEl = rec.tot_elettronico !== undefined && rec.tot_elettronico !== '' ? rec.tot_elettronico : null;
        let delta = '', stato;
        if (rtEl === null) {
            stato = '⚠ mancante';
        } else {
            delta = +(gg.residuo - rtEl).toFixed(2);
            stato = Math.abs(delta) <= 0.02 ? '✓ ok' : `⚠ Δ +${delta}€`;
        }
        riepilogo.push([formatDate(gg.data), gg.sede, gg.residuo, rtEl ?? '', delta, stato]);
    });

    const ws1 = XLSX.utils.aoa_to_sheet(riepilogo);
    ws1['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 22 }, { wch: 12 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Riepilogo');

    // ---- Fogli 2 & 3: DDT per sede ----
    const hDDT = [
        'N° DDT', 'Sede', 'Data DDT', 'Cliente', 'Importo (€)',
        'Pagamento attuale', 'Correggere in',
        'POS Data', 'POS Ora', 'POS N° Auth', 'POS Circuito', 'Corretto'
    ];

    [['F', 'Ferraris'], ['Z', 'Spezia']].forEach(([sedeChr, nomeS]) => {
        const rows = anomalie
            .filter(a => a.ddt.Sede === sedeChr)
            .sort((a, b) => a.ddt.DataParsed.localeCompare(b.ddt.DataParsed))
            .map(a => [
                a.ddt.NrDoc,
                nomeS,
                formatDate(a.ddt.DataParsed),
                a.ddt.Cliente,
                a.ddt.ImportoConIVA,
                a.ddt.Pagamento,
                'POS',
                a.pos.DataParsed ? formatDate(a.pos.DataParsed) : '',
                a.pos.Ora || '',
                a.pos.Autorizzazione || '',
                a.pos.Circuito || '',
                correttiIDs.includes(a.anomaliaId) ? '✓' : ''
            ]);

        const ws = XLSX.utils.aoa_to_sheet([hDDT, ...rows]);
        ws['!cols'] = [
            { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 32 }, { wch: 12 },
            { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 8 }
        ];
        XLSX.utils.book_append_sheet(wb, ws, `${nomeS} - DDT`);
    });

    // ---- Foglio 4: Corrispettivi & POS residuo ----
    const hCorr = [
        'Data', 'Sede', 'POS-cassa tot. (€)', 'DDT abbinati (€)',
        'Residuo POS (€)', 'Dichiarato RT el. (€)', 'Delta (€)',
        'Stato', 'Contanti RT (€)', 'Note'
    ];

    const rowsCorr = aggregatiGiornalieri.map(gg => {
        const rec = db[`${gg.data}_${gg.sedeChr}`] || {};
        const rtEl   = rec.tot_elettronico !== undefined && rec.tot_elettronico !== '' ? rec.tot_elettronico : '';
        const rtCont = rec.tot_contanti   !== undefined && rec.tot_contanti   !== '' ? rec.tot_contanti   : '';
        let delta = '', stato;
        if (rtEl === '') {
            stato = '⚠ mancante';
        } else {
            delta = +(gg.residuo - rtEl).toFixed(2);
            stato = Math.abs(delta) <= 0.02 ? '✓ ok' : `⚠ Δ +${delta}€`;
        }
        return [
            formatDate(gg.data), gg.sede,
            gg.posTotale, gg.b2bAbbinati, gg.residuo,
            rtEl, delta, stato, rtCont, rec.note || ''
        ];
    });

    const ws4 = XLSX.utils.aoa_to_sheet([hCorr, ...rowsCorr]);
    ws4['!cols'] = [
        { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 14 },
        { wch: 20 }, { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 30 }
    ];
    XLSX.utils.book_append_sheet(wb, ws4, 'Corrispettivi');

    // Scarica
    const dataFile = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Riconciliazione_${dataFile}.xlsx`);
}

// Stato globale dell'app
const state = {
    ddtList: [],
    posList: [],
    risultati: null
};

// Funzioni di Utility UI
const formatEuro = (num) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(num);
const formatDate = (isoStr) => {
    if (!isoStr || isoStr.length !== 10) return isoStr;
    const parts = isoStr.split('-');
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

// DOM Elements
const ui = {
    tabs: document.querySelectorAll('.ag-nav .ag-nav-voce'),
    sections: document.querySelectorAll('.tab-content'),
    dropDdt: document.getElementById('dropzone-ddt'),
    dropPos: document.getElementById('dropzone-pos'),
    fileDdt: document.getElementById('file-ddt'),
    filePos: document.getElementById('file-pos'),
    statusDdt: document.getElementById('status-ddt'),
    statusPos: document.getElementById('status-pos'),
    btnElabora: document.getElementById('btn-elabora'),
    statusIndDot: document.querySelector('#status-indicator .dot'),
    statusIndText: document.querySelector('#status-indicator'),
    
    // Tabelle
    tbodyFerraris: document.querySelector('#table-ferraris tbody'),
    tbodySpezia: document.querySelector('#table-spezia tbody'),
    tbodyCorrispettivi: document.querySelector('#table-corrispettivi tbody'),
    tbodyAllDdt: document.querySelector('#table-all-ddt tbody'),
    tbodyAllPos: document.querySelector('#table-all-pos tbody'),
    toggleCorretti: document.getElementById('toggle-corretti'),
    countAnomalie: document.getElementById('count-anomalie')
};

// --- Gestione Tabs ---
ui.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        if (tab.classList.contains('disattiva')) return;

        ui.tabs.forEach(t => t.classList.remove('attiva'));
        ui.sections.forEach(s => s.classList.remove('active'));

        tab.classList.add('attiva');
        document.getElementById(tab.dataset.tab).classList.add('active');
    });
});

// --- Gestione Drag & Drop e File Input ---

// Helper Drag&Drop generico
function setupDropzone(zone, inputEl, callback) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            inputEl.files = e.dataTransfer.files;
            callback(e.dataTransfer.files);
        }
    });
    inputEl.addEventListener('change', (e) => callback(e.target.files));
}

async function handleDDTUpload(files) {
    if (!files.length) return;
    ui.statusDdt.className = 'file-status';
    ui.statusDdt.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Elaborazione in corso...';
    try {
        const ddtArray = await parseFileDDT(files[0]);
        state.ddtList = ddtArray;
        ui.statusDdt.className = 'file-status success';
        ui.statusDdt.innerHTML = `<i class="fa-solid fa-check"></i> OK! Caricati ${ddtArray.length} documenti.`;
        checkReadyState();
    } catch (e) {
        ui.statusDdt.className = 'file-status error';
        ui.statusDdt.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Errore: ${e}`;
    }
}

async function handlePOSUpload(files) {
    if (!files.length) return;
    ui.statusPos.className = 'file-status';
    ui.statusPos.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Elaborazione in corso...';
    try {
        const fileArray = Array.from(files);
        const posArray = await parseFilesPOS(fileArray);
        state.posList = posArray;
        ui.statusPos.className = 'file-status success';
        ui.statusPos.innerHTML = `<i class="fa-solid fa-check"></i> OK! Caricate ${posArray.length} transazioni.`;
        checkReadyState();
    } catch (e) {
        ui.statusPos.className = 'file-status error';
        ui.statusPos.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Errore: ${e}`;
    }
}

setupDropzone(ui.dropDdt, ui.fileDdt, handleDDTUpload);
setupDropzone(ui.dropPos, ui.filePos, handlePOSUpload);


function checkReadyState() {
    if (state.ddtList.length > 0 && state.posList.length > 0) {
        ui.btnElabora.classList.remove('disabled');
        ui.statusIndDot.className = 'dot ready';
        ui.statusIndText.innerHTML = '<div class="dot ready"></div> Pronti per la riconciliazione';
    }
}

// --- Elaborazione Centrale ---

ui.btnElabora.addEventListener('click', () => {
    state.risultati = eseguiRiconciliazione(state.ddtList, state.posList);
    
    // Attiva le altre tab
    document.getElementById('nav-riconciliazioni').classList.remove('disattiva');
    document.getElementById('nav-corrispettivi').classList.remove('disattiva');
    document.getElementById('nav-all-ddt').classList.remove('disattiva');
    document.getElementById('nav-all-pos').classList.remove('disattiva');
    
    // Salta alla tab Riconciliazioni
    document.getElementById('nav-riconciliazioni').click();
    
    renderAll();
});


// --- Render UI ---

function renderAll() {
    renderAnomalie();
    renderCorrispettivi();
    renderAllDdt();
    renderAllPos();
}

function renderAllDdt() {
    ui.tbodyAllDdt.innerHTML = '';
    state.ddtList.forEach(ddt => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${ddt.Sede === 'F' ? 'Ferraris' : 'Spezia'}</strong></td>
            <td>${formatDate(ddt.DataParsed)}</td>
            <td>${ddt.NrDoc}</td>
            <td>${ddt.Cliente}</td>
            <td class="amount text-nexi">${formatEuro(ddt.ImportoConIVA)}</td>
            <td><span class="badge ${NON_POS_PAG.includes(ddt.Pagamento) ? 'badge-danger' : 'badge-success'}">${ddt.Pagamento}</span></td>
        `;
        ui.tbodyAllDdt.appendChild(row);
    });
}

function renderAllPos() {
    ui.tbodyAllPos.innerHTML = '';
    state.posList.forEach(pos => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${pos.sede_tml === 'F' ? 'Ferraris' : (pos.sede_tml === 'Z' ? 'Spezia' : 'Sconosciuta')}</strong><br><small>${pos.tipo_tml}</small></td>
            <td>${formatDate(pos.DataParsed)}<br><small>${pos.Ora}</small></td>
            <td>${pos.Autorizzazione}</td>
            <td class="amount text-nexi">${formatEuro(pos.Importo)}</td>
            <td><span class="badge badge-success">${pos.Circuito}</span></td>
        `;
        ui.tbodyAllPos.appendChild(row);
    });
}

function renderAnomalie() {
    const { anomalie } = state.risultati;
    ui.tbodyFerraris.innerHTML = '';
    ui.tbodySpezia.innerHTML = '';
    
    // Recupera lo stato "Corretti" salvato
    const correttiIDs = Store.getCorretti();
    const mostraTutti = ui.toggleCorretti.checked;
    
    let conteggioVisibili = 0;

    anomalie.sort((a,b) => a.ddt.DataParsed.localeCompare(b.ddt.DataParsed)).forEach(anomalia => {
        const id = anomalia.anomaliaId;
        const isCorretto = correttiIDs.includes(id);
        
        // Nascondi se è corretto e il toggle è spento
        if (isCorretto && !mostraTutti) return;
        if (!isCorretto) conteggioVisibili++;

        const row = document.createElement('tr');
        if (isCorretto) row.classList.add('tr-corretto');

        row.innerHTML = `
            <td>${formatDate(anomalia.ddt.DataParsed)}</td>
            <td><strong>${anomalia.ddt.NrDoc}</strong></td>
            <td>${anomalia.ddt.Cliente}</td>
            <td class="amount text-nexi">${formatEuro(anomalia.ddt.ImportoConIVA)}</td>
            <td><span class="badge badge-warning">${anomalia.ddt.Pagamento} ➔ POS</span></td>
            <td style="font-size:0.85em; color:var(--text-muted)">
                ${anomalia.pos.Ora} - Auth: ${anomalia.pos.Autorizzazione}<br>
                ${anomalia.pos.Circuito}
            </td>
            <td>
                ${isCorretto ? `
                    <button class="btn btn-outline" onclick="window.unmarkCorretto('${id}')">
                        <i class="fa-solid fa-rotate-left"></i> Annulla
                    </button>
                ` : `
                    <button class="btn btn-success" onclick="window.markCorretto('${id}')">
                        <i class="fa-solid fa-check"></i> Segna Corretto
                    </button>
                `}
            </td>
        `;

        if (anomalia.ddt.Sede === 'F') ui.tbodyFerraris.appendChild(row);
        else ui.tbodySpezia.appendChild(row);
    });

    ui.countAnomalie.innerText = conteggioVisibili;
}

ui.toggleCorretti.addEventListener('change', renderAnomalie);

// Esporre globalmente per i pulsanti inline nella tabella
window.markCorretto = (id) => {
    Store.marcaComeCorretto(id);
    renderAnomalie();
};
window.unmarkCorretto = (id) => {
    Store.rimuoviCorretto(id);
    renderAnomalie();
};

function renderCorrispettivi() {
    const { aggregatiGiornalieri } = state.risultati;
    ui.tbodyCorrispettivi.innerHTML = '';
    
    const db = Store.getCorrispettivi();

    aggregatiGiornalieri.forEach((gg, idx) => {
        const key = `${gg.data}_${gg.sedeChr}`;
        const recordSalvato = db[key] || {};
        
        const row = document.createElement('tr');
        // Identificatori per gli id input
        const idInpElett = `rt_el_${idx}`;
        const idInpCont = `rt_co_${idx}`;
        const idInpNote = `rt_no_${idx}`;
        const idSpnDelta = `spn_delta_${idx}`;
        
        row.innerHTML = `
            <td>${formatDate(gg.data)}</td>
            <td><strong>${gg.sede}</strong></td>
            <td class="amount">${formatEuro(gg.posTotale)}</td>
            <td class="amount text-nexi">${formatEuro(gg.b2bAbbinati)}</td>
            <td class="amount" style="color:white">${formatEuro(gg.residuo)}</td>
            <td>
                <input type="number" id="${idInpElett}" class="modern-input" step="0.01" value="${recordSalvato.tot_elettronico || ''}" placeholder="0.00">
            </td>
            <td><strong id="${idSpnDelta}">--</strong></td>
            <td>
                <input type="number" id="${idInpCont}" class="modern-input" step="0.01" value="${recordSalvato.tot_contanti || ''}" placeholder="0.00">
            </td>
            <td>
                <input type="text" id="${idInpNote}" class="modern-input wide" value="${recordSalvato.note || ''}" placeholder="Es. 5G in negozio">
            </td>
            <td>
                <button class="btn btn-outline" id="btn_save_${idx}"><i class="fa-solid fa-floppy-disk"></i></button>
            </td>
        `;
        ui.tbodyCorrispettivi.appendChild(row);

        // Collegamento eventi e logica live-update
        const inputElett = document.getElementById(idInpElett);
        const spanDelta = document.getElementById(idSpnDelta);
        const btnSave = document.getElementById(`btn_save_${idx}`);
        
        const calcDelta = () => {
            const rtEl = parseFloat(inputElett.value) || 0;
            if (rtEl === 0) {
                spanDelta.innerHTML = `<span class="badge badge-warning">?</span>`;
                return;
            }
            const delta = gg.residuo - rtEl;
            if (Math.abs(delta) <= 0.05) {
                spanDelta.innerHTML = `<span class="badge badge-success"><i class="fa-solid fa-check"></i> ${formatEuro(delta)}</span>`;
            } else {
                spanDelta.innerHTML = `<span class="badge badge-danger">! ${formatEuro(delta)}</span>`;
            }
        };

        inputElett.addEventListener('input', calcDelta);
        calcDelta(); // first render

        btnSave.addEventListener('click', () => {
            const eVal = parseFloat(inputElett.value) || 0;
            const cVal = parseFloat(document.getElementById(idInpCont).value) || 0;
            const nVal = document.getElementById(idInpNote).value;
            
            Store.salvaCorrispettivo({
                data: gg.data,
                sede: gg.sedeChr,
                tot_elettronico: eVal,
                tot_contanti: cVal,
                tot_corrispettivi: eVal + cVal,
                note: nVal
            });
            
            btnSave.classList.replace('btn-outline', 'btn-success');
            setTimeout(() => btnSave.classList.replace('btn-success', 'btn-outline'), 1000);
        });
    });
}
