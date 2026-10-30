import { h, field, toast, showError, fmtDateTime, emptyState, confirmDialog } from '../ui.js';
import { api, can } from '../api.js';
import { clientHeader } from './clients.js';
import { uploadMedia } from './media.js';

const SOURCE = { handmatig: 'Handmatig', whatsapp: 'WhatsApp', email: 'E-mail', overig: 'Overig' };

export async function inboxView({ clientId, tab, rerender }) {
  const [{ header }, inputs, media] = await Promise.all([
    clientHeader(clientId, tab), api.get(`/clients/${clientId}/inputs`), api.get(`/clients/${clientId}/media`),
  ]);
  const editable = can('editContent');

  // Nieuwe input
  const title = h('input', { type: 'text', placeholder: 'Bijv. "Open dag zaterdag 14 november"' });
  const body = h('textarea', { rows: 6, required: true, placeholder: 'Informatie, teksten of steekwoorden van de klant…' });
  const instructions = h('textarea', { rows: 2, placeholder: 'Bijzonderheden: "niet vóór de 10e posten", "naam medewerker niet noemen"…' });
  const source = h('select', {}, ['handmatig', 'email', 'overig'].map((s) => h('option', { value: s }, SOURCE[s])));
  const files = h('input', { type: 'file', multiple: true, accept: 'image/*,video/*' });
  const newForm = h('form', {
    class: 'kaart',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const { id } = await api.post(`/clients/${clientId}/inputs`, { title: title.value, body: body.value, instructions: instructions.value, source: source.value });
        if (files.files.length) await uploadMedia(clientId, files.files, id);
        toast('Klantinput toegevoegd.');
        rerender();
      } catch (err) {
        showError(err);
      }
    },
  }, h('h2', {}, 'Klantinput toevoegen'),
  h('div', { class: 'rij' }, field('Titel', title), field('Bron', source)),
  field('Inhoud', body), field('Bijzonderheden / instructies', instructions),
  field('Foto\'s en video\'s van de klant', files, 'Worden in de mediabibliotheek opgeslagen en aan deze input gekoppeld.'),
  h('button', { class: 'knop primair', type: 'submit' }, 'Toevoegen'));

  // WhatsApp-import
  const waFile = h('input', { type: 'file', accept: '.txt,text/plain', required: true });
  const waFrom = h('input', { type: 'date' });
  const waTo = h('input', { type: 'date' });
  const waForm = h('form', {
    class: 'kaart',
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData();
      fd.append('file', waFile.files[0]);
      if (waFrom.value) fd.append('from', waFrom.value);
      if (waTo.value) fd.append('to', waTo.value);
      try {
        const res = await api.post(`/clients/${clientId}/inputs/whatsapp`, fd);
        toast(`${res.count} WhatsApp-berichten geïmporteerd.`);
        rerender();
      } catch (err) {
        showError(err);
      }
    },
  }, h('h2', {}, 'WhatsApp-import'),
  h('p', { class: 'zacht' }, 'Open de chat in WhatsApp → Chat exporteren → "Zonder media". Upload het .txt-bestand. Foto\'s en video\'s uit de chat voeg je toe via de mediabibliotheek.'),
  field('Chatexport (.txt)', waFile),
  h('div', { class: 'rij' }, field('Vanaf (optioneel)', waFrom), field('Tot en met (optioneel)', waTo)),
  h('button', { class: 'knop primair', type: 'submit' }, 'Importeren'));

  const mediaByInput = media.reduce((acc, m) => ((acc[m.client_input_id] ??= []).push(m), acc), {});

  const item = (i) => {
    const el = h('div', { class: `input-item ${i.processed ? 'verwerkt' : ''}` },
      h('div', { class: 'meta' },
        h('span', { class: 'chip' }, SOURCE[i.source]),
        h('span', {}, fmtDateTime(i.created_at)),
        i.processed ? h('span', { class: 'chip' }, '✓ Verwerkt in planning') : h('span', { class: 'chip ai-aan' }, 'Nieuw'),
        mediaByInput[i.id] ? h('span', {}, `${mediaByInput[i.id].length} bestand(en)`) : null),
      i.title ? h('h3', {}, i.title) : null,
      h('div', { class: 'body' }, i.body),
      i.instructions ? h('p', { class: 'zacht', style: { marginTop: '6px' } }, 'Instructies: ', i.instructions) : null,
      h('div', { class: 'knoppen', style: { marginTop: '8px' } },
        h('button', { class: 'knop klein kaal', onclick: () => el.classList.toggle('open') }, 'Alles tonen'),
        editable ? h('button', {
          class: 'knop klein kaal',
          onclick: async () => { await api.patch(`/inputs/${i.id}`, { processed: !i.processed }); rerender(); },
        }, i.processed ? 'Markeer als nieuw' : 'Markeer als verwerkt') : null,
        editable ? h('button', {
          class: 'knop klein kaal gevaar',
          onclick: async () => {
            if (await confirmDialog('Input verwijderen?', 'Gekoppelde foto\'s en video\'s blijven in de mediabibliotheek staan.', { confirmLabel: 'Verwijderen', danger: true })) {
              await api.del(`/inputs/${i.id}`);
              rerender();
            }
          },
        }, 'Verwijderen') : null));
    return el;
  };

  return [
    ...header,
    h('div', { class: 'twee-kolommen' },
      h('div', {},
        h('h2', {}, `Inbox (${inputs.filter((i) => !i.processed).length} nieuw)`),
        h('p', { class: 'zacht' }, 'Nieuwe input wordt meegenomen in de volgende conceptplanning. Na goedkeuring wordt hij als verwerkt gemarkeerd.'),
        inputs.length ? inputs.map(item) : emptyState('Nog geen klantinput. Zonder input maakt de AI algemene content op basis van de strategie.')),
      editable ? h('div', { style: { display: 'grid', gap: '16px', alignContent: 'start' } }, newForm, waForm) : null),
  ];
}
