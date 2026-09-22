'use strict';

/** Tests für die REST-Endpunkte. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { server } = require('../server');

let baseUrl;

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { status: response.status, headers: response.headers, body };
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET /health meldet den Status', async () => {
  const { status, body } = await get('/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'watchmatch');
  assert.equal(typeof body.rooms, 'number');
});

test('GET /api/config liefert keine Secrets', async () => {
  const { status, body } = await get('/api/config');
  assert.equal(status, 200);
  assert.equal(typeof body.tmdbEnabled, 'boolean');
  assert.equal(body.maxUsersPerRoom, 8);
  assert.ok(body.genres.length >= 12);

  const serialized = JSON.stringify(body).toLowerCase();
  assert.ok(!serialized.includes('api_key'), 'kein API-Key im Payload');
  assert.ok(!serialized.includes('tmdb_api_key'));
  assert.ok(!serialized.includes('apikey'));
});

test('GET /api/movies liefert gefilterte, normalisierte Filme', async () => {
  const { status, body } = await get('/api/movies?genre=878&minRating=7.5&count=8');
  assert.equal(status, 200);
  assert.equal(body.movies.length, 8);
  assert.ok(['tmdb', 'fallback'].includes(body.source));

  for (const movie of body.movies) {
    assert.match(movie.id, /^[a-z]+-\d+$/);
    assert.equal(typeof movie.title, 'string');
    assert.ok(movie.rating >= 7.5);
    assert.ok(movie.genres.includes('Science Fiction'));
    // Es werden nur benötigte Felder ausgeliefert.
    assert.equal(movie.poster_path, undefined);
    assert.equal(movie.vote_average, undefined);
  }
});

test('GET /api/movies mit unerfüllbaren Filtern antwortet mit 404', async () => {
  const { status, body } = await get('/api/movies?minRating=9.9&yearFrom=2030');
  assert.equal(status, 404);
  assert.equal(body.error.code, 'NO_MOVIES');
});

test('GET /api/movies ignoriert unsinnige Eingaben', async () => {
  const { status, body } = await get('/api/movies?genre=evil&minRating=-99&count=999&yearFrom=abc');
  assert.equal(status, 200);
  assert.equal(body.filters.genre, null);
  assert.equal(body.filters.minRating, 0);
  assert.equal(body.filters.yearFrom, null);
  assert.ok(body.movies.length <= 100);
});

test('GET /api/rooms/:code validiert den Code', async () => {
  const unknown = await get('/api/rooms/WM22');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.exists, false);

  const invalid = await get('/api/rooms/nope!');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'INVALID_CODE');
});

test('Platzhalter-Poster werden als SVG ausgeliefert', async () => {
  const { status, headers, body } = await get('/img/poster/10.svg');
  assert.equal(status, 200);
  assert.match(headers.get('content-type'), /image\/svg\+xml/);
  assert.match(body, /^<svg /);
  assert.ok(!body.includes('<script'), 'SVG enthält kein Skript');

  const missing = await get('/img/poster/999999.svg');
  assert.equal(missing.status, 404);
});

test('Security-Header sind gesetzt', async () => {
  const { headers } = await get('/health');
  const csp = headers.get('content-security-policy');
  assert.ok(csp, 'CSP-Header fehlt');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.ok(!csp.includes("'unsafe-eval'"), 'kein unsafe-eval erlaubt');
  assert.equal(headers.get('x-powered-by'), null);
  assert.ok(headers.get('x-content-type-options'));
});

test('Die App wird unter / und /room/:code ausgeliefert', async () => {
  const root = await get('/');
  assert.equal(root.status, 200);
  assert.match(root.body, /WatchMatch/i);
  assert.match(root.body, /id="view-home"/);

  const room = await get('/room/WM8K');
  assert.equal(room.status, 200);
  assert.match(room.body, /<title>/);
});

test('Unbekannte API-Pfade liefern JSON-404', async () => {
  const { status, body } = await get('/api/gibtsnicht');
  assert.equal(status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
});
