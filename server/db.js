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
  ['clients', 'archived_at', 'TEXT'],
  ['users', 'disabled', 'INTEGER NOT NULL DEFAULT 0'],
  ['shoot_suggestions', 'planned_date', 'TEXT'],
  ['shoot_suggestions', 'done', 'INTEGER NOT NULL DEFAULT 0'],
  ['clients', 'avatar_at', 'TEXT'],
  ['users', 'avatar_at', 'TEXT'],
  ['clients', 'branches', "TEXT NOT NULL DEFAULT '[]'"],
  ['clients', 'own_days', "TEXT NOT NULL DEFAULT '[]'"],
  ['clients', 'recurring', "TEXT NOT NULL DEFAULT '[]'"],
  ['seen_items', 'seen_at', 'TEXT'],
  ['calendar_items', 'content_pillar', 'TEXT'],
  ['calendar_items', 'assignee', "TEXT NOT NULL DEFAULT ''"],
  ['clients', 'auto_plan', 'INTEGER NOT NULL DEFAULT 1'],
  ['content_plans', 'auto_generated', 'INTEGER NOT NULL DEFAULT 0'],
];
function migrate(db) {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  // De lijst met toegestane input-bronnen is uitgebreid met 'transcriptie'. Oude databases hebben nog de
  // beperktere CHECK-constraint; die herbouwen we eenmalig (SQLite kan een CHECK niet los wijzigen).
  const inputsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'client_inputs'").get()?.sql ?? '';
  if (inputsSql && !inputsSql.includes('transcriptie')) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      ALTER TABLE client_inputs RENAME TO client_inputs_oud;
      CREATE TABLE client_inputs (
        id           TEXT PRIMARY KEY,
        client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        source       TEXT NOT NULL CHECK (source IN ('handmatig', 'whatsapp', 'email', 'transcriptie', 'overig')),
        title        TEXT NOT NULL DEFAULT '',
        body         TEXT NOT NULL,
        instructions TEXT NOT NULL DEFAULT '',
        processed    INTEGER NOT NULL DEFAULT 0,
        created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO client_inputs (id, client_id, source, title, body, instructions, processed, created_by, created_at)
        SELECT id, client_id, source, title, body, instructions, processed, created_by, created_at FROM client_inputs_oud;
      DROP TABLE client_inputs_oud;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  // media_assets: 'audio' toegevoegd aan de toegestane soorten (voor gespreksopnames). Oude databases herbouwen.
  const mediaSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'media_assets'").get()?.sql ?? '';
  if (mediaSql && !mediaSql.includes("'audio'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      ALTER TABLE media_assets RENAME TO media_assets_oud;
      CREATE TABLE media_assets (
        id              TEXT PRIMARY KEY,
        client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        client_input_id TEXT REFERENCES client_inputs(id) ON DELETE SET NULL,
        kind            TEXT NOT NULL CHECK (kind IN ('foto', 'video', 'audio')),
        storage_name    TEXT NOT NULL,
        filename        TEXT NOT NULL,
        mime_type       TEXT NOT NULL,
        size_bytes      INTEGER NOT NULL,
        description     TEXT NOT NULL DEFAULT '',
        tags            TEXT NOT NULL DEFAULT '[]',
        has_recognizable_faces INTEGER,
        ai_processing_allowed  INTEGER NOT NULL DEFAULT 0,
        uploaded_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
        uploaded_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO media_assets SELECT * FROM media_assets_oud;
      DROP TABLE media_assets_oud;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
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
