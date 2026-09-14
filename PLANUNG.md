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

**Nachtrag 2 (September 2026):** Auf Nachfrage einen "Übernehmen"-Button ergänzt, der pro Ergebniszeile
(und per Checkbox-Auswahl auch für mehrere/alle in einem Rutsch) den laut Blockung erwarteten Kurs direkt
in die Leistungsdaten einträgt (ersetzt dabei einen ggf. vorhandenen falschen Eintrag). Der dafür nötige
*echte* Zielkurs wird - anders als beim reinen Anzeigen - über den kompletten Kurskatalog (nicht nur die
Kurse der/des Schülerin/Schülers) per Fach+Kursart(+Kursnummer) aufgelöst, da im "fehlt"-Fall noch gar kein
eigener Kurs existiert, an dem man sich orientieren könnte. Nicht eindeutig auflösbare ("unsicher")
Zeilen bekommen bewusst keinen Button, bleiben zur manuellen Prüfung stehen. Wiederverwendet dafür die
bereits vorhandene Split-Infrastruktur (`buildSplitLeistungsdatenPayload()`, `batchWithBisection()`,
`createLeistungsdatenMultiple()`/`deleteLeistungsdatenMultiple()`) - daher trotz Umfang kein grundlegend
neuer Mechanismus.

**Nachtrag 3 (September 2026):** Mit echten Daten getestet - bei "fehlt"-Zeilen suchte die
Zielkurs-Bestimmung anfangs im *kompletten* Kurskatalog des Schuljahresabschnitts (alle Jahrgänge), was
z.B. bei "Sport GK" zu unplausibel vielen (14) Kandidaten führte, obwohl in der eigenen Stufe nur wenige
infrage kommen. Fix: zusätzliche Einschränkung auf den echten Schild-Jahrgang der/des Schülerin/Schülers
(`schueler.idJahrgang` gegen `KursDaten.idJahrgaenge`), siehe Fehlerbehebung 13 in README.md.

**Nachtrag 4 (September 2026):** "Übernehmen" bei "abweichender Kurs" schlug real mit HTTP 409 fehl. Erste
(unbestätigte) Vermutung: Unique-Constraint durch die "neu anlegen, dann alten löschen"-Reihenfolge - Fix:
`SvwsApi.patchLeistungsdaten()` (`PATCH /schueler/leistungsdaten/{id}`) statt Ersetzen. Beim erneuten Test
schlug aber auch das PATCH mit 409 fehl, was die Unique-Constraint-These widerlegte. Diesmal im
SVWS-Server-Quellcode nachvollzogen (öffentliches Repo, `git clone --sparse`): Der eigentliche Fehler lag
im mitgeschickten `kursart`-Feld (allgemeine Kursart "GK" statt der dort erwarteten spezifischen Kürzel
wie "GKM"/"AB3"/"AB4") sowie einem zusätzlichen `fachID`-Feld, das serverseitig `Kurs_ID` wieder auf `null`
zurücksetzt. Fix: Patch/Create-Payload schicken jetzt nur noch `kursID` (+ `wochenstunden`/bei Neuanlage
`fachID`) - der Server leitet Kursart und Fachlehrer selbst her. Siehe Fehlerbehebung 14+15 in README.md.

**Nachtrag 5 (September 2026):** Auf Meldung, dass vertauschte AB3-/AB4-Kennzeichnungen (3. vs. 4.
Abiturfach) nicht erkannt wurden - Kursnummer und Lehrer bleiben dabei gleich (derselbe Kurs), nur die
Kennzeichnung selbst ist falsch, und die steht nur auf dem Leistungsdaten-Eintrag selbst
(`SchuelerLeistungsdaten.kursart`), nicht auf Blockung oder Kurs. Fix: Neue Funktion
`SvwsApi.getGostAbiturjahrgangLaufbahndaten()` lädt die Abiturdaten der ganzen Stufe (welches Fach ist bei
wem das 3./4. Abiturfach, `AbiturFachbelegung.abiturFach`) als dritte, unabhängige Quelle - bei
Grundkursen wird die daraus erwartete Kursart (AB3/AB4) gegen den Leistungsdaten-Eintrag verglichen. Siehe
Fehlerbehebung 16 in README.md.

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

### 6. Neuer Bereich "Abgleich Untis mit Leistungsdaten" (wartung.html)

Umgesetzt (September 2026): Liest einen Untis-Export (Datei "GPU015.TXT", Kurswahl der Studenten - DIF-
Format) ein und vergleicht ihn mit den Leistungsdaten einer wählbaren Jahrgangsstufe. Die Datei bleibt nach
dem Einlesen im `state` (JSON) gespeichert, bis eine neue eingelesen wird - kein erneutes Hochladen pro
Sitzung nötig. Zwei Checkboxen: "Kursbezeichnung abgleichen" (funktioniert, Default an) und "Lehrer:in
abgleichen" (aktuell deaktiviert, s.u.).

Vor der Umsetzung wurde recherchiert (offizielle Untis-Doku, `untis.at/manual`) und mit Rückfrage an den
Nutzer geklärt, statt blind zu raten:

- Das Feldtrennzeichen ist bei Untis beim Export frei wählbar (kein fester Standard) - wird deshalb aus der
  Datei selbst erkannt, nicht fest angenommen.
- **GPU015.txt enthält laut Doku kein Lehrer-Feld** - das stünde nur in einer separaten Datei (GPU002.txt,
  "Unterricht"). Auf Nachfrage entschieden: fürs Erste nur Kursbezeichnung abgleichen, die
  Lehrer-Abgleich-Checkbox schon in der UI vorsehen, aber deaktiviert ("noch nicht verfügbar, benötigt
  zusätzlich GPU002.txt") - Einlesen einer zweiten Datei und Verknüpfung über "Unterrichtsnummer" bleibt
  eine mögliche spätere Erweiterung.
- Schüler:innen werden über Feld 7 ("Studentennummer") der Schild-internen Schüler-ID zugeordnet - auf
  Nachfrage bestätigt, dass das bei diesem Nutzer zutrifft (Untis wurde ursprünglich mit Schild-Daten
  importiert).

Bewusst noch **nicht** umgesetzt (auf expliziten Wunsch, um den ersten Wurf klein zu halten): Rewrite-Regeln
für Kursbezeichnungen und eine Liste nicht zu beachtender Elemente ("kann später erweitert werden") sowie
jegliche Lösch-/Änderungsfunktion (anders als beim Blockung-Abgleich aktuell kein "Übernehmen").

**Nachtrag (September 2026):** Mit echten Daten getestet - real existierende Kurse wie "BI-GK2" wurden als
"unbekanntes Fach-Kürzel in Schild" gemeldet. Ursache: Bei diesem Nutzer trägt Untis' Feld "Fach" nicht das
bloße Fachkürzel ("BI"), sondern bereits die komplette Kursbezeichnung ("BI-GK2") - der ursprüngliche
Abgleich nur gegen die Schild-Fachkürzel-Tabelle fand das naturgemäß nicht. Fix: zweistufige Auflösung -
zuerst wird versucht, "Fach" direkt gegen den echten (schulweiten) Kurskatalog aufzulösen, erst danach
gegen die bloßen Fachkürzel. Siehe README.md, Abschnitt zu `onRunUntisAbgleich()`.

**Nachtrag 2 (September 2026):** Auf Nachfrage die erste konkrete Erweiterung der beiden ursprünglich
zurückgestellten Punkte umgesetzt - Kursart-Abgleich (mit Rewrite-Regel) statt der ganzen offenen Liste
nicht zu beachtender Elemente, die weiterhin offen bleibt:

- Neue Checkbox **"Kursart abgleichen"** (Default an): "Statistikkennzeichen" (Feld 6 der Untis-Datei) wird
  über eine feste Tabelle (1/2/3/4/M/S/Z → LK1/LK2/AB3/AB4/GKM/GKS/ZK, laut Nutzerangabe für diese Schule
  gültig) in die spezifische Kursart übersetzt und gegen `SchuelerLeistungsdaten.kursart` verglichen (nicht
  `KursDaten.kursartAllg` - das kennt diese Unterscheidung nicht). Ein leeres oder unbekanntes
  Statistikkennzeichen wird selbst gemeldet ("Kursart in Untis-Datei fehlt"/"unbekanntes
  Statistikkennzeichen") statt stillschweigend übersprungen zu werden - eigens nachgefragt: "leere
  Kursarten in der GPU wären auch Mist und zu melden".
- Erste **Rewrite-Regel** als eigene Checkbox **"AB3/AB4 als GKS werten"** (Default aus, nur wirksam
  zusammen mit "Kursart abgleichen") - manchmal nötig, weil AB3/AB4 (3./4. Abiturfach) bei manchen Schulen
  nicht 1:1 dem in Schild hinterlegten Kursart-Kürzel entspricht. Bewusst als eigenständige, unabhängig
  schaltbare Checkbox (nicht Teil von "Kursart abgleichen" selbst) - Vorlage für weitere Rewrite-Regeln,
  die bei Bedarf als weitere Checkboxen ergänzt werden können, bis sich ein Muster für eine generischere
  Regel-Liste abzeichnet.

**Nachtrag 3 (September 2026):** Auf Nachfrage die eine Rewrite-Regel-Checkbox "AB3/AB4 als GKS werten" in
zwei unabhängig schaltbare Checkboxen aufgeteilt - eine für die Untis-Seite (`rewriteUntisAb34ZuGks`), eine
für die Schild-Seite (`rewriteSchildAb34ZuGks`). Grund: Untis-Statistikkennzeichen und
Schild-Leistungsdaten sind zwei getrennt gepflegte Datenquellen, AB3/AB4 kann auf jeder für sich falsch
gesetzt sein - eine gemeinsame Regel für beide Seiten wäre entweder zu grob (trifft auch die richtige
Seite) oder zu schwach (deckt nur eine Seite ab).

### 7. Neuer Bereich "Pflichtunterricht im Klassenverband (PUK) prüfen" (wartung.html)

Umgesetzt (September 2026): Reiner Klassenunterricht ohne eigenen Kurs trägt an manchen Schulen die
Kursart "PUK" direkt auf dem Leistungsdaten-Eintrag (kein `kursID` nötig) - andere Kursarten sind irgendwo
als echter Kurs abgebildet und werden von den übrigen Wartungs-Bausteinen bereits geprüft (leerer Kurs,
Blockung, Untis). Neuer Baustein geht alle Klassen durch und prüft je Fach und Klasse zwei Dinge:

- **Lehrer-Vergleich**: haben alle Schüler:innen der Klasse für dieses Fach dieselbe Lehrkraft eingetragen?
- **Vollständigkeits-Vergleich**: haben wirklich *alle* Schüler:innen der Klasse dieses Fach als PUK
  eingetragen - Pflichtunterricht betrifft die ganze Klasse, fehlt es bei einem Teil, ist das auffällig.

Ergebnistabelle im Spaltenkopf **Klasse** filterbar (dasselbe Excel-artige Popover-Muster wie bei "Leere
Kurse suchen"/"Leistungsdaten mit leerem Kurs"), fehlende Schüler:innen mit bis zu 10 Namen einsehbar
(analog zum Untis-Abgleich). Dabei den Lehrer-Katalog-Lazy-Load aus dem Blockung-Abgleich
(`SvwsApi.getLehrer()` bei Bedarf, in `lehrerById` gecacht) in einen gemeinsamen Helper
`ensureLehrerKatalogGeladen()` gezogen, den jetzt beide Bausteine nutzen. Rein lesende Prüfung ohne
Lösch-/Änderungsfunktion.

**Nachtrag (September 2026):** Auf Rückmeldung, dass ein Hover-Tooltip (natives `title`-Attribut, wie
zunächst hier und beim Untis-Abgleich für die Namenslisten genutzt) "nicht so günstig" ist, durch ein
(i)-Symbol mit eigenem Overlay ersetzt. Neue gemeinsame Funktion
`SharedCode.infoPopoverHtml(items, summaryTitle)` (kürzt selbst auf 10 Einträge + "… und N weitere")
ersetzt die bisherige `statusEl.title`-Zuweisung beim Untis-Abgleich und die `title`-Zellenattribute bei
der PUK-Prüfung - an beiden Stellen konsistent umgestellt, nicht nur an der zuletzt bemängelten.

**Nachtrag 2 (September 2026):** Die erste Fassung von `infoPopoverHtml()` nutzte ein natives `<details>`
(Klick zum Öffnen) - das fügt den Inhalt aber in den normalen Textfluss ein, wodurch sich beim Öffnen
Tabellenzeilen sichtbar verschoben ("die Darstellung verrückt sich"). Auf Rückmeldung umgebaut auf ein
reines CSS-Hover-Overlay (`.info-popover-content` mit `position: absolute`, siehe css/style.css) - blendet
sich über den Inhalt statt ihn zu verschieben, per Maus-Hover oder Tastaturfokus (`:focus-within`)
erreichbar über einen echten `<button>` statt nur Text.
