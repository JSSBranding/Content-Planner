// Leesfuncties die databaserijen omzetten naar nette objecten voor de API.
import { json } from './db.js';

// Adres van een profielfoto; het tijdstip in de URL zorgt dat een nieuwe foto direct zichtbaar is.
export const avatarUrl = (kind, id, at) => (at ? `/api/avatar/${kind}/${id}?v=${encodeURIComponent(at)}` : null);

export function mapClient(row) {
  if (!row) return null;
  return {
    ...row,
    content_pillars: json.parse(row.content_pillars, []),
    channels: json.parse(row.channels, []),
    branches: json.parse(row.branches, []),
    own_days: json.parse(row.own_days, []),
    recurring: json.parse(row.recurring, []),
    archived: Boolean(row.archived),
    avatar_url: avatarUrl('client', row.id, row.avatar_at),
  };
}

export const getClient = (db, id) => mapClient(db.prepare('SELECT * FROM clients WHERE id = ?').get(id));

export function mapMedia(row) {
  return {
    ...row,
    tags: json.parse(row.tags, []),
    has_recognizable_faces: row.has_recognizable_faces,
    ai_processing_allowed: row.ai_processing_allowed,
    times_used: row.times_used ?? 0,
    url: `/api/media/${row.id}/file`,
    download_url: `/api/media/${row.id}/download`,
  };
}

export function listMedia(db, clientId) {
  return db.prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM calendar_item_media cm WHERE cm.media_asset_id = m.id) AS times_used,
           (SELECT MAX(ci.publish_date) FROM calendar_item_media cm JOIN calendar_items ci ON ci.id = cm.calendar_item_id
             WHERE cm.media_asset_id = m.id) AS last_used_on
    FROM media_assets m WHERE m.client_id = ? ORDER BY m.uploaded_at DESC`).all(clientId).map(mapMedia);
}

export function listInputs(db, clientId) {
  return db.prepare('SELECT * FROM client_inputs WHERE client_id = ? ORDER BY created_at DESC').all(clientId)
    .map((r) => ({ ...r, processed: Boolean(r.processed) }));
}

export function mediaForCalendarItems(db, itemIds) {
  if (!itemIds.length) return new Map();
  const rows = db.prepare(`
    SELECT cm.calendar_item_id, cm.position, m.* FROM calendar_item_media cm
    JOIN media_assets m ON m.id = cm.media_asset_id
    WHERE cm.calendar_item_id IN (${itemIds.map(() => '?').join(',')})
    ORDER BY cm.position`).all(...itemIds);
  const byItem = new Map();
  for (const r of rows) {
    if (!byItem.has(r.calendar_item_id)) byItem.set(r.calendar_item_id, []);
    byItem.get(r.calendar_item_id).push(mapMedia(r));
  }
  return byItem;
}

export function listCalendar(db, clientId, from, to) {
  const rows = db.prepare(`
    SELECT ci.*, COALESCE(NULLIF(ci.assignee, ''), u.name) AS assignee_name,
      (SELECT COUNT(*) FROM comments c WHERE c.calendar_item_id = ci.id) AS comment_count
    FROM calendar_items ci LEFT JOIN users u ON u.id = ci.assignee_id
    WHERE ci.client_id = ? AND ci.publish_date BETWEEN ? AND ? ORDER BY ci.publish_date, ci.channel`).all(clientId, from, to);
  const media = mediaForCalendarItems(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, media: media.get(r.id) ?? [] }));
}

export function getCalendarItem(db, id) {
  const row = db.prepare(`
    SELECT ci.*, COALESCE(NULLIF(ci.assignee, ''), u.name) AS assignee_name FROM calendar_items ci LEFT JOIN users u ON u.id = ci.assignee_id
    WHERE ci.id = ?`).get(id);
  if (!row) return null;
  return { ...row, media: mediaForCalendarItems(db, [id]).get(id) ?? [] };
}

export function mapPlanItem(row) {
  return {
    id: row.id,
    position: row.position,
    date: row.publish_date,
    time: row.suggested_time,
    topic: row.topic,
    channels: json.parse(row.channels, []),
    pillar: row.content_pillar,
    clientInputId: row.client_input_id,
    media: json.parse(row.media, []),
    rationale: row.rationale,
    texts: json.parse(row.texts, {}),
  };
}

// Een planning in de vorm die src/planning/plan.js verwacht.
export function getPlan(db, id) {
  const row = db.prepare('SELECT p.*, u.name AS approved_by_name FROM content_plans p LEFT JOIN users u ON u.id = p.approved_by WHERE p.id = ?').get(id);
  if (!row) return null;
  const items = db.prepare('SELECT * FROM content_plan_items WHERE plan_id = ? ORDER BY position').all(id).map(mapPlanItem);
  return {
    id: row.id,
    clientId: row.client_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    generation: row.generation,
    reviewTextsFirst: Boolean(row.review_texts_first),
    textsReady: Boolean(row.texts_ready),
    aiSource: row.ai_source,
    aiNote: row.ai_note,
    wishes: row.wishes,
    approvedBy: row.approved_by,
    approvedByName: row.approved_by_name,
    approvedAt: row.approved_at,
    approvedGeneration: row.approved_generation,
    addedToCalendarAt: row.added_to_calendar_at,
    createdAt: row.created_at,
    items,
  };
}

export function snapshotCalendarItem(item) {
  const { media, assignee_name: _a, ...rest } = item;
  return JSON.stringify({ ...rest, media: media.map((m) => m.id) });
}
