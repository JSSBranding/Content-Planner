import { h, fill, icon, showError, initials, modal, toast, openMenu } from './ui.js';
import { api, meta, loadMeta, can, roleLabel } from './api.js';
import { loginView, setupView } from './views/login.js';
import { clientsView } from './views/clients.js';
import { calendarView } from './views/calendar.js';
import { plansView, planView } from './views/plans.js';
import { mediaView } from './views/media.js';
import { settingsView, confirmDeleteClient } from './views/settings.js';
import { shootsView } from './views/shoots.js';
import { usersView } from './views/users.js';
import { clientSetupView } from './views/setup.js';

const root = document.getElementById('app');

// Routes: #/pad/:param. De eerste die past, wint.
const routes = [
  ['/', clientsView, 'overzicht'],
  ['/gebruikers', usersView, 'gebruikers'],
  ['/inrichten', clientSetupView, 'inrichten'],
  ['/klant/:clientId', calendarView, 'klant', 'kalender'],
  ['/klant/:clientId/kalender', calendarView, 'klant', 'kalender'],
  ['/klant/:clientId/planning', plansView, 'klant', 'planning'],
  ['/klant/:clientId/planning/:planId', planView, 'klant', 'planning'],
  ['/klant/:clientId/input', plansView, 'klant', 'planning'],
  ['/klant/:clientId/media', mediaView, 'klant', 'media'],
  ['/klant/:clientId/shoots', shootsView, 'klant', 'shoots'],
  ['/klant/:clientId/instellingen', settingsView, 'klant', 'instellingen'],
];

function match(path) {
  for (const [pattern, view, section, tab] of routes) {
    const names = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}$`);
    const m = path.match(re);
    if (m) return { view, section, tab, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

// ---------- Zijbalk ----------

let clientSearch = '';
let renaming = false; // tijdens hernoemen in de zijbalk wordt die niet vernieuwd

function sidebar(clients, route) {
  const list = h('nav', { class: 'klantenlijst', 'aria-label': 'Klanten' });
  const drawList = () => {
    const q = clientSearch.trim().toLowerCase();
    const shown = clients.filter((c) => !c.archived && (!q || c.name.toLowerCase().includes(q)));
    fill(list, shown.length ? shown.map((c) => {
      const waiting = c.open_plans;
      const active = route.params.clientId === c.id;
      // Blijf op hetzelfde tabblad als je van klant wisselt.
      const tab = route.section === 'klant' && route.tab !== 'kalender' ? route.tab : 'kalender';
      const name = h('span', { class: 'naam' }, c.name);
      const link = h('a', {
        class: `zijlink ${active ? 'actief' : ''}`, href: `#/klant/${c.id}/${tab}`, 'aria-current': active ? 'page' : null, title: c.name,
        ondblclick: (e) => { if (can('manageClients')) { e.preventDefault(); renameInline(c, name); } },
      },
      h('span', { class: 'initialen' }, initials(c.name)), name,
      waiting ? h('span', { class: 'teller', title: `${waiting} conceptplanning(en) open` }, waiting) : null);
      const more = h('button', {
        type: 'button', class: 'zijmeer', 'aria-label': `Meer voor ${c.name}`, title: 'Meer',
        onclick: (e) => openMenu(e.currentTarget, clientMenu(c, name)),
      }, icon('meer', { size: 16 }));
      return h('div', { class: 'zijrij' }, link, more);
    }) : h('p', { class: 'zacht', style: { color: '#a9acab', padding: '4px 10px' } }, q ? 'Geen klant gevonden.' : 'Nog geen klanten.'));
  };
  drawList();

  const search = clients.length > 6 ? h('input', {
    type: 'search', class: 'zoek', placeholder: 'Zoek klant', value: clientSearch, 'aria-label': 'Zoek klant',
    oninput: (e) => { clientSearch = e.target.value; drawList(); },
  }) : null;

  return h('aside', { class: 'zijbalk' },
    h('a', { class: 'merk', href: '#/' }, h('img', { src: 'assets/brand/svg/beeldmerk-turkoois.svg', alt: '' }), 'Jouw Content Studio'),
    h('nav', { 'aria-label': 'Hoofdmenu' },
      h('a', { class: `zijlink ${route.section === 'overzicht' ? 'actief' : ''}`, href: '#/' }, icon('kalender'), h('span', { class: 'naam' }, 'Overzicht')),
      can('manageClients') ? h('a', { class: `zijlink ${route.section === 'inrichten' ? 'actief' : ''}`, href: '#/inrichten' }, icon('profiel'), h('span', { class: 'naam' }, 'Klanten inrichten'),
        clients.some((c) => !c.archived && !c.channels.length) ? h('span', { class: 'teller', title: 'Klanten zonder kanalen' }, clients.filter((c) => !c.archived && !c.channels.length).length) : null) : null,
      can('manageUsers') ? h('a', { class: `zijlink ${route.section === 'gebruikers' ? 'actief' : ''}`, href: '#/gebruikers' }, icon('gebruikers'), h('span', { class: 'naam' }, 'Team en rechten')) : null),
    h('div', { class: 'kopje' }, 'Klanten',
      can('manageClients') ? h('a', { href: '#/?nieuw=1', title: 'Nieuwe klant', 'aria-label': 'Nieuwe klant' }, icon('plus', { size: 16 })) : null),
    search,
    list,
    h('div', { class: 'voet' },
      meta.demo ? null : h('div', { class: `ai-status ${meta.ai.available ? 'aan' : ''}`, title: meta.ai.available ? `Model: ${meta.ai.model}` : 'Op de server is nog geen ANTHROPIC_API_KEY ingesteld.' },
        meta.ai.available ? 'AI actief' : 'AI in voorbeeldmodus'),
      meta.demo ? demoBlock() : null,
      h('div', { class: 'gebruiker' },
        h('span', { class: 'initialen', style: { width: '28px', height: '28px', borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgb(255 255 255 / 12%)', fontSize: '11px', fontWeight: '600' } }, initials(meta.user.name)),
        h('div', { class: 'wie' }, h('div', {}, meta.user.name), h('div', { class: 'rol' }, roleLabel(meta.user.role))),
        h('button', { type: 'button', title: 'Uitloggen', 'aria-label': 'Uitloggen', onclick: logout }, icon('uitlog')))));
}

// ---------- Demoversie ----------

function demoBlock() {
  return h('div', { class: 'demoblok' },
    h('div', { class: 'demolabel' }, 'Demoversie'),
    h('div', { class: 'demoknoppen' },
      h('button', { type: 'button', onclick: () => showWelcome() }, 'Wat kan ik proberen?'),
      h('button', { type: 'button', onclick: resetDemo }, 'Opnieuw beginnen')));
}

async function resetDemo() {
  const ok = await modal({
    title: 'Demo opnieuw beginnen?',
    body: h('p', {}, 'Alles wat je in de demo hebt gewijzigd, wordt teruggezet naar de voorbeeldgegevens.'),
    buttons: [{ label: 'Annuleren' }, { label: 'Opnieuw beginnen', class: 'primair', value: true }],
  });
  if (!ok) return;
  await api.post('/demo/opnieuw');
  await loadMeta();
  location.hash = '#/';
  toast('De demo is teruggezet');
  render();
}

function showWelcome() {
  const tries = [
    ['Een planning goedkeuren', 'Open Bakkerij De Vries, tabblad Input en planning. Er wacht een voorstel voor volgende maand. Pas iets aan en keur het goed. Je ziet ook wat er gebeurt als er al een post op een datum staat.'],
    ['De kalender gebruiken', 'Naast de datums zie je feest- en actiedagen. Beweeg over een post om de tekst te kopiëren of de status te wijzigen; klik erop voor tekst, beeld, pijler en opmerkingen.'],
    ['Klanten snel beheren', 'Dubbelklik in de zijbalk op een klantnaam om hem te wijzigen, of gebruik de drie puntjes voor meer opties.'],
    ['Inloggen met een andere rol', 'Log uit (linksonder) en log in als Branding of Stage om te zien wat die rol wel en niet kan.'],
    ['Klanten inrichten', 'Onder Klanten inrichten staan jullie eigen klantnamen. Vink kanalen aan en vul het aantal posts per week in.'],
  ];
  modal({
    title: 'Welkom in de demo van Jouw Content Studio', width: '620px',
    body: [
      h('p', {}, 'Dit is een volledig werkende demo met voorbeeldgegevens. Bakkerij De Vries en Fietsenmaker Van Dam zijn verzonnen klanten om mee te oefenen.'),
      h('div', { class: 'welkomlijst' }, tries.map(([title, text]) => h('div', {}, h('strong', {}, title), h('p', { class: 'zacht' }, text)))),
      h('p', { class: 'zacht' }, 'Wat werkt anders dan in de echte versie: teksten en voorstellen komen uit een vaste voorbeeldgenerator in plaats van de AI, downloaden en Excel-import werken niet, en je wijzigingen blijven alleen in deze browser.'),
    ],
    buttons: [{ label: 'Aan de slag', class: 'primair', value: true }],
  });
  try { localStorage.setItem('jcs-demo-welkom', '1'); } catch { /* geen opslag */ }
}

// ---------- Klant snel beheren vanuit de zijbalk ----------

function clientMenu(c, nameEl) {
  const go = (path) => () => { location.hash = `#/klant/${c.id}/${path}`; };
  const items = [
    { label: 'Contentkalender', icon: 'kalender', action: go('kalender') },
    { label: 'Klantinput en planning', icon: 'planning', action: go('planning') },
    { label: 'Klantprofiel en context', icon: 'profiel', action: go('instellingen') },
  ];
  if (can('editContent')) items.push({ label: 'Beeld uploaden', icon: 'upload', action: go('media') });
  if (can('manageClients')) {
    items.push(
      { label: 'Naam wijzigen', icon: 'bewerk', action: () => renameInline(c, nameEl) },
      { label: c.archived ? 'Weer actief maken' : 'Archiveren', icon: 'slot', action: () => toggleArchive(c) },
      { label: 'Klant verwijderen', icon: 'prullenbak', action: () => confirmDeleteClient(c) },
    );
  }
  return items;
}

// Naam direct in de zijbalk aanpassen: Enter of wegklikken slaat op, Escape annuleert.
function renameInline(c, nameEl) {
  const row = nameEl.closest('.zijrij');
  const input = h('input', { type: 'text', class: 'zijnaam-invoer', value: c.name, 'aria-label': `Nieuwe naam voor ${c.name}` });
  let done = false;
  renaming = true;
  const finish = async (save) => {
    if (done) return;
    done = true;
    renaming = false;
    const value = input.value.trim();
    if (save && value && value !== c.name) {
      try {
        await api.patch(`/clients/${c.id}`, { name: value });
        toast(`Naam gewijzigd in ${value}`);
      } catch (err) {
        showError(err);
      }
    }
    render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  row.replaceChildren(input);
  input.focus();
  input.select();
}

async function toggleArchive(c) {
  try {
    await api.patch(`/clients/${c.id}`, { archived: !c.archived });
    toast(c.archived ? `${c.name} is weer actief` : `${c.name} is gearchiveerd`);
    render();
  } catch (err) {
    showError(err);
  }
}

async function logout() {
  await api.post('/logout');
  meta.user = null;
  render();
}

// ---------- Weergeven ----------

let renderToken = 0;

export async function render() {
  const token = ++renderToken;
  if (meta.needsSetup) return fill(root, setupView(onLoggedIn));
  if (!meta.user) return fill(root, loginView(onLoggedIn));

  const [path, query = ''] = (location.hash.slice(1) || '/').split('?');
  const route = match(path) ?? match('/');
  const main = h('main', { class: 'werkvlak' }, h('div', { class: 'laadvlak' }, h('span', { class: 'laden' }), 'Laden'));
  const shell = h('div', { class: 'app' }, h('aside', { class: 'zijbalk' }), main);
  if (!root.querySelector('.app')) fill(root, shell);
  else root.querySelector('.werkvlak').replaceWith(main);

  try {
    const [clients, content] = await Promise.all([
      api.get('/clients'),
      route.view({ ...route.params, query: new URLSearchParams(query), tab: route.tab, rerender: render }),
    ]);
    if (token !== renderToken) return;
    if (!renaming) root.querySelector('.zijbalk').replaceWith(sidebar(clients, route));
    fill(main, content);
    document.title = `${main.querySelector('h1')?.textContent ?? 'Overzicht'} | Jouw Content Studio`;
  } catch (err) {
    if (token !== renderToken) return;
    fill(main, h('div', { class: 'inhoud-vlak' }, h('div', { class: 'melding fout' }, icon('sluit'), err.message)));
    if (err.status !== 404) showError(err);
  }
}

async function onLoggedIn() {
  await loadMeta();
  fill(root);
  await render();
  maybeWelcome();
}

window.addEventListener('hashchange', render);
window.addEventListener('jcs:vernieuw', () => render());
window.addEventListener('jcs:uitgelogd', () => {
  if (!meta.user) return;
  meta.user = null;
  render();
});

// In de demo kunnen bestanden niet worden gedownload; geef dan een duidelijke melding.
document.addEventListener('click', (e) => {
  if (!meta.demo) return;
  const link = e.target.closest?.('a[download]');
  if (!link) return;
  e.preventDefault();
  toast('Downloaden kan in de demo niet. In de echte versie wel.');
}, true);

// In de demo verschijnt na de eerste keer inloggen een korte uitleg.
function maybeWelcome() {
  let seen = false;
  try { seen = localStorage.getItem('jcs-demo-welkom') === '1'; } catch { /* geen opslag */ }
  if (meta.demo && meta.user && !seen) showWelcome();
}

loadMeta().then(async () => {
  await render();
  maybeWelcome();
}).catch((err) => fill(root, h('div', { class: 'inhoud-vlak' }, h('div', { class: 'melding fout' }, `De server is niet bereikbaar: ${err.message}`))));
