'use strict';

/**
 * Film-Service (ausschließlich serverseitig).
 *
 * Verantwortlich für:
 *  - Abruf von TMDB (`discover/movie` + Details für die Laufzeit)
 *  - Normalisierung auf ein schlankes Client-Format
 *  - Filterung (Genre, Mindestbewertung, Jahr)
 *  - deterministisches Mischen, damit alle Raumteilnehmer dieselbe
 *    Reihenfolge sehen
 *  - automatischen Fallback auf den lokalen Datensatz
 *
 * Der TMDB-API-Key verlässt diesen Prozess nie.
 */

const config = require('./config');
const { FALLBACK_MOVIES } = require('./fallback-movies');
const { genreNames, isKnownGenreId } = require('./genres');

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1888;
const MAX_YEAR = CURRENT_YEAR + 5;

/** Fehler, wenn zu den Filtern keine Filme gefunden wurden. */
class NoMoviesError extends Error {
  constructor(message = 'Zu diesen Filtern wurden keine Filme gefunden.') {
    super(message);
    this.name = 'NoMoviesError';
    this.code = 'NO_MOVIES';
  }
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/** Standardfilter eines neuen Raums. */
function defaultFilters() {
  return { genre: null, minRating: 0, yearFrom: null, yearTo: null };
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Validiert und normalisiert Filter-Eingaben vom Client.
 * Unbekannte oder unsinnige Werte werden still auf sichere Defaults gesetzt.
 */
function sanitizeFilters(input) {
  const filters = defaultFilters();
  if (!input || typeof input !== 'object') return filters;

  const genre = toFiniteNumber(input.genre);
  if (genre !== null && isKnownGenreId(genre)) {
    filters.genre = Math.trunc(genre);
  }

  const minRating = toFiniteNumber(input.minRating);
  if (minRating !== null) {
    filters.minRating = Math.round(Math.min(10, Math.max(0, minRating)) * 10) / 10;
  }

  let yearFrom = toFiniteNumber(input.yearFrom);
  let yearTo = toFiniteNumber(input.yearTo);
  if (yearFrom !== null) yearFrom = Math.min(MAX_YEAR, Math.max(MIN_YEAR, Math.trunc(yearFrom)));
  if (yearTo !== null) yearTo = Math.min(MAX_YEAR, Math.max(MIN_YEAR, Math.trunc(yearTo)));
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    [yearFrom, yearTo] = [yearTo, yearFrom];
  }
  filters.yearFrom = yearFrom;
  filters.yearTo = yearTo;

  return filters;
}

// ---------------------------------------------------------------------------
// Normalisierung
// ---------------------------------------------------------------------------

function yearOf(releaseDate) {
  if (typeof releaseDate !== 'string' || releaseDate.length < 4) return null;
  const year = Number.parseInt(releaseDate.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function tmdbImageUrl(path, size) {
  if (!path || typeof path !== 'string') return null;
  if (path.startsWith('/img/')) return path; // lokal erzeugter Platzhalter
  return `${config.tmdbImageBaseUrl}/${size}${path}`;
}

/**
 * Bringt Fallback- und TMDB-Rohdaten in genau ein Client-Format.
 * Es werden nur Felder ausgeliefert, die das UI wirklich braucht.
 */
function normalizeMovie(raw, source) {
  const genreIds = Array.isArray(raw.genres)
    ? raw.genres.map((genre) => (typeof genre === 'object' && genre ? genre.id : genre))
    : Array.isArray(raw.genre_ids)
      ? raw.genre_ids
      : [];

  const rating = Number(raw.vote_average);
  const runtime = Number(raw.runtime);

  return {
    id: `${source}-${raw.id}`,
    title: String(raw.title || raw.name || 'Unbekannter Titel').slice(0, 160),
    overview: String(raw.overview || '').slice(0, 600),
    year: yearOf(raw.release_date),
    releaseDate: typeof raw.release_date === 'string' ? raw.release_date : null,
    posterUrl: tmdbImageUrl(raw.poster_path, 'w500'),
    backdropUrl: tmdbImageUrl(raw.backdrop_path, 'w780'),
    rating: Number.isFinite(rating) ? Math.round(rating * 10) / 10 : null,
    genres: genreNames(genreIds).slice(0, 3),
    runtime: Number.isFinite(runtime) && runtime > 0 ? Math.trunc(runtime) : null,
  };
}

// ---------------------------------------------------------------------------
// Deterministisches Mischen
// ---------------------------------------------------------------------------

function seedToInt(seed) {
  let hash = 2166136261;
  const value = String(seed);
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Kleiner, schneller PRNG (mulberry32) für reproduzierbare Reihenfolgen. */
function createRandom(seed) {
  let state = seedToInt(seed);
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates mit seed-basiertem PRNG - gleiche Seed, gleiche Reihenfolge. */
function shuffleWithSeed(items, seed) {
  const result = items.slice();
  const random = createRandom(seed);
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Lokaler Fallback
// ---------------------------------------------------------------------------

function matchesFilters(movie, filters) {
  const genreIds = Array.isArray(movie.genres) ? movie.genres.map(Number) : [];
  if (filters.genre !== null && !genreIds.includes(filters.genre)) return false;
  if (filters.minRating > 0 && Number(movie.vote_average) < filters.minRating) return false;

  const year = yearOf(movie.release_date);
  if (filters.yearFrom !== null && (year === null || year < filters.yearFrom)) return false;
  if (filters.yearTo !== null && (year === null || year > filters.yearTo)) return false;
  return true;
}

function fallbackCandidates(filters) {
  return FALLBACK_MOVIES.filter((movie) => matchesFilters(movie, filters)).map((movie) =>
    normalizeMovie(movie, 'fb'),
  );
}

// ---------------------------------------------------------------------------
// TMDB
// ---------------------------------------------------------------------------

const tmdbCache = new Map(); // cacheKey -> { expiresAt, movies }

function cacheKeyFor(filters) {
  return [filters.genre, filters.minRating, filters.yearFrom, filters.yearTo].join('|');
}

function readCache(key) {
  const entry = tmdbCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    tmdbCache.delete(key);
    return null;
  }
  return entry.movies;
}

function writeCache(key, movies) {
  if (config.tmdbCacheTtlMs <= 0) return;
  if (tmdbCache.size > 200) tmdbCache.clear();
  tmdbCache.set(key, { expiresAt: Date.now() + config.tmdbCacheTtlMs, movies });
}

function isTmdbEnabled() {
  return config.tmdbApiKey.length > 0;
}

/**
 * TMDB gibt zwei Zugangsdaten aus, die sich nicht gleich verwenden lassen:
 *
 *   API Key (v3 auth)         32-stelliger Hex-String, als `api_key` in der URL
 *   API Read Access Token (v4) JWT, als `Authorization: Bearer` im Header
 *
 * Beide werden hier unterstützt, weil erfahrungsgemäß oft der falsche kopiert
 * wird. Ein JWT beginnt immer mit `eyJ` und enthält Punkte.
 */
function usesBearerToken() {
  return /^eyJ[\w-]+\.[\w-]+\./.test(config.tmdbApiKey);
}

/** Welche Art Zugangsdatum konfiguriert ist - für Diagnose und Logausgabe. */
function credentialKind() {
  if (!isTmdbEnabled()) return 'none';
  return usesBearerToken() ? 'read-access-token' : 'api-key';
}

/**
 * Merkt sich den letzten TMDB-Fehler. Ohne das fällt die App bei einem
 * abgelehnten Schlüssel still auf die lokalen Filme zurück, und niemand
 * erfährt, warum keine echten Cover erscheinen.
 */
let lastTmdbError = null;

function tmdbStatus() {
  if (!isTmdbEnabled()) return { state: 'disabled', credential: 'none' };
  if (lastTmdbError) return { state: 'error', credential: credentialKind(), ...lastTmdbError };
  return { state: 'ok', credential: credentialKind() };
}

/** `fetch` mit Timeout - hängende Requests blockieren so keine Raumrunde. */
async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.tmdbTimeoutMs);
  const headers = { Accept: 'application/json' };
  if (usesBearerToken()) headers.Authorization = `Bearer ${config.tmdbApiKey}`;

  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) {
      const error = new Error(`TMDB antwortete mit HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildDiscoverUrl(filters, page) {
  const params = new URLSearchParams({
    language: config.tmdbLanguage,
    sort_by: 'popularity.desc',
    include_adult: 'false',
    include_video: 'false',
    'vote_count.gte': '150',
    page: String(page),
  });
  if (filters.genre !== null) params.set('with_genres', String(filters.genre));
  if (filters.minRating > 0) params.set('vote_average.gte', String(filters.minRating));
  if (filters.yearFrom !== null) params.set('primary_release_date.gte', `${filters.yearFrom}-01-01`);
  if (filters.yearTo !== null) params.set('primary_release_date.lte', `${filters.yearTo}-12-31`);
  if (!usesBearerToken()) params.set('api_key', config.tmdbApiKey);
  return `${config.tmdbBaseUrl}/discover/movie?${params.toString()}`;
}

/** Zeitbudget für das Nachladen der Laufzeiten. */
const RUNTIME_ENRICH_BUDGET_MS = 8000;

/**
 * Holt Laufzeiten nach (`discover` liefert keine `runtime`).
 *
 * Fehlschläge sind unkritisch: das UI blendet fehlende Laufzeiten aus. Damit
 * ein langsames TMDB den Rundenstart nicht blockiert, bricht die Anreicherung
 * nach einem festen Zeitbudget ab.
 */
async function enrichWithRuntime(movies) {
  const chunkSize = 8;
  const deadline = Date.now() + RUNTIME_ENRICH_BUDGET_MS;

  for (let i = 0; i < movies.length; i += chunkSize) {
    if (Date.now() > deadline) {
      console.warn('[tmdb] Zeitbudget für Laufzeiten erreicht – Rest wird ohne Laufzeit angezeigt.');
      break;
    }
    const chunk = movies.slice(i, i + chunkSize);
    const results = await Promise.allSettled(
      chunk.map((movie) => {
        const params = new URLSearchParams({ language: config.tmdbLanguage });
        if (!usesBearerToken()) params.set('api_key', config.tmdbApiKey);
        const tmdbId = movie.id.replace(/^tmdb-/, '');
        return fetchJson(`${config.tmdbBaseUrl}/movie/${tmdbId}?${params.toString()}`);
      }),
    );
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      const runtime = Number(result.value && result.value.runtime);
      if (Number.isFinite(runtime) && runtime > 0) {
        chunk[index].runtime = Math.trunc(runtime);
      }
    });
  }
  return movies;
}

/**
 * @returns {Promise<object[]|null>} Normalisierte TMDB-Filme oder `null`,
 * wenn TMDB nicht erreichbar ist (dann greift der Fallback).
 */
async function fetchFromTmdb(filters, count) {
  if (!isTmdbEnabled()) return null;

  const key = cacheKeyFor(filters);
  const cached = readCache(key);
  if (cached) return cached;

  try {
    const pagesNeeded = Math.min(5, Math.max(2, Math.ceil((count * 2) / 20)));
    const pages = await Promise.all(
      Array.from({ length: pagesNeeded }, (_, index) => fetchJson(buildDiscoverUrl(filters, index + 1))),
    );

    const seen = new Set();
    const movies = [];
    for (const page of pages) {
      for (const raw of Array.isArray(page && page.results) ? page.results : []) {
        if (!raw || seen.has(raw.id)) continue;
        if (!raw.poster_path) continue; // ohne Poster sieht die Karte kaputt aus
        seen.add(raw.id);
        movies.push(normalizeMovie(raw, 'tmdb'));
      }
    }

    writeCache(key, movies);
    lastTmdbError = null;
    return movies;
  } catch (error) {
    // Ein abgelehnter Schlüssel ist etwas anderes als ein Netzwerkproblem.
    // Beides wird festgehalten, damit /health und /api/config es benennen
    // können, statt still auf die lokalen Filme zurückzufallen.
    const status = Number(error.status) || null;
    let hint = null;
    if (status === 401) {
      hint = usesBearerToken()
        ? 'TMDB lehnt den Read Access Token ab. Prüfe, ob er vollständig kopiert wurde.'
        : 'TMDB lehnt den API-Key ab. Hast du versehentlich den Read Access Token als API Key eingetragen?';
    } else if (status === 404) {
      hint = 'TMDB kennt diesen Endpunkt nicht - vermutlich ein unvollständiger Schlüssel.';
    } else if (status) {
      hint = `TMDB antwortete mit HTTP ${status}.`;
    } else {
      hint = 'TMDB war nicht erreichbar. Hat der Server Internetzugang?';
    }

    lastTmdbError = { status, hint, at: new Date().toISOString() };
    console.warn(`[tmdb] Abruf fehlgeschlagen (${error.message}) - nutze Fallback-Filme. ${hint}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Oeffentliche API
// ---------------------------------------------------------------------------

/**
 * Stellt die Filmliste für eine Raumrunde zusammen.
 *
 * @param {object} rawFilters Filter vom Host.
 * @param {object} [options]
 * @param {number} [options.count] Anzahl Filme.
 * @param {string} [options.seed] Seed für die Reihenfolge (z.B. Raumcode).
 * @returns {Promise<{movies: object[], source: 'tmdb'|'fallback', filters: object}>}
 * @throws {NoMoviesError} Wenn die Filter kein Ergebnis liefern.
 */
async function getMovies(rawFilters, options = {}) {
  const filters = sanitizeFilters(rawFilters);
  const count = Math.min(100, Math.max(5, Number(options.count) || config.moviesPerRound));
  const seed = options.seed === undefined ? String(Date.now()) : String(options.seed);

  let source = 'fallback';
  let candidates = await fetchFromTmdb(filters, count);

  if (candidates === null) {
    candidates = fallbackCandidates(filters);
  } else if (candidates.length === 0) {
    // TMDB war erreichbar, hat aber nichts geliefert -> lokal gegenprüfen.
    candidates = fallbackCandidates(filters);
  } else {
    source = 'tmdb';
  }

  if (candidates.length === 0) {
    throw new NoMoviesError();
  }

  const selected = shuffleWithSeed(candidates, seed).slice(0, count);
  if (source === 'tmdb') {
    await enrichWithRuntime(selected);
  }
  return { movies: selected, source, filters };
}

module.exports = {
  getMovies,
  tmdbStatus,
  credentialKind,
  sanitizeFilters,
  defaultFilters,
  normalizeMovie,
  shuffleWithSeed,
  isTmdbEnabled,
  NoMoviesError,
  MIN_YEAR,
  MAX_YEAR,
};
