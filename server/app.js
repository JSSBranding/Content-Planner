import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPLOAD_DIR, newId, json, transaction } from './db.js';
import {
  CHANNELS, CHANNEL_KEYS, CALENDAR_STATUSES, CALENDAR_STATUS_KEYS, PLAN_STATUSES, ROLES, ROLE_KEYS, PERMISSIONS,
} from './constants.js';
import {
  sessionMiddleware, requireLogin, requirePermission, can, createUser, createSession, verifyPassword,
  setSessionCookie, hashPassword, COOKIE, loadPermissions, savePermissions, currentPermissions,
} from './auth.js';
import {
  getClient, mapClient, listMedia, listInputs, listCalendar, getCalendarItem, getPlan, snapshotCalendarItem,
} from './repo.js';
import { proposePlan, writeTexts, suggestShoots, aiAvailable, AiError, MODEL } from './ai.js';
import { parseWhatsApp, whatsappToInput } from './whatsapp.js';
import { exportCalendar, parseCalendarWorkbook } from './excel.js';
import {
  PlanError, createPlan, submitForReview, editManually, applyAiRedistribution, regenerate, approve,
  addToCalendar, findConflicts, cellKey, initialStatus, PLAN_STATUS,
} from '../src/planning/plan.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const optTime = (s) => (s ? (isTime(s) ? s : fail(400, `Ongeldig tijdstip: ${s}`)) : null);
const str = (v, max = 20000) => String(v ?? '').slice(0, max);
const utf8Name = (name) => Buffer.from(name, 'latin1').toString('utf8');

export function createApp(db, { secureCookies = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(sessionMiddleware(db));
  loadPermissions(db);
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    next();
  });

  const api = express.Router();
  app.use('/api', api);

  // ---------- Hulpfuncties ----------

  const clientOr404 = (id) => getClient(db, id) ?? fail(404, 'Klant niet gevonden.');
  const planOr404 = (id) => getPlan(db, id) ?? fail(404, 'Planning niet gevonden.');
  const calendarItemOr404 = (id) => getCalendarItem(db, id) ?? fail(404, 'Kalenderitem niet gevonden.');

  function saveVersion(item, userId, reason, byAi = false) {
    db.prepare(`INSERT INTO calendar_item_versions (id, calendar_item_id, snapshot, reason, changed_by, changed_by_ai)
      VALUES (?, ?, ?, ?, ?, ?)`).run(newId(), item.id, snapshotCalendarItem(item), reason, userId, byAi ? 1 : 0);
  }

  function setCalendarMedia(itemId, mediaIds, clientId) {
    const valid = new Set(db.prepare('SELECT id FROM media_assets WHERE client_id = ?').all(clientId).map((r) => r.id));
    db.prepare('DELETE FROM calendar_item_media WHERE calendar_item_id = ?').run(itemId);
    const insert = db.prepare('INSERT INTO calendar_item_media (calendar_item_id, media_asset_id, position) VALUES (?, ?, ?)');
    [...new Set(mediaIds)].filter((id) => valid.has(id)).forEach((id, i) => insert.run(itemId, id, i));
  }

  function insertCalendarItem(data) {
    const id = newId();
    db.prepare(`INSERT INTO calendar_items (id, client_id, publish_date, suggested_time, channel, body, topic, content_pillar, source_info,
        internal_notes, status, assignee_id, plan_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, data.clientId, data.date, data.time ?? null, data.channel, data.body ?? '', data.topic ?? '', data.pillar || null,
        data.sourceInfo ?? '', data.notes ?? '', data.status, data.assigneeId ?? null, data.planId ?? null, data.createdBy ?? null);
    setCalendarMedia(id, data.media ?? [], data.clientId);
    return id;
  }

  function sourceInfoFor(item, inputsById) {
    const parts = [];
    const input = item.clientInputId && inputsById.get(item.clientInputId);
    if (input) parts.push(`Klantinput${input.title ? ` "${input.title}"` : ''}: ${input.body.slice(0, 600)}`);
    if (input?.instructions) parts.push(`Instructies: ${input.instructions}`);
    return parts.join('\n');
  }

  function persistPlan(plan, { replaceItems = true } = {}) {
    transaction(db, () => {
      db.prepare(`UPDATE content_plans SET status = ?, generation = ?, approved_by = ?, approved_at = ?, approved_generation = ?,
          added_to_calendar_at = ?, ai_note = ?, ai_source = ?, wishes = ?, review_texts_first = ?, texts_ready = ? WHERE id = ?`)
        .run(plan.status, plan.generation, plan.approvedBy ?? null, plan.approvedAt ?? null, plan.approvedGeneration ?? null,
          plan.addedToCalendarAt ?? null, plan.aiNote ?? '', plan.aiSource ?? 'ai', plan.wishes ?? '',
          plan.reviewTextsFirst ? 1 : 0, plan.textsReady ? 1 : 0, plan.id);
      if (replaceItems) {
        db.prepare('DELETE FROM content_plan_items WHERE plan_id = ?').run(plan.id);
        const insert = db.prepare(`INSERT INTO content_plan_items (id, plan_id, position, publish_date, suggested_time, topic,
            channels, content_pillar, client_input_id, media, rationale, texts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        plan.items.forEach((it, i) => insert.run(newId(), plan.id, i, it.date, it.time ?? null, it.topic, json.str(it.channels),
          it.pillar ?? null, it.clientInputId ?? null, json.str(it.media ?? []), it.rationale ?? '', json.str(it.texts ?? {})));
      }
    });
    return getPlan(db, plan.id);
  }

  // Handmatig bewerkte planregels controleren en opschonen.
  function cleanItems(items, client, plan) {
    if (!Array.isArray(items)) fail(400, 'Ongeldige planregels.');
    const inputIds = new Set(listInputs(db, client.id).map((i) => i.id));
    const mediaIds = new Set(listMedia(db, client.id).map((m) => m.id));
    return items.map((it, i) => {
      if (!isDate(it.date)) fail(400, `Regel ${i + 1}: ongeldige datum.`);
      if (it.date < plan.periodStart || it.date > plan.periodEnd) fail(400, `Regel ${i + 1}: datum valt buiten de periode van deze planning.`);
      if (!str(it.topic).trim()) fail(400, `Regel ${i + 1}: onderwerp ontbreekt.`);
      const channels = [...new Set(it.channels ?? [])].filter((c) => CHANNEL_KEYS.includes(c));
      if (!channels.length) fail(400, `Regel ${i + 1}: kies minimaal één kanaal.`);
      const texts = {};
      for (const c of channels) if (it.texts?.[c]) texts[c] = str(it.texts[c]);
      return {
        date: it.date, time: optTime(it.time), topic: str(it.topic, 300).trim(), channels,
        pillar: it.pillar ? str(it.pillar, 100) : null,
        clientInputId: inputIds.has(it.clientInputId) ? it.clientInputId : null,
        media: [...new Set(it.media ?? [])].filter((id) => mediaIds.has(id)),
        rationale: str(it.rationale, 500), texts,
      };
    });
  }

  function planContext(client, plan) {
    const inputs = listInputs(db, client.id);
    const occupied = db.prepare('SELECT publish_date, channel FROM calendar_items WHERE client_id = ? AND publish_date BETWEEN ? AND ?')
      .all(client.id, plan.periodStart, plan.periodEnd);
    return { inputs, media: listMedia(db, client.id), occupied };
  }

  async function generateTextsFor(client, items) {
    const inputsById = new Map(listInputs(db, client.id).map((i) => [i.id, i]));
    const mediaById = new Map(listMedia(db, client.id).map((m) => [m.id, m]));
    const posts = items.map((it) => ({
      date: it.date, topic: it.topic, channels: it.channels, pillar: it.pillar,
      input: it.clientInputId ? inputsById.get(it.clientInputId) : null,
      media: (it.media ?? []).map((id) => mediaById.get(id)).filter(Boolean),
    }));
    return writeTexts({ client, posts });
  }

  // Plaatst een goedgekeurde planning in de kalender. Conflicten moeten expliciet zijn opgelost.
  function placeInCalendar(plan, user, resolutions) {
    const client = clientOr404(plan.clientId);
    const existing = db.prepare('SELECT id, client_id AS clientId, publish_date AS date, channel FROM calendar_items WHERE client_id = ?')
      .all(plan.clientId);
    const result = addToCalendar(plan, user, existing, resolutions);
    const inputsById = new Map(listInputs(db, client.id).map((i) => [i.id, i]));
    const replacedByKey = new Map(result.replaced.map((r) => [cellKey(r.date, r.channel), r]));
    const placed = [];
    transaction(db, () => {
      for (const cell of result.newCalendarItems) {
        const data = {
          clientId: plan.clientId, date: cell.date, time: cell.time, channel: cell.channel, body: cell.body,
          topic: cell.topic, pillar: cell.pillar, sourceInfo: sourceInfoFor(cell, inputsById), status: cell.status, media: cell.media,
          planId: plan.id, createdBy: user.id,
        };
        const old = replacedByKey.get(cellKey(cell.date, cell.channel));
        if (old) {
          const current = getCalendarItem(db, old.id);
          saveVersion(current, user.id, 'Vervangen door goedgekeurde AI-planning (expliciet gekozen)');
          db.prepare(`UPDATE calendar_items SET suggested_time = ?, body = ?, topic = ?, content_pillar = ?, source_info = ?, status = ?, plan_id = ?,
              updated_at = datetime('now') WHERE id = ?`)
            .run(data.time ?? null, data.body, data.topic, data.pillar || null, data.sourceInfo, data.status, plan.id, old.id);
          setCalendarMedia(old.id, data.media, plan.clientId);
          placed.push({ id: old.id, ...cell });
        } else {
          placed.push({ id: insertCalendarItem(data), ...cell });
        }
      }
      const inputIds = [...new Set(plan.items.map((i) => i.clientInputId).filter(Boolean))];
      for (const id of inputIds) db.prepare('UPDATE client_inputs SET processed = 1 WHERE id = ?').run(id);
      persistPlan({ ...result.plan, id: plan.id }, { replaceItems: false });
    });
    return placed;
  }

  // Na toevoegen: AI schrijft de ontbrekende teksten direct in de kalendercellen.
  async function fillCalendarTexts(client, plan, placed, user) {
    const missing = placed.filter((c) => !c.body);
    if (!missing.length) return 0;
    const groups = plan.items
      .map((it) => ({ ...it, channels: it.channels.filter((ch) => missing.some((c) => c.date === it.date && c.channel === ch && c.topic === it.topic)) }))
      .filter((it) => it.channels.length);
    const texts = await generateTextsFor(client, groups);
    let filled = 0;
    transaction(db, () => {
      groups.forEach((g, i) => {
        for (const ch of g.channels) {
          const body = texts[i]?.[ch];
          const cell = missing.find((c) => c.date === g.date && c.channel === ch);
          if (!body || !cell) continue;
          const current = getCalendarItem(db, cell.id);
          saveVersion(current, user.id, 'Tekst geschreven door AI', true);
          db.prepare(`UPDATE calendar_items SET body = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(body, current.status === 'placeholder_actie_nodig' || current.status === 'beeld_gereed_tekst_ontbreekt'
              ? initialStatus({ body, media: current.media }) : current.status, cell.id);
          filled++;
        }
      });
    });
    return filled;
  }

  // ---------- Meta, installatie en inloggen ----------

  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  api.get('/meta', (req, res) => {
    res.json({
      channels: CHANNELS, calendarStatuses: CALENDAR_STATUSES, planStatuses: PLAN_STATUSES, roles: ROLES, permissions: currentPermissions(), permissionList: PERMISSIONS,
      ai: { available: aiAvailable(), model: aiAvailable() ? MODEL : null },
      needsSetup: userCount() === 0,
      user: req.user ?? null,
    });
  });

  api.post('/setup', (req, res) => {
    if (userCount() > 0) fail(403, 'De applicatie is al ingericht.');
    const { name, email, password } = req.body ?? {};
    if (!str(name).trim() || !str(email).includes('@') || str(password).length < 10) {
      fail(400, 'Vul naam, e-mailadres en een wachtwoord van minimaal 10 tekens in.');
    }
    const id = createUser(db, { name, email, role: 'admin', password });
    setSessionCookie(res, createSession(db, id), secureCookies);
    res.status(201).json({ ok: true });
  });

  // Na 10 mislukte pogingen per e-mailadres en IP-adres volgt een pauze van 15 minuten.
  const failedLogins = new Map();
  api.post('/login', (req, res) => {
    const { email, password } = req.body ?? {};
    const key = `${str(email).trim().toLowerCase()}|${req.ip}`;
    const now = Date.now();
    const attempts = (failedLogins.get(key) ?? []).filter((t) => now - t < 15 * 60_000);
    if (attempts.length >= 10) fail(429, 'Te veel mislukte pogingen. Probeer het over een kwartier opnieuw.');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(str(email).trim());
    if (!user || !verifyPassword(str(password), user.password_hash)) {
      failedLogins.set(key, [...attempts, now]);
      fail(401, 'E-mailadres of wachtwoord klopt niet.');
    }
    failedLogins.delete(key);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
    setSessionCookie(res, createSession(db, user.id), secureCookies);
    res.json({ ok: true });
  });

  api.post('/logout', (req, res) => {
    if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // Alles hieronder vereist een ingelogde gebruiker.
  api.use(requireLogin);

  // ---------- Rechten per rol ----------

  api.put('/permissions', requirePermission('manageUsers'), (req, res) => {
    const body = req.body?.permissions;
    if (!body || typeof body !== 'object') fail(400, 'Ongeldige rechten.');
    res.json({ permissions: savePermissions(db, body) });
  });

  // ---------- Gebruikers ----------

  api.get('/users', (req, res) => {
    const fields = can(req.user, 'manageUsers') ? 'id, name, email, role, created_at' : 'id, name, role';
    res.json(db.prepare(`SELECT ${fields} FROM users ORDER BY name`).all());
  });

  api.post('/users', requirePermission('manageUsers'), (req, res) => {
    const { email, role, password } = req.body ?? {};
    // Accounts zijn per rol; zonder eigen naam krijgt het account de naam van de rol.
    const name = str(req.body?.name).trim() || ROLES.find((r) => r.key === role)?.label;
    if (!str(email).includes('@') || !ROLE_KEYS.includes(role) || str(password).length < 10) {
      fail(400, 'Vul rol, e-mailadres en een wachtwoord van minimaal 10 tekens in.');
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.trim())) fail(409, 'Dit e-mailadres bestaat al.');
    res.status(201).json({ id: createUser(db, { name, email, role, password }) });
  });

  api.patch('/users/:id', requirePermission('manageUsers'), (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) ?? fail(404, 'Gebruiker niet gevonden.');
    const { name, role, password } = req.body ?? {};
    if (role && !ROLE_KEYS.includes(role)) fail(400, 'Onbekende rol.');
    if (role && role !== 'admin' && user.role === 'admin'
      && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n === 1) fail(400, 'Er moet minimaal één beheerder blijven.');
    if (password && str(password).length < 10) fail(400, 'Wachtwoord moet minimaal 10 tekens zijn.');
    db.prepare('UPDATE users SET name = ?, role = ?, password_hash = ? WHERE id = ?').run(
      str(name).trim() || user.name, role ?? user.role, password ? hashPassword(password) : user.password_hash, user.id);
    if (password) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(user.id, req.sessionToken);
    res.json({ ok: true });
  });

  // ---------- Klanten ----------

  function clientFields(body, current = {}) {
    const rawChannels = body.channels ?? current.channels ?? [];
    if (!Array.isArray(rawChannels)) fail(400, 'Onbekend kanaal.');
    const channels = rawChannels.filter((c) => CHANNEL_KEYS.includes(c)); // kanalen die niet meer bestaan vallen weg
    const pillars = (body.content_pillars ?? current.content_pillars ?? []).map((p) => str(p, 100).trim()).filter(Boolean);
    const ppw = Number(body.posts_per_week ?? current.posts_per_week ?? 3);
    if (!Number.isInteger(ppw) || ppw < 1 || ppw > 21) fail(400, 'Publicatiefrequentie moet tussen 1 en 21 per week liggen.');
    const name = str(body.name ?? current.name, 200).trim() || fail(400, 'Naam is verplicht.');
    return {
      name, strategy: str(body.strategy ?? current.strategy), tone_of_voice: str(body.tone_of_voice ?? current.tone_of_voice),
      content_pillars: json.str(pillars), channels: json.str(channels), posts_per_week: ppw,
      ai_memory: str(body.ai_memory ?? current.ai_memory), archived: (body.archived ?? current.archived) ? 1 : 0,
      context: str(body.context ?? current.context), target_audience: str(body.target_audience ?? current.target_audience, 5000),
      website: str(body.website ?? current.website, 300).trim(), contact: str(body.contact ?? current.contact, 500),
    };
  }

  api.get('/clients', (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM client_inputs i WHERE i.client_id = c.id AND i.processed = 0) AS open_inputs,
        (SELECT COUNT(*) FROM content_plans p WHERE p.client_id = c.id AND p.status IN ('concept','in_controle','aanpassen','goedgekeurd')) AS open_plans,
        (SELECT COUNT(*) FROM calendar_items ci WHERE ci.client_id = c.id AND ci.publish_date >= ? AND ci.status = 'placeholder_actie_nodig') AS action_needed
      FROM clients c ORDER BY c.archived, c.name COLLATE NOCASE`).all(today);
    res.json(rows.map(mapClient));
  });

  const nameTaken = (name, exceptId = '') =>
    db.prepare('SELECT 1 FROM clients WHERE name = ? COLLATE NOCASE AND id <> ?').get(name, exceptId);

  api.post('/clients', requirePermission('manageClients'), (req, res) => {
    const f = clientFields(req.body ?? {});
    if (nameTaken(f.name)) fail(409, `Er bestaat al een klant met de naam ${f.name}.`);
    const id = newId();
    db.prepare(`INSERT INTO clients (id, name, strategy, tone_of_voice, content_pillars, channels, posts_per_week, ai_memory, archived,
      context, target_audience, website, contact) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, f.name, f.strategy, f.tone_of_voice,
      f.content_pillars, f.channels, f.posts_per_week, f.ai_memory, f.archived, f.context, f.target_audience, f.website, f.contact);
    res.status(201).json(getClient(db, id));
  });

  api.get('/clients/:id', (req, res) => {
    const client = clientOr404(req.params.id);
    const count = (sql) => db.prepare(sql).get(client.id).n;
    res.json({
      ...client,
      open_inputs: count('SELECT COUNT(*) AS n FROM client_inputs WHERE client_id = ? AND processed = 0'),
      open_plans: count("SELECT COUNT(*) AS n FROM content_plans WHERE client_id = ? AND status IN ('concept','in_controle','aanpassen','goedgekeurd')"),
    });
  });

  // Meerdere klanten tegelijk toevoegen (één naam per regel). Bestaande namen worden overgeslagen.
  api.post('/clients/bulk', requirePermission('manageClients'), (req, res) => {
    // Dubbele namen in de lijst: de eerste schrijfwijze telt.
    const seen = new Set();
    const names = (Array.isArray(req.body?.names) ? req.body.names : []).map((n) => str(n, 200).trim())
      .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
    if (!names.length) fail(400, 'Vul minimaal één klantnaam in.');
    const f = clientFields({ name: 'x', channels: req.body?.channels ?? [], posts_per_week: req.body?.posts_per_week ?? 3 });
    const insert = db.prepare('INSERT INTO clients (id, name, channels, posts_per_week) VALUES (?, ?, ?, ?)');
    const created = [];
    const skipped = [];
    transaction(db, () => {
      for (const name of names) {
        if (nameTaken(name)) skipped.push(name);
        else { insert.run(newId(), name, f.channels, f.posts_per_week); created.push(name); }
      }
    });
    res.status(201).json({ created, skipped });
  });

  api.patch('/clients/:id', requirePermission('manageClients'), (req, res) => {
    const f = clientFields(req.body ?? {}, clientOr404(req.params.id));
    if (nameTaken(f.name, req.params.id)) fail(409, `Er bestaat al een klant met de naam ${f.name}.`);
    db.prepare(`UPDATE clients SET name = ?, strategy = ?, tone_of_voice = ?, content_pillars = ?, channels = ?, posts_per_week = ?,
      ai_memory = ?, archived = ?, context = ?, target_audience = ?, website = ?, contact = ? WHERE id = ?`).run(f.name, f.strategy,
      f.tone_of_voice, f.content_pillars, f.channels, f.posts_per_week, f.ai_memory, f.archived, f.context, f.target_audience,
      f.website, f.contact, req.params.id);
    res.json(getClient(db, req.params.id));
  });

  // Definitief verwijderen, inclusief kalender, planningen, input en beeld. Alleen met de exacte klantnaam als bevestiging.
  api.delete('/clients/:id', requirePermission('manageClients'), (req, res) => {
    const client = clientOr404(req.params.id);
    if (str(req.body?.confirmName).trim() !== client.name) fail(400, 'Typ de klantnaam exact over om te bevestigen.');
    transaction(db, () => {
      // Eerst de kalender: gekoppeld beeld mag pas weg als geen post er meer naar verwijst.
      db.prepare('DELETE FROM calendar_items WHERE client_id = ?').run(client.id);
      db.prepare('DELETE FROM clients WHERE id = ?').run(client.id);
    });
    fs.rm(path.join(UPLOAD_DIR, client.id), { recursive: true, force: true }, () => {});
    res.json({ ok: true });
  });

  // ---------- Klantinput-inbox ----------

  api.get('/clients/:id/inputs', (req, res) => {
    clientOr404(req.params.id);
    res.json(listInputs(db, req.params.id));
  });

  api.post('/clients/:id/inputs', requirePermission('editContent'), (req, res) => {
    clientOr404(req.params.id);
    const { title, body, instructions, source = 'handmatig' } = req.body ?? {};
    if (!str(body).trim()) fail(400, 'Vul de klantinput in.');
    if (!['handmatig', 'email', 'overig'].includes(source)) fail(400, 'Onbekende bron.');
    const id = newId();
    db.prepare('INSERT INTO client_inputs (id, client_id, source, title, body, instructions, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, req.params.id, source, str(title, 200).trim(), str(body, 50000).trim(), str(instructions), req.user.id);
    res.status(201).json({ id });
  });

  const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

  api.post('/clients/:id/inputs/whatsapp', requirePermission('editContent'), memoryUpload.single('file'), (req, res) => {
    clientOr404(req.params.id);
    const text = req.file ? req.file.buffer.toString('utf8') : str(req.body?.text, 2_000_000);
    const messages = parseWhatsApp(text);
    const from = isDate(req.body?.from) ? req.body.from : undefined;
    const to = isDate(req.body?.to) ? req.body.to : undefined;
    const result = whatsappToInput(messages, { from, to });
    if (!result.count) fail(400, 'Geen WhatsApp-berichten herkend. Exporteer de chat als .txt ("zonder media").');
    const id = newId();
    db.prepare('INSERT INTO client_inputs (id, client_id, source, title, body, instructions, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, req.params.id, 'whatsapp', `WhatsApp ${result.firstDate} t/m ${result.lastDate}`, result.body.slice(0, 200000),
        str(req.body?.instructions), req.user.id);
    res.status(201).json({ id, count: result.count });
  });

  api.patch('/inputs/:id', requirePermission('editContent'), (req, res) => {
    const input = db.prepare('SELECT * FROM client_inputs WHERE id = ?').get(req.params.id) ?? fail(404, 'Input niet gevonden.');
    const b = req.body ?? {};
    db.prepare('UPDATE client_inputs SET title = ?, body = ?, instructions = ?, processed = ? WHERE id = ?').run(
      str(b.title ?? input.title, 200), str(b.body ?? input.body, 200000), str(b.instructions ?? input.instructions),
      (b.processed ?? input.processed) ? 1 : 0, input.id);
    res.json({ ok: true });
  });

  api.delete('/inputs/:id', requirePermission('editContent'), (req, res) => {
    db.prepare('DELETE FROM client_inputs WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---------- Mediabibliotheek ----------

  const mediaUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const dir = path.join(UPLOAD_DIR, req.params.id);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => cb(null, `${newId()}${path.extname(utf8Name(file.originalname)).toLowerCase().slice(0, 10)}`),
    }),
    limits: { fileSize: 1024 * 1024 * 1024, files: 50 },
    fileFilter: (_req, file, cb) => cb(null, /^(image|video)\//.test(file.mimetype)),
  });

  api.get('/clients/:id/media', (req, res) => {
    clientOr404(req.params.id);
    res.json(listMedia(db, req.params.id));
  });

  api.post('/clients/:id/media', requirePermission('manageMedia'), (req, res, next) => {
    clientOr404(req.params.id);
    next();
  }, mediaUpload.array('files', 50), (req, res) => {
    const files = req.files ?? [];
    if (!files.length) fail(400, 'Geen foto\'s of video\'s ontvangen. Alleen beeld- en videobestanden zijn toegestaan.');
    const inputId = req.body?.client_input_id || null;
    if (inputId && !db.prepare('SELECT 1 FROM client_inputs WHERE id = ? AND client_id = ?').get(inputId, req.params.id)) fail(400, 'Onbekende klantinput.');
    const insert = db.prepare(`INSERT INTO media_assets (id, client_id, client_input_id, kind, storage_name, filename, mime_type, size_bytes,
      uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const ids = files.map((f) => {
      const id = newId();
      insert.run(id, req.params.id, inputId, f.mimetype.startsWith('video/') ? 'video' : 'foto', f.filename, utf8Name(f.originalname),
        f.mimetype, f.size, req.user.id);
      return id;
    });
    res.status(201).json({ ids });
  });

  const mediaOr404 = (id) => db.prepare('SELECT * FROM media_assets WHERE id = ?').get(id) ?? fail(404, 'Bestand niet gevonden.');
  const mediaPath = (m) => path.join(UPLOAD_DIR, m.client_id, m.storage_name);

  // Klantbestanden worden nooit als actieve inhoud uitgevoerd (bijv. een SVG met script).
  const sandboxed = (res) => res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");

  api.get('/media/:id/file', (req, res) => {
    const m = mediaOr404(req.params.id);
    sandboxed(res);
    res.set('Cache-Control', 'private, max-age=86400');
    res.type(m.mime_type).sendFile(mediaPath(m));
  });

  api.get('/media/:id/download', (req, res) => {
    const m = mediaOr404(req.params.id);
    sandboxed(res);
    res.download(mediaPath(m), m.filename);
  });

  api.patch('/media/:id', requirePermission('manageMedia'), (req, res) => {
    const m = mediaOr404(req.params.id);
    const b = req.body ?? {};
    const tags = Array.isArray(b.tags) ? b.tags.map((t) => str(t, 50).trim()).filter(Boolean) : json.parse(m.tags, []);
    const faces = b.has_recognizable_faces === undefined ? m.has_recognizable_faces : b.has_recognizable_faces === null ? null : b.has_recognizable_faces ? 1 : 0;
    const allowed = b.ai_processing_allowed === undefined ? m.ai_processing_allowed : b.ai_processing_allowed ? 1 : 0;
    db.prepare('UPDATE media_assets SET description = ?, tags = ?, has_recognizable_faces = ?, ai_processing_allowed = ? WHERE id = ?')
      .run(str(b.description ?? m.description, 1000), json.str(tags), faces, allowed, m.id);
    res.json({ ok: true });
  });

  api.delete('/media/:id', requirePermission('manageMedia'), (req, res) => {
    const m = mediaOr404(req.params.id);
    const used = db.prepare('SELECT COUNT(*) AS n FROM calendar_item_media WHERE media_asset_id = ?').get(m.id).n;
    if (used) fail(409, `Dit bestand is gekoppeld aan ${used} kalenderitem(s). Ontkoppel het eerst.`);
    db.prepare('DELETE FROM media_assets WHERE id = ?').run(m.id);
    fs.rm(mediaPath(m), { force: true }, () => {});
    res.json({ ok: true });
  });

  // ---------- AI-planning (conceptplanning) ----------

  api.get('/clients/:id/plans', (req, res) => {
    clientOr404(req.params.id);
    const rows = db.prepare(`SELECT p.id, p.period_start, p.period_end, p.status, p.generation, p.ai_source, p.created_at,
        p.approved_at, u.name AS approved_by_name, (SELECT COUNT(*) FROM content_plan_items i WHERE i.plan_id = p.id) AS item_count
      FROM content_plans p LEFT JOIN users u ON u.id = p.approved_by WHERE p.client_id = ? ORDER BY p.created_at DESC`).all(req.params.id);
    res.json(rows);
  });

  api.post('/clients/:id/plans', requirePermission('managePlans'), async (req, res) => {
    const client = clientOr404(req.params.id);
    if (!client.channels.length) fail(400, 'Stel eerst de kanalen van deze klant in.');
    const { periodStart, periodEnd, wishes } = req.body ?? {};
    if (!isDate(periodStart) || !isDate(periodEnd) || periodEnd < periodStart) fail(400, 'Kies een geldige periode.');
    if ((Date.parse(periodEnd) - Date.parse(periodStart)) / 86400_000 > 92) fail(400, 'Een planning beslaat maximaal drie maanden.');
    const ctx = planContext(client, { periodStart, periodEnd });
    const inputs = ctx.inputs.filter((i) => !i.processed);
    const proposal = await proposePlan({ client, periodStart, periodEnd, inputs, media: ctx.media, occupied: ctx.occupied, wishes: str(wishes, 2000) });
    const id = newId();
    db.prepare('INSERT INTO content_plans (id, client_id, period_start, period_end, ai_source, ai_note, wishes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, client.id, periodStart, periodEnd, proposal.source, proposal.note, str(wishes, 2000), req.user.id);
    const plan = { ...createPlan({ clientId: client.id, items: proposal.items }), id, aiNote: proposal.note, aiSource: proposal.source, wishes: str(wishes, 2000) };
    res.status(201).json(persistPlan(plan));
  });

  function planWithConflicts(plan) {
    const existing = db.prepare(`SELECT ci.id, ci.client_id AS clientId, ci.publish_date AS date, ci.channel, ci.body, ci.status, ci.topic
      FROM calendar_items ci WHERE ci.client_id = ? AND ci.publish_date BETWEEN ? AND ?`).all(plan.clientId, plan.periodStart, plan.periodEnd);
    const conflicts = plan.status === PLAN_STATUS.TOEGEVOEGD ? [] : findConflicts(plan, existing).map(({ cell, existing: e }) => ({
      key: cellKey(cell.date, cell.channel), date: cell.date, channel: cell.channel, newTopic: cell.topic,
      existing: { id: e.id, topic: e.topic, body: e.body.slice(0, 300), status: e.status, planId: e.plan_id },
    }));
    return { ...plan, conflicts };
  }

  api.get('/plans/:id', (req, res) => res.json(planWithConflicts(planOr404(req.params.id))));

  api.put('/plans/:id/items', requirePermission('managePlans'), (req, res) => {
    const plan = planOr404(req.params.id);
    const items = cleanItems(req.body?.items, clientOr404(plan.clientId), plan);
    res.json(planWithConflicts(persistPlan({ ...editManually(plan, req.user, items), id: plan.id })));
  });

  api.post('/plans/:id/submit', requirePermission('managePlans'), (req, res) => {
    const plan = planOr404(req.params.id);
    res.json(planWithConflicts(persistPlan({ ...submitForReview(plan), id: plan.id }, { replaceItems: false })));
  });

  // "Conceptplanning aanpassen"
  api.post('/plans/:id/adjust', requirePermission('managePlans'), (req, res) => {
    const plan = planOr404(req.params.id);
    if (plan.status === PLAN_STATUS.GOEDGEKEURD) {
      // Bewust heropenen: de goedkeuring vervalt en moet opnieuw worden gegeven.
      const reopened = { ...plan, status: PLAN_STATUS.AANPASSEN, approvedBy: null, approvedAt: null, approvedGeneration: null };
      return res.json(planWithConflicts(persistPlan(reopened, { replaceItems: false })));
    }
    res.json(planWithConflicts(persistPlan({ ...editManually(plan, req.user, plan.items), id: plan.id }, { replaceItems: false })));
  });

  async function aiReplan(req, mode) {
    const plan = planOr404(req.params.id);
    const client = clientOr404(plan.clientId);
    if (plan.status === PLAN_STATUS.TOEGEVOEGD) fail(409, 'Deze planning staat al in de kalender.');
    const ctx = planContext(client, plan);
    const wishes = str(req.body?.wishes ?? plan.wishes, 2000);
    const previous = mode === 'redistribute'
      ? plan.items.map(({ date, time, topic, channels, pillar, clientInputId, media }) => ({ date, time, topic, channels, pillar, client_input_id: clientInputId, media_ids: media }))
      : null;
    const inputs = mode === 'redistribute' ? ctx.inputs : ctx.inputs.filter((i) => !i.processed);
    const proposal = await proposePlan({ client, periodStart: plan.periodStart, periodEnd: plan.periodEnd, inputs, media: ctx.media, occupied: ctx.occupied, wishes, previous });
    const next = mode === 'redistribute' ? applyAiRedistribution(plan, proposal.items) : regenerate(plan, proposal.items);
    return planWithConflicts(persistPlan({ ...next, id: plan.id, aiNote: proposal.note, aiSource: proposal.source, wishes, textsReady: false }));
  }

  // "Nieuwe verdeling voorstellen" — vraagt altijd opnieuw akkoord.
  api.post('/plans/:id/redistribute', requirePermission('managePlans'), async (req, res) => res.json(await aiReplan(req, 'redistribute')));
  // "Het hele voorstel opnieuw laten genereren"
  api.post('/plans/:id/regenerate', requirePermission('managePlans'), async (req, res) => res.json(await aiReplan(req, 'regenerate')));

  // "Planning goedkeuren en toevoegen aan kalender"
  api.post('/plans/:id/approve', requirePermission('approvePlans'), async (req, res) => {
    let plan = planOr404(req.params.id);
    const client = clientOr404(plan.clientId);
    const reviewTextsFirst = Boolean(req.body?.reviewTextsFirst);
    const resolutions = req.body?.resolutions ?? {};

    if (!reviewTextsFirst) {
      // Eerst controleren op bestaande content; zonder expliciete keuze verandert er niets.
      const unresolved = planWithConflicts(plan).conflicts.filter((c) => !['skip', 'replace'].includes(resolutions[c.key]));
      if (unresolved.length) fail(409, 'Er staat al content op enkele datums en kanalen. Kies per item wat er moet gebeuren.', { conflicts: unresolved });
    }

    plan = persistPlan({ ...approve(plan, req.user), id: plan.id, reviewTextsFirst }, { replaceItems: false });
    if (reviewTextsFirst) {
      const texts = await generateTextsFor(client, plan.items);
      const withTexts = plan.items.map((it, i) => ({ ...it, texts: { ...texts[i], ...it.texts } }));
      plan = persistPlan({ ...plan, items: withTexts, textsReady: true });
      return res.json({ plan: planWithConflicts(plan), placed: 0, textsFilled: 0 });
    }

    const placed = placeInCalendar(plan, req.user, resolutions);
    let textsFilled = 0;
    let warning = null;
    try {
      textsFilled = await fillCalendarTexts(client, plan, placed, req.user);
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      warning = `De planning staat in de kalender, maar de teksten konden niet worden geschreven: ${err.message}`;
    }
    res.json({ plan: planWithConflicts(getPlan(db, plan.id)), placed: placed.length, textsFilled, warning });
  });

  // Conceptteksten (opnieuw) laten schrijven voor een goedgekeurde planning.
  api.post('/plans/:id/write-texts', requirePermission('managePlans'), async (req, res) => {
    const plan = planOr404(req.params.id);
    if (plan.status !== PLAN_STATUS.GOEDGEKEURD) fail(409, 'Teksten worden geschreven nadat de planning is goedgekeurd.');
    const texts = await generateTextsFor(clientOr404(plan.clientId), plan.items);
    const overwrite = Boolean(req.body?.overwrite);
    const items = plan.items.map((it, i) => ({ ...it, texts: overwrite ? { ...it.texts, ...texts[i] } : { ...texts[i], ...it.texts } }));
    res.json(planWithConflicts(persistPlan({ ...plan, items, textsReady: true })));
  });

  // Na controle van de conceptteksten: toevoegen aan de kalender.
  api.post('/plans/:id/add-to-calendar', requirePermission('approvePlans'), (req, res) => {
    const plan = planOr404(req.params.id);
    const resolutions = req.body?.resolutions ?? {};
    const unresolved = planWithConflicts(plan).conflicts.filter((c) => !['skip', 'replace'].includes(resolutions[c.key]));
    if (unresolved.length) fail(409, 'Er staat al content op enkele datums en kanalen. Kies per item wat er moet gebeuren.', { conflicts: unresolved });
    const placed = placeInCalendar(plan, req.user, resolutions);
    res.json({ plan: planWithConflicts(getPlan(db, plan.id)), placed: placed.length });
  });

  api.delete('/plans/:id', requirePermission('managePlans'), (req, res) => {
    const plan = planOr404(req.params.id);
    if (plan.status === PLAN_STATUS.TOEGEVOEGD) fail(409, 'Een planning die al in de kalender staat, kan niet worden verwijderd.');
    db.prepare('DELETE FROM content_plans WHERE id = ?').run(plan.id);
    res.json({ ok: true });
  });

  // ---------- Contentkalender ----------

  const monthRange = (q) => {
    const from = isDate(q.from) ? q.from : `${new Date().toISOString().slice(0, 7)}-01`;
    const to = isDate(q.to) ? q.to : new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7), 0)).toISOString().slice(0, 10);
    return { from, to };
  };

  api.get('/clients/:id/calendar', (req, res) => {
    clientOr404(req.params.id);
    const { from, to } = monthRange(req.query);
    res.json({ from, to, items: listCalendar(db, req.params.id, from, to) });
  });

  // Handmatig aangemaakte posts worden direct opgeslagen.
  api.post('/clients/:id/calendar', requirePermission('editContent'), (req, res) => {
    const client = clientOr404(req.params.id);
    const b = req.body ?? {};
    if (!isDate(b.date)) fail(400, 'Kies een geldige datum.');
    if (!CHANNEL_KEYS.includes(b.channel)) fail(400, 'Kies een kanaal.');
    if (b.status && !CALENDAR_STATUS_KEYS.includes(b.status)) fail(400, 'Onbekende status.');
    const taken = db.prepare('SELECT id FROM calendar_items WHERE client_id = ? AND publish_date = ? AND channel = ?').get(client.id, b.date, b.channel);
    if (taken) fail(409, 'Er staat al content op deze datum en dit kanaal. Open die cel om hem te bewerken.', { existingId: taken.id });
    const media = Array.isArray(b.media) ? b.media : [];
    const id = insertCalendarItem({
      clientId: client.id, date: b.date, time: optTime(b.time), channel: b.channel, body: str(b.body), topic: str(b.topic, 300),
      pillar: str(b.content_pillar, 100).trim(), sourceInfo: str(b.source_info), notes: str(b.internal_notes), status: b.status ?? initialStatus({ body: b.body, media }),
      assigneeId: b.assignee_id || null, media, createdBy: req.user.id,
    });
    res.status(201).json(getCalendarItem(db, id));
  });

  // Eén post op meerdere kanalen tegelijk, met eventueel per kanaal een eigen tekst.
  // Staat er op een van de kanalen al iets, dan wordt niets aangemaakt en krijg je te zien welke.
  api.post('/clients/:id/calendar/batch', requirePermission('editContent'), (req, res) => {
    const client = clientOr404(req.params.id);
    const b = req.body ?? {};
    if (!isDate(b.date)) fail(400, 'Kies een geldige datum.');
    const posts = (Array.isArray(b.posts) ? b.posts : []).filter((p) => CHANNEL_KEYS.includes(p?.channel));
    if (!posts.length) fail(400, 'Kies minimaal één kanaal.');
    if (new Set(posts.map((p) => p.channel)).size !== posts.length) fail(400, 'Elk kanaal kan maar één keer.');
    const taken = posts.filter((p) => db.prepare('SELECT 1 FROM calendar_items WHERE client_id = ? AND publish_date = ? AND channel = ?').get(client.id, b.date, p.channel));
    if (taken.length) {
      fail(409, `Op deze datum staat al een post op ${taken.map((p) => CHANNELS.find((c) => c.key === p.channel).label).join(' en ')}. Haal dat kanaal weg of kies een andere datum.`, { takenChannels: taken.map((p) => p.channel) });
    }
    const media = Array.isArray(b.media) ? b.media : [];
    const ids = transaction(db, () => posts.map((p) => insertCalendarItem({
      clientId: client.id, date: b.date, time: optTime(b.time), channel: p.channel, body: str(p.body), topic: str(b.topic, 300),
      pillar: str(b.content_pillar, 100).trim(), sourceInfo: str(b.source_info), notes: str(b.internal_notes),
      status: b.status ?? initialStatus({ body: p.body, media }), assigneeId: b.assignee_id || null, media, createdBy: req.user.id,
    })));
    res.status(201).json({ items: ids.map((id) => getCalendarItem(db, id)) });
  });

  api.get('/calendar/:id', (req, res) => {
    const item = calendarItemOr404(req.params.id);
    const versions = db.prepare(`SELECT v.id, v.reason, v.changed_by_ai, v.changed_at, u.name AS changed_by_name FROM calendar_item_versions v
      LEFT JOIN users u ON u.id = v.changed_by WHERE v.calendar_item_id = ? ORDER BY v.changed_at DESC, v.rowid DESC`).all(item.id);
    res.json({ ...item, versions });
  });

  api.patch('/calendar/:id', (req, res) => {
    if (!can(req.user, 'updateStatus') && !can(req.user, 'editContent')) fail(403, 'Je hebt geen rechten voor deze actie.');
    const item = calendarItemOr404(req.params.id);
    const b = req.body ?? {};
    const contentFields = ['publish_date', 'suggested_time', 'channel', 'body', 'topic', 'content_pillar', 'source_info', 'assignee_id', 'media'];
    if (!can(req.user, 'editContent') && contentFields.some((f) => f in b)) {
      fail(403, 'Met jouw rechten kun je alleen de status en interne opmerkingen aanpassen.');
    }
    if (b.status && !CALENDAR_STATUS_KEYS.includes(b.status)) fail(400, 'Onbekende status.');
    if ('publish_date' in b && !isDate(b.publish_date)) fail(400, 'Ongeldige datum.');
    if ('channel' in b && !CHANNEL_KEYS.includes(b.channel)) fail(400, 'Onbekend kanaal.');
    const next = {
      publish_date: b.publish_date ?? item.publish_date,
      suggested_time: 'suggested_time' in b ? optTime(b.suggested_time) : item.suggested_time,
      channel: b.channel ?? item.channel,
      body: 'body' in b ? str(b.body) : item.body,
      topic: 'topic' in b ? str(b.topic, 300) : item.topic,
      content_pillar: 'content_pillar' in b ? str(b.content_pillar, 100).trim() || null : item.content_pillar,
      source_info: 'source_info' in b ? str(b.source_info) : item.source_info,
      internal_notes: 'internal_notes' in b ? str(b.internal_notes) : item.internal_notes,
      status: b.status ?? item.status,
      assignee_id: 'assignee_id' in b ? b.assignee_id || null : item.assignee_id,
    };
    if (next.publish_date !== item.publish_date || next.channel !== item.channel) {
      const taken = db.prepare('SELECT id FROM calendar_items WHERE client_id = ? AND publish_date = ? AND channel = ? AND id <> ?')
        .get(item.client_id, next.publish_date, next.channel, item.id);
      if (taken) fail(409, 'Er staat al content op die datum en dat kanaal. Bestaande content wordt nooit overschreven.');
    }
    transaction(db, () => {
      saveVersion(item, req.user.id, str(b.reason, 200) || 'Bewerkt');
      db.prepare(`UPDATE calendar_items SET publish_date = ?, suggested_time = ?, channel = ?, body = ?, topic = ?, content_pillar = ?,
          source_info = ?, internal_notes = ?, status = ?, assignee_id = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(next.publish_date, next.suggested_time, next.channel, next.body, next.topic, next.content_pillar, next.source_info,
          next.internal_notes, next.status, next.assignee_id, item.id);
      if (Array.isArray(b.media)) setCalendarMedia(item.id, b.media, item.client_id);
    });
    res.json(getCalendarItem(db, item.id));
  });

  api.delete('/calendar/:id', requirePermission('editContent'), (req, res) => {
    calendarItemOr404(req.params.id);
    db.prepare('DELETE FROM calendar_items WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  api.get('/calendar/:id/versions/:vid', (req, res) => {
    const v = db.prepare('SELECT * FROM calendar_item_versions WHERE id = ? AND calendar_item_id = ?').get(req.params.vid, req.params.id)
      ?? fail(404, 'Versie niet gevonden.');
    res.json({ ...v, snapshot: json.parse(v.snapshot, {}) });
  });

  api.post('/calendar/:id/versions/:vid/restore', requirePermission('editContent'), (req, res) => {
    const item = calendarItemOr404(req.params.id);
    const v = db.prepare('SELECT * FROM calendar_item_versions WHERE id = ? AND calendar_item_id = ?').get(req.params.vid, item.id)
      ?? fail(404, 'Versie niet gevonden.');
    const s = json.parse(v.snapshot, {});
    const taken = db.prepare('SELECT id FROM calendar_items WHERE client_id = ? AND publish_date = ? AND channel = ? AND id <> ?')
      .get(item.client_id, s.publish_date, s.channel, item.id);
    if (taken) fail(409, 'Op de datum en het kanaal van deze versie staat inmiddels andere content.');
    transaction(db, () => {
      saveVersion(item, req.user.id, `Vóór terugzetten naar versie van ${v.changed_at}`);
      db.prepare(`UPDATE calendar_items SET publish_date = ?, suggested_time = ?, channel = ?, body = ?, topic = ?, content_pillar = ?,
          source_info = ?, internal_notes = ?, status = ?, assignee_id = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(s.publish_date, s.suggested_time, s.channel, s.body, s.topic, s.content_pillar ?? null, s.source_info, s.internal_notes,
          s.status, s.assignee_id ?? null, item.id);
      setCalendarMedia(item.id, s.media ?? [], item.client_id);
    });
    res.json(getCalendarItem(db, item.id));
  });

  // AI schrijft (opnieuw) de tekst voor één kalendercel. De vorige tekst blijft in de versiegeschiedenis.
  api.post('/calendar/:id/write-text', requirePermission('editContent'), async (req, res) => {
    const item = calendarItemOr404(req.params.id);
    const client = clientOr404(item.client_id);
    const [texts] = await generateTextsFor(client, [{
      date: item.publish_date, topic: item.topic || item.source_info.slice(0, 200) || 'Algemene post', channels: [item.channel],
      pillar: null, clientInputId: null, media: item.media.map((m) => m.id),
    }]);
    const body = texts?.[item.channel];
    if (!body) fail(502, 'De AI gaf geen tekst terug. Probeer het opnieuw.');
    transaction(db, () => {
      saveVersion(item, req.user.id, 'Tekst opnieuw geschreven door AI', true);
      db.prepare(`UPDATE calendar_items SET body = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(body, ['placeholder_actie_nodig', 'beeld_gereed_tekst_ontbreekt'].includes(item.status) ? initialStatus({ body, media: item.media }) : item.status, item.id);
    });
    res.json(getCalendarItem(db, item.id));
  });

  // ---------- Excel ----------

  api.get('/clients/:id/export.xlsx', async (req, res) => {
    const client = clientOr404(req.params.id);
    const { from, to } = monthRange(req.query);
    const buffer = await exportCalendar({ client, items: listCalendar(db, client.id, from, to), from, to });
    const safe = client.name.replace(/[^\w-]+/g, '_');
    res.attachment(`Contentkalender_${safe}_${from}_${to}.xlsx`).type('xlsx').send(Buffer.from(buffer));
  });

  // Zonder "confirm" alleen een voorbeeld; bestaande cellen worden alleen vervangen als ze expliciet in "overwrite" staan.
  api.post('/clients/:id/import', requirePermission('editContent'), memoryUpload.single('file'), async (req, res) => {
    const client = clientOr404(req.params.id);
    if (!req.file) fail(400, 'Kies een Excel-bestand (.xlsx).');
    let parsed;
    try {
      parsed = await parseCalendarWorkbook(req.file.buffer);
    } catch {
      fail(400, 'Dit bestand kon niet als Excel (.xlsx) worden gelezen.');
    }
    const existing = new Map(db.prepare('SELECT id, publish_date, channel FROM calendar_items WHERE client_id = ?').all(client.id)
      .map((r) => [cellKey(r.publish_date, r.channel), r.id]));
    const seen = new Set();
    const rows = parsed.rows.filter((r) => {
      const k = cellKey(r.date, r.channel);
      if (seen.has(k)) { parsed.errors.push(`Rij ${r.row}: dubbele combinatie van datum en kanaal, overgeslagen.`); return false; }
      seen.add(k);
      return true;
    }).map((r) => ({ ...r, key: cellKey(r.date, r.channel), exists: existing.has(cellKey(r.date, r.channel)) }));

    if (req.body?.confirm !== 'true') return res.json({ rows, errors: parsed.errors });

    const overwrite = new Set(json.parse(req.body?.overwrite, []));
    let created = 0;
    let replaced = 0;
    let skipped = 0;
    transaction(db, () => {
      for (const r of rows) {
        const status = r.status ?? initialStatus({ body: r.body, media: [] });
        if (!r.exists) {
          insertCalendarItem({ clientId: client.id, date: r.date, time: r.time, channel: r.channel, body: r.body, topic: r.topic,
            pillar: r.pillar, sourceInfo: r.source, notes: r.notes, status, createdBy: req.user.id });
          created++;
        } else if (overwrite.has(r.key)) {
          const id = existing.get(r.key);
          saveVersion(getCalendarItem(db, id), req.user.id, 'Vervangen via Excel-import (expliciet gekozen)');
          db.prepare(`UPDATE calendar_items SET suggested_time = ?, body = ?, topic = ?, content_pillar = ?, source_info = ?, internal_notes = ?,
              status = ?, updated_at = datetime('now') WHERE id = ?`).run(r.time, r.body, r.topic, r.pillar || null, r.source, r.notes, status, id);
          replaced++;
        } else {
          skipped++;
        }
      }
    });
    res.json({ created, replaced, skipped, errors: parsed.errors });
  });

  // ---------- Contentshoot-voorstellen ----------

  api.get('/clients/:id/shoots', (req, res) => {
    clientOr404(req.params.id);
    res.json(db.prepare('SELECT * FROM shoot_suggestions WHERE client_id = ? ORDER BY created_at DESC').all(req.params.id));
  });

  api.post('/clients/:id/shoots', requirePermission('managePlans'), async (req, res) => {
    const client = clientOr404(req.params.id);
    const recentTopics = db.prepare("SELECT DISTINCT topic FROM calendar_items WHERE client_id = ? AND topic <> '' ORDER BY publish_date DESC LIMIT 30")
      .all(client.id).map((r) => r.topic);
    const suggestions = await suggestShoots({ client, media: listMedia(db, client.id), recentTopics });
    const insert = db.prepare('INSERT INTO shoot_suggestions (id, client_id, title, body, ai_source) VALUES (?, ?, ?, ?, ?)');
    transaction(db, () => suggestions.forEach((s) => insert.run(newId(), client.id, str(s.title, 200), str(s.body, 5000), aiAvailable() ? 'ai' : 'voorbeeld')));
    res.status(201).json({ count: suggestions.length });
  });

  api.delete('/shoots/:id', requirePermission('managePlans'), (req, res) => {
    db.prepare('DELETE FROM shoot_suggestions WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'Onbekende API-route.')));

  // ---------- Frontend ----------

  app.use('/assets', express.static(path.join(root, 'assets'), { maxAge: '7d' }));
  app.use('/styles', express.static(path.join(root, 'src', 'styles')));
  app.get('/gedeeld/dagen.js', (_req, res) => res.type('js').sendFile(path.join(root, 'src', 'dagen.js')));
  app.use(express.static(path.join(root, 'public')));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(root, 'public', 'index.html')));

  // ---------- Foutafhandeling ----------

  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err instanceof PlanError) return res.status(409).json({ error: err.message, conflicts: err.conflicts });
    if (err instanceof AiError) return res.status(502).json({ error: err.message });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload mislukt: ${err.message}` });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ongeldige gegevens.' });
    console.error(err);
    res.status(500).json({ error: 'Er ging iets mis op de server.' });
  });

  return app;
}
