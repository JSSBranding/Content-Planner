import { h, fill, icon, showError, toast, openMenu, downloadUrl, avatar, avatarEditor, modal, field } from './ui.js';
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
import { archivedView } from './views/archived.js';

const root = document.getElementById('app');

// Routes: #/pad/:param. De eerste die past, wint.
const routes = [
  ['/', clientsView, 'overzicht'],
  ['/gebruikers', usersView, 'gebruikers'],
  ['/inrichten', clientSetupView, 'inrichten'],
  ['/gearchiveerd', archivedView, 'gearchiveerd'],
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
let menuOpen = false; // op de telefoon klapt de zijbalk in tot een balk met menuknop
window.addEventListener('hashchange', () => { menuOpen = false; });

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
      avatar(c.name, c.avatar_url), name,
      hasNews(c) ? h('span', { class: 'nieuw-bol', title: 'Nieuw toegevoegd door een ander account' }) : null,
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

  const aside = h('aside', { class: `zijbalk ${menuOpen ? 'open' : ''}` });
  const toggle = h('button', {
    type: 'button', class: 'menuknop', 'aria-label': 'Menu', 'aria-expanded': String(menuOpen),
    onclick: () => {
      menuOpen = !menuOpen;
      aside.classList.toggle('open', menuOpen);
      toggle.setAttribute('aria-expanded', String(menuOpen));
    },
  }, icon('menu', { size: 22 }));
  return fill(aside,
    h('div', { class: 'zijtop' },
      h('a', { class: 'merk', href: '#/' }, h('img', { src: 'assets/brand/svg/beeldmerk-turkoois.svg', alt: '' }), 'Jouw Content Studio'),
      toggle),
    h('div', { class: 'zijinhoud' },
    h('nav', { 'aria-label': 'Hoofdmenu' },
      h('a', { class: `zijlink ${route.section === 'overzicht' ? 'actief' : ''}`, href: '#/' }, icon('kalender'), h('span', { class: 'naam' }, 'Overzicht')),
      can('manageClients') ? h('a', { class: `zijlink ${route.section === 'inrichten' ? 'actief' : ''}`, href: '#/inrichten' }, icon('profiel'), h('span', { class: 'naam' }, 'Klanten inrichten'),
        clients.some((c) => !c.archived && !c.channels.length) ? h('span', { class: 'teller', title: 'Klanten zonder kanalen' }, clients.filter((c) => !c.archived && !c.channels.length).length) : null) : null,
      can('manageUsers') ? h('a', { class: `zijlink ${route.section === 'gebruikers' ? 'actief' : ''}`, href: '#/gebruikers' }, icon('gebruikers'), h('span', { class: 'naam' }, 'Team en rechten')) : null),
    h('div', { class: 'kopje' }, 'Klanten',
      can('manageClients') ? h('a', { href: '#/?nieuw=1', title: 'Nieuwe klant', 'aria-label': 'Nieuwe klant' }, icon('plus', { size: 16 })) : null),
    search,
    list,
    archivedLink(clients, route),
    h('div', { class: 'voet' },
      meta.demo ? null : h('div', { class: `ai-status ${meta.ai.available ? 'aan' : ''}`, title: meta.ai.available ? `Model: ${meta.ai.model}` : 'Op de server is nog geen ANTHROPIC_API_KEY ingesteld.' },
        meta.ai.available ? 'AI actief' : 'AI in voorbeeldmodus'),
      h('div', { class: 'gebruiker' },
        h('button', { type: 'button', class: 'mijnaccount', title: 'Mijn account en profielfoto', onclick: openMyAccount },
          avatar(roleLabel(meta.user.role), meta.user.avatar_url, 'gebruikerfoto'),
          h('div', { class: 'wie' }, h('div', {}, roleLabel(meta.user.role)), h('div', { class: 'rol' }, meta.user.email))),
        h('button', { type: 'button', title: 'Uitloggen', 'aria-label': 'Uitloggen', onclick: logout }, icon('uitlog'))))));
}

// Eigen account: profielfoto wijzigen. Iedereen mag dit voor het eigen account.
function openMyAccount() {
  const editor = avatarEditor({
    name: roleLabel(meta.user.role), url: meta.user.avatar_url,
    hint: 'Je foto staat linksonder in het menu en bij Team en rechten. Wordt automatisch vierkant bijgesneden.',
    save: async (image) => {
      const res = image ? await api.put(`/users/${meta.user.id}/avatar`, { image }) : await api.del(`/users/${meta.user.id}/avatar`);
      meta.user.avatar_url = res.avatar_url;
      window.dispatchEvent(new CustomEvent('jcs:zijbalk'));
      if (location.hash.startsWith('#/gebruikers')) render();
      return res.avatar_url;
    },
  });
  modal({
    title: 'Mijn account', width: '520px',
    body: [
      h('div', { class: 'veld' }, h('label', {}, 'Profielfoto'), editor),
      field('Rol', h('input', { type: 'text', value: roleLabel(meta.user.role), disabled: true })),
      field('E-mailadres', h('input', { type: 'text', value: meta.user.email, disabled: true }), 'Een ander e-mailadres of wachtwoord stelt een Chefkes in onder Team en rechten.'),
    ],
    buttons: [{ label: 'Sluiten', class: 'primair', value: true }],
  });
}

// Gearchiveerde klanten staan niet in de lijst, maar zijn hier altijd terug te vinden.
function archivedLink(clients, route) {
  const count = clients.filter((c) => c.archived).length;
  const active = route.section === 'gearchiveerd' || (route.section === 'klant' && clients.find((c) => c.id === route.params.clientId)?.archived);
  return h('a', { class: `zijlink archieflink ${active ? 'actief' : ''}`, href: '#/gearchiveerd', 'aria-current': active ? 'page' : null },
    icon('archief'), h('span', { class: 'naam' }, 'Gearchiveerd'), count ? h('span', { class: 'aantal' }, count) : null);
}


// ---------- Klant snel beheren vanuit de zijbalk ----------

const hasNews = (c) => Boolean(c.news && (c.news.kalender || c.news.planning || c.news.media));

export function clientMenu(c, nameEl) {
  const go = (path) => () => { location.hash = `#/klant/${c.id}/${path}`; };
  const items = [
    { label: 'Contentkalender', icon: 'kalender', action: go('kalender') },
    { label: 'Klantinput en planning', icon: 'planning', action: go('planning') },
    { label: 'Klantprofiel en context', icon: 'profiel', action: go('instellingen') },
  ];
  if (can('manageMedia')) items.push({ label: 'Beeld uploaden', icon: 'upload', action: go('media') });
  if (can('manageClients')) {
    items.push(
      ...(nameEl ? [{ label: 'Naam wijzigen', icon: 'bewerk', action: () => renameInline(c, nameEl) }] : [{ label: 'Naam wijzigen', icon: 'bewerk', action: go('instellingen') }]),
      { label: 'Dupliceren', icon: 'kopie', action: () => duplicateClient(c) },
      { label: c.archived ? 'Weer actief maken' : 'Archiveren', icon: 'archief', action: () => toggleArchive(c) },
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

async function duplicateClient(c) {
  try {
    const copy = await api.post(`/clients/${c.id}/duplicate`);
    toast(`${copy.name} aangemaakt, met dezelfde instellingen en context`);
    location.hash = `#/klant/${copy.id}/instellingen`;
  } catch (err) {
    showError(err);
  }
}

export async function toggleArchive(c) {
  try {
    await api.patch(`/clients/${c.id}`, { archived: !c.archived });
    toast(c.archived ? `${c.name} is weer actief en staat weer in de zijbalk` : `${c.name} is gearchiveerd. Je vindt hem onder Gearchiveerd, links onderaan de klantenlijst.`);
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
    markSeen(route, token);
    document.title = `${main.querySelector('h1')?.textContent ?? 'Overzicht'} | Jouw Content Studio`;
  } catch (err) {
    if (token !== renderToken) return;
    fill(main, h('div', { class: 'inhoud-vlak' }, h('div', { class: 'melding fout' }, icon('sluit'), err.message)));
    if (err.status !== 404) showError(err);
  }
}

// Een onderdeel van een klant openen telt als bekeken: de bolletjes verdwijnen daarna.
// De kalender meldt zelf welke nieuwe posts in beeld waren (zie calendar.js).
const SEEN_SECTION = { planning: 'planning', media: 'media' };
async function markSeen(route, token, body) {
  const section = body?.section ?? SEEN_SECTION[route.tab];
  if (!route.params.clientId || !section) return;
  try {
    await api.post(`/clients/${route.params.clientId}/seen`, body ?? { section });
    const clients = await api.get('/clients');
    if (token === renderToken && !renaming) root.querySelector('.zijbalk').replaceWith(sidebar(clients, route));
  } catch { /* niet belangrijk genoeg om te melden */ }
}

async function onLoggedIn() {
  await loadMeta();
  fill(root);
  await render();
  maybeWelcome();
}

window.addEventListener('hashchange', render);
window.addEventListener('jcs:vernieuw', () => render());
window.addEventListener('jcs:posts-bekeken', (e) => {
  const [path] = (location.hash.slice(1) || '/').split('?');
  const route = match(path);
  if (route) markSeen(route, renderToken, { section: 'kalender', ids: e.detail });
});
// Alleen de zijbalk vernieuwen (bijv. na een nieuwe profielfoto), zonder het werkvlak met eventueel half ingevulde velden.
window.addEventListener('jcs:zijbalk', async () => {
  const [path] = (location.hash.slice(1) || '/').split('?');
  const route = match(path) ?? match('/');
  try {
    const clients = await api.get('/clients');
    if (!renaming) root.querySelector('.zijbalk')?.replaceWith(sidebar(clients, route));
  } catch { /* de volgende weergave haalt het in */ }
});
window.addEventListener('jcs:uitgelogd', () => {
  if (!meta.user) return;
  meta.user = null;
  render();
});

// In de browserversie gaan downloadlinks via de downloadfunctie van de omgeving.
document.addEventListener('click', (e) => {
  if (!meta.demo) return;
  const link = e.target.closest?.('a[download]');
  if (!link || link.dataset.direct) return;
  e.preventDefault();
  downloadUrl(link.getAttribute('href'), link.getAttribute('download'));
}, true);

loadMeta().then(() => render()).catch((err) => fill(root, h('div', { class: 'inhoud-vlak' }, h('div', { class: 'melding fout' }, `De server is niet bereikbaar: ${err.message}`))));
