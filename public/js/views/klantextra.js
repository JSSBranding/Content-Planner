// Extra onderdelen van het klantprofiel: belangrijke dagen (branches en eigen dagen),
// terugkerende posts (optie) en afspraken laten voorstellen voor het klantgeheugen.
import { h, fill, icon, field, toast, showError, modal, busy, confirmDialog, fmtLongDate } from '../ui.js';
import { api, meta, can, channelLabel } from '../api.js';
import { BRANCHES, describeRhythm } from '../../gedeeld/dagen.js';

const fmtDayMonth = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long' });

// ---------- Belangrijke dagen ----------

export function importantDaysBlock(client) {
  const editable = can('manageClients');
  let branches = [...(client.branches ?? [])];
  let ownDays = [...(client.own_days ?? [])];

  async function save(patch, message) {
    try {
      const saved = await api.patch(`/clients/${client.id}`, patch);
      branches = saved.branches;
      ownDays = saved.own_days;
      Object.assign(client, { branches, own_days: ownDays });
      toast(message);
      draw();
    } catch (err) {
      showError(err);
      draw();
    }
  }

  const host = h('div');
  function draw() {
    fill(host,
      h('div', { class: 'veld' },
        h('label', {}, 'Branche'),
        h('p', { class: 'hulp', style: { marginTop: 0 } }, 'De vakdagen van deze branche staan in de kalender en de AI neemt ze mee in voorstellen.'),
        h('div', { class: 'kanaalkeuze' }, BRANCHES.map((b) => h('label', { title: b.days.map((d) => d.at(-1)).join(', ') },
          h('input', {
            type: 'checkbox', checked: branches.includes(b.key), disabled: !editable,
            onchange: (e) => save({ branches: e.target.checked ? [...branches, b.key] : branches.filter((k) => k !== b.key) }, 'Branche opgeslagen'),
          }), b.label)))),
      h('div', { class: 'veld' },
        h('div', { class: 'tekstkop' }, h('label', {}, 'Eigen belangrijke dagen'),
          editable ? h('button', { type: 'button', class: 'knop klein', onclick: () => editDay(null) }, icon('plus', { size: 15 }), 'Dag toevoegen') : null),
        h('p', { class: 'hulp', style: { marginTop: 0 } }, 'Bijvoorbeeld de opening, een jubileum, een beurs of een vaste actie. Staat altijd in de kalender en gaat mee in de planning.'),
        ownDays.length ? h('ul', { class: 'dagenlijst' }, ownDays.map((d, i) => h('li', {},
          h('span', { class: 'datum' }, d.yearly ? `${fmtDayMonth.format(new Date(`${d.date}T12:00:00`))}, elk jaar` : fmtLongDate(d.date)),
          h('span', { class: 'naam' }, d.name),
          editable ? h('span', { class: 'acties' },
            h('button', { type: 'button', class: 'knop klein kaal', onclick: () => editDay(i) }, 'Wijzigen'),
            h('button', { type: 'button', class: 'knop klein kaal icoonknop', 'aria-label': `${d.name} verwijderen`, title: 'Verwijderen',
              onclick: async () => { if (await confirmDialog('Dag verwijderen?', `"${d.name}" wordt verwijderd.`, { confirmLabel: 'Verwijderen', danger: true })) save({ own_days: ownDays.filter((_, x) => x !== i) }, 'Dag verwijderd'); } },
            icon('prullenbak', { size: 15 }))) : null)))
          : h('p', { class: 'zacht' }, 'Nog geen eigen dagen.')));
  }

  async function editDay(index) {
    const current = index == null ? null : ownDays[index];
    const name = h('input', { type: 'text', value: current?.name ?? '', placeholder: 'Bijv. 10 jaar in deze straat' });
    const date = h('input', { type: 'date', value: current?.date ?? '' });
    const yearly = h('input', { type: 'checkbox', checked: current ? current.yearly : true });
    const error = h('div', { class: 'melding fout', hidden: true, role: 'alert' });
    await modal({
      title: current ? 'Dag wijzigen' : 'Belangrijke dag toevoegen', width: '480px',
      body: [error, field('Naam', name), field('Datum', date), h('label', { class: 'vinkje' }, yearly, 'Elk jaar op deze datum')],
      buttons: [{ label: 'Annuleren' }, {
        label: current ? 'Opslaan' : 'Toevoegen', class: 'primair',
        action: async () => {
          if (!name.value.trim() || !date.value) { error.textContent = 'Vul een naam en datum in.'; error.hidden = false; return undefined; }
          const day = { date: date.value, name: name.value.trim(), yearly: yearly.checked };
          await save({ own_days: current ? ownDays.map((d, i) => (i === index ? day : d)) : [...ownDays, day] }, current ? 'Dag opgeslagen' : 'Dag toegevoegd');
          return true;
        },
      }],
    });
  }

  draw();
  return h('section', { class: 'paneelblok', style: { marginTop: '20px' } },
    h('h2', {}, 'Belangrijke dagen'),
    h('p', { class: 'zacht' }, 'Naast de algemene feest- en actiedagen: vakdagen van de branche en dagen die alleen voor deze klant belangrijk zijn.'),
    host);
}

// ---------- Terugkerende posts (optie) ----------

const WEEKDAYS = [[1, 'maandag'], [2, 'dinsdag'], [3, 'woensdag'], [4, 'donderdag'], [5, 'vrijdag'], [6, 'zaterdag'], [7, 'zondag']];

export function recurringBlock(client) {
  const editable = can('manageClients');
  let rules = [...(client.recurring ?? [])];

  async function save(next, message) {
    try {
      const saved = await api.patch(`/clients/${client.id}`, { recurring: next });
      rules = saved.recurring;
      client.recurring = rules;
      toast(message);
      draw();
      return true;
    } catch (err) {
      showError(err);
      return false;
    }
  }

  const host = h('div');
  function draw() {
    fill(host, rules.length ? h('ul', { class: 'regellijst' }, rules.map((r, i) => h('li', { class: r.active ? '' : 'uit' },
      h('label', { class: 'schakelaar', title: r.active ? 'Staat aan' : 'Staat uit' },
        h('input', { type: 'checkbox', checked: r.active, disabled: !editable, 'aria-label': `${r.title} aan of uit`,
          onchange: (e) => save(rules.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)), e.target.checked ? 'Terugkerende post staat aan' : 'Terugkerende post staat uit') }),
        h('span', { class: 'knopje' })),
      h('div', { class: 'wat' },
        h('strong', {}, r.title),
        h('div', { class: 'zacht' }, `${describeRhythm(r)}${r.time ? ` om ${r.time}` : ''} op ${r.channels.map(channelLabel).join(', ')}${r.pillar ? `, pijler ${r.pillar}` : ''}`)),
      editable ? h('span', { class: 'acties' },
        h('button', { type: 'button', class: 'knop klein kaal', onclick: () => editRule(i) }, 'Wijzigen'),
        h('button', { type: 'button', class: 'knop klein kaal icoonknop', title: 'Verwijderen', 'aria-label': `${r.title} verwijderen`,
          onclick: async () => { if (await confirmDialog('Terugkerende post verwijderen?', `"${r.title}" wordt niet meer voorgesteld. Posts die al in de kalender staan, blijven staan.`, { confirmLabel: 'Verwijderen', danger: true })) save(rules.filter((_, j) => j !== i), 'Verwijderd'); } },
        icon('prullenbak', { size: 15 }))) : null)))
      : h('p', { class: 'zacht' }, 'Nog geen terugkerende posts. Deze optie is helemaal vrijblijvend.'));
  }

  async function editRule(index) {
    const r = index == null ? { rhythm: 'week', weekday: 1, day: 1, nth: 1, channels: [...client.channels], active: true } : rules[index];
    const title = h('input', { type: 'text', value: r.title ?? '', placeholder: 'Bijv. Weekstart, of Actie van de maand' });
    const rhythm = h('select', { value: r.rhythm },
      h('option', { value: 'week' }, 'Elke week'), h('option', { value: 'twee-weken' }, 'Om de week'),
      h('option', { value: 'maand-weekdag' }, 'Elke maand op een vaste weekdag'), h('option', { value: 'maand-dag' }, 'Elke maand op een vaste datum'));
    const weekday = h('select', { value: String(r.weekday ?? 1) }, WEEKDAYS.map(([v, l]) => h('option', { value: String(v) }, l)));
    const nth = h('select', { value: String(r.nth ?? 1) }, [[1, 'eerste'], [2, 'tweede'], [3, 'derde'], [4, 'vierde'], [-1, 'laatste']].map(([v, l]) => h('option', { value: String(v) }, l)));
    const day = h('input', { type: 'number', min: 1, max: 31, value: String(r.day ?? 1), class: 'smal' });
    const start = h('input', { type: 'date', value: r.start ?? '' });
    const time = h('input', { type: 'time', value: r.time ?? '' });
    const pillar = h('select', { value: r.pillar ?? '' }, h('option', { value: '' }, 'Geen pijler'), client.content_pillars.map((p) => h('option', { value: p }, p)));
    const channelsAll = meta.channels.map((c) => c.key);
    const channelBoxes = channelsAll.map((ch) => h('label', { hidden: client.channels.length > 0 && !client.channels.includes(ch) && !r.channels.includes(ch) },
      h('input', { type: 'checkbox', value: ch, checked: r.channels.includes(ch) }), channelLabel(ch)));
    const fields = {
      week: [field('Op', weekday)], 'twee-weken': [field('Eerste keer op', start, 'Daarna om de week op dezelfde dag.')],
      'maand-weekdag': [h('div', { class: 'rij' }, field('De', nth), field('Dag', weekday))], 'maand-dag': [field('Dag van de maand', day, 'Bestaat de dag niet (bijv. 31 in april), dan de laatste dag van de maand.')],
    };
    const when = h('div');
    const drawWhen = () => fill(when, fields[rhythm.value]);
    rhythm.addEventListener('change', drawWhen);
    drawWhen();
    const error = h('div', { class: 'melding fout', hidden: true, role: 'alert' });
    await modal({
      title: index == null ? 'Terugkerende post toevoegen' : 'Terugkerende post wijzigen', width: '560px',
      body: [
        error,
        h('p', { class: 'zacht' }, 'Je zet deze posts zelf in de kalender met de knop "Terugkerende posts" boven de kalender. Er wordt nooit iets overschreven: staat er al een post, dan wordt die dag overgeslagen.'),
        field('Onderwerp', title), field('Hoe vaak', rhythm), when,
        h('div', { class: 'rij' }, field('Tijd (voorstel)', time), field('Contentpijler', pillar)),
        h('div', { class: 'veld' }, h('label', {}, 'Kanalen'), h('div', { class: 'kanaalkeuze' }, channelBoxes)),
      ],
      buttons: [{ label: 'Annuleren' }, {
        label: index == null ? 'Toevoegen' : 'Opslaan', class: 'primair',
        action: async () => {
          const rule = {
            id: r.id, title: title.value, rhythm: rhythm.value, weekday: Number(weekday.value), nth: Number(nth.value), day: Number(day.value),
            start: start.value || null, time: time.value || null, pillar: pillar.value || null, active: r.active !== false,
            channels: channelBoxes.map((l) => l.querySelector('input')).filter((x) => x.checked).map((x) => x.value),
          };
          const next = index == null ? [...rules, rule] : rules.map((x, j) => (j === index ? rule : x));
          try {
            const saved = await api.patch(`/clients/${client.id}`, { recurring: next });
            rules = saved.recurring;
            client.recurring = rules;
            toast(index == null ? 'Terugkerende post toegevoegd' : 'Terugkerende post opgeslagen');
            draw();
            return true;
          } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
            return undefined;
          }
        },
      }],
    });
  }

  draw();
  return h('section', { class: 'paneelblok', style: { marginTop: '20px' } },
    h('div', { class: 'tekstkop' }, h('h2', { style: { margin: 0, flex: 1 } }, 'Terugkerende posts ', h('span', { class: 'chip' }, 'Optie')),
      editable ? h('button', { type: 'button', class: 'knop klein', onclick: () => editRule(null) }, icon('plus', { size: 15 }), 'Terugkerende post toevoegen') : null),
    h('p', { class: 'zacht' }, 'Vaste posts die steeds terugkomen, zoals elke maandag een weekstart of elke eerste vrijdag een actie. Ze komen niet vanzelf in de kalender: je plaatst ze per maand met één klik, als lege placeholder om in te vullen.'),
    host);
}

// ---------- Klantgeheugen: afspraken laten voorstellen ----------

export function suggestMemoryButton(client, memoryField) {
  if (!can('manageClients')) return null;
  return h('button', {
    type: 'button', class: 'knop klein', style: { marginTop: '8px' },
    title: 'De AI kijkt hoe het team AI-teksten aanpaste en wat er in opmerkingen en klantinstructies staat',
    onclick: async () => {
      let res;
      try {
        res = await busy('Afspraken zoeken in aanpassingen en opmerkingen', () => api.post(`/clients/${client.id}/afspraken-voorstel`));
      } catch (err) {
        return showError(err);
      }
      if (!res.suggestions.length) {
        return modal({
          title: 'Geen nieuwe afspraken gevonden',
          body: h('p', {}, `Er is gekeken naar ${res.basedOn.edits} aangepaste AI-teksten en ${res.basedOn.notes} opmerkingen en instructies. Daar kwamen geen nieuwe afspraken uit. Probeer het opnieuw als het team meer teksten heeft aangepast.`),
          buttons: [{ label: 'Sluiten', class: 'primair', value: true }],
        });
      }
      const boxes = res.suggestions.map((s) => ({ s, box: h('input', { type: 'checkbox', checked: true }) }));
      const ok = await modal({
        title: 'Voorgestelde afspraken', width: '600px',
        body: [
          h('p', { class: 'zacht' }, `Op basis van ${res.basedOn.edits} aangepaste AI-teksten en ${res.basedOn.notes} opmerkingen en instructies. Vink aan wat erbij mag; de rest wordt niet bewaard.`),
          h('ul', { class: 'voorstellijst' }, boxes.map(({ s, box }) => h('li', {}, h('label', { class: 'vinkje' }, box, h('span', {}, h('strong', {}, s.rule), h('span', { class: 'zacht' }, s.reason)))))),
        ],
        buttons: [{ label: 'Annuleren' }, { label: 'Toevoegen aan afspraken', class: 'primair', value: true }],
      });
      if (!ok) return;
      const chosen = boxes.filter((b) => b.box.checked).map((b) => b.s.rule);
      if (!chosen.length) return;
      const next = [memoryField.value.trim(), ...chosen].filter(Boolean).join('\n');
      try {
        await api.patch(`/clients/${client.id}`, { ai_memory: next });
        memoryField.value = next;
        client.ai_memory = next;
        toast(`${chosen.length} afspra${chosen.length === 1 ? 'ak' : 'ken'} toegevoegd`);
      } catch (err) {
        showError(err);
      }
    },
  }, icon('sparkle', { size: 15 }), 'Afspraken laten voorstellen');
}
