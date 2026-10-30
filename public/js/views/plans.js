import {
  h, fill, field, toast, showError, modal, confirmDialog, busy, mediaThumb, fmtDate, fmtLongDate, fmtDateTime, isoDate,
  monthBounds, shiftMonth, isoWeek, emptyState,
} from '../ui.js';
import { api, meta, can, channelLabel } from '../api.js';
import { clientHeader } from './clients.js';
import { pickMedia } from './media.js';

const PLAN_LABEL = {
  concept: 'Concept', in_controle: 'In controle', aanpassen: 'Aanpassen', goedgekeurd: 'Goedgekeurd', toegevoegd_aan_kalender: 'Toegevoegd aan kalender',
};
const PLAN_ORDER = Object.keys(PLAN_LABEL);
const planChip = (status) => h('span', { class: `chip ${status === 'toegevoegd_aan_kalender' ? 'ai-aan' : status === 'goedgekeurd' ? '' : 'ai-uit'}` }, PLAN_LABEL[status]);

// ---------- Overzicht en nieuwe conceptplanning ----------

export async function plansView({ clientId, tab, rerender }) {
  const [{ client, header }, plans, inputs] = await Promise.all([
    clientHeader(clientId, tab), api.get(`/clients/${clientId}/plans`), api.get(`/clients/${clientId}/inputs`),
  ]);
  const next = monthBounds(shiftMonth(isoDate(new Date()).slice(0, 7), 1));
  const start = h('input', { type: 'date', value: next.from, required: true });
  const end = h('input', { type: 'date', value: next.to, required: true });
  const wishes = h('textarea', { rows: 3, placeholder: 'Optioneel: "focus op kerst", "geen posts in het weekend", "LinkedIn maximaal 1× per week"…' });
  const openInputs = inputs.filter((i) => !i.processed).length;

  const form = can('managePlans') ? h('form', {
    class: 'kaart sectie',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const plan = await busy('De AI analyseert de klantcontext en maakt een conceptplanning…',
          () => api.post(`/clients/${clientId}/plans`, { periodStart: start.value, periodEnd: end.value, wishes: wishes.value }));
        location.hash = `#/klant/${clientId}/planning/${plan.id}`;
      } catch (err) {
        showError(err);
      }
    },
  },
  h('h2', {}, 'Nieuwe conceptplanning'),
  h('p', { class: 'zacht' },
    `De AI stelt onderwerpen, datums, tijdstippen, kanalen en beeld voor op basis van de strategie, ${client.posts_per_week} posts per week en `,
    openInputs ? `${openInputs} nieuwe klantinput.` : 'algemene content (er is geen nieuwe klantinput).',
    ' Er komt niets in de kalender zonder jouw goedkeuring.'),
  h('div', { class: 'rij' }, field('Van', start), field('Tot en met', end)),
  field('Wensen voor deze periode', wishes),
  h('button', { class: 'knop primair', type: 'submit' }, 'Conceptplanning laten maken')) : null;

  return [
    ...header,
    form,
    h('h2', {}, 'Planningen'),
    plans.length ? h('table', { class: 'lijst' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Periode'), h('th', {}, 'Status'), h('th', {}, 'Onderwerpen'), h('th', {}, 'Gemaakt'), h('th', {}, 'Goedgekeurd door'))),
      h('tbody', {}, plans.map((p) => h('tr', { class: 'klikbaar', onclick: () => { location.hash = `#/klant/${clientId}/planning/${p.id}`; } },
        h('td', {}, h('a', { href: `#/klant/${clientId}/planning/${p.id}` }, `${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}`)),
        h('td', {}, planChip(p.status), p.ai_source === 'voorbeeld' ? h('span', { class: 'zacht' }, ' · voorbeeld') : null),
        h('td', {}, p.item_count), h('td', { class: 'zacht' }, fmtDateTime(p.created_at)),
        h('td', { class: 'zacht' }, p.approved_by_name ? `${p.approved_by_name}, ${fmtDateTime(p.approved_at)}` : '—'))))) : emptyState('Nog geen planningen voor deze klant.'),
  ];
}

// ---------- Eén conceptplanning beoordelen ----------

export async function planView({ clientId, planId, tab, rerender }) {
  const [{ client, header }, plan, media, inputs] = await Promise.all([
    clientHeader(clientId, tab), api.get(`/plans/${planId}`), api.get(`/clients/${clientId}/media`), api.get(`/clients/${clientId}/inputs`),
  ]);
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const inputsById = new Map(inputs.map((i) => [i.id, i]));
  const manager = can('managePlans');
  const status = plan.status;
  const structureEditable = manager && status === 'aanpassen';
  const textsEditable = manager && ['aanpassen', 'goedgekeurd'].includes(status);
  const showTexts = plan.items.some((i) => Object.keys(i.texts).length) || status === 'goedgekeurd';
  const channels = [...new Set([...client.channels, ...plan.items.flatMap((i) => i.channels)])];
  const pillars = [...new Set([...client.content_pillars, ...plan.items.map((i) => i.pillar).filter(Boolean)])];

  let items = plan.items.map((i) => ({ ...i, texts: { ...i.texts }, media: [...i.media], channels: [...i.channels] }));
  let dirty = false;
  const conflictKeys = new Set(plan.conflicts.map((c) => c.key));

  const saveBar = h('div', { class: 'melding let-op', hidden: true }, 'Je hebt niet-opgeslagen wijzigingen. ',
    h('button', { class: 'knop klein', onclick: () => save().then(rerender).catch(showError) }, 'Wijzigingen opslaan'));
  const markDirty = () => { dirty = true; saveBar.hidden = false; drawSummary(); };

  async function save() {
    if (!dirty) return;
    await api.put(`/plans/${planId}/items`, { items });
    dirty = false;
    toast('Conceptplanning opgeslagen.');
  }

  // ---------- Kop: stappen en toelichting ----------

  const current = PLAN_ORDER.indexOf(status);
  const steps = h('ol', { class: 'stappen', 'aria-label': 'Status van de planning' },
    meta.planStatuses.map((s, i) => h('li', { class: i < current ? 'klaar' : i === current ? 'nu' : '', 'aria-current': i === current ? 'step' : null },
      h('span', { class: 'nr' }, i < current ? '✓' : i + 1), s.label)));

  const intro = [
    h('div', { class: 'klantkop' },
      h('div', {}, h('a', { href: `#/klant/${clientId}/planning`, class: 'zacht', style: { textDecoration: 'none' } }, '← Alle planningen'),
        h('h2', { style: { margin: 0 } }, `Conceptplanning ${fmtDate(plan.periodStart)} – ${fmtDate(plan.periodEnd)}`)),
      h('div', { class: 'knoppen', style: { marginLeft: 'auto' } }, planChip(status), h('span', { class: 'zacht' }, `versie ${plan.generation}`))),
    steps,
    status !== 'toegevoegd_aan_kalender'
      ? h('div', { class: 'melding info' }, h('strong', {}, 'Deze planning staat nog niet in de contentkalender. '),
        'Controleer datums, tijden, onderwerpen, kanalen en beeld. Pas na jouw expliciete goedkeuring wordt de planning toegevoegd. Tijdstippen zijn adviezen, geen gegarandeerd optimale tijden.')
      : h('div', { class: 'melding ok' }, `Toegevoegd aan de kalender op ${fmtDateTime(plan.addedToCalendarAt?.replace('T', ' ').slice(0, 19))}, goedgekeurd door ${plan.approvedByName ?? 'onbekend'}. `,
        h('a', { href: `#/klant/${clientId}/kalender?maand=${plan.periodStart.slice(0, 7)}` }, 'Naar de kalender →')),
    plan.aiSource === 'voorbeeld' ? h('div', { class: 'melding let-op' }, 'Voorbeeldverdeling: er is geen AI-sleutel ingesteld op de server. De verdeling is volgens vaste regels gemaakt.') : null,
    plan.aiNote ? h('p', {}, h('strong', {}, 'Toelichting AI: '), plan.aiNote) : null,
    plan.wishes ? h('p', { class: 'zacht' }, 'Wensen: ', plan.wishes) : null,
    status === 'goedgekeurd' ? h('div', { class: 'melding ok' }, `Goedgekeurd door ${plan.approvedByName}. `,
      plan.reviewTextsFirst ? 'Controleer de conceptteksten hieronder en voeg de planning daarna toe aan de kalender.' : '') : null,
  ];

  // ---------- Verdeling ----------

  const summaryHost = h('div', { class: 'kaart sectie' });
  function bars(title, entries, target) {
    const max = Math.max(1, target ?? 0, ...entries.map(([, n]) => n));
    return h('div', {}, h('h3', {}, title), entries.length ? entries.map(([label, n]) => h('div', { class: 'balk' },
      h('span', { class: 'label', title: label }, label), h('span', { class: 'spoor' }, h('span', { class: 'vulling', style: { width: `${(n / max) * 100}%` } })),
      h('span', { class: 'getal' }, n))) : h('p', { class: 'zacht' }, '—'));
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
      h('h3', {}, `Verdeling: ${items.length} onderwerpen, ${items.reduce((n, it) => n + it.channels.length, 0)} kanaalcellen`),
      h('div', { class: 'verdeling' },
        bars(`Per week (afspraak: ${client.posts_per_week})`, weeks, client.posts_per_week),
        bars('Per contentpijler', count((it) => it.pillar ?? 'Geen pijler')),
        bars('Per kanaal', count((it) => it.channels.map(channelLabel)))),
      noMedia ? h('p', { class: 'waarschuwing' }, `${noMedia} onderwerp(en) zonder beeld.`) : null);
  }
  drawSummary();

  // ---------- Tabel met planregels ----------

  const tbody = h('tbody');
  function duplicateKeys() {
    const seen = new Map();
    for (const it of items) for (const ch of it.channels) seen.set(`${it.date}|${ch}`, (seen.get(`${it.date}|${ch}`) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }

  function drawRows() {
    const dups = duplicateKeys();
    fill(tbody, ...items.flatMap((it, index) => {
      const keys = it.channels.map((ch) => `${it.date}|${ch}`);
      const conflicts = keys.filter((k) => conflictKeys.has(k));
      const isDup = keys.some((k) => dups.has(k));
      const update = (patch, redraw = false) => { Object.assign(it, patch); markDirty(); if (redraw) drawRows(); };

      const dateIn = h('input', { type: 'date', value: it.date, min: plan.periodStart, max: plan.periodEnd, disabled: !structureEditable, onchange: (e) => update({ date: e.target.value }, true) });
      const timeIn = h('input', { type: 'time', value: it.time ?? '', disabled: !structureEditable, title: 'Voorgesteld tijdstip', onchange: (e) => update({ time: e.target.value || null }) });
      const topicIn = h('input', { type: 'text', value: it.topic, disabled: !structureEditable, oninput: (e) => update({ topic: e.target.value }) });
      const pillarIn = h('select', { value: it.pillar ?? '', disabled: !structureEditable, onchange: (e) => update({ pillar: e.target.value || null }) },
        h('option', { value: '' }, '— Geen pijler —'), pillars.map((p) => h('option', { value: p }, p)));
      const inputIn = h('select', { value: it.clientInputId ?? '', disabled: !structureEditable, onchange: (e) => update({ clientInputId: e.target.value || null }) },
        h('option', { value: '' }, '— Geen klantinput —'), inputs.map((i) => h('option', { value: i.id }, (i.title || i.body).slice(0, 60))));
      const chans = h('div', { class: 'kanaalkeuze' }, channels.map((ch) => h('label', {},
        h('input', {
          type: 'checkbox', checked: it.channels.includes(ch), disabled: !structureEditable,
          onchange: (e) => update({ channels: e.target.checked ? [...it.channels, ch] : it.channels.filter((c) => c !== ch) }, true),
        }), channelLabel(ch))));
      const thumbs = h('div', { class: 'duimpjes', style: { flexWrap: 'wrap' } }, it.media.map((id) => mediaById.get(id)).filter(Boolean).map((m) => mediaThumb(m)));
      const input = it.clientInputId && inputsById.get(it.clientInputId);

      const row = h('tr', { class: isDup ? 'dubbel' : conflicts.length ? 'conflict' : '' },
        h('td', { class: 'nr' }, index + 1),
        h('td', { class: 'datumtijd' }, dateIn, timeIn, h('div', { class: 'zacht' }, fmtDate(it.date))),
        h('td', {}, topicIn,
          h('div', { class: 'rij', style: { marginTop: '6px', gap: '6px' } }, pillarIn, inputIn),
          it.rationale ? h('div', { class: 'reden' }, 'Waarom: ', it.rationale) : null,
          input && !structureEditable ? h('div', { class: 'reden' }, 'Klantinput: ', (input.title || input.body).slice(0, 120)) : null,
          isDup ? h('div', { class: 'waarschuwing fout' }, 'Een ander onderwerp staat al op deze datum en hetzelfde kanaal.') : null,
          conflicts.length ? h('div', { class: 'waarschuwing' }, `Er staat al content in de kalender op: ${conflicts.map((k) => channelLabel(k.split('|')[1])).join(', ')}.`) : null),
        h('td', { class: 'kanalen' }, chans),
        h('td', {}, thumbs, structureEditable ? h('button', {
          class: 'knop klein', style: { marginTop: '4px' },
          onclick: async () => {
            const ids = await pickMedia(clientId, { selected: it.media, title: `Beeld voor "${it.topic || 'onderwerp'}"` });
            if (!ids) return;
            const fresh = await api.get(`/clients/${clientId}/media`);
            fresh.forEach((m) => mediaById.set(m.id, m));
            update({ media: ids }, true);
          },
        }, it.media.length ? 'Beeld vervangen' : 'Beeld kiezen') : null),
        h('td', { class: 'volgorde' }, structureEditable ? [
          h('button', { class: 'knop klein kaal', disabled: index === 0, 'aria-label': 'Omhoog', onclick: () => { items.splice(index - 1, 0, items.splice(index, 1)[0]); markDirty(); drawRows(); } }, '↑'),
          h('button', { class: 'knop klein kaal', disabled: index === items.length - 1, 'aria-label': 'Omlaag', onclick: () => { items.splice(index + 1, 0, items.splice(index, 1)[0]); markDirty(); drawRows(); } }, '↓'),
          h('button', { class: 'knop klein kaal gevaar', 'aria-label': 'Onderwerp verwijderen', onclick: () => { items.splice(index, 1); markDirty(); drawRows(); } }, '✕'),
        ] : null));

      if (!showTexts) return [row];
      const textRow = h('tr', { class: row.className }, h('td'), h('td', { colSpan: 5 },
        h('div', { class: 'teksten' }, it.channels.map((ch) => h('div', {},
          h('label', {}, `${channelLabel(ch)}`),
          h('textarea', {
            value: it.texts[ch] ?? '', disabled: !textsEditable, placeholder: 'Nog geen tekst',
            oninput: (e) => { it.texts[ch] = e.target.value; markDirty(); },
          }))))));
      return [row, textRow];
    }));
  }
  drawRows();

  const table = h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'planregels' },
    h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Datum en tijd (voorstel)'), h('th', {}, 'Onderwerp, pijler en klantinput'),
      h('th', {}, 'Kanalen'), h('th', {}, 'Voorgesteld beeld'), h('th', {}, ''))),
    tbody));

  const editTools = structureEditable ? h('div', { class: 'knoppen', style: { margin: '10px 0 20px' } },
    h('button', {
      class: 'knop', onclick: () => {
        const last = items.at(-1);
        items.push({ date: last?.date ?? plan.periodStart, time: null, topic: '', channels: [...client.channels], pillar: null, clientInputId: null, media: [], rationale: '', texts: {} });
        markDirty();
        drawRows();
        tbody.querySelector('tr:last-child input[type=text]')?.focus();
      },
    }, '+ Onderwerp toevoegen'),
    h('button', { class: 'knop', onclick: () => { items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '')); markDirty(); drawRows(); } }, 'Sorteer op datum'),
    h('button', { class: 'knop primair', onclick: () => save().then(rerender).catch(showError) }, 'Wijzigingen opslaan')) : null;

  // ---------- Acties ----------

  async function action(fn) {
    try {
      await fn();
    } catch (err) {
      showError(err);
    }
  }

  async function adjust() {
    if (status === 'goedgekeurd' && !(await confirmDialog('Goedkeuring intrekken?',
      'Om datums, kanalen of onderwerpen te wijzigen wordt de planning heropend. Daarna moet je hem opnieuw goedkeuren.', { confirmLabel: 'Heropenen' }))) return;
    await api.post(`/plans/${planId}/adjust`);
    rerender();
  }

  async function aiAgain(mode) {
    const wishes = h('textarea', { rows: 3, value: plan.wishes });
    const ok = await modal({
      title: mode === 'redistribute' ? 'Nieuwe verdeling voorstellen' : 'Hele voorstel opnieuw genereren',
      body: [
        h('div', { class: 'melding let-op' }, mode === 'redistribute'
          ? 'De AI verdeelt de onderwerpen opnieuw over datums, tijden en kanalen. Daarna moet je de planning opnieuw beoordelen en goedkeuren.'
          : 'De AI maakt een volledig nieuw voorstel. Alle huidige onderwerpen en handmatige wijzigingen worden vervangen.'),
        field('Wensen (optioneel)', wishes),
      ],
      buttons: [{ label: 'Annuleren' }, { label: mode === 'redistribute' ? 'Nieuwe verdeling voorstellen' : 'Opnieuw genereren', class: 'primair', value: true }],
    });
    if (!ok) return;
    await busy('De AI maakt een nieuw voorstel…', () => api.post(`/plans/${planId}/${mode}`, { wishes: wishes.value }));
    toast('Nieuw voorstel klaar. Beoordeel het opnieuw.');
    rerender();
  }

  // Bij conflicten moet de manager per kanaalcel kiezen: overslaan of vervangen.
  async function resolveConflicts(conflicts) {
    const choices = conflicts.map((c) => {
      const name = `c-${c.key}`;
      return { key: c.key, el: h('li', {},
        h('strong', {}, `${fmtLongDate(c.date)} · ${channelLabel(c.channel)}`),
        h('div', { class: 'zacht' }, 'Nu in de kalender: ', c.existing.topic || '', c.existing.body ? ` — "${c.existing.body.slice(0, 140)}"` : ' (nog geen tekst)'),
        h('div', { class: 'zacht' }, 'Nieuw onderwerp: ', c.newTopic),
        h('div', { class: 'keuzes' },
          h('label', { class: 'vinkje' }, h('input', { type: 'radio', name, value: 'skip' }), 'Bestaande content behouden (overslaan)'),
          h('label', { class: 'vinkje' }, h('input', { type: 'radio', name, value: 'replace' }), 'Vervangen (huidige versie blijft in de geschiedenis)'))) };
    });
    const error = h('div', { class: 'melding fout', hidden: true }, 'Maak voor elke kanaalcel een keuze.');
    return modal({
      title: 'Er staat al content op deze datums', width: '720px',
      body: [h('p', {}, 'Bestaande content wordt nooit ongemerkt overschreven. Kies per kanaalcel wat er moet gebeuren.'), error,
        h('ul', { class: 'conflictlijst' }, choices.map((c) => c.el))],
      buttons: [{ label: 'Annuleren' }, {
        label: 'Keuzes bevestigen', class: 'primair',
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

  async function approveAndAdd() {
    if (duplicateKeys().size) return showError(new Error('Los eerst de rood gemarkeerde dubbelingen op (twee onderwerpen op dezelfde datum en hetzelfde kanaal).'));
    const cells = items.reduce((n, it) => n + it.channels.length, 0);
    const ok = await confirmDialog('Planning goedkeuren?', reviewFirst.checked
      ? `Je keurt ${items.length} onderwerpen (${cells} kanaalcellen) goed. De AI schrijft daarna conceptteksten per kanaal, die je eerst controleert voordat de kalender wordt gevuld.`
      : `Je keurt ${items.length} onderwerpen (${cells} kanaalcellen) goed. Ze worden direct aan de contentkalender toegevoegd en de AI schrijft de teksten per kanaal.`,
    { confirmLabel: 'Ja, goedkeuren' });
    if (!ok) return;
    await save();
    const res = await withConflictResolution((resolutions) => busy(reviewFirst.checked ? 'Goedkeuren en conceptteksten schrijven…' : 'Goedkeuren, toevoegen aan de kalender en teksten schrijven…',
      () => api.post(`/plans/${planId}/approve`, { reviewTextsFirst: reviewFirst.checked, resolutions })));
    if (!res) return rerender();
    if (res.warning) showError(new Error(res.warning));
    if (reviewFirst.checked) {
      toast('Planning goedgekeurd. Controleer nu de conceptteksten.');
      rerender();
    } else {
      toast(`${res.placed} kanaalcellen toegevoegd aan de kalender, ${res.textsFilled} teksten geschreven.`);
      location.hash = `#/klant/${clientId}/kalender?maand=${plan.periodStart.slice(0, 7)}`;
    }
  }

  async function addReviewed() {
    const missing = items.reduce((n, it) => n + it.channels.filter((ch) => !it.texts[ch]?.trim()).length, 0);
    const ok = await confirmDialog('Toevoegen aan de kalender?',
      `De gecontroleerde teksten en het gekozen beeld komen in de contentkalender.${missing ? ` Let op: ${missing} kanaalcel(len) hebben nog geen tekst.` : ''}`,
      { confirmLabel: 'Toevoegen aan kalender' });
    if (!ok) return;
    await save();
    const res = await withConflictResolution((resolutions) => api.post(`/plans/${planId}/add-to-calendar`, { resolutions }));
    if (!res) return rerender();
    toast(`${res.placed} kanaalcellen toegevoegd aan de kalender.`);
    location.hash = `#/klant/${clientId}/kalender?maand=${plan.periodStart.slice(0, 7)}`;
  }

  const actions = [];
  if (manager && ['concept', 'in_controle', 'aanpassen'].includes(status)) {
    actions.push(h('div', { class: 'knoppen sectie' },
      status === 'concept' ? h('button', { class: 'knop donker', onclick: () => action(async () => { await api.post(`/plans/${planId}/submit`); rerender(); }) }, 'Ter controle aanbieden') : null,
      status !== 'aanpassen' ? h('button', { class: 'knop', onclick: () => action(adjust) }, 'Conceptplanning aanpassen') : null,
      h('button', { class: 'knop', onclick: () => action(() => aiAgain('redistribute')) }, 'Nieuwe verdeling voorstellen'),
      h('button', { class: 'knop kaal', onclick: () => action(() => aiAgain('regenerate')) }, 'Hele voorstel opnieuw genereren'),
      h('button', {
        class: 'knop kaal gevaar', style: { marginLeft: 'auto' },
        onclick: () => action(async () => {
          if (!(await confirmDialog('Conceptplanning verwijderen?', 'De planning wordt verwijderd. De kalender verandert niet.', { confirmLabel: 'Verwijderen', danger: true }))) return;
          await api.del(`/plans/${planId}`);
          location.hash = `#/klant/${clientId}/planning`;
        }),
      }, 'Verwijderen')));
  }

  let approvalBox = null;
  if (can('approvePlans') && ['in_controle', 'aanpassen'].includes(status)) {
    approvalBox = h('div', { class: 'goedkeuring' },
      h('h3', {}, 'Goedkeuring door social media manager'),
      h('label', { class: 'vinkje', style: { marginBottom: '10px' } }, reviewFirst, 'Eerst conceptteksten controleren voordat de kalender wordt gevuld'),
      h('div', { class: 'knoppen' },
        h('button', { class: 'knop primair', onclick: () => action(approveAndAdd) }, 'Planning goedkeuren en toevoegen aan kalender'),
        h('span', { class: 'zacht' }, 'De kalender wordt eerst gecontroleerd op bestaande content op dezelfde datums en kanalen.')));
  } else if (can('approvePlans') && status === 'goedgekeurd') {
    approvalBox = h('div', { class: 'goedkeuring' },
      h('h3', {}, 'Conceptteksten controleren'),
      h('p', { class: 'zacht' }, 'Pas de teksten hierboven aan waar nodig. Wijzigingen door jou houden de goedkeuring in stand. Wil je datums of kanalen wijzigen, heropen dan de planning.'),
      h('div', { class: 'knoppen' },
        h('button', { class: 'knop primair', onclick: () => action(addReviewed) }, 'Teksten goedkeuren en toevoegen aan kalender'),
        h('button', {
          class: 'knop', onclick: () => action(async () => {
            const overwrite = await modal({
              title: 'Teksten opnieuw laten schrijven',
              body: h('p', {}, 'Wil je alleen ontbrekende teksten laten aanvullen, of ook de bestaande teksten laten vervangen?'),
              buttons: [{ label: 'Annuleren', value: null }, { label: 'Alleen ontbrekende aanvullen', value: 'nee' }, { label: 'Ook bestaande vervangen', value: 'ja', class: 'primair' }],
            });
            if (!overwrite) return;
            await save();
            await busy('De AI schrijft de teksten per kanaal…', () => api.post(`/plans/${planId}/write-texts`, { overwrite: overwrite === 'ja' }));
            rerender();
          }),
        }, 'Teksten (opnieuw) laten schrijven'),
        h('button', { class: 'knop', onclick: () => action(adjust) }, 'Conceptplanning aanpassen')));
  } else if (!manager && status !== 'toegevoegd_aan_kalender') {
    approvalBox = h('div', { class: 'melding info' }, 'Alleen een social media manager of beheerder kan deze planning aanpassen en goedkeuren.');
  }

  return [...header, ...intro, actions, saveBar, summaryHost, table, editTools, approvalBox];
}
