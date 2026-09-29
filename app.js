// Stato globale dell'app
const state = {
    ddtList: [],
    posList: [],
    bpmList: null,          // null = estratto conto non caricato
    risultati: null,
    filtri: { categoria: 'da_sistemare', sede: '', conf: '', testo: '' }
};

// --- Utility UI ---
const formatEuro = (num) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(num);
const formatDate = (isoStr) => {
    if (!isoStr || isoStr.length !== 10) return isoStr || '';
    const parts = isoStr.split('-');
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
};
const formatDateBreve = (isoStr) => formatDate(isoStr).slice(0, 5);
const nomeSede = (c) => (c === 'F' ? 'Ferraris' : c === 'Z' ? 'Spezia' : 'Sconosciuta');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const REGOLE = {
    pos_esatto: 'Stesso giorno, stessa sede, stesso importo',
    pos_altra_sede: "Stesso giorno e importo, ma sul POS dell'altra sede",
    pos_finestra: 'Stesso importo e sede, POS battuto in un giorno diverso dal DDT',
    pos_gruppo: 'Più DDT dello stesso cliente pagati con una sola transazione',
    pos_anticipato: 'Stesso importo e sede, POS battuto prima della consegna (pagamento anticipato)',
    bon_rif_ddt: 'La causale del bonifico cita il numero del DDT',
    bon_cliente_importo: 'Ordinante uguale al cliente, stesso importo',
    bon_cliente_somma: 'Ordinante uguale al cliente, bonifico pari alla somma di più DDT',
    bon_solo_importo: 'Solo stesso importo: ordinante non riconosciuto',
    bon_rif_fattura: 'La causale del bonifico cita il numero della fattura dei DDT',
    bon_fattura_mese: 'Ordinante uguale al cliente, bonifico pari al totale dei DDT del mese (fattura mensile)'
};

// Categorie della scheda "Verifica pagamenti"
const CATEGORIE = [
    { id: 'da_sistemare', label: 'Da sistemare', test: r => r.verdetto === 'correggere' || r.verdetto === 'mancante' },
    { id: 'correggi_pos', label: 'Correggere in POS', test: r => r.verdetto === 'correggere' && r.correggiIn === 'POS' },
    { id: 'correggi_bb', label: 'Correggere in BB', test: r => r.verdetto === 'correggere' && r.correggiIn === 'BB' },
    { id: 'pos_mancante', label: 'POS senza transazione', test: r => r.verdetto === 'mancante' && r.ddt.Pagamento === 'POS' },
    { id: 'bb_mancante', label: 'Fattura scaduta non pagata', test: r => r.verdetto === 'mancante' && r.ddt.Pagamento !== 'POS' },
    { id: 'attesa_fattura', label: 'Attesa pagamento fine mese', test: r => r.verdetto === 'attesa_fattura' },
    { id: 'in_attesa', label: 'Non verificabili', test: r => r.verdetto === 'non_verificabile' },
    { id: 'ok', label: 'Corretti', test: r => r.verdetto === 'ok' },
    { id: 'tutti', label: 'Tutti', test: () => true }
];
const categoria = (id) => CATEGORIE.find(c => c.id === id);

function badgeEsito(r) {
    const p = esc(r.ddt.Pagamento);
    switch (r.verdetto) {
        case 'correggere': return `<span class="ag-pastiglia pastiglia-arancio">${p} ➔ ${r.correggiIn}</span>`;
        case 'mancante': return `<span class="ag-pastiglia pastiglia-rossa">${r.ddt.Pagamento === 'POS' ? 'POS senza transazione' : p + ' senza bonifico'}</span>`;
        case 'attesa_fattura': return `<span class="ag-pastiglia pastiglia-blu" title="${esc(r.motivo)}">attesa fine mese</span>`;
        case 'non_verificabile': return '<span class="ag-pastiglia">non verificabile</span>';
        case 'ok': return '<span class="ag-pastiglia pastiglia-verde">ok</span>';
        case 'reso': return '<span class="ag-pastiglia">reso</span>';
        case 'riba': return '<span class="ag-pastiglia">RiBa</span>';
        default: return `<span class="ag-pastiglia">${r.ddt.Pagamento === 'CAS' ? 'contanti/assegno' : 'nessun incasso'}</span>`;
    }
}

function badgeConf(conf, regola) {
    if (!conf) return '';
    const cls = { alta: 'pastiglia-verde', media: 'pastiglia-ambra', bassa: 'pastiglia-arancio' }[conf];
    return `<span class="ag-pastiglia ${cls}" title="${esc(REGOLE[regola] || '')}">${conf}</span>`;
}

function descriviIncasso(r) {
    const e = r.esito;
    if (!e) return `<span class="testo-tenue">${esc(r.motivo)}</span>`
        + (r.indizi || []).map(i => `<br><span class="indizio"><i class="fa-solid fa-magnifying-glass"></i> ${esc(i)}</span>`).join('');
    const altri = e.gruppo ? `<br><small>insieme a DDT ${esc(e.gruppo.filter(n => n !== r.ddt.NrDoc).join(', '))}</small>` : '';
    if (e.canale === 'POS') {
        const p = e.pos;
        const gg = Util.giorniTra(r.ddt.DataParsed, p.DataParsed);
        const note = [];
        if (gg !== 0) note.push(`${gg > 0 ? '+' : ''}${gg} gg`);
        if (p.sede_tml !== r.ddt.Sede) note.push(`POS ${nomeSede(p.sede_tml)}`);
        if (p.tipo_tml !== 'pos_cassa') note.push(p.tipo_tml === 'pay_by_link' ? 'pay-by-link' : 'POS 5G');
        return `<i class="fa-solid fa-credit-card"></i> ${formatDateBreve(p.DataParsed)} ${esc(p.Ora.slice(0, 5))} · ${esc(p.Circuito)} · auth ${esc(p.Autorizzazione)}`
            + (note.length ? ` <span class="nota-evidenza">(${esc(note.join(', '))})</span>` : '') + altri;
    }
    const b = e.bon;
    return `<i class="fa-solid fa-building-columns"></i> ${formatDateBreve(b.DataParsed)} · <span title="${esc(b.Descrizione)}">${esc(b.Ordinante.length > 60 ? b.Ordinante.slice(0, 60) + '…' : b.Ordinante)}</span>`
        + (e.nota ? ` <span class="nota-evidenza">(${esc(e.nota)})</span>` : '') + altri;
}

// --- DOM ---
const ui = {
    tabs: document.querySelectorAll('.ag-nav .ag-nav-voce'),
    sections: document.querySelectorAll('.tab-content'),
    dropDdt: document.getElementById('dropzone-ddt'),
    dropPos: document.getElementById('dropzone-pos'),
    dropBpm: document.getElementById('dropzone-bpm'),
    fileDdt: document.getElementById('file-ddt'),
    filePos: document.getElementById('file-pos'),
    fileBpm: document.getElementById('file-bpm'),
    statusDdt: document.getElementById('status-ddt'),
    statusPos: document.getElementById('status-pos'),
    statusBpm: document.getElementById('status-bpm'),
    btnElabora: document.getElementById('btn-elabora'),
    statusIndText: document.querySelector('#status-indicator'),

    tbodyVerifica: document.querySelector('#table-verifica tbody'),
    vuotoVerifica: document.getElementById('vuoto-verifica'),
    riepilogo: document.getElementById('riepilogo-verifica'),
    filtroCategoria: document.getElementById('filtro-categoria'),
    filtroSede: document.getElementById('filtro-sede'),
    filtroConf: document.getElementById('filtro-conf'),
    filtroTesto: document.getElementById('filtro-testo'),
    sottotitoloVerifica: document.getElementById('sottotitolo-verifica'),
    tbodyBonifici: document.querySelector('#table-bonifici tbody'),
    sottotitoloBonifici: document.getElementById('sottotitolo-bonifici'),
    tbodyQuadratura: document.querySelector('#table-quadratura tbody'),
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

// --- Drag & Drop e File Input ---
function setupDropzone(zone, inputEl, callback) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) callback(e.dataTransfer.files);
    });
    inputEl.addEventListener('change', (e) => { callback(e.target.files); e.target.value = ''; });
}

async function caricaFile(files, statusEl, parse, applica, descrivi) {
    if (!files.length) return;
    statusEl.className = 'file-status';
    statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Elaborazione in corso...';
    try {
        const dati = await parse(Array.from(files));
        applica(dati);
        statusEl.className = 'file-status success';
        statusEl.innerHTML = `<i class="fa-solid fa-check"></i> ${descrivi(dati)}`;
        checkReadyState();
    } catch (e) {
        statusEl.className = 'file-status error';
        statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Errore: ${esc(e.message || e)}`;
    }
}

const periodoDi = (lista) => {
    const d = lista.map(x => x.DataParsed).sort();
    return d.length ? `dal ${formatDate(d[0])} al ${formatDate(d[d.length - 1])}` : '';
};

setupDropzone(ui.dropDdt, ui.fileDdt, files => caricaFile(files, ui.statusDdt,
    f => parseFileDDT(f[0]), d => { state.ddtList = d; },
    d => `OK! ${d.length} documenti ${periodoDi(d)}.`));

setupDropzone(ui.dropPos, ui.filePos, files => caricaFile(files, ui.statusPos,
    f => parseFilesPOS(f), d => { state.posList = d; },
    d => `OK! ${d.length} transazioni ${periodoDi(d)}.`));

setupDropzone(ui.dropBpm, ui.fileBpm, files => caricaFile(files, ui.statusBpm,
    f => parseFilesBPM(f), d => { state.bpmList = d; },
    d => `OK! ${d.length} movimenti in entrata (${d.filter(m => m.tipo === 'bonifico').length} bonifici clienti) ${periodoDi(d)}.`));

function checkReadyState() {
    if (state.ddtList.length > 0 && state.posList.length > 0) {
        ui.btnElabora.classList.remove('disabled');
        ui.statusIndText.innerHTML = state.bpmList
            ? '<div class="dot ready"></div> Pronti: verifica POS e bonifici'
            : '<div class="dot ready"></div> Pronti: verifica solo POS (manca l\'estratto conto)';
    }
}

// --- Elaborazione ---
ui.btnElabora.addEventListener('click', () => {
    state.risultati = eseguiRiconciliazione(state.ddtList, state.posList, state.bpmList);

    ['nav-riconciliazioni', 'nav-corrispettivi', 'nav-all-ddt', 'nav-all-pos'].forEach(id =>
        document.getElementById(id).classList.remove('disattiva'));
    document.getElementById('nav-bonifici').classList.toggle('disattiva', !state.bpmList);

    document.getElementById('nav-riconciliazioni').click();
    renderAll();
});

// --- Render ---
function renderAll() {
    renderVerifica();
    renderBonifici();
    renderCorrispettivi();
    renderAllDdt();
    renderAllPos();
}

function righeFiltrate(ignoraCategoria) {
    const { righe } = state.risultati;
    const f = state.filtri;
    const cat = categoria(f.categoria);
    const testo = f.testo.trim().toLowerCase();
    const corretti = new Set(Store.getCorretti());
    const confMin = f.conf === 'alta' ? 3 : f.conf === 'media' ? 2 : 0;
    return righe.filter(r => {
        if (!ignoraCategoria && !cat.test(r)) return false;
        if (f.sede && r.ddt.Sede !== f.sede) return false;
        if (confMin && r.esito && (CONF_ORDINE[r.esito.conf] || 0) < confMin) return false;
        if (testo && !(`${r.ddt.NrDoc} ${r.ddt.Cliente}`.toLowerCase().includes(testo))) return false;
        if (!ui.toggleCorretti.checked && corretti.has(r.anomaliaId) && f.categoria !== 'ok' && f.categoria !== 'tutti') return false;
        return true;
    });
}

function renderRiepilogo() {
    const { righe, periodo } = state.risultati;
    const corretti = new Set(Store.getCorretti());
    const carte = [
        { id: 'correggi_pos', titolo: 'Da correggere in POS', icona: 'fa-credit-card', tono: 'arancio' },
        { id: 'correggi_bb', titolo: 'Da correggere in BB', icona: 'fa-building-columns', tono: 'arancio', richiedeBpm: true },
        { id: 'pos_mancante', titolo: 'POS senza transazione', icona: 'fa-circle-question', tono: 'rosso' },
        { id: 'bb_mancante', titolo: 'Fattura scaduta non pagata', icona: 'fa-circle-question', tono: 'rosso', richiedeBpm: true },
        { id: 'attesa_fattura', titolo: 'Attesa pagamento fine mese', icona: 'fa-calendar-days', tono: 'blu', richiedeBpm: true },
        { id: 'ok', titolo: 'Pagamento corretto', icona: 'fa-circle-check', tono: 'verde' }
    ];
    ui.riepilogo.innerHTML = carte.map(c => {
        const lista = righe.filter(categoria(c.id).test);
        const aperte = c.id === 'ok' ? lista : lista.filter(r => !corretti.has(r.anomaliaId));
        const tot = aperte.reduce((s, r) => s + r.ddt.ImportoConIVA, 0);
        const assente = c.richiedeBpm && !periodo.bpmCaricato;
        return `<button class="carta-riepilogo tono-${c.tono} ${state.filtri.categoria === c.id ? 'attiva' : ''}" data-cat="${c.id}" ${assente ? 'disabled' : ''}>
            <span class="carta-titolo"><i class="fa-solid ${c.icona}"></i> ${c.titolo}</span>
            <span class="carta-numero">${assente ? '—' : aperte.length}</span>
            <span class="carta-sotto">${assente ? 'carica l\'estratto BPM' : formatEuro(tot)}</span>
        </button>`;
    }).join('');
}

function renderFiltriCategoria() {
    const { righe } = state.risultati;
    const corretti = new Set(Store.getCorretti());
    ui.filtroCategoria.innerHTML = CATEGORIE.map(c => {
        let n = righe.filter(c.test);
        if (!['ok', 'tutti'].includes(c.id)) n = n.filter(r => !corretti.has(r.anomaliaId));
        return `<button class="chip ${state.filtri.categoria === c.id ? 'attiva' : ''}" data-cat="${c.id}">${c.label} <span class="chip-conta">${n.length}</span></button>`;
    }).join('');
}

function renderVerifica() {
    const { righe, periodo } = state.risultati;
    const corretti = new Set(Store.getCorretti());

    ui.sottotitoloVerifica.textContent =
        `POS Nexi ${periodo.posMin ? 'dal ' + formatDate(periodo.posMin) + ' al ' + formatDate(periodo.posMax) : 'non caricato'} · ` +
        (periodo.bpmCaricato ? `estratto BPM dal ${formatDate(periodo.bpmMin)} al ${formatDate(periodo.bpmMax)}` : 'estratto BPM non caricato: verifica solo POS');

    renderRiepilogo();
    renderFiltriCategoria();

    const lista = righeFiltrate().sort((a, b) =>
        a.ddt.Sede.localeCompare(b.ddt.Sede) || a.ddt.DataParsed.localeCompare(b.ddt.DataParsed) || a.ddt.NrDoc.localeCompare(b.ddt.NrDoc, undefined, { numeric: true }));

    ui.tbodyVerifica.innerHTML = lista.map(r => {
        const fatto = corretti.has(r.anomaliaId);
        const azionabile = r.verdetto === 'correggere' || r.verdetto === 'mancante';
        return `<tr class="${fatto ? 'tr-corretto' : ''}">
            <td>${formatDate(r.ddt.DataParsed)}</td>
            <td>${nomeSede(r.ddt.Sede)}</td>
            <td><strong>${esc(r.ddt.NrDoc)}</strong></td>
            <td>${esc(r.ddt.Cliente)}</td>
            <td class="amount">${formatEuro(r.ddt.ImportoConIVA)}</td>
            <td><span class="ag-pastiglia">${esc(r.ddt.Pagamento)}</span></td>
            <td>${badgeEsito(r)}</td>
            <td class="cella-incasso">${descriviIncasso(r)}</td>
            <td>${r.esito ? badgeConf(r.esito.conf, r.esito.regola) : ''}</td>
            <td>${!azionabile ? '' : fatto
                ? `<button class="btn btn-outline btn-sm" data-annulla="${esc(r.anomaliaId)}"><i class="fa-solid fa-rotate-left"></i> Annulla</button>`
                : `<button class="btn btn-success btn-sm" data-fatto="${esc(r.anomaliaId)}" title="Corretto in contabilità, o verificato e non da correggere"><i class="fa-solid fa-check"></i> Sistemato</button>`}</td>
        </tr>`;
    }).join('');
    ui.vuotoVerifica.hidden = lista.length > 0;

    const daFare = righe.filter(categoria('da_sistemare').test).filter(r => !corretti.has(r.anomaliaId)).length;
    ui.countAnomalie.innerText = daFare;
    ui.countAnomalie.classList.toggle('allarme', daFare > 0);
}

// Eventi della scheda verifica (delegati: la tabella viene ridisegnata spesso)
ui.tbodyVerifica.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.fatto) Store.marcaComeCorretto(b.dataset.fatto);
    if (b.dataset.annulla) Store.rimuoviCorretto(b.dataset.annulla);
    renderVerifica();
    renderAllDdt();
});
const cambiaCategoria = e => {
    const b = e.target.closest('[data-cat]');
    if (!b || b.disabled) return;
    state.filtri.categoria = b.dataset.cat;
    renderVerifica();
};
ui.filtroCategoria.addEventListener('click', cambiaCategoria);
ui.riepilogo.addEventListener('click', cambiaCategoria);
ui.filtroSede.addEventListener('change', () => { state.filtri.sede = ui.filtroSede.value; renderVerifica(); });
ui.filtroConf.addEventListener('change', () => { state.filtri.conf = ui.filtroConf.value; renderVerifica(); });
ui.filtroTesto.addEventListener('input', () => { state.filtri.testo = ui.filtroTesto.value; renderVerifica(); });
ui.toggleCorretti.addEventListener('change', renderVerifica);

function renderBonifici() {
    const { bonifici, quadraturaNexi, periodo } = state.risultati;
    if (!periodo.bpmCaricato) {
        ui.tbodyBonifici.innerHTML = '';
        ui.tbodyQuadratura.innerHTML = '';
        return;
    }
    const abbinati = bonifici.filter(b => b.ddt.length);
    ui.sottotitoloBonifici.textContent = `${bonifici.length} bonifici clienti, ${abbinati.length} abbinati a DDT del periodo. ` +
        'Quelli non abbinati di solito saldano fatture di mesi precedenti o sono acconti.';

    ui.tbodyBonifici.innerHTML = [...bonifici].sort((a, b) => b.mov.DataParsed.localeCompare(a.mov.DataParsed)).map(b => `
        <tr>
            <td>${formatDate(b.mov.DataParsed)}</td>
            <td class="amount">${formatEuro(b.mov.Importo)}</td>
            <td>${esc(b.mov.Ordinante)}</td>
            <td>${b.ddt.length
                ? b.ddt.map(d => `<strong>${esc(d.NrDoc)}</strong>/${d.Sede} <span class="ag-pastiglia">${esc(d.Pagamento)}</span> ${formatEuro(d.ImportoConIVA)}`).join('<br>')
                    + `<br><small class="testo-tenue">${esc(b.ddt[0].Cliente)}</small>` + (b.nota ? `<br><small class="nota-evidenza">${esc(b.nota)}</small>` : '')
                : `<span class="testo-tenue">non abbinato${b.suggerimento ? ' · cliente probabile: ' + esc(b.suggerimento) : ''}</span>`}</td>
            <td>${badgeConf(b.conf, b.regola)}</td>
        </tr>`).join('');

    ui.tbodyQuadratura.innerHTML = quadraturaNexi.map(q => {
        const stato = q.accredito === null
            ? `<span class="ag-pastiglia pastiglia-rossa" title="Transazioni nel file Nexi senza accredito in banca">nessun accredito</span>`
            : q.delta === null
                ? '<span class="testo-tenue">transazioni prima del file Nexi</span>'
                : Math.abs(q.delta) <= 0.02
                    ? '<span class="ag-pastiglia pastiglia-verde">quadra</span>'
                    : `<span class="ag-pastiglia pastiglia-rossa">${formatEuro(q.delta)}</span>`;
        return `<tr>
            <td>${q.dataTransazioni ? formatDate(q.dataTransazioni) : '—'}</td>
            <td>${nomeSede(q.sede)}</td>
            <td>${esc(q.circuito)}</td>
            <td>${q.dataAccredito ? formatDate(q.dataAccredito) : '—'}</td>
            <td class="amount">${q.accredito === null ? '' : formatEuro(q.accredito)}</td>
            <td class="amount">${q.totalePos === null ? '' : formatEuro(q.totalePos)}</td>
            <td class="amount">${stato}</td>
        </tr>`;
    }).join('');
}

function renderAllDdt() {
    const perId = new Map(state.risultati.righe.map(r => [r.ddt.id, r]));
    ui.tbodyAllDdt.innerHTML = state.ddtList.map(ddt => {
        const r = perId.get(ddt.id);
        return `<tr>
            <td><strong>${nomeSede(ddt.Sede)}</strong></td>
            <td>${formatDate(ddt.DataParsed)}</td>
            <td>${esc(ddt.NrDoc)}</td>
            <td>${esc(ddt.Cliente)}</td>
            <td class="amount text-nexi">${formatEuro(ddt.ImportoConIVA)}</td>
            <td><span class="ag-pastiglia">${esc(ddt.Pagamento)}</span></td>
            <td>${r ? badgeEsito(r) : ''}</td>
        </tr>`;
    }).join('');
}

function renderAllPos() {
    const { posUsati } = state.risultati;
    const perId = new Map(state.ddtList.map(d => [d.id, d]));
    ui.tbodyAllPos.innerHTML = state.posList.map(pos => {
        const ids = posUsati.get(pos._uid) || [];
        const ddt = ids.map(id => perId.get(id)).filter(Boolean);
        return `<tr>
            <td><strong>${nomeSede(pos.sede_tml)}</strong><br><small>${esc(pos.tipo_tml)}</small></td>
            <td>${formatDate(pos.DataParsed)}<br><small>${esc(pos.Ora)}</small></td>
            <td>${esc(pos.Autorizzazione)}</td>
            <td class="amount text-nexi">${formatEuro(pos.Importo)}</td>
            <td><span class="ag-pastiglia">${esc(pos.Circuito)}</span></td>
            <td>${ddt.length ? ddt.map(d => `${esc(d.NrDoc)}/${d.Sede} <small>${esc(d.NomeCliente)}</small>`).join('<br>')
                : pos.tipo_tml === 'pay_by_link' ? '<span class="ag-pastiglia pastiglia-rossa">pay-by-link senza DDT</span>' : '<span class="testo-tenue">—</span>'}</td>
        </tr>`;
    }).join('');
}

function renderCorrispettivi() {
    const { aggregatiGiornalieri } = state.risultati;
    ui.tbodyCorrispettivi.innerHTML = '';
    const db = Store.getCorrispettivi();

    aggregatiGiornalieri.forEach((gg, idx) => {
        const recordSalvato = db[`${gg.data}_${gg.sedeChr}`] || {};
        const row = document.createElement('tr');
        const idInpElett = `rt_el_${idx}`;
        const idInpCont = `rt_co_${idx}`;
        const idInpNote = `rt_no_${idx}`;
        const idSpnDelta = `spn_delta_${idx}`;

        row.innerHTML = `
            <td>${formatDate(gg.data)}</td>
            <td><strong>${gg.sede}</strong></td>
            <td class="amount">${formatEuro(gg.posTotale)}</td>
            <td class="amount text-nexi">${formatEuro(gg.b2bAbbinati)}</td>
            <td class="amount"><strong>${formatEuro(gg.residuo)}</strong></td>
            <td><input type="number" id="${idInpElett}" class="modern-input" step="0.01" value="${esc(recordSalvato.tot_elettronico ?? '')}" placeholder="0.00"></td>
            <td><strong id="${idSpnDelta}">--</strong></td>
            <td><input type="number" id="${idInpCont}" class="modern-input" step="0.01" value="${esc(recordSalvato.tot_contanti ?? '')}" placeholder="0.00"></td>
            <td><input type="text" id="${idInpNote}" class="modern-input wide" value="${esc(recordSalvato.note || '')}" placeholder="Es. 5G in negozio"></td>
            <td><button class="btn btn-outline" id="btn_save_${idx}"><i class="fa-solid fa-floppy-disk"></i></button></td>
        `;
        ui.tbodyCorrispettivi.appendChild(row);

        const inputElett = document.getElementById(idInpElett);
        const spanDelta = document.getElementById(idSpnDelta);
        const btnSave = document.getElementById(`btn_save_${idx}`);

        const calcDelta = () => {
            const rtEl = parseFloat(inputElett.value) || 0;
            if (rtEl === 0) { spanDelta.innerHTML = '<span class="badge badge-warning">?</span>'; return; }
            const delta = gg.residuo - rtEl;
            spanDelta.innerHTML = Math.abs(delta) <= 0.05
                ? `<span class="badge badge-success"><i class="fa-solid fa-check"></i> ${formatEuro(delta)}</span>`
                : `<span class="badge badge-danger">! ${formatEuro(delta)}</span>`;
        };
        inputElett.addEventListener('input', calcDelta);
        calcDelta();

        btnSave.addEventListener('click', () => {
            const eVal = parseFloat(inputElett.value) || 0;
            const cVal = parseFloat(document.getElementById(idInpCont).value) || 0;
            Store.salvaCorrispettivo({
                data: gg.data, sede: gg.sedeChr,
                tot_elettronico: eVal, tot_contanti: cVal, tot_corrispettivi: eVal + cVal,
                note: document.getElementById(idInpNote).value
            });
            btnSave.classList.replace('btn-outline', 'btn-success');
            setTimeout(() => btnSave.classList.replace('btn-success', 'btn-outline'), 1000);
        });
    });
}

// --- Export Excel ---
function esportaExcel() {
    if (!state.risultati) return;
    const { righe, bonifici, quadraturaNexi, aggregatiGiornalieri, periodo } = state.risultati;
    const corretti = new Set(Store.getCorretti());
    const db = Store.getCorrispettivi();
    const wb = XLSX.utils.book_new();

    const dettaglioIncasso = (r) => {
        const e = r.esito;
        if (!e) return ['', '', (r.indizi || []).join(' | '), '', ''];
        const gruppo = e.gruppo ? ` (insieme a DDT ${e.gruppo.filter(n => n !== r.ddt.NrDoc).join(', ')})` : '';
        if (e.canale === 'POS') {
            return ['POS', formatDate(e.pos.DataParsed),
                `${e.pos.Ora} · ${e.pos.Circuito} · auth ${e.pos.Autorizzazione} · ${nomeSede(e.pos.sede_tml)} ${e.pos.tipo_tml}${gruppo}`,
                e.conf, REGOLE[e.regola] || e.regola];
        }
        return ['Bonifico', formatDate(e.bon.DataParsed), `${e.bon.Ordinante}${e.nota ? ' — ' + e.nota : ''}${gruppo}`, e.conf, REGOLE[e.regola] || e.regola];
    };
    const ordina = (a, b) => a.ddt.Sede.localeCompare(b.ddt.Sede) || a.ddt.DataParsed.localeCompare(b.ddt.DataParsed);
    const colsDdt = [{ wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 40 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 60 }, { wch: 11 }, { wch: 45 }, { wch: 10 }];
    const hDdt = ['N° DDT', 'Sede', 'Data DDT', 'Cliente', 'Importo (€)', 'Pagamento attuale', 'Esito', 'Canale incasso', 'Data incasso', 'Dettaglio incasso', 'Affidabilità', 'Criterio', 'Sistemato'];
    const esitoTesto = r => r.verdetto === 'correggere' ? `Correggere in ${r.correggiIn}` : r.motivo;
    const rigaDdt = r => [r.ddt.NrDoc, nomeSede(r.ddt.Sede), formatDate(r.ddt.DataParsed), r.ddt.Cliente, r.ddt.ImportoConIVA,
        r.ddt.Pagamento, esitoTesto(r), ...dettaglioIncasso(r), corretti.has(r.anomaliaId) ? '✓' : ''];
    const foglio = (nome, aoa, cols) => {
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        if (cols) ws['!cols'] = cols;
        XLSX.utils.book_append_sheet(wb, ws, nome);
    };

    // Riepilogo
    const conta = (id, sede) => {
        const l = righe.filter(categoria(id).test).filter(r => !sede || r.ddt.Sede === sede);
        return [l.length, l.reduce((s, r) => s + r.ddt.ImportoConIVA, 0)];
    };
    const riep = [
        ['VERIFICA PAGAMENTI DDT — Il Magazzino Edile S.r.l.'],
        ['Generato il:', new Date().toLocaleString('it-IT')],
        ['Periodo POS Nexi:', periodo.posMin ? `${formatDate(periodo.posMin)} – ${formatDate(periodo.posMax)}` : '—'],
        ['Periodo estratto BPM:', periodo.bpmCaricato ? `${formatDate(periodo.bpmMin)} – ${formatDate(periodo.bpmMax)}` : 'non caricato'],
        [],
        ['Categoria', 'Ferraris n°', 'Ferraris €', 'Spezia n°', 'Spezia €', 'Totale n°', 'Totale €']
    ];
    for (const c of CATEGORIE.filter(c => c.id !== 'tutti' && c.id !== 'da_sistemare')) {
        riep.push([c.label, ...conta(c.id, 'F'), ...conta(c.id, 'Z'), ...conta(c.id)]);
    }
    riep.push([], ['ANOMALIE CORRISPETTIVI'], ['Data', 'Sede', 'Residuo POS (€)', 'Dichiarato RT el. (€)', 'Delta (€)', 'Stato']);
    aggregatiGiornalieri.forEach(gg => {
        const rec = db[`${gg.data}_${gg.sedeChr}`] || {};
        const rtEl = rec.tot_elettronico !== undefined && rec.tot_elettronico !== '' ? rec.tot_elettronico : null;
        let delta = '', stato;
        if (rtEl === null) stato = '⚠ mancante';
        else { delta = +(gg.residuo - rtEl).toFixed(2); stato = Math.abs(delta) <= 0.02 ? '✓ ok' : `⚠ Δ ${delta}€`; }
        riep.push([formatDate(gg.data), gg.sede, gg.residuo, rtEl ?? '', delta, stato]);
    });
    foglio('Riepilogo', riep, [{ wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 14 }]);

    // Da correggere
    foglio('Da correggere', [hDdt, ...righe.filter(r => r.verdetto === 'correggere').sort(ordina).map(rigaDdt)], colsDdt);

    // Senza incasso
    foglio('Senza incasso', [hDdt, ...righe.filter(r => ['mancante', 'attesa_fattura'].includes(r.verdetto)).sort(ordina).map(rigaDdt)], colsDdt);

    // Tutti i DDT
    foglio('Tutti i DDT', [hDdt, ...[...righe].sort(ordina).map(rigaDdt)], colsDdt);

    // Bonifici
    if (periodo.bpmCaricato) {
        foglio('Bonifici', [
            ['Data', 'Importo (€)', 'Ordinante e causale', 'DDT abbinati', 'Cliente', 'Affidabilità', 'Criterio', 'Note'],
            ...bonifici.map(b => [formatDate(b.mov.DataParsed), b.mov.Importo, b.mov.Ordinante,
                b.ddt.map(d => `${d.NrDoc}/${d.Sede} (${d.Pagamento})`).join(', '),
                b.ddt.length ? b.ddt[0].Cliente : (b.suggerimento ? 'probabile: ' + b.suggerimento : ''),
                b.conf || '', REGOLE[b.regola] || '', b.nota])
        ], [{ wch: 12 }, { wch: 12 }, { wch: 60 }, { wch: 30 }, { wch: 40 }, { wch: 11 }, { wch: 45 }, { wch: 25 }]);

        foglio('Quadratura Nexi', [
            ['Giorno transazioni', 'Sede', 'Circuito', 'Data accredito', 'Accredito banca (€)', 'Transazioni Nexi (€)', 'Differenza (€)'],
            ...quadraturaNexi.map(q => [q.dataTransazioni ? formatDate(q.dataTransazioni) : 'prima del file Nexi', nomeSede(q.sede), q.circuito,
                q.dataAccredito ? formatDate(q.dataAccredito) : 'nessun accredito', q.accredito ?? '', q.totalePos ?? '', q.delta ?? ''])
        ], [{ wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 14 }]);
    }

    // Corrispettivi
    foglio('Corrispettivi', [
        ['Data', 'Sede', 'POS-cassa tot. (€)', 'DDT abbinati (€)', 'Residuo POS (€)', 'Dichiarato RT el. (€)', 'Delta (€)', 'Stato', 'POS 5G (€)', 'Pay-by-link (€)', 'PBL senza DDT (€)', 'Contanti RT (€)', 'Note'],
        ...aggregatiGiornalieri.map(gg => {
            const rec = db[`${gg.data}_${gg.sedeChr}`] || {};
            const rtEl = rec.tot_elettronico !== undefined && rec.tot_elettronico !== '' ? rec.tot_elettronico : '';
            const rtCont = rec.tot_contanti !== undefined && rec.tot_contanti !== '' ? rec.tot_contanti : '';
            let delta = '', stato;
            if (rtEl === '') stato = '⚠ mancante';
            else { delta = +(gg.residuo - rtEl).toFixed(2); stato = Math.abs(delta) <= 0.02 ? '✓ ok' : `⚠ Δ ${delta}€`; }
            return [formatDate(gg.data), gg.sede, gg.posTotale, gg.b2bAbbinati, gg.residuo, rtEl, delta, stato, gg.pos5g, gg.payByLink, gg.pblSenzaDdt, rtCont, rec.note || ''];
        })
    ], [{ wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 10 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 30 }]);

    XLSX.writeFile(wb, `Verifica_pagamenti_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
