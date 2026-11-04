// Feestdagen en actiedagen in Nederland om in content op in te spelen.
// Zonder afhankelijkheden, zodat server (AI-planning) en browser (kalender) dezelfde lijst gebruiken.
// Soorten: 'feestdag' (officiële feestdagen en grote vieringen) en 'actiedag' (thema- en awarenessdagen).
// Dagen met een wisselende datum (Pasen, Moederdag, Black Friday) worden per jaar berekend.
// Bewust niet opgenomen: dagen waarvan de datum per jaar door een organisatie wordt gekozen
// (zoals Ramadan, Suikerfeest, Kinderboekenweek); die voeg je per klant toe als klantinput.

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const shift = (y, m, d, days) => {
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};

// Paasdatum (anonieme Gregoriaanse berekening).
export function easter(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

// n-de weekdag van een maand (weekday 0 = zondag); n = -1 is de laatste.
function nthWeekday(y, m, weekday, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return iso(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
  return iso(y, m, lastDay - ((last - weekday + 7) % 7));
}

const FIXED = [
  [1, 1, 'Nieuwjaarsdag', 'feestdag'],
  [1, 6, 'Driekoningen', 'actiedag'],
  [2, 4, 'Wereldkankerdag', 'actiedag'],
  [2, 14, 'Valentijnsdag', 'feestdag'],
  [3, 1, 'Nationale Complimentendag', 'actiedag'],
  [3, 8, 'Internationale Vrouwendag', 'actiedag'],
  [3, 20, 'Internationale Dag van Geluk', 'actiedag'],
  [3, 22, 'Wereldwaterdag', 'actiedag'],
  [4, 1, '1 april', 'actiedag'],
  [4, 7, 'Wereldgezondheidsdag', 'actiedag'],
  [4, 22, 'Dag van de Aarde', 'actiedag'],
  [4, 23, 'Wereldboekendag', 'actiedag'],
  [5, 1, 'Dag van de Arbeid', 'actiedag'],
  [5, 4, 'Dodenherdenking', 'feestdag'],
  [5, 5, 'Bevrijdingsdag', 'feestdag'],
  [5, 12, 'Internationale Dag van de Verpleging', 'actiedag'],
  [5, 20, 'Wereldbijendag', 'actiedag'],
  [6, 3, 'Wereldfietsdag', 'actiedag'],
  [6, 5, 'Wereldmilieudag', 'actiedag'],
  [6, 21, 'Wereldmuziekdag', 'actiedag'],
  [7, 1, 'Keti Koti', 'feestdag'],
  [7, 7, 'Wereldchocoladedag', 'actiedag'],
  [7, 17, 'Wereldemojidag', 'actiedag'],
  [7, 30, 'Internationale Dag van de Vriendschap', 'actiedag'],
  [8, 8, 'Internationale Kattendag', 'actiedag'],
  [8, 19, 'Wereldfotografiedag', 'actiedag'],
  [8, 26, 'Internationale Hondendag', 'actiedag'],
  [9, 21, 'Internationale Dag van de Vrede', 'actiedag'],
  [10, 1, 'Wereldkoffiedag', 'actiedag'],
  [10, 4, 'Dierendag', 'actiedag'],
  [10, 5, 'Dag van de Leraar', 'actiedag'],
  [10, 10, 'Dag van de Duurzaamheid', 'actiedag'],
  [10, 10, 'Wereld Mentale Gezondheidsdag', 'actiedag'],
  [10, 16, 'Wereldvoedseldag', 'actiedag'],
  [10, 31, 'Halloween', 'feestdag'],
  [11, 10, 'Dag van de Mantelzorg', 'actiedag'],
  [11, 11, 'Sint-Maarten', 'feestdag'],
  [11, 11, 'Singles Day', 'actiedag'],
  [11, 20, 'Wereldkinderdag', 'actiedag'],
  [12, 5, 'Pakjesavond', 'feestdag'],
  [12, 5, 'Internationale Dag van de Vrijwilliger', 'actiedag'],
  [12, 24, 'Kerstavond', 'feestdag'],
  [12, 25, 'Eerste Kerstdag', 'feestdag'],
  [12, 26, 'Tweede Kerstdag', 'feestdag'],
  [12, 31, 'Oudejaarsavond', 'feestdag'],
];

const seasons = [[3, 1, 'Begin van de lente'], [6, 1, 'Begin van de zomer'], [9, 1, 'Begin van de herfst'], [12, 1, 'Begin van de winter']];

/** Alle dagen van één jaar: [{ date: 'JJJJ-MM-DD', name, type }] gesorteerd op datum. */
export function daysOfYear(y) {
  const out = FIXED.map(([m, d, name, type]) => ({ date: iso(y, m, d), name, type }));
  for (const [m, d, name] of seasons) out.push({ date: iso(y, m, d), name: `${name} (meteorologisch)`, type: 'actiedag' });

  // Koningsdag valt op 26 april als 27 april een zondag is.
  out.push({ date: new Date(Date.UTC(y, 3, 27)).getUTCDay() === 0 ? iso(y, 4, 26) : iso(y, 4, 27), name: 'Koningsdag', type: 'feestdag' });

  const [em, ed] = easter(y);
  const fromEaster = (days, name, type = 'feestdag') => out.push({ date: shift(y, em, ed, days), name, type });
  fromEaster(-49, 'Carnaval (zondag)');
  fromEaster(-48, 'Carnaval (maandag)');
  fromEaster(-47, 'Carnaval (dinsdag)');
  fromEaster(-46, 'Aswoensdag', 'actiedag');
  fromEaster(-7, 'Palmpasen', 'actiedag');
  fromEaster(-2, 'Goede Vrijdag');
  fromEaster(0, 'Eerste Paasdag');
  fromEaster(1, 'Tweede Paasdag');
  fromEaster(39, 'Hemelvaartsdag');
  fromEaster(49, 'Eerste Pinksterdag');
  fromEaster(50, 'Tweede Pinksterdag');

  out.push({ date: nthWeekday(y, 1, 1, 3), name: 'Blue Monday', type: 'actiedag' });
  out.push({ date: nthWeekday(y, 1, 4, -1), name: 'Gedichtendag', type: 'actiedag' });
  out.push({ date: nthWeekday(y, 3, 0, -1), name: 'Zomertijd gaat in', type: 'actiedag' });
  out.push({ date: nthWeekday(y, 5, 0, 2), name: 'Moederdag', type: 'feestdag' });
  out.push({ date: nthWeekday(y, 6, 0, 3), name: 'Vaderdag', type: 'feestdag' });
  out.push({ date: nthWeekday(y, 9, 2, 3), name: 'Prinsjesdag', type: 'actiedag' });
  out.push({ date: nthWeekday(y, 10, 5, 1), name: 'Wereldglimlachdag', type: 'actiedag' });
  out.push({ date: nthWeekday(y, 10, 0, -1), name: 'Wintertijd gaat in', type: 'actiedag' });
  const thanksgiving = nthWeekday(y, 11, 4, 4);
  const [, tm, td] = thanksgiving.split('-').map(Number);
  out.push({ date: shift(y, tm, td, 1), name: 'Black Friday', type: 'actiedag' });
  out.push({ date: shift(y, tm, td, 4), name: 'Cyber Monday', type: 'actiedag' });

  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'feestdag' ? -1 : 1));
}

/** Dagen tussen twee datums (inclusief), over jaargrenzen heen. */
export function daysBetween(from, to) {
  const out = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const d of daysOfYear(y)) if (d.date >= from && d.date <= to) out.push(d);
  }
  return out;
}

// ---------- Vakdagen per branche ----------
// Alleen dagen met een vaste of vast berekende datum. Losse jaarlijkse momenten (beurzen, jubilea)
// zet je per klant bij "Eigen belangrijke dagen".
// Een dag is [maand, dag, naam] of [maand, weekdag (0 = zondag), n-de (-1 = laatste), naam].
export const BRANCHES = [
  { key: 'eten', label: 'Eten, drinken en horeca', days: [[5, 21, 'Internationale Dag van de Thee'], [8, 5, 1, 'Internationale Bierdag'], [10, 16, 'Wereld Brooddag'], [10, 25, 'Wereldpastadag'], [11, 1, 'Wereldvegandag']] },
  { key: 'zorg', label: 'Zorg en welzijn', days: [[5, 31, 'Wereld Niet Roken Dag'], [9, 8, 'Werelddag van de Fysiotherapie'], [9, 29, 'Wereld Hartdag'], [11, 14, 'Wereld Diabetesdag'], [12, 1, 'Wereld Aidsdag']] },
  { key: 'onderwijs', label: 'Onderwijs en kinderopvang', days: [[1, 24, 'Internationale Dag van het Onderwijs'], [9, 8, 'Internationale Dag van de Alfabetisering']] },
  { key: 'zakelijk', label: 'Financieel en zakelijke dienstverlening', days: [[5, 1, 'Deadline aangifte inkomstenbelasting'], [10, 31, 'Wereldspaardag'], [11, 5, 3, 'Dag van de Ondernemer']] },
  { key: 'it', label: 'IT en techniek', days: [[2, 2, 2, 'Safer Internet Day'], [3, 31, 'Wereld Back-up Dag'], [5, 4, 1, 'Wereld Wachtwoorddag'], ['programmeur', 'Dag van de Programmeur']] },
  { key: 'wonen', label: 'Wonen, bouw en installatie', days: [[3, 5, 'Wereld Energiebesparingsdag'], [3, 6, -1, 'Earth Hour'], [10, 1, 1, 'Wereld Habitat Dag']] },
  { key: 'events', label: 'Bruiloften en evenementen', days: [[2, 0, 2, 'Wereldhuwelijksdag']] },
  { key: 'sport', label: 'Sport en beweging', days: [[6, 21, 'Internationale Dag van de Yoga'], [6, 23, 'Olympische Dag']] },
  { key: 'toerisme', label: 'Toerisme en recreatie', days: [[9, 27, 'Wereldtoerismedag']] },
];

function brancheDaysOfYear(key, y) {
  const branche = BRANCHES.find((b) => b.key === key);
  if (!branche) return [];
  return branche.days.map((d) => {
    let date;
    if (d[0] === 'programmeur') date = shift(y, 1, 1, 255); // de 256e dag van het jaar
    else if (d.length === 3) date = iso(y, d[0], d[1]);
    else date = nthWeekday(y, d[0], d[1], d[2]);
    return { date, name: d.at(-1), type: 'vakdag', branche: branche.label };
  });
}

/**
 * Alle dagen voor één klant: feest- en actiedagen, vakdagen van de gekozen branches en de eigen dagen van de klant.
 * client.branches: ['eten', ...]; client.own_days: [{ date: 'JJJJ-MM-DD', name, yearly }].
 */
export function clientDaysBetween(client, from, to) {
  const out = daysBetween(from, to);
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const key of client?.branches ?? []) for (const d of brancheDaysOfYear(key, y)) if (d.date >= from && d.date <= to) out.push(d);
    for (const own of client?.own_days ?? []) {
      if (!own?.date || !own.name) continue;
      const date = own.yearly ? `${y}${own.date.slice(4)}` : own.date;
      if ((own.yearly || Number(own.date.slice(0, 4)) === y) && date >= from && date <= to && !Number.isNaN(Date.parse(date))) {
        out.push({ date, name: own.name, type: 'klantdag' });
      }
    }
  }
  const order = { klantdag: 0, feestdag: 1, vakdag: 2, actiedag: 3 };
  return out.sort((a, b) => a.date.localeCompare(b.date) || order[a.type] - order[b.type]);
}

// ---------- Terugkerende posts ----------
// rule.rhythm: 'week' (elke week op rule.weekday, 1 = maandag … 7 = zondag), 'twee-weken' (om de week, vanaf rule.start),
// 'maand-dag' (elke maand op dag rule.day; bestaat die niet, dan de laatste dag) of 'maand-weekdag' (de rule.nth-de rule.weekday, -1 = laatste).
export function recurringDates(rule, from, to) {
  const out = [];
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  const isoOf = (d) => d.toISOString().slice(0, 10);
  const weekday = Number(rule.weekday) % 7; // 7 (zondag) wordt 0
  if (rule.rhythm === 'week' || rule.rhythm === 'twee-weken') {
    const anchor = rule.start ? new Date(`${rule.start}T12:00:00Z`) : null;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() !== weekday) continue;
      if (rule.rhythm === 'twee-weken' && anchor && Math.round((d - anchor) / 86400000 / 7) % 2 !== 0) continue;
      out.push(isoOf(d));
    }
    return out;
  }
  for (let y = start.getUTCFullYear(), m = start.getUTCMonth() + 1; y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth() + 1); m === 12 ? (y++, m = 1) : m++) {
    let date;
    if (rule.rhythm === 'maand-dag') {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      date = iso(y, m, Math.min(Number(rule.day) || 1, last));
    } else if (rule.rhythm === 'maand-weekdag') {
      date = nthWeekday(y, m, weekday, Number(rule.nth) || 1);
    }
    if (date && date >= from && date <= to) out.push(date);
  }
  return out;
}

// ---------- Controle van wat er per klant wordt opgeslagen (server en browserversie) ----------
const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const text = (s, max) => String(s ?? '').trim().slice(0, max);

export function cleanBranches(list, fail) {
  if (!Array.isArray(list)) fail(400, 'Ongeldige branches.');
  return [...new Set(list)].filter((k) => BRANCHES.some((b) => b.key === k));
}

export function cleanOwnDays(list, fail) {
  if (!Array.isArray(list) || list.length > 200) fail(400, 'Ongeldige lijst met eigen dagen.');
  return list.map((d, i) => {
    if (!isIsoDate(d?.date)) fail(400, `Eigen dag ${i + 1}: kies een geldige datum.`);
    const name = text(d.name, 120) || fail(400, `Eigen dag ${i + 1}: geef de dag een naam.`);
    return { date: d.date, name, yearly: Boolean(d.yearly) };
  }).sort((a, b) => a.date.slice(5).localeCompare(b.date.slice(5)));
}

export const RHYTHMS = ['week', 'twee-weken', 'maand-dag', 'maand-weekdag'];
export function cleanRecurring(list, channelKeys, fail) {
  if (!Array.isArray(list) || list.length > 50) fail(400, 'Ongeldige lijst met terugkerende posts.');
  return list.map((r, i) => {
    const title = text(r?.title, 200) || fail(400, `Terugkerende post ${i + 1}: geef een onderwerp.`);
    if (!RHYTHMS.includes(r.rhythm)) fail(400, `Terugkerende post ${i + 1}: kies hoe vaak.`);
    const channels = [...new Set(r.channels ?? [])].filter((c) => channelKeys.includes(c));
    if (!channels.length) fail(400, `Terugkerende post ${i + 1}: kies minimaal één kanaal.`);
    // Om de week: de weekdag volgt uit de eerste datum.
    const weekday = r.rhythm === 'twee-weken' && isIsoDate(r.start) ? (new Date(`${r.start}T12:00:00Z`).getUTCDay() || 7) : Number(r.weekday ?? 1);
    if (r.rhythm !== 'maand-dag' && !(weekday >= 1 && weekday <= 7)) fail(400, `Terugkerende post ${i + 1}: kies een dag van de week.`);
    const day = Number(r.day ?? 1);
    if (r.rhythm === 'maand-dag' && !(day >= 1 && day <= 31)) fail(400, `Terugkerende post ${i + 1}: kies een dag van de maand (1 t/m 31).`);
    const nth = Number(r.nth ?? 1);
    if (r.rhythm === 'maand-weekdag' && ![1, 2, 3, 4, -1].includes(nth)) fail(400, `Terugkerende post ${i + 1}: kies welke week van de maand.`);
    if (r.rhythm === 'twee-weken' && !isIsoDate(r.start)) fail(400, `Terugkerende post ${i + 1}: kies de eerste datum.`);
    const time = /^\d{2}:\d{2}$/.test(r.time ?? '') ? r.time : null;
    return {
      id: text(r.id, 40) || `t${Date.now().toString(36)}${i}`, title, channels, rhythm: r.rhythm, weekday, day, nth,
      start: r.rhythm === 'twee-weken' ? r.start : null, time, pillar: text(r.pillar, 100) || null, active: r.active !== false,
    };
  });
}

/** Leesbare omschrijving van het ritme, bijv. "Elke maandag" of "Elke eerste vrijdag van de maand". */
export function describeRhythm(r) {
  const days = ['', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
  const nth = { 1: 'eerste', 2: 'tweede', 3: 'derde', 4: 'vierde', '-1': 'laatste' };
  if (r.rhythm === 'week') return `Elke ${days[r.weekday]}`;
  if (r.rhythm === 'twee-weken') return `Om de week op ${days[r.weekday]}`;
  if (r.rhythm === 'maand-dag') return `Elke maand op de ${r.day}e`;
  return `Elke ${nth[r.nth]} ${days[r.weekday]} van de maand`;
}

// ---------- Herhalen vanuit "Post toevoegen" ----------
// Het ritme volgt uit de datum van de eerste post: dezelfde weekdag, dezelfde n-de weekdag van de maand of dezelfde datum.
export const REPEAT_LIMIT_DAYS = 366;
export function ruleFromDate(rhythm, date) {
  const d = new Date(`${date}T12:00:00Z`);
  const weekday = d.getUTCDay() || 7;
  const n = Math.ceil(d.getUTCDate() / 7);
  return { rhythm, weekday, nth: n >= 5 ? -1 : n, day: d.getUTCDate(), start: rhythm === 'twee-weken' ? date : null };
}
/** Herhaaldatums ná de eerste datum, tot en met 'until' (maximaal een jaar vooruit). */
export function repeatDates(rhythm, date, until) {
  if (!RHYTHMS.includes(rhythm) || !isIsoDate(date) || !isIsoDate(until) || until <= date) return [];
  const limit = shift(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)), REPEAT_LIMIT_DAYS);
  const next = shift(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)), 1);
  return recurringDates(ruleFromDate(rhythm, date), next, until < limit ? until : limit);
}
