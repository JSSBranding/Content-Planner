import { h, fill, icon, busy, toast, showError, fmtLongDate, fmtMonth, isoDate, addDays, shiftMonth, emptyState, copyText, page, modal, field, confirmDialog } from '../ui.js';
import { api, can } from '../api.js';
import { clientHeader } from './clients.js';

const WEEKDAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

// Contentshoots: voorstellen van de AI (met een voorgestelde datum) en eigen shoots, in een maandkalender en een lijst.
export async function shootsView({ clientId, tab, query, rerender }) {
  const [{ head }, shoots] = await Promise.all([clientHeader(clientId, tab), api.get(`/clients/${clientId}/shoots`)]);
  const editable = can('managePlans');
  const today = isoDate(new Date());
  const firstPlanned = shoots.find((s) => !s.done && s.planned_date && s.planned_date >= today)?.planned_date;
  let month = /^\d{4}-\d{2}$/.test(query.get('maand') ?? '') ? query.get('maand') : (firstPlanned ?? today).slice(0, 7);

  async function generate() {
    try {
      const res = await busy('De AI bekijkt wat er aan beeld ontbreekt en kiest datums', () => api.post(`/clients/${clientId}/shoots`));
      toast(`${res.count} shoots voorgesteld, elk met een datum`);
      rerender();
    } catch (err) {
      showError(err);
    }
  }
  // Elke knop krijgt een eigen element met eigen klikactie (een kopie van een knop verliest die).
  const generateButton = (cls = 'knop primair') => (editable ? h('button', { class: cls, type: 'button', onclick: generate }, icon('sparkle', { size: 16 }), 'Shoots laten voorstellen') : null);
  const addButton = (cls = 'knop') => (editable ? h('button', { class: cls, type: 'button', onclick: () => editShoot(null) }, icon('plus', { size: 16 }), 'Shoot toevoegen') : null);

  async function editShoot(shoot, presetDate) {
    const title = h('input', { type: 'text', value: shoot?.title ?? '', placeholder: 'Bijv. Team aan het werk in de bakkerij', required: true });
    const date = h('input', { type: 'date', value: shoot?.planned_date ?? presetDate ?? '' });
    const body = h('textarea', { rows: 6, value: shoot?.body ?? '', placeholder: 'Wat, waar, welke shots (foto/video, staand/liggend), voor welke pijler en kanalen' });
    const done = h('input', { type: 'checkbox', checked: Boolean(shoot?.done) });
    const error = h('div', { class: 'melding fout', hidden: true, role: 'alert' }, 'Geef de shoot een titel.');
    await modal({
      title: shoot ? 'Contentshoot wijzigen' : 'Contentshoot toevoegen', width: '600px',
      body: [
        error,
        field('Titel', title),
        field('Datum van de shoot', date, shoot?.ai_source && shoot.ai_source !== 'handmatig' ? 'Voorgesteld door de AI. Pas de datum aan als die niet uitkomt.' : 'Leeg laten als de datum nog niet vaststaat.'),
        field('Wat moet er gefilmd en gefotografeerd worden?', body),
        shoot ? h('label', { class: 'vinkje' }, done, 'Deze shoot is gedaan') : null,
      ],
      buttons: [
        shoot ? { label: 'Verwijderen', class: 'gevaar', action: async () => { if (await remove(shoot)) return true; return undefined; } } : null,
        { label: 'Annuleren' },
        {
          label: shoot ? 'Opslaan' : 'Toevoegen', class: 'primair',
          action: async () => {
            if (!title.value.trim()) { error.hidden = false; title.focus(); return undefined; }
            const data = { title: title.value, body: body.value, planned_date: date.value || null };
            try {
              if (shoot) await api.patch(`/shoots/${shoot.id}`, { ...data, done: done.checked });
              else await api.post(`/clients/${clientId}/shoots/eigen`, data);
              toast(shoot ? 'Shoot opgeslagen' : 'Shoot toegevoegd');
              rerender();
              return true;
            } catch (err) {
              showError(err);
            }
          },
        },
      ],
    });
  }

  async function remove(shoot) {
    if (!(await confirmDialog('Shoot verwijderen?', `"${shoot.title}" wordt verwijderd.`, { confirmLabel: 'Verwijderen', danger: true }))) return false;
    try {
      await api.del(`/shoots/${shoot.id}`);
      toast('Shoot verwijderd');
      rerender();
      return true;
    } catch (err) {
      showError(err);
      return false;
    }
  }

  async function toggleDone(shoot) {
    try {
      await api.patch(`/shoots/${shoot.id}`, { done: !shoot.done });
      toast(shoot.done ? 'Weer op de planning gezet' : 'Gemarkeerd als gedaan');
      rerender();
    } catch (err) {
      showError(err);
    }
  }

  // ---------- Maandkalender ----------

  const calendarHost = h('div', { class: 'paneelblok shootkalender' });
  function drawCalendar() {
    const first = `${month}-01`;
    const start = addDays(first, -((new Date(`${first}T12:00:00`).getDay() + 6) % 7)); // maandag van de eerste week
    const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const weeks = days.at(35).slice(0, 7) === month ? 6 : 5;
    const byDate = Map.groupBy ? Map.groupBy(shoots.filter((s) => s.planned_date), (s) => s.planned_date)
      : shoots.filter((s) => s.planned_date).reduce((m, s) => m.set(s.planned_date, [...(m.get(s.planned_date) ?? []), s]), new Map());
    const inMonth = shoots.filter((s) => s.planned_date?.startsWith(month)).length;
    fill(calendarHost,
      h('div', { class: 'maandkop' },
        h('div', { class: 'maandkiezer' },
          h('button', { type: 'button', 'aria-label': 'Vorige maand', onclick: () => { month = shiftMonth(month, -1); drawCalendar(); } }, icon('links')),
          h('span', { class: 'maand' }, fmtMonth(first)),
          h('button', { type: 'button', 'aria-label': 'Volgende maand', onclick: () => { month = shiftMonth(month, 1); drawCalendar(); } }, icon('rechts'))),
        h('span', { class: 'zacht' }, inMonth ? `${inMonth} shoot${inMonth === 1 ? '' : 's'} deze maand` : 'Geen shoots deze maand'),
        month !== today.slice(0, 7) ? h('button', { class: 'knop klein', type: 'button', onclick: () => { month = today.slice(0, 7); drawCalendar(); } }, 'Naar vandaag') : null),
      h('div', { class: 'maandraster', role: 'grid', 'aria-label': `Shoots in ${fmtMonth(first)}` },
        WEEKDAYS.map((d) => h('div', { class: 'weekdag', role: 'columnheader' }, d)),
        days.slice(0, weeks * 7).map((d) => {
          const list = byDate.get(d) ?? [];
          const other = d.slice(0, 7) !== month;
          return h('div', {
            class: `dagvak ${other ? 'andere-maand' : ''} ${d === today ? 'vandaag' : ''} ${[5, 6].includes(days.indexOf(d) % 7) ? 'weekend' : ''}`,
            role: 'gridcell',
          },
          h('div', { class: 'dagnr' }, Number(d.slice(8))),
          list.map((s) => h('button', {
            type: 'button', class: `shootchip ${s.done ? 'gedaan' : ''}`, title: `${s.title}${s.done ? ' (gedaan)' : ''}`,
            onclick: () => (editable ? editShoot(s) : showShoot(s)),
          }, icon(s.done ? 'vink' : 'camera', { size: 12 }), h('span', {}, s.title))),
          editable && !other && !list.length ? h('button', {
            type: 'button', class: 'dagplus', 'aria-label': `Shoot toevoegen op ${fmtLongDate(d)}`, title: 'Shoot toevoegen op deze dag',
            onclick: () => editShoot(null, d),
          }, icon('plus', { size: 13 })) : null);
        })));
  }

  function showShoot(s) {
    modal({
      title: s.title, width: '560px',
      body: [h('p', { class: 'zacht' }, s.planned_date ? fmtLongDate(s.planned_date) : 'Nog geen datum'), h('p', { style: { whiteSpace: 'pre-wrap' } }, s.body)],
      buttons: [{ label: 'Kopiëren', action: () => { copyText(`${s.title}\n\n${s.body}`); return undefined; } }, { label: 'Sluiten', class: 'primair', value: true }],
    });
  }

  // ---------- Lijst ----------

  const card = (s) => h('article', { class: `klantkaart shootkaart ${s.done ? 'gedaan' : ''}` },
    h('div', { class: 'kop' },
      h('span', { class: 'initialen', style: { background: s.done ? 'var(--vlak)' : 'var(--turkoois)', color: 'var(--inkt)' } }, icon(s.done ? 'vink' : 'camera', { size: 18 })),
      h('div', {}, h('h2', {}, s.title),
        h('div', { class: 'zacht' }, s.planned_date ? `${s.done ? 'Gedaan, gepland op' : 'Gepland op'} ${fmtLongDate(s.planned_date)}` : 'Nog geen datum',
          s.ai_source === 'handmatig' ? '' : ', voorstel van de AI'))),
    h('p', { style: { whiteSpace: 'pre-wrap', margin: 0 } }, s.body),
    h('div', { class: 'knoppen', style: { marginTop: 'auto' } },
      editable ? h('label', { class: 'vinkje klein-vinkje' }, h('input', { type: 'checkbox', checked: s.done, onchange: () => toggleDone(s) }), 'Gedaan') : null,
      h('button', { class: 'knop klein kaal', type: 'button', style: { marginLeft: 'auto' }, onclick: () => copyText(`${s.title}${s.planned_date ? ` (${fmtLongDate(s.planned_date)})` : ''}\n\n${s.body}`) }, icon('kopie', { size: 15 }), 'Kopiëren'),
      editable ? h('button', { class: 'knop klein', type: 'button', onclick: () => editShoot(s) }, icon('bewerk', { size: 15 }), 'Wijzigen') : null));

  if (!shoots.length) {
    return page(head([addButton(), generateButton()]),
      h('div', { class: 'paneelblok' }, emptyState(
        'Nog geen contentshoots. Laat de AI shoots voorstellen, elk met een voorgestelde datum, of plan er zelf een in.',
        editable ? h('div', { class: 'knoppen', style: { justifyContent: 'center' } }, generateButton(), addButton()) : null)));
  }

  drawCalendar();
  const open = shoots.filter((s) => !s.done);
  const done = shoots.filter((s) => s.done);
  return page(head([addButton(), generateButton()]),
    h('p', { class: 'zacht', style: { maxWidth: '720px', marginBottom: '18px' } },
      'Ideeën voor nieuwe foto- en video-opnames, op basis van de strategie, de pijlers en wat er in de beeldbibliotheek ontbreekt. Elke shoot heeft een voorgestelde datum; klik op een shoot om de datum of inhoud aan te passen.'),
    calendarHost,
    h('h2', { class: 'sectiekop' }, `Te doen (${open.length})`),
    open.length ? h('div', { class: 'klantkaarten' }, open.map(card)) : h('p', { class: 'zacht' }, 'Alle shoots zijn gedaan.'),
    done.length ? h('details', { class: 'uitklap', style: { marginTop: '22px' } },
      h('summary', {}, `Gedaan (${done.length})`),
      h('div', { class: 'klantkaarten' }, done.map(card))) : null);
}
