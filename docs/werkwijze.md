# Jouw Content Studio — definitieve JSS-werkwijze

Dit document is **leidend** voor ontwerp, database en ontwikkeling. Bij strijdigheid met
eerdere specificaties gaat dit document voor.

## Einddoel

```
Klantinput + originele foto's/video's
  → AI maakt content- en planningsvoorstel (conceptplanning)
  → Social media manager keurt verdeling en datums/tijden goed
  → AI schrijft teksten per kanaal
  → Social media manager controleert
  → Tekst + origineel beeld in de Excel-achtige contentkalender
  → Grafisch vormgever werkt buiten de applicatie (Canva, Adobe, …)
  → Medewerker past de kalenderstatus handmatig aan
```

De contentkalender is de **centrale overdrachtsplek**, niet de plek waar grafische
ontwerpen worden gemaakt. Doel: content voorbereiden eenvoudiger, sneller en overzichtelijker.

## 1. Wat een kalenderitem bevat

Eén kalenderitem = één kanaal op één datum (kanaalcel). Velden:

| Veld | Verplicht |
|---|---|
| Publicatiedatum | ja |
| Voorgesteld publicatietijdstip | nee |
| Socialmediakanaal | ja |
| Tekst voor dat kanaal | nee (kan nog ontbreken) |
| Eén of meer originele klantfoto's/-video's | nee |
| Klantinput / broninformatie | nee |
| Interne opmerkingen / instructies | nee |
| Kleurstatus (zeven statussen) | ja |
| Verantwoordelijke medewerker | nee |

Geen opgemaakte posts, geen tekstlagen, logo's of ontworpen achtergronden. Foto's en video's
zijn bij de tekst te bekijken en te downloaden; tekst is met één klik te kopiëren.

## 2. Workflow

1. **Klantinput aanleveren** — manager kiest klant en voegt informatie, teksten/steekwoorden,
   foto's, video's, WhatsApp-input en bijzonderheden toe. Alternatief: algemene AI-content op
   basis van de klantstrategie.
2. **AI-contentvoorstel** — onderwerpen, datums, eventuele tijdstippen, kanalen, aantal posts per
   week, verdeling over de maand, passend aangeleverd beeld.
3. **Verplichte goedkeuring** — zie §4. AI verdeelt **nooit** automatisch over de definitieve kalender.
4. **Teksten per kanaal** — na goedkeuring schrijft AI per kanaal een eigen versie
   (bijv. LinkedIn zakelijk, Facebook toegankelijk, Instagram korter) in afzonderlijke
   kanaalcellen op dezelfde datum, met het gekozen originele beeld gekoppeld. De manager kan
   kiezen de conceptteksten eerst te controleren voordat de kalender wordt gevuld. Alles blijft
   aanpasbaar.
5. **Overdracht aan vormgever** — ziet tekst, origineel beeld, kanaal, datum, tijd en interne
   opmerkingen; kopieert/downloadt en ontwerpt buiten de applicatie. Hoeft niets terug te uploaden.
6. **Status bijwerken** — handmatig, met de bestaande zeven kleurstatussen.

Handmatig aangemaakte posts mogen direct als concept in de kalender worden opgeslagen.

## 3. Kleurstatussen (ongewijzigd, zeven)

1. Tekst gereed
2. Beeld gereed, tekst ontbreekt
3. Gereed voor inplannen
4. Volledig ingepland *(handmatig, na inplannen buiten de app)*
5. Advertising gereed
6. Advertising ingepland *(handmatig, na inplannen buiten de app)*
7. Placeholder / actie nodig

Er is **geen** automatische publicatie en **geen** publicatiekoppeling.

## 4. AI-planning: goedkeuringsproces

### Statussen

| # | Status | Betekenis |
|---|---|---|
| 1 | Concept | gegenereerd door AI |
| 2 | In controle | wacht op beoordeling |
| 3 | Aanpassen | manager wijzigt het voorstel |
| 4 | Goedgekeurd | manager heeft expliciet akkoord gegeven |
| 5 | Toegevoegd aan kalender | items staan daadwerkelijk in het raster |

### Regels

- Een AI-planning gaat **alleen** naar de kalender vanuit *Goedgekeurd*, en alleen door een
  bevoegde social media manager.
- Elke AI-wijziging van datums, tijden of kanaalverdeling (bijv. "Nieuwe verdeling voorstellen")
  zet de planning terug naar *In controle*: opnieuw akkoord nodig.
- Handmatige wijzigingen door een bevoegde medewerker hoeven niet opnieuw door AI te worden
  goedgekeurd; tijdens *Aanpassen* blijft de planning bewerkbaar tot de manager goedkeurt.
- Vóór toevoegen controleert het systeem op bestaande content op dezelfde datum + kanaal.
  Bestaande content wordt **nooit ongemerkt overschreven**: bij conflicten kiest de manager
  per item (overslaan of expliciet vervangen).
- Tijdstippen worden altijd gepresenteerd als **voorstel**, nooit als gegarandeerd optimaal.

### Conceptplanning — inhoud per regel

Datum · eventueel tijdstip · onderwerp · kanaal(en) · contentpijler · gekoppelde klantinput ·
voorgestelde foto/video.

### Wat de manager kan

Datums en tijden aanpassen · onderwerpen wijzigen/verwijderen/toevoegen · kanalen veranderen ·
volgorde wijzigen · beelden vervangen · verdeling aanpassen · hele voorstel opnieuw laten genereren.

### Acties (letterlijke knopteksten)

- **Conceptplanning aanpassen**
- **Nieuwe verdeling voorstellen**
- **Planning goedkeuren en toevoegen aan kalender**

### Basis voor AI-voorstellen

Afgesproken publicatiefrequentie · beschikbare klantinput · contentpijlers · gewenste kanalen ·
relevante datums · evenwichtige spreiding door de maand.

## 5. Mediabibliotheek (wél bouwen)

Foto-upload · video-upload · thumbnails · video-preview · meerdere foto's per post · beeld koppelen
aan teksten · beeld vervangen · zoeken en filteren · downloaden · inzicht in eerder gebruikt beeld.

AI mag passend beeld uit de klantbibliotheek **voorstellen**; de definitieve keuze ligt bij de
manager. De privacycontrole voor AI-verwerking van herkenbare gezichten blijft verplicht zodra
zo'n AI-verwerking wordt aangeboden.

## 6. Niet bouwen

- Ingebouwde grafische afbeeldingseditor
- Tekstlagen of logo's op afbeeldingen
- Grafische templates / Canva-achtige functionaliteit
- Ingebouwde video-editor
- Verplichte upload van definitief opgemaakte posts
- Ontwerpworkflow voor de vormgever binnen de app
- Publicatiekoppelingen naar socialmediaplatforms
- Uitgebreide AI-beeldgeneratie (geen prioriteit)

## 7. Behouden functionaliteit

JSS 2.0-huisstijl · klantenbeheer · Excel-achtige kalender · zeven kleurstatussen ·
AI-klantgeheugen · klantinput-inbox · WhatsApp-import · contentgeneratie · meerdere teksten per
datum · interne opmerkingen · versiegeschiedenis · foto's en video's · contentshoot-voorstellen ·
Excel-import en -export · privacybeveiliging.
