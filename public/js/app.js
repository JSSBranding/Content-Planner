import { h, fill, showError } from './ui.js';
import { api, meta, loadMeta, can } from './api.js';
import { loginView, setupView } from './views/login.js';
import { clientsView } from './views/clients.js';
import { calendarView } from './views/calendar.js';
import { plansView, planView } from './views/plans.js';
import { inboxView } from './views/inbox.js';
import { mediaView } from './views/media.js';
import { settingsView } from './views/settings.js';
import { shootsView } from './views/shoots.js';
import { usersView } from './views/users.js';

const root = document.getElementById('app');

// Routes: #/pad/:param. De eerste die past, wint.
const routes = [
  ['/', clientsView, 'klanten'],
  ['/gebruikers', usersView, 'gebruikers'],
  ['/klant/:clientId', calendarView, 'klanten', 'kalender'],
  ['/klant/:clientId/kalender', calendarView, 'klanten', 'kalender'],
  ['/klant/:clientId/planning', plansView, 'klanten', 'planning'],
  ['/klant/:clientId/planning/:planId', planView, 'klanten', 'planning'],
  ['/klant/:clientId/input', inboxView, 'klanten', 'input'],
  ['/klant/:clientId/media', mediaView, 'klanten', 'media'],
  ['/klant/:clientId/shoots', shootsView, 'klanten', 'shoots'],
  ['/klant/:clientId/instellingen', settingsView, 'klanten', 'instellingen'],
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

export function navigate(path) {
  location.hash = `#${path}`;
}

function header(section) {
  const ai = meta.ai.available
    ? h('span', { class: 'chip ai-aan', title: `Model: ${meta.ai.model}` }, '● AI actief')
    : h('span', { class: 'chip ai-uit', title: 'Stel ANTHROPIC_API_KEY in op de server om AI te gebruiken.' }, '● Voorbeeldmodus (geen AI-sleutel)');
  return h('header', { class: 'kop' },
    h('a', { class: 'merk', href: '#/' }, h('img', { src: '/assets/brand/svg/beeldmerk-turkoois.svg', alt: '' }), 'Jouw Content Studio'),
    h('nav', {},
      h('a', { href: '#/', class: section === 'klanten' ? 'actief' : '' }, 'Klanten'),
      can('manageUsers') ? h('a', { href: '#/gebruikers', class: section === 'gebruikers' ? 'actief' : '' }, 'Gebruikers') : null),
    h('div', { class: 'rechts' }, ai,
      h('span', { class: 'zacht' }, meta.user.name),
      h('button', { class: 'knop klein', onclick: logout }, 'Uitloggen')));
}

async function logout() {
  await api.post('/logout');
  meta.user = null;
  render();
}

let renderToken = 0;

export async function render() {
  const token = ++renderToken;
  if (meta.needsSetup) return fill(root, setupView(onLoggedIn));
  if (!meta.user) return fill(root, loginView(onLoggedIn));

  const [path, query = ''] = (location.hash.slice(1) || '/').split('?');
  const route = match(path) ?? match('/');
  const main = h('main', { class: route.tab === 'kalender' || route.tab === 'planning' ? 'breed' : '' }, h('p', { class: 'zacht' }, h('span', { class: 'laden' }), ' Laden…'));
  fill(root, header(route.section), main);
  try {
    const content = await route.view({ ...route.params, query: new URLSearchParams(query), tab: route.tab, rerender: render });
    if (token === renderToken) fill(main, content);
  } catch (err) {
    if (token !== renderToken) return;
    fill(main, h('div', { class: 'melding fout' }, err.message));
    if (err.status !== 404) showError(err);
  }
}

async function onLoggedIn() {
  await loadMeta();
  render();
}

window.addEventListener('hashchange', render);
window.addEventListener('jcs:uitgelogd', () => {
  if (!meta.user) return;
  meta.user = null;
  render();
});

loadMeta().then(render).catch((err) => fill(root, h('main', {}, h('div', { class: 'melding fout' }, `De server is niet bereikbaar: ${err.message}`))));
