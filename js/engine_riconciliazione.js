// Motore logico di riconciliazione

window.NON_POS_PAG = ['CAS', 'D', 'D60', 'W30', 'W60', 'BB', 'WI6', 'W6N', 'W3+', 'W90', 'B30', 'WI9', 'W03'];

window.eseguiRiconciliazione = function eseguiRiconciliazione(listaDdt, listaPos) {
    console.log(`Inizio riconciliazione: ${listaDdt.length} DDT, ${listaPos.length} POS`);
    
    let anomalieDaCorreggere = []; // DDT B2B segnati errati ma incassati POS
    let posUsatiUid = new Set();
    
    // Raggruppiamo i POS per facilitare la ricerca
    const posDisponibili = [...listaPos];

    // Passaggio 1: Troviamo TUTTI i match DDT <-> POS
    // Questo è vitale per capire quali POS sono B2B
    for (let ddt of listaDdt) {
        
        // Cerchiamo un POS corrispondente (stessa data, importo tolleranza 0.02)
        let bestMatchIndex = -1;
        for (let i = 0; i < posDisponibili.length; i++) {
            let pos = posDisponibili[i];
            
            // Check se lo abbiamo già usato
            if (posUsatiUid.has(pos._uid)) continue;
            
            // Regola Matching: Data uguale e Importo corrispondente (tolleranza 2 cent)
            if (pos.DataParsed === ddt.DataParsed && pos.sede_tml === ddt.Sede) {
                const diff = Math.abs(pos.Importo - ddt.ImportoConIVA);
                if (diff <= 0.02) {
                    bestMatchIndex = i;
                    break;
                }
            }
        }

        if (bestMatchIndex !== -1) {
            let posMatchato = posDisponibili[bestMatchIndex];
            posUsatiUid.add(posMatchato._uid);
            
            // Se questo DDT era registrato con "CAS" o "D" (non POS), è un'anomalia da correggere in contabilità
            if (NON_POS_PAG.includes(ddt.Pagamento)) {
                anomalieDaCorreggere.push({
                    ddt: ddt,
                    pos: posMatchato,
                    anomaliaId: `${ddt.NrDoc}_${ddt.DataParsed}_${ddt.Sede}`
                });
            }
        }
    }

    // Passaggio 2: Calcolo aggregati giornalieri (Corrispettivi)
    // Filtriamo il calendario ai soli giorni in cui abbiamo DDT (come da specifiche)
    const giorniDdt = [...new Set(listaDdt.map(d => d.DataParsed))].sort();
    let corrispettiviGiornalieri = [];

    const sedi = ['F', 'Z'];

    for (let giorno of giorniDdt) {
        for (let sede of sedi) {
            const sedeName = sede === 'F' ? 'Ferraris' : 'Spezia';
            
            // POS-Cassa totali della giornata
            const posGiornoCassa = listaPos.filter(p => p.DataParsed === giorno && p.sede_tml === sede && p.tipo_tml === 'pos_cassa');
            const incassoTotalePOS = posGiornoCassa.reduce((sum, p) => sum + p.Importo, 0);

            // POS B2B Abbinati
            const posAbbinati = posGiornoCassa.filter(p => posUsatiUid.has(p._uid));
            const incassoB2B = posAbbinati.reduce((sum, p) => sum + p.Importo, 0);

            // Residuo privarti (da battere al RT)
            const residuoPOS = incassoTotalePOS - incassoB2B;

            corrispettiviGiornalieri.push({
                data: giorno,
                sedeChr: sede,
                sede: sedeName,
                posTotale: incassoTotalePOS,
                b2bAbbinati: incassoB2B,
                residuo: residuoPOS
            });
        }
    }

    return {
        anomalie: anomalieDaCorreggere,
        aggregatiGiornalieri: corrispettiviGiornalieri
    };
}
