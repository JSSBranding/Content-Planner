import { h, fill, icon, field, toast, showError, emptyState, pageHead, page, initials } from '../ui.js';
import { api, can, meta, channelLabel } from '../api.js';
import { clientForm } from './settings.js';

export async function clientsView({ query }) {
  const clients = await api.get('/clients');
  const active = clients.filter((c) => !c.archived);
  const archived = clients.filter((c) => c.archived);
  const newMode = can('manageClients') ? query.get('nieuw') : null; // '1' = één klant, 'lijst' = meerdere

  const newButton = can('manageClients') && !newMode
    ? h('a', { class: 'knop primair', href: '#/?nieuw=1' }, icon('plus', { size: 16 }), 'Klant toevoegen')
    : null;

  // Per klant: wat vraagt nu aandacht?
  const todos = (c) => [
    !c.channels.length ? 'Kanalen nog instellen' : null,
    c.open_plans ? `${c.open_plans} conceptplanning${c.open_plans > 1 ? 'en' : ''} wacht${c.open_plans > 1 ? 'en' : ''} op beoordeling` : null,
    c.open_inputs ? `${c.open_inputs} nieuwe klantinput` : null,
    c.action_needed ? `${c.action_needed} post${c.action_needed > 1 ? 's' : ''} met actie nodig` : null,
  ].filter(Boolean);

  const card = (c) => {
    const list = todos(c);
    return h('a', { class: 'klantkaart', href: `#/klant/${c.id}/${c.channels.length ? 'kalender' : 'instellingen'}` },
      h('div', { class: 'kop' }, h('span', { class: 'initialen' }, initials(c.name)),
        h('div', {}, h('h2', {}, c.name),
          h('div', { class: 'zacht' }, c.channels.length ? `${c.posts_per_week} posts per week op ${c.channels.map(channelLabel).join(', ')}` : 'Nog niet ingericht'))),
      h('div', { class: 'todo' }, list.length
        ? list.map((t) => h('div', {}, h('span', { class: 'stip' }), t))
        : h('div', { class: 'rustig' }, 'Niets openstaand')));
  };

  // ---------- Toevoegen: één klant of een hele lijst ----------

  let form = null;
  if (newMode) {
    const switcher = h('div', { class: 'knoppen', style: { marginBottom: '16px' } },
      h('a', { class: `knop klein ${newMode === 'lijst' ? 'kaal' : ''}`, href: '#/?nieuw=1' }, 'Eén klant'),
      h('a', { class: `knop klein ${newMode === 'lijst' ? '' : 'kaal'}`, href: '#/?nieuw=lijst' }, 'Meerdere tegelijk'));
    form = h('div', { class: 'paneelblok sectie' },
      h('div', { class: 'knoppen', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
        h('div', {}, h('h2', {}, newMode === 'lijst' ? 'Klanten toevoegen' : 'Klant toevoegen'),
          h('p', { class: 'zacht' }, newMode === 'lijst'
            ? 'Plak een lijst met namen, één per regel. Namen die al bestaan worden overgeslagen. Kanalen en strategie kun je daarna per klant aanpassen.'
            : 'Begin met naam, kanalen en frequentie. Strategie en AI-geheugen vul je later aan.')),
        switcher),
      newMode === 'lijst' ? bulkForm() : clientForm({ client: null, onSaved: (c) => { location.hash = `#/klant/${c.id}/kalender`; }, onCancel: () => { location.hash = '#/'; } }));
  }

  function bulkForm() {
    const names = h('textarea', { rows: 10, placeholder: 'Bakkerij De Vries\nFietsenmaker Van Dam\nKapsalon Knip' });
    const counter = h('span', { class: 'zacht' }, '0 namen');
    names.addEventListener('input', () => {
      const n = names.value.split('\n').filter((l) => l.trim()).length;
      counter.textContent = `${n} ${n === 1 ? 'naam' : 'namen'}`;
    });
    const channelBoxes = meta.channels.map((ch) => h('label', {}, h('input', { type: 'checkbox', value: ch.key }), ch.label));
    const ppw = h('input', { type: 'number', min: 1, max: 21, value: '3' });
    return h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const res = await api.post('/clients/bulk', {
            names: names.value.split('\n'),
            channels: channelBoxes.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value),
            posts_per_week: Number(ppw.value),
          });
          toast(`${res.created.length} klant${res.created.length === 1 ? '' : 'en'} toegevoegd${res.skipped.length ? `, ${res.skipped.length} bestond${res.skipped.length === 1 ? '' : 'en'} al` : ''}`);
          location.hash = '#/';
        } catch (err) {
          showError(err);
        }
      },
    },
    h('div', { class: 'veld' }, h('div', { class: 'tekstkop' }, h('label', {}, 'Klantnamen'), counter), names),
    h('div', { class: 'veld' }, h('label', {}, 'Kanalen voor deze klanten (optioneel)'), h('div', { class: 'kanaalkeuze' }, channelBoxes)),
    h('div', { style: { maxWidth: '220px' } }, field('Posts per week', ppw)),
    h('div', { class: 'knoppen' }, h('button', { class: 'knop primair', type: 'submit' }, icon('plus', { size: 16 }), 'Klanten toevoegen'),
      h('a', { class: 'knop', href: '#/' }, 'Annuleren')));
  }

  // ---------- Zoeken ----------

  const grid = h('div', { class: 'klantkaarten sectie' });
  const search = h('input', { type: 'search', placeholder: 'Zoek klant', 'aria-label': 'Zoek klant', oninput: () => draw() });
  function draw() {
    const q = search.value.trim().toLowerCase();
    const shown = active.filter((c) => !q || c.name.toLowerCase().includes(q));
    fill(grid, shown.length ? shown.map(card) : h('p', { class: 'zacht' }, `Geen klant gevonden met "${search.value}".`));
  }
  draw();

  const totalPlans = active.reduce((n, c) => n + c.open_plans, 0);
  return page(
    pageHead({
      title: `Goedendag, ${meta.user.name.split(' ')[0]}`,
      sub: `${active.length} klant${active.length === 1 ? '' : 'en'}. ${totalPlans ? `${totalPlans} conceptplanning${totalPlans > 1 ? 'en' : ''} wacht${totalPlans > 1 ? 'en' : ''} op beoordeling.` : 'Alle conceptplanningen zijn beoordeeld.'}`,
      actions: newButton,
    }),
    form,
    active.length > 8 ? h('div', { class: 'filters' }, h('div', { class: 'zoekveld' }, icon('zoek', { size: 16 }), search)) : null,
    active.length ? grid : !newMode ? emptyState('Nog geen klanten. Voeg je eerste klant toe om te beginnen.', newButton) : null,
    archived.length ? h('details', { class: 'uitklap' }, h('summary', { class: 'zacht' }, `Gearchiveerde klanten (${archived.length})`),
      h('div', { class: 'klantkaarten', style: { marginTop: '12px' } }, archived.map(card))) : null,
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
