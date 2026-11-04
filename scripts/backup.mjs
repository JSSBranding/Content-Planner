// Maakt een back-up van de database en alle geüploade bestanden, ook terwijl de app draait.
// Gebruik: npm run backup            (naar ./backups/<datum-tijd>/)
//          JCS_BACKUP_DIR=/pad npm run backup
// Bewaart standaard de laatste 14 back-ups (JCS_BACKUP_KEEP om dat te wijzigen).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../server/db.js';

const dbFile = path.join(DATA_DIR, 'jouw-content-studio.sqlite');
const uploads = path.join(DATA_DIR, 'uploads');
const root = process.env.JCS_BACKUP_DIR ?? path.resolve('backups');
const keep = Number(process.env.JCS_BACKUP_KEEP ?? 14);

if (!fs.existsSync(dbFile)) {
  console.error(`Geen database gevonden op ${dbFile}. Klopt JCS_DATA_DIR?`);
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
const target = path.join(root, stamp);
fs.mkdirSync(target, { recursive: true });

// VACUUM INTO maakt een consistente kopie, ook tijdens gebruik (een gewone bestandskopie kan halverwege een schrijfactie vallen).
const db = new DatabaseSync(dbFile, { readOnly: true });
db.exec(`VACUUM INTO '${path.join(target, 'jouw-content-studio.sqlite').replaceAll("'", "''")}'`);
db.close();

if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(target, 'uploads'), { recursive: true });

// Oude back-ups opruimen.
const old = fs.readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(d)).sort().slice(0, -keep);
for (const dir of old) fs.rmSync(path.join(root, dir), { recursive: true, force: true });

console.log(`Back-up gemaakt in ${target}${old.length ? ` (${old.length} oude verwijderd)` : ''}.`);
