// Gedeelde vaste waarden. De frontend haalt deze op via GET /api/meta.

export const CHANNELS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'instagram_stories', label: 'Instagram Stories' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
];
export const CHANNEL_KEYS = CHANNELS.map((c) => c.key);

// De zeven bestaande kleurstatussen, in de volgorde en kleuren van de JSS-legenda.
// Dit is de enige plek met de kleuren: kalender, legenda en Excel-export lezen ze hier.
export const CALENDAR_STATUSES = [
  { key: 'tekst_gereed', label: 'Tekst gereed', color: '#ffffff', text: '#3c3c3b', bold: true, colorName: 'Wit + vetgedrukt' },
  { key: 'volledig_ingepland', label: 'Volledig ingepland', color: '#cef3d6', text: '#3c3c3b', bold: false, colorName: 'Lichtgroen' },
  { key: 'placeholder_actie_nodig', label: 'Placeholder / actie nodig', color: '#f9dab7', text: '#3c3c3b', bold: false, colorName: 'Lichtoranje' },
  { key: 'gereed_voor_inplannen', label: 'Gereed voor inplannen', color: '#d1e5fd', text: '#3c3c3b', bold: false, colorName: 'Lichtblauw' },
  { key: 'beeld_gereed_tekst_ontbreekt', label: 'Beeld gereed, tekst ontbreekt', color: '#fdf2d0', text: '#3c3c3b', bold: false, colorName: 'Lichtgeel' },
  { key: 'advertising_gereed', label: 'Advertising gereed', color: '#7960dd', text: '#ffffff', bold: false, colorName: 'Felpaars' },
  { key: 'advertising_ingepland', label: 'Advertising ingepland', color: '#e0dafc', text: '#3c3c3b', bold: false, colorName: 'Lichtpaars' },
];
export const CALENDAR_STATUS_KEYS = CALENDAR_STATUSES.map((s) => s.key);

export const PLAN_STATUSES = [
  { key: 'concept', label: 'Concept — gegenereerd door AI' },
  { key: 'in_controle', label: 'In controle' },
  { key: 'aanpassen', label: 'Aanpassen' },
  { key: 'goedgekeurd', label: 'Goedgekeurd' },
  { key: 'toegevoegd_aan_kalender', label: 'Toegevoegd aan kalender' },
];

// De rollen bij Jouw Social Studio. De sleutels blijven gelijk (bestaande accounts), alleen de namen zijn die van het team.
export const ROLES = [
  { key: 'admin', label: 'Chefkes', description: 'Alles, inclusief het team en de rechten beheren' },
  { key: 'social_media_manager', label: 'Social media manager', description: 'Klanten inrichten, conceptplanningen maken en goedkeuren' },
  { key: 'vormgever', label: 'Branding', description: 'Tekst en beeld bekijken, kopiëren en downloaden; status en opmerkingen aanpassen' },
  { key: 'medewerker', label: 'Stage', description: 'Teksten, beeld en klantinput bewerken; niets goedkeuren of verwijderen' },
];
export const ROLE_KEYS = ROLES.map((r) => r.key);

// Standaardrechten per rol. Chefkes kunnen dit aanpassen in Team en rechten; de actuele rechten staan in de database.
// updateStatus is de vaste basis: iedereen mag de status wijzigen (ook naar Volledig ingepland) en opmerkingen plaatsen.
export const CAN = {
  manageUsers: ['admin'],
  manageClients: ['admin', 'social_media_manager'],
  managePlans: ['admin', 'social_media_manager'],
  approvePlans: ['admin', 'social_media_manager'],
  editContent: ['admin', 'social_media_manager', 'medewerker'],
  manageMedia: ['admin', 'social_media_manager', 'medewerker', 'vormgever'],
  updateStatus: ['admin', 'social_media_manager', 'medewerker', 'vormgever'],
};

// Rechten voor het overzicht, van basis naar zwaar. 'requires' = het recht dat er automatisch bij hoort.
export const PERMISSIONS = [
  { key: 'updateStatus', label: 'Kalender gebruiken', description: 'Bekijken, tekst kopiëren, beeld downloaden, status wijzigen (ook naar Volledig ingepland) en opmerkingen plaatsen.', everyone: true },
  { key: 'manageMedia', label: 'Beeld uploaden en beheren', description: 'Foto\'s en video\'s toevoegen aan de beeldbibliotheek, beschrijven en verwijderen.' },
  { key: 'editContent', label: 'Posts en klantinput bewerken', description: 'Posts toevoegen, teksten en beeld bij een post aanpassen, klantinput toevoegen.' },
  { key: 'managePlans', label: 'Conceptplanningen maken', description: 'Voorstellen laten maken en aanpassen.', requires: 'editContent' },
  { key: 'approvePlans', label: 'Planningen goedkeuren', description: 'De laatste stap voordat een planning in de kalender komt.', requires: 'managePlans' },
  { key: 'manageClients', label: 'Klanten beheren', description: 'Toevoegen, inrichten, hernoemen, archiveren en verwijderen.' },
  { key: 'manageUsers', label: 'Team en rechten beheren', description: 'Accounts toevoegen en deze rechten aanpassen. Chefkes houden dit altijd.' },
];
export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/** Maakt rechten logisch: de basis geldt voor iedereen, afhankelijke rechten komen mee, chefkes houden teambeheer. */
export function normalizePermissions(next) {
  const out = Object.fromEntries(PERMISSION_KEYS.map((p) => [p, [...new Set((next?.[p] ?? []).filter((r) => ROLE_KEYS.includes(r)))]]));
  out.updateStatus = [...ROLE_KEYS];
  if (!out.manageUsers.includes('admin')) out.manageUsers.push('admin');
  // Van zwaar naar licht, zodat een keten (goedkeuren → plannen → bewerken) helemaal doorwerkt.
  for (const p of [...PERMISSIONS].reverse()) {
    if (!p.requires) continue;
    for (const role of out[p.key]) if (!out[p.requires].includes(role)) out[p.requires].push(role);
  }
  return out;
}
