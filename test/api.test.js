// Doorloopt de volledige JSS-workflow via de API, zonder AI-sleutel (voorbeeldgenerator).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jcs-test-'));
process.env.JCS_DATA_DIR = dataDir;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const { openDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

let server;
let base;

before(async () => {
  server = createApp(openDb(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function agent() {
  let cookie = '';
  return async (method, url, body, { form } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(cookie && { cookie }), ...(body && !form && { 'content-type': 'application/json' }) },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.arrayBuffer() };
  };
}

const admin = agent();
const designer = agent();
let clientId;
let planId;

test('eerste beheerder inrichten en daarna niet opnieuw', async () => {
  assert.equal((await admin('GET', '/api/meta')).body.needsSetup, true);
  assert.equal((await admin('POST', '/api/setup', { name: 'Beheer', email: 'beheer@jss.nl', password: 'geheim-wachtwoord' })).status, 201);
  assert.equal((await agent()('POST', '/api/setup', { name: 'X', email: 'x@x.nl', password: 'geheim-wachtwoord' })).status, 403);
  assert.equal((await agent()('GET', '/api/clients')).status, 401);
});

test('vormgever aanmaken; vormgever mag geen planning goedkeuren', async () => {
  assert.equal((await admin('POST', '/api/users', { name: 'Vera', email: 'vera@jss.nl', role: 'vormgever', password: 'nog-een-wachtwoord' })).status, 201);
  assert.equal((await designer('POST', '/api/login', { email: 'vera@jss.nl', password: 'nog-een-wachtwoord' })).status, 200);
});

test('klant met strategie, kanalen en frequentie', async () => {
  const res = await admin('POST', '/api/clients', {
    name: 'Bakkerij De Vries', strategy: 'Ambacht en buurtgevoel', content_pillars: ['Vakmanschap', 'Team', 'Aanbod'],
    channels: ['instagram', 'facebook', 'linkedin'], posts_per_week: 2,
  });
  assert.equal(res.status, 201);
  clientId = res.body.id;
});

test('klantinput, WhatsApp-import en media-upload', async () => {
  assert.equal((await admin('POST', `/api/clients/${clientId}/inputs`, { title: 'Kerstbrood', body: 'Vanaf 1 december kerstbrood met amandelspijs.' })).status, 201);
  const chat = '[12-11-2026 09:15:02] Jan de Vries: Foto\'s van de nieuwe oven gestuurd\n[12-11-2026 09:16:10] Jan de Vries: <Media weggelaten>\n12-11-2026 10:00 - Sanne: Zaterdag open dag!\nVanaf 10 uur.';
  const form = new FormData();
  form.append('file', new Blob([chat], { type: 'text/plain' }), 'chat.txt');
  const wa = await admin('POST', `/api/clients/${clientId}/inputs/whatsapp`, null, { form });
  assert.equal(wa.status, 201);
  assert.equal(wa.body.count, 2);

  const upload = new FormData();
  upload.append('files', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'oven.jpg');
  upload.append('files', new Blob([Buffer.from('x')], { type: 'text/plain' }), 'geen-beeld.txt');
  const media = await admin('POST', `/api/clients/${clientId}/media`, null, { form: upload });
  assert.equal(media.status, 201);
  assert.equal(media.body.ids.length, 1, 'alleen beeld en video worden geaccepteerd');
  const list = (await admin('GET', `/api/clients/${clientId}/media`)).body;
  assert.equal(list[0].filename, 'oven.jpg');
  const dl = await designer('GET', list[0].download_url);
  assert.equal(dl.status, 200);
});

test('AI-conceptplanning komt NIET automatisch in de kalender', async () => {
  const res = await admin('POST', `/api/clients/${clientId}/plans`, { periodStart: '2026-12-01', periodEnd: '2026-12-31' });
  assert.equal(res.status, 201);
  planId = res.body.id;
  assert.equal(res.body.status, 'concept');
  assert.equal(res.body.aiSource, 'voorbeeld');
  assert.ok(res.body.items.length >= 8);
  const cal = (await admin('GET', `/api/clients/${clientId}/calendar?from=2026-12-01&to=2026-12-31`)).body;
  assert.equal(cal.items.length, 0);
});

test('goedkeuren kan pas vanuit controle, en niet door een vormgever', async () => {
  assert.equal((await admin('POST', `/api/plans/${planId}/approve`, {})).status, 409);
  assert.equal((await admin('POST', `/api/plans/${planId}/submit`)).body.status, 'in_controle');
  assert.equal((await designer('POST', `/api/plans/${planId}/approve`, {})).status, 403);
});

test('handmatige post blokkeert een cel; conflict moet expliciet worden opgelost', async () => {
  const plan = (await admin('GET', `/api/plans/${planId}`)).body;
  const first = plan.items[0];
  const manual = await admin('POST', `/api/clients/${clientId}/calendar`, { date: first.date, channel: 'instagram', body: 'Handmatige post' });
  assert.equal(manual.status, 201);
  assert.equal((await admin('POST', `/api/clients/${clientId}/calendar`, { date: first.date, channel: 'instagram', body: 'Nog een' })).status, 409);

  const blocked = await admin('POST', `/api/plans/${planId}/approve`, {});
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.conflicts.length, 1);
  assert.equal((await admin('GET', `/api/plans/${planId}`)).body.status, 'in_controle', 'zonder keuze verandert er niets');

  const key = blocked.body.conflicts[0].key;
  const ok = await admin('POST', `/api/plans/${planId}/approve`, { resolutions: { [key]: 'skip' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.plan.status, 'toegevoegd_aan_kalender');
  assert.equal(ok.body.placed, plan.items.length * 3 - 1);
  assert.equal(ok.body.textsFilled, ok.body.placed);

  const cal = (await admin('GET', `/api/clients/${clientId}/calendar?from=2026-12-01&to=2026-12-31`)).body.items;
  const kept = cal.find((c) => c.publish_date === first.date && c.channel === 'instagram');
  assert.equal(kept.body, 'Handmatige post', 'bestaande content is niet overschreven');
  const sameDay = cal.filter((c) => c.publish_date === first.date);
  assert.deepEqual(sameDay.map((c) => c.channel).sort(), ['facebook', 'instagram', 'linkedin']);
});

test('na "Nieuwe verdeling voorstellen" is opnieuw akkoord nodig', async () => {
  const res = await admin('POST', `/api/clients/${clientId}/plans`, { periodStart: '2027-01-01', periodEnd: '2027-01-31' });
  const id = res.body.id;
  await admin('POST', `/api/plans/${id}/submit`);
  const approved = await admin('POST', `/api/plans/${id}/approve`, { reviewTextsFirst: true });
  assert.equal(approved.body.plan.status, 'goedgekeurd');
  assert.ok(approved.body.plan.items.every((i) => Object.keys(i.texts).length === 3), 'conceptteksten per kanaal');

  const redistributed = await admin('POST', `/api/plans/${id}/redistribute`, {});
  assert.equal(redistributed.body.status, 'in_controle');
  assert.equal(redistributed.body.approvedBy, null);
  assert.equal((await admin('POST', `/api/plans/${id}/add-to-calendar`, {})).status, 409);
});

test('vormgever mag status en opmerkingen aanpassen, maar geen tekst', async () => {
  const cal = (await designer('GET', `/api/clients/${clientId}/calendar?from=2026-12-01&to=2026-12-31`)).body.items;
  const item = cal[0];
  assert.equal((await designer('PATCH', `/api/calendar/${item.id}`, { body: 'Andere tekst' })).status, 403);
  const ok = await designer('PATCH', `/api/calendar/${item.id}`, { status: 'volledig_ingepland', internal_notes: 'Ingepland in Meta' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'volledig_ingepland');
  const detail = (await admin('GET', `/api/calendar/${item.id}`)).body;
  assert.ok(detail.versions.length >= 2, 'versiegeschiedenis bijgehouden');
});

test('Excel-export en -import zonder ongemerkt overschrijven', async () => {
  const xlsx = await admin('GET', `/api/clients/${clientId}/export.xlsx?from=2026-12-01&to=2026-12-31`);
  assert.equal(xlsx.status, 200);
  const form = () => {
    const f = new FormData();
    f.append('file', new Blob([xlsx.body]), 'kalender.xlsx');
    return f;
  };
  const preview = await admin('POST', `/api/clients/${clientId}/import`, null, { form: form() });
  assert.ok(preview.body.rows.length > 0);
  assert.ok(preview.body.rows.every((r) => r.exists));
  const f = form();
  f.append('confirm', 'true');
  const applied = await admin('POST', `/api/clients/${clientId}/import`, null, { form: f });
  assert.equal(applied.body.created, 0);
  assert.equal(applied.body.replaced, 0);
  assert.equal(applied.body.skipped, preview.body.rows.length);
});

test('beveiliging: mediabestanden in sandbox, inlogpogingen begrensd', async () => {
  const list = (await admin('GET', `/api/clients/${clientId}/media`)).body;
  const res = await fetch(base + list[0].url, { method: 'HEAD' });
  assert.equal(res.status, 401, 'niet zonder inloggen');
  const anon = agent();
  let last;
  for (let i = 0; i < 11; i++) last = await anon('POST', '/api/login', { email: 'beheer@jss.nl', password: 'fout' });
  assert.equal(last.status, 429);
});

test('klanten beheren: lijst toevoegen, hernoemen, archiveren en verwijderen', async () => {
  const bulk = await admin('POST', '/api/clients/bulk', { names: ['Mutsaars Bikes', 'De Kroeg', 'de kroeg', '', 'Bakkerij De Vries'], channels: ['instagram'], posts_per_week: 2 });
  assert.equal(bulk.status, 201);
  assert.deepEqual(bulk.body.created, ['Mutsaars Bikes', 'De Kroeg']);
  assert.deepEqual(bulk.body.skipped, ['Bakkerij De Vries'], 'bestaande naam wordt overgeslagen');

  const all = (await admin('GET', '/api/clients')).body;
  const kroeg = all.find((c) => c.name === 'De Kroeg');
  assert.deepEqual(kroeg.channels, ['instagram']);
  assert.equal(kroeg.posts_per_week, 2);

  assert.equal((await admin('PATCH', `/api/clients/${kroeg.id}`, { name: 'mutsaars bikes' })).status, 409, 'geen dubbele namen');
  assert.equal((await admin('PATCH', `/api/clients/${kroeg.id}`, { name: 'Café De Kroeg' })).body.name, 'Café De Kroeg');
  assert.equal((await designer('PATCH', `/api/clients/${kroeg.id}`, { name: 'X' })).status, 403);

  // Verwijderen kan alleen met de exacte naam, en neemt kalender, planningen en beeld mee.
  await admin('POST', `/api/clients/${kroeg.id}/calendar`, { date: '2026-12-01', channel: 'instagram', body: 'Proost' });
  const upload = new FormData();
  upload.append('files', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'bar.jpg');
  const [mediaId] = (await admin('POST', `/api/clients/${kroeg.id}/media`, null, { form: upload })).body.ids;
  const item = (await admin('GET', `/api/clients/${kroeg.id}/calendar?from=2026-12-01&to=2026-12-31`)).body.items[0];
  await admin('PATCH', `/api/calendar/${item.id}`, { media: [mediaId] });

  assert.equal((await admin('DELETE', `/api/clients/${kroeg.id}`, { confirmName: 'De Kroeg' })).status, 400);
  assert.equal((await designer('DELETE', `/api/clients/${kroeg.id}`, { confirmName: 'Café De Kroeg' })).status, 403);
  assert.equal((await admin('DELETE', `/api/clients/${kroeg.id}`, { confirmName: 'Café De Kroeg' })).status, 200);
  assert.equal((await admin('GET', `/api/clients/${kroeg.id}`)).status, 404);
  assert.equal((await admin('GET', `/api/calendar/${item.id}`)).status, 404);
  assert.ok(!fs.existsSync(path.join(dataDir, 'uploads', kroeg.id)) || fs.readdirSync(path.join(dataDir, 'uploads', kroeg.id)).length === 0);
});

test('klantcontext en contentpijler per post', async () => {
  const c = (await admin('POST', '/api/clients', { name: 'Context Test', channels: ['instagram'], content_pillars: ['Team', 'Aanbod'] })).body;
  const saved = (await admin('PATCH', `/api/clients/${c.id}`, { context: 'Familiebedrijf sinds 1974', target_audience: 'Gezinnen', website: 'www.voorbeeld.nl', contact: 'Jan' })).body;
  assert.equal(saved.context, 'Familiebedrijf sinds 1974');
  assert.equal(saved.target_audience, 'Gezinnen');
  assert.equal(saved.website, 'www.voorbeeld.nl');

  const post = (await admin('POST', `/api/clients/${c.id}/calendar`, { date: '2026-12-01', channel: 'instagram', body: 'Hoi', content_pillar: 'Team' })).body;
  assert.equal(post.content_pillar, 'Team');
  assert.equal((await admin('PATCH', `/api/calendar/${post.id}`, { content_pillar: '' })).body.content_pillar, null, 'pijler is optioneel');
  assert.equal((await designer('PATCH', `/api/calendar/${post.id}`, { content_pillar: 'Aanbod' })).status, 403);

  // Een goedgekeurde planning neemt de pijler mee naar de kalender.
  const plan = (await admin('POST', `/api/clients/${c.id}/plans`, { periodStart: '2027-02-01', periodEnd: '2027-02-28' })).body;
  await admin('POST', `/api/plans/${plan.id}/submit`);
  await admin('POST', `/api/plans/${plan.id}/approve`, {});
  const cal = (await admin('GET', `/api/clients/${c.id}/calendar?from=2027-02-01&to=2027-02-28`)).body.items;
  assert.ok(cal.length > 0 && cal.every((i) => ['Team', 'Aanbod'].includes(i.content_pillar)));
  assert.ok(cal.every((i) => !i.source_info.includes('Contentpijler')), 'pijler staat niet meer in de broninformatie');
});

test('rollen heten Chefkes, Social media manager, Branding en Stage', async () => {
  const roles = (await admin('GET', '/api/meta')).body.roles.map((r) => r.label);
  assert.deepEqual(roles, ['Chefkes', 'Social media manager', 'Branding', 'Stage']);
});

test('post op meerdere kanalen tegelijk, met eigen tekst per kanaal', async () => {
  const c = (await admin('POST', '/api/clients', { name: 'Batch Test', channels: ['instagram', 'facebook', 'linkedin'] })).body;
  const res = await admin('POST', `/api/clients/${c.id}/calendar/batch`, {
    date: '2026-12-10', time: '09:00', topic: 'Open dag', content_pillar: 'Buurt',
    posts: [{ channel: 'instagram', body: 'Kort ✨' }, { channel: 'linkedin', body: 'Zakelijke tekst' }],
  });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.items.map((i) => [i.channel, i.body, i.content_pillar]), [['instagram', 'Kort ✨', 'Buurt'], ['linkedin', 'Zakelijke tekst', 'Buurt']]);

  const clash = await admin('POST', `/api/clients/${c.id}/calendar/batch`, { date: '2026-12-10', posts: [{ channel: 'facebook', body: 'x' }, { channel: 'linkedin', body: 'y' }] });
  assert.equal(clash.status, 409);
  assert.deepEqual(clash.body.takenChannels, ['linkedin']);
  const cal = (await admin('GET', `/api/clients/${c.id}/calendar?from=2026-12-10&to=2026-12-10`)).body.items;
  assert.equal(cal.length, 2, 'bij een conflict wordt niets aangemaakt');
});

test('rechten per rol aanvinken; chefkes houden teambeheer', async () => {
  const meta = (await admin('GET', '/api/meta')).body;
  assert.ok(meta.permissions.updateStatus.includes('vormgever'));
  // Branding mag voortaan ook content bewerken
  const next = { ...meta.permissions, editContent: [...meta.permissions.editContent, 'vormgever'], manageUsers: [] };
  const saved = (await admin('PUT', '/api/permissions', { permissions: next })).body.permissions;
  assert.deepEqual(saved.manageUsers, ['admin'], 'chefkes kunnen zichzelf niet buitensluiten');
  const item = (await designer('GET', `/api/clients/${clientId}/calendar?from=2026-12-01&to=2026-12-31`)).body.items[0];
  assert.equal((await designer('PATCH', `/api/calendar/${item.id}`, { body: 'Nu wel' })).status, 200);
  assert.equal((await designer('PUT', '/api/permissions', { permissions: next })).status, 403);
  await admin('PUT', '/api/permissions', { permissions: meta.permissions });
  assert.equal((await designer('PATCH', `/api/calendar/${item.id}`, { body: 'Weer niet' })).status, 403);
});

test('rechten zijn logisch: status voor iedereen, afhankelijke rechten komen mee', async () => {
  const meta = (await admin('GET', '/api/meta')).body;
  assert.deepEqual(meta.channels.map((c) => c.key), ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube'], 'geen Pinterest en X');
  const saved = (await admin('PUT', '/api/permissions', {
    permissions: { ...meta.permissions, updateStatus: [], approvePlans: [...meta.permissions.approvePlans, 'medewerker'] },
  })).body.permissions;
  assert.equal(saved.updateStatus.length, 4, 'iedereen mag status wijzigen, ook naar Volledig ingepland');
  assert.ok(saved.managePlans.includes('medewerker') && saved.editContent.includes('medewerker'), 'goedkeuren neemt plannen en bewerken mee');
  await admin('PUT', '/api/permissions', { permissions: meta.permissions });
});

test('verantwoordelijke is een vrije naam, met voorstellen', async () => {
  const c = (await admin('POST', '/api/clients', { name: 'Assignee Test', channels: ['instagram'] })).body;
  const post = (await admin('POST', `/api/clients/${c.id}/calendar`, { date: '2026-12-02', channel: 'instagram', body: 'x', assignee: 'Lotte' })).body;
  assert.equal(post.assignee_name, 'Lotte');
  assert.equal((await admin('PATCH', `/api/calendar/${post.id}`, { assignee: 'Mark' })).body.assignee_name, 'Mark');
  const cal = (await admin('GET', `/api/clients/${c.id}/calendar?from=2026-12-01&to=2026-12-31`)).body;
  assert.ok(cal.assignees.includes('Mark'));
});

test('bolletje: nieuw toegevoegd door een ander account, weg na bekijken', async () => {
  const c = (await admin('POST', '/api/clients', { name: 'Nieuws Test', channels: ['instagram'] })).body;
  await new Promise((r) => setTimeout(r, 1100)); // tijden zijn op de seconde nauwkeurig
  await admin('POST', `/api/clients/${c.id}/calendar`, { date: '2026-12-03', channel: 'instagram', body: 'Van de beheerder' });
  await admin('POST', `/api/clients/${c.id}/inputs`, { body: 'Nieuwe input' });
  const forDesigner = (await designer('GET', '/api/clients')).body.find((x) => x.id === c.id);
  assert.deepEqual(forDesigner.news, { kalender: 1, planning: 1, media: 0 });
  const forAdmin = (await admin('GET', '/api/clients')).body.find((x) => x.id === c.id);
  assert.deepEqual(forAdmin.news, { kalender: 0, planning: 0, media: 0 }, 'eigen toevoegingen tellen niet');
  const cal = (await designer('GET', `/api/clients/${c.id}/calendar?from=2026-12-01&to=2026-12-31`)).body;
  assert.equal(cal.items[0].is_new, true);
  await designer('POST', `/api/clients/${c.id}/seen`, { section: 'kalender', ids: [] });
  assert.equal((await designer('GET', `/api/clients/${c.id}`)).body.news.kalender, 1, 'alleen een post in beeld telt als bekeken');
  await designer('POST', `/api/clients/${c.id}/seen`, { section: 'kalender', ids: [cal.items[0].id] });
  assert.equal((await designer('GET', `/api/clients/${c.id}`)).body.news.kalender, 0);
  assert.equal((await designer('GET', `/api/clients/${c.id}/calendar?from=2026-12-01&to=2026-12-31`)).body.items[0].is_new, false);
});

test('klant dupliceren en planning voor één dag', async () => {
  const c = (await admin('POST', '/api/clients', { name: 'Origineel', channels: ['instagram', 'youtube'], content_pillars: ['Team'], posts_per_week: 2 })).body;
  const copy = (await admin('POST', `/api/clients/${c.id}/duplicate`)).body;
  assert.equal(copy.name, 'Origineel (kopie)');
  assert.deepEqual(copy.channels, ['instagram', 'youtube']);
  assert.equal((await admin('POST', `/api/clients/${c.id}/duplicate`)).body.name, 'Origineel (kopie 2)');
  assert.equal((await designer('POST', `/api/clients/${c.id}/duplicate`)).status, 403);

  // 2 december 2026 is een woensdag; bij 2 posts per week valt die buiten de vaste dagen, maar één dag kan altijd.
  const plan = await admin('POST', `/api/clients/${c.id}/plans`, { periodStart: '2026-12-02', periodEnd: '2026-12-02' });
  assert.equal(plan.status, 201);
  assert.equal(plan.body.items.length, 1);
  assert.equal(plan.body.items[0].date, '2026-12-02');
});

test('gearchiveerde klant: datum en aantal posts bewaard, en weer terug te zetten', async () => {
  const c = (await admin('POST', '/api/clients', { name: 'Archief Test', channels: ['instagram'], posts_per_week: 2 })).body;
  await admin('POST', `/api/clients/${c.id}/calendar`, { date: '2026-12-02', channel: 'instagram', body: 'Bewaard' });
  const archived = (await admin('PATCH', `/api/clients/${c.id}`, { archived: true })).body;
  assert.equal(archived.archived, true);
  assert.ok(archived.archived_at, 'archiefdatum is gezet');
  const listed = (await admin('GET', '/api/clients')).body.find((x) => x.id === c.id);
  assert.equal(listed.archived, true);
  assert.equal(listed.post_count, 1, 'posts blijven bewaard');
  // Andere wijzigingen laten de archiefdatum staan.
  assert.equal((await admin('PATCH', `/api/clients/${c.id}`, { tone_of_voice: 'Rustig' })).body.archived_at, archived.archived_at);
  const back = (await admin('PATCH', `/api/clients/${c.id}`, { archived: false })).body;
  assert.equal(back.archived, false);
  assert.equal(back.archived_at, null);
});

test('account uitzetten en e-mailadres wijzigen; er blijft altijd een actieve Chefkes', async () => {
  const api = agent();
  const users = (await admin('GET', '/api/users')).body;
  const me = users.find((u) => u.role === 'admin');
  assert.equal((await admin('PATCH', `/api/users/${me.id}`, { disabled: true })).status, 400, 'eigen account niet uitzetten');

  const created = await admin('POST', '/api/users', { role: 'medewerker', email: 'stagiair@jss.nl', password: 'stage-wachtwoord-1' });
  const id = created.body.id;
  assert.equal((await api('POST', '/api/login', { email: 'stagiair@jss.nl', password: 'stage-wachtwoord-1' })).status, 200);
  assert.equal((await admin('PATCH', `/api/users/${id}`, { email: 'stage@jss.nl' })).status, 200);
  assert.equal((await api('POST', '/api/login', { email: 'stage@jss.nl', password: 'stage-wachtwoord-1' })).status, 200, 'inloggen met nieuw adres');
  assert.equal((await admin('PATCH', `/api/users/${id}`, { email: me.email })).status, 409, 'geen dubbel adres');

  assert.equal((await admin('PATCH', `/api/users/${id}`, { disabled: true })).status, 200);
  const login = await api('POST', '/api/login', { email: 'stage@jss.nl', password: 'stage-wachtwoord-1' });
  assert.equal(login.status, 403);
  assert.match(login.body.error, /staat uit/);
  assert.equal((await admin('GET', '/api/users')).body.find((u) => u.id === id).disabled, true);
  assert.equal((await admin('PATCH', `/api/users/${id}`, { disabled: false })).status, 200);
  assert.equal((await api('POST', '/api/login', { email: 'stage@jss.nl', password: 'stage-wachtwoord-1' })).status, 200);
});

test('gezondheidscontrole voor de hosting', async () => {
  const res = await fetch(`${base}/gezond`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('contentshoots: voorgestelde datum, zelf toevoegen, datum aanpassen en afvinken', async () => {
  const c = (await admin('POST', '/api/clients', { name: 'Shoot Test', channels: ['instagram'], content_pillars: ['Team', 'Product'] })).body;
  assert.equal((await admin('POST', `/api/clients/${c.id}/shoots`)).status, 201);
  let shoots = (await admin('GET', `/api/clients/${c.id}/shoots`)).body;
  assert.equal(shoots.length, 2);
  const today = new Date().toISOString().slice(0, 10);
  for (const s of shoots) {
    assert.match(s.planned_date, /^\d{4}-\d{2}-\d{2}$/, 'elke voorgestelde shoot heeft een datum');
    assert.ok(s.planned_date > today, 'datum ligt in de toekomst');
    assert.ok(![0, 6].includes(new Date(`${s.planned_date}T12:00:00Z`).getUTCDay()), 'op een werkdag');
  }
  assert.equal((await admin('POST', `/api/clients/${c.id}/shoots/eigen`, { title: 'Kerstshoot', planned_date: '2026-12-10' })).status, 201);
  assert.equal((await admin('POST', `/api/clients/${c.id}/shoots/eigen`, { title: '' })).status, 400);
  shoots = (await admin('GET', `/api/clients/${c.id}/shoots`)).body;
  const kerst = shoots.find((s) => s.title === 'Kerstshoot');
  assert.equal((await admin('PATCH', `/api/shoots/${kerst.id}`, { planned_date: 'morgen' })).status, 400);
  const updated = (await admin('PATCH', `/api/shoots/${kerst.id}`, { planned_date: '2026-12-11', done: true })).body;
  assert.equal(updated.planned_date, '2026-12-11');
  assert.equal(updated.done, true);
  shoots = (await admin('GET', `/api/clients/${c.id}/shoots`)).body;
  assert.equal(shoots.at(-1).id, kerst.id, 'gedane shoots staan onderaan');
  assert.equal((await designer('PATCH', `/api/shoots/${kerst.id}`, { done: false })).status, 403);
});

test('teksten kunnen al vóór goedkeuren worden geschreven; goedkeuren houdt eigen teksten', async () => {
  const c = (await admin('POST', '/api/clients', { name: 'Tekst Test', channels: ['instagram', 'facebook'], posts_per_week: 2 })).body;
  const plan = (await admin('POST', `/api/clients/${c.id}/plans`, { periodStart: '2027-02-01', periodEnd: '2027-02-07' })).body;
  const written = await admin('POST', `/api/plans/${plan.id}/write-texts`, {});
  assert.equal(written.status, 200);
  assert.ok(written.body.items.every((it) => it.channels.every((ch) => it.texts[ch])), 'alle teksten geschreven');
  const items = written.body.items.map((it, i) => (i === 0 ? { ...it, texts: { ...it.texts, instagram: 'Mijn eigen tekst' } } : it));
  assert.equal((await admin('PUT', `/api/plans/${plan.id}/items`, { items })).status, 200);
  const approved = await admin('POST', `/api/plans/${plan.id}/approve`, { reviewTextsFirst: false, resolutions: {} });
  assert.equal(approved.status, 200);
  const cal = (await admin('GET', `/api/clients/${c.id}/calendar?from=2027-02-01&to=2027-02-07`)).body.items;
  assert.ok(cal.some((i) => i.body === 'Mijn eigen tekst'), 'eigen tekst staat in de kalender');
});

test('beeld dat in posts zit: eerst melding, na bevestiging verwijderd en posts blijven staan', async () => {
  const c = (await admin('POST', '/api/clients', { name: 'Beeld Test', channels: ['instagram'] })).body;
  const upload = new FormData();
  upload.append('files', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'foto.jpg');
  const [mediaId] = (await admin('POST', `/api/clients/${c.id}/media`, null, { form: upload })).body.ids;
  await admin('POST', `/api/clients/${c.id}/calendar`, { date: '2027-03-01', channel: 'instagram', body: 'Met foto', media: [mediaId] });
  const first = await admin('DELETE', `/api/media/${mediaId}`);
  assert.equal(first.status, 409);
  assert.equal(first.body.linked, 1);
  assert.equal((await admin('DELETE', `/api/media/${mediaId}`, { force: true })).status, 200);
  const item = (await admin('GET', `/api/clients/${c.id}/calendar?from=2027-03-01&to=2027-03-31`)).body.items[0];
  assert.equal(item.body, 'Met foto');
  assert.equal(item.media.length, 0);
  assert.ok((await admin('GET', `/api/calendar/${item.id}`)).body.versions.length >= 1, 'vorige versie bewaard');
});

test('profielfoto voor klanten en accounts', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const c = (await admin('POST', '/api/clients', { name: 'Foto Test', channels: ['instagram'] })).body;
  assert.equal(c.avatar_url, null);
  assert.equal((await admin('PUT', `/api/clients/${c.id}/avatar`, { image: 'data:text/html;base64,PGgxPg==' })).status, 400, 'geen html');
  assert.equal((await admin('PUT', `/api/clients/${c.id}/avatar`, { image: 'data:image/png;base64,PGgxPg==' })).status, 400, 'geen nep-png');
  assert.equal((await designer('PUT', `/api/clients/${c.id}/avatar`, { image: png })).status, 403);
  const set = await admin('PUT', `/api/clients/${c.id}/avatar`, { image: png });
  assert.equal(set.status, 200);
  assert.match(set.body.avatar_url, /^\/api\/avatar\/client\//);
  assert.equal((await admin('GET', `/api/clients/${c.id}`)).body.avatar_url, set.body.avatar_url);
  const img = await admin('GET', set.body.avatar_url);
  assert.equal(img.status, 200);
  assert.equal(Buffer.from(img.body)[1], 0x50, 'het is de png');
  assert.equal((await admin('DELETE', `/api/clients/${c.id}/avatar`)).status, 200);
  assert.equal((await admin('GET', `/api/clients/${c.id}`)).body.avatar_url, null);

  // Eigen account: iedereen mag de eigen foto wijzigen, niet die van een ander.
  const meDesigner = (await designer('GET', '/api/meta')).body.user;
  const own = await designer('PUT', `/api/users/${meDesigner.id}/avatar`, { image: png });
  assert.equal(own.status, 200);
  assert.equal((await designer('GET', '/api/meta')).body.user.avatar_url, own.body.avatar_url);
  const adminId = (await admin('GET', '/api/meta')).body.user.id;
  assert.equal((await designer('PUT', `/api/users/${adminId}/avatar`, { image: png })).status, 403);
  assert.equal((await admin('PUT', `/api/users/${meDesigner.id}/avatar`, { image: png })).status, 200, 'chefkes mag het voor anderen');
  assert.ok((await admin('GET', '/api/users')).body.find((u) => u.id === meDesigner.id).avatar_url);
});

test('eigen wachtwoord wijzigen: huidig wachtwoord nodig, andere sessies uitgelogd', async () => {
  const a = agent();
  const b = agent();
  await admin('POST', '/api/users', { role: 'vormgever', email: 'brand@jss.nl', password: 'branding-start-1' });
  await a('POST', '/api/login', { email: 'brand@jss.nl', password: 'branding-start-1' });
  await b('POST', '/api/login', { email: 'brand@jss.nl', password: 'branding-start-1' });
  assert.equal((await a('POST', '/api/account/password', { current: 'fout', password: 'nieuw-wachtwoord-2' })).status, 400);
  assert.equal((await a('POST', '/api/account/password', { current: 'branding-start-1', password: 'kort' })).status, 400);
  assert.equal((await a('POST', '/api/account/password', { current: 'branding-start-1', password: 'nieuw-wachtwoord-2' })).status, 200);
  assert.equal((await a('GET', '/api/meta')).body.user.email, 'brand@jss.nl', 'zelf blijf je ingelogd');
  assert.equal((await b('GET', '/api/meta')).body.user, null, 'andere sessie is uitgelogd');
  assert.equal((await b('POST', '/api/login', { email: 'brand@jss.nl', password: 'nieuw-wachtwoord-2' })).status, 200);
});

test('aandacht: binnenkort online zonder tekst of beeld', async () => {
  const c = (await admin('POST', '/api/clients', { name: 'Aandacht Test', channels: ['instagram', 'facebook'] })).body;
  const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  await admin('POST', `/api/clients/${c.id}/calendar`, { date: d(1), channel: 'instagram', body: '' });
  await admin('POST', `/api/clients/${c.id}/calendar`, { date: d(2), channel: 'facebook', body: 'Tekst', status: 'volledig_ingepland' });
  await admin('POST', `/api/clients/${c.id}/calendar`, { date: d(10), channel: 'facebook', body: '' });
  const list = (await admin('GET', '/api/aandacht')).body.items.filter((i) => i.client_id === c.id);
  assert.equal(list.length, 1, 'alleen de post binnen 3 dagen die niet is ingepland');
  assert.deepEqual(list[0].missing, ['tekst', 'beeld']);
});

test('rapportage: afgesproken tegenover ingepland, met Excel', async () => {
  const c = (await admin('POST', '/api/clients', { name: 'Rapport Test', channels: ['instagram', 'facebook'], posts_per_week: 2 })).body;
  await admin('POST', `/api/clients/${c.id}/calendar`, { date: '2027-04-01', channel: 'instagram', body: 'a', status: 'volledig_ingepland' });
  await admin('POST', `/api/clients/${c.id}/calendar`, { date: '2027-04-02', channel: 'facebook', body: 'b' });
  const row = (await admin('GET', '/api/rapportage?maand=2027-04')).body.rows.find((r) => r.client_id === c.id);
  assert.equal(row.expected, Math.round((2 * 2 * 30) / 7));
  assert.equal(row.planned, 2);
  assert.equal(row.done, 1);
  assert.equal((await designer('GET', '/api/rapportage?maand=2027-04')).status, 403);
  const xlsx = await admin('GET', '/api/rapportage.xlsx?maand=2027-04');
  assert.equal(xlsx.status, 200);
  assert.equal(Buffer.from(xlsx.body).subarray(0, 2).toString(), 'PK');
});

test('reacties met @vermelding: bolletje en lijst voor wie genoemd is', async () => {
  const c = (await admin('POST', '/api/clients', { name: 'Reactie Test', channels: ['instagram'] })).body;
  const item = (await admin('POST', `/api/clients/${c.id}/calendar`, { date: '2027-05-03', channel: 'instagram', body: 'Hallo' })).body;
  const designerName = (await designer('GET', '/api/meta')).body.user.name;
  // Zet de post voor de vormgever op 'gezien', zodat alleen de reactie hem weer nieuw maakt.
  await designer('POST', `/api/clients/${c.id}/seen`, { section: 'kalender', ids: [item.id] });
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal((await admin('POST', `/api/calendar/${item.id}/comments`, { body: '' })).status, 400);
  const posted = await admin('POST', `/api/calendar/${item.id}/comments`, { body: `@${designerName} kun jij het beeld maken?` });
  assert.equal(posted.status, 201);
  assert.equal(posted.body.length, 1);
  assert.equal((await admin('GET', `/api/calendar/${item.id}`)).body.comments.length, 1);
  const cal = (await designer('GET', `/api/clients/${c.id}/calendar?from=2027-05-01&to=2027-05-31`)).body.items[0];
  assert.equal(cal.is_new, true, 'nieuwe reactie maakt de post weer nieuw');
  assert.equal(cal.comment_count, 1);
  const mentions = (await designer('GET', '/api/vermeldingen')).body;
  assert.ok(mentions.some((m) => m.item_id === item.id), 'vormgever ziet de vermelding');
  await designer('POST', `/api/clients/${c.id}/seen`, { section: 'kalender', ids: [item.id] });
  assert.ok(!(await designer('GET', '/api/vermeldingen')).body.some((m) => m.item_id === item.id), 'na bekijken weg');
  assert.equal((await designer('DELETE', `/api/comments/${posted.body[0].id}`)).status, 403, 'niet andermans reactie verwijderen');
  assert.equal((await admin('DELETE', `/api/comments/${posted.body[0].id}`)).status, 200);
});

test('branches, eigen dagen en terugkerende posts', async () => {
  const c = (await admin('POST', '/api/clients', { name: 'Terugkeer Test', channels: ['instagram', 'facebook'] })).body;
  assert.equal((await admin('PATCH', `/api/clients/${c.id}`, { own_days: [{ date: 'morgen', name: 'x' }] })).status, 400);
  assert.equal((await admin('PATCH', `/api/clients/${c.id}`, { recurring: [{ title: 'Weekstart', rhythm: 'week', weekday: 1, channels: [] }] })).status, 400);
  const saved = (await admin('PATCH', `/api/clients/${c.id}`, {
    branches: ['it', 'bestaat-niet'], own_days: [{ date: '2020-06-12', name: 'Opening', yearly: true }],
    recurring: [{ title: 'Weekstart', rhythm: 'week', weekday: 1, channels: ['instagram'], time: '08:00' }],
  })).body;
  assert.deepEqual(saved.branches, ['it']);
  assert.equal(saved.own_days[0].name, 'Opening');
  assert.equal(saved.recurring[0].active, true);
  await admin('POST', `/api/clients/${c.id}/calendar`, { date: '2027-03-01', channel: 'instagram', body: 'Al bezet' });
  const preview = (await admin('GET', `/api/clients/${c.id}/terugkerend?maand=2027-03`)).body;
  assert.deepEqual(preview.posts.map((p) => p.date), ['2027-03-08', '2027-03-15', '2027-03-22', '2027-03-29']);
  assert.equal(preview.skipped.length, 1, 'bezette cel wordt overgeslagen, niet overschreven');
  assert.equal((await designer('POST', `/api/clients/${c.id}/terugkerend`, { maand: '2027-03' })).status, 403);
  const placed = (await admin('POST', `/api/clients/${c.id}/terugkerend`, { maand: '2027-03' })).body;
  assert.deepEqual(placed, { created: 4, skipped: 1 });
  const items = (await admin('GET', `/api/clients/${c.id}/calendar?from=2027-03-01&to=2027-03-31`)).body.items;
  assert.equal(items.find((i) => i.publish_date === '2027-03-01').body, 'Al bezet');
  assert.ok(items.filter((i) => i.topic === 'Weekstart').every((i) => i.status === 'placeholder_actie_nodig' && i.suggested_time === '08:00'));
  assert.equal((await admin('GET', `/api/clients/${c.id}/terugkerend?maand=2027-03`)).body.posts.length, 0, 'tweede keer niets dubbel');
});

test('klantgeheugen: afspraken voorstellen uit opmerkingen (zonder AI)', async () => {
  const c = (await admin('POST', '/api/clients', { name: 'Geheugen Test', channels: ['instagram'], ai_memory: 'Geen prijzen noemen' })).body;
  await admin('POST', `/api/clients/${c.id}/calendar`, { date: '2027-06-01', channel: 'instagram', body: 'x', internal_notes: 'Klant wil nooit foto\'s van het magazijn. Geen prijzen noemen.' });
  const res = await admin('POST', `/api/clients/${c.id}/afspraken-voorstel`);
  assert.equal(res.status, 200);
  const rules = res.body.suggestions.map((s) => s.rule);
  assert.ok(rules.some((r) => /magazijn/.test(r)));
  assert.ok(!rules.some((r) => /prijzen/i.test(r)), 'bestaande afspraak wordt niet opnieuw voorgesteld');
  assert.equal((await designer('POST', `/api/clients/${c.id}/afspraken-voorstel`)).status, 403);
});

test('post toevoegen met herhalen: bezette dagen overgeslagen, regel bewaard', async () => {
  const c = (await admin('POST', '/api/clients', { name: 'Herhaal Test', channels: ['instagram', 'facebook'] })).body;
  await admin('POST', `/api/clients/${c.id}/calendar`, { date: '2027-07-12', channel: 'facebook', body: 'Al bezet' });
  assert.equal((await admin('POST', `/api/clients/${c.id}/calendar/batch`, { date: '2027-07-05', posts: [{ channel: 'instagram', body: 'x' }], repeat: { rhythm: 'week', until: '2027-07-01' } })).status, 400, 'einddatum voor de eerste datum');
  const res = await admin('POST', `/api/clients/${c.id}/calendar/batch`, {
    date: '2027-07-05', time: '09:00', topic: 'Weekstart', posts: [{ channel: 'instagram', body: 'Fijne week!' }, { channel: 'facebook', body: 'Fijne week!' }],
    repeat: { rhythm: 'week', until: '2027-07-26', saveRule: true },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.dates, 4, '5, 12, 19 en 26 juli');
  assert.equal(res.body.created, 7, '8 posts min 1 bezette dag');
  assert.equal(res.body.skipped, 1);
  const items = (await admin('GET', `/api/clients/${c.id}/calendar?from=2027-07-01&to=2027-07-31`)).body.items;
  assert.equal(items.find((i) => i.publish_date === '2027-07-12' && i.channel === 'facebook').body, 'Al bezet');
  assert.equal(items.filter((i) => i.body === 'Fijne week!').length, 7);
  const rule = (await admin('GET', `/api/clients/${c.id}`)).body.recurring[0];
  assert.equal(rule.title, 'Weekstart');
  assert.equal(rule.rhythm, 'week');
  assert.equal(rule.weekday, 1, 'maandag, afgeleid van de eerste datum');
  assert.deepEqual(rule.channels, ['instagram', 'facebook']);
});
