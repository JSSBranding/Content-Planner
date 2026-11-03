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
