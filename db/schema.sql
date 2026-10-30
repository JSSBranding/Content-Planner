-- Jouw Content Studio — databaseschema (PostgreSQL)
-- Volgt docs/werkwijze.md. Geen tabellen voor ontwerpen, templates of publicatiekoppelingen.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('admin', 'social_media_manager', 'vormgever', 'medewerker');

CREATE TYPE channel AS ENUM ('instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'pinterest', 'x');

-- De zeven bestaande kleurstatussen.
CREATE TYPE calendar_status AS ENUM (
  'tekst_gereed',
  'beeld_gereed_tekst_ontbreekt',
  'gereed_voor_inplannen',
  'volledig_ingepland',
  'advertising_gereed',
  'advertising_ingepland',
  'placeholder_actie_nodig'
);

CREATE TYPE plan_status AS ENUM (
  'concept',               -- 1. gegenereerd door AI
  'in_controle',           -- 2. wacht op beoordeling
  'aanpassen',             -- 3. manager wijzigt het voorstel
  'goedgekeurd',           -- 4. expliciet akkoord manager
  'toegevoegd_aan_kalender'-- 5. items staan in het raster
);

CREATE TYPE media_kind AS ENUM ('foto', 'video');

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text NOT NULL UNIQUE,
  role        user_role NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  strategy              text,                 -- klantstrategie
  content_pillars       text[] NOT NULL DEFAULT '{}',
  channels              channel[] NOT NULL DEFAULT '{}',
  posts_per_week        smallint,             -- afgesproken publicatiefrequentie
  ai_memory             jsonb NOT NULL DEFAULT '{}', -- AI-klantgeheugen
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Klantinput-inbox: informatie, steekwoorden, WhatsApp-import, bijzonderheden.
CREATE TABLE client_inputs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source      text NOT NULL CHECK (source IN ('handmatig', 'whatsapp', 'email', 'overig')),
  body        text NOT NULL,
  instructions text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Mediabibliotheek: alleen originele klantbestanden.
CREATE TABLE media_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  client_input_id uuid REFERENCES client_inputs(id) ON DELETE SET NULL,
  kind            media_kind NOT NULL,
  storage_key     text NOT NULL,
  thumbnail_key   text,
  preview_key     text,                 -- video-preview
  filename        text NOT NULL,
  mime_type       text NOT NULL,
  size_bytes      bigint NOT NULL,
  tags            text[] NOT NULL DEFAULT '{}',
  -- Privacy: AI-verwerking van herkenbare gezichten alleen na expliciete toestemming.
  has_recognizable_faces boolean,
  ai_processing_allowed  boolean NOT NULL DEFAULT false,
  uploaded_by     uuid REFERENCES users(id),
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_assets_client_idx ON media_assets (client_id, uploaded_at DESC);

-- AI-planning (conceptplanning) met goedkeuringsproces.
CREATE TABLE content_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  status        plan_status NOT NULL DEFAULT 'concept',
  generation    integer NOT NULL DEFAULT 1,   -- verhoogd bij elke AI-herverdeling
  approved_by   uuid REFERENCES users(id),
  approved_at   timestamptz,
  approved_generation integer,               -- goedkeuring geldt voor precies deze generatie
  added_to_calendar_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  -- Goedgekeurd of toegevoegd vereist een expliciete, actuele managergoedkeuring.
  CHECK (status NOT IN ('goedgekeurd', 'toegevoegd_aan_kalender')
         OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_generation = generation))
);

CREATE TABLE content_plan_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES content_plans(id) ON DELETE CASCADE,
  position        integer NOT NULL,          -- volgorde
  publish_date    date NOT NULL,
  suggested_time  time,                      -- altijd een voorstel
  topic           text NOT NULL,
  channels        channel[] NOT NULL,
  content_pillar  text,
  client_input_id uuid REFERENCES client_inputs(id) ON DELETE SET NULL,
  suggested_media uuid[] NOT NULL DEFAULT '{}',
  UNIQUE (plan_id, position)
);

-- Definitieve contentkalender: één rij per kanaalcel (datum × kanaal).
CREATE TABLE calendar_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  publish_date    date NOT NULL,
  suggested_time  time,
  channel         channel NOT NULL,
  body            text,                       -- tekst voor dit kanaal
  source_info     text,                       -- klantinput / broninformatie
  internal_notes  text,
  status          calendar_status NOT NULL DEFAULT 'placeholder_actie_nodig',
  assignee_id     uuid REFERENCES users(id),
  plan_item_id    uuid REFERENCES content_plan_items(id) ON DELETE SET NULL,
  is_draft        boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Bestaande content mag nooit ongemerkt overschreven worden: één cel per klant/datum/kanaal.
  UNIQUE (client_id, publish_date, channel)
);

-- Meerdere originele foto's/video's per kalenderitem, met volgorde.
CREATE TABLE calendar_item_media (
  calendar_item_id uuid NOT NULL REFERENCES calendar_items(id) ON DELETE CASCADE,
  media_asset_id   uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  position         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (calendar_item_id, media_asset_id)
);
-- "Inzicht in eerder gebruikt beeld".
CREATE INDEX calendar_item_media_asset_idx ON calendar_item_media (media_asset_id);

-- Versiegeschiedenis van kalenderitems.
CREATE TABLE calendar_item_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_item_id uuid NOT NULL REFERENCES calendar_items(id) ON DELETE CASCADE,
  snapshot         jsonb NOT NULL,
  changed_by       uuid REFERENCES users(id),
  changed_by_ai    boolean NOT NULL DEFAULT false,
  changed_at       timestamptz NOT NULL DEFAULT now()
);

-- Contentshoot-voorstellen.
CREATE TABLE shoot_suggestions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
