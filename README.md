# Jouw Content Studio

<img src="assets/brand/svg/logo-turkoois.svg" alt="Jouw Social Studio" width="180">

Interne tool van Jouw Social Studio voor het **voorbereiden en overdragen** van social media content.

Klantinput + originele foto's/video's → AI-planningsvoorstel → goedkeuring door social media manager →
AI-teksten per kanaal → controle → Excel-achtige contentkalender → vormgever werkt buiten de app →
medewerker zet de kleurstatus.

- `docs/werkwijze.md` — definitieve werkwijze (leidend voor ontwerp, database en ontwikkeling)
- `db/schema.sql` — databaseschema (PostgreSQL)
- `src/planning/plan.js` — goedkeuringsproces AI-planning en conflictcontrole
- `docs/huisstijl.md`, `assets/brand/` — JSS 2.0-logo's, beeldmerk, kleuren
- `assets/icons/` — iconen (hart, pijl) en icoonvellen

Geen grafische editor, geen templates, geen publicatiekoppelingen.

```bash
npm test
```
