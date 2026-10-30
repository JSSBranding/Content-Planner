import { h, icon, emptyState, pageHead, page, initials } from '../ui.js';
import { api, can, meta, channelLabel } from '../api.js';
import { clientForm } from './settings.js';

export async function clientsView({ query }) {
  const clients = await api.get('/clients');
  const active = clients.filter((c) => !c.archived);
  const archived = clients.filter((c) => c.archived);
  const newOpen = query.get('nieuw') === '1' && can('manageClients');

  const newButton = can('manageClients') && !newOpen
    ? h('a', { class: 'knop primair', href: '#/?nieuw=1' }, icon('plus', { size: 16 }), 'Nieuwe klant')
    : null;

  // Per klant: wat vraagt nu aandacht?
  const todos = (c) => [
    c.open_plans ? `${c.open_plans} conceptplanning${c.open_plans > 1 ? 'en' : ''} wacht${c.open_plans > 1 ? 'en' : ''} op beoordeling` : null,
    c.open_inputs ? `${c.open_inputs} nieuwe klantinput` : null,
    c.action_needed ? `${c.action_needed} post${c.action_needed > 1 ? 's' : ''} met actie nodig` : null,
  ].filter(Boolean);

  const card = (c) => {
    const list = todos(c);
    return h('a', { class: 'klantkaart', href: `#/klant/${c.id}/kalender` },
      h('div', { class: 'kop' }, h('span', { class: 'initialen' }, initials(c.name)),
        h('div', {}, h('h2', {}, c.name),
          h('div', { class: 'zacht' }, `${c.posts_per_week} posts per week op ${c.channels.map(channelLabel).join(', ') || 'nog geen kanalen'}`))),
      h('div', { class: 'todo' }, list.length
        ? list.map((t) => h('div', {}, h('span', { class: 'stip' }), t))
        : h('div', { class: 'rustig' }, 'Niets openstaand')));
  };

  const form = newOpen ? h('div', { class: 'paneelblok sectie' }, h('h2', {}, 'Nieuwe klant'),
    h('p', { class: 'zacht' }, 'Begin met naam, kanalen en frequentie. Strategie en AI-geheugen kun je later aanvullen.'),
    clientForm({ client: null, onSaved: (c) => { location.hash = `#/klant/${c.id}/kalender`; }, onCancel: () => { location.hash = '#/'; } })) : null;

  const totalPlans = active.reduce((n, c) => n + c.open_plans, 0);
  return page(
    pageHead({
      title: `Goedendag, ${meta.user.name.split(' ')[0]}`,
      sub: totalPlans ? `${totalPlans} conceptplanning${totalPlans > 1 ? 'en' : ''} wacht${totalPlans > 1 ? 'en' : ''} op beoordeling.` : 'Alle conceptplanningen zijn beoordeeld.',
      actions: newButton,
    }),
    form,
    active.length ? h('div', { class: 'klantkaarten sectie' }, active.map(card))
      : !newOpen ? emptyState('Nog geen klanten. Voeg je eerste klant toe om te beginnen.', newButton) : null,
    archived.length ? h('details', { class: 'uitklap' }, h('summary', { class: 'zacht' }, `Gearchiveerde klanten (${archived.length})`),
      h('div', { class: 'klantkaarten' }, archived.map(card))) : null,
  );
}

const TABS = [
  ['kalender', 'Contentkalender', 'kalender'],
  ['planning', 'Conceptplanning', 'planning'],
  ['input', 'Klantinput', 'inbox'],
  ['media', 'Beeld', 'beeld'],
  ['shoots', 'Contentshoots', 'camera'],
  ['instellingen', 'Klantprofiel', 'profiel'],
];

// Kop met klantnaam, acties en tabbladen boven elk klantscherm.
export async function clientHeader(clientId, tab) {
  const client = await api.get(`/clients/${clientId}`);
  const counts = { planning: client.open_plans, input: client.open_inputs };
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Onderdelen' }, TABS.map(([key, label, ic]) =>
    h('a', { href: `#/klant/${clientId}/${key}`, class: tab === key ? 'actief' : '', 'aria-current': tab === key ? 'page' : null },
      icon(ic, { size: 16 }), label, counts[key] ? h('span', { class: 'teller' }, counts[key]) : null)));
  return {
    client,
    head: (actions) => pageHead({
      title: client.name,
      sub: `${client.posts_per_week} posts per week op ${client.channels.map(channelLabel).join(', ') || 'nog geen kanalen'}`,
      actions,
      tabs,
    }),
  };
}
