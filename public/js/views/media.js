import { h, fill, toast, showError, fmtSize, fmtDate, mediaPreview, modal, confirmDialog, emptyState, busy } from '../ui.js';
import { api, can } from '../api.js';
import { clientHeader } from './clients.js';

export async function uploadMedia(clientId, fileList, clientInputId) {
  const fd = new FormData();
  for (const f of fileList) fd.append('files', f);
  if (clientInputId) fd.append('client_input_id', clientInputId);
  const res = await busy(`${fileList.length} bestand(en) uploaden…`, () => api.post(`/clients/${clientId}/media`, fd));
  const skipped = fileList.length - res.ids.length;
  toast(`${res.ids.length} bestand(en) geüpload${skipped ? `; ${skipped} overgeslagen (geen foto of video)` : ''}.`);
  return res.ids;
}

// Filterbaar raster van media. Gedeeld door de bibliotheek en de beeldkiezer.
function mediaFilters(onChange) {
  const search = h('input', { type: 'search', placeholder: 'Zoek op bestandsnaam, beschrijving of tag…', oninput: onChange });
  const kind = h('select', { onchange: onChange }, h('option', { value: '' }, 'Foto\'s en video\'s'), h('option', { value: 'foto' }, 'Alleen foto\'s'), h('option', { value: 'video' }, 'Alleen video\'s'));
  const usage = h('select', { onchange: onChange }, h('option', { value: '' }, 'Gebruikt en ongebruikt'), h('option', { value: 'nieuw' }, 'Nog niet gebruikt'), h('option', { value: 'gebruikt' }, 'Eerder gebruikt'));
  const apply = (list) => {
    const q = search.value.trim().toLowerCase();
    return list.filter((m) => (!kind.value || m.kind === kind.value)
      && (!usage.value || (usage.value === 'nieuw' ? m.times_used === 0 : m.times_used > 0))
      && (!q || [m.filename, m.description, ...m.tags].join(' ').toLowerCase().includes(q)));
  };
  return { el: h('div', { class: 'filters' }, search, kind, usage), apply };
}

const usedLabel = (m) => (m.times_used ? `${m.times_used}× gebruikt${m.last_used_on ? `, laatst ${fmtDate(m.last_used_on)}` : ''}` : 'Nog niet gebruikt');

/** Beeldkiezer: geeft de gekozen media-id's terug (in volgorde van klikken), of null bij annuleren. */
export async function pickMedia(clientId, { selected = [], title = 'Beeld kiezen' } = {}) {
  let media = await api.get(`/clients/${clientId}/media`);
  const chosen = [...selected];
  const grid = h('div', { class: 'beeldlijst' });
  const filters = mediaFilters(() => draw());
  const upload = can('editContent') ? h('input', {
    type: 'file', multiple: true, accept: 'image/*,video/*',
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
    fill(grid, ...(list.length ? list.map((m) => h('div', {
      class: `beeld ${chosen.includes(m.id) ? 'gekozen' : ''}`, role: 'button', tabIndex: 0, 'aria-pressed': String(chosen.includes(m.id)),
      onclick: () => toggle(m.id),
      onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle(m.id)),
    }, h('div', { class: 'voorbeeld' }, mediaPreview(m)),
    h('div', { class: 'info' }, h('div', { class: 'naam' }, chosen.includes(m.id) ? `✓ ${chosen.indexOf(m.id) + 1}. ` : '', m.filename),
      h('div', { class: 'zacht' }, usedLabel(m))))) : [emptyState('Geen beeld gevonden.')]));
  }
  function toggle(id) {
    const i = chosen.indexOf(id);
    if (i >= 0) chosen.splice(i, 1);
    else chosen.push(id);
    draw();
  }
  draw();

  return modal({
    title, width: '920px',
    body: [h('div', { class: 'knoppen', style: { marginBottom: '12px' } }, filters.el, upload ? h('label', { class: 'knop' }, 'Uploaden…', Object.assign(upload, { hidden: true })) : null), grid],
    buttons: [{ label: 'Annuleren' }, { label: 'Selectie gebruiken', class: 'primair', action: () => chosen }],
  });
}

export async function mediaView({ clientId, tab, rerender }) {
  const [{ header }, media] = await Promise.all([clientHeader(clientId, tab), api.get(`/clients/${clientId}/media`)]);
  const editable = can('editContent');
  const grid = h('div', { class: 'beeldlijst', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' } });
  const filters = mediaFilters(() => draw());
  const counter = h('span', { class: 'zacht' });

  function draw() {
    const list = filters.apply(media);
    counter.textContent = `${list.length} van ${media.length} bestanden`;
    fill(grid, ...(list.length ? list.map(card) : [emptyState(media.length ? 'Geen bestanden gevonden met deze filters.' : 'De mediabibliotheek is nog leeg.')]));
  }

  function card(m) {
    const facesLabel = m.has_recognizable_faces === 1 ? (m.ai_processing_allowed ? '🙂 Gezichten · AI toegestaan' : '🙂 Gezichten · niet voor AI') : m.has_recognizable_faces === 0 ? 'Geen herkenbare gezichten' : 'Gezichten: niet beoordeeld';
    return h('div', { class: 'beeld' },
      h('div', { class: 'voorbeeld' }, mediaPreview(m)),
      h('div', { class: 'info' },
        h('div', { class: 'naam', title: m.filename }, m.filename),
        h('div', { class: 'zacht' }, `${m.kind === 'video' ? 'Video' : 'Foto'} · ${fmtSize(m.size_bytes)}`),
        h('div', { class: 'zacht' }, usedLabel(m)),
        m.description ? h('div', {}, m.description) : null,
        m.tags.length ? h('div', { class: 'zacht' }, m.tags.map((t) => `#${t}`).join(' ')) : null,
        h('div', { class: 'zacht' }, facesLabel)),
      h('div', { class: 'acties' },
        h('a', { class: 'knop klein kaal', href: m.download_url, download: '' }, 'Download'),
        editable ? h('button', { class: 'knop klein kaal', onclick: () => editMedia(m) }, 'Gegevens') : null,
        editable ? h('button', {
          class: 'knop klein kaal gevaar',
          onclick: async () => {
            if (!(await confirmDialog('Bestand verwijderen?', `"${m.filename}" wordt definitief verwijderd.`, { confirmLabel: 'Verwijderen', danger: true }))) return;
            try { await api.del(`/media/${m.id}`); rerender(); } catch (err) { showError(err); }
          },
        }, 'Verwijderen') : null));
  }

  async function editMedia(m) {
    const description = h('textarea', { rows: 3, value: m.description });
    const tags = h('input', { type: 'text', value: m.tags.join(', ') });
    const faces = h('select', { value: m.has_recognizable_faces == null ? '' : String(m.has_recognizable_faces) },
      h('option', { value: '' }, 'Nog niet beoordeeld'), h('option', { value: '0' }, 'Nee'), h('option', { value: '1' }, 'Ja'));
    const allowed = h('input', { type: 'checkbox', checked: Boolean(m.ai_processing_allowed) });
    const allowedRow = h('label', { class: 'vinkje' }, allowed, 'Er is toestemming om dit beeld met AI te verwerken');
    const sync = () => { allowedRow.hidden = faces.value !== '1'; };
    faces.addEventListener('change', sync);
    sync();
    await modal({
      title: m.filename,
      body: [
        h('div', { class: 'veld' }, h('label', {}, 'Beschrijving'), description, h('div', { class: 'hulp' }, 'Helpt de AI om passend beeld voor te stellen. De AI ziet alleen deze tekst, nooit het beeld zelf.')),
        h('div', { class: 'veld' }, h('label', {}, 'Tags (komma-gescheiden)'), tags),
        h('div', { class: 'veld' }, h('label', {}, 'Herkenbare gezichten op dit beeld?'), faces),
        allowedRow,
        h('p', { class: 'zacht', style: { marginTop: '8px' } }, 'Beeld met herkenbare gezichten zonder toestemming wordt niet aan de AI aangeboden.'),
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
            rerender();
            return true;
          } catch (err) {
            showError(err);
          }
        },
      }],
    });
  }

  const input = h('input', { type: 'file', multiple: true, accept: 'image/*,video/*', hidden: true, onchange: (e) => upload(e.target.files) });
  async function upload(files) {
    if (!files.length) return;
    try {
      await uploadMedia(clientId, files);
      rerender();
    } catch (err) {
      showError(err);
    }
  }
  const drop = editable ? h('div', {
    class: 'dropzone sectie',
    ondragover: (e) => { e.preventDefault(); drop.classList.add('erboven'); },
    ondragleave: () => drop.classList.remove('erboven'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('erboven'); upload(e.dataTransfer.files); },
  }, h('p', {}, 'Sleep foto\'s en video\'s van de klant hierheen'), h('label', { class: 'knop primair' }, 'Bestanden kiezen', input)) : null;

  draw();
  return [...header, drop, h('div', { class: 'knoppen', style: { justifyContent: 'space-between' } }, filters.el, counter), grid];
}
