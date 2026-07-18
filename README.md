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
   nötig). Über "Übertragen starten" werden die fehlenden Leistungsdaten-Einträge in Batches angelegt,
   mit Protokoll pro Batch.
7. **Speichern/Laden**: Der gesamte Zustand (Verbindungsdaten *ohne Passwort*, Statusfilter,
   Spaltenzuordnung, beide Matching-Tabellen, Übertragungs-Defaults) wird automatisch im Browser
   (`localStorage`) gesichert und beim nächsten Öffnen der Seite wiederhergestellt. Zusätzlich kann der
   Zustand als JSON-Datei exportiert/importiert werden, z.B. um ihn an eine Kolleg:in weiterzugeben oder
   zu sichern. Über "Zustand zurücksetzen" (mit Sicherheitsabfrage) lässt sich der komplette gespeicherte
   Zustand löschen und ganz von vorne beginnen – z.B. nach einem Testlauf mit falschen Daten oder zu Beginn
   einer neuen Umfragerunde im nächsten Halbjahr.
8. **Nachbereitung** (sichtbar sobald Schritt 2 abgeschlossen ist, unabhängig vom restlichen
   Forms-Abgleich): Sammelstelle für Kontrollen auf dem aktuellen Schild-Datenbestand, z.B. um
   Datenreste aus früheren, fehlgeschlagenen Übertragungen aufzuspüren. Aktuell verfügbar:
   **"Leistungsdaten mit leerem Kurs"** – findet Leistungsdaten-Einträge, die eine Kursart tragen (also
   ursprünglich einem Kurs zugeordnet waren), deren Kurs-Verknüpfung aber fehlt *oder* auf einen nicht
   mehr existierenden Kurs zeigt – letzteres z.B. bei doppelt angelegten Einträgen für dasselbe Fach, bei
   denen einer der beiden Kurse zwischenzeitlich in Schild gelöscht wurde (reiner Klassenunterricht ohne
   Kursart wird nicht gemeldet). Über "Prüfen" werden alle in Schritt 2 geladenen Schüler:innen
   durchsucht (bei größeren Schulen können das über 1000 sein – Fortschrittsbalken und Statustext zeigen
   laufend an, wie viele bereits geprüft wurden und wie viele Treffer es bisher gibt); Treffer erscheinen
   in einer Tabelle mit Auswahl-Checkboxen (alle vorausgewählt, inkl.
   Anzeige der betroffenen Kurs-ID), über "Ausgewählte löschen" (mit Sicherheitsabfrage) lassen sich die
   markierten Leistungsdaten-Einträge dauerhaft aus Schild entfernen. Weitere Kontrollen lassen sich über
   `js/check.js` ergänzen.

   **"Split in Jahrgangskurse"**: verschiebt Schüler:innen eines Jahrgangs aus einem gemeinsam angelegten
   Quellkurs (z.B. eine AG, die zunächst für alle Jahrgänge zusammen angelegt wurde) in einen
   jahrgangsspezifischen Zielkurs. Eine Tabelle mit frei hinzufügbaren Zeilen (Quellkurs, Jahrgang,
   Zielkurs) definiert die gewünschten Verschiebungen:
   - **Quellkurs**/**Zielkurs**: Autocomplete-Felder wie in Schritt 4/5, akzeptieren bewusst nur
     *vorhandene* Kurse (zeigen zusätzlich die aktuelle Schülerzahl je Kurs in Klammern an, z.B.
     "AGGT-Robotik (23)") – kein "Freitext legt automatisch einen Kurs an" wie in einer früheren Version,
     das war zu intransparent.
   - **Zielkurs, der noch nicht existiert**: über den Button **"+ Kurs"** neben dem Zielkurs-Feld öffnet
     sich derselbe "Neuen Kurs anlegen"-Dialog wie in Schritt 5, vorbelegt mit Vorschlägen aus dem
     Quellkurs (Kürzel-Vorschlag `<Quellkurs-Kürzel>-<Jahrgang>`, Fach, Kursart, Wochenstunden) und dem
     Jahrgang dieser Zeile als vorausgewähltem (aber änderbarem) Jahrgang – alle Werte bleiben im Dialog
     frei editierbar, nichts wird ungesehen übernommen. Nach dem Anlegen wird der neue Kurs automatisch
     als Zielkurs der Zeile eingetragen.
   - **"+ Jahrgang"**: fügt direkt unter der Zeile eine neue Zeile mit demselben Quellkurs ein, um einen
     Kurs bequem auf mehrere Jahrgänge/Zielkurse aufzuteilen, ohne den Quellkurs erneut auswählen zu müssen.
   - **"Split durchführen"**: verarbeitet alle vollständig ausgefüllten Zeilen nacheinander (mit
     Fortschrittsbalken). Pro Zeile werden alle Schüler:innen des Quellkurses ermittelt, die dem gewählten
     Jahrgang angehören; für jede Person wird geprüft, ob sie den Zielkurs schon hat (dann keine Dopplung)
     – in jedem Fall wird sie aber aus dem Quellkurs entfernt. Noten-/Zeugnisrelevante Felder
     (Note, "auf Zeugnis", Bemerkungstext, Epochal-Kennzeichen) werden beim Verschieben vom
     Quell-Leistungsdaten-Eintrag übernommen, Kursart/Wochenstunden/Kursleitung kommen vom Zielkurs.
     **Sicherheitsgarantie:** Schlägt das Anlegen im Zielkurs für eine Person fehl, wird ihr
     Quellkurs-Eintrag *nicht* gelöscht – so kann niemand eine Fachbelegung komplett verlieren, nur weil
     ein einzelner Schreibvorgang scheitert (isoliert getestet, siehe "Fehlerbehebungen" unten).

   **"Split in Klassenkurse"**: direkt darunter, strukturell identisch zu "Split in Jahrgangskurse", aber
   nach Klasse statt Jahrgang gruppiert (eigene Tabelle mit "+ Klasse" statt "+ Jahrgang", eigenes
   `state.splitKlasseRows`). Ein Unterschied: Kurse kennen in Schild keine direkte Klassen-Zuordnung
   (nur `idJahrgaenge`), daher wird beim Anlegen eines Zielkurses über "+ Kurs" als Jahrgangs-Vorschlag
   der Jahrgang der gewählten Klasse vorausgewählt (`klasse.idJahrgang`) – frei änderbar wie immer.

   **"Kurse ohne Forms-Wahl"** (bewusst *nach* den beiden Split-Bereichen platziert, siehe unten): vergleicht
   für alle in Schritt 4 gematchten Schüler:innen ihre aktuellen Schild-Kurse mit ihren gematchten
   Forms-Kurswahlen aus Schritt 5 und findet Leistungsdaten-Einträge zu Kursen, die laut Forms nicht (mehr)
   gewählt wurden – z.B. Reste einer alten AG-Wahl. Setzt einen abgeschlossenen Forms-Abgleich voraus
   (Schritte 3–5); ohne das erscheint eine Fehlermeldung statt Ergebnissen. **Berücksichtigt dabei auch die
   oben konfigurierten Splits**: Liegt ein aktueller Kurs auf einem Zielkurs eines Jahrgangs- oder
   Klassen-Splits (auch mehrstufig, z.B. erst Jahrgangs- dann Klassen-Split), gilt rückwirkend der
   ursprüngliche Quellkurs als gewählt – ein frisch gesplitteter Kurs wird also nicht fälschlich als
   "nicht gewählt" gemeldet, nur weil er selbst nie Teil einer Forms-Kurswahl war (genau deshalb steht
   dieser Abschnitt hinter den Split-Bereichen: er liest deren Konfiguration mit). Da reguläre Fachkurse
   (Mathematik, Deutsch, …) nichts mit der Forms-Umfrage zu tun haben und sonst immer als "nicht gewählt"
   auftauchen würden, **muss** der Vergleich zunächst auf mindestens ein Fach und eine Kursart eingegrenzt
   werden (Checkboxen, vorbelegt mit allen Fächern/Kursarten, die tatsächlich in geladenen Kursen vorkommen
   – nicht der komplette Schild-Fächerkatalog). Je eine **"alle"-Checkbox** über den beiden Gruppen
   wählt die gesamte Gruppe auf einmal an oder ab; die zuletzt getroffene Auswahl wird persistiert
   (localStorage + JSON-Export) und beim nächsten Öffnen wiederhergestellt. Die Ergebnistabelle
   unterstützt:
   - **Sortierbare Spalten** (Schüler, Fach, Kursart, Kurs, Leistungsdaten-ID) – Klick auf die
     Spaltenüberschrift, wie bei "Schüler ohne Forms-Abgabe" in Schritt 4a.
   - **Ein Suchfeld**, das live über Schüler-, Fach-, Kursart- und Kurstext filtert.
   - **Löschen einzeln** (Button je Zeile) oder **über Checkboxen mehrere auf einmal** (alle standardmäßig
     ausgewählt).

   **"Leere Kurse suchen"**: letzter Nachbereitungs-Baustein, findet Kurse, denen laut zuletzt geladenem
   Datenstand (Schritt 2 bzw. "Kursbelegung aktualisieren") **kein einziger Schüler** zugeordnet ist – z.B.
   Kurse, die nach einem Split oder einer Bereinigung leer zurückgeblieben sind. Rein clientseitige Prüfung
   über die bereits geladenen Kursdaten, kein zusätzlicher API-Aufruf nötig. Stilistisch an "Kurse ohne
   Forms-Wahl" angelehnt (Fach-/Kursart-Checkboxen mit je einer "alle"-Checkbox, sortierbare Ergebnistabelle,
   Suchfeld, Einzel- und Mehrfachlöschen), verwendet aber bewusst eine **eigene, unabhängig gespeicherte**
   Filterauswahl (`state.leereKurseFilter` statt `state.kurseOhneWahlFilter`) – so verändert eine
   Fach-/Kursart-Auswahl in einem der beiden Bereiche nicht unbemerkt das Ergebnis des anderen. Anders als
   bei "Kurse ohne Forms-Wahl" (das nur Leistungsdaten-Einträge löscht) löscht dieser Bereich den **Kurs
   selbst** über `DELETE /kurse/delete/multiple` – Schild meldet den Erfolg pro Kurs einzeln zurück (z.B.
   falls ein Kurs trotz leerer Schülerliste aus anderen Gründen nicht löschbar ist), daher ist hier anders
   als beim Leistungsdaten-Löschen keine Bisection nötig. Nach erfolgreichem Löschen wird automatisch die
   Kursbelegung aktualisiert (`refreshKursBelegung()`), damit gelöschte Kurse überall (Datalists,
   Split-Tabellen, Matching-Vorschläge) sofort verschwinden.

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

6. **"Leistungsdaten mit leerem Kurs" (Schritt 8) fand bei mehreren fast identischen Einträgen eines
   Fachs systematisch einen weniger, als tatsächlich betroffen waren.**
   Ursache: Der erste Wurf des Checks filterte auf `kursID == null`. Ein konkreter, vom Nutzer gelieferter
   Datensatz zeigte aber, dass **alle** Leistungsdaten-Einträge eine `kursID` trugen – auch der als "leer"
   wahrgenommene. Der Fall war: dasselbe Fach zweimal vergeben, mit zwei unterschiedlichen `kursID`-Werten
   (Duplikat), von denen einer auf einen zwischenzeitlich in Schild gelöschten Kurs zeigte. Ein gesetztes,
   aber nicht mehr auflösbares `kursID` erscheint in Schild ebenfalls als leeres Kurs-Feld, wurde vom
   ursprünglichen `kursID == null`-Filter aber gar nicht erst erfasst – die alte Logik hätte bei diesem
   Datensatz **null** Treffer gefunden, nicht "einen zu wenig".
   **Fix:** `findeLeistungsdatenMitLeeremKurs()` (`js/check.js`) bekommt zusätzlich `gueltigeKursIds` (ein
   `Set` der aktuell in Schild existierenden Kurs-IDs, aus `kursById` in `js/app.js`) übergeben und meldet
   jetzt beide Fälle: `kursID == null` **oder** `kursID` gesetzt, aber nicht in `gueltigeKursIds` enthalten.
   Die Ergebnistabelle in Schritt 8 zeigt zusätzlich eine Kurs-ID-Spalte, damit der Unterschied zwischen
   "leer" und "verweist auf gelöschten Kurs" sichtbar ist.

## Programmstruktur

```text
SchildKurswahlen/
  index.html                  UI-Grundgerüst des Wizards (8 Abschnitte)
  css/style.css                Styling (hell/dunkel automatisch je nach Systemeinstellung)
  js/vendor/xlsx.full.min.js   Vendorte SheetJS-Bibliothek (xlsx-Parsing)
  js/svwsApi.js                SVWS-REST-Client
  js/formsImport.js            xlsx-Einlesen, Spalten-Heuristik, Kurswahl-Extraktion
  js/matching.js                Fuzzy-Matching + Verwaltung der persistenten Matching-Tabellen
  js/storage.js                localStorage-Autosave + JSON-Export/Import (ohne Zugangsdaten)
  js/check.js                  Nachbereitungs-Kontrollen (Schritt 8), reine Analyse-Funktionen
  js/app.js                    Orchestrierung: verdrahtet UI-Events mit den obigen Modulen
  testdaten/                  Beispiel-Forms-Export zum Testen
```

### `js/svwsApi.js`

Zustandsloser REST-Client (bis auf `baseUrl`/Auth-Header im Modul-Scope). Wichtigste Funktionen:

| Funktion | Endpunkt | Zweck |
| --- | --- | --- |
| `configure({host, schema, username, password})` | – | Baut Basic-Auth-Header, merkt sich Basis-URL |
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
| `deleteLeistungsdatenMultiple(ids)` | `DELETE /schueler/leistungsdaten/delete/multiple` | Löscht Leistungsdaten-Einträge anhand ihrer IDs (Batch, Schritt 8) |
| `deleteKurseMultiple(ids)` | `DELETE /kurse/delete/multiple` | Löscht Kurse anhand ihrer IDs, antwortet pro Kurs einzeln mit `{id, success, log[]}` (Schritt 8, "Leere Kurse suchen") |

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

Analog zu `matching.js`/`formsImport.js` bewusst als reine Funktionen ohne eigenen Zustand und ohne
API-Zugriff gehalten – das Holen der Daten übernimmt `app.js`, hier steckt nur die Analyse-Logik, damit sie
sich isoliert testen lässt (siehe Node-Testskripte während der Entwicklung) und sich künftig leicht um
weitere Kontrollen ergänzen lässt.

- `findeLeistungsdatenMitLeeremKurs(lernabschnittsdaten, gueltigeKursIds)`: liefert die
  Leistungsdaten-Einträge eines Lernabschnitts, die eine `kursart` tragen (also ursprünglich einem Kurs
  zugeordnet waren), deren `kursID` aber entweder `null` ist **oder** nicht in `gueltigeKursIds` (Set der
  aktuell in Schild existierenden Kurs-IDs) vorkommt. Der zweite Fall wurde erst im Nachhinein ergänzt: ein
  gesetztes `kursID`, das auf einen inzwischen gelöschten Kurs zeigt, ist genauso "leer" wie `kursID: null`
  – zeigt sich in Schild aber identisch als leeres Kurs-Feld. Ohne den Vergleich gegen `gueltigeKursIds`
  wären solche hängenden Referenzen unentdeckt geblieben (siehe "Fehlerbehebungen" unten).
- `CHECKS`: Registry aller Nachbereitungs-Kontrollen (`{id, label, findIssues}`) für eine generische
  Bedienoberfläche in Schritt 8; aktuell ein Eintrag (`leistungsdatenLeererKurs`).

### `js/app.js`

Hält den nicht-persistenten Laufzeitzustand (geladene Schild-Daten, geparste Forms-Datei,
Berechnungs-Zwischenergebnisse) und verdrahtet alle Buttons/Inputs der `index.html` mit den obigen
Modulen. Der persistente Teil des Zustands (`state`) wird bei jeder relevanten Änderung über
`Storage.scheduleSave(state)` gesichert.

`pruneStaleKursMatches()`: läuft am Ende von `onLoadSchildData()` (Schritt 2), nachdem `kursById` aus den
frisch geladenen Schild-Kursen aufgebaut wurde. Entfernt aus `state.kursMatching` alle nicht-ignorierten
Einträge, deren `targetId` nicht mehr in `kursById` existiert, und meldet die Anzahl im Status-Text von
Schritt 2. Ignorierte Einträge (keine `targetId`) bleiben unangetastet.

`refreshKursBelegung()`: lädt nur `GET /kurse/abschnitt/{id}` neu (nicht den kompletten Schritt-2-Umfang)
und ersetzt `schildKurse`/`kursById` durch den frischen Stand - inkl. der darin eingebetteten
`schueler[]`-Arrays, aus denen die in Klammern angezeigten Teilnehmerzahlen (`kursLabelMitAnzahl()`)
stammen. Ruft danach `pruneStaleKursMatches()`, `buildDatalists()`, `populateKurseOhneWahlFilters()` sowie
beide `renderSplit*Table()` auf, damit alle Anzeigen synchron sind. Wird automatisch am Ende von Schritt 6
(Übertragung, nur bei mindestens einem erfolgreichen Eintrag) sowie am Ende jedes Splits aufgerufen;
zusätzlich manuell über den Button "Kursbelegung aktualisieren" am Anfang von Schritt 8
(`onRefreshKursBelegung()`) anstoßbar - z.B. falls parallel direkt in Schild etwas geändert wurde.

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

Funktionen rund um den "Neuen Kurs anlegen"-Dialog (verwendet von Schritt 5 *und* "Split in
Jahrgangskurse" in Schritt 8 - bewusst generisch gehalten, damit jeder künftige Aufrufer denselben Dialog
mit eigenen Vorschlägen und eigener Erfolgs-Aktion wiederverwenden kann):

- `populateCreateKursDialogOptions()`: befüllt das Fach-Dropdown und die Kursarten-Datalist im Dialog aus
  den in Schritt 2 geladenen Fächern/Kursarten. Wird nach jedem "Schild-Daten laden" neu aufgerufen.
- `openCreateKursDialog(options)`: öffnet den nativen `<dialog>` und befüllt alle Felder als editierbare
  *Vorschläge* aus `options` (`displayText`, `kuerzelSuggestion`, `bezeichnungSuggestion`, `fachId`,
  `kursart`, `wochenstunden`, `jahrgangIds`). `options.onCreated(neuerKurs)` wird nach erfolgreichem
  Anlegen aufgerufen und entscheidet kontextspezifisch, was mit dem neuen Kurs passiert (Schritt 5:
  Eintrag in `state.kursMatching`; Split-Zeile: `row.zielkursId` setzen) - der Dialog selbst kennt diese
  Aufrufer-Logik nicht mehr, nur noch den generischen Callback (gemerkt in der Modul-Variable
  `createKursOnCreated`).
- `renderCreateKursJahrgaenge(preselectIds)`: baut die Jahrgangs-Checkboxen; ohne `preselectIds` greift
  die generische Vorauswahl `DEFAULT_JAHRGANG_KUERZEL` (05–10, EF, Q1, Q2), mit expliziten IDs (z.B. genau
  der Jahrgang einer Split-Zeile) wird nur dieser vorausgewählt - beides bleibt im Dialog frei änderbar.
- `onCreateKursFormSubmit(evt)`: baut aus den Formularfeldern das `KursDaten`-Objekt, ruft
  `SvwsApi.createKurs()` auf, übernimmt bei Erfolg den neuen Kurs in `schildKurse`/`kursById`/die
  Datalists und ruft danach den zuvor über `openCreateKursDialog()` hinterlegten Callback auf.

Funktionen rund um Schritt 6 (Übertragung), siehe auch "Fehlerbehebungen während der Entwicklung" oben:

- `commitVisibleStudentMatches()` / `commitVisibleCourseMatches()`: übernehmen sichtbare, aber noch nicht
  bestätigte Match-Vorschläge der jeweiligen Tabelle in die persistente Matching-Tabelle und geben die
  Anzahl neu übernommener Zeilen zurück. Werden vom "Speichern"-Button in Schritt 4 (nur Schüler) bzw.
  intern von `commitVisibleMatches()` (beide zusammen, vor der Vorschau-Berechnung in Schritt 6)
  aufgerufen.
- `collectMatchedPairs()`: sammelt alle gematchten Schüler×Kurs-Kombinationen und dedupliziert sie.
- `createBatchWithBisection(rows)`: legt einen Batch an; schlägt er fehl, wird rekursiv halbiert, bis die
  einzelnen fehlerhaften Datensätze isoliert sind, statt einen ganzen Batch zu verwerfen.

Statusfilter in Schritt 4/5:

- Jede Tabellenzeile bekommt beim Rendern ein `data-status` (`saved`/`high`/`low`/`none`/`ignored`, siehe
  `statusCategory()`), das mit den Filter-Checkboxen (`#student-status-filter`/`#course-status-filter`)
  über `applyStudentFilter()`/`applyCourseFilter()` abgeglichen wird (rein CSS-`display`-basiert, keine
  Neuberechnung der Tabelle). `setStudentFilterOnly()`/`setCourseFilterOnly()` setzen die Checkboxen für
  die Schnellzugriffs-Buttons ("Nur unsichere anzeigen"/"Alle anzeigen"). Eine Zeile mit ungültiger,
  gerade eingetippter Eingabe wird unabhängig vom Filter immer angezeigt, damit sie nicht "verschwindet".

Funktionen rund um Schritt 8 (Nachbereitung):

- `onRunCheckLeererKurs()`: holt konkurrenzbegrenzt (`mapWithConcurrency`) die Lernabschnittsdaten aller
  in Schritt 2 geladenen Schüler:innen, wendet `Check.CHECKS.leistungsdatenLeererKurs.findIssues()` an und
  sammelt Treffer in `checkLeererKursResults`.
- `renderCheckLeererKursTable()`: rendert die Ergebnistabelle mit vorausgewählten Checkboxen pro Zeile.
- `onDeleteCheckLeererKurs()`: fragt vor dem Löschen per `confirm()` nach, ruft dann
  `SvwsApi.deleteLeistungsdatenMultiple()` mit den ausgewählten IDs auf und entfernt erfolgreich gelöschte
  Zeilen aus der Tabelle.
- `batchWithBisection(items, apiCall)`: generische Verallgemeinerung des früheren
  `createBatchWithBisection()` (siehe Fehlerbehebung Nr. 2) - funktioniert für beliebige Batch-Aufrufe
  (Anlegen *und* Löschen), nicht nur für Leistungsdaten-Erstellung. `items` müssen keine fertigen Payloads
  sein; `apiCall` entscheidet, was daraus gesendet wird, `failed[].item` bleibt die Original-Referenz.
  Wird von `onExecuteTransfer()`, `onDeleteCheckLeererKurs()`, `onExecuteSplitJahrgang()`,
  `onExecuteSplitKlasse()` und `deleteKurseOhneWahlIds()` genutzt.

Funktionen rund um "Split in Jahrgangskurse" (Schritt 8):

- `renderSplitJahrgangTable()` / `onSplitJahrgangAddRow()` / `onSplitJahrgangAddBelow()` /
  `onSplitJahrgangRemoveRow()`: verwalten `state.splitJahrgangRows` (persistiert) und deren Darstellung.
  Delegierte Change-/Click-Handler am statischen `#split-jahrgang-table`-Element bedienen alle Zeilen,
  ohne nach jedem Re-Render neu verdrahtet werden zu müssen.
- `onSplitJahrgangZielkursChange()`: löst das Zielkurs-Feld strikt auf einen vorhandenen Kurs auf (wie
  `onSplitJahrgangQuellkursChange()`) - kein Freitext-Fallback.
- `onSplitJahrgangCreateZielkurs()`: öffnet den (generalisierten, siehe unten) "Neuen Kurs
  anlegen"-Dialog mit Vorschlägen aus dem Quellkurs/Jahrgang der Zeile; trägt den neu angelegten Kurs im
  `onCreated`-Callback als Zielkurs der Zeile ein.
- `buildSplitLeistungsdatenPayload(quellEintrag, zielkurs)`: baut den Leistungsdaten-Payload für den
  Zielkurs - Noten-/Zeugnisfelder vom Quelleintrag, Kursart/Wochenstunden/Kursleitung vom Zielkurs.
- `onExecuteSplitJahrgang()`: verarbeitet alle vollständigen Zeilen sequenziell. Pro Zeile: Kandidaten
  über `schuelerById.get(s.id).idJahrgang` filtern (getrennt gezählt von Schüler:innen, die in
  `schuelerById` gar nicht auftauchen, weil sie nicht im Status-Filter aus Schritt 2 enthalten sind - nur
  Letzteres landet als Hinweis im Protokoll, "andere Jahrgänge im selben Quellkurs" ist normal und wird
  nicht gemeldet), Lernabschnittsdaten konkurrenzbegrenzt laden, für jede Person Anlegen-im-Ziel (falls
  nötig) und Löschen-aus-Quelle über `batchWithBisection()` ausführen. Wichtig: Die zum Löschen
  vorgesehene Menge wird aus den *erfolgreichen* Anlege-Operationen abgeleitet (`fehlgeschlageneOps`-Set
  über Objektreferenzen aus `createResult.failed`), damit ein fehlgeschlagenes Anlegen niemals zu einem
  gelöschten Quelleintrag ohne Ziel-Gegenstück führt.

"Split in Klassenkurse" (`renderSplitKlasseTable()`, `onSplitKlasse*()`, `onExecuteSplitKlasse()`,
`state.splitKlasseRows`) ist bewusst ein separater, struktureller Zwilling der obigen Funktionen statt
einer gemeinsamen generischen Engine - die beiden Dimensionen unterscheiden sich genug (Schülerfeld
`idKlasse` vs. `idJahrgang`; Kurse kennen nur Jahrgänge, keine Klassen, daher andere
Zielkurs-Anlage-Vorbelegung über `klasse.idJahrgang`), dass eine Abstraktion mehr Indirektion als Nutzen
gebracht hätte. Echte Querschnittslogik (`batchWithBisection()`, `buildSplitLeistungsdatenPayload()`,
`openCreateKursDialog()`) bleibt geteilt.

Funktionen rund um "Kurse ohne Forms-Wahl" (Schritt 8, bewusst *nach* den beiden Split-Blöcken im Code
platziert, da sie deren Konfiguration liest):

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
- `buildSplitZielZuQuellMap()`: baut aus den vollständigen Zeilen *beider* Split-Bereiche
  (`state.splitJahrgangRows` + `state.splitKlasseRows`) eine Zielkurs-ID → Quellkurs-ID-Abbildung.
- `resolveUrsprungsKurs(kursId, zielZuQuell)`: verfolgt einen Kurs rückwärts über ggf. mehrere
  Split-Schritte (Jahrgangs- *und* Klassen-Split können hintereinander angewendet worden sein) bis zum
  ursprünglichen, nicht selbst aus einem Split hervorgegangenen Kurs zurück, mit Zyklus-Schutz für
  widersprüchliche Konfigurationen (isoliert getestet: mehrstufige Ketten, unbekannte IDs, Zyklen).
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

Funktionen rund um "Leere Kurse suchen" (Schritt 8, letzter Nachbereitungs-Baustein), strukturell an
"Kurse ohne Forms-Wahl" angelehnt, aber mit **eigenem, unabhängig gespeichertem** Filter-Zustand
(`state.leereKurseFilter`), damit die beiden Bereiche sich nicht gegenseitig in der Fach-/Kursart-Auswahl
beeinflussen:

- `populateLeereKurseFilters()` / `persistLeereKurseFilter()` / `updateLeereKurseSelectAllCheckboxes()` /
  `onLeereKurseFachSelectAll()` / `onLeereKurseKursartSelectAll()`: analog zu den gleichnamigen
  `*KurseOhneWahl*`-Funktionen, nur auf `state.leereKurseFilter` statt `state.kurseOhneWahlFilter`.
- `onRunLeereKurse()`: rein clientseitige Prüfung ohne API-Aufruf - filtert `schildKurse` auf die
  gewählten Fächer/Kursarten und meldet jeden Kurs, dessen eingebettetes `schueler`-Array leer ist.
- `renderLeereKurseTable()` / `compareLeereKurse()` / `onLeereKurseSortClick()`: Suchfilter, Sortierung
  und Rendering der Ergebnistabelle, gleiches Muster wie `renderKurseOhneWahlTable()`.
- `deleteLeereKurseIds(ids)`: löscht - anders als `deleteKurseOhneWahlIds()`, das nur Leistungsdaten
  entfernt - die **Kurse selbst** über `SvwsApi.deleteKurseMultiple()`. Der Endpunkt antwortet pro Kurs
  einzeln mit `{id, success, log[]}` statt alles-oder-nichts, daher keine `batchWithBisection()` nötig -
  jede Antwort wird direkt ausgewertet und im Log protokolliert. Nach mindestens einem erfolgreichen
  Löschen wird automatisch `refreshKursBelegung()` aufgerufen. Gemeinsame Basis für
  `onDeleteLeereKurseSingle()` (Einzel-Löschen je Zeile) und `onDeleteLeereKurseSelected()`
  (Mehrfach-Löschen über Checkboxen), beide mit `confirm()`-Sicherheitsabfrage vor dem endgültigen,
  nicht rückgängig machbaren Löschen des Kurses.

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
