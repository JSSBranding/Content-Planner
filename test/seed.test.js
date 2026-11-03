import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { seedClients, readStartClients } from '../server/seed.js';

test('startlijst: 50 klanten, alleen in een lege database', () => {
  const names = readStartClients();
  assert.equal(names.length, 50);
  assert.ok(names.includes('Natuurlijk! Sint-Oedenrode') && names.includes('Ann & John Bruidsmode'));

  const db = openDb(':memory:');
  assert.equal(seedClients(db), 50);
  assert.equal(seedClients(db), 0, 'niet opnieuw als er al klanten zijn');
  db.prepare("DELETE FROM clients WHERE name = 'JSA'").run();
  assert.equal(seedClients(db), 0, 'een verwijderde klant komt niet terug');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clients').get().n, 49);
});
