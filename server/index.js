import { openDb } from './db.js';
import { createApp } from './app.js';
import { aiAvailable, MODEL } from './ai.js';
import { seedClients } from './seed.js';

const port = Number(process.env.PORT ?? 3000);
const db = openDb();
const seeded = seedClients(db);
const app = createApp(db, { secureCookies: process.env.JCS_SECURE_COOKIES === 'true' });

app.listen(port, () => {
  console.log(`Jouw Content Studio draait op http://localhost:${port}`);
  if (seeded) console.log(`${seeded} klanten uit db/startklanten.txt toegevoegd.`);
  console.log(aiAvailable() ? `AI actief (${MODEL}).` : 'Geen ANTHROPIC_API_KEY: AI-functies gebruiken voorbeeldvoorstellen.');
});
