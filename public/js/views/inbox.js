import { h, fill, icon, field, fileButton, toast, showError, fmtDateTime, confirmDialog, mediaThumb, modal } from '../ui.js';
import { api, can } from '../api.js';
import { uploadMedia } from './media.js';

const SOURCE = { handmatig: 'Handmatig', whatsapp: 'WhatsApp', email: 'E-mail', overig: 'Overig' };

// Klantinput is tijdelijk: wat de klant aanlevert, wordt verwerkt in een conceptplanning en is daarna niet meer nodig.
// Dit blok staat daarom op het tabblad Input en planning, boven de planningen.
export function inputSection({ clientId, inputs, media, rerender }) {
  const editable = can('editContent');
  const open = inputs.filter((i) => !i.processed);
  const processed = inputs.filter((i) => i.processed);
  const mediaByInput = media.reduce((acc, m) => ((acc[m.client_input_id] ??= []).push(m), acc), {});
  let showProcessed = false;

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

  const list = h('div');
  const toggle = processed.length ? h('button', { class: 'knop klein kaal', onclick: () => { showProcessed = !showProcessed; draw(); } }) : null;
  function draw() {
    const shown = showProcessed ? [...open, ...processed] : open;
    fill(list, shown.length ? shown.map(item)
      : h('p', { class: 'zacht', style: { margin: '4px 0 0' } }, inputs.length
        ? 'Alles is verwerkt. Nieuwe input van de klant voeg je hier toe.'
        : 'Nog geen klantinput. Zonder input maakt de AI algemene content op basis van de strategie en context.'));
    if (toggle) toggle.textContent = showProcessed ? 'Verwerkte input verbergen' : `Verwerkte input tonen (${processed.length})`;
  }
  draw();

  return h('section', { class: 'paneelblok sectie' },
    h('div', { class: 'knoppen', style: { justifyContent: 'space-between', marginBottom: '12px' } },
      h('div', {}, h('h2', {}, `Klantinput${open.length ? ` (${open.length} nieuw)` : ''}`),
        h('p', { class: 'zacht', style: { margin: 0 } }, 'Wat de klant aanlevert. Wordt meegenomen in de volgende conceptplanning en daarna als verwerkt gemarkeerd.')),
      editable ? h('div', { class: 'knoppen' },
        h('button', { class: 'knop', onclick: () => addInput(clientId, rerender) }, icon('plus', { size: 16 }), 'Input toevoegen'),
        h('button', { class: 'knop', onclick: () => importWhatsApp(clientId, rerender) }, icon('whatsapp', { size: 16 }), 'WhatsApp importeren')) : null),
    list, toggle);
}

async function addInput(clientId, rerender) {
  const title = h('input', { type: 'text', placeholder: 'Bijv. Open dag zaterdag 14 november' });
  const body = h('textarea', { rows: 6, placeholder: 'Informatie, teksten of steekwoorden van de klant' });
  const instructions = h('textarea', { rows: 2, placeholder: 'Bijv. niet vóór de 10e posten, naam van een collega niet noemen' });
  const source = h('select', {}, ['handmatig', 'email', 'overig'].map((s) => h('option', { value: s }, SOURCE[s])));
  const files = h('input', { type: 'file', multiple: true, accept: 'image/*,video/*' });
  await modal({
    title: 'Klantinput toevoegen', width: '600px',
    body: [
      h('div', { class: 'rij' }, h('div', { class: 'veld', style: { flex: '2 1 200px' } }, h('label', {}, 'Titel'), title), field('Bron', source)),
      field('Wat heeft de klant aangeleverd?', body),
      field('Bijzonderheden', instructions),
      can('manageMedia') ? h('div', { class: 'veld' }, h('label', {}, 'Foto\'s en video\'s'), fileButton(files, 'Bestanden kiezen'), h('div', { class: 'hulp' }, 'Komen bij Beeld, gekoppeld aan deze input.')) : null,
    ],
    buttons: [{ label: 'Annuleren' }, {
      label: 'Toevoegen', class: 'primair',
      action: async () => {
        if (!body.value.trim()) { showError(new Error('Vul in wat de klant heeft aangeleverd.')); return undefined; }
        try {
          const { id } = await api.post(`/clients/${clientId}/inputs`, { title: title.value, body: body.value, instructions: instructions.value, source: source.value });
          if (files.files.length) await uploadMedia(clientId, files.files, id);
          toast('Klantinput toegevoegd');
          rerender();
          return true;
        } catch (err) {
          showError(err);
        }
      },
    }],
  });
}

async function importWhatsApp(clientId, rerender) {
  const file = h('input', { type: 'file', accept: '.txt,text/plain' });
  const from = h('input', { type: 'date' });
  const to = h('input', { type: 'date' });
  await modal({
    title: 'WhatsApp-chat importeren', width: '560px',
    body: [
      h('p', { class: 'zacht' }, 'In WhatsApp: open de chat, kies Chat exporteren en dan Zonder media. Upload het .txt-bestand hier. Foto\'s uit de chat voeg je toe via Beeld.'),
      h('div', { class: 'veld' }, h('label', {}, 'Chatexport'), fileButton(file, 'Bestand kiezen', 'Nog geen bestand')),
      h('div', { class: 'rij' }, field('Vanaf (optioneel)', from), field('Tot en met (optioneel)', to)),
    ],
    buttons: [{ label: 'Annuleren' }, {
      label: 'Importeren', class: 'primair',
      action: async () => {
        if (!file.files[0]) { showError(new Error('Kies eerst het .txt-bestand van de chatexport.')); return undefined; }
        const fd = new FormData();
        fd.append('file', file.files[0]);
        if (from.value) fd.append('from', from.value);
        if (to.value) fd.append('to', to.value);
        try {
          const res = await api.post(`/clients/${clientId}/inputs/whatsapp`, fd);
          toast(`${res.count} WhatsApp-berichten geïmporteerd`);
          rerender();
          return true;
        } catch (err) {
          showError(err);
        }
      },
    }],
  });
}
