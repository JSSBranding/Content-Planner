// Gedeelde vaste waarden. De frontend haalt deze op via GET /api/meta.

export const CHANNELS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'pinterest', label: 'Pinterest' },
  { key: 'x', label: 'X' },
];
export const CHANNEL_KEYS = CHANNELS.map((c) => c.key);

// De zeven bestaande kleurstatussen. Kleuren staan in public/styles.css (--status-*).
export const CALENDAR_STATUSES = [
  { key: 'tekst_gereed', label: 'Tekst gereed' },
  { key: 'beeld_gereed_tekst_ontbreekt', label: 'Beeld gereed, tekst ontbreekt' },
  { key: 'gereed_voor_inplannen', label: 'Gereed voor inplannen' },
  { key: 'volledig_ingepland', label: 'Volledig ingepland' },
  { key: 'advertising_gereed', label: 'Advertising gereed' },
  { key: 'advertising_ingepland', label: 'Advertising ingepland' },
  { key: 'placeholder_actie_nodig', label: 'Placeholder / actie nodig' },
];
export const CALENDAR_STATUS_KEYS = CALENDAR_STATUSES.map((s) => s.key);

export const PLAN_STATUSES = [
  { key: 'concept', label: 'Concept — gegenereerd door AI' },
  { key: 'in_controle', label: 'In controle' },
  { key: 'aanpassen', label: 'Aanpassen' },
  { key: 'goedgekeurd', label: 'Goedgekeurd' },
  { key: 'toegevoegd_aan_kalender', label: 'Toegevoegd aan kalender' },
];

export const ROLES = [
  { key: 'admin', label: 'Beheerder' },
  { key: 'social_media_manager', label: 'Social media manager' },
  { key: 'medewerker', label: 'Medewerker' },
  { key: 'vormgever', label: 'Grafisch vormgever' },
];
export const ROLE_KEYS = ROLES.map((r) => r.key);

// Wie mag wat. Goedkeuren van AI-planningen: alleen manager en beheerder.
export const CAN = {
  manageUsers: ['admin'],
  manageClients: ['admin', 'social_media_manager'],
  managePlans: ['admin', 'social_media_manager'],
  approvePlans: ['admin', 'social_media_manager'],
  editContent: ['admin', 'social_media_manager', 'medewerker'],
  // Vormgever: bekijken, kopiëren, downloaden, status en interne opmerkingen bijwerken.
  updateStatus: ['admin', 'social_media_manager', 'medewerker', 'vormgever'],
};
