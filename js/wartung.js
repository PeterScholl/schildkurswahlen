/**
 * Orchestrierung für wartung.html: eigenständige Wartungs-Werkzeuge auf den in Schild vorhandenen
 * Kurs-/Schülerdaten, unabhängig vom Forms-Abgleich (der lebt weiter in index.html/app.js). Strukturell
 * bewusst ein eigenständiges, zweites Skript (statt eines gemeinsam mit app.js geteilten Moduls) - beide
 * Seiten teilen sich zwar denselben persistenten Zustand (state, aus storage.js, via localStorage), aber
 * jede Seite verdrahtet nur die auf ihr tatsächlich vorhandenen DOM-Elemente.
 *
 * Geteilter Zustand mit index.html (über denselben localStorage-Key "schildKurswahlen.state.v1"):
 * Verbindungsdaten (außer Passwort - wie überall in dieser Anwendung nie gespeichert), Status-Filter,
 * splitJahrgangRows/splitKlasseRows und leereKurseFilter. Änderungen hier sind also auf index.html
 * sichtbar (z.B. löst "Kurse ohne Forms-Wahl" dort die hier konfigurierten Splits rückwärts auf) und
 * umgekehrt - funktioniert zuverlässig, wenn beide Seiten über denselben lokalen Webserver (oder in
 * Chrome auch direkt per Doppelklick) geöffnet werden; manche Browser (z.B. Firefox) trennen bei
 * file://-URLs den localStorage pro Datei, dann muss die Verbindung auf jeder Seite einzeln eingegeben
 * werden.
 */
(function () {
  "use strict";

  let state = Storage.loadState();

  // Laufzeit-Daten (nicht persistiert)
  let abschnittId = null;
  let statusKatalog = [];
  let schildSchueler = [];
  let schildKurse = [];
  let schildFaecher = [];
  let schildKlassen = [];
  let schildKursarten = []; // Katalog gültiger Kursarten (für "Neuen Kurs anlegen"-Dialog)
  let schildJahrgaenge = []; // Katalog aller Jahrgänge (für "Neuen Kurs anlegen"-Dialog)
  let schuelerById = new Map();
  let kursById = new Map();
  let schuelerIdToKlasse = new Map(); // Schüler-ID -> Klassen-Kürzel, aus KlassenDaten.schueler[] gebaut
  let createKursOnCreated = null; // Callback(neuerKurs), der nach erfolgreichem Anlegen im Dialog aufgerufen wird

  // "Automatischer Vorschlag" für "Split in Jahrgangskurse" - Wegwerf-Zwischenergebnis, bewusst nicht
  // in state/localStorage persistiert.
  let autosplitProposalRows = []; // [{jahrgangId, jahrgangLabel, anzahlSchueler, zielkursValue, bezeichnung, fachId, kursart, wochenstunden}]
  let autosplitQuellkursId = null;

  // Dasselbe für "Split in Klassenkurse" - eigener, paralleler State (wie die Split-Tabellen selbst).
  let autosplitKlasseProposalRows = []; // [{klasseId, klasseLabel, klasseJahrgangId, anzahlSchueler, zielkursValue, bezeichnung, fachId, kursart, wochenstunden}]
  let autosplitKlasseQuellkursId = null;

  // ---------- Hilfsfunktionen ----------
  // Rein zustandslose Utilities kommen aus js/sharedCode.js (identisch von js/app.js genutzt, siehe
  // dortiger Kopfkommentar) - hier nur als lokale Bindings, damit der Rest der Datei unverändert
  // `$(...)`, `escapeHtml(...)` usw. aufrufen kann.
  const { $, reveal, escapeHtml, idFromLabel, kursLabel, mapWithConcurrency, batchWithBisection, DEFAULT_JAHRGANG_KUERZEL, setStatus } =
    SharedCode;

  function persist() { Storage.scheduleSave(state); }

  /** Wrapper um SharedCode.schuelerLabel(): reicht das hier lokal geladene schuelerIdToKlasse mit durch
   *  (jede Seite pflegt ihre eigene, unabhängig geladene Map), damit bestehende Aufrufe `schuelerLabel(s)`
   *  unverändert funktionieren. */
  function schuelerLabel(s) {
    return SharedCode.schuelerLabel(s, schuelerIdToKlasse);
  }

  /** Wie kursLabel(), aber mit Schülerzahl in Klammern - die Zahl kommt aus dem eingebetteten
   *  `schueler[]`-Array der zuletzt geladenen Kursdaten. Nur hier gebraucht (Split-Tabellen), daher nicht
   *  in sharedCode.js. */
  function kursLabelMitAnzahl(k) {
    const zeugnis = k.bezeichnungZeugnis ? ` – ${k.bezeichnungZeugnis}` : "";
    const anzahl = (k.schueler || []).length;
    return `${k.kuerzel}${zeugnis} (${anzahl}) [${k.id}]`;
  }

  // ---------- 1. Verbindung ----------

  function populateConnectionFields() {
    $("conn-host").value = state.connection.host || "";
    $("conn-schema").value = state.connection.schema || "";
    $("conn-username").value = state.connection.username || "";
    $("conn-jahr").value = state.connection.jahr || new Date().getFullYear();
    $("conn-abschnitt").value = state.connection.abschnitt || 1;
  }

  async function onConnect() {
    const host = $("conn-host").value.trim();
    const schema = $("conn-schema").value.trim();
    const username = $("conn-username").value.trim();
    const password = $("conn-password").value;
    const jahr = Number($("conn-jahr").value);
    const abschnitt = Number($("conn-abschnitt").value);

    if (!host || !schema || !username) {
      setStatus($("connect-status"), "Bitte Host, Schema und Benutzername angeben.", "error");
      return;
    }

    SvwsApi.configure({ host, schema, username, password });
    setStatus($("connect-status"), "Verbinde …", "");

    try {
      const id = await SvwsApi.getAbschnittId(jahr, abschnitt);
      if (!id) {
        setStatus($("connect-status"), `Kein Schuljahresabschnitt ${jahr}.${abschnitt} gefunden.`, "error");
        return;
      }
      abschnittId = id;
      statusKatalog = await SvwsApi.getStatusKatalog();

      state.connection = { host, schema, username, jahr, abschnitt };
      persist();

      renderStatusKatalog();
      setStatus($("connect-status"), `Verbunden – Abschnitt-ID ${abschnittId}.`, "ok");
      reveal("status-katalog-wrapper");
      reveal("section-schild-data");
    } catch (err) {
      setStatus($("connect-status"), err.message, "error", err);
    }
  }

  function renderStatusKatalog() {
    const container = $("status-katalog-container");
    container.innerHTML = "";
    const defaultTexts = ["aktiv", "extern", "aufnahme"];
    const hasSavedFilter = state.statusFilter && state.statusFilter.length > 0;
    for (const eintrag of statusKatalog) {
      const checked = hasSavedFilter
        ? state.statusFilter.includes(eintrag.id)
        : defaultTexts.includes(String(eintrag.text).toLowerCase());
      const label = document.createElement("label");
      label.innerHTML = `<input type="checkbox" value="${eintrag.id}" ${checked ? "checked" : ""}/> ${eintrag.text}`;
      label.querySelector("input").addEventListener("change", onStatusFilterChange);
      container.appendChild(label);
    }
    onStatusFilterChange();
  }

  function onStatusFilterChange() {
    const checked = Array.from($("status-katalog-container").querySelectorAll("input:checked")).map((i) =>
      Number(i.value)
    );
    state.statusFilter = checked;
    persist();
  }

  // ---------- 2. Schild-Daten laden ----------

  async function onLoadSchildData() {
    const statusEl = $("schild-data-status");
    setStatus(statusEl, "Lade Schüler, Kurse und Fächer …", "");
    try {
      const [schuelerAlle, kurse, faecher] = await Promise.all([
        SvwsApi.getSchuelerListe(abschnittId),
        SvwsApi.getKurse(abschnittId),
        SvwsApi.getFaecher(),
      ]);
      const erlaubteStatus = new Set(state.statusFilter);
      schildSchueler = schuelerAlle.filter((s) => erlaubteStatus.has(s.status));
      schildKurse = kurse;
      schildFaecher = faecher;

      schuelerById = new Map(schildSchueler.map((s) => [s.id, s]));
      kursById = new Map(schildKurse.map((k) => [k.id, k]));

      // Klassen sind nur eine Zusatzinfo (Split nach Klasse, Schüler-Label) - ein Fehler hier soll nicht
      // den ganzen Schritt blockieren, falls dieser Endpunkt auf einem Server mal nicht verfügbar ist.
      let klassenHinweis = "";
      try {
        schildKlassen = await SvwsApi.getKlassen(abschnittId);
        schuelerIdToKlasse = new Map();
        for (const klasse of schildKlassen) {
          const kuerzel = klasse.kuerzel || klasse.beschreibung || "–";
          for (const s of klasse.schueler || []) schuelerIdToKlasse.set(s.id, kuerzel);
        }
      } catch (klassenErr) {
        schildKlassen = [];
        schuelerIdToKlasse = new Map();
        klassenHinweis = " Klassen konnten nicht geladen werden (\"Split in Klassenkurse\" bleibt ohne Klassenliste).";
        console.warn("Klassen konnten nicht geladen werden:", klassenErr);
      }

      // Kursarten sind nur für den "Neuen Kurs anlegen"-Dialog nötig - auch hier soll ein Fehler nicht
      // den ganzen Schritt blockieren, das Kürzel-Feld im Dialog bleibt sonst per Freitext nutzbar.
      try {
        schildKursarten = await SvwsApi.getKursarten();
      } catch (kursartenErr) {
        schildKursarten = [];
        console.warn("Kursarten konnten nicht geladen werden:", kursartenErr);
      }

      // Jahrgänge werden für den "Neuen Kurs anlegen"-Dialog sowie "Split in Jahrgangskurse" gebraucht -
      // ein Fehler hier soll den Schritt nicht blockieren.
      try {
        schildJahrgaenge = await SvwsApi.getJahrgaenge();
      } catch (jahrgaengeErr) {
        schildJahrgaenge = [];
        console.warn("Jahrgänge konnten nicht geladen werden:", jahrgaengeErr);
      }

      $("schild-data-counts").textContent =
        `${schildSchueler.length} Schüler (gefiltert), ${schildKurse.length} Kurse, ${schildFaecher.length} Fächer, ${schildKlassen.length} Klassen geladen.`;
      setStatus(statusEl, "Fertig." + klassenHinweis, klassenHinweis ? "warn" : "ok");
      reveal("section-wartung");
      buildKursDatalistMitAnzahl();
      populateCreateKursDialogOptions();
      renderSplitJahrgangTable();
      renderSplitKlasseTable();
      populateBlockungAbgleichStufen();
    } catch (err) {
      setStatus(statusEl, err.message, "error", err);
    }
  }

  function populateCreateKursDialogOptions() {
    const fachSelect = $("create-kurs-fach");
    fachSelect.innerHTML =
      '<option value="">(kein Fach)</option>' +
      schildFaecher
        .map((f) => `<option value="${f.id}">${escapeHtml(f.kuerzel)} – ${escapeHtml(f.bezeichnung || "")}</option>`)
        .join("");

    const kursartOptions = new Map();
    for (const k of schildKursarten) {
      if (!k.kuerzelAllg) continue;
      if (!kursartOptions.has(k.kuerzelAllg)) kursartOptions.set(k.kuerzelAllg, k.bezeichnungAllg || "");
    }
    const kursartDatalist = $("kursart-datalist");
    kursartDatalist.innerHTML = Array.from(kursartOptions.entries())
      .map(([kuerzel, bezeichnung]) => `<option value="${escapeHtml(kuerzel)}">${escapeHtml(bezeichnung)}</option>`)
      .join("");
  }

  // DEFAULT_JAHRGANG_KUERZEL kommt aus SharedCode (siehe oben) - deckt Sek I und Oberstufe gleichermaßen ab.

  /** Baut die Jahrgangs-Checkboxen im "Neuen Kurs anlegen"-Dialog neu auf. Wird bei jedem Öffnen des
   *  Dialogs aufgerufen, damit eine vorherige manuelle Auswahl nicht hängen bleibt.
   *  @param preselectIds optionale explizite Vorauswahl (z.B. genau der Jahrgang einer Split-Zeile);
   *    ohne Angabe greift die generische Vorauswahl `DEFAULT_JAHRGANG_KUERZEL`. */
  function renderCreateKursJahrgaenge(preselectIds) {
    const preselect = preselectIds ? new Set(preselectIds) : null;
    const container = $("create-kurs-jahrgaenge-container");
    container.innerHTML = schildJahrgaenge
      .map((j) => {
        const label = j.kuerzel || j.kuerzelStatistik || `#${j.id}`;
        const vergleichsKuerzel = (j.kuerzel || j.kuerzelStatistik || "").trim().toUpperCase();
        const checked = preselect ? preselect.has(j.id) : DEFAULT_JAHRGANG_KUERZEL.has(vergleichsKuerzel);
        return `<label><input type="checkbox" class="create-kurs-jahrgang" value="${j.id}" ${checked ? "checked" : ""}/> ${escapeHtml(label)}</label>`;
      })
      .join("");
  }

  /** Separate Datalist mit Schülerzahl je Kurs (für die Quellkurs-/Zielkurs-Felder unten). */
  function buildKursDatalistMitAnzahl() {
    const datalist = $("kurs-datalist-anzahl");
    datalist.innerHTML = schildKurse.map((k) => `<option value="${escapeHtml(kursLabelMitAnzahl(k))}"></option>`).join("");
  }

  /**
   * Lädt nur die Kursliste (inkl. aktueller Teilnehmerzahlen aus dem eingebetteten `schueler[]`) neu,
   * ohne den kompletten "Schild-Daten laden"-Schritt (Schüler/Klassen/Kursarten/Jahrgänge) zu wiederholen
   * - reicht aus, um die in Klammern angezeigten Teilnehmerzahlen sowie Split-Tabellen nach
   * Ausführungen/Löschungen aktuell zu halten. Wird automatisch nach jedem Split/Löschen aufgerufen;
   * zusätzlich manuell über den "Kursbelegung aktualisieren"-Button.
   */
  async function refreshKursBelegung() {
    if (!abschnittId) return false;
    try {
      schildKurse = await SvwsApi.getKurse(abschnittId);
      kursById = new Map(schildKurse.map((k) => [k.id, k]));
      buildKursDatalistMitAnzahl();
      renderSplitJahrgangTable();
      renderSplitKlasseTable();
      return true;
    } catch (err) {
      console.warn("Kursbelegung konnte nicht aktualisiert werden:", err);
      return false;
    }
  }

  async function onRefreshKursBelegung() {
    const statusEl = $("kursbelegung-refresh-status");
    setStatus(statusEl, "Aktualisiere Kursbelegung …", "");
    const ok = await refreshKursBelegung();
    setStatus(statusEl, ok ? "Kursbelegung aktualisiert." : "Aktualisierung fehlgeschlagen.", ok ? "ok" : "error");
  }

  // ---------- "Neuen Kurs anlegen"-Dialog (generisch, von mehreren Stellen unten genutzt) ----------

  /**
   * Öffnet den "Neuen Kurs anlegen"-Dialog generisch für jeden Aufrufer (Split-Zielkurs, …). Alle Felder
   * werden nur als editierbarer *Vorschlag* vorbelegt - nichts wird beim Anlegen automatisch/unsichtbar
   * übernommen, der Dialog muss immer aktiv bestätigt werden.
   */
  function openCreateKursDialog(options) {
    createKursOnCreated = options.onCreated || null;
    $("create-kurs-source-text").textContent = options.displayText || "";
    $("create-kurs-kuerzel").value = options.kuerzelSuggestion || "";
    $("create-kurs-bezeichnung").value = options.bezeichnungSuggestion ?? options.kuerzelSuggestion ?? "";
    $("create-kurs-fach").value = options.fachId != null ? String(options.fachId) : "";
    $("create-kurs-kursart").value = options.kursart || "";
    $("create-kurs-wochenstunden").value = options.wochenstunden ?? 2;
    $("create-kurs-sichtbar").checked = true;
    renderCreateKursJahrgaenge(options.jahrgangIds || null);
    setStatus($("create-kurs-status"), "", "");
    $("create-kurs-dialog").showModal();
    $("create-kurs-kuerzel").focus();
  }

  function closeCreateKursDialog() {
    $("create-kurs-dialog").close();
    createKursOnCreated = null;
  }

  async function onCreateKursFormSubmit(evt) {
    evt.preventDefault();
    const kuerzel = $("create-kurs-kuerzel").value.trim();
    const kursartAllg = $("create-kurs-kursart").value.trim();
    if (!kuerzel || !kursartAllg) {
      setStatus($("create-kurs-status"), "Bitte Kürzel und Kursart angeben.", "error");
      return;
    }
    const fachId = $("create-kurs-fach").value ? Number($("create-kurs-fach").value) : null;
    const bezeichnungZeugnis = $("create-kurs-bezeichnung").value.trim();
    const idJahrgaenge = Array.from(document.querySelectorAll(".create-kurs-jahrgang:checked")).map((cb) =>
      Number(cb.value)
    );

    const payload = {
      idSchuljahresabschnitt: abschnittId,
      kuerzel,
      kursartAllg,
      idFach: fachId,
      bezeichnungZeugnis: bezeichnungZeugnis || null,
      wochenstunden: Number($("create-kurs-wochenstunden").value) || 0,
      istSichtbar: $("create-kurs-sichtbar").checked,
      idJahrgaenge,
      schienen: [],
    };

    setStatus($("create-kurs-status"), "Lege Kurs an …", "");
    $("btn-create-kurs-submit").disabled = true;
    try {
      const neuerKurs = await SvwsApi.createKurs(payload);
      schildKurse.push(neuerKurs);
      kursById.set(neuerKurs.id, neuerKurs);
      buildKursDatalistMitAnzahl();

      const callback = createKursOnCreated;
      closeCreateKursDialog();
      if (callback) callback(neuerKurs);
    } catch (err) {
      setStatus($("create-kurs-status"), err.message, "error");
    } finally {
      $("btn-create-kurs-submit").disabled = false;
    }
  }

  // ---------- 3. Leistungsdaten mit leerem Kurs ----------
  // "Prüfen" läuft immer über alle geladenen Schüler:innen (unabhängig von der Kursart, s.u. - die
  // Kursart eines Treffers ist ja gerade Teil dessen, was erst die Prüfung selbst liefert, kann also nicht
  // vorab eingegrenzt werden). Der Kursart-Spaltenkopf-Filter unten wirkt deshalb rein auf die Anzeige,
  // genau wie bei "Leere Kurse suchen".

  let checkLeererKursResults = []; // [{schuelerId, schuelerLabel, fachLabel, kursart, leistungsdatenId}]

  async function onRunCheckLeererKurs() {
    if (schildSchueler.length === 0) {
      setStatus($("check-leerer-kurs-status"), "Bitte zuerst Schild-Daten laden.", "error");
      return;
    }
    const statusEl = $("check-leerer-kurs-status");
    const progressEl = $("check-leerer-kurs-progress");
    const total = schildSchueler.length;
    let processed = 0;
    progressEl.max = total;
    progressEl.value = 0;
    progressEl.classList.remove("hidden");
    setStatus(statusEl, `Prüfe 0 / ${total} Schüler:innen …`, "");
    $("btn-run-check-leerer-kurs").disabled = true;

    const fachById = new Map(schildFaecher.map((f) => [f.id, f]));
    const gueltigeKursIds = new Set(kursById.keys());
    const results = [];
    let fehler = 0;
    await mapWithConcurrency(schildSchueler, 6, async (schueler) => {
      try {
        const lad = await SvwsApi.getLernabschnittsdaten(schueler.id, abschnittId);
        for (const eintrag of Check.CHECKS.leistungsdatenLeererKurs.findIssues(lad, gueltigeKursIds)) {
          const fach = fachById.get(eintrag.fachID);
          results.push({
            schuelerId: schueler.id,
            schuelerLabel: schuelerLabel(schueler),
            fachLabel: fach ? `${fach.kuerzel} – ${fach.bezeichnung || ""}` : `Fach-ID ${eintrag.fachID}`,
            kursart: eintrag.kursart,
            kursIdHinweis: eintrag.kursID == null ? "– (leer)" : `${eintrag.kursID} (existiert nicht mehr)`,
            leistungsdatenId: eintrag.id,
          });
        }
      } catch (e) {
        fehler++;
      } finally {
        processed++;
        progressEl.value = processed;
        setStatus(statusEl, `Prüfe ${processed} / ${total} Schüler:innen … (${results.length} Treffer bisher)`, "");
      }
    });

    progressEl.classList.add("hidden");
    checkLeererKursResults = results;
    populateCheckLeererKursKursartFilter();
    renderCheckLeererKursTable();
    $("btn-run-check-leerer-kurs").disabled = false;
    setStatus(
      statusEl,
      `${results.length} betroffene Leistungsdaten-Einträge gefunden${fehler ? ` (${fehler} Schüler:innen konnten nicht geprüft werden)` : ""}.`,
      results.length ? "warn" : "ok"
    );
  }

  /** Baut die Checkbox-Liste im Kursart-Spaltenkopf-Popover aus den *tatsächlich* gefundenen
   *  `checkLeererKursResults` (nicht dem vollen Schild-Kursartenkatalog) - z.B. um bei Schulen, an denen
   *  regulärer Klassenunterricht ebenfalls eine Kursart trägt (z.B. "PUK"), genau diese Kursart gezielt
   *  auszublenden, ohne die anderen (tatsächlich interessanten) Treffer zu verlieren. */
  function populateCheckLeererKursKursartFilter() {
    const gespeichert = state.checkLeererKursFilter.kursarten || [];
    const kursarten = Array.from(new Set(checkLeererKursResults.map((r) => r.kursart))).sort();
    $("check-leerer-kurs-kursart-filter-options").innerHTML = kursarten
      .map((ka) => {
        const anzeige = ka || "(ohne Kursart)";
        const checked = gespeichert.length === 0 || gespeichert.includes(ka);
        return `<label><input type="checkbox" class="check-leerer-kurs-kursart-cb" value="${escapeHtml(ka)}" ${checked ? "checked" : ""}/> ${escapeHtml(anzeige)}</label>`;
      })
      .join("");
    document
      .querySelectorAll(".check-leerer-kurs-kursart-cb")
      .forEach((cb) => cb.addEventListener("change", onCheckLeererKursFilterChange));
    updateCheckLeererKursFilterButtonState();
  }

  function persistCheckLeererKursFilter() {
    state.checkLeererKursFilter = {
      kursarten: Array.from(document.querySelectorAll(".check-leerer-kurs-kursart-cb:checked")).map((cb) => cb.value),
    };
    persist();
  }

  function updateCheckLeererKursFilterButtonState() {
    const cbs = document.querySelectorAll(".check-leerer-kurs-kursart-cb");
    const aktiv = cbs.length > 0 && !Array.from(cbs).every((cb) => cb.checked);
    $("check-leerer-kurs-kursart-filter-btn").classList.toggle("active", aktiv);
  }

  function onCheckLeererKursFilterChange() {
    persistCheckLeererKursFilter();
    updateCheckLeererKursFilterButtonState();
    renderCheckLeererKursTable();
  }

  /** Wendet den Kursart-Filter auf checkLeererKursResults an (leeres Array = kein Filter aktiv = alles
   *  anzeigen, wie bei state.leereKurseFilter). */
  function filteredCheckLeererKursRows() {
    const kursartFilter = state.checkLeererKursFilter.kursarten || [];
    if (kursartFilter.length === 0) return checkLeererKursResults;
    return checkLeererKursResults.filter((r) => kursartFilter.includes(r.kursart));
  }

  function renderCheckLeererKursTable() {
    const tbody = document.querySelector("#check-leerer-kurs-table tbody");
    const rows = filteredCheckLeererKursRows();
    tbody.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td><input type="checkbox" class="check-leerer-kurs-row" data-id="${r.leistungsdatenId}" checked /></td>
        <td>${escapeHtml(r.schuelerLabel)}</td>
        <td>${escapeHtml(r.fachLabel)}</td>
        <td>${escapeHtml(r.kursart)}</td>
        <td>${escapeHtml(r.kursIdHinweis)}</td>
        <td>${r.leistungsdatenId}</td>
      </tr>`
      )
      .join("");
    $("check-leerer-kurs-select-all").checked = rows.length > 0;
    $("btn-delete-check-leerer-kurs").disabled = rows.length === 0;
    $("check-leerer-kurs-treffer-hinweis").textContent =
      checkLeererKursResults.length === 0
        ? ""
        : rows.length === checkLeererKursResults.length
        ? `${checkLeererKursResults.length} Treffer.`
        : `${rows.length} von ${checkLeererKursResults.length} Treffern angezeigt (gefiltert).`;
  }

  function onCheckLeererKursSelectAll(evt) {
    document.querySelectorAll(".check-leerer-kurs-row").forEach((cb) => (cb.checked = evt.target.checked));
  }

  async function onDeleteCheckLeererKurs() {
    const checked = Array.from(document.querySelectorAll(".check-leerer-kurs-row:checked"));
    if (checked.length === 0) return;
    const sicher = confirm(
      `${checked.length} Leistungsdaten-Einträge wirklich unwiderruflich in Schild löschen? Das kann nicht rückgängig gemacht werden.`
    );
    if (!sicher) return;

    const ids = checked.map((cb) => Number(cb.dataset.id));
    const log = $("check-leerer-kurs-log");
    log.textContent = `Lösche ${ids.length} Leistungsdaten-Einträge …\n`;
    $("btn-delete-check-leerer-kurs").disabled = true;

    const result = await batchWithBisection(ids, (subset) => SvwsApi.deleteLeistungsdatenMultiple(subset));
    const geloeschtIds = new Set(ids.filter((id) => !result.failed.some((f) => f.item === id)));
    checkLeererKursResults = checkLeererKursResults.filter((r) => !geloeschtIds.has(r.leistungsdatenId));
    renderCheckLeererKursTable();

    if (result.failed.length === 0) {
      log.textContent += `${result.ok} Einträge erfolgreich gelöscht.\n`;
      setStatus($("check-leerer-kurs-status"), `${result.ok} Einträge gelöscht.`, "ok");
    } else {
      log.textContent += `${result.ok} gelöscht, ${result.failed.length} fehlgeschlagen:\n`;
      for (const f of result.failed) log.textContent += `- Leistungsdaten-ID ${f.item}: ${f.message}\n`;
      setStatus($("check-leerer-kurs-status"), `${result.ok} gelöscht, ${result.failed.length} fehlgeschlagen.`, "warn");
    }
    $("btn-delete-check-leerer-kurs").disabled = checkLeererKursResults.length === 0;
  }

  // ---------- 4. Split in Jahrgangskurse ----------

  /** Zählt für einen Kurs, wie viele seiner eingeschriebenen Schüler:innen (die im aktuell geladenen
   *  Status-Filter enthalten sind) zu welchem Jahrgang gehören. */
  function jahrgangAnzahlByKurs(kurs) {
    const anzahlByJahrgang = new Map();
    let nichtImStatusFilter = 0;
    for (const s of (kurs && kurs.schueler) || []) {
      const voll = schuelerById.get(s.id);
      if (!voll) {
        nichtImStatusFilter++;
        continue;
      }
      if (voll.idJahrgang == null) continue;
      anzahlByJahrgang.set(voll.idJahrgang, (anzahlByJahrgang.get(voll.idJahrgang) || 0) + 1);
    }
    return { anzahlByJahrgang, nichtImStatusFilter };
  }

  function jahrgangOptionsHtml(selectedId, anzahlByJahrgang) {
    const optionen = ['<option value="">(wählen)</option>'].concat(
      schildJahrgaenge.map((j) => {
        const label = j.kuerzel || j.kuerzelStatistik || `#${j.id}`;
        const suffix = anzahlByJahrgang ? ` (${anzahlByJahrgang.get(j.id) || 0} SuS)` : "";
        return `<option value="${j.id}" ${j.id === selectedId ? "selected" : ""}>${escapeHtml(label + suffix)}</option>`;
      })
    );
    return optionen.join("");
  }

  function fachOptionsHtml(selectedId) {
    const optionen = ['<option value="">(kein Fach)</option>'].concat(
      schildFaecher.map((f) => {
        const label = `${f.kuerzel} – ${f.bezeichnung || ""}`;
        return `<option value="${f.id}" ${f.id === selectedId ? "selected" : ""}>${escapeHtml(label)}</option>`;
      })
    );
    return optionen.join("");
  }

  function onAutosplitVorschlag() {
    const statusEl = $("autosplit-status");
    const id = idFromLabel($("autosplit-quellkurs-input").value.trim());
    const quellkurs = id != null ? kursById.get(id) : null;
    if (!quellkurs) {
      setStatus(statusEl, "Bitte einen vorhandenen Kurs auswählen.", "error");
      autosplitProposalRows = [];
      autosplitQuellkursId = null;
      renderAutosplitTable();
      return;
    }

    const { anzahlByJahrgang, nichtImStatusFilter } = jahrgangAnzahlByKurs(quellkurs);

    autosplitQuellkursId = quellkurs.id;
    autosplitProposalRows = schildJahrgaenge
      .filter((j) => anzahlByJahrgang.has(j.id))
      .map((j) => {
        const jahrgangLabel = j.kuerzel || j.kuerzelStatistik || `#${j.id}`;
        const kuerzelSuggestion = [quellkurs.kuerzel, jahrgangLabel].filter(Boolean).join("-");
        const existing = schildKurse.find((k) => k.kuerzel === kuerzelSuggestion);
        return {
          jahrgangId: j.id,
          jahrgangLabel,
          anzahlSchueler: anzahlByJahrgang.get(j.id),
          zielkursValue: existing ? kursLabelMitAnzahl(existing) : kuerzelSuggestion,
          bezeichnung: quellkurs.bezeichnungZeugnis
            ? [quellkurs.bezeichnungZeugnis, jahrgangLabel].filter(Boolean).join(" ")
            : "",
          fachId: quellkurs.idFach ?? null,
          kursart: quellkurs.kursartAllg || "",
          wochenstunden: quellkurs.wochenstunden ?? 2,
        };
      });

    renderAutosplitTable();

    if (autosplitProposalRows.length === 0) {
      setStatus(
        statusEl,
        `Keine Jahrgänge gefunden${
          nichtImStatusFilter ? ` (${nichtImStatusFilter} Schüler:innen im Kurs sind nicht im aktuell geladenen Status-Filter enthalten)` : ""
        }.`,
        "warn"
      );
      return;
    }
    const gesamtSchueler = autosplitProposalRows.reduce((sum, r) => sum + r.anzahlSchueler, 0);
    setStatus(
      statusEl,
      `${autosplitProposalRows.length} Jahrgänge gefunden, ${gesamtSchueler} Schüler:innen betroffen` +
        (nichtImStatusFilter ? ` (${nichtImStatusFilter} Schüler:innen im Kurs nicht im Status-Filter enthalten)` : "") +
        ".",
      "ok"
    );
  }

  function renderAutosplitTable() {
    $("autosplit-table-wrap").classList.toggle("hidden", autosplitProposalRows.length === 0);
    $("btn-autosplit-uebernehmen").classList.toggle("hidden", autosplitProposalRows.length === 0);
    const tbody = document.querySelector("#autosplit-table tbody");
    tbody.innerHTML = autosplitProposalRows
      .map(
        (row, idx) => `
      <tr data-row-idx="${idx}">
        <td><input type="checkbox" class="autosplit-row-checkbox" checked /></td>
        <td>${escapeHtml(row.jahrgangLabel)}</td>
        <td>${row.anzahlSchueler}</td>
        <td><input type="text" class="autosplit-zielkurs-input" list="kurs-datalist-anzahl" value="${escapeHtml(row.zielkursValue)}" /></td>
        <td><input type="text" class="autosplit-bezeichnung-input" value="${escapeHtml(row.bezeichnung)}" /></td>
        <td><select class="autosplit-fach">${fachOptionsHtml(row.fachId)}</select></td>
        <td><input type="text" class="autosplit-kursart" list="kursart-datalist" value="${escapeHtml(row.kursart)}" /></td>
        <td><input type="number" class="autosplit-wstd" value="${row.wochenstunden}" min="0" /></td>
      </tr>`
      )
      .join("");
  }

  function onAutosplitSelectAll(evt) {
    document.querySelectorAll(".autosplit-row-checkbox").forEach((cb) => (cb.checked = evt.target.checked));
  }

  async function onAutosplitUebernehmen() {
    const statusEl = $("autosplit-status");
    const log = $("autosplit-log");
    log.textContent = "";

    const rows = [];
    document.querySelectorAll("#autosplit-table tbody tr").forEach((tr) => {
      const idx = Number(tr.dataset.rowIdx);
      const proposal = autosplitProposalRows[idx];
      if (!proposal) return;
      if (!tr.querySelector(".autosplit-row-checkbox").checked) return;
      rows.push({
        jahrgangId: proposal.jahrgangId,
        jahrgangLabel: proposal.jahrgangLabel,
        zielkursText: tr.querySelector(".autosplit-zielkurs-input").value.trim(),
        bezeichnung: tr.querySelector(".autosplit-bezeichnung-input").value.trim(),
        fachId: tr.querySelector(".autosplit-fach").value ? Number(tr.querySelector(".autosplit-fach").value) : null,
        kursart: tr.querySelector(".autosplit-kursart").value.trim(),
        wochenstunden: Number(tr.querySelector(".autosplit-wstd").value) || 0,
      });
    });

    if (rows.length === 0) {
      setStatus(statusEl, "Keine Zeilen ausgewählt.", "error");
      return;
    }

    $("btn-autosplit-uebernehmen").disabled = true;

    const finalEntries = [];
    const neueGruppen = new Map();
    let uebersprungen = 0;

    for (const row of rows) {
      if (!row.zielkursText) {
        log.textContent += `Jahrgang "${row.jahrgangLabel}": kein Zielkurs angegeben, übersprungen.\n`;
        uebersprungen++;
        continue;
      }
      const id = idFromLabel(row.zielkursText);
      if (id != null && kursById.has(id)) {
        finalEntries.push({ quellkursId: autosplitQuellkursId, jahrgangId: row.jahrgangId, zielkursId: id });
        continue;
      }
      if (!neueGruppen.has(row.zielkursText)) {
        neueGruppen.set(row.zielkursText, {
          rows: [],
          bezeichnung: row.bezeichnung,
          fachId: row.fachId,
          kursart: row.kursart,
          wochenstunden: row.wochenstunden,
          jahrgangIds: new Set(),
        });
      }
      const gruppe = neueGruppen.get(row.zielkursText);
      gruppe.rows.push(row);
      gruppe.jahrgangIds.add(row.jahrgangId);
    }

    let neueKurseAnzahl = 0;
    for (const [kuerzel, gruppe] of neueGruppen) {
      if (!gruppe.kursart) {
        log.textContent += `Kurs "${kuerzel}" konnte nicht angelegt werden: Kursart fehlt.\n`;
        uebersprungen += gruppe.rows.length;
        continue;
      }
      try {
        const neuerKurs = await SvwsApi.createKurs({
          idSchuljahresabschnitt: abschnittId,
          kuerzel,
          kursartAllg: gruppe.kursart,
          idFach: gruppe.fachId,
          bezeichnungZeugnis: gruppe.bezeichnung || null,
          wochenstunden: gruppe.wochenstunden,
          istSichtbar: true,
          idJahrgaenge: Array.from(gruppe.jahrgangIds),
          schienen: [],
        });
        schildKurse.push(neuerKurs);
        kursById.set(neuerKurs.id, neuerKurs);
        neueKurseAnzahl++;
        for (const r of gruppe.rows) {
          finalEntries.push({ quellkursId: autosplitQuellkursId, jahrgangId: r.jahrgangId, zielkursId: neuerKurs.id });
        }
        log.textContent += `Kurs "${neuerKurs.kuerzel}" angelegt (${gruppe.jahrgangIds.size} Jahrgang/Jahrgänge).\n`;
      } catch (err) {
        log.textContent += `Kurs "${kuerzel}" konnte nicht angelegt werden: ${err.message}\n`;
        uebersprungen += gruppe.rows.length;
      }
    }

    state.splitJahrgangRows.push(...finalEntries);
    persist();
    buildKursDatalistMitAnzahl();
    renderSplitJahrgangTable();

    autosplitProposalRows = [];
    autosplitQuellkursId = null;
    $("autosplit-quellkurs-input").value = "";
    renderAutosplitTable();

    $("btn-autosplit-uebernehmen").disabled = false;
    setStatus(
      statusEl,
      `${finalEntries.length} Zeile(n) übernommen (${neueKurseAnzahl} neue(r) Kurs(e) angelegt)` +
        (uebersprungen ? `, ${uebersprungen} übersprungen (siehe Protokoll)` : "") +
        ".",
      uebersprungen ? "warn" : "ok"
    );
  }

  function renderSplitJahrgangTable() {
    const tbody = document.querySelector("#split-jahrgang-table tbody");
    tbody.innerHTML = state.splitJahrgangRows
      .map((row, idx) => {
        const quellkurs = row.quellkursId != null ? kursById.get(row.quellkursId) : null;
        const zielkurs = row.zielkursId != null ? kursById.get(row.zielkursId) : null;
        const anzahlByJahrgang = quellkurs ? jahrgangAnzahlByKurs(quellkurs).anzahlByJahrgang : null;
        return `
        <tr data-row-idx="${idx}">
          <td><input type="text" class="split-quellkurs-input" list="kurs-datalist-anzahl" value="${escapeHtml(quellkurs ? kursLabelMitAnzahl(quellkurs) : "")}" placeholder="Kurs wählen" /></td>
          <td><select class="split-jahrgang-select">${jahrgangOptionsHtml(row.jahrgangId, anzahlByJahrgang)}</select></td>
          <td>
            <input type="text" class="split-zielkurs-input" list="kurs-datalist-anzahl" value="${escapeHtml(zielkurs ? kursLabelMitAnzahl(zielkurs) : "")}" placeholder="vorhandenen Kurs wählen" />
            <button type="button" class="btn-secondary split-zielkurs-create" title="Neuen Kurs für diese Zeile anlegen">+ Kurs</button>
          </td>
          <td class="row-actions">
            <button type="button" class="btn-secondary split-add-below">+ Jahrgang</button>
            <button type="button" class="btn-secondary split-remove-row">✕</button>
          </td>
        </tr>`;
      })
      .join("");
  }

  function splitJahrgangRowIndex(evt) {
    return Number(evt.target.closest("tr").dataset.rowIdx);
  }

  function onSplitJahrgangQuellkursChange(evt) {
    const idx = splitJahrgangRowIndex(evt);
    const id = idFromLabel(evt.target.value.trim());
    state.splitJahrgangRows[idx].quellkursId = id != null && kursById.has(id) ? id : null;
    persist();
    renderSplitJahrgangTable();
  }

  function onSplitJahrgangJahrgangChange(evt) {
    const idx = splitJahrgangRowIndex(evt);
    state.splitJahrgangRows[idx].jahrgangId = evt.target.value ? Number(evt.target.value) : null;
    persist();
  }

  function onSplitJahrgangZielkursChange(evt) {
    const idx = splitJahrgangRowIndex(evt);
    const id = idFromLabel(evt.target.value.trim());
    state.splitJahrgangRows[idx].zielkursId = id != null && kursById.has(id) ? id : null;
    persist();
    renderSplitJahrgangTable();
  }

  function onSplitJahrgangAddRow() {
    state.splitJahrgangRows.push({ quellkursId: null, jahrgangId: null, zielkursId: null });
    persist();
    renderSplitJahrgangTable();
  }

  function onSplitJahrgangAddBelow(evt) {
    const idx = splitJahrgangRowIndex(evt);
    const quelle = state.splitJahrgangRows[idx];
    state.splitJahrgangRows.splice(idx + 1, 0, { quellkursId: quelle.quellkursId, jahrgangId: null, zielkursId: null });
    persist();
    renderSplitJahrgangTable();
  }

  function onSplitJahrgangRemoveRow(evt) {
    const idx = splitJahrgangRowIndex(evt);
    state.splitJahrgangRows.splice(idx, 1);
    persist();
    renderSplitJahrgangTable();
  }

  function onSplitJahrgangCreateZielkurs(evt) {
    const idx = splitJahrgangRowIndex(evt);
    const row = state.splitJahrgangRows[idx];
    const quellkurs = row.quellkursId != null ? kursById.get(row.quellkursId) : null;
    const jahrgang = row.jahrgangId != null ? schildJahrgaenge.find((j) => j.id === row.jahrgangId) : null;
    const jahrgangLabel = jahrgang ? jahrgang.kuerzel || jahrgang.kuerzelStatistik || "" : "";
    const kuerzelSuggestion = quellkurs ? [quellkurs.kuerzel, jahrgangLabel].filter(Boolean).join("-") : "";

    openCreateKursDialog({
      displayText: quellkurs ? `Split-Zeile: ${quellkurs.kuerzel} → ${jahrgangLabel || "?"}` : "Split-Zeile",
      kuerzelSuggestion,
      bezeichnungSuggestion: quellkurs ? quellkurs.bezeichnungZeugnis || kuerzelSuggestion : "",
      fachId: quellkurs ? quellkurs.idFach : null,
      kursart: quellkurs ? quellkurs.kursartAllg : "",
      wochenstunden: quellkurs ? quellkurs.wochenstunden : 2,
      jahrgangIds: jahrgang ? [jahrgang.id] : null,
      onCreated: (neuerKurs) => {
        row.zielkursId = neuerKurs.id;
        persist();
        renderSplitJahrgangTable();
        setStatus($("split-jahrgang-status"), `Kurs "${neuerKurs.kuerzel}" angelegt und als Zielkurs eingetragen.`, "ok");
      },
    });
  }

  /** Baut aus einem Quell-Leistungsdaten-Eintrag den Payload für den Zielkurs. Wird sowohl vom
   *  Jahrgangs- als auch vom Klassen-Split unten genutzt. */
  function buildSplitLeistungsdatenPayload(quellEintrag, zielkurs) {
    return {
      lernabschnittID: quellEintrag.lernabschnittID,
      fachID: quellEintrag.fachID,
      kursID: zielkurs.id,
      kursart: zielkurs.kursartAllg || quellEintrag.kursart || null,
      lehrerID: zielkurs.lehrer ?? null,
      wochenstunden: zielkurs.wochenstunden ?? quellEintrag.wochenstunden ?? 0,
      aufZeugnis: !!quellEintrag.aufZeugnis,
      istEpochal: !!quellEintrag.istEpochal,
      umfangLernstandsbericht: quellEintrag.umfangLernstandsbericht || "V",
      textFachbezogeneLernentwicklung: quellEintrag.textFachbezogeneLernentwicklung || "",
      note: quellEintrag.note ?? null,
      noteQuartal: quellEintrag.noteQuartal ?? null,
    };
  }

  async function onExecuteSplitJahrgang() {
    const log = $("split-jahrgang-log");
    const statusEl = $("split-jahrgang-status");
    const progressEl = $("split-jahrgang-progress");
    log.textContent = "";

    const rows = state.splitJahrgangRows.filter(
      (r) => r.quellkursId != null && r.jahrgangId != null && r.zielkursId != null
    );
    if (rows.length === 0) {
      setStatus(statusEl, "Keine vollständig ausgefüllten Zeilen (Quellkurs, Jahrgang und Zielkurs nötig).", "error");
      return;
    }

    $("btn-split-jahrgang-execute").disabled = true;
    progressEl.classList.remove("hidden");
    progressEl.max = rows.length;
    progressEl.value = 0;

    let gesamtVerschoben = 0;
    let gesamtFehler = 0;
    let zeilenNr = 0;

    for (const row of rows) {
      zeilenNr++;
      progressEl.value = zeilenNr;
      const quellkurs = kursById.get(row.quellkursId);
      const jahrgang = schildJahrgaenge.find((j) => j.id === row.jahrgangId);
      if (!quellkurs || !jahrgang) {
        log.textContent += `Zeile ${zeilenNr}: Quellkurs oder Jahrgang nicht mehr gültig, übersprungen.\n`;
        gesamtFehler++;
        continue;
      }

      setStatus(statusEl, `Zeile ${zeilenNr}/${rows.length}: ${quellkurs.kuerzel} → ${jahrgang.kuerzel || jahrgang.kuerzelStatistik} …`, "");
      log.textContent += `Zeile ${zeilenNr}: Quellkurs "${quellkurs.kuerzel}", Jahrgang "${jahrgang.kuerzel || jahrgang.kuerzelStatistik}" …\n`;

      const zielkurs = kursById.get(row.zielkursId);
      if (!zielkurs) {
        log.textContent += `  Zielkurs nicht mehr gültig, übersprungen.\n`;
        gesamtFehler++;
        continue;
      }
      if (zielkurs.id === quellkurs.id) {
        log.textContent += `  Quellkurs und Zielkurs sind identisch, übersprungen.\n`;
        continue;
      }

      const kandidaten = [];
      let nichtImStatusFilter = 0;
      for (const s of quellkurs.schueler || []) {
        const voll = schuelerById.get(s.id);
        if (!voll) {
          nichtImStatusFilter++;
          continue;
        }
        if (voll.idJahrgang === jahrgang.id) kandidaten.push(s);
      }
      if (kandidaten.length === 0) {
        log.textContent += `  Keine passenden Schüler:innen im Quellkurs gefunden${
          nichtImStatusFilter ? ` (${nichtImStatusFilter} Schüler:innen im Kurs sind nicht im aktuell geladenen Status-Filter enthalten)` : ""
        }.\n`;
        continue;
      }

      const ladBySchueler = new Map();
      await mapWithConcurrency(kandidaten, 6, async (s) => {
        try {
          ladBySchueler.set(s.id, await SvwsApi.getLernabschnittsdaten(s.id, abschnittId));
        } catch (e) {
          ladBySchueler.set(s.id, null);
        }
      });

      const ops = [];
      let ladFehler = 0;
      for (const s of kandidaten) {
        const lad = ladBySchueler.get(s.id);
        if (!lad) {
          ladFehler++;
          continue;
        }
        const quellEintrag = (lad.leistungsdaten || []).find((l) => l.kursID === quellkurs.id);
        if (!quellEintrag) continue;
        const hatSchonZiel = (lad.leistungsdaten || []).some((l) => l.kursID === zielkurs.id);
        ops.push({
          schuelerLabel: schuelerLabel(s),
          quellEintragId: quellEintrag.id,
          createPayload: hatSchonZiel ? null : buildSplitLeistungsdatenPayload(quellEintrag, zielkurs),
        });
      }

      const toCreate = ops.filter((op) => op.createPayload);
      const createResult = await batchWithBisection(toCreate, (subset) =>
        SvwsApi.createLeistungsdatenMultiple(subset.map((op) => op.createPayload))
      );
      const fehlgeschlageneOps = new Set(createResult.failed.map((f) => f.item));

      const toDelete = ops.filter((op) => !op.createPayload || !fehlgeschlageneOps.has(op));
      const deleteResult = await batchWithBisection(
        toDelete.map((op) => op.quellEintragId),
        (subset) => SvwsApi.deleteLeistungsdatenMultiple(subset)
      );

      gesamtVerschoben += deleteResult.ok;
      const zeilenFehler = createResult.failed.length + deleteResult.failed.length + ladFehler;
      gesamtFehler += zeilenFehler;

      log.textContent +=
        `  ${deleteResult.ok} Schüler:innen verschoben` +
        (createResult.failed.length ? `, ${createResult.failed.length} Anlage-Fehler (Quelleintrag bewusst nicht gelöscht)` : "") +
        (deleteResult.failed.length ? `, ${deleteResult.failed.length} Lösch-Fehler (jetzt evtl. doppelt vorhanden)` : "") +
        (ladFehler ? `, ${ladFehler}x Lernabschnittsdaten nicht ladbar` : "") +
        ".\n";
      for (const f of createResult.failed) log.textContent += `    Anlegen fehlgeschlagen (${f.item.schuelerLabel}): ${f.message}\n`;
      for (const f of deleteResult.failed) log.textContent += `    Löschen fehlgeschlagen (Leistungsdaten-ID ${f.item}): ${f.message}\n`;
      log.scrollTop = log.scrollHeight;
    }

    persist();
    if (gesamtVerschoben > 0) {
      log.textContent += `Aktualisiere Kursbelegung …\n`;
      await refreshKursBelegung();
      log.textContent += `Kursbelegung aktualisiert.\n`;
      log.scrollTop = log.scrollHeight;
    } else {
      renderSplitJahrgangTable();
    }
    progressEl.classList.add("hidden");
    $("btn-split-jahrgang-execute").disabled = false;
    setStatus(
      statusEl,
      `Fertig: ${gesamtVerschoben} Schüler:innen verschoben${gesamtFehler ? `, ${gesamtFehler} Fehler (siehe Protokoll)` : ""}.`,
      gesamtFehler ? "warn" : "ok"
    );
  }

  // ---------- 5. Split in Klassenkurse ----------
  // Strukturell identisch zu "Split in Jahrgangskurse" oben, nur nach Klasse statt Jahrgang gruppiert -
  // bewusst als eigener, paralleler Funktionsblock gehalten statt generalisiert, siehe Kommentar dazu
  // in der ursprünglichen app.js-Fassung dieses Bereichs.

  function klasseAnzahlByKurs(kurs) {
    const anzahlByKlasse = new Map();
    let nichtImStatusFilter = 0;
    for (const s of (kurs && kurs.schueler) || []) {
      const voll = schuelerById.get(s.id);
      if (!voll) {
        nichtImStatusFilter++;
        continue;
      }
      if (voll.idKlasse == null) continue;
      anzahlByKlasse.set(voll.idKlasse, (anzahlByKlasse.get(voll.idKlasse) || 0) + 1);
    }
    return { anzahlByKlasse, nichtImStatusFilter };
  }

  function klasseOptionsHtml(selectedId, anzahlByKlasse) {
    const optionen = ['<option value="">(wählen)</option>'].concat(
      schildKlassen.map((k) => {
        const label = k.kuerzel || k.beschreibung || `#${k.id}`;
        const suffix = anzahlByKlasse ? ` (${anzahlByKlasse.get(k.id) || 0} SuS)` : "";
        return `<option value="${k.id}" ${k.id === selectedId ? "selected" : ""}>${escapeHtml(label + suffix)}</option>`;
      })
    );
    return optionen.join("");
  }

  function onAutosplitKlasseVorschlag() {
    const statusEl = $("autosplit-klasse-status");
    const id = idFromLabel($("autosplit-klasse-quellkurs-input").value.trim());
    const quellkurs = id != null ? kursById.get(id) : null;
    if (!quellkurs) {
      setStatus(statusEl, "Bitte einen vorhandenen Kurs auswählen.", "error");
      autosplitKlasseProposalRows = [];
      autosplitKlasseQuellkursId = null;
      renderAutosplitKlasseTable();
      return;
    }

    const { anzahlByKlasse, nichtImStatusFilter } = klasseAnzahlByKurs(quellkurs);

    autosplitKlasseQuellkursId = quellkurs.id;
    autosplitKlasseProposalRows = schildKlassen
      .filter((k) => anzahlByKlasse.has(k.id))
      .map((k) => {
        const klasseLabel = k.kuerzel || k.beschreibung || `#${k.id}`;
        const kuerzelSuggestion = [quellkurs.kuerzel, klasseLabel].filter(Boolean).join("-");
        const existing = schildKurse.find((x) => x.kuerzel === kuerzelSuggestion);
        return {
          klasseId: k.id,
          klasseLabel,
          klasseJahrgangId: k.idJahrgang ?? null,
          anzahlSchueler: anzahlByKlasse.get(k.id),
          zielkursValue: existing ? kursLabelMitAnzahl(existing) : kuerzelSuggestion,
          bezeichnung: quellkurs.bezeichnungZeugnis
            ? [quellkurs.bezeichnungZeugnis, klasseLabel].filter(Boolean).join(" ")
            : "",
          fachId: quellkurs.idFach ?? null,
          kursart: quellkurs.kursartAllg || "",
          wochenstunden: quellkurs.wochenstunden ?? 2,
        };
      });

    renderAutosplitKlasseTable();

    if (autosplitKlasseProposalRows.length === 0) {
      setStatus(
        statusEl,
        `Keine Klassen gefunden${
          nichtImStatusFilter ? ` (${nichtImStatusFilter} Schüler:innen im Kurs sind nicht im aktuell geladenen Status-Filter enthalten)` : ""
        }.`,
        "warn"
      );
      return;
    }
    const gesamtSchueler = autosplitKlasseProposalRows.reduce((sum, r) => sum + r.anzahlSchueler, 0);
    setStatus(
      statusEl,
      `${autosplitKlasseProposalRows.length} Klassen gefunden, ${gesamtSchueler} Schüler:innen betroffen` +
        (nichtImStatusFilter ? ` (${nichtImStatusFilter} Schüler:innen im Kurs nicht im Status-Filter enthalten)` : "") +
        ".",
      "ok"
    );
  }

  function renderAutosplitKlasseTable() {
    $("autosplit-klasse-table-wrap").classList.toggle("hidden", autosplitKlasseProposalRows.length === 0);
    $("btn-autosplit-klasse-uebernehmen").classList.toggle("hidden", autosplitKlasseProposalRows.length === 0);
    const tbody = document.querySelector("#autosplit-klasse-table tbody");
    tbody.innerHTML = autosplitKlasseProposalRows
      .map(
        (row, idx) => `
      <tr data-row-idx="${idx}">
        <td><input type="checkbox" class="autosplit-klasse-row-checkbox" checked /></td>
        <td>${escapeHtml(row.klasseLabel)}</td>
        <td>${row.anzahlSchueler}</td>
        <td><input type="text" class="autosplit-klasse-zielkurs-input" list="kurs-datalist-anzahl" value="${escapeHtml(row.zielkursValue)}" /></td>
        <td><input type="text" class="autosplit-klasse-bezeichnung-input" value="${escapeHtml(row.bezeichnung)}" /></td>
        <td><select class="autosplit-klasse-fach">${fachOptionsHtml(row.fachId)}</select></td>
        <td><input type="text" class="autosplit-klasse-kursart" list="kursart-datalist" value="${escapeHtml(row.kursart)}" /></td>
        <td><input type="number" class="autosplit-klasse-wstd" value="${row.wochenstunden}" min="0" /></td>
      </tr>`
      )
      .join("");
  }

  function onAutosplitKlasseSelectAll(evt) {
    document.querySelectorAll(".autosplit-klasse-row-checkbox").forEach((cb) => (cb.checked = evt.target.checked));
  }

  async function onAutosplitKlasseUebernehmen() {
    const statusEl = $("autosplit-klasse-status");
    const log = $("autosplit-klasse-log");
    log.textContent = "";

    const rows = [];
    document.querySelectorAll("#autosplit-klasse-table tbody tr").forEach((tr) => {
      const idx = Number(tr.dataset.rowIdx);
      const proposal = autosplitKlasseProposalRows[idx];
      if (!proposal) return;
      if (!tr.querySelector(".autosplit-klasse-row-checkbox").checked) return;
      rows.push({
        klasseId: proposal.klasseId,
        klasseLabel: proposal.klasseLabel,
        klasseJahrgangId: proposal.klasseJahrgangId,
        zielkursText: tr.querySelector(".autosplit-klasse-zielkurs-input").value.trim(),
        bezeichnung: tr.querySelector(".autosplit-klasse-bezeichnung-input").value.trim(),
        fachId: tr.querySelector(".autosplit-klasse-fach").value ? Number(tr.querySelector(".autosplit-klasse-fach").value) : null,
        kursart: tr.querySelector(".autosplit-klasse-kursart").value.trim(),
        wochenstunden: Number(tr.querySelector(".autosplit-klasse-wstd").value) || 0,
      });
    });

    if (rows.length === 0) {
      setStatus(statusEl, "Keine Zeilen ausgewählt.", "error");
      return;
    }

    $("btn-autosplit-klasse-uebernehmen").disabled = true;

    const finalEntries = [];
    const neueGruppen = new Map();
    let uebersprungen = 0;

    for (const row of rows) {
      if (!row.zielkursText) {
        log.textContent += `Klasse "${row.klasseLabel}": kein Zielkurs angegeben, übersprungen.\n`;
        uebersprungen++;
        continue;
      }
      const id = idFromLabel(row.zielkursText);
      if (id != null && kursById.has(id)) {
        finalEntries.push({ quellkursId: autosplitKlasseQuellkursId, klasseId: row.klasseId, zielkursId: id });
        continue;
      }
      if (!neueGruppen.has(row.zielkursText)) {
        neueGruppen.set(row.zielkursText, {
          rows: [],
          bezeichnung: row.bezeichnung,
          fachId: row.fachId,
          kursart: row.kursart,
          wochenstunden: row.wochenstunden,
          jahrgangIds: new Set(),
        });
      }
      const gruppe = neueGruppen.get(row.zielkursText);
      gruppe.rows.push(row);
      if (row.klasseJahrgangId != null) gruppe.jahrgangIds.add(row.klasseJahrgangId);
    }

    let neueKurseAnzahl = 0;
    for (const [kuerzel, gruppe] of neueGruppen) {
      if (!gruppe.kursart) {
        log.textContent += `Kurs "${kuerzel}" konnte nicht angelegt werden: Kursart fehlt.\n`;
        uebersprungen += gruppe.rows.length;
        continue;
      }
      try {
        const neuerKurs = await SvwsApi.createKurs({
          idSchuljahresabschnitt: abschnittId,
          kuerzel,
          kursartAllg: gruppe.kursart,
          idFach: gruppe.fachId,
          bezeichnungZeugnis: gruppe.bezeichnung || null,
          wochenstunden: gruppe.wochenstunden,
          istSichtbar: true,
          idJahrgaenge: Array.from(gruppe.jahrgangIds),
          schienen: [],
        });
        schildKurse.push(neuerKurs);
        kursById.set(neuerKurs.id, neuerKurs);
        neueKurseAnzahl++;
        for (const r of gruppe.rows) {
          finalEntries.push({ quellkursId: autosplitKlasseQuellkursId, klasseId: r.klasseId, zielkursId: neuerKurs.id });
        }
        log.textContent += `Kurs "${neuerKurs.kuerzel}" angelegt (${gruppe.rows.length} Klasse(n)).\n`;
      } catch (err) {
        log.textContent += `Kurs "${kuerzel}" konnte nicht angelegt werden: ${err.message}\n`;
        uebersprungen += gruppe.rows.length;
      }
    }

    state.splitKlasseRows.push(...finalEntries);
    persist();
    buildKursDatalistMitAnzahl();
    renderSplitKlasseTable();

    autosplitKlasseProposalRows = [];
    autosplitKlasseQuellkursId = null;
    $("autosplit-klasse-quellkurs-input").value = "";
    renderAutosplitKlasseTable();

    $("btn-autosplit-klasse-uebernehmen").disabled = false;
    setStatus(
      statusEl,
      `${finalEntries.length} Zeile(n) übernommen (${neueKurseAnzahl} neue(r) Kurs(e) angelegt)` +
        (uebersprungen ? `, ${uebersprungen} übersprungen (siehe Protokoll)` : "") +
        ".",
      uebersprungen ? "warn" : "ok"
    );
  }

  function renderSplitKlasseTable() {
    const tbody = document.querySelector("#split-klasse-table tbody");
    tbody.innerHTML = state.splitKlasseRows
      .map((row, idx) => {
        const quellkurs = row.quellkursId != null ? kursById.get(row.quellkursId) : null;
        const zielkurs = row.zielkursId != null ? kursById.get(row.zielkursId) : null;
        const anzahlByKlasse = quellkurs ? klasseAnzahlByKurs(quellkurs).anzahlByKlasse : null;
        return `
        <tr data-row-idx="${idx}">
          <td><input type="text" class="split-klasse-quellkurs-input" list="kurs-datalist-anzahl" value="${escapeHtml(quellkurs ? kursLabelMitAnzahl(quellkurs) : "")}" placeholder="Kurs wählen" /></td>
          <td><select class="split-klasse-klasse-select">${klasseOptionsHtml(row.klasseId, anzahlByKlasse)}</select></td>
          <td>
            <input type="text" class="split-klasse-zielkurs-input" list="kurs-datalist-anzahl" value="${escapeHtml(zielkurs ? kursLabelMitAnzahl(zielkurs) : "")}" placeholder="vorhandenen Kurs wählen" />
            <button type="button" class="btn-secondary split-klasse-zielkurs-create" title="Neuen Kurs für diese Zeile anlegen">+ Kurs</button>
          </td>
          <td class="row-actions">
            <button type="button" class="btn-secondary split-klasse-add-below">+ Klasse</button>
            <button type="button" class="btn-secondary split-klasse-remove-row">✕</button>
          </td>
        </tr>`;
      })
      .join("");
  }

  function splitKlasseRowIndex(evt) {
    return Number(evt.target.closest("tr").dataset.rowIdx);
  }

  function onSplitKlasseQuellkursChange(evt) {
    const idx = splitKlasseRowIndex(evt);
    const id = idFromLabel(evt.target.value.trim());
    state.splitKlasseRows[idx].quellkursId = id != null && kursById.has(id) ? id : null;
    persist();
    renderSplitKlasseTable();
  }

  function onSplitKlasseKlasseChange(evt) {
    const idx = splitKlasseRowIndex(evt);
    state.splitKlasseRows[idx].klasseId = evt.target.value ? Number(evt.target.value) : null;
    persist();
  }

  function onSplitKlasseZielkursChange(evt) {
    const idx = splitKlasseRowIndex(evt);
    const id = idFromLabel(evt.target.value.trim());
    state.splitKlasseRows[idx].zielkursId = id != null && kursById.has(id) ? id : null;
    persist();
    renderSplitKlasseTable();
  }

  function onSplitKlasseAddRow() {
    state.splitKlasseRows.push({ quellkursId: null, klasseId: null, zielkursId: null });
    persist();
    renderSplitKlasseTable();
  }

  function onSplitKlasseAddBelow(evt) {
    const idx = splitKlasseRowIndex(evt);
    const quelle = state.splitKlasseRows[idx];
    state.splitKlasseRows.splice(idx + 1, 0, { quellkursId: quelle.quellkursId, klasseId: null, zielkursId: null });
    persist();
    renderSplitKlasseTable();
  }

  function onSplitKlasseRemoveRow(evt) {
    const idx = splitKlasseRowIndex(evt);
    state.splitKlasseRows.splice(idx, 1);
    persist();
    renderSplitKlasseTable();
  }

  function onSplitKlasseCreateZielkurs(evt) {
    const idx = splitKlasseRowIndex(evt);
    const row = state.splitKlasseRows[idx];
    const quellkurs = row.quellkursId != null ? kursById.get(row.quellkursId) : null;
    const klasse = row.klasseId != null ? schildKlassen.find((k) => k.id === row.klasseId) : null;
    const klasseLabel = klasse ? klasse.kuerzel || klasse.beschreibung || "" : "";
    const kuerzelSuggestion = quellkurs ? [quellkurs.kuerzel, klasseLabel].filter(Boolean).join("-") : "";

    openCreateKursDialog({
      displayText: quellkurs ? `Split-Zeile: ${quellkurs.kuerzel} → ${klasseLabel || "?"}` : "Split-Zeile",
      kuerzelSuggestion,
      bezeichnungSuggestion: quellkurs ? quellkurs.bezeichnungZeugnis || kuerzelSuggestion : "",
      fachId: quellkurs ? quellkurs.idFach : null,
      kursart: quellkurs ? quellkurs.kursartAllg : "",
      wochenstunden: quellkurs ? quellkurs.wochenstunden : 2,
      jahrgangIds: klasse && klasse.idJahrgang != null ? [klasse.idJahrgang] : null,
      onCreated: (neuerKurs) => {
        row.zielkursId = neuerKurs.id;
        persist();
        renderSplitKlasseTable();
        setStatus($("split-klasse-status"), `Kurs "${neuerKurs.kuerzel}" angelegt und als Zielkurs eingetragen.`, "ok");
      },
    });
  }

  async function onExecuteSplitKlasse() {
    const log = $("split-klasse-log");
    const statusEl = $("split-klasse-status");
    const progressEl = $("split-klasse-progress");
    log.textContent = "";

    const rows = state.splitKlasseRows.filter((r) => r.quellkursId != null && r.klasseId != null && r.zielkursId != null);
    if (rows.length === 0) {
      setStatus(statusEl, "Keine vollständig ausgefüllten Zeilen (Quellkurs, Klasse und Zielkurs nötig).", "error");
      return;
    }

    $("btn-split-klasse-execute").disabled = true;
    progressEl.classList.remove("hidden");
    progressEl.max = rows.length;
    progressEl.value = 0;

    let gesamtVerschoben = 0;
    let gesamtFehler = 0;
    let zeilenNr = 0;

    for (const row of rows) {
      zeilenNr++;
      progressEl.value = zeilenNr;
      const quellkurs = kursById.get(row.quellkursId);
      const klasse = schildKlassen.find((k) => k.id === row.klasseId);
      if (!quellkurs || !klasse) {
        log.textContent += `Zeile ${zeilenNr}: Quellkurs oder Klasse nicht mehr gültig, übersprungen.\n`;
        gesamtFehler++;
        continue;
      }
      const klasseLabel = klasse.kuerzel || klasse.beschreibung || `#${klasse.id}`;

      setStatus(statusEl, `Zeile ${zeilenNr}/${rows.length}: ${quellkurs.kuerzel} → ${klasseLabel} …`, "");
      log.textContent += `Zeile ${zeilenNr}: Quellkurs "${quellkurs.kuerzel}", Klasse "${klasseLabel}" …\n`;

      const zielkurs = kursById.get(row.zielkursId);
      if (!zielkurs) {
        log.textContent += `  Zielkurs nicht mehr gültig, übersprungen.\n`;
        gesamtFehler++;
        continue;
      }
      if (zielkurs.id === quellkurs.id) {
        log.textContent += `  Quellkurs und Zielkurs sind identisch, übersprungen.\n`;
        continue;
      }

      const kandidaten = [];
      let nichtImStatusFilter = 0;
      for (const s of quellkurs.schueler || []) {
        const voll = schuelerById.get(s.id);
        if (!voll) {
          nichtImStatusFilter++;
          continue;
        }
        if (voll.idKlasse === klasse.id) kandidaten.push(s);
      }
      if (kandidaten.length === 0) {
        log.textContent += `  Keine passenden Schüler:innen im Quellkurs gefunden${
          nichtImStatusFilter ? ` (${nichtImStatusFilter} Schüler:innen im Kurs sind nicht im aktuell geladenen Status-Filter enthalten)` : ""
        }.\n`;
        continue;
      }

      const ladBySchueler = new Map();
      await mapWithConcurrency(kandidaten, 6, async (s) => {
        try {
          ladBySchueler.set(s.id, await SvwsApi.getLernabschnittsdaten(s.id, abschnittId));
        } catch (e) {
          ladBySchueler.set(s.id, null);
        }
      });

      const ops = [];
      let ladFehler = 0;
      for (const s of kandidaten) {
        const lad = ladBySchueler.get(s.id);
        if (!lad) {
          ladFehler++;
          continue;
        }
        const quellEintrag = (lad.leistungsdaten || []).find((l) => l.kursID === quellkurs.id);
        if (!quellEintrag) continue;
        const hatSchonZiel = (lad.leistungsdaten || []).some((l) => l.kursID === zielkurs.id);
        ops.push({
          schuelerLabel: schuelerLabel(s),
          quellEintragId: quellEintrag.id,
          createPayload: hatSchonZiel ? null : buildSplitLeistungsdatenPayload(quellEintrag, zielkurs),
        });
      }

      const toCreate = ops.filter((op) => op.createPayload);
      const createResult = await batchWithBisection(toCreate, (subset) =>
        SvwsApi.createLeistungsdatenMultiple(subset.map((op) => op.createPayload))
      );
      const fehlgeschlageneOps = new Set(createResult.failed.map((f) => f.item));

      const toDelete = ops.filter((op) => !op.createPayload || !fehlgeschlageneOps.has(op));
      const deleteResult = await batchWithBisection(
        toDelete.map((op) => op.quellEintragId),
        (subset) => SvwsApi.deleteLeistungsdatenMultiple(subset)
      );

      gesamtVerschoben += deleteResult.ok;
      const zeilenFehler = createResult.failed.length + deleteResult.failed.length + ladFehler;
      gesamtFehler += zeilenFehler;

      log.textContent +=
        `  ${deleteResult.ok} Schüler:innen verschoben` +
        (createResult.failed.length ? `, ${createResult.failed.length} Anlage-Fehler (Quelleintrag bewusst nicht gelöscht)` : "") +
        (deleteResult.failed.length ? `, ${deleteResult.failed.length} Lösch-Fehler (jetzt evtl. doppelt vorhanden)` : "") +
        (ladFehler ? `, ${ladFehler}x Lernabschnittsdaten nicht ladbar` : "") +
        ".\n";
      for (const f of createResult.failed) log.textContent += `    Anlegen fehlgeschlagen (${f.item.schuelerLabel}): ${f.message}\n`;
      for (const f of deleteResult.failed) log.textContent += `    Löschen fehlgeschlagen (Leistungsdaten-ID ${f.item}): ${f.message}\n`;
      log.scrollTop = log.scrollHeight;
    }

    persist();
    if (gesamtVerschoben > 0) {
      log.textContent += `Aktualisiere Kursbelegung …\n`;
      await refreshKursBelegung();
      log.textContent += `Kursbelegung aktualisiert.\n`;
      log.scrollTop = log.scrollHeight;
    } else {
      renderSplitKlasseTable();
    }
    progressEl.classList.add("hidden");
    $("btn-split-klasse-execute").disabled = false;
    setStatus(
      statusEl,
      `Fertig: ${gesamtVerschoben} Schüler:innen verschoben${gesamtFehler ? `, ${gesamtFehler} Fehler (siehe Protokoll)` : ""}.`,
      gesamtFehler ? "warn" : "ok"
    );
  }

  // ---------- 6. Leere Kurse suchen ----------
  // "Prüfen" durchsucht alle geladenen Kurse ohne Vorbedingung (rein clientseitig auf dem bereits
  // geladenen `schildKurse` - kein API-Aufruf nötig, die Teilnehmerzahl steckt schon im eingebetteten
  // `schueler[]`-Array). Die Fach-/Kursart-Filter sitzen direkt als Checkbox-Popover im jeweiligen
  // Spaltenkopf (Excel-artig), werden aus den tatsächlich gefundenen Treffern befüllt und wirken sofort
  // auf die Anzeige, ohne dass "Prüfen" erneut geklickt werden muss - dieselbe Filter-Auswahl wird wie
  // zuvor in `state.leereKurseFilter` gesichert (leeres Array = kein Filter aktiv = alles anzeigen).

  let leereKurseResults = []; // [{kursId, kursLabel, fachLabel, fachKuerzel, kursart}]
  let leereKurseSort = { key: "kurs", dir: "asc" };

  function onRunLeereKurse() {
    if (schildKurse.length === 0) {
      setStatus($("leere-kurse-status"), "Bitte zuerst Schild-Daten laden.", "error");
      return;
    }
    const fachById = new Map(schildFaecher.map((f) => [f.id, f]));
    leereKurseResults = schildKurse
      .filter((k) => (k.schueler || []).length === 0)
      .map((k) => {
        const fach = fachById.get(k.idFach);
        return {
          kursId: k.id,
          kursLabel: kursLabel(k),
          fachLabel: fach ? `${fach.kuerzel} – ${fach.bezeichnung || ""}` : k.idFach != null ? `Fach-ID ${k.idFach}` : "(kein Fach)",
          kursart: k.kursartAllg || "",
        };
      });

    populateLeereKurseFilters();
    renderLeereKurseTable();
    setStatus(
      $("leere-kurse-status"),
      `${leereKurseResults.length} leere Kurse gefunden.`,
      leereKurseResults.length ? "warn" : "ok"
    );
  }

  /** Baut die Checkbox-Listen in den beiden Spaltenkopf-Popovern (Fach, Kursart) aus den *tatsächlich*
   *  gefundenen `leereKurseResults` - nicht aus dem gesamten Schild-Fächerkatalog, damit die Liste kurz
   *  und relevant bleibt ("aus den vorhandenen Einträgen wählen"). */
  function populateLeereKurseFilters() {
    const gespeichertFach = state.leereKurseFilter.fachLabels || [];
    const gespeichertKursart = state.leereKurseFilter.kursarten || [];

    const fachEintraege = Array.from(new Set(leereKurseResults.map((r) => r.fachLabel))).sort((a, b) =>
      a.localeCompare(b, "de")
    );
    $("leere-kurse-fach-filter-options").innerHTML = fachEintraege
      .map((label) => {
        const checked = gespeichertFach.length === 0 || gespeichertFach.includes(label);
        return `<label><input type="checkbox" class="leere-kurse-fach-cb" value="${escapeHtml(label)}" ${checked ? "checked" : ""}/> ${escapeHtml(label)}</label>`;
      })
      .join("");

    const kursarten = Array.from(new Set(leereKurseResults.map((r) => r.kursart))).sort();
    $("leere-kurse-kursart-filter-options").innerHTML = kursarten
      .map((ka) => {
        const anzeige = ka || "(ohne Kursart)";
        const checked = gespeichertKursart.length === 0 || gespeichertKursart.includes(ka);
        return `<label><input type="checkbox" class="leere-kurse-kursart-cb" value="${escapeHtml(ka)}" ${checked ? "checked" : ""}/> ${escapeHtml(anzeige)}</label>`;
      })
      .join("");

    document
      .querySelectorAll(".leere-kurse-fach-cb, .leere-kurse-kursart-cb")
      .forEach((cb) => cb.addEventListener("change", onLeereKurseFilterChange));
    updateColFilterButtonState();
  }

  function persistLeereKurseFilter() {
    state.leereKurseFilter = {
      fachLabels: Array.from(document.querySelectorAll(".leere-kurse-fach-cb:checked")).map((cb) => cb.value),
      kursarten: Array.from(document.querySelectorAll(".leere-kurse-kursart-cb:checked")).map((cb) => cb.value),
    };
    persist();
  }

  /** Ein Filter gilt als "aktiv" (Button hervorgehoben), wenn nicht ausnahmslos alle Optionen angehakt
   *  sind - konsistent zur Anzeige-Logik in filteredLeereKurseRows() (leeres Array = alles anzeigen). */
  function updateColFilterButtonState() {
    const fachCbs = document.querySelectorAll(".leere-kurse-fach-cb");
    const fachAktiv = fachCbs.length > 0 && !Array.from(fachCbs).every((cb) => cb.checked);
    $("leere-kurse-fach-filter-btn").classList.toggle("active", fachAktiv);
    const kursartCbs = document.querySelectorAll(".leere-kurse-kursart-cb");
    const kursartAktiv = kursartCbs.length > 0 && !Array.from(kursartCbs).every((cb) => cb.checked);
    $("leere-kurse-kursart-filter-btn").classList.toggle("active", kursartAktiv);
  }

  function onLeereKurseFilterChange() {
    persistLeereKurseFilter();
    updateColFilterButtonState();
    renderLeereKurseTable();
  }

  // Generisch für alle Spaltenkopf-Filter-Popover auf dieser Seite (aktuell: "Leere Kurse suchen"
  // Fach/Kursart sowie "Leistungsdaten mit leerem Kurs" Kursart) - jeweils per Popover-Element-ID
  // angesprochen statt über eine feste Enum-Liste, damit sich künftig leicht weitere ergänzen lassen.
  let openColFilterPopoverId = null;

  function toggleColFilterPopover(popoverId) {
    if (openColFilterPopoverId === popoverId) {
      closeColFilterPopovers();
      return;
    }
    closeColFilterPopovers();
    openColFilterPopoverId = popoverId;
    $(popoverId).classList.remove("hidden");
  }

  function closeColFilterPopovers() {
    openColFilterPopoverId = null;
    document.querySelectorAll(".col-filter-popover").forEach((el) => el.classList.add("hidden"));
  }

  function compareLeereKurse(a, b, key) {
    if (key === "id") return a.kursId - b.kursId;
    if (key === "fach") return a.fachLabel.localeCompare(b.fachLabel, "de");
    if (key === "kursart") return (a.kursart || "").localeCompare(b.kursart || "", "de");
    return a.kursLabel.localeCompare(b.kursLabel, "de");
  }

  function updateLeereKurseSortIndicators() {
    document.querySelectorAll("#leere-kurse-table .th-sort-btn").forEach((btn) => {
      const active = btn.dataset.sortKey === leereKurseSort.key;
      const arrow = active ? (leereKurseSort.dir === "asc" ? " ▲" : " ▼") : "";
      btn.textContent = btn.dataset.label + arrow;
      btn.classList.toggle("sort-active", active);
    });
  }

  function onLeereKurseSortClick(evt) {
    const btn = evt.target.closest(".th-sort-btn");
    if (!btn) return;
    const key = btn.dataset.sortKey;
    if (leereKurseSort.key === key) leereKurseSort.dir = leereKurseSort.dir === "asc" ? "desc" : "asc";
    else leereKurseSort = { key, dir: "asc" };
    updateLeereKurseSortIndicators();
    renderLeereKurseTable();
  }

  /** Wendet Suchfeld UND die beiden Spaltenkopf-Filter auf leereKurseResults an (ungesortiert). Leeres
   *  Filter-Array = kein Filter aktiv = alles anzeigen (siehe state.leereKurseFilter-Kommentar in
   *  storage.js). */
  function filteredLeereKurseRows() {
    const suchtext = $("leere-kurse-suche").value.trim().toLowerCase();
    const fachFilter = state.leereKurseFilter.fachLabels || [];
    const kursartFilter = state.leereKurseFilter.kursarten || [];
    return leereKurseResults.filter((r) => {
      if (fachFilter.length > 0 && !fachFilter.includes(r.fachLabel)) return false;
      if (kursartFilter.length > 0 && !kursartFilter.includes(r.kursart)) return false;
      if (suchtext && ![r.kursLabel, r.fachLabel, r.kursart].some((v) => v.toLowerCase().includes(suchtext))) return false;
      return true;
    });
  }

  function renderLeereKurseTable() {
    const tbody = document.querySelector("#leere-kurse-table tbody");
    let rows = filteredLeereKurseRows();
    rows = [...rows].sort((a, b) => {
      const cmp = compareLeereKurse(a, b, leereKurseSort.key);
      return leereKurseSort.dir === "asc" ? cmp : -cmp;
    });
    tbody.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td><input type="checkbox" class="leere-kurse-row" data-id="${r.kursId}" checked /></td>
        <td>${escapeHtml(r.kursLabel)}</td>
        <td>${escapeHtml(r.fachLabel)}</td>
        <td>${escapeHtml(r.kursart)}</td>
        <td>${r.kursId}</td>
        <td><button type="button" class="btn-secondary leere-kurse-delete-single" data-id="${r.kursId}">Löschen</button></td>
      </tr>`
      )
      .join("");
    $("leere-kurse-select-all").checked = rows.length > 0;
    $("btn-delete-leere-kurse").disabled = rows.length === 0;
    $("btn-leere-kurse-sortierung-null").disabled = rows.length === 0;
    $("leere-kurse-treffer-hinweis").textContent =
      leereKurseResults.length === 0
        ? ""
        : rows.length === leereKurseResults.length
        ? `${leereKurseResults.length} Treffer.`
        : `${rows.length} von ${leereKurseResults.length} Treffern angezeigt (gefiltert).`;
  }

  /** "Ausgewählte mit Sortierung 0 versehen": Löschen von Kursen ist über die SVWS-API Stand Juli 2026
   *  serverseitig gesperrt (siehe Hinweistext oben) - als Workaround lassen sich leere Kurse stattdessen
   *  direkt in Schild3 markieren und per Rechtsklick-Kontextmenü löschen. Damit sie dort in der Sortierung
   *  "Benutzerdefiniert" ganz oben (und damit leicht auffindbar) erscheinen, setzt dieser Button per PATCH
   *  (läuft im normalen Server-Modus, anders als DELETE) bei den per Checkbox ausgewählten Kursen das Feld
   *  "sortierung" auf 0. */
  async function onLeereKurseSortierungNull() {
    const checked = Array.from(document.querySelectorAll(".leere-kurse-row:checked"));
    if (checked.length === 0) return;
    const rows = checked
      .map((cb) => leereKurseResults.find((r) => r.kursId === Number(cb.dataset.id)))
      .filter(Boolean);
    const log = $("leere-kurse-log");
    const statusEl = $("leere-kurse-status");
    log.textContent = `Setze Sortierung auf 0 bei ${rows.length} Kurs(en) …\n`;
    $("btn-leere-kurse-sortierung-null").disabled = true;

    let ok = 0;
    let fehlgeschlagen = 0;
    await mapWithConcurrency(rows, 6, async (row) => {
      try {
        await SvwsApi.patchKurs(row.kursId, { sortierung: 0 });
        const kurs = kursById.get(row.kursId);
        if (kurs) kurs.sortierung = 0;
        ok++;
        log.textContent += `- ${row.kursLabel}: Sortierung auf 0 gesetzt.\n`;
      } catch (err) {
        fehlgeschlagen++;
        log.textContent += `- ${row.kursLabel}: FEHLGESCHLAGEN – ${err.message}\n`;
      }
    });
    log.scrollTop = log.scrollHeight;

    $("btn-leere-kurse-sortierung-null").disabled = leereKurseResults.length === 0;
    setStatus(
      statusEl,
      fehlgeschlagen === 0
        ? `Sortierung bei ${ok} Kurs(en) auf 0 gesetzt – in Schild3 bei Sortierung "Benutzerdefiniert" markieren und per Rechtsklick löschen.`
        : `${ok} Kurs(e) angepasst, ${fehlgeschlagen} fehlgeschlagen.`,
      fehlgeschlagen === 0 ? "ok" : "warn"
    );
  }

  function onLeereKurseSelectAll(evt) {
    document.querySelectorAll(".leere-kurse-row").forEach((cb) => (cb.checked = evt.target.checked));
  }

  async function deleteLeereKurseIds(ids) {
    const log = $("leere-kurse-log");
    log.textContent = `Lösche ${ids.length} Kurs(e) …\n`;
    $("btn-delete-leere-kurse").disabled = true;

    let ok = 0;
    let fehlgeschlagen = 0;
    try {
      const antworten = await SvwsApi.deleteKurseMultiple(ids);
      for (const antwort of antworten) {
        const row = leereKurseResults.find((r) => r.kursId === antwort.id);
        const label = row ? row.kursLabel : `Kurs-ID ${antwort.id}`;
        if (antwort.success) {
          ok++;
          log.textContent += `- ${label}: gelöscht.\n`;
        } else {
          fehlgeschlagen++;
          log.textContent += `- ${label}: FEHLGESCHLAGEN${antwort.log && antwort.log.length ? " – " + antwort.log.join(" ") : ""}\n`;
        }
      }
      const geloeschtIds = new Set(antworten.filter((a) => a.success).map((a) => a.id));
      leereKurseResults = leereKurseResults.filter((r) => !geloeschtIds.has(r.kursId));
      renderLeereKurseTable();
      if (ok > 0) {
        log.textContent += `Aktualisiere Kursbelegung …\n`;
        await refreshKursBelegung();
        log.textContent += `Kursbelegung aktualisiert.\n`;
      }
    } catch (err) {
      fehlgeschlagen = ids.length;
      log.textContent += `FEHLER – ${err.message}\n`;
    }
    log.scrollTop = log.scrollHeight;

    setStatus(
      $("leere-kurse-status"),
      fehlgeschlagen === 0 ? `${ok} Kurs(e) gelöscht.` : `${ok} gelöscht, ${fehlgeschlagen} fehlgeschlagen.`,
      fehlgeschlagen === 0 ? "ok" : "warn"
    );
    $("btn-delete-leere-kurse").disabled = leereKurseResults.length === 0;
  }

  async function onDeleteLeereKurseSelected() {
    const checked = Array.from(document.querySelectorAll(".leere-kurse-row:checked"));
    if (checked.length === 0) return;
    const sicher = confirm(
      `${checked.length} Kurs(e) wirklich unwiderruflich aus Schild löschen? Das betrifft den Kurs selbst (nicht nur Leistungsdaten) und kann nicht rückgängig gemacht werden.`
    );
    if (!sicher) return;
    await deleteLeereKurseIds(checked.map((cb) => Number(cb.dataset.id)));
  }

  async function onDeleteLeereKurseSingle(evt) {
    const sicher = confirm(
      "Diesen Kurs wirklich unwiderruflich aus Schild löschen? Das betrifft den Kurs selbst (nicht nur Leistungsdaten) und kann nicht rückgängig gemacht werden."
    );
    if (!sicher) return;
    await deleteLeereKurseIds([Number(evt.target.dataset.id)]);
  }

  // ---------- 7. Blockung mit Leistungsdaten abgleichen ----------
  // Gost-Kursart ist serverseitig ein festes Java-Enum (keine Katalog-API dafür) - Zuordnung aus dem
  // SVWS-Server-Quellcode (de.svws_nrw.core.types.gost.GostKursart) übernommen, ändert sich praktisch nie.
  const GOST_KURSART_LABELS = { 1: "LK", 2: "GK", 3: "ZK", 4: "PJK", 5: "VTF" };
  function gostKursartLabel(id) {
    return GOST_KURSART_LABELS[id] || `Kursart-ID ${id}`;
  }

  /** Extrahiert die Kursnummer aus einem Kurs-Kürzel (z.B. "SP-GK3" -> 3, "D-LK1" -> 1) - die am Ende
   *  stehende Zahl. Liefert `null`, wenn das Kürzel nicht auf eine Zahl endet. Wird nur als Notlösung
   *  gebraucht, um bei mehreren parallelen Kursen desselben Fachs/derselben Kursart (z.B. zwei GK-Kurse)
   *  den laut Blockungs-Kursnummer richtigen zu finden - siehe Kommentar bei `onRunBlockungAbgleich()`. */
  function parseKursnummerAusKuerzel(kuerzel) {
    const m = /(\d+)\s*$/.exec(kuerzel || "");
    return m ? Number(m[1]) : null;
  }

  /** GostHalbjahr-Enum-Index (0=EF.1 … 5=Q2.2), wie ihn `/gost/abiturjahrgang/{abiturjahr}/{halbjahr}/…`
   *  erwartet. WICHTIG: Das `halbjahr`-Feld aus `GostJahrgang` (`/gost/abiturjahrgaenge/{idAbschnitt}`) ist
   *  NICHT dieser Enum-Index, sondern schlicht "1" oder "2" - welche Hälfte des Schuljahres der jeweilige
   *  Abschnitt ist (dieselbe 1/2-Zählung wie beim Verbindungs-Feld "Abschnitt"). Muss deshalb zusammen mit
   *  dem Jahrgangs-Label (EF/Q1/Q2) erst in den echten Enum-Index umgerechnet werden - sonst landet man
   *  (wie ursprünglich in dieser Funktion geschehen) bei der falschen, oft längst vergangenen Blockung. */
  const GOST_JAHRGANG_BASIS = { EF: 0, Q1: 2, Q2: 4 };
  function gostHalbjahrIndex(jahrgangLabel, schuljahresHalbjahr) {
    const basis = GOST_JAHRGANG_BASIS[jahrgangLabel];
    if (basis == null) return null;
    return basis + (Number(schuljahresHalbjahr) === 2 ? 1 : 0);
  }

  let gostJahrgaenge = []; // [{abiturjahr, jahrgang, halbjahr, bezeichnung, ...}], ohne den Platzhalter abiturjahr=-1 und ohne Jahrgänge unterhalb der Oberstufe (EF/Q1/Q2)
  let gostBlockungen = []; // [{id, name, istAktiv, idAktivesErgebnis, ...}] - für die aktuell gewählte Stufe
  let blockungAbgleichResults = []; // [{schuelerLabel, fachLabel, kursart, kursBlockungLabel, kursLeistungsdatenLabel, hinweis}]

  /** Lädt die verfügbaren Stufen (Abiturjahrgänge) für den aktuell verbundenen Schuljahresabschnitt - wird
   *  einmalig nach "Schild-Daten laden" aufgerufen, analog zu den anderen Katalogen dort. Ein Fehler hier
   *  (z.B. auf einer Schule ohne gymnasiale Oberstufe) soll "Schild-Daten laden" nicht blockieren. */
  async function populateBlockungAbgleichStufen() {
    const select = $("blockung-abgleich-stufe");
    select.innerHTML = '<option value="">(wählen)</option>';
    try {
      const alle = await SvwsApi.getGostAbiturjahrgaenge(abschnittId);
      gostJahrgaenge = alle.filter((j) => j.abiturjahr !== -1 && GOST_JAHRGANG_BASIS[j.jahrgang] != null);
    } catch (err) {
      gostJahrgaenge = [];
      console.warn("Abiturjahrgänge konnten nicht geladen werden (evtl. keine gymnasiale Oberstufe):", err);
      return;
    }
    select.innerHTML +=
      '<option value="">(wählen)</option>' +
      gostJahrgaenge
        .map(
          (j, idx) =>
            `<option value="${idx}">${escapeHtml(j.jahrgang || "?")} (Abi ${j.abiturjahr})</option>`
        )
        .join("");
  }

  /** Stufe gewechselt: lädt die dafür verfügbaren Blockungen (im aktuellen Halbjahr dieser Stufe) und
   *  wählt, falls vorhanden, die als aktiv markierte Blockung vor. */
  async function onBlockungAbgleichStufeChange() {
    const stufeSelect = $("blockung-abgleich-stufe");
    const blockungSelect = $("blockung-abgleich-blockung");
    const statusEl = $("blockung-abgleich-status");
    gostBlockungen = [];
    blockungSelect.innerHTML = '<option value="">(erst Stufe wählen)</option>';
    blockungSelect.disabled = true;
    $("btn-run-blockung-abgleich").disabled = true;
    setStatus(statusEl, "", "");

    const jahrgang = gostJahrgaenge[Number(stufeSelect.value)];
    if (!jahrgang) return;

    const halbjahrIndex = gostHalbjahrIndex(jahrgang.jahrgang, jahrgang.halbjahr);
    if (halbjahrIndex == null) {
      blockungSelect.innerHTML = '<option value="">(unbekanntes Halbjahr)</option>';
      setStatus(statusEl, `Konnte das Gost-Halbjahr für Jahrgang "${jahrgang.jahrgang}" nicht bestimmen.`, "error");
      return;
    }

    blockungSelect.innerHTML = '<option value="">Lade Blockungen …</option>';
    try {
      gostBlockungen = await SvwsApi.getGostBlockungen(jahrgang.abiturjahr, halbjahrIndex);
    } catch (err) {
      blockungSelect.innerHTML = '<option value="">(Fehler beim Laden)</option>';
      setStatus(statusEl, err.message, "error");
      return;
    }
    if (gostBlockungen.length === 0) {
      blockungSelect.innerHTML = '<option value="">(keine Blockung für diese Stufe/dieses Halbjahr)</option>';
      return;
    }
    const aktivIdx = gostBlockungen.findIndex((b) => b.istAktiv);
    // Blockungs-/Ergebnis-ID werden mit angezeigt, damit sie sich beim manuellen Nachprüfen einzelner
    // Treffer (z.B. über die Swagger-UI) nicht erst aus den Netzwerk-Requests des Browsers zusammensuchen
    // lassen müssen.
    blockungSelect.innerHTML = gostBlockungen
      .map(
        (b, idx) =>
          `<option value="${idx}" ${idx === aktivIdx ? "selected" : ""}>${escapeHtml(b.name)}${b.istAktiv ? " (aktiv)" : ""} – Blockung-ID ${b.id}, Ergebnis-ID ${b.idAktivesErgebnis ?? "–"}</option>`
      )
      .join("");
    blockungSelect.disabled = false;
    $("btn-run-blockung-abgleich").disabled = false;
  }

  async function onRunBlockungAbgleich() {
    const statusEl = $("blockung-abgleich-status");
    const blockung = gostBlockungen[Number($("blockung-abgleich-blockung").value)];
    if (!blockung) {
      setStatus(statusEl, "Bitte eine Blockung auswählen.", "error");
      return;
    }
    if (blockung.idAktivesErgebnis == null) {
      setStatus(statusEl, `Blockung "${blockung.name}" hat kein aktives Ergebnis.`, "error");
      return;
    }

    const progressEl = $("blockung-abgleich-progress");
    $("btn-run-blockung-abgleich").disabled = true;
    setStatus(statusEl, "Lade Blockungsergebnis …", "");
    progressEl.classList.add("hidden");

    let ergebnis;
    let blockungsdaten;
    try {
      [ergebnis, blockungsdaten] = await Promise.all([
        SvwsApi.getGostBlockungsergebnis(blockung.idAktivesErgebnis),
        SvwsApi.getGostBlockungsdaten(blockung.id),
      ]);
    } catch (err) {
      setStatus(statusEl, err.message, "error");
      $("btn-run-blockung-abgleich").disabled = false;
      return;
    }

    // Kursnummer/Suffix je Blockungs-Kurs (nur für die Anzeige, z.B. "GK 3") - kommt aus den
    // Blockungsdaten, nicht aus dem Ergebnis. WICHTIG: Blockungs-Kurs-IDs (Gost_Blockung_Kurse.ID) sind
    // eine eigene, von der normalen Kurse-Tabelle unabhängige ID-Reihe (siehe Fehlerbehebung in
    // README.md) - dürfen also NIE gegen kursById aufgelöst werden, das kann einen zufällig
    // gleich-nummerierten, aber völlig anderen echten Kurs liefern.
    const blockungsKursInfo = new Map((blockungsdaten.kurse || []).map((k) => [k.id, k]));
    const blockungsKursLabel = (kursId) => {
      const k = blockungsKursInfo.get(kursId);
      if (!k) return `Blockungs-Kurs-ID ${kursId}`;
      return `Kurs-Nr. ${k.nummer}${k.suffix ? k.suffix : ""}`;
    };

    // Schüler-ID -> [{fachID, kursart, kursId}], aus allen Schienen des Ergebnisses aufgesammelt (ein/e
    // Schüler:in taucht üblicherweise in mehreren Schienen mit je einem Kurs auf).
    const blockungBySchueler = new Map();
    for (const schiene of ergebnis.schienen || []) {
      for (const kurs of schiene.kurse || []) {
        for (const schuelerId of kurs.schueler || []) {
          if (schuelerId == null) continue;
          if (!blockungBySchueler.has(schuelerId)) blockungBySchueler.set(schuelerId, []);
          blockungBySchueler.get(schuelerId).push({ fachID: kurs.fachID, kursart: gostKursartLabel(kurs.kursart), kursId: kurs.id });
        }
      }
    }

    const schuelerIds = Array.from(blockungBySchueler.keys());
    if (schuelerIds.length === 0) {
      setStatus(statusEl, "Diese Blockung enthält keine Schüler-Kurs-Zuordnungen.", "warn");
      $("btn-run-blockung-abgleich").disabled = false;
      return;
    }

    const beideRichtungen = $("blockung-abgleich-beide-richtungen").checked;
    const fachById = new Map(schildFaecher.map((f) => [f.id, f]));
    const fachLabel = (id) => {
      const f = fachById.get(id);
      return f ? `${f.kuerzel} – ${f.bezeichnung || ""}` : `Fach-ID ${id}`;
    };
    const kursLabelOrId = (id) => {
      const k = kursById.get(id);
      return k ? kursLabel(k) : `Kurs-ID ${id}`;
    };

    const total = schuelerIds.length;
    let processed = 0;
    progressEl.max = total;
    progressEl.value = 0;
    progressEl.classList.remove("hidden");

    const results = [];
    let fehler = 0;
    let nichtImStatusFilter = 0;
    await mapWithConcurrency(schuelerIds, 6, async (schuelerId) => {
      try {
        const schueler = schuelerById.get(schuelerId);
        // Die Blockung ist ein eingefrorener Snapshot und enthält auch längst ausgeschiedene/abgemeldete
        // Schüler:innen, die im aktuell geladenen Status-Filter (Schritt 1) nicht mehr auftauchen - für
        // die sind naturgemäß keine aktuellen Leistungsdaten zu erwarten. Ohne diesen Ausschluss würde
        // praktisch jedes Fach dieser Person fälschlich als "fehlt in Leistungsdaten" gemeldet.
        if (!schueler) {
          nichtImStatusFilter++;
          return;
        }
        const label = schuelerLabel(schueler);
        const lad = await SvwsApi.getLernabschnittsdaten(schuelerId, abschnittId);

        // Fach/Kursart für den Vergleich kommen aus dem bereits geladenen Kurskatalog (kursById), NICHT
        // aus den Feldern fachID/kursart auf dem Leistungsdaten-Datensatz selbst (siehe Fehlerbehebung
        // unten - die sind bei per Blockung "hochgeschriebenen" Einträgen nicht zuverlässig befüllt).
        //
        // Ein exakter Kurs-ID-Treffer ist strukturell unmöglich: Blockungs-Kurse (`Gost_Blockung_Kurse`)
        // haben eine eigene, von der echten Kurse-Tabelle unabhängige ID-Reihe, ohne gespeicherte
        // Verknüpfung dazwischen (siehe Fehlerbehebung unten) - der Vergleich läuft deshalb ausschließlich
        // über Fach+Kursart, verfeinert um die Kursnummer (aus dem Kürzel geraten, s.u.), falls es mehrere
        // parallele Kurse desselben Fachs/derselben Kursart gibt (z.B. zwei GK-Kurse).
        const meineKursIds = new Set((lad.leistungsdaten || []).filter((l) => l.kursID != null).map((l) => l.kursID));
        // Kurse, die bereits als "abweichender Kurs" (Ersatz für eine fehlende Blockungszeile) gemeldet
        // wurden, dürfen bei "beide Richtungen" nicht zusätzlich als "nicht in Blockung" auftauchen - sonst
        // erscheint derselbe tatsächliche Kurs für dasselbe Fach doppelt in der Ergebnisliste.
        const alsErsatzVerwendeteKursIds = new Set();

        for (const erwartet of blockungBySchueler.get(schuelerId)) {
          const erwartetInfo = blockungsKursInfo.get(erwartet.kursId);
          const erwartetNummer = erwartetInfo ? erwartetInfo.nummer : null;

          const kandidaten = [];
          for (const kid of meineKursIds) {
            if (alsErsatzVerwendeteKursIds.has(kid)) continue; // nicht zweimal als Ersatz verwenden
            const k = kursById.get(kid);
            if (k && k.idFach === erwartet.fachID && k.kursartAllg === erwartet.kursart) kandidaten.push(kid);
          }

          if (kandidaten.length === 0) {
            results.push({
              schuelerLabel: label,
              fachLabel: fachLabel(erwartet.fachID),
              kursart: erwartet.kursart,
              kursBlockung: blockungsKursLabel(erwartet.kursId),
              kursLeistungsdaten: "– (fehlt)",
              hinweis: "fehlt in Leistungsdaten",
            });
            continue;
          }

          // Genau ein Kandidat: eindeutig (einziger Kurs dieses Fachs/dieser Kursart), gilt als
          // Treffer - keine Meldung nötig, auch ohne Kursnummer-Abgleich. Bei mehreren Kandidaten
          // (parallele Kurse, z.B. zwei GK-Kurse) wird über die aus dem Kürzel geratene Kursnummer
          // versucht, den richtigen eindeutig zu bestimmen; gelingt das, gilt das ebenfalls als Treffer.
          // Nur wenn auch das nicht eindeutig gelingt, wird die Zeile gemeldet (bester Rateversuch als
          // Anzeige, aber als unsicher gekennzeichnet).
          const nummernTreffer =
            erwartetNummer != null ? kandidaten.find((kid) => parseKursnummerAusKuerzel(kursById.get(kid).kuerzel) === erwartetNummer) : null;

          if (kandidaten.length === 1) {
            alsErsatzVerwendeteKursIds.add(kandidaten[0]);
          } else if (nummernTreffer != null) {
            alsErsatzVerwendeteKursIds.add(nummernTreffer);
          } else {
            const bestGuess = kandidaten[0];
            alsErsatzVerwendeteKursIds.add(bestGuess);
            results.push({
              schuelerLabel: label,
              fachLabel: fachLabel(erwartet.fachID),
              kursart: erwartet.kursart,
              kursBlockung: blockungsKursLabel(erwartet.kursId),
              kursLeistungsdaten: `${kursLabelOrId(bestGuess)} (unsicher – ${kandidaten.length} passende Kurse, Kursnummer nicht eindeutig zuordenbar)`,
              hinweis: "abweichender Kurs",
            });
          }
        }

        if (beideRichtungen) {
          for (const kid of meineKursIds) {
            if (alsErsatzVerwendeteKursIds.has(kid)) continue;
            const k = kursById.get(kid);
            results.push({
              schuelerLabel: label,
              fachLabel: k ? fachLabel(k.idFach) : `Kurs-ID ${kid}`,
              kursart: k ? k.kursartAllg || "" : "",
              kursBlockung: "– (nicht in Blockung)",
              kursLeistungsdaten: kursLabelOrId(kid),
              hinweis: "zusätzlich in Leistungsdaten",
            });
          }
        }
      } catch (e) {
        fehler++;
      } finally {
        processed++;
        progressEl.value = processed;
        setStatus(statusEl, `Prüfe ${processed} / ${total} Schüler:innen …`, "");
      }
    });

    progressEl.classList.add("hidden");
    blockungAbgleichResults = results;
    renderBlockungAbgleichTable();
    $("btn-run-blockung-abgleich").disabled = false;
    setStatus(
      statusEl,
      `${results.length} Abweichung(en) bei ${total} Schüler:innen gefunden` +
        (fehler ? ` (${fehler} Schüler:innen konnten nicht geprüft werden)` : "") +
        (nichtImStatusFilter
          ? ` (${nichtImStatusFilter} Schüler:innen aus der Blockung sind nicht im aktuell geladenen Status-Filter enthalten und wurden übersprungen)`
          : "") +
        ".",
      results.length ? "warn" : "ok"
    );
  }

  function renderBlockungAbgleichTable() {
    const tbody = document.querySelector("#blockung-abgleich-table tbody");
    tbody.innerHTML = blockungAbgleichResults
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.schuelerLabel)}</td>
        <td>${escapeHtml(r.fachLabel)}</td>
        <td>${escapeHtml(r.kursart)}</td>
        <td>${escapeHtml(r.kursBlockung)}</td>
        <td>${escapeHtml(r.kursLeistungsdaten)}</td>
        <td>${escapeHtml(r.hinweis)}</td>
      </tr>`
      )
      .join("");
  }

  // ---------- 4. Speichern / Laden ----------
  // Identisch zu Schritt 7 in index.html/js/app.js (derselbe Storage.exportJson()/importJson(), derselbe
  // geteilte state) - bewusst als eigene Kopie hier, damit man für Export/Import/Reset nicht extra auf die
  // andere Seite wechseln muss.

  function onExportJson() {
    Storage.exportJson(state);
    setStatus($("save-load-status"), "JSON-Datei wurde heruntergeladen.", "ok");
  }

  async function onImportJson(evt) {
    const file = evt.target.files[0];
    if (!file) return;
    try {
      state = await Storage.importJson(file);
      Storage.saveStateNow(state);
      populateConnectionFields();
      setStatus($("save-load-status"), "Zustand aus JSON geladen. Bitte erneut verbinden.", "ok");
    } catch (err) {
      setStatus($("save-load-status"), err.message, "error");
    }
  }

  /** Löscht den gesamten gespeicherten Zustand (localStorage) und startet die Seite neu. Betrifft wegen
   *  des geteilten Speichers auch den Kurswahlen-Abgleich (index.html) - z.B. dessen Matching-Tabellen und
   *  Verbindungsdaten -, daher der Hinweis im confirm(). */
  function onResetState() {
    const sicher = confirm(
      "Wirklich alle gespeicherten Zuordnungen und Einstellungen löschen? Das betrifft auch den " +
        "Kurswahlen-Abgleich (index.html), da beide Seiten sich denselben Speicher teilen. Das kann nicht " +
        "rückgängig gemacht werden. Schild-Daten müssen danach erneut geladen werden."
    );
    if (!sicher) return;
    localStorage.removeItem(Storage.STORAGE_KEY);
    location.reload();
  }

  // ---------- Initialisierung ----------

  function init() {
    populateConnectionFields();

    $("btn-connect").addEventListener("click", onConnect);
    $("section-connection").addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && evt.target.tagName === "INPUT") {
        evt.preventDefault();
        onConnect();
      }
    });
    $("btn-load-schild-data").addEventListener("click", onLoadSchildData);
    $("btn-refresh-kursbelegung").addEventListener("click", onRefreshKursBelegung);

    $("create-kurs-form").addEventListener("submit", onCreateKursFormSubmit);
    $("btn-create-kurs-cancel").addEventListener("click", closeCreateKursDialog);

    $("btn-run-check-leerer-kurs").addEventListener("click", onRunCheckLeererKurs);
    $("check-leerer-kurs-select-all").addEventListener("change", onCheckLeererKursSelectAll);
    $("btn-delete-check-leerer-kurs").addEventListener("click", onDeleteCheckLeererKurs);

    $("btn-autosplit-vorschlag").addEventListener("click", onAutosplitVorschlag);
    $("autosplit-select-all").addEventListener("change", onAutosplitSelectAll);
    $("btn-autosplit-uebernehmen").addEventListener("click", onAutosplitUebernehmen);

    $("btn-split-jahrgang-add-row").addEventListener("click", onSplitJahrgangAddRow);
    $("btn-split-jahrgang-execute").addEventListener("click", onExecuteSplitJahrgang);
    document.querySelector("#split-jahrgang-table").addEventListener("change", (evt) => {
      if (evt.target.classList.contains("split-quellkurs-input")) onSplitJahrgangQuellkursChange(evt);
      else if (evt.target.classList.contains("split-jahrgang-select")) onSplitJahrgangJahrgangChange(evt);
      else if (evt.target.classList.contains("split-zielkurs-input")) onSplitJahrgangZielkursChange(evt);
    });
    document.querySelector("#split-jahrgang-table").addEventListener("click", (evt) => {
      if (evt.target.classList.contains("split-add-below")) onSplitJahrgangAddBelow(evt);
      else if (evt.target.classList.contains("split-remove-row")) onSplitJahrgangRemoveRow(evt);
      else if (evt.target.classList.contains("split-zielkurs-create")) onSplitJahrgangCreateZielkurs(evt);
    });

    $("btn-autosplit-klasse-vorschlag").addEventListener("click", onAutosplitKlasseVorschlag);
    $("autosplit-klasse-select-all").addEventListener("change", onAutosplitKlasseSelectAll);
    $("btn-autosplit-klasse-uebernehmen").addEventListener("click", onAutosplitKlasseUebernehmen);

    $("btn-split-klasse-add-row").addEventListener("click", onSplitKlasseAddRow);
    $("btn-split-klasse-execute").addEventListener("click", onExecuteSplitKlasse);
    document.querySelector("#split-klasse-table").addEventListener("change", (evt) => {
      if (evt.target.classList.contains("split-klasse-quellkurs-input")) onSplitKlasseQuellkursChange(evt);
      else if (evt.target.classList.contains("split-klasse-klasse-select")) onSplitKlasseKlasseChange(evt);
      else if (evt.target.classList.contains("split-klasse-zielkurs-input")) onSplitKlasseZielkursChange(evt);
    });
    document.querySelector("#split-klasse-table").addEventListener("click", (evt) => {
      if (evt.target.classList.contains("split-klasse-add-below")) onSplitKlasseAddBelow(evt);
      else if (evt.target.classList.contains("split-klasse-remove-row")) onSplitKlasseRemoveRow(evt);
      else if (evt.target.classList.contains("split-klasse-zielkurs-create")) onSplitKlasseCreateZielkurs(evt);
    });

    $("leere-kurse-fach-filter-btn").addEventListener("click", (evt) => {
      evt.stopPropagation();
      toggleColFilterPopover("leere-kurse-fach-filter-popover");
    });
    $("leere-kurse-kursart-filter-btn").addEventListener("click", (evt) => {
      evt.stopPropagation();
      toggleColFilterPopover("leere-kurse-kursart-filter-popover");
    });
    $("check-leerer-kurs-kursart-filter-btn").addEventListener("click", (evt) => {
      evt.stopPropagation();
      toggleColFilterPopover("check-leerer-kurs-kursart-filter-popover");
    });
    document.querySelectorAll(".col-filter-popover").forEach((pop) => pop.addEventListener("click", (evt) => evt.stopPropagation()));
    document.addEventListener("click", closeColFilterPopovers);
    document.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape") closeColFilterPopovers();
    });

    $("btn-run-leere-kurse").addEventListener("click", onRunLeereKurse);
    $("leere-kurse-select-all").addEventListener("change", onLeereKurseSelectAll);
    $("btn-delete-leere-kurse").addEventListener("click", onDeleteLeereKurseSelected);
    $("btn-leere-kurse-sortierung-null").addEventListener("click", onLeereKurseSortierungNull);
    $("leere-kurse-suche").addEventListener("input", renderLeereKurseTable);
    document.querySelector("#leere-kurse-table").addEventListener("click", (evt) => {
      if (evt.target.classList.contains("leere-kurse-delete-single")) onDeleteLeereKurseSingle(evt);
    });
    document.querySelector("#leere-kurse-table thead").addEventListener("click", onLeereKurseSortClick);
    updateLeereKurseSortIndicators();

    $("blockung-abgleich-stufe").addEventListener("change", onBlockungAbgleichStufeChange);
    $("btn-run-blockung-abgleich").addEventListener("click", onRunBlockungAbgleich);

    $("btn-export-json").addEventListener("click", onExportJson);
    $("import-json-input").addEventListener("change", onImportJson);
    $("btn-reset-state").addEventListener("click", onResetState);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
