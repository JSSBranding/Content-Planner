import { h, field, toast, showError, modal, fmtDateTime } from '../ui.js';
import { api, meta, roleLabel } from '../api.js';

const roleSelect = (value) => h('select', { value }, meta.roles.map((r) => h('option', { value: r.key }, r.label)));

export async function usersView({ rerender }) {
  const users = await api.get('/users');

  const name = h('input', { type: 'text', required: true });
  const email = h('input', { type: 'email', required: true });
  const role = roleSelect('social_media_manager');
  const password = h('input', { type: 'password', required: true, minLength: 10, autocomplete: 'new-password' });
  const form = h('form', {
    class: 'kaart sectie',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api.post('/users', { name: name.value, email: email.value, role: role.value, password: password.value });
        toast('Gebruiker aangemaakt. Geef het wachtwoord persoonlijk door.');
        rerender();
      } catch (err) {
        showError(err);
      }
    },
  }, h('h2', {}, 'Gebruiker toevoegen'),
  h('div', { class: 'rij' }, field('Naam', name), field('E-mailadres', email), field('Rol', role), field('Tijdelijk wachtwoord', password, 'Minimaal 10 tekens.')),
  h('button', { class: 'knop primair', type: 'submit' }, 'Toevoegen'));

  async function edit(u) {
    const r = roleSelect(u.role);
    const pw = h('input', { type: 'password', minLength: 10, autocomplete: 'new-password', placeholder: 'Leeg laten om niet te wijzigen' });
    await modal({
      title: `${u.name} bewerken`,
      body: [field('Rol', r), field('Nieuw wachtwoord', pw)],
      buttons: [{ label: 'Annuleren' }, {
        label: 'Opslaan', class: 'primair',
        action: async () => {
          try {
            await api.patch(`/users/${u.id}`, { role: r.value, ...(pw.value && { password: pw.value }) });
            toast('Gebruiker bijgewerkt.');
            rerender();
            return true;
          } catch (err) {
            showError(err);
          }
        },
      }],
    });
  }

  return [
    h('h1', {}, 'Gebruikers'),
    h('div', { class: 'melding info' },
      'Rollen: social media managers en beheerders mogen AI-planningen goedkeuren. Medewerkers bewerken teksten en beeld. ',
      'Grafisch vormgevers bekijken, kopiëren en downloaden, en passen status en interne opmerkingen aan.'),
    form,
    h('table', { class: 'lijst' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Naam'), h('th', {}, 'E-mailadres'), h('th', {}, 'Rol'), h('th', {}, 'Sinds'), h('th', {}))),
      h('tbody', {}, users.map((u) => h('tr', {},
        h('td', {}, u.name, u.id === meta.user.id ? h('span', { class: 'zacht' }, ' (jij)') : null),
        h('td', {}, u.email), h('td', {}, roleLabel(u.role)), h('td', { class: 'zacht' }, fmtDateTime(u.created_at)),
        h('td', {}, h('button', { class: 'knop klein', onclick: () => edit(u) }, 'Bewerken')))))),
  ];
}
