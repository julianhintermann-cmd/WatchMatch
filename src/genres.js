'use strict';

/**
 * TMDB-Genre-IDs und ihre deutschen Namen.
 *
 * Die IDs entsprechen den offiziellen TMDB-Genre-IDs, damit Fallback-Daten und
 * TMDB-Daten exakt gleich gefiltert und normalisiert werden können.
 */
const GENRES = [
  { id: 28, name: 'Action' },
  { id: 12, name: 'Abenteuer' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Komödie' },
  { id: 80, name: 'Krimi' },
  { id: 99, name: 'Dokumentation' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Familie' },
  { id: 14, name: 'Fantasy' },
  { id: 36, name: 'Historie' },
  { id: 27, name: 'Horror' },
  { id: 10402, name: 'Musik' },
  { id: 9648, name: 'Mystery' },
  { id: 10749, name: 'Liebesfilm' },
  { id: 878, name: 'Science Fiction' },
  { id: 53, name: 'Thriller' },
  { id: 10752, name: 'Kriegsfilm' },
  { id: 37, name: 'Western' },
];

/** Genres, die im Filter-UI angeboten werden (siehe Anforderungskatalog). */
const FILTERABLE_GENRE_IDS = [28, 12, 16, 35, 80, 18, 14, 27, 9648, 10749, 878, 53];

const GENRE_NAME_BY_ID = new Map(GENRES.map((genre) => [genre.id, genre.name]));

/** @returns {string[]} Genre-Namen für eine Liste von TMDB-Genre-IDs. */
function genreNames(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => GENRE_NAME_BY_ID.get(Number(id))).filter(Boolean);
}

/** @returns {{id:number,name:string}[]} Die im UI auswählbaren Genres. */
function filterableGenres() {
  return FILTERABLE_GENRE_IDS.map((id) => ({ id, name: GENRE_NAME_BY_ID.get(id) })).filter(
    (genre) => Boolean(genre.name),
  );
}

function isKnownGenreId(id) {
  return GENRE_NAME_BY_ID.has(Number(id));
}

module.exports = { GENRES, FILTERABLE_GENRE_IDS, genreNames, filterableGenres, isKnownGenreId };
