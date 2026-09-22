'use strict';

/**
 * WatchMatch - Einstiegspunkt.
 *
 * Aufbau (in dieser Reihenfolge):
 *   1. Konfiguration
 *   2. Express-Setup
 *   3. Security-Middleware
 *   4. API-Routen (inkl. TMDB-Service und Fallback-Filmen)
 *   5. Statische Dateien & SPA-Routen
 *   6. Fehlerbehandlung
 *   7. Socket.IO (Raumverwaltung, Swipes, Matches)
 *   8. Serverstart & sauberes Herunterfahren
 */

require('dotenv').config();

const http = require('http');
const path = require('path');

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { Server } = require('socket.io');

const config = require('./src/config');
const apiRoutes = require('./src/routes');
const roomStore = require('./src/rooms');
const movieService = require('./src/movie-service');
const { registerSocketHandlers } = require('./src/socket-handlers');

// ---------------------------------------------------------------------------
// 2. Express-Setup
// ---------------------------------------------------------------------------

const app = express();
const publicDir = path.join(__dirname, 'public');

// Hinter einem Reverse Proxy nötig, damit Rate-Limiting die echte IP sieht.
app.set('trust proxy', config.trustProxy ? 1 : false);
app.disable('x-powered-by');

app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// ---------------------------------------------------------------------------
// 3. Security-Middleware
// ---------------------------------------------------------------------------

/**
 * Content Security Policy.
 * Die App lädt Skripte und Styles ausschließlich von der eigenen Origin
 * (kein CDN), Bilder zusätzlich von TMDB. Damit sind XSS-Vektoren über
 * eingeschleuste externe Ressourcen ausgeschlossen.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'base-uri': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'self'"],
        'form-action': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'https://image.tmdb.org'],
        // Socket.IO nutzt Polling (http) und WebSocket (ws/wss) auf derselben Origin.
        'connect-src': ["'self'", 'ws:', 'wss:'],
        'font-src': ["'self'"],
        'manifest-src': ["'self'"],
      },
    },
    // Die App lädt Poster von image.tmdb.org - cross-origin erlaubt.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  }),
);

/**
 * CORS: Ohne konfigurierte Origin wird die App nur unter der eigenen Domain
 * ausgeliefert (same-origin) - dann ist keine CORS-Freigabe nötig.
 */
const corsOptions = config.corsOrigins.length > 0 ? { origin: config.corsOrigins } : { origin: false };
app.use(cors(corsOptions));

// ---------------------------------------------------------------------------
// 4. API-Routen
// ---------------------------------------------------------------------------

app.use(apiRoutes);

// ---------------------------------------------------------------------------
// 5. Statische Dateien & SPA-Routen
// ---------------------------------------------------------------------------

app.use(
  express.static(publicDir, {
    maxAge: config.nodeEnv === 'production' ? '1h' : 0,
    index: 'index.html',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

/** Direkter Raum-Link: /room/WM8K liefert dieselbe Single-Page-App aus. */
app.get('/room/:code', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// 404 für alles Uebrige.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpunkt nicht gefunden.' } });
    return;
  }
  res.status(404).sendFile(path.join(publicDir, 'index.html'));
});

// ---------------------------------------------------------------------------
// 6. Fehlerbehandlung
// ---------------------------------------------------------------------------

// Der vierte Parameter `next` muss stehen bleiben: Express erkennt einen
// Error-Handler ausschließlich an der Anzahl der Parameter.
app.use((error, req, res, next) => {
  console.error('[http] Unerwarteter Fehler:', error);
  if (res.headersSent) return;
  res.status(500).json({
    error: { code: 'SERVER_ERROR', message: 'Da ist etwas schiefgelaufen. Bitte versuche es erneut.' },
  });
});

// ---------------------------------------------------------------------------
// 7. Socket.IO
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const io = new Server(server, {
  cors: config.corsOrigins.length > 0 ? { origin: config.corsOrigins } : { origin: false },
  // Großzügig genug für wackelige Mobilverbindungen, ohne Sockets ewig zu halten.
  pingTimeout: 25000,
  pingInterval: 20000,
  maxHttpBufferSize: 1e5,
});

registerSocketHandlers(io);

// ---------------------------------------------------------------------------
// 8. Serverstart & Shutdown
// ---------------------------------------------------------------------------

function start() {
  server.listen(config.port, config.host, () => {
    console.log(`WatchMatch läuft auf http://${config.host}:${config.port}`);
    console.log(
      movieService.isTmdbEnabled()
        ? '[movies] TMDB aktiv (Fallback-Daten stehen bereit).'
        : '[movies] Kein TMDB_API_KEY gesetzt - es werden lokale Fallback-Filme verwendet.',
    );
  });
}

function shutdown(signal) {
  console.log(`\n[server] ${signal} empfangen - fahre herunter ...`);
  io.close();
  server.close(() => process.exit(0));
  // Notbremse, falls Verbindungen hängen bleiben.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unbehandelte Promise-Ablehnung:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[server] Unbehandelter Fehler:', error);
});

if (require.main === module) {
  start();
}

module.exports = { app, server, io, start, roomStore };
