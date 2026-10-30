import { h, field, toast, showError } from '../ui.js';
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
        toast('Klant opgeslagen.');
        onSaved?.(saved);
      } catch (err) {
        showError(err);
      }
    },
  },
  h('div', { class: 'twee-kolommen' },
    h('div', {},
      field('Klantnaam', name),
      field('Strategie', strategy, 'Doelen, doelgroep, propositie. De AI gebruikt dit voor elk voorstel.'),
      field('Tone of voice', tone),
      field('Contentpijlers', pillars, 'Eén pijler per regel.')),
    h('div', {},
      h('div', { class: 'veld' }, h('label', {}, 'Kanalen'), h('div', { class: 'kanaalkeuze' }, channelBoxes)),
      field('Afgesproken publicatiefrequentie (posts per week)', ppw),
      field('AI-klantgeheugen', memory, 'Vaste afspraken, voorkeuren en lessen ("geen prijzen noemen", "altijd je-vorm", "klant wil minder LinkedIn"). Wordt bij elk AI-verzoek meegegeven.'),
      client ? h('div', { class: 'veld' }, h('label', { class: 'vinkje' }, archived, 'Klant archiveren')) : null)),
  readOnly ? h('p', { class: 'zacht' }, 'Alleen social media managers en beheerders kunnen het klantprofiel wijzigen.') :
    h('div', { class: 'knoppen' }, h('button', { class: 'knop primair', type: 'submit' }, 'Opslaan'),
      onCancel ? h('button', { class: 'knop', type: 'button', onclick: onCancel }, 'Annuleren') : null));
  return form;
}

export async function settingsView({ clientId, tab, rerender }) {
  const { client, header } = await clientHeader(clientId, tab);
  return [
    ...header,
    h('div', { class: 'melding info' }, 'De AI krijgt bij elk voorstel deze strategie, pijlers, kanalen, frequentie en het AI-klantgeheugen mee. Telefoonnummers en e-mailadressen worden vooraf weggelaten.'),
    clientForm({ client, onSaved: () => rerender() }),
  ];
}
