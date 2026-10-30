import {
  h, fill, icon, field, toast, showError, modal, confirmDialog, busy, mediaThumb, copyText, openMenu, page,
  fmtDate, fmtLongDate, fmtDateTime, isoDate, monthBounds, shiftMonth, isoWeek, emptyState,
} from '../ui.js';
import { api, meta, can, channelLabel } from '../api.js';
import { clientHeader } from './clients.js';
import { pickMedia } from './media.js';

const PLAN_LABEL = {
  concept: 'Concept', in_controle: 'In controle', aanpassen: 'Aanpassen', goedgekeurd: 'Goedgekeurd', toegevoegd_aan_kalender: 'In kalender',
};
const PLAN_ORDER = Object.keys(PLAN_LABEL);
const planChip = (status) => h('span', { class: `chip ${status === 'toegevoegd_aan_kalender' ? 'ok' : status === 'goedgekeurd' ? 'turkoois' : 'let-op'}` }, PLAN_LABEL[status]);
const period = (a, b) => `${fmtDate(a)} t/m ${fmtDate(b)}`;

// ---------- Overzicht en nieuwe conceptplanning ----------

export async function plansView({ clientId, tab }) {
  const [{ client, head }, plans, inputs] = await Promise.all([
    clientHeader(clientId, tab), api.get(`/clients/${clientId}/plans`), api.get(`/clients/${clientId}/inputs`),
  ]);
  const next = monthBounds(shiftMonth(isoDate(new Date()).slice(0, 7), 1));
  const start = h('input', { type: 'date', value: next.from, required: true });
  const end = h('input', { type: 'date', value: next.to, required: true });
  const wishes = h('textarea', { rows: 3, placeholder: 'Bijv. focus op kerst, geen posts in het weekend, LinkedIn maximaal één keer per week' });
  const openInputs = inputs.filter((i) => !i.processed).length;

  const form = can('managePlans') ? h('form', {
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
  h('div', { class: 'rij' }, field('Van', start), field('Tot en met', end)),
  field('Wensen voor deze periode', wishes),
  h('button', { class: 'knop primair', type: 'submit', style: { width: '100%' } }, icon('sparkle', { size: 16 }), 'Voorstel laten maken')) : null;

  const list = plans.length ? h('table', { class: 'lijst' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Periode'), h('th', {}, 'Status'), h('th', {}, 'Onderwerpen'), h('th', {}, 'Goedgekeurd'))),
    h('tbody', {}, plans.map((p) => h('tr', { class: 'klikbaar', onclick: () => { location.hash = `#/klant/${clientId}/planning/${p.id}`; } },
      h('td', {}, h('a', { href: `#/klant/${clientId}/planning/${p.id}`, style: { fontWeight: 600, textDecoration: 'none' } }, period(p.period_start, p.period_end)),
        h('div', { class: 'zacht' }, `Gemaakt ${fmtDateTime(p.created_at)}${p.ai_source === 'voorbeeld' ? ' (voorbeeldmodus)' : ''}`)),
      h('td', {}, planChip(p.status)),
      h('td', {}, p.item_count),
      h('td', { class: 'zacht' }, p.approved_by_name ? `${p.approved_by_name}, ${fmtDateTime(p.approved_at)}` : 'Nog niet'))))) : h('div', { class: 'paneelblok' }, emptyState('Nog geen planningen. Laat rechts een eerste voorstel maken.'));

  return page(head(), h('div', { class: form ? 'zij-kolom' : '' }, h('div', {}, list), form));
}

// ---------- Eén conceptplanning beoordelen ----------

export async function planView({ clientId, planId, tab, rerender }) {
  const [{ client, head }, plan, media, inputs] = await Promise.all([
    clientHeader(clientId, tab), api.get(`/plans/${planId}`), api.get(`/clients/${clientId}/media`), api.get(`/clients/${clientId}/inputs`),
  ]);
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const inputsById = new Map(inputs.map((i) => [i.id, i]));
  const manager = can('managePlans');
  const approver = can('approvePlans');
  const status = plan.status;
  const structureEditable = manager && status === 'aanpassen';
  const textsEditable = manager && ['aanpassen', 'goedgekeurd'].includes(status);
  const showTexts = plan.items.some((i) => Object.keys(i.texts).length) || status === 'goedgekeurd';
  const channels = [...new Set([...client.channels, ...plan.items.flatMap((i) => i.channels)])];
  const pillars = [...new Set([...client.content_pillars, ...plan.items.map((i) => i.pillar).filter(Boolean)])];

  const items = plan.items.map((i) => ({ ...i, texts: { ...i.texts }, media: [...i.media], channels: [...i.channels] }));
  let dirty = false;
  const conflictKeys = new Set(plan.conflicts.map((c) => c.key));
  const markDirty = () => { dirty = true; drawSummary(); drawBar(); };

  async function save() {
    if (!dirty) return;
    await api.put(`/plans/${planId}/items`, { items });
    dirty = false;
    toast('Wijzigingen opgeslagen');
  }
  async function action(fn) {
    try {
      await fn();
    } catch (err) {
      showError(err);
    }
  }

  // ---------- Kop van de planning ----------

  const current = PLAN_ORDER.indexOf(status);
  const steps = h('ol', { class: 'statusbaan', 'aria-label': 'Voortgang van de planning' },
    meta.planStatuses.map((s, i) => h('li', { class: i < current ? 'klaar' : i === current ? 'nu' : '', 'aria-current': i === current ? 'step' : null },
      h('span', { class: 'punt' }, i < current ? icon('vink', { size: 11 }) : null), PLAN_LABEL[s.key])));

  const explanation = {
    concept: 'Dit is een voorstel van de AI. Controleer en pas aan waar nodig, en keur het daarna goed.',
    in_controle: 'Dit voorstel wacht op beoordeling door een social media manager.',
    aanpassen: 'Pas datums, tijden, onderwerpen, kanalen en beeld aan. Je wijzigingen worden opgeslagen bij goedkeuren.',
    goedgekeurd: plan.reviewTextsFirst ? 'Goedgekeurd. Controleer de teksten per kanaal en zet de planning daarna in de kalender.' : 'Goedgekeurd.',
    toegevoegd_aan_kalender: `Staat in de kalender sinds ${fmtDateTime(plan.addedToCalendarAt)}. Goedgekeurd door ${plan.approvedByName ?? 'onbekend'}.`,
  }[status];

  const toolButtons = manager && ['concept', 'in_controle'].includes(status) ? [
    h('button', { class: 'knop', onclick: () => action(adjust) }, icon('bewerk', { size: 16 }), 'Conceptplanning aanpassen'),
    h('button', { class: 'knop', onclick: () => action(() => aiAgain('redistribute')) }, icon('sparkle', { size: 16 }), 'Nieuwe verdeling voorstellen'),
  ] : manager && status === 'aanpassen' ? [
    h('button', { class: 'knop', onclick: () => action(() => aiAgain('redistribute')) }, icon('sparkle', { size: 16 }), 'Nieuwe verdeling voorstellen'),
  ] : manager && status === 'goedgekeurd' ? [
    h('button', { class: 'knop', onclick: () => action(adjust) }, icon('bewerk', { size: 16 }), 'Conceptplanning aanpassen'),
  ] : [];
  const moreItems = manager && status !== 'toegevoegd_aan_kalender' ? [
    ...(status === 'concept' ? [{ label: 'Ter controle aanbieden', icon: 'vink', action: () => action(async () => { await api.post(`/plans/${planId}/submit`); rerender(); }) }] : []),
    ...(status !== 'goedgekeurd' ? [{ label: 'Hele voorstel opnieuw laten maken', icon: 'sparkle', action: () => action(() => aiAgain('regenerate')) }] : []),
    { label: 'Planning verwijderen', icon: 'prullenbak', action: () => action(removePlan) },
  ] : [];
  const moreButton = moreItems.length ? h('button', { class: 'knop icoonknop', 'aria-label': 'Meer acties', title: 'Meer acties', onclick: (e) => openMenu(e.currentTarget, moreItems) }, icon('meer')) : null;

  const intro = h('div', { class: 'sectie' },
    h('div', { class: 'knoppen', style: { marginBottom: '14px' } },
      h('a', { class: 'knop kaal klein', href: `#/klant/${clientId}/planning` }, icon('links', { size: 15 }), 'Alle planningen')),
    h('div', { class: 'knoppen', style: { gap: '16px' } },
      h('h2', { style: { fontSize: '22px', fontWeight: 700, flex: '1', minWidth: '280px' } }, `Conceptplanning ${period(plan.periodStart, plan.periodEnd)}`),
      h('div', { class: 'knoppen' }, toolButtons, moreButton)),
    h('div', { style: { marginTop: '12px' } }, steps),
    h('p', { style: { marginTop: '14px', maxWidth: '760px' } }, explanation),
    plan.aiSource === 'voorbeeld' && status !== 'toegevoegd_aan_kalender' ? h('div', { class: 'melding let-op' }, icon('sparkle'), 'Voorbeeldmodus: er is nog geen AI gekoppeld, dus dit voorstel is volgens vaste regels gemaakt.') : null,
    plan.aiNote && plan.aiSource !== 'voorbeeld' ? h('div', { class: 'melding info' }, icon('sparkle'), h('div', {}, h('strong', {}, 'Toelichting van de AI. '), plan.aiNote)) : null,
    plan.wishes ? h('p', { class: 'zacht' }, `Jouw wensen: ${plan.wishes}`) : null);

  // ---------- Verdeling ----------

  const summaryHost = h('div', { class: 'paneelblok sectie' });
  function bars(title, entries, target) {
    const max = Math.max(1, target ?? 0, ...entries.map(([, n]) => n));
    return h('div', {}, h('h3', {}, title), entries.length ? entries.map(([label, n]) => h('div', { class: 'balk' },
      h('span', { class: 'label', title: label }, label),
      h('span', { class: 'spoor' },
        h('span', { class: `vulling ${target && n > target ? 'boven' : ''}`, style: { width: `${(n / max) * 100}%` } }),
        target ? h('span', { class: 'doel', style: { left: `calc(${(target / max) * 100}% - 1px)` }, title: `Afspraak: ${target}` }) : null),
      h('span', { class: 'getal' }, n))) : h('p', { class: 'zacht' }, 'Nog niets'));
  }
  function drawSummary() {
    const count = (fn) => Object.entries(items.reduce((acc, it) => { for (const k of [fn(it)].flat()) acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}));
    // Weken op volgorde van hun eerste datum, zodat week 53 vóór week 1 van het nieuwe jaar komt.
    const firstDate = {};
    for (const it of items) {
      const w = `week ${isoWeek(it.date)}`;
      if (!firstDate[w] || it.date < firstDate[w]) firstDate[w] = it.date;
    }
    const weeks = count((it) => `week ${isoWeek(it.date)}`).sort((a, b) => firstDate[a[0]].localeCompare(firstDate[b[0]]));
    const noMedia = items.filter((it) => !it.media.length).length;
    fill(summaryHost,
      h('div', { class: 'verdeling' },
        bars(`Per week (afspraak ${client.posts_per_week})`, weeks, client.posts_per_week),
        bars('Per contentpijler', count((it) => it.pillar ?? 'Geen pijler')),
        bars('Per kanaal', count((it) => it.channels.map(channelLabel)))),
      noMedia ? h('p', { class: 'waarschuwing', style: { marginTop: '14px', marginBottom: 0 } }, `${noMedia} onderwerp${noMedia > 1 ? 'en hebben' : ' heeft'} nog geen beeld.`) : null);
  }
  drawSummary();

  // ---------- Onderwerpen ----------

  const listHost = h('div', { class: 'planlijst' });
  function duplicateKeys() {
    const seen = new Map();
    for (const it of items) for (const ch of it.channels) seen.set(`${it.date}|${ch}`, (seen.get(`${it.date}|${ch}`) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }

  function drawRows() {
    const dups = duplicateKeys();
    fill(listHost, items.length ? items.map((it, index) => {
      const keys = it.channels.map((ch) => `${it.date}|${ch}`);
      const conflicts = keys.filter((k) => conflictKeys.has(k));
      const isDup = keys.some((k) => dups.has(k));
      const update = (patch, redraw = false) => { Object.assign(it, patch); markDirty(); if (redraw) drawRows(); };
      const input = it.clientInputId && inputsById.get(it.clientInputId);
      const day = new Date(`${it.date}T12:00:00`);

      const when = structureEditable
        ? h('div', { class: 'bewerkvelden' },
          h('input', { type: 'date', value: it.date, min: plan.periodStart, max: plan.periodEnd, 'aria-label': 'Datum', onchange: (e) => update({ date: e.target.value }, true) }),
          h('input', { type: 'time', value: it.time ?? '', 'aria-label': 'Tijdstip (voorstel)', onchange: (e) => update({ time: e.target.value || null }) }))
        : h('div', { class: 'wanneer' }, h('div', { class: 'dag' }, day.getDate()),
          h('div', { class: 'rest' }, day.toLocaleDateString('nl-NL', { weekday: 'long' }), it.time ? h('div', {}, `${it.time} (voorstel)`) : null));

      const what = structureEditable
        ? h('div', { class: 'bewerkvelden' },
          h('input', { type: 'text', value: it.topic, placeholder: 'Onderwerp', 'aria-label': 'Onderwerp', oninput: (e) => update({ topic: e.target.value }) }),
          h('div', { class: 'twee' },
            h('select', { value: it.pillar ?? '', 'aria-label': 'Contentpijler', onchange: (e) => update({ pillar: e.target.value || null }) },
              h('option', { value: '' }, 'Geen pijler'), pillars.map((p) => h('option', { value: p }, p))),
            h('select', { value: it.clientInputId ?? '', 'aria-label': 'Klantinput', onchange: (e) => update({ clientInputId: e.target.value || null }) },
              h('option', { value: '' }, 'Geen klantinput'), inputs.map((i) => h('option', { value: i.id }, (i.title || i.body).slice(0, 60))))))
        : h('div', {},
          h('div', { class: 'onderwerp' }, it.topic),
          h('div', { class: 'meta' },
            it.pillar ? h('span', { class: 'chip' }, it.pillar) : null,
            input ? h('span', { class: 'chip turkoois', title: input.body.slice(0, 300) }, icon('inbox', { size: 13 }), (input.title || input.body).slice(0, 40)) : null),
          it.rationale ? h('div', { class: 'reden' }, it.rationale) : null);

      const chans = h('div', { class: 'kanaalkeuze' }, channels.map((ch) => h('label', {},
        h('input', {
          type: 'checkbox', checked: it.channels.includes(ch), disabled: !structureEditable,
          onchange: (e) => update({ channels: e.target.checked ? [...it.channels, ch] : it.channels.filter((c) => c !== ch) }, true),
        }), channelLabel(ch))));

      const picture = h('div', { class: 'beeldkol' },
        h('div', { class: 'beeldjes' }, it.media.map((id) => mediaById.get(id)).filter(Boolean).map((m) => mediaThumb(m)),
          structureEditable ? h('button', {
            class: 'knop klein', type: 'button',
            onclick: async () => {
              const ids = await pickMedia(clientId, { selected: it.media, title: `Beeld voor ${it.topic || 'dit onderwerp'}` });
              if (!ids) return;
              (await api.get(`/clients/${clientId}/media`)).forEach((m) => mediaById.set(m.id, m));
              update({ media: ids }, true);
            },
          }, icon('beeld', { size: 15 }), it.media.length ? 'Wijzigen' : 'Kiezen') : null),
        !it.media.length && !structureEditable ? h('span', { class: 'zacht' }, 'Geen beeld') : null);

      const order = h('div', { class: 'volgorde' }, structureEditable ? [
        h('button', { class: 'knop kaal icoonknop klein', disabled: index === 0, 'aria-label': 'Omhoog', title: 'Omhoog', onclick: () => { items.splice(index - 1, 0, items.splice(index, 1)[0]); markDirty(); drawRows(); } }, icon('omhoog', { size: 16 })),
        h('button', { class: 'knop kaal icoonknop klein', disabled: index === items.length - 1, 'aria-label': 'Omlaag', title: 'Omlaag', onclick: () => { items.splice(index + 1, 0, items.splice(index, 1)[0]); markDirty(); drawRows(); } }, icon('omlaag', { size: 16 })),
        h('button', { class: 'knop kaal icoonknop klein gevaar', 'aria-label': 'Onderwerp verwijderen', title: 'Verwijderen', onclick: () => { items.splice(index, 1); markDirty(); drawRows(); } }, icon('prullenbak', { size: 16 })),
      ] : null);

      const warnings = [
        isDup ? h('div', { class: 'waarschuwing fout' }, 'Op deze datum staat al een ander onderwerp op hetzelfde kanaal.') : null,
        conflicts.length ? h('div', { class: 'waarschuwing' }, `Er staat al een post in de kalender op ${conflicts.map((k) => channelLabel(k.split('|')[1])).join(' en ')}. Bij goedkeuren kies je wat er gebeurt.`) : null,
      ];

      const texts = showTexts ? h('div', { class: 'teksten' }, it.channels.map((ch) => h('div', {},
        h('label', {}, channelLabel(ch), it.texts[ch] ? h('button', { class: 'knop kaal klein icoonknop', type: 'button', title: 'Kopiëren', 'aria-label': `Tekst ${channelLabel(ch)} kopiëren`, onclick: () => copyText(it.texts[ch]) }, icon('kopie', { size: 14 })) : null),
        h('textarea', {
          value: it.texts[ch] ?? '', disabled: !textsEditable, placeholder: 'Nog geen tekst', 'aria-label': `Tekst ${channelLabel(ch)}`,
          oninput: (e) => { it.texts[ch] = e.target.value; markDirty(); },
        })))) : null;

      return h('div', { class: `planregel ${isDup ? 'dubbel' : conflicts.length ? 'conflict' : ''}` },
        when, h('div', {}, what, warnings), chans, picture, order, texts);
    }) : emptyState(structureEditable ? 'Geen onderwerpen. Voeg er een toe.' : 'Deze planning heeft geen onderwerpen.'));
  }
  drawRows();

  const addRow = structureEditable ? h('div', { class: 'knoppen', style: { marginTop: '12px' } },
    h('button', {
      class: 'knop', onclick: () => {
        const last = items.at(-1);
        items.push({ date: last?.date ?? plan.periodStart, time: null, topic: '', channels: [...client.channels], pillar: null, clientInputId: null, media: [], rationale: '', texts: {} });
        markDirty();
        drawRows();
        listHost.lastElementChild?.querySelector('input[type=text]')?.focus();
      },
    }, icon('plus', { size: 16 }), 'Onderwerp toevoegen'),
    h('button', { class: 'knop kaal', onclick: () => { items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '')); markDirty(); drawRows(); } }, 'Sorteren op datum')) : null;

  // ---------- Acties ----------

  async function adjust() {
    if (status === 'goedgekeurd' && !(await confirmDialog('Goedkeuring intrekken?',
      'Om datums, kanalen of onderwerpen te wijzigen wordt de planning heropend. Daarna keur je hem opnieuw goed.', { confirmLabel: 'Heropenen' }))) return;
    await api.post(`/plans/${planId}/adjust`);
    rerender();
  }

  async function aiAgain(mode) {
    const wishes = h('textarea', { rows: 3, value: plan.wishes, placeholder: 'Bijv. meer spreiding, minder LinkedIn, kerst eerder' });
    const ok = await modal({
      title: mode === 'redistribute' ? 'Nieuwe verdeling voorstellen' : 'Nieuw voorstel laten maken',
      body: [
        h('p', {}, mode === 'redistribute'
          ? 'De AI verdeelt de onderwerpen opnieuw over datums, tijden en kanalen. Daarna beoordeel je de planning opnieuw.'
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

  const reviewFirst = h('input', { type: 'checkbox', checked: plan.reviewTextsFirst });
  const cellCount = () => items.reduce((n, it) => n + it.channels.length, 0);

  async function approveAndAdd() {
    if (duplicateKeys().size) return showError(new Error('Los eerst de rood gemarkeerde dubbelingen op: twee onderwerpen op dezelfde datum en hetzelfde kanaal.'));
    if (!items.length) return showError(new Error('Deze planning heeft geen onderwerpen.'));
    const ok = await confirmDialog('Planning goedkeuren?', reviewFirst.checked
      ? `Je keurt ${items.length} onderwerpen goed (${cellCount()} posts). De AI schrijft daarna de teksten per kanaal; die controleer je eerst, voordat ze in de kalender komen.`
      : `Je keurt ${items.length} onderwerpen goed (${cellCount()} posts). Ze komen direct in de kalender en de AI schrijft de teksten per kanaal.`,
    { confirmLabel: 'Goedkeuren' });
    if (!ok) return;
    await save();
    if (status === 'concept') await api.post(`/plans/${planId}/submit`);
    const res = await withConflictResolution((resolutions) => busy(reviewFirst.checked ? 'Goedkeuren en teksten schrijven' : 'Goedkeuren, in de kalender zetten en teksten schrijven',
      () => api.post(`/plans/${planId}/approve`, { reviewTextsFirst: reviewFirst.checked, resolutions })));
    if (!res) return rerender();
    if (res.warning) showError(new Error(res.warning));
    if (reviewFirst.checked) {
      toast('Goedgekeurd. Controleer nu de teksten.');
      rerender();
    } else {
      toast(`${res.placed} posts in de kalender gezet, ${res.textsFilled} teksten geschreven`);
      location.hash = `#/klant/${clientId}/kalender?maand=${plan.periodStart.slice(0, 7)}`;
    }
  }

  async function addReviewed() {
    const missing = items.reduce((n, it) => n + it.channels.filter((ch) => !it.texts[ch]?.trim()).length, 0);
    const ok = await confirmDialog('In de kalender zetten?',
      `De teksten en het gekozen beeld komen in de contentkalender.${missing ? ` Let op: ${missing} post${missing > 1 ? 's hebben' : ' heeft'} nog geen tekst.` : ''}`,
      { confirmLabel: 'In kalender zetten' });
    if (!ok) return;
    await save();
    const res = await withConflictResolution((resolutions) => api.post(`/plans/${planId}/add-to-calendar`, { resolutions }));
    if (!res) return rerender();
    toast(`${res.placed} posts in de kalender gezet`);
    location.hash = `#/klant/${clientId}/kalender?maand=${plan.periodStart.slice(0, 7)}`;
  }

  async function rewriteTexts() {
    const choice = await modal({
      title: 'Teksten opnieuw laten schrijven',
      body: h('p', {}, 'Wil je alleen de ontbrekende teksten laten aanvullen, of ook bestaande teksten laten vervangen?'),
      buttons: [{ label: 'Annuleren', value: null }, { label: 'Alleen ontbrekende', value: 'nee' }, { label: 'Alles vervangen', value: 'ja', class: 'primair' }],
    });
    if (!choice) return;
    await save();
    await busy('De AI schrijft de teksten per kanaal', () => api.post(`/plans/${planId}/write-texts`, { overwrite: choice === 'ja' }));
    rerender();
  }

  // ---------- Vaste actiebalk onderin ----------

  const bar = h('div', { class: 'actiebalk' });
  function drawBar() {
    const summary = h('div', { class: 'samenvatting' },
      h('strong', {}, `${items.length} onderwerpen, ${cellCount()} posts`),
      h('span', { class: 'zacht' }, dirty ? 'Niet-opgeslagen wijzigingen' : status === 'toegevoegd_aan_kalender' ? 'Staat in de kalender' : 'Nog niet in de kalender'));
    let buttons = [];
    if (approver && ['concept', 'in_controle', 'aanpassen'].includes(status)) {
      buttons = [
        dirty ? h('button', { class: 'knop', onclick: () => action(async () => { await save(); rerender(); }) }, 'Wijzigingen opslaan') : null,
        h('label', { class: 'vinkje' }, reviewFirst, 'Eerst teksten controleren'),
        h('button', { class: 'knop primair', onclick: () => action(approveAndAdd) }, icon('vink', { size: 16 }), 'Planning goedkeuren en toevoegen aan kalender'),
      ];
    } else if (approver && status === 'goedgekeurd') {
      buttons = [
        dirty ? h('button', { class: 'knop', onclick: () => action(async () => { await save(); rerender(); }) }, 'Wijzigingen opslaan') : null,
        h('button', { class: 'knop', onclick: () => action(rewriteTexts) }, icon('sparkle', { size: 16 }), 'Teksten opnieuw laten schrijven'),
        h('button', { class: 'knop primair', onclick: () => action(addReviewed) }, icon('vink', { size: 16 }), 'Teksten goedkeuren en in kalender zetten'),
      ];
    } else if (status === 'toegevoegd_aan_kalender') {
      buttons = [h('a', { class: 'knop primair', href: `#/klant/${clientId}/kalender?maand=${plan.periodStart.slice(0, 7)}` }, icon('kalender', { size: 16 }), 'Bekijk in de kalender')];
    } else {
      buttons = [h('span', { class: 'zacht', style: { color: '#b9bcbb' } }, 'Alleen een social media manager kan deze planning goedkeuren.')];
    }
    fill(bar, summary, h('div', { class: 'rechts' }, buttons));
  }
  drawBar();

  return page(head(), intro, summaryHost, listHost, addRow, bar);
}
