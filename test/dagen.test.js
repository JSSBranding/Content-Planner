import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysOfYear, daysBetween, easter } from '../src/dagen.js';

const on = (y, name) => daysOfYear(y).find((d) => d.name === name)?.date;

test('feestdagen met wisselende datum', () => {
  assert.deepEqual(easter(2026), [4, 5]);
  assert.deepEqual(easter(2027), [3, 28]);
  assert.equal(on(2026, 'Eerste Paasdag'), '2026-04-05');
  assert.equal(on(2026, 'Hemelvaartsdag'), '2026-05-14');
  assert.equal(on(2026, 'Eerste Pinksterdag'), '2026-05-24');
  assert.equal(on(2026, 'Moederdag'), '2026-05-10');
  assert.equal(on(2026, 'Vaderdag'), '2026-06-21');
  assert.equal(on(2026, 'Black Friday'), '2026-11-27');
  assert.equal(on(2026, 'Prinsjesdag'), '2026-09-15');
  assert.equal(on(2025, 'Koningsdag'), '2025-04-26', '27 april 2025 is een zondag');
  assert.equal(on(2026, 'Koningsdag'), '2026-04-27');
});

test('ook kleine actiedagen, zoals Dierendag', () => {
  assert.equal(on(2026, 'Dierendag'), '2026-10-04');
  assert.equal(on(2026, 'Valentijnsdag'), '2026-02-14');
  const dec = daysBetween('2026-12-20', '2027-01-02').map((d) => d.name);
  assert.ok(dec.includes('Eerste Kerstdag') && dec.includes('Nieuwjaarsdag'), 'over de jaargrens heen');
});
