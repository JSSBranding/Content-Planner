// Bouwt de demoversie in dist/demo: dezelfde interface als de echte app, met een nagebootste server
// in de browser (demo/server.js) en voorbeeldgegevens. Gebruik: npm run demo:bouwen
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'demo');
const r = (...p) => path.join(root, ...p);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
  fs.cpSync(r(from), path.join(out, to), { recursive: true });
};

// Interface
copy('public/js', 'js');
copy('demo/server.js', 'js/demo/server.js');
copy('demo/seed.js', 'js/demo/seed.js');
copy('src/planning/plan.js', 'js/demo/lib/plan.js');
copy('src/ai/voorbeeld.js', 'js/demo/lib/voorbeeld.js');
copy('server/whatsapp.js', 'js/demo/lib/whatsapp.js');
copy('server/constants.js', 'js/demo/lib/constants.js');
copy('src/dagen.js', 'gedeeld/dagen.js');
copy('src/rapport.js', 'gedeeld/rapport.js');
copy('src/dagen.js', 'js/demo/lib/dagen.js');
copy('src/rapport.js', 'js/demo/lib/rapport.js');

// Excel: dezelfde export- en importcode als de server. ExcelJS komt als los script mee en wordt pas bij gebruik geladen.
copy('node_modules/exceljs/dist/exceljs.min.js', 'js/demo/lib/exceljs.min.js');
const excelSrc = fs.readFileSync(r('server/excel.js'), 'utf8');
const excelImport = "import ExcelJS from 'exceljs';";
if (!excelSrc.includes(excelImport)) throw new Error('server/excel.js: import van ExcelJS niet gevonden');
fs.writeFileSync(path.join(out, 'js/demo/lib/excel.js'), excelSrc.replace(excelImport,
  '// In de browser: ExcelJS staat op window zodra js/demo/lib/exceljs.min.js is geladen.\nconst ExcelJS = { get Workbook() { return globalThis.ExcelJS.Workbook; } };'));

// Klantnamen uit de echte startlijst
const names = fs.readFileSync(r('db/startklanten.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
fs.writeFileSync(path.join(out, 'js/demo/startklanten.js'), `// Gegenereerd uit db/startklanten.txt\nexport const START_CLIENTS = ${JSON.stringify(names, null, 2)};\n`);

// Beeld
for (const f of ['beeldmerk-turkoois.svg', 'logo-wit-op-turkoois.svg', 'aanhalingstekens-lijn-turkoois.svg']) copy(`assets/brand/svg/${f}`, `assets/brand/svg/${f}`);
copy('demo/beeld', 'demo-beeld');

// Stijlen in één blok; het lettertype als data-URI, zodat het binnen de demo-omgeving laadt.
const fontsCss = fs.readFileSync(r('src/styles/fonts.css'), 'utf8').replace(/url\('\.\.\/\.\.\/(assets\/fonts\/poppins\/[^']+\.woff2)'\)/g,
  (_, file) => `url(data:font/woff2;base64,${fs.readFileSync(r(file)).toString('base64')})`);
const tokensCss = fs.readFileSync(r('src/styles/tokens.css'), 'utf8').replace(/@import [^;]+;\n?/, '');
const appCss = fs.readFileSync(r('public/styles.css'), 'utf8');

const page = `<title>Jouw Content Studio</title>
<style>
:root { color-scheme: light; }
${fontsCss}
${tokensCss}
${appCss}
</style>
<script>window.JCS_DEMO = true;</script>
<div id="app" aria-live="polite"></div>
<div id="toasts" role="status"></div>
<script type="module" src="js/app.js"></script>
`;
fs.writeFileSync(path.join(out, 'index.html'), page);

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(path.relative(out, p));
  }
};
walk(out);
console.log(`Demo gebouwd in ${path.relative(root, out)}: ${files.length} bestanden, pagina ${(Buffer.byteLength(page) / 1024).toFixed(0)} kB.`);
