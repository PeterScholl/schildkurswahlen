/**
 * Client für die SVWS-Server-REST-API (Schild3).
 * Zugangsdaten (Benutzer/Passwort) werden ausschließlich im Modul-State gehalten
 * und NIEMALS an Storage.js übergeben oder in localStorage/JSON geschrieben.
 */
(function (global) {
  "use strict";

  let baseUrl = "";
  let authHeader = "";
  let username = "";

  /** Debug-Flag fürs Request-Logging (siehe request() unten) - Stand September 2026 standardmäßig AUS,
   *  nachdem das ursprüngliche Firefox-Problem geklärt ist (siehe PLANUNG.md). Bei Bedarf in der
   *  Browser-Konsole wieder einschalten: `SvwsApi.setDebugLogging(true)` (persistiert nicht, gilt nur bis
   *  zum nächsten Neuladen der Seite). */
  let debugLogging = false;
  function setDebugLogging(enabled) {
    debugLogging = !!enabled;
  }

  function configure({ host, schema, username: user, password }) {
    const cleanHost = String(host || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
    baseUrl = `https://${cleanHost}/db/${encodeURIComponent(schema)}`;
    username = user || "";
    authHeader = "Basic " + btoa(unescape(encodeURIComponent(`${user || ""}:${password || ""}`)));
  }

  function isConfigured() {
    return !!baseUrl && !!authHeader;
  }

  function getUsername() {
    return username;
  }

  function getBaseUrl() {
    return baseUrl;
  }

  /** true, wenn `err` aus dem generischen fetch()-Fehlschlag in request() stammt (Server nicht
   *  erreichbar/blockiert, siehe dortiger Kommentar) - für die UI, um optional einen Hinweis mit
   *  möglichen Ursachen anzuzeigen. */
  function isNetworkError(err) {
    return !!(err && err.isNetworkError);
  }

  function friendlyError(status, url) {
    switch (status) {
      case 401:
        return "Anmeldung fehlgeschlagen (401) – Benutzername oder Passwort falsch.";
      case 403:
        return "Zugriff verweigert (403) – der Benutzer hat keine Rechte für diese Daten.";
      case 404:
        return "Nicht gefunden (404) – Schema, Abschnitt oder Datensatz existiert nicht.";
      default:
        if (status >= 500) return `Serverfehler (${status}) beim Zugriff auf den SVWS-Server.`;
        return `Unerwarteter HTTP-Status ${status} bei ${url}`;
    }
  }

  /** Diagnose-Logging (Stand September 2026, siehe PLANUNG.md), half beim Eingrenzen eines
   *  Firefox-spezifischen Verbindungsproblems (Local Network Access, siehe request() unten) - alle
   *  Aufrufe hier laufen über *dieselbe* request()-Funktion mit identischen fetch()-Optionen (auch
   *  "Verbinden"/getStammdaten() - keine Sonderbehandlung). Standardmäßig aus (`debugLogging = false`
   *  oben); bei Bedarf über `SvwsApi.setDebugLogging(true)` in der Browser-Konsole wieder einschalten. */
  function safeHeadersForLog(headers) {
    const clone = { ...headers };
    if (clone.Authorization) clone.Authorization = "(gesetzt, Wert nicht geloggt)";
    return clone;
  }

  async function request(method, path, body) {
    if (!isConfigured()) throw new Error("SVWS-API ist nicht konfiguriert – bitte zuerst verbinden.");
    const url = `${baseUrl}${path}`;
    const options = {
      method,
      mode: "cors", // entspricht dem fetch()-Standardverhalten bei Cross-Origin-Requests - jetzt nur
      credentials: "same-origin", // explizit gemacht, um es unten mitloggen zu können; keine Verhaltensänderung
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    };
    if (debugLogging) {
      console.debug(
        "[svwsApi] Anfrage:",
        url,
        "method:", options.method,
        "mode:", options.mode,
        "credentials:", options.credentials
      );
    }

    let response;
    try {
      response = await fetch(url, options);
    } catch (networkError) {
      if (debugLogging) {
        console.error(
          "[svwsApi]", url, networkError.name, networkError.message,
          JSON.stringify({ method: options.method, mode: options.mode, credentials: options.credentials, headers: safeHeadersForLog(options.headers) })
        );
      }
      // Jeder fetch()-Abbruch vor Erhalt einer Antwort (Server nicht erreichbar, Zertifikatsproblem,
      // vom Browser blockiert z.B. durch CORS oder Firefox' "Local Network Access", ...) landet hier -
      // der Browser unterscheidet das aus Sicherheitsgründen nicht im Detail (nur generischer
      // TypeError). `isNetworkError` markiert diese ganze Klasse für die UI (siehe isNetworkError()
      // unten), die daraufhin einen Hinweis mit möglichen Ursachen anzeigen kann - ohne zu behaupten,
      // welche davon tatsächlich zutrifft.
      const fehler = new Error(
        `Verbindung zu ${baseUrl} fehlgeschlagen. Läuft der Server? Bei selbstsigniertem Zertifikat: ` +
          `${baseUrl} einmal direkt im Browser öffnen und die Zertifikatswarnung bestätigen. (${networkError.message})`
      );
      fehler.isNetworkError = true;
      throw fehler;
    }
    if (!response.ok) {
      throw new Error(await buildErrorMessage(response, url));
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  /** Fängt Fehler ab, die aus irgendeinem Grund nicht in einem try/catch der aufrufenden Seite landen
   *  (z.B. vergessenes .catch() in einer Promise-Kette) - reine Diagnose-Ergänzung, ändert an der
   *  eigentlichen Fehlerbehandlung nichts. Wird nur einmal registriert, auch wenn svwsApi.js aus
   *  irgendeinem Grund mehrfach eingebunden würde. */
  if (!global.__svwsApiUnhandledRejectionLogged) {
    global.__svwsApiUnhandledRejectionLogged = true;
    global.addEventListener("unhandledrejection", (evt) => {
      const err = evt.reason;
      console.error(
        "[svwsApi] unhandledrejection:",
        err && err.name,
        err && err.message,
        err
      );
    });
  }

  /** Baut aus einer Fehlerantwort eine Meldung inkl. Server-Rückmeldung, egal ob diese JSON oder
   *  Klartext ist (z.B. "Das Patchen des Attributes X wird nicht unterstützt."). */
  async function buildErrorMessage(response, url) {
    const base = friendlyError(response.status, url);
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      // Body nicht lesbar -> ohne Detail fortfahren
    }
    if (!bodyText) return base;
    let detail = bodyText;
    try {
      const parsed = JSON.parse(bodyText);
      detail = parsed.message || parsed.error || JSON.stringify(parsed);
    } catch {
      // keine JSON-Antwort -> Rohtext unverändert als Detail verwenden
    }
    return `${base} Rückmeldung des Servers: "${detail}"`;
  }

  async function getStammdaten() {
    return request("GET", "/schule/stammdaten");
  }

  async function getAbschnittId(jahr, abschnitt) {
    const stammdaten = await getStammdaten();
    const eintrag = (stammdaten.abschnitte || []).find(
      (a) => a.schuljahr === Number(jahr) && a.abschnitt === Number(abschnitt)
    );
    return eintrag ? eintrag.id : null;
  }

  async function getStatusKatalog() {
    return request("GET", "/schule/schueler/status");
  }

  async function getSchuelerListe(abschnittId) {
    return request("GET", `/schueler/abschnitt/${abschnittId}`);
  }

  async function getKurse(abschnittId) {
    return request("GET", `/kurse/abschnitt/${abschnittId}`);
  }

  async function getFaecher() {
    return request("GET", "/faecher");
  }

  async function getKursarten() {
    return request("GET", "/kurse/allgemein/kursarten");
  }

  async function getJahrgaenge() {
    return request("GET", "/jahrgaenge");
  }

  /** Erstellt einen neuen Kurs und gibt die von Schild vergebenen Daten (inkl. neuer ID) zurück. */
  async function createKurs(kursDaten) {
    return request("POST", "/kurse/create", kursDaten);
  }

  /** Liefert KlassenDaten inkl. eingebettetem `schueler[]`-Array je Klasse (Kürzel + Mitglieder).
   *  Bewusst `/details/` statt `/minimal/` verwendet: Auf mindestens einer SVWS-Server-Instanz
   *  antwortet die CORS-Preflight-Anfrage für `/klassen/minimal/abschnitt/{id}` mit einem
   *  Server-Fehler (500) - der details-Endpunkt funktioniert dort einwandfrei. */
  async function getKlassen(abschnittId) {
    return request("GET", `/klassen/details/abschnitt/${abschnittId}`);
  }

  async function getLernabschnittsdaten(schuelerId, abschnittId) {
    return request("GET", `/schueler/${schuelerId}/abschnitt/${abschnittId}/lernabschnittsdaten`);
  }

  async function createLeistungsdatenMultiple(list) {
    return request("POST", "/schueler/leistungsdaten/create/multiple", list);
  }

  async function createLeistungsdaten(einzelDatensatz) {
    return request("POST", "/schueler/leistungsdaten/create", einzelDatensatz);
  }

  /** Patcht einzelne Felder eines bestehenden Leistungsdaten-Eintrags (Merge-Patch nach RFC 7386) - z.B.
   *  um bei "Blockung mit Leistungsdaten abgleichen" (wartung.html) "Übernehmen" die Kurszuordnung zu
   *  korrigieren, ohne den Eintrag zu löschen und neu anzulegen (das schlägt serverseitig mit HTTP 409
   *  fehl, solange zum selben Fach/Lernabschnitt noch ein anderer Eintrag existiert - siehe Fehlerbehebung
   *  in README.md). Läuft im normalen Server-Modus (anders als DELETE /kurse/delete/multiple). */
  async function patchLeistungsdaten(id, patch) {
    return request("PATCH", `/schueler/leistungsdaten/${id}`, patch);
  }

  /** Löscht mehrere Leistungsdaten anhand ihrer IDs, gibt die gelöschten Datensätze zurück. */
  async function deleteLeistungsdatenMultiple(ids) {
    return request("DELETE", "/schueler/leistungsdaten/delete/multiple", ids);
  }

  /** Löscht mehrere Kurse anhand ihrer IDs. Anders als bei Leistungsdaten antwortet dieser Endpunkt
   *  pro Kurs einzeln mit `{id, success, log[]}` statt alles-oder-nichts - eine Bisection ist hier also
   *  nicht nötig, die Erfolgs-/Fehlerauswertung passiert direkt anhand der Antwort. */
  async function deleteKurseMultiple(ids) {
    return request("DELETE", "/kurse/delete/multiple", ids);
  }

  /** Patcht einzelne Felder eines Kurses (Merge-Patch, RFC 7386 - nur die im `patch`-Objekt enthaltenen
   *  Felder werden geändert). Anders als DELETE /kurse/delete/multiple läuft dieser Endpunkt im
   *  ServerMode STABLE, ist also ohne besondere Server-Konfiguration nutzbar. */
  async function patchKurs(id, patch) {
    return request("PATCH", `/kurse/${id}`, patch);
  }

  // ---------- Gymnasiale Oberstufe (Gost) - für wartung.html "Blockung mit Leistungsdaten abgleichen" ----------

  /** Liefert alle Abiturjahrgänge (Stufen der Oberstufe), die im angegebenen Schuljahresabschnitt bekannt
   *  sind - inkl. eines Platzhalter-Eintrags `abiturjahr: -1` ("Allgemeine Vorlagen"), den Aufrufer selbst
   *  herausfiltern müssen. */
  async function getGostAbiturjahrgaenge(abschnittId) {
    return request("GET", `/gost/abiturjahrgaenge/${abschnittId}`);
  }

  /** Liefert die Blockungen (Planungsstände) eines Abiturjahrgangs für ein bestimmtes Gost-Halbjahr
   *  (0=EF.1 … 5=Q2.2). */
  async function getGostBlockungen(abiturjahr, halbjahr) {
    return request("GET", `/gost/abiturjahrgang/${abiturjahr}/${halbjahr}/blockungen`);
  }

  /** Liefert ein konkretes Blockungsergebnis (die tatsächliche Schüler-Kurs-Zuordnung einer Blockung,
   *  gruppiert nach Schienen) anhand seiner Ergebnis-ID. */
  async function getGostBlockungsergebnis(ergebnisId) {
    return request("GET", `/gost/blockungen/zwischenergebnisse/${ergebnisId}`);
  }

  /** Liefert die Grunddaten einer Blockung inkl. `kurse[]` (mit Kursnummer/Suffix je Blockungs-Kurs -
   *  das Blockungsergebnis selbst liefert das nicht). WICHTIG: Die Kurs-IDs innerhalb einer Blockung
   *  (`Gost_Blockung_Kurse.ID`) sind eine eigene, von der normalen Kurse-Tabelle unabhängige ID-Reihe -
   *  niemals gegen den normalen Kurskatalog (kursById) auflösen, siehe Fehlerbehebung in README.md. */
  async function getGostBlockungsdaten(blockungsId) {
    return request("GET", `/gost/blockungen/${blockungsId}`);
  }

  /** Liefert die Abiturdaten (inkl. `fachbelegungen[]` mit `fachID`/`abiturFach` 1-4) aller Schüler:innen
   *  eines Abiturjahrgangs in einem Aufruf - für "Blockung mit Leistungsdaten abgleichen" (wartung.html),
   *  um je Fach zu wissen, ob es bei einer/einem Schülerin/Schüler als 3. oder 4. Abiturfach (GK) gewählt
   *  wurde. Das ist die einzige verlässliche Quelle dafür - weder die Blockung noch der Kurs selbst kennen
   *  diese Unterscheidung, nur die Leistungsdaten-Kursart (AB3/AB4) *soll* sie widerspiegeln, tut das laut
   *  Fehlerbehebung in README.md aber nicht immer zuverlässig. */
  async function getGostAbiturjahrgangLaufbahndaten(abiturjahr) {
    return request("GET", `/gost/abiturjahrgang/${abiturjahr}/laufbahndaten`);
  }

  /** Liefert den kompletten Lehrer-Katalog der Schule (Kürzel/Name je Lehrkraft) - für
   *  "Blockung mit Leistungsdaten abgleichen" (wartung.html), um die Lehrer-IDs an echten Kursen
   *  (`KursDaten.lehrer`/`weitereLehrer`) mit den in der Blockung hinterlegten Namen/Kürzeln vergleichbar
   *  zu machen. */
  async function getLehrer() {
    return request("GET", "/lehrer");
  }

  global.SvwsApi = {
    configure,
    isConfigured,
    isNetworkError,
    setDebugLogging,
    getUsername,
    getBaseUrl,
    getStammdaten,
    getAbschnittId,
    getStatusKatalog,
    getSchuelerListe,
    getKurse,
    getFaecher,
    getKlassen,
    getKursarten,
    getJahrgaenge,
    createKurs,
    getGostAbiturjahrgaenge,
    getGostBlockungen,
    getGostBlockungsergebnis,
    getGostBlockungsdaten,
    getGostAbiturjahrgangLaufbahndaten,
    getLehrer,
    getLernabschnittsdaten,
    createLeistungsdatenMultiple,
    createLeistungsdaten,
    patchLeistungsdaten,
    deleteLeistungsdatenMultiple,
    deleteKurseMultiple,
    patchKurs,
  };
})(window);
