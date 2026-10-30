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
