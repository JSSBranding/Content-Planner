import { h, fill, icon, field, toast, showError, emptyState, pageHead, page, avatar, openMenu } from '../ui.js';
import { api, can, meta, channelLabel } from '../api.js';
import { clientForm } from './settings.js';

export async function clientsView({ query }) {
  const [clients, attention, mentions] = await Promise.all([api.get('/clients'), api.get('/aandacht'), api.get('/vermeldingen')]);
  const active = clients.filter((c) => !c.archived);
  const archived = clients.filter((c) => c.archived);
  const newMode = can('manageClients') ? query.get('nieuw') : null; // '1' = één klant, 'lijst' = meerdere

  const newButton = can('manageClients') && !newMode
    ? h('a', { class: 'knop primair', href: '#/?nieuw=1' }, icon('plus', { size: 16 }), 'Klant toevoegen')
    : null;

  // Per klant: wat vraagt nu aandacht?
  const soon = (c) => attention.items.filter((i) => i.client_id === c.id).length;
  const todos = (c) => [
    soon(c) ? `${soon(c)} post${soon(c) > 1 ? 's gaan' : ' gaat'} binnen ${attention.days} dagen online zonder tekst of beeld` : null,
    !c.channels.length ? 'Kanalen nog instellen' : null,
    c.open_plans ? `${c.open_plans} conceptplanning${c.open_plans > 1 ? 'en' : ''} wacht${c.open_plans > 1 ? 'en' : ''} op beoordeling` : null,
    c.open_inputs ? `${c.open_inputs} nieuwe klantinput` : null,
    c.action_needed ? `${c.action_needed} post${c.action_needed > 1 ? 's' : ''} met actie nodig` : null,
  ].filter(Boolean);

  const card = (c) => {
    const list = todos(c);
    const hasNews = c.news && (c.news.kalender || c.news.planning || c.news.media);
    const more = h('button', {
      type: 'button', class: 'knop kaal icoonknop klein kaartmeer', 'aria-label': `Meer voor ${c.name}`, title: 'Meer',
      onclick: async (e) => {
        const button = e.currentTarget; // na de await is currentTarget leeg
        const { clientMenu } = await import('../app.js');
        openMenu(button, clientMenu(c, null));
      },
    }, icon('meer', { size: 16 }));
    return h('div', { class: 'kaarthouder' }, more, h('a', { class: 'klantkaart', href: `#/klant/${c.id}/${c.channels.length ? 'kalender' : 'instellingen'}` },
      h('div', { class: 'kop' }, avatar(c.name, c.avatar_url),
        h('div', {}, h('h2', {}, c.name),
          h('div', { class: 'zacht' }, c.channels.length ? `${c.posts_per_week} posts per week op ${c.channels.map(channelLabel).join(', ')}` : 'Nog niet ingericht'))),
      h('div', { class: 'todo' },
        hasNews ? h('div', {}, h('span', { class: 'nieuw-bol' }), 'Nieuw sinds je laatste bezoek') : null,
        list.length ? list.map((t) => h('div', {}, h('span', { class: 'stip' }), t))
          : hasNews ? null : h('div', { class: 'rustig' }, 'Niets openstaand'))));
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
            : 'Begin met naam, kanalen en frequentie. Wat de klant doet en de afspraken vul je later aan op het klantprofiel.')),
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
      title: 'Goedendag',
      sub: `${active.length} klant${active.length === 1 ? '' : 'en'}. ${totalPlans ? `${totalPlans} conceptplanning${totalPlans > 1 ? 'en' : ''} wacht${totalPlans > 1 ? 'en' : ''} op beoordeling.` : 'Alle conceptplanningen zijn beoordeeld.'}`,
      actions: newButton,
    }),
    form,
    newMode ? null : attentionBlock(attention),
    newMode ? null : mentionsBlock(mentions),
    !newMode && can('manageClients') && active.some((c) => !c.channels.length) ? h('div', { class: 'melding let-op' }, icon('profiel'),
      h('div', {}, `${active.filter((c) => !c.channels.length).length} klanten hebben nog geen kanalen en frequentie. `,
        h('a', { href: '#/inrichten' }, 'Vul ze in één overzicht in'), '.')) : null,
    active.length > 8 ? h('div', { class: 'filters' }, h('div', { class: 'zoekveld' }, icon('zoek', { size: 16 }), search)) : null,
    active.length ? grid : !newMode ? emptyState('Nog geen klanten. Voeg je eerste klant toe om te beginnen.', newButton) : null,
    archived.length ? h('p', { class: 'archiefverwijzing' }, icon('archief', { size: 16 }),
      h('a', { href: '#/gearchiveerd' }, `${archived.length} gearchiveerde klant${archived.length === 1 ? '' : 'en'} bekijken`)) : null,
  );
}

// ---------- Bovenaan het overzicht: wat nu aandacht nodig heeft ----------

const dayFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
const whenLabel = (iso) => {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  return iso === today ? 'Vandaag' : iso === tomorrow ? 'Morgen' : dayFmt.format(new Date(`${iso}T12:00:00`));
};

function attentionBlock(attention) {
  if (!attention.items.length) return null;
  const shown = attention.items.slice(0, 8);
  return h('section', { class: 'overzichtblok melding fout', style: { display: 'block' } },
    h('h2', {}, icon('waarschuwing', { size: 17 }), `${attention.items.length} post${attention.items.length > 1 ? 's gaan' : ' gaat'} binnen ${attention.days} dagen online, maar is nog niet klaar`),
    h('p', { class: 'zacht', style: { margin: 0 } }, 'Tekst of beeld ontbreekt nog. Posts die al volledig zijn ingepland, staan hier niet.'),
    h('ul', { class: 'aandachtlijst' }, shown.map((i) => h('li', {},
      h('a', { href: `#/klant/${i.client_id}/kalender?maand=${i.publish_date.slice(0, 7)}&post=${i.id}` },
        h('span', { class: 'wanneer' }, whenLabel(i.publish_date)),
        h('span', { class: 'wat' }, h('strong', {}, i.client_name), ` · ${channelLabel(i.channel)}${i.topic ? ` · ${i.topic}` : ''}`),
        h('span', { class: 'chip let-op' }, `${i.missing.join(' en ')} ontbreekt`))))),
    attention.items.length > shown.length ? h('p', { class: 'zacht', style: { margin: '8px 0 0' } }, `En nog ${attention.items.length - shown.length} meer.`) : null);
}

function mentionsBlock(mentions) {
  if (!mentions.length) return null;
  return h('section', { class: 'overzichtblok paneelblok' },
    h('h2', {}, icon('reactie', { size: 16 }), `Je bent genoemd in ${mentions.length} reactie${mentions.length > 1 ? 's' : ''}`),
    h('ul', { class: 'aandachtlijst' }, mentions.slice(0, 8).map((m) => h('li', {},
      h('a', { href: `#/klant/${m.client_id}/kalender?maand=${m.publish_date.slice(0, 7)}&post=${m.item_id}`, title: m.body },
        h('span', { class: 'wanneer' }, m.user_name ?? 'Iemand'),
        h('span', { class: 'wat' }, h('strong', {}, m.client_name), ` · ${whenLabel(m.publish_date)}, ${channelLabel(m.channel)} · "${m.body.slice(0, 90)}"`),
        h('span', { class: 'chip turkoois' }, 'Bekijken'))))));
}

const TABS = [
  ['kalender', 'Contentkalender', 'kalender'],
  ['planning', 'Input en planning', 'planning'],
  ['media', 'Beeld', 'beeld'],
  ['shoots', 'Contentshoots', 'camera'],
  ['instellingen', 'Klantprofiel', 'profiel'],
];

function archivedNotice(client) {
  return h('div', { class: 'melding let-op archiefmelding' }, icon('archief'),
    h('div', {}, h('strong', {}, 'Deze klant is gearchiveerd. '), 'Hij staat niet in de zijbalk; alle gegevens zijn bewaard. ',
      h('a', { href: '#/gearchiveerd' }, 'Naar Gearchiveerd')),
    can('manageClients') ? h('button', {
      type: 'button', class: 'knop klein',
      onclick: async () => { const { toggleArchive } = await import('../app.js'); toggleArchive(client); },
    }, 'Weer actief maken') : null);
}

// Kop met klantnaam, acties en tabbladen boven elk klantscherm.
export async function clientHeader(clientId, tab) {
  const client = await api.get(`/clients/${clientId}`);
  const counts = { planning: client.open_plans + client.open_inputs };
  const news = client.news ?? {};
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Onderdelen' }, TABS.map(([key, label, ic]) =>
    h('a', { href: `#/klant/${clientId}/${key}`, class: tab === key ? 'actief' : '', 'aria-current': tab === key ? 'page' : null },
      icon(ic, { size: 16 }), label, counts[key] ? h('span', { class: 'teller' }, counts[key]) : null,
      news[key] && tab !== key ? h('span', { class: 'nieuw-bol', title: 'Nieuw toegevoegd door een ander account' }) : null)));
  return {
    client,
    head: (actions) => pageHead({
      title: client.name,
      titleIcon: avatar(client.name, client.avatar_url, 'titelfoto'),
      titleMenu: h('button', {
        type: 'button', class: 'knop kaal icoonknop klein titelmeer', 'aria-label': `Meer voor ${client.name}`, title: 'Naam wijzigen, dupliceren, archiveren of verwijderen',
        onclick: async (e) => {
          const button = e.currentTarget;
          const { clientMenu } = await import('../app.js');
          openMenu(button, clientMenu(client, null));
        },
      }, icon('meer', { size: 18 })),
      sub: `${client.posts_per_week} posts per week op ${client.channels.map(channelLabel).join(', ') || 'nog geen kanalen'}`,
      actions,
      tabs: [client.archived ? archivedNotice(client) : null, tabs],
    }),
  };
}
