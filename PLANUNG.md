# Planung / Ideen

Sammlung von Vorhaben. Dient als Gedächtnisstütze für spätere Sessions – kein Ersatz für README.md (die
bleibt die Doku des aktuellen Ist-Zustands).

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
