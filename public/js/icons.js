// Eenvoudige lijniconen (24×24, lijndikte via CSS). Alleen vaste, eigen SVG-paden; nooit gebruikersinvoer.
const PATHS = {
  kalender: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  planning: '<path d="M5 6h14M5 12h9M5 18h6"/><path d="m15.5 17 2 2 3.5-4"/>',
  inbox: '<path d="M4 13.5 6.5 5h11l2.5 8.5V19H4z"/><path d="M4 13.5h5l1 2h4l1-2h5"/>',
  beeld: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5.5-5 4 3.5 2.5-2 4 3.5"/>',
  camera: '<path d="M4 8.5h3l1.8-2.5h6.4L17 8.5h3V19H4z"/><circle cx="12" cy="13.5" r="3.3"/>',
  profiel: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  gebruikers: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.7-3.2 3-5 6-5s5.3 1.8 6 5"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.8c1.8.6 3 2.1 3.5 4.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  kopie: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>',
  upload: '<path d="M12 15.5V4.5M7 9l5-5 5 5M5 19.5h14"/>',
  sluit: '<path d="m6 6 12 12M18 6 6 18"/>',
  links: '<path d="m14.5 6-6 6 6 6"/>',
  rechts: '<path d="m9.5 6 6 6-6 6"/>',
  omhoog: '<path d="m6 14.5 6-6 6 6"/>',
  omlaag: '<path d="m6 9.5 6 6 6-6"/>',
  prullenbak: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>',
  sparkle: '<path d="M12 3.5c.6 4.3 2.2 5.9 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.6 5.9-2.2 6.5-6.5zM18.5 15.5c.3 1.8 1 2.6 2.8 2.8-1.8.3-2.5 1-2.8 2.8-.3-1.8-1-2.5-2.8-2.8 1.8-.2 2.5-1 2.8-2.8z"/>',
  vink: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  notitie: '<path d="M5 4.5h14v11l-4 4H5z"/><path d="M15 19.5v-4h4M8.5 9h7M8.5 12.5h4"/>',
  zoek: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  excel: '<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M4 9h16M4 14.5h16M10 9v11.5"/>',
  uitlog: '<path d="M14 4.5h4.5v15H14M10.5 8l-4 4 4 4M6.5 12H15"/>',
  geschiedenis: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9M12 8v4.5l3 2"/>',
  bewerk: '<path d="M14.5 5.5 18.5 9.5 9 19H5v-4z"/>',
  video: '<rect x="3.5" y="6" width="12.5" height="12" rx="2"/><path d="m16 10.5 4.5-2.5v8l-4.5-2.5z"/>',
  slot: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  archief: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1.2"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  meer: '<circle cx="5.5" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="2" fill="currentColor" stroke="none"/>',
  whatsapp: '<path d="M5 19.5 6 16a7.5 7.5 0 1 1 2.8 2.6z"/><path d="M9.5 9.2c.2 2.4 2.6 4.9 5.2 5.3l.9-1.3-1.7-.9-.8.8c-.9-.4-1.7-1.2-2.1-2.1l.8-.8-.9-1.7z"/>',
};

export function icon(name, { size = 18, label } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', 'icoon');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  svg.innerHTML = PATHS[name] ?? '';
  return svg;
}
