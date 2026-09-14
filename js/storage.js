/**
 * Persistenz des Anwendungszustands: Autosave in localStorage sowie
 * manueller JSON-Export/Import. Die Schild-Zugangsdaten (Benutzer bleibt
 * erlaubt, Passwort NICHT) werden nie hier hindurchgereicht - app.js hält
 * das Passwort ausschließlich lokal und übergibt es nur an SvwsApi.configure().
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "schildKurswahlen.state.v1";
  const STATE_VERSION = 1;

  function getDefaultState() {
    return {
      version: STATE_VERSION,
      connection: { host: "", schema: "", username: "", jahr: new Date().getFullYear(), abschnitt: 1 },
      statusFilter: [],
      columnMapping: { nameCol: null, courseCols: [] },
      columnPrefixes: {}, // Spaltenindex (als String) -> Kürzel, das dem Kurstext vorangestellt wird
      courseSplitDelimiter: "", // Trennzeichen für Kurs-Rewrite (Schritt 3a); leer = kein Split
      splitJahrgangRows: [], // [{quellkursId, jahrgangId, zielkursId}] - wartung.html "Split in Jahrgangskurse", alle drei nur gültige IDs
      splitKlasseRows: [], // [{quellkursId, klasseId, zielkursId}] - wartung.html "Split in Klassenkurse", alle drei nur gültige IDs
      kurseOhneWahlFilter: { fachIds: [], kursarten: [] }, // index.html Schritt 8 "Kurse ohne Forms-Wahl"; leer = alle (Default)
      leereKurseFilter: { fachLabels: [], kursarten: [] }, // wartung.html "Leere Kurse suchen" (Spaltenkopf-Filter); leer = alle (Default)
      checkLeererKursFilter: { kursarten: [] }, // wartung.html "Leistungsdaten mit leerem Kurs" (Spaltenkopf-Filter, z.B. um "PUK" auszublenden); leer = alle (Default)
      pukFilter: { klassen: [] }, // wartung.html "Pflichtunterricht im Klassenverband (PUK) prüfen" (Spaltenkopf-Filter Klasse); leer = alle (Default)
      untisImport: null, // wartung.html "Abgleich Untis mit Leistungsdaten": zuletzt eingelesene GPU015.TXT
      // (Untis-Export "Kurswahl"), bleibt bis zum nächsten Einlesen gespeichert -
      // {dateiname, importDatumIso, trenner, zeilen: [{studentKurzname, unterrichtsnummer, fach, unterrichtsalias, klasse, statistikkennzeichen, studentennummer}]}
      schuelerMatching: {},
      kursMatching: {},
      transferStartRow: null, // Excel-Zeilennummer (1-basiert, Kopfzeile = Zeile 1); null/leer = alle Zeilen übertragen
      leistungsdatenDefaults: {
        kursartFallback: "",
        aufZeugnis: false,
        umfangLernstandsbericht: "V",
        wochenstundenFallback: 0,
        istEpochal: false,
      },
    };
  }

  /** Entfernt defensiv jedes Feld namens "password"/"passwort", egal wie tief verschachtelt. */
  function stripSecrets(obj) {
    if (Array.isArray(obj)) return obj.map(stripSecrets);
    if (obj && typeof obj === "object") {
      const clean = {};
      for (const [key, value] of Object.entries(obj)) {
        if (/^pass(wor)?t?$/i.test(key)) continue;
        clean[key] = stripSecrets(value);
      }
      return clean;
    }
    return obj;
  }

  function mergeWithDefaults(loaded) {
    const defaults = getDefaultState();
    if (!loaded || typeof loaded !== "object") return defaults;
    return {
      ...defaults,
      ...loaded,
      connection: { ...defaults.connection, ...(loaded.connection || {}) },
      columnMapping: { ...defaults.columnMapping, ...(loaded.columnMapping || {}) },
      columnPrefixes: loaded.columnPrefixes || {},
      leistungsdatenDefaults: { ...defaults.leistungsdatenDefaults, ...(loaded.leistungsdatenDefaults || {}) },
      kurseOhneWahlFilter: { ...defaults.kurseOhneWahlFilter, ...(loaded.kurseOhneWahlFilter || {}) },
      leereKurseFilter: { ...defaults.leereKurseFilter, ...(loaded.leereKurseFilter || {}) },
      checkLeererKursFilter: { ...defaults.checkLeererKursFilter, ...(loaded.checkLeererKursFilter || {}) },
      pukFilter: { ...defaults.pukFilter, ...(loaded.pukFilter || {}) },
      schuelerMatching: loaded.schuelerMatching || {},
      kursMatching: loaded.kursMatching || {},
      statusFilter: loaded.statusFilter || [],
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return getDefaultState();
      return mergeWithDefaults(stripSecrets(JSON.parse(raw)));
    } catch (e) {
      console.warn("Konnte gespeicherten Zustand nicht laden, verwende Defaults.", e);
      return getDefaultState();
    }
  }

  function saveStateNow(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripSecrets(state)));
  }

  let debounceTimer = null;
  function scheduleSave(state, delayMs = 400) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => saveStateNow(state), delayMs);
  }

  function exportJson(state) {
    const clean = stripSecrets(state);
    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `schild-kurswahlen-zustand-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importJson(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          resolve(mergeWithDefaults(stripSecrets(parsed)));
        } catch (e) {
          reject(new Error("Die Datei enthält kein gültiges JSON: " + e.message));
        }
      };
      reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
      reader.readAsText(file);
    });
  }

  global.Storage = {
    STORAGE_KEY,
    getDefaultState,
    loadState,
    saveStateNow,
    scheduleSave,
    exportJson,
    importJson,
    stripSecrets,
  };
})(window);
