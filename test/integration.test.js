'use strict';

/**
 * End-to-End-Test über echte Socket.IO-Verbindungen:
 * Raum erstellen, beitreten, swipen, Match, Reconnect.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');

const { server, io } = require('../server');
const config = require('../src/config');

let baseUrl;
const openSockets = new Set();

function connect() {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { transports: ['websocket'], forceNew: true });
    openSockets.add(socket);
    const timer = setTimeout(() => reject(new Error('Verbindung dauert zu lange')), 6000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Sendet ein Event und wartet auf die Ack-Antwort. */
function send(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Keine Antwort auf ${event}`)), 8000);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

/** Wartet auf ein vom Server gesendetes Event. */
function waitFor(socket, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Event ${event} blieb aus`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function disconnectAll() {
  for (const socket of openSockets) socket.disconnect();
  openSockets.clear();
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  disconnectAll();
  io.close();
  await new Promise((resolve) => server.close(resolve));
});

test('Raum erstellen liefert Code, Session und Host-Rolle', async () => {
  const host = await connect();
  const created = await send(host, 'room:create');

  assert.equal(created.ok, true);
  assert.match(created.state.code, /^WM[2-9A-HJ-NP-Z]{2,6}$/);
  assert.equal(created.state.phase, 'lobby');
  assert.equal(created.state.hostId, created.session.userId);
  assert.equal(created.session.name, 'User 1');
  assert.ok(created.session.token.length >= 32);

  host.disconnect();
});

test('Unbekannter Raum-Code wird verständlich abgelehnt', async () => {
  const guest = await connect();
  const response = await send(guest, 'room:join', { code: 'WM22' });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'ROOM_NOT_FOUND');
  assert.match(response.error.message, /existiert nicht oder ist bereits geschlossen/);

  const invalid = await send(guest, 'room:join', { code: '???' });
  assert.equal(invalid.error.code, 'INVALID_CODE');
  guest.disconnect();
});

test('Kompletter Ablauf: beitreten, starten, swipen, Match', async () => {
  const host = await connect();
  const guest = await connect();

  const created = await send(host, 'room:create');
  const code = created.state.code;

  const hostSeesJoin = waitFor(host, 'room:state');
  const joined = await send(guest, 'room:join', { code });
  assert.equal(joined.ok, true);
  assert.equal(joined.session.name, 'User 2');
  assert.equal(joined.state.users.length, 2);

  const stateAfterJoin = await hostSeesJoin;
  assert.equal(stateAfterJoin.users.length, 2);

  // Nur der Host darf Filter setzen ...
  const guestFilter = await send(guest, 'room:filters', { filters: { genre: 28 } });
  assert.equal(guestFilter.ok, false);
  assert.equal(guestFilter.error.code, 'NOT_HOST');

  const hostFilter = await send(host, 'room:filters', { filters: { minRating: 7 } });
  assert.equal(hostFilter.ok, true);
  assert.equal(hostFilter.filters.minRating, 7);

  // ... und nur der Host darf starten.
  const guestStart = await send(guest, 'room:start');
  assert.equal(guestStart.ok, false);
  assert.equal(guestStart.error.code, 'NOT_HOST');

  const hostMovies = waitFor(host, 'room:movies');
  const guestMovies = waitFor(guest, 'room:movies');
  const started = await send(host, 'room:start');
  assert.equal(started.ok, true);

  const moviesForHost = await hostMovies;
  const moviesForGuest = await guestMovies;
  assert.ok(moviesForHost.movies.length > 0);
  assert.deepEqual(
    moviesForHost.movies.map((movie) => movie.id),
    moviesForGuest.movies.map((movie) => movie.id),
    'alle Teilnehmer bekommen dieselbe Reihenfolge',
  );
  assert.ok(moviesForHost.movies.every((movie) => movie.rating >= 7));

  const movie = moviesForHost.movies[0];

  // Erster Like: noch kein Match.
  const firstLike = await send(host, 'movie:swipe', { movieId: movie.id, direction: 'right' });
  assert.equal(firstLike.ok, true);
  assert.equal(firstLike.swipeCount, 1);

  // Zweiter Like desselben Films -> Match bei allen Teilnehmern.
  const hostMatch = waitFor(host, 'match:created');
  const guestMatch = waitFor(guest, 'match:created');
  await send(guest, 'movie:swipe', { movieId: movie.id, direction: 'right' });

  const matchForHost = await hostMatch;
  const matchForGuest = await guestMatch;
  assert.equal(matchForHost.match.movieId, movie.id);
  assert.equal(matchForGuest.match.movie.title, movie.title);
  assert.equal(matchForHost.totalMatches, 1);
  assert.deepEqual(matchForHost.match.likedBy.slice().sort(), ['User 1', 'User 2']);

  // Doppelter Swipe wird abgelehnt.
  const duplicate = await send(host, 'movie:swipe', { movieId: movie.id, direction: 'left' });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'ALREADY_SWIPED');

  // Unbekannte Film-ID wird abgelehnt.
  const bogus = await send(host, 'movie:swipe', { movieId: 'fb-999999', direction: 'right' });
  assert.equal(bogus.error.code, 'INVALID_MOVIE');

  const injection = await send(host, 'movie:swipe', {
    movieId: '<img src=x onerror=alert(1)>',
    direction: 'right',
  });
  assert.equal(injection.error.code, 'INVALID_MOVIE');

  // Ungültige Richtung wird abgelehnt.
  const wrongDirection = await send(host, 'movie:swipe', {
    movieId: moviesForHost.movies[1].id,
    direction: 'up',
  });
  assert.equal(wrongDirection.error.code, 'INVALID_SWIPE');

  host.disconnect();
  guest.disconnect();
});

test('Reconnect stellt Sitzung, Swipes und Matches wieder her', async () => {
  const host = await connect();
  const created = await send(host, 'room:create');
  const code = created.state.code;

  const guest = await connect();
  const joined = await send(guest, 'room:join', { code });

  const moviesPromise = waitFor(host, 'room:movies');
  await send(host, 'room:start');
  const { movies } = await moviesPromise;

  await send(guest, 'movie:swipe', { movieId: movies[0].id, direction: 'right' });
  await send(guest, 'movie:swipe', { movieId: movies[1].id, direction: 'left' });

  guest.disconnect();
  openSockets.delete(guest);

  const reconnected = await connect();
  const restored = await send(reconnected, 'room:join', {
    code,
    userId: joined.session.userId,
    token: joined.session.token,
  });

  assert.equal(restored.ok, true);
  assert.equal(restored.session.userId, joined.session.userId, 'gleiche Identität nach Reconnect');
  assert.equal(restored.state.phase, 'swiping');
  assert.equal(restored.movies.length, movies.length, 'Filmliste kommt erneut mit');
  assert.deepEqual(restored.yourSwipes, { [movies[0].id]: 'like', [movies[1].id]: 'pass' });

  // Der wiederhergestellte Benutzer darf nicht doppelt bewerten.
  const duplicate = await send(reconnected, 'movie:swipe', {
    movieId: movies[0].id,
    direction: 'right',
  });
  assert.equal(duplicate.error.code, 'ALREADY_SWIPED');

  host.disconnect();
  reconnected.disconnect();
});

test('Voller Raum weist weitere Beitritte ab', async () => {
  const host = await connect();
  const created = await send(host, 'room:create');
  const code = created.state.code;

  for (let i = 1; i < config.maxUsersPerRoom; i += 1) {
    const guest = await connect();
    const response = await send(guest, 'room:join', { code });
    assert.equal(response.ok, true, `Benutzer ${i + 1} sollte beitreten können`);
  }

  const tooMany = await connect();
  const rejected = await send(tooMany, 'room:join', { code });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'ROOM_FULL');
  assert.match(rejected.error.message, /bereits voll/);

  disconnectAll();
});

test('Host-Rolle wandert weiter, wenn der Host den Raum verlässt', async () => {
  const host = await connect();
  const created = await send(host, 'room:create');
  const guest = await connect();
  const joined = await send(guest, 'room:join', { code: created.state.code });

  const guestSeesChange = waitFor(guest, 'room:state');
  await send(host, 'room:leave');
  const newState = await guestSeesChange;

  assert.equal(newState.hostId, joined.session.userId);
  assert.equal(newState.users.length, 1);

  host.disconnect();
  guest.disconnect();
});

test('Aktionen ohne Raum werden abgewiesen', async () => {
  const stray = await connect();
  const swipe = await send(stray, 'movie:swipe', { movieId: 'fb-1', direction: 'right' });
  assert.equal(swipe.error.code, 'NOT_IN_ROOM');

  const start = await send(stray, 'room:start');
  assert.equal(start.error.code, 'NOT_IN_ROOM');
  stray.disconnect();
});

test('Gleichzeitige Swipes mehrerer Clients erzeugen genau ein Match-Event', async () => {
  const host = await connect();
  const created = await send(host, 'room:create');
  const code = created.state.code;

  const guests = [];
  for (let i = 0; i < 3; i += 1) {
    const guest = await connect();
    await send(guest, 'room:join', { code });
    guests.push(guest);
  }

  const moviesPromise = waitFor(host, 'room:movies');
  await send(host, 'room:start');
  const { movies } = await moviesPromise;
  const target = movies[0].id;

  // Jeder Client zählt mit, wie viele Match-Events er für diesen Film sieht.
  const seen = new Map();
  for (const socket of [host, ...guests]) {
    seen.set(socket, 0);
    socket.on('match:created', (payload) => {
      if (payload.match.movieId === target) seen.set(socket, seen.get(socket) + 1);
    });
  }

  // Alle liken denselben Film praktisch gleichzeitig.
  await Promise.all(
    [host, ...guests].map((socket) => send(socket, 'movie:swipe', { movieId: target, direction: 'right' })),
  );
  await new Promise((resolve) => setTimeout(resolve, 400));

  for (const [, count] of seen) {
    assert.equal(count, 1, 'jeder Client sieht genau ein Match-Event');
  }

  host.disconnect();
  guests.forEach((guest) => guest.disconnect());
});

test('Ein neu beitretender Client bekommt die laufende Runde mit', async () => {
  const host = await connect();
  const created = await send(host, 'room:create');
  const code = created.state.code;

  const first = await connect();
  await send(first, 'room:join', { code });

  const moviesPromise = waitFor(host, 'room:movies');
  await send(host, 'room:start');
  const { movies } = await moviesPromise;

  await send(host, 'movie:swipe', { movieId: movies[0].id, direction: 'right' });
  await send(first, 'movie:swipe', { movieId: movies[0].id, direction: 'right' });

  // Jemand kommt mitten in der Runde dazu.
  const late = await connect();
  const joined = await send(late, 'room:join', { code });

  assert.equal(joined.state.phase, 'swiping');
  assert.deepEqual(
    joined.movies.map((movie) => movie.id),
    movies.map((movie) => movie.id),
    'gleiche Filme in gleicher Reihenfolge',
  );
  assert.deepEqual(joined.yourSwipes, {}, 'startet mit leerem Fortschritt');
  assert.equal(joined.state.matches.length, 1, 'bisherige Matches sind sichtbar');

  host.disconnect();
  first.disconnect();
  late.disconnect();
});
