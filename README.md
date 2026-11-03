# Jouw Content Studio

<img src="assets/brand/svg/logo-turkoois.svg" alt="Jouw Social Studio" width="180">

Interne tool van Jouw Social Studio voor het **voorbereiden en overdragen** van socialmediacontent.

```
Klantinput + originele foto's/video's
  → AI maakt een content- en planningsvoorstel (conceptplanning)
  → social media manager past aan en keurt expliciet goed
  → AI schrijft de teksten per kanaal (direct, of eerst ter controle)
  → tekst + origineel beeld staan in de Excel-achtige contentkalender
  → vormgever kopieert/downloadt en werkt buiten de app (Canva, Adobe…)
  → medewerker zet de kleurstatus
```

Geen grafische editor, geen templates, geen publicatiekoppelingen. Zie [`docs/werkwijze.md`](docs/werkwijze.md).

## Starten

Vereist: Node.js 22.13 of nieuwer (gebruikt de ingebouwde SQLite-module, geen aparte database nodig).

```bash
npm install
```

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Open http://localhost:3000. Bij de eerste keer maak je het beheerdersaccount aan; daarna voeg je collega's toe via **Team en rechten**.

Bij de eerste start met een lege database worden de klanten uit `db/startklanten.txt` aangemaakt. Daarna beheer je klanten in de app: toevoegen (los of als lijst), naam en gegevens aanpassen, archiveren en verwijderen. Het bestand wordt dan niet opnieuw gelezen, dus een verwijderde klant komt niet terug.

Zonder `ANTHROPIC_API_KEY` werkt alles ook, maar dan maakt een vaste voorbeeldgenerator de planningen, teksten en shootvoorstellen (de interface toont dan "Voorbeeldmodus"). Handig om de workflow te testen.

### Instellingen (omgevingsvariabelen)

| Variabele | Standaard | Betekenis |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Sleutel voor de Claude API. Zonder sleutel: voorbeeldmodus. |
| `JCS_AI_MODEL` | `claude-opus-5-5` | Claude-model voor alle AI-functies. |
| `PORT` | `3000` | Poort van de webserver. |
| `JCS_DATA_DIR` | `./data` | Map met de database (`jouw-content-studio.sqlite`) en geüploade bestanden (`uploads/`). **Maak hier back-ups van.** |
| `JCS_SECURE_COOKIES` | `false` | Zet op `true` zodra de app via HTTPS draait. |

### Testen

```bash
npm test
```

De tests doorlopen de hele workflow via de API (zonder AI-sleutel), de goedkeuringsregels en het AI-pad met een nagebootste Claude-client.

## Wat erin zit

| Onderdeel | Waar |
|---|---|
| **Klantenbeheer**: strategie, tone of voice, contentpijlers, kanalen, frequentie | Klantprofiel & AI-geheugen |
| **AI-klantgeheugen**: vaste afspraken en lessen, gaat mee bij elk AI-verzoek | Klantprofiel & AI-geheugen |
| **Klantinput-inbox** met **WhatsApp-import** (chatexport .txt) en bijbehorende foto's/video's | Klantinput |
| **Mediabibliotheek**: upload, thumbnails, videopreview, zoeken/filteren, downloaden, "eerder gebruikt", privacy per bestand | Mediabibliotheek |
| **Conceptplanning** met vijf statussen en verplichte goedkeuring door een manager | Conceptplanning |
| **Contentkalender**: raster datum × kanaal, zeven kleurstatussen (kleuren uit de JSS-legenda, `server/constants.js`), meerdere beelden per post, interne opmerkingen, verantwoordelijke | Contentkalender |
| **Versiegeschiedenis** per kalendercel, met terugzetten | Zijpaneel van een cel |
| **Excel-export en -import** (import vervangt alleen wat je expliciet aanvinkt) | Contentkalender |
| **Contentshoot-voorstellen** | Contentshoots |
| **Rollen**: beheerder, social media manager, medewerker, grafisch vormgever | Gebruikers |

### Goedkeuringsregels (afgedwongen in de server, niet alleen in de interface)

- Een AI-planning komt alleen in de kalender na expliciete goedkeuring door een social media manager of beheerder (`src/planning/plan.js`, plus een databasecontrole in `db/schema.sql`).
- "Nieuwe verdeling voorstellen" of opnieuw genereren door de AI trekt de goedkeuring in: opnieuw akkoord nodig.
- Handmatige wijzigingen door een manager houden een goedkeuring in stand.
- Bestaande content wordt nooit ongemerkt overschreven: per kanaalcel kies je "overslaan" of "vervangen", en een vervangen versie blijft in de geschiedenis.
- Twee onderwerpen op dezelfde datum en hetzelfde kanaal kunnen niet worden goedgekeurd.
- Handmatige posts worden direct opgeslagen.
- Een vormgever kan alleen status en interne opmerkingen wijzigen.

### Privacy

- Alle pagina's en bestanden zijn alleen bereikbaar na inloggen. Wachtwoorden worden met scrypt opgeslagen.
- De AI krijgt **nooit** beeldbestanden zelf, alleen bestandsnaam, beschrijving en tags.
- Beeld waarvan is aangegeven dat er herkenbare gezichten op staan, wordt zonder vastgelegde toestemming niet aan de AI aangeboden.
- Telefoonnummers en e-mailadressen worden uit teksten gehaald voordat die naar de AI gaan.
- Klantteksten gaan wel naar Anthropic (de Claude API). Leg dit vast in de verwerkersovereenkomsten met klanten.
- Het lettertype wordt zelf gehost; de browser maakt geen verbinding met Google.

## Bekende beperkingen

- **Thumbnails** zijn het originele bestand, door de browser verkleind. Bij zeer grote foto's is server-side verkleinen (bijv. met `sharp`) een logische vervolgstap.
- **Alles downloaden** downloadt de bestanden één voor één, niet als zip.
- **AI-klantgeheugen** wordt handmatig bijgehouden; de AI vult het niet zelf aan.
- **Wachtwoord vergeten**: een beheerder stelt een nieuw wachtwoord in; er is geen e-mailherstel.
- **Beeldkeuze door de AI** gebeurt op bestandsnaam, beschrijving en tags; de AI bekijkt de beelden zelf (nog) niet.
- Het AI-pad is getest met een nagebootste Claude-client; test na het instellen van een sleutel één planning van begin tot eind.

## Mappen

```
server/          API (Express), database, AI, WhatsApp- en Excel-verwerking
src/planning/    goedkeuringsregels voor AI-planningen (zonder afhankelijkheden, met tests)
src/styles/      huisstijltokens en lettertype
public/          interface (HTML, CSS, JavaScript zonder buildstap)
db/schema.sql    databaseschema (SQLite)
assets/          logo's, beeldmerk, iconen, Poppins
docs/            werkwijze en huisstijl
test/            tests
```
