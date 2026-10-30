import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_STATUS, PlanError, createPlan, submitForReview, editManually,
  applyAiRedistribution, regenerate, approve, addToCalendar, findConflicts,
} from '../src/planning/plan.js';

const manager = { id: 'u1', role: 'social_media_manager' };
const designer = { id: 'u2', role: 'vormgever' };

const items = [
  { date: '2026-11-11', time: '09:00', topic: 'Nieuwe collectie', channels: ['linkedin', 'facebook', 'instagram'], media: ['m1'] },
  { date: '2026-11-14', topic: 'Achter de schermen', channels: ['instagram'] },
];

const reviewed = () => submitForReview(createPlan({ clientId: 'c1', items }));

test('AI-planning kan niet zonder goedkeuring naar de kalender', () => {
  assert.throws(() => addToCalendar(reviewed(), manager, []), PlanError);
});

test('alleen een manager mag goedkeuren', () => {
  assert.throws(() => approve(reviewed(), designer), PlanError);
  assert.equal(approve(reviewed(), manager).status, PLAN_STATUS.GOEDGEKEURD);
});

test('goedgekeurde planning levert één kalendercel per datum × kanaal', () => {
  const { plan, newCalendarItems } = addToCalendar(approve(reviewed(), manager), manager, []);
  assert.equal(plan.status, PLAN_STATUS.TOEGEVOEGD);
  assert.equal(newCalendarItems.length, 4);
  assert.deepEqual(newCalendarItems.filter((c) => c.date === '2026-11-11').map((c) => c.channel),
    ['linkedin', 'facebook', 'instagram']);
});

test('AI-herverdeling na goedkeuring vereist opnieuw akkoord', () => {
  const redistributed = applyAiRedistribution(approve(reviewed(), manager), items);
  assert.equal(redistributed.status, PLAN_STATUS.IN_CONTROLE);
  assert.equal(redistributed.approvedBy, null);
  assert.throws(() => addToCalendar(redistributed, manager, []), PlanError);
});

test('opnieuw genereren zet de planning terug naar concept', () => {
  assert.equal(regenerate(approve(reviewed(), manager), items).status, PLAN_STATUS.CONCEPT);
});

test('handmatige wijziging door manager houdt goedkeuring, door ander niet', () => {
  const approved = approve(reviewed(), manager);
  assert.equal(editManually(approved, manager, items).status, PLAN_STATUS.GOEDGEKEURD);
  assert.equal(editManually(approved, designer, items).status, PLAN_STATUS.AANPASSEN);
});

test('bestaande content wordt nooit ongemerkt overschreven', () => {
  const approved = approve(reviewed(), manager);
  const existing = [{ id: 'k1', clientId: 'c1', date: '2026-11-11', channel: 'instagram' }];
  assert.equal(findConflicts(approved, existing).length, 1);

  assert.throws(() => addToCalendar(approved, manager, existing), (e) => e.conflicts?.length === 1);

  const skipped = addToCalendar(approved, manager, existing, { '2026-11-11|instagram': 'skip' });
  assert.equal(skipped.newCalendarItems.length, 3);
  assert.equal(skipped.replaced.length, 0);

  const replaced = addToCalendar(approved, manager, existing, { '2026-11-11|instagram': 'replace' });
  assert.equal(replaced.newCalendarItems.length, 4);
  assert.deepEqual(replaced.replaced.map((r) => r.id), ['k1']);
});

test('content van andere klanten telt niet als conflict', () => {
  const existing = [{ clientId: 'c2', date: '2026-11-11', channel: 'instagram' }];
  assert.equal(findConflicts(approve(reviewed(), manager), existing).length, 0);
});

test('conceptteksten per kanaal gaan mee naar de kalendercellen', () => {
  const withTexts = items.map((it, i) => (i === 0 ? { ...it, texts: { linkedin: 'Zakelijk', instagram: 'Kort' } } : it));
  const plan = approve(submitForReview(createPlan({ clientId: 'c1', items: withTexts })), manager);
  const cells = addToCalendar(plan, manager, []).newCalendarItems;
  const byChannel = Object.fromEntries(cells.filter((c) => c.date === '2026-11-11').map((c) => [c.channel, c]));
  assert.equal(byChannel.linkedin.body, 'Zakelijk');
  assert.equal(byChannel.linkedin.status, 'tekst_gereed');
  assert.equal(byChannel.facebook.body, '');
  assert.equal(byChannel.facebook.status, 'beeld_gereed_tekst_ontbreekt');
  assert.equal(cells.find((c) => c.date === '2026-11-14').status, 'placeholder_actie_nodig');
});

test('twee onderwerpen op dezelfde datum en hetzelfde kanaal kunnen niet worden goedgekeurd', () => {
  const dup = [...items, { date: '2026-11-11', topic: 'Tweede onderwerp', channels: ['instagram'] }];
  const plan = submitForReview(createPlan({ clientId: 'c1', items: dup }));
  assert.throws(() => approve(plan, manager), (e) => e.duplicates?.includes('2026-11-11|instagram'));
});
