import { h, icon, field, toast, showError, page } from '../ui.js';
import { api, meta, can } from '../api.js';
import { clientHeader } from './clients.js';

export function clientForm({ client, onSaved, onCancel }) {
  const readOnly = !can('manageClients');
  const c = client ?? { name: '', strategy: '', tone_of_voice: '', content_pillars: [], channels: [], posts_per_week: 3, ai_memory: '' };
  const name = h('input', { type: 'text', value: c.name, required: true, disabled: readOnly });
  const strategy = h('textarea', { rows: 5, disabled: readOnly, value: c.strategy });
  const tone = h('textarea', { rows: 3, disabled: readOnly, value: c.tone_of_voice });
  const pillars = h('textarea', { rows: 4, disabled: readOnly, value: c.content_pillars.join('\n') });
  const ppw = h('input', { type: 'number', min: 1, max: 21, value: String(c.posts_per_week), disabled: readOnly });
  const memory = h('textarea', { rows: 8, disabled: readOnly, value: c.ai_memory });
  const archived = h('input', { type: 'checkbox', checked: Boolean(c.archived), disabled: readOnly });
  const channelBoxes = meta.channels.map((ch) => h('label', {},
    h('input', { type: 'checkbox', value: ch.key, checked: c.channels.includes(ch.key), disabled: readOnly }), ch.label));
  const pillarHelp = 'Eén pijler per regel, bijv. Vakmanschap, Team, Aanbod.';

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const body = {
        name: name.value,
        strategy: strategy.value,
        tone_of_voice: tone.value,
        content_pillars: pillars.value.split('\n').map((s) => s.trim()).filter(Boolean),
        channels: channelBoxes.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value),
        posts_per_week: Number(ppw.value),
        ai_memory: memory.value,
        archived: archived.checked,
      };
      try {
        const saved = client ? await api.patch(`/clients/${client.id}`, body) : await api.post('/clients', body);
        toast(client ? 'Klantprofiel opgeslagen' : 'Klant toegevoegd');
        onSaved?.(saved);
      } catch (err) {
        showError(err);
      }
    },
  },
  client ? h('div', { class: 'twee-kolommen' },
    h('div', { class: 'paneelblok' },
      h('h2', {}, 'Basis'), h('p', { class: 'zacht' }, 'Wat er wanneer en waar gepost wordt.'),
      field('Klantnaam', name),
      h('div', { class: 'veld' }, h('label', {}, 'Kanalen'), h('div', { class: 'kanaalkeuze' }, channelBoxes)),
      field('Posts per week', ppw, 'De afgesproken frequentie. De AI plant hier omheen.'),
      field('Contentpijlers', pillars, pillarHelp),
      h('label', { class: 'vinkje' }, archived, 'Klant archiveren')),
    h('div', { class: 'paneelblok' },
      h('h2', {}, 'Strategie en AI-geheugen'), h('p', { class: 'zacht' }, 'Gaat mee bij elk AI-voorstel en elke tekst. Telefoonnummers en e-mailadressen worden eerst weggelaten.'),
      field('Strategie', strategy, 'Doelen, doelgroep en wat de klant wil uitstralen.'),
      field('Tone of voice', tone),
      field('AI-klantgeheugen', memory, 'Vaste afspraken en lessen, bijv. "geen prijzen noemen", "altijd je-vorm", "liever minder LinkedIn".')))
    : [
      field('Klantnaam', name),
      h('div', { class: 'veld' }, h('label', {}, 'Kanalen'), h('div', { class: 'kanaalkeuze' }, channelBoxes)),
      h('div', { class: 'rij' }, field('Posts per week', ppw), h('div', { class: 'veld', style: { flex: '3 1 260px' } }, h('label', {}, 'Contentpijlers'), pillars, h('div', { class: 'hulp' }, pillarHelp))),
    ],
  readOnly ? h('p', { class: 'zacht' }, 'Alleen social media managers en beheerders kunnen het klantprofiel wijzigen.') :
    h('div', { class: 'knoppen', style: { marginTop: '16px' } }, h('button', { class: 'knop primair', type: 'submit' }, client ? 'Opslaan' : 'Klant toevoegen'),
      onCancel ? h('button', { class: 'knop', type: 'button', onclick: onCancel }, 'Annuleren') : null));
  return form;
}

export async function settingsView({ clientId, tab, rerender }) {
  const { client, head } = await clientHeader(clientId, tab);
  return page(head(), clientForm({ client, onSaved: () => rerender() }));
}
