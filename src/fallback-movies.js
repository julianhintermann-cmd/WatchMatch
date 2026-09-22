'use strict';

/**
 * Lokaler Film-Datensatz.
 *
 * Wird verwendet, wenn kein TMDB_API_KEY gesetzt ist oder die TMDB-API nicht
 * erreichbar ist. Die App funktioniert dadurch vollständig offline.
 *
 * Feldnamen folgen bewusst dem TMDB-Schema, damit `normalizeMovie()` beide
 * Quellen identisch verarbeiten kann:
 *   id, title, overview, release_date, poster_path, backdrop_path,
 *   vote_average, genres (TMDB-Genre-IDs), runtime (Minuten)
 *
 * `poster_path` / `backdrop_path` zeigen auf lokal generierte SVG-Platzhalter
 * (siehe `src/placeholder-image.js`), es werden also keine externen Bilder
 * benötigt.
 */

/** @type {Array<{id:number,title:string,overview:string,release_date:string,vote_average:number,genres:number[],runtime:number}>} */
const MOVIES = [
  { id: 1, title: 'Die Verurteilten', release_date: '1994-09-23', vote_average: 8.7, runtime: 142, genres: [18, 80], overview: 'Ein zu Unrecht verurteilter Banker findet im Gefängnis einen Freund - und einen langen Atem.' },
  { id: 2, title: 'Der Pate', release_date: '1972-03-14', vote_average: 8.7, runtime: 175, genres: [18, 80], overview: 'Der jüngste Sohn einer Mafiafamilie rutscht Schritt für Schritt in die Rolle des Oberhaupts.' },
  { id: 3, title: 'The Dark Knight', release_date: '2008-07-16', vote_average: 8.5, runtime: 152, genres: [28, 80, 18, 53], overview: 'Ein anarchischer Clown zwingt Gotham und seinen maskierten Beschützer an ihre moralische Grenze.' },
  { id: 4, title: 'Pulp Fiction', release_date: '1994-09-10', vote_average: 8.5, runtime: 154, genres: [53, 80], overview: 'Auftragskiller, ein Boxer und ein Pärchen mit Raubplan - drei Geschichten, die sich kreuzen.' },
  { id: 5, title: 'Forrest Gump', release_date: '1994-07-06', vote_average: 8.5, runtime: 142, genres: [35, 18, 10749], overview: 'Ein gutherziger Mann stolpert durch die amerikanische Nachkriegsgeschichte und bleibt sich treu.' },
  { id: 6, title: 'Inception', release_date: '2010-07-15', vote_average: 8.4, runtime: 148, genres: [28, 878, 12], overview: 'Ein Team von Traumdieben soll eine Idee pflanzen statt sie zu stehlen - mehrere Ebenen tief.' },
  { id: 7, title: 'Fight Club', release_date: '1999-10-15', vote_average: 8.4, runtime: 139, genres: [18, 53], overview: 'Ein schlafloser Angestellter gründet mit einem Fremden einen Klub, der außer Kontrolle gerät.' },
  { id: 8, title: 'Matrix', release_date: '1999-03-31', vote_average: 8.2, runtime: 136, genres: [28, 878], overview: 'Ein Programmierer entdeckt, dass seine Realität eine Simulation ist - und lernt, sie zu biegen.' },
  { id: 9, title: 'GoodFellas', release_date: '1990-09-19', vote_average: 8.5, runtime: 145, genres: [18, 80], overview: 'Drei Jahrzehnte Aufstieg und Absturz im Alltag der New Yorker Mafia.' },
  { id: 10, title: 'Interstellar', release_date: '2014-11-05', vote_average: 8.4, runtime: 169, genres: [12, 18, 878], overview: 'Ein Pilot verlässt seine Kinder, um jenseits eines Wurmlochs eine neue Heimat für die Menschheit zu finden.' },
  { id: 11, title: 'Sieben', release_date: '1995-09-22', vote_average: 8.4, runtime: 127, genres: [80, 53, 9648], overview: 'Zwei Ermittler jagen einen Mörder, der seine Taten an den sieben Todsünden ausrichtet.' },
  { id: 12, title: 'Das Schweigen der Lämmer', release_date: '1991-02-14', vote_average: 8.4, runtime: 119, genres: [80, 18, 53], overview: 'Eine junge FBI-Agentin sucht Rat bei einem inhaftierten Kannibalen, um einen Serientäter zu fassen.' },
  { id: 13, title: 'Der Soldat James Ryan', release_date: '1998-07-24', vote_average: 8.2, runtime: 169, genres: [18, 10752], overview: 'Eine Einheit soll mitten im Krieg einen einzelnen Fallschirmjäger finden und nach Hause bringen.' },
  { id: 14, title: 'Gladiator', release_date: '2000-05-01', vote_average: 8.2, runtime: 155, genres: [28, 18, 12], overview: 'Ein verratener römischer General kämpft sich als Sklave zurück in die Arena - und zur Rache.' },
  { id: 15, title: 'The Green Mile', release_date: '1999-12-10', vote_average: 8.5, runtime: 189, genres: [14, 18, 80], overview: 'Ein Wärter im Todestrakt trifft auf einen Häftling mit einer unerklärlichen Gabe.' },
  { id: 16, title: 'Léon - Der Profi', release_date: '1994-09-14', vote_average: 8.3, runtime: 110, genres: [53, 28, 80], overview: 'Ein wortkarger Auftragskiller nimmt ein zwölfjähriges Mädchen bei sich auf und bringt ihr sein Handwerk bei.' },
  { id: 17, title: 'Chihiros Reise ins Zauberland', release_date: '2001-07-20', vote_average: 8.5, runtime: 125, genres: [16, 10751, 14], overview: 'Ein Mädchen landet in einer Geisterwelt und muss arbeiten, um ihre Eltern zurückzuholen.' },
  { id: 18, title: 'Parasite', release_date: '2019-05-30', vote_average: 8.5, runtime: 133, genres: [35, 53, 18], overview: 'Eine arme Familie schleust sich nach und nach in den Haushalt einer reichen Familie ein.' },
  { id: 19, title: 'Whiplash', release_date: '2014-10-10', vote_average: 8.4, runtime: 107, genres: [18, 10402], overview: 'Ein ehrgeiziger Jazzdrummer gerät an einen Lehrer, der Perfektion mit Zerstörung verwechselt.' },
  { id: 20, title: 'Prestige - Die Meister der Magie', release_date: '2006-10-19', vote_average: 8.2, runtime: 130, genres: [18, 9648, 878], overview: 'Zwei Bühnenzauberer treiben ihre Rivalität bis zur völligen Selbstaufgabe.' },
  { id: 21, title: 'Departed - Unter Feinden', release_date: '2006-10-05', vote_average: 8.2, runtime: 151, genres: [18, 53, 80], overview: 'Ein Undercover-Cop und ein Maulwurf der Mafia suchen gleichzeitig nacheinander.' },
  { id: 22, title: 'Django Unchained', release_date: '2012-12-25', vote_average: 8.2, runtime: 165, genres: [18, 37], overview: 'Ein befreiter Sklave zieht mit einem Kopfgeldjäger los, um seine Frau zurückzuholen.' },
  { id: 23, title: 'Zurück in die Zukunft', release_date: '1985-07-03', vote_average: 8.3, runtime: 116, genres: [12, 35, 878], overview: 'Ein Teenager landet mit einem umgebauten Sportwagen im Jahr 1955 und gefährdet seine eigene Existenz.' },
  { id: 24, title: 'Alien - Das unheimliche Wesen aus einer fremden Welt', release_date: '1979-05-25', vote_average: 8.1, runtime: 117, genres: [27, 878], overview: 'Die Crew eines Frachtraumschiffs nimmt ein Lebewesen an Bord, das sie einzeln jagt.' },
  { id: 25, title: 'Terminator 2 - Tag der Abrechnung', release_date: '1991-07-03', vote_average: 8.1, runtime: 137, genres: [28, 53, 878], overview: 'Eine Maschine aus der Zukunft soll diesmal ein Kind beschützen statt es zu töten.' },
  { id: 26, title: 'Jurassic Park', release_date: '1993-06-11', vote_average: 8.0, runtime: 127, genres: [12, 878], overview: 'Ein Freizeitpark mit geklonten Dinosauriern verliert am Eröffnungswochenende die Kontrolle.' },
  { id: 27, title: 'Der König der Löwen', release_date: '1994-06-24', vote_average: 8.3, runtime: 89, genres: [16, 10751, 18], overview: 'Ein junger Löwe flieht nach dem Tod seines Vaters und muss lernen, seinen Platz einzunehmen.' },
  { id: 28, title: 'Toy Story', release_date: '1995-11-22', vote_average: 8.0, runtime: 81, genres: [16, 10751, 35], overview: 'Ein Cowboy aus Stoff bekommt Konkurrenz von einer Astronautenfigur - und findet einen Freund.' },
  { id: 29, title: 'WALL-E - Der Letzte räumt die Erde auf', release_date: '2008-06-27', vote_average: 8.1, runtime: 98, genres: [16, 10751, 878], overview: 'Ein einsamer Müllroboter verliebt sich und folgt seiner Sonde quer durchs All.' },
  { id: 30, title: 'Oben', release_date: '2009-05-29', vote_average: 8.0, runtime: 96, genres: [16, 10751, 12], overview: 'Ein alter Mann lässt sein Haus an Luftballons davonschweben - mit blindem Passagier.' },
  { id: 31, title: 'Coco', release_date: '2017-11-22', vote_average: 8.2, runtime: 105, genres: [16, 10751, 14], overview: 'Ein Junge landet am Tag der Toten im Reich seiner Vorfahren und sucht dort seine Familiengeschichte.' },
  { id: 32, title: 'Alles steht Kopf', release_date: '2015-06-19', vote_average: 8.0, runtime: 95, genres: [16, 10751, 18], overview: 'Die Gefühle eines elfjährigen Mädchens übernehmen die Erzählung - und geraten durcheinander.' },
  { id: 33, title: 'Grand Budapest Hotel', release_date: '2014-03-07', vote_average: 8.1, runtime: 100, genres: [35, 18], overview: 'Ein legendärer Concierge und sein Lobbyboy geraten wegen eines Gemäldes in große Schwierigkeiten.' },
  { id: 34, title: 'La La Land', release_date: '2016-12-09', vote_average: 7.9, runtime: 128, genres: [35, 18, 10402, 10749], overview: 'Eine Schauspielerin und ein Jazzpianist verlieben sich in Los Angeles - und in ihre Träume.' },
  { id: 35, title: 'Mad Max - Fury Road', release_date: '2015-05-15', vote_average: 7.6, runtime: 120, genres: [28, 12, 878], overview: 'Eine Fluchtfahrt durch die Wüste wird zur Dauerverfolgungsjagd ohne Atempause.' },
  { id: 36, title: 'Blade Runner 2049', release_date: '2017-10-06', vote_average: 7.6, runtime: 164, genres: [878, 18], overview: 'Ein Replikanten-Jäger stößt auf ein Geheimnis, das die Grenze zwischen Mensch und Maschine auflöst.' },
  { id: 37, title: 'Arrival', release_date: '2016-11-11', vote_average: 7.6, runtime: 116, genres: [878, 18, 9648], overview: 'Eine Linguistin soll die Sprache außerirdischer Besucher entschlüsseln - und begreift dabei die Zeit neu.' },
  { id: 38, title: 'Dune', release_date: '2021-09-15', vote_average: 7.8, runtime: 155, genres: [878, 12], overview: 'Ein Adelssohn übernimmt mit seiner Familie einen Wüstenplaneten voller Intrigen und Sand.' },
  { id: 39, title: 'Everything Everywhere All at Once', release_date: '2022-03-24', vote_average: 7.8, runtime: 139, genres: [28, 12, 878], overview: 'Eine überforderte Waschsalonbesitzerin muss das Multiversum retten - zwischen Steuererklärung und Familie.' },
  { id: 40, title: 'Spider-Man - A New Universe', release_date: '2018-12-06', vote_average: 8.4, runtime: 117, genres: [16, 28, 12], overview: 'Ein Teenager aus Brooklyn trifft auf Spider-Helden aus anderen Dimensionen.' },
  { id: 41, title: 'Avengers - Endgame', release_date: '2019-04-24', vote_average: 8.3, runtime: 181, genres: [12, 878, 28], overview: 'Die verbliebenen Helden versuchen, eine verlorene Schlacht rückgängig zu machen.' },
  { id: 42, title: 'Guardians of the Galaxy', release_date: '2014-07-30', vote_average: 7.9, runtime: 121, genres: [28, 878, 12], overview: 'Eine Truppe von Außenseitern stiehlt ein Artefakt und rettet aus Versehen die Galaxie.' },
  { id: 43, title: 'Der Herr der Ringe - Die Gefährten', release_date: '2001-12-19', vote_average: 8.4, runtime: 178, genres: [12, 14, 28], overview: 'Ein Hobbit bricht mit acht Gefährten auf, um einen gefährlichen Ring zu zerstören.' },
  { id: 44, title: 'Der Herr der Ringe - Die Rückkehr des Königs', release_date: '2003-12-17', vote_average: 8.5, runtime: 201, genres: [12, 14, 28], overview: 'Während die letzte Schlacht tobt, schleppen sich zwei Hobbits zum Schicksalsberg.' },
  { id: 45, title: 'Harry Potter und der Stein der Weisen', release_date: '2001-11-16', vote_average: 7.9, runtime: 152, genres: [12, 14, 10751], overview: 'Ein Waisenjunge erfährt an seinem elften Geburtstag, dass er ein Zauberer ist.' },
  { id: 46, title: 'Knives Out - Mord ist Familiensache', release_date: '2019-11-27', vote_average: 7.9, runtime: 130, genres: [35, 80, 9648], overview: 'Ein exzentrischer Detektiv ermittelt im Todesfall eines Krimiautors - verdächtig ist die ganze Familie.' },
  { id: 47, title: 'Get Out', release_date: '2017-02-24', vote_average: 7.6, runtime: 104, genres: [27, 9648, 53], overview: 'Ein Wochenende bei den Eltern der Freundin wird zum Albtraum mit System.' },
  { id: 48, title: 'A Quiet Place', release_date: '2018-04-03', vote_average: 7.4, runtime: 90, genres: [27, 18, 878], overview: 'Eine Familie lebt völlig lautlos, weil jedes Geräusch tödliche Jäger anlockt.' },
  { id: 49, title: 'Conjuring - Die Heimsuchung', release_date: '2013-07-18', vote_average: 7.5, runtime: 112, genres: [27, 53, 9648], overview: 'Zwei Geisterjäger helfen einer Familie, deren Farmhaus sie nicht mehr loslässt.' },
  { id: 50, title: 'Shutter Island', release_date: '2010-02-18', vote_average: 8.2, runtime: 138, genres: [18, 53, 9648], overview: 'Ein Marshal untersucht das Verschwinden einer Patientin auf einer abgeriegelten Gefängnisinsel.' },
  { id: 51, title: 'Memento', release_date: '2000-10-11', vote_average: 8.2, runtime: 113, genres: [9648, 53], overview: 'Ein Mann ohne Kurzzeitgedächtnis jagt einen Mörder - mit Polaroids und Tätowierungen als Notizen.' },
  { id: 52, title: 'Casablanca', release_date: '1942-11-26', vote_average: 8.2, runtime: 102, genres: [18, 10749], overview: 'Ein Barbesitzer im besetzten Marokko trifft die Frau wieder, die ihn verlassen hat.' },
  { id: 53, title: 'Titanic', release_date: '1997-11-18', vote_average: 7.9, runtime: 194, genres: [18, 10749], overview: 'Zwei junge Menschen aus verschiedenen Welten verlieben sich auf der berühmtesten Jungfernfahrt der Geschichte.' },
  { id: 54, title: 'Vergiss mein nicht!', release_date: '2004-03-19', vote_average: 8.1, runtime: 108, genres: [18, 10749, 878], overview: 'Ein Mann lässt die Erinnerung an seine Ex löschen und kämpft mitten im Verfahren darum.' },
  { id: 55, title: 'Die fabelhafte Welt der Amélie', release_date: '2001-04-25', vote_average: 8.3, runtime: 122, genres: [35, 10749], overview: 'Eine schüchterne Kellnerin beschließt, heimlich das Glück der Menschen um sie herum zu organisieren.' },
  { id: 56, title: 'Die Truman Show', release_date: '1998-06-05', vote_average: 8.1, runtime: 103, genres: [35, 18], overview: 'Ein Mann merkt langsam, dass sein ganzes Leben eine Fernsehsendung ist.' },
  { id: 57, title: 'Joker', release_date: '2019-10-02', vote_average: 8.1, runtime: 122, genres: [80, 53, 18], overview: 'Ein erfolgloser Comedian rutscht in einer kalten Stadt in Gewalt und Größenwahn.' },
  { id: 58, title: '1917', release_date: '2019-12-25', vote_average: 8.0, runtime: 119, genres: [18, 10752, 28], overview: 'Zwei Soldaten müssen in einem Tag eine Nachricht über die Frontlinie bringen.' },
  { id: 59, title: 'Oppenheimer', release_date: '2023-07-19', vote_average: 8.1, runtime: 181, genres: [18, 36], overview: 'Der Physiker hinter der ersten Atombombe zwischen Genie, Politik und Gewissen.' },
  { id: 60, title: 'Top Gun - Maverick', release_date: '2022-05-24', vote_average: 8.2, runtime: 130, genres: [28, 18], overview: 'Ein alternder Testpilot bildet eine neue Generation für einen fast unmöglichen Einsatz aus.' },
];

/**
 * Fertige Fallback-Filme inklusive Bildpfade.
 * Eingefroren, damit die Liste zur Laufzeit nicht versehentlich mutiert wird.
 */
const FALLBACK_MOVIES = Object.freeze(
  MOVIES.map((movie) =>
    Object.freeze({
      ...movie,
      poster_path: `/img/poster/${movie.id}.svg`,
      backdrop_path: `/img/backdrop/${movie.id}.svg`,
    }),
  ),
);

const FALLBACK_MOVIE_BY_ID = new Map(FALLBACK_MOVIES.map((movie) => [movie.id, movie]));

module.exports = { FALLBACK_MOVIES, FALLBACK_MOVIE_BY_ID };
