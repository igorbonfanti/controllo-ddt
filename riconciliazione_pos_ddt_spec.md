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
| `POS` | Pagamento POS corretto | No |
| `CAS` | Contanti / Cassa | Sì, se esiste transazione POS corrispondente |
| `D` | Rimessa Diretta | Sì, se esiste transazione POS corrispondente |
| `D60` | Rimessa Diretta 60gg | Sì, se esiste transazione POS corrispondente |
| `W30` | Bonifico 30gg | No — pagamento differito, non rilevante per POS |
| `W60` | Bonifico 60gg | No |
| `BB` | Ricevuta Bancaria | No |
| `WI6` | Vari termini bancari | No |
| `W6N`, `W3+`, `W90`, `B30`, `WI9`, `W03` | Vari termini bancari | No |

**Codici da verificare contro POS** (costante `NON_POS_PAG`):
```
CAS, D, D60, W30, W60, BB, WI6, W6N, W3+, W90, B30, WI9, W03
```

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

Il matching abbina ogni DDT a una transazione POS sulla base di **data esatta + importo IVA inclusa** (tolleranza ±€0,02 per arrotondamenti).

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
