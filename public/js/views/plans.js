import {
  h, fill, icon, field, toast, showError, modal, confirmDialog, busy, mediaThumb, copyText, openMenu, page,
  fmtDate, fmtLongDate, fmtDateTime, isoDate, monthBounds, shiftMonth, isoWeek, emptyState, addDays,
} from '../ui.js';
import { api, meta, can, channelLabel } from '../api.js';
import { clientHeader } from './clients.js';
import { pickMedia } from './media.js';
import { inputSection } from './inbox.js';

// Voor de gebruiker zijn er twee stappen: controleren en aanpassen (één stap), en in de kalender.
const planDone = (status) => status === 'toegevoegd_aan_kalender';
const planChip = (status) => h('span', { class: `chip ${planDone(status) ? 'ok' : 'let-op'}` }, planDone(status) ? 'In de kalender' : 'Te controleren');
const period = (a, b) => `${fmtDate(a)} t/m ${fmtDate(b)}`;

// ---------- Overzicht en nieuwe conceptplanning ----------

export async function plansView({ clientId, tab, rerender }) {
  const [{ client, head }, plans, inputs, media] = await Promise.all([
    clientHeader(clientId, tab), api.get(`/clients/${clientId}/plans`), api.get(`/clients/${clientId}/inputs`), api.get(`/clients/${clientId}/media`),
  ]);
  const next = monthBounds(shiftMonth(isoDate(new Date()).slice(0, 7), 1));
  const start = h('input', { type: 'date', value: next.from, required: true });
  const end = h('input', { type: 'date', value: next.to, required: true });
  // Periode: één dag, een week of een maand. Bij één dag is er maar één datumveld.
  let mode = 'maand';
  const endField = field('Tot en met', end);
  const startLabel = h('span', {}, 'Van');
  const periodButtons = h('div', { class: 'segment', role: 'group', 'aria-label': 'Periode' });
  function setMode(m) {
    mode = m;
    if (m === 'dag') end.value = start.value;
    if (m === 'week') end.value = addDays(start.value, 6);
    if (m === 'maand') { const b = monthBounds(start.value.slice(0, 7)); start.value = b.from; end.value = b.to; }
    endField.hidden = m === 'dag';
    startLabel.textContent = m === 'dag' ? 'Datum' : 'Van';
    fill(periodButtons, [['dag', 'Eén dag'], ['week', 'Week'], ['maand', 'Maand']].map(([k, l]) =>
      h('button', { type: 'button', class: k === mode ? 'aan' : '', 'aria-pressed': String(k === mode), onclick: () => setMode(k) }, l)));
  }
  start.addEventListener('change', () => { if (mode === 'dag') end.value = start.value; if (mode === 'week') end.value = addDays(start.value, 6); });
  setMode('maand');
  const wishes = h('textarea', { rows: 3, placeholder: 'Bijv. focus op kerst, geen posts in het weekend, LinkedIn maximaal één keer per week' });
  const openInputs = inputs.filter((i) => !i.processed).length;

  const notReady = !client.channels.length;
  const form = can('managePlans') && notReady ? h('div', { class: 'paneelblok' },
    h('h2', {}, 'Nieuwe conceptplanning'),
    h('p', { class: 'zacht' }, 'Stel eerst de kanalen en het aantal posts per week van deze klant in. Daar baseert de AI de planning op.'),
    h('a', { class: 'knop primair', href: `#/klant/${clientId}/instellingen` }, 'Kanalen en frequentie instellen'))
    : can('managePlans') ? h('form', {
    class: 'paneelblok',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const plan = await busy('De AI leest de klantinput en stelt een planning voor',
          () => api.post(`/clients/${clientId}/plans`, { periodStart: start.value, periodEnd: end.value, wishes: wishes.value }));
        location.hash = `#/klant/${clientId}/planning/${plan.id}`;
      } catch (err) {
        showError(err);
      }
    },
  },
  h('h2', {}, 'Nieuwe conceptplanning'),
  h('p', { class: 'zacht' },
    `Op basis van de strategie, ${client.posts_per_week} posts per week en `,
    openInputs ? `${openInputs} nieuwe klantinput.` : 'algemene content (er is geen nieuwe klantinput).',
    ' Je ziet eerst een voorstel; er komt niets in de kalender zonder jouw goedkeuring.'),
  h('div', { class: 'veld' }, h('label', {}, 'Periode'), periodButtons),
  h('div', { class: 'rij' }, h('div', { class: 'veld' }, h('label', {}, startLabel), start), endField),
  field('Wensen voor deze periode', wishes),
  h('button', { class: 'knop primair', type: 'submit', style: { width: '100%' } }, icon('sparkle', { size: 16 }), 'Voorstel laten maken')) : null;

  const list = plans.length ? h('div', { class: 'tabel-wrap' }, h('table', { class: 'lijst' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Periode'), h('th', {}, 'Status'), h('th', {}, 'Onderwerpen'), h('th', {}, 'Goedgekeurd door'))),
    h('tbody', {}, plans.map((p) => h('tr', { class: 'klikbaar', onclick: () => { location.hash = `#/klant/${clientId}/planning/${p.id}`; } },
      h('td', {}, h('a', { href: `#/klant/${clientId}/planning/${p.id}`, style: { fontWeight: 600, textDecoration: 'none' } }, period(p.period_start, p.period_end)),
        h('div', { class: 'zacht' }, `Gemaakt ${fmtDateTime(p.created_at)}${p.ai_source === 'voorbeeld' ? ' (voorbeeldmodus)' : ''}`)),
      h('td', {}, planChip(p.status)),
      h('td', {}, p.item_count),
      h('td', { class: 'zacht' }, p.approved_by_name ? `${p.approved_by_name}, ${fmtDateTime(p.approved_at)}` : 'Nog niet')))))) : h('div', { class: 'paneelblok' }, emptyState('Nog geen planningen. Laat rechts een voorstel maken op basis van de klantinput.'));

  return page(head(), h('div', { class: form ? 'zij-kolom' : '' },
    h('div', {},
      inputSection({ clientId, inputs, media, rerender }),
      h('h2', { style: { margin: '4px 0 12px' } }, 'Conceptplanningen'),
      list),
    form ? h('div', { class: 'plakkerig' }, form) : null));
}


// ---------- Eén conceptplanning controleren, aanpassen en goedkeuren ----------
// Eén stap: alles is direct aan te passen (klik op een post), wijzigingen worden meteen opgeslagen,
// en goedkeuren zet de planning in de kalender. Ontbrekende teksten schrijft de AI dan.

const shortDate = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'short' });
const asDay = (iso) => new Date(`${iso}T12:00:00`);
const mondayOf = (iso) => addDays(iso, -((asDay(iso).getDay() + 6) % 7));

export async function planView({ clientId, planId, tab, rerender }) {
  const [{ client, head }, plan, media, inputs] = await Promise.all([
    clientHeader(clientId, tab), api.get(`/plans/${planId}`), api.get(`/clients/${clientId}/media`), api.get(`/clients/${clientId}/inputs`),
  ]);
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const inputsById = new Map(inputs.map((i) => [i.id, i]));
  const manager = can('managePlans');
  const approver = can('approvePlans');
  const done = planDone(plan.status);
  const editable = manager && !done;
  const pillars = [...new Set([...client.content_pillars, ...plan.items.map((i) => i.pillar).filter(Boolean)])];

  const items = plan.items.map((i) => ({ ...i, texts: { ...i.texts }, media: [...i.media], channels: [...i.channels] }));
  const byDate = (a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '');
  items.sort(byDate);
  let conflictKeys = new Set(plan.conflicts.map((c) => c.key));
  const cellCount = () => items.reduce((n, it) => n + it.channels.length, 0);
  const missingTexts = () => items.reduce((n, it) => n + it.channels.filter((ch) => !it.texts[ch]?.trim()).length, 0);

  // ---------- Opslaan: elke wijziging gaat direct naar de server ----------

  let saving = Promise.resolve();
  let saveState = 'opgeslagen';
  function commit() {
    items.sort(byDate);
    saveState = 'bezig';
    drawAll();
    saving = saving.then(async () => {
      try {
        const saved = await api.put(`/plans/${planId}/items`, { items });
        conflictKeys = new Set(saved.conflicts.map((c) => c.key));
        saveState = 'opgeslagen';
      } catch (err) {
        saveState = 'fout';
        showError(err);
      }
      drawAll();
    });
    return saving;
  }
  async function action(fn) {
    try {
      await fn();
    } catch (err) {
      showError(err);
    }
  }

  // ---------- Kop ----------

  const stepNames = ['Voorstel gemaakt', 'Controleren en aanpassen', 'In de kalender'];
  const current = done ? 2 : 1;
  const steps = h('ol', { class: 'statusbaan', 'aria-label': 'Voortgang van de planning' },
    stepNames.map((name, i) => h('li', { class: i < current || done ? 'klaar' : i === current ? 'nu' : '', 'aria-current': i === current ? 'step' : null },
      h('span', { class: 'punt' }, i < current || done ? icon('vink', { size: 11 }) : null), name)));

  const explanation = done
    ? `Staat in de kalender sinds ${fmtDateTime(plan.addedToCalendarAt)}, goedgekeurd door ${plan.approvedByName ?? 'onbekend'}. Wijzigingen doe je nu in de kalender.`
    : editable
      ? `Controleer het voorstel en pas aan wat nodig is. Klik op een post om alles te wijzigen: datum, tijd, onderwerp, kanalen, beeld en teksten. Wijzigingen worden direct opgeslagen. ${approver ? 'Keur je goed, dan komt alles meteen in de kalender; teksten die nog leeg zijn, schrijft de AI dan.' : 'Een social media manager keurt de planning goed.'}`
      : 'Een social media manager controleert en keurt deze planning goed. Klik op een post om alle details te zien.';

  const toolButtons = editable ? [
    h('button', { class: 'knop', type: 'button', onclick: () => action(writeTexts), title: 'Laat de AI nu de teksten per kanaal schrijven, zodat je ze vóór het goedkeuren kunt lezen en aanpassen' }, icon('sparkle', { size: 16 }), 'Teksten laten schrijven'),
    h('button', { class: 'knop', type: 'button', onclick: () => action(() => aiAgain('redistribute')), title: 'Dezelfde onderwerpen, opnieuw verdeeld over datums, tijden en kanalen' }, icon('sparkle', { size: 16 }), 'Nieuwe verdeling voorstellen'),
  ] : [];
  const moreItems = editable ? [
    { label: 'Hele voorstel opnieuw laten maken', icon: 'sparkle', action: () => action(() => aiAgain('regenerate')) },
    { label: 'Planning verwijderen', icon: 'prullenbak', action: () => action(removePlan) },
  ] : [];
  const moreButton = moreItems.length ? h('button', { class: 'knop icoonknop', type: 'button', 'aria-label': 'Meer acties', title: 'Meer acties', onclick: (e) => openMenu(e.currentTarget, moreItems) }, icon('meer')) : null;

  const intro = h('div', { class: 'sectie' },
    h('div', { class: 'knoppen', style: { marginBottom: '14px' } },
      h('a', { class: 'knop kaal klein', href: `#/klant/${clientId}/planning` }, icon('links', { size: 15 }), 'Alle planningen')),
    h('div', { class: 'knoppen', style: { gap: '16px' } },
      h('h2', { style: { fontSize: '22px', fontWeight: 700, flex: '1', minWidth: '280px' } }, `Conceptplanning ${period(plan.periodStart, plan.periodEnd)}`),
      h('div', { class: 'knoppen' }, toolButtons, moreButton)),
    h('div', { style: { marginTop: '12px' } }, steps),
    h('p', { style: { marginTop: '14px', maxWidth: '820px' } }, explanation),
    plan.aiSource === 'voorbeeld' && !done ? h('div', { class: 'melding let-op' }, icon('sparkle'), 'Voorbeeldmodus: er is nog geen AI gekoppeld, dus dit voorstel is volgens vaste regels gemaakt.') : null,
    plan.aiNote && plan.aiSource !== 'voorbeeld' ? h('div', { class: 'melding info' }, icon('sparkle'), h('div', {}, h('strong', {}, 'Toelichting van de AI. '), plan.aiNote)) : null,
    plan.wishes ? h('p', { class: 'zacht' }, `Jouw wensen: ${plan.wishes}`) : null);

  // ---------- Verdeling: wat de planning in getallen betekent ----------

  const summaryHost = h('section', { class: 'paneelblok sectie verdelingblok', 'aria-label': 'Verdeling' });
  function countBy(fn) {
    const acc = new Map();
    for (const it of items) for (const k of [fn(it)].flat()) acc.set(k, (acc.get(k) ?? 0) + 1);
    return [...acc];
  }
  function rows(entries, render) {
    const max = Math.max(1, ...entries.map(([, n]) => n));
    return entries.length ? entries.map(([label, n]) => render(label, n, max)) : h('p', { class: 'zacht' }, 'Nog niets');
  }
  const bar = (n, max, cls = '') => h('span', { class: 'spoor' }, h('span', { class: `vulling ${cls}`, style: { width: `${(n / max) * 100}%` } }));

  function drawSummary() {
    const target = client.posts_per_week;
    // Per week, van maandag t/m zondag. Een week die maar deels in de periode valt, krijgt een evenredig deel van de afspraak.
    const weeks = new Map();
    for (const it of items) {
      const mon = mondayOf(it.date);
      weeks.set(mon, (weeks.get(mon) ?? 0) + 1);
    }
    for (let d = mondayOf(plan.periodStart); d <= plan.periodEnd; d = addDays(d, 7)) if (!weeks.has(d)) weeks.set(d, 0);
    let anyPartial = false;
    const weekRows = [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([mon, n]) => {
      const sun = addDays(mon, 6);
      const from = mon < plan.periodStart ? plan.periodStart : mon;
      const to = sun > plan.periodEnd ? plan.periodEnd : sun;
      const days = Math.round((asDay(to) - asDay(from)) / 86400000) + 1;
      const expected = Math.round((target * days) / 7);
      const partial = days < 7;
      if (partial) anyPartial = true;
      const diff = n - expected;
      const verdict = diff === 0 ? h('span', { class: 'oordeel ok' }, icon('vink', { size: 13 }), 'Klopt')
        : h('span', { class: 'oordeel let-op' }, diff < 0 ? `${-diff} te weinig` : `${diff} te veel`);
      return h('div', { class: 'weekregel' },
        h('div', { class: 'weeknaam' }, h('strong', {}, `Week ${isoWeek(mon)}`),
          h('span', { class: 'zacht' }, `${shortDate.format(asDay(from))} t/m ${shortDate.format(asDay(to))}${partial ? `, ${days} ${days === 1 ? 'dag' : 'dagen'}` : ''}`)),
        h('span', { class: 'getal', title: `${n} onderwerpen, afspraak ${expected}` }, `${n} van ${expected}`),
        verdict);
    });

    fill(summaryHost,
      h('div', { class: 'verdelingkop' },
        h('h2', {}, 'Verdeling'),
        h('p', { class: 'zacht' }, `Zo zijn de ${items.length} onderwerpen verdeeld. Eén onderwerp kan op meerdere kanalen komen; elk kanaal wordt een eigen post in de kalender (samen ${cellCount()} posts).`)),
      h('div', { class: 'verdeling' },
        h('div', {}, h('h3', {}, 'Onderwerpen per week'), h('p', { class: 'hulp' }, `Afspraak: ${target} per week.${anyPartial ? ' Een week die maar deels in deze periode valt, telt naar rato.' : ''}`), weekRows),
        h('div', {}, h('h3', {}, 'Onderwerpen per contentpijler'), h('p', { class: 'hulp' }, 'Hoe vaak elke pijler aan bod komt.'),
          rows(countBy((it) => it.pillar ?? 'Geen pijler').sort((a, b) => b[1] - a[1]), (label, n, max) => h('div', { class: 'balk' },
            h('span', { class: 'label', title: label }, label), bar(n, max), h('span', { class: 'getal' }, n)))),
        h('div', {}, h('h3', {}, 'Posts per kanaal'), h('p', { class: 'hulp' }, 'Hoeveel posts er per kanaal in de kalender komen.'),
          rows(countBy((it) => it.channels.map(channelLabel)), (label, n, max) => h('div', { class: 'balk' },
            h('span', { class: 'label' }, label), bar(n, max), h('span', { class: 'getal' }, n))))));
  }

  // ---------- Posts, per week gegroepeerd ----------

  const listHost = h('section', { class: 'sectie', 'aria-label': 'Posts' });
  function duplicateKeys() {
    const seen = new Map();
    for (const it of items) for (const ch of it.channels) seen.set(`${it.date}|${ch}`, (seen.get(`${it.date}|${ch}`) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }

  function postCard(it, index, dups) {
    const keys = it.channels.map((ch) => `${it.date}|${ch}`);
    const conflicts = keys.filter((k) => conflictKeys.has(k));
    const isDup = keys.some((k) => dups.has(k));
    const input = it.clientInputId && inputsById.get(it.clientInputId);
    const written = it.channels.filter((ch) => it.texts[ch]?.trim()).length;
    const day = asDay(it.date);
    return h('button', {
      type: 'button', class: `postkaart ${isDup ? 'dubbel' : conflicts.length ? 'conflict' : ''}`,
      'aria-label': `${fmtLongDate(it.date)}: ${it.topic}. ${editable ? 'Klik om aan te passen' : 'Klik voor details'}`,
      onclick: () => openPost(index),
    },
    h('div', { class: 'wanneer' }, h('div', { class: 'dag' }, day.getDate()),
      h('div', { class: 'rest' }, weekdayFmt.format(day), it.time ? h('div', {}, it.time) : null)),
    h('div', { class: 'wat' },
      h('div', { class: 'onderwerp' }, it.topic || 'Nog geen onderwerp'),
      h('div', { class: 'meta' },
        it.channels.map((ch) => h('span', { class: 'chip kanaal' }, channelLabel(ch))),
        it.pillar ? h('span', { class: 'chip' }, it.pillar) : null,
        input ? h('span', { class: 'chip turkoois', title: input.body.slice(0, 300) }, icon('inbox', { size: 13 }), (input.title || input.body).slice(0, 36)) : null),
      h('div', { class: 'tekststatus zacht' }, written === it.channels.length && written
        ? `Teksten klaar (${written})`
        : written ? `Teksten: ${written} van ${it.channels.length} klaar, de rest schrijft de AI bij goedkeuren`
          : 'Teksten volgen bij goedkeuren'),
      isDup ? h('div', { class: 'waarschuwing fout' }, 'Op deze datum staat al een ander onderwerp op hetzelfde kanaal. Pas de datum of het kanaal aan.') : null,
      conflicts.length ? h('div', { class: 'waarschuwing' }, `In de kalender staat al een post op ${conflicts.map((k) => channelLabel(k.split('|')[1])).join(' en ')}. Bij goedkeuren kies je: houden of vervangen.`) : null),
    h('div', { class: 'beeldjes' }, it.media.map((id) => mediaById.get(id)).filter(Boolean).slice(0, 3).map((m) => mediaThumb(m)),
      it.media.length ? null : h('span', { class: 'zacht' }, 'Geen beeld')),
    h('span', { class: 'pijl', 'aria-hidden': 'true' }, icon('rechts', { size: 16 })));
  }

  function drawRows() {
    const dups = duplicateKeys();
    const groups = new Map();
    items.forEach((it, index) => {
      const mon = mondayOf(it.date);
      if (!groups.has(mon)) groups.set(mon, []);
      groups.get(mon).push(postCard(it, index, dups));
    });
    fill(listHost,
      h('div', { class: 'lijstkop' },
        h('h2', {}, `Posts (${items.length})`),
        h('span', { class: 'zacht' }, editable ? 'Klik op een post om hem aan te passen.' : 'Klik op een post voor alle details.'),
        editable ? h('button', { class: 'knop', type: 'button', style: { marginLeft: 'auto' }, onclick: () => openPost(-1) }, icon('plus', { size: 16 }), 'Post toevoegen') : null),
      items.length ? [...groups].map(([mon, cards]) => h('div', { class: 'weekgroep' },
        h('h3', {}, `Week ${isoWeek(mon)}`, h('span', { class: 'zacht' },
          ` ${shortDate.format(asDay(mon < plan.periodStart ? plan.periodStart : mon))} t/m ${shortDate.format(asDay(addDays(mon, 6) > plan.periodEnd ? plan.periodEnd : addDays(mon, 6)))}`)),
        h('div', { class: 'postlijst' }, cards)))
        : h('div', { class: 'paneelblok' }, emptyState(editable ? 'Deze planning heeft nog geen posts. Voeg er een toe.' : 'Deze planning heeft geen posts.')));
  }

  // ---------- Paneel: één post helemaal aanpassen ----------

  function openPost(index) {
    const isNew = index < 0;
    const source = isNew
      ? { date: items.at(-1)?.date ?? plan.periodStart, time: null, topic: '', channels: [...client.channels], pillar: null, clientInputId: null, media: [], rationale: '', texts: {} }
      : items[index];
    const draft = { ...source, texts: { ...source.texts }, media: [...source.media], channels: [...source.channels] };
    let changed = false;
    const touch = () => { changed = true; };
    const ro = !editable;

    const date = h('input', { type: 'date', value: draft.date, min: plan.periodStart, max: plan.periodEnd, disabled: ro, onchange: (e) => { draft.date = e.target.value; touch(); } });
    const time = h('input', { type: 'time', value: draft.time ?? '', disabled: ro, onchange: (e) => { draft.time = e.target.value || null; touch(); } });
    const topic = h('input', { type: 'text', value: draft.topic, disabled: ro, placeholder: 'Waar gaat deze post over?', oninput: (e) => { draft.topic = e.target.value; touch(); } });
    const pillar = h('select', { value: draft.pillar ?? '', disabled: ro, onchange: (e) => { draft.pillar = e.target.value || null; touch(); } },
      h('option', { value: '' }, 'Geen pijler'), pillars.map((p) => h('option', { value: p }, p)));
    const inputSelect = h('select', { value: draft.clientInputId ?? '', disabled: ro, onchange: (e) => { draft.clientInputId = e.target.value || null; touch(); } },
      h('option', { value: '' }, 'Geen klantinput'), inputs.map((i) => h('option', { value: i.id }, (i.title || i.body).slice(0, 70))));

    // Kanalen: die van de klant, en op verzoek de andere.
    const allChannels = meta.channels.map((c) => c.key);
    const own = client.channels.length ? allChannels.filter((ch) => client.channels.includes(ch) || draft.channels.includes(ch)) : allChannels;
    const textsHost = h('div', { class: 'teksten-per-kanaal' });
    const channelBoxes = allChannels.map((ch) => h('label', { hidden: !own.includes(ch) },
      h('input', { type: 'checkbox', value: ch, checked: draft.channels.includes(ch), disabled: ro,
        onchange: (e) => {
          draft.channels = allChannels.filter((c) => (c === ch ? e.target.checked : draft.channels.includes(c)));
          touch();
          drawTexts();
        } }), channelLabel(ch)));
    const moreChannels = !ro && own.length < allChannels.length ? h('button', {
      type: 'button', class: 'knop klein kaal', onclick: (e) => { channelBoxes.forEach((l) => { l.hidden = false; }); e.currentTarget.remove(); },
    }, icon('plus', { size: 14 }), 'Ander kanaal') : null;

    const textareas = {};
    function drawTexts() {
      fill(textsHost, draft.channels.length ? draft.channels.map((ch) => {
        textareas[ch] ??= h('textarea', {
          rows: 6, value: draft.texts[ch] ?? '', disabled: ro, 'aria-label': `Tekst voor ${channelLabel(ch)}`,
          placeholder: 'Leeg laten: de AI schrijft deze tekst bij goedkeuren.',
          oninput: (e) => { draft.texts[ch] = e.target.value; touch(); },
        });
        return h('div', { class: 'veld' },
          h('div', { class: 'tekstkop' }, h('label', {}, `Tekst voor ${channelLabel(ch)}`),
            h('button', { class: 'knop klein kaal', type: 'button', onclick: () => copyText(textareas[ch].value) }, icon('kopie', { size: 14 }), 'Kopiëren')),
          textareas[ch]);
      }) : h('p', { class: 'waarschuwing' }, 'Kies minimaal één kanaal.'));
    }
    drawTexts();

    const mediaHost = h('div', { class: 'beeldjes groot' });
    const drawMedia = () => fill(mediaHost, draft.media.length ? draft.media.map((id) => mediaById.get(id)).filter(Boolean).map((m) => mediaThumb(m)) : h('span', { class: 'zacht' }, 'Nog geen beeld gekozen'));
    drawMedia();
    const pickButton = ro ? null : h('button', {
      class: 'knop klein', type: 'button',
      onclick: async () => {
        const ids = await pickMedia(clientId, { selected: draft.media, title: `Beeld voor ${draft.topic || 'deze post'}` });
        if (!ids) return;
        (await api.get(`/clients/${clientId}/media`)).forEach((m) => mediaById.set(m.id, m));
        draft.media = ids;
        touch();
        drawMedia();
      },
    }, icon('beeld', { size: 15 }), draft.media.length ? 'Beeld wijzigen' : 'Beeld kiezen');

    const error = h('div', { class: 'melding fout', hidden: true, role: 'alert' });
    function apply() {
      const problem = !draft.topic.trim() ? 'Geef de post een onderwerp.'
        : !draft.channels.length ? 'Kies minimaal één kanaal.'
          : draft.date < plan.periodStart || draft.date > plan.periodEnd ? `Kies een datum tussen ${fmtDate(plan.periodStart)} en ${fmtDate(plan.periodEnd)}.` : null;
      if (problem) { error.textContent = problem; error.hidden = false; return false; }
      for (const ch of Object.keys(draft.texts)) if (!draft.channels.includes(ch)) delete draft.texts[ch];
      if (isNew) items.push(draft);
      else Object.assign(items[index], draft);
      commit();
      return true;
    }
    async function go(step) {
      if (changed && !apply()) return;
      close();
      const position = items.indexOf(isNew ? draft : source);
      openPost(Math.min(items.length - 1, Math.max(0, position + step)));
    }
    async function remove() {
      if (!(await confirmDialog('Post verwijderen?', `"${source.topic || 'Deze post'}" wordt uit de planning gehaald. De kalender verandert niet.`, { confirmLabel: 'Verwijderen', danger: true }))) return;
      items.splice(index, 1);
      close();
      commit();
    }
    async function tryClose() {
      if (changed && !ro && !(await confirmDialog('Wijzigingen niet opgeslagen', 'Wil je sluiten zonder op te slaan?', { confirmLabel: 'Sluiten zonder opslaan', danger: true }))) return;
      close();
    }

    const position = isNew ? items.length : index;
    const backdrop = h('div', { class: 'scherm', onclick: () => tryClose() });
    const panel = h('aside', { class: 'paneel', role: 'dialog', 'aria-modal': 'true', 'aria-label': isNew ? 'Post toevoegen' : 'Post aanpassen' },
      h('div', { class: 'paneel-kop' },
        h('div', { class: 'titel' },
          h('h2', {}, isNew ? 'Post toevoegen' : fmtLongDate(source.date)),
          h('div', { class: 'zacht' }, isNew ? 'Wordt toegevoegd aan deze conceptplanning' : `Post ${position + 1} van ${items.length}`)),
        !isNew ? [
          h('button', { class: 'knop kaal icoonknop', type: 'button', disabled: index <= 0, title: 'Vorige post', 'aria-label': 'Vorige post', onclick: () => go(-1) }, icon('omhoog')),
          h('button', { class: 'knop kaal icoonknop', type: 'button', disabled: index >= items.length - 1, title: 'Volgende post', 'aria-label': 'Volgende post', onclick: () => go(1) }, icon('omlaag')),
        ] : null,
        h('button', { class: 'knop kaal icoonknop', type: 'button', 'aria-label': 'Sluiten', title: 'Sluiten (Esc)', onclick: () => tryClose() }, icon('sluit'))),
      h('div', { class: 'paneel-inhoud' },
        error,
        h('div', { class: 'rij' }, field('Datum', date), field('Tijd (voorstel)', time)),
        field('Onderwerp', topic),
        h('div', { class: 'rij' }, field('Contentpijler', pillar), field('Klantinput', inputSelect)),
        h('div', { class: 'veld' }, h('label', {}, 'Kanalen'), h('div', { class: 'kanaalkeuze' }, channelBoxes, moreChannels)),
        h('div', { class: 'veld' }, h('div', { class: 'tekstkop' }, h('label', {}, 'Origineel beeld'), pickButton), mediaHost),
        textsHost,
        draft.rationale ? h('p', { class: 'zacht', style: { marginTop: '6px' } }, h('strong', {}, 'Waarom dit voorstel: '), draft.rationale) : null),
      h('div', { class: 'paneel-voet' },
        ro ? h('button', { class: 'knop primair', type: 'button', onclick: () => close() }, 'Sluiten') : [
          h('button', { class: 'knop primair', type: 'button', title: 'Opslaan (Ctrl+S)', onclick: () => { if (apply()) close(); } }, isNew ? 'Toevoegen' : 'Opslaan'),
          h('button', { class: 'knop', type: 'button', onclick: () => tryClose() }, 'Annuleren'),
          !isNew ? h('div', { class: 'rechts' }, h('button', { class: 'knop kaal gevaar', type: 'button', onclick: remove }, icon('prullenbak', { size: 16 }), 'Post verwijderen')) : null,
        ]));

    const onKey = (e) => {
      if (document.querySelector('.modaal, .menu')) return;
      if (e.key === 'Escape') tryClose();
      if (!ro && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (apply()) close(); }
    };
    function close() {
      backdrop.remove();
      panel.remove();
      document.removeEventListener('keydown', onKey);
    }
    document.querySelector('.paneel')?.remove();
    document.querySelector('.scherm')?.remove();
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop, panel);
    (ro ? panel.querySelector('.paneel-kop button:last-child') : topic).focus({ preventScroll: true });
  }

  // ---------- Acties ----------

  async function aiAgain(mode) {
    await saving;
    const wishes = h('textarea', { rows: 3, value: plan.wishes, placeholder: 'Bijv. meer spreiding, minder LinkedIn, kerst eerder' });
    const ok = await modal({
      title: mode === 'redistribute' ? 'Nieuwe verdeling voorstellen' : 'Nieuw voorstel laten maken',
      body: [
        h('p', {}, mode === 'redistribute'
          ? 'De AI verdeelt dezelfde onderwerpen opnieuw over datums, tijden en kanalen. Je aanpassingen aan datums en kanalen vervallen; daarna controleer je de planning opnieuw.'
          : 'De AI maakt een volledig nieuw voorstel. De huidige onderwerpen en je aanpassingen vervallen.'),
        field('Wat moet er anders? (optioneel)', wishes),
      ],
      buttons: [{ label: 'Annuleren' }, { label: mode === 'redistribute' ? 'Nieuwe verdeling voorstellen' : 'Nieuw voorstel maken', class: 'primair', value: true }],
    });
    if (!ok) return;
    await busy('De AI maakt een nieuw voorstel', () => api.post(`/plans/${planId}/${mode}`, { wishes: wishes.value }));
    toast('Nieuw voorstel klaar');
    rerender();
  }

  async function writeTexts() {
    await saving;
    const hasTexts = items.some((it) => it.channels.some((ch) => it.texts[ch]?.trim()));
    let overwrite = false;
    if (hasTexts) {
      const choice = await modal({
        title: 'Teksten laten schrijven',
        body: h('p', {}, 'Sommige posts hebben al een tekst. Wil je alleen de lege teksten laten schrijven, of ook bestaande teksten laten vervangen?'),
        buttons: [{ label: 'Annuleren', value: null }, { label: 'Alleen lege teksten', value: 'leeg', class: 'primair' }, { label: 'Alles opnieuw', value: 'alles' }],
      });
      if (!choice) return;
      overwrite = choice === 'alles';
    }
    await busy('De AI schrijft de teksten per kanaal', () => api.post(`/plans/${planId}/write-texts`, { overwrite }));
    toast('Teksten geschreven. Klik op een post om ze te lezen en aan te passen.');
    rerender();
  }

  async function removePlan() {
    if (!(await confirmDialog('Planning verwijderen?', 'Alleen dit voorstel wordt verwijderd. De kalender verandert niet.', { confirmLabel: 'Verwijderen', danger: true }))) return;
    await api.del(`/plans/${planId}`);
    toast('Planning verwijderd');
    location.hash = `#/klant/${clientId}/planning`;
  }

  // Bij bestaande content kiest de manager per kanaalcel: behouden of vervangen.
  async function resolveConflicts(conflicts) {
    const choices = conflicts.map((c) => {
      const name = `c-${c.key}`;
      return { key: c.key, el: h('li', {},
        h('strong', {}, `${fmtLongDate(c.date)}, ${channelLabel(c.channel)}`),
        h('div', { class: 'zacht', style: { marginTop: '4px' } }, `Nu in de kalender: ${c.existing.body ? `"${c.existing.body.slice(0, 120)}"` : (c.existing.topic || 'een post zonder tekst')}`),
        h('div', { class: 'zacht' }, `Nieuw onderwerp: ${c.newTopic}`),
        h('div', { class: 'keuzes' },
          h('label', {}, h('input', { type: 'radio', name, value: 'skip' }), 'Bestaande post houden'),
          h('label', {}, h('input', { type: 'radio', name, value: 'replace' }), 'Vervangen door de nieuwe'))) };
    });
    const error = h('div', { class: 'melding fout', hidden: true }, 'Maak voor elke post een keuze.');
    return modal({
      title: 'Er staan al posts op deze datums', width: '640px',
      body: [h('p', {}, 'Bestaande posts worden nooit zomaar overschreven. Kies per post wat er moet gebeuren. Een vervangen post blijft terug te vinden in de geschiedenis.'), error,
        h('ul', { class: 'conflictlijst' }, choices.map((c) => c.el))],
      buttons: [{ label: 'Annuleren' }, {
        label: 'Doorgaan', class: 'primair',
        action: () => {
          const result = {};
          for (const c of choices) {
            const picked = c.el.querySelector('input:checked');
            if (!picked) { error.hidden = false; return undefined; }
            result[c.key] = picked.value;
          }
          return result;
        },
      }],
    });
  }

  async function withConflictResolution(send) {
    let resolutions = {};
    for (;;) {
      try {
        return await send(resolutions);
      } catch (err) {
        if (err.status !== 409 || !err.body.conflicts?.length) throw err;
        const picked = await resolveConflicts(err.body.conflicts);
        if (!picked) return null;
        resolutions = { ...resolutions, ...picked };
      }
    }
  }

  async function approve() {
    if (duplicateKeys().size) return showError(new Error('Los eerst de rood gemarkeerde dubbelingen op: twee onderwerpen op dezelfde datum en hetzelfde kanaal.'));
    if (!items.length) return showError(new Error('Deze planning heeft geen posts.'));
    const missing = missingTexts();
    const ok = await confirmDialog('Goedkeuren en in de kalender zetten?',
      `Je keurt ${items.length} onderwerpen goed. Er komen ${cellCount()} posts in de kalender van ${client.name}.${missing ? ` De AI schrijft de ${missing} teksten die nog leeg zijn.` : ' Alle teksten zijn al geschreven.'}`,
      { confirmLabel: 'Goedkeuren' });
    if (!ok) return;
    await saving;
    if (saveState === 'fout') return showError(new Error('Niet alle wijzigingen zijn opgeslagen. Probeer het opnieuw.'));
    const fresh = await api.get(`/plans/${planId}`);
    let res;
    if (fresh.status === 'goedgekeurd' && fresh.approvedGeneration === fresh.generation) {
      res = await withConflictResolution((resolutions) => busy('In de kalender zetten', () => api.post(`/plans/${planId}/add-to-calendar`, { resolutions })));
    } else {
      if (fresh.status === 'concept') await api.post(`/plans/${planId}/submit`);
      res = await withConflictResolution((resolutions) => busy(missing ? 'Goedkeuren, in de kalender zetten en teksten schrijven' : 'Goedkeuren en in de kalender zetten',
        () => api.post(`/plans/${planId}/approve`, { reviewTextsFirst: false, resolutions })));
    }
    if (!res) return rerender();
    if (res.warning) showError(new Error(res.warning));
    toast(`${res.placed} posts in de kalender gezet${res.textsFilled ? `, ${res.textsFilled} teksten geschreven` : ''}`);
    location.hash = `#/klant/${clientId}/kalender?maand=${plan.periodStart.slice(0, 7)}`;
  }

  // ---------- Vaste actiebalk onderin ----------

  const barHost = h('div', { class: 'actiebalk' });
  function drawBar() {
    const state = { bezig: 'Opslaan…', fout: 'Niet opgeslagen', opgeslagen: 'Alle wijzigingen zijn opgeslagen' }[saveState];
    const summary = h('div', { class: 'samenvatting' },
      h('strong', {}, `${items.length} onderwerpen, ${cellCount()} posts`),
      h('span', { class: 'zacht' }, done ? 'Staat in de kalender' : editable ? state : 'Nog niet in de kalender'));
    let buttons;
    if (done) buttons = h('a', { class: 'knop primair', href: `#/klant/${clientId}/kalender?maand=${plan.periodStart.slice(0, 7)}` }, icon('kalender', { size: 16 }), 'Bekijk in de kalender');
    else if (approver) buttons = h('button', { class: 'knop primair', type: 'button', onclick: () => action(approve) }, icon('vink', { size: 16 }), 'Goedkeuren en in de kalender zetten');
    else buttons = h('span', { class: 'zacht', style: { color: '#b9bcbb' } }, 'Alleen een social media manager kan deze planning goedkeuren.');
    fill(barHost, summary, h('div', { class: 'rechts' }, buttons));
  }

  function drawAll() {
    drawSummary();
    drawRows();
    drawBar();
  }
  drawAll();

  return page(head(), intro, summaryHost, listHost, barHost);
}
