import { h, fill, icon, toast, showError, fmtSize, fmtDate, mediaPreview, modal, confirmDialog, emptyState, busy, page } from '../ui.js';
import { api, can } from '../api.js';
import { clientHeader } from './clients.js';

export async function uploadMedia(clientId, fileList, clientInputId) {
  const fd = new FormData();
  for (const f of fileList) fd.append('files', f);
  if (clientInputId) fd.append('client_input_id', clientInputId);
  const res = await busy(`${fileList.length} bestand${fileList.length === 1 ? '' : 'en'} uploaden`, () => api.post(`/clients/${clientId}/media`, fd));
  const skipped = fileList.length - res.ids.length;
  toast(`${res.ids.length} bestand${res.ids.length === 1 ? '' : 'en'} toegevoegd${skipped ? `, ${skipped} overgeslagen (geen foto of video)` : ''}`);
  return res.ids;
}

// Zoeken en filteren; gedeeld door de bibliotheek en de beeldkiezer.
function mediaFilters(onChange) {
  const search = h('input', { type: 'search', placeholder: 'Zoek op naam, beschrijving of tag', 'aria-label': 'Zoeken', oninput: onChange });
  const kind = h('select', { onchange: onChange, 'aria-label': 'Soort' }, h('option', { value: '' }, 'Foto\'s en video\'s'), h('option', { value: 'foto' }, 'Alleen foto\'s'), h('option', { value: 'video' }, 'Alleen video\'s'));
  const usage = h('select', { onchange: onChange, 'aria-label': 'Gebruik' }, h('option', { value: '' }, 'Alles'), h('option', { value: 'nieuw' }, 'Nog niet gebruikt'), h('option', { value: 'gebruikt' }, 'Al gebruikt'));
  const apply = (list) => {
    const q = search.value.trim().toLowerCase();
    return list.filter((m) => (!kind.value || m.kind === kind.value)
      && (!usage.value || (usage.value === 'nieuw' ? m.times_used === 0 : m.times_used > 0))
      && (!q || [m.filename, m.description, ...m.tags].join(' ').toLowerCase().includes(q)));
  };
  return { el: [h('div', { class: 'zoekveld' }, icon('zoek', { size: 16 }), search), kind, usage], apply };
}

const usedLabel = (m) => (m.times_used ? `${m.times_used}× gebruikt, laatst ${fmtDate(m.last_used_on)}` : 'Nog niet gebruikt');
const kindBadge = (m) => (m.kind === 'video' ? h('span', { class: 'soort' }, icon('video', { size: 12 }), 'Video') : null);

/** Beeldkiezer: geeft de gekozen media-id's terug (in volgorde van klikken), of null bij annuleren. */
export async function pickMedia(clientId, { selected = [], title = 'Beeld kiezen' } = {}) {
  let media = await api.get(`/clients/${clientId}/media`);
  const chosen = [...selected];
  const grid = h('div', { class: 'beeldlijst' });
  const filters = mediaFilters(() => draw());
  const upload = can('manageMedia') ? h('input', {
    type: 'file', multiple: true, accept: 'image/*,video/*', hidden: true,
    onchange: async (e) => {
      try {
        const ids = await uploadMedia(clientId, e.target.files);
        chosen.push(...ids);
        media = await api.get(`/clients/${clientId}/media`);
        draw();
      } catch (err) {
        showError(err);
      }
    },
  }) : null;

  function draw() {
    const list = filters.apply(media);
    fill(grid, list.length ? list.map((m) => {
      const n = chosen.indexOf(m.id);
      return h('div', {
        class: `beeld kiesbaar ${n >= 0 ? 'gekozen' : ''}`, role: 'button', tabIndex: 0, 'aria-pressed': String(n >= 0), 'aria-label': m.filename,
        onclick: () => toggle(m.id),
        onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle(m.id)),
      }, h('div', { class: 'voorbeeld' }, mediaPreview(m), kindBadge(m), n >= 0 ? h('span', { class: 'keuzenr' }, n + 1) : null),
      h('div', { class: 'info' }, h('div', { class: 'naam' }, m.filename), h('div', { class: 'zacht' }, usedLabel(m))));
    }) : emptyState(media.length ? 'Geen beeld gevonden met deze filters.' : 'Er is nog geen beeld voor deze klant. Upload hier foto\'s of video\'s.'));
  }
  function toggle(id) {
    const i = chosen.indexOf(id);
    if (i >= 0) chosen.splice(i, 1);
    else chosen.push(id);
    draw();
  }
  draw();

  return modal({
    title, width: '940px',
    body: [h('div', { class: 'filters' }, filters.el, upload ? h('label', { class: 'knop', style: { marginLeft: 'auto', marginBottom: 0 } }, icon('upload', { size: 16 }), 'Uploaden', upload) : null), grid],
    buttons: [{ label: 'Annuleren' }, { label: 'Gebruik selectie', class: 'primair', action: () => chosen }],
  });
}

export async function mediaView({ clientId, tab, rerender }) {
  const [{ head }, media] = await Promise.all([clientHeader(clientId, tab), api.get(`/clients/${clientId}/media`)]);
  const editable = can('manageMedia');
  const grid = h('div', { class: 'beeldlijst', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' } });
  const filters = mediaFilters(() => draw());
  const counter = h('span', { class: 'teller' });

  function draw() {
    const list = filters.apply(media);
    counter.textContent = `${list.length} van ${media.length}`;
    fill(grid, list.length ? list.map(card) : emptyState(media.length ? 'Geen bestanden gevonden met deze filters.' : 'Nog geen beeld. Sleep de foto\'s en video\'s van de klant hierheen.'));
  }

  function card(m) {
    const privacy = m.has_recognizable_faces === 1
      ? h('span', { class: `chip ${m.ai_processing_allowed ? 'ok' : 'let-op'}` }, icon('slot', { size: 12 }), m.ai_processing_allowed ? 'Gezichten, toestemming' : 'Gezichten, niet voor AI')
      : null;
    return h('div', { class: 'beeld' },
      h('div', { class: 'voorbeeld' }, mediaPreview(m), kindBadge(m)),
      h('div', { class: 'info' },
        h('div', { class: 'naam', title: m.filename }, m.filename),
        h('div', { class: 'zacht' }, `${fmtSize(m.size_bytes)}, ${usedLabel(m).toLowerCase()}`),
        m.description ? h('div', { style: { marginTop: '4px' } }, m.description) : null,
        m.tags.length || privacy ? h('div', { class: 'knoppen', style: { gap: '4px', marginTop: '6px' } }, m.tags.map((t) => h('span', { class: 'chip' }, t)), privacy) : null),
      h('div', { class: 'acties' },
        h('a', { class: 'knop klein kaal', href: m.download_url, download: m.filename }, icon('download', { size: 15 }), 'Download'),
        editable ? h('button', { class: 'knop klein kaal', onclick: () => editMedia(m) }, icon('bewerk', { size: 15 }), 'Gegevens') : null,
        editable ? h('button', {
          class: 'knop klein kaal icoonknop gevaar', title: 'Verwijderen', 'aria-label': `${m.filename} verwijderen`, style: { marginLeft: 'auto' },
          onclick: async () => {
            if (!(await confirmDialog('Bestand verwijderen?', `${m.filename} wordt definitief verwijderd.`, { confirmLabel: 'Verwijderen', danger: true }))) return;
            try { await api.del(`/media/${m.id}`); toast('Bestand verwijderd'); rerender(); } catch (err) { showError(err); }
          },
        }, icon('prullenbak', { size: 15 })) : null));
  }

  async function editMedia(m) {
    const description = h('textarea', { rows: 3, value: m.description, placeholder: 'Bijv. Jan haalt brood uit de nieuwe oven' });
    const tags = h('input', { type: 'text', value: m.tags.join(', '), placeholder: 'oven, brood, team' });
    const faces = h('select', { value: m.has_recognizable_faces == null ? '' : String(m.has_recognizable_faces) },
      h('option', { value: '' }, 'Nog niet beoordeeld'), h('option', { value: '0' }, 'Nee'), h('option', { value: '1' }, 'Ja'));
    const allowed = h('input', { type: 'checkbox', checked: Boolean(m.ai_processing_allowed) });
    const allowedRow = h('label', { class: 'vinkje' }, allowed, 'Er is toestemming om dit beeld met AI te verwerken');
    const sync = () => { allowedRow.hidden = faces.value !== '1'; };
    faces.addEventListener('change', sync);
    sync();
    await modal({
      title: 'Gegevens van het beeld',
      body: [
        h('p', { class: 'zacht' }, m.filename),
        h('div', { class: 'veld' }, h('label', {}, 'Beschrijving'), description, h('div', { class: 'hulp' }, 'Helpt de AI passend beeld voor te stellen. De AI ziet alleen deze tekst, nooit het beeld zelf.')),
        h('div', { class: 'veld' }, h('label', {}, 'Tags'), tags, h('div', { class: 'hulp' }, 'Gescheiden door komma\'s.')),
        h('div', { class: 'veld' }, h('label', {}, 'Staan er herkenbare gezichten op?'), faces),
        allowedRow,
      ],
      buttons: [{ label: 'Annuleren' }, {
        label: 'Opslaan', class: 'primair',
        action: async () => {
          try {
            await api.patch(`/media/${m.id}`, {
              description: description.value,
              tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean),
              has_recognizable_faces: faces.value === '' ? null : faces.value === '1',
              ai_processing_allowed: faces.value === '1' && allowed.checked,
            });
            toast('Gegevens opgeslagen');
            rerender();
            return true;
          } catch (err) {
            showError(err);
          }
        },
      }],
    });
  }

  async function upload(files) {
    if (!files.length) return;
    try {
      await uploadMedia(clientId, files);
      rerender();
    } catch (err) {
      showError(err);
    }
  }
  const fileInput = h('input', { type: 'file', multiple: true, accept: 'image/*,video/*', hidden: true, onchange: (e) => upload(e.target.files) });
  const uploadButton = editable ? h('label', { class: 'knop primair', style: { marginBottom: 0 } }, icon('upload', { size: 16 }), 'Beeld uploaden', fileInput) : null;
  const drop = editable ? h('div', {
    class: 'dropzone',
    ondragover: (e) => { e.preventDefault(); drop.classList.add('erboven'); },
    ondragleave: () => drop.classList.remove('erboven'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('erboven'); upload(e.dataTransfer.files); },
  }, icon('upload', { size: 22 }),
  h('div', { class: 'tekst' }, h('strong', {}, 'Sleep foto\'s en video\'s van de klant hierheen'), h('span', { class: 'zacht' }, 'Alleen originele bestanden. Vormgeving gebeurt buiten de app.'))) : null;

  draw();
  return page(head(uploadButton), drop, h('div', { class: 'filters' }, filters.el, counter), grid);
}
