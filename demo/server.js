// Nagebootste server voor de demoversie. Volgt de routes en regels van server/app.js,
// maar bewaart alles in de browser (localStorage). AI-functies gebruiken voorbeeldvoorstellen.
import {
  PlanError, createPlan, submitForReview, editManually, applyAiRedistribution, regenerate, approve,
  addToCalendar, findConflicts, cellKey, initialStatus, PLAN_STATUS,
} from './lib/plan.js';
import { examplePlan, exampleShoots, exampleMemory } from './lib/voorbeeld.js';
import { cleanBranches, cleanOwnDays, cleanRecurring, recurringDates, describeRhythm } from './lib/dagen.js';
import { buildReport, needsAttention, ATTENTION_DAYS } from './lib/rapport.js';
import { parseWhatsApp, whatsappToInput } from './lib/whatsapp.js';
import { CHANNELS, CHANNEL_KEYS, CALENDAR_STATUSES, CALENDAR_STATUS_KEYS, PLAN_STATUSES, ROLES, ROLE_KEYS, PERMISSIONS, normalizePermissions } from './lib/constants.js';
import { buildSeed, demoText } from './seed.js';

const STORE_KEY = 'jcs-demo-v7';
const sessionFiles = new Map(); // video's die alleen tijdens deze sessie bestaan (blob-URL's)

// ---------- Opslag ----------

let state = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (saved?.version === 7) return { comments: [], ...saved };
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

const currentUser = () => state.users.find((u) => u.id === state.currentUserId) ?? null;
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, disabled: Boolean(u.disabled), avatar_url: u.avatar_url ?? null, created_at: u.created_at });

// Wachtwoorden worden in de demo als SHA-256-hash bewaard, nooit leesbaar.
export async function hashPassword(password) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`jcs-demo:${password}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const can = (permission) => Boolean(state.permissions[permission]?.includes(currentUser().role));
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
    assignee_name: item.assignee || userName(item.assignee_id),
    comment_count: (state.comments ?? []).filter((c) => c.calendar_item_id === item.id).length,
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
    body: data.body ?? '', topic: data.topic ?? '', content_pillar: data.pillar || null, source_info: data.sourceInfo ?? '', internal_notes: data.notes ?? '',
    status: data.status, assignee: str(data.assignee, 100).trim(), assignee_id: null, plan_id: data.planId ?? null,
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
      Object.assign(item, { suggested_time: cell.time ?? null, body, topic: cell.topic, content_pillar: cell.pillar || null, source_info: sourceInfoFor(cell, client), status, plan_id: plan.id, updated_at: now() });
      setMedia(item, cell.media);
    } else {
      insertItem({ clientId: plan.clientId, date: cell.date, time: cell.time, channel: cell.channel, body, topic: cell.topic, pillar: cell.pillar, sourceInfo: sourceInfoFor(cell, client), status, media: cell.media, planId: plan.id });
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
    note: 'Verdeling volgens vaste regels, op basis van de kanalen, de frequentie en de klantinput.',
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

const PUBLIC = new Set(['GET /meta', 'POST /login', 'POST /logout', 'POST /demo/opnieuw']);
route('GET', '/meta', () => ({
  channels: CHANNELS, calendarStatuses: CALENDAR_STATUSES, planStatuses: PLAN_STATUSES, roles: ROLES, permissions: state.permissions, permissionList: PERMISSIONS,
  ai: { available: false, model: null }, needsSetup: false, user: currentUser() ? publicUser(currentUser()) : null, demo: true,
  demoAccounts: state.users.filter((u) => u.demoAccount && !u.disabled).map((u) => ({ name: u.name, email: u.email, role: u.role })),
}));
route('POST', '/login', async (_, b) => {
  const user = state.users.find((u) => u.email.toLowerCase() === str(b?.email).trim().toLowerCase());
  if (!user || user.password_hash !== await hashPassword(str(b?.password))) fail(401, 'E-mailadres of wachtwoord klopt niet.');
  if (user.disabled) fail(403, 'Dit account staat uit. Vraag een Chefkes om het weer aan te zetten.');
  state.currentUserId = user.id;
  return { ok: true };
});
route('POST', '/logout', () => { state.currentUserId = null; return { ok: true }; });
route('POST', '/demo/opnieuw', () => { reset(); return { ok: true }; });
route('PUT', '/permissions', (_, b) => {
  need('manageUsers');
  const clean = normalizePermissions(b?.permissions ?? {});
  state.permissions = clean;
  return { permissions: clean };
});

// Gebruikers
route('GET', '/users', () => state.users.map((u) => (can('manageUsers') ? publicUser(u) : { id: u.id, name: u.name, role: u.role, disabled: Boolean(u.disabled), avatar_url: u.avatar_url ?? null }))
  .sort((a, b) => Number(a.disabled) - Number(b.disabled) || a.name.localeCompare(b.name)));
route('POST', '/users', async (_, b) => {
  need('manageUsers');
  if (!str(b?.email).includes('@') || !ROLE_KEYS.includes(b?.role) || str(b?.password).length < 10) {
    fail(400, 'Vul rol, e-mailadres en een wachtwoord van minimaal 10 tekens in.');
  }
  if (state.users.some((u) => u.email.toLowerCase() === b.email.trim().toLowerCase())) fail(409, 'Dit e-mailadres bestaat al.');
  const user = { id: newId(), name: str(b.name).trim() || ROLES.find((r) => r.key === b.role).label, email: b.email.trim(), role: b.role, created_at: now(), password_hash: await hashPassword(b.password) };
  state.users.push(user);
  return { id: user.id };
});
route('PATCH', '/users/:id', async ({ id }, b) => {
  need('manageUsers');
  const user = state.users.find((u) => u.id === id) ?? fail(404, 'Gebruiker niet gevonden.');
  if (b?.role && !ROLE_KEYS.includes(b.role)) fail(400, 'Onbekende rol.');
  const disabled = b?.disabled == null ? Boolean(user.disabled) : Boolean(b.disabled);
  const otherActiveAdmins = state.users.filter((u) => u.role === 'admin' && !u.disabled && u.id !== user.id).length;
  if (user.role === 'admin' && !user.disabled && ((b?.role && b.role !== 'admin') || disabled) && otherActiveAdmins === 0) {
    fail(400, 'Er moet minimaal één actief Chefkes-account blijven.');
  }
  if (disabled && user.id === currentUser().id) fail(400, 'Je kunt je eigen account niet uitzetten.');
  if (b?.password && str(b.password).length < 10) fail(400, 'Wachtwoord moet minimaal 10 tekens zijn.');
  const email = b?.email == null ? user.email : str(b.email, 200).trim();
  if (!email.includes('@')) fail(400, 'Vul een geldig e-mailadres in.');
  if (state.users.some((u) => u.id !== user.id && u.email.toLowerCase() === email.toLowerCase())) fail(409, 'Dit e-mailadres bestaat al.');
  Object.assign(user, { name: str(b?.name).trim() || user.name, role: b?.role ?? user.role, email, disabled });
  if (b?.password) user.password_hash = await hashPassword(b.password);
  return { ok: true };
});

// Profielfoto's: in de browserversie als kleine afbeelding (data-URL) bewaard.
function avatarImage(image) {
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(str(image, 1_500_000))) fail(400, 'Kies een foto (JPG, PNG of WebP).');
  return image;
}
const avatarUser = (id) => {
  if (id !== currentUser().id && !can('manageUsers')) fail(403, 'Je kunt alleen je eigen profielfoto wijzigen.');
  return state.users.find((u) => u.id === id) ?? fail(404, 'Gebruiker niet gevonden.');
};
route('PUT', '/clients/:id/avatar', ({ id }, b) => { need('manageClients'); const c = clientOr404(id); c.avatar_url = avatarImage(b?.image); return { avatar_url: c.avatar_url }; });
route('DELETE', '/clients/:id/avatar', ({ id }) => { need('manageClients'); clientOr404(id).avatar_url = null; return { avatar_url: null }; });
route('PUT', '/users/:id/avatar', ({ id }, b) => { const u = avatarUser(id); u.avatar_url = avatarImage(b?.image); return { avatar_url: u.avatar_url }; });
route('DELETE', '/users/:id/avatar', ({ id }) => { avatarUser(id).avatar_url = null; return { avatar_url: null }; });

// Nieuw sinds je laatste bezoek (bolletjes)
const SECTIONS = ['kalender', 'planning', 'media'];
const seenAt = (clientId, section) => state.seen[`${currentUser().id}|${clientId}|${section}`] ?? currentUser().created_at;
const seenItemAt = (i) => { const v = state.seenItems[`${currentUser().id}|${i.id}`]; return typeof v === 'string' ? v : v ? '0' : null; };
// Nieuw: door een ander gemaakt en nog niet gezien, of een nieuwe reactie van een ander sinds je de post zag.
const isUnseenPost = (i) => (i.created_by !== currentUser().id && i.created_at > currentUser().created_at && !seenItemAt(i))
  || (state.comments ?? []).some((c) => c.calendar_item_id === i.id && c.user_id !== currentUser().id && c.created_at > (seenItemAt(i) ?? currentUser().created_at));
function newsFor(clientId) {
  const me = currentUser().id;
  const after = (section) => (x, by, at) => x.client_id === clientId && x[by] !== me && x[at] > seenAt(clientId, section);
  return {
    kalender: state.calendar.filter((i) => isUnseenPost(i) && i.client_id === clientId).length,
    planning: state.inputs.filter((i) => after('planning')(i, 'created_by', 'created_at')).length
      + state.plans.filter((p) => p.clientId === clientId && p.createdBy && p.createdBy !== me && p.createdAt > seenAt(clientId, 'planning')).length,
    media: state.media.filter((m) => after('media')(m, 'uploaded_by', 'uploaded_at')).length,
  };
}
route('POST', '/clients/:id/seen', ({ id }, b) => {
  clientOr404(id);
  if (!SECTIONS.includes(b?.section)) fail(400, 'Onbekend onderdeel.');
  if (b.section === 'kalender') {
    for (const itemId of b.ids ?? []) if (state.calendar.some((i) => i.id === itemId && i.client_id === id)) state.seenItems[`${currentUser().id}|${itemId}`] = now();
    return { ok: true };
  }
  state.seen[`${currentUser().id}|${id}|${b.section}`] = now();
  return { ok: true };
});
route('POST', '/clients/:id/duplicate', ({ id }) => {
  need('manageClients');
  const c = clientOr404(id);
  let name = `${c.name} (kopie)`;
  for (let i = 2; nameTaken(name); i++) name = `${c.name} (kopie ${i})`;
  const copy = { ...structuredClone(c), id: newId(), name, archived: false, avatar_url: null, created_at: now() };
  state.clients.push(copy);
  return structuredClone(copy);
});

// Klanten
const clientCounts = (c) => {
  const today = new Date().toISOString().slice(0, 10);
  return {
    open_inputs: state.inputs.filter((i) => i.client_id === c.id && !i.processed).length,
    open_plans: state.plans.filter((p) => p.clientId === c.id && ['concept', 'in_controle', 'aanpassen', 'goedgekeurd'].includes(p.status)).length,
    action_needed: state.calendar.filter((i) => i.client_id === c.id && i.publish_date >= today && i.status === 'placeholder_actie_nodig').length,
    post_count: state.calendar.filter((i) => i.client_id === c.id).length,
    news: newsFor(c.id),
  };
};
const nameTaken = (name, exceptId) => state.clients.some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());
function clientFields(body, current = {}) {
  const rawChannels = body.channels ?? current.channels ?? [];
  if (!Array.isArray(rawChannels)) fail(400, 'Onbekend kanaal.');
  const channels = rawChannels.filter((c) => CHANNEL_KEYS.includes(c));
  const ppw = Number(body.posts_per_week ?? current.posts_per_week ?? 3);
  if (!Number.isInteger(ppw) || ppw < 1 || ppw > 21) fail(400, 'Publicatiefrequentie moet tussen 1 en 21 per week liggen.');
  const name = str(body.name ?? current.name, 200).trim() || fail(400, 'Naam is verplicht.');
  return {
    name, strategy: str(body.strategy ?? current.strategy ?? ''), tone_of_voice: str(body.tone_of_voice ?? current.tone_of_voice ?? ''),
    content_pillars: (body.content_pillars ?? current.content_pillars ?? []).map((p) => str(p, 100).trim()).filter(Boolean),
    channels, posts_per_week: ppw, ai_memory: str(body.ai_memory ?? current.ai_memory ?? ''), archived: Boolean(body.archived ?? current.archived),
    context: str(body.context ?? current.context ?? ''), target_audience: str(body.target_audience ?? current.target_audience ?? '', 5000),
    website: str(body.website ?? current.website ?? '', 300).trim(), contact: str(body.contact ?? current.contact ?? '', 500),
    branches: cleanBranches(body.branches ?? current.branches ?? [], fail),
    own_days: cleanOwnDays(body.own_days ?? current.own_days ?? [], fail),
    recurring: cleanRecurring(body.recurring ?? current.recurring ?? [], CHANNEL_KEYS, fail),
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
    state.clients.push({ id: newId(), ...f, name, content_pillars: [], strategy: '', tone_of_voice: '', ai_memory: '', context: '', target_audience: '', website: '', contact: '', archived: false, created_at: now() });
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
  c.archived_at = c.archived ? (c.archived_at ?? now()) : null;
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
  need('manageMedia');
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
      size_bytes: f.size, description: isVideo ? 'Video is alleen tijdens deze sessie zichtbaar.' : '', tags: [],
      has_recognizable_faces: null, ai_processing_allowed: 0, uploaded_by: currentUser().id, uploaded_at: now(), src,
    });
    ids.push(mediaId);
  }
  return { ids };
});
route('PATCH', '/media/:id', ({ id }, b) => {
  need('manageMedia');
  const m = mediaOr404(id);
  if (Array.isArray(b?.tags)) m.tags = b.tags.map((t) => str(t, 50).trim()).filter(Boolean);
  if ('description' in (b ?? {})) m.description = str(b.description, 1000);
  if ('has_recognizable_faces' in (b ?? {})) m.has_recognizable_faces = b.has_recognizable_faces === null ? null : b.has_recognizable_faces ? 1 : 0;
  if ('ai_processing_allowed' in (b ?? {})) m.ai_processing_allowed = b.ai_processing_allowed ? 1 : 0;
  return { ok: true };
});
route('DELETE', '/media/:id', ({ id }, b) => {
  need('manageMedia');
  const m = mediaOr404(id);
  const linked = state.calendar.filter((i) => i.media.includes(id));
  if (linked.length && b?.force !== true) fail(409, `Dit beeld zit in ${linked.length} post${linked.length === 1 ? '' : 's'} in de kalender.`, { linked: linked.length });
  for (const item of linked) {
    saveVersion(item, `Beeld ${m.filename} verwijderd uit de bibliotheek`);
    item.media = item.media.filter((x) => x !== id);
  }
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
    addedToCalendarAt: null, createdAt: now(), createdBy: currentUser().id,
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
  if (plan.status === PLAN_STATUS.TOEGEVOEGD) fail(409, 'Deze planning staat al in de kalender.');
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
    .sort((a, b) => a.publish_date.localeCompare(b.publish_date) || a.channel.localeCompare(b.channel)).map(mapItem)
    .map((i) => ({ ...i, is_new: isUnseenPost(state.calendar.find((x) => x.id === i.id)) }));
  const assignees = [...new Set(state.calendar.map((i) => i.assignee).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { from, to, items, assignees };
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
    pillar: str(b.content_pillar, 100).trim(), sourceInfo: str(b.source_info), notes: str(b.internal_notes), status: b.status ?? initialStatus({ body: b.body, media }),
    assignee: b.assignee, media,
  });
  return mapItem(item);
});
route('POST', '/clients/:id/calendar/batch', ({ id }, b) => {
  need('editContent');
  clientOr404(id);
  if (!isDate(b?.date)) fail(400, 'Kies een geldige datum.');
  const posts = (Array.isArray(b.posts) ? b.posts : []).filter((p) => CHANNEL_KEYS.includes(p?.channel));
  if (!posts.length) fail(400, 'Kies minimaal één kanaal.');
  if (new Set(posts.map((p) => p.channel)).size !== posts.length) fail(400, 'Elk kanaal kan maar één keer.');
  const taken = posts.filter((p) => cellTaken(id, b.date, p.channel));
  if (taken.length) {
    fail(409, `Op deze datum staat al een post op ${taken.map((p) => CHANNELS.find((c) => c.key === p.channel).label).join(' en ')}. Haal dat kanaal weg of kies een andere datum.`, { takenChannels: taken.map((p) => p.channel) });
  }
  const media = Array.isArray(b.media) ? b.media : [];
  const items = posts.map((p) => insertItem({
    clientId: id, date: b.date, time: optTime(b.time), channel: p.channel, body: str(p.body), topic: str(b.topic, 300),
    pillar: str(b.content_pillar, 100).trim(), sourceInfo: str(b.source_info), notes: str(b.internal_notes),
    status: b.status ?? initialStatus({ body: p.body, media }), assignee: b.assignee, media,
  }));
  return { items: items.map(mapItem) };
});
route('GET', '/calendar/:id', ({ id }) => {
  const item = itemOr404(id);
  const versions = state.versions.filter((v) => v.calendar_item_id === id).sort((a, b) => b.changed_at.localeCompare(a.changed_at))
    .map((v) => ({ id: v.id, reason: v.reason, changed_by_ai: v.changed_by_ai, changed_at: v.changed_at, changed_by_name: userName(v.changed_by) }));
  return { ...mapItem(item), versions, comments: commentsOf(id) };
});

// Reacties met @vermeldingen
function commentsOf(itemId) {
  return (state.comments ?? []).filter((c) => c.calendar_item_id === itemId).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((c) => {
    const u = state.users.find((x) => x.id === c.user_id);
    return { ...c, mine: c.user_id === currentUser().id, user_name: u?.name ?? 'Verwijderd account', avatar_url: u?.avatar_url ?? null };
  });
}
route('POST', '/calendar/:id/comments', ({ id }, b) => {
  const item = itemOr404(id);
  const body = str(b?.body, 2000).trim() || fail(400, 'Schrijf eerst een reactie.');
  const lower = body.toLowerCase();
  const mentions = state.users.filter((u) => !u.disabled && u.id !== currentUser().id && lower.includes(`@${u.name.toLowerCase()}`)).map((u) => u.id);
  state.comments ??= [];
  state.comments.push({ id: newId(), calendar_item_id: item.id, user_id: currentUser().id, body, mentions, created_at: now() });
  state.seenItems[`${currentUser().id}|${item.id}`] = now();
  return commentsOf(item.id);
});
route('DELETE', '/comments/:id', ({ id }) => {
  const c = (state.comments ?? []).find((x) => x.id === id) ?? fail(404, 'Reactie niet gevonden.');
  if (c.user_id !== currentUser().id && !can('manageUsers')) fail(403, 'Je kunt alleen je eigen reacties verwijderen.');
  state.comments = state.comments.filter((x) => x.id !== id);
  return commentsOf(c.calendar_item_id);
});
route('GET', '/vermeldingen', () => (state.comments ?? [])
  .filter((c) => c.mentions.includes(currentUser().id) && c.user_id !== currentUser().id)
  .map((c) => ({ c, item: state.calendar.find((i) => i.id === c.calendar_item_id) }))
  .filter(({ c, item }) => item && !clientOr404(item.client_id).archived && c.created_at > (seenItemAt(item) ?? ''))
  .sort((a, b) => b.c.created_at.localeCompare(a.c.created_at))
  .map(({ c, item }) => ({ id: c.id, body: c.body, created_at: c.created_at, user_name: userName(c.user_id), item_id: item.id, publish_date: item.publish_date,
    channel: item.channel, topic: item.topic, client_id: item.client_id, client_name: clientOr404(item.client_id).name })));

// Eigen wachtwoord wijzigen
route('POST', '/account/password', async (_, b) => {
  const user = currentUser();
  if (user.password_hash !== await hashPassword(str(b?.current))) fail(400, 'Je huidige wachtwoord klopt niet.');
  if (str(b?.password).length < 10) fail(400, 'Het nieuwe wachtwoord moet minimaal 10 tekens zijn.');
  user.password_hash = await hashPassword(b.password);
  user.demoAccount = false; // het getoonde wachtwoord op het inlogscherm klopt dan niet meer
  return { ok: true };
});

// Aandacht nodig
route('GET', '/aandacht', () => {
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + ATTENTION_DAYS * 86400000).toISOString().slice(0, 10);
  const items = state.calendar.filter((i) => !clientOr404(i.client_id).archived)
    .map((i) => ({ i, missing: needsAttention(i, today, until) })).filter((x) => x.missing)
    .sort((a, b) => a.i.publish_date.localeCompare(b.i.publish_date))
    .map(({ i, missing }) => ({ id: i.id, client_id: i.client_id, client_name: clientOr404(i.client_id).name, publish_date: i.publish_date, channel: i.channel, topic: i.topic, status: i.status, missing }));
  return { days: ATTENTION_DAYS, items };
});

// Afspraak tegenover geleverd
const reportFor = (month) => {
  if (!/^\d{4}-\d{2}$/.test(month ?? '')) fail(400, 'Kies een maand.');
  return buildReport(state.clients, state.calendar, month);
};
route('GET', '/rapportage', (_, __, q) => { need('manageClients'); return { month: q.get('maand'), rows: reportFor(q.get('maand')) }; });
route('GET', '/rapportage.xlsx', async (_, __, q) => {
  need('manageClients');
  const { exportReport } = await excel();
  return { file: true, filename: `Afspraken_${q.get('maand')}.xlsx`, data: new Uint8Array(await exportReport({ month: q.get('maand'), rows: reportFor(q.get('maand')) })) };
});

// Klantgeheugen: afspraken laten voorstellen (vaste regels, zonder AI)
route('POST', '/clients/:id/afspraken-voorstel', ({ id }) => {
  need('manageClients');
  const client = clientOr404(id);
  const own = state.calendar.filter((i) => i.client_id === id);
  const pairs = [];
  for (const it of own) {
    const versions = state.versions.filter((v) => v.calendar_item_id === it.id).sort((a, b) => a.changed_at.localeCompare(b.changed_at));
    const aiAt = versions.findIndex((v) => v.changed_by_ai);
    const humanAfter = aiAt >= 0 ? versions.slice(aiAt + 1).find((v) => !v.changed_by_ai) : null;
    if (humanAfter && humanAfter.snapshot.body && humanAfter.snapshot.body !== it.body) pairs.push({ ai: humanAfter.snapshot.body, human: it.body });
  }
  const notes = [
    ...own.filter((i) => i.internal_notes).map((i) => ({ text: i.internal_notes, source: 'Uit een interne opmerking bij een post' })),
    ...state.inputs.filter((i) => i.client_id === id && i.instructions).map((i) => ({ text: i.instructions, source: 'Uit een instructie bij klantinput' })),
  ];
  return { suggestions: exampleMemory({ client, pairs, notes }), basedOn: { edits: pairs.length, notes: notes.length } };
});

// Terugkerende posts (optie per klant)
function recurringFor(client, month) {
  if (!/^\d{4}-\d{2}$/.test(month ?? '')) fail(400, 'Kies een maand.');
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const taken = new Set(state.calendar.filter((i) => i.client_id === client.id && i.publish_date >= from && i.publish_date <= to).map((i) => `${i.publish_date}|${i.channel}`));
  const posts = [];
  const skipped = [];
  for (const rule of (client.recurring ?? []).filter((r) => r.active)) {
    for (const date of recurringDates(rule, from, to)) {
      for (const channel of rule.channels) {
        const entry = { date, channel, title: rule.title, time: rule.time, pillar: rule.pillar, rhythm: describeRhythm(rule) };
        if (taken.has(`${date}|${channel}`)) skipped.push(entry);
        else { posts.push(entry); taken.add(`${date}|${channel}`); }
      }
    }
  }
  return { posts, skipped };
}
route('GET', '/clients/:id/terugkerend', ({ id }, _, q) => recurringFor(clientOr404(id), q.get('maand')));
route('POST', '/clients/:id/terugkerend', ({ id }, b) => {
  need('editContent');
  const { posts, skipped } = recurringFor(clientOr404(id), b?.maand);
  for (const p of posts) {
    insertItem({ clientId: id, date: p.date, time: p.time, channel: p.channel, body: '', topic: p.title, pillar: p.pillar,
      sourceInfo: `Terugkerende post: ${p.rhythm.toLowerCase()}`, notes: '', status: 'placeholder_actie_nodig' });
  }
  return { created: posts.length, skipped: skipped.length };
});
route('PATCH', '/calendar/:id', ({ id }, b) => {
  if (!can('updateStatus') && !can('editContent')) fail(403, 'Je hebt geen rechten voor deze actie.');
  const item = itemOr404(id);
  const contentFields = ['publish_date', 'suggested_time', 'channel', 'body', 'topic', 'content_pillar', 'source_info', 'assignee', 'media'];
  if (!can('editContent') && contentFields.some((f) => f in (b ?? {}))) fail(403, 'Met jouw rechten kun je alleen de status en interne opmerkingen aanpassen.');
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
    content_pillar: 'content_pillar' in b ? str(b.content_pillar, 100).trim() || null : item.content_pillar,
    source_info: 'source_info' in b ? str(b.source_info) : item.source_info,
    internal_notes: 'internal_notes' in b ? str(b.internal_notes) : item.internal_notes,
    status: b.status ?? item.status,
    assignee: 'assignee' in b ? str(b.assignee, 100).trim() : item.assignee,
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
    content_pillar: s.content_pillar ?? null, source_info: s.source_info, internal_notes: s.internal_notes, status: s.status, assignee: s.assignee ?? '', updated_at: now(),
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
// Excel: dezelfde export- en importcode als de server, met ExcelJS in de browser (pas geladen bij gebruik).
let excelModule = null;
async function excel() {
  if (!globalThis.ExcelJS) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/demo/lib/exceljs.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new HttpError(503, 'Excel kon niet worden geladen. Vernieuw de pagina en probeer het opnieuw.'));
      document.head.append(s);
    });
  }
  excelModule ??= await import('./lib/excel.js');
  return excelModule;
}
route('GET', '/clients/:id/export.xlsx', async ({ id }, _, q) => {
  const client = clientOr404(id);
  const today = new Date().toISOString().slice(0, 10);
  const from = isDate(q.get('from')) ? q.get('from') : `${today.slice(0, 7)}-01`;
  const to = isDate(q.get('to')) ? q.get('to') : from;
  const items = state.calendar.filter((i) => i.client_id === id && i.publish_date >= from && i.publish_date <= to)
    .sort((a, b) => a.publish_date.localeCompare(b.publish_date) || a.channel.localeCompare(b.channel)).map(mapItem);
  const { exportCalendar } = await excel();
  const data = new Uint8Array(await exportCalendar({ client, items, from, to }));
  return { file: true, filename: `Contentkalender_${client.name.replace(/[^\w-]+/g, '_')}_${from}_${to}.xlsx`, data };
});
route('POST', '/clients/:id/import', async ({ id }, b) => {
  need('editContent');
  const client = clientOr404(id);
  const file = b instanceof FormData ? b.get('file') : null;
  if (!file || typeof file === 'string') fail(400, 'Kies een Excel-bestand (.xlsx).');
  const { parseCalendarWorkbook } = await excel();
  let parsed;
  try {
    parsed = await parseCalendarWorkbook(await file.arrayBuffer());
  } catch {
    fail(400, 'Dit bestand kon niet als Excel (.xlsx) worden gelezen.');
  }
  const existing = new Map(state.calendar.filter((i) => i.client_id === client.id).map((i) => [cellKey(i.publish_date, i.channel), i]));
  const seenKeys = new Set();
  const rows = parsed.rows.filter((r) => {
    const k = cellKey(r.date, r.channel);
    if (seenKeys.has(k)) { parsed.errors.push(`Rij ${r.row}: dubbele combinatie van datum en kanaal, overgeslagen.`); return false; }
    seenKeys.add(k);
    return true;
  }).map((r) => ({ ...r, key: cellKey(r.date, r.channel), exists: existing.has(cellKey(r.date, r.channel)) }));
  if (b.get('confirm') !== 'true') return { rows, errors: parsed.errors };

  let overwrite;
  try { overwrite = new Set(JSON.parse(b.get('overwrite') ?? '[]')); } catch { overwrite = new Set(); }
  let created = 0;
  let replaced = 0;
  let skipped = 0;
  for (const r of rows) {
    const status = r.status ?? initialStatus({ body: r.body, media: [] });
    if (!r.exists) {
      insertItem({ clientId: client.id, date: r.date, time: r.time, channel: r.channel, body: r.body, topic: r.topic, pillar: r.pillar,
        sourceInfo: r.source, notes: r.notes, assignee: r.assignee, status });
      created++;
    } else if (overwrite.has(r.key)) {
      const item = existing.get(r.key);
      saveVersion(item, 'Vervangen via Excel-import (expliciet gekozen)');
      Object.assign(item, { suggested_time: r.time, body: r.body, topic: r.topic, content_pillar: r.pillar || null, source_info: r.source,
        internal_notes: r.notes, status, updated_at: now() });
      replaced++;
    } else {
      skipped++;
    }
  }
  return { created, replaced, skipped, errors: parsed.errors };
});

// Contentshoots
route('GET', '/clients/:id/shoots', ({ id }) => {
  clientOr404(id);
  return state.shoots.filter((s) => s.client_id === id).map((s) => ({ planned_date: null, ...s, done: Boolean(s.done) }))
    .sort((a, b) => Number(a.done) - Number(b.done) || Number(!a.planned_date) - Number(!b.planned_date)
      || (a.planned_date ?? '').localeCompare(b.planned_date ?? '') || b.created_at.localeCompare(a.created_at));
});
route('POST', '/clients/:id/shoots', ({ id }) => {
  need('managePlans');
  const client = clientOr404(id);
  const suggestions = exampleShoots(client);
  for (const s of suggestions) state.shoots.push({ id: newId(), client_id: id, title: s.title, body: s.body, ai_source: 'voorbeeld', planned_date: s.date ?? null, done: false, created_at: now() });
  return { count: suggestions.length };
});
const shootDate = (s) => (s ? (isDate(s) ? s : fail(400, `Ongeldige datum: ${s}`)) : null);
route('POST', '/clients/:id/shoots/eigen', ({ id }, b) => {
  need('managePlans');
  clientOr404(id);
  const title = str(b?.title, 200).trim() || fail(400, 'Geef de shoot een titel.');
  const shoot = { id: newId(), client_id: id, title, body: str(b?.body, 5000), ai_source: 'handmatig', planned_date: shootDate(b?.planned_date), done: false, created_at: now() };
  state.shoots.push(shoot);
  return { id: shoot.id };
});
route('PATCH', '/shoots/:id', ({ id }, b) => {
  need('managePlans');
  const shoot = state.shoots.find((s) => s.id === id) ?? fail(404, 'Contentshoot niet gevonden.');
  if (b?.title != null) shoot.title = str(b.title, 200).trim() || fail(400, 'Geef de shoot een titel.');
  if (b?.body != null) shoot.body = str(b.body, 5000);
  if (b?.planned_date !== undefined) shoot.planned_date = shootDate(b.planned_date);
  if (b?.done != null) shoot.done = Boolean(b.done);
  return { ...shoot };
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
    if (!PUBLIC.has(`${method} ${path}`) && !currentUser()) return { status: 401, body: { error: 'Log eerst in.' } };
    try {
      const result = await r.handler(params, body, query);
      if (method !== 'GET') persist();
      return { status: method === 'POST' && /\/(clients|users|inputs|media|calendar|plans|shoots|bulk|whatsapp)$/.test(path) ? 201 : 200, body: structuredClone(result) };
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, body: { error: err.message, ...err.extra } };
      if (err instanceof PlanError) return { status: 409, body: { error: err.message, conflicts: err.conflicts } };
      console.error(err);
      return { status: 500, body: { error: 'Er ging iets mis. Vernieuw de pagina en probeer het opnieuw.' } };
    }
  }
  return { status: 404, body: { error: 'Onbekende route.' } };
}
