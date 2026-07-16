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
   Abschnitts.
3. **Forms-Datei laden**: xlsx-Datei auswählen. Es erscheint eine Vorschau der ersten Zeilen sowie eine
   Spaltenzuordnung: eine Spalte als "Name" markieren, beliebig viele Spalten als "Kurswahl-Spalten"
   (Checkboxen, mit automatischer Vorauswahl anhand einfacher Heuristiken). Jede nicht-leere Zelle einer
   gewählten Kurswahl-Spalte zählt als eine Kurswahl der jeweiligen Person.
4. **Abgleich Schüler**: Pro erkanntem Forms-Namen wird automatisch der ähnlichste Schild-Schüler
   vorgeschlagen (mit Konfidenz-Prozentwert). Über "Automatisch matchen" werden alle Vorschläge mit hoher
   Sicherheit sofort fest übernommen; unsichere Fälle bleiben zur manuellen Kontrolle stehen. Die
   Eingabefelder sind Autocomplete-Felder (Datalist) über alle geladenen Schüler – einfach tippen und aus
   der Liste wählen. Über die Checkbox "Ignorieren" lässt sich eine Person bewusst von der Übertragung
   ausschließen (z.B. Karteileichen, Fake-Testeinträge).
5. **Abgleich Kurse**: Analog für die Menge der unterschiedlichen Kurswahl-Texte (nicht pro Person,
   sondern einmal pro eindeutigem Text – bei 500 Schüler:innen mit denselben 20 AGs muss man also nur
   20 Zuordnungen treffen, nicht 500). Auch hier lassen sich Werte wie "kein Angebot" oder "Lernzeit"
   bewusst ignorieren, falls sie keinem echten Schild-Kurs entsprechen.
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
   zu sichern.

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

## Programmstruktur

```
SchildKurswahlen/
  index.html                  UI-Grundgerüst des Wizards (7 Abschnitte)
  css/style.css                Styling (hell/dunkel automatisch je nach Systemeinstellung)
  js/vendor/xlsx.full.min.js   Vendorte SheetJS-Bibliothek (xlsx-Parsing)
  js/svwsApi.js                SVWS-REST-Client
  js/formsImport.js            xlsx-Einlesen, Spalten-Heuristik, Kurswahl-Extraktion
  js/matching.js                Fuzzy-Matching + Verwaltung der persistenten Matching-Tabellen
  js/storage.js                localStorage-Autosave + JSON-Export/Import (ohne Zugangsdaten)
  js/app.js                    Orchestrierung: verdrahtet UI-Events mit den obigen Modulen
  testdaten/                  Beispiel-Forms-Export zum Testen
```

### `js/svwsApi.js`

Zustandsloser REST-Client (bis auf `baseUrl`/Auth-Header im Modul-Scope). Wichtigste Funktionen:

| Funktion | Endpunkt | Zweck |
|---|---|---|
| `configure({host, schema, username, password})` | – | Baut Basic-Auth-Header, merkt sich Basis-URL |
| `getStammdaten()` / `getAbschnittId(jahr, abschnitt)` | `GET /schule/stammdaten` | Ermittelt die Abschnitts-ID |
| `getStatusKatalog()` | `GET /schule/schueler/status` | Katalog der Schüler-Status |
| `getSchuelerListe(abschnittId)` | `GET /schueler/abschnitt/{id}` | Schülerliste des Abschnitts |
| `getKurse(abschnittId)` | `GET /kurse/abschnitt/{id}` | Kursliste des Abschnitts |
| `getFaecher()` | `GET /faecher` | Fächerliste |
| `getLernabschnittsdaten(schuelerId, abschnittId)` | `GET /schueler/{id}/abschnitt/{id}/lernabschnittsdaten` | Liefert `lernabschnittID` + vorhandene `leistungsdaten[]` (für Duplikat-Check) |
| `createLeistungsdatenMultiple(list)` | `POST /schueler/leistungsdaten/create/multiple` | Legt neue Leistungsdaten-Einträge an (Batch) |

Fehler werden als verständliche deutsche Fehlermeldungen geworfen (401/403/404/5xx sowie
Netzwerkfehler mit Zertifikats-Hinweis).

### `js/formsImport.js`

- `parseWorkbook(file)` liest die xlsx-Datei (via SheetJS) und liefert `{headers, rows}`.
- `suggestColumnMapping(headers, rows)` schlägt Namens-/Kurswahl-Spalten anhand einfacher Heuristiken vor
  (Metadaten-Spalten wie ID/Zeitstempel werden ausgeschlossen, Spalten mit überwiegend kurzen Texten ohne
  Zahlen/Datumswerte werden vorgeschlagen).
- `extractSelections(parsed, mapping)` liefert pro Zeile `{formsName, courses[]}`.
- `distinctCourseTexts(selections)` liefert die Menge aller unterschiedlichen Kurswahl-Texte.

### `js/matching.js`

- `normalizeText`/`similarity`: Textnormalisierung (Kleinschreibung, Umlaut-Transliteration,
  Satzzeichen entfernt) und Ähnlichkeitsberechnung (Kombination aus Levenshtein-Ratio und Token-Jaccard).
- `suggestStudentMatches` / `suggestCourseMatches`: liefern die besten Kandidaten für einen Text.
- `autoMatchStudents` / `autoMatchCourses`: matchen eine ganze Liste auf einmal, tragen sichere Treffer in
  die übergebene Matching-Tabelle ein und liefern die unsicheren Fälle zur manuellen Prüfung zurück.
- Matching-Tabellen sind einfache Objekte `{ [normalisierterSchlüssel]: {targetId, targetLabel, manual,
  ignored} }` – bewusst ohne eigenen Zustand in diesem Modul, damit sie 1:1 in `storage.js` persistiert
  werden können.

### `js/storage.js`

- `getDefaultState()` / `loadState()` / `saveStateNow()` / `scheduleSave()` (debounced Autosave in
  `localStorage`).
- `exportJson(state)` / `importJson(file)` für den manuellen JSON-Export/Import.
- `stripSecrets(obj)`: entfernt rekursiv jedes Feld, dessen Name wie ein Passwort aussieht – wird vor
  jedem Speichern/Export aufgerufen.

### `js/app.js`

Hält den nicht-persistenten Laufzeitzustand (geladene Schild-Daten, geparste Forms-Datei,
Berechnungs-Zwischenergebnisse) und verdrahtet alle Buttons/Inputs der `index.html` mit den obigen
Modulen. Der persistente Teil des Zustands (`state`) wird bei jeder relevanten Änderung über
`Storage.scheduleSave(state)` gesichert.

## Bekannte Grenzen / mögliche Erweiterungen

- Mehrfach-Einreichungen derselben Person in der Forms-Datei werden anhand der Zeilenreihenfolge
  aufgelöst (die letzte Zeile mit demselben Namen gewinnt) – es gibt keinen Abgleich über die
  Forms-interne Antwort-ID hinaus.
- Es werden ausschließlich neue Leistungsdaten angelegt; ein Abgleich, der auch anzeigt, welche
  *vorhandenen* Schild-Kurse laut Forms nicht mehr gewählt sind (zum manuellen Entfernen), ist aktuell
  nicht enthalten.
- Kein automatisierter Test-Runner; die Kernlogik (`formsImport.js`, `matching.js`) wurde während der
  Entwicklung über Node-Skripte gegen die echte Beispieldatei sowie synthetische Schild-Daten geprüft.
