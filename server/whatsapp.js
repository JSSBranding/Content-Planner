// Leest een WhatsApp-chatexport (.txt, "Chat exporteren" zonder media) in.
// Ondersteunt de gangbare Nederlandse formaten van iOS en Android:
//   [12-11-2026 09:15:02] Naam: bericht
//   12-11-2026 09:15 - Naam: bericht
//   12/11/26, 09:15 - Naam: bericht

const LINE = /^‎?\[?(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4}),?\s+(\d{1,2}:\d{2})(?::\d{2})?\]?\s*(?:-\s*)?([^:]{1,60}):\s?(.*)$/;
const SKIP = [/<Media weggelaten>/i, /<Media omitted>/i, /afbeelding weggelaten/i, /video weggelaten/i,
  /Berichten en oproepen worden end-to-end versleuteld/i, /Messages and calls are end-to-end encrypted/i, /^Dit bericht is verwijderd$/i];

export function parseWhatsApp(text) {
  const messages = [];
  for (const raw of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/‎/g, '');
    const m = line.match(LINE);
    if (m) {
      const [, d, mo, y, time, author, body] = m;
      const year = y.length === 2 ? `20${y}` : y;
      messages.push({ date: `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, time: time.padStart(5, '0'), author: author.trim(), body });
    } else if (messages.length && line.trim()) {
      messages.at(-1).body += `\n${line}`; // vervolgregel van een bericht met meerdere regels
    }
  }
  return messages
    .map((msg) => ({ ...msg, body: msg.body.trim() }))
    .filter((msg) => msg.body && !SKIP.some((re) => re.test(msg.body)));
}

// Zet berichten om naar één leesbare klantinput, eventueel gefilterd op periode.
export function whatsappToInput(messages, { from, to } = {}) {
  const selected = messages.filter((m) => (!from || m.date >= from) && (!to || m.date <= to));
  return {
    count: selected.length,
    body: selected.map((m) => `${m.date} ${m.time} — ${m.author}: ${m.body}`).join('\n'),
    firstDate: selected[0]?.date ?? null,
    lastDate: selected.at(-1)?.date ?? null,
  };
}
