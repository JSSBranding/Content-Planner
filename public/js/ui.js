// Kleine hulpfuncties voor de interface. Alle tekst gaat via textContent, nooit via innerHTML.
import { icon } from './icons.js';

export { icon };

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false || key === 'value') continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (v == null) continue;
        if (prop.startsWith('--')) el.style.setProperty(prop, v); // CSS-variabelen, bijv. --kleur
        else el.style[prop] = v;
      }
    }
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  // value pas na de kinderen zetten: anders kiest een <select> nog geen optie.
  if (attrs?.value != null) el.value = attrs.value;
  return el;
}

// Vervangt de inhoud van el; lege waarden (null, false) worden overgeslagen, lijsten platgeslagen.
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function toast(message, type = '') {
  const el = h('div', { class: `toast ${type}` }, icon(type === 'fout' ? 'sluit' : 'vink', { size: 16 }), message);
  const host = document.getElementById('toasts');
  host.append(el);
  while (host.children.length > 3) host.firstChild.remove();
  setTimeout(() => el.remove(), type === 'fout' ? 7000 : 3200);
}

export function showError(err) {
  toast(err?.message ?? String(err), 'fout');
}

// Toont een venster en geeft een Promise terug die de gekozen waarde oplevert (of null bij sluiten).
export function modal({ title, body, buttons = [], width }) {
  return new Promise((resolve) => {
    const close = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => e.key === 'Escape' && close(null);
    const footer = h('footer', {}, buttons.map((b) => h('button', {
      class: `knop ${b.class ?? ''}`, type: 'button',
      onclick: async () => {
        if (!b.action) return close(b.value ?? null);
        const result = await b.action(close);
        if (result !== undefined) close(result);
      },
    }, b.label)));
    const overlay = h('div', { class: 'modaal', onclick: (e) => e.target === overlay && close(null) },
      h('div', { class: 'venster', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: width ? { '--breedte': width } : null },
        h('header', {}, h('h2', {}, title), h('button', { class: 'knop kaal icoonknop klein', type: 'button', 'aria-label': 'Sluiten', onclick: () => close(null) }, icon('sluit'))),
        h('div', { class: 'inhoud' }, body),
        buttons.length ? footer : null));
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    overlay.querySelector('input, textarea, select, button')?.focus();
  });
}

export function confirmDialog(title, message, { confirmLabel = 'Doorgaan', danger = false } = {}) {
  return modal({
    title,
    body: h('p', {}, message),
    buttons: [{ label: 'Annuleren', value: false }, { label: confirmLabel, value: true, class: danger ? 'gevaar' : 'primair' }],
  });
}

// Blokkeert de interface tijdens lange acties (zoals AI-verzoeken) met een duidelijke melding.
export async function busy(message, fn) {
  const el = h('div', { class: 'bezig', role: 'status' },
    h('div', { class: 'kaartje' }, h('img', { src: '/assets/brand/svg/beeldmerk-turkoois.svg', alt: '' }), h('div', {}, message)));
  document.body.append(el);
  try {
    return await fn();
  } finally {
    el.remove();
  }
}

// Klein keuzemenu bij een knop. items: [{ label, icon?, kleur?: style, checked?, action }].
export function openMenu(anchor, items) {
  document.querySelector('.menu')?.remove();
  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
    anchor.focus?.();
  };
  const outside = (e) => !menu.contains(e.target) && close();
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    const buttons = [...menu.querySelectorAll('button')];
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
  };
  const menu = h('div', { class: 'menu', role: 'menu' }, items.map((it) => h('button', {
    type: 'button', role: 'menuitem',
    onclick: (e) => { e.stopPropagation(); close(); it.action(); },
  }, it.kleur ? h('span', { class: 'kleurbol', style: it.kleur }) : it.icon ? icon(it.icon, { size: 16 }) : null,
  it.label, it.checked ? h('span', { class: 'vink' }, icon('vink', { size: 16 })) : null)));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  menu.style.top = `${Math.min(r.bottom + 6, innerHeight - m.height - 8)}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - m.width, innerWidth - m.width - 8))}px`;
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', onKey, true);
  (menu.querySelector('.vink')?.closest('button') ?? menu.querySelector('button'))?.focus();
}

// Vaste paginaopbouw: een kop (met titel, acties en eventueel tabs) en het werkvlak eronder.
export function pageHead({ title, sub, actions, tabs }) {
  return h('header', { class: `paginakop ${tabs ? '' : 'zonder-tabs'}` },
    h('div', { class: 'titelrij' }, h('div', {}, h('h1', {}, title), sub ? h('div', { class: 'sub' }, sub) : null),
      actions ? h('div', { class: 'acties knoppen' }, actions) : null),
    tabs ?? null);
}
export const page = (head, ...content) => [head, h('div', { class: 'inhoud-vlak' }, content)];

export function initials(name) {
  const words = String(name).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words.at(-1)[0] : words[0]?.[1] ?? '')).toUpperCase();
}

const dateFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
const longDateFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const asDate = (iso) => new Date(`${iso}T12:00:00`);
export const fmtDate = (iso) => (iso ? dateFmt.format(asDate(iso)) : '');
export const fmtLongDate = (iso) => (iso ? longDateFmt.format(asDate(iso)) : '');
export const fmtMonth = (iso) => monthFmt.format(asDate(iso));
// Accepteert zowel SQLite-tijden ("2026-11-12 09:15:00", UTC) als ISO-tijden ("2026-11-12T09:15:00.000Z").
export const fmtDateTime = (value) => {
  if (!value) return '';
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : dateTimeFmt.format(d);
};
export const fmtSize = (bytes) => (bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`);

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(iso, n) {
  const d = asDate(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
export function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  return { from: `${ym}-01`, to: isoDate(new Date(y, m, 0)) };
}
export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function isoWeek(iso) {
  const d = asDate(iso);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Tekst gekopieerd.');
}

export function downloadUrl(url) {
  const a = h('a', { href: url, download: '' });
  document.body.append(a);
  a.click();
  a.remove();
}

// Thumbnail van een foto of video uit de mediabibliotheek.
export function mediaThumb(m, cls = 'duim') {
  if (m.kind === 'video') {
    return h('video', { class: `${cls} video`, src: `${m.url}#t=0.5`, preload: 'metadata', muted: true, playsInline: true, title: m.filename });
  }
  return h('img', { class: cls, src: m.url, alt: m.description || m.filename, loading: 'lazy', title: m.filename });
}

export function mediaPreview(m) {
  return m.kind === 'video'
    ? h('video', { src: m.url, controls: true, preload: 'metadata', playsInline: true })
    : h('img', { src: m.url, alt: m.description || m.filename, loading: 'lazy' });
}

export function field(labelText, control, help) {
  const id = control.id || `v${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return h('div', { class: 'veld' }, h('label', { for: id }, labelText), control, help ? h('div', { class: 'hulp' }, help) : null);
}

// Nette bestandskiezer in plaats van de standaardknop van de browser.
export function fileButton(input, label, emptyText = 'Nog niets gekozen') {
  input.hidden = true;
  const chosen = h('span', { class: 'gekozen' }, emptyText);
  input.addEventListener('change', () => {
    const files = [...input.files];
    chosen.textContent = files.length ? (files.length === 1 ? files[0].name : `${files.length} bestanden gekozen`) : emptyText;
  });
  input.form?.addEventListener('reset', () => { chosen.textContent = emptyText; });
  return h('div', { class: 'bestandkeuze' }, h('label', { class: 'knop klein' }, icon('upload', { size: 15 }), label, input), chosen);
}

export function emptyState(message, action) {
  return h('div', { class: 'leeg' }, h('img', { src: '/assets/brand/svg/aanhalingstekens-lijn-turkoois.svg', alt: '' }), h('p', {}, message), action ?? null);
}
