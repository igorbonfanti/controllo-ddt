// Gestore del salvataggio Locale (LocalStorage)
// Facilmente rimpiazzabile con Firebase in futuro

const STORE_KEYS = {
    CORRISPETTIVI: 'app_corrispettivi_storico',
    CORRETTI: 'app_ddt_corretti'
};

window.Store = {
    // --- Corrispettivi ---
    getCorrispettivi() {
        try {
            const data = localStorage.getItem(STORE_KEYS.CORRISPETTIVI);
            return data ? JSON.parse(data) : {}; // Struttura: { "YYYY-MM-DD_SEDE": { data:..., tot:..., ... } }
        } catch {
            return {};
        }
    },

    salvaCorrispettivo(record) {
        // record richiede: sede, data, tot_corrispettivi, tot_elettronico, tot_contanti, note
        const data = this.getCorrispettivi();
        const key = `${record.data}_${record.sede}`;
        
        data[key] = {
            ...record,
            inserito_il: new Date().toISOString()
        };
        
        localStorage.setItem(STORE_KEYS.CORRISPETTIVI, JSON.stringify(data));
        return true;
    },

    // --- DDT Corretti/Archiviati ---
    // Salviamo semplicemente gli _uid associati al match (oppure i numeri DDT)
    getCorretti() {
        try {
            const data = localStorage.getItem(STORE_KEYS.CORRETTI);
            return data ? JSON.parse(data) : []; // Array di "NUMDDT_DATA_SEDE"
        } catch {
            return [];
        }
    },

    marcaComeCorretto(ddtId) {
        const corretti = this.getCorretti();
        if (!corretti.includes(ddtId)) {
            corretti.push(ddtId);
            localStorage.setItem(STORE_KEYS.CORRETTI, JSON.stringify(corretti));
        }
    },

    rimuoviCorretto(ddtId) {
        let corretti = this.getCorretti();
        corretti = corretti.filter(id => id !== ddtId);
        localStorage.setItem(STORE_KEYS.CORRETTI, JSON.stringify(corretti));
    }
};
