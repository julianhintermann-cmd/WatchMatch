'use strict';

/**
 * Tests für die TMDB-Anbindung. `fetch` wird ersetzt, damit kein echter
 * API-Key und kein Netzwerkzugriff nötig ist.
 */

// Muss vor dem Laden der Module gesetzt sein – config liest die Variable einmalig.
process.env.TMDB_API_KEY = 'test-key-1234567890';

const test = require('node:test');
const assert = require('node:assert/strict');

const movieService = require('../src/movie-service');

const realFetch = globalThis.fetch;
const requestedUrls = [];

function discoverPage(ids) {
  return {
    results: ids.map((id) => ({
      id,
      title: `Film ${id}`,
      overview: `Beschreibung ${id}`,
      release_date: '2015-06-01',
      poster_path: `/poster${id}.jpg`,
      backdrop_path: `/backdrop${id}.jpg`,
      vote_average: 8.1,
      genre_ids: [878, 28],
    })),
  };
}

/** Ersetzt `fetch` durch eine Attrappe. */
function stubFetch(handler) {
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return handler(String(url));
  };
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
  requestedUrls.length = 0;
});

test('TMDB gilt als aktiv, sobald ein Key gesetzt ist', () => {
  assert.equal(movieService.isTmdbEnabled(), true);
});

test('TMDB-Daten werden abgerufen und normalisiert', async () => {
  stubFetch((url) => {
    if (url.includes('/discover/movie')) {
      return { ok: true, json: async () => discoverPage([101, 102, 103]) };
    }
    if (url.includes('/movie/101')) return { ok: true, json: async () => ({ runtime: 132 }) };
    return { ok: true, json: async () => ({ runtime: 99 }) };
  });

  const { movies, source } = await movieService.getMovies(
    { genre: 878, minRating: 7 },
    { count: 3, seed: 'WMAB' },
  );

  assert.equal(source, 'tmdb');
  assert.ok(movies.length > 0);

  const movie = movies[0];
  assert.match(movie.id, /^tmdb-10[123]$/);
  assert.match(movie.posterUrl, /^https:\/\/image\.tmdb\.org\/t\/p\/w500\/poster\d+\.jpg$/);
  assert.match(movie.backdropUrl, /^https:\/\/image\.tmdb\.org\/t\/p\/w780\//);
  assert.equal(movie.year, 2015);
  assert.equal(movie.rating, 8.1);
  assert.deepEqual(movie.genres, ['Science Fiction', 'Action']);
  assert.ok(movie.runtime > 0, 'Laufzeit wurde nachgeladen');

  // Der Key geht an TMDB ...
  assert.ok(requestedUrls.some((url) => url.includes('api_key=test-key-1234567890')));
  // ... taucht aber in keinem ausgelieferten Feld auf.
  assert.ok(!JSON.stringify(movies).includes('test-key'));
});

test('Filter werden als TMDB-Query-Parameter übersetzt', async () => {
  stubFetch((url) => {
    if (url.includes('/discover/movie')) return { ok: true, json: async () => discoverPage([201]) };
    return { ok: true, json: async () => ({ runtime: 101 }) };
  });

  await movieService.getMovies(
    { genre: 27, minRating: 6.5, yearFrom: 2001, yearTo: 2009 },
    { count: 5, seed: 'WMCD' },
  );

  const discover = requestedUrls.find((url) => url.includes('/discover/movie'));
  assert.ok(discover.includes('with_genres=27'));
  assert.ok(discover.includes('vote_average.gte=6.5'));
  assert.ok(discover.includes('primary_release_date.gte=2001-01-01'));
  assert.ok(discover.includes('primary_release_date.lte=2009-12-31'));
  assert.ok(discover.includes('include_adult=false'));
});

test('Bei TMDB-Fehlern greift der lokale Fallback', async () => {
  stubFetch(() => {
    throw new Error('Netzwerk nicht erreichbar');
  });

  const { movies, source } = await movieService.getMovies(
    { genre: 28, minRating: 0, yearFrom: 1990 },
    { count: 5, seed: 'WMEF' },
  );

  assert.equal(source, 'fallback');
  assert.ok(movies.length > 0);
  assert.ok(movies.every((movie) => movie.id.startsWith('fb-')));
});

test('Auch ein HTTP-Fehler von TMDB führt zum Fallback', async () => {
  stubFetch(() => ({ ok: false, status: 401, json: async () => ({}) }));

  const { source, movies } = await movieService.getMovies(
    { genre: 35, minRating: 0 },
    { count: 4, seed: 'WMGH' },
  );

  assert.equal(source, 'fallback');
  assert.ok(movies.length > 0);
});

test('Filme ohne Poster werden übersprungen', async () => {
  stubFetch((url) => {
    if (url.includes('/discover/movie')) {
      return {
        ok: true,
        json: async () => ({
          results: [
            { id: 301, title: 'Mit Poster', poster_path: '/p.jpg', vote_average: 7, release_date: '2020-01-01', genre_ids: [28] },
            { id: 302, title: 'Ohne Poster', poster_path: null, vote_average: 7, release_date: '2020-01-01', genre_ids: [28] },
          ],
        }),
      };
    }
    return { ok: true, json: async () => ({ runtime: 100 }) };
  });

  const { movies } = await movieService.getMovies({ genre: 12 }, { count: 10, seed: 'WMIJ' });
  assert.equal(movies.length, 1);
  assert.equal(movies[0].title, 'Mit Poster');
});
