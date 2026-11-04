import { openDb } from './db.js';
import { createApp } from './app.js';
import { aiAvailable, MODEL } from './ai.js';
import { seedClients } from './seed.js';

const port = Number(process.env.PORT ?? 3000);
const db = openDb();
const seeded = seedClients(db);
// JCS_TRUST_PROXY: aantal proxy's voor de app (bijv. 1), of 'true'/'loopback'. Leeg = geen proxy.
const trustEnv = process.env.JCS_TRUST_PROXY ?? '';
const trustProxy = /^\d+$/.test(trustEnv) ? Number(trustEnv) : trustEnv === 'true' ? true : trustEnv || false;
const app = createApp(db, { secureCookies: process.env.JCS_SECURE_COOKIES === 'true', trustProxy });

const server = app.listen(port, () => {
  console.log(`Jouw Content Studio draait op http://localhost:${port}`);
  if (seeded) console.log(`${seeded} klanten uit db/startklanten.txt toegevoegd.`);
  console.log(aiAvailable() ? `AI actief (${MODEL}).` : 'Geen ANTHROPIC_API_KEY: AI-functies gebruiken voorbeeldvoorstellen.');
});

// Netjes afsluiten bij een herstart of update van de hosting: lopende verzoeken afmaken, dan de database sluiten.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
