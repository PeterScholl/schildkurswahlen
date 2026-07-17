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

  async function request(method, path, body) {
    if (!isConfigured()) throw new Error("SVWS-API ist nicht konfiguriert – bitte zuerst verbinden.");
    const url = `${baseUrl}${path}`;
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (networkError) {
      throw new Error(
        `Verbindung zu ${baseUrl} fehlgeschlagen. Läuft der Server? Bei selbstsigniertem Zertifikat: ` +
          `${baseUrl} einmal direkt im Browser öffnen und die Zertifikatswarnung bestätigen. (${networkError.message})`
      );
    }
    if (!response.ok) {
      throw new Error(await buildErrorMessage(response, url));
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
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

  global.SvwsApi = {
    configure,
    isConfigured,
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
    createKurs,
    getLernabschnittsdaten,
    createLeistungsdatenMultiple,
    createLeistungsdaten,
  };
})(window);
