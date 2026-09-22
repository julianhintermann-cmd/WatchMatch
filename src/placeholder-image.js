'use strict';

/**
 * Erzeugt Poster- und Backdrop-Platzhalter als SVG.
 *
 * Damit funktionieren die Fallback-Filme komplett ohne externe Bild-URLs –
 * auch in einem Container ohne Internetzugang.
 *
 * Bewusst ohne Text: Die Filmkarte zeigt Titel, Jahr und Bewertung bereits in
 * der Typografie der Oberfläche. Ein zweites Mal auf dem Poster wäre eine
 * Dopplung. Der Platzhalter liefert deshalb nur ein Farbfeld – deterministisch
 * aus der Film-ID abgeleitet, damit jeder Film seine eigene Farbe behält.
 */

const { FALLBACK_MOVIE_BY_ID } = require('./fallback-movies');

/** Einfacher, stabiler String-Hash (FNV-1a Variante). */
function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** XML-Escaping für das aria-label. */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Farbpaare im warmen Dunkel der Oberfläche: gedeckte Tiefen, jeweils ein
 * kräftigerer Ton darüber. Passt zur Palette der App, ohne sie zu übertönen.
 */
function paletteFor(seed) {
  const palettes = [
    ['#2a1a10', '#b4561f'], // Kupfer
    ['#101f22', '#1f7f76'], // Schneidetisch-Grün
    ['#241026', '#8c2f63'], // Magenta
    ['#14192c', '#33569c'], // Nachtblau
    ['#2b1408', '#c2761c'], // Bernstein
    ['#10241a', '#2f8f57'], // Waldgrün
    ['#1f142c', '#6247a8'], // Violett
    ['#2c1412', '#a83c34'], // Rostrot
  ];
  return palettes[seed % palettes.length];
}

/**
 * @param {object} options
 * @param {string} options.title Nur für das aria-label.
 * @param {string|number} options.seedSource Bestimmt die Farbwahl.
 * @param {number} options.width
 * @param {number} options.height
 * @returns {string} SVG-Markup
 */
function buildSvg({ title, seedSource, width, height }) {
  const seed = hashString(String(seedSource));
  const [deep, lift] = paletteFor(seed);
  const id = seed % 100000;

  // Zwei Lichtquellen, aus dem Seed leicht verschoben – so wirkt kein Poster
  // wie das andere, ohne dass ein Muster erkennbar wird.
  const cx = 0.26 + ((seed >> 3) % 50) / 100;
  const cy = 0.16 + ((seed >> 7) % 40) / 100;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(
    title,
  )}">
  <defs>
    <linearGradient id="b${id}" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stop-color="${lift}"/>
      <stop offset="100%" stop-color="${deep}"/>
    </linearGradient>
    <radialGradient id="l${id}" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="0.75">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="v${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="45%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.45"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="${deep}"/>
  <rect width="${width}" height="${height}" fill="url(#b${id})"/>
  <rect width="${width}" height="${height}" fill="url(#l${id})"/>
  <rect width="${width}" height="${height}" fill="url(#v${id})"/>
</svg>`;
}

/**
 * Liefert das SVG für einen Fallback-Film.
 * @param {number} movieId Numerische ID aus dem Fallback-Datensatz.
 * @param {'poster'|'backdrop'} kind
 * @returns {string|null} SVG-Markup oder null, wenn die ID unbekannt ist.
 */
function movieImageSvg(movieId, kind) {
  const movie = FALLBACK_MOVIE_BY_ID.get(Number(movieId));
  if (!movie) return null;

  return kind === 'backdrop'
    ? buildSvg({ title: movie.title, seedSource: movie.id, width: 1280, height: 720 })
    : buildSvg({ title: movie.title, seedSource: movie.id, width: 500, height: 750 });
}

module.exports = { movieImageSvg, escapeXml };
