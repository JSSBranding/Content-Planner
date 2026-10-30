import { h, busy, toast, showError, fmtDateTime, emptyState, copyText } from '../ui.js';
import { api, can } from '../api.js';
import { clientHeader } from './clients.js';

export async function shootsView({ clientId, tab, rerender }) {
  const [{ header }, shoots] = await Promise.all([clientHeader(clientId, tab), api.get(`/clients/${clientId}/shoots`)]);

  const generate = can('managePlans') ? h('button', {
    class: 'knop primair',
    onclick: async () => {
      try {
        const res = await busy('De AI bekijkt de mediabibliotheek en stelt contentshoots voor…', () => api.post(`/clients/${clientId}/shoots`));
        toast(`${res.count} voorstellen toegevoegd.`);
        rerender();
      } catch (err) {
        showError(err);
      }
    },
  }, 'Contentshoots laten voorstellen') : null;

  return [
    ...header,
    h('div', { class: 'klantkop' },
      h('p', { class: 'zacht', style: { margin: 0, maxWidth: '640px' } }, 'Voorstellen voor nieuwe foto- en video-opnames, op basis van de strategie, de pijlers en wat er in de mediabibliotheek ontbreekt of al vaak gebruikt is.'),
      h('div', { style: { marginLeft: 'auto' } }, generate)),
    shoots.length ? h('div', { class: 'kaarten' }, shoots.map((s) => h('div', { class: 'kaart' },
      h('h3', {}, s.title),
      h('p', { style: { whiteSpace: 'pre-wrap' } }, s.body),
      h('div', { class: 'knoppen' },
        h('span', { class: 'zacht' }, fmtDateTime(s.created_at), s.ai_source === 'voorbeeld' ? ' · voorbeeld' : ''),
        h('button', { class: 'knop klein', style: { marginLeft: 'auto' }, onclick: () => copyText(`${s.title}\n\n${s.body}`) }, 'Kopiëren'),
        can('managePlans') ? h('button', {
          class: 'knop klein gevaar',
          onclick: async () => { await api.del(`/shoots/${s.id}`); rerender(); },
        }, 'Verwijderen') : null)))) : emptyState('Nog geen contentshoot-voorstellen.'),
  ];
}
