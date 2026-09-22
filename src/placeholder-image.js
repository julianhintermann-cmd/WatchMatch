'use strict';

/**
 * Erzeugt neutrale Poster-/Backdrop-Platzhalter als SVG.
 *
 * Damit funktionieren die Fallback-Filme komplett ohne externe Bild-URLs -
 * auch in einem Container ohne Internetzugang. Farben werden deterministisch
 * aus der Film-ID abgeleitet, damit jeder Film immer gleich aussieht.
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

/** XML-Escaping - verhindert, dass Titel die SVG-Struktur aufbrechen. */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Bricht einen Titel in Zeilen mit maximaler Zeichenzahl um. */
function wrapText(text, maxChars, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);

  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, maxChars - 1)).trim()}...`;
  }
  return lines;
}

function paletteFor(seed) {
  const palettes = [
    ['#1f2a4d', '#6d28d9'],
    ['#0f3c4c', '#0ea5a4'],
    ['#3b1447', '#db2777'],
    ['#12263a', '#2563eb'],
    ['#3a1c1c', '#ea580c'],
    ['#14301f', '#16a34a'],
    ['#2d1b3d', '#8b5cf6'],
    ['#1b2735', '#38bdf8'],
  ];
  return palettes[seed % palettes.length];
}

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string|number} options.seedSource Bestimmt die Farbwahl.
 * @param {number} options.width
 * @param {number} options.height
 * @returns {string} SVG-Markup
 */
function buildSvg({ title, seedSource, width, height }) {
  const seed = hashString(String(seedSource));
  const [from, to] = paletteFor(seed);
  const gradientId = `g${seed % 100000}`;
  const isPoster = height > width;

  // Bewusst kleine, gesperrte Schrift: wirkt wie Postergrafik und nicht wie
  // eine Dopplung der Überschrift, die die Filmkarte ohnehin anzeigt.
  const maxChars = isPoster ? 20 : 30;
  const lines = wrapText(title, maxChars, 3);
  const fontSize = isPoster ? 27 : 36;
  const lineHeight = fontSize * 1.35;
  const blockHeight = lines.length * lineHeight;

  /*
   * Der Titel sitzt im oberen Drittel. Auf der Filmkarte liegt unten ein
   * dunkler Verlauf mit den echten Filmdaten - so überlagern sich Platzhalter
   * und Kartentext nicht.
   */
  const startY = height * (isPoster ? 0.3 : 0.42) - blockHeight / 2 + fontSize * 0.85;

  const titleLines = lines
    .map(
      (line, index) =>
        `<text x="50%" y="${(startY + index * lineHeight).toFixed(1)}" text-anchor="middle" ` +
        `font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="${fontSize}" ` +
        `font-weight="600" letter-spacing="${(fontSize * 0.14).toFixed(1)}" fill="#ffffff" ` +
        `opacity="0.88">${escapeXml(line)}</text>`,
    )
    .join('');

  // Dezente Filmstreifen-Perforation als grafisches Motiv.
  const stripeY = height * (isPoster ? 0.58 : 0.72);
  const holes = [];
  const holeSize = Math.round(width * 0.035);
  for (let x = width * 0.08; x < width * 0.93; x += holeSize * 2.4) {
    holes.push(
      `<rect x="${x.toFixed(1)}" y="${stripeY.toFixed(1)}" width="${holeSize}" height="${holeSize}" rx="${Math.round(
        holeSize / 3,
      )}" fill="#ffffff" opacity="0.16"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(
    title,
  )}">
  <defs>
    <linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="${from}"/>
  <rect width="${width}" height="${height}" fill="url(#${gradientId})"/>
  <circle cx="${width * 0.82}" cy="${height * 0.14}" r="${width * 0.3}" fill="#ffffff" opacity="0.07"/>
  <circle cx="${width * 0.1}" cy="${height * 0.92}" r="${width * 0.36}" fill="#000000" opacity="0.16"/>
  <line x1="${(width * 0.28).toFixed(1)}" y1="${(startY - fontSize * 1.5).toFixed(1)}" x2="${(width * 0.72).toFixed(1)}" y2="${(startY - fontSize * 1.5).toFixed(1)}" stroke="#ffffff" stroke-width="1.5" opacity="0.4"/>
  ${titleLines}
  <line x1="${(width * 0.28).toFixed(1)}" y1="${(startY + blockHeight - fontSize * 0.5).toFixed(1)}" x2="${(width * 0.72).toFixed(1)}" y2="${(startY + blockHeight - fontSize * 0.5).toFixed(1)}" stroke="#ffffff" stroke-width="1.5" opacity="0.4"/>
  ${holes.join('')}
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
