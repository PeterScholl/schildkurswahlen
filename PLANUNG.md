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

### 1. Firefox-spezifische fehlgeschlagene Anfragen ("CORS-Anfrage schlug fehl, Statuscode: (null)")

Beobachtet und gelöst (September 2026): In Firefox schlugen manche Aufrufe mit "CORS-Anfrage schlug fehl,
Statuscode: (null)" fehl, während andere (z.B. `GET .../faecher`) und der Verbindungstest normal
funktionierten - in Chrome trat das nicht auf. Ursache: Firefox' neueres "Local Network Access" (LNA)
blockiert standardmäßig den Zugriff auf Adressen im lokalen/privaten Netzwerk, sofern die Seite keine
Ausnahme dafür hat. Nutzer-seitiger Fix: `about:config` → `network.lna.skip-domains` → Server-Domain
eintragen, Seite neu laden - reine Browser-Einstellung, keine Code-Änderung nötig, um das Grundproblem zu
lösen.

Zwei Ergänzungen im Tool selbst:
- **Diagnose-Logging** (`js/svwsApi.js`, `request()`): `console.debug()` vor jedem Request
  (URL/method/mode/credentials) sowie `console.error()` bei fehlgeschlagenem `fetch()`
  (`error.name`/`error.message`/Request-Optionen, Authorization-Header nur als "gesetzt" geloggt), plus
  ein globaler `unhandledrejection`-Handler. Hinter einem Debug-Flag (`debugLogging`, standardmäßig
  `false`) - einschalten über `SvwsApi.setDebugLogging(true)` in der Browser-Konsole.
- **In-App-Hinweis:** Da sich ein LNA-Block browserseitig aus Sicherheitsgründen nicht zuverlässig von
  "Server generell nicht erreichbar" unterscheiden lässt (beides derselbe generische `TypeError`), zeigt
  bei jedem Netzwerkfehler (markiert über `err.isNetworkError`/`SvwsApi.isNetworkError()`) ein
  aufklappbarer Hinweis (`<details>`, `networkErrorHintHtml()` in `js/app.js`/`js/wartung.js`, jeweils
  direkt hinter der `.status-msg`-Zeile) beide möglichen Ursachen inkl. LNA-Lösungsschritten an, ohne eine
  davon zu behaupten. Aktuell verdrahtet bei "Verbinden" und "Schild-Daten laden" auf beiden Seiten (die
  naheliegendsten Erstkontakt-Stellen) - für weitere Stellen reicht es, `err` als 4. Argument an
  `setStatus()` zu übergeben.

### 2. "Leere Kurse suchen": Fach-/Kursart-Filter im Spaltenkopf

Umgesetzt (September 2026): Statt der Checkbox-Blöcke oberhalb der Tabelle gibt es jetzt in den
Spaltenköpfen "Fach" und "Kursart" der Ergebnistabelle (`wartung.html`) je eine ▾-Schaltfläche, die ein
Popover mit Checkboxen der tatsächlich gefundenen Werte öffnet – Auswahl wirkt sofort auf die Anzeige
(kein erneutes "Prüfen" nötig) und wird gespeichert. "Prüfen" selbst läuft jetzt ohne Vorbedingung über
alle Kurse mit 0 Schüler:innen.

### 3. Eigenes Wartungs-Tool `wartung.html`

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
bei Jahrgangs-/Klassen-Split). **Nachtrag:** Die wirklich zustandslosen Hilfsfunktionen darunter wurden
später doch ausgelagert, siehe Punkt 5 unten - die obige Begründung gilt seitdem nur noch für die
Funktionen, die tatsächlich Datei-lokalen Zustand brauchen.

### 4. Neuer Bereich "Blockung mit Leistungsdaten abgleichen" (wartung.html)

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

**Nachtrag (September 2026):** Auf Hinweis, dass eine Umwahl innerhalb desselben Fachs/derselben Kursart
(z.B. Sp-GK1 laut Blockung, aber tatsächlich Sp-GK2) unbemerkt blieb – der bis dahin einzige Kandidat je
Fach/Kursart wurde ungeprüft als Treffer gewertet, Kursnummer-Abgleich lief nur bei *mehreren* Kandidaten.
Neue Checkbox "Auch Kursbezeichnung (Kursnummer) und Lehrer:in … vergleichen" (Default: an) lässt diesen
Detail-Vergleich jetzt auch im (häufigsten) Ein-Kandidat-Fall laufen; zusätzlich wird, falls ladbar, der
Lehrer-Katalog (`SvwsApi.getLehrer()`, neu) für einen Lehrer-Kürzel-Abgleich herangezogen (Blockung liefert
Lehrer-Namen direkt mit, echte Kurse nur IDs). Beide Signale lösen nur bei tatsächlicher Abweichung einen
Hinweis aus, nie bei fehlender Bestimmbarkeit (kein Kürzel-Suffix bzw. kein ladbarer Katalog).

### 5. Neues `js/sharedCode.js` für echte Code-Duplikate zwischen app.js und wartung.js

Umgesetzt (September 2026), auf Nachfrage: `js/app.js` und `js/wartung.js` hatten rund 19 gleichnamige
Funktionen - beim genauen Durchsehen stellte sich heraus, dass nur ein Teil davon *wirklich* identisch
war (rein aus den Parametern berechnet, ohne versteckte Abhängigkeit von Datei-lokalem Zustand). Genau
dieser Teil (`$`, `reveal`, `escapeHtml`, `idFromLabel`, `kursLabel`, `schuelerLabel`,
`mapWithConcurrency`, `batchWithBisection`, `DEFAULT_JAHRGANG_KUERZEL`, `networkErrorHintHtml`,
`setStatus`) wurde nach `js/sharedCode.js` verschoben (als `window.SharedCode` exportiert, per
`<script>`-Tag von beiden Seiten eingebunden wie schon `svwsApi.js`/`storage.js` - kein Build-Schritt
nötig, da beide Module ohnehin schon so eingebunden werden). `app.js`/`wartung.js` holen sich die
Funktionen einmalig per Destructuring (`const { $, ... } = SharedCode;`), sodass der Rest jeder Datei
unverändert bleibt. `schuelerLabel()` bekam dafür einen zusätzlichen Parameter (die Klassen-Map statt
Zugriff über Closure) - beide Seiten legen sich einen kleinen 1-Zeilen-Wrapper an, damit bestehende
Aufrufe unverändert funktionieren.

Bewusst **nicht** verschoben: alles, was echten Datei-lokalen Laufzeit-Zustand braucht (Verbindungsaufbau,
"Neuen Kurs anlegen"-Dialog, Speichern/Laden, `onLoadSchildData()`/`refreshKursBelegung()` - Letztere
unterscheiden sich auch inhaltlich zwischen den Seiten). Eine Auslagerung davon würde entweder viele
Parameter durchreichen oder eine größere Umbau-Aktion (gemeinsam verwalteter Zustand) erfordern - siehe
aktualisierten Punkt 3 oben.
