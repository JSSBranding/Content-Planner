import { h, icon, field, fileButton, toast, showError, fmtDateTime, emptyState, confirmDialog, mediaThumb, page } from '../ui.js';
import { api, can } from '../api.js';
import { clientHeader } from './clients.js';
import { uploadMedia } from './media.js';

const SOURCE = { handmatig: 'Handmatig', whatsapp: 'WhatsApp', email: 'E-mail', overig: 'Overig' };

export async function inboxView({ clientId, tab, query, rerender }) {
  const [{ head }, inputs, media] = await Promise.all([
    clientHeader(clientId, tab), api.get(`/clients/${clientId}/inputs`), api.get(`/clients/${clientId}/media`),
  ]);
  const editable = can('editContent');
  const showAll = query.get('alles') === '1';
  const open = inputs.filter((i) => !i.processed);
  const shown = showAll ? inputs : open;

  // ---------- Nieuwe input ----------

  const title = h('input', { type: 'text', placeholder: 'Bijv. Open dag zaterdag 14 november' });
  const body = h('textarea', { rows: 5, required: true, placeholder: 'Informatie, teksten of steekwoorden van de klant' });
  const instructions = h('textarea', { rows: 2, placeholder: 'Bijv. niet vóór de 10e posten, naam van de medewerker niet noemen' });
  const source = h('select', {}, ['handmatig', 'email', 'overig'].map((s) => h('option', { value: s }, SOURCE[s])));
  const files = h('input', { type: 'file', multiple: true, accept: 'image/*,video/*' });
  const newForm = h('form', {
    class: 'paneelblok',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const { id } = await api.post(`/clients/${clientId}/inputs`, { title: title.value, body: body.value, instructions: instructions.value, source: source.value });
        if (files.files.length) await uploadMedia(clientId, files.files, id);
        toast('Klantinput toegevoegd');
        rerender();
      } catch (err) {
        showError(err);
      }
    },
  }, h('h2', {}, 'Klantinput toevoegen'),
  h('p', { class: 'zacht' }, 'Wordt meegenomen in de volgende conceptplanning.'),
  h('div', { class: 'rij' }, h('div', { class: 'veld', style: { flex: '2 1 200px' } }, h('label', {}, 'Titel'), title), field('Bron', source)),
  field('Wat heeft de klant aangeleverd?', body),
  field('Bijzonderheden', instructions),
  h('div', { class: 'veld' }, h('label', {}, 'Foto\'s en video\'s'), fileButton(files, 'Bestanden kiezen'), h('div', { class: 'hulp' }, 'Komen in de beeldbibliotheek, gekoppeld aan deze input.')),
  h('button', { class: 'knop primair', type: 'submit', style: { width: '100%' } }, icon('plus', { size: 16 }), 'Toevoegen'));

  // ---------- WhatsApp-import ----------

  const waFile = h('input', { type: 'file', accept: '.txt,text/plain' });
  const waFrom = h('input', { type: 'date' });
  const waTo = h('input', { type: 'date' });
  const waForm = h('form', {
    class: 'paneelblok',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!waFile.files[0]) return showError(new Error('Kies eerst het .txt-bestand van de chatexport.'));
      const fd = new FormData();
      fd.append('file', waFile.files[0]);
      if (waFrom.value) fd.append('from', waFrom.value);
      if (waTo.value) fd.append('to', waTo.value);
      try {
        const res = await api.post(`/clients/${clientId}/inputs/whatsapp`, fd);
        toast(`${res.count} WhatsApp-berichten geïmporteerd`);
        rerender();
      } catch (err) {
        showError(err);
      }
    },
  }, h('h2', {}, 'WhatsApp-chat importeren'),
  h('p', { class: 'zacht' }, 'In WhatsApp: open de chat, kies Chat exporteren en dan Zonder media. Upload het .txt-bestand hier. Foto\'s uit de chat voeg je toe via Beeld.'),
  h('div', { class: 'veld' }, h('label', {}, 'Chatexport'), fileButton(waFile, 'Bestand kiezen', 'Nog geen bestand')),
  h('div', { class: 'rij' }, field('Vanaf', waFrom), field('Tot en met', waTo)),
  h('button', { class: 'knop', type: 'submit', style: { width: '100%' } }, icon('whatsapp', { size: 16 }), 'Importeren'));

  // ---------- Inbox ----------

  const mediaByInput = media.reduce((acc, m) => ((acc[m.client_input_id] ??= []).push(m), acc), {});

  const item = (i) => {
    const pics = mediaByInput[i.id] ?? [];
    const el = h('article', { class: `input-item ${i.processed ? 'verwerkt' : ''}` },
      h('div', { class: 'meta' },
        h('span', { class: 'chip' }, i.source === 'whatsapp' ? icon('whatsapp', { size: 13 }) : icon('inbox', { size: 13 }), SOURCE[i.source]),
        h('span', {}, fmtDateTime(i.created_at)),
        i.processed ? h('span', { class: 'chip ok' }, icon('vink', { size: 13 }), 'Verwerkt') : h('span', { class: 'chip turkoois' }, 'Nieuw')),
      i.title ? h('h3', {}, i.title) : null,
      h('div', { class: 'body' }, i.body),
      i.instructions ? h('p', { class: 'zacht', style: { marginTop: '8px', marginBottom: 0 } }, `Bijzonderheden: ${i.instructions}`) : null,
      pics.length ? h('div', { class: 'beeldjes', style: { marginTop: '10px' } }, pics.slice(0, 8).map((m) => mediaThumb(m)), pics.length > 8 ? h('span', { class: 'zacht' }, `+${pics.length - 8}`) : null) : null,
      h('div', { class: 'acties' },
        i.body.length > 300 ? h('button', { class: 'knop klein kaal', onclick: (e) => { el.classList.toggle('open'); e.currentTarget.textContent = el.classList.contains('open') ? 'Minder tonen' : 'Alles lezen'; } }, 'Alles lezen') : null,
        editable ? h('button', {
          class: 'knop klein kaal',
          onclick: async () => { await api.patch(`/inputs/${i.id}`, { processed: !i.processed }); rerender(); },
        }, i.processed ? 'Terugzetten naar nieuw' : 'Markeer als verwerkt') : null,
        editable ? h('button', {
          class: 'knop klein kaal gevaar',
          onclick: async () => {
            if (await confirmDialog('Input verwijderen?', 'Het bijbehorende beeld blijft in de bibliotheek staan.', { confirmLabel: 'Verwijderen', danger: true })) {
              await api.del(`/inputs/${i.id}`);
              toast('Input verwijderd');
              rerender();
            }
          },
        }, 'Verwijderen') : null));
    return el;
  };

  const switcher = h('div', { class: 'knoppen', style: { marginBottom: '12px' } },
    h('a', { class: `knop klein ${showAll ? 'kaal' : ''}`, href: `#/klant/${clientId}/input` }, `Nieuw (${open.length})`),
    h('a', { class: `knop klein ${showAll ? '' : 'kaal'}`, href: `#/klant/${clientId}/input?alles=1` }, `Alles (${inputs.length})`));

  return page(head(),
    h('div', { class: editable ? 'zij-kolom' : '' },
      h('div', {}, switcher,
        shown.length ? shown.map(item) : h('div', { class: 'paneelblok' }, emptyState(showAll
          ? 'Nog geen klantinput. Zonder input maakt de AI algemene content op basis van de strategie.'
          : 'Geen nieuwe klantinput. Alles is verwerkt.'))),
      editable ? h('div', { style: { display: 'grid', gap: '16px' } }, newForm, waForm) : null));
}
