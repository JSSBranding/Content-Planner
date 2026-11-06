import { h, fill, icon, field, fileButton, toast, showError, busy, fmtDateTime, confirmDialog, mediaThumb, mediaPreview, modal } from '../ui.js';
import { api, can } from '../api.js';
import { uploadMedia } from './media.js';

const SOURCE = { handmatig: 'Handmatig', whatsapp: 'WhatsApp', email: 'E-mail', transcriptie: 'Opname of transcript', overig: 'Overig' };
const SOURCE_ICON = { whatsapp: 'whatsapp', transcriptie: 'geluid' };

// Klantinput: wat de klant aanlevert (tekst, opname-transcript, WhatsApp). De AI leest het uit en maakt er automatisch
// een conceptplanning van. Dit blok staat op het tabblad Input en planning, boven de planningen.
export function inputSection({ clientId, inputs, media, rerender }) {
  const editable = can('editContent');
  const open = inputs.filter((i) => !i.processed);
  const processed = inputs.filter((i) => i.processed);
  const mediaByInput = media.reduce((acc, m) => ((acc[m.client_input_id] ??= []).push(m), acc), {});
  let showProcessed = false;

  const item = (i) => {
    const files = mediaByInput[i.id] ?? [];
    const audio = files.filter((m) => m.kind === 'audio');
    const pics = files.filter((m) => m.kind !== 'audio');
    const el = h('article', { class: `input-item ${i.processed ? 'verwerkt' : ''}` },
      h('div', { class: 'meta' },
        h('span', { class: 'chip' }, icon(SOURCE_ICON[i.source] ?? 'inbox', { size: 13 }), SOURCE[i.source] ?? 'Input'),
        h('span', {}, fmtDateTime(i.created_at)),
        i.processed ? h('span', { class: 'chip ok' }, icon('vink', { size: 13 }), 'Verwerkt') : h('span', { class: 'chip turkoois' }, 'Nieuw')),
      i.title ? h('h3', {}, i.title) : null,
      h('div', { class: 'body' }, i.body),
      i.instructions ? h('p', { class: 'zacht', style: { marginTop: '8px', marginBottom: 0 } }, `Bijzonderheden: ${i.instructions}`) : null,
      audio.length ? h('div', { class: 'opnames' }, audio.map((m) => h('div', { class: 'opname' }, icon('geluid', { size: 14 }), h('span', { class: 'naam' }, m.filename), mediaPreview(m)))) : null,
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
            if (await confirmDialog('Input verwijderen?', 'Het bijbehorende beeld en de opname blijven in de bibliotheek staan.', { confirmLabel: 'Verwijderen', danger: true })) {
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
        h('p', { class: 'zacht', style: { margin: 0 } }, 'Alles wat de klant aanlevert. De AI leest het uit en maakt er automatisch een conceptplanning van; die beoordeel en keur je daarna goed.')),
      editable ? h('div', { class: 'knoppen' },
        h('button', { class: 'knop', onclick: () => addInput(clientId, rerender) }, icon('plus', { size: 16 }), 'Input toevoegen'),
        h('button', { class: 'knop', onclick: () => addInput(clientId, rerender, 'transcriptie') }, icon('geluid', { size: 16 }), 'Opname of transcript'),
        h('button', { class: 'knop', onclick: () => importWhatsApp(clientId, rerender) }, icon('whatsapp', { size: 16 }), 'WhatsApp uitlezen')) : null),
    list, toggle);
}

// Na het toevoegen van input: de AI maakt (of ververst) automatisch een conceptplanning.
async function afterInputAdded(clientId, rerender) {
  let res;
  try {
    res = await busy('De AI leest de input en maakt een conceptplanning', () => api.post(`/clients/${clientId}/auto-plan`));
  } catch (err) {
    showError(err); // input is wél opgeslagen; alleen het automatische voorstel mislukte
    return rerender();
  }
  if (res.plan) {
    toast(res.refreshed ? 'Conceptplanning bijgewerkt met de nieuwe input.' : 'De AI heeft een conceptplanning gemaakt. Beoordeel en keur hem goed.');
    location.hash = `#/klant/${clientId}/planning/${res.plan.id}`;
    return;
  }
  const uitleg = {
    'geen-kanalen': 'Input toegevoegd. Stel eerst de kanalen van deze klant in; dan maakt de AI automatisch een planning.',
    uit: 'Input toegevoegd. Automatische planning staat uit voor deze klant (aan te zetten op het klantprofiel).',
  }[res.skipped];
  toast(uitleg ?? 'Input toegevoegd.');
  rerender();
}

async function addInput(clientId, rerender, preset) {
  const transcript = preset === 'transcriptie';
  const title = h('input', { type: 'text', placeholder: transcript ? 'Bijv. Belafspraak met de klant, 6 november' : 'Bijv. Open dag zaterdag 14 november' });
  const body = h('textarea', { rows: transcript ? 8 : 6, placeholder: transcript ? 'Plak hier het transcript (bijv. uit Read AI, Fireflies of Teams). De AI leest het uit en haalt de contentideeën eruit.' : 'Informatie, teksten of steekwoorden van de klant' });
  const instructions = h('textarea', { rows: 2, placeholder: 'Bijv. niet vóór de 10e posten, naam van een collega niet noemen' });
  const source = h('select', { value: transcript ? 'transcriptie' : 'handmatig' }, ['handmatig', 'email', 'transcriptie', 'overig'].map((s) => h('option', { value: s }, SOURCE[s])));
  const files = h('input', { type: 'file', multiple: true, accept: transcript ? 'audio/*,video/*' : 'image/*,video/*,audio/*' });
  let createdId = null;
  await modal({
    title: transcript ? 'Opname of transcript toevoegen' : 'Klantinput toevoegen', width: '600px',
    body: [
      transcript ? h('p', { class: 'zacht', style: { marginTop: 0 } }, 'Plak het transcript van een gesprek. Een audio- of video-opname kun je als bijlage toevoegen; die wordt bewaard, maar de AI werkt met de transcripttekst.') : null,
      h('div', { class: 'rij' }, h('div', { class: 'veld', style: { flex: '2 1 200px' } }, h('label', {}, 'Titel'), title), field('Bron', source)),
      field(transcript ? 'Transcript' : 'Wat heeft de klant aangeleverd?', body),
      field('Bijzonderheden', instructions),
      can('manageMedia') ? h('div', { class: 'veld' }, h('label', {}, transcript ? 'Opname (audio of video, optioneel)' : 'Foto\'s, video\'s of opnames') , fileButton(files, 'Bestanden kiezen'), h('div', { class: 'hulp' }, transcript ? 'Komt bij Beeld, gekoppeld aan deze input.' : 'Komen bij Beeld, gekoppeld aan deze input.')) : null,
    ],
    buttons: [{ label: 'Annuleren' }, {
      label: 'Toevoegen', class: 'primair',
      action: async () => {
        if (!body.value.trim()) { showError(new Error(transcript ? 'Plak eerst het transcript.' : 'Vul in wat de klant heeft aangeleverd.')); return undefined; }
        try {
          const { id } = await api.post(`/clients/${clientId}/inputs`, { title: title.value, body: body.value, instructions: instructions.value, source: source.value });
          if (files.files.length) await uploadMedia(clientId, files.files, id);
          createdId = id;
          return true;
        } catch (err) {
          showError(err);
        }
      },
    }],
  });
  if (createdId) await afterInputAdded(clientId, rerender);
}

async function importWhatsApp(clientId, rerender) {
  const file = h('input', { type: 'file', accept: '.txt,text/plain' });
  const from = h('input', { type: 'date' });
  const to = h('input', { type: 'date' });
  let imported = false;
  await modal({
    title: 'WhatsApp-chat uitlezen', width: '560px',
    body: [
      h('p', { class: 'zacht' }, 'In WhatsApp: open de chat met de klant, kies Chat exporteren en dan Zonder media. Upload het .txt-bestand hier. De AI leest de chat uit en maakt er een conceptplanning van. Foto\'s uit de chat voeg je toe via Beeld.'),
      h('div', { class: 'veld' }, h('label', {}, 'Chatexport'), fileButton(file, 'Bestand kiezen', 'Nog geen bestand')),
      h('div', { class: 'rij' }, field('Vanaf (optioneel)', from), field('Tot en met (optioneel)', to)),
    ],
    buttons: [{ label: 'Annuleren' }, {
      label: 'Uitlezen', class: 'primair',
      action: async () => {
        if (!file.files[0]) { showError(new Error('Kies eerst het .txt-bestand van de chatexport.')); return undefined; }
        const fd = new FormData();
        fd.append('file', file.files[0]);
        if (from.value) fd.append('from', from.value);
        if (to.value) fd.append('to', to.value);
        try {
          const res = await api.post(`/clients/${clientId}/inputs/whatsapp`, fd);
          toast(`${res.count} WhatsApp-berichten ingelezen`);
          imported = true;
          return true;
        } catch (err) {
          showError(err);
        }
      },
    }],
  });
  if (imported) await afterInputAdded(clientId, rerender);
}
