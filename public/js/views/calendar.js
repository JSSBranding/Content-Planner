import {
  h, fill, field, toast, showError, modal, confirmDialog, busy, copyText, downloadUrl, mediaThumb, mediaPreview,
  fmtDate, fmtLongDate, fmtMonth, fmtDateTime, isoDate, addDays, monthBounds, shiftMonth,
} from '../ui.js';
import { api, meta, can, channelLabel, statusLabel, statusColor } from '../api.js';
import { clientHeader } from './clients.js';
import { pickMedia } from './media.js';

export async function calendarView({ clientId, tab, query, rerender }) {
  const month = /^\d{4}-\d{2}$/.test(query.get('maand') ?? '') ? query.get('maand') : isoDate(new Date()).slice(0, 7);
  const { from, to } = monthBounds(month);
  const [{ client, header }, cal, users] = await Promise.all([
    clientHeader(clientId, tab), api.get(`/clients/${clientId}/calendar?from=${from}&to=${to}`), api.get('/users'),
  ]);
  const goMonth = (ym) => { location.hash = `#/klant/${clientId}/kalender?maand=${ym}`; };
  const statusFilter = query.get('status') ?? '';

  // Kanalen van de klant, plus kanalen waar (nog) content op staat.
  const channels = [...new Set([...client.channels, ...cal.items.map((i) => i.channel)])];
  const byCell = new Map(cal.items.map((i) => [`${i.publish_date}|${i.channel}`, i]));
  const today = isoDate(new Date());

  const toolbar = h('div', { class: 'kalenderbalk' },
    h('button', { class: 'knop', onclick: () => goMonth(shiftMonth(month, -1)), 'aria-label': 'Vorige maand' }, '←'),
    h('div', { class: 'maand' }, fmtMonth(from)),
    h('button', { class: 'knop', onclick: () => goMonth(shiftMonth(month, 1)), 'aria-label': 'Volgende maand' }, '→'),
    h('button', { class: 'knop kaal', onclick: () => goMonth(today.slice(0, 7)) }, 'Vandaag'),
    h('select', {
      style: { width: 'auto' }, value: statusFilter,
      onchange: (e) => { location.hash = `#/klant/${clientId}/kalender?maand=${month}${e.target.value ? `&status=${e.target.value}` : ''}`; },
    }, h('option', { value: '' }, 'Alle statussen'), meta.calendarStatuses.map((s) => h('option', { value: s.key }, s.label))),
    h('div', { class: 'knoppen', style: { marginLeft: 'auto' } },
      can('editContent') ? h('button', { class: 'knop primair', onclick: () => openEditor({ publish_date: today >= from && today <= to ? today : from, channel: channels[0] }) }, '+ Handmatige post') : null,
      h('a', { class: 'knop', href: `/api/clients/${clientId}/export.xlsx?from=${from}&to=${to}`, download: '' }, 'Excel-export'),
      can('editContent') ? h('button', { class: 'knop', onclick: importExcel }, 'Excel-import') : null));

  const legend = h('div', { class: 'legenda sectie', style: { marginTop: '10px' } },
    meta.calendarStatuses.map((s) => h('span', { class: 'status', style: { '--kleur': statusColor(s.key) } },
      `${s.label} (${cal.items.filter((i) => i.status === s.key).length})`)));

  // ---------- Raster ----------

  const rows = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = new Date(`${d}T12:00:00`).getDay();
    rows.push(h('tr', { class: [day === 0 || day === 6 ? 'weekend' : '', day === 1 ? 'weekstart' : '', d === today ? 'vandaag' : ''].join(' ') },
      h('td', { class: 'datum' }, new Date(`${d}T12:00:00`).getDate(), h('span', { class: 'dag' }, fmtDate(d).split(' ')[0])),
      channels.map((ch) => h('td', { class: 'kanaalcel' }, cell(d, ch)))));
  }

  function cell(date, channel) {
    const item = byCell.get(`${date}|${channel}`);
    const label = `${fmtLongDate(date)}, ${channelLabel(channel)}`;
    if (!item) {
      return can('editContent')
        ? h('button', { class: 'cel leeg-cel', 'aria-label': `Nieuwe post: ${label}`, onclick: () => openEditor({ publish_date: date, channel }) }, '+ post')
        : h('div', { class: 'cel leeg-cel' });
    }
    const hidden = statusFilter && item.status !== statusFilter;
    const shown = item.media.slice(0, 3);
    return h('button', {
      class: 'cel gevuld', style: { '--kleur': statusColor(item.status), opacity: hidden ? '0.25' : null },
      'aria-label': `${label}: ${statusLabel(item.status)}`, onclick: () => openEditor(item),
    },
    h('div', { class: 'celkop' }, h('span', {}, item.suggested_time ?? ''), h('span', {}, statusLabel(item.status))),
    item.body ? h('div', { class: 'celtekst' }, item.body) : h('div', { class: 'celtekst ontbreekt' }, item.topic || 'Tekst ontbreekt'),
    item.media.length ? h('div', { class: 'duimpjes' }, shown.map((m) => mediaThumb(m)),
      item.media.length > 3 ? h('span', { class: 'duim-meer' }, `+${item.media.length - 3}`) : null) : null);
  }

  const grid = h('div', { class: 'raster-wrap' },
    h('table', { class: 'raster' },
      h('thead', {}, h('tr', {}, h('th', { class: 'datum' }, 'Datum'), channels.map((ch) => h('th', {}, channelLabel(ch))))),
      h('tbody', {}, rows)));

  // ---------- Zijpaneel: kanaalcel bekijken en bewerken ----------

  async function openEditor(start) {
    const isNew = !start.id;
    let item = isNew ? { body: '', topic: '', source_info: '', internal_notes: '', status: 'placeholder_actie_nodig', media: [], suggested_time: null, assignee_id: null, ...start } : await api.get(`/calendar/${start.id}`);
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
      onchange: () => { status.style.setProperty('--kleur', statusColor(status.value)); statusTouched = true; markDirty(); },
    }, meta.calendarStatuses.map((s) => h('option', { value: s.key }, s.label)));
    status.style.setProperty('--kleur', statusColor(item.status));
    const assignee = h('select', { value: item.assignee_id ?? '', disabled: !contentEditable, onchange: markDirty },
      h('option', { value: '' }, '— Niemand —'), users.map((u) => h('option', { value: u.id }, u.name)));
    const topic = h('input', { type: 'text', value: item.topic, disabled: !contentEditable, oninput: markDirty });
    const counter = h('span', { class: 'zacht' });
    const body = h('textarea', { rows: 10, value: item.body, disabled: !contentEditable, oninput: () => { markDirty(); count(); } });
    const count = () => { counter.textContent = `${body.value.length} tekens`; };
    count();
    const source = h('textarea', { rows: 3, value: item.source_info, disabled: !contentEditable, oninput: markDirty });
    const notes = h('textarea', { rows: 3, value: item.internal_notes, disabled: !statusEditable, oninput: markDirty });

    const mediaHost = h('div');
    function drawMedia() {
      fill(mediaHost, mediaList.length ? h('div', { class: 'beeldlijst' }, mediaList.map((m, i) => h('div', { class: 'beeld' },
        h('div', { class: 'voorbeeld' }, mediaPreview(m)),
        h('div', { class: 'info' }, h('div', { class: 'naam', title: m.filename }, m.filename)),
        h('div', { class: 'acties' },
          h('a', { class: 'knop klein kaal', href: m.download_url, download: '' }, 'Download'),
          contentEditable && i > 0 ? h('button', { class: 'knop klein kaal', 'aria-label': 'Naar voren', onclick: () => move(i, -1) }, '←') : null,
          contentEditable && i < mediaList.length - 1 ? h('button', { class: 'knop klein kaal', 'aria-label': 'Naar achteren', onclick: () => move(i, 1) }, '→') : null,
          contentEditable ? h('button', { class: 'knop klein kaal gevaar', onclick: () => { mediaList.splice(i, 1); markDirty(); drawMedia(); } }, 'Ontkoppel') : null))))
        : h('p', { class: 'zacht' }, 'Nog geen beeld gekoppeld.'));
    }
    function move(i, delta) {
      const [m] = mediaList.splice(i, 1);
      mediaList.splice(i + delta, 0, m);
      markDirty();
      drawMedia();
    }
    drawMedia();

    async function chooseMedia() {
      const ids = await pickMedia(clientId, { selected: mediaList.map((m) => m.id), title: 'Beeld koppelen of vervangen' });
      if (!ids) return;
      const all = await api.get(`/clients/${clientId}/media`);
      mediaList = ids.map((id) => all.find((m) => m.id === id)).filter(Boolean);
      markDirty();
      drawMedia();
    }

    async function save() {
      const payload = { status: status.value, internal_notes: notes.value };
      if (contentEditable) {
        Object.assign(payload, {
          publish_date: date.value, suggested_time: time.value || null, channel: channel.value, topic: topic.value,
          body: body.value, source_info: source.value, assignee_id: assignee.value || null, media: mediaList.map((m) => m.id),
        });
      }
      try {
        if (isNew) {
          // Zonder eigen keuze bepaalt de server de status op basis van tekst en beeld.
          if (!statusTouched) delete payload.status;
          await api.post(`/clients/${clientId}/calendar`, { ...payload, date: payload.publish_date, time: payload.suggested_time });
          toast('Post opgeslagen.');
        } else {
          await api.patch(`/calendar/${item.id}`, payload);
          toast('Wijzigingen opgeslagen.');
        }
        dirty = false;
        close();
        rerender();
      } catch (err) {
        showError(err);
      }
    }

    async function aiText() {
      if (dirty && !(await confirmDialog('Niet-opgeslagen wijzigingen', 'Sla eerst je wijzigingen op, of ga door en verlies ze.', { confirmLabel: 'Doorgaan zonder opslaan' }))) return;
      try {
        await busy('De AI schrijft de tekst…', () => api.post(`/calendar/${item.id}/write-text`));
        toast('Nieuwe tekst geschreven. De vorige staat in de versiegeschiedenis.');
        dirty = false;
        close();
        rerender();
        openEditor({ id: item.id });
      } catch (err) {
        showError(err);
      }
    }

    async function remove() {
      if (!(await confirmDialog('Post verwijderen?', 'Deze kanaalcel wordt leeggemaakt. Het beeld blijft in de mediabibliotheek.', { confirmLabel: 'Verwijderen', danger: true }))) return;
      await api.del(`/calendar/${item.id}`);
      close();
      rerender();
    }

    const versions = isNew ? null : h('details', { class: 'sectie' },
      h('summary', {}, h('strong', {}, `Versiegeschiedenis (${item.versions.length})`)),
      item.versions.length ? h('ul', { class: 'versies' }, item.versions.map((v) => h('li', {},
        h('div', {}, h('div', {}, v.reason || 'Bewerkt'), h('div', { class: 'zacht' }, fmtDateTime(v.changed_at), ' · ', v.changed_by_ai ? 'AI' : (v.changed_by_name ?? 'onbekend'))),
        h('div', { class: 'knoppen' },
          h('button', { class: 'knop klein', onclick: () => showVersion(v) }, 'Bekijk'),
          contentEditable ? h('button', { class: 'knop klein', onclick: () => restore(v) }, 'Terugzetten') : null)))) : h('p', { class: 'zacht' }, 'Nog geen eerdere versies.'));

    async function showVersion(v) {
      const { snapshot: s } = await api.get(`/calendar/${item.id}/versions/${v.id}`);
      modal({
        title: `Versie van ${fmtDateTime(v.changed_at)}`,
        body: [h('p', {}, h('strong', {}, `${fmtLongDate(s.publish_date)} · ${channelLabel(s.channel)} · ${statusLabel(s.status)}`)),
          h('p', { style: { whiteSpace: 'pre-wrap' } }, s.body || '(geen tekst)'),
          s.internal_notes ? h('p', { class: 'zacht' }, 'Opmerkingen: ', s.internal_notes) : null],
        buttons: [{ label: 'Sluiten' }],
      });
    }
    async function restore(v) {
      if (!(await confirmDialog('Versie terugzetten?', 'De huidige versie wordt eerst bewaard in de geschiedenis.', { confirmLabel: 'Terugzetten' }))) return;
      try {
        await api.post(`/calendar/${item.id}/versions/${v.id}/restore`);
        toast('Versie teruggezet.');
        close();
        rerender();
      } catch (err) {
        showError(err);
      }
    }

    const backdrop = h('div', { class: 'scherm', onclick: () => tryClose() });
    const panel = h('aside', { class: 'paneel', role: 'dialog', 'aria-label': 'Kalenderitem' },
      h('div', { class: 'paneel-kop' },
        h('div', {}, h('div', { class: 'zacht' }, isNew ? 'Nieuwe handmatige post' : channelLabel(item.channel)),
          h('h2', {}, isNew ? 'Post toevoegen' : fmtLongDate(item.publish_date))),
        h('button', { class: 'knop kaal sluit', 'aria-label': 'Sluiten', onclick: () => tryClose() }, '✕')),
      h('div', { class: 'paneel-inhoud' },
        !contentEditable ? h('div', { class: 'melding info' }, 'Kopieer de tekst en download het beeld voor de vormgeving. Na het inplannen buiten de app zet je hier de status.') : null,
        h('div', { class: 'rij' }, field('Status', status), field('Verantwoordelijke', assignee)),
        h('div', { class: 'rij' }, field('Publicatiedatum', date), field('Tijdstip (voorstel)', time), field('Kanaal', channel)),
        field('Onderwerp', topic),
        h('div', { class: 'veld' },
          h('div', { class: 'knoppen', style: { justifyContent: 'space-between', marginBottom: '4px' } },
            h('label', { for: 'celtekst', style: { margin: 0 } }, `Tekst voor ${channelLabel(item.channel)}`),
            h('div', { class: 'knoppen' }, counter,
              h('button', { class: 'knop klein', type: 'button', onclick: () => copyText(body.value) }, 'Kopieer tekst'),
              contentEditable && !isNew ? h('button', { class: 'knop klein', type: 'button', onclick: aiText }, item.body ? 'AI: herschrijven' : 'AI: tekst schrijven') : null)),
          Object.assign(body, { id: 'celtekst' })),
        h('div', { class: 'veld' },
          h('div', { class: 'knoppen', style: { justifyContent: 'space-between', marginBottom: '6px' } },
            h('label', { style: { margin: 0 } }, 'Origineel beeld van de klant'),
            h('div', { class: 'knoppen' },
              mediaList.length > 1 ? h('button', { class: 'knop klein', type: 'button', onclick: () => mediaList.forEach((m, i) => setTimeout(() => downloadUrl(m.download_url), i * 400)) }, 'Alles downloaden') : null,
              contentEditable ? h('button', { class: 'knop klein', type: 'button', onclick: chooseMedia }, 'Beeld kiezen / vervangen') : null)),
          mediaHost),
        field('Klantinput / broninformatie', source),
        field('Interne opmerkingen', notes, 'Bijv. instructies voor de vormgever of waar de post is ingepland.'),
        versions),
      h('div', { class: 'paneel-voet' },
        statusEditable ? h('button', { class: 'knop primair', onclick: save }, isNew ? 'Opslaan' : 'Wijzigingen opslaan') : null,
        h('button', { class: 'knop', onclick: () => tryClose() }, 'Sluiten'),
        contentEditable && !isNew ? h('button', { class: 'knop gevaar', style: { marginLeft: 'auto' }, onclick: remove }, 'Verwijderen') : null));

    const onKey = (e) => e.key === 'Escape' && !document.querySelector('.modaal') && tryClose();
    async function tryClose() {
      if (dirty && !(await confirmDialog('Wijzigingen niet opgeslagen', 'Wil je het paneel sluiten zonder op te slaan?', { confirmLabel: 'Sluiten zonder opslaan', danger: true }))) return;
      close();
    }
    function close() {
      backdrop.remove();
      panel.remove();
      document.removeEventListener('keydown', onKey);
    }
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop, panel);
    (contentEditable ? body : status).focus();
  }

  // ---------- Excel-import ----------

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
      const boxes = existing.map((r) => h('input', { type: 'checkbox', value: r.key }));
      const result = await modal({
        title: 'Excel-import controleren', width: '720px',
        body: [
          h('p', {}, `${preview.rows.length - existing.length} nieuwe post(s) worden toegevoegd.`),
          preview.errors.length ? h('div', { class: 'melding let-op' }, h('strong', {}, 'Overgeslagen regels:'), h('ul', {}, preview.errors.map((e) => h('li', {}, e)))) : null,
          existing.length ? [
            h('div', { class: 'melding let-op' }, `${existing.length} regel(s) vallen op een datum en kanaal waar al content staat. Die worden overgeslagen, tenzij je ze hieronder expliciet aanvinkt om te vervangen. De huidige versie blijft dan in de geschiedenis bewaard.`),
            h('ul', { class: 'conflictlijst' }, existing.map((r, i) => h('li', {}, h('label', { class: 'vinkje' }, boxes[i], `${fmtLongDate(r.date)} · ${channelLabel(r.channel)} vervangen`),
              h('div', { class: 'zacht' }, (r.body || '(geen tekst)').slice(0, 160))))),
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
        toast(`Import klaar: ${res.created} toegevoegd, ${res.replaced} vervangen, ${res.skipped} overgeslagen.`);
        rerender();
      } catch (err) {
        showError(err);
      }
    });
    input.click();
  }

  return [
    ...header,
    toolbar,
    legend,
    channels.length ? grid : h('div', { class: 'melding let-op' }, 'Deze klant heeft nog geen kanalen. Stel ze in bij "Klantprofiel & AI-geheugen".'),
  ];
}
