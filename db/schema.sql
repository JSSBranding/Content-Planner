-- Jouw Content Studio — databaseschema (SQLite, via node:sqlite).
-- Volgt docs/werkwijze.md. Geen tabellen voor ontwerpen, templates of publicatiekoppelingen.
-- Lijsten (kanalen, pijlers, tags, media-id's) worden als JSON-tekst opgeslagen.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'social_media_manager', 'medewerker', 'vormgever')),
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  strategy        TEXT NOT NULL DEFAULT '',          -- klantstrategie
  tone_of_voice   TEXT NOT NULL DEFAULT '',
  content_pillars TEXT NOT NULL DEFAULT '[]',        -- JSON: ["Vakmanschap", ...]
  channels        TEXT NOT NULL DEFAULT '[]',        -- JSON: ["instagram", ...]
  posts_per_week  INTEGER NOT NULL DEFAULT 3,        -- afgesproken publicatiefrequentie
  ai_memory       TEXT NOT NULL DEFAULT '',          -- AI-klantgeheugen
  context         TEXT NOT NULL DEFAULT '',          -- over de klant: achtergrond, producten, USP's
  target_audience TEXT NOT NULL DEFAULT '',          -- doelgroep
  website         TEXT NOT NULL DEFAULT '',
  contact         TEXT NOT NULL DEFAULT '',          -- contactpersoon bij de klant
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Klantinput-inbox: informatie, steekwoorden, WhatsApp-import, bijzonderheden.
CREATE TABLE IF NOT EXISTS client_inputs (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source       TEXT NOT NULL CHECK (source IN ('handmatig', 'whatsapp', 'email', 'overig')),
  title        TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  processed    INTEGER NOT NULL DEFAULT 0,           -- verwerkt in een planning
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Mediabibliotheek: alleen originele klantbestanden.
CREATE TABLE IF NOT EXISTS media_assets (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  client_input_id TEXT REFERENCES client_inputs(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('foto', 'video')),
  storage_name    TEXT NOT NULL,
  filename        TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  tags            TEXT NOT NULL DEFAULT '[]',
  -- Privacy: herkenbare gezichten worden nooit aan AI aangeboden zonder expliciete toestemming.
  has_recognizable_faces INTEGER,                    -- NULL = nog niet beoordeeld
  ai_processing_allowed  INTEGER NOT NULL DEFAULT 0,
  uploaded_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS media_assets_client_idx ON media_assets (client_id, uploaded_at DESC);

-- AI-planning (conceptplanning) met goedkeuringsproces.
CREATE TABLE IF NOT EXISTS content_plans (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'concept'
                CHECK (status IN ('concept', 'in_controle', 'aanpassen', 'goedgekeurd', 'toegevoegd_aan_kalender')),
  generation    INTEGER NOT NULL DEFAULT 1,          -- verhoogd bij elke AI-(her)verdeling
  review_texts_first INTEGER NOT NULL DEFAULT 0,     -- conceptteksten eerst controleren
  texts_ready   INTEGER NOT NULL DEFAULT 0,
  ai_source     TEXT NOT NULL DEFAULT 'ai',          -- 'ai' of 'voorbeeld' (zonder API-sleutel)
  ai_note       TEXT NOT NULL DEFAULT '',
  wishes        TEXT NOT NULL DEFAULT '',            -- extra wensen van de manager
  approved_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at   TEXT,
  approved_generation INTEGER,
  added_to_calendar_at TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (period_end >= period_start),
  -- Goedgekeurd of toegevoegd vereist een expliciete, actuele managergoedkeuring.
  CHECK (status NOT IN ('goedgekeurd', 'toegevoegd_aan_kalender')
         OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_generation = generation))
);

CREATE TABLE IF NOT EXISTS content_plan_items (
  id              TEXT PRIMARY KEY,
  plan_id         TEXT NOT NULL REFERENCES content_plans(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,                  -- volgorde
  publish_date    TEXT NOT NULL,
  suggested_time  TEXT,                              -- altijd een voorstel
  topic           TEXT NOT NULL,
  channels        TEXT NOT NULL DEFAULT '[]',
  content_pillar  TEXT,
  client_input_id TEXT REFERENCES client_inputs(id) ON DELETE SET NULL,
  media           TEXT NOT NULL DEFAULT '[]',        -- JSON: media-id's
  rationale       TEXT NOT NULL DEFAULT '',
  texts           TEXT NOT NULL DEFAULT '{}'         -- JSON: {kanaal: concepttekst}
);

-- Definitieve contentkalender: één rij per kanaalcel (datum × kanaal).
CREATE TABLE IF NOT EXISTS calendar_items (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  publish_date    TEXT NOT NULL,
  suggested_time  TEXT,
  channel         TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',          -- tekst voor dit kanaal
  topic           TEXT NOT NULL DEFAULT '',
  content_pillar  TEXT,                              -- optioneel
  source_info     TEXT NOT NULL DEFAULT '',          -- klantinput / broninformatie
  internal_notes  TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'placeholder_actie_nodig'
                  CHECK (status IN ('tekst_gereed', 'beeld_gereed_tekst_ontbreekt', 'gereed_voor_inplannen',
                                    'volledig_ingepland', 'advertising_gereed', 'advertising_ingepland',
                                    'placeholder_actie_nodig')),
  assignee_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  plan_id         TEXT REFERENCES content_plans(id) ON DELETE SET NULL,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  -- Bestaande content mag nooit ongemerkt overschreven worden: één cel per klant/datum/kanaal.
  UNIQUE (client_id, publish_date, channel)
);

-- Meerdere originele foto's/video's per kalenderitem, met volgorde.
CREATE TABLE IF NOT EXISTS calendar_item_media (
  calendar_item_id TEXT NOT NULL REFERENCES calendar_items(id) ON DELETE CASCADE,
  media_asset_id   TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  position         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (calendar_item_id, media_asset_id)
);
-- "Inzicht in eerder gebruikt beeld".
CREATE INDEX IF NOT EXISTS calendar_item_media_asset_idx ON calendar_item_media (media_asset_id);

-- Versiegeschiedenis van kalenderitems (snapshot vóór elke wijziging).
CREATE TABLE IF NOT EXISTS calendar_item_versions (
  id               TEXT PRIMARY KEY,
  calendar_item_id TEXT NOT NULL REFERENCES calendar_items(id) ON DELETE CASCADE,
  snapshot         TEXT NOT NULL,
  reason           TEXT NOT NULL DEFAULT '',
  changed_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  changed_by_ai    INTEGER NOT NULL DEFAULT 0,
  changed_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Contentshoot-voorstellen.
CREATE TABLE IF NOT EXISTS shoot_suggestions (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  ai_source   TEXT NOT NULL DEFAULT 'ai',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
