import { h, icon, field, toast, showError, modal, fmtDateTime, pageHead, page, initials } from '../ui.js';
import { api, meta, roleLabel, loadMeta } from '../api.js';

const roleSelect = (value) => h('select', { value }, meta.roles.map((r) => h('option', { value: r.key }, r.label)));

// Accounts horen bij een rol, niet bij een persoon: de naam is de rol, tenzij je zelf iets anders invult.
export async function usersView({ rerender }) {
  const users = await api.get('/users');

  const role = roleSelect('social_media_manager');
  const email = h('input', { type: 'email', required: true, placeholder: 'smm@jouwsocialstudio.nl' });
  const password = h('input', { type: 'password', required: true, minLength: 10, autocomplete: 'new-password' });
  const form = h('form', {
    class: 'paneelblok',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api.post('/users', { role: role.value, email: email.value, password: password.value });
        toast(`Account voor ${roleLabel(role.value)} toegevoegd`);
        rerender();
      } catch (err) {
        showError(err);
      }
    },
  }, h('h2', {}, 'Account toevoegen'),
  h('p', { class: 'zacht' }, 'Eén account per rol of team. Deel het wachtwoord alleen met wie het nodig heeft.'),
  field('Rol', role), field('E-mailadres om mee in te loggen', email), field('Wachtwoord', password, 'Minimaal 10 tekens.'),
  h('button', { class: 'knop primair', type: 'submit', style: { width: '100%' } }, icon('plus', { size: 16 }), 'Account toevoegen'));

  async function edit(u) {
    const r = roleSelect(u.role);
    const pw = h('input', { type: 'password', minLength: 10, autocomplete: 'new-password', placeholder: 'Leeg laten om niet te wijzigen' });
    await modal({
      title: `Account ${u.email} wijzigen`,
      body: [field('Rol', r), field('Nieuw wachtwoord', pw)],
      buttons: [{ label: 'Annuleren' }, {
        label: 'Opslaan', class: 'primair',
        action: async () => {
          try {
            await api.patch(`/users/${u.id}`, { role: r.value, ...(r.value !== u.role && u.name === roleLabel(u.role) && { name: roleLabel(r.value) }), ...(pw.value && { password: pw.value }) });
            toast('Account bijgewerkt');
            rerender();
            return true;
          } catch (err) {
            showError(err);
          }
        },
      }],
    });
  }

  // ---------- Rechten per rol ----------

  const boxes = {};
  const byKey = Object.fromEntries(meta.permissionList.map((p) => [p.key, p]));
  // Logisch houden: aanvinken neemt het benodigde recht mee, uitvinken haalt wat ervan afhangt weg.
  function cascade(permKey, role, checked) {
    if (checked && byKey[permKey].requires) {
      const box = boxes[byKey[permKey].requires][role];
      if (!box.checked) { box.checked = true; cascade(byKey[permKey].requires, role, true); }
    }
    if (!checked) {
      for (const p of meta.permissionList.filter((x) => x.requires === permKey)) {
        const box = boxes[p.key][role];
        if (box.checked && !box.disabled) { box.checked = false; cascade(p.key, role, false); }
      }
    }
  }
  const matrix = h('table', { class: 'lijst rechten' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Recht'), meta.roles.map((r) => h('th', { class: 'midden' }, r.label)))),
    h('tbody', {}, meta.permissionList.map((p) => h('tr', { class: p.everyone ? 'vast' : '' },
      h('td', {},
        h('div', { style: { fontWeight: 500 } }, p.label, p.everyone ? h('span', { class: 'chip', style: { marginLeft: '8px' } }, 'Iedereen') : null),
        h('div', { class: 'zacht' }, p.description),
        p.requires ? h('div', { class: 'zacht', style: { fontSize: '12px', marginTop: '2px' } }, `Inclusief: ${byKey[p.requires].label.toLowerCase()}`) : null),
      meta.roles.map((r) => {
        const locked = p.everyone || (p.key === 'manageUsers' && r.key === 'admin');
        const box = h('input', {
          type: 'checkbox', checked: p.everyone || meta.permissions[p.key]?.includes(r.key), disabled: locked,
          'aria-label': `${r.label}: ${p.label}`, title: p.everyone ? 'Iedereen kan dit altijd' : locked ? 'Chefkes houden dit recht altijd' : null,
          onchange: (e) => { cascade(p.key, r.key, e.target.checked); saveBar.hidden = false; },
        });
        (boxes[p.key] ??= {})[r.key] = box;
        return h('td', { class: 'midden' }, box);
      })))));

  const saveBar = h('div', { class: 'knoppen', hidden: true, style: { marginTop: '12px' } },
    h('button', {
      class: 'knop primair', onclick: async () => {
        const permissions = Object.fromEntries(Object.entries(boxes).map(([p, byRole]) => [p, Object.entries(byRole).filter(([, b]) => b.checked).map(([r]) => r)]));
        try {
          await api.put('/permissions', { permissions });
          await loadMeta();
          toast('Rechten opgeslagen');
          rerender();
        } catch (err) {
          showError(err);
        }
      },
    }, 'Rechten opslaan'),
    h('button', { class: 'knop', onclick: () => rerender() }, 'Annuleren'));

  return page(pageHead({ title: 'Team en rechten', sub: `${users.length} account${users.length === 1 ? '' : 's'}` }),
    h('div', { class: 'zij-kolom' },
      h('div', {},
        h('table', { class: 'lijst sectie' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Account'), h('th', {}, 'Rol'), h('th', {}, 'Sinds'), h('th', {}))),
          h('tbody', {}, users.map((u) => h('tr', {},
            h('td', {}, h('div', { class: 'knoppen', style: { flexWrap: 'nowrap' } },
              h('span', { class: 'initialen', style: { width: '32px', height: '32px', borderRadius: '50%', background: 'var(--inkt)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: '12px', fontWeight: 600, flex: 'none' } }, initials(u.name)),
              h('div', {}, h('div', { style: { fontWeight: 500 } }, u.email, u.id === meta.user.id ? h('span', { class: 'zacht' }, ' (jij)') : null)))),
            h('td', {}, roleLabel(u.role)), h('td', { class: 'zacht' }, fmtDateTime(u.created_at)),
            h('td', { style: { textAlign: 'right' } }, h('button', { class: 'knop klein', onclick: () => edit(u) }, 'Wijzigen')))))),
        h('div', { class: 'paneelblok' },
          h('h2', {}, 'Wie mag wat?'),
          h('p', { class: 'zacht' }, 'Vink per rol aan wat die mag. De kalender gebruiken, inclusief status op Volledig ingepland zetten, kan iedereen altijd. Wijzigingen gelden direct voor iedereen met die rol.'),
          h('div', { class: 'tabel-wrap' }, matrix),
          saveBar)),
      form));
}
