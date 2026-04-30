// Motore logico di riconciliazione

window.NON_POS_PAG = ['CAS', 'D', 'D60', 'W30', 'W60', 'BB', 'WI6', 'W6N', 'W3+', 'W90', 'B30', 'WI9', 'W03'];
const ANOMALIA_PAG = ['CAS', 'D', 'D60'];

window.eseguiRiconciliazione = function eseguiRiconciliazione(listaDdt, listaPos) {
    console.log(`Inizio riconciliazione v2: ${listaDdt.length} DDT, ${listaPos.length} POS`);

    let anomalieDaCorreggere = [];
    let posUsatiUid = new Set();

    function trovaPosMatch(ddt) {
        for (let pos of listaPos) {
            if (posUsatiUid.has(pos._uid)) continue;
            if (pos.DataParsed !== ddt.DataParsed) continue;
            if (pos.sede_tml !== ddt.Sede) continue;
            if (Math.abs(pos.Importo - ddt.ImportoConIVA) <= 0.02) return pos;
        }
        return null;
    }

    // PRE-PASS: riserva le transazioni POS già associate a DDT corretti (Pagamento=POS).
    // Deve girare prima della ricerca anomalie: se un DDT con Pagamento=POS
    // e uno con Pagamento=D hanno lo stesso importo nella stessa giornata,
    // esiste un'unica transazione POS e appartiene al DDT già corretto.
    for (let ddt of listaDdt) {
        if (ddt.Pagamento === 'POS') {
            const match = trovaPosMatch(ddt);
            if (match) posUsatiUid.add(match._uid);
        }
    }

    // PASS ANOMALIE: cerca solo DDT con pagamento immediato mal classificato (CAS, D, D60).
    // I termini bancari/differiti (W30, W60, BB ecc.) sono esclusi.
    for (let ddt of listaDdt) {
        if (!ANOMALIA_PAG.includes(ddt.Pagamento)) continue;
        const match = trovaPosMatch(ddt);
        if (match) {
            posUsatiUid.add(match._uid);
            anomalieDaCorreggere.push({
                ddt: ddt,
                pos: match,
                anomaliaId: `${ddt.NrDoc}_${ddt.DataParsed}_${ddt.Sede}`
            });
        }
    }

    // PASSAGGIO 2: calcolo aggregati giornalieri corrispettivi (invariato).
    const giorniDdt = [...new Set(listaDdt.map(d => d.DataParsed))].sort();
    let corrispettiviGiornalieri = [];

    for (let giorno of giorniDdt) {
        for (let sede of ['F', 'Z']) {
            const sedeName = sede === 'F' ? 'Ferraris' : 'Spezia';
            const posGiornoCassa = listaPos.filter(p =>
                p.DataParsed === giorno && p.sede_tml === sede && p.tipo_tml === 'pos_cassa'
            );
            const incassoTotalePOS = posGiornoCassa.reduce((s, p) => s + p.Importo, 0);
            const incassoB2B       = posGiornoCassa.filter(p => posUsatiUid.has(p._uid)).reduce((s, p) => s + p.Importo, 0);
            corrispettiviGiornalieri.push({
                data:        giorno,
                sedeChr:     sede,
                sede:        sedeName,
                posTotale:   incassoTotalePOS,
                b2bAbbinati: incassoB2B,
                residuo:     incassoTotalePOS - incassoB2B
            });
        }
    }

    console.log(`Riconciliazione completata: ${anomalieDaCorreggere.length} anomalie trovate.`);
    return { anomalie: anomalieDaCorreggere, aggregatiGiornalieri: corrispettiviGiornalieri };
}
