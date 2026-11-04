import {
  h, fill, icon, field, toast, showError, modal, confirmDialog, busy, copyText, downloadUrl, mediaThumb, mediaPreview, openMenu,
  page, initials, avatar, fmtLongDate, fmtMonth, fmtDateTime, isoDate, addDays, monthBounds, shiftMonth, isoWeek,
} from '../ui.js';
import { api, meta, can, channelLabel, statusLabel, statusStyle } from '../api.js';
import { clientHeader } from './clients.js';
import { pickMedia } from './media.js';
import { clientDaysBetween, describeRhythm, repeatDates, ruleFromDate } from '../../gedeeld/dagen.js';
import { needsAttention, ATTENTION_DAYS } from '../../gedeeld/rapport.js';

// Scrollpositie per maand bewaren, zodat de kalender na opslaan niet terugspringt.
const scrollMemory = new Map();

export async function calendarView({ clientId, tab, query, rerender }) {
  const month = /^\d{4}-\d{2}$/.test(query.get('maand') ?? '') ? query.get('maand') : isoDate(new Date()).slice(0, 7);
  const { from, to } = monthBounds(month);
  const [{ client, head }, cal] = await Promise.all([
    clientHeader(clientId, tab), api.get(`/clients/${clientId}/calendar?from=${from}&to=${to}`),
  ]);
  const statusFilter = query.get('status') ?? '';
  const today = isoDate(new Date());
  const memoryKey = `${clientId}|${month}`;
  const url = (ym, status = statusFilter) => `#/klant/${clientId}/kalender?maand=${ym}${status ? `&status=${status}` : ''}`;

  // Kanalen van de klant, plus kanalen waar (nog) content op staat.
  const channels = [...new Set([...client.channels, ...cal.items.map((i) => i.channel)])];
  const items = cal.items;
  const byCell = new Map(items.map((i) => [`${i.publish_date}|${i.channel}`, i]));
  const ordered = () => [...items].sort((a, b) => a.publish_date.localeCompare(b.publish_date) || channels.indexOf(a.channel) - channels.indexOf(b.channel));

  // Feest- en actiedagen naast de datums. Actiedagen kun je verbergen; die keuze wordt onthouden.
  let showActionDays = true;
  try { showActionDays = localStorage.getItem('jcs-actiedagen') !== 'uit'; } catch { /* geen opslag */ }
  // Feestdagen en eigen dagen van de klant altijd; actie- en vakdagen alleen als 'Actiedagen tonen' aan staat.
  const specialDays = clientDaysBetween(client, from, to).filter((d) => showActionDays || d.type === 'feestdag' || d.type === 'klantdag');
  const DAY_TITLE = { feestdag: 'Feestdag', actiedag: 'Actiedag', vakdag: 'Vakdag', klantdag: 'Eigen dag van de klant' };
  // Posts die binnenkort online moeten maar nog tekst of beeld missen.
  const attentionUntil = addDays(today, ATTENTION_DAYS);
  const daysOn = (date) => specialDays.filter((d) => d.date === date);

  // ---------- Balk boven de kalender ----------

  const filterBar = h('div', { class: `statusfilter ${statusFilter ? 'gefilterd' : ''}`, role: 'group', 'aria-label': 'Filter op status' },
    meta.calendarStatuses.map((s) => {
      const n = items.filter((i) => i.status === s.key).length;
      const on = statusFilter === s.key;
      return h('button', {
        type: 'button', class: `status ${on ? 'aan' : ''}`, style: statusStyle(s.key), 'aria-pressed': String(on),
        title: on ? 'Filter uitzetten' : `Alleen "${s.label}" tonen`,
        onclick: () => { location.hash = url(month, on ? '' : s.key); },
      }, s.label, h('span', { class: 'aantal' }, n));
    }));

  const toolbar = h('div', { class: 'kalenderbalk' },
    h('div', { class: 'maandkiezer' },
      h('button', { type: 'button', 'aria-label': 'Vorige maand', onclick: () => { location.hash = url(shiftMonth(month, -1)); } }, icon('links')),
      h('span', { class: 'maand' }, fmtMonth(from)),
      h('button', { type: 'button', 'aria-label': 'Volgende maand', onclick: () => { location.hash = url(shiftMonth(month, 1)); } }, icon('rechts'))),
    month !== today.slice(0, 7) ? h('button', { class: 'knop', onclick: () => { location.hash = url(today.slice(0, 7)); } }, 'Naar vandaag') : null,
    can('editContent') && (client.recurring ?? []).some((r) => r.active) ? h('button', {
      class: 'knop', type: 'button', title: 'Vaste posts van deze klant als placeholder in deze maand zetten', onclick: placeRecurring,
    }, icon('geschiedenis', { size: 16 }), 'Terugkerende posts') : null,
    h('div', { style: { flex: '1' } }),
    filterBar,
    h('label', { class: 'vinkje klein-vinkje', title: 'Thema- en actiedagen zoals Dierendag en Black Friday' },
      h('input', {
        type: 'checkbox', checked: showActionDays,
        onchange: (e) => { try { localStorage.setItem('jcs-actiedagen', e.target.checked ? 'aan' : 'uit'); } catch { /* geen opslag */ } rerender(); },
      }), 'Actiedagen tonen'));

  // Terugkerende posts (optie op het klantprofiel) als lege placeholders in deze maand zetten.
  async function placeRecurring() {
    let preview;
    try {
      preview = await api.get(`/clients/${clientId}/terugkerend?maand=${month}`);
    } catch (err) {
      return showError(err);
    }
    const line = (p) => h('li', {}, h('strong', {}, `${fmtLongDate(p.date)}, ${channelLabel(p.channel)}`), h('span', { class: 'zacht' }, ` ${p.title} (${p.rhythm.toLowerCase()})`));
    const ok = await modal({
      title: `Terugkerende posts in ${fmtMonth(from)}`, width: '600px',
      body: [
        preview.posts.length
          ? h('p', {}, `${preview.posts.length} post${preview.posts.length === 1 ? '' : 's'} worden als lege placeholder (status "Placeholder / actie nodig") in de kalender gezet:`)
          : h('p', {}, 'Er hoeven deze maand geen terugkerende posts meer bij: ze staan er al, of er staat al iets op die dagen.'),
        preview.posts.length ? h('ul', { class: 'conflictlijst' }, preview.posts.map(line)) : null,
        preview.skipped.length ? [h('p', { class: 'zacht', style: { marginTop: '12px' } }, `Overgeslagen, omdat daar al een post staat (die blijft staan):`),
          h('ul', { class: 'conflictlijst' }, preview.skipped.map(line))] : null,
      ],
      buttons: preview.posts.length ? [{ label: 'Annuleren' }, { label: 'In de kalender zetten', class: 'primair', value: true }] : [{ label: 'Sluiten', class: 'primair' }],
    });
    if (!ok) return;
    try {
      const res = await api.post(`/clients/${clientId}/terugkerend`, { maand: month });
      toast(`${res.created} terugkerende post${res.created === 1 ? '' : 's'} toegevoegd`);
      rerender();
    } catch (err) {
      showError(err);
    }
  }

  // ---------- Raster ----------

  const rows = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const date = new Date(`${d}T12:00:00`);
    const day = date.getDay();
    const weekStart = day === 1 || d === from;
    rows.push(h('tr', { class: [day === 0 || day === 6 ? 'weekend' : '', day === 1 ? 'weekstart' : '', d === today ? 'vandaag' : ''].join(' '), dataset: { datum: d } },
      h('td', { class: 'datumkol' },
        weekStart ? h('span', { class: 'weeknr' }, `week ${isoWeek(d)}`) : null,
        h('span', { class: 'dagnr' }, date.getDate()),
        h('span', { class: 'dagnaam' }, d === today ? 'vandaag' : date.toLocaleDateString('nl-NL', { weekday: 'short' })),
        daysOn(d).length ? h('ul', { class: 'dagen' }, daysOn(d).map((x) => h('li', { class: x.type, title: x.branche ? `Vakdag: ${x.branche}` : DAY_TITLE[x.type] }, x.name))) : null),
      channels.map((ch) => h('td', { class: 'kanaalcel', dataset: { kanaal: ch } }, cell(d, ch)))));
  }

  function cell(date, channel) {
    const item = byCell.get(`${date}|${channel}`);
    const label = `${fmtLongDate(date)}, ${channelLabel(channel)}`;
    if (!item) {
      if (!can('editContent')) return h('div', { class: 'cel leeg-cel' });
      // Een post hierheen slepen kan binnen hetzelfde kanaal; een gevulde cel is nooit een doel.
      return h('div', {
        class: 'cel leeg-cel',
        ondragover: (e) => { if (dragged?.channel === channel) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('sleepdoel'); } },
        ondragleave: (e) => e.currentTarget.classList.remove('sleepdoel'),
        ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('sleepdoel'); if (dragged?.channel === channel) moveItem(dragged, date); },
      },
        h('button', { type: 'button', class: 'open', 'aria-label': `Post toevoegen: ${label}`, onclick: () => openEditor({ publish_date: date, channel }) }, icon('plus', { size: 16 })));
    }
    const dimmed = statusFilter && item.status !== statusFilter;
    const shown = item.media.slice(0, 3);
    const missing = needsAttention(item, today, attentionUntil);
    return h('div', {
      class: `cel gevuld ${dimmed ? 'gedimd' : ''} ${missing ? 'aandacht' : ''}`, style: statusStyle(item.status),
      draggable: can('editContent'),
      ondragstart: (e) => {
        dragged = item;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.id);
        table.querySelectorAll(`td[data-kanaal="${item.channel}"] .leeg-cel`).forEach((c) => c.classList.add('kan-hier'));
      },
      ondragend: () => { dragged = null; table.querySelectorAll('.kan-hier, .sleepdoel').forEach((c) => c.classList.remove('kan-hier', 'sleepdoel')); },
    },
      h('button', {
        type: 'button', class: 'open', 'aria-label': `${label}, ${statusLabel(item.status)}. Openen`,
        title: statusLabel(item.status), onclick: () => openEditor(item),
      },
      h('div', { class: 'celkop' },
        item.is_new ? h('span', { class: 'nieuw-bol', title: 'Nieuw toegevoegd door een ander account' }) : null,
        h('span', { class: 'tijd' }, item.suggested_time ?? ''),
        item.content_pillar ? h('span', { class: 'pijler', title: 'Contentpijler' }, item.content_pillar) : null,
        h('span', { class: 'rechts' },
          missing ? h('span', { class: 'let-op-teken', title: `Gaat ${item.publish_date === today ? 'vandaag' : 'binnenkort'} online, maar ${missing.join(' en ')} ontbreekt` }, '!') : null,
          item.comment_count ? h('span', { class: 'reacties', title: `${item.comment_count} reactie${item.comment_count === 1 ? '' : 's'}` }, icon('reactie', { size: 14 }), item.comment_count) : null,
          item.internal_notes ? h('span', { title: `Opmerking: ${item.internal_notes}` }, icon('notitie', { size: 14 })) : null,
          item.assignee_name ? h('span', { class: 'wie', title: item.assignee_name }, initials(item.assignee_name)) : null)),
      item.body ? h('div', { class: 'celtekst' }, item.body) : h('div', { class: 'celtekst ontbreekt' }, item.topic || 'Tekst ontbreekt'),
      item.media.length ? h('div', { class: 'duimpjes' }, shown.map((m) => mediaThumb(m)),
        item.media.length > 3 ? h('span', { class: 'duim-meer' }, `+${item.media.length - 3}`) : null) : null),
      h('div', { class: 'snel' },
        item.body ? h('button', { type: 'button', title: 'Tekst kopiëren', 'aria-label': 'Tekst kopiëren', onclick: () => copyText(item.body) }, icon('kopie', { size: 16 })) : null,
        can('updateStatus') ? h('button', {
          type: 'button', title: 'Status wijzigen', 'aria-label': 'Status wijzigen',
          onclick: (e) => openMenu(e.currentTarget, meta.calendarStatuses.map((s) => ({
            label: s.label, kleur: statusStyle(s.key), checked: s.key === item.status,
            action: () => quickStatus(item, s.key),
          }))),
        }, h('span', { class: 'kleurbol' })) : null));
  }

  // Slepen: een post naar een andere datum in hetzelfde kanaal. Bestaande content wordt nooit overschreven.
  let dragged = null;
  async function moveItem(item, date) {
    if (date === item.publish_date) return;
    try {
      await api.patch(`/calendar/${item.id}`, { publish_date: date, reason: `Verplaatst van ${fmtLongDate(item.publish_date)}` });
      toast(`Verplaatst naar ${fmtLongDate(date)}. De vorige datum staat in de geschiedenis.`);
      rerender();
    } catch (err) {
      showError(err);
    }
  }

  // Status wijzigen zonder het paneel te openen; alleen deze cel wordt opnieuw getekend.
  async function quickStatus(item, status) {
    if (status === item.status) return;
    try {
      const updated = await api.patch(`/calendar/${item.id}`, { status, reason: 'Status gewijzigd' });
      Object.assign(item, updated);
      redrawCell(item);
      redrawFilter();
      toast(`Status: ${statusLabel(status)}`);
    } catch (err) {
      showError(err);
    }
  }
  function redrawCell(item) {
    const td = table.querySelector(`tr[data-datum="${item.publish_date}"] td.kanaalcel:nth-child(${channels.indexOf(item.channel) + 2})`);
    if (td) fill(td, cell(item.publish_date, item.channel));
  }
  function redrawFilter() {
    filterBar.querySelectorAll('button.status').forEach((b, i) => {
      b.querySelector('.aantal').textContent = items.filter((it) => it.status === meta.calendarStatuses[i].key).length;
    });
  }

  const table = h('table', { class: 'raster' },
    h('thead', {}, h('tr', {}, h('th', { class: 'datumkol' }, h('span', { class: 'visueel-verborgen' }, 'Datum')),
      channels.map((ch) => h('th', {}, channelLabel(ch), h('span', { class: 'aantal' }, items.filter((i) => i.channel === ch).length))))),
    h('tbody', {}, rows));
  const wrap = h('div', { class: 'raster-wrap' }, table);

  // Na het tonen: terug naar de vorige scrollpositie, of anders naar vandaag.
  setTimeout(() => {
    if (!wrap.isConnected) return;
    // Nieuwe posts in deze maand zijn nu in beeld geweest; het bolletje blijft tot de volgende keer laden zichtbaar.
    const newIds = items.filter((i) => i.is_new).map((i) => i.id);
    if (newIds.length) window.dispatchEvent(new CustomEvent('jcs:posts-bekeken', { detail: newIds }));
    if (scrollMemory.has(memoryKey)) wrap.scrollTop = scrollMemory.get(memoryKey);
    else {
      const row = table.querySelector('tr.vandaag');
      if (row) wrap.scrollTop = Math.max(0, row.offsetTop - 120);
    }
    wrap.addEventListener('scroll', () => scrollMemory.set(memoryKey, wrap.scrollTop), { passive: true });
  });

  // ---------- Zijpaneel: kanaalcel bekijken en bewerken ----------

  async function openEditor(start) {
    const isNew = !start.id;
    let item;
    try {
      item = isNew ? { body: '', topic: '', source_info: '', internal_notes: '', status: 'placeholder_actie_nodig', media: [], suggested_time: null, assignee_id: null, versions: [], ...start }
        : await api.get(`/calendar/${start.id}`);
    } catch (err) {
      return showError(err);
    }
    const contentEditable = can('editContent');
    const statusEditable = can('updateStatus');
    let mediaList = [...item.media];
    let dirty = false;
    let statusTouched = false;
    const markDirty = () => { dirty = true; };

    const date = h('input', { type: 'date', value: item.publish_date, disabled: !contentEditable, oninput: markDirty });
    const time = h('input', { type: 'time', value: item.suggested_time ?? '', disabled: !contentEditable, oninput: markDirty });
    const channel = h('select', { value: item.channel, disabled: !contentEditable, onchange: markDirty },
      meta.channels.map((c) => h('option', { value: c.key }, c.label)));
    const status = h('select', {
      class: 'statusselect', value: item.status, disabled: !statusEditable,
      onchange: () => { paintStatus(); statusTouched = true; markDirty(); },
    }, meta.calendarStatuses.map((s) => h('option', { value: s.key }, s.label)));
    function paintStatus() {
      for (const [prop, v] of Object.entries(statusStyle(status.value))) status.style.setProperty(prop, v);
    }
    paintStatus();
    const pillarOptions = [...new Set([...client.content_pillars, item.content_pillar].filter(Boolean))];
    const pillar = h('select', { value: item.content_pillar ?? '', disabled: !contentEditable, onchange: markDirty },
      h('option', { value: '' }, 'Geen pijler'), pillarOptions.map((p) => h('option', { value: p }, p)));
    // Verantwoordelijke is een vrije naam (accounts zijn per rol); eerder gebruikte namen worden voorgesteld.
    const assignee = h('input', { type: 'text', list: 'verantwoordelijken', value: item.assignee_name ?? '', disabled: !contentEditable, oninput: markDirty, placeholder: 'Naam' });
    const assigneeList = h('datalist', { id: 'verantwoordelijken' }, (cal.assignees ?? []).map((n) => h('option', { value: n })));
    const topic = h('input', { type: 'text', value: item.topic, disabled: !contentEditable, oninput: markDirty, placeholder: 'Waar gaat deze post over?' });
    const counter = h('span', { class: 'zacht' });
    const body = h('textarea', { id: 'celtekst', class: 'groot-tekstvak', value: item.body, disabled: !contentEditable, placeholder: 'Tekst voor deze post', oninput: () => { markDirty(); count(); } });
    const count = () => { counter.textContent = `${body.value.length} tekens`; };
    count();
    const source = h('textarea', { rows: 3, value: item.source_info, disabled: !contentEditable, oninput: markDirty });

    // Nieuwe post: kanalen aanvinken, één tekst voor alle kanalen of per kanaal een eigen tekst.
    const startChannels = start.channels ?? (start.channel ? [start.channel] : client.channels);
    // Standaard alleen de kanalen van deze klant; andere kanalen kun je er bewust bij zetten.
    const allChannels = meta.channels.map((c) => c.key);
    const ownChannels = client.channels.length ? allChannels.filter((ch) => client.channels.includes(ch) || startChannels.includes(ch)) : allChannels;
    const channelBoxes = allChannels.map((ch) => h('label', { hidden: !ownChannels.includes(ch) },
      h('input', { type: 'checkbox', value: ch, checked: startChannels.includes(ch), onchange: () => { markDirty(); drawPerChannel(); } }), channelLabel(ch)));
    const otherChannelsButton = ownChannels.length < allChannels.length ? h('button', {
      type: 'button', class: 'knop klein kaal', title: 'Kanalen die niet bij deze klant zijn ingesteld',
      onclick: (e) => { channelBoxes.forEach((l) => { l.hidden = false; }); e.currentTarget.remove(); },
    }, icon('plus', { size: 14 }), 'Ander kanaal') : null;
    const chosenChannels = () => channelBoxes.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
    const perChannelToggle = h('input', { type: 'checkbox', onchange: () => drawPerChannel(true) });
    const perChannelTexts = {};
    const perChannelHost = h('div', { class: 'teksten-per-kanaal' });
    function drawPerChannel(copyShared = false) {
      if (!perChannelToggle.checked) { fill(perChannelHost); body.parentElement.hidden = false; return; }
      body.parentElement.hidden = true;
      fill(perChannelHost, chosenChannels().map((ch) => {
        perChannelTexts[ch] ??= h('textarea', { rows: 6, 'aria-label': `Tekst voor ${channelLabel(ch)}`, oninput: markDirty });
        if (copyShared && !perChannelTexts[ch].value) perChannelTexts[ch].value = body.value;
        return h('div', { class: 'veld' }, h('label', {}, `Tekst voor ${channelLabel(ch)}`), perChannelTexts[ch]);
      }));
    }
    const notes = h('textarea', { rows: 3, value: item.internal_notes, disabled: !statusEditable, oninput: markDirty, placeholder: 'Bijv. instructies voor branding, of waar de post is ingepland' });

    // Nieuwe post herhalen: het ritme volgt uit de gekozen datum. Bezette dagen worden overgeslagen.
    const repeat = h('select', { 'aria-label': 'Herhalen', onchange: () => { markDirty(); drawRepeat(); } });
    const repeatUntil = h('input', { type: 'date', 'aria-label': 'Herhalen tot en met', onchange: () => { markDirty(); drawRepeat(); } });
    const saveRule = h('input', { type: 'checkbox', checked: true });
    const repeatInfo = h('div', { class: 'hulp' });
    const repeatExtra = h('div', { class: 'herhaal-extra', hidden: true },
      h('div', { class: 'rij' }, field('Tot en met', repeatUntil), h('div', { class: 'veld' }, h('label', {}, ' '), repeatInfo)),
      h('label', { class: 'vinkje klein-vinkje' }, saveRule, 'Ook bewaren bij Terugkerende posts van deze klant, om later verder te plaatsen'));
    function drawRepeat() {
      const first = date.value;
      const chosen = repeat.value;
      fill(repeat, [['', 'Niet herhalen'], ['week', null], ['twee-weken', null], ['maand-weekdag', null], ['maand-dag', null]].map(([v, label]) =>
        h('option', { value: v }, label ?? (first ? describeRhythm(ruleFromDate(v, first)) : v))));
      repeat.value = chosen;
      repeatExtra.hidden = !repeat.value;
      if (!repeat.value) return;
      if (!repeatUntil.value || repeatUntil.value <= first) repeatUntil.value = addDays(first, 90);
      repeatUntil.min = addDays(first, 1);
      repeatUntil.max = addDays(first, 366);
      const n = repeatDates(repeat.value, first, repeatUntil.value).length + 1;
      repeatInfo.textContent = `Komt op ${n} datum${n === 1 ? '' : 's'} in de kalender, met dezelfde tekst en hetzelfde beeld. Staat er op een dag al iets, dan wordt die dag overgeslagen.`;
    }
    date.addEventListener('change', drawRepeat);
    if (isNew) drawRepeat();

    const mediaHost = h('div');
    function drawMedia() {
      fill(mediaHost, mediaList.length ? h('div', { class: 'beeldlijst' }, mediaList.map((m, i) => h('div', { class: 'beeld' },
        h('div', { class: 'voorbeeld' }, mediaPreview(m), m.kind === 'video' ? h('span', { class: 'soort' }, icon('video', { size: 12 }), 'Video') : null),
        h('div', { class: 'info' }, h('div', { class: 'naam', title: m.filename }, m.filename)),
        h('div', { class: 'acties' },
          h('a', { class: 'knop klein kaal', href: m.download_url, download: m.filename, title: 'Downloaden' }, icon('download', { size: 15 }), 'Download'),
          contentEditable && mediaList.length > 1 ? [
            h('button', { class: 'knop klein kaal icoonknop', disabled: i === 0, 'aria-label': 'Naar voren', title: 'Naar voren', onclick: () => move(i, -1) }, icon('links', { size: 15 })),
            h('button', { class: 'knop klein kaal icoonknop', disabled: i === mediaList.length - 1, 'aria-label': 'Naar achteren', title: 'Naar achteren', onclick: () => move(i, 1) }, icon('rechts', { size: 15 })),
          ] : null,
          contentEditable ? h('button', { class: 'knop klein kaal icoonknop', 'aria-label': 'Ontkoppelen', title: 'Ontkoppelen (blijft in de bibliotheek)', onclick: () => { mediaList.splice(i, 1); markDirty(); drawMedia(); } }, icon('sluit', { size: 15 })) : null))))
        : h('p', { class: 'zacht' }, contentEditable ? 'Nog geen beeld. Kies een foto of video uit de bibliotheek.' : 'Nog geen beeld gekoppeld.'));
    }
    function move(i, delta) {
      const [m] = mediaList.splice(i, 1);
      mediaList.splice(i + delta, 0, m);
      markDirty();
      drawMedia();
    }
    drawMedia();

    async function chooseMedia() {
      const ids = await pickMedia(clientId, { selected: mediaList.map((m) => m.id), title: 'Beeld koppelen' });
      if (!ids) return;
      const all = await api.get(`/clients/${clientId}/media`);
      mediaList = ids.map((id) => all.find((m) => m.id === id)).filter(Boolean);
      markDirty();
      drawMedia();
    }

    async function save({ thenOpen } = {}) {
      const payload = { status: status.value, internal_notes: notes.value };
      if (contentEditable) {
        Object.assign(payload, {
          publish_date: date.value, suggested_time: time.value || null, channel: channel.value, topic: topic.value, content_pillar: pillar.value,
          body: body.value, source_info: source.value, assignee: assignee.value.trim(), media: mediaList.map((m) => m.id),
        });
      }
      try {
        if (isNew) {
          const chosen = chosenChannels();
          if (!chosen.length) return showError(new Error('Vink minimaal één kanaal aan.'));
          // Zonder eigen keuze bepaalt de server de status op basis van tekst en beeld.
          if (!statusTouched) delete payload.status;
          const posts = chosen.map((ch) => ({ channel: ch, body: perChannelToggle.checked ? perChannelTexts[ch]?.value ?? '' : body.value }));
          const repeatPayload = repeat.value ? { rhythm: repeat.value, until: repeatUntil.value, saveRule: saveRule.checked } : undefined;
          const res = await api.post(`/clients/${clientId}/calendar/batch`, { ...payload, date: payload.publish_date, time: payload.suggested_time, posts, repeat: repeatPayload });
          if (repeatPayload) {
            toast(`Herhalende post: ${res.created} posts op ${res.dates} datums toegevoegd${res.skipped ? `, ${res.skipped} overgeslagen omdat daar al iets stond` : ''}${repeatPayload.saveRule ? '. Ook bewaard bij Terugkerende posts.' : ''}`);
          } else {
            toast(chosen.length === 1 ? 'Post toegevoegd' : `Post toegevoegd op ${chosen.length} kanalen`);
          }
        } else {
          await api.patch(`/calendar/${item.id}`, payload);
          toast('Wijzigingen opgeslagen');
        }
        dirty = false;
        close();
        await rerender();
        if (thenOpen) document.dispatchEvent(new CustomEvent('jcs:open-cel', { detail: thenOpen }));
        return true;
      } catch (err) {
        showError(err);
        return false;
      }
    }

    async function aiText() {
      if (dirty && !(await confirmDialog('Wijzigingen niet opgeslagen', 'Als de AI nu een nieuwe tekst schrijft, gaan je wijzigingen verloren.', { confirmLabel: 'Toch doorgaan' }))) return;
      try {
        await busy('De AI schrijft een nieuwe tekst', () => api.post(`/calendar/${item.id}/write-text`));
        toast('Nieuwe tekst geschreven. De vorige staat in de geschiedenis.');
        dirty = false;
        close();
        await rerender();
        document.dispatchEvent(new CustomEvent('jcs:open-cel', { detail: item.id }));
      } catch (err) {
        showError(err);
      }
    }

    async function remove() {
      if (!(await confirmDialog('Post verwijderen?', 'De cel wordt leeggemaakt. Het beeld blijft in de bibliotheek.', { confirmLabel: 'Verwijderen', danger: true }))) return;
      await api.del(`/calendar/${item.id}`);
      toast('Post verwijderd');
      close();
      rerender();
    }

    // Vorige/volgende post in de maand, om snel door de planning te werken.
    const list = ordered();
    const index = isNew ? -1 : list.findIndex((i) => i.id === item.id);
    async function go(delta) {
      const next = list[index + delta];
      if (!next) return;
      if (dirty) {
        const choice = await modal({
          title: 'Wijzigingen opslaan?',
          body: h('p', {}, 'Je hebt deze post aangepast. Wil je de wijzigingen opslaan voordat je verdergaat?'),
          buttons: [{ label: 'Annuleren', value: null }, { label: 'Niet opslaan', value: 'nee' }, { label: 'Opslaan', value: 'ja', class: 'primair' }],
        });
        if (!choice) return;
        if (choice === 'ja') return save({ thenOpen: next.id });
      }
      close();
      openEditor(next);
    }

    // Reacties: kort overleg bij deze post, met @naam om een collega te laten weten dat er iets voor hem of haar is.
    const commentsHost = isNew ? null : h('div', { class: 'reacties-blok' });
    let comments = item.comments ?? [];
    let people = [];
    if (!isNew) {
      api.get('/users').then((users) => { people = users.filter((u) => !u.disabled && u.id !== meta.user.id); drawComments(); }).catch(() => {});
      // De post is nu bekeken: bolletje van een nieuwe reactie mag weg.
      if (start.is_new) window.dispatchEvent(new CustomEvent('jcs:posts-bekeken', { detail: [item.id] }));
    }
    const commentInput = h('textarea', { rows: 2, placeholder: 'Schrijf een reactie. Typ @ en een naam om iemand te noemen.', 'aria-label': 'Reactie' });
    function withMentions(text) {
      const names = [...people.map((p) => p.name), meta.user.name].filter(Boolean).sort((a, b) => b.length - a.length);
      if (!names.length) return text;
      const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'gi');
      return text.split(re).map((part, i) => (i % 2 ? h('span', { class: 'vermelding' }, part) : part));
    }
    function drawComments() {
      if (!commentsHost) return;
      fill(commentsHost,
        comments.length ? h('ul', { class: 'reactielijst' }, comments.map((c) => h('li', {},
          avatar(c.user_name, c.avatar_url, 'accountfoto klein'),
          h('div', { class: 'tekst' },
            h('div', { class: 'kop' }, h('strong', {}, c.user_name), h('span', { class: 'zacht' }, fmtDateTime(c.created_at)),
              c.mine || can('manageUsers') ? h('button', { type: 'button', class: 'knop kaal klein', onclick: () => removeComment(c) }, 'Verwijderen') : null),
            h('div', { class: 'inhoud' }, withMentions(c.body)))))) : h('p', { class: 'zacht' }, 'Nog geen reacties.'),
        h('div', { class: 'reactie-nieuw' },
          commentInput,
          people.length ? h('div', { class: 'noem' }, h('span', { class: 'zacht' }, 'Noem:'), people.map((p) => h('button', {
            type: 'button', class: 'chip noemknop', onclick: () => {
              const sep = commentInput.value && !/\s$/.test(commentInput.value) ? ' ' : '';
              commentInput.value += `${sep}@${p.name} `;
              commentInput.focus();
            },
          }, `@${p.name}`))) : null,
          h('button', { type: 'button', class: 'knop klein primair', onclick: postComment }, 'Plaatsen')));
    }
    async function postComment() {
      if (!commentInput.value.trim()) return commentInput.focus();
      try {
        comments = await api.post(`/calendar/${item.id}/comments`, { body: commentInput.value });
        commentInput.value = '';
        item.comment_count = comments.length;
        const listed = items.find((i) => i.id === item.id);
        if (listed) { listed.comment_count = comments.length; listed.is_new = false; redrawCell(listed); }
        drawComments();
      } catch (err) {
        showError(err);
      }
    }
    async function removeComment(c) {
      if (!(await confirmDialog('Reactie verwijderen?', 'Deze reactie wordt verwijderd.', { confirmLabel: 'Verwijderen', danger: true }))) return;
      try {
        comments = await api.del(`/comments/${c.id}`);
        const listed = items.find((i) => i.id === item.id);
        if (listed) { listed.comment_count = comments.length; redrawCell(listed); }
        drawComments();
      } catch (err) {
        showError(err);
      }
    }
    drawComments();

    const versions = isNew ? null : h('details', { class: 'uitklap' },
      h('summary', {}, icon('geschiedenis', { size: 16 }), `Geschiedenis (${item.versions.length})`),
      item.versions.length ? h('ul', { class: 'versies' }, item.versions.map((v) => h('li', {},
        h('div', {}, h('div', {}, v.reason || 'Bewerkt'), h('div', { class: 'zacht' }, `${fmtDateTime(v.changed_at)}, ${v.changed_by_ai ? 'door AI' : (v.changed_by_name ?? 'onbekend')}`)),
        h('div', { class: 'knoppen' },
          h('button', { class: 'knop klein', onclick: () => showVersion(v) }, 'Bekijken'),
          contentEditable ? h('button', { class: 'knop klein', onclick: () => restore(v) }, 'Terugzetten') : null)))) : h('p', { class: 'zacht' }, 'Nog geen eerdere versies.'));

    async function showVersion(v) {
      const { snapshot: s } = await api.get(`/calendar/${item.id}/versions/${v.id}`);
      modal({
        title: `Versie van ${fmtDateTime(v.changed_at)}`, width: '560px',
        body: [h('p', {}, h('span', { class: 'status', style: statusStyle(s.status) }, statusLabel(s.status))),
          h('p', { class: 'zacht' }, `${fmtLongDate(s.publish_date)}, ${channelLabel(s.channel)}`),
          h('p', { style: { whiteSpace: 'pre-wrap' } }, s.body || 'Geen tekst'),
          s.internal_notes ? h('p', { class: 'zacht' }, `Opmerking: ${s.internal_notes}`) : null],
        buttons: [{ label: 'Sluiten' }],
      });
    }
    async function restore(v) {
      if (!(await confirmDialog('Deze versie terugzetten?', 'De huidige versie blijft bewaard in de geschiedenis.', { confirmLabel: 'Terugzetten' }))) return;
      try {
        await api.post(`/calendar/${item.id}/versions/${v.id}/restore`);
        toast('Versie teruggezet');
        close();
        await rerender();
        document.dispatchEvent(new CustomEvent('jcs:open-cel', { detail: item.id }));
      } catch (err) {
        showError(err);
      }
    }

    const backdrop = h('div', { class: 'scherm', onclick: () => tryClose() });
    const panel = h('aside', { class: 'paneel', role: 'dialog', 'aria-modal': 'true', 'aria-label': isNew ? 'Post toevoegen' : 'Post bekijken' },
      h('div', { class: 'paneel-kop' },
        h('div', { class: 'titel' },
          h('h2', {}, isNew ? 'Post toevoegen' : fmtLongDate(item.publish_date)),
          h('div', { class: 'zacht' }, isNew ? 'Wordt direct in de kalender opgeslagen' : `${channelLabel(item.channel)}${item.suggested_time ? `, ${item.suggested_time}` : ''}${index >= 0 ? `. Post ${index + 1} van ${list.length}` : ''}`)),
        !isNew ? [
          h('button', { class: 'knop kaal icoonknop', disabled: index <= 0, title: 'Vorige post', 'aria-label': 'Vorige post', onclick: () => go(-1) }, icon('omhoog')),
          h('button', { class: 'knop kaal icoonknop', disabled: index >= list.length - 1, title: 'Volgende post', 'aria-label': 'Volgende post', onclick: () => go(1) }, icon('omlaag')),
        ] : null,
        h('button', { class: 'knop kaal icoonknop', 'aria-label': 'Sluiten', title: 'Sluiten (Esc)', onclick: () => tryClose() }, icon('sluit'))),
      h('div', { class: 'paneel-inhoud' },
        h('div', { class: 'rij' }, field('Status', status), field('Contentpijler (optioneel)', pillar, pillarOptions.length ? null : 'Pijlers stel je in op het klantprofiel.'), field('Verantwoordelijke', assignee), assigneeList),
        isNew ? h('div', { class: 'veld' }, h('label', {}, 'Kanalen'), h('div', { class: 'kanaalkeuze' }, channelBoxes, otherChannelsButton),
          h('label', { class: 'vinkje klein-vinkje', style: { marginTop: '10px' } }, perChannelToggle, 'Andere tekst per kanaal')) : null,
        isNew ? h('div', { class: 'veld' }, h('label', {}, icon('geschiedenis', { size: 15 }), ' Herhalen'), repeat, repeatExtra) : null,
        perChannelHost,
        h('div', { class: 'veld' },
          h('div', { class: 'tekstkop' },
            h('label', { for: 'celtekst' }, isNew ? 'Tekst (voor alle gekozen kanalen)' : `Tekst voor ${channelLabel(item.channel)}`), counter,
            h('button', { class: 'knop klein', type: 'button', onclick: () => copyText(body.value) }, icon('kopie', { size: 15 }), 'Kopiëren'),
            contentEditable && !isNew ? h('button', { class: 'knop klein', type: 'button', onclick: aiText, title: 'Laat de AI deze tekst (opnieuw) schrijven' }, icon('sparkle', { size: 15 }), item.body ? 'Herschrijven' : 'Laten schrijven') : null),
          body),
        h('div', { class: 'veld' },
          h('div', { class: 'tekstkop' },
            h('label', {}, 'Origineel beeld'),
            mediaList.length > 1 ? h('button', { class: 'knop klein', type: 'button', onclick: async () => { for (const m of mediaList) { await downloadUrl(m.download_url, m.filename); await new Promise((r) => setTimeout(r, 400)); } } }, icon('download', { size: 15 }), 'Alles downloaden') : null,
            contentEditable ? h('button', { class: 'knop klein', type: 'button', onclick: chooseMedia }, icon('beeld', { size: 15 }), mediaList.length ? 'Beeld wijzigen' : 'Beeld kiezen') : null),
          mediaHost),
        field('Interne opmerkingen', notes),
        isNew ? null : h('div', { class: 'veld' }, h('label', {}, icon('reactie', { size: 15 }), ' Reacties'), commentsHost),
        h('details', { class: 'uitklap', open: isNew },
          h('summary', {}, icon('bewerk', { size: 16 }), isNew ? 'Datum, onderwerp en bron' : 'Datum, kanaal, onderwerp en bron'),
          h('div', { class: 'rij' }, field('Datum', date), field('Tijd (voorstel)', time), isNew ? null : field('Kanaal', channel)),
          field('Onderwerp', topic),
          field('Klantinput en bron', source)),
        versions),
      h('div', { class: 'paneel-voet' },
        statusEditable ? h('button', { class: 'knop primair', onclick: () => save(), title: 'Opslaan (Ctrl+S)' }, isNew ? 'Post toevoegen' : 'Opslaan') : null,
        h('button', { class: 'knop', onclick: () => tryClose() }, 'Sluiten'),
        contentEditable && !isNew ? h('div', { class: 'rechts' }, h('button', { class: 'knop kaal gevaar', onclick: remove }, icon('prullenbak', { size: 16 }), 'Verwijderen')) : null));

    const onKey = (e) => {
      if (document.querySelector('.modaal, .menu')) return;
      if (e.key === 'Escape') tryClose();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (statusEditable) save(); }
    };
    async function tryClose() {
      if (dirty && !(await confirmDialog('Wijzigingen niet opgeslagen', 'Wil je sluiten zonder op te slaan?', { confirmLabel: 'Sluiten zonder opslaan', danger: true }))) return;
      close();
    }
    function close() {
      backdrop.remove();
      panel.remove();
      document.removeEventListener('keydown', onKey);
    }
    document.querySelector('.paneel')?.remove();
    document.querySelector('.scherm')?.remove();
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop, panel);
    (contentEditable ? body : status).focus({ preventScroll: true });
  }

  // Na opslaan of terugzetten opent het paneel van dezelfde (of de volgende) post opnieuw.
  const reopen = (e) => {
    document.removeEventListener('jcs:open-cel', reopen);
    const target = items.find((i) => i.id === e.detail);
    if (target && wrap.isConnected) openEditor(target);
  };
  document.addEventListener('jcs:open-cel', reopen);
  // Vanaf het overzicht (vermelding of waarschuwing) direct de juiste post openen.
  const openId = query.get('post');
  if (openId) {
    // Eenmalig: haal de post uit het adres, anders gaat hij bij elke verversing opnieuw open.
    history.replaceState(null, '', url(month));
    setTimeout(() => {
      const target = items.find((i) => i.id === openId);
      if (target && wrap.isConnected) openEditor(target);
    });
  }
  setTimeout(() => document.removeEventListener('jcs:open-cel', reopen), 3000);

  // ---------- Excel ----------

  async function importExcel() {
    const input = h('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      let preview;
      try {
        preview = await api.post(`/clients/${clientId}/import`, fd);
      } catch (err) {
        return showError(err);
      }
      const existing = preview.rows.filter((r) => r.exists);
      const fresh = preview.rows.length - existing.length;
      const boxes = existing.map((r) => h('input', { type: 'checkbox', value: r.key }));
      const result = await modal({
        title: 'Excel-import controleren', width: '640px',
        body: [
          h('p', { class: 'zacht' }, 'Zo zet je een bestaande Excel-planning over, of voeg je eerdere posts toe. De AI gebruikt eerdere posts als voorbeeld voor stijl en toon van nieuwe teksten.'),
          h('p', {}, `${fresh} nieuwe post${fresh === 1 ? '' : 's'} worden toegevoegd.`),
          preview.errors.length ? h('div', { class: 'melding let-op' }, h('div', {}, h('strong', {}, 'Deze regels worden overgeslagen'), h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px' } }, preview.errors.map((e) => h('li', {}, e))))) : null,
          existing.length ? [
            h('p', {}, `${existing.length} regel${existing.length === 1 ? ' valt' : 's vallen'} op een datum en kanaal waar al een post staat. Die blijven staan, tenzij je hieronder aanvinkt dat ze vervangen moeten worden.`),
            h('ul', { class: 'conflictlijst' }, existing.map((r, i) => h('li', {}, h('label', { class: 'vinkje' }, boxes[i], `Vervang ${fmtLongDate(r.date)}, ${channelLabel(r.channel)}`),
              h('div', { class: 'zacht', style: { marginTop: '4px' } }, (r.body || 'Geen tekst').slice(0, 160))))),
          ] : null,
        ],
        buttons: [{ label: 'Annuleren' }, { label: 'Importeren', class: 'primair', value: true }],
      });
      if (!result) return;
      const fd2 = new FormData();
      fd2.append('file', file);
      fd2.append('confirm', 'true');
      fd2.append('overwrite', JSON.stringify(boxes.filter((b) => b.checked).map((b) => b.value)));
      try {
        const res = await api.post(`/clients/${clientId}/import`, fd2);
        toast(`Import klaar: ${res.created} toegevoegd, ${res.replaced} vervangen, ${res.skipped} overgeslagen`);
        rerender();
      } catch (err) {
        showError(err);
      }
    });
    input.click();
  }

  const excelButton = h('button', {
    class: 'knop', type: 'button',
    onclick: (e) => openMenu(e.currentTarget, [
      { label: `${fmtMonth(from)} exporteren`, icon: 'download', action: () => downloadUrl(`/api/clients/${clientId}/export.xlsx?from=${from}&to=${to}`) },
      ...(can('editContent') ? [{ label: 'Bestaande planning of eerdere posts importeren', icon: 'upload', action: importExcel }] : []),
    ]),
  }, icon('excel', { size: 16 }), 'Excel');

  const addButton = can('editContent')
    ? h('button', { class: 'knop primair', onclick: () => openEditor({ publish_date: today >= from && today <= to ? today : from, channel: channels[0], channels: client.channels }) }, icon('plus', { size: 16 }), 'Post toevoegen')
    : null;

  return page(head([excelButton, addButton]),
    toolbar,
    channels.length ? wrap
      : h('div', { class: 'melding let-op' }, icon('kalender'), h('div', {}, 'Deze klant heeft nog geen kanalen. ', h('a', { href: `#/klant/${clientId}/instellingen` }, 'Stel de kanalen in'), ' om de kalender te gebruiken.')));
}
