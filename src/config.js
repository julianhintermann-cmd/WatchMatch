'use strict';

/**
 * Zentrale Konfiguration.
 *
 * Alle Werte können über Environment-Variablen überschrieben werden.
 * Der TMDB-Key wird ausschließlich hier (serverseitig) gelesen und niemals
 * an den Client ausgeliefert - siehe `GET /api/config`.
 */

function intFromEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function boolFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

const config = {
  // --- Server ---------------------------------------------------------
  port: intFromEnv('PORT', 3000, { min: 1, max: 65535 }),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',

  /**
   * CORS: Standardmäßig wird die App unter der eigenen Origin ausgeliefert,
   * es wird also keine fremde Origin benötigt. Wer die App hinter einer
   * anderen Domain betreibt, setzt `CORS_ORIGIN` (kommagetrennt).
   */
  corsOrigins: (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),

  /** Hinter einem Reverse Proxy (nginx, Traefik, ...) auf 1 setzen. */
  trustProxy: boolFromEnv('TRUST_PROXY', false),

  // --- TMDB -----------------------------------------------------------
  tmdbApiKey: (process.env.TMDB_API_KEY || '').trim(),
  tmdbBaseUrl: 'https://api.themoviedb.org/3',
  tmdbImageBaseUrl: 'https://image.tmdb.org/t/p',
  tmdbLanguage: process.env.TMDB_LANGUAGE || 'de-DE',
  tmdbTimeoutMs: intFromEnv('TMDB_TIMEOUT_MS', 6000, { min: 500, max: 30000 }),
  tmdbCacheTtlMs: intFromEnv('TMDB_CACHE_TTL_MS', 10 * 60 * 1000, { min: 0 }),

  // --- Räume ---------------------------------------------------------
  maxUsersPerRoom: intFromEnv('MAX_USERS_PER_ROOM', 8, { min: 2, max: 32 }),
  /** Maximale Anzahl gleichzeitig offener Räume (Schutz vor Speicher-Abuse). */
  maxRooms: intFromEnv('MAX_ROOMS', 2000, { min: 1 }),
  /** Zeit bis ein leerer Raum gelöscht wird. */
  roomGracePeriodMs: intFromEnv('ROOM_GRACE_PERIOD_MS', 5 * 60 * 1000, { min: 1000 }),
  /** Zeit, die ein getrennter Benutzer seinen Platz im Raum behält. */
  userReconnectGraceMs: intFromEnv('USER_RECONNECT_GRACE_MS', 2 * 60 * 1000, { min: 1000 }),
  /** Absolute Lebensdauer eines Raums (Aufräumen von Karteileichen). */
  roomMaxLifetimeMs: intFromEnv('ROOM_MAX_LIFETIME_MS', 12 * 60 * 60 * 1000, { min: 60 * 1000 }),
  roomCleanupIntervalMs: 60 * 1000,

  // --- Filme ----------------------------------------------------------
  /** Anzahl Filme pro Runde. */
  moviesPerRound: intFromEnv('MOVIES_PER_ROUND', 40, { min: 5, max: 100 }),
  /** Anzahl Likes, die für ein Match nötig sind (Version 1: 2). */
  matchThreshold: intFromEnv('MATCH_THRESHOLD', 2, { min: 2 }),

  // --- Limits / Validierung -------------------------------------------
  maxDisplayNameLength: 24,
  /** Socket-Rate-Limit: max. Events pro Fenster und Verbindung. */
  socketRateLimit: {
    windowMs: 10 * 1000,
    maxEvents: 120,
  },
};

module.exports = config;
