# Specifica: Applicazione Riconciliazione POS / DDT
## Il Magazzino Edile S.r.l. — Due sedi operative a Milano

---

## 1. Contesto operativo

Il Magazzino Edile è un rivenditore di materiali edili con due punti vendita a Milano:
- **Via Ferraris** (sede principale)
- **Via Spezia** (seconda sede)

Il 90% degli incassi POS riguarda clienti B2B (imprese edili, artigiani) che ricevono un DDT per ogni consegna. I DDT vengono poi raggruppati in una **fattura elettronica cumulativa mensile** per cliente. La quota restante degli incassi POS riguarda privati che ricevono uno scontrino fiscale dal registratore telematico.

L'applicazione serve a:
1. Trovare i DDT registrati con modalità di pagamento errata (es. CAS, D) per i quali esiste un incasso POS corrispondente → da correggere in contabilità
2. Calcolare il residuo POS giornaliero per sede (totale POS − incassi B2B abbinati) e confrontarlo con i corrispettivi dichiarati dalla chiusura del registratore telematico

---

## 2. Architettura terminali POS

Ogni sede dispone di tre terminali Nexi con ruoli distinti:

| Terminal ID | Sede | Tipo | Descrizione |
|---|---|---|---|
| `85028845` | Via Ferraris | `pos_cassa` | POS fisico integrato con il Registratore Telematico. Batte scontrini per privati E incassa DDT B2B. È lo stesso dispositivo fisico del registratore di cassa. |
| `85074555` | Via Ferraris | `pos_5g` | POS mobile 5G, usato raramente (~1 volta/mese) come backup quando manca connettività WiFi, o occasionalmente in cantiere. NON collegato al Registratore Telematico. |
| `85074088` | Via Ferraris | `pay_by_link` | Pay-by-link Nexi inviato via email al cliente per pagamenti remoti. Appare come "E-commerce" nell'export Nexi. Sempre e solo B2B con DDT. |
| `85028787` | Via Spezia | `pos_cassa` | Idem Ferraris — POS integrato con Registratore Telematico della sede. |
| `85074547` | Via Spezia | `pos_5g` | POS mobile 5G backup. Stessa logica del 85074555. |
| `85072084` | Via Spezia | `pay_by_link` | Pay-by-link Nexi per la sede di Via Spezia. |

**Regole operative sui terminali:**
- Il `pos_cassa` di ogni sede gestisce sia clienti B2B che privati sullo stesso dispositivo
- Il `pos_5g` non genera scontrino automatico → ogni sua transazione deve essere classificata manualmente (DDT B2B, scontrino emesso manualmente, o cantiere senza corrispettivo)
- Il `pay_by_link` genera sempre e solo incassi B2B con DDT → se non trova un DDT abbinato è un'anomalia
- I terminali `pos_5g` e `pay_by_link` non contribuiscono ai corrispettivi del Registratore Telematico

---

## 3. File di input

### 3.1 File DDT — export da Zucchetti Gestionale 2

**Formato:** `.xls` (legacy Excel, richiedono engine `xlrd`) o `.xlsx`  
**Periodicità:** Settimanale — contiene solo i DDT del periodo da riconciliare  
**Struttura colonne** (le colonne "Unnamed" sono artefatti dell'export Zucchetti):

| Colonna | Nome interno | Contenuto |
|---|---|---|
| A | `Prog.` | Numero progressivo interno Zucchetti (es. `73073316`) |
| B | `Cod./Descrizione documento` | Tipo documento: `DE1` = DDT Via Spezia, `DE2` = DDT Via Ferraris |
| C | `Unnamed: 2` | Sempre `DDT Fattura Elettronica` |
| D | `Nr. doc.` | **Numero DDT** — campo chiave per l'operatore (es. `521`, `1043`) |
| E | `Unnamed: 4` | **Sede**: `F` = Via Ferraris, `Z` = Via Spezia |
| F | `Data doc.` | **Data DDT** formato `DD/MM/YYYY` |
| G | `Num. fattura` | Numero fattura se già fatturato, `NaN` se non ancora fatturato |
| H | `Unnamed: 7` | Sezionale fattura (es. `0C0`) |
| I | `Data fattura` | Data fattura se emessa |
| J | `Pagamento` | **Modalità di pagamento registrata** — campo centrale della riconciliazione |
| K | `Importo senza IVA` | Imponibile — formato italiano con virgola decimale nelle versioni `.xls` |
| L | `Importo con IVA` | **Importo totale IVA inclusa** — usato per il matching con il POS |
| M | `Unnamed: 12` | **Cliente** in formato `Cliente: CODICE - NOME COMPLETO CITTÀ` |

**Codici pagamento rilevanti:**

| Codice | Significato | Da correggere? |
|---|---|---|
| `POS` | Carta di credito o bancomat | Sì, in BB se in realtà pagato con bonifico |
| `BB`, `B30`, `B60` | Bonifico (immediato o a 30/60 gg) | Sì, in POS se in realtà pagato al POS |
| `CAS` | Contanti o assegno | Sì, se esiste un POS o un bonifico corrispondente |
| `D`, `D60` | Rimessa diretta: può essere pagata con POS o con bonifico | Sì, in POS o BB secondo l'incasso trovato |
| `W30`, `W60`, `W90`, `WI6`, `W6N`, `W3+`, `WI9`, `W03` | RiBa: percorso a parte (presentazione effetti) | Solo con prova forte di un POS o bonifico |

**Note di parsing:**
- Le ultime righe del file contengono totali e piè di pagina — filtrare includendo solo righe dove `Unnamed: 4` è `F` o `Z`
- Gli importi nelle versioni `.xls` usano la virgola come separatore decimale e il punto come separatore delle migliaia (es. `1.062,49`) → rimuovere punti, sostituire virgola con punto
- Il campo `Unnamed: 12` va pulito rimuovendo il prefisso `Cliente: `
- Il codice cliente è la parte prima del primo ` - `, il nome è il resto

### 3.2 File POS — export da Nexi (portale transazioni)

**Formato:** `.xlsx` (con intestazione estesa su righe 1-3, header effettivo alla riga 4) o `.csv` (separatore `;`, decimali con virgola)  
**Periodicità:** Può coprire un periodo più ampio dei DDT — la riconciliazione usa **solo il range di date presente nei DDT caricati**  
**Contenuto:** Un singolo file può contenere tutti e 6 i terminali insieme

**Rilevamento header `.xlsx`:** Le prime righe contengono titolo e intestazioni. L'header effettivo è la prima riga che contiene sia `Data` che `Importo` tra i valori non-null. Rilevare dinamicamente scorrendo le prime 10 righe.

**Struttura colonne:**

| Colonna | Contenuto |
|---|---|
| `Data` | Data transazione formato `DD.MM.YYYY` |
| `Ora` | Ora transazione `HH:MM:SS` |
| `N° autorizzazione` | Codice autorizzazione (stringa — può contenere lettere: `R72257`, `H25286`) |
| `Numero Carta/Conto corrente` | Ultime 4 cifre carta (intero) |
| `Importo` | Importo transazione — punto decimale in xlsx, virgola in csv |
| `Stato transazione` | `Autorizzato`, `Contabilizzato`, `Rifiutato` |
| `Canale` | `Pos` (fisica) o `E-commerce` (pay-by-link) |
| `Circuito` | `VISA`, `MASTERCARD`, `BANCOMAT`, `AMEX` |
| `TERMINAL ID (TML)` | **ID terminale** — chiave per identificare sede e tipo |
| `Numero ordine` | Per pay-by-link: formato `APIBO_YYYYMMDDHHMMSS` |

**Regole di caricamento:**
- Escludere sempre le transazioni con `Stato transazione == 'Rifiutato'`
- Aggiungere colonne derivate `sede_tml` e `tipo_tml` mappando `TERMINAL ID (TML)` alla tabella terminali
- Aggiungere colonna `_uid` = `N° autorizzazione + '|' + Data + '|' + Importo` — identificatore univoco stabile per il tracking dei match (immune a reset_index e concat di DataFrame)

---

## 4. Logica di riconciliazione

### 4.1 Matching DDT ↔ POS

Il matching abbina ogni DDT a una transazione POS sulla base di **data esatta + importo IVA inclusa, al centesimo**.

**Importo del DDT stampato (v2.3):** la colonna `Importo con IVA` dell'export Zucchetti somma le righe già arrotondate una per una. Il DDT stampato invece calcola l'IVA sul totale: `imponibile × 1,22` arrotondato. I due valori differiscono di 1-2 centesimi in circa 1 DDT su 5, e il cliente paga la cifra stampata. L'app confronta POS e bonifici con entrambi i valori, al centesimo. Se lo scarto supera 0,05 € (IVA non tutta al 22%) si usa solo il valore dell'export. Sui dati di settembre 2026 tutti i 287 abbinamenti POS risultano esatti al centesimo. Resta una tolleranza di ±0,02 € solo per il POS dello stesso giorno e della stessa sede; in tutti gli altri casi (altro giorno, altra sede, pagamento anticipato) il POS deve essere esatto.

**Algoritmo:**
```
per ogni DDT nel sottoinsieme da processare:
    cerca transazioni POS dove:
        - data_pos == data_ddt (stesso giorno)
        - |importo_pos - importo_ddt_iva| <= 0.02
        - transazione non già usata in questo match (_uid non in pos_used)
    se trovata:
        prendi la prima candidata
        marca il suo _uid come usato
        aggiungi alla lista match
```

**Punto critico — uso dello `_uid`:**  
Non usare mai l'indice del DataFrame per tracciare i match. Gli indici cambiano quando si concatenano file o si resettano. Usare sempre `_uid` (stringa costruita su auth + data + importo) che rimane stabile.

**Due passaggi distinti:**

**Passaggio A — Lista DDT da correggere:**
- Filtra DDT con `Pagamento in NON_POS_PAG` (CAS, D, ecc.)
- Abbina al POS della stessa sede
- Output: lista di DDT da correggere in contabilità con dettaglio transazione POS abbinata

**Passaggio B — Abbinati B2B per corrispettivi:**
- Usa **tutti** i DDT (inclusi quelli già con `Pagamento == POS`)
- Serve per sapere quante transazioni POS-cassa giornaliere sono B2B
- Output: set di `_uid` di tutte le transazioni POS abbinate a qualsiasi DDT

### 4.1-bis Verifica pagamenti a due livelli (v2)

Da v2.0 l'app (statica, `js/engine_riconciliazione.js`) verifica ogni DDT in entrambe le direzioni, su POS Nexi e su bonifici dall'estratto conto Banco BPM (`MovimentiCC_OnLine_*.csv`, facoltativo).

**Estratto conto BPM** (`js/parser_bpm.js`): si leggono solo le entrate. Descrizione `bon.da <ordinante> <causale>` = bonifico cliente. `nexi payments` e `american express` sono accrediti POS, esclusi dal matching. Causali 292/293 = RiBa. Gli accrediti Bancomat Nexi (`pv <n> accredito bancomat DDMMYY`) servono per quadrare il file Nexi: PV `1000001535691` = Ferraris, `1000001535664` = Spezia.

**Passaggi di abbinamento** (dal più affidabile; un DDT o un incasso già abbinato non viene più riconsiderato):

| # | Criterio | Affidabilità |
|---|---|---|
| 1 | La causale del bonifico cita il n° DDT (`ddt 2376-z`, `ddt 4230/f`) | alta (media se l'importo differisce) |
| 2 | POS stesso giorno, stessa sede, stesso importo | alta |
| 3 | Ordinante = cliente e stesso importo, bonifico da 7 gg prima a 90 gg dopo il DDT | alta |
| 4 | POS stesso giorno, altra sede | media |
| 5 | POS stessa sede, da 3 gg prima a 10 gg dopo (solo DDT con codice POS) | media |
| 5-bis | POS stessa sede fino a 30 gg prima del DDT: pagamento anticipato (solo DDT con codice POS) | media |
| 6 | Ordinante = cliente, bonifico pari alla somma di 2–6 DDT | alta fino a 3 DDT, poi media |
| 7 | Più DDT dello stesso cliente e giorno pagati con una transazione POS | media |
| 8 | POS in finestra di date per DDT con altro codice (esclusi i `W..` RiBa) | bassa |
| 9 | Bonifico con solo l'importo uguale e un unico DDT candidato (esclusi i `W..` RiBa) | media se il DDT è `B..`, altrimenti bassa |

Passaggi aggiuntivi per la fattura cumulativa mensile:
- dopo il n° DDT: la causale cita un numero fattura (`fatt.`, `ft.`, `fattura nr.`) presente nella colonna `Num. fattura` dei DDT dello stesso cliente → alta;
- dopo il passaggio 6: bonifico arrivato da fine mese in poi, pari al totale dei DDT del cliente di quel mese non già pagati (esclusi `POS`, `CAS`, RiBa) → alta.

**Scadenza bonifici e rimesse dirette:** i clienti a bonifico e a rimessa diretta pagano "fine mese data fattura". Data fattura = colonna `Data fattura` del DDT se già fatturato, altrimenti fine mese della data DDT. Scadenza = fine mese di (data fattura + 0/30/60 gg per `BB`, `D` / `B30` / `B60`, `D60`).

**Indizi per i DDT `POS` senza transazione** (non sono abbinamenti, solo piste mostrate accanto al DDT):
- pagamento misto: POS non abbinato dello stesso giorno e sede, con resto in cifra tonda (multiplo di 5 €) presumibilmente in contanti;
- carta del cliente: POS non abbinato fatto con una carta (ultime 4 cifre) già usata dal cliente per altri DDT;
- pagato insieme ad altri DDT dello stesso cliente (anche resi) entro 5 gg: POS non abbinato pari alla somma;
- stesso importo già abbinato a un altro DDT: possibile DDT doppio o cliente scambiato;
- nessuna delle precedenti: "nessuna traccia né nel file Nexi né in banca", probabilmente contanti o non pagato.

**Completezza del file Nexi:** in cima alla verifica un avviso dice se tutti gli accrediti Nexi in banca quadrano con il file. Se qualcuno non quadra, indica sede, giorno e differenza: i "POS senza transazione" potrebbero essere falsi allarmi e conviene riesportare da Nexi.

**Storni Nexi:** uno storno compare come riga `Stornata` accanto alla riga originale `Contabilizzata` con la stessa autorizzazione. Si scartano entrambe.

**Quadratura accrediti Nexi:** Nexi accredita al lordo un bonifico per sede e per giorno di transazioni. Bancomat: il giorno è nella descrizione. Visa/Mastercard (`accredito internaz. e apm`): si cerca il giorno con lo stesso totale nei 7 giorni precedenti. Amex accredita a parte.

Ordinante = cliente: la prima parola distintiva della ragione sociale (senza SRL, EDIL, città…) compare nella descrizione del bonifico, oppure ci compaiono almeno metà delle parole distintive.

**Esiti:**

| Codice DDT | Trovato POS | Trovato bonifico | Nessun incasso |
|---|---|---|---|
| `POS` | ok | correggere in BB | POS senza transazione (se il DDT è nel periodo Nexi) |
| `BB`, `B30`, `B60` | correggere in POS | ok | attesa pagamento fine mese data fattura; "fattura scaduta non pagata" 10 gg dopo la scadenza |
| `D`, `D60` | correggere in POS | correggere in BB | come i bonifici: attesa pagamento fine mese data fattura (`D60` = +60 gg), poi "fattura scaduta non pagata" |
| `CAS` | correggere in POS | correggere in BB | nessun riscontro (contanti o assegno, atteso) |
| `W..` RiBa | correggere in POS | correggere in BB | RiBa, percorso a parte |

### 4.2 Calcolo residuo corrispettivi

Per ogni giorno nel range del DDT e per ogni sede:

```
POS-cassa totale giorno
  = somma Importo dove data==giorno AND sede==X AND tipo_tml=='pos_cassa'

POS abbinati B2B
  = somma Importo delle transazioni pos_cassa il cui _uid è in all_used_uid

Residuo POS
  = POS-cassa totale - POS abbinati B2B
  → questa è la quota "privati/scontrino" da confrontare con la chiusura RT

POS 5G giorno
  = somma Importo dove data==giorno AND sede==X AND tipo_tml=='pos_5g'
  → eventi rari, classificare manualmente

Pay-by-link giorno
  = somma Importo dove data==giorno AND sede==X AND tipo_tml=='pay_by_link'
  → deve sempre trovare un DDT; se residuo > 0 è anomalia
```

**Confronto con chiusura RT:**
```
delta = Residuo POS − Totale elettronico dichiarato dall'operatore

delta == 0  → tutto quadra
delta > 0   → ci sono transazioni POS non spiegate né da DDT né da scontrino
delta < 0   → il RT dichiara più elettronico di quanto risulta dal POS
              (possibile: POS 5G usato in negozio quel giorno, non nel file Nexi)
```

**Filtro date:** La tabella corrispettivi mostra **solo** i giorni nel range `[min(date DDT), max(date DDT)]`. Se il file POS copre mesi precedenti, quei giorni non vengono mostrati.

---

## 5. Storico corrispettivi

I dati di chiusura RT vengono inseriti manualmente dall'operatore il giorno successivo alla chiusura (o anche dopo, uno alla volta). Vengono salvati in un file `corrispettivi_storico.json` locale nella stessa cartella dell'applicazione.

**Struttura record:**
```json
{
  "sede": "Ferraris",
  "data": "2026-03-24",
  "data_label": "24/03/2026",
  "tot_corrispettivi": 450.50,
  "tot_elettronico": 380.20,
  "tot_contanti": 70.30,
  "note": "POS 5G usato come backup ore 11",
  "inserito_il": "2026-03-25T09:14:22",
  "ins_label": "25/03 09:14"
}
```

**Regole:**
- Chiave univoca: `(sede, data)` — se si reinserisce la stessa sede+data, sovrascrive
- I record vengono ordinati per `data, sede`
- La riconciliazione settimanale incrocia questo storico con il range date del DDT caricato
- Il file JSON è persistente tra una sessione e l'altra

---

## 6. Output — Report Excel

Il file Excel generato contiene 4 fogli:

### Foglio 1: Riepilogo
- Conteggio DDT da correggere per sede (Ferraris / Spezia)
- Importo totale
- Lista anomalie corrispettivi (delta ≠ 0 o chiusure RT mancanti)

### Foglio 2: Ferraris — DDT da correggere
Colonne: N° DDT, Sede, Data DDT, Cliente, Importo (€), Pagamento attuale, Correggere in, POS Data, POS Ora, POS N° Auth, POS Circuito, Corretto (spunta manuale)

### Foglio 3: Spezia — DDT da correggere
Stessa struttura del foglio Ferraris.

### Foglio 4: Corrispettivi & POS residuo
Una riga per ogni combinazione giorno/sede nel periodo. Colonne:
Data, Sede, POS-cassa tot., DDT abbinati, Residuo POS, Dichiarato RT (el.), Delta, Stato, POS 5G, Pay-by-link, PBL senza DDT, Contanti RT, Note

**Stato:** `✓ ok` (delta ≤ 0.02), `⚠ Δ +X.XX€` (delta > 0), `⚠ mancante` (nessun inserimento RT per quel giorno)

---

## 7. Architettura applicazione web (Flask)

```
app_v2.py                    # file unico, tutto incluso
corrispettivi_storico.json   # creato automaticamente al primo inserimento
avvia.bat                    # launcher Windows con auto-install dipendenze
```

**Stack:** Python 3.x + Flask + pandas + openpyxl + xlrd  
**Porta:** 5000  
**Accesso:** http://localhost:5000 (o http://IP-SERVER:5000 in LAN)

### Endpoints

| Route | Metodo | Descrizione |
|---|---|---|
| `/` | GET | Serve l'HTML completo (single-page app) |
| `/api/riconcilia` | POST | Riceve DDT + POS (multipart/form-data), esegue la riconciliazione, restituisce JSON |
| `/api/scarica` | GET | Scarica l'ultimo Excel generato (cache in memoria) |
| `/api/corrispettivi` | POST | Salva un record di chiusura RT (JSON body) |
| `/api/storico` | GET | Restituisce lo storico filtrato (query params: `sede`, `mese`) |
| `/api/storico/<idx>` | DELETE | Elimina un record dallo storico |
| `/api/storico/csv` | GET | Esporta lo storico completo in CSV |

### Struttura HTML (single-page, 3 tab)

**Tab 1 — Riconciliazione:**
- 3 zone drag & drop: DDT (.xls/.xlsx), POS principale (.xlsx), POS opzionale (.xlsx/.csv)
- Pulsante "Avvia" attivo solo quando DDT + POS sono caricati
- Barra progresso a 5 step
- Risultati: stats (n DDT Ferraris, n DDT Spezia, importo totale), tabelle DDT per sede, tabella corrispettivi giornaliera
- Pulsante download Excel

**Tab 2 — Corrispettivi:**
- Form: sede (select), data (date picker), totale corrispettivi, di cui elettronico, di cui contanti, note
- Controllo live: verifica che elettronico + contanti = totale mentre si digita
- Salva con POST a `/api/corrispettivi`

**Tab 3 — Storico:**
- Tabella di tutti i record con filtri per sede e mese
- Pulsante elimina per record singolo
- Export CSV

---

## 8. Casi edge e gestione errori

**Formato importi DDT (.xls):** `1.062,49` → rimuovere `.`, sostituire `,` con `.` → `1062.49`

**Header POS variabile:** Alcuni export Nexi xlsx hanno righe vuote prima dell'header. Rilevare la riga header cercando la prima riga che contiene sia `Data` che `Importo`.

**Doppio file POS (concat):** Dopo `pd.concat([pos1, pos2], ignore_index=True)` gli indici cambiano. Rigenerare `_uid` dopo il concat.

**Data DDT vs data POS:** DDT usa formato `DD/MM/YYYY`, POS usa `DD.MM.YYYY`. Normalizzare entrambi a `YYYY-MM-DD` per i confronti.

**POS con più mesi:** Il file POS può contenere dati da gennaio mentre i DDT coprono solo marzo. Filtrare la tabella corrispettivi al range `[min_data_ddt, max_data_ddt]`.

**Stessa sede+data nei corrispettivi:** Il secondo inserimento sovrascrive il primo (comportamento "upsert").

**Pay-by-link senza DDT:** Segnalare come anomalia — il cliente ha pagato un link ma non esiste DDT corrispondente. Può indicare un pagamento non registrato nel gestionale.

**POS 5G:** Evento raro. Le sue transazioni appaiono nel residuo giornaliero. L'operatore le classifica manualmente usando le note nel form corrispettivi.

---

## 9. Dipendenze Python

```
flask>=3.0
pandas>=2.0
openpyxl>=3.1
xlrd>=2.0.1        # necessario per file .xls legacy Zucchetti
```

Installazione:
```bash
pip install flask pandas openpyxl xlrd
```
