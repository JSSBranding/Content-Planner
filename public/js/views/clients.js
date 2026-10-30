import { h, fill, emptyState } from '../ui.js';
import { api, can, channelLabel, statusStyle } from '../api.js';
import { clientForm } from './settings.js';

export async function clientsView({ rerender }) {
  const clients = await api.get('/clients');
  const active = clients.filter((c) => !c.archived);
  const archived = clients.filter((c) => c.archived);

  const newButton = can('manageClients')
    ? h('button', { class: 'knop primair', onclick: () => openNew() }, '+ Nieuwe klant')
    : null;
  const formHost = h('div');

  function openNew() {
    fill(formHost, h('div', { class: 'kaart sectie' }, h('h2', {}, 'Nieuwe klant'),
      clientForm({ client: null, onSaved: (c) => { location.hash = `#/klant/${c.id}/instellingen`; }, onCancel: () => fill(formHost) })));
  }

  const card = (c) => h('a', { class: 'kaart', href: `#/klant/${c.id}/kalender`, style: { textDecoration: 'none', display: 'block' } },
    h('h2', {}, c.name),
    h('p', { class: 'zacht' }, c.channels.map(channelLabel).join(' · ') || 'Nog geen kanalen ingesteld', ` — ${c.posts_per_week} posts per week`),
    h('div', { class: 'knoppen' },
      c.open_inputs ? h('span', { class: 'chip' }, `${c.open_inputs} nieuwe input`) : null,
      c.open_plans ? h('span', { class: 'chip' }, `${c.open_plans} conceptplanning${c.open_plans > 1 ? 'en' : ''} open`) : null,
      c.action_needed ? h('span', { class: 'status', style: statusStyle('placeholder_actie_nodig') }, `${c.action_needed} × actie nodig`) : null));

  return [
    h('div', { class: 'klantkop' }, h('h1', {}, 'Klanten'), h('div', { style: { marginLeft: 'auto' } }, newButton)),
    formHost,
    active.length ? h('div', { class: 'kaarten sectie' }, active.map(card)) : emptyState('Er zijn nog geen klanten.', newButton?.cloneNode(true)),
    archived.length ? h('details', {}, h('summary', { class: 'zacht' }, `Gearchiveerde klanten (${archived.length})`),
      h('div', { class: 'kaarten', style: { marginTop: '12px' } }, archived.map(card))) : null,
  ];
}

// Kop en tabbladen boven elk klantscherm.
export async function clientHeader(clientId, tab) {
  const client = await api.get(`/clients/${clientId}`);
  const t = (key, label) => h('a', { href: `#/klant/${clientId}/${key}`, class: tab === key ? 'actief' : '' }, label);
  return {
    client,
    header: [
      h('div', { class: 'klantkop' },
        h('div', {}, h('a', { href: '#/', class: 'zacht', style: { textDecoration: 'none' } }, '← Klanten'), h('h1', {}, client.name))),
      h('nav', { class: 'tabs' },
        t('kalender', 'Contentkalender'), t('planning', 'Conceptplanning'), t('input', 'Klantinput'),
        t('media', 'Mediabibliotheek'), t('shoots', 'Contentshoots'), t('instellingen', 'Klantprofiel & AI-geheugen')),
    ],
  };
}
