// Voorbeeldgegevens voor de demoversie. Bakkerij De Vries is een verzonnen voorbeeldklant;
// de overige klantnamen komen uit db/startklanten.txt en starten, net als in de echte app, zonder inrichting.
import { START_CLIENTS } from './startklanten.js';
import { CAN, normalizePermissions } from './lib/constants.js';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
let counter = 0;
const id = (prefix) => `${prefix}-${++counter}`;

// ---------- Voorbeeldteksten per kanaal ----------

const tag = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
const firstSentence = (text) => {
  const clean = String(text ?? '').split('\n').map((l) => l.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} — [^:]+: /, '').trim()).filter(Boolean)[0] ?? '';
  return clean.length > 220 ? `${clean.slice(0, 217)}…` : clean;
};

/** Een geloofwaardige voorbeeldtekst; in de echte versie schrijft de AI deze op basis van de klantcontext. */
export function demoText(client, { topic, pillar, input, variant = 0 }, channel) {
  const base = input ? firstSentence(input.body) : '';
  const tags = [tag(client.name), tag(pillar) || 'lokaal'].filter(Boolean).map((t) => `#${t}`).join(' ');
  const closers = [
    'Kom gerust langs, we vertellen je er graag meer over.',
    'Laat in de reacties weten wat jij ervan vindt!',
    'Tot snel bij ons in de zaak.',
  ];
  const closer = closers[Math.abs(Number(variant) || topic.length) % closers.length];
  switch (channel) {
    case 'linkedin':
      return `${topic}\n\n${base || `Bij ${client.name} draait alles om aandacht voor het vak.`} Daar zijn we trots op, en dat willen we graag laten zien.\n\nBenieuwd hoe wij werken? Neem gerust contact met ons op.\n\n${tags}`;
    case 'facebook':
      return `${base || topic}\n\n${closer}`;
    case 'instagram':
      return `${topic} ✨\n\n${base ? `${base}\n\n` : ''}${tags} #ondernemen`;
    default:
      return base ? `${topic}: ${base}` : topic;
  }
}

// ---------- Bakkerij De Vries ----------

const BAKKERIJ_POSTS = [
  { topic: 'Onze nieuwe steenoven staat', pillar: 'Vakmanschap', media: 'oven',
    linkedin: 'Een investering in vakmanschap: sinds deze maand bakken we al ons brood in een nieuwe steenoven.\n\nDe oven houdt de warmte gelijkmatiger vast. Het resultaat: een krokantere korst en een luchtiger kruim. Voor ons team betekent het ook minder energieverbruik per bakbeurt.\n\nAmbacht en vooruitgang gaan prima samen.\n\n#bakkerijdevries #vakmanschap #ambacht',
    facebook: 'Hij staat! 🎉 Onze nieuwe steenoven is in gebruik en we zijn er nu al verliefd op. De broden worden nog knapperiger dan je van ons gewend bent.\n\nProef het zelf: deze week krijg je bij elk brood een gratis krentenbol.',
    instagram: 'Nieuwe oven, zelfde liefde voor brood 🔥🍞\n\nKnapperiger korst, luchtiger kruim. Kom proeven!\n\n#bakkerijdevries #steenoven #ambachtelijk #utrecht' },
  { topic: 'Maak kennis met bakker Jan', pillar: 'Team', media: 'brood',
    linkedin: 'Al 22 jaar staat Jan om vier uur \'s nachts in de bakkerij. Hij leerde het vak van zijn vader en geeft het nu door aan twee leerlingen.\n\nWat hem drijft? "Elke ochtend iets maken waar mensen blij van worden."\n\n#bakkerijdevries #team #vakmanschap',
    facebook: 'Ken je Jan al? Hij is degene die ervoor zorgt dat jouw brood elke ochtend vers klaarligt. Al 22 jaar! 👨‍🍳\n\nZeg gerust even hallo als je hem ziet.',
    instagram: 'Dit is Jan 👋 22 jaar bakker, elke ochtend om 4 uur aan de slag.\n\n#bakkerijdevries #bakker #teamwork #utrecht' },
  { topic: 'Ons zuurdesembrood: 36 uur rijzen', pillar: 'Aanbod', media: 'brood',
    linkedin: 'Waarom ons zuurdesembrood 36 uur nodig heeft: een langzame rijs maakt het brood beter verteerbaar en geeft meer smaak. Geen haast, wel resultaat.\n\n#bakkerijdevries #zuurdesem #kwaliteit',
    facebook: 'Ons zuurdesembrood rijst maar liefst 36 uur. Dat proef je! 🍞 Vanaf vandaag ook als halfje verkrijgbaar.',
    instagram: '36 uur geduld in één brood 🕰️🍞\n\n#zuurdesem #bakkerijdevries #slowfood' },
  { topic: 'Achter de schermen om 4 uur \'s nachts', pillar: 'Vakmanschap', media: 'bakken',
    linkedin: 'Terwijl de wijk slaapt, begint ons werk. Een kijkje achter de schermen van een ambachtelijke bakkerij, van deeg kneden tot de eerste broden uit de oven.\n\n#bakkerijdevries #achterdeschermen',
    facebook: 'Ooit afgevraagd hoe jouw brood \'s ochtends op tijd klaarligt? We namen je mee om 4 uur \'s nachts 🌙',
    instagram: 'Om 4 uur begint de magie 🌙✨\n\n#achterdeschermen #bakkerijdevries #bakkerij' },
  { topic: 'Brood voor de voedselbank', pillar: 'Buurt', media: 'winkel',
    linkedin: 'Wat we aan het eind van de dag over hebben, gaat naar de voedselbank in de wijk. Zo gooien we niets weg en helpen we buren die het nodig hebben.\n\n#bakkerijdevries #buurt #maatschappelijk',
    facebook: 'Elke avond gaat ons overgebleven brood naar de voedselbank Utrecht-Oost. Samen zorgen we dat er niets verloren gaat 💛',
    instagram: 'Niks weggooien, wel delen 💛\n\n#voedselbank #bakkerijdevries #buurt' },
  { topic: 'Appeltaart van oma, het originele recept', pillar: 'Aanbod', media: 'taart',
    linkedin: 'Sommige recepten verander je niet. Onze appeltaart bakken we nog altijd volgens het recept van oma De Vries uit 1974.\n\n#bakkerijdevries #traditie',
    facebook: 'Het recept is uit 1974 en we hebben er nooit iets aan veranderd 🍎 Oma\'s appeltaart, elk weekend vers.',
    instagram: 'Oma\'s recept uit 1974 🍎🥧\n\n#appeltaart #bakkerijdevries #weekend' },
  { topic: 'Bestellen voor een feestje', pillar: 'Aanbod', media: 'taart',
    linkedin: 'Een vergadering, jubileum of borrel? Wij verzorgen broodjes, taarten en zoetigheden voor groepen vanaf tien personen.\n\n#bakkerijdevries #catering',
    facebook: 'Iets te vieren? Bestel uiterlijk twee dagen van tevoren je taart of broodjesplateau, dan zorgen wij voor de rest 🎂',
    instagram: 'Iets te vieren? Wij bakken mee 🎂\n\n#bakkerijdevries #feestje #taart' },
  { topic: 'Klant aan het woord: de croissants', pillar: 'Buurt', media: 'winkel',
    linkedin: '"De beste croissants van de wijk." Een mooi compliment van een vaste klant, en een fijne bevestiging voor ons team.\n\n#bakkerijdevries #klanttevredenheid',
    facebook: '"De beste croissants van de wijk!" Dank je wel, Marieke, voor je lieve review 🥐❤️',
    instagram: 'Jullie zeggen het zelf 🥐❤️\n\n#croissant #bakkerijdevries #review' },
  { topic: 'Recept: wentelteefjes van oud brood', pillar: 'Buurt', media: 'brood',
    linkedin: 'Minder verspilling begint thuis. Ons favoriete recept voor oud brood: wentelteefjes. Simpel en lekker.\n\n#bakkerijdevries #duurzaam',
    facebook: 'Brood over? Maak er wentelteefjes van! Ei, melk, kaneel en een klontje boter. Smakelijk 😋',
    instagram: 'Oud brood? Wentelteefjes! 😋\n\n#recept #nowaste #bakkerijdevries' },
  { topic: 'Het team achter de toonbank', pillar: 'Team', media: 'team',
    linkedin: 'Vijf collega\'s, één doel: jou elke dag vriendelijk en snel helpen. Maak kennis met ons winkelteam.\n\n#bakkerijdevries #team',
    facebook: 'Dit zijn de vrolijke gezichten achter de toonbank 😊 Zeg gerust even hallo!',
    instagram: 'Ons winkelteam 😊\n\n#team #bakkerijdevries #utrecht' },
  { topic: 'Seizoensbrood: pompoen en walnoot', pillar: 'Aanbod', media: 'brood',
    linkedin: 'Nieuw in het seizoensassortiment: pompoen-walnootbrood, met pompoen van een kweker uit de regio.\n\n#bakkerijdevries #seizoen #lokaal',
    facebook: 'Nieuw! 🎃 Pompoen-walnootbrood, alleen dit seizoen. Lekker bij soep.',
    instagram: 'Seizoensbrood is terug 🎃🌰\n\n#pompoenbrood #bakkerijdevries #herfst' },
  { topic: 'Openingstijden en vooruit bestellen', pillar: 'Aanbod', media: 'winkel',
    linkedin: 'Een overzicht van onze openingstijden en hoe je vooruit kunt bestellen, zodat je nooit misgrijpt.\n\n#bakkerijdevries',
    facebook: 'Wist je dat je ook vooruit kunt bestellen? Bel of app ons en we leggen je brood apart 🍞',
    instagram: 'Vooruit bestellen kan ook 📲\n\n#bakkerijdevries #service' },
  { topic: 'Bedankt voor jullie steun', pillar: 'Buurt', media: 'winkel',
    linkedin: 'Een bakkerij bestaat dankzij de buurt. Dank aan iedereen die ons elke week weet te vinden.\n\n#bakkerijdevries #dankjewel',
    facebook: 'Dankjewel, lieve buurt, voor al jullie bezoekjes deze maand 💛',
    instagram: 'Dankjewel buurt 💛\n\n#bakkerijdevries #buurt' },
];

const PLAN_TOPICS = [
  ['Proeverij: drie soorten zuurdesem', 'Aanbod'], ['Leerling-bakker Sara stelt zich voor', 'Team'], ['Hoe kies je het juiste brood?', 'Vakmanschap'],
  ['Samenwerking met de kaasboer om de hoek', 'Buurt'], ['Nieuw: speltcroissants', 'Aanbod'], ['Een dag meelopen met de bezorger', 'Team'],
  ['Waarom wij geen broodverbeteraars gebruiken', 'Vakmanschap'], ['Buurtfeest: wij bakken mee', 'Buurt'], ['Taart van de maand', 'Aanbod'],
  ['10 jaar in deze straat', 'Buurt'], ['Tips om brood vers te houden', 'Vakmanschap'], ['Winactie: ontbijt voor twee', 'Aanbod'], ['Terugblik op de maand', 'Team'],
];

// ---------- Opbouw ----------

export function buildSeed(today) {
  counter = 0;
  const t = iso(today);
  const created = new Date(today.getTime() - 20 * 86400000).toISOString();
  // Demo-accounts, één per rol. Wachtwoord voor allemaal: demo-wachtwoord (bewaard als hash).
  const PASSWORD_HASH = 'c1cf012eef5880cf58f15b27bbfdefa994fcaf742bb8e5f4f0095458257fc868';
  const account = (id, name, email, role) => ({ id, name, email, role, created_at: created, password_hash: PASSWORD_HASH, demoAccount: true });
  const users = [
    account('u-chef', 'Chefkes', 'chefkes@demo.nl', 'admin'),
    account('u-lisa', 'Social media manager', 'smm@demo.nl', 'social_media_manager'),
    account('u-vera', 'Branding', 'branding@demo.nl', 'vormgever'),
    account('u-sam', 'Stage', 'stage@demo.nl', 'medewerker'),
  ];

  const bakkerij = {
    id: 'c-bakkerij', name: 'Bakkerij De Vries', created_at: created, archived: false,
    strategy: 'Ambachtelijke buurtbakker in Utrecht-Oost. Doel: meer bekendheid in de wijk en meer bestellingen voor feestjes en bedrijven.',
    tone_of_voice: 'Warm, nuchter, je-vorm. Af en toe een emoji, nooit overdreven.',
    content_pillars: ['Vakmanschap', 'Team', 'Aanbod', 'Buurt'], channels: ['instagram', 'facebook', 'linkedin'], posts_per_week: 3,
    ai_memory: 'Geen prijzen noemen.\nSanne liever niet herkenbaar in beeld.\nLinkedIn zakelijker houden, gericht op bedrijven in de buurt.',
    context: 'Familiebakkerij sinds 1974, nu in handen van Jan de Vries. Alles wordt dagelijks vers gebakken in eigen bakkerij achter de winkel. Bekend om zuurdesembrood, appeltaart van oma en croissants. Sinds kort een nieuwe steenoven. Levert ook aan bedrijven in de buurt (vergaderingen, borrels).',
    target_audience: 'Gezinnen en ouderen in Utrecht-Oost; kantoren en zzp\'ers in de buurt voor catering.',
    website: 'www.bakkerijdevries-voorbeeld.nl', contact: 'Jan de Vries, eigenaar (bij voorkeur via WhatsApp)',
  };
  const realClients = START_CLIENTS.map((name) => ({
    id: id('c'), name, created_at: created, archived: false, strategy: '', tone_of_voice: '', content_pillars: [], channels: [], posts_per_week: 3, ai_memory: '',
    context: '', target_audience: '', website: '', contact: '',
  }));

  // Beeld (verzonnen voorbeeldfoto's)
  const pic = (key, client, filename, kind, extra = {}) => ({
    id: `m-${key}`, client_id: client, client_input_id: null, kind, filename, mime_type: kind === 'video' ? 'video/mp4' : 'image/jpeg',
    size_bytes: kind === 'video' ? 13466 : 64000, description: '', tags: [], has_recognizable_faces: 0, ai_processing_allowed: 0,
    uploaded_by: 'u-lisa', uploaded_at: created, src: `demo-beeld/${filename}`, ...extra,
  });
  const media = [
    pic('oven', 'c-bakkerij', 'oven.jpg', 'foto', { description: 'De nieuwe steenoven met de eerste broden', tags: ['oven', 'vakmanschap'], client_input_id: 'i-oven' }),
    pic('brood', 'c-bakkerij', 'brood.jpg', 'foto', { description: 'Zuurdesembroden op de toonbank', tags: ['brood', 'aanbod'] }),
    pic('team', 'c-bakkerij', 'team.jpg', 'foto', { description: 'Het winkelteam achter de toonbank', tags: ['team'], has_recognizable_faces: 1 }),
    pic('winkel', 'c-bakkerij', 'winkel.jpg', 'foto', { description: 'De winkel van buiten', tags: ['winkel', 'buurt'] }),
    pic('taart', 'c-bakkerij', 'taart.jpg', 'foto', { description: 'Appeltaart van oma', tags: ['taart', 'aanbod'] }),
    pic('bakken', 'c-bakkerij', 'bakken.mp4', 'video', { description: 'Korte video van het bakproces', tags: ['achter de schermen'] }),
  ];

  const inputs = [
    { id: 'i-oven', client_id: 'c-bakkerij', source: 'handmatig', title: 'Nieuwe steenoven', body: 'We hebben een nieuwe steenoven! Daardoor zijn de broden nog knapperiger. Foto\'s bijgevoegd.', instructions: '', processed: true, created_by: 'u-lisa', created_at: created },
    { id: 'i-whatsapp', client_id: 'c-bakkerij', source: 'whatsapp', title: 'WhatsApp met Jan de Vries', body: `${t} 09:15 — Jan de Vries: Hoi! Volgende maand starten we met speltcroissants, leuk om te delen?\n${t} 09:16 — Jan de Vries: En we doen mee aan het buurtfeest, we bakken taarten voor de kinderen.\n${t} 09:20 — JSS: Top, nemen we mee in de planning!`, instructions: '', processed: false, created_by: 'u-lisa', created_at: new Date(today.getTime() - 86400000).toISOString() },
    { id: 'i-jubileum', client_id: 'c-bakkerij', source: 'email', title: '10 jaar in deze straat', body: 'Over een paar weken zitten we tien jaar op deze plek. We willen dat vieren met een actie: elke klant een gratis koekje en een winactie voor een ontbijt voor twee.', instructions: 'Winactie pas in de laatste week aankondigen.', processed: false, created_by: 'u-sam', created_at: new Date(today.getTime() - 2 * 86400000).toISOString() },
  ];

  // Kalender van deze maand: maandag, woensdag en vrijdag, drie kanalen.
  const calendar = [];
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const days = [];
  for (let d = first; d <= last; d = addDays(d, 1)) if ([1, 3, 5].includes(d.getDay())) days.push(iso(d));
  const weekAhead = iso(addDays(today, 7));
  days.forEach((date, i) => {
    const post = BAKKERIJ_POSTS[i % BAKKERIJ_POSTS.length];
    bakkerij.channels.forEach((channel, c) => {
      let status;
      let body = post[channel];
      let notes = '';
      if (date < t) {
        status = i === 1 && channel === 'facebook' ? 'advertising_ingepland' : 'volledig_ingepland';
        notes = channel === 'linkedin' ? 'Ingepland via LinkedIn' : 'Ingepland in Meta Business Suite';
      } else if (date <= weekAhead) {
        status = c === 0 ? 'gereed_voor_inplannen' : 'tekst_gereed';
        if (c === 0) notes = 'Vormgever: tekst in beeld bovenin, logo rechtsonder.';
      } else if (i % 4 === 0) {
        status = 'beeld_gereed_tekst_ontbreekt';
        body = '';
      } else if (i % 4 === 1) {
        status = 'placeholder_actie_nodig';
        body = '';
        notes = 'Klant levert nog foto\'s aan.';
      } else if (i % 4 === 2 && channel === 'facebook') {
        status = 'advertising_gereed';
        notes = 'Advertentie: budget en doelgroep afstemmen met klant.';
      } else {
        status = 'tekst_gereed';
      }
      calendar.push({
        id: id('k'), client_id: 'c-bakkerij', publish_date: date, suggested_time: { linkedin: '08:30', facebook: '19:30', instagram: '19:00' }[channel],
        channel, body, topic: post.topic, content_pillar: post.pillar, source_info: '', internal_notes: notes, status,
        assignee_id: status === 'placeholder_actie_nodig' ? 'u-sam' : date <= weekAhead && date >= t ? 'u-vera' : null,
        plan_id: null, created_by: 'u-lisa', created_at: created, updated_at: created,
        media: status === 'placeholder_actie_nodig' ? [] : [`m-${post.media}`],
      });
    });
  });

  // Conceptplanning voor volgende maand, wacht op beoordeling
  const nFirst = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const nLast = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  const planDays = [];
  for (let d = nFirst; d <= nLast; d = addDays(d, 1)) if ([1, 3, 5].includes(d.getDay())) planDays.push(iso(d));
  const planMedia = { Aanbod: 'm-brood', Team: 'm-team', Vakmanschap: 'm-oven', Buurt: 'm-winkel' };
  const plan = {
    id: 'p-volgende-maand', clientId: 'c-bakkerij', periodStart: iso(nFirst), periodEnd: iso(nLast), status: 'in_controle', generation: 1,
    reviewTextsFirst: false, textsReady: false, aiSource: 'voorbeeld',
    aiNote: 'In de demo is dit voorstel vooraf klaargezet. In de echte versie maakt de AI het op basis van strategie, klantinput en beeld.',
    wishes: '', approvedBy: null, approvedAt: null, approvedGeneration: null, addedToCalendarAt: null, createdAt: new Date(today.getTime() - 3600000).toISOString(),
    items: planDays.map((date, i) => {
      const [topic, pillar] = PLAN_TOPICS[i % PLAN_TOPICS.length];
      const fromInput = topic.startsWith('Nieuw: spelt') || topic.startsWith('Buurtfeest') ? 'i-whatsapp' : topic.startsWith('10 jaar') || topic.startsWith('Winactie') ? 'i-jubileum' : null;
      return {
        id: id('pi'), position: i, date, time: '19:00', topic, channels: [...bakkerij.channels], pillar, clientInputId: fromInput,
        media: pillar === 'Team' ? [] : [planMedia[pillar]], texts: {},
        rationale: fromInput ? 'Gebaseerd op aangeleverde klantinput.' : `Past bij de pijler ${pillar} en zorgt voor spreiding over de maand.`,
      };
    }),
  };

  // Eén handmatige post op de eerste plandag, zodat je bij goedkeuren de keuze 'behouden of vervangen' ziet.
  calendar.push({
    id: id('k'), client_id: 'c-bakkerij', publish_date: planDays[0], suggested_time: '12:00', channel: 'instagram',
    body: 'Nieuw: de spaarkaart is terug! Bij tien stempels een gratis brood naar keuze 🍞\n\n#bakkerijdevries #spaarkaart',
    topic: 'Spaarkaart is terug', content_pillar: 'Aanbod', source_info: 'Handmatig toegevoegd op verzoek van de klant', internal_notes: '', status: 'tekst_gereed',
    assignee_id: null, plan_id: null, created_by: 'u-sam', created_at: created, updated_at: created, media: ['m-winkel'],
  });

  return {
    version: 4, currentUserId: null, users, permissions: normalizePermissions(CAN),
    clients: [bakkerij, ...realClients],
    inputs, media, calendar, versions: [], plans: [plan], shoots: [],
  };
}
