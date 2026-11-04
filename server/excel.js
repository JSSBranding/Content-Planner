// Excel-export en -import van de contentkalender.
import ExcelJS from 'exceljs';
import { CHANNELS, CALENDAR_STATUSES } from './constants.js';

const argb = (hex) => `FF${hex.slice(1).toUpperCase()}`;
const statusFill = (key) => {
  const s = CALENDAR_STATUSES.find((x) => x.key === key);
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(s.color) } };
};
const statusFont = (key) => {
  const s = CALENDAR_STATUSES.find((x) => x.key === key);
  return { color: { argb: argb(s.text) }, bold: s.bold };
};

const COLUMNS = [
  { header: 'Datum', key: 'date', width: 12 },
  { header: 'Tijd (voorstel)', key: 'time', width: 10 },
  { header: 'Kanaal', key: 'channel', width: 12 },
  { header: 'Onderwerp', key: 'topic', width: 30 },
  { header: 'Contentpijler', key: 'pillar', width: 18 },
  { header: 'Tekst', key: 'body', width: 70 },
  { header: 'Beeld (bestandsnamen)', key: 'media', width: 34 },
  { header: 'Status', key: 'status', width: 26 },
  { header: 'Verantwoordelijke', key: 'assignee', width: 18 },
  { header: 'Bron / klantinput', key: 'source', width: 34 },
  { header: 'Interne opmerkingen', key: 'notes', width: 34 },
];

const channelLabel = (k) => CHANNELS.find((c) => c.key === k)?.label ?? k;
const statusLabel = (k) => CALENDAR_STATUSES.find((s) => s.key === k)?.label ?? k;

export async function exportCalendar({ client, items, from, to }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Jouw Content Studio';
  const ws = wb.addWorksheet('Contentkalender', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS;
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FFEB' } };
  for (const it of items) {
    const row = ws.addRow({
      date: it.publish_date,
      time: it.suggested_time ?? '',
      channel: channelLabel(it.channel),
      topic: it.topic,
      pillar: it.content_pillar ?? '',
      body: it.body,
      media: it.media.map((m) => m.filename).join(', '),
      status: statusLabel(it.status),
      assignee: it.assignee_name ?? '',
      source: it.source_info,
      notes: it.internal_notes,
    });
    row.alignment = { vertical: 'top', wrapText: true };
    // Zoals in de bestaande JSS-kalender: de hele rij krijgt de statuskleur.
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = statusFill(it.status);
      cell.font = statusFont(it.status);
    });
  }
  ws.autoFilter = { from: 'A1', to: 'K1' };

  const legend = wb.addWorksheet('Statussen');
  legend.columns = [{ header: 'Kleur', key: 'c', width: 20 }, { header: 'Status', key: 's', width: 32 }];
  legend.getRow(1).font = { bold: true };
  for (const s of CALENDAR_STATUSES) {
    const row = legend.addRow({ c: s.colorName, s: s.label });
    row.eachCell((cell) => { cell.fill = statusFill(s.key); cell.font = statusFont(s.key); });
  }
  const info = wb.addWorksheet('Info');
  info.addRows([['Klant', client.name], ['Periode', `${from} t/m ${to}`], ['Geëxporteerd', new Date().toISOString().slice(0, 16).replace('T', ' ')]]);
  return wb.xlsx.writeBuffer();
}

function cellText(cell) {
  const v = cell?.value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('');
  if (typeof v === 'object' && 'text' in v) return String(v.text);
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '');
  return String(v).trim();
}

function normalizeDate(s) {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

function normalizeTime(s) {
  if (!s) return null;
  const m = s.match(/(\d{1,2})[:.](\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

const find = (list, value) => {
  const v = value.trim().toLowerCase();
  return list.find((x) => x.key === v || x.label.toLowerCase() === v)?.key ?? null;
};

/** Leest rijen uit een geëxporteerd (of vergelijkbaar opgebouwd) Excel-bestand. */
export async function parseCalendarWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], errors: ['Het bestand bevat geen werkblad.'] };
  const headers = {};
  ws.getRow(1).eachCell((cell, col) => { headers[cellText(cell).toLowerCase()] = col; });
  const col = (...names) => names.map((n) => headers[n.toLowerCase()]).find(Boolean);
  const c = {
    date: col('Datum'), time: col('Tijd (voorstel)', 'Tijd'), channel: col('Kanaal'), topic: col('Onderwerp'), pillar: col('Contentpijler', 'Pijler'),
    body: col('Tekst'), status: col('Status'), assignee: col('Verantwoordelijke'), source: col('Bron / klantinput', 'Bron'), notes: col('Interne opmerkingen', 'Opmerkingen'),
  };
  if (!c.date || !c.channel) return { rows: [], errors: ['Kolommen "Datum" en "Kanaal" zijn verplicht.'] };

  const rows = [];
  const errors = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const get = (k) => (c[k] ? cellText(row.getCell(c[k])) : '');
    if (!get('date') && !get('body')) return;
    const date = normalizeDate(get('date'));
    const channel = find(CHANNELS, get('channel'));
    if (!date) return errors.push(`Rij ${n}: ongeldige datum "${get('date')}".`);
    if (!channel) return errors.push(`Rij ${n}: onbekend kanaal "${get('channel')}".`);
    rows.push({
      row: n, date, channel, time: normalizeTime(get('time')), topic: get('topic'), pillar: get('pillar'), body: get('body'),
      status: find(CALENDAR_STATUSES, get('status')) ?? null, source: get('source'), notes: get('notes'), assignee: get('assignee'),
    });
  });
  return { rows, errors };
}

/** Overzicht "afspraak tegenover geleverd" voor één maand, voor facturatie. */
export async function exportReport({ month, rows }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Jouw Content Studio';
  const ws = wb.addWorksheet(`Afspraken ${month}`, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Klant', key: 'name', width: 34 },
    { header: 'Posts per week', key: 'ppw', width: 15 },
    { header: 'Kanalen', key: 'channels', width: 34 },
    { header: 'Afgesproken', key: 'expected', width: 13 },
    { header: 'In kalender', key: 'planned', width: 13 },
    { header: 'Volledig ingepland', key: 'done', width: 18 },
    { header: 'Nog te doen', key: 'open', width: 13 },
    { header: 'Percentage', key: 'pct', width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FFEB' } };
  for (const r of rows) {
    ws.addRow({ name: r.name, ppw: r.posts_per_week, channels: r.channels.map(channelLabel).join(', '), expected: r.expected, planned: r.planned,
      done: r.done, open: r.open, pct: r.percentage == null ? '' : r.percentage / 100 });
  }
  ws.getColumn('pct').numFmt = '0%';
  const total = (k) => rows.reduce((n, r) => n + r[k], 0);
  const sum = ws.addRow({ name: 'Totaal', expected: total('expected'), planned: total('planned'), done: total('done'), open: total('open'),
    pct: total('expected') ? total('done') / total('expected') : '' });
  sum.font = { bold: true };
  ws.autoFilter = { from: 'A1', to: 'H1' };
  const info = wb.addWorksheet('Uitleg');
  info.addRows([
    ['Maand', month],
    ['Afgesproken', 'Posts per week × aantal kanalen × dagen in de maand / 7, afgerond'],
    ['Volledig ingepland', 'Posts met status Volledig ingepland of Advertising ingepland'],
    ['Geëxporteerd', new Date().toISOString().slice(0, 16).replace('T', ' ')],
  ]);
  info.getColumn(1).width = 20;
  info.getColumn(2).width = 70;
  return wb.xlsx.writeBuffer();
}
