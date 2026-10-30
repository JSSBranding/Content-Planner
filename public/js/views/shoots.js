import { h, icon, busy, toast, showError, fmtDateTime, emptyState, copyText, page } from '../ui.js';
import { api, can } from '../api.js';
import { clientHeader } from './clients.js';

export async function shootsView({ clientId, tab, rerender }) {
  const [{ head }, shoots] = await Promise.all([clientHeader(clientId, tab), api.get(`/clients/${clientId}/shoots`)]);

  const generate = can('managePlans') ? h('button', {
    class: 'knop primair',
    onclick: async () => {
      try {
        const res = await busy('De AI bekijkt wat er aan beeld ontbreekt', () => api.post(`/clients/${clientId}/shoots`));
        toast(`${res.count} voorstellen toegevoegd`);
        rerender();
      } catch (err) {
        showError(err);
      }
    },
  }, icon('sparkle', { size: 16 }), 'Shoots laten voorstellen') : null;

  return page(head(generate),
    h('p', { class: 'zacht', style: { maxWidth: '640px', marginBottom: '18px' } }, 'Ideeën voor nieuwe foto- en video-opnames, op basis van de strategie, de pijlers en wat er in de beeldbibliotheek ontbreekt of al vaak gebruikt is.'),
    shoots.length ? h('div', { class: 'klantkaarten' }, shoots.map((s) => h('article', { class: 'klantkaart' },
      h('div', { class: 'kop' }, h('span', { class: 'initialen', style: { background: 'var(--turkoois)', color: 'var(--inkt)' } }, icon('camera', { size: 18 })), h('h2', {}, s.title)),
      h('p', { style: { whiteSpace: 'pre-wrap', margin: 0 } }, s.body),
      h('div', { class: 'knoppen', style: { marginTop: 'auto' } },
        h('span', { class: 'zacht' }, `${fmtDateTime(s.created_at)}${s.ai_source === 'voorbeeld' ? ', voorbeeld' : ''}`),
        h('button', { class: 'knop klein kaal', style: { marginLeft: 'auto' }, onclick: () => copyText(`${s.title}\n\n${s.body}`) }, icon('kopie', { size: 15 }), 'Kopiëren'),
        can('managePlans') ? h('button', {
          class: 'knop klein kaal icoonknop gevaar', title: 'Verwijderen', 'aria-label': 'Voorstel verwijderen',
          onclick: async () => { await api.del(`/shoots/${s.id}`); toast('Voorstel verwijderd'); rerender(); },
        }, icon('prullenbak', { size: 15 })) : null)))) : h('div', { class: 'paneelblok' }, emptyState('Nog geen voorstellen voor contentshoots.', generate?.cloneNode(true))),
  );
}
