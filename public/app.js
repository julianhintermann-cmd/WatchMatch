/* ==========================================================================
   WatchMatch – Client
   Aufbau:
     1. Hilfsfunktionen        7. Filter
     2. Zustand & Speicher     8. Kartenstapel & Swipe-Gesten
     3. DOM-Referenzen         9. Matches & Overlay
     4. Benachrichtigungen    10. Socket-Anbindung
     5. Ansichten & Routing   11. Ereignisse verdrahten
     6. Raum-Rendering        12. Start

   Sicherheit: Sämtliche Inhalte vom Server werden ausschließlich über
   `textContent` gesetzt – es wird nirgends HTML aus Daten erzeugt.
   ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
     1. Hilfsfunktionen
     ====================================================================== */

  const $ = (id) => document.getElementById(id);

  /** Erlaubt nur Bild-URLs von der eigenen Origin oder von TMDB. */
  function safeImageUrl(url) {
    if (typeof url !== 'string' || url.length === 0) return null;
    if (url.startsWith('/') && !url.startsWith('//')) return url;
    if (url.startsWith('https://image.tmdb.org/')) return url;
    return null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /** "2h 49min" bzw. "95min" */
  function formatRuntime(minutes) {
    if (!minutes || minutes <= 0) return '';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours === 0) return `${rest}min`;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}min`;
  }

  function formatRating(rating) {
    return typeof rating === 'number' && rating > 0 ? `${rating.toFixed(1)}/10` : '';
  }

  function debounce(fn, delay) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /** Kopiert Text – mit Fallback für Browser ohne Clipboard-API (http). */
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* Fallback unten */
    }
    try {
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(helper);
      return ok;
    } catch {
      return false;
    }
  }

  /* ======================================================================
     2. Zustand & Speicher
     ====================================================================== */

  const SESSION_KEY = 'watchmatch:session';

  const state = {
    config: null,
    session: null, // { userId, token, name, roomCode }
    room: null, // öffentlicher Raumzustand vom Server
    movies: [],
    mySwipes: {}, // movieId -> 'like' | 'pass'
    queue: [], // noch nicht bewertete Filme (Server-Reihenfolge)
    view: 'home',
    connected: false,
    everConnected: false,
    busy: false, // blockiert Swipes während einer Fly-out-Animation
    matchQueue: [],
    overlayOpen: false,
    tmdbStatus: null, // { state: 'ok' | 'disabled' | 'error', hint? }
  };

  const Storage = {
    load() {
      try {
        const raw = window.localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.userId === 'string' && typeof parsed.token === 'string') {
          return parsed;
        }
      } catch {
        /* localStorage kann blockiert sein – dann eben ohne Wiederverbindung */
      }
      return null;
    },
    save(session) {
      try {
        window.localStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            userId: session.userId,
            token: session.token,
            roomCode: session.roomCode,
          }),
        );
      } catch {
        /* ignorieren */
      }
    },
    clear() {
      try {
        window.localStorage.removeItem(SESSION_KEY);
      } catch {
        /* ignorieren */
      }
    },
  };

  /* ======================================================================
     3. DOM-Referenzen
     ====================================================================== */

  const dom = {
    views: {
      home: $('view-home'),
      lobby: $('view-lobby'),
      swipe: $('view-swipe'),
      done: $('view-done'),
    },
    roomStatus: $('room-status'),
    connectionDot: $('connection-dot'),
    connectionText: $('connection-text'),
    peopleCount: $('people-count'),
    roomCodeChip: $('room-code-chip'),
    btnLeave: $('btn-leave'),

    btnCreateRoom: $('btn-create-room'),
    btnShowJoin: $('btn-show-join'),
    joinForm: $('join-form'),
    inputRoomCode: $('input-room-code'),

    lobbyRoomCode: $('lobby-room-code'),
    btnCopyCode: $('btn-copy-code'),
    btnCopyLink: $('btn-copy-link'),
    btnShare: $('btn-share'),
    inviteLink: $('invite-link'),
    lobbyUsers: $('lobby-users'),
    lobbyUserCount: $('lobby-user-count'),
    filters: $('filters'),
    filterHint: $('filter-hint'),
    noteNoKey: $('note-no-key'),
    noteTmdbError: $('note-tmdb-error'),
    tmdbErrorHint: $('tmdb-error-hint'),
    filterGenre: $('filter-genre'),
    filterRating: $('filter-rating'),
    filterRatingValue: $('filter-rating-value'),
    filterYear: $('filter-year'),
    customYearFields: $('custom-year-fields'),
    filterYearFrom: $('filter-year-from'),
    filterYearTo: $('filter-year-to'),
    btnStart: $('btn-start'),
    startNote: $('start-note'),

    myProgress: $('my-progress'),
    reel: $('reel'),
    heroReel: $('hero-reel'),
    peerProgress: $('peer-progress'),
    cardStack: $('card-stack'),
    stackLoading: $('stack-loading'),
    cardAnnouncer: $('card-announcer'),
    btnPass: $('btn-pass'),
    btnLike: $('btn-like'),
    btnDetails: $('btn-details'),
    btnOpenMatches: $('btn-open-matches'),
    matchCount: $('match-count'),

    doneMatches: $('done-matches'),
    doneSubtitle: $('done-subtitle'),
    btnNewRound: $('btn-new-round'),
    btnBackToSwipe: $('btn-back-to-swipe'),

    matchesPanel: $('matches-panel'),
    drawerGrabber: $('drawer-grabber'),
    matchesList: $('matches-list'),
    btnCloseMatches: $('btn-close-matches'),
    drawerBackdrop: $('drawer-backdrop'),

    overlay: $('match-overlay'),
    overlayPoster: $('overlay-poster'),
    overlayTitle: $('overlay-movie-title'),
    overlayMeta: $('overlay-movie-meta'),
    overlayOverview: $('overlay-movie-overview'),
    overlayLikedBy: $('overlay-liked-by'),
    btnKeepSwiping: $('btn-keep-swiping'),
    btnStopSwiping: $('btn-stop-swiping'),

    toasts: $('toasts'),

    tplCard: $('tpl-card'),
    tplUser: $('tpl-user'),
    tplMatch: $('tpl-match'),
    tplPeer: $('tpl-peer'),
    tplToast: $('tpl-toast'),
  };

  /* ======================================================================
     4. Benachrichtigungen
     ====================================================================== */

  const Notify = {
    show(message, type = 'info', duration = 3600) {
      const node = dom.tplToast.content.firstElementChild.cloneNode(true);
      node.dataset.type = type;
      node.querySelector('.toast__text').textContent = message;
      dom.toasts.appendChild(node);

      setTimeout(() => {
        node.classList.add('toast--leaving');
        setTimeout(() => node.remove(), 220);
      }, duration);
    },
    error(message) {
      this.show(message, 'error', 4800);
    },
    success(message) {
      this.show(message, 'success');
    },
  };

  /* ======================================================================
     5. Ansichten & Routing
     ====================================================================== */

  function showView(name) {
    state.view = name;
    Object.keys(dom.views).forEach((key) => {
      dom.views[key].hidden = key !== name;
    });

    const inRoom = name !== 'home';
    dom.roomStatus.hidden = !inRoom;
    dom.btnLeave.hidden = !inRoom;
    window.scrollTo(0, 0);
  }

  /** Liest einen Raum-Code aus /room/WM8K bzw. ?room=WM8K. */
  function roomCodeFromUrl() {
    const match = window.location.pathname.match(/^\/room\/([A-Za-z0-9]{2,10})\/?$/);
    if (match) return match[1].toUpperCase();
    const param = new URLSearchParams(window.location.search).get('room');
    return param ? param.toUpperCase() : null;
  }

  function setUrlForRoom(code) {
    const target = code ? `/room/${code}` : '/';
    if (window.location.pathname !== target) {
      window.history.pushState({ room: code || null }, '', target);
    }
  }

  function roomLink(code) {
    return `${window.location.origin}/room/${code}`;
  }

  /* ======================================================================
     6. Raum-Rendering
     ====================================================================== */

  function isHost() {
    return Boolean(state.room && state.session && state.room.hostId === state.session.userId);
  }

  function myUser() {
    if (!state.room || !state.session) return null;
    return state.room.users.find((user) => user.id === state.session.userId) || null;
  }

  function renderHeader() {
    if (!state.room) return;
    const online = state.room.users.filter((user) => user.connected).length;
    dom.peopleCount.textContent = `${online} ${online === 1 ? 'Person' : 'Personen'}`;
    dom.roomCodeChip.textContent = state.room.code;
  }

  function setConnectionState(connected) {
    state.connected = connected;
    dom.connectionDot.dataset.state = connected ? 'online' : 'offline';
    dom.connectionText.textContent = connected ? 'Verbunden' : 'Verbindung verloren';
  }

  function renderLobby() {
    if (!state.room) return;
    const room = state.room;

    dom.lobbyRoomCode.textContent = room.code;
    dom.inviteLink.textContent = roomLink(room.code);
    dom.lobbyUserCount.textContent = `${room.users.length}/${room.maxUsers}`;

    dom.lobbyUsers.replaceChildren();
    room.users.forEach((user, index) => {
      const node = dom.tplUser.content.firstElementChild.cloneNode(true);
      node.querySelector('.seat__no').textContent = String(index + 1).padStart(2, '0');
      node.querySelector('.seat__name').textContent = user.name;
      if (!user.connected) node.classList.add('seat--offline');

      // Rollen als Textmarken statt Emojis.
      const tags = node.querySelector('.seat__tags');
      tags.replaceChildren();
      if (user.isHost) {
        const host = document.createElement('span');
        host.className = 'is-host';
        host.textContent = 'Host';
        tags.appendChild(host);
      }
      if (user.id === (state.session && state.session.userId)) {
        const you = document.createElement('span');
        you.textContent = 'Du';
        tags.appendChild(you);
      }
      if (!user.connected) {
        const off = document.createElement('span');
        off.textContent = 'offline';
        tags.appendChild(off);
      }

      dom.lobbyUsers.appendChild(node);
    });

    const host = isHost();
    setFiltersFromRoom(room.filters);
    setFiltersEnabled(host);
    dom.filterHint.textContent = host
      ? 'Stelle ein, welche Filme ihr bewerten wollt.'
      : 'Nur der Host kann die Filter ändern.';

    dom.btnStart.hidden = !host;
    dom.btnStart.disabled = !host || !state.connected;
    dom.startNote.textContent = host
      ? room.users.length < 2
        ? 'Tipp: Für Matches braucht ihr mindestens zwei Personen im Raum.'
        : 'Alle da? Dann kann es losgehen.'
      : 'Warte, bis der Host die Runde startet.';
  }

  /**
   * Zeichnet die Rolle: ein Kader je Film. Der Streifen zeigt nicht nur den
   * Fortschritt, sondern auch das eigene Urteil und die Fundstellen der
   * Matches – Information, die ein Fortschrittsbalken nicht transportiert.
   */
  function renderReel() {
    const total = state.movies.length;
    if (total === 0) {
      dom.reel.replaceChildren();
      return;
    }

    // Kader nur neu aufbauen, wenn sich die Rundenlänge geändert hat.
    if (dom.reel.childElementCount !== total) {
      const frames = [];
      for (let index = 0; index < total; index += 1) {
        const frame = document.createElement('span');
        frame.className = 'reel__frame';
        frames.push(frame);
      }
      dom.reel.replaceChildren(...frames);
    }

    const matched = new Set(
      state.room ? state.room.matches.map((match) => match.movieId) : [],
    );
    const current = state.queue.length > 0 ? state.queue[0].id : null;

    state.movies.forEach((movie, index) => {
      const frame = dom.reel.children[index];
      if (!frame) return;

      const verdict = state.mySwipes[movie.id];
      let mark = '';
      if (matched.has(movie.id)) mark = 'match';
      else if (verdict === 'like') mark = 'keep';
      else if (verdict === 'pass') mark = 'pass';
      if (mark) frame.dataset.state = mark;
      else frame.removeAttribute('data-state');

      // Der Abspielkopf ist eine eigene Markierung – sonst verschwindet er,
      // sobald der aktuelle Film bereits ein Match ist.
      if (movie.id === current) frame.dataset.now = 'true';
      else frame.removeAttribute('data-now');
    });
  }

  function renderProgress() {
    if (!state.room) return;
    const total = state.movies.length || state.room.movieCount || 0;
    const me = myUser();
    const mine = me ? me.swipes : 0;

    dom.myProgress.textContent = `Du ${mine}/${total}`;
    dom.reel.setAttribute(
      'aria-valuenow',
      String(total > 0 ? Math.round((mine / total) * 100) : 0),
    );
    renderReel();

    dom.peerProgress.replaceChildren();
    state.room.users
      .filter((user) => !state.session || user.id !== state.session.userId)
      .forEach((user) => {
        const node = dom.tplPeer.content.firstElementChild.cloneNode(true);
        node.querySelector('.peer__name').textContent = user.name;
        node.querySelector('.peer__value').textContent = `${user.swipes}/${total}`;
        if (!user.connected) node.classList.add('peer--offline');
        dom.peerProgress.appendChild(node);
      });
  }

  /**
   * Erklärt, woher die Filme kommen. Wichtig ist der Fehlerfall: Ist ein Key
   * gesetzt, den TMDB ablehnt, fällt der Server auf die lokalen Filme zurück –
   * ohne Hinweis säße man vor Platzhaltern und wüsste nicht, warum.
   */
  function renderMovieSourceNote() {
    const status = state.tmdbStatus;
    const kind = status ? status.state : null;

    dom.noteNoKey.hidden = kind !== 'disabled';
    dom.noteTmdbError.hidden = kind !== 'error';
    dom.tmdbErrorHint.textContent = kind === 'error' && status.hint ? status.hint : '';
  }

  function renderMatchList(listElement, matches) {
    listElement.replaceChildren();

    if (!matches || matches.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'matches__empty';
      empty.textContent = 'Noch kein Match. Zwei gleiche Likes genügen.';
      listElement.appendChild(empty);
      return;
    }

    matches
      .slice()
      .reverse()
      .forEach((match) => {
        const movie = match.movie;
        const node = dom.tplMatch.content.firstElementChild.cloneNode(true);
        const poster = node.querySelector('.match__poster');
        const url = safeImageUrl(movie.posterUrl);
        if (url) {
          poster.src = url;
          poster.alt = `Poster: ${movie.title}`;
        } else {
          poster.remove();
        }
        node.querySelector('.match__title').textContent = movie.title;
        node.querySelector('.match__meta').textContent = [
          formatRating(movie.rating),
          movie.year || '',
          (movie.genres || []).slice(0, 2).join(' · '),
        ]
          .filter(Boolean)
          .join(' · ');
        listElement.appendChild(node);
      });
  }

  function renderMatches() {
    const matches = state.room ? state.room.matches : [];
    dom.matchCount.textContent = String(matches.length);
    dom.matchCount.dataset.empty = String(matches.length === 0);
    renderMatchList(dom.matchesList, matches);
    renderMatchList(dom.doneMatches, matches);
  }

  function renderDone() {
    const host = isHost();
    dom.btnNewRound.hidden = !host;
    dom.btnBackToSwipe.hidden = state.queue.length === 0;

    const others = state.room
      ? state.room.users.filter((user) => user.id !== (state.session && state.session.userId))
      : [];
    const total = state.movies.length;
    const stillSwiping = others.filter((user) => user.swipes < total).length;

    dom.doneSubtitle.textContent =
      stillSwiping > 0
        ? `Noch ${stillSwiping} ${stillSwiping === 1 ? 'Person ist' : 'Personen sind'} am Swipen – Matches erscheinen weiterhin sofort.`
        : 'Alle sind durch. Viel Spaß beim Film!';
  }

  function renderAll() {
    renderHeader();
    renderMatches();
    if (state.view === 'lobby') renderLobby();
    if (state.view === 'swipe') renderProgress();
    if (state.view === 'done') {
      renderProgress();
      renderDone();
    }
  }

  /* ======================================================================
     7. Filter
     ====================================================================== */

  const CURRENT_YEAR = new Date().getFullYear();

  function populateFilterOptions(config) {
    config.genres.forEach((genre) => {
      const option = document.createElement('option');
      option.value = String(genre.id);
      option.textContent = genre.name;
      dom.filterGenre.appendChild(option);
    });
    dom.filterYearFrom.min = String(config.yearRange.min);
    dom.filterYearFrom.max = String(config.yearRange.max);
    dom.filterYearTo.min = String(config.yearRange.min);
    dom.filterYearTo.max = String(config.yearRange.max);
    dom.filterYearFrom.placeholder = '1990';
    dom.filterYearTo.placeholder = String(CURRENT_YEAR);
  }

  /** UI-Auswahl -> Filterobjekt für den Server. */
  function readFiltersFromUi() {
    const genreValue = dom.filterGenre.value;
    const filters = {
      genre: genreValue === '' ? null : Number(genreValue),
      minRating: Number(dom.filterRating.value) || 0,
      yearFrom: null,
      yearTo: null,
    };

    switch (dom.filterYear.value) {
      case 'last5':
        filters.yearFrom = CURRENT_YEAR - 4;
        break;
      case 'last10':
        filters.yearFrom = CURRENT_YEAR - 9;
        break;
      case 'since2000':
        filters.yearFrom = 2000;
        break;
      case 'since1990':
        filters.yearFrom = 1990;
        break;
      case 'custom': {
        const from = Number.parseInt(dom.filterYearFrom.value, 10);
        const to = Number.parseInt(dom.filterYearTo.value, 10);
        filters.yearFrom = Number.isFinite(from) ? from : null;
        filters.yearTo = Number.isFinite(to) ? to : null;
        break;
      }
      default:
        break;
    }
    return filters;
  }

  /** Serverzustand -> UI (damit Gäste die Host-Auswahl sehen). */
  function setFiltersFromRoom(filters) {
    if (!filters || dom.filters.dataset.editing === 'true') return;

    dom.filterGenre.value = filters.genre === null ? '' : String(filters.genre);
    dom.filterRating.value = String(filters.minRating || 0);
    dom.filterRatingValue.textContent = Number(filters.minRating || 0).toFixed(1);

    let preset = 'all';
    if (filters.yearFrom !== null && filters.yearTo === null) {
      if (filters.yearFrom === CURRENT_YEAR - 4) preset = 'last5';
      else if (filters.yearFrom === CURRENT_YEAR - 9) preset = 'last10';
      else if (filters.yearFrom === 2000) preset = 'since2000';
      else if (filters.yearFrom === 1990) preset = 'since1990';
      else preset = 'custom';
    } else if (filters.yearFrom !== null || filters.yearTo !== null) {
      preset = 'custom';
    }

    dom.filterYear.value = preset;
    dom.customYearFields.hidden = preset !== 'custom';
    if (preset === 'custom') {
      dom.filterYearFrom.value = filters.yearFrom === null ? '' : String(filters.yearFrom);
      dom.filterYearTo.value = filters.yearTo === null ? '' : String(filters.yearTo);
    }
  }

  function setFiltersEnabled(enabled) {
    dom.filters.dataset.locked = String(!enabled);
    [
      dom.filterGenre,
      dom.filterRating,
      dom.filterYear,
      dom.filterYearFrom,
      dom.filterYearTo,
    ].forEach((element) => {
      element.disabled = !enabled;
    });
  }

  // `Socket` wird weiter unten (Abschnitt 10) definiert. Das ist unkritisch:
  // Diese Funktion läuft erst, nachdem `init()` die Oberfläche verdrahtet hat.
  const pushFilters = debounce(() => {
    if (!isHost()) return;
    Socket.emit('room:filters', { filters: readFiltersFromUi() }, (response) => {
      dom.filters.dataset.editing = 'false';
      if (response && response.ok === false) Notify.error(response.error.message);
    });
  }, 320);

  function onFilterChanged() {
    dom.filters.dataset.editing = 'true';
    dom.filterRatingValue.textContent = Number(dom.filterRating.value).toFixed(1);
    dom.customYearFields.hidden = dom.filterYear.value !== 'custom';
    pushFilters();
  }

  /* ======================================================================
     8. Kartenstapel & Swipe-Gesten
     ====================================================================== */

  const VISIBLE_CARDS = 3;

  function rebuildQueue() {
    state.queue = state.movies.filter((movie) => !state.mySwipes[movie.id]);
  }

  function buildCard(movie, depth, position, total) {
    const node = dom.tplCard.content.firstElementChild.cloneNode(true);
    node.dataset.depth = String(depth);
    node.dataset.movieId = movie.id;

    // Randcode wie auf Filmmaterial: Position in der Rolle und Jahr.
    node.querySelector('.card__edgecode').textContent = [
      `${String(position).padStart(2, '0')}/${total}`,
      movie.year || '',
    ]
      .filter(Boolean)
      .join('  ');

    const image = node.querySelector('.card__img');
    const placeholder = node.querySelector('.card__placeholder');
    placeholder.firstElementChild.textContent = movie.title;

    const url = safeImageUrl(movie.posterUrl);
    if (url) {
      image.alt = `Filmposter: ${movie.title}`;
      image.addEventListener('error', () => {
        image.hidden = true;
        placeholder.hidden = false;
      });
      placeholder.hidden = true;
      image.src = url;
    } else {
      image.hidden = true;
      placeholder.hidden = false;
    }

    node.querySelector('.card__title').textContent = movie.title;
    node.querySelector('.card__rating').textContent = formatRating(movie.rating);
    node.querySelector('.card__year').textContent = movie.year ? String(movie.year) : '';
    node.querySelector('.card__runtime').textContent = formatRuntime(movie.runtime);
    node.querySelector('.card__genres').textContent = (movie.genres || []).join(' · ');
    node.querySelector('.card__overview').textContent =
      movie.overview || 'Für diesen Film liegt keine Beschreibung vor.';

    return node;
  }

  function renderStack() {
    dom.cardStack.replaceChildren();

    const visible = state.queue.slice(0, VISIBLE_CARDS);
    const total = state.movies.length;
    const firstPosition = total - state.queue.length + 1;
    // Rückwärts einfügen, damit der erste Film oben liegt.
    for (let index = visible.length - 1; index >= 0; index -= 1) {
      dom.cardStack.appendChild(buildCard(visible[index], index, firstPosition + index, total));
    }

    const hasCards = visible.length > 0;
    dom.stackLoading.hidden = hasCards;
    dom.btnPass.disabled = !hasCards;
    dom.btnLike.disabled = !hasCards;
    dom.btnDetails.disabled = !hasCards;

    if (hasCards) {
      dom.cardAnnouncer.textContent = `Film ${firstPosition} von ${total}: ${visible[0].title}`;
      attachGestures(topCard());
    }
  }

  function topCard() {
    return dom.cardStack.querySelector('.card[data-depth="0"]');
  }

  /** Blendet die Ladeanzeige ein/aus. */
  function setStackLoading(loading) {
    dom.stackLoading.hidden = !loading;
  }

  function swipeThreshold(card) {
    return Math.max(70, card.getBoundingClientRect().width * 0.28);
  }

  function updateDragVisual(card, dx, dy) {
    const threshold = swipeThreshold(card);
    const rotation = clamp((dx / card.getBoundingClientRect().width) * 22, -22, 22);
    // Leichtes Anheben beim Ziehen – die Karte kommt aus dem Stapel heraus.
    const lift = 1 + Math.min(Math.hypot(dx, dy) / 700, 0.022);
    card.style.transform =
      `translate(${dx}px, ${dy * 0.35}px) rotate(${rotation}deg) scale(${lift.toFixed(4)})`;

    const intensity = clamp(Math.abs(dx) / threshold, 0, 1);
    const keep = card.querySelector('.card__mark--keep');
    const pass = card.querySelector('.card__mark--pass');
    keep.style.opacity = dx > 0 ? String(intensity) : '0';
    pass.style.opacity = dx < 0 ? String(intensity) : '0';
    // Die Markierung wächst mit der Ziehdistanz.
    const scale = 0.8 + intensity * 0.2;
    keep.style.transform = `scale(${scale})`;
    pass.style.transform = `scale(${scale})`;

    // Die Karte darunter rückt schon während des Ziehens nach vorn. Ohne das
    // wirkt der Stapel starr, bis der Swipe fertig ist.
    const next = dom.cardStack.querySelector('.card[data-depth="1"]');
    if (next) {
      const y = (14 - 14 * intensity).toFixed(2);
      const s = (0.968 + 0.032 * intensity).toFixed(4);
      next.style.transform = `translateY(${y}px) scale(${s})`;
      next.style.filter = `brightness(${(0.66 + 0.34 * intensity).toFixed(3)})`;
    }
  }

  /** Setzt die mitbewegte Folgekarte auf ihren Ruhezustand zurück. */
  function resetNextCard() {
    const next = dom.cardStack.querySelector('.card[data-depth="1"]');
    if (!next) return;
    next.style.transform = '';
    next.style.filter = '';
  }

  function resetCardPosition(card) {
    card.classList.add('card--animated');
    card.style.transform = '';
    card.querySelector('.card__mark--keep').style.opacity = '0';
    card.querySelector('.card__mark--pass').style.opacity = '0';
    resetNextCard();
    setTimeout(() => card.classList.remove('card--animated'), 420);
  }

  /** Lässt die Karte aus dem Bildschirm fliegen und meldet den Swipe. */
  function flyOut(card, direction) {
    const offset = (direction === 'right' ? 1 : -1) * (window.innerWidth + 260);
    card.classList.add('card--animated');
    card.style.transform = `translate(${offset}px, -40px) rotate(${direction === 'right' ? 22 : -22}deg)`;
    card.style.opacity = '0';
    card.querySelector(`.card__mark--${direction === 'right' ? 'keep' : 'pass'}`).style.opacity = '1';
  }

  function attachGestures(card) {
    if (!card || card.dataset.gestures === 'true') return;
    card.dataset.gestures = 'true';

    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;
    let moved = false;

    card.addEventListener('pointerdown', (event) => {
      if (state.busy || pointerId !== null || event.button !== 0) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      dx = 0;
      dy = 0;
      moved = false;
      card.classList.remove('card--animated');
      card.setPointerCapture(pointerId);
    });

    card.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      dx = event.clientX - startX;
      dy = event.clientY - startY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      updateDragVisual(card, dx, dy);
    });

    function finish(event) {
      if (event.pointerId !== pointerId) return;
      if (card.hasPointerCapture(pointerId)) card.releasePointerCapture(pointerId);
      pointerId = null;

      if (!moved) {
        card.classList.toggle('card--expanded');
        resetCardPosition(card);
        return;
      }

      if (Math.abs(dx) >= swipeThreshold(card)) {
        commitSwipe(dx > 0 ? 'right' : 'left', card);
      } else {
        resetCardPosition(card);
      }
    }

    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', (event) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      resetCardPosition(card);
    });
  }

  /**
   * Führt einen Swipe aus: Animation, Server-Meldung, nächste Karte.
   * Doppelte Swipes werden zusätzlich serverseitig verhindert.
   */
  function commitSwipe(direction, card) {
    if (state.busy) return;
    const movie = state.queue[0];
    if (!movie) return;

    const element = card || topCard();
    if (!element) return;

    state.busy = true;
    flyOut(element, direction);

    // Optimistisch weiterschalten – fühlt sich flüssiger an.
    state.mySwipes[movie.id] = direction === 'right' ? 'like' : 'pass';
    const me = myUser();
    if (me) me.swipes += 1;
    renderProgress();

    let reverted = false;

    Socket.emit('movie:swipe', { movieId: movie.id, direction }, (response) => {
      if (!response || response.ok !== false) return;
      // Ein bereits gezählter Swipe ist kein Fehler für den Benutzer.
      if (response.error.code === 'ALREADY_SWIPED') return;

      // Server hat den Swipe nicht gezählt -> lokalen Zustand zurückdrehen.
      reverted = true;
      delete state.mySwipes[movie.id];
      const user = myUser();
      if (user && user.swipes > 0) user.swipes -= 1;
      state.busy = false;
      rebuildQueue();
      renderStack();
      renderProgress();
      Notify.error(response.error.message);
    });

    setTimeout(() => {
      if (reverted) return; // Karte wurde bereits wiederhergestellt.
      state.busy = false;
      state.queue.shift();
      renderStack();
      if (state.queue.length === 0 && !state.overlayOpen) {
        showView('done');
        renderDone();
        renderProgress();
      }
    }, 300);
  }

  function handleKeydown(event) {
    if (state.view !== 'swipe' || state.overlayOpen) return;
    const target = event.target;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

    const key = event.key.toLowerCase();
    if (key === 'arrowleft' || key === 'a') {
      event.preventDefault();
      commitSwipe('left');
    } else if (key === 'arrowright' || key === 'd') {
      event.preventDefault();
      commitSwipe('right');
    }
  }

  /* ======================================================================
     9. Matches & Overlay
     ====================================================================== */

  /**
   * Startet die Match-Sequenz von vorn: Lampe zündet, Kader fädelt ein, Licht
   * wandert über das Bild, Text kommt gestaffelt nach.
   *
   * Die Klasse wird entfernt und nach einem erzwungenen Reflow neu gesetzt.
   * Ohne das liefe die Sequenz beim zweiten Match in Folge nicht erneut, weil
   * das Overlay zwischendurch gar nicht ausgeblendet wird.
   */
  function playMatchSequence() {
    dom.overlay.classList.remove('overlay--play');
    void dom.overlay.offsetWidth;
    dom.overlay.classList.add('overlay--play');
  }

  function showMatchOverlay(match) {
    const movie = match.movie;
    state.overlayOpen = true;

    const url = safeImageUrl(movie.posterUrl);
    if (url) {
      dom.overlayPoster.src = url;
      dom.overlayPoster.alt = `Filmposter: ${movie.title}`;
      dom.overlayPoster.hidden = false;
    } else {
      dom.overlayPoster.removeAttribute('src');
      dom.overlayPoster.hidden = true;
    }

    dom.overlayTitle.textContent = movie.title;
    dom.overlayMeta.textContent = [formatRating(movie.rating), movie.year || '', formatRuntime(movie.runtime)]
      .filter(Boolean)
      .join('  ·  ');
    dom.overlayOverview.textContent = movie.overview || '';
    dom.overlayLikedBy.textContent = (match.likedBy || []).join(' + ');

    dom.overlay.hidden = false;
    playMatchSequence();
    // Fokus erst nach dem Auftritt setzen, sonst springt die Seite.
    setTimeout(() => dom.btnKeepSwiping.focus({ preventScroll: true }), 480);
  }

  function closeMatchOverlay(goToResults) {
    dom.overlay.hidden = true;
    state.overlayOpen = false;

    if (goToResults) {
      showView('done');
      renderDone();
      renderProgress();
      return;
    }

    const next = state.matchQueue.shift();
    if (next) {
      showMatchOverlay(next);
      return;
    }
    if (state.view === 'swipe' && state.queue.length === 0) {
      showView('done');
      renderDone();
      renderProgress();
    }
  }

  function queueMatch(match) {
    if (state.overlayOpen) {
      state.matchQueue.push(match);
      return;
    }
    showMatchOverlay(match);
  }

  let sheetHideTimer = null;

  /**
   * Blendet die Matches-Liste ein und aus.
   *
   * Beim Schließen wird erst hinausgeglitten und danach ausgeblendet – würde
   * man sofort `hidden` setzen, verschwände die Fläche schlagartig.
   */
  function toggleMatchesPanel(open) {
    clearTimeout(sheetHideTimer);

    if (open) {
      dom.matchesPanel.hidden = false;
      dom.drawerBackdrop.hidden = false;
      dom.matchesPanel.setAttribute('aria-hidden', 'false');
      dom.matchesPanel.style.transform = '';
      // Erst nach dem Einblenden animieren, sonst springt es ohne Bewegung auf.
      window.requestAnimationFrame(() => {
        dom.matchesPanel.dataset.open = 'true';
      });
      dom.btnCloseMatches.focus({ preventScroll: true });
      return;
    }

    dom.matchesPanel.dataset.open = 'false';
    dom.matchesPanel.setAttribute('aria-hidden', 'true');
    dom.drawerBackdrop.hidden = true;
    sheetHideTimer = setTimeout(() => {
      dom.matchesPanel.hidden = true;
      dom.matchesPanel.style.transform = '';
    }, 430);
  }

  /**
   * Das Sheet lässt sich am Griff nach unten wegwischen – auf dem Handy die
   * erwartete Geste. Nach oben gummiert es, statt sich ziehen zu lassen.
   */
  function attachSheetGesture() {
    const grabber = dom.drawerGrabber;
    if (!grabber) return;

    let pointerId = null;
    let startY = 0;
    let dy = 0;

    grabber.addEventListener('pointerdown', (event) => {
      if (pointerId !== null || event.button !== 0) return;
      pointerId = event.pointerId;
      startY = event.clientY;
      dy = 0;
      dom.matchesPanel.dataset.dragging = 'true';
      grabber.setPointerCapture(pointerId);
    });

    grabber.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      dy = event.clientY - startY;
      const offset = dy < 0 ? dy * 0.16 : dy;
      dom.matchesPanel.style.transform = `translateY(${offset.toFixed(1)}px)`;
    });

    function finish(event) {
      if (event.pointerId !== pointerId) return;
      if (grabber.hasPointerCapture(pointerId)) grabber.releasePointerCapture(pointerId);
      pointerId = null;
      dom.matchesPanel.dataset.dragging = 'false';

      if (dy > 90) {
        toggleMatchesPanel(false);
      } else {
        dom.matchesPanel.style.transform = '';
      }
    }

    grabber.addEventListener('pointerup', finish);
    grabber.addEventListener('pointercancel', finish);
  }

  /* ======================================================================
     10. Socket-Anbindung
     ====================================================================== */

  const Socket = {
    io: null,

    connect() {
      this.io = window.io({
        reconnectionDelay: 700,
        reconnectionDelayMax: 4000,
        timeout: 12000,
      });
      this.registerEvents();
    },

    emit(event, payload, ack) {
      if (!this.io || !this.io.connected) {
        Notify.error('Keine Verbindung zum Server. Bitte kurz warten.');
        if (typeof ack === 'function') {
          ack({ ok: false, error: { code: 'OFFLINE', message: 'Keine Verbindung.' } });
        }
        return;
      }
      this.io.emit(event, payload, ack);
    },

    registerEvents() {
      const socket = this.io;

      socket.on('connect', () => {
        setConnectionState(true);
        if (state.everConnected) {
          dom.connectionText.textContent = 'Wieder verbunden';
          Notify.success('Wieder verbunden.');
        }
        state.everConnected = true;
        restoreSession();
      });

      socket.on('disconnect', () => {
        setConnectionState(false);
        if (state.view !== 'home') Notify.error('Verbindung verloren – wir versuchen es weiter.');
      });

      socket.on('connect_error', () => {
        setConnectionState(false);
      });

      socket.on('room:state', (roomState) => {
        if (!roomState || !state.session || roomState.code !== state.session.roomCode) return;
        const wasLobby = state.room ? state.room.phase : null;
        state.room = roomState;

        if (wasLobby === 'lobby' && roomState.phase === 'swiping' && state.movies.length === 0) {
          setStackLoading(true);
        }
        renderAll();
      });

      socket.on('room:movies', (payload) => {
        if (!payload || !Array.isArray(payload.movies)) return;
        state.movies = payload.movies;
        state.mySwipes = {};
        state.matchQueue = [];
        rebuildQueue();
        setStackLoading(false);
        showView('swipe');
        renderStack();
        renderProgress();

        if (payload.tmdb) {
          state.tmdbStatus = payload.tmdb;
          renderMovieSourceNote();
        }
        if (payload.tmdb && payload.tmdb.state === 'error') {
          Notify.error(payload.tmdb.hint || 'TMDB ist nicht erreichbar – es laufen die mitgelieferten Filme.');
        } else {
          Notify.success(`${payload.movies.length} Filme geladen – los geht's!`);
        }
      });

      socket.on('room:progress', (payload) => {
        if (!state.room || !payload || payload.code !== state.room.code) return;
        const swipesById = new Map(payload.users.map((user) => [user.id, user.swipes]));
        state.room.users.forEach((user) => {
          if (swipesById.has(user.id)) user.swipes = swipesById.get(user.id);
        });
        renderProgress();
        if (state.view === 'done') renderDone();
      });

      socket.on('match:created', (payload) => {
        if (!payload || !payload.match) return;
        if (state.room) {
          const known = state.room.matches.some((match) => match.movieId === payload.match.movieId);
          if (!known) state.room.matches.push(payload.match);
        }
        renderMatches();
        queueMatch(payload.match);
      });

      socket.on('room:error', (error) => {
        if (error && error.message) Notify.error(error.message);
      });

      socket.on('room:closed', (payload) => {
        Notify.error((payload && payload.message) || 'Der Raum wurde geschlossen.');
        leaveRoomLocally();
      });
    },
  };

  /* ======================================================================
     Raum-Aktionen
     ====================================================================== */

  function applySession(payload) {
    state.session = payload.session;
    state.room = payload.state;
    state.movies = Array.isArray(payload.movies) ? payload.movies : [];
    state.mySwipes = payload.yourSwipes || {};
    rebuildQueue();

    Storage.save(payload.session);
    setUrlForRoom(payload.state.code);
    setConnectionState(true);

    if (payload.state.phase === 'swiping' && state.movies.length > 0) {
      setStackLoading(false);
      showView(state.queue.length > 0 ? 'swipe' : 'done');
      renderStack();
    } else {
      showView('lobby');
    }
    renderAll();
    if (state.view === 'done') renderDone();
  }

  function createRoom() {
    dom.btnCreateRoom.disabled = true;
    Socket.emit('room:create', {}, (response) => {
      dom.btnCreateRoom.disabled = false;
      if (!response || response.ok === false) {
        Notify.error((response && response.error.message) || 'Raum konnte nicht erstellt werden.');
        return;
      }
      applySession(response);
      Notify.success(`Raum ${response.state.code} erstellt.`);
    });
  }

  function joinRoom(code, credentials) {
    const payload = { code };
    if (credentials) {
      payload.userId = credentials.userId;
      payload.token = credentials.token;
    }

    Socket.emit('room:join', payload, (response) => {
      if (!response || response.ok === false) {
        Notify.error((response && response.error.message) || 'Beitritt fehlgeschlagen.');
        if (credentials) {
          // Gespeicherte Sitzung ist ungültig – nicht endlos wiederholen.
          Storage.clear();
          leaveRoomLocally();
        } else if (!state.room) {
          setUrlForRoom(null);
        }
        return;
      }
      applySession(response);
    });
  }

  /** Setzt den Client auf die Startseite zurück (ohne Server-Aufruf). */
  function leaveRoomLocally() {
    state.session = null;
    state.room = null;
    state.movies = [];
    state.queue = [];
    state.mySwipes = {};
    state.matchQueue = [];
    state.overlayOpen = false;
    dom.overlay.hidden = true;
    toggleMatchesPanel(false);
    Storage.clear();
    setUrlForRoom(null);
    showView('home');
  }

  function leaveRoom() {
    Socket.emit('room:leave', {}, () => {});
    leaveRoomLocally();
    Notify.show('Du hast den Raum verlassen.');
  }

  /** Nach (Wieder-)Verbindung: Sitzung oder Link-Code wiederherstellen. */
  function restoreSession() {
    const urlCode = roomCodeFromUrl();
    const stored = state.session || Storage.load();

    if (stored && stored.roomCode && (!urlCode || urlCode === stored.roomCode)) {
      joinRoom(stored.roomCode, stored);
      return;
    }
    if (urlCode) {
      joinRoom(urlCode, null);
      return;
    }
    if (state.view !== 'home') showView('home');
  }

  function startRound() {
    if (!isHost()) return;
    dom.btnStart.disabled = true;
    dom.btnNewRound.disabled = true;
    setStackLoading(true);

    Socket.emit('room:start', {}, (response) => {
      dom.btnStart.disabled = false;
      dom.btnNewRound.disabled = false;
      if (!response || response.ok === false) {
        setStackLoading(false);
        Notify.error((response && response.error.message) || 'Die Runde konnte nicht gestartet werden.');
      }
    });
  }

  /* ======================================================================
     11. Ereignisse verdrahten
     ====================================================================== */

  function wireEvents() {
    dom.btnCreateRoom.addEventListener('click', createRoom);

    dom.btnShowJoin.addEventListener('click', () => {
      dom.joinForm.hidden = !dom.joinForm.hidden;
      if (!dom.joinForm.hidden) dom.inputRoomCode.focus();
    });

    dom.joinForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = dom.inputRoomCode.value.trim().toUpperCase();
      if (code.length < 2) {
        Notify.error('Bitte gib einen Raum-Code ein, zum Beispiel WM8K.');
        return;
      }
      joinRoom(code, null);
    });

    dom.inputRoomCode.addEventListener('input', () => {
      dom.inputRoomCode.value = dom.inputRoomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    dom.btnLeave.addEventListener('click', leaveRoom);

    // --- Einladung ---
    dom.btnCopyCode.addEventListener('click', async () => {
      if (!state.room) return;
      const ok = await copyText(state.room.code);
      ok ? Notify.success('Raum-Code kopiert.') : Notify.error('Kopieren hat nicht geklappt.');
    });

    dom.btnCopyLink.addEventListener('click', async () => {
      if (!state.room) return;
      const ok = await copyText(roomLink(state.room.code));
      ok ? Notify.success('Link kopiert.') : Notify.error('Kopieren hat nicht geklappt.');
    });

    if (navigator.share) {
      dom.btnShare.hidden = false;
      dom.btnShare.addEventListener('click', async () => {
        if (!state.room) return;
        try {
          await navigator.share({
            title: 'WatchMatch',
            text: `Komm in meinen WatchMatch-Raum ${state.room.code}!`,
            url: roomLink(state.room.code),
          });
        } catch {
          /* Benutzer hat abgebrochen – nichts zu tun */
        }
      });
    }

    // --- Filter & Start ---
    [dom.filterGenre, dom.filterYear, dom.filterYearFrom, dom.filterYearTo].forEach((element) => {
      element.addEventListener('change', onFilterChanged);
    });
    dom.filterRating.addEventListener('input', onFilterChanged);
    dom.btnStart.addEventListener('click', startRound);
    dom.btnNewRound.addEventListener('click', startRound);

    dom.btnBackToSwipe.addEventListener('click', () => {
      showView('swipe');
      renderStack();
      renderProgress();
    });

    // --- Swipe-Bedienung ---
    dom.btnPass.addEventListener('click', () => commitSwipe('left'));
    dom.btnLike.addEventListener('click', () => commitSwipe('right'));
    dom.btnDetails.addEventListener('click', () => {
      const card = topCard();
      if (card) card.classList.toggle('card--expanded');
    });
    document.addEventListener('keydown', handleKeydown);

    // --- Matches ---
    dom.btnOpenMatches.addEventListener('click', () => toggleMatchesPanel(true));
    attachSheetGesture();
    dom.btnCloseMatches.addEventListener('click', () => toggleMatchesPanel(false));
    dom.drawerBackdrop.addEventListener('click', () => toggleMatchesPanel(false));

    dom.btnKeepSwiping.addEventListener('click', () => closeMatchOverlay(false));
    dom.btnStopSwiping.addEventListener('click', () => closeMatchOverlay(true));

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (state.overlayOpen) closeMatchOverlay(false);
      else if (!dom.matchesPanel.hidden) toggleMatchesPanel(false);
    });

    // Zurück-Navigation im Browser.
    window.addEventListener('popstate', () => {
      const code = roomCodeFromUrl();
      if (!code && state.view !== 'home') leaveRoomLocally();
      else if (code && (!state.room || state.room.code !== code)) restoreSession();
    });
  }

  /* ======================================================================
     12. Start
     ====================================================================== */

  async function loadConfig() {
    try {
      const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Konfiguration nicht verfügbar');
      return await response.json();
    } catch {
      // Sinnvolle Defaults, damit die App auch ohne /api/config bedienbar bleibt.
      return {
        genres: [],
        maxUsersPerRoom: 8,
        moviesPerRound: 40,
        yearRange: { min: 1888, max: CURRENT_YEAR + 5 },
        tmdbStatus: null,
      };
    }
  }

  /**
   * Füllt den laufenden Filmstreifen auf der Startseite. Die Poster sind die
   * lokal erzeugten Platzhalter – damit läuft der Streifen auch offline.
   */
  const HERO_FRAMES = [10, 43, 18, 3, 35, 6, 27, 52, 39, 17];

  function buildHeroReel() {
    if (!dom.heroReel) return;
    const frames = [];
    // Zweimal dieselbe Folge, damit die Endlosschleife nahtlos umschlägt.
    for (let pass = 0; pass < 2; pass += 1) {
      HERO_FRAMES.forEach((id) => {
        const frame = document.createElement('div');
        frame.className = 'filmstrip__frame';
        const image = document.createElement('img');
        image.src = `/img/poster/${id}.svg`;
        image.alt = '';
        image.loading = 'lazy';
        frame.appendChild(image);
        frames.push(frame);
      });
    }
    dom.heroReel.replaceChildren(...frames);
  }

  async function init() {
    state.config = await loadConfig();
    populateFilterOptions(state.config);

    // Bei nicht erreichbarer Konfiguration bleibt jeder Hinweis weg.
    state.tmdbStatus = state.config.tmdbStatus || null;
    renderMovieSourceNote();
    setFiltersEnabled(false);
    wireEvents();
    buildHeroReel();
    showView('home');

    const urlCode = roomCodeFromUrl();
    if (urlCode) dom.inputRoomCode.value = urlCode;

    Socket.connect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
