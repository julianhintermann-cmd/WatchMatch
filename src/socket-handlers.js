'use strict';

/**
 * Socket.IO-Schicht - die zentrale Echtzeit-Schnittstelle.
 *
 * ---------------------------------------------------------------------------
 * Events: Client -> Server (jeweils mit optionalem Ack-Callback)
 * ---------------------------------------------------------------------------
 *  room:create   {}                                -> ack { ok, session, state }
 *  room:join     { code, userId?, token? }         -> ack { ok, session, state, movies, yourSwipes }
 *  room:leave    {}                                -> ack { ok }
 *  room:filters  { filters }            (nur Host) -> ack { ok, filters }
 *  room:start    {}                     (nur Host) -> ack { ok, count }
 *  movie:swipe   { movieId, direction }            -> ack { ok, swipeCount, total }
 *
 * ---------------------------------------------------------------------------
 * Events: Server -> Client
 * ---------------------------------------------------------------------------
 *  room:state     Vollständiger Raumzustand (Teilnehmer, Filter, Matches, Phase)
 *  room:movies    { movies, startedAt, source } - identische Reihenfolge für alle
 *  room:progress  { total, users: [{ id, name, swipes }] }
 *  match:created  { match, totalMatches }
 *  room:error     { code, message }
 *  room:closed    { code, reason, message }
 *
 * Ein Ack-Callback antwortet immer entweder mit `{ ok: true, ... }` oder mit
 * `{ ok: false, error: { code, message } }` - technische Details bleiben auf
 * dem Server.
 */

const config = require('./config');
const rooms = require('./rooms');
const movieService = require('./movie-service');

const GENERIC_ERROR = {
  code: 'SERVER_ERROR',
  message: 'Da ist etwas schiefgelaufen. Bitte versuche es erneut.',
};

/** Einfaches Token-Bucket pro Verbindung gegen Event-Fluten. */
function allowEvent(socket) {
  const now = Date.now();
  const bucket = socket.data.rateBucket;
  if (now - bucket.windowStart > config.socketRateLimit.windowMs) {
    bucket.windowStart = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  return bucket.count <= config.socketRateLimit.maxEvents;
}

function respond(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

/**
 * Fehler zurückmelden. Gibt es einen Ack-Callback, entscheidet der Client
 * selbst über die Darstellung - sonst wird `room:error` gepusht.
 */
function fail(socket, ack, error) {
  if (typeof ack === 'function') {
    ack({ ok: false, error });
    return;
  }
  socket.emit('room:error', error);
}

function toClientError(error) {
  if (error instanceof rooms.RoomError || error instanceof movieService.NoMoviesError) {
    return { code: error.code, message: error.message };
  }
  console.error('[socket] Unerwarteter Fehler:', error);
  return GENERIC_ERROR;
}

function registerSocketHandlers(io) {
  /** Sendet den Raumzustand an alle Teilnehmer. */
  function broadcastState(room) {
    io.to(room.code).emit('room:state', rooms.publicState(room));
  }

  /** Raum + Benutzer zum aktuellen Socket ermitteln. */
  function currentRoomAndUser(socket) {
    const { roomCode, userId } = socket.data;
    if (!roomCode || !userId) return null;
    const room = rooms.getRoom(roomCode);
    if (!room) return null;
    const user = room.users.get(userId);
    if (!user) return null;
    return { room, user };
  }

  /** Gemeinsame Antwort nach create/join. */
  function sessionPayload(room, user) {
    return {
      ok: true,
      session: { userId: user.id, token: user.token, name: user.name, roomCode: room.code },
      state: rooms.publicState(room),
      movies: room.phase === 'swiping' ? room.movies : [],
      yourSwipes: rooms.swipesOf(room, user.id),
    };
  }

  function attachSocketToRoom(socket, room, user) {
    socket.data.roomCode = room.code;
    socket.data.userId = user.id;
    user.socketIds.add(socket.id);
    socket.join(room.code);
  }

  io.on('connection', (socket) => {
    socket.data.rateBucket = { windowStart: Date.now(), count: 0 };
    socket.data.roomCode = null;
    socket.data.userId = null;

    /** Wrapper: Rate-Limit, einheitliche Fehlerbehandlung, Ack-Garantie. */
    function handler(fn) {
      return async (payload, ack) => {
        if (!allowEvent(socket)) {
          fail(socket, ack, {
            code: 'RATE_LIMITED',
            message: 'Zu viele Aktionen in kurzer Zeit. Bitte kurz warten.',
          });
          return;
        }
        try {
          await fn(payload && typeof payload === 'object' ? payload : {}, ack);
        } catch (error) {
          fail(socket, ack, toClientError(error));
        }
      };
    }

    // --- Raum erstellen ---------------------------------------------------
    socket.on(
      'room:create',
      handler(async (payload, ack) => {
        const { room, user } = rooms.createRoom();
        if (payload.filters) {
          room.filters = movieService.sanitizeFilters(payload.filters);
        }
        attachSocketToRoom(socket, room, user);
        respond(ack, sessionPayload(room, user));
        broadcastState(room);
      }),
    );

    // --- Raum beitreten / Reconnect --------------------------------------
    socket.on(
      'room:join',
      handler(async (payload, ack) => {
        const { room, user } = rooms.joinRoom(payload.code, {
          userId: typeof payload.userId === 'string' ? payload.userId : undefined,
          token: typeof payload.token === 'string' ? payload.token : undefined,
        });

        // Falls dieser Socket vorher in einem anderen Raum war: sauber lösen.
        if (socket.data.roomCode && socket.data.roomCode !== room.code) {
          socket.leave(socket.data.roomCode);
        }

        attachSocketToRoom(socket, room, user);
        respond(ack, sessionPayload(room, user));
        broadcastState(room);
      }),
    );

    // --- Raum verlassen ---------------------------------------------------
    socket.on(
      'room:leave',
      handler(async (payload, ack) => {
        const context = currentRoomAndUser(socket);
        respond(ack, { ok: true });
        if (!context) return;

        const { room, user } = context;
        user.socketIds.delete(socket.id);
        socket.leave(room.code);
        socket.data.roomCode = null;
        socket.data.userId = null;

        rooms.leaveRoom(room, user.id);
        if (rooms.getRoom(room.code)) broadcastState(room);
      }),
    );

    // --- Filter aktualisieren (nur Host) ----------------------------------
    socket.on(
      'room:filters',
      handler(async (payload, ack) => {
        const context = currentRoomAndUser(socket);
        if (!context) throw new rooms.RoomError('NOT_IN_ROOM', 'Du bist nicht mehr in diesem Raum.');

        const { room, user } = context;
        const filters = rooms.setFilters(room, user.id, movieService.sanitizeFilters(payload.filters));
        respond(ack, { ok: true, filters });
        broadcastState(room);
      }),
    );

    // --- Runde starten (nur Host) -----------------------------------------
    socket.on(
      'room:start',
      handler(async (payload, ack) => {
        const context = currentRoomAndUser(socket);
        if (!context) throw new rooms.RoomError('NOT_IN_ROOM', 'Du bist nicht mehr in diesem Raum.');

        const { room, user } = context;
        rooms.assertHost(room, user.id);
        if (room.loadingMovies) {
          throw new rooms.RoomError('TOO_FAST', 'Die Filme werden bereits geladen.');
        }
        rooms.assertStartAllowed(room, user.id);

        room.loadingMovies = true;
        try {
          const { movies, source } = await movieService.getMovies(room.filters, {
            count: config.moviesPerRound,
            // Seed aus Raumcode + Startzeit: alle sehen dieselbe Reihenfolge,
            // eine neue Runde mischt aber neu.
            seed: `${room.code}:${Date.now()}`,
          });

          // Der Raum könnte während des Ladens geschlossen worden sein.
          // Wichtig: als Fehler melden, damit der Client nicht ewig wartet.
          if (!rooms.getRoom(room.code)) {
            throw new rooms.RoomError(
              'ROOM_NOT_FOUND',
              'Dieser Raum existiert nicht oder ist bereits geschlossen.',
            );
          }

          rooms.startRound(room, user.id, movies, source);
          const tmdb = movieService.tmdbStatus();
          respond(ack, { ok: true, count: movies.length, source, tmdb });
          io.to(room.code).emit('room:movies', {
            movies: room.movies,
            startedAt: room.startedAt,
            source: room.movieSource,
            // Damit der Client benennen kann, warum keine echten Cover kommen.
            tmdb,
          });
          broadcastState(room);
        } finally {
          room.loadingMovies = false;
        }
      }),
    );

    // --- Swipe ------------------------------------------------------------
    socket.on(
      'movie:swipe',
      handler(async (payload, ack) => {
        const context = currentRoomAndUser(socket);
        if (!context) throw new rooms.RoomError('NOT_IN_ROOM', 'Du bist nicht mehr in diesem Raum.');

        const { room, user } = context;
        const result = rooms.recordSwipe(room, user.id, payload.movieId, payload.direction);

        respond(ack, { ok: true, swipeCount: result.swipeCount, total: result.total });
        io.to(room.code).emit('room:progress', rooms.progressState(room));

        if (result.match) {
          io.to(room.code).emit('match:created', {
            match: result.match,
            totalMatches: room.matches.length,
          });
        }
      }),
    );

    // --- Verbindungsabbruch ----------------------------------------------
    socket.on('disconnect', () => {
      const context = currentRoomAndUser(socket);
      if (!context) return;

      const { room, user } = context;
      user.socketIds.delete(socket.id);
      // Andere Tabs desselben Benutzers halten die Sitzung offen.
      if (user.socketIds.size === 0) {
        rooms.markDisconnected(room, user.id);
      }
      if (rooms.getRoom(room.code)) broadcastState(room);
    });
  });

  // --- Periodisches Aufräumen -------------------------------------------
  const cleanupTimer = setInterval(() => {
    rooms.cleanupSweep({
      onRoomDeleted: (code, reason) => {
        io.to(code).emit('room:closed', {
          code: reason,
          reason,
          message: 'Dieser Raum wurde geschlossen.',
        });
        io.in(code).socketsLeave(code);
      },
      // Z. B. nach einem Host-Wechsel: verbleibende Teilnehmer aktualisieren.
      onRoomChanged: (room) => broadcastState(room),
    });
  }, config.roomCleanupIntervalMs);
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

  return () => clearInterval(cleanupTimer);
}

module.exports = { registerSocketHandlers };
