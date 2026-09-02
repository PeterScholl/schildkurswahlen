# Planung / Ideen

Sammlung von Vorhaben. Dient als Gedächtnisstütze für spätere Sessions – kein Ersatz für README.md (die
bleibt die Doku des aktuellen Ist-Zustands).

## Offen

### Irreführende Fehlermeldung bei gesperrtem Datenbank-Schema

Beobachtet: Antwortet der SVWS-Server mit "Datenbank-Schema ist zur Zeit aufgrund von internen Operationen
gesperrt. Der Zugriff kann später nochmals versucht werden.", zeigt das Tool trotzdem eine irreführende
CORS-/Zertifikats-Fehlermeldung an ("Verbindung zu ... fehlgeschlagen ...") statt der eigentlichen
Server-Meldung. In den Browser-Entwicklertools steht dabei sinngemäß "Response-Body ist für Skripte nicht
verfügbar (Grund: CORS Missing Allow Origin)".

Vermutliche Ursache: Diese spezielle Fehlerantwort scheint keine (oder eine unvollständige)
`Access-Control-Allow-Origin`-Antwort mitzuschicken – der Browser blockiert dadurch den Zugriff auf Status
und Body bereits auf `fetch()`-Ebene (TypeError, kein `response.ok === false`), sodass in `js/svwsApi.js`
gar nicht erst `buildErrorMessage()` (Zeile ~76, liest den eigentlichen Server-Text aus dem Body) greift,
sondern der generische `catch`-Block um den `fetch()`-Aufruf (Zeile ~60) mit seiner
Zertifikats-/Netzwerk-Vermutung. Betrifft vermutlich nur diesen einen Server-Fehlerfall (Schema-Sperre),
nicht reguläre 4xx/5xx-Antworten, die im Test bislang korrekt durchgereicht wurden.

Noch zu klären, bevor ein Fix versucht wird: ob sich die fehlenden CORS-Header wirklich nur bei diesem
Fehler zeigen (serverseitiges Verhalten, ggf. nicht im Tool behebbar) oder ob sich die Ursache im
Client eingrenzen/umgehen lässt (z.B. am Netzwerkfehler-Text erkennen, dass es evtl. eine Schema-Sperre
statt eines echten Verbindungsproblems ist, und einen entsprechend vorsichtigeren Hinweistext anzeigen).

**Status: nur notiert, noch nicht untersucht/behoben.**

## Erledigt

### 1. "Leere Kurse suchen": Fach-/Kursart-Filter im Spaltenkopf

Umgesetzt (September 2026): Statt der Checkbox-Blöcke oberhalb der Tabelle gibt es jetzt in den
Spaltenköpfen "Fach" und "Kursart" der Ergebnistabelle (`wartung.html`) je eine ▾-Schaltfläche, die ein
Popover mit Checkboxen der tatsächlich gefundenen Werte öffnet – Auswahl wirkt sofort auf die Anzeige
(kein erneutes "Prüfen" nötig) und wird gespeichert. "Prüfen" selbst läuft jetzt ohne Vorbedingung über
alle Kurse mit 0 Schüler:innen.

### 2. Eigenes Wartungs-Tool `wartung.html`

Umgesetzt (September 2026): Die reinen Schild-Wartungswerkzeuge (Leistungsdaten mit leerem Kurs, Split in
Jahrgangs-/Klassenkurse, Leere Kurse suchen) wurden aus `index.html`/`js/app.js` in ein eigenständiges
`wartung.html`/`js/wartung.js` ausgelagert. Beide Seiten verlinken sich gegenseitig oben und teilen sich
Verbindungsdaten (außer Passwort) sowie Split-/Filter-Konfiguration über denselben localStorage-State.

Bewusste Ausnahme: "Kurse ohne Forms-Wahl" (Schritt 8) bleibt in `index.html`, da diese Prüfung zwingend
die im Forms-Abgleich (Schritte 3–5) laufenden Daten (hochgeladene Excel-Datei, Schüler-/Kursmatching)
braucht, die nicht dauerhaft gespeichert werden.

Code-Duplikation zwischen `app.js` und `wartung.js` (Verbindungsaufbau, Schild-Daten laden, "Neuen Kurs
anlegen"-Dialog) ist bewusst in Kauf genommen statt in ein gemeinsames Modul ausgelagert – passend zum
bestehenden Stil des Projekts (kein Build-Schritt, reines Duplizieren paralleler Funktionsblöcke wie schon
bei Jahrgangs-/Klassen-Split).

### 3. Neuer Bereich "Blockung mit Leistungsdaten abgleichen" (wartung.html)

Umgesetzt (September 2026): Vergleicht die Kurszuordnung einer Blockung der gymnasialen Oberstufe mit den
tatsächlich eingetragenen Leistungsdaten einer Stufe, um manuell nachgetragene Umwahlen auf Vollständigkeit
zu prüfen – Stufe (Abiturjahrgang) und Blockung auswählbar, aktive Blockung/Ergebnis vorbelegt.

Mit echten Testdaten (nicht dem leeren öffentlichen Testserver) wurden dabei drei nicht-triviale
SVWS-Eigenheiten aufgedeckt und behoben (Details in README.md, "Fehlerbehebungen während der Entwicklung"
Nr. 8–12):

- Das `halbjahr`-Feld aus `GostJahrgang` ist nicht der erwartete GostHalbjahr-Enum-Index, sondern nur "1"
  oder "2" (Schuljahres-Hälfte) – musste erst umgerechnet werden.
- Kurse innerhalb einer Blockung (`Gost_Blockung_Kurse`) haben eine eigene, von der normalen Kurse-Tabelle
  unabhängige ID-Reihe ohne gespeicherten Fremdschlüssel dazwischen – ein Abgleich über Kurs-IDs ist
  serverseitig unmöglich. Der Vergleich läuft deshalb über Fach+Kursart, bei mehreren parallelen Kursen
  verfeinert um eine aus dem Kurs-Kürzel geratene Kursnummer (Heuristik, kein Garant).
  `fachID`/`kursart` *auf dem Leistungsdaten-Datensatz selbst* sind bei per Blockung
  "hochgeschriebenen" Einträgen nicht zuverlässig befüllt – Fach/Kursart kommen deshalb aus dem
  Kurskatalog (`kursById`), nicht aus diesen Feldern.
- Die Blockung ist ein eingefrorener Snapshot und enthält auch längst ausgeschiedene Schüler:innen, die im
  aktuellen Status-Filter nicht mehr auftauchen – die werden jetzt übersprungen statt fälschlich "fehlt
  überall" zu melden.
