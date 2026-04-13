# Antigravity Design System
**Versione:** 1.0
**Stile:** Dark Mode Premium, Glassmorphism leggero, Dati ad alta densità
**Famiglia Applicazioni:** POS, Riconciliazione, Gestione Ordini

Questo documento definisce il linguaggio visivo standard per tutte le applicazioni Antigravity ("same look and feel"). Si raccomanda di utilizzare queste variabili e componenti di base in ogni nuovo progetto per garantire un'identità aziendale coerente, professionale e moderna.

---

## 1. Design Tokens (Variabili CSS)

Tutti i nuovi progetti devono importare questo `root` nel file `index.css` principale. Questi colori sono derivati da una palette armonica progettata specificamente per ridurre l'affaticamento visivo mantenendo un contrasto eccellente per la lettura dei dati.

```css
:root {
  /* ============ BACKGROUNDS ============ */
  --bg: #0f1117;           /* Sfondo principale dell'app (Nero-Bluastro molto scuro) */
  --surface: #1a1d27;      /* Superficie di base (Card principale, sidebar) */
  --surface2: #232735;     /* Superficie secondaria (Hover states, header di tabelle) */
  --surface3: #2c3044;     /* Superficie terziaria (Bottoni secondari scuri) */
  
  /* ============== BORDERS ============== */
  --border: #333850;       /* Bordi standard divisori */
  
  /* ================ TYPOGRAPHY ================ */
  --text: #e8eaf0;         /* Testo primario (Bianco sporco) */
  --text2: #9fa4b8;        /* Testo secondario (Grigio chiaro) */
  --text3: #6b7194;        /* Testo terziario / Placeholder / Muted */
  
  /* ============= BRAND / ACCENT ============= */
  --accent: #f59e0b;       /* Ambra/Arancione primario (Brand principale) */
  --accent2: #fbbf24;      /* Ambra chiaro (Hover states) */
  --accent-bg: rgba(245, 158, 11, 0.08); /* Sfondo accent (Focus ring, Highlight row) */
  
  /* ============ STATUS COLORS ============ */
  --green: #22c55e;        /* Successo, Prezzi, Incassi */
  --green-bg: rgba(34, 197, 94, 0.08);
  --green-border: rgba(34, 197, 94, 0.2);
  
  --red: #ef4444;          /* Errore, Rimozione, Azione Distruttiva */
  --red-bg: rgba(239, 68, 68, 0.08);
  --red-border: rgba(239, 68, 68, 0.25);
  
  --orange: #f97316;       /* Warning, Sconti, Attenzione */
  --orange-bg: rgba(249, 115, 22, 0.1);
  
  /* =============== BORDER RADIUS =============== */
  --radius: 12px;          /* Radius standard per card e modali */
  --radius-sm: 8px;        /* Radius stretto per bottoni e input */
  --radius-full: 9999px;   /* Elementi arrotondati (Pillole, Badge) */
}
```

---

## 2. Tipografia

Combinare l'eleganza di un font sans-serif geometrico con la precisione di un font monospaziato per i dati.

Import link:
```html
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
```

- **Font per Interfaccia (UI, Testi, Label):** `'DM Sans', sans-serif`
- **Font per Codici, Prezzi, Quantità, Partite IVA:** `'JetBrains Mono', monospace`

### Reset Globale Suggerito
```css
html, body {
  height: 100vh;
  height: -webkit-fill-available;
  height: 100dvh;
  font-family: 'DM Sans', sans-serif;
  background: var(--bg);
  color: var(--text);
  overflow: hidden; /* Se stai facendo una web app "app-like" */
}
```

---

## 3. Elementi Base dell'Interfaccia (Componenti)

Queste regole definiscono come rendere i componenti in modo identico all'app POS.

### 3.1 Input Form, Ricerca e Dropdown
Gli input devono essere evidenti con un feedback visivo immediato al `focus` tramite un box-shadow morbido derivato dal colore accent.

```css
.input-standard {
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: 'DM Sans', sans-serif; /* Oppure JetBrains Mono per input numerici */
  font-size: 14px;
  font-weight: 500;
  padding: 12px 16px;
  outline: none;
  transition: border-color .2s, box-shadow .2s;
}

.input-standard:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-bg); /* Glow effect */
}

.input-standard::placeholder {
  color: var(--text3);
}
```

### 3.2 Bottoni (Buttons)
Tre varianti base di bottoni. Utilizzare sempre un `border-radius: var(--radius-sm)` e `font-weight: 600` o `700`.

```css
.btn {
  padding: 10px 16px;
  border-radius: var(--radius-sm);
  border: none;
  cursor: pointer;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all .15s ease-in-out;
}

/* Primario (Azione di Salvataggio, Aggiunta) */
.btn-primary {
  background: var(--accent);
  color: var(--bg);
}
.btn-primary:hover {
  background: var(--accent2);
}

/* Secondario (Annulla, Chiusura Modale, Azioni generiche) */
.btn-secondary {
  background: var(--surface3);
  color: var(--text2);
  border: 1px solid var(--border);
}
.btn-secondary:hover {
  background: var(--border);
  color: var(--text);
}

/* Destruttivo (Elimina, Rimuovi, Reset) */
.btn-danger {
  background: var(--red-bg);
  color: var(--red);
  border: 1px solid var(--red-border);
}
.btn-danger:hover {
  background: rgba(239, 68, 68, 0.15);
}
```

### 3.3 Tabelle Dati (Data Tables)
Le tabelle sono fondamentali nelle app Antigravity. Devono essere dark, pulite e prevedere hover leggeri sulle intere righe. L'uso di `JetBrains Mono` per dati tecnici è obbligatorio.

```css
.table-wrap {
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  overflow-y: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

thead th {
  padding: 8px 12px;
  text-align: left;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text3);
  background: var(--surface2);
  border-bottom: 1px solid var(--border);
  position: sticky; /* Importante per tavole scrollabili */
  top: 0;
  z-index: 2;
}

tbody tr {
  border-bottom: 1px solid rgba(51, 56, 80, 0.3);
  cursor: pointer;
  transition: background .1s;
}

tbody tr:hover {
  background: var(--surface2); /* o var(--accent-bg) per righe cliccabili/attive */
}

tbody td {
  padding: 8px 12px;
  font-size: 12px;
  vertical-align: middle;
}

/* Testo tecnico in tabella  */
.td-mono {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px; /* o 13px per prezzi finali */
}
```

### 3.4 Modali (Overlays & Dialogs)
I modali e i popup devono utilizzare un overlay semi-trasparente e posporre se stessi sopra tutta l'UI con un drop-shadow marcato per creare "profondità".

```css
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px); /* Effetto Glass */
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px; /* Poco più grande dei bottoni */
  padding: 24px;
  width: 90%;
  max-width: 480px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5); /* Ombra importante */
  animation: slideUp .2s ease;
}

@keyframes slideUp {
  from { transform: translateY(16px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
```

### 3.5 Scrollbars Personalizzate
Nelle app desktop-like, nascondere le classiche scrollbar del browser rimpiazzandole con barre dark pulite:

```css
::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}
```

---

## Regole d'oro del Design "Antigravity"

1. **Mai usare Colori generici standard**: Usa SOLO le variabili dalla root. Nessun `color: red` (usa `--red`), nessun `background: #333` (usa `--surface2` o `--border`).
2. **Aura "Tech & Premium"**: Manteniamo sfondi molto scuri (`--bg` #0f1117) spezzati da card leggermente più chiare (`--surface` #1a1d27). Il distacco cromatico dà la gerarchia visiva, i bordi fini marcano i perimetri.
3. **Poche animazioni ma buone**: Un `.15s ease-in-out` sui bottoni (cambio background) o un `.2s slideUp` per far comparire la modale rendono il prodotto "scattante ma morbido".
4. **Allineamento Dati Numerici**: Qualsiasi tabella/listato che mostri prezzi, sconti o codici partita IVA **deve** usare `JetBrains Mono` e **deve** essere allineato a DESTRA per favorire la leggibilità in colonna. I codici prodotto vanno aspramente in mono (allineati a sinistra).
5. **Border Radius**: Mai ad angolo retto (0px). Gli input, bottoni e label usano `--radius-sm` (8px). I blocchi più grandi come le box, le carrellate o le modali usano `--radius` (12px) o 16px.

Se un nuovo progetto Antigravity segue alla lettera questo foglio stile base, sembrerà istantaneamente parte del medesimo ecosistema software a livello visivo e di interaction design.
