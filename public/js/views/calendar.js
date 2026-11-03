import {
  h, fill, icon, field, toast, showError, modal, confirmDialog, busy, copyText, downloadUrl, mediaThumb, mediaPreview, openMenu,
  page, initials, fmtLongDate, fmtMonth, fmtDateTime, isoDate, addDays, monthBounds, shiftMonth, isoWeek,
} from '../ui.js';
import { api, meta, can, channelLabel, statusLabel, statusStyle } from '../api.js';
import { clientHeader } from './clients.js';
import { pickMedia } from './media.js';
import { daysBetween } from '../../gedeeld/dagen.js';

// Scrollpositie per maand bewaren, zodat de kalender na opslaan niet terugspringt.
const scrollMemory = new Map();

export async function calendarView({ clientId, tab, query, rerender }) {
  const month = /^\d{4}-\d{2}$/.test(query.get('maand') ?? '') ? query.get('maand') : isoDate(new Date()).slice(0, 7);
  const { from, to } = monthBounds(month);
  const [{ client, head }, cal, users] = await Promise.all([
    clientHeader(clientId, tab), api.get(`/clients/${clientId}/calendar?from=${from}&to=${to}`), api.get('/users'),
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
  const specialDays = daysBetween(from, to).filter((d) => showActionDays || d.type === 'feestdag');
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
    h('div', { style: { flex: '1' } }),
    filterBar,
    h('label', { class: 'vinkje klein-vinkje', title: 'Thema- en actiedagen zoals Dierendag en Black Friday' },
      h('input', {
        type: 'checkbox', checked: showActionDays,
        onchange: (e) => { try { localStorage.setItem('jcs-actiedagen', e.target.checked ? 'aan' : 'uit'); } catch { /* geen opslag */ } rerender(); },
      }), 'Actiedagen tonen'));

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
        daysOn(d).length ? h('ul', { class: 'dagen' }, daysOn(d).map((x) => h('li', { class: x.type, title: x.type === 'feestdag' ? 'Feestdag' : 'Actiedag' }, x.name))) : null),
      channels.map((ch) => h('td', { class: 'kanaalcel' }, cell(d, ch)))));
  }

  function cell(date, channel) {
    const item = byCell.get(`${date}|${channel}`);
    const label = `${fmtLongDate(date)}, ${channelLabel(channel)}`;
    if (!item) {
      if (!can('editContent')) return h('div', { class: 'cel leeg-cel' });
      return h('div', { class: 'cel leeg-cel' },
        h('button', { type: 'button', class: 'open', 'aria-label': `Post toevoegen: ${label}`, onclick: () => openEditor({ publish_date: date, channel }) }, icon('plus', { size: 16 })));
    }
    const dimmed = statusFilter && item.status !== statusFilter;
    const shown = item.media.slice(0, 3);
    return h('div', { class: `cel gevuld ${dimmed ? 'gedimd' : ''}`, style: statusStyle(item.status) },
      h('button', {
        type: 'button', class: 'open', 'aria-label': `${label}, ${statusLabel(item.status)}. Openen`,
        title: statusLabel(item.status), onclick: () => openEditor(item),
      },
      h('div', { class: 'celkop' },
        h('span', { class: 'tijd' }, item.suggested_time ?? ''),
        item.content_pillar ? h('span', { class: 'pijler', title: 'Contentpijler' }, item.content_pillar) : null,
        h('span', { class: 'rechts' },
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
    const assignee = h('select', { value: item.assignee_id ?? '', disabled: !contentEditable, onchange: markDirty },
      h('option', { value: '' }, 'Niemand'), users.map((u) => h('option', { value: u.id }, u.name)));
    const topic = h('input', { type: 'text', value: item.topic, disabled: !contentEditable, oninput: markDirty, placeholder: 'Waar gaat deze post over?' });
    const counter = h('span', { class: 'zacht' });
    const body = h('textarea', { id: 'celtekst', class: 'groot-tekstvak', value: item.body, disabled: !contentEditable, placeholder: 'Tekst voor deze post', oninput: () => { markDirty(); count(); } });
    const count = () => { counter.textContent = `${body.value.length} tekens`; };
    count();
    const source = h('textarea', { rows: 3, value: item.source_info, disabled: !contentEditable, oninput: markDirty });
    const notes = h('textarea', { rows: 3, value: item.internal_notes, disabled: !statusEditable, oninput: markDirty, placeholder: 'Bijv. instructies voor branding, of waar de post is ingepland' });

    const mediaHost = h('div');
    function drawMedia() {
      fill(mediaHost, mediaList.length ? h('div', { class: 'beeldlijst' }, mediaList.map((m, i) => h('div', { class: 'beeld' },
        h('div', { class: 'voorbeeld' }, mediaPreview(m), m.kind === 'video' ? h('span', { class: 'soort' }, icon('video', { size: 12 }), 'Video') : null),
        h('div', { class: 'info' }, h('div', { class: 'naam', title: m.filename }, m.filename)),
        h('div', { class: 'acties' },
          h('a', { class: 'knop klein kaal', href: m.download_url, download: '', title: 'Downloaden' }, icon('download', { size: 15 }), 'Download'),
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
          body: body.value, source_info: source.value, assignee_id: assignee.value || null, media: mediaList.map((m) => m.id),
        });
      }
      try {
        if (isNew) {
          // Zonder eigen keuze bepaalt de server de status op basis van tekst en beeld.
          if (!statusTouched) delete payload.status;
          await api.post(`/clients/${clientId}/calendar`, { ...payload, date: payload.publish_date, time: payload.suggested_time });
          toast('Post toegevoegd');
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
        h('div', { class: 'rij' }, field('Status', status), field('Contentpijler (optioneel)', pillar, pillarOptions.length ? null : 'Pijlers stel je in op het klantprofiel.'), field('Verantwoordelijke', assignee)),
        h('div', { class: 'veld' },
          h('div', { class: 'tekstkop' },
            h('label', { for: 'celtekst' }, `Tekst voor ${channelLabel(item.channel)}`), counter,
            h('button', { class: 'knop klein', type: 'button', onclick: () => copyText(body.value) }, icon('kopie', { size: 15 }), 'Kopiëren'),
            contentEditable && !isNew ? h('button', { class: 'knop klein', type: 'button', onclick: aiText, title: 'Laat de AI deze tekst (opnieuw) schrijven' }, icon('sparkle', { size: 15 }), item.body ? 'Herschrijven' : 'Laten schrijven') : null),
          body),
        h('div', { class: 'veld' },
          h('div', { class: 'tekstkop' },
            h('label', {}, 'Origineel beeld'),
            mediaList.length > 1 ? h('button', { class: 'knop klein', type: 'button', onclick: () => mediaList.forEach((m, i) => setTimeout(() => downloadUrl(m.download_url), i * 400)) }, icon('download', { size: 15 }), 'Alles downloaden') : null,
            contentEditable ? h('button', { class: 'knop klein', type: 'button', onclick: chooseMedia }, icon('beeld', { size: 15 }), mediaList.length ? 'Beeld wijzigen' : 'Beeld kiezen') : null),
          mediaHost),
        field('Interne opmerkingen', notes),
        h('details', { class: 'uitklap', open: isNew },
          h('summary', {}, icon('bewerk', { size: 16 }), 'Datum, kanaal, onderwerp en bron'),
          h('div', { class: 'rij' }, field('Datum', date), field('Tijd (voorstel)', time), field('Kanaal', channel)),
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
      ...(can('editContent') ? [{ label: 'Excel-bestand importeren', icon: 'upload', action: importExcel }] : []),
    ]),
  }, icon('excel', { size: 16 }), 'Excel');

  const addButton = can('editContent')
    ? h('button', { class: 'knop primair', onclick: () => openEditor({ publish_date: today >= from && today <= to ? today : from, channel: channels[0] }) }, icon('plus', { size: 16 }), 'Post toevoegen')
    : null;

  return page(head([excelButton, addButton]),
    toolbar,
    channels.length ? wrap
      : h('div', { class: 'melding let-op' }, icon('kalender'), h('div', {}, 'Deze klant heeft nog geen kanalen. ', h('a', { href: `#/klant/${clientId}/instellingen` }, 'Stel de kanalen in'), ' om de kalender te gebruiken.')));
}
