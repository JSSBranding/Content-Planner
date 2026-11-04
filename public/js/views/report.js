import { h, fill, icon, pageHead, page, avatar, fmtMonth, isoDate, shiftMonth, downloadUrl, emptyState } from '../ui.js';
import { api, can, channelLabel } from '../api.js';

// Afspraak tegenover geleverd: per klant hoeveel posts er deze maand zijn afgesproken, in de kalender staan en volledig zijn ingepland.
export async function reportView({ query }) {
  if (!can('manageClients')) throw Object.assign(new Error('Alleen social media managers en Chefkes zien de afspraken per klant.'), { status: 403 });
  const month = /^\d{4}-\d{2}$/.test(query.get('maand') ?? '') ? query.get('maand') : isoDate(new Date()).slice(0, 7);
  const { rows } = await api.get(`/rapportage?maand=${month}`);
  let onlySetUp = query.get('alle') !== '1';
  const go = (ym) => { location.hash = `#/afspraken?maand=${ym}`; };

  const tbody = h('tbody');
  const tfoot = h('tfoot');
  function draw() {
    const shown = rows.filter((r) => !onlySetUp || r.expected > 0);
    const sum = (k) => shown.reduce((n, r) => n + r[k], 0);
    fill(tbody, shown.length ? shown.map((r) => {
      const pct = r.percentage ?? 0;
      return h('tr', {},
        h('td', {}, h('a', { class: 'klantnaam-cel', href: `#/klant/${r.client_id}/kalender?maand=${month}` }, avatar(r.name, r.avatar_url), h('strong', {}, r.name))),
        h('td', { class: 'zacht' }, r.channels.length ? `${r.posts_per_week} per week op ${r.channels.map(channelLabel).join(', ')}` : 'Nog niet ingericht'),
        h('td', { class: 'getal' }, r.expected),
        h('td', { class: 'getal' }, r.planned),
        h('td', { class: 'getal' }, r.done),
        h('td', { class: 'getal' }, r.open ? h('span', { class: 'chip let-op' }, r.open) : h('span', { class: 'chip ok' }, icon('vink', { size: 12 }), '0')),
        h('td', { class: 'voortgang' }, r.percentage == null ? h('span', { class: 'zacht' }, '–') : [
          h('span', { class: 'spoor' }, h('span', { class: `vulling ${pct >= 100 ? 'klaar' : ''}`, style: { width: `${Math.min(100, pct)}%` } })),
          h('span', { class: 'getal' }, `${pct}%`)]));
    }) : h('tr', {}, h('td', { colspan: 7 }, emptyState('Geen klanten met kanalen en frequentie. Vul ze in bij Klanten inrichten.'))));
    const total = sum('expected');
    fill(tfoot, shown.length ? h('tr', {},
      h('td', {}, h('strong', {}, 'Totaal')), h('td', {}),
      h('td', { class: 'getal' }, total), h('td', { class: 'getal' }, sum('planned')), h('td', { class: 'getal' }, sum('done')),
      h('td', { class: 'getal' }, sum('open')),
      h('td', { class: 'voortgang' }, total ? `${Math.round((sum('done') / total) * 100)}%` : '–')) : null);
  }
  draw();

  return page(
    pageHead({
      title: 'Afspraken',
      sub: 'Per klant: hoeveel posts er zijn afgesproken, hoeveel er in de kalender staan en hoeveel er volledig zijn ingepland. Handig voor de facturatie.',
      actions: h('button', { class: 'knop', type: 'button', onclick: () => downloadUrl(`/api/rapportage.xlsx?maand=${month}`, `Afspraken_${month}.xlsx`) }, icon('excel', { size: 16 }), 'Excel'),
    }),
    h('div', { class: 'kalenderbalk' },
      h('div', { class: 'maandkiezer' },
        h('button', { type: 'button', 'aria-label': 'Vorige maand', onclick: () => go(shiftMonth(month, -1)) }, icon('links')),
        h('span', { class: 'maand' }, fmtMonth(`${month}-01`)),
        h('button', { type: 'button', 'aria-label': 'Volgende maand', onclick: () => go(shiftMonth(month, 1)) }, icon('rechts'))),
      month !== isoDate(new Date()).slice(0, 7) ? h('button', { class: 'knop', type: 'button', onclick: () => go(isoDate(new Date()).slice(0, 7)) }, 'Deze maand') : null,
      h('label', { class: 'vinkje klein-vinkje', style: { marginLeft: 'auto' } },
        h('input', { type: 'checkbox', checked: onlySetUp, onchange: (e) => { onlySetUp = e.target.checked; draw(); } }), 'Alleen ingerichte klanten')),
    h('div', { class: 'tabel-wrap' }, h('table', { class: 'lijst rapport' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Klant'), h('th', {}, 'Afspraak'),
        h('th', { class: 'getal', title: 'Posts per week × aantal kanalen × dagen in de maand / 7' }, 'Afgesproken'),
        h('th', { class: 'getal', title: 'Alle posts in de kalender, ongeacht de status' }, 'In kalender'),
        h('th', { class: 'getal', title: 'Status Volledig ingepland of Advertising ingepland' }, 'Ingepland'),
        h('th', { class: 'getal' }, 'Nog te doen'), h('th', {}, 'Voortgang'))),
      tbody, tfoot)),
    h('p', { class: 'zacht', style: { marginTop: '12px' } },
      'Afgesproken = posts per week × aantal kanalen × dagen in de maand / 7, afgerond. Ingepland = status Volledig ingepland of Advertising ingepland.'));
}
