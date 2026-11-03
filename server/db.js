import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DATA_DIR = process.env.JCS_DATA_DIR ?? path.join(root, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

export function openDb(file = path.join(DATA_DIR, 'jouw-content-studio.sqlite')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8'));
  migrate(db);
  return db;
}

// Kolommen die later zijn toegevoegd; bestaande databases krijgen ze erbij zonder gegevensverlies.
const ADDED_COLUMNS = [
  ['clients', 'context', "TEXT NOT NULL DEFAULT ''"],
  ['clients', 'target_audience', "TEXT NOT NULL DEFAULT ''"],
  ['clients', 'website', "TEXT NOT NULL DEFAULT ''"],
  ['clients', 'contact', "TEXT NOT NULL DEFAULT ''"],
  ['calendar_items', 'content_pillar', 'TEXT'],
  ['calendar_items', 'assignee', "TEXT NOT NULL DEFAULT ''"],
];
function migrate(db) {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  // Pinterest en X worden niet meer gebruikt: uit de kanalen van klanten halen (bestaande posts blijven staan).
  for (const c of db.prepare("SELECT id, channels FROM clients WHERE channels LIKE '%pinterest%' OR channels LIKE '%\"x\"%'").all()) {
    const channels = JSON.parse(c.channels).filter((k) => k !== 'pinterest' && k !== 'x');
    db.prepare('UPDATE clients SET channels = ? WHERE id = ?').run(JSON.stringify(channels), c.id);
  }
}

export const newId = () => crypto.randomUUID();

export const json = {
  parse(value, fallback) {
    try {
      return value == null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  str: (value) => JSON.stringify(value ?? null),
};

// Voert fn uit binnen één transactie; bij een fout wordt alles teruggedraaid.
// Geneste aanroepen gebruiken savepoints, zodat ze samen slagen of samen mislukken.
const depth = new WeakMap();
export function transaction(db, fn) {
  const level = depth.get(db) ?? 0;
  const name = `sp${level}`;
  db.exec(level === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
  depth.set(db, level + 1);
  try {
    const result = fn();
    db.exec(level === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    throw err;
  } finally {
    depth.set(db, level);
  }
}
