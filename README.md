# Kurswahlen-Abgleich: Forms ↔ Schild

Ein reines HTML/JavaScript-Tool (keine Installation, kein Build-Schritt), das Kurswahlen aus einem
MS-Forms-Umfrage-Export (xlsx) mit den in Schild angelegten Kursen abgleicht und als Leistungsdaten
in die Schild-Datenbank überträgt – über die SVWS-Server-API (Schild3).

Typischer Anwendungsfall: Am Schuljahresende/-anfang füllen Schüler:innen eine Forms-Umfrage zu ihren
Kurswahlen (z.B. AG-Wahl im Ganztag) aus. Die Namen und Kursbezeichnungen in dieser Umfrage weichen oft
leicht von den Schild-Datensätzen ab ("Peter Scholl" vs. "Scholl, Peter", "Schach" vs. Kurs-Kürzel
"SCHACH-AG"). Dieses Tool matched beides automatisch so weit wie möglich, lässt den Rest manuell
korrigieren, merkt sich diese Korrekturen dauerhaft und legt am Ende die passenden Leistungsdaten-Einträge
in Schild an.

Das Projekt besteht aus zwei Seiten, die sich oben gegenseitig verlinken und sich denselben
Browser-Speicher (Verbindungsdaten außer Passwort, Splits, Filter) teilen:

- **`index.html`** – der oben beschriebene Forms-Kurswahlen-Abgleich (Wizard, Schritt für Schritt).
- **`wartung.html`** – eigenständige Werkzeuge zum Aufräumen der Schild-Kursdaten (Splitten, leere Kurse
  aufspüren, verwaiste Leistungsdaten finden), ohne dass dafür Importdaten geladen werden müssen. Siehe
  [Wartung (`wartung.html`)](#wartung-wartunghtml) weiter unten.

## Bedienung (Wizard, Schritt für Schritt)

Die Seite `index.html` einfach im Browser öffnen (Doppelklick reicht, ein lokaler Webserver ist nicht
nötig, funktioniert aber auch). Die Abschnitte bauen aufeinander auf und werden erst sichtbar, wenn der
vorherige Schritt erledigt ist.

1. **Verbindung**: Host (z.B. `nightly.svws-nrw.de`), Schema, Benutzername, Passwort, Schuljahr und
   Abschnitt eingeben und auf "Verbinden" klicken. Das Tool ermittelt daraus die Schuljahresabschnitts-ID
   und lädt den Schüler-Status-Katalog direkt aus Schild (nicht hart codiert – falls sich Statuswerte
   zwischen Schulen/Versionen unterscheiden, passt sich das Tool automatisch an). Vorbelegt werden die
   Status, deren Bezeichnung "Aktiv", "Extern" oder "Aufnahme" enthält; das lässt sich über die Checkboxen
   frei anpassen.
2. **Schild-Daten laden**: Lädt Schüler (gefiltert nach den gewählten Status), Kurse und Fächer des
   Abschnitts. Dabei wird auch geprüft, ob zuvor gespeicherte Kurs-Zuordnungen (Schritt 5) noch auf
   existierende Kurse zeigen – z.B. falls ein Kurs zwischenzeitlich in Schild gelöscht wurde. Nicht mehr
   auflösbare Zuordnungen werden automatisch entfernt (nicht der Kurs selbst, nur die lokale Zuordnung) und
   erscheinen danach in Schritt 5 wieder als "kein Treffer" zur Neuzuordnung, mit Hinweis auf die Anzahl.
3. **Forms-Datei laden**: xlsx-Datei auswählen. Es erscheint eine Vorschau der ersten Zeilen sowie eine
   Spaltenzuordnung: eine Spalte als "Name" markieren, beliebig viele Spalten als "Kurswahl-Spalten"
   (Checkboxen, mit automatischer Vorauswahl anhand einfacher Heuristiken). Jede nicht-leere Zelle einer
   gewählten Kurswahl-Spalte zählt als eine Kurswahl der jeweiligen Person.
3a. **Kurs-Rewrite**: Manche Forms-Antworten kombinieren mehrere Wahlen in einer Zelle (z.B.
   "Lernzeit + ELSA" – kommt in der Beispieldatei tatsächlich so vor). Über ein Trennzeichen (Vorschlag
   "+") lässt sich eine solche Zelle in mehrere einzelne Kurswahlen aufsplitten, die danach unabhängig
   voneinander in Schritt 5 gematcht und in Schritt 6 als getrennte Leistungsdaten-Einträge angelegt
   werden – aus "Lernzeit + ELSA" werden dann "Lernzeit" *und* "ELSA". Das Trennzeichen gilt für alle
   Kurswahl-Spalten gleichermaßen; Feld leeren, um nicht zu splitten (Standardzustand, muss aktiv über
   "Übernehmen" gesetzt werden). Der Split passiert *vor* dem Voranstellen des Spaltenkürzels aus 3b, d.h.
   aus Spalte 9 werden bei aktivem Split z.B. "S9 Lernzeit" und "S9 ELSA".
3b. **Spaltenkürzel für Kurswahl-Spalten**: Jede Kurswahl-Spalte bekommt ein Kürzel (Standard:
   `S<Spaltennummer>`, z.B. `S7`), das dem Kurstext beim Matching vorangestellt wird. Damit lässt sich
   z.B. "Rudern" aus Spalte 7 einem anderen Schild-Kurs zuordnen als "Rudern" aus Spalte 9 (unterschiedliche
   Kürzel), oder bewusst zusammenfassen (gleiches Kürzel für beide Spalten – z.B. wenn zwei Spalten
   tatsächlich denselben Kurs meinen). Ein leeres Kürzel-Feld lässt den Text unverändert wie bisher. Über
   "Kürzel übernehmen" werden die Kurswahl-Texte (und damit die Tabellen in Schritt 4/5) mit den neuen
   Kürzeln neu berechnet. Kürzel und Trennzeichen werden persistiert (localStorage + JSON-Export).
4. **Abgleich Schüler**: Pro erkanntem Forms-Namen wird automatisch der ähnlichste Schild-Schüler
   vorgeschlagen (mit Konfidenz-Prozentwert). Über "Automatisch matchen" werden alle Vorschläge mit hoher
   Sicherheit sofort fest übernommen; unsichere Fälle bleiben zur manuellen Kontrolle stehen. Die
   Eingabefelder sind Autocomplete-Felder (Datalist) über alle geladenen Schüler – einfach tippen und aus
   der Liste wählen. Über die Checkbox "Ignorieren" lässt sich eine Person bewusst von der Übertragung
   ausschließen (z.B. Karteileichen, Fake-Testeinträge).
   Der Button "Speichern" übernimmt alle aktuell sichtbaren (auch die nur vorausgefüllten, noch nicht per
   Klick bestätigten) Zuordnungen fest in die Matching-Tabelle – ohne das muss man sonst erst bis Schritt 6
   vorspulen, damit eine Zuordnung "zählt". Insbesondere Schritt 4a (Schüler ohne Forms-Abgabe) liest nur
   fest gespeicherte Zuordnungen, daher lohnt sich ein Klick auf "Speichern" hier, bevor man dort prüft.
   Über die Status-Checkboxen ("Gespeichert", "Hohe Konfidenz", "Niedrige Konfidenz", "Kein Treffer",
   "Ignoriert") lässt sich die Tabelle nach diesen Kategorien filtern; der Button "Nur unsichere anzeigen"
   blendet mit einem Klick alles bis auf "Niedrige Konfidenz" und "Kein Treffer" aus – praktisch, um sich
   bei vielen Zeilen gezielt auf die Fälle zu konzentrieren, die eine manuelle Prüfung brauchen.
   "Alle anzeigen" setzt den Filter zurück.
4a. **Schüler ohne Forms-Abgabe** (bei Bedarf, über "Prüfen / Aktualisieren"): Listet alle Schild-Schüler
   aus der in Schritt 2 geladenen Liste auf, denen aktuell keine (nicht-ignorierte) Forms-Zeile zugeordnet
   ist – Name, Schild-ID und Klasse. In der Kopfzeile der Tabelle lässt sich über ein Auswahlfeld auf eine
   einzelne Klasse eingrenzen; nach der ersten Auswahl per Maus lässt sich mit den Pfeiltasten hoch/runter
   klassenweise weiterblättern (Standardverhalten von `<select>`-Feldern in Browsern, kein Zusatzcode
   nötig). Nützlich z.B., um am Ende einer Umfrage klassenweise nachzuhaken, wer noch nicht abgestimmt
   hat. Alle drei Spaltenüberschriften (Name, Schild-ID, Klasse) sind klickbar und sortieren die Tabelle
   danach (nochmaliger Klick kehrt die Richtung um, ein ▲/▼ zeigt Spalte und Richtung an); die
   Klassen-Sortierung ist "natürlich" (5a, 5b, 9c, 10a – nicht alphabetisch 10a vor 5a).
5. **Abgleich Kurse**: Analog für die Menge der unterschiedlichen Kurswahl-Texte (nicht pro Person,
   sondern einmal pro eindeutigem Text – bei 500 Schüler:innen mit denselben 20 AGs muss man also nur
   20 Zuordnungen treffen, nicht 500). Auch hier lassen sich Werte wie "kein Angebot" oder "Lernzeit"
   bewusst ignorieren, falls sie keinem echten Schild-Kurs entsprechen. Dieselben Status-Filter und der
   "Nur unsichere anzeigen"-Button stehen auch hier zur Verfügung.
   Das Spalten-Kürzel aus Schritt 3b (z.B. "S9") bleibt zwar Teil des Textes, mit dem der Eintrag in der
   Tabelle identifiziert wird, fließt aber **nicht** in die Ähnlichkeitssuche nach einem passenden
   Schild-Kurs ein – gesucht wird nur mit dem eigentlichen Kurstext ohne Kürzel, da das Kürzel ja keine
   Bedeutung für die Kursbezeichnung hat und die Trefferqualität sonst unnötig verschlechtern würde.

   Findet sich für einen Forms-Kurstext kein passender Schild-Kurs (z.B. "Judo" wurde in der Umfrage
   gewählt, existiert aber noch nicht in Schild), legt der Button **"+ Kurs"** am Ende der jeweiligen
   Zeile über einen Dialog direkt einen neuen Kurs an und ordnet ihn der Zeile sofort zu. Abgefragt werden:
   - **Kürzel*** (Pflicht) – die eindeutige Kurs-Kennung in Schild, vorbelegt mit dem Forms-Kurstext ohne
     Spalten-Kürzel (frei editierbar, an die Namenskonvention der eigenen Schule anpassen).
   - **Zeugnisbezeichnung** (optional, aber empfohlen) – ebenfalls vorbelegt; hilft künftigen
     Matching-Durchläufen, da Schritt 5 sowohl gegen Kürzel als auch gegen Zeugnisbezeichnung sucht.
   - **Fach** (optional) – Dropdown aus den in Schritt 2 geladenen Fächern.
   - **Kursart (allgemein)*** (Pflicht, z.B. `AG`, `GK`, `ZK`) – Eingabefeld mit Autovervollständigung aus
     dem live von Schild geladenen Kursarten-Katalog; freie Texteingabe ist möglich, falls die gewünschte
     Kursart dort nicht auftaucht.
   - **Wochenstunden** (Default 2) und **Sichtbar in Schild** (Checkbox, Default an).
   - **Jahrgänge** – Checkboxen aus den in Schild vorhandenen Jahrgängen (`GET /jahrgaenge`); vorausgewählt
     sind, sofern in Schild vorhanden, 05–10 sowie EF, Q1, Q2 (`DEFAULT_JAHRGANG_KUERZEL` in `js/app.js`).
     Grund: über die App angelegte Kurse hatten anfangs gar keine Jahrgangszuordnung (`idJahrgaenge: []`),
     was sie sichtbar von regulär in Schild angelegten Kursen unterschied (z.B. in jahrgangsbezogenen
     Ansichten/Auswertungen). Die Auswahl lässt sich vor dem Anlegen frei anpassen.

   Fest auf eine leere Liste gesetzt bleibt `schienen` (laut SVWS-API zwar Pflichtfeld, aber als leeres
   Array zulässig; relevant nur für die Blockplanung in der Oberstufe). Die Felder `schueler` und
   `weitereLehrer` werden trotz gleicher Pflichtfeld-Kennzeichnung im Schema bewusst **nicht**
   mitgeschickt – der Server lehnt beide beim Anlegen ab ("Das Patchen des Attributes
   schueler/weitereLehrer wird nicht unterstützt."), diese Zuordnungen laufen offenbar über einen anderen
   API-Weg. Der neue Kurs ist also zunächst keiner Lehrkraft/keinen Schüler:innen direkt zugeordnet und
   muss dafür ggf. noch in Schild selbst nachbearbeitet werden; für den reinen Zweck dieses Tools
   (Leistungsdaten anlegen) reicht das bereits.
6. **Übertragung**: Default-Werte für neu anzulegende Leistungsdaten einstellen (Kursart-Fallback,
   Wochenstunden-Fallback, Zeugnis-Umfang, "Auf Zeugnis", Epochalunterricht). Über "Vorschau berechnen"
   prüft das Tool für jede gematchte Schüler×Kurs-Kombination gegen die tatsächlichen Lernabschnittsdaten,
   ob der Eintrag in Schild schon existiert. Nur die tatsächlich fehlenden Kombinationen werden zur
   Übertragung vorausgewählt; vorhandene werden nur informativ angezeigt (ausgegraut, abwählbar/nicht
   nötig) – dabei gilt ein Eintrag auch dann als vorhanden, wenn er inzwischen (per Split auf der
   [Wartungsseite](#wartung-wartunghtml)) in einen Split-Zielkurs verschoben wurde (Hinweis "bereits
   vorhanden (in Split-Zielkurs)"), damit eine erneute
   Übertragung so einer Person nicht versehentlich wieder einen Eintrag im alten, gesplitteten Quellkurs
   anlegt. Über "Übertragen starten" werden die fehlenden Leistungsdaten-Einträge in Batches angelegt, mit
   Protokoll pro Batch. Das Feld **"Nur ab Excel-Zeile"** (optional) grenzt "Vorschau berechnen" auf Forms-
   Zeilen ab der angegebenen Excel-Zeilennummer ein (Zeile 1 = Kopfzeile, Zeile 2 = erste Datenzeile) – z.B.
   praktisch, um bei einem späten Nachtrag gezielt nur die neu hinzugekommenen Zeilen zu betrachten, ohne
   die komplette (große) Kombinationsmenge erneut zu prüfen. Leer lassen überträgt wie bisher alle Zeilen.
7. **Speichern/Laden**: Der gesamte Zustand (Verbindungsdaten *ohne Passwort*, Statusfilter,
   Spaltenzuordnung, beide Matching-Tabellen, Übertragungs-Defaults, aber auch die auf der Wartungsseite
   konfigurierten Splits/Filter – der Zustand ist ja geteilt) wird automatisch im Browser (`localStorage`)
   gesichert und beim nächsten Öffnen der Seite wiederhergestellt. Zusätzlich kann der Zustand als
   JSON-Datei exportiert/importiert werden, z.B. um ihn an eine Kolleg:in weiterzugeben oder zu sichern.
   Über "Zustand zurücksetzen" (mit Sicherheitsabfrage) lässt sich der komplette gespeicherte Zustand
   löschen und ganz von vorne beginnen – z.B. nach einem Testlauf mit falschen Daten oder zu Beginn einer
   neuen Umfragerunde im nächsten Halbjahr. Denselben Bereich gibt es identisch als Schritt 4 auf der
   [Wartungsseite](#wartung-wartunghtml) – praktisch, um Export/Import/Reset dort zu erledigen, ohne
   zwischen den Seiten wechseln zu müssen.
8. **Kurse ohne Forms-Wahl** (sichtbar sobald Schritt 2 abgeschlossen ist): vergleicht für alle in
   Schritt 4 gematchten Schüler:innen ihre aktuellen Schild-Kurse mit ihren gematchten Forms-Kurswahlen
   aus Schritt 5 und findet Leistungsdaten-Einträge zu Kursen, die laut Forms nicht (mehr) gewählt wurden
   – z.B. Reste einer alten AG-Wahl. Setzt einen abgeschlossenen Forms-Abgleich voraus (Schritte 3–5);
   ohne das erscheint eine Fehlermeldung statt Ergebnissen. Bleibt bewusst hier im Wizard statt auf der
   [Wartungsseite](#wartung-wartunghtml), da die Prüfung zwingend die hier laufenden Forms-Daten braucht
   (siehe dort). **Berücksichtigt dabei auch die auf der Wartungsseite konfigurierten Splits**: Liegt ein
   aktueller Kurs auf einem Zielkurs eines Jahrgangs- oder Klassen-Splits (auch mehrstufig, z.B. erst
   Jahrgangs- dann Klassen-Split), gilt rückwirkend der ursprüngliche Quellkurs als gewählt – ein frisch
   gesplitteter Kurs wird also nicht fälschlich als "nicht gewählt" gemeldet, nur weil er selbst nie Teil
   einer Forms-Kurswahl war. Da reguläre Fachkurse (Mathematik, Deutsch, …) nichts mit der Forms-Umfrage
   zu tun haben und sonst immer als "nicht gewählt" auftauchen würden, **muss** der Vergleich zunächst auf
   mindestens ein Fach und eine Kursart eingegrenzt werden (Checkboxen, vorbelegt mit allen
   Fächern/Kursarten, die tatsächlich in geladenen Kursen vorkommen – nicht der komplette
   Schild-Fächerkatalog). Je eine **"alle"-Checkbox** über den beiden Gruppen wählt die gesamte Gruppe auf
   einmal an oder ab; die zuletzt getroffene Auswahl wird persistiert (localStorage + JSON-Export) und
   beim nächsten Öffnen wiederhergestellt. Der Button **"Kursbelegung aktualisieren"** lädt bei Bedarf nur
   die Kursliste neu (z.B. wenn parallel in Schild selbst oder auf der Wartungsseite etwas geändert
   wurde). Die Ergebnistabelle unterstützt:
   - **Sortierbare Spalten** (Schüler, Fach, Kursart, Kurs, Leistungsdaten-ID) – Klick auf die
     Spaltenüberschrift, wie bei "Schüler ohne Forms-Abgabe" in Schritt 4a.
   - **Ein Suchfeld**, das live über Schüler-, Fach-, Kursart- und Kurstext filtert.
   - **Löschen einzeln** (Button je Zeile) oder **über Checkboxen mehrere auf einmal** (alle standardmäßig
     ausgewählt).

## Wartung (`wartung.html`)

Eigenständige Seite für Werkzeuge, die nur auf dem aktuellen Schild-Kursdatenbestand arbeiten und keinen
Forms-Import brauchen – man muss sich beim reinen Aufräumen von Kursen also nicht durch den ganzen
Wahlabgleich-Workflow denken. Oben verlinkt sie zurück zu `index.html` und umgekehrt. Verbindungsdaten
(Host, Schema, Benutzername, Schuljahr, Abschnitt) werden mit dem Kurswahlen-Abgleich geteilt (derselbe
localStorage-Schlüssel) und auf beiden Seiten automatisch vorausgefüllt – nur das Passwort wird wie überall
in diesem Tool nie gespeichert und muss auf jeder Seite einzeln eingegeben werden (funktioniert
zuverlässig, wenn beide Seiten über denselben lokalen Webserver oder in Chrome direkt per `file://`
geöffnet werden; manche Browser wie Firefox trennen bei `file://`-URLs den localStorage pro Datei, dann
braucht jede Seite ihre eigene Verbindungseingabe).

Struktur wie der Wizard: **1. Verbindung** und **2. Schild-Daten laden** (Schüler/Kurse/Fächer/Klassen/
Kursarten/Jahrgänge, gefiltert nach demselben Status-Filter wie in Schritt 1 des Wizards), danach
**3. Wartung** mit sieben Bausteinen. Jeder Baustein ist ein natives `<details>`-Element (Klasse
`wartung-baustein` in `css/style.css`) – auf-/zuklappbar über einen Klick auf die Überschrift, standardmäßig
eingeklappt, damit die Seite nicht sofort mit dem gesamten Erklärtext aller sieben Bausteine erschlägt:

- **"Leistungsdaten mit leerem Kurs"** – findet Leistungsdaten-Einträge, die eine Kursart tragen (also
  ursprünglich einem Kurs zugeordnet waren), deren Kurs-Verknüpfung aber fehlt *oder* auf einen nicht mehr
  existierenden Kurs zeigt – letzteres z.B. bei doppelt angelegten Einträgen für dasselbe Fach, bei denen
  einer der beiden Kurse zwischenzeitlich in Schild gelöscht wurde (reiner Klassenunterricht *ohne*
  Kursart wird nicht gemeldet). Über "Prüfen" werden alle geladenen Schüler:innen durchsucht (bei größeren
  Schulen können das über 1000 sein – Fortschrittsbalken und Statustext zeigen laufend an, wie viele
  bereits geprüft wurden und wie viele Treffer es bisher gibt); Treffer erscheinen in einer Tabelle mit
  Auswahl-Checkboxen (alle vorausgewählt, inkl. Anzeige der betroffenen Kurs-ID), über "Ausgewählte
  löschen" (mit Sicherheitsabfrage) lassen sich die markierten Leistungsdaten-Einträge dauerhaft aus
  Schild entfernen. Weitere Kontrollen lassen sich über `js/check.js` ergänzen. An manchen Schulen trägt
  auch regulärer Klassenunterricht eine eigene Kursart (z.B. "PUK") und taucht dadurch hier mit auf, obwohl
  es kein echtes Problem ist – über eine ▾-Schaltfläche im Spaltenkopf "Kursart" (Checkbox-Popover, gleiches
  Prinzip wie bei "Leere Kurse suchen" weiter unten, aus den tatsächlich gefundenen Treffern befüllt und
  gespeichert in `state.checkLeererKursFilter`) lässt sich eine solche Kursart gezielt ausblenden; wirkt
  nur auf die Anzeige, nicht auf die Prüfung selbst (die zugrundeliegende Kursart eines Treffers ist ja
  erst deren Ergebnis, kann also nicht vorab eingegrenzt werden).

- **"Split in Jahrgangskurse"**: verschiebt Schüler:innen eines Jahrgangs aus einem gemeinsam angelegten
  Quellkurs (z.B. eine AG, die zunächst für alle Jahrgänge zusammen angelegt wurde) in einen
  jahrgangsspezifischen Zielkurs. Eine Tabelle mit frei hinzufügbaren Zeilen (Quellkurs, Jahrgang,
  Zielkurs) definiert die gewünschten Verschiebungen:
  - **Quellkurs**/**Zielkurs**: Autocomplete-Felder wie in Wizard-Schritt 4/5, akzeptieren bewusst nur
    *vorhandene* Kurse (zeigen zusätzlich die aktuelle Schülerzahl je Kurs in Klammern an, z.B.
    "AGGT-Robotik (23)") – kein "Freitext legt automatisch einen Kurs an" wie in einer früheren Version,
    das war zu intransparent.
  - **Zielkurs, der noch nicht existiert**: über den Button **"+ Kurs"** neben dem Zielkurs-Feld öffnet
    sich ein "Neuen Kurs anlegen"-Dialog, vorbelegt mit Vorschlägen aus dem Quellkurs (Kürzel-Vorschlag
    `<Quellkurs-Kürzel>-<Jahrgang>`, Fach, Kursart, Wochenstunden) und dem Jahrgang dieser Zeile als
    vorausgewähltem (aber änderbarem) Jahrgang – alle Werte bleiben im Dialog frei editierbar, nichts wird
    ungesehen übernommen. Nach dem Anlegen wird der neue Kurs automatisch als Zielkurs der Zeile
    eingetragen.
  - **"+ Jahrgang"**: fügt direkt unter der Zeile eine neue Zeile mit demselben Quellkurs ein, um einen
    Kurs bequem auf mehrere Jahrgänge/Zielkurse aufzuteilen, ohne den Quellkurs erneut auswählen zu müssen.
  - **"Split durchführen"**: verarbeitet alle vollständig ausgefüllten Zeilen nacheinander (mit
    Fortschrittsbalken). Pro Zeile werden alle Schüler:innen des Quellkurses ermittelt, die dem gewählten
    Jahrgang angehören; für jede Person wird geprüft, ob sie den Zielkurs schon hat (dann keine Dopplung)
    – in jedem Fall wird sie aber aus dem Quellkurs entfernt. Noten-/Zeugnisrelevante Felder (Note, "auf
    Zeugnis", Bemerkungstext, Epochal-Kennzeichen) werden beim Verschieben vom Quell-Leistungsdaten-Eintrag
    übernommen, Kursart/Wochenstunden/Kursleitung kommen vom Zielkurs. **Sicherheitsgarantie:** Schlägt
    das Anlegen im Zielkurs für eine Person fehl, wird ihr Quellkurs-Eintrag *nicht* gelöscht – so kann
    niemand eine Fachbelegung komplett verlieren, nur weil ein einzelner Schreibvorgang scheitert
    (isoliert getestet, siehe "Fehlerbehebungen" unten).
  - **"Automatischer Vorschlag"** (oberhalb der Tabelle, optional): erspart bei einem Kurs mit vielen
    Jahrgängen das manuelle Anlegen jeder einzelnen Zeile. Kurs wählen und **"Vorschlag erzeugen"**
    klicken – das Tool ermittelt anhand der aktuell im Kurs eingeschriebenen Schüler:innen, welche
    Jahrgänge vorkommen (mit Schülerzahl je Jahrgang), und schlägt je Jahrgang einen Zielkurs vor: Kürzel
    `<Quellkurs>-<Jahrgang>`, wobei ein bereits vorhandener gleichnamiger Kurs wiederverwendet wird, sonst
    bei "Übernehmen" neu angelegt. Bezeichnung/Fach/Kursart/Wochenstunden werden je Zeile vom Quellkurs
    vorbelegt, sind aber frei änderbar (relevant nur, wenn für die Zeile tatsächlich ein neuer Kurs
    angelegt wird). Über Checkboxen lässt sich auswählen, welche Zeilen übernommen werden sollen; das
    Zielkurs-Feld akzeptiert wie gewohnt sowohl einen vorhandenen Kurs (Autocomplete) als auch einen frei
    eingegebenen neuen Namen – geben zwei Zeilen denselben Namen ein, landen beide im selben, einmalig neu
    angelegten Kurs (dessen Jahrgangs-Zuordnung dann die Vereinigung der beteiligten Jahrgänge ist). Klick
    auf **"Ausgewählte übernehmen"** legt die dafür nötigen neuen Kurse an und hängt die ausgewählten
    Zeilen unten an die "Split in Jahrgangskurse"-Tabelle an – verschoben wird dabei noch niemand, das
    bleibt weiterhin Sache von "Split durchführen". Direkt danach lässt sich der nächste Kurs wählen und
    vorschlagen.

- **"Split in Klassenkurse"**: direkt darunter, strukturell identisch zu "Split in Jahrgangskurse", aber
  nach Klasse statt Jahrgang gruppiert (eigene Tabelle mit "+ Klasse" statt "+ Jahrgang", eigenes
  `state.splitKlasseRows`). Ein Unterschied: Kurse kennen in Schild keine direkte Klassen-Zuordnung
  (nur `idJahrgaenge`), daher wird beim Anlegen eines Zielkurses über "+ Kurs" als Jahrgangs-Vorschlag der
  Jahrgang der gewählten Klasse vorausgewählt (`klasse.idJahrgang`) – frei änderbar wie immer. Auch hier
  gibt es oberhalb der Tabelle denselben **"Automatischer Vorschlag"**-Bereich wie bei "Split in
  Jahrgangskurse" (Kurs wählen, "Vorschlag erzeugen", Zeilen prüfen/anpassen/auswählen, "Ausgewählte
  übernehmen"), nur nach Klasse statt Jahrgang gruppiert. Werden beim Neuanlegen mehrere Zeilen zu einem
  gemeinsamen (neuen) Zielkurs zusammengeführt, ist dessen Jahrgangs-Zuordnung die Vereinigung der
  `idJahrgang`-Werte aller beteiligten Klassen.

- **"Leere Kurse suchen"**: findet Kurse, denen laut zuletzt geladenem Datenstand (Schild-Daten laden bzw.
  "Kursbelegung aktualisieren") **kein einziger Schüler** zugeordnet ist – z.B. Kurse, die nach einem
  Split oder einer Bereinigung leer zurückgeblieben sind. Rein clientseitige Prüfung über die bereits
  geladenen Kursdaten, kein zusätzlicher API-Aufruf nötig; "Prüfen" läuft ohne Vorbedingung über alle
  Kurse mit 0 Schüler:innen. Die Ergebnistabelle unterstützt:
  - **Spaltenkopf-Filter** (Excel-artig): eine kleine ▾-Schaltfläche in den Spaltenköpfen "Fach" und
    "Kursart" öffnet ein Popover mit Checkboxen der in den *aktuell gefundenen Treffern* tatsächlich
    vorkommenden Werte – Auswahl wirkt sofort auf die Anzeige (kein erneutes "Prüfen" nötig) und wird
    gespeichert (`state.leereKurseFilter`, eigener, unabhängig von "Kurse ohne Forms-Wahl" im Wizard
    gespeicherter Filter).
  - **Sortierbare Spalten** und **ein Suchfeld**, das live über Kurs-, Fach- und Kursart-Text filtert.
  - **Löschen einzeln** oder **über Checkboxen mehrere auf einmal** – löscht anders als "Leistungsdaten
    mit leerem Kurs" (das nur Leistungsdaten-Einträge löscht) den **Kurs selbst** über
    `DELETE /kurse/delete/multiple`. Schild meldet den Erfolg pro Kurs einzeln zurück (z.B. falls ein Kurs
    trotz leerer Schülerliste aus anderen Gründen nicht löschbar ist), daher ist hier anders als beim
    Leistungsdaten-Löschen keine Bisection nötig. Nach erfolgreichem Löschen wird automatisch die
    Kursbelegung aktualisiert (`refreshKursBelegung()`), damit gelöschte Kurse überall (Datalists,
    Split-Tabellen) sofort verschwinden.
  - **Hinweis (Stand Juli 2026):** `DELETE /kurse/delete/multiple` ist auf dem SVWS-Server serverseitig
    auf den Server-Entwicklungsmodus beschränkt (`ServerMode.DEV` in `APIKurse.java`, während
    Anlegen/Ändern nur `ServerMode.STABLE` verlangen) und schlägt im normalen Stable-Betrieb mit einem
    Fehler fehl – "Ausgewählte löschen"/"Löschen" funktionieren also aktuell auf den meisten Servern
    nicht. Als Workaround gibt es den Button **"Ausgewählte mit Sortierung 0 versehen"**: er patcht bei
    den per Checkbox ausgewählten Kursen das Feld `sortierung` auf `0` (`PATCH /kurse/{id}`, läuft im
    normalen Server-Modus, dieselbe Checkbox-Auswahl wie bei "Ausgewählte löschen"). In Schild3 selbst
    erscheinen diese Kurse dann bei der Sortierung "Benutzerdefiniert" ganz oben und lassen sich dort
    markieren und per Rechtsklick-Kontextmenü löschen.

- **"Blockung mit Leistungsdaten abgleichen"** – vergleicht die Kurszuordnung einer Blockung der
  gymnasialen Oberstufe mit den tatsächlich eingetragenen Leistungsdaten der Schüler:innen einer Stufe im
  aktuellen Halbjahr, z.B. um manuell nachgetragene Umwahlen auf Vollständigkeit zu prüfen. **Stufe**
  wählen (Abiturjahrgang, nicht der normale Sek-I-Jahrgang – die Oberstufe organisiert sich über den
  voraussichtlichen Abiturjahrgang), danach **Blockung** (Planungsstand; die als aktiv markierte Blockung
  ist vorausgewählt, verwendet wird deren aktives Ergebnis). "Abgleichen" prüft je Schüler:in und
  Fach/Kursart, ob die Blockung einen Kurs vorsieht, der in den Leistungsdaten fehlt oder dort auf einen
  *anderen* Kurs derselben Fach-/Kursart-Kombination zeigt (z.B. "SP-GK3" laut Blockung, aber "SP-GK4" in
  den Leistungsdaten – ein Hinweis auf eine Umwahl in eine parallele Kursschiene, die in Schild noch
  nachgetragen werden müsste). Die Checkbox **"Auch Kursbezeichnung (Kursnummer) und Lehrer:in … vergleichen"**
  (Default: an) prüft zusätzlich den nach Fach+Kursart eindeutig bestimmten Kurs selbst – ohne sie fällt
  z.B. "Sp-GK1" laut Blockung, aber "Sp-GK2" in den Leistungsdaten nicht auf, weil pro Fach/Kursart in den
  Leistungsdaten einer Person meist ohnehin nur ein einziger Kurs in Frage kommt und dieser bislang
  ungeprüft als Treffer galt. Verglichen werden dabei die aus dem Kurs-Kürzel geratene Kursnummer (wie beim
  Auflösen mehrerer Parallelkurse) sowie – sofern ein Lehrer-Katalog geladen werden kann
  (`SvwsApi.getLehrer()`) – eine Überschneidung der Lehrer-Kürzel (Blockung: `GostBlockungKursLehrer.kuerzel`
  direkt aus den Blockungsdaten; echter Kurs: `KursDaten.lehrer`/`weitereLehrer[].idLehrer`, über den
  Lehrer-Katalog aufgelöst). Beide Signale werden nur gewertet, wenn sie auf beiden Seiten überhaupt
  bestimmbar sind (kein Kürzel-Suffix bzw. kein ladbarer Lehrer-Katalog zählt nicht als Abweichung, sonst
  gäbe es bei Fächern ohne Parallelkurs ständig falschen Alarm). Bei Grundkursen zusätzlich ein dritter
  Vergleich: Ist das Fach laut Laufbahnplanung das 3. oder 4. Abiturfach der/des Schülerin/Schülers, wird
  die dafür erwartete spezifische Kursart (AB3 bzw. AB4) gegen die tatsächlich in den Leistungsdaten
  eingetragene verglichen – deckt vertauschte AB3-/AB4-Kennzeichnungen auf, die weder über Kursnummer noch
  Lehrer auffallen (derselbe Kurs, dieselbe Lehrkraft, nur die Kennzeichnung als 3. vs. 4. Abiturfach ist
  vertauscht). Nötig, weil weder die Blockung noch der Kurs selbst diese Unterscheidung kennen (beides
  einfach "GK") – die Information kommt stattdessen separat aus den Laufbahndaten des Abiturjahrgangs
  (`SvwsApi.getGostAbiturjahrgangLaufbahndaten()`). Über die Checkbox **"Auch Kurse zeigen,
  die nur in den Leistungsdaten stehen …"** lässt sich optional auch die umgekehrte Richtung mit anzeigen
  (kann bei Kursen außerhalb der Blockung, z.B. Sport/Religion, mehr Rauschen erzeugen, deshalb
  standardmäßig aus).

  Jede Ergebniszeile vom Typ "fehlt in Leistungsdaten" oder "abweichender Kurs" hat, sofern sich der laut
  Blockung erwartete Kurs im Kurskatalog eindeutig bestimmen lässt, einen Button **"Übernehmen"**, der genau
  diese eine Zuordnung in die Leistungsdaten einträgt; per Checkboxen (Spaltenkopf-Checkbox wählt alle
  anwendbaren Zeilen) und **"Ausgewählte übernehmen"** geht das auch für mehrere/alle Zeilen in einem
  Rutsch. Ist bereits ein (falscher) Eintrag zu Fach/Kursart vorhanden, wird bei diesem nur die
  Kurszuordnung korrigiert (`PATCH`, der Eintrag selbst bleibt erhalten); sonst wird ein neuer Eintrag
  angelegt. Nicht anwendbar (kein Button, nur ein Hinweistext) sind "unsicher"-Zeilen, bei denen auch der
  komplette Kurskatalog keine eindeutige Kursnummer-Zuordnung liefert – die bleiben zur manuellen Prüfung
  stehen. Erfolgreich übernommene Zeilen verschwinden aus der Ergebnisliste; fehlgeschlagene bleiben mit
  entsprechendem Protokoll-Hinweis stehen.

- **"Abgleich Untis mit Leistungsdaten"** – vergleicht einen Untis-Export (Datei "GPU015.TXT", "Kurswahl
  der Studenten") mit den Leistungsdaten einer Jahrgangsstufe. Per Datei-Auswahl wird die Untis-Datei
  eingelesen; sie bleibt danach (als JSON) im `state` gespeichert, bis eine neue eingelesen wird – ein
  erneutes Hochladen ist also nicht bei jedem Abgleich nötig, auch nicht nach einem Neuladen der Seite.
  Checkboxen steuern, was verglichen wird: **"Kursbezeichnung abgleichen"** (Default an – vergleicht
  zusätzlich zum Fach auch die konkrete Kursbezeichnung), **"Kursart abgleichen"** (Default an – vergleicht
  die aus "Statistikkennzeichen" abgeleitete spezifische Kursart, s.u.) und **"Lehrer:in abgleichen"**
  (aktuell deaktiviert – die Kurswahl-Datei enthält dafür keine Information, das bräuchte zusätzlich die
  separate Untis-Datei GPU002.TXT, für eine spätere Erweiterung vorgesehen). Zwei erste **Rewrite-Regeln**
  (auf Nachfrage ergänzt, beide Default aus, nur wirksam wenn "Kursart abgleichen" aktiv ist): **"AB3/AB4
  laut Untis … als GKS werten"** und **"AB3/AB4 laut Schild-Leistungsdaten … als GKS werten"** – getrennt
  schaltbar, weil AB3/AB4 auf beiden Seiten unabhängig voneinander "falsch" gesetzt sein kann (Untis und
  Schild sind zwei getrennt gepflegte Datenquellen) - man kann also z.B. nur die Untis-Seite umdeuten,
  ohne die Schild-Seite anzufassen, oder umgekehrt. Weitere Rewrite-Regeln oder eine Liste nicht zu
  beachtender Elemente sind als spätere Erweiterung vorgesehen (dann eher als generische Liste statt
  weiterer Einzel-Checkboxen). Danach
  **Jahrgangsstufe** wählen (aus dem bereits geladenen Schild-Jahrgangskatalog, mit Schüler:innen-Anzahl je
  Stufe) und "Abgleichen" klicken – geprüft wird je Schüler:in dieser Stufe, ob die in Untis gewählten
  Fächer (und optional Kursbezeichnungen/Kursarten) in den Leistungsdaten wiederzufinden sind; auch ein
  leeres oder unbekanntes "Statistikkennzeichen" in der Untis-Datei selbst wird gemeldet, nicht
  stillschweigend übersprungen. Schüler:innen werden über die "Studentennummer" der Untis-Datei der
  Schild-internen Schüler-ID zugeordnet – Voraussetzung dafür ist, dass diese beim Untis-Export tatsächlich
  befüllt wird (z.B. weil Untis ursprünglich mit Schild-Daten importiert wurde); Schüler:innen der Stufe
  ohne zuordenbare Untis-Zeile werden nicht geprüft, sondern nur gezählt – ein (i)-Symbol hinter der
  Statuszeile zeigt beim Drüberfahren bis zu 10 ihrer Namen. Rein lesende Prüfung ohne Lösch-/Änderungsfunktion (anders als beim
  Blockung-Abgleich aktuell kein "Übernehmen").

- **"Pflichtunterricht im Klassenverband (PUK) prüfen"** – reiner Klassenunterricht ohne eigenen Kurs trägt
  an manchen Schulen die Kursart "PUK" direkt auf dem Leistungsdaten-Eintrag; andere Kursarten sind
  irgendwo als echter Kurs abgebildet und werden von den übrigen Bausteinen hier bereits erfasst. "Prüfen"
  geht alle Klassen durch und vergleicht je Fach und Klasse zwei Dinge: ob alle Schüler:innen dieser Klasse
  für dieses Fach dieselbe Lehrkraft eingetragen haben ("Unterschiedliche Lehrer:innen: …"), und ob
  wirklich alle Schüler:innen der Klasse dieses Fach überhaupt als PUK eingetragen haben (Pflichtunterricht
  betrifft die ganze Klasse – fehlt es bei einem Teil, steht neben dem Hinweis ein (i)-Symbol, das beim
  Drüberfahren bis zu 10 Namen der betroffenen Personen zeigt). Die Ergebnistabelle lässt sich im Spaltenkopf **Klasse** filtern
  (Checkbox-Popover, dasselbe Excel-artige Muster wie bei "Leere Kurse suchen"). Rein lesende Prüfung ohne
  Lösch-/Änderungsfunktion.

Danach **4. Speichern / Laden** – inhaltlich identisch zu Schritt 7 im Kurswahlen-Abgleich (derselbe
geteilte Zustand, derselbe Export/Import/Reset), nur als eigener Bereich hier auf der Wartungsseite, damit
man dafür nicht extra zu `index.html` wechseln muss. "Zustand zurücksetzen" betrifft dabei ausdrücklich
auch `index.html`, da beide sich denselben `localStorage` teilen – der Sicherheitsabfrage-Text weist
darauf hin.

## Wichtige Entscheidungen

- **Generischer Spalten-Picker statt Speziallogik**: Die Beispiel-Forms-Datei hat pro Wochentag mehrere
  Spalten (Kategorie-Frage, AG-Name, AG-Name-in-Kombination-mit-ELSA), weil Forms bedingte Verzweigungen
  exportiert. Statt das fest einzuprogrammieren, wählt man frei, welche Spalte den Namen enthält und
  welche Spalten Kurswahlen enthalten. Dadurch funktioniert das Tool auch für ganz andere künftige
  Forms-Umfragen, ohne Code ändern zu müssen.
- **Nur ergänzen, nie überschreiben/löschen**: Die Übertragung legt ausschließlich fehlende
  Leistungsdaten-Einträge neu an. Bereits in Schild vorhandene Einträge werden nie verändert oder
  gelöscht – das ist der sicherste Ansatz für einen (wiederholt ausführbaren) Abgleich-Lauf, ohne Gefahr
  für bestehende Daten.
- **Keine ES-Module, keine Build-Tools**: Alle Dateien sind klassische `<script>`-Includes mit globalen
  Namespace-Objekten (`window.SvwsApi`, `window.FormsImport`, `window.Matching`, `window.Storage`). Das
  funktioniert auch per Doppelklick auf `index.html` (`file://`-Protokoll), wo ES-Module oft an
  CORS-Beschränkungen scheitern.
- **SheetJS lokal vorhanden** (`js/vendor/xlsx.full.min.js`), nicht per CDN zur Laufzeit geladen – damit
  das Tool auch ohne Internetzugang bzw. hinter Schul-Firewalls zuverlässig läuft.
- **Zugangsdaten werden nirgends gespeichert**: Benutzername darf persistiert werden (reine Bequemlichkeit
  beim erneuten Öffnen), das Passwort existiert ausschließlich als lokale Variable in `svwsApi.js` für die
  Dauer der Sitzung. `storage.js` besitzt zusätzlich eine defensive `stripSecrets()`-Funktion, die vor
  jedem Speichern/Export jedes Feld entfernt, dessen Name wie "password"/"passwort" aussieht – auch falls
  so ein Feld versehentlich einmal in den Zustand geraten sollte.
- **Direkter Browser-Zugriff auf die SVWS-API, kein eigener Backend-Proxy**: Der SVWS-Server sendet
  `Access-Control-Allow-Origin: *` und erlaubt den `authorization`-Header per CORS, wodurch `fetch()`
  direkt aus dem Browser funktioniert. Bei selbstsigniertem Server-Zertifikat muss die Basis-URL
  (`https://<host>/db/<schema>`) einmal manuell im Browser geöffnet und die Zertifikatswarnung bestätigt
  werden – danach klappt auch `fetch()`.
- **Status-Katalog live von der API, nicht hart kodiert**: Welche Zahl "Aktiv"/"Extern"/"Neuaufnahme"
  bedeutet, wird über `GET /schule/schueler/status` abgefragt statt angenommen, da sich das zwischen
  SVWS-Versionen/Schulformen unterscheiden kann.
- **Matching-Algorithmus**: Kombination aus zeichenbasierter Ähnlichkeit (Levenshtein-Distanz, toleriert
  Tippfehler) und wortbasierter Ähnlichkeit (Token-Jaccard, toleriert vertauschte Reihenfolge wie
  "Nachname, Vorname" vs. "Vorname Nachname" sowie zusätzliche/fehlende Wörter). Bei Kursen wird zusätzlich
  sowohl gegen das Kürzel als auch gegen die Zeugnisbezeichnung verglichen und die bessere der beiden
  Übereinstimmungen gewertet, damit ein exaktes Kürzel-Match nicht durch eine lange, abweichende
  Zeugnisbezeichnung verwässert wird. Score ≥ 0.82 → automatische Übernahme, sonst manuelle Prüfung
  nötig (Konstante `Matching.DEFAULT_AUTO_THRESHOLD`).
- **Matching-Tabellen sind das Gedächtnis des Tools**: Einmal manuell gesetzte oder bestätigte Zuordnungen
  werden dauerhaft gespeichert (Schlüssel = normalisierter Forms-Text) und bei künftigen Durchläufen
  zuerst nachgeschlagen, bevor neu gematcht wird – Korrekturen müssen also nur einmal gemacht werden.

## Fehlerbehebungen während der Entwicklung

Zwei reale Bugs wurden beim ersten Testlauf gegen einen echten Server gefunden und behoben – hier
dokumentiert, weil die Ursachen nicht offensichtlich sind und für künftige Änderungen relevant bleiben:

1. **"Keine gematchten Schüler/Kurs-Kombinationen gefunden" trotz sichtbar korrekter Zuordnung in
   Schritt 4/5.**
   Ursache: In den Schritten 4 und 5 wird ein unsicherer Match-Vorschlag zwar direkt im Eingabefeld
   vorausgefüllt (inkl. Konfidenz-Prozentwert), aber *nicht* automatisch in die persistente
   Matching-Tabelle übernommen – das passiert bisher nur beim Klick auf "Automatisch matchen" (nur für
   Treffer ≥ 82 % Konfidenz) oder bei einer manuellen Änderung des Feldes (löst ein `change`-Event aus).
   Ein nur *angezeigter* Vorschlag, den niemand angefasst hat, landete also nie in der Tabelle, obwohl er
   optisch wie ein fertiger Treffer aussah. `collectMatchedPairs()` in Schritt 6 fand dadurch nichts.
   **Fix:** Neue Funktion `commitVisibleMatches()` in `js/app.js`, die vor der Vorschau-Berechnung
   (`onComputePreview`) einmal alle aktuell sichtbaren Feldwerte beider Match-Tabellen einliest und – sofern
   gültig und nicht ignoriert – in die persistenten Tabellen übernimmt. Damit kann "sieht gematcht aus" nie
   mehr von "ist tatsächlich gematcht" abweichen.

2. **Serverfehler (500) bei der Übertragung, aber nur für einen Teil der Batches (z.B. Batch 2, 3, 4, 6, 7,
   9, 12, 13, 15 von 15, mit leerem Response-Body).**
   Ursache: `POST .../leistungsdaten/create/multiple` scheint serverseitig transaktional zu sein – enthält
   ein 50er-Batch auch nur einen problematischen Datensatz, scheitert der komplette Batch, obwohl die
   übrigen 49 Einträge in Ordnung wären. Wahrscheinlichster Auslöser: Dieselbe (Schüler, Kurs)-Kombination
   kam doppelt im Batch vor, z.B. weil ein:e Schüler:in dieselbe AG über zwei verschiedene Forms-Spalten
   (zwei Wochentage) gewählt hatte, die beide auf denselben Schild-Kurs gematcht wurden.
   **Fix, alle in `js/app.js`:**
   - `collectMatchedPairs()` dedupliziert jetzt auf `Schüler-ID + Kurs-ID`; die Anzahl entfernter
     Dopplungen wird in Schritt 6 als Hinweis angezeigt.
   - `buildLeistungsdatenPayload()` sendet `fachID` jetzt explizit als `null` statt `undefined`, falls ein
     Kurs kein zugeordnetes Fach hat (`JSON.stringify` entfernt `undefined`-Felder sonst stillschweigend
     aus dem Payload – eine zweite denkbare Fehlerquelle für den Server).
   - Neue Funktion `createBatchWithBisection()`: Scheitert ein Batch trotzdem, wird er rekursiv halbiert
     und erneut versucht, bis entweder ein Teil-Batch durchgeht oder die einzelnen problematischen
     Datensätze isoliert sind. Das Übertragungsprotokoll listet danach genau auf, welche(r) einzelne(n)
     Schüler/Kurs-Kombination(en) tatsächlich nicht angelegt werden konnten, statt (wie zuvor) ganze
     50er-Batches inklusive der darin enthaltenen validen Einträge als Verlust auszuweisen.

3. **"Schild-Daten laden" (Schritt 2) schlägt komplett fehl, obwohl vorher alles funktioniert hat** –
   Fehlermeldung im Browser: CORS-Preflight für `.../klassen/minimal/abschnitt/{id}` schlägt mit
   Statuscode 500 fehl.
   Ursache: Für die neue Klassen-Spalte in Schritt 4a wurde `SvwsApi.getKlassen()` zusätzlich per
   `Promise.all()` zusammen mit Schüler/Kurse/Fächer geladen. Auf mindestens einer SVWS-Server-Instanz
   gibt genau dieser Endpunkt serverseitig einen 500 auf die CORS-Preflight-Anfrage zurück (ein Problem
   auf der Server-Seite, nicht am Request des Tools) – `Promise.all()` lässt dadurch den kompletten
   Schritt scheitern, obwohl Schüler/Kurse/Fächer einzeln betrachtet erfolgreich geladen worden wären.
   **Fix, zweistufig:**
   - `getKlassen()` wird in `onLoadSchildData()` in einem eigenen, isolierten `try/catch` aufgerufen statt
     im gemeinsamen `Promise.all()`. Schlägt es fehl, bleibt die Klassen-Info einfach leer (Klasse wird in
     Schritt 4a dann als "–" angezeigt) und es erscheint ein Warnhinweis – der Rest des Schrittes (Schüler,
     Kurse, Fächer) funktioniert unabhängig davon weiter.
   - Der Endpunkt selbst wurde wegen des serverseitigen Bugs von `/klassen/minimal/abschnitt/{id}` auf
     `/klassen/details/abschnitt/{id}` umgestellt (funktionierte auf dem betroffenen Server einwandfrei).
     Dieser liefert `KlassenDaten` statt `KlassenDatenMinimal` – deutlich umfangreicher, aber mit einem
     praktischen Nebeneffekt: Jede Klasse bringt ihr `schueler[]`-Array direkt mit (Schüler-ID, Name,
     Status). Damit lässt sich die Zuordnung Schüler→Klasse direkt aus den Klassendaten aufbauen
     (`schuelerIdToKlasse`, in `js/app.js`), ohne über das `idKlasse`-Feld der Schülerliste gehen zu
     müssen – eine Cross-Reference weniger.

4. **"Neuen Kurs anlegen" (Schritt 5) schlägt fehl** – Fehlermeldung: "Das Patchen des Attributes
   schueler/weitereLehrer wird nicht unterstützt."
   Ursache: Obwohl `schueler` und `weitereLehrer` laut OpenAPI-Schema von `KursDaten` Pflichtfelder sind,
   lehnt `POST /kurse/create` beide serverseitig ab, wenn sie im Request-Body enthalten sind –
   Schüler-/Lehrer-Zuordnungen zu einem Kurs laufen offenbar über einen separaten API-Weg, nicht über das
   direkte Setzen dieser Felder beim Anlegen.
   **Fix, zweistufig:**
   - `schueler` und `weitereLehrer` werden beim Aufbau des Kurs-Anlage-Payloads in
     `onCreateKursFormSubmit()` (`js/app.js`) nicht mehr mitgeschickt.
   - Generischer als der Einzelfall: `SvwsApi`s `request()`-Funktion (`js/svwsApi.js`) hat bislang bei
     Fehlerantworten (`!response.ok`) nur eine pauschale, statuscode-basierte Meldung geworfen und den
     Antwort-Body nie gelesen – die eigentliche, oft sehr konkrete Server-Rückmeldung (egal ob JSON oder
     Klartext) ging verloren. Neue Hilfsfunktion `buildErrorMessage(response, url)` liest den Body,
     versucht ihn als JSON zu parsen (`message`/`error`-Feld bzw. vollständiges Objekt) und fällt sonst auf
     den Rohtext zurück; das Ergebnis hängt sie an die bestehende Statuscode-Meldung an. Dadurch werden
     künftige Server-Fehler dieser Art direkt im Fehlertext sichtbar, ohne dass jeder Einzelfall im Code
     abgefangen werden muss.

5. **"Vorschau berechnen" (Schritt 6) zeigt nach einer Übertragung scheinbar keine Veränderung**, obwohl
   sich der Datenbestand in Schild inzwischen geändert hat (z.B. weil eine vorherige Übertragung
   tatsächlich erfolgreich war, siehe unten).
   Ursache: `lernabschnittsdatenCache` (Map schuelerId -> Lernabschnittsdaten-Promise) wurde als
   Modul-Variable nie geleert und blieb über mehrere Klicks auf "Vorschau berechnen" hinweg bestehen. Der
   Cache war ursprünglich nur dafür gedacht, innerhalb *eines* Vorschau-Laufs doppelte GET-Anfragen für
   Schüler:innen mit mehreren Kurswahlen zu vermeiden - blieb er aber über den Lauf hinaus erhalten, lieferte
   ein erneuter Klick auf "Vorschau berechnen" denselben (veralteten) Datenstand wie beim letzten Mal,
   unabhängig davon, was sich in der Zwischenzeit in Schild geändert hatte.
   **Fix:** `onComputePreview()` (`js/app.js`) leert `lernabschnittsdatenCache` jetzt zu Beginn jedes Laufs.

6. **"Leistungsdaten mit leerem Kurs" (damals Teil von Schritt 8 in `index.html`, heute ein eigener
   Baustein auf der [Wartungsseite](#wartung-wartunghtml)) fand bei mehreren fast identischen Einträgen
   eines Fachs systematisch einen weniger, als tatsächlich betroffen waren.**
   Ursache: Der erste Wurf des Checks filterte auf `kursID == null`. Ein konkreter, vom Nutzer gelieferter
   Datensatz zeigte aber, dass **alle** Leistungsdaten-Einträge eine `kursID` trugen – auch der als "leer"
   wahrgenommene. Der Fall war: dasselbe Fach zweimal vergeben, mit zwei unterschiedlichen `kursID`-Werten
   (Duplikat), von denen einer auf einen zwischenzeitlich in Schild gelöschten Kurs zeigte. Ein gesetztes,
   aber nicht mehr auflösbares `kursID` erscheint in Schild ebenfalls als leeres Kurs-Feld, wurde vom
   ursprünglichen `kursID == null`-Filter aber gar nicht erst erfasst – die alte Logik hätte bei diesem
   Datensatz **null** Treffer gefunden, nicht "einen zu wenig".
   **Fix:** `findeLeistungsdatenMitLeeremKurs()` (`js/check.js`) bekommt zusätzlich `gueltigeKursIds` (ein
   `Set` der aktuell in Schild existierenden Kurs-IDs, aus `kursById` in `js/wartung.js`) übergeben und
   meldet jetzt beide Fälle: `kursID == null` **oder** `kursID` gesetzt, aber nicht in `gueltigeKursIds`
   enthalten. Die Ergebnistabelle zeigt zusätzlich eine Kurs-ID-Spalte, damit der Unterschied zwischen
   "leer" und "verweist auf gelöschten Kurs" sichtbar ist.

7. **Erneute Übertragung (Schritt 6) legte Personen, die zuvor per Split (damals Teil von Schritt 8, heute
   auf der Wartungsseite) in einen Jahrgangs-/Klassenkurs verschoben worden waren, wieder im alten,
   gesplitteten Quellkurs an.**
   Ursache: "Vorschau berechnen" prüfte die Existenz eines Leistungsdaten-Eintrags nur gegen genau den in
   Schritt 5 gematchten Kurs. Nach einem Split hat die betroffene Person dort aber gar keinen Eintrag mehr
   (der Split hat ihn ins Zielkurs verschoben) – die Vorschau erkannte das fälschlich als "fehlt" und legte
   bei "Übertragen starten" einen zweiten, veralteten Eintrag im Quellkurs an. Betraf typischerweise
   Nachträge: neue Forms-Antworten, deren Kurswahl auf einen inzwischen gesplitteten Kurs gematcht war.
   **Fix:** `onComputePreview()` (`js/app.js`) prüft jetzt zusätzlich, ob einer der *vorhandenen*
   Leistungsdaten-Einträge einer Person über `resolveUrsprungsKurs()` (dieselbe Rückwärts-Verfolgung durch
   ggf. mehrere Split-Schritte, die schon "Kurse ohne Forms-Wahl" nutzt) auf den gematchten Kurs
   zurückführt - dann gilt die Kombination ebenfalls als "bereits vorhanden" (Hinweis "bereits vorhanden
   (in Split-Zielkurs)" in der Vorschau-Tabelle) statt erneut angelegt zu werden.

8. **"Blockung mit Leistungsdaten abgleichen" fand keine aktive Blockung bzw. zeigte für einen
   Abiturjahrgang nur eine veraltete Blockung an.**
   Ursache: Das Feld `halbjahr` aus `GostJahrgang` (`GET /gost/abiturjahrgaenge/{idAbschnitt}`) wurde
   fälschlich direkt als der von `GET /gost/abiturjahrgang/{abiturjahr}/{halbjahr}/blockungen` erwartete
   GostHalbjahr-Enum-Index (0=EF.1…5=Q2.2) verwendet. Tatsächlich ist es aber nur "1" oder "2" - welche
   Hälfte des Schuljahres der angefragte Abschnitt ist (dieselbe Zählung wie beim Verbindungsfeld
   "Abschnitt"). Für einen Q2-Jahrgang im 2. Schuljahres-Halbjahr wurde dadurch Index 2 (= Q1.1)
   abgefragt statt des richtigen Index 5 (= Q2.2) - eine längst überholte, nicht mehr aktive Blockung.
   **Fix:** Neue Funktion `gostHalbjahrIndex(jahrgangLabel, schuljahresHalbjahr)` (`js/wartung.js`)
   rechnet Jahrgangs-Label (EF/Q1/Q2) und Schuljahres-Halbjahr (1/2) korrekt in den echten Enum-Index um.

9. **"Blockung mit Leistungsdaten abgleichen" fand nach Fehlerbehebung 8 (falsches Gost-Halbjahr) zwar die
   richtige, aktive Blockung, meldete aber *jeden einzelnen* Blockungs-Kurs als "fehlt in
   Leistungsdaten" – auch für Schüler:innen, deren Leistungsdaten den Kurs nachweislich enthielten.**
   Ursache: Der erste Wurf verglich über einen zusammengesetzten Schlüssel `fachID|kursart`, gebildet aus
   den Feldern `fachID`/`kursart` *direkt auf dem Leistungsdaten-Datensatz*. Bei den über die
   SVWS-eigene Blockungs-Funktion "hochschreiben" erzeugten Leistungsdaten-Einträgen scheinen diese Felder
   nicht zuverlässig befüllt zu sein (vermutlich wird die Kursart dort nur über den verknüpften Kurs
   aufgelöst, nicht redundant auf den Leistungsdaten-Datensatz geschrieben) - der Schlüssel passte dadurch
   nie, unabhängig vom tatsächlichen Inhalt.
   **Fix:** `onRunBlockungAbgleich()` (`js/wartung.js`) vergleicht jetzt primär direkt über die
   **Kurs-ID** (`meineKursIds`-Set aus `leistungsdaten[].kursID`, unabhängig von `fachID`/`kursart` auf dem
   Datensatz) - ein exakter Treffer gilt sofort als vorhanden. Nur wenn kein exakter Kurstreffer existiert,
   wird zusätzlich nach einem Kurs mit gleichem Fach/gleicher Kursart gesucht, um "abweichender Kurs" (z.B.
   "SP-GK3" laut Blockung, aber "SP-GK4" in den Leistungsdaten) zu erkennen - Fach/Kursart kommen dafür aus
   dem bereits geladenen Kurskatalog (`kursById.idFach`/`kursById.kursartAllg`), nicht mehr aus den
   Leistungsdaten-Feldern selbst.

10. **"Blockung mit Leistungsdaten abgleichen" meldete denselben tatsächlichen Kurs teils doppelt** – einmal
    als "abweichender Kurs" (Ersatz für eine fehlende Blockungszeile) und bei aktivierter Checkbox "beide
    Richtungen" zusätzlich als "zusätzlich in Leistungsdaten", obwohl es sich erkennbar um ein und denselben
    Kurs für dasselbe Fach handelte.
    Ursache: Die Fehlerbehebung 9 oben führte die Fach-/Kursart-basierte Ersatzkurs-Suche ein, ohne sich zu
    merken, welche tatsächlich vorhandenen Kurse dabei bereits "verbraucht" wurden - die "beide
    Richtungen"-Prüfung sah den als Ersatz gefundenen Kurs deshalb weiterhin als "nicht in der Blockung
    vorhanden" an.
    **Fix:** `onRunBlockungAbgleich()` (`js/wartung.js`) merkt sich als Ersatz verwendete Kurs-IDs jetzt in
    `alsErsatzVerwendeteKursIds` und schließt sie von der "beide Richtungen"-Prüfung aus.

11. **"Blockung mit Leistungsdaten abgleichen" zeigte bei "Kurs laut Blockung" gelegentlich einen falschen,
    aber real existierenden Kurs an** (Kürzel/Bezeichnung eines völlig anderen Faches) - **und meldete nach
    dem Beheben so gut wie jeden zugewiesenen Kurs als Abweichung**, selbst wenn er in den Leistungsdaten
    korrekt eingetragen war.
    Ursache, im SVWS-Server-Quellcode nachvollzogen: Kurse innerhalb einer Blockung
    (`DTOGostBlockungKurs`, Tabelle `Gost_Blockung_Kurse`) haben eine **eigene, unabhängig generierte
    ID** ("ID des Kurses in der Blockung") - ohne gespeicherten Fremdschlüssel zur normalen `Kurse`-Tabelle,
    die die Leistungsdaten referenzieren. Ein Abgleich über die Kurs-ID ist dadurch strukturell unmöglich;
    `kursById.get(blockungsKursId)` (wie in Fehlerbehebung 9 genutzt) kann bestenfalls zufällig danebenliegen
    - im beobachteten Fall lieferte ID 2247 einen völlig unbeteiligten, aber real existierenden Kurs eines
    anderen Faches zurück, weil beide Tabellen unabhängig voneinander bei 1 hochzählende IDs vergeben.
    **Fix, zweistufig (`js/wartung.js`, `js/svwsApi.js`):**
    - Neue Funktion `SvwsApi.getGostBlockungsdaten(blockungsId)` (`GET /gost/blockungen/{blockungsId}`)
      liefert `kurse[]` mit Kursnummer (`nummer`) und Suffix je Blockungs-Kurs. `blockungsKursLabel()`
      zeigt daraus "Kurs-Nr. X" an - die Blockungs-Kurs-ID wird nirgends mehr gegen `kursById` aufgelöst.
    - Der Vergleich läuft jetzt ausschließlich über Fach+Kursart; bei mehreren passenden Kursen (parallele
      Kurse, z.B. zwei GK-Kurse desselben Fachs) versucht `parseKursnummerAusKuerzel()`, aus dem
      *tatsächlichen* Kurs-Kürzel die Kursnummer zu erraten (endende Ziffern, z.B. "SP-GK3" → 3) und mit
      der Blockungs-Kursnummer abzugleichen - ausdrücklich eine Heuristik (funktioniert nur, wenn Kürzel
      auf die Kursnummer enden), keine zuverlässige Zuordnung. Nur bei genau einem passenden Kurs
      (eindeutig) oder eindeutigem Kursnummer-Treffer gilt die Zeile als unauffällig und wird *nicht*
      gemeldet; bleiben mehrere Kandidaten ohne eindeutigen Kursnummer-Treffer übrig, wird die Zeile mit
      dem Hinweis "unsicher" gemeldet (bester Rateversuch als Anzeige, aber erkennbar unsicher).

12. **"Blockung mit Leistungsdaten abgleichen" meldete für einzelne Schüler:innen (angezeigt nur als
    "Schüler-ID X" statt Name) praktisch jedes Fach als "fehlt in Leistungsdaten".**
    Ursache: Eine Blockung ist ein eingefrorener Snapshot und enthält auch längst ausgeschiedene/
    abgemeldete Schüler:innen, die im aktuell geladenen Status-Filter (Schritt 1, standardmäßig nur
    "Aktiv"/"Extern"/"Aufnahme") nicht mehr auftauchen (`schuelerById.get()` liefert dann `undefined`,
    daher die reine ID statt eines Namens in der Anzeige). Für solche Personen gibt es naturgemäß keine
    aktuellen Leistungsdaten mehr zu vergleichen - das ist kein Fehler, sondern erwartbar.
    **Fix:** `onRunBlockungAbgleich()` (`js/wartung.js`) überspringt Schüler:innen, die nicht in
    `schuelerById` gefunden werden, jetzt komplett (kein Leistungsdaten-Abgleich, keine Meldungen für sie)
    und zählt sie im Abschluss-Status als "nicht im aktuell geladenen Status-Filter enthalten".

13. **"Übernehmen" (siehe oben) meldete bei einem realen "SP-GK4 fehlt"-Fall "14 passende Kurse im
    Kurskatalog, keine eindeutige Kursnummer-Zuordnung möglich"** - für eine einzelne Jahrgangsstufe
    (Q1) unplausibel viele Sport-GK-Kurse.
    Ursache: `resolveZielkurs()` durchsuchte den *kompletten* `kursById`-Katalog des aktuellen
    Schuljahresabschnitts nach Fach+Kursart, ohne nach Jahrgang einzuschränken - Sport-GK-Kurse existieren
    aber in EF, Q1 *und* Q2 gleichzeitig (plus ggf. mehrere Parallelgruppen je Jahrgang), sodass dort
    leicht ein Dutzend+ Kandidaten zusammenkommen, obwohl in der Stufe selbst nur eine Handvoll infrage
    kommt.
    **Fix:** `resolveZielkurs()`/`buildApplyInfo()` bekommen jetzt zusätzlich `jahrgangIds` übergeben -
    die echte Schild-Jahrgangs-ID der/des Schülerin/Schülers (`schueler.idJahrgang`, aus der bereits
    geladenen Schülerliste, nicht aus der Gost-Stufenauswahl selbst hergeleitet). Die Kandidatenliste wird
    zuerst darauf eingeschränkt (`KursDaten.idJahrgaenge.includes(...)`), nur wenn das *alle* Kandidaten
    wegfiltern würde (z.B. `idJahrgaenge` auf einem Kurs nicht gepflegt), wird ungefiltert weitergesucht.

14. **"Übernehmen" bei "abweichender Kurs" schlug mit HTTP 409 (Conflict) fehl** - im Netzwerk-Log leerer
    Response-Body, daher ohne eigene Server-Fehlermeldung erkennbar; in der Swagger-UI ist bei
    `POST .../create/multiple` kein 409 dokumentiert (nur 201/403/404/500).
    Ursache *vermutet* (zu diesem Zeitpunkt ohne Quellcode-Einsicht, nur aus dem HTTP-Statuscode
    geschlossen): Die erste Fassung legte den neuen Leistungsdaten-Eintrag zuerst an (`POST
    .../leistungsdaten/create/multiple`) und löschte danach den alten. Vermutung: Der Server lässt pro
    Fach/Lernabschnitt nur einen Eintrag zu (DB-Unique-Constraint), das Anlegen schlägt fehl, solange der
    alte noch existiert. **Diese Vermutung erwies sich als unvollständig** (siehe Fehlerbehebung 15 - der
    echte Fehler lag am Payload-Inhalt, nicht an der Reihenfolge) - nachträglich per Quellcode korrigiert.
    **Fix (Zwischenstand):** Für "abweichender Kurs" wird seitdem statt "anlegen + löschen" die neue
    Funktion `SvwsApi.patchLeistungsdaten(id, patch)` (`PATCH /schueler/leistungsdaten/{id}`) genutzt -
    ändert den *bestehenden* Eintrag per Merge-Patch, statt einen neuen anzulegen. Architektonisch sinnvoll
    unabhängig von der (unvollständigen) Ursachenvermutung, hat den eigentlichen Fehler aber noch nicht
    behoben - siehe Fehlerbehebung 15.

15. **PATCH aus Fehlerbehebung 14 schlug beim erneuten Testen weiterhin mit HTTP 409 fehl**, obwohl dabei
    gar kein zweiter Eintrag angelegt wird - das widerlegte die dortige Unique-Constraint-Vermutung.
    Auf Nachfrage, wie die Diagnose zustande kam: dieses Mal **im SVWS-Server-Quellcode nachvollzogen**
    (öffentliches Repository, `git clone --sparse` ohne Login, `DataSchuelerLeistungsdaten.java`) statt nur
    vermutet. Zwei echte Fehler im Patch-/Create-Payload gefunden:
    - Das mitgeschickte Feld `kursart` (z.B. `"GK"`, aus `KursDaten.kursartAllg` - der *allgemeinen*
      Kursart) wird serverseitig (`mapAttribute()`, Fall `"kursart"`) gegen den Katalog *spezifischer*
      Kursart-Kürzel geprüft (`ZulaessigeKursart`, z.B. `GKM`/`GKS`/`AB3`/`AB4`/`LK1`/`LK2`) - `"GK"` ist
      dort kein gültiger Wert, `getWertByKuerzel()` liefert `null` → `throw new
      ApiOperationException(Status.CONFLICT)`. Das erklärt vermutlich auch den *ursprünglichen* 409 aus
      Fehlerbehebung 14, dessen Payload denselben `kursart`-Wert enthielt - die Unique-Constraint-These dort
      war also wahrscheinlich unnötig, der eigentliche Fehler lag vermutlich von Anfang an hier.
    - Ein zusätzlich mitgeschicktes Feld `fachID` setzt im selben Fall (`mapAttribute()`, Fall `"fachID"`)
      serverseitig `Kurs_ID` bedingungslos auf `null` zurück - hätte die kurz zuvor im selben Patch gesetzte
      `kursID` also wieder zunichtegemacht, selbst wenn sich das Fach gar nicht ändert.
    Wichtige Erkenntnis dabei: Ein reines Patchen von `kursID` (`mapKursID()`) leitet die passende
    *spezifische* Kursart automatisch her (inkl. Sonderfällen wie GK → GKM/AB3/AB4 je nach Abiturfach, das
    der Client gar nicht kennt) und übernimmt den Fachlehrer direkt vom Kurs - beides muss der Client also
    gar nicht selbst mitschicken.
    **Fix:** `buildKurswechselPatch()` und `buildNeueLeistungsdatenPayload()` (`js/wartung.js`) schicken
    jetzt nur noch `kursID` (+ `wochenstunden`, bei Neuanlage zusätzlich das dort ohnehin pflichtige
    `fachID`) - kein `kursart`, kein `lehrerID` mehr.

16. **"Blockung mit Leistungsdaten abgleichen" erkannte vertauschte AB3-/AB4-Kennzeichnungen nicht** - eine
    Person, die laut Laufbahnplanung z.B. Fach A als 3. und Fach B als 4. Abiturfach hat, aber in Schild
    genau andersherum eingetragen war (Fach A = AB4, Fach B = AB3), wurde nicht gemeldet.
    Ursache: Der Detail-Vergleich prüfte bis dahin nur Kursnummer und Lehrer - beide bleiben bei einer
    AB3-/AB4-Verwechslung unverändert (derselbe Kurs, dieselbe Lehrkraft, nur die Kennzeichnung als 3. vs.
    4. Abiturfach ist falsch). Die spezifische Kursart (`AB3`/`AB4`, im Unterschied zur allgemeinen `GK`)
    steht außerdem nur auf dem Leistungsdaten-Eintrag selbst (`SchuelerLeistungsdaten.kursart`) - weder die
    Blockung noch der Kurs (`KursDaten.kursartAllg`) kennen diese Unterscheidung, der Vergleich las dieses
    Feld bislang also gar nicht.
    **Fix:** Neue Funktion `SvwsApi.getGostAbiturjahrgangLaufbahndaten(abiturjahr)` lädt (bei aktiviertem
    Detail-Vergleich, einmalig für den ganzen Abgleich) die Abiturdaten aller Schüler:innen der Stufe -
    einzige verlässliche Quelle dafür, welches Fach bei einer Person das 3./4. Abiturfach ist
    (`AbiturFachbelegung.abiturFach`). Bei Grundkursen wird daraus die erwartete Kursart (AB3/AB4)
    bestimmt und gegen `SchuelerLeistungsdaten.kursart` des gewählten Kandidaten verglichen - nur, wenn die
    Person das Fach dort tatsächlich als 3./4. Abiturfach führt (sonst keine Aussage möglich, kein falscher
    Alarm).

## Programmstruktur

```text
SchildKurswahlen/
  index.html                  UI-Grundgerüst des Wizards (8 Abschnitte)
  wartung.html                 UI-Grundgerüst der Wartungsseite (Verbindung, Schild-Daten laden, Wartung)
  css/style.css                Styling (hell/dunkel automatisch je nach Systemeinstellung), von beiden Seiten genutzt
  js/vendor/xlsx.full.min.js   Vendorte SheetJS-Bibliothek (xlsx-Parsing, nur index.html)
  js/svwsApi.js                SVWS-REST-Client, von beiden Seiten genutzt
  js/sharedCode.js              Zustandslose Utility-Funktionen, von beiden Seiten genutzt (s.u.)
  js/formsImport.js            xlsx-Einlesen, Spalten-Heuristik, Kurswahl-Extraktion (nur index.html)
  js/matching.js                Fuzzy-Matching + Verwaltung der persistenten Matching-Tabellen (nur index.html)
  js/storage.js                localStorage-Autosave + JSON-Export/Import (ohne Zugangsdaten), von beiden Seiten genutzt
  js/check.js                  Wartungs-Kontrollen, reine Analyse-Funktionen (nur wartung.html)
  js/app.js                    Orchestrierung für index.html: verdrahtet UI-Events mit den obigen Modulen
  js/wartung.js                 Orchestrierung für wartung.html: eigenständig, teilt sich state/localStorage mit js/app.js
  testdaten/                  Beispiel-Forms-Export zum Testen
```

### `js/sharedCode.js`

Enthält die Funktionen, die `js/app.js` und `js/wartung.js` früher jeweils als identisches Copy-Paste
selbst mitführten - ausgelagert, nachdem sich zeigte, dass es sich lohnt (September 2026). Bewusst
**nur** Funktionen, die ausschließlich von ihren Parametern abhängen (keine geschlossene Referenz auf
Datei-lokalen Zustand wie `state`, `schildKurse`, `kursById`): `$(id)`, `reveal(id)`, `escapeHtml(str)`,
`idFromLabel(label)`, `kursLabel(k)`, `schuelerLabel(s, schuelerIdToKlasse)` (Klassen-Map als Parameter
statt Closure, da beide Seiten ihre eigene unabhängig geladene Map pflegen - `app.js`/`wartung.js` legen
sich dafür einen kleinen 1-Parameter-Wrapper an, damit bestehende Aufrufe `schuelerLabel(s)`
unverändert bleiben), `mapWithConcurrency()`, `batchWithBisection()`, `DEFAULT_JAHRGANG_KUERZEL`,
`networkErrorHintHtml()`/`setStatus()` (Netzwerkfehler-Hinweis, siehe Fehlerbehebung weiter unten),
`infoPopoverHtml(items, summaryTitle)` ((i)-Symbol für Detail-Listen wie betroffene Namen - Overlay per
reinem CSS-Hover/Tastaturfokus (`position: absolute`, siehe `.info-popover` in css/style.css), verschiebt
beim Einblenden also nichts - Ersatz für einen ersten Anlauf mit `<details>`, der den Inhalt in den
normalen Textfluss einfügte und dadurch z.B. Tabellenzeilen auseinanderschob, und für den nackten
`title`-Attribut-Tooltip davor (kein eigenes Styling, keine Liste möglich); kürzt selbst auf die ersten 10
Einträge plus "… und N weitere", liefert `""` bei leerer Liste; genutzt vom Untis- und vom PUK-Abgleich in
`wartung.js`). Als
`window.SharedCode` exportiert; `app.js`/`wartung.js` holen sich die benötigten Funktionen einmal am
Dateianfang per Destructuring (`const { $, reveal, ... } = SharedCode;`), der Rest der Datei ruft sie
unverändert wie zuvor auf.

**Bewusst weiterhin dupliziert** (nicht hier ausgelagert), weil diese Funktionen Datei-lokalen
Laufzeit-Zustand per Closure brauchen (`state`, `schildFaecher`, `schildKursarten`, `schildJahrgaenge`,
`createKursOnCreated`, …) - eine Auslagerung würde entweder viele Parameter durchreichen oder eine
größere Umbau-Aktion (gemeinsam verwalteter Zustand) erfordern, für die aktuelle Projektgröße nicht im
Verhältnis zum Nutzen: Verbindungsaufbau (`onConnect()`, `populateConnectionFields()`,
`renderStatusKatalog()`), "Neuen Kurs anlegen"-Dialog, Speichern/Laden (`onExportJson()` etc.),
`onLoadSchildData()`/`refreshKursBelegung()` (unterscheiden sich zudem inhaltlich zwischen den Seiten -
`wartung.js` aktualisiert z.B. zusätzlich die Split-Tabellen).

### `js/svwsApi.js`

Zustandsloser REST-Client (bis auf `baseUrl`/Auth-Header im Modul-Scope). Wichtigste Funktionen:

| Funktion | Endpunkt | Zweck |
| --- | --- | --- |
| `configure({host, schema, username, password})` | – | Baut Basic-Auth-Header, merkt sich Basis-URL |
| `isNetworkError(err)` | – | true, wenn `err` aus einem generischen `fetch()`-Fehlschlag stammt (Server nicht erreichbar/blockiert) - für die UI, um optional einen Hinweis mit möglichen Ursachen anzuzeigen (siehe `networkErrorHintHtml()` in `js/sharedCode.js`) |
| `setDebugLogging(enabled)` | – | Schaltet das Request-Logging in `request()` ein/aus (`console.debug`/`console.error`, standardmäßig aus) - Diagnosehilfe, siehe PLANUNG.md |
| `getStammdaten()` / `getAbschnittId(jahr, abschnitt)` | `GET /schule/stammdaten` | Ermittelt die Abschnitts-ID |
| `getStatusKatalog()` | `GET /schule/schueler/status` | Katalog der Schüler-Status |
| `getSchuelerListe(abschnittId)` | `GET /schueler/abschnitt/{id}` | Schülerliste des Abschnitts |
| `getKurse(abschnittId)` | `GET /kurse/abschnitt/{id}` | Kursliste des Abschnitts |
| `getKlassen(abschnittId)` | `GET /klassen/details/abschnitt/{id}` | Klassenliste inkl. `schueler[]` je Klasse (für Klassen-Kürzel je Schüler) |
| `getFaecher()` | `GET /faecher` | Fächerliste |
| `getKursarten()` | `GET /kurse/allgemein/kursarten` | Katalog gültiger Kursarten (für "Neuen Kurs anlegen"-Dialog) |
| `getJahrgaenge()` | `GET /jahrgaenge` | Katalog aller Jahrgänge (für Jahrgangs-Vorbelegung im "Neuen Kurs anlegen"-Dialog) |
| `createKurs(kursDaten)` | `POST /kurse/create` | Legt einen neuen Kurs an, gibt ihn inkl. neuer ID zurück |
| `getLernabschnittsdaten(schuelerId, abschnittId)` | `GET /schueler/{id}/abschnitt/{id}/lernabschnittsdaten` | Liefert `lernabschnittID` + vorhandene `leistungsdaten[]` (für Duplikat-Check) |
| `createLeistungsdatenMultiple(list)` | `POST /schueler/leistungsdaten/create/multiple` | Legt neue Leistungsdaten-Einträge an (Batch) |
| `patchLeistungsdaten(id, patch)` | `PATCH /schueler/leistungsdaten/{id}` | Ändert einzelne Felder eines bestehenden Leistungsdaten-Eintrags (Merge-Patch nach RFC 7386, z.B. `{kursID: ...}`) - "Blockung mit Leistungsdaten abgleichen" → "Übernehmen" (wartung.html) nutzt das, um die Kurszuordnung zu korrigieren, ohne den Eintrag zu löschen und neu anzulegen |
| `deleteLeistungsdatenMultiple(ids)` | `DELETE /schueler/leistungsdaten/delete/multiple` | Löscht Leistungsdaten-Einträge anhand ihrer IDs (Batch; index.html Schritt 8 sowie mehrere wartung.html-Bausteine) |
| `deleteKurseMultiple(ids)` | `DELETE /kurse/delete/multiple` | Löscht Kurse anhand ihrer IDs, antwortet pro Kurs einzeln mit `{id, success, log[]}` (wartung.html "Leere Kurse suchen") – Stand Juli 2026 serverseitig auf den Server-Entwicklungsmodus beschränkt, siehe Hinweis dort |
| `patchKurs(id, patch)` | `PATCH /kurse/{id}` | Ändert einzelne Felder eines Kurses (Merge-Patch nach RFC 7386, z.B. `{sortierung: 0}`) – anders als das Löschen im normalen Server-Modus nutzbar |
| `getGostAbiturjahrgaenge(abschnittId)` | `GET /gost/abiturjahrgaenge/{abschnittId}` | Stufen (Abiturjahrgänge) der gymnasialen Oberstufe im aktuellen Abschnitt (wartung.html "Blockung mit Leistungsdaten abgleichen") |
| `getGostBlockungen(abiturjahr, halbjahr)` | `GET /gost/abiturjahrgang/{abiturjahr}/{halbjahr}/blockungen` | Blockungen (Planungsstände) einer Stufe in einem Gost-Halbjahr (`halbjahr` hier: 0=EF.1 … 5=Q2.2 - **nicht** dasselbe wie `GostJahrgang.halbjahr`, siehe `gostHalbjahrIndex()` in js/wartung.js) |
| `getGostBlockungsergebnis(ergebnisId)` | `GET /gost/blockungen/zwischenergebnisse/{ergebnisId}` | Konkretes Blockungsergebnis inkl. Schienen/Kurse/Schüler-Zuordnung |
| `getGostBlockungsdaten(blockungsId)` | `GET /gost/blockungen/{blockungsId}` | Grunddaten einer Blockung inkl. `kurse[]` mit Kursnummer/Suffix - Blockungs-Kurs-IDs sind eine eigene ID-Reihe, siehe Hinweis unten |
| `getGostAbiturjahrgangLaufbahndaten(abiturjahr)` | `GET /gost/abiturjahrgang/{abiturjahr}/laufbahndaten` | Abiturdaten (inkl. `fachbelegungen[]` mit `fachID`/`abiturFach` 1-4) aller Schüler:innen eines Abiturjahrgangs in einem Aufruf - einzige verlässliche Quelle dafür, ob ein Fach bei einer Person das 3./4. Abiturfach ist (wartung.html "Blockung mit Leistungsdaten abgleichen", Detail-Vergleich) |
| `getLehrer()` | `GET /lehrer` | Kompletter Lehrer-Katalog (Kürzel/Name je Lehrkraft, schulweit, nicht abschnittsabhängig) - für den optionalen Lehrer-Abgleich in "Blockung mit Leistungsdaten abgleichen" (wartung.html), löst dort die Lehrer-IDs echter Kurse (`KursDaten.lehrer`/`weitereLehrer`) in Kürzel auf |

Fehler werden als verständliche deutsche Fehlermeldungen geworfen (401/403/404/5xx sowie
Netzwerkfehler mit Zertifikats-Hinweis). `buildErrorMessage()` hängt zusätzlich die eigentliche
Server-Rückmeldung aus dem Antwort-Body an (JSON oder Klartext, je nachdem was der Server liefert).

### `js/formsImport.js`

- `parseWorkbook(file)` liest die xlsx-Datei (via SheetJS) und liefert `{headers, rows}`.
- `suggestColumnMapping(headers, rows)` schlägt Namens-/Kurswahl-Spalten anhand einfacher Heuristiken vor
  (Metadaten-Spalten wie ID/Zeitstempel werden ausgeschlossen, Spalten mit überwiegend kurzen Texten ohne
  Zahlen/Datumswerte werden vorgeschlagen).
- `extractSelections(parsed, mapping)` liefert pro Zeile `{formsName, courses[]}`. Pro Zellwert wird
  zunächst `mapping.splitDelimiter` angewendet (Schritt 3a - ein Zellwert kann so zu mehreren Einträgen in
  `courses[]` werden), danach `mapping.columnPrefixes` (Spaltenindex als String -> Kürzel, Schritt 3b)
  jedem resultierenden Teil vorangestellt, sofern für die Spalte ein nicht-leeres Kürzel hinterlegt ist.
- `distinctCourseTexts(selections)` liefert die Menge aller unterschiedlichen Kurswahl-Texte.
- `splitCourseValue(value, delimiter)` zerlegt einen Zellwert am Trennzeichen in mehrere Teile (leeres
  Trennzeichen -> Wert unverändert als einzelnes Element); `DEFAULT_SPLIT_DELIMITER` ("+") ist der in der
  UI vorgeschlagene Default.
- `defaultColumnPrefix(colIdx)` liefert das Standard-Kürzel `S<Spaltennummer>` (1-indiziert) für eine
  Kurswahl-Spalte.
- `stripKnownPrefix(text, columnPrefixes)` entfernt ein bekanntes Spalten-Kürzel samt Leerzeichen vom
  Anfang eines Textes (falls vorhanden) – für die Ähnlichkeitssuche in Schritt 5, die vom Kürzel nichts
  wissen soll.

### `js/matching.js`

- `normalizeText`/`similarity`: Textnormalisierung (Kleinschreibung, Umlaut-Transliteration,
  Satzzeichen entfernt) und Ähnlichkeitsberechnung (Kombination aus Levenshtein-Ratio und Token-Jaccard).
- `suggestStudentMatches` / `suggestCourseMatches`: liefern die besten Kandidaten für einen Text.
- `autoMatchStudents` / `autoMatchCourses`: matchen eine ganze Liste auf einmal, tragen sichere Treffer in
  die übergebene Matching-Tabelle ein und liefern die unsicheren Fälle zur manuellen Prüfung zurück.
  `autoMatch()` (intern) trennt bewusst Speicherschlüssel (immer die Original-Query) und Suchtext
  (optional über `searchTextFn` ableitbar) - so nutzt `app.js` beim Kurs-Matching den Speicherschlüssel
  inkl. Spalten-Kürzel, die Ähnlichkeitssuche aber den Text ohne Kürzel (via
  `FormsImport.stripKnownPrefix()`).
- Matching-Tabellen sind einfache Objekte `{ [normalisierterSchlüssel]: {targetId, targetLabel, manual,
  ignored} }` – bewusst ohne eigenen Zustand in diesem Modul, damit sie 1:1 in `storage.js` persistiert
  werden können.

### `js/storage.js`

- `getDefaultState()` / `loadState()` / `saveStateNow()` / `scheduleSave()` (debounced Autosave in
  `localStorage`).
- `exportJson(state)` / `importJson(file)` für den manuellen JSON-Export/Import.
- `stripSecrets(obj)`: entfernt rekursiv jedes Feld, dessen Name wie ein Passwort aussieht – wird vor
  jedem Speichern/Export aufgerufen.

### `js/check.js`

Nur von `wartung.html`/`js/wartung.js` genutzt ("Leistungsdaten mit leerem Kurs"). Analog zu
`matching.js`/`formsImport.js` bewusst als reine Funktionen ohne eigenen Zustand und ohne API-Zugriff
gehalten – das Holen der Daten übernimmt `wartung.js`, hier steckt nur die Analyse-Logik, damit sie sich
isoliert testen lässt (siehe Node-Testskripte während der Entwicklung) und sich künftig leicht um weitere
Kontrollen ergänzen lässt.

- `findeLeistungsdatenMitLeeremKurs(lernabschnittsdaten, gueltigeKursIds)`: liefert die
  Leistungsdaten-Einträge eines Lernabschnitts, die eine `kursart` tragen (also ursprünglich einem Kurs
  zugeordnet waren), deren `kursID` aber entweder `null` ist **oder** nicht in `gueltigeKursIds` (Set der
  aktuell in Schild existierenden Kurs-IDs) vorkommt. Der zweite Fall wurde erst im Nachhinein ergänzt: ein
  gesetztes `kursID`, das auf einen inzwischen gelöschten Kurs zeigt, ist genauso "leer" wie `kursID: null`
  – zeigt sich in Schild aber identisch als leeres Kurs-Feld. Ohne den Vergleich gegen `gueltigeKursIds`
  wären solche hängenden Referenzen unentdeckt geblieben (siehe "Fehlerbehebungen" unten).
- `CHECKS`: Registry aller Wartungs-Kontrollen (`{id, label, findIssues}`) für eine generische
  Bedienoberfläche; aktuell ein Eintrag (`leistungsdatenLeererKurs`).

### `js/app.js`

Orchestrierung für `index.html`. Hält den nicht-persistenten Laufzeitzustand (geladene Schild-Daten,
geparste Forms-Datei, Berechnungs-Zwischenergebnisse) und verdrahtet alle Buttons/Inputs von `index.html`
mit den obigen Modulen. Der persistente Teil des Zustands (`state`) wird bei jeder relevanten Änderung
über `Storage.scheduleSave(state)` gesichert. Die reinen Schild-Wartungswerkzeuge (Split, Leere Kurse,
Leistungsdaten mit leerem Kurs) sitzen **nicht** hier, sondern eigenständig in `js/wartung.js` (siehe
dort) – einzige Ausnahme ist "Kurse ohne Forms-Wahl" (Schritt 8) unten, die die hier laufenden Forms-Daten
braucht. Die zustandslosen Hilfsfunktionen (`$`, `escapeHtml`, `mapWithConcurrency`, `batchWithBisection`,
`kursLabel`, `schuelerLabel`, `idFromLabel`, `reveal`, `DEFAULT_JAHRGANG_KUERZEL`, `setStatus`) kommen aus
`js/sharedCode.js` (siehe dort) - hier nur per Destructuring als lokale Bindings geholt.

`pruneStaleKursMatches()`: läuft am Ende von `onLoadSchildData()` (Schritt 2), nachdem `kursById` aus den
frisch geladenen Schild-Kursen aufgebaut wurde. Entfernt aus `state.kursMatching` alle nicht-ignorierten
Einträge, deren `targetId` nicht mehr in `kursById` existiert, und meldet die Anzahl im Status-Text von
Schritt 2. Ignorierte Einträge (keine `targetId`) bleiben unangetastet.

`refreshKursBelegung()`: lädt nur `GET /kurse/abschnitt/{id}` neu (nicht den kompletten Schritt-2-Umfang)
und ersetzt `schildKurse`/`kursById` durch den frischen Stand. Ruft danach `pruneStaleKursMatches()`,
`buildDatalists()` und `populateKurseOhneWahlFilters()` auf. Wird automatisch am Ende von Schritt 6
(Übertragung, nur bei mindestens einem erfolgreichen Eintrag) aufgerufen; zusätzlich manuell über den
Button "Kursbelegung aktualisieren" am Anfang von Schritt 8 (`onRefreshKursBelegung()`) anstoßbar - z.B.
falls parallel direkt in Schild oder auf der Wartungsseite etwas geändert wurde. `js/wartung.js` hat eine
eigene, um die dort zusätzlich benötigten Split-Tabellen erweiterte Variante derselben Funktion.

Funktionen rund um Schritt 3a (Kurs-Rewrite) und 3b (Spaltenkürzel):

- `onApplyCourseSplit()`: übernimmt das Trennzeichen-Feld nach `state.courseSplitDelimiter` und
  berechnet die Kurswahl-Texte neu. `renderCourseSplitEditor()` zeigt den gespeicherten Wert an bzw.
  schlägt `FormsImport.DEFAULT_SPLIT_DELIMITER` vor, solange noch nichts gespeichert wurde.
- `ensureDefaultColumnPrefixes(courseCols)`: setzt für neue Kurswahl-Spalten das Standard-Kürzel
  `S<Spaltennummer>`; bereits vergebene (auch bewusst geleerte) Kürzel bleiben unangetastet.
- `recomputeSelectionsAndRender()`: ruft `FormsImport.extractSelections()` mit der aktuellen
  Spaltenzuordnung, dem aktuellen Split-Trennzeichen *und* den aktuellen Kürzeln neu auf und rendert
  Schritt 4 + 5 neu. Wird nach "Auswahl übernehmen" (Schritt 3), "Übernehmen" (Schritt 3a) und "Kürzel
  übernehmen" (Schritt 3b) aufgerufen.

Funktionen rund um den "Neuen Kurs anlegen"-Dialog (hier nur noch für Schritt 5 gebraucht;
`js/wartung.js` hat für seine Split-Bereiche eine eigene, unabhängige Kopie desselben Dialogs und
derselben Funktionen – bewusste Duplikation statt eines gemeinsamen Moduls, siehe PLANUNG.md):

- `populateCreateKursDialogOptions()`: befüllt das Fach-Dropdown und die Kursarten-Datalist im Dialog aus
  den in Schritt 2 geladenen Fächern/Kursarten. Wird nach jedem "Schild-Daten laden" neu aufgerufen.
- `openCreateKursDialog(options)`: öffnet den nativen `<dialog>` und befüllt alle Felder als editierbare
  *Vorschläge* aus `options` (`displayText`, `kuerzelSuggestion`, `bezeichnungSuggestion`, `fachId`,
  `kursart`, `wochenstunden`, `jahrgangIds`). `options.onCreated(neuerKurs)` wird nach erfolgreichem
  Anlegen aufgerufen und trägt den neuen Kurs in `state.kursMatching` ein - der Dialog selbst kennt diese
  Aufrufer-Logik nicht mehr, nur noch den generischen Callback (gemerkt in der Modul-Variable
  `createKursOnCreated`).
- `renderCreateKursJahrgaenge(preselectIds)`: baut die Jahrgangs-Checkboxen; ohne `preselectIds` greift
  die generische Vorauswahl `DEFAULT_JAHRGANG_KUERZEL` (05–10, EF, Q1, Q2), mit expliziten IDs wird nur
  dieser vorausgewählt - beides bleibt im Dialog frei änderbar.
- `onCreateKursFormSubmit(evt)`: baut aus den Formularfeldern das `KursDaten`-Objekt, ruft
  `SvwsApi.createKurs()` auf, übernimmt bei Erfolg den neuen Kurs in `schildKurse`/`kursById`/die
  Datalists und ruft danach den zuvor über `openCreateKursDialog()` hinterlegten Callback auf.

Funktionen rund um Schritt 6 (Übertragung), siehe auch "Fehlerbehebungen während der Entwicklung" oben:

- `commitVisibleStudentMatches()` / `commitVisibleCourseMatches()`: übernehmen sichtbare, aber noch nicht
  bestätigte Match-Vorschläge der jeweiligen Tabelle in die persistente Matching-Tabelle und geben die
  Anzahl neu übernommener Zeilen zurück. Werden vom "Speichern"-Button in Schritt 4 (nur Schüler) bzw.
  intern von `commitVisibleMatches()` (beide zusammen, vor der Vorschau-Berechnung in Schritt 6)
  aufgerufen.
- `collectMatchedPairs()`: sammelt alle gematchten Schüler×Kurs-Kombinationen und dedupliziert sie. Ist
  `state.transferStartRow` gesetzt (Feld "Nur ab Excel-Zeile"), werden Forms-Zeilen mit kleinerem
  `entry.rowIndex` vorher übersprungen (`transferStartRowIndex()` rechnet die 1-basierte Excel-Zeilennummer
  in den 0-basierten `rowIndex` aus `FormsImport.extractSelections()` um) - betrifft nur die Übertragung,
  nicht die Matching-Tabellen in Schritt 4/5.
- `onComputePreview()`: baut `transferPreviewRows` und prüft dabei je Person nicht nur, ob im gematchten
  Kurs direkt schon ein Leistungsdaten-Eintrag existiert, sondern über `resolveUrsprungsKurs()` (siehe
  Schritt 8 unten) auch, ob ein vorhandener Eintrag über einen zwischenzeitlichen, auf der Wartungsseite
  konfigurierten Split auf diesen Kurs zurückführt (`existingViaSplit`) - siehe "Fehlerbehebungen" Nr. 7
  oben.
- `batchWithBisection(items, apiCall)` (aus `js/sharedCode.js`, siehe dort): legt einen Batch an; schlägt
  er fehl, wird rekursiv halbiert, bis entweder ein Teil-Batch durchgeht oder die einzelnen fehlerhaften
  Datensätze isoliert sind, statt einen ganzen Batch zu verwerfen (siehe Fehlerbehebung Nr. 2 oben, wo die
  Funktion ursprünglich unter dem Namen `createBatchWithBisection()` speziell für Leistungsdaten entstand,
  bevor sie generalisiert und später nach `sharedCode.js` verschoben wurde). `items` müssen keine
  fertigen Payloads sein; `apiCall` entscheidet, was daraus gesendet wird, `failed[].item` bleibt die
  Original-Referenz. Wird von `onExecuteTransfer()` und `deleteKurseOhneWahlIds()` genutzt.

Statusfilter in Schritt 4/5:

- Jede Tabellenzeile bekommt beim Rendern ein `data-status` (`saved`/`high`/`low`/`none`/`ignored`, siehe
  `statusCategory()`), das mit den Filter-Checkboxen (`#student-status-filter`/`#course-status-filter`)
  über `applyStudentFilter()`/`applyCourseFilter()` abgeglichen wird (rein CSS-`display`-basiert, keine
  Neuberechnung der Tabelle). `setStudentFilterOnly()`/`setCourseFilterOnly()` setzen die Checkboxen für
  die Schnellzugriffs-Buttons ("Nur unsichere anzeigen"/"Alle anzeigen"). Eine Zeile mit ungültiger,
  gerade eingetippter Eingabe wird unabhängig vom Filter immer angezeigt, damit sie nicht "verschwindet".

Funktionen rund um Schritt 8 ("Kurse ohne Forms-Wahl", einzige Wartungs-Kontrolle, die hier statt in
`js/wartung.js` lebt - siehe Begründung oben im Datei-Kopfkommentar):

- `populateKurseOhneWahlFilters()`: befüllt die Fach-/Kursart-Checkboxen aus den tatsächlich in
  `schildKurse` vorkommenden Werten (nicht dem vollen Fächerkatalog). Vorbelegung ist die zuletzt
  gespeicherte Auswahl aus `state.kurseOhneWahlFilter` (persistiert; leeres Array = "noch nichts
  gespeichert" → alle angehakt, analog zu `state.statusFilter` in Schritt 1). Wird nach jedem
  "Schild-Daten laden" neu aufgerufen.
- `persistKurseOhneWahlFilter()`: schreibt die aktuell angehakten Fach-/Kursart-Checkboxen in
  `state.kurseOhneWahlFilter` und speichert; läuft bei jeder Änderung einer Einzel- oder "alle"-Checkbox.
- `onKurseOhneWahlFachSelectAll()` / `onKurseOhneWahlKursartSelectAll()`: setzen alle Checkboxen der
  jeweiligen Gruppe auf einmal. `updateKurseOhneWahlSelectAllCheckboxes()` hält umgekehrt die beiden
  "alle"-Checkboxen konsistent mit dem Zustand ihrer Gruppe (nur angehakt, wenn wirklich jede
  Einzel-Checkbox angehakt ist).
- `buildSplitZielZuQuellMap()`: baut aus den vollständigen Zeilen *beider* auf der Wartungsseite
  konfigurierten Split-Bereiche (`state.splitJahrgangRows` + `state.splitKlasseRows`, geschrieben von
  `js/wartung.js`, hier nur gelesen) eine Zielkurs-ID → Quellkurs-ID-Abbildung.
- `resolveUrsprungsKurs(kursId, zielZuQuell)`: verfolgt einen Kurs rückwärts über ggf. mehrere
  Split-Schritte (Jahrgangs- *und* Klassen-Split können hintereinander angewendet worden sein) bis zum
  ursprünglichen, nicht selbst aus einem Split hervorgegangenen Kurs zurück, mit Zyklus-Schutz für
  widersprüchliche Konfigurationen (isoliert getestet: mehrstufige Ketten, unbekannte IDs, Zyklen). Auch
  von `onComputePreview()` (Schritt 6) genutzt.
- `onRunKurseOhneWahl()`: baut zunächst pro Schritt-4-Match die Menge `chosenKursIds` (alle
  nicht-ignorierten Kurs-Treffer aus `state.kursMatching` für die Kurswahlen dieser Person), holt dann
  konkurrenzbegrenzt die Lernabschnittsdaten und meldet Leistungsdaten-Einträge mit `kursID`, die (a)
  durch den Fach-/Kursart-Filter kommen und (b) weder direkt noch über `resolveUrsprungsKurs()` in
  `chosenKursIds` enthalten sind.
- `renderKurseOhneWahlTable()`: wendet Suchfilter (`#kurse-ohne-wahl-suche`, Substring über alle
  Anzeigespalten) und Sortierung (`compareKurseOhneWahl()`, gleiches Sortier-Muster wie
  `compareMissingStudents()` in Schritt 4a) auf `kurseOhneWahlResults` an, bevor gerendert wird - beides
  rein clientseitig auf dem bereits geladenen Ergebnis, keine erneuten Server-Anfragen.
- `deleteKurseOhneWahlIds(ids)`: gemeinsame Löschroutine für sowohl den Einzel-Löschen-Button je Zeile
  (`onDeleteKurseOhneWahlSingle()`) als auch das Mehrfach-Löschen über Checkboxen
  (`onDeleteKurseOhneWahlSelected()`), beide mit `confirm()`-Sicherheitsabfrage.

### `js/wartung.js`

Orchestrierung für `wartung.html`, strukturell an `js/app.js` angelehnt, aber ein eigenständiges,
paralleles Skript: eigene `state`-Instanz (`Storage.loadState()`), eigene Kopien von Verbindung/
Schild-Daten-laden/"Neuen Kurs anlegen"-Dialog. Die reinen, zustandslosen Hilfsfunktionen (`$`,
`escapeHtml`, `mapWithConcurrency`, `batchWithBisection`, `kursLabel`, `schuelerLabel`, `idFromLabel`, …)
kommen dagegen aus `js/sharedCode.js` (siehe dort) - nur der Rest bleibt bewusst dupliziert statt in ein
gemeinsames Modul mit `js/app.js` ausgelagert (siehe Datei-Kopfkommentar sowie PLANUNG.md), da er
Datei-lokalen Laufzeit-Zustand braucht, passend zum bestehenden Stil des Projekts (kein Build-Schritt).

- `kursLabelMitAnzahl(k)`: wie `kursLabel()`, aber mit Schülerzahl in Klammern (z.B. "AGGT-Robotik (23)"),
  aus dem eingebetteten `schueler[]`-Array der zuletzt geladenen Kursdaten - Basis für die
  `kurs-datalist-anzahl`-Autocomplete der Quell-/Zielkurs-Felder unten.
- `refreshKursBelegung()`: lädt nur `GET /kurse/abschnitt/{id}` neu, baut `kursById`/die
  `kurs-datalist-anzahl`-Datalist neu und rendert beide Split-Tabellen - Pendant zur gleichnamigen,
  schlankeren Funktion in `js/app.js`. Wird automatisch am Ende jedes Splits sowie nach jedem
  Kurs-Löschen aufgerufen; zusätzlich manuell über "Kursbelegung aktualisieren".
- **"Leistungsdaten mit leerem Kurs"**: `onRunCheckLeererKurs()` holt konkurrenzbegrenzt
  (`mapWithConcurrency`) die Lernabschnittsdaten aller geladenen Schüler:innen, wendet
  `Check.CHECKS.leistungsdatenLeererKurs.findIssues()` an und sammelt Treffer in
  `checkLeererKursResults`. `populateCheckLeererKursKursartFilter()` befüllt danach das
  Kursart-Spaltenkopf-Popover aus den tatsächlich gefundenen Kursarten (z.B. um "PUK" bei Schulen
  auszublenden, an denen regulärer Klassenunterricht ebenfalls eine Kursart trägt);
  `persistCheckLeererKursFilter()`/`onCheckLeererKursFilterChange()` speichern die Auswahl in
  `state.checkLeererKursFilter` (leeres Array = alles anzeigen) und rendern sofort neu, wie beim
  Fach-/Kursart-Filter von "Leere Kurse suchen" unten. `filteredCheckLeererKursRows()` wendet den Filter
  an, bevor `renderCheckLeererKursTable()` die Ergebnistabelle rendert; `onDeleteCheckLeererKurs()` löscht
  die ausgewählten Einträge (mit `confirm()`-Sicherheitsabfrage).
- **"Split in Jahrgangskurse"**: `renderSplitJahrgangTable()` / `onSplitJahrgangAddRow()` /
  `onSplitJahrgangAddBelow()` / `onSplitJahrgangRemoveRow()` verwalten `state.splitJahrgangRows`
  (persistiert, geteilt mit `index.html`/"Kurse ohne Forms-Wahl") und deren Darstellung - `select`-Feld
  zeigt hinter jedem Jahrgang zusätzlich die Schülerzahl dieses Quellkurses in diesem Jahrgang an (z.B.
  "05 (12 SuS)"), ermittelt über `jahrgangAnzahlByKurs(quellkurs)`. `onSplitJahrgangCreateZielkurs()`
  öffnet den "Neuen Kurs anlegen"-Dialog mit Vorschlägen aus Quellkurs/Jahrgang der Zeile.
  `buildSplitLeistungsdatenPayload(quellEintrag, zielkurs)` baut den Leistungsdaten-Payload für den
  Zielkurs (Noten-/Zeugnisfelder vom Quelleintrag, Kursart/Wochenstunden/Kursleitung vom Zielkurs) -
  gemeinsam mit dem Klassen-Split genutzt. `onExecuteSplitJahrgang()` verarbeitet alle vollständigen
  Zeilen sequenziell: Kandidaten über `schuelerById.get(s.id).idJahrgang` filtern, Lernabschnittsdaten
  konkurrenzbegrenzt laden, für jede Person Anlegen-im-Ziel (falls nötig) und Löschen-aus-Quelle über
  `batchWithBisection()` ausführen. Die zum Löschen vorgesehene Menge wird aus den *erfolgreichen*
  Anlege-Operationen abgeleitet (`fehlgeschlageneOps`-Set über Objektreferenzen aus `createResult.failed`),
  damit ein fehlgeschlagenes Anlegen niemals zu einem gelöschten Quelleintrag ohne Ziel-Gegenstück führt.
- **"Automatischer Vorschlag"** (Jahrgang): `autosplitProposalRows`/`autosplitQuellkursId` sind
  Laufzeit-only-Zwischenergebnisse, bewusst nicht persistiert - ein Vorschlag lässt sich jederzeit neu
  erzeugen. `onAutosplitVorschlag()` gruppiert das eingebettete `schueler[]` des gewählten Quellkurses
  nach Jahrgang und baut pro vorkommendem Jahrgang eine Vorschlagszeile (Zielkurs-Vorschlag
  `<Quellkurs-Kürzel>-<Jahrgang>`, ein bereits vorhandener gleichnamiger Kurs wird per `schildKurse.find()`
  wiederverwendet). `renderAutosplitTable()` / `fachOptionsHtml()` rendern die Vorschlagstabelle
  (`fachOptionsHtml()` ist das Fach-Pendant zu `jahrgangOptionsHtml()`, da ein `<select>` nicht wie eine
  Datalist mehrfach im DOM wiederverwendet werden kann). `onAutosplitUebernehmen()` liest beim Klick auf
  "Ausgewählte übernehmen" die *aktuellen* DOM-Werte der angehakten Zeilen (nicht `autosplitProposalRows` -
  frei editierbar); mehrere Zeilen mit *identischem* Zielkurs-Text werden zu einer Gruppe zusammengefasst
  (ein neuer Kurs mit vereinigten Jahrgängen). Fehlt einer Gruppe die Kursart oder schlägt das Anlegen
  fehl, wird die Gruppe übersprungen und im Protokoll vermerkt. Erfolgreich aufgelöste Zeilen werden an
  `state.splitJahrgangRows` angehängt, der eigentliche Verschiebevorgang bleibt Sache von "Split
  durchführen".
- **"Split in Klassenkurse"** (`renderSplitKlasseTable()`, `onSplitKlasse*()`, `onExecuteSplitKlasse()`,
  `state.splitKlasseRows`) sowie **"Automatischer Vorschlag"** für Klassen (`autosplitKlasseProposalRows`,
  `onAutosplitKlasseVorschlag()`, `renderAutosplitKlasseTable()`, `onAutosplitKlasseUebernehmen()`,
  `klasseAnzahlByKurs()`) sind bewusst separate, strukturelle Zwillinge der Jahrgangs-Funktionen statt
  einer gemeinsamen generischen Engine - die beiden Dimensionen unterscheiden sich genug (Schülerfeld
  `idKlasse` vs. `idJahrgang`; Kurse kennen nur Jahrgänge, keine Klassen, daher andere
  Zielkurs-Anlage-Vorbelegung: `idJahrgaenge` des neuen Kurses wird aus `klasse.idJahrgang` der beteiligten
  Zeile(n) gebildet statt aus einem direkt gewählten Jahrgang, siehe `onSplitKlasseCreateZielkurs()`),
  dass eine Abstraktion mehr Indirektion als Nutzen gebracht hätte. Echte Querschnittslogik
  (`batchWithBisection()`, `buildSplitLeistungsdatenPayload()`, `openCreateKursDialog()`,
  `fachOptionsHtml()`) bleibt geteilt.
- **"Leere Kurse suchen"**: `onRunLeereKurse()` läuft ohne Vorbedingung über alle `schildKurse` und
  meldet jeden Kurs, dessen eingebettetes `schueler`-Array leer ist (rein clientseitig, kein API-Aufruf).
  Die **Spaltenkopf-Filter** (Excel-artig, Fach/Kursart) sind der zentrale Unterschied zum
  Fach-/Kursart-Checkblock von "Kurse ohne Forms-Wahl" in `index.html`:
  `populateLeereKurseFilters()` befüllt zwei Checkbox-Popover (`#leere-kurse-fach-filter-popover`/
  `#leere-kurse-kursart-filter-popover`, geöffnet über die ▾-Buttons `#leere-kurse-*-filter-btn`,
  `toggleColFilterPopover()`/`closeColFilterPopovers()`) aus den *tatsächlich gefundenen* Werten in
  `leereKurseResults` (nicht dem vollen Schild-Katalog) - läuft nach jedem "Prüfen" neu, nicht beim
  Schild-Daten-laden. `persistLeereKurseFilter()` schreibt die Auswahl nach `state.leereKurseFilter`
  (`{fachLabels: [], kursarten: []}`, eigener, unabhängig von `state.kurseOhneWahlFilter` gespeicherter
  Zustand; leeres Array = kein Filter aktiv = alles anzeigen). `onLeereKurseFilterChange()` persistiert
  *und* rendert sofort neu - keine erneute "Prüfen"-Runde nötig. `filteredLeereKurseRows()` wendet
  Fach-/Kursart-Filter *und* Suchfeld auf `leereKurseResults` an; `renderLeereKurseTable()` /
  `compareLeereKurse()` / `onLeereKurseSortClick()` übernehmen Sortierung und Rendering.
  `onLeereKurseSortierungNull()`: Workaround für das (Stand Juli 2026) serverseitig gesperrte
  `DELETE /kurse/delete/multiple` (siehe Hinweis oben) - patcht per
  `SvwsApi.patchKurs(id, {sortierung: 0})` konkurrenzbegrenzt die per Checkbox ausgewählten Treffer, damit
  sie in Schild3 bei der Sortierung "Benutzerdefiniert" ganz oben stehen. `deleteLeereKurseIds(ids)`
  löscht die **Kurse selbst** über `SvwsApi.deleteKurseMultiple()` (antwortet pro Kurs einzeln mit
  `{id, success, log[]}`, daher keine `batchWithBisection()` nötig) und ruft danach `refreshKursBelegung()`
  auf.
- **"Blockung mit Leistungsdaten abgleichen"**: `GOST_KURSART_LABELS`/`gostKursartLabel(id)` bilden das
  feste Gost-Kursart-Enum (1–5) auf die Kürzel LK/GK/ZK/PJK/VTF ab (aus dem SVWS-Server-Quellcode
  übernommen, keine Katalog-API dafür verfügbar). `gostHalbjahrIndex(jahrgangLabel, schuljahresHalbjahr)`:
  wichtige Umrechnung, da das `halbjahr`-Feld aus `GostJahrgang` (`/gost/abiturjahrgaenge/{idAbschnitt}`)
  **nicht** der von `/gost/abiturjahrgang/{abiturjahr}/{halbjahr}/blockungen` erwartete GostHalbjahr-Index
  (0=EF.1…5=Q2.2) ist, sondern schlicht "1" oder "2" (welche Hälfte des Schuljahres der Abschnitt ist,
  dieselbe Zählung wie beim Verbindungs-Feld "Abschnitt") - `GOST_JAHRGANG_BASIS` (EF→0, Q1→2, Q2→4) plus
  `+1` bei Schuljahres-Halbjahr 2 liefert den echten Index. Ohne diese Umrechnung landet man bei der
  falschen (oft längst vergangenen, inaktiven) Blockung - genau das war ein realer Bug in einer früheren
  Fassung. `populateBlockungAbgleichStufen()` lädt nach "Schild-Daten laden" die Stufen
  (`SvwsApi.getGostAbiturjahrgaenge()`, Platzhalter `abiturjahr: -1` sowie Jahrgänge unterhalb der
  Oberstufe herausgefiltert - nur EF/Q1/Q2 bleiben). `onBlockungAbgleichStufeChange()` lädt bei
  Stufenwechsel die Blockungen (`SvwsApi.getGostBlockungen()`, mit dem umgerechneten Halbjahr-Index) und
  wählt die als `istAktiv` markierte vor. `onRunBlockungAbgleich()` holt parallel das aktive Ergebnis der
  gewählten Blockung (`SvwsApi.getGostBlockungsergebnis()`) und deren Grunddaten
  (`SvwsApi.getGostBlockungsdaten()`, liefert `kurse[]` mit Kursnummer/Suffix -
  `blockungsKursInfo`/`blockungsKursLabel()`), baut aus dem Ergebnis eine Map Schüler-ID →
  `[{fachID, kursart, kursId}]` aus allen Schienen/Kursen und holt dann konkurrenzbegrenzt die
  Lernabschnittsdaten jeder/jedes betroffenen Schülerin/Schülers. Ein Abgleich über die Kurs-ID ist
  **strukturell unmöglich** (eigene, unabhängige ID-Reihe der Blockungs-Kurse ohne Fremdschlüssel zur
  echten Kurse-Tabelle, siehe Fehlerbehebung 11) - verglichen wird ausschließlich über Fach+Kursart (aus
  `kursById.idFach`/`kursById.kursartAllg` der *tatsächlich vorhandenen* Kurse, bewusst nicht über
  `fachID`/`kursart` auf dem Leistungsdaten-Datensatz selbst, siehe Fehlerbehebung 9 - die sind bei per
  Blockung "hochgeschriebenen" Einträgen nicht zuverlässig befüllt). Kein passender Kurs vorhanden →
  "fehlt in Leistungsdaten". Mehrere passende Kurse (parallele Kurse desselben Fachs/derselben Kursart) →
  `parseKursnummerAusKuerzel()` versucht, über die am Kürzel-Ende geratene Kursnummer (z.B. "SP-GK3" → 3)
  den laut Blockungs-Kursnummer richtigen eindeutig zu bestimmen; gelingt das nicht → "abweichender Kurs"
  mit Hinweis "unsicher" (bester Rateversuch, erkennbar unsicher), sofort weiter zum nächsten Fach.
  Andernfalls ist per Fach+Kursart (und ggf. Kursnummer) genau ein `gewaehlterKandidat` bestimmt - der
  häufigste Fall ist dabei genau ein Kandidat von vornherein (eine Person hat i.d.R. nur einen Kurs je
  Fach/Kursart in den Leistungsdaten). Bei aktivierter Checkbox **"Auch Kursbezeichnung … vergleichen"**
  (`detailsPruefen`, Default an) wird dieser Kandidat zusätzlich geprüft, statt ihn blind als Treffer zu
  werten (das war der ursprüngliche Bug: eine Sp-GK1-statt-Sp-GK2-Umwahl blieb im Ein-Kandidat-Fall
  unbemerkt) - verglichen werden die aus dem Kürzel geratene Kursnummer sowie, falls der Lehrer-Katalog
  geladen werden konnte (`ensureLehrerKatalogGeladen()`, ruft bei Bedarf einmalig `SvwsApi.getLehrer()` auf und cacht das Ergebnis in `lehrerById` - seit der PUK-Prüfung (s.u.) als gemeinsamer Helper beider Aufrufer herausgezogen), eine
  Überschneidung der Lehrer-Kürzel (Blockung: `GostBlockungKursLehrer.kuerzel` direkt aus
  `blockungsKursInfo`; echter Kurs: `KursDaten.lehrer`/`weitereLehrer[].idLehrer`, über `lehrerById`
  aufgelöst), sowie - bei Grundkursen - die Abiturfach-Kennzeichnung (AB3/AB4, siehe Fehlerbehebung 16):
  `abiturFachBySchuelerUndFach` (Schüler-ID → Fach-ID → 1-4, aus
  `SvwsApi.getGostAbiturjahrgangLaufbahndaten()` - einmalig für die ganze Stufe geladen, *nicht* aus der
  Blockung oder dem Kurs, die kennen diese Unterscheidung nicht) liefert das erwartete Abiturfach; ist es 3
  oder 4, wird die erwartete Kursart ("AB3"/"AB4") gegen das `kursart`-Feld des gewählten
  Leistungsdaten-Eintrags verglichen. Alle drei Signale zählen nur als Abweichung, wenn sie auf *beiden*
  Seiten bestimmbar sind (kein Kürzel-Suffix, kein ladbarer Lehrer-Katalog bzw. kein bekanntes Abiturfach
  löst keinen falschen Alarm aus) - bei Abweichung →
  "abweichender Kurs" mit den konkreten Unterschieden im Hinweistext. `alsErsatzVerwendeteKursIds`
  verhindert, dass ein bereits zugeordneter Kurs bei aktivierter Checkbox "beide Richtungen" zusätzlich als
  "zusätzlich in Leistungsdaten" auftaucht (siehe Fehlerbehebung 10). `kursLabelOrId()`/`fachLabel()`
  lösen *echte* Kurs-/Fach-IDs über die bereits geladenen `kursById`/`schildFaecher` auf und fallen auf
  die reine ID zurück, falls dort nicht gefunden; `blockungsKursId`s werden dafür nie verwendet.
  Schüler:innen, die nicht in `schuelerById` gefunden werden (nicht im aktuell geladenen Status-Filter,
  z.B. längst ausgeschieden - siehe Fehlerbehebung 12), werden komplett übersprungen statt fälschlich
  "fehlt überall" zu melden.

  **"Übernehmen"** (September 2026, auf Nachfrage): Jede "fehlt"/"abweichend"-Zeile bekommt beim Bauen
  bereits ein `apply`-Objekt mitgegeben
  (`buildApplyInfo(lad, quellEintrag, fachID, kursart, erwartetNummer, jahrgangIds)` - `quellEintrag` ist
  dabei `null` im "fehlt"-Fall, sonst der bereits vorhandene, zu ersetzende Leistungsdaten-Eintrag).
  `buildApplyInfo()` löst per `resolveZielkurs(fachID, kursart, erwartetNummer, jahrgangIds)` den laut
  Blockung gemeinten *echten* Kurs im `kursById`-Katalog auf (nicht nur unter den Kursen der/des
  Schülerin/Schülers - wichtig gerade für den "fehlt"-Fall, wo es davon keine gibt), zunächst eingeschränkt
  auf `jahrgangIds` (die echte Schild-Jahrgangs-ID der/des Schülerin/Schülers, `schueler.idJahrgang`,
  verglichen mit `KursDaten.idJahrgaenge`) - **wichtig**, sonst landen z.B. bei "Sport GK" leicht ein
  Dutzend+ Kurse aus *allen* Jahrgängen der Schule im Kandidatenkreis, obwohl in der eigenen Stufe oft nur
  eine Handvoll paralleler Kurse existiert (reale Beobachtung: 14 statt der paar tatsächlich in Frage
  kommenden). Nur wirksam, wenn dadurch nicht plötzlich gar keine Kandidaten mehr übrig sind (z.B. falls
  `idJahrgaenge` auf einem Kurs nicht gepflegt ist) - dann wird ungefiltert weitergesucht. Eindeutig, wenn
  danach nur ein Fach/Kursart-Treffer übrig bleibt oder die Kursnummer die übrigen ausschließt, sonst
  liefert es nur einen Grund-Text (keine automatische Übernahme möglich). Ist der Zielkurs eindeutig und
  es gibt bereits einen `quellEintrag` (Fach schon in den Leistungsdaten, nur der falsche Kurs), liefert
  `buildApplyInfo()` `patchPayload`/`leistungsdatenId`: `buildKurswechselPatch(zielkurs)` baut daraus einen
  *bewusst minimalen* Merge-Patch (nur `kursID` + `wochenstunden` - **nicht** `fachID`/`kursart`/`lehrerID`,
  siehe Fehlerbehebung 15: der Server leitet beim Patchen von `kursID` die passende Kursart und den
  Fachlehrer selbst her, ein eigenes `kursart`-Feld läuft dort ins Leere). **Bewusst kein "löschen + neu
  anlegen"**: Ein neuer Eintrag lässt sich serverseitig mit HTTP 409 nicht anlegen, solange zum selben
  Fach/Lernabschnitt noch der alte existiert (siehe Fehlerbehebung 14) - PATCH ändert den bestehenden
  Eintrag dagegen atomar (Noten-/Zeugnis-Felder bleiben dabei unverändert). Fehlt der Eintrag ganz, liefert
  `buildApplyInfo()` stattdessen `createPayload` über das neue
  `buildNeueLeistungsdatenPayload(lernabschnittID, zielkurs)` (ebenfalls ohne `kursart`/`lehrerID`, aus
  demselben Grund - `fachID` bleibt, da beim Anlegen Pflichtfeld). `renderBlockungAbgleichTable()` zeigt bei anwendbaren
  Zeilen (`patchPayload` oder `createPayload` vorhanden) eine Checkbox plus Button "Übernehmen" (sonst nur
  den Grund-Text als Hinweis). `applyBlockungAbgleichRows(rows)` führt die eigentliche Übernahme für eine
  oder mehrere Zeilen aus: PATCH-Zeilen einzeln, konkurrenzbegrenzt über `mapWithConcurrency()` (die API
  bietet dafür kein Batch-PATCH), Anlege-Zeilen gebündelt über `batchWithBisection()` +
  `SvwsApi.createLeistungsdatenMultiple()`; nur erfolgreiche Zeilen werden aus `blockungAbgleichResults`
  entfernt, fehlgeschlagene bleiben mit Protokoll-Hinweis stehen.
  `onApplyBlockungAbgleichSelected()`/`onApplyBlockungAbgleichSingle(evt)` sind die Checkbox-Auswahl- bzw.
  Einzelzeilen-Wrapper (beide mit `confirm()`-Sicherheitsabfrage), `onBlockungAbgleichSelectAll(evt)` die
  Spaltenkopf-Checkbox - alle drei demselben Muster wie z.B. bei "Leere Kurse suchen" folgend.

- **"Abgleich Untis mit Leistungsdaten"**: liest einen Untis-Export (GPU015.TXT, "Kurswahl der Studenten" -
  generisches DIF-Format, siehe [untis.at/manual](https://www.untis.at/manual/hid_export_kurswahl.htm))
  ein und vergleicht ihn mit den Leistungsdaten einer Jahrgangsstufe. Feldaufbau je Zeile laut Untis-Doku:
  1 Student Kurzname, 2 Unterrichtsnummer, 3 Fach, 4 Unterrichtsalias, 5 Klasse, 6 Statistikkennzeichen,
  7 Studentennummer (nur Export), 8-9 reserviert - **kein Lehrer-Feld** (das stünde nur in der separaten
  Unterrichts-Datei GPU002.TXT, hier bewusst nicht eingelesen; die Checkbox "Lehrer:in abgleichen" im HTML
  ist deshalb deaktiviert, für eine spätere Erweiterung vorgesehen). Das Trennzeichen zwischen den Feldern
  ist bei Untis beim Export frei wählbar (kein fester Standard) - `erkenneUntisTrennzeichen(zeilen)` rät es
  aus der Datei selbst (das Zeichen, das über die meisten Zeilen hinweg konsistent dieselbe, >1 große
  Feldanzahl liefert, gewinnt; bei Gleichstand Semikolon vor Komma vor Tab). `parseUntisZeile(zeile,
  trenner)` ist ein kleiner handgeschriebener CSV-artiger Parser (kein externe Bibliothek nötig) - beachtet
  in Anführungszeichen gesetzte Felder (Untis-Textbegrenzer-Default `"`, `""` als Escape für ein
  Anführungszeichen darin), in denen das Trennzeichen selbst vorkommen darf. `parseUntisDatei(file)` liest
  die Datei als `ArrayBuffer` und dekodiert sie zunächst mit `TextDecoder("utf-8", {fatal: true})` - schlägt
  das fehl (ungültige Byte-Folge), wird auf Windows-1252 zurückgefallen, da Untis-Exporte trotz "ASCII" in
  der Doku in der Praxis wegen der Umlaute meist so kodiert sind. Das Ergebnis (`{dateiname,
  importDatumIso, trenner, zeilen}`) landet in `state.untisImport` (persistiert wie der Rest des
  Zustands über `Storage`, bleibt also bis zum nächsten Einlesen erhalten) - `renderUntisDateiStatus()`
  zeigt das beim Seitenaufruf sofort an, kein erneutes Hochladen pro Sitzung nötig.
  `populateUntisAbgleichJahrgang()` befüllt die Jahrgangsstufen-Auswahl aus dem bereits geladenen
  Schild-Jahrgangskatalog (unabhängig davon, ob schon eine Untis-Datei da ist) über die schon vorhandene
  `jahrgangOptionsHtml()` (dieselbe Funktion wie bei "Split in Jahrgangskurse"), mit
  Schüler:innen-Anzahl je Stufe. `onRunUntisAbgleich()` gruppiert die Untis-Zeilen nach "Studentennummer"
  (= Schild-Schüler-ID) und vergleicht je Schüler:in der gewählten Stufe. Fach-/Kursbezeichnungs-Auflösung
  läuft zweistufig (`kursByKuerzel`/`fachIdByUntisKuerzel`), weil sich in der Praxis zeigte, dass Untis' Feld
  "Fach" je nach Schule/Konfiguration nicht das bloße Fachkürzel trägt, sondern bereits die komplette
  Kursbezeichnung (z.B. "BI-GK2" statt "BI" - Untis kennt historisch keinen eigenen Kurs-Begriff, "Fach"
  wird dafür teils pro Kurs angelegt): Zuerst wird versucht, das Untis-"Fach" schulweit gegen die echten
  Kurs-Kürzel aufzulösen (`kursByKuerzel`, aus `kursById`) - gelingt das, sind Fach *und* erwartete
  Kursbezeichnung direkt bekannt (der gefundene Kurs selbst). Erst wenn das fehlschlägt, wird auf das
  bloße Fachkürzel gegen `schildFaecher` zurückgefallen (`fachIdByUntisKuerzel`) - dann kommt die erwartete
  Kursbezeichnung stattdessen aus dem separaten Feld "Unterrichtsalias" (kann in diesem Fall auch leer
  sein). Die eigenen Leistungsdaten-Kurse kommen wie beim Blockung-Abgleich aus `kursById` (nicht aus dem
  Leistungsdaten-eigenen `fachID`-Feld) - `meineKurseByFach` hält dafür je Fach eine Liste von
  `{kurs, leistungsdaten}`-Paaren (nicht nur den Kurs), weil der Kursart-Vergleich unten das `kursart`-Feld
  des Leistungsdaten-*Eintrags* selbst braucht (das gibt es nur dort, nicht auf `KursDaten`, die nur die
  allgemeine `kursartAllg` kennen). Fehlt ein Fach komplett → "fehlt in Leistungsdaten"; sonst werden pro
  Untis-Zeile bis zu zwei unabhängige Signale in ein `abweichungen`-Array gesammelt (Muster wie beim
  Detail-Vergleich im Blockung-Abgleich):
  - **Kursbezeichnung** (Checkbox "Kursbezeichnung abgleichen", Default an, nur gewertet wenn eine
    erwartete Bezeichnung überhaupt bestimmbar ist): keiner der zum Fach passenden Schild-Kurse hat dieses
    Kürzel → Abweichung.
  - **Kursart** (Checkbox "Kursart abgleichen", Default an): "Statistikkennzeichen" (Feld 6) wird über
    `UNTIS_STATISTIKKENNZEICHEN_KURSART` (`{1: "LK1", 2: "LK2", 3: "AB3", 4: "AB4", M: "GKM", S: "GKS",
    Z: "ZK"}`, an dieser Schule so verwendet) in die spezifische Kursart übersetzt - dieselben Kürzel, die
    `SchuelerLeistungsdaten.kursart` auf Schild-Seite trägt (siehe `ZulaessigeKursart` im
    SVWS-Server-Quellcode, Fehlerbehebung 15). Leeres oder unbekanntes Statistikkennzeichen wird selbst als
    Befund gemeldet ("Kursart in Untis-Datei fehlt"/"unbekanntes Statistikkennzeichen"), nicht
    stillschweigend übersprungen - auf Nachfrage ergänzt, da auch das ein Datenqualitätsproblem in der
    Untis-Datei ist. Zwei getrennte Rewrite-Regel-Checkboxen (beide Default aus, nur wirksam wenn
    "Kursart abgleichen" aktiv ist), weil AB3/AB4 auf beiden Seiten unabhängig voneinander "falsch" gesetzt
    sein kann (zwei getrennt gepflegte Datenquellen): **"AB3/AB4 laut Untis … als GKS werten"**
    (`rewriteUntisAb34ZuGks`) biegt die aus dem Statistikkennzeichen übersetzte Kursart vor dem Vergleich
    entsprechend um, **"AB3/AB4 laut Schild-Leistungsdaten … als GKS werten"** (`rewriteSchildAb34ZuGks`)
    macht dasselbe mit dem `kursart`-Wert jedes Kandidaten - beide unabhängig voneinander schaltbar, weil
    sich in der Praxis zeigte, dass es nicht reicht, das nur auf einer Seite zu tun. Gewertet wird nur,
    wenn mindestens einer der Kandidaten-Kurse überhaupt eine Kursart-Angabe in Schild hat (sonst kein
    aussagekräftiger Vergleich möglich, kein falscher Alarm); der Hinweistext zeigt bei der Untis-Seite die
    ggf. umgeschriebene, bei der Schild-Seite weiterhin die unveränderten Rohwerte (die Schild-seitige
    Rewrite-Regel wirkt nur auf den Vergleich selbst, nicht auf die Anzeige).

  Schüler:innen der Stufe, für die keine passende "Studentennummer" in der Untis-Datei gefunden wurde,
  werden nicht geprüft, sondern nur gezählt (`keineUntisZeilenLabels`) - `SharedCode.infoPopoverHtml()`
  fügt dafür direkt hinter der Statuszeile ein (i)-Symbol ein, das per CSS-Hover/Tastaturfokus (nicht mehr
  per Klick - ein erster Anlauf nutzte `<details>`, das schob aber beim Öffnen sichtbaren Inhalt
  auseinander) bis zu 10 Namen als überlagerndes Overlay zeigt, der Rest nur als "… und N weitere"; ein von
  einem vorherigen Lauf noch stehendes Symbol wird vorher entfernt (dasselbe Muster wie `setStatus()` das
  für den network-error-hint macht). Rein lesend, keine Lösch-/Änderungsfunktion (anders als beim
  Blockung-Abgleich noch kein "Übernehmen").

- **"Pflichtunterricht im Klassenverband (PUK) prüfen"**: geht - anders als die übrigen Bausteine, die
  jeweils eine Auswahl (Jahrgang/Stufe/Datei) brauchen - direkt alle in `schildKlassen` geladenen Klassen
  durch, jeweils eingeschränkt auf die im aktuellen Status-Filter enthaltenen Mitglieder
  (`klassenMitMitgliedern`, Klassen ohne verbleibende Mitglieder werden übersprungen). Lädt zunächst
  konkurrenzbegrenzt (`mapWithConcurrency`) die Lernabschnittsdaten *aller* betroffenen Schüler:innen in
  `ladBySchuelerId` sowie einmalig den Lehrer-Katalog (`ensureLehrerKatalogGeladen()`), dann wertet
  `onRunPukCheck()` klassenweise aus: `pukByFach` gruppiert je Klasse die Leistungsdaten-Einträge mit
  Kursart "PUK" (`(l.kursart || "").trim().toUpperCase() === "PUK"`, case-/leerzeichen-unabhängig; andere
  Kursarten sind irgendwo als echter Kurs abgebildet und werden von den anderen Bausteinen bereits geprüft)
  nach `fachID` - dieses Feld direkt vom Leistungsdaten-Eintrag zu nehmen ist hier anders als beim
  Blockung-/Untis-Abgleich unproblematisch, weil die dort dokumentierte Unzuverlässigkeit sich auf per
  Blockung "hochgeschriebene" Einträge bezieht, PUK-Einträge aber gewöhnliche manuell erfasste
  Leistungsdaten ohne `kursID` sind (kein alternativer, vertrauenswürdigerer Wert existiert dafür).
  Je Fach/Klasse zwei unabhängige Prüfungen: **Lehrer-Vergleich** (nur nicht-leere `lehrerID`-Werte
  verglichen; mehr als eine unterschiedliche ID → Meldung "Unterschiedliche Lehrer:innen: Kürzel (Anzahl),
  …", Kürzel über `lehrerById` aufgelöst) und **Vollständigkeits-Vergleich** (Anzahl der Einträge zu
  diesem Fach kleiner als die Klassengröße → Meldung mit Anzahl, fehlende Schüler:innen als
  `infoPopoverHtml()`-(i)-Symbol mit bis zu 10 Namen direkt in der Hinweis-Zelle, analog zum Untis-Abgleich
  oben - `namen: []` unterdrückt das Symbol bei der Lehrer-Vergleich-Zeile, die nichts aufzulisten hat).
  `populatePukKlasseFilter()`/
  `persistPukFilter()`/`updatePukFilterButtonState()`/`onPukFilterChange()`/`filteredPukRows()` sind der
  Klasse-Spaltenkopf-Filter im selben Excel-artigen Popover-Muster wie bei "Leere Kurse suchen"
  (Fach/Kursart) bzw. "Leistungsdaten mit leerem Kurs" (Kursart) - baut die Checkbox-Liste aus den
  *tatsächlich* gefundenen `pukResults`, nicht dem vollen Klassenkatalog. Rein lesend, keine
  Lösch-/Änderungsfunktion.

`onExportJson()` / `onImportJson(evt)` / `onResetState()`: eigene Kopien der gleichnamigen Funktionen aus
`js/app.js` (Schritt 7) - nutzen dieselben `Storage.exportJson()`/`Storage.importJson()`. `onResetState()`
weist im `confirm()`-Text ausdrücklich darauf hin, dass das Zurücksetzen wegen des geteilten `localStorage`
auch `index.html` betrifft.

## Bekannte Grenzen / mögliche Erweiterungen

- Mehrfach-Einreichungen derselben Person in der Forms-Datei werden anhand der Zeilenreihenfolge
  aufgelöst (die letzte Zeile mit demselben Namen gewinnt) – es gibt keinen Abgleich über die
  Forms-interne Antwort-ID hinaus.
- Schritt 6 legt ausschließlich neue Leistungsdaten an. Der Abgleich, welche *vorhandenen* Schild-Kurse
  laut Forms nicht mehr gewählt sind, existiert inzwischen als eigener Bereich "Kurse ohne Forms-Wahl" in
  Schritt 8 (inkl. Löschmöglichkeit) - Schritt 6 selbst löscht aber weiterhin nichts automatisch.
- Kein automatisierter Test-Runner; die Kernlogik (`formsImport.js`, `matching.js`) wurde während der
  Entwicklung über Node-Skripte gegen die echte Beispieldatei sowie synthetische Schild-Daten geprüft.
- Die eigentliche Verschiebe-Logik von "Split in Jahrgangskurse"/"Split in Klassenkurse" holt pro Zeile
  ohnehin frische Lernabschnittsdaten und ist dadurch immer korrekt, unabhängig vom Stand der angezeigten
  Teilnehmerzahlen (siehe `refreshKursBelegung()` in der Programmstruktur unten für die automatische
  Aktualisierung dieser Zahlen).
- `index.html` und `wartung.html` teilen sich Verbindungsdaten/Splits/Filter nur, wenn der Browser
  `localStorage` zwischen den beiden Dateien tatsächlich teilt - bei `file://`-URLs macht das nicht jeder
  Browser gleich (Chrome: ja, Firefox: nein, jede Datei isoliert). Über einen lokalen Webserver geöffnet
  ist das Teilen immer zuverlässig.
- "Blockung mit Leistungsdaten abgleichen": Ein exakter Kurs-ID-Abgleich ist serverseitig unmöglich
  (eigene, unabhängige ID-Reihe der Blockungs-Kurse ohne Fremdschlüssel zur echten Kurse-Tabelle, siehe
  Fehlerbehebung 11) - der Vergleich läuft deshalb über Fach+Kursart, bei mehreren parallelen Kursen
  verfeinert um eine aus dem Kurs-Kürzel geratene Kursnummer (`parseKursnummerAusKuerzel()`). Das
  funktioniert nur, wenn Kurs-Kürzel auf die Kursnummer enden (z.B. "SP-GK3") - bei anderen
  Kürzel-Konventionen bleibt die Zuordnung bei mehreren parallelen Kursen unsicher (wird dann auch so
  gekennzeichnet, nicht stillschweigend geraten).

## Einen SVWS-API-Endpunkt selbst prüfen (Swagger UI, ohne curl)

Wenn ein API-Aufruf unerwartet fehlschlägt oder unklar ist, welche Felder ein Endpunkt erwartet
(Pflichtfelder, erlaubte Werte, Antwortformat), lässt sich das komplett im Browser nachvollziehen – ganz
ohne Kommandozeile. Am Beispiel des öffentlichen Testservers `nightly.svws-nrw.de`:

1. **Swagger UI öffnen**: `https://nightly.svws-nrw.de/swagger/` (ein SVWS-Server liefert seine
   interaktive API-Dokumentation immer unter `/swagger/` aus, unabhängig vom Schema). Alternativ liefert
   `https://nightly.svws-nrw.de/openapi/server.json` dieselben Informationen als reines
   OpenAPI-JSON-Dokument – nützlich, um mit `Strg+F` gezielt nach einem Endpunkt- oder Feldnamen zu
   suchen, wenn die Swagger-Oberfläche bei sehr vielen Endpunkten unübersichtlich wird.
2. **Endpunkt suchen**: Swagger UI gruppiert die Endpunkte nach Tags (z.B. "Kurse", "Schüler",
   "Leistungsdaten"). Über das Suchfeld oben rechts oder das Browser-`Strg+F` lässt sich z.B. `/kurse/create`
   oder `/schueler/leistungsdaten/create/multiple` direkt finden.
3. **Schema/Pflichtfelder einsehen**: Endpunkt aufklappen (Klick auf die Zeile) – unter "Request body"
   zeigt Swagger UI das erwartete JSON-Schema. Wichtig ist der Reiter **"Schema"** statt "Example Value":
   Pflichtfelder sind dort mit einem roten Stern bzw. dem Zusatz `required` markiert, optionale Felder
   ohne. Genau so wurde z.B. entdeckt, dass `KursDaten` laut Schema zwar `schueler` und `weitereLehrer`
   als Felder besitzt, der Server das Patchen dieser Felder beim Anlegen aber serverseitig ablehnt (siehe
   "Fehlerbehebungen" oben) – das Schema beschreibt also die Datenstruktur, nicht zwingend, was jeder
   einzelne Endpunkt tatsächlich akzeptiert.
4. **Live gegen den Server testen ("Try it out")**: Button **"Try it out"** am Endpunkt klickt, die
   Beispiel-Request-Body-Felder erscheinen editierbar. Für Endpunkte, die eine Anmeldung voraussetzen
   (bei SVWS die meisten), oben auf der Seite auf das Schloss-Symbol bzw. den Button **"Authorize"**
   klicken und Benutzername/Passwort für das gewünschte Schema eintragen (z.B. `admin` mit leerem
   Passwort auf `nightly.svws-nrw.de`, Schema `GymAbiLite`) – Swagger UI merkt sich das für alle
   weiteren "Try it out"-Aufrufe in der Sitzung. Danach Parameter/Body ausfüllen und **"Execute"**
   klicken: Swagger UI zeigt sowohl den tatsächlich gesendeten Request (inkl. Headers, als `curl`-Befehl
   zum Kopieren) als auch die rohe Server-Antwort inkl. HTTP-Status – bei einem Fehler also genau die
   Meldung, die auch dieses Tool in seiner Fehlerausgabe anzeigt (siehe `buildErrorMessage()` in
   `js/svwsApi.js`).
5. **Ohne Swagger UI, nur im Browser**: `GET`-Endpunkte lassen sich auch direkt als URL aufrufen, z.B.
   `https://nightly.svws-nrw.de/db/GymAbiLite/faecher` – der Browser fragt dann per HTTP-Basic-Auth-Dialog
   nach Benutzername/Passwort und zeigt die JSON-Antwort an (ggf. lesbarer mit einer Browser-Erweiterung
   wie einem JSON-Viewer). Für `POST`/`DELETE`-Endpunkte mit Body funktioniert das nicht mehr rein über die
   Adresszeile – dafür ist "Try it out" in Swagger UI der einfachste Weg ohne Kommandozeile.
6. **Selbstsigniertes Zertifikat**: Meldet der Browser beim Aufruf von `nightly.svws-nrw.de` oder der
   eigenen Schild-Instanz eine Zertifikatswarnung, muss die Basis-URL (`https://<host>/db/<schema>` bzw.
   `https://<host>/swagger/`) einmal manuell aufgerufen und die Warnung bestätigt werden – danach
   funktionieren sowohl Swagger UI als auch dieses Tool (das denselben Browser-`fetch()` nutzt) ohne
   weitere Nachfrage, siehe auch den entsprechenden Hinweistext direkt im Tool bei Verbindungsfehlern.
