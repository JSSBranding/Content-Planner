# JSS 2.0-huisstijl

Bronnen: `assets/brand/bron/JSS20_Logo_beeldmerk.ai` en `assets/brand/bron/icoontjes.ai`.
Logo: (Illustrator, 7 tekengebieden van 500 × 500).
Elk tekengebied staat als SVG in `assets/brand/svg/` en als PNG (1000 px, transparant) in `assets/brand/png/`.

| Bestand | Gebruik |
|---|---|
| `logo-turkoois` | hoofdlogo op lichte achtergrond |
| `logo-donkergrijs` | logo op lichte achtergrond, rustige/zakelijke context (bijv. exports) |
| `logo-wit-op-turkoois` | logo inclusief turquoise vlak (bijv. inlogscherm, avatar) |
| `beeldmerk-turkoois` | app-icoon, favicon (`assets/favicon.svg`) |
| `beeldmerk-donkergrijs` | compacte plekken, bijv. zijbalk |
| `aanhalingstekens-turkoois` | decoratief accent, lege toestanden |
| `aanhalingstekens-lijn-turkoois` | lichte variant van het accent |

## Icoontjes

Losse iconen in `assets/icons/` nemen de tekstkleur over (`fill="currentColor"`), dus kleur ze met CSS:

| Bestand | Gebruik (voorstel) |
|---|---|
| `hart-dicht` / `hart-open` | favoriet / niet-favoriet (bijv. favoriete foto in de mediabibliotheek) |
| `pijl-dicht` / `pijl-open` | volgende, uitklappen, navigatie in de kalender |

`assets/icons/vellen/` bevat de overige tekengebieden uit `icoontjes.ai` als overzichtsvel
(pijlen, kruisen, harten, patronen). Tekengebied 3 en 4 zijn leeg en zijn niet geëxporteerd.
Iconen uit een vel die in de app gebruikt worden, worden eerst als los SVG-bestand uitgesneden.

## Lettertype: Poppins

Poppins (SIL Open Font License 1.1) is **zelf gehost** in `assets/fonts/poppins/` en wordt geladen via
`src/styles/fonts.css` (geïmporteerd door `tokens.css`). Er wordt bewust geen Google Fonts-CDN
gebruikt: zo gaan er geen IP-adressen van medewerkers naar Google (privacy/AVG).

| Token | Gewicht | Gebruik |
|---|---|---|
| `--gewicht-normaal` | 400 | lopende tekst, kalendercellen, posttekst |
| `--gewicht-medium` | 500 | labels, kolomkoppen, knoppen |
| `--gewicht-halfvet` | 600 | tussenkoppen, klantnaam |
| `--gewicht-vet` | 700 | paginatitels |
| `--gewicht-extravet` | 800 | grote koppen, spaarzaam |

Alleen het Latijnse subset is opgenomen (bevat ë, é, ï enz.). Cursief alleen in 400.
Fallback: `system-ui`, daarna Arial.

## Kleuren

| Token | Hex | Herkomst |
|---|---|---|
| `--jss-turkoois` | `#00FFEB` | logo, beeldmerk |
| `--jss-turkoois-zacht` | `#50FEE7` | aanhalingstekens-icoon |
| `--jss-donkergrijs` | `#3C3C3B` | logotekst |
| `--jss-grijs` | `#4A4A49` | cirkel beeldmerk |

Tokens staan in `src/styles/tokens.css`.

## Regels

- **Turkoois is een accentkleur, geen tekstkleur.** Op wit is het contrast ±1,3:1, dus onleesbaar.
  Gebruik het voor vlakken, markeringen, actieve tabs en het logo.
- Tekst op turkoois is donkergrijs (`#3C3C3B`, ±8,7:1), niet wit.
- Standaard tekstkleur is donkergrijs op wit (±11:1).
- Logo's niet vervormen, hertekenen of van kleur wisselen buiten de varianten hierboven.
- De zeven kleurstatussen van de kalender zijn functionele kleuren en staan los van de huisstijl.
  Ze mogen niet op turkoois lijken, zodat een status nooit met een merkaccent verward wordt.
