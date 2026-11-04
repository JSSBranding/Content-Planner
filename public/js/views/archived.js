import { h, fill, icon, emptyState, pageHead, page, avatar, fmtDateTime } from '../ui.js';
import { api, can, channelLabel } from '../api.js';

// Gearchiveerde klanten: uit de zijbalk, maar met alle gegevens bewaard en altijd terug te zetten.
export async function archivedView() {
  const clients = (await api.get('/clients')).filter((c) => c.archived);
  const { toggleArchive } = await import('../app.js');
  const { confirmDeleteClient } = await import('./settings.js');

  const tbody = h('tbody');
  const search = h('input', { type: 'search', placeholder: 'Zoek klant', 'aria-label': 'Zoek gearchiveerde klant', oninput: () => draw() });

  const row = (c) => h('tr', {},
    h('td', {}, h('a', { class: 'klantnaam-cel', href: `#/klant/${c.id}/kalender` },
      avatar(c.name, c.avatar_url), h('strong', {}, c.name))),
    h('td', { class: 'zacht' }, c.channels.length ? c.channels.map(channelLabel).join(', ') : 'Geen kanalen'),
    h('td', { class: 'zacht' }, `${c.post_count ?? 0} post${c.post_count === 1 ? '' : 's'}`),
    h('td', { class: 'zacht' }, c.archived_at ? fmtDateTime(c.archived_at) : 'Onbekend'),
    h('td', { class: 'rechts' }, h('div', { class: 'knoppen eind' },
      h('a', { class: 'knop klein', href: `#/klant/${c.id}/kalender` }, 'Bekijken'),
      can('manageClients') ? h('button', { type: 'button', class: 'knop klein primair', onclick: () => toggleArchive(c) }, 'Weer actief maken') : null,
      can('manageClients') ? h('button', {
        type: 'button', class: 'knop klein kaal icoonknop', title: 'Definitief verwijderen', 'aria-label': `${c.name} definitief verwijderen`,
        onclick: () => confirmDeleteClient(c),
      }, icon('prullenbak', { size: 16 })) : null)));

  function draw() {
    const q = search.value.trim().toLowerCase();
    const shown = clients.filter((c) => !q || c.name.toLowerCase().includes(q));
    fill(tbody, shown.length ? shown.map(row) : h('tr', {}, h('td', { colspan: 5, class: 'zacht' }, `Geen gearchiveerde klant gevonden met "${search.value}".`)));
  }
  draw();

  return page(
    pageHead({
      title: 'Gearchiveerd',
      sub: clients.length
        ? `${clients.length} gearchiveerde klant${clients.length === 1 ? '' : 'en'}. Ze staan niet in de zijbalk, maar kalender, planningen, input en beeld zijn bewaard.`
        : 'Gearchiveerde klanten staan niet in de zijbalk, maar al hun gegevens blijven bewaard.',
    }),
    clients.length > 8 ? h('div', { class: 'filters' }, h('div', { class: 'zoekveld' }, icon('zoek', { size: 16 }), search)) : null,
    clients.length
      ? h('div', { class: 'tabel-wrap' }, h('table', { class: 'lijst archieflijst' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Klant'), h('th', {}, 'Kanalen'), h('th', {}, 'Kalender'), h('th', {}, 'Gearchiveerd op'), h('th', {}))),
        tbody))
      : emptyState('Er zijn geen gearchiveerde klanten. Archiveer een klant via de drie puntjes naast de naam; je vindt hem dan hier terug.'),
  );
}
