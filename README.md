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
- [Docker Hub und GitHub Actions](#docker-hub-und-github-actions)
- [TMDB-Anbindung](#tmdb-anbindung)
- [Zum Homescreen hinzufügen](#zum-homescreen-hinzufügen)
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

So gestartet baut Compose das Image beim ersten Start selbst – es wird also
kein veröffentlichtes Image gebraucht.

Wer stattdessen das fertige Image von Docker Hub ziehen möchte, trägt in der
`.env` den Benutzernamen ein:

```env
DOCKERHUB_USERNAME=euer-dockerhub-name
```

```bash
docker compose pull
docker compose up -d
```

In `docker-compose.yml` selbst muss dafür nichts geändert werden – der
Image-Name wird aus dieser Variablen zusammengesetzt. Ohne gesetzten Wert
heißt das lokal gebaute Image `watchmatch-local/watchmatch:latest`.

## Docker Hub und GitHub Actions

Der Workflow `.github/workflows/docker-build.yml` führt zuerst die Tests aus,
baut anschließend mit Docker Buildx und veröffentlicht auf Docker Hub.

**Zugangsdaten** kommen aus den Repository-Secrets und stehen nirgends im
Quelltext. Anzulegen unter *Settings → Secrets and variables → Actions*:

| Name | Inhalt |
| --- | --- |
| `DOCKERHUB_USERNAME` | Docker-Hub-Benutzername |
| `DOCKERHUB_TOKEN` | Access Token mit Berechtigung **Read & Write** ([Docker Hub → Account settings → Personal access tokens](https://app.docker.com/settings/personal-access-tokens)) |

Der Benutzername darf statt als Secret auch als *Variable* hinterlegt sein.
Der Workflow akzeptiert beides. Als Variable erscheint er unmaskiert im Log,
was die Fehlersuche erleichtert – öffentlich ist er ohnehin, er steht im
Image-Namen. Der Token gehört immer in die Secrets.

**Wann gebaut und wann veröffentlicht wird**

| Auslöser | Verhalten |
| --- | --- |
| Push auf den Default-Branch | Tests, Build, Push |
| Push eines Tags `v1.2.3` | Tests, Build, Push |
| Push auf jeden anderen Branch | Tests und Build, **kein** Push |
| Manueller Start (*Actions → Run workflow*) | Tests, Build, Push |

Dass auch Nebenbranches gebaut werden, ist Absicht: So fällt ein kaputtes
Dockerfile auf, bevor es auf dem Hauptbranch landet – ohne die Registry zu
berühren.

**Veröffentlichte Tags**

| Tag | Wann |
| --- | --- |
| `latest` | Push auf den Default-Branch |
| `sha-<commit>` | bei jeder Veröffentlichung |
| `<branchname>` | Push auf einen Branch (Schrägstriche werden zu `-`) |
| `1.2.3` und `1.2` | Git-Tag `v1.2.3` |

Image ziehen:

```bash
docker pull euer-dockerhub-name/watchmatch:latest
```

**Falls der Lauf scheitert**

| Meldung | Ursache |
| --- | --- |
| `Zum Veröffentlichen fehlen Zugangsdaten` | Secret fehlt oder heißt anders – der Workflow erwartet exakt `DOCKERHUB_USERNAME` und `DOCKERHUB_TOKEN` |
| `denied: requested access to the resource is denied` | Token hat nur Leserechte, oder der Benutzername passt nicht zum Token |
| `repository does not exist` | Das Repository auf Docker Hub vorher anlegen – nicht jedes Konto erlaubt automatisches Anlegen beim ersten Push |

**Nur für amd64.** Der Build erzeugt bewusst ein einzelnes Image für
`linux/amd64`. Wer das Image auf einem Raspberry Pi oder Apple Silicon nativ
betreiben will, ergänzt im Schritt *Image bauen und pushen*:

```yaml
          platforms: linux/amd64,linux/arm64
```

und davor `- uses: docker/setup-qemu-action@v3`. Das verdoppelt ungefähr die
Bauzeit.

## TMDB-Anbindung

WatchMatch kann Filmdaten von [The Movie Database](https://www.themoviedb.org/)
beziehen. Der Key wird in der `.env` hinterlegt:

```env
TMDB_API_KEY=euer_key_hier
```

TMDB gibt auf der API-Seite **zwei** Zugangsdaten aus, die sich technisch
unterscheiden. WatchMatch erkennt automatisch, welches davon eingetragen ist,
und verwendet es richtig:

| Zugangsdatum | Aussehen | Verwendung |
| --- | --- | --- |
| API Key (v3 auth) | 32 Zeichen hexadezimal | als `api_key` in der URL |
| API Read Access Token (v4) | langer Text, beginnt mit `eyJ` | als `Authorization: Bearer` im Header |

Wird ein Schlüssel abgelehnt, fällt die App nicht stillschweigend zurück:
`GET /health` und `GET /api/config` melden den Zustand unter `tmdb`, und die
Lobby zeigt den Grund an.

- Der Key wird **ausschließlich serverseitig** verwendet. `GET /api/config`
  liefert lediglich `"tmdbEnabled": true|false` – der Key selbst verlässt den
  Server nie.
- Der Server normalisiert die TMDB-Antwort und schickt nur die Felder an den
  Browser, die die Filmkarte tatsächlich braucht.
- Ergebnisse werden 10 Minuten zwischengespeichert, Anfragen laufen mit
  Timeout.

**Ohne Key oder wenn TMDB nicht erreichbar ist**, greift automatisch der
lokale Datensatz aus `src/fallback-movies.js` (60 Filme von 1942 bis 2023).
Die App ist dadurch auch komplett offline voll funktionsfähig.

> **Echte Filmcover gibt es nur mit Key.** Der Fallback bringt Titel, Jahr,
> Bewertung, Genres und Beschreibung mit, aber keine Poster – echte Cover
> dürfen nicht mitgeliefert werden. Der Server erzeugt stattdessen farbige
> Platzhalter mit dem Filmfenster-Zeichen der App. Die Lobby weist darauf hin,
> solange kein Key gesetzt ist.

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

**Bewegung** folgt Apple-Physik in der Bildsprache des Projektors. Die
Übergangskurven sind numerisch berechnete gedämpfte Federn, als CSS-`linear()`
hinterlegt (Fallback auf Bézier für Safari < 17.4) – Elemente kommen zur Ruhe,
statt abrupt zu stoppen:

| Kurve | Dämpfung | Verwendung |
| --- | --- | --- |
| `--spring-snap` | 0.86 | Zustandswechsel, Karten, Ansichten |
| `--spring-pop` | 0.68 | Auftritte mit spürbarem Nachfedern |
| `--spring-sheet` | 0.82 | grosse Flächen wie das Sheet |

Der Match ist eine zusammenhängende Sequenz statt verstreuter Effekte: Die
Lampe zündet, der Kader fädelt von oben ins Bildfenster ein, Licht wandert
einmal über das Poster, das Überblendzeichen brennt ein, der Text kommt
gestaffelt nach. Auf dem Handy erscheint die Matches-Liste als Sheet von unten,
mit Griff und zum Wegwischen; ab Tablet-Breite bleibt es eine seitliche
Schublade. Animiert werden ausschliesslich `transform` und `opacity`.

`prefers-reduced-motion` schaltet Dauer **und Verzögerungen** ab – ohne
Letzteres bliebe gestaffelter Text sonst sekundenlang unsichtbar.

**Schriften** liegen unter `public/fonts/` im Repository – Big Shoulders
Display (Anzeige), Archivo (Fließtext), Azeret Mono (Daten). Kein Google-Fonts-
CDN: Die App sieht ohne Internetzugang identisch aus, und die CSP erlaubt nur
`font-src 'self'`. Alle drei stehen unter der SIL Open Font License 1.1, siehe
`public/fonts/LICENSE.md`.

Geprüft wurde außerdem: alle Trefferflächen ≥ 44 px, sichtbarer Fokus auf jedem
Bedienelement, keine Emojis als Icons (durchgehend SVG mit einer Strichstärke),
kein horizontales Scrollen bei 375 px, im Querformat und bei 22 px Grundschrift,
und `prefers-reduced-motion` schaltet Bewegung ab.

## Zum Homescreen hinzufügen

Die App lässt sich auf dem Handy wie eine native App ablegen: in Safari über
*Teilen → Zum Home-Bildschirm*, in Chrome über *Zum Startbildschirm hinzufügen*.
Sie startet dann im Vollbild ohne Browserleiste und bekommt ein eigenes Symbol.

Die PNG-Symbole entstehen aus `public/icon.svg`. Wer das Symbol ändert, passt
diese Datei an und erzeugt die Rastergrößen neu, zum Beispiel mit
`rsvg-convert`:

```bash
rsvg-convert -w 180 -h 180 public/icon.svg -o public/apple-touch-icon.png
rsvg-convert -w 192 -h 192 public/icon.svg -o public/icon-192.png
rsvg-convert -w 512 -h 512 public/icon.svg -o public/icon-512.png
```

Das SVG ist bewusst randlos: iOS und Android legen ihre eigene abgerundete
Maske darüber. Ein vorgerundetes Symbol bekäme doppelte Ecken. Für iOS ist das
PNG Pflicht – `apple-touch-icon` wertet kein SVG aus.

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
│   ├── favicon.svg              Browser-Tab
│   ├── icon.svg                 Vorlage für die App-Icons
│   ├── apple-touch-icon.png     Homescreen-Symbol (iOS, 180x180)
│   ├── icon-192.png             Homescreen-Symbol (Android / Manifest)
│   ├── icon-512.png
│   ├── manifest.webmanifest
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
