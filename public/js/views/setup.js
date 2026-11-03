import { h, fill, icon, toast, showError, pageHead, page, initials } from '../ui.js';
import { api, meta, can } from '../api.js';

// Kanalen en frequentie van alle klanten in één tabel invullen. Elke wijziging wordt direct opgeslagen.
export async function clientSetupView({ query }) {
  if (!can('manageClients')) throw Object.assign(new Error('Alleen social media managers en beheerders kunnen klanten inrichten.'), { status: 403 });
  const clients = (await api.get('/clients')).filter((c) => !c.archived);
  let onlyOpen = query.get('alles') !== '1' && clients.some((c) => !c.channels.length);
  const done = () => clients.filter((c) => c.channels.length).length;

  const progress = h('span', { class: 'zacht' });
  const drawProgress = () => { progress.textContent = `${done()} van ${clients.length} klanten ingericht`; };
  drawProgress();

  async function save(c, patch, statusCell) {
    fill(statusCell, h('span', { class: 'laden', 'aria-label': 'Opslaan' }));
    try {
      const saved = await api.patch(`/clients/${c.id}`, patch);
      Object.assign(c, { channels: saved.channels, posts_per_week: saved.posts_per_week });
      fill(statusCell, h('span', { class: 'chip ok', title: 'Opgeslagen' }, icon('vink', { size: 13 }), 'Opgeslagen'));
      drawProgress();
    } catch (err) {
      fill(statusCell, h('span', { class: 'chip let-op' }, 'Niet opgeslagen'));
      showError(err);
    }
  }

  const tbody = h('tbody');
  const search = h('input', { type: 'search', placeholder: 'Zoek klant', 'aria-label': 'Zoek klant', oninput: () => draw() });

  function row(c) {
    const statusCell = h('td', { class: 'opslagstatus' }, c.channels.length ? null : h('span', { class: 'chip let-op' }, 'Nog invullen'));
    const boxes = meta.channels.map((ch) => h('td', { class: 'midden' },
      h('input', {
        type: 'checkbox', checked: c.channels.includes(ch.key), 'aria-label': `${c.name}: ${ch.label}`,
        onchange: (e) => {
          const channels = e.target.checked ? [...c.channels, ch.key] : c.channels.filter((k) => k !== ch.key);
          save(c, { channels: meta.channels.map((x) => x.key).filter((k) => channels.includes(k)) }, statusCell);
        },
      })));
    let timer;
    const ppw = h('input', {
      type: 'number', min: 1, max: 21, value: String(c.posts_per_week), class: 'smal', 'aria-label': `${c.name}: posts per week`,
      oninput: (e) => {
        clearTimeout(timer);
        const n = Number(e.target.value);
        if (!Number.isInteger(n) || n < 1 || n > 21) return;
        timer = setTimeout(() => save(c, { posts_per_week: n }, statusCell), 500);
      },
    });
    return h('tr', {},
      h('td', {}, h('a', { class: 'klantlink', href: `#/klant/${c.id}/instellingen`, title: 'Klantprofiel openen' },
        h('span', { class: 'initialen' }, initials(c.name)), c.name)),
      boxes, h('td', {}, ppw), statusCell);
  }

  function draw() {
    const q = search.value.trim().toLowerCase();
    const shown = clients.filter((c) => (!onlyOpen || !c.channels.length || c.justShown) && (!q || c.name.toLowerCase().includes(q)));
    // Een klant die je net invult, blijft zichtbaar tot je de filter wijzigt.
    shown.forEach((c) => { c.justShown = true; });
    fill(tbody, shown.length ? shown.map(row) : h('tr', {}, h('td', { colSpan: meta.channels.length + 3, class: 'zacht' }, q ? `Geen klant gevonden met "${search.value}".` : 'Alle klanten zijn ingericht.')));
  }
  const filterToggle = h('label', { class: 'vinkje' }, h('input', {
    type: 'checkbox', checked: onlyOpen,
    onchange: (e) => { onlyOpen = e.target.checked; clients.forEach((c) => { c.justShown = false; }); draw(); },
  }), 'Alleen klanten die nog niet zijn ingericht');
  draw();

  return page(
    pageHead({ title: 'Klanten inrichten', sub: 'Vink per klant de kanalen aan en vul het afgesproken aantal posts per week in. Alles wordt direct opgeslagen en blijft later aanpasbaar.' }),
    h('div', { class: 'filters' }, h('div', { class: 'zoekveld' }, icon('zoek', { size: 16 }), search), filterToggle, h('span', { class: 'teller' }, progress)),
    h('div', { class: 'tabel-wrap' }, h('table', { class: 'lijst inricht' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Klant'), meta.channels.map((ch) => h('th', { class: 'midden' }, ch.label)), h('th', {}, 'Posts per week'), h('th', {}, ''))),
      tbody)),
    h('p', { class: 'zacht', style: { marginTop: '14px' } }, 'Wat de klant doet, doelen, afspraken en contentpijlers vul je per klant in op het klantprofiel. Klik daarvoor op de klantnaam.'));
}
