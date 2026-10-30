import { h, field } from '../ui.js';
import { api } from '../api.js';

function shell(title, intro, form) {
  return h('div', { class: 'inlog' },
    h('div', { class: 'merkvlak' }, h('img', { src: '/assets/brand/svg/logo-wit-op-turkoois.svg', alt: 'Jouw Social Studio' })),
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

export function loginView(onLoggedIn) {
  return shell('Inloggen', 'Jouw Content Studio, de contentplanner van Jouw Social Studio.', form([
    field('E-mailadres', h('input', { type: 'email', name: 'email', required: true, autocomplete: 'username' })),
    field('Wachtwoord', h('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password' })),
  ], 'Inloggen', async (data) => {
    await api.post('/login', data);
    await onLoggedIn();
  }));
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
