import { h, icon, field, toast, showError, modal, fmtDateTime, pageHead, page, initials } from '../ui.js';
import { api, meta, roleLabel } from '../api.js';

const roleSelect = (value) => h('select', { value }, meta.roles.map((r) => h('option', { value: r.key }, r.label)));

export async function usersView({ rerender }) {
  const users = await api.get('/users');

  const name = h('input', { type: 'text', required: true });
  const email = h('input', { type: 'email', required: true });
  const role = roleSelect('social_media_manager');
  const password = h('input', { type: 'password', required: true, minLength: 10, autocomplete: 'new-password' });
  const form = h('form', {
    class: 'paneelblok',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api.post('/users', { name: name.value, email: email.value, role: role.value, password: password.value });
        toast('Collega toegevoegd. Geef het wachtwoord persoonlijk door.');
        rerender();
      } catch (err) {
        showError(err);
      }
    },
  }, h('h2', {}, 'Collega toevoegen'),
  h('p', { class: 'zacht' }, 'Geef het tijdelijke wachtwoord persoonlijk door.'),
  field('Naam', name), field('E-mailadres', email), field('Rol', role), field('Tijdelijk wachtwoord', password, 'Minimaal 10 tekens.'),
  h('button', { class: 'knop primair', type: 'submit', style: { width: '100%' } }, icon('plus', { size: 16 }), 'Toevoegen'));

  async function edit(u) {
    const r = roleSelect(u.role);
    const pw = h('input', { type: 'password', minLength: 10, autocomplete: 'new-password', placeholder: 'Leeg laten om niet te wijzigen' });
    await modal({
      title: `${u.name} wijzigen`,
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

  const rights = meta.roles.map((r) => [r.label, r.description]);
  return page(pageHead({ title: 'Team en rechten', sub: `${users.length} ${users.length === 1 ? 'persoon heeft' : 'mensen hebben'} toegang` }),
    h('div', { class: 'zij-kolom' },
      h('div', {},
        h('table', { class: 'lijst sectie' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Naam'), h('th', {}, 'Rol'), h('th', {}, 'Sinds'), h('th', {}))),
          h('tbody', {}, users.map((u) => h('tr', {},
            h('td', {}, h('div', { class: 'knoppen', style: { flexWrap: 'nowrap' } },
              h('span', { class: 'initialen', style: { width: '32px', height: '32px', borderRadius: '50%', background: 'var(--inkt)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: '12px', fontWeight: 600, flex: 'none' } }, initials(u.name)),
              h('div', {}, h('div', { style: { fontWeight: 500 } }, u.name, u.id === meta.user.id ? h('span', { class: 'zacht' }, ' (jij)') : null), h('div', { class: 'zacht' }, u.email)))),
            h('td', {}, roleLabel(u.role)), h('td', { class: 'zacht' }, fmtDateTime(u.created_at)),
            h('td', { style: { textAlign: 'right' } }, h('button', { class: 'knop klein', onclick: () => edit(u) }, 'Wijzigen')))))),
        h('div', { class: 'paneelblok' }, h('h2', {}, 'Wat mag elke rol?'),
          h('div', { style: { display: 'grid', gap: '8px', marginTop: '12px' } }, rights.map(([r, t]) => h('div', {}, h('strong', { style: { fontWeight: 600 } }, r), h('span', { class: 'zacht' }, `: ${t}`)))))),
      form));
}
