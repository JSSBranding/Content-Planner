import { h, icon, field, toast, showError, page, modal } from '../ui.js';
import { api, meta, can } from '../api.js';
import { clientHeader } from './clients.js';

export function clientForm({ client, onSaved, onCancel }) {
  const readOnly = !can('manageClients');
  const c = client ?? { name: '', strategy: '', tone_of_voice: '', content_pillars: [], channels: [], posts_per_week: 3, ai_memory: '', context: '', target_audience: '', website: '', contact: '' };
  const context = h('textarea', { rows: 6, disabled: readOnly, value: c.context ?? '', placeholder: 'Wat doet het bedrijf, wat maakt het bijzonder, welke producten of diensten zijn belangrijk, wat speelt er nu?' });
  const audience = h('textarea', { rows: 3, disabled: readOnly, value: c.target_audience ?? '', placeholder: 'Bijv. gezinnen in de wijk, 30 tot 50 jaar; bedrijven in de regio voor catering' });
  const website = h('input', { type: 'text', disabled: readOnly, value: c.website ?? '', placeholder: 'www.voorbeeld.nl' });
  const contact = h('input', { type: 'text', disabled: readOnly, value: c.contact ?? '', placeholder: 'Naam en hoe je diegene bereikt' });
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
        context: context.value,
        target_audience: audience.value,
        website: website.value,
        contact: contact.value,
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
    h('div', { style: { display: 'grid', gap: '20px' } },
      h('div', { class: 'paneelblok' },
        h('h2', {}, 'Over de klant'), h('p', { class: 'zacht' }, 'De context achter alle content. Gaat ook mee naar de AI.'),
        field('Wat doet de klant?', context),
        field('Doelgroep', audience),
        h('div', { class: 'rij' }, field('Website', website), field('Contactpersoon', contact))),
      h('div', { class: 'paneelblok' },
        h('h2', {}, 'Basis'), h('p', { class: 'zacht' }, 'Wat er wanneer en waar gepost wordt.'),
        field('Klantnaam', name),
        h('div', { class: 'veld' }, h('label', {}, 'Kanalen'), h('div', { class: 'kanaalkeuze' }, channelBoxes)),
        field('Posts per week', ppw, 'De afgesproken frequentie. De AI plant hier omheen.'),
        field('Contentpijlers', pillars, pillarHelp))),
    h('div', { class: 'paneelblok' },
      h('h2', {}, 'Strategie en AI-geheugen'), h('p', { class: 'zacht' }, 'Gaat mee bij elk AI-voorstel en elke tekst. Telefoonnummers en e-mailadressen worden eerst weggelaten.'),
      field('Strategie', strategy, 'Doelen en wat de klant wil bereiken met social media.'),
      field('Tone of voice', tone),
      field('AI-klantgeheugen', memory, 'Vaste afspraken en lessen, bijv. "geen prijzen noemen", "altijd je-vorm", "liever minder LinkedIn".')))
    : [
      field('Klantnaam', name),
      h('div', { class: 'veld' }, h('label', {}, 'Kanalen'), h('div', { class: 'kanaalkeuze' }, channelBoxes)),
      h('div', { class: 'rij' }, field('Posts per week', ppw), h('div', { class: 'veld', style: { flex: '3 1 260px' } }, h('label', {}, 'Contentpijlers'), pillars, h('div', { class: 'hulp' }, pillarHelp))),
    ],
  readOnly ? h('p', { class: 'zacht' }, 'Alleen social media managers en chefkes kunnen het klantprofiel wijzigen.') :
    h('div', { class: 'knoppen', style: { marginTop: '16px' } }, h('button', { class: 'knop primair', type: 'submit' }, client ? 'Opslaan' : 'Klant toevoegen'),
      onCancel ? h('button', { class: 'knop', type: 'button', onclick: onCancel }, 'Annuleren') : null));
  return form;
}

// Verwijderen kan alleen door de klantnaam over te typen. Gebruikt op het klantprofiel en in de zijbalk.
export async function confirmDeleteClient(client) {
  const typed = h('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Klantnaam ter bevestiging' });
  const error = h('div', { class: 'melding fout', hidden: true }, 'De naam klopt niet. Typ hem precies over.');
  await modal({
    title: `${client.name} verwijderen?`,
    body: [
      h('p', {}, 'Alle posts in de kalender, conceptplanningen, klantinput, contentshoots en het beeld van deze klant worden definitief verwijderd. Dit kun je niet ongedaan maken.'),
      h('p', { class: 'zacht' }, 'Wil je de klant alleen uit beeld hebben? Kies dan voor archiveren; dan blijft alles bewaard.'),
      error,
      field(`Typ ${client.name} om te bevestigen`, typed),
    ],
    buttons: [{ label: 'Annuleren' }, {
      label: 'Definitief verwijderen', class: 'gevaar',
      action: async () => {
        if (typed.value.trim() !== client.name) { error.hidden = false; typed.focus(); return undefined; }
        try {
          await api.del(`/clients/${client.id}`, { confirmName: typed.value.trim() });
          toast(`${client.name} is verwijderd`);
          if (location.hash.includes(client.id)) location.hash = '#/';
          window.dispatchEvent(new CustomEvent('jcs:vernieuw'));
          return true;
        } catch (err) {
          showError(err);
        }
      },
    }],
  });
}

export async function settingsView({ clientId, tab, rerender }) {
  const { client, head } = await clientHeader(clientId, tab);

  async function toggleArchive() {
    try {
      await api.patch(`/clients/${client.id}`, { archived: !client.archived });
      toast(client.archived ? `${client.name} is weer actief` : `${client.name} is gearchiveerd`);
      rerender();
    } catch (err) {
      showError(err);
    }
  }

  const danger = can('manageClients') ? h('div', { class: 'paneelblok', style: { marginTop: '20px' } },
    h('h2', {}, 'Archiveren of verwijderen'),
    h('p', { class: 'zacht' }, 'Een gearchiveerde klant verdwijnt uit de zijbalk, maar alle gegevens blijven bewaard en je kunt hem altijd terugzetten.'),
    h('div', { class: 'knoppen' },
      h('button', { class: 'knop', type: 'button', onclick: toggleArchive }, client.archived ? 'Weer actief maken' : 'Archiveren'),
      h('button', { class: 'knop gevaar', type: 'button', onclick: () => confirmDeleteClient(client) }, icon('prullenbak', { size: 16 }), 'Klant verwijderen'))) : null;

  return page(head(), clientForm({ client, onSaved: () => rerender() }), danger);
}
