// Esegue parser e motore sui file in ../dati (fuori dal repository: contengono dati reali).
// Uso: node test/verifica.js [cartella-dati]
const fs = require('fs');
const path = require('path');
const XLSX = require(path.resolve(__dirname, '../../dati/node_modules/xlsx'));
globalThis.XLSX = XLSX;
const U = require('../js/util.js');
const { parseDDTRows } = require('../js/parser_ddt.js');
const { parsePOSRows } = require('../js/parser_pos.js');
const { parseBPMRows } = require('../js/parser_bpm.js');
const { eseguiRiconciliazione } = require('../js/engine_riconciliazione.js');

const dir = process.argv[2] || path.resolve(__dirname, '../../dati');
const righe = f => U.righeDaBuffer(new Uint8Array(fs.readFileSync(path.join(dir, f))), f, XLSX);

const ddt = parseDDTRows(righe('ddt.xls'));
const pos = parsePOSRows(righe(process.env.NEXI || 'nexi.csv'));
const bpm = parseBPMRows(righe('bpm.csv'));
console.log(`DDT ${ddt.length} | POS ${pos.length} (scartate ${JSON.stringify(pos.scartate)}) | BPM ${bpm.length}`);

const r = eseguiRiconciliazione(ddt, pos, bpm);
const conta = {};
r.righe.forEach(x => { const k = `${x.verdetto}${x.correggiIn ? '→' + x.correggiIn : ''}`; conta[k] = (conta[k] || 0) + 1; });
console.log(conta, r.periodo);

const fmt = x => `${x.ddt.Sede} ${x.ddt.NrDoc.padStart(5)} ${x.ddt.DataParsed} ${x.ddt.Pagamento.padEnd(4)} ${x.ddt.ImportoConIVA.toFixed(2).padStart(8)} ${x.ddt.NomeCliente.slice(0, 28).padEnd(28)}`;
const ev = (e, x) => !e ? x.motivo : e.canale === 'POS'
    ? `POS ${e.pos.DataParsed} ${e.pos.Ora} ${e.pos.sede_tml} [${e.conf} ${e.regola}]${e.gruppo ? ' gruppo ' + e.gruppo : ''}`
    : `BON ${e.bon.DataParsed} "${e.bon.Ordinante.slice(0, 40)}" [${e.conf} ${e.regola}]${e.gruppo ? ' gruppo ' + e.gruppo : ''} ${e.nota}`;
for (const v of ["correggere", "mancante", "attesa_fattura"]) {
    console.log(`\n== ${v}`);
    r.righe.filter(x => x.verdetto === v).forEach(x => console.log(fmt(x), x.correggiIn || '', ev(x.esito, x)));
}
console.log('\n== bonifici');
r.bonifici.forEach(b => console.log(b.mov.DataParsed, b.mov.Importo.toFixed(2).padStart(8), b.mov.Ordinante.slice(0, 45).padEnd(45), b.ddt.length ? b.ddt.map(d => d.NrDoc + d.Sede).join(',') + ` [${b.conf} ${b.regola}] ${b.nota}` : '-- ' + b.suggerimento));
console.log('\n== quadratura bancomat');
r.quadraturaNexi.filter(q => q.delta !== 0).forEach(q => console.log(q.circuito, q.dataTransazioni, q.dataAccredito, q.sede, q.accredito, q.totalePos, q.delta)); console.log('quadrature a zero:', r.quadraturaNexi.filter(q => q.delta === 0).length);
