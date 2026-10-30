import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, mediaAllowedForAi, proposePlan, writeTexts, setClientForTests, AiError } from '../server/ai.js';

const client = {
  name: 'Bakkerij De Vries', strategy: 'Buurtbakker', tone_of_voice: 'Warm', content_pillars: ['Vakmanschap', 'Team'],
  channels: ['instagram', 'linkedin'], posts_per_week: 2, ai_memory: 'Bel Jan op 06-12345678',
};
const media = [
  { id: 'm1', kind: 'foto', filename: 'oven.jpg', description: '', tags: [], times_used: 0, has_recognizable_faces: 0, ai_processing_allowed: 0 },
  { id: 'm2', kind: 'foto', filename: 'team.jpg', description: '', tags: [], times_used: 0, has_recognizable_faces: 1, ai_processing_allowed: 0 },
];

// Nabootsing van client.beta.messages.stream(...).finalMessage().
function fakeClient(responseJson, { stop = 'end_turn' } = {}) {
  const calls = [];
  return {
    calls,
    beta: { messages: { stream: (params) => { calls.push(params); return { finalMessage: async () => ({ stop_reason: stop, content: [{ type: 'text', text: JSON.stringify(responseJson) }] }) }; } } },
  };
}

test('privacy: telefoonnummers en e-mailadressen worden weggelaten', () => {
  assert.equal(redact('Bel 06-12345678 of +31 6 1234 5678, mail jan@bakker.nl.'), 'Bel [telefoonnummer] of [telefoonnummer], mail [e-mailadres].');
  assert.equal(redact('Op 12-11-2026 om 10:00, 250 broden'), 'Op 12-11-2026 om 10:00, 250 broden');
});

test('privacy: beeld met herkenbare gezichten zonder toestemming gaat niet naar de AI', () => {
  assert.equal(mediaAllowedForAi(media[0]), true);
  assert.equal(mediaAllowedForAi(media[1]), false);
  assert.equal(mediaAllowedForAi({ ...media[1], ai_processing_allowed: 1 }), true);
});

test('planningsvoorstel: verzoek en opschoning van AI-uitvoer', async () => {
  process.env.ANTHROPIC_API_KEY = 'test';
  const fake = fakeClient({
    note: 'Evenwichtig verdeeld.',
    items: [
      { date: '2026-12-02', time: '08:30', topic: 'Nieuwe oven', channels: ['instagram', 'tiktok'], pillar: 'Vakmanschap', client_input_id: 'i1', media_ids: ['m1', 'm2', 'bestaat-niet'], rationale: 'Klantinput' },
      { date: '2026-12-02', time: '25:99', topic: 'Dubbel op Instagram', channels: ['instagram'], pillar: null, client_input_id: 'onbekend', media_ids: [], rationale: '' },
      { date: '2027-01-05', time: null, topic: 'Buiten de periode', channels: ['linkedin'], pillar: null, client_input_id: null, media_ids: [], rationale: '' },
    ],
  });
  setClientForTests(fake);
  try {
    const result = await proposePlan({
      client, periodStart: '2026-12-01', periodEnd: '2026-12-31', inputs: [{ id: 'i1', title: 'Oven', body: 'Mail info@bakker.nl', instructions: '' }],
      media, occupied: [], wishes: '',
    });
    const params = fake.calls[0];
    assert.equal(params.model, 'claude-opus-5-5');
    assert.equal(params.output_config.format.type, 'json_schema');
    assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(params.fallbacks, 'default');
    const prompt = params.messages[0].content;
    assert.ok(!prompt.includes('team.jpg'), 'beeld met gezichten zonder toestemming niet in prompt');
    assert.ok(!prompt.includes('06-12345678') && !prompt.includes('info@bakker.nl'), 'persoonsgegevens weggelaten');

    assert.equal(result.source, 'ai');
    assert.equal(result.items.length, 1, 'dubbele cel en datum buiten periode vallen af');
    const [item] = result.items;
    assert.deepEqual(item.channels, ['instagram'], 'kanaal dat de klant niet gebruikt valt af');
    assert.deepEqual(item.media, ['m1'], 'alleen bekende en toegestane media');
    assert.equal(item.clientInputId, 'i1');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('teksten per kanaal; weigering wordt een duidelijke fout', async () => {
  process.env.ANTHROPIC_API_KEY = 'test';
  try {
    setClientForTests(fakeClient({ posts: [{ index: 0, texts: [{ channel: 'instagram', text: ' Kort! ' }, { channel: 'x', text: 'niet gevraagd' }] }] }));
    const texts = await writeTexts({ client, posts: [{ date: '2026-12-02', topic: 'Oven', channels: ['instagram', 'linkedin'], pillar: null, input: null, media: [] }] });
    assert.deepEqual(texts, [{ instagram: 'Kort!' }]);

    setClientForTests(fakeClient({}, { stop: 'refusal' }));
    await assert.rejects(writeTexts({ client, posts: [{ date: '2026-12-02', topic: 'x', channels: ['instagram'], input: null, media: [] }] }), AiError);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});
