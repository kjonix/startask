# Stepster ⭐

> **Din venn i hverdagen** — En webapp som hjelper barn å komme seg gjennom dagens gjøremål med stjerner, nedtelling og trafikklys.

---

## Arkitektur

```
Bruker (nettleser)
    │
    ├── Azure Static Web Apps          ← index.html, om.html, mascot.png
    │   https://stepster.no
    │   (auto-deploy fra GitHub)
    │
    └── Azure Functions                ← api/index.js
        https://startask-api-gcb3cke7bagha3fu.norwayeast-01.azurewebsites.net/api/api
        (manuell deploy via PowerShell)
```

### Azure-ressurser

| Ressurs | Navn | URL |
|---|---|---|
| Static Web App | delightful-plant-0e81d7203 | https://stepster.no |
| Function App | startask-api | https://startask-api-gcb3cke7bagha3fu.norwayeast-01.azurewebsites.net/api/api |
| SQL Server | startask-srv.database.windows.net | — |
| SQL Database | startask-db | — |
| Resource Group | startask-rg | — |

> **Merk:** Alle Azure-ressurser heter fortsatt `startask` internt. Kun det brukeren ser er endret til **Stepster**.

---

## Filstruktur

```
startask/
├── index.html          ← Selve appen (SPA)
├── om.html             ← Forklaringsside for nye brukere
├── mascot.png          ← Stepster-maskoten 🦊
├── sw.js               ← Service Worker (push-varsler)
├── manifest.json       ← PWA-manifest
│
└── api/                ← Azure Functions kode (kun versjonskontroll)
    ├── index.js        ← Hovud-API med alle actions
    ├── function.json   ← HTTP trigger-konfigurasjon
    └── package.json    ← npm-avhengigheter (mssql, web-push)
```

---

## Deploy-arbeidsflyt

### Filer som auto-deployes via GitHub Actions

Når du pusher til `main` på GitHub deployes disse filene **automatisk** til Azure Static Web Apps:

- `index.html`
- `om.html`
- `mascot.png`
- `sw.js`
- `manifest.json`

Du trenger ikke gjøre noe annet enn å laste opp filene til GitHub.

---

### API-deploy (manuell via PowerShell)

`api/index.js` i GitHub er kun for **versjonskontroll** og deployes **ikke** automatisk. Ny API-kode må deployes manuelt fra den lokale PowerShell-maskinen.

**Anbefalt arbeidsflyt:**

1. Last ned ny `index.js` fra Claude til `Downloads`-mappen
2. Kopier filen til riktig sted i den lokale funksjonsmappen
3. Deploy til Azure

```powershell
# Steg 1 — Kopier fra Downloads til lokal functionapp-mappe
Copy-Item "C:\Users\Pål-André\Downloads\index.js" D:\SuperTask\functionapp\api\index.js -Force

# Steg 2 — Naviger til functionapp-mappen
cd D:\SuperTask\functionapp

# Steg 3 — Deploy til Azure Functions
func azure functionapp publish startask-api --node
```

> **Viktig:** Azure Functions kjører filen fra `api\index.js` — ikke fra `src\functions\`. Pass alltid på at det er `api\index.js` som oppdateres.

**Verifiser at riktig fil er på plass før deploy:**
```powershell
Get-Content D:\SuperTask\functionapp\api\index.js | Select-Object -First 5
Get-Content D:\SuperTask\functionapp\api\index.js | Select-String "deadline" | Select-Object -First 3
```

---

## Viktige PowerShell-kommandoer

### Verifiser innhold i en fil
```powershell
Get-Content D:\SuperTask\functionapp\api\index.js | Select-Object -First 10
```

### Søk etter tekst i fil
```powershell
Get-Content D:\SuperTask\functionapp\api\index.js | Select-String "nøkkelord"
```

### Tell antall linjer
```powershell
Get-Content D:\SuperTask\functionapp\api\index.js | Measure-Object -Line
```

### Slett en Azure App Setting
```powershell
az functionapp config appsettings delete `
  --resource-group startask-rg `
  --name startask-api `
  --setting-names SETTING_NAVN
```

### Se alle App Settings
```powershell
az functionapp config appsettings list `
  --resource-group startask-rg `
  --name startask-api
```

### Restart Function App
```powershell
az functionapp restart --resource-group startask-rg --name startask-api
```

### Logg inn på Azure CLI
```powershell
az login
```

---

## Database

**Server:** `startask-srv.database.windows.net`  
**Database:** `startask-db`  
**Bruker:** `startaskadmin`

SQL-endringer gjøres i **Azure Portal → SQL Database → Query editor**.

### Tabellstruktur

```sql
users       -- Foreldre (id, email, pin_hash, created_at)
rooms       -- Oppgavelister (id, user_id, name, child_name, deadline, child_key, pin_hash)
tasks       -- Oppgaver (id, room_id, name, emoji, mins, sort_order)
checks      -- Avhukinger (task_id, checked_at, checked_time)
push_subs   -- Push-abonnementer (id, room_id, endpoint, subscription, updated_at)
```

### Kjørte migrasjoner

```sql
-- Lagt til PIN på rooms
ALTER TABLE rooms ADD pin_hash NVARCHAR(64) NULL;

-- Lagt til barnekode
ALTER TABLE rooms ADD child_key NVARCHAR(50) NULL;

-- Lagt til frist
ALTER TABLE rooms ADD deadline TIME NULL;

-- Lagt til klokkeslett på avhukinger
ALTER TABLE checks ADD checked_time TIME NOT NULL DEFAULT CAST(GETDATE() AS TIME);

-- Brukertabell og listehåndtering
CREATE TABLE users (
  id         INT           NOT NULL PRIMARY KEY IDENTITY(1,1),
  email      NVARCHAR(200) NOT NULL UNIQUE,
  pin_hash   NVARCHAR(64)  NOT NULL,
  created_at DATETIME      NOT NULL DEFAULT GETDATE()
);
ALTER TABLE rooms ADD user_id INT NULL REFERENCES users(id);
ALTER TABLE rooms ADD name NVARCHAR(100) NULL;
```

---

## API-actions

| Action | Metode | Beskrivelse |
|---|---|---|
| `register` | POST | Opprett ny brukerkonto (epost + PIN) |
| `login` | POST | Logg inn, returner userId |
| `getLists` | POST | Hent alle oppgavelister for en bruker |
| `createList` | POST | Opprett ny oppgaveliste |
| `getRoom` | GET | Hent rom med oppgaver (via roomId eller childKey) |
| `saveRoom` | POST | Lagre oppgaver og frist |
| `check` | POST | Huk av / fjern avhuking på oppgave |
| `weekStats` | GET | Ukentlig statistikk med skille på i tide / etter frist |
| `deleteList` | POST | Slett oppgaveliste |

---

## Miljøvariabler i Azure Functions

Settes i **Azure Portal → Function App → Configuration → Application settings**

| Navn | Beskrivelse |
|---|---|
| `SQL_SERVER` | startask-srv.database.windows.net |
| `SQL_DATABASE` | startask-db |
| `SQL_USER` | startaskadmin |
| `SQL_PASSWORD` | Databasepassord |
| `VAPID_PUBLIC_KEY` | Push-varsel public key |
| `VAPID_PRIVATE_KEY` | Push-varsel private key |
| `VAPID_EMAIL` | mailto: adresse for push |

---

## VAPID-nøkler (push-varsler, ikke aktivt i bruk)

```
Public:  BNT1BSBplMNZzI_c4lpIjvXYlzc_yLa5KnjEkQgdHpvVvd8hEZvEbWrH2i-UggVMIfxB68pLnFyfNAUVMX3PdIg
Private: r9eap5OxsV3niziq_XZytMACmdNlJ6MANJgVUF1-__8
```

---

## Lokalt utviklingsmiljø

```
D:\SuperTask\
└── functionapp\
    ├── api\
    │   └── index.js        ← Dette er filen Azure bruker!
    ├── src\functions\
    │   └── index.js        ← Kopi for referanse
    ├── reminder-timer\
    │   └── index.js        ← Timer-funksjon (ikke i aktiv bruk)
    ├── host.json
    ├── package.json
    └── node_modules\
```

---

## Brukere og sikkerhet

- Foreldre registrerer seg med **epostadresse + 4-sifret PIN**
- PIN lagres som **SHA256-hash** med salt i databasen — aldri i klartekst
- Barnets URL inneholder en **lang tilfeldig nøkkel** (`childKey`) — umulig å gjette
- Foreldre ser kun sine egne oppgavelister (`user_id`-isolasjon i SQL)
