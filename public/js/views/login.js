import { h, field } from '../ui.js';
import { api, meta, roleLabel } from '../api.js';

function shell(title, intro, form) {
  return h('div', { class: 'inlog' },
    h('div', { class: 'merkvlak' }, h('img', { src: 'assets/brand/svg/logo-wit-op-turkoois.svg', alt: 'Jouw Social Studio' })),
    h('div', { class: 'formvlak' },
      h('div', {}, h('h1', {}, title), h('p', { class: 'zacht' }, intro), form)));
}

function form(fields, submitLabel, onSubmit) {
  const error = h('div', { class: 'melding fout', hidden: true, role: 'alert' });
  const button = h('button', { class: 'knop primair', type: 'submit' }, submitLabel);
  const el = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      button.disabled = true;
      error.hidden = true;
      try {
        await onSubmit(Object.fromEntries(new FormData(el)));
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      } finally {
        button.disabled = false;
      }
    },
  }, error, fields, button);
  return el;
}

// In de demo: de demo-accounts, één per rol. Een klik vult e-mailadres en wachtwoord in.
function demoAccounts(formEl) {
  if (!meta.demo || !meta.demoAccounts?.length) return null;
  const fillIn = (email) => {
    formEl.querySelector('input[name=email]').value = email;
    formEl.querySelector('input[name=password]').value = 'demo-wachtwoord';
    formEl.querySelector('button[type=submit]').focus();
  };
  return h('div', { class: 'demo-accounts' },
    h('h2', {}, 'Demo-accounts'),
    h('p', { class: 'zacht' }, 'Wachtwoord voor alle accounts: demo-wachtwoord. Klik op een account om het in te vullen.'),
    h('ul', {}, meta.demoAccounts.map((a) => h('li', {},
      h('button', { type: 'button', onclick: () => fillIn(a.email) },
        h('strong', {}, roleLabel(a.role)), h('span', {}, a.email))))));
}

export function loginView(onLoggedIn) {
  const view = shell('Inloggen', meta.demo ? 'Demoversie van Jouw Content Studio, de contentplanner van Jouw Social Studio.' : 'Jouw Content Studio, de contentplanner van Jouw Social Studio.', form([
    field('E-mailadres', h('input', { type: 'email', name: 'email', required: true, autocomplete: 'username' })),
    field('Wachtwoord', h('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password' })),
  ], 'Inloggen', async (data) => {
    await api.post('/login', data);
    await onLoggedIn();
  }));
  const formEl = view.querySelector('form');
  const accounts = demoAccounts(formEl);
  if (accounts) formEl.after(accounts);
  return view;
}

export function setupView(onLoggedIn) {
  return shell('Account van de beheerder', 'Er zijn nog geen gebruikers. Maak eerst het beheerdersaccount aan; daarna voeg je het team toe.', form([
    field('Naam', h('input', { type: 'text', name: 'name', required: true })),
    field('E-mailadres', h('input', { type: 'email', name: 'email', required: true, autocomplete: 'username' })),
    field('Wachtwoord', h('input', { type: 'password', name: 'password', required: true, minLength: 10, autocomplete: 'new-password' }), 'Minimaal 10 tekens.'),
  ], 'Account aanmaken', async (data) => {
    await api.post('/setup', data);
    await onLoggedIn();
  }));
}
