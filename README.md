# WatchMatch

**Find a movie. Match together. Watch tonight.**

WatchMatch ist eine gemeinsame Film-Swipe-App: Eine Person erstellt einen Raum,
teilt den Code oder den Link, und alle swipen unabhängig voneinander durch
dieselbe Filmliste. Sobald zwei Personen denselben Film mögen, erscheint das
Match sofort auf allen Geräten.

```
Raum erstellen → Raum teilen → Beitreten → Gemeinsame Filmliste
      → Swipen → Synchronisation → Match → Match auf allen Geräten
```

## Inhalt

- [Funktionen](#funktionen)
- [Voraussetzungen](#voraussetzungen)
- [Schnellstart](#schnellstart)
- [Entwicklung](#entwicklung)
- [Docker](#docker)
- [Docker Compose](#docker-compose)
- [GitHub Container Registry](#github-container-registry)
- [TMDB-Anbindung](#tmdb-anbindung)
- [Gestaltung](#gestaltung)
- [Konfiguration](#konfiguration)
- [REST-API](#rest-api)
- [Socket.IO-Events](#socketio-events)
- [Projektstruktur](#projektstruktur)
- [Tests](#tests)
- [Sicherheit](#sicherheit)
- [Fehlerbehebung](#fehlerbehebung)

## Funktionen

- **Räume mit kurzem Code** im Format `WM8K`, teilbar per Link, Copy-Button
  oder – auf Mobilgeräten – über die native Teilen-Funktion.
- **2 bis 8 Personen pro Raum**, Host-Rolle sichtbar, Teilnehmerzahl live.
- **Filter** (Genre, Mindestbewertung, Erscheinungsjahr) – gesetzt vom Host,
  für alle sichtbar.
- **Identische Filmreihenfolge** für alle Teilnehmer: Die Auswahl und die
  Reihenfolge kommen ausschließlich vom Server.
- **Echte Swipe-Gesten** auf Touchgeräten (inklusive LIKE/PASS-Stempel und
  Fly-out-Animation), Buttons und Tastatur (`←`/`→` bzw. `A`/`D`) am Desktop.
- **Matches in Echtzeit** mit Overlay, Überblendzeichen und gemeinsamer
  Match-Historie.
- **Reconnect-sicher**: Nach Verbindungsabbruch oder Reload werden Sitzung,
  Fortschritt und Matches wiederhergestellt.
- **Funktioniert ohne TMDB-Key** – dann kommen 60 mitgelieferte Filme mit
  lokal erzeugten Poster-Grafiken zum Einsatz. Kein Internetzugang nötig.

## Voraussetzungen

| Werkzeug | Version | Wofür |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) | 20 oder neuer | lokaler Betrieb und Tests |
| [Docker](https://docs.docker.com/get-docker/) | aktuell | Container-Betrieb (optional) |
| [Git](https://git-scm.com/) | aktuell | Repository klonen |

Ein TMDB-API-Key ist **nicht** erforderlich.

## Schnellstart

```bash
git clone https://github.com/<euer-benutzername>/watchmatch.git
cd watchmatch

cp .env.example .env     # optional: TMDB_API_KEY eintragen
npm install
npm start
```

Danach im Browser öffnen:

```
http://localhost:3000
```

Zum Ausprobieren genügt ein zweites Browserfenster (am besten ein privates
Fenster oder ein zweites Profil, damit eine eigene Sitzung entsteht). Raum
erstellen, Link kopieren, im zweiten Fenster öffnen – fertig.

## Entwicklung

```bash
npm run dev     # Neustart bei Dateiänderungen (node --watch)
npm test        # Unit- und End-to-End-Tests
npm run check   # Syntaxprüfung für server.js und public/app.js
```

## Docker

```bash
docker build -t watchmatch .
docker run -p 3000:3000 watchmatch
```

Mit TMDB-Key:

```bash
docker run -p 3000:3000 -e TMDB_API_KEY=euer_key watchmatch
```

Das Image basiert auf `node:20-alpine`, installiert nur
Produktionsabhängigkeiten, läuft als unprivilegierter Benutzer `node` und
bringt einen Healthcheck auf `/health` mit:

```bash
docker ps   # Spalte STATUS zeigt "healthy"
```

## Docker Compose

```bash
cp .env.example .env
docker compose up -d
```

Die App ist danach unter `http://localhost:3000` erreichbar.

```bash
docker compose logs -f      # Logs ansehen
docker compose down         # Stoppen
```

> **Einziger Wert, der bewusst angepasst werden muss:**
> In `docker-compose.yml` steht `ghcr.io/YOUR_GITHUB_USERNAME/watchmatch:latest`.
> Ersetzt `YOUR_GITHUB_USERNAME` durch euren GitHub-Benutzer- oder
> Organisationsnamen (**kleingeschrieben** – die GitHub Container Registry
> akzeptiert nur Kleinbuchstaben).

Solange der `build:`-Block in der Datei steht, baut Compose das Image beim
ersten Start selbst – ihr könnt also auch ohne veröffentlichtes Image starten.
Wer stattdessen das fertige Image aus der Registry ziehen möchte, entfernt den
`build:`-Block und nutzt `docker compose pull && docker compose up -d`.

## GitHub Container Registry

Der Workflow `.github/workflows/docker-build.yml` läuft

- bei jedem Push auf `main`,
- bei Tags der Form `v1.2.3`,
- bei Pull Requests (nur bauen, nicht veröffentlichen),
- und manuell über **Actions → Docker Build & Push → Run workflow**.

Er führt zuerst die Tests aus, baut anschließend mit Docker Buildx und pusht
nach GHCR. Dabei wird ausschließlich das automatisch bereitgestellte
`GITHUB_TOKEN` verwendet – es ist **kein** persönlicher Access Token nötig.

Veröffentlichte Tags:

| Tag | Wann |
| --- | --- |
| `latest` | Push auf den Default-Branch |
| `sha-<commit>` | bei jedem Build |
| `<branchname>` | Push auf einen Branch |
| `1.2.3` | Git-Tag `v1.2.3` |

Image ziehen:

```bash
docker pull ghcr.io/<euer-benutzername>/watchmatch:latest
```

Damit der Push gelingt, muss im Repository unter
**Settings → Actions → General → Workflow permissions** die Option
*Read and write permissions* aktiv sein. Neu erstellte Pakete sind zunächst
privat; öffentlich macht ihr sie unter **Packages → watchmatch → Package
settings → Change visibility**.

## TMDB-Anbindung

WatchMatch kann Filmdaten von [The Movie Database](https://www.themoviedb.org/)
beziehen. Der Key wird in der `.env` hinterlegt:

```env
TMDB_API_KEY=euer_key_hier
```

- Der Key wird **ausschließlich serverseitig** verwendet. `GET /api/config`
  liefert lediglich `"tmdbEnabled": true|false` – der Key selbst verlässt den
  Server nie.
- Der Server normalisiert die TMDB-Antwort und schickt nur die Felder an den
  Browser, die die Filmkarte tatsächlich braucht.
- Ergebnisse werden 10 Minuten zwischengespeichert, Anfragen laufen mit
  Timeout.

**Ohne Key oder wenn TMDB nicht erreichbar ist**, greift automatisch der
lokale Datensatz aus `src/fallback-movies.js` (60 Filme von 1942 bis 2023).
Die Poster dafür erzeugt der Server selbst als SVG – es werden keine externen
Bilder geladen. Die App ist dadurch auch komplett offline voll funktionsfähig.

## Gestaltung

Die Oberfläche folgt einer durchgehenden Idee statt einer Sammlung von
Effekten: **die Apparatur des Kinos**. Das ist keine Dekoration, sondern
ergibt sich aus dem Datenmodell – alle Teilnehmer laufen durch dieselbe,
servergenerierte Sequenz von Filmen. Das *ist* eine Filmrolle im Projektor.

| Element | Herkunft |
| --- | --- |
| Fortschritt als **Rolle** mit einem Kader je Film | zeigt zusätzlich, was behalten wurde und wo die Matches liegen – das kann ein Balken nicht |
| Filmkarte als **16-mm-Kader**: einseitig perforiert, mit Randcode | 16-mm-Material ist einseitig perforiert; der Randcode nennt Position in der Rolle und Jahr |
| **Überblendzeichen** beim Match | der Kreis, der im Kino oben rechts den Rollenwechsel ankündigt – ersetzt Konfetti |
| Perforation als Trennlinie | statt beliebiger Haarlinien |
| Markierung beim Ziehen: Kreis behalten, Kreuz weiter | wie Cutter einen Kader von Hand bewerten |

**Farben** stammen aus Filmmaterial statt aus einem Paletten-Generator: warmes
Fast-Schwarz (abgedunkelter Saal), Academy-Leader-Creme als Schriftfarbe,
Projektorlampen-Bernstein als Marke, Schneidetisch-Grün für „behalten",
Überblendzeichen-Rot für „weiter". Alle Textfarben erfüllen mindestens
WCAG AA auf allen Flächen.

**Schriften** liegen unter `public/fonts/` im Repository – Big Shoulders
Display (Anzeige), Archivo (Fließtext), Azeret Mono (Daten). Kein Google-Fonts-
CDN: Die App sieht ohne Internetzugang identisch aus, und die CSP erlaubt nur
`font-src 'self'`. Alle drei stehen unter der SIL Open Font License 1.1, siehe
`public/fonts/LICENSE.md`.

Geprüft wurde außerdem: alle Trefferflächen ≥ 44 px, sichtbarer Fokus auf jedem
Bedienelement, keine Emojis als Icons (durchgehend SVG mit einer Strichstärke),
kein horizontales Scrollen bei 375 px, im Querformat und bei 22 px Grundschrift,
und `prefers-reduced-motion` schaltet Bewegung ab.

## Konfiguration

Alle Werte sind optional, `PORT` und `TMDB_API_KEY` stehen in `.env.example`.

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `PORT` | `3000` | Port des Servers |
| `HOST` | `0.0.0.0` | Interface, auf dem gelauscht wird |
| `TMDB_API_KEY` | – | TMDB-Key; leer ⇒ Fallback-Filme |
| `TMDB_LANGUAGE` | `de-DE` | Sprache der TMDB-Antworten |
| `TMDB_TIMEOUT_MS` | `6000` | Timeout je TMDB-Anfrage |
| `TMDB_CACHE_TTL_MS` | `600000` | Cache-Dauer für TMDB-Ergebnisse |
| `MOVIES_PER_ROUND` | `40` | Filme pro Runde (5–100) |
| `MAX_USERS_PER_ROOM` | `8` | Teilnehmer pro Raum (2–32) |
| `MATCH_THRESHOLD` | `2` | Likes, die ein Match auslösen |
| `ROOM_GRACE_PERIOD_MS` | `300000` | Wartezeit, bis ein leerer Raum gelöscht wird |
| `USER_RECONNECT_GRACE_MS` | `120000` | Wie lange ein getrennter Benutzer seinen Platz behält |
| `ROOM_MAX_LIFETIME_MS` | `43200000` | Maximale Lebensdauer eines Raums |
| `MAX_ROOMS` | `2000` | Obergrenze gleichzeitig offener Räume |
| `CORS_ORIGIN` | – | Erlaubte fremde Origins, kommagetrennt |
| `TRUST_PROXY` | `0` | Auf `1` setzen hinter einem Reverse Proxy |

## REST-API

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `GET` | `/` | Single-Page-App |
| `GET` | `/room/:code` | Direkter Raum-Link (liefert dieselbe App aus) |
| `GET` | `/health` | `{ "status": "ok", "service": "watchmatch", ... }` |
| `GET` | `/api/config` | Öffentliche Client-Konfiguration (ohne Secrets) |
| `GET` | `/api/movies` | Filmliste zu optionalen Filtern |
| `GET` | `/api/rooms/:code` | Prüft, ob ein Raum existiert |
| `GET` | `/img/poster/:id.svg` | Lokal erzeugtes Platzhalter-Poster |
| `GET` | `/img/backdrop/:id.svg` | Lokal erzeugtes Platzhalter-Backdrop |

Beispiel:

```bash
curl "http://localhost:3000/api/movies?genre=878&minRating=7.5&count=5"
```

Fehler kommen einheitlich als
`{ "error": { "code": "...", "message": "..." } }` zurück. Alle `/api/*`-Routen
sind ratenbegrenzt (`/api/movies` strenger, da es der teuerste Endpunkt ist).

## Socket.IO-Events

Die Echtzeit-Kommunikation läuft vollständig über Socket.IO. Jedes
Client-Event akzeptiert einen Ack-Callback, der entweder `{ ok: true, ... }`
oder `{ ok: false, error: { code, message } }` liefert.

**Client → Server**

| Event | Nutzlast | Wirkung |
| --- | --- | --- |
| `room:create` | `{}` | Legt einen Raum an, Absender wird Host |
| `room:join` | `{ code, userId?, token? }` | Beitritt oder Wiederherstellung einer Sitzung |
| `room:leave` | `{}` | Verlässt den Raum |
| `room:filters` | `{ filters }` | Filter setzen (nur Host) |
| `room:start` | `{}` | Filme laden und Runde starten (nur Host) |
| `movie:swipe` | `{ movieId, direction }` | `"right"` = Like, `"left"` = Pass |

**Server → Client**

| Event | Nutzlast | Wann |
| --- | --- | --- |
| `room:state` | Vollständiger Raumzustand | Beitritt, Austritt, Filter, Phasenwechsel |
| `room:movies` | `{ movies, startedAt, source }` | Rundenstart – identische Reihenfolge für alle |
| `room:progress` | `{ total, users[] }` | Nach jedem Swipe |
| `match:created` | `{ match, totalMatches }` | Sobald ein Match entsteht |
| `room:error` | `{ code, message }` | Serverseitiger Fehler ohne Ack |
| `room:closed` | `{ reason, message }` | Raum wurde geschlossen |

Die vollständige Dokumentation steht als Kommentarblock in
`src/socket-handlers.js`.

## Projektstruktur

```
watchmatch/
├── server.js                    Einstiegspunkt: Express, Security, Socket.IO
├── src/
│   ├── config.js                Konfiguration aus Environment-Variablen
│   ├── routes.js                REST-Endpunkte inkl. Rate-Limiting
│   ├── rooms.js                 Raumverwaltung, Swipes, Match-Logik
│   ├── socket-handlers.js       Socket.IO-Events (dokumentiert)
│   ├── movie-service.js         TMDB-Abruf, Normalisierung, Fallback
│   ├── fallback-movies.js       60 lokale Filme
│   ├── genres.js                TMDB-Genre-IDs und Namen
│   └── placeholder-image.js     SVG-Poster für Fallback-Filme
├── public/
│   ├── index.html               Single-Page-App
│   ├── app.js                   Client (Socket, Swipes, Matches, UI)
│   ├── styles.css               Gestaltung, Mobile First, ohne CDN
│   ├── favicon.svg
│   └── fonts/                   selbst gehostete Schriften (+ LICENSE.md)
├── test/
│   ├── rooms.test.js            Raum- und Match-Logik
│   ├── api.test.js              REST-Endpunkte und Security-Header
│   ├── tmdb.test.js             TMDB-Anbindung (mit ersetztem fetch)
│   └── integration.test.js      End-to-End über echte Socket-Verbindungen
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── .github/workflows/docker-build.yml
```

## Tests

```bash
npm test
```

45 Tests, ohne zusätzliches Test-Framework (Node-eigener Test-Runner).
Abgedeckt sind unter anderem:

- Raum erstellen, Codeformat und Code-Normalisierung
- Beitritt, voller Raum, ungültiger und unbekannter Code, Beitritt mitten in der Runde
- Host-Rechte (Filter und Start) sowie Host-Wechsel beim Verlassen und nach Timeout
- identische Filmreihenfolge bei allen Teilnehmern
- Match ab zwei Likes, genau ein Match pro Film – auch bei acht gleichzeitigen Likes
- Abwehr doppelter, ungültiger und manipulierter Swipes
- Reconnect inklusive Wiederherstellung von Swipes und Matches
- TMDB-Abruf, Filterübersetzung, Normalisierung und Fallback bei Netz- oder HTTP-Fehlern
- Security-Header, Fehlerformate und dass kein API-Key ausgeliefert wird

Die End-to-End-Tests starten einen echten Server und sprechen ihn über echte
Socket.IO-Verbindungen an – es wird also der tatsächliche Ablauf geprüft.

## Sicherheit

- **Helmet** mit strikter Content Security Policy: Skripte und Styles nur von
  der eigenen Origin (kein CDN), kein `unsafe-eval`, `object-src 'none'`.
- **Keine Secrets im Client** – der TMDB-Key bleibt serverseitig.
- **Kein HTML aus Daten**: Der Client schreibt sämtliche Inhalte über
  `textContent`; Bild-URLs werden gegen eine Whitelist geprüft. Damit sind
  XSS-Einfallstore geschlossen.
- **Serverseitige Validierung** von Raumcodes, Filmkennungen, Swipe-Richtungen
  und Filtern. Der Client kann weder fremde Swipes setzen noch Matches
  erzwingen.
- **Sitzungs-Token** pro Benutzer, beim Reconnect in konstanter Zeit verglichen.
- **Rate-Limiting** für REST-Endpunkte und pro Socket-Verbindung.
- **Obergrenzen** für Teilnehmer pro Raum, Räume insgesamt, Raumlebensdauer und
  Nachrichtengröße.
- **Container** läuft als unprivilegierter Benutzer mit nur
  Produktionsabhängigkeiten.

## Fehlerbehebung

| Symptom | Ursache und Lösung |
| --- | --- |
| „Dieser Raum existiert nicht oder ist bereits geschlossen." | Räume liegen im RAM und werden nach fünf Minuten ohne Teilnehmer gelöscht – auch ein Serverneustart leert sie. Einfach einen neuen Raum erstellen. |
| „Dieser Raum ist bereits voll." | Standardmäßig sind acht Personen erlaubt; per `MAX_USERS_PER_ROOM` anpassbar. |
| Immer dieselben 60 Filme | Es ist kein `TMDB_API_KEY` gesetzt oder TMDB ist nicht erreichbar – das Log zeigt beim Start, welche Quelle verwendet wird. |
| „Zu diesen Filtern wurden keine Filme gefunden." | Die Filter sind zu streng. Mindestbewertung senken oder Jahresbereich erweitern. |
| Rotes Status-Licht im Kopfbereich | Die Socket-Verbindung ist weg. Der Client verbindet sich selbst neu und synchronisiert den Raumzustand. |
| Kopieren funktioniert nicht | Browser erlauben die Zwischenablage nur in sicheren Kontexten (`https` oder `localhost`). Die App nutzt dann automatisch ein Fallback; alternativ den angezeigten Link manuell kopieren. |
| Port 3000 belegt | `PORT=3001 npm start` bzw. das Port-Mapping in `docker-compose.yml` ändern. |

## Lizenz

MIT

Filmdaten und Poster stammen – sofern ein Key hinterlegt ist – von
[TMDB](https://www.themoviedb.org/). Dieses Projekt wird von TMDB weder
unterstützt noch zertifiziert.
