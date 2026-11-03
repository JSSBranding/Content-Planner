// Nagebootste server voor de demoversie. Volgt de routes en regels van server/app.js,
// maar bewaart alles in de browser (localStorage). AI-functies gebruiken voorbeeldvoorstellen.
import {
  PlanError, createPlan, submitForReview, editManually, applyAiRedistribution, regenerate, approve,
  addToCalendar, findConflicts, cellKey, initialStatus, PLAN_STATUS,
} from './lib/plan.js';
import { examplePlan, exampleShoots } from './lib/voorbeeld.js';
import { parseWhatsApp, whatsappToInput } from './lib/whatsapp.js';
import { CHANNELS, CHANNEL_KEYS, CALENDAR_STATUSES, CALENDAR_STATUS_KEYS, PLAN_STATUSES, ROLES, ROLE_KEYS, CAN } from './lib/constants.js';
import { buildSeed, demoText } from './seed.js';

const STORE_KEY = 'jcs-demo-v1';
const sessionFiles = new Map(); // video's die alleen tijdens deze sessie bestaan (blob-URL's)

// ---------- Opslag ----------

let state = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (saved?.version === 1) return saved;
  } catch { /* geen opslag beschikbaar */ }
  return buildSeed(new Date());
}
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch { /* opslag vol of geblokkeerd: de demo werkt verder in het geheugen */ }
}
export function reset() {
  state = buildSeed(new Date());
  persist();
}

// ---------- Hulpfuncties ----------

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const now = () => new Date().toISOString();
const str = (v, max = 20000) => String(v ?? '').slice(0, max);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const optTime = (s) => (s ? (isTime(s) ? s : fail(400, `Ongeldig tijdstip: ${s}`)) : null);

const currentUser = () => state.users.find((u) => u.id === state.currentUserId) ?? state.users[0];
const can = (permission) => CAN[permission].includes(currentUser().role);
const need = (permission) => { if (!can(permission)) fail(403, 'Je hebt geen rechten voor deze actie.'); };
const userName = (id) => state.users.find((u) => u.id === id)?.name ?? null;

const clientOr404 = (id) => state.clients.find((c) => c.id === id) ?? fail(404, 'Klant niet gevonden.');
const planOr404 = (id) => state.plans.find((p) => p.id === id) ?? fail(404, 'Planning niet gevonden.');
const itemOr404 = (id) => state.calendar.find((i) => i.id === id) ?? fail(404, 'Kalenderitem niet gevonden.');
const mediaOr404 = (id) => state.media.find((m) => m.id === id) ?? fail(404, 'Bestand niet gevonden.');

function mapMedia(m) {
  const uses = state.calendar.filter((i) => i.media.includes(m.id));
  const src = m.src ?? sessionFiles.get(m.id) ?? 'demo-beeld/niet-beschikbaar.svg';
  return {
    ...m,
    times_used: uses.length,
    last_used_on: uses.map((i) => i.publish_date).sort().at(-1) ?? null,
    url: src,
    download_url: src,
  };
}
const listMedia = (clientId) => state.media.filter((m) => m.client_id === clientId)
  .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)).map(mapMedia);
const listInputs = (clientId) => state.inputs.filter((i) => i.client_id === clientId)
  .sort((a, b) => b.created_at.localeCompare(a.created_at));

function mapItem(item) {
  return {
    ...item,
    assignee_name: userName(item.assignee_id),
    media: item.media.map((id) => state.media.find((m) => m.id === id)).filter(Boolean).map(mapMedia),
  };
}

function saveVersion(item, reason, byAi = false) {
  const { media, ...rest } = item;
  state.versions.push({
    id: newId(), calendar_item_id: item.id, snapshot: { ...structuredClone(rest), media: [...media] },
    reason, changed_by: currentUser().id, changed_by_ai: byAi ? 1 : 0, changed_at: now(),
  });
}

function setMedia(item, ids) {
  const valid = new Set(state.media.filter((m) => m.client_id === item.client_id).map((m) => m.id));
  item.media = [...new Set(ids)].filter((id) => valid.has(id));
}

function insertItem(data) {
  const item = {
    id: newId(), client_id: data.clientId, publish_date: data.date, suggested_time: data.time ?? null, channel: data.channel,
    body: data.body ?? '', topic: data.topic ?? '', source_info: data.sourceInfo ?? '', internal_notes: data.notes ?? '',
    status: data.status, assignee_id: data.assigneeId ?? null, plan_id: data.planId ?? null,
    created_by: currentUser().id, created_at: now(), updated_at: now(), media: [],
  };
  setMedia(item, data.media ?? []);
  state.calendar.push(item);
  return item;
}

const cellTaken = (clientId, date, channel, exceptId) =>
  state.calendar.find((i) => i.client_id === clientId && i.publish_date === date && i.channel === channel && i.id !== exceptId);

// ---------- Planningen ----------

function planOut(plan) {
  const existing = state.calendar
    .filter((i) => i.client_id === plan.clientId && i.publish_date >= plan.periodStart && i.publish_date <= plan.periodEnd)
    .map((i) => ({ id: i.id, clientId: i.client_id, date: i.publish_date, channel: i.channel, body: i.body, status: i.status, topic: i.topic, plan_id: i.plan_id }));
  const conflicts = plan.status === PLAN_STATUS.TOEGEVOEGD ? [] : findConflicts(plan, existing).map(({ cell, existing: e }) => ({
    key: cellKey(cell.date, cell.channel), date: cell.date, channel: cell.channel, newTopic: cell.topic,
    existing: { id: e.id, topic: e.topic, body: e.body.slice(0, 300), status: e.status, planId: e.plan_id },
  }));
  return { ...structuredClone(plan), approvedByName: userName(plan.approvedBy), conflicts };
}

function storePlan(next) {
  const i = state.plans.findIndex((p) => p.id === next.id);
  const items = next.items.map((it, position) => ({ ...it, id: it.id ?? newId(), position }));
  const stored = { ...next, items };
  if (i >= 0) state.plans[i] = stored;
  else state.plans.push(stored);
  return stored;
}

function cleanItems(items, client, plan) {
  if (!Array.isArray(items)) fail(400, 'Ongeldige planregels.');
  const inputIds = new Set(listInputs(client.id).map((i) => i.id));
  const mediaIds = new Set(state.media.filter((m) => m.client_id === client.id).map((m) => m.id));
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

function textsFor(client, items) {
  const inputs = new Map(listInputs(client.id).map((i) => [i.id, i]));
  return items.map((it) => {
    const input = it.clientInputId ? inputs.get(it.clientInputId) : null;
    return Object.fromEntries(it.channels.map((ch) => [ch, demoText(client, { topic: it.topic, pillar: it.pillar, input }, ch)]));
  });
}

function sourceInfoFor(cell, client) {
  const parts = [];
  if (cell.pillar) parts.push(`Contentpijler: ${cell.pillar}`);
  const input = cell.clientInputId && state.inputs.find((i) => i.id === cell.clientInputId);
  if (input) parts.push(`Klantinput${input.title ? ` "${input.title}"` : ''}: ${input.body.slice(0, 600)}`);
  if (input?.instructions) parts.push(`Instructies: ${input.instructions}`);
  return parts.join('\n');
}

function placeInCalendar(plan, resolutions, { writeTexts }) {
  const client = clientOr404(plan.clientId);
  const existing = state.calendar.filter((i) => i.client_id === plan.clientId)
    .map((i) => ({ id: i.id, clientId: i.client_id, date: i.publish_date, channel: i.channel }));
  const result = addToCalendar(plan, currentUser(), existing, resolutions);
  const replaced = new Map(result.replaced.map((r) => [cellKey(r.date, r.channel), r]));
  const texts = writeTexts ? textsFor(client, plan.items) : null;
  let placed = 0;
  let filled = 0;
  for (const cell of result.newCalendarItems) {
    let body = cell.body;
    if (!body && texts) {
      const index = plan.items.findIndex((it) => it.date === cell.date && it.topic === cell.topic && it.channels.includes(cell.channel));
      body = texts[index]?.[cell.channel] ?? '';
      if (body) filled++;
    }
    const status = initialStatus({ body, media: cell.media });
    const old = replaced.get(cellKey(cell.date, cell.channel));
    if (old) {
      const item = itemOr404(old.id);
      saveVersion(item, 'Vervangen door goedgekeurde AI-planning (expliciet gekozen)');
      Object.assign(item, { suggested_time: cell.time ?? null, body, topic: cell.topic, source_info: sourceInfoFor(cell, client), status, plan_id: plan.id, updated_at: now() });
      setMedia(item, cell.media);
    } else {
      insertItem({ clientId: plan.clientId, date: cell.date, time: cell.time, channel: cell.channel, body, topic: cell.topic, sourceInfo: sourceInfoFor(cell, client), status, media: cell.media, planId: plan.id });
    }
    placed++;
  }
  for (const id of new Set(plan.items.map((i) => i.clientInputId).filter(Boolean))) {
    const input = state.inputs.find((i) => i.id === id);
    if (input) input.processed = true;
  }
  storePlan({ ...result.plan, id: plan.id });
  return { placed, filled };
}

function unresolvedConflicts(plan, resolutions) {
  return planOut(plan).conflicts.filter((c) => !['skip', 'replace'].includes(resolutions[c.key]));
}

function newPlanProposal(client, plan, inputs) {
  const media = listMedia(client.id).filter((m) => !(m.has_recognizable_faces === 1 && m.ai_processing_allowed !== 1));
  return examplePlan({
    client, periodStart: plan.periodStart, periodEnd: plan.periodEnd, inputs, media,
    note: 'In de demo maakt een vaste voorbeeldgenerator de verdeling. In de echte versie doet de AI een voorstel op basis van de klantcontext.',
  });
}

// ---------- Uploads ----------

// Foto's worden verkleind opgeslagen, zodat ze in de browseropslag passen.
async function imageToDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

// ---------- Routes ----------

const routes = [];
const route = (method, pattern, handler) => {
  const names = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}$`);
  routes.push({ method, re, names, handler });
};

route('GET', '/meta', () => ({
  channels: CHANNELS, calendarStatuses: CALENDAR_STATUSES, planStatuses: PLAN_STATUSES, roles: ROLES, permissions: CAN,
  ai: { available: false, model: null }, needsSetup: false, user: { ...currentUser() }, demo: true,
  demoUsers: state.users.map(({ id, name, role }) => ({ id, name, role })),
}));
route('POST', '/logout', () => ({ ok: true }));
route('POST', '/demo/gebruiker', (_, body) => {
  if (!state.users.some((u) => u.id === body?.id)) fail(400, 'Onbekende gebruiker.');
  state.currentUserId = body.id;
  return { ok: true };
});
route('POST', '/demo/opnieuw', () => { reset(); return { ok: true }; });

// Gebruikers
route('GET', '/users', () => state.users.map((u) => (can('manageUsers') ? { ...u } : { id: u.id, name: u.name, role: u.role })).sort((a, b) => a.name.localeCompare(b.name)));
route('POST', '/users', (_, b) => {
  need('manageUsers');
  if (!str(b?.name).trim() || !str(b?.email).includes('@') || !ROLE_KEYS.includes(b?.role) || str(b?.password).length < 10) {
    fail(400, 'Vul naam, e-mailadres, rol en een wachtwoord van minimaal 10 tekens in.');
  }
  if (state.users.some((u) => u.email.toLowerCase() === b.email.trim().toLowerCase())) fail(409, 'Dit e-mailadres bestaat al.');
  const user = { id: newId(), name: b.name.trim(), email: b.email.trim(), role: b.role, created_at: now() };
  state.users.push(user);
  return { id: user.id };
});
route('PATCH', '/users/:id', ({ id }, b) => {
  need('manageUsers');
  const user = state.users.find((u) => u.id === id) ?? fail(404, 'Gebruiker niet gevonden.');
  if (b?.role && !ROLE_KEYS.includes(b.role)) fail(400, 'Onbekende rol.');
  if (b?.role && b.role !== 'admin' && user.role === 'admin' && state.users.filter((u) => u.role === 'admin').length === 1) fail(400, 'Er moet minimaal één beheerder blijven.');
  if (b?.password && str(b.password).length < 10) fail(400, 'Wachtwoord moet minimaal 10 tekens zijn.');
  Object.assign(user, { name: str(b?.name).trim() || user.name, role: b?.role ?? user.role });
  return { ok: true };
});

// Klanten
const clientCounts = (c) => {
  const today = new Date().toISOString().slice(0, 10);
  return {
    open_inputs: state.inputs.filter((i) => i.client_id === c.id && !i.processed).length,
    open_plans: state.plans.filter((p) => p.clientId === c.id && ['concept', 'in_controle', 'aanpassen', 'goedgekeurd'].includes(p.status)).length,
    action_needed: state.calendar.filter((i) => i.client_id === c.id && i.publish_date >= today && i.status === 'placeholder_actie_nodig').length,
  };
};
const nameTaken = (name, exceptId) => state.clients.some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());
function clientFields(body, current = {}) {
  const channels = body.channels ?? current.channels ?? [];
  if (!Array.isArray(channels) || channels.some((c) => !CHANNEL_KEYS.includes(c))) fail(400, 'Onbekend kanaal.');
  const ppw = Number(body.posts_per_week ?? current.posts_per_week ?? 3);
  if (!Number.isInteger(ppw) || ppw < 1 || ppw > 21) fail(400, 'Publicatiefrequentie moet tussen 1 en 21 per week liggen.');
  const name = str(body.name ?? current.name, 200).trim() || fail(400, 'Naam is verplicht.');
  return {
    name, strategy: str(body.strategy ?? current.strategy ?? ''), tone_of_voice: str(body.tone_of_voice ?? current.tone_of_voice ?? ''),
    content_pillars: (body.content_pillars ?? current.content_pillars ?? []).map((p) => str(p, 100).trim()).filter(Boolean),
    channels, posts_per_week: ppw, ai_memory: str(body.ai_memory ?? current.ai_memory ?? ''), archived: Boolean(body.archived ?? current.archived),
  };
}
route('GET', '/clients', () => [...state.clients]
  .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }))
  .map((c) => ({ ...structuredClone(c), ...clientCounts(c) })));
route('POST', '/clients', (_, b) => {
  need('manageClients');
  const f = clientFields(b ?? {});
  if (nameTaken(f.name)) fail(409, `Er bestaat al een klant met de naam ${f.name}.`);
  const client = { id: newId(), ...f, created_at: now() };
  state.clients.push(client);
  return structuredClone(client);
});
route('POST', '/clients/bulk', (_, b) => {
  need('manageClients');
  const seen = new Set();
  const names = (Array.isArray(b?.names) ? b.names : []).map((n) => str(n, 200).trim())
    .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
  if (!names.length) fail(400, 'Vul minimaal één klantnaam in.');
  const f = clientFields({ name: 'x', channels: b?.channels ?? [], posts_per_week: b?.posts_per_week ?? 3 });
  const created = [];
  const skipped = [];
  for (const name of names) {
    if (nameTaken(name)) { skipped.push(name); continue; }
    state.clients.push({ id: newId(), ...f, name, content_pillars: [], strategy: '', tone_of_voice: '', ai_memory: '', archived: false, created_at: now() });
    created.push(name);
  }
  return { created, skipped };
});
route('GET', '/clients/:id', ({ id }) => {
  const c = clientOr404(id);
  return { ...structuredClone(c), ...clientCounts(c) };
});
route('PATCH', '/clients/:id', ({ id }, b) => {
  need('manageClients');
  const c = clientOr404(id);
  const f = clientFields(b ?? {}, c);
  if (nameTaken(f.name, id)) fail(409, `Er bestaat al een klant met de naam ${f.name}.`);
  Object.assign(c, f);
  return structuredClone(c);
});
route('DELETE', '/clients/:id', ({ id }, b) => {
  need('manageClients');
  const c = clientOr404(id);
  if (str(b?.confirmName).trim() !== c.name) fail(400, 'Typ de klantnaam exact over om te bevestigen.');
  const itemIds = new Set(state.calendar.filter((i) => i.client_id === id).map((i) => i.id));
  state.calendar = state.calendar.filter((i) => i.client_id !== id);
  state.versions = state.versions.filter((v) => !itemIds.has(v.calendar_item_id));
  for (const key of ['inputs', 'media', 'shoots']) state[key] = state[key].filter((x) => x.client_id !== id);
  state.plans = state.plans.filter((p) => p.clientId !== id);
  state.clients = state.clients.filter((x) => x.id !== id);
  return { ok: true };
});

// Klantinput
route('GET', '/clients/:id/inputs', ({ id }) => { clientOr404(id); return structuredClone(listInputs(id)); });
route('POST', '/clients/:id/inputs', ({ id }, b) => {
  need('editContent');
  clientOr404(id);
  if (!str(b?.body).trim()) fail(400, 'Vul de klantinput in.');
  const input = { id: newId(), client_id: id, source: ['handmatig', 'email', 'overig'].includes(b?.source) ? b.source : 'handmatig', title: str(b?.title, 200).trim(), body: str(b?.body, 50000).trim(), instructions: str(b?.instructions), processed: false, created_by: currentUser().id, created_at: now() };
  state.inputs.push(input);
  return { id: input.id };
});
route('POST', '/clients/:id/inputs/whatsapp', async ({ id }, form) => {
  need('editContent');
  clientOr404(id);
  const file = form instanceof FormData ? form.get('file') : null;
  const text = file ? await file.text() : '';
  const from = form?.get?.('from') || undefined;
  const to = form?.get?.('to') || undefined;
  const result = whatsappToInput(parseWhatsApp(text), { from, to });
  if (!result.count) fail(400, 'Geen WhatsApp-berichten herkend. Exporteer de chat als .txt ("zonder media").');
  const input = { id: newId(), client_id: id, source: 'whatsapp', title: `WhatsApp ${result.firstDate} t/m ${result.lastDate}`, body: result.body.slice(0, 200000), instructions: '', processed: false, created_by: currentUser().id, created_at: now() };
  state.inputs.push(input);
  return { id: input.id, count: result.count };
});
route('PATCH', '/inputs/:id', ({ id }, b) => {
  need('editContent');
  const input = state.inputs.find((i) => i.id === id) ?? fail(404, 'Input niet gevonden.');
  Object.assign(input, {
    title: str(b?.title ?? input.title, 200), body: str(b?.body ?? input.body), instructions: str(b?.instructions ?? input.instructions),
    processed: Boolean(b?.processed ?? input.processed),
  });
  return { ok: true };
});
route('DELETE', '/inputs/:id', ({ id }) => {
  need('editContent');
  state.inputs = state.inputs.filter((i) => i.id !== id);
  for (const m of state.media) if (m.client_input_id === id) m.client_input_id = null;
  return { ok: true };
});

// Beeld
route('GET', '/clients/:id/media', ({ id }) => { clientOr404(id); return listMedia(id); });
route('POST', '/clients/:id/media', async ({ id }, form) => {
  need('editContent');
  clientOr404(id);
  const files = form instanceof FormData ? form.getAll('files').filter((f) => /^(image|video)\//.test(f.type)) : [];
  if (!files.length) fail(400, 'Geen foto\'s of video\'s ontvangen. Alleen beeld- en videobestanden zijn toegestaan.');
  const inputId = form.get('client_input_id') || null;
  const ids = [];
  for (const f of files) {
    const mediaId = newId();
    const isVideo = f.type.startsWith('video/');
    let src = null;
    if (isVideo) sessionFiles.set(mediaId, URL.createObjectURL(f));
    else {
      try { src = await imageToDataUrl(f); } catch { sessionFiles.set(mediaId, URL.createObjectURL(f)); }
    }
    state.media.push({
      id: mediaId, client_id: id, client_input_id: inputId, kind: isVideo ? 'video' : 'foto', filename: f.name, mime_type: f.type,
      size_bytes: f.size, description: isVideo ? 'Video blijft in de demo alleen tijdens deze sessie zichtbaar.' : '', tags: [],
      has_recognizable_faces: null, ai_processing_allowed: 0, uploaded_by: currentUser().id, uploaded_at: now(), src,
    });
    ids.push(mediaId);
  }
  return { ids };
});
route('PATCH', '/media/:id', ({ id }, b) => {
  need('editContent');
  const m = mediaOr404(id);
  if (Array.isArray(b?.tags)) m.tags = b.tags.map((t) => str(t, 50).trim()).filter(Boolean);
  if ('description' in (b ?? {})) m.description = str(b.description, 1000);
  if ('has_recognizable_faces' in (b ?? {})) m.has_recognizable_faces = b.has_recognizable_faces === null ? null : b.has_recognizable_faces ? 1 : 0;
  if ('ai_processing_allowed' in (b ?? {})) m.ai_processing_allowed = b.ai_processing_allowed ? 1 : 0;
  return { ok: true };
});
route('DELETE', '/media/:id', ({ id }) => {
  need('editContent');
  const m = mediaOr404(id);
  const used = state.calendar.filter((i) => i.media.includes(id)).length;
  if (used) fail(409, `Dit bestand is gekoppeld aan ${used} kalenderitem(s). Ontkoppel het eerst.`);
  state.media = state.media.filter((x) => x.id !== m.id);
  return { ok: true };
});

// Conceptplanning
route('GET', '/clients/:id/plans', ({ id }) => {
  clientOr404(id);
  return state.plans.filter((p) => p.clientId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => ({
    id: p.id, period_start: p.periodStart, period_end: p.periodEnd, status: p.status, generation: p.generation, ai_source: p.aiSource,
    created_at: p.createdAt, approved_at: p.approvedAt, approved_by_name: userName(p.approvedBy), item_count: p.items.length,
  }));
});
route('POST', '/clients/:id/plans', ({ id }, b) => {
  need('managePlans');
  const client = clientOr404(id);
  if (!client.channels.length) fail(400, 'Stel eerst de kanalen van deze klant in.');
  const { periodStart, periodEnd } = b ?? {};
  if (!isDate(periodStart) || !isDate(periodEnd) || periodEnd < periodStart) fail(400, 'Kies een geldige periode.');
  if ((Date.parse(periodEnd) - Date.parse(periodStart)) / 86400000 > 92) fail(400, 'Een planning beslaat maximaal drie maanden.');
  const proposal = newPlanProposal(client, { periodStart, periodEnd }, listInputs(id).filter((i) => !i.processed));
  const plan = storePlan({
    ...createPlan({ clientId: id, items: proposal.items }), id: newId(), periodStart, periodEnd,
    reviewTextsFirst: false, textsReady: false, aiSource: 'voorbeeld', aiNote: proposal.note, wishes: str(b?.wishes, 2000),
    addedToCalendarAt: null, createdAt: now(),
  });
  return planOut(plan);
});
route('GET', '/plans/:id', ({ id }) => planOut(planOr404(id)));
route('PUT', '/plans/:id/items', ({ id }, b) => {
  need('managePlans');
  const plan = planOr404(id);
  const items = cleanItems(b?.items, clientOr404(plan.clientId), plan);
  return planOut(storePlan({ ...editManually(plan, currentUser(), items), id }));
});
route('POST', '/plans/:id/submit', ({ id }) => { need('managePlans'); return planOut(storePlan({ ...submitForReview(planOr404(id)), id })); });
route('POST', '/plans/:id/adjust', ({ id }) => {
  need('managePlans');
  const plan = planOr404(id);
  if (plan.status === PLAN_STATUS.GOEDGEKEURD) {
    return planOut(storePlan({ ...plan, status: PLAN_STATUS.AANPASSEN, approvedBy: null, approvedAt: null, approvedGeneration: null }));
  }
  return planOut(storePlan({ ...editManually(plan, currentUser(), plan.items), id }));
});
for (const mode of ['redistribute', 'regenerate']) {
  route('POST', `/plans/:id/${mode}`, ({ id }, b) => {
    need('managePlans');
    const plan = planOr404(id);
    if (plan.status === PLAN_STATUS.TOEGEVOEGD) fail(409, 'Deze planning staat al in de kalender.');
    const client = clientOr404(plan.clientId);
    const inputs = mode === 'redistribute' ? listInputs(client.id) : listInputs(client.id).filter((i) => !i.processed);
    let items = newPlanProposal(client, plan, inputs).items;
    // Bij een nieuwe verdeling blijven de onderwerpen behouden; alleen datums, tijden en kanalen schuiven.
    if (mode === 'redistribute' && plan.items.length) {
      items = items.map((it, i) => (plan.items[i] ? { ...it, topic: plan.items[i].topic, pillar: plan.items[i].pillar, clientInputId: plan.items[i].clientInputId, media: plan.items[i].media, rationale: 'Onderwerp behouden, opnieuw verdeeld.' } : it));
    }
    const next = mode === 'redistribute' ? applyAiRedistribution(plan, items) : regenerate(plan, items);
    return planOut(storePlan({ ...next, id, wishes: str(b?.wishes ?? plan.wishes, 2000), textsReady: false }));
  });
}
route('POST', '/plans/:id/approve', ({ id }, b) => {
  need('approvePlans');
  let plan = planOr404(id);
  const reviewTextsFirst = Boolean(b?.reviewTextsFirst);
  const resolutions = b?.resolutions ?? {};
  if (!reviewTextsFirst) {
    const unresolved = unresolvedConflicts(plan, resolutions);
    if (unresolved.length) fail(409, 'Er staat al content op enkele datums en kanalen. Kies per item wat er moet gebeuren.', { conflicts: unresolved });
  }
  plan = storePlan({ ...approve(plan, currentUser()), id, reviewTextsFirst });
  if (reviewTextsFirst) {
    const texts = textsFor(clientOr404(plan.clientId), plan.items);
    plan = storePlan({ ...plan, items: plan.items.map((it, i) => ({ ...it, texts: { ...texts[i], ...it.texts } })), textsReady: true });
    return { plan: planOut(plan), placed: 0, textsFilled: 0 };
  }
  const { placed, filled } = placeInCalendar(plan, resolutions, { writeTexts: true });
  return { plan: planOut(planOr404(id)), placed, textsFilled: filled, warning: null };
});
route('POST', '/plans/:id/write-texts', ({ id }, b) => {
  need('managePlans');
  const plan = planOr404(id);
  if (plan.status !== PLAN_STATUS.GOEDGEKEURD) fail(409, 'Teksten worden geschreven nadat de planning is goedgekeurd.');
  const texts = textsFor(clientOr404(plan.clientId), plan.items);
  const items = plan.items.map((it, i) => ({ ...it, texts: b?.overwrite ? { ...it.texts, ...texts[i] } : { ...texts[i], ...it.texts } }));
  return planOut(storePlan({ ...plan, items, textsReady: true }));
});
route('POST', '/plans/:id/add-to-calendar', ({ id }, b) => {
  need('approvePlans');
  const plan = planOr404(id);
  const resolutions = b?.resolutions ?? {};
  const unresolved = unresolvedConflicts(plan, resolutions);
  if (unresolved.length) fail(409, 'Er staat al content op enkele datums en kanalen. Kies per item wat er moet gebeuren.', { conflicts: unresolved });
  const { placed } = placeInCalendar(plan, resolutions, { writeTexts: false });
  return { plan: planOut(planOr404(id)), placed };
});
route('DELETE', '/plans/:id', ({ id }) => {
  need('managePlans');
  const plan = planOr404(id);
  if (plan.status === PLAN_STATUS.TOEGEVOEGD) fail(409, 'Een planning die al in de kalender staat, kan niet worden verwijderd.');
  state.plans = state.plans.filter((p) => p.id !== id);
  return { ok: true };
});

// Contentkalender
route('GET', '/clients/:id/calendar', ({ id }, _, q) => {
  clientOr404(id);
  const from = isDate(q.get('from')) ? q.get('from') : `${new Date().toISOString().slice(0, 7)}-01`;
  const to = isDate(q.get('to')) ? q.get('to') : from;
  const items = state.calendar.filter((i) => i.client_id === id && i.publish_date >= from && i.publish_date <= to)
    .sort((a, b) => a.publish_date.localeCompare(b.publish_date) || a.channel.localeCompare(b.channel)).map(mapItem);
  return { from, to, items };
});
route('POST', '/clients/:id/calendar', ({ id }, b) => {
  need('editContent');
  clientOr404(id);
  if (!isDate(b?.date)) fail(400, 'Kies een geldige datum.');
  if (!CHANNEL_KEYS.includes(b?.channel)) fail(400, 'Kies een kanaal.');
  if (b.status && !CALENDAR_STATUS_KEYS.includes(b.status)) fail(400, 'Onbekende status.');
  const taken = cellTaken(id, b.date, b.channel);
  if (taken) fail(409, 'Er staat al content op deze datum en dit kanaal. Open die cel om hem te bewerken.', { existingId: taken.id });
  const media = Array.isArray(b.media) ? b.media : [];
  const item = insertItem({
    clientId: id, date: b.date, time: optTime(b.time), channel: b.channel, body: str(b.body), topic: str(b.topic, 300),
    sourceInfo: str(b.source_info), notes: str(b.internal_notes), status: b.status ?? initialStatus({ body: b.body, media }),
    assigneeId: b.assignee_id || null, media,
  });
  return mapItem(item);
});
route('GET', '/calendar/:id', ({ id }) => {
  const item = itemOr404(id);
  const versions = state.versions.filter((v) => v.calendar_item_id === id).sort((a, b) => b.changed_at.localeCompare(a.changed_at))
    .map((v) => ({ id: v.id, reason: v.reason, changed_by_ai: v.changed_by_ai, changed_at: v.changed_at, changed_by_name: userName(v.changed_by) }));
  return { ...mapItem(item), versions };
});
route('PATCH', '/calendar/:id', ({ id }, b) => {
  need('updateStatus');
  const item = itemOr404(id);
  const contentFields = ['publish_date', 'suggested_time', 'channel', 'body', 'topic', 'source_info', 'assignee_id', 'media'];
  if (!can('editContent') && contentFields.some((f) => f in (b ?? {}))) fail(403, 'Als vormgever kun je alleen de status en interne opmerkingen aanpassen.');
  if (b?.status && !CALENDAR_STATUS_KEYS.includes(b.status)) fail(400, 'Onbekende status.');
  if ('publish_date' in b && !isDate(b.publish_date)) fail(400, 'Ongeldige datum.');
  if ('channel' in b && !CHANNEL_KEYS.includes(b.channel)) fail(400, 'Onbekend kanaal.');
  const date = b.publish_date ?? item.publish_date;
  const channel = b.channel ?? item.channel;
  if ((date !== item.publish_date || channel !== item.channel) && cellTaken(item.client_id, date, channel, id)) {
    fail(409, 'Er staat al content op die datum en dat kanaal. Bestaande content wordt nooit overschreven.');
  }
  saveVersion(item, str(b.reason, 200) || 'Bewerkt');
  Object.assign(item, {
    publish_date: date, channel,
    suggested_time: 'suggested_time' in b ? optTime(b.suggested_time) : item.suggested_time,
    body: 'body' in b ? str(b.body) : item.body,
    topic: 'topic' in b ? str(b.topic, 300) : item.topic,
    source_info: 'source_info' in b ? str(b.source_info) : item.source_info,
    internal_notes: 'internal_notes' in b ? str(b.internal_notes) : item.internal_notes,
    status: b.status ?? item.status,
    assignee_id: 'assignee_id' in b ? b.assignee_id || null : item.assignee_id,
    updated_at: now(),
  });
  if (Array.isArray(b.media)) setMedia(item, b.media);
  return mapItem(item);
});
route('DELETE', '/calendar/:id', ({ id }) => {
  need('editContent');
  itemOr404(id);
  state.calendar = state.calendar.filter((i) => i.id !== id);
  state.versions = state.versions.filter((v) => v.calendar_item_id !== id);
  return { ok: true };
});
route('GET', '/calendar/:id/versions/:vid', ({ id, vid }) => {
  const v = state.versions.find((x) => x.id === vid && x.calendar_item_id === id) ?? fail(404, 'Versie niet gevonden.');
  return structuredClone(v);
});
route('POST', '/calendar/:id/versions/:vid/restore', ({ id, vid }) => {
  need('editContent');
  const item = itemOr404(id);
  const v = state.versions.find((x) => x.id === vid && x.calendar_item_id === id) ?? fail(404, 'Versie niet gevonden.');
  const s = v.snapshot;
  if (cellTaken(item.client_id, s.publish_date, s.channel, id)) fail(409, 'Op de datum en het kanaal van deze versie staat inmiddels andere content.');
  saveVersion(item, 'Vóór terugzetten naar een eerdere versie');
  Object.assign(item, {
    publish_date: s.publish_date, suggested_time: s.suggested_time, channel: s.channel, body: s.body, topic: s.topic,
    source_info: s.source_info, internal_notes: s.internal_notes, status: s.status, assignee_id: s.assignee_id ?? null, updated_at: now(),
  });
  setMedia(item, s.media ?? []);
  return mapItem(item);
});
route('POST', '/calendar/:id/write-text', ({ id }) => {
  need('editContent');
  const item = itemOr404(id);
  const client = clientOr404(item.client_id);
  const body = demoText(client, { topic: item.topic || 'Algemene post', pillar: null, input: null, variant: Date.now() }, item.channel);
  saveVersion(item, 'Tekst opnieuw geschreven door AI', true);
  item.body = body;
  if (['placeholder_actie_nodig', 'beeld_gereed_tekst_ontbreekt'].includes(item.status)) item.status = initialStatus({ body, media: item.media });
  item.updated_at = now();
  return mapItem(item);
});
route('POST', '/clients/:id/import', () => fail(400, 'Excel-import kun je in de demo niet proberen. In de echte versie wel.'));

// Contentshoots
route('GET', '/clients/:id/shoots', ({ id }) => { clientOr404(id); return state.shoots.filter((s) => s.client_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at)); });
route('POST', '/clients/:id/shoots', ({ id }) => {
  need('managePlans');
  const client = clientOr404(id);
  const suggestions = exampleShoots(client);
  for (const s of suggestions) state.shoots.push({ id: newId(), client_id: id, title: s.title, body: s.body, ai_source: 'voorbeeld', created_at: now() });
  return { count: suggestions.length };
});
route('DELETE', '/shoots/:id', ({ id }) => { need('managePlans'); state.shoots = state.shoots.filter((s) => s.id !== id); return { ok: true }; });

// ---------- Afhandeling ----------

export async function handle(method, url, body) {
  const [path, queryString = ''] = url.split('?');
  const query = new URLSearchParams(queryString);
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    try {
      const result = await r.handler(params, body, query);
      if (method !== 'GET') persist();
      return { status: method === 'POST' && /\/(clients|users|inputs|media|calendar|plans|shoots|bulk|whatsapp)$/.test(path) ? 201 : 200, body: structuredClone(result) };
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, body: { error: err.message, ...err.extra } };
      if (err instanceof PlanError) return { status: 409, body: { error: err.message, conflicts: err.conflicts } };
      console.error(err);
      return { status: 500, body: { error: 'Er ging iets mis in de demo. Probeer "Demo opnieuw beginnen" als dit blijft gebeuren.' } };
    }
  }
  return { status: 404, body: { error: 'Onbekende route in de demo.' } };
}
