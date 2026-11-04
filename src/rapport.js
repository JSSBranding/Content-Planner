// Afspraak tegenover geleverd, per klant en per maand. Gedeeld door server en browserversie.
// Afgesproken posts per maand = posts per week × aantal kanalen × (dagen in de maand / 7), afgerond.
export const DONE_STATUSES = ['volledig_ingepland', 'advertising_ingepland'];

export function buildReport(clients, items, month) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return clients.filter((c) => !c.archived).map((c) => {
    const own = items.filter((i) => i.client_id === c.id && i.publish_date.startsWith(month));
    const expected = c.channels.length ? Math.round((c.posts_per_week * c.channels.length * days) / 7) : 0;
    const done = own.filter((i) => DONE_STATUSES.includes(i.status)).length;
    return {
      client_id: c.id, name: c.name, avatar_url: c.avatar_url ?? null, channels: c.channels, posts_per_week: c.posts_per_week,
      expected, planned: own.length, done, open: Math.max(0, expected - done),
      percentage: expected ? Math.round((done / expected) * 100) : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }));
}

// Posts die binnenkort online moeten maar nog tekst of beeld missen. Ingeplande posts tellen niet mee.
export const ATTENTION_DAYS = 3;
export function needsAttention(item, today, until) {
  if (item.publish_date < today || item.publish_date > until || DONE_STATUSES.includes(item.status)) return null;
  const missing = [!item.body?.trim() ? 'tekst' : null, !(item.media?.length ?? item.media_count) ? 'beeld' : null].filter(Boolean);
  return missing.length ? missing : null;
}
