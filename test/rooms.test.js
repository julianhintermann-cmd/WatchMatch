'use strict';

/** Unit-Tests für die Raumlogik (ohne Netzwerk). */

const test = require('node:test');
const assert = require('node:assert/strict');

const rooms = require('../src/rooms');
const config = require('../src/config');

function freshRoom() {
  const { room, user } = rooms.createRoom();
  room.movies = [
    { id: 'fb-1', title: 'A' },
    { id: 'fb-2', title: 'B' },
  ];
  room.phase = 'swiping';
  return { room, host: user };
}

test('Raumcode hat das Format WMXX', () => {
  const { room } = rooms.createRoom();
  assert.match(room.code, /^WM[2-9A-HJ-NP-Z]{2}$/);
  rooms.deleteRoom(room.code);
});

test('Raum-Codes werden normalisiert', () => {
  assert.equal(rooms.normalizeRoomCode('wm8k'), 'WM8K');
  assert.equal(rooms.normalizeRoomCode(' 8K '), 'WM8K');
  assert.equal(rooms.normalizeRoomCode('WM-8K'), 'WM8K');
  assert.equal(rooms.normalizeRoomCode('WM0I'), null); // verwechselbare Zeichen
  assert.equal(rooms.normalizeRoomCode(''), null);
  assert.equal(rooms.normalizeRoomCode(null), null);
  assert.equal(rooms.normalizeRoomCode('<script>'), null);
});

test('Beitritt zu unbekanntem Raum schlägt verständlich fehl', () => {
  assert.throws(() => rooms.joinRoom('WM22'), (error) => {
    assert.equal(error.code, 'ROOM_NOT_FOUND');
    assert.match(error.message, /existiert nicht/);
    return true;
  });
});

test('Ersteller ist Host, zweiter Benutzer nicht', () => {
  const { room, user: host } = rooms.createRoom();
  const { user: guest } = rooms.joinRoom(room.code);
  assert.equal(host.isHost, true);
  assert.equal(guest.isHost, false);
  assert.equal(room.hostId, host.id);
  assert.equal(guest.name, 'User 2');
  rooms.deleteRoom(room.code);
});

test('Raum ist ab maxUsersPerRoom voll', () => {
  const { room } = rooms.createRoom();
  for (let i = 1; i < config.maxUsersPerRoom; i += 1) rooms.joinRoom(room.code);
  assert.throws(() => rooms.joinRoom(room.code), (error) => {
    assert.equal(error.code, 'ROOM_FULL');
    return true;
  });
  rooms.deleteRoom(room.code);
});

test('Reconnect mit gültigem Token stellt die Sitzung wieder her', () => {
  const { room, user } = rooms.createRoom();
  rooms.markDisconnected(room, user.id);
  assert.equal(room.users.get(user.id).connected, false);

  const result = rooms.joinRoom(room.code, { userId: user.id, token: user.token });
  assert.equal(result.rejoined, true);
  assert.equal(result.user.id, user.id);
  assert.equal(result.user.connected, true);
  rooms.deleteRoom(room.code);
});

test('Reconnect mit falschem Token erzeugt einen neuen Benutzer', () => {
  const { room, user } = rooms.createRoom();
  const result = rooms.joinRoom(room.code, { userId: user.id, token: 'falsch' });
  assert.equal(result.rejoined, false);
  assert.notEqual(result.user.id, user.id);
  rooms.deleteRoom(room.code);
});

test('Zwei Likes erzeugen genau ein Match', () => {
  const { room, host } = freshRoom();
  const { user: guest } = rooms.joinRoom(room.code);

  const first = rooms.recordSwipe(room, host.id, 'fb-1', 'right');
  assert.equal(first.match, null, 'ein Like reicht nicht');

  const second = rooms.recordSwipe(room, guest.id, 'fb-1', 'right');
  assert.ok(second.match, 'zweites Like erzeugt Match');
  assert.equal(second.match.movieId, 'fb-1');
  assert.deepEqual(second.match.likedBy.sort(), ['User 1', 'User 2']);
  assert.equal(room.matches.length, 1);

  // Dritter Benutzer liked denselben Film -> kein zweites Match.
  const { user: third } = rooms.joinRoom(room.code);
  const again = rooms.recordSwipe(room, third.id, 'fb-1', 'right');
  assert.equal(again.match, null);
  assert.equal(room.matches.length, 1);
  rooms.deleteRoom(room.code);
});

test('Ein Like und ein Pass erzeugen kein Match', () => {
  const { room, host } = freshRoom();
  const { user: guest } = rooms.joinRoom(room.code);
  rooms.recordSwipe(room, host.id, 'fb-2', 'right');
  const result = rooms.recordSwipe(room, guest.id, 'fb-2', 'left');
  assert.equal(result.match, null);
  assert.equal(room.matches.length, 0);
  rooms.deleteRoom(room.code);
});

test('Doppelte Swipes werden abgelehnt', () => {
  const { room, host } = freshRoom();
  rooms.recordSwipe(room, host.id, 'fb-1', 'right');
  assert.throws(() => rooms.recordSwipe(room, host.id, 'fb-1', 'left'), (error) => {
    assert.equal(error.code, 'ALREADY_SWIPED');
    return true;
  });
  rooms.deleteRoom(room.code);
});

test('Ungültige Swipe-Daten werden abgewiesen', () => {
  const { room, host } = freshRoom();
  assert.throws(() => rooms.recordSwipe(room, host.id, 'fb-1', 'up'), /Ungültiger Swipe/);
  assert.throws(() => rooms.recordSwipe(room, host.id, 'fb-999', 'right'), /gehört nicht/);
  assert.throws(() => rooms.recordSwipe(room, host.id, '<script>', 'right'), /gehört nicht/);
  assert.throws(() => rooms.recordSwipe(room, host.id, { evil: true }, 'right'), /gehört nicht/);
  rooms.deleteRoom(room.code);
});

test('Swipes ausserhalb der Runde werden abgelehnt', () => {
  const { room, user } = rooms.createRoom();
  room.movies = [{ id: 'fb-1', title: 'A' }];
  assert.throws(() => rooms.recordSwipe(room, user.id, 'fb-1', 'right'), (error) => {
    assert.equal(error.code, 'WRONG_PHASE');
    return true;
  });
  rooms.deleteRoom(room.code);
});

test('Nur der Host darf Filter setzen und starten', () => {
  const { room, user: host } = rooms.createRoom();
  const { user: guest } = rooms.joinRoom(room.code);

  assert.throws(() => rooms.setFilters(room, guest.id, { genre: 28 }), (error) => {
    assert.equal(error.code, 'NOT_HOST');
    return true;
  });
  assert.doesNotThrow(() => rooms.setFilters(room, host.id, { genre: 28, minRating: 0, yearFrom: null, yearTo: null }));
  assert.equal(room.filters.genre, 28);
  rooms.deleteRoom(room.code);
});

test('Host-Rolle wandert weiter, wenn der Host geht', () => {
  const { room, user: host } = rooms.createRoom();
  const { user: guest } = rooms.joinRoom(room.code);
  const result = rooms.leaveRoom(room, host.id);
  assert.equal(result.newHost.id, guest.id);
  assert.equal(room.hostId, guest.id);
  assert.equal(room.users.get(guest.id).isHost, true);
  rooms.deleteRoom(room.code);
});

test('publicState enthält keine Tokens', () => {
  const { room } = rooms.createRoom();
  const serialized = JSON.stringify(rooms.publicState(room));
  assert.ok(!serialized.includes('token'), 'publicState darf kein Token enthalten');
  rooms.deleteRoom(room.code);
});

test('Neue Runde setzt Swipes und Matches zurück', () => {
  const { room, host } = freshRoom();
  const { user: guest } = rooms.joinRoom(room.code);
  rooms.recordSwipe(room, host.id, 'fb-1', 'right');
  rooms.recordSwipe(room, guest.id, 'fb-1', 'right');
  assert.equal(room.matches.length, 1);

  room.lastStartAt = 0;
  rooms.startRound(room, host.id, [{ id: 'fb-3', title: 'C' }], 'fallback');
  assert.equal(room.matches.length, 0);
  assert.equal(rooms.publicState(room).users.every((user) => user.swipes === 0), true);
  rooms.deleteRoom(room.code);
});

test('cleanupSweep entfernt abgelaufene Räume', () => {
  const { room } = rooms.createRoom();
  const code = room.code;
  const deleted = [];
  rooms.cleanupSweep({
    now: Date.now() + config.roomMaxLifetimeMs + 1000,
    onRoomDeleted: (roomCode) => deleted.push(roomCode),
  });
  assert.ok(deleted.includes(code));
  assert.equal(rooms.getRoom(code), null);
});

test('cleanupSweep entfernt abgelaufene Benutzer und befördert einen neuen Host', () => {
  const { room, user: host } = rooms.createRoom();
  const { user: guest } = rooms.joinRoom(room.code);

  rooms.markDisconnected(room, host.id);

  const changed = [];
  rooms.cleanupSweep({
    now: Date.now() + config.userReconnectGraceMs + 1000,
    onRoomChanged: (updated) => changed.push(updated.code),
  });

  assert.equal(room.users.has(host.id), false, 'abgelaufener Benutzer entfernt');
  assert.equal(room.hostId, guest.id, 'Host-Rolle weitergegeben');
  assert.equal(room.users.get(guest.id).isHost, true);
  assert.ok(changed.includes(room.code), 'Änderung wird gemeldet');
  rooms.deleteRoom(room.code);
});

test('Gleichzeitige Likes erzeugen genau ein Match', () => {
  const { room, host } = freshRoom();
  const guests = [];
  for (let i = 1; i < config.maxUsersPerRoom; i += 1) guests.push(rooms.joinRoom(room.code).user);

  const results = [host, ...guests].map((user) => rooms.recordSwipe(room, user.id, 'fb-1', 'right'));
  const matches = results.filter((result) => result.match !== null);

  assert.equal(matches.length, 1, 'trotz 8 Likes nur ein Match');
  assert.equal(room.matches.length, 1);
  assert.equal(room.matchedMovieIds.size, 1);
  rooms.deleteRoom(room.code);
});

test('Ein Benutzer allein erzeugt nie ein Match', () => {
  const { room, host } = freshRoom();
  const first = rooms.recordSwipe(room, host.id, 'fb-1', 'right');
  const second = rooms.recordSwipe(room, host.id, 'fb-2', 'right');
  assert.equal(first.match, null);
  assert.equal(second.match, null);
  assert.equal(room.matches.length, 0);
  rooms.deleteRoom(room.code);
});
