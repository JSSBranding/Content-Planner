# Jouw Content Studio

Interne tool van Jouw Social Studio voor het **voorbereiden en overdragen** van social media content.

Klantinput + originele foto's/video's → AI-planningsvoorstel → goedkeuring door social media manager →
AI-teksten per kanaal → controle → Excel-achtige contentkalender → vormgever werkt buiten de app →
medewerker zet de kleurstatus.

- `docs/werkwijze.md` — definitieve werkwijze (leidend voor ontwerp, database en ontwikkeling)
- `db/schema.sql` — databaseschema (PostgreSQL)
- `src/planning/plan.js` — goedkeuringsproces AI-planning en conflictcontrole

Geen grafische editor, geen templates, geen publicatiekoppelingen.

```bash
npm test
```
