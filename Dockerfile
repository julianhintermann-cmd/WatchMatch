# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build-Stage: nur Produktionsabhängigkeiten installieren
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Erst die Manifeste kopieren – so bleibt der npm-Layer im Cache, solange sich
# die Abhängigkeiten nicht ändern.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# Runtime-Stage
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime

# wget wird für den Healthcheck benötigt (in alpine via busybox vorhanden).
ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server.js ./
COPY src ./src
COPY public ./public

# Das offizielle Node-Image bringt den unprivilegierten Benutzer `node` mit.
RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:${PORT}/health || exit 1

CMD ["npm", "start"]
