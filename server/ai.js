// AI-functies: planningsvoorstel, teksten per kanaal en contentshoot-voorstellen.
// Zonder ANTHROPIC_API_KEY valt alles terug op een eenvoudige, voorspelbare voorbeeldgenerator,
// zodat de workflow altijd te testen is. AI-uitkomsten zijn altijd voorstellen.
import Anthropic from '@anthropic-ai/sdk';
import { CHANNELS } from './constants.js';
import { datesBetween, examplePlan, exampleTexts, exampleShoots } from '../src/ai/voorbeeld.js';

export { datesBetween, examplePlan };

export const MODEL = process.env.JCS_AI_MODEL ?? 'claude-opus-5-5';

export class AiError extends Error {}

let client = null;
export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
function getClient() {
  client ??= new Anthropic();
  return client;
}
// Alleen voor tests: vervangt de Claude-client door een nabootsing.
export function setClientForTests(fake) {
  client = fake;
}

// ---------- Privacy ----------

// Persoonsgegevens die de AI niet nodig heeft, worden vervangen voordat tekst de applicatie verlaat.
export function redact(text) {
  return String(text ?? '')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[e-mailadres]')
    .replace(/(?:\+|00)\d[\d\s-]{7,}\d|\b0\d(?:[\s-]?\d){8}\b/g, '[telefoonnummer]');
}

// Foto's met herkenbare gezichten zonder expliciete toestemming worden niet aan de AI aangeboden.
export const mediaAllowedForAi = (m) => !(m.has_recognizable_faces === 1 && m.ai_processing_allowed !== 1);

// ---------- Hulpfuncties ----------

const channelLabel = (key) => CHANNELS.find((c) => c.key === key)?.label ?? key;

const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
const isValidTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

async function callJson({ system, prompt, schema, maxTokens = 16000, effort = 'medium' }) {
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    // Bij een weigering door een veiligheidsfilter probeert de API automatisch een ander model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort, format: { type: 'json_schema', schema } },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
  });
  let message;
  try {
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AiError('De AI-sleutel is ongeldig.');
    if (err instanceof Anthropic.RateLimitError) throw new AiError('De AI is even overbelast. Probeer het zo opnieuw.');
    if (err instanceof Anthropic.APIError) throw new AiError(`AI-fout (${err.status ?? 'verbinding'}): ${err.message}`);
    throw err;
  }
  if (message.stop_reason === 'refusal') throw new AiError('De AI heeft dit verzoek geweigerd.');
  if (message.stop_reason === 'max_tokens') throw new AiError('Het AI-antwoord was te lang. Kies een kortere periode.');
  const text = message.content.find((b) => b.type === 'text')?.text;
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('De AI gaf geen bruikbaar antwoord. Probeer het opnieuw.');
  }
}

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

const SYSTEM = `Je bent de contentstrateeg van Jouw Social Studio, een Nederlands socialmediabureau.
Je werkt voor social media managers die content voorbereiden voor klanten.

Belangrijk over de werkwijze:
- Je doet alleen voorstellen. Een social media manager controleert en keurt alles goed.
- De contentkalender bevat teksten en originele, door de klant aangeleverde foto's en video's.
  Er worden geen opgemaakte posts gemaakt; een vormgever doet dat later buiten de applicatie.
- Gebruik alleen beeldmateriaal uit de meegegeven lijst (op id). Verzin geen beelden.
- Publicatietijden zijn adviezen, geen gegarandeerd optimale tijden.
- Schrijf in correct, natuurlijk Nederlands, tenzij de klantcontext anders aangeeft.`;

function clientContext(client) {
  return [
    `Klant: ${client.name}`,
    `Strategie: ${redact(client.strategy) || '(niet ingevuld)'}`,
    `Tone of voice: ${redact(client.tone_of_voice) || '(niet ingevuld)'}`,
    `Contentpijlers: ${client.content_pillars.join(', ') || '(geen)'}`,
    `Kanalen: ${client.channels.map(channelLabel).join(', ')}`,
    `Afgesproken frequentie: ${client.posts_per_week} posts per week`,
    `AI-klantgeheugen (eerdere afspraken en lessen):\n${redact(client.ai_memory) || '(leeg)'}`,
  ].join('\n');
}

// ---------- Planningsvoorstel ----------

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'note'],
  properties: {
    note: { type: 'string', description: 'Korte toelichting op de verdeling (max. 3 zinnen).' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'time', 'topic', 'channels', 'pillar', 'client_input_id', 'media_ids', 'rationale'],
        properties: {
          date: { type: 'string', description: 'JJJJ-MM-DD' },
          time: nullable({ type: 'string', description: 'UU:MM, voorgesteld tijdstip' }),
          topic: { type: 'string' },
          channels: { type: 'array', items: { type: 'string' } },
          pillar: nullable({ type: 'string' }),
          client_input_id: nullable({ type: 'string' }),
          media_ids: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
        },
      },
    },
  },
};

/**
 * Stelt een conceptplanning voor. Geeft { items, source, note } terug; items hebben de vorm van
 * src/planning/plan.js ({ date, time, topic, channels, pillar, clientInputId, media, rationale }).
 */
export async function proposePlan({ client, periodStart, periodEnd, inputs, media, occupied, wishes, previous }) {
  const allowedMedia = media.filter(mediaAllowedForAi);
  if (!aiAvailable()) {
    return { ...examplePlan({ client, periodStart, periodEnd, inputs, media: allowedMedia }), source: 'voorbeeld' };
  }

  const prompt = [
    clientContext(client),
    `\nPeriode: ${periodStart} t/m ${periodEnd}.`,
    `\nAangeleverde klantinput (id — inhoud):`,
    inputs.length ? inputs.map((i) => `- ${i.id} — ${i.title ? `${i.title}: ` : ''}${redact(i.body).slice(0, 1500)}${i.instructions ? ` [instructies: ${redact(i.instructions)}]` : ''}`).join('\n') : '(geen; maak algemene content op basis van de strategie)',
    `\nBeschikbaar beeldmateriaal (id — soort — bestandsnaam — beschrijving — tags — eerder gebruikt):`,
    allowedMedia.length ? allowedMedia.map((m) => `- ${m.id} — ${m.kind} — ${m.filename} — ${redact(m.description) || '-'} — ${m.tags.join(', ') || '-'} — ${m.times_used}x`).join('\n') : '(geen beeld beschikbaar)',
    `\nAl bezet in de kalender (datum + kanaal), niet dubbel inplannen:\n${occupied.map((o) => `${o.publish_date} ${o.channel}`).join('\n') || '(niets)'}`,
    previous ? `\nHuidige conceptplanning die opnieuw verdeeld moet worden (behoud de onderwerpen tenzij de wensen anders zeggen):\n${JSON.stringify(previous)}` : '',
    wishes ? `\nWensen van de social media manager: ${redact(wishes)}` : '',
    `\nOpdracht: stel een evenwichtige contentplanning voor deze periode voor.
- Houd je aan de afgesproken frequentie en spreid de posts gelijkmatig over de periode.
- Kies per onderwerp passende kanalen uit de kanalen van de klant (gebruik de sleutels: ${client.channels.join(', ')}).
- Verdeel de contentpijlers evenwichtig; gebruik relevante datums (feestdagen, seizoenen) waar het past.
- Koppel klantinput via client_input_id als een onderwerp daarop gebaseerd is.
- Kies passend beeld uit de lijst (media_ids), bij voorkeur beeld dat nog weinig gebruikt is. Leeg laten als niets past.
- Stel per post een tijdstip voor (UU:MM) als advies.
- Geef per onderwerp een korte reden (rationale).`,
  ].join('\n');

  const result = await callJson({ system: SYSTEM, prompt, schema: PLAN_SCHEMA });
  return { items: sanitizePlanItems(result.items, { client, periodStart, periodEnd, inputs, media: allowedMedia }), note: result.note ?? '', source: 'ai' };
}

// AI-uitvoer wordt nooit blind vertrouwd: alleen geldige datums, kanalen en bekende id's blijven over.
export function sanitizePlanItems(items, { client, periodStart, periodEnd, inputs, media }) {
  const inputIds = new Set(inputs.map((i) => i.id));
  const mediaIds = new Set(media.map((m) => m.id));
  return (items ?? [])
    .filter((it) => isValidDate(it.date) && it.date >= periodStart && it.date <= periodEnd && String(it.topic ?? '').trim())
    .map((it) => {
      const channels = [...new Set((it.channels ?? []).filter((c) => client.channels.includes(c)))];
      return {
        date: it.date,
        time: isValidTime(it.time ?? '') ? it.time : null,
        topic: String(it.topic).trim().slice(0, 300),
        channels: channels.length ? channels : [...client.channels],
        pillar: it.pillar && client.content_pillars.includes(it.pillar) ? it.pillar : (it.pillar || null),
        clientInputId: inputIds.has(it.client_input_id) ? it.client_input_id : null,
        media: [...new Set((it.media_ids ?? []).filter((id) => mediaIds.has(id)))],
        rationale: String(it.rationale ?? '').slice(0, 500),
        texts: {},
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    // Per datum mag elk kanaal maar één onderwerp hebben; latere dubbelingen vallen af.
    .reduce((acc, it) => {
      const taken = new Set(acc.filter((x) => x.date === it.date).flatMap((x) => x.channels));
      const channels = it.channels.filter((c) => !taken.has(c));
      return channels.length ? [...acc, { ...it, channels }] : acc;
    }, []);
}

// ---------- Teksten per kanaal ----------

const TEXTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['posts'],
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'texts'],
        properties: {
          index: { type: 'integer' },
          texts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['channel', 'text'],
              properties: { channel: { type: 'string' }, text: { type: 'string' } },
            },
          },
        },
      },
    },
  },
};

const CHANNEL_STYLE = {
  linkedin: 'zakelijk en inhoudelijk, 80–200 woorden, weinig emoji, eventueel 3–5 hashtags',
  facebook: 'toegankelijk en persoonlijk, 40–120 woorden, uitnodigend tot reactie',
  instagram: 'korter en beeldend, 30–80 woorden, passende emoji, 5–10 relevante hashtags onderaan',
  tiktok: 'heel kort en luchtig, 1–3 zinnen, inspelend op de video',
  youtube: 'beschrijvend, met een eerste zin die de video samenvat',
  pinterest: 'beschrijvend en zoekvriendelijk, 1–3 zinnen',
  x: 'kort en krachtig, maximaal 260 tekens',
};

/** Schrijft per post en per kanaal een tekst. posts: [{ topic, channels, pillar, input, media }]. */
export async function writeTexts({ client, posts }) {
  if (!aiAvailable()) return posts.map((p) => exampleTexts(client, p));

  const prompt = [
    clientContext(client),
    `\nSchrijf voor elke onderstaande post een aparte tekst per kanaal. Stijl per kanaal:`,
    ...client.channels.map((c) => `- ${c}: ${CHANNEL_STYLE[c] ?? 'passend bij het kanaal'}`),
    `\nDe tekst wordt naast originele klantfoto's of -video's geplaatst; beschrijf het beeld niet letterlijk maar sluit erop aan.`,
    `Gebruik alleen feiten uit de klantinput en strategie. Verzin geen prijzen, data of beloftes.`,
    `\nPosts:`,
    ...posts.map((p, index) => [
      `\n[${index}] ${p.date} — ${p.topic}`,
      `Kanalen: ${p.channels.join(', ')}`,
      p.pillar ? `Contentpijler: ${p.pillar}` : '',
      p.input ? `Klantinput: ${redact(p.input.body).slice(0, 2000)}${p.input.instructions ? `\nInstructies: ${redact(p.input.instructions)}` : ''}` : '',
      p.media.length ? `Beeld: ${p.media.map((m) => `${m.kind} "${m.filename}"${m.description ? ` (${redact(m.description)})` : ''}`).join('; ')}` : 'Beeld: nog niet gekozen',
    ].filter(Boolean).join('\n')),
  ].join('\n');

  const result = await callJson({ system: SYSTEM, prompt, schema: TEXTS_SCHEMA, maxTokens: 64000 });
  return posts.map((p, index) => {
    const entry = (result.posts ?? []).find((x) => x.index === index);
    const texts = {};
    for (const { channel, text } of entry?.texts ?? []) {
      if (p.channels.includes(channel) && text?.trim()) texts[channel] = text.trim();
    }
    return texts;
  });
}

// ---------- Contentshoot-voorstellen ----------

const SHOOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'body'],
        properties: { title: { type: 'string' }, body: { type: 'string' } },
      },
    },
  },
};

export async function suggestShoots({ client, media, recentTopics }) {
  if (!aiAvailable()) return exampleShoots(client);
  const counts = media.reduce((acc, m) => ({ ...acc, [m.kind]: (acc[m.kind] ?? 0) + 1 }), {});
  const prompt = [
    clientContext(client),
    `\nBeeldbibliotheek: ${counts.foto ?? 0} foto's, ${counts.video ?? 0} video's. Onbenut: ${media.filter((m) => m.times_used === 0).length}.`,
    `Tags in de bibliotheek: ${[...new Set(media.flatMap((m) => m.tags))].join(', ') || '(geen)'}`,
    `Recente onderwerpen: ${recentTopics.join('; ') || '(geen)'}`,
    `\nStel 3–6 concrete contentshoots voor die ontbrekend beeld aanvullen. Per voorstel: wat, waar, welke shots (foto/video, staand/liggend), voor welke pijler en kanalen.`,
  ].join('\n');
  const result = await callJson({ system: SYSTEM, prompt, schema: SHOOT_SCHEMA, effort: 'low' });
  return (result.suggestions ?? []).filter((s) => s.title?.trim() && s.body?.trim());
}
