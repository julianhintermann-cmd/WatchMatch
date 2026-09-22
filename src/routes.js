'use strict';

/**
 * REST-Endpunkte.
 *
 *  GET /health              Statusinfo für Docker/Monitoring
 *  GET /api/config          Oeffentliche Client-Konfiguration (ohne Secrets!)
 *  GET /api/movies          Filmliste zu optionalen Filtern (Debug/Vorschau)
 *  GET /api/rooms/:code     Existiert dieser Raum?
 *  GET /img/poster/:id.svg  Lokaler Poster-Platzhalter
 *  GET /img/backdrop/:id.svg
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const rooms = require('./rooms');
const movieService = require('./movie-service');
const { filterableGenres } = require('./genres');
const { movieImageSvg } = require('./placeholder-image');

const startedAt = Date.now();

/** Gemeinsame Antwort für überschrittene Limits. */
const limitHandler = (req, res) => {
  res.status(429).json({
    error: { code: 'RATE_LIMITED', message: 'Zu viele Anfragen. Bitte kurz warten.' },
  });
};

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitHandler,
});

/** Die Filmsuche ist der teuerste Endpunkt - daher strenger limitiert. */
const movieLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitHandler,
});

const router = express.Router();

// --- Health ----------------------------------------------------------------

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'watchmatch',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    rooms: rooms.rooms.size,
    movieSource: movieService.isTmdbEnabled() ? 'tmdb' : 'fallback',
  });
});

// --- Client-Konfiguration --------------------------------------------------

router.get('/api/config', apiLimiter, (req, res) => {
  res.json({
    appName: 'WatchMatch',
    // Nur ein Boolean - der Key selbst verlässt den Server nie.
    tmdbEnabled: movieService.isTmdbEnabled(),
    maxUsersPerRoom: config.maxUsersPerRoom,
    moviesPerRound: config.moviesPerRound,
    matchThreshold: config.matchThreshold,
    roomCodePattern: rooms.CODE_PATTERN.source,
    genres: filterableGenres(),
    yearRange: { min: movieService.MIN_YEAR, max: movieService.MAX_YEAR },
  });
});

// --- Filme -----------------------------------------------------------------

router.get('/api/movies', movieLimiter, async (req, res, next) => {
  try {
    const { movies, source, filters } = await movieService.getMovies(
      {
        genre: req.query.genre,
        minRating: req.query.minRating,
        yearFrom: req.query.yearFrom,
        yearTo: req.query.yearTo,
      },
      { count: req.query.count, seed: req.query.seed },
    );
    res.json({ source, filters, count: movies.length, movies });
  } catch (error) {
    if (error instanceof movieService.NoMoviesError) {
      res.status(404).json({ error: { code: error.code, message: error.message } });
      return;
    }
    next(error);
  }
});

// --- Raum-Validierung ------------------------------------------------------

router.get('/api/rooms/:code', apiLimiter, (req, res) => {
  const code = rooms.normalizeRoomCode(req.params.code);
  if (!code) {
    res.status(400).json({
      exists: false,
      error: { code: 'INVALID_CODE', message: 'Dieser Raum-Code ist ungültig. Format: WM8K' },
    });
    return;
  }

  const summary = rooms.roomSummary(code);
  if (!summary) {
    res.status(404).json({
      exists: false,
      error: {
        code: 'ROOM_NOT_FOUND',
        message: 'Dieser Raum existiert nicht oder ist bereits geschlossen.',
      },
    });
    return;
  }

  res.json({ exists: true, room: summary });
});

// --- Platzhalter-Bilder ----------------------------------------------------

function sendPlaceholder(kind) {
  return (req, res) => {
    const svg = movieImageSvg(req.params.id, kind);
    if (!svg) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    // Zusätzliche Absicherung: SVGs dürfen nichts nachladen oder ausführen.
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.send(svg);
  };
}

router.get('/img/poster/:id([0-9]{1,6}).svg', sendPlaceholder('poster'));
router.get('/img/backdrop/:id([0-9]{1,6}).svg', sendPlaceholder('backdrop'));

module.exports = router;
