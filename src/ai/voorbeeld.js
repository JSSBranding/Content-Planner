// Voorspelbare voorstellen zonder AI. Gebruikt door de server (zonder API-sleutel) en door de demoversie.
// Geen afhankelijkheden, zodat dit ook in de browser draait.

const CHANNEL_LABEL = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', pinterest: 'Pinterest', x: 'X' };
const WEEKDAY_PATTERNS = { 1: [3], 2: [2, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
export const EXAMPLE_TIMES = { linkedin: '08:30', facebook: '19:30', instagram: '19:00', tiktok: '20:00', youtube: '17:00', pinterest: '20:30', x: '12:00' };

export function datesBetween(start, end) {
  const out = [];
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Vaste weekdagen volgens de frequentie, onderwerpen uit klantinput en anders uit de pijlers.
export function examplePlan({ client, periodStart, periodEnd, inputs, media, note }) {
  const pattern = WEEKDAY_PATTERNS[Math.min(7, Math.max(1, client.posts_per_week || 3))];
  const all = datesBetween(periodStart, periodEnd);
  let days = all.filter((d) => pattern.includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
  // Korte periode (zoals één dag) zonder vaste postdag: plan dan op de eerste dag.
  if (!days.length) days = all.slice(0, 1);
  const pillars = client.content_pillars.length ? client.content_pillars : [null];
  const mediaPool = [...media].sort((a, b) => a.times_used - b.times_used);
  const items = days.map((date, i) => {
    const input = inputs[i];
    const pillar = pillars[i % pillars.length];
    const linked = input ? mediaPool.filter((m) => m.client_input_id === input.id) : [];
    const pick = linked.length ? linked.slice(0, 3) : mediaPool.length ? [mediaPool[i % mediaPool.length]] : [];
    return {
      date,
      time: EXAMPLE_TIMES[client.channels[0]] ?? '12:00',
      topic: input ? (input.title || input.body.split('\n')[0]).slice(0, 80) : `${pillar ?? 'Algemeen'}: onderwerp nader te bepalen`,
      channels: [...client.channels],
      pillar,
      clientInputId: input?.id ?? null,
      media: pick.map((m) => m.id),
      rationale: input ? 'Gebaseerd op aangeleverde klantinput.' : 'Evenwichtige spreiding over de contentpijlers.',
      texts: {},
    };
  });
  return {
    items,
    note: note ?? 'Voorbeeldverdeling zonder AI (er is geen ANTHROPIC_API_KEY ingesteld). Pas onderwerpen, datums en kanalen zelf aan.',
  };
}

export function exampleTexts(client, post) {
  const texts = {};
  for (const channel of post.channels) {
    texts[channel] = `[Voorbeeldtekst ${CHANNEL_LABEL[channel] ?? channel}, geen AI-sleutel ingesteld]\n${post.topic}${post.input ? `\n\n${post.input.body.slice(0, 300)}` : ''}`;
  }
  return texts;
}

export function exampleShoots(client) {
  const pillars = client.content_pillars.length ? client.content_pillars : ['Algemeen'];
  return pillars.slice(0, 5).map((p) => ({
    title: `Beeld voor pijler ${p}`,
    body: `Maak 5 tot 10 foto's en 2 korte verticale video's die ${p.toLowerCase()} laten zien. Liefst op locatie bij de klant, met daglicht.`,
  }));
}
