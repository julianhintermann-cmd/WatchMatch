'use strict';

/**
 * Raumverwaltung.
 *
 * Alle Räume liegen ausschließlich im RAM (Version 1 braucht keine Datenbank).
 * Dieses Modul kennt weder Express noch Socket.IO - es ist reine Zustandslogik
 * und dadurch gut testbar.
 *
 * Raumstruktur:
 *   {
 *     code, hostId, phase: 'lobby' | 'swiping',
 *     users: Map<userId, User>,
 *     movies: [],
 *     swipes: Map<userId, Map<movieId, 'like'|'pass'>>,
 *     likesByMovie: Map<movieId, Set<userId>>,
 *     matches: [], matchedMovieIds: Set,
 *     filters: { genre, minRating, yearFrom, yearTo },
 *     createdAt, startedAt, movieSource
 *   }
 */

const crypto = require('crypto');
const config = require('./config');
const { defaultFilters } = require('./movie-service');

/** Zeichen ohne leicht verwechselbare Glyphen (kein 0/O, 1/I). */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_PREFIX = 'WM';
const CODE_PATTERN = /^WM[2-9A-HJ-NP-Z]{2,6}$/;
const MOVIE_ID_PATTERN = /^[a-z]{2,8}-\d{1,12}$/;

/** Fehler mit maschinenlesbarem Code und benutzerfreundlicher Meldung. */
class RoomError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RoomError';
    this.code = code;
  }
}

/** @type {Map<string, object>} */
const rooms = new Map();

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function randomCode(length) {
  const bytes = crypto.randomBytes(length);
  let code = CODE_PREFIX;
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Erzeugt einen freien Raumcode im Format `WMXX`.
 * Wenn der kurze Coderaum belegt ist, wird der Code schrittweise länger.
 */
function generateRoomCode() {
  for (let length = 2; length <= 6; length += 1) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = randomCode(length);
      if (!rooms.has(code)) return code;
    }
  }
  throw new RoomError('ROOM_LIMIT', 'Aktuell sind zu viele Räume offen. Bitte kurz später erneut versuchen.');
}

/**
 * Prüft und normalisiert einen vom Benutzer eingegebenen Raumcode.
 * Akzeptiert auch Eingaben ohne Prefix ("8K") und Kleinschreibung.
 */
function normalizeRoomCode(input) {
  if (typeof input !== 'string') return null;
  let code = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (code.length === 0 || code.length > 10) return null;
  if (!code.startsWith(CODE_PREFIX)) code = CODE_PREFIX + code;
  return CODE_PATTERN.test(code) ? code : null;
}

function isValidMovieId(value) {
  return typeof value === 'string' && value.length <= 32 && MOVIE_ID_PATTERN.test(value);
}

function createUserId() {
  return `u_${crypto.randomBytes(6).toString('hex')}`;
}

function createUserToken() {
  return crypto.randomBytes(24).toString('hex');
}

/** Konstantzeit-Vergleich für Session-Tokens. */
function tokensMatch(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string') return false;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

/** Vergibt den nächsten freien Anzeigenamen ("User 1", "User 2", ...). */
function nextUserName(room) {
  const used = new Set(Array.from(room.users.values(), (user) => user.name));
  for (let index = 1; index <= config.maxUsersPerRoom + 1; index += 1) {
    const candidate = `User ${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `User ${room.users.size + 1}`;
}

/** Benutzer, die aktuell einen Platz belegen (verbunden oder in Reconnect-Karenz). */
function activeUsers(room) {
  const now = Date.now();
  return Array.from(room.users.values()).filter(
    (user) =>
      user.connected ||
      (user.disconnectedAt !== null && now - user.disconnectedAt < config.userReconnectGraceMs),
  );
}

function connectedCount(room) {
  let count = 0;
  for (const user of room.users.values()) {
    if (user.connected) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Lebenszyklus
// ---------------------------------------------------------------------------

/** Löscht den Raum sofort. */
function deleteRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  rooms.delete(code);
}

/**
 * Startet die Grace Period: ein leerer Raum wird erst nach Ablauf gelöscht,
 * damit ein kurzer Verbindungsabbruch den Raum nicht zerstört.
 */
function scheduleCleanup(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    room.cleanupTimer = null;
    if (connectedCount(room) === 0) deleteRoom(room.code);
  }, config.roomGracePeriodMs);
  if (typeof room.cleanupTimer.unref === 'function') room.cleanupTimer.unref();
}

function cancelCleanup(room) {
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }
}

/**
 * Periodisches Aufräumen: entfernt abgelaufene Benutzer und alte Räume.
 *
 * @param {object} [options]
 * @param {number} [options.now] Zeitstempel (für Tests).
 * @param {(code: string, reason: string) => void} [options.onRoomDeleted]
 * @param {(room: object) => void} [options.onRoomChanged] Der Raum hat sich
 *   geändert (Benutzer entfernt oder neuer Host) und sollte neu verteilt werden.
 * @returns {{removedRooms: number, removedUsers: number}}
 */
function cleanupSweep(options = {}) {
  const now = options.now || Date.now();
  const onRoomDeleted = typeof options.onRoomDeleted === 'function' ? options.onRoomDeleted : null;
  const onRoomChanged = typeof options.onRoomChanged === 'function' ? options.onRoomChanged : null;
  let removedRooms = 0;
  let removedUsers = 0;

  for (const room of Array.from(rooms.values())) {
    if (now - room.createdAt > config.roomMaxLifetimeMs) {
      deleteRoom(room.code);
      if (onRoomDeleted) onRoomDeleted(room.code, 'EXPIRED');
      removedRooms += 1;
      continue;
    }

    let changed = false;
    for (const user of Array.from(room.users.values())) {
      const expired =
        !user.connected &&
        user.disconnectedAt !== null &&
        now - user.disconnectedAt > config.userReconnectGraceMs;
      if (expired) {
        room.users.delete(user.id);
        room.swipes.delete(user.id);
        for (const likes of room.likesByMovie.values()) likes.delete(user.id);
        removedUsers += 1;
        changed = true;
      }
    }

    // Host endgültig weg -> Rolle weitergeben, damit der Raum nutzbar bleibt.
    if (room.users.size > 0 && !room.users.has(room.hostId)) {
      promoteNewHost(room);
      changed = true;
    }
    if (changed && room.users.size > 0 && onRoomChanged) onRoomChanged(room);

    if (room.users.size === 0 && !room.cleanupTimer) {
      deleteRoom(room.code);
      if (onRoomDeleted) onRoomDeleted(room.code, 'EMPTY');
      removedRooms += 1;
    }
  }

  return { removedRooms, removedUsers };
}

function promoteNewHost(room) {
  const candidates = Array.from(room.users.values()).sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return a.joinedAt - b.joinedAt;
  });
  const next = candidates[0];
  for (const user of room.users.values()) user.isHost = false;
  if (next) {
    next.isHost = true;
    room.hostId = next.id;
  } else {
    room.hostId = null;
  }
  return next || null;
}

// ---------------------------------------------------------------------------
// Raum erstellen / beitreten / verlassen
// ---------------------------------------------------------------------------

function addUser(room, { isHost }) {
  const user = {
    id: createUserId(),
    token: createUserToken(),
    name: nextUserName(room),
    isHost,
    connected: true,
    disconnectedAt: null,
    joinedAt: Date.now(),
    socketIds: new Set(),
  };
  room.users.set(user.id, user);
  room.swipes.set(user.id, new Map());
  return user;
}

/**
 * Erstellt einen neuen Raum. Der Ersteller wird automatisch Host.
 * @returns {{room: object, user: object}}
 */
function createRoom() {
  if (rooms.size >= config.maxRooms) {
    throw new RoomError('ROOM_LIMIT', 'Aktuell sind zu viele Räume offen. Bitte kurz später erneut versuchen.');
  }

  const code = generateRoomCode();
  const room = {
    code,
    hostId: null,
    phase: 'lobby',
    users: new Map(),
    movies: [],
    movieSource: null,
    swipes: new Map(),
    likesByMovie: new Map(),
    matches: [],
    matchedMovieIds: new Set(),
    filters: defaultFilters(),
    createdAt: Date.now(),
    startedAt: null,
    lastStartAt: 0,
    loadingMovies: false,
    cleanupTimer: null,
  };
  rooms.set(code, room);

  const user = addUser(room, { isHost: true });
  room.hostId = user.id;
  return { room, user };
}

function getRoom(code) {
  return rooms.get(code) || null;
}

/**
 * Tritt einem Raum bei - oder stellt eine bestehende Sitzung wieder her,
 * wenn gültige `userId` + `token` mitgeschickt werden (Reconnect).
 *
 * @returns {{room: object, user: object, rejoined: boolean}}
 */
function joinRoom(rawCode, { userId, token } = {}) {
  const code = normalizeRoomCode(rawCode);
  if (!code) {
    throw new RoomError('INVALID_CODE', 'Dieser Raum-Code ist ungültig. Format: WM8K');
  }

  const room = rooms.get(code);
  if (!room) {
    throw new RoomError('ROOM_NOT_FOUND', 'Dieser Raum existiert nicht oder ist bereits geschlossen.');
  }

  // Reconnect: bestehende Sitzung fortsetzen.
  if (typeof userId === 'string' && typeof token === 'string') {
    const existing = room.users.get(userId);
    if (existing && tokensMatch(existing.token, token)) {
      existing.connected = true;
      existing.disconnectedAt = null;
      cancelCleanup(room);
      return { room, user: existing, rejoined: true };
    }
  }

  if (activeUsers(room).length >= config.maxUsersPerRoom) {
    throw new RoomError('ROOM_FULL', 'Dieser Raum ist bereits voll.');
  }

  const user = addUser(room, { isHost: room.users.size === 0 });
  if (user.isHost) room.hostId = user.id;
  cancelCleanup(room);
  return { room, user, rejoined: false };
}

/** Entfernt einen Benutzer endgültig aus dem Raum. */
function leaveRoom(room, userId) {
  const user = room.users.get(userId);
  if (!user) return { removed: false, newHost: null };

  room.users.delete(userId);
  room.swipes.delete(userId);
  for (const likes of room.likesByMovie.values()) likes.delete(userId);

  let newHost = null;
  if (room.hostId === userId) newHost = promoteNewHost(room);

  if (connectedCount(room) === 0) scheduleCleanup(room);
  return { removed: true, newHost };
}

/** Markiert einen Benutzer als getrennt (Reconnect bleibt möglich). */
function markDisconnected(room, userId) {
  const user = room.users.get(userId);
  if (!user) return;
  user.connected = false;
  user.disconnectedAt = Date.now();
  user.socketIds.clear();
  if (connectedCount(room) === 0) scheduleCleanup(room);
}

// ---------------------------------------------------------------------------
// Filter & Runde
// ---------------------------------------------------------------------------

function assertHost(room, userId) {
  if (room.hostId !== userId) {
    throw new RoomError('NOT_HOST', 'Nur der Host kann diese Aktion ausführen.');
  }
}

function setFilters(room, userId, filters) {
  assertHost(room, userId);
  room.filters = filters;
  return room.filters;
}

/** Setzt Swipes, Likes und Matches zurück (neue Runde). */
function resetRound(room) {
  room.likesByMovie = new Map();
  room.matches = [];
  room.matchedMovieIds = new Set();
  for (const userId of room.users.keys()) {
    room.swipes.set(userId, new Map());
  }
}

/**
 * Startet eine Runde mit der bereits geladenen Filmliste.
 * Die Reihenfolge kommt vom Server - alle Teilnehmer sehen dieselbe.
 */
function startRound(room, userId, movies, source) {
  assertHost(room, userId);
  if (!Array.isArray(movies) || movies.length === 0) {
    throw new RoomError('NO_MOVIES', 'Zu diesen Filtern wurden keine Filme gefunden.');
  }
  room.movies = movies;
  room.movieSource = source;
  room.phase = 'swiping';
  room.startedAt = Date.now();
  room.lastStartAt = Date.now();
  resetRound(room);
  return room;
}

/** Verhindert, dass der Host die (teure) Filmsuche im Sekundentakt auslöst. */
function assertStartAllowed(room, userId) {
  assertHost(room, userId);
  if (Date.now() - room.lastStartAt < 3000) {
    throw new RoomError('TOO_FAST', 'Kurz durchatmen - die Runde wurde gerade erst gestartet.');
  }
  room.lastStartAt = Date.now();
}

// ---------------------------------------------------------------------------
// Swipes & Matches
// ---------------------------------------------------------------------------

/**
 * Verarbeitet einen Swipe.
 *
 * - validiert Phase, Film-ID und Richtung
 * - verhindert doppelte Bewertungen
 * - erzeugt höchstens ein Match pro Film
 *
 * Der Ablauf ist synchron, dadurch kann zwischen "Like zählen" und
 * "Match prüfen" kein zweiter Swipe dazwischenkommen (keine Race Condition).
 *
 * @returns {{direction: string, match: object|null, swipeCount: number, total: number}}
 */
function recordSwipe(room, userId, movieId, direction) {
  if (room.phase !== 'swiping') {
    throw new RoomError('WRONG_PHASE', 'Die Runde läuft gerade nicht.');
  }
  if (direction !== 'left' && direction !== 'right') {
    throw new RoomError('INVALID_SWIPE', 'Ungültiger Swipe.');
  }
  if (!isValidMovieId(movieId)) {
    throw new RoomError('INVALID_MOVIE', 'Dieser Film gehört nicht zu dieser Runde.');
  }

  const user = room.users.get(userId);
  if (!user) {
    throw new RoomError('NOT_IN_ROOM', 'Du bist nicht mehr in diesem Raum.');
  }

  const movie = room.movies.find((entry) => entry.id === movieId);
  if (!movie) {
    throw new RoomError('INVALID_MOVIE', 'Dieser Film gehört nicht zu dieser Runde.');
  }

  let userSwipes = room.swipes.get(userId);
  if (!userSwipes) {
    userSwipes = new Map();
    room.swipes.set(userId, userSwipes);
  }
  if (userSwipes.has(movieId)) {
    throw new RoomError('ALREADY_SWIPED', 'Diesen Film hast du bereits bewertet.');
  }

  userSwipes.set(movieId, direction === 'right' ? 'like' : 'pass');

  let match = null;
  if (direction === 'right') {
    let likes = room.likesByMovie.get(movieId);
    if (!likes) {
      likes = new Set();
      room.likesByMovie.set(movieId, likes);
    }
    likes.add(userId);

    if (likes.size >= config.matchThreshold && !room.matchedMovieIds.has(movieId)) {
      room.matchedMovieIds.add(movieId);
      match = {
        movieId,
        movie,
        likedBy: Array.from(likes, (id) => {
          const liker = room.users.get(id);
          return liker ? liker.name : 'Unbekannt';
        }),
        createdAt: Date.now(),
      };
      room.matches.push(match);
    }
  }

  return {
    direction,
    match,
    swipeCount: userSwipes.size,
    total: room.movies.length,
  };
}

/** Bewertungen eines Benutzers als einfaches Objekt (für Reconnect). */
function swipesOf(room, userId) {
  const userSwipes = room.swipes.get(userId);
  if (!userSwipes) return {};
  return Object.fromEntries(userSwipes);
}

// ---------------------------------------------------------------------------
// Serialisierung für den Client
// ---------------------------------------------------------------------------

/**
 * Oeffentlicher Raumzustand. Enthält bewusst keine Tokens und keine
 * Information darüber, wer welchen Film wie bewertet hat.
 */
function publicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    maxUsers: config.maxUsersPerRoom,
    filters: { ...room.filters },
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    movieCount: room.movies.length,
    movieSource: room.movieSource,
    matchThreshold: config.matchThreshold,
    users: Array.from(room.users.values()).map((user) => ({
      id: user.id,
      name: user.name,
      isHost: user.isHost,
      connected: user.connected,
      swipes: (room.swipes.get(user.id) || new Map()).size,
    })),
    matches: room.matches.map((match) => ({
      movieId: match.movieId,
      movie: match.movie,
      likedBy: match.likedBy,
      createdAt: match.createdAt,
    })),
  };
}

/** Schlanker Fortschritts-Payload (wird bei jedem Swipe gesendet). */
function progressState(room) {
  return {
    code: room.code,
    total: room.movies.length,
    users: Array.from(room.users.values()).map((user) => ({
      id: user.id,
      name: user.name,
      connected: user.connected,
      swipes: (room.swipes.get(user.id) || new Map()).size,
    })),
  };
}

/** Kurzinfo für die REST-Validierung eines Codes (ohne Details). */
function roomSummary(code) {
  const room = rooms.get(code);
  if (!room) return null;
  return {
    code: room.code,
    phase: room.phase,
    users: activeUsers(room).length,
    maxUsers: config.maxUsersPerRoom,
    isFull: activeUsers(room).length >= config.maxUsersPerRoom,
  };
}

module.exports = {
  rooms,
  RoomError,
  CODE_PATTERN,
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  deleteRoom,
  markDisconnected,
  normalizeRoomCode,
  isValidMovieId,
  setFilters,
  startRound,
  assertStartAllowed,
  assertHost,
  recordSwipe,
  swipesOf,
  publicState,
  progressState,
  roomSummary,
  cleanupSweep,
  activeUsers,
  connectedCount,
  promoteNewHost,
};
