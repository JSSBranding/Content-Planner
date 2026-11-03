// Vult een lege database met de startlijst van klanten (db/startklanten.txt).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId } from './db.js';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'startklanten.txt');

export function readStartClients(file = FILE) {
  if (!fs.existsSync(file)) return [];
  const names = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const seen = new Set();
  return names.filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
}

/** Maakt de startklanten aan, maar alleen als er nog helemaal geen klanten zijn. Geeft het aantal terug. */
export function seedClients(db, names = readStartClients()) {
  if (db.prepare('SELECT COUNT(*) AS n FROM clients').get().n > 0) return 0;
  const insert = db.prepare('INSERT INTO clients (id, name) VALUES (?, ?)');
  for (const name of names) insert.run(newId(), name);
  return names.length;
}
