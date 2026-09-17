/**
 * Orchestrierung für index.html (Forms-Kurswahlen-Abgleich): verdrahtet die UI mit SvwsApi, FormsImport,
 * Matching und Storage. Hält den nicht-persistenten Laufzeit-Zustand (geladene Schild-/Forms-Daten); der
 * persistente Zustand liegt in `state` (siehe storage.js) und wird bei jeder relevanten Änderung über
 * Storage.scheduleSave(state) gesichert.
 *
 * Die reinen Schild-Wartungswerkzeuge (Kurse splitten, leere Kurse aufräumen, Leistungsdaten mit leerem
 * Kurs finden) sitzen NICHT hier, sondern in js/wartung.js (wartung.html) - eigenständig, aber über
 * denselben localStorage-State verbunden. Einzige Ausnahme ist "Kurse ohne Forms-Wahl" unten (Schritt 8):
 * die braucht zwingend die hier im Wizard laufenden Forms-Daten und bleibt deshalb hier.
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

  let missingStudents = []; // [{id, nachname, vorname, klasse}] – Schild-Schüler ohne Forms-Zuordnung

  let formsParsed = null; // { headers, rows }
  let studentEntries = []; // [{formsName, courses, rowIndex}] – ein Eintrag pro eindeutigem Forms-Namen
  let distinctCourseTexts = [];

  let schuelerLabelToId = new Map(); // für Datalist-Auflösung
  let kursLabelToId = new Map();

  let transferPreviewRows = []; // [{schuelerId, schuelerLabel, kursId, kursLabel, lernabschnittID, existing, fach, kurs}]
  let lernabschnittsdatenCache = new Map(); // schuelerId -> Promise<lernabschnittsdaten>

  // ---------- Hilfsfunktionen ----------
  // Rein zustandslose Utilities kommen aus js/sharedCode.js (identisch von js/wartung.js genutzt, siehe
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

  // ---------- 1. Verbindung ----------

  function populateConnectionFields() {
    $("conn-host").value = state.connection.host || "";
    $("conn-schema").value = state.connection.schema || "";
    $("conn-username").value = state.connection.username || "";
    $("conn-jahr").value = state.connection.jahr || new Date().getFullYear();
    $("conn-abschnitt").value = state.connection.abschnitt || 1;
  }

  /** Trägt die Zugangsdaten des öffentlichen SVWS-Testservers ein (nightly.svws-nrw.de, Schema
   *  TestDB_GY, Benutzer admin, Schuljahr 2026 Abschnitt 1) - Passwort bleibt unangetastet. */
  function fillTestdata() {
    $("conn-host").value = "nightly.svws-nrw.de";
    $("conn-schema").value = "TestDB_GY";
    $("conn-username").value = "admin";
    $("conn-jahr").value = 2026;
    $("conn-abschnitt").value = 1;
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

  /**
   * Entfernt gespeicherte Kurs-Matches (Schritt 5), deren Ziel-Kurs in Schild nicht mehr existiert
   * (z.B. gelöscht). Läuft nach jedem "Schild-Daten laden", also bevor die Kurs-Match-Tabelle in
   * Schritt 5 gerendert wird - betroffene Zeilen erscheinen danach wieder als "kein Treffer" und
   * können neu zugeordnet werden, statt unbemerkt auf einen nicht mehr existierenden Kurs zu zeigen.
   * Ignorierte Einträge (ohne targetId) bleiben unangetastet.
   */
  function pruneStaleKursMatches() {
    let removed = 0;
    for (const [key, entry] of Object.entries(state.kursMatching)) {
      if (entry && !entry.ignored && entry.targetId != null && !kursById.has(entry.targetId)) {
        delete state.kursMatching[key];
        removed++;
      }
    }
    if (removed > 0) persist();
    return removed;
  }

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

      const entfernteKursMatches = pruneStaleKursMatches();

      // Klassen sind nur eine Zusatzinfo für Schritt 4a ("Klasse"-Spalte) - ein Fehler hier soll
      // nicht den ganzen Schritt blockieren, falls dieser Endpunkt auf einem Server mal nicht
      // verfügbar ist (z.B. abweichende Server-Version).
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
        klassenHinweis = " Klassen konnten nicht geladen werden (Klassen-Spalte bei „Schüler ohne Forms-Abgabe“ bleibt leer).";
        console.warn("Klassen konnten nicht geladen werden:", klassenErr);
      }

      // Kursarten sind nur für den "Neuen Kurs anlegen"-Dialog (Schritt 5) nötig - auch hier soll ein
      // Fehler nicht den ganzen Schritt blockieren, das Kürzel-Feld im Dialog bleibt sonst per Freitext nutzbar.
      try {
        schildKursarten = await SvwsApi.getKursarten();
      } catch (kursartenErr) {
        schildKursarten = [];
        console.warn("Kursarten konnten nicht geladen werden:", kursartenErr);
      }

      // Jahrgänge sind ebenfalls nur für den "Neuen Kurs anlegen"-Dialog nötig (Vorbelegung der
      // Jahrgangs-Zuordnung neuer Kurse) - ein Fehler hier soll den Schritt nicht blockieren.
      try {
        schildJahrgaenge = await SvwsApi.getJahrgaenge();
      } catch (jahrgaengeErr) {
        schildJahrgaenge = [];
        console.warn("Jahrgänge konnten nicht geladen werden:", jahrgaengeErr);
      }

      $("schild-data-counts").textContent =
        `${schildSchueler.length} Schüler (gefiltert), ${schildKurse.length} Kurse, ${schildFaecher.length} Fächer, ${schildKlassen.length} Klassen geladen.`;
      const pruneHinweis =
        entfernteKursMatches > 0
          ? ` ${entfernteKursMatches} gespeicherte Kurs-Zuordnung(en) auf nicht mehr existierende Kurse entfernt.`
          : "";
      setStatus(statusEl, "Fertig." + klassenHinweis + pruneHinweis, klassenHinweis || pruneHinweis ? "warn" : "ok");
      reveal("section-forms-import");
      reveal("section-kurse-ohne-wahl");
      buildDatalists();
      populateCreateKursDialogOptions();
      populateKurseOhneWahlFilters();
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

  // DEFAULT_JAHRGANG_KUERZEL kommt aus SharedCode (siehe oben) - deckt Sek I und Oberstufe gleichermaßen
  // ab, damit ein neu angelegter AG-/Wahlkurs nicht durch eine fehlende Jahrgangszuordnung abweicht.

  /** Baut die Jahrgangs-Checkboxen im "Neuen Kurs anlegen"-Dialog neu auf. Wird bei jedem Öffnen des
   *  Dialogs aufgerufen, damit eine vorherige manuelle Auswahl nicht hängen bleibt.
   *  @param preselectIds optionale explizite Vorauswahl (z.B. genau der Jahrgang einer Split-Zeile);
   *    ohne Angabe greift die generische Vorauswahl `DEFAULT_JAHRGANG_KUERZEL`. Immer nur ein Vorschlag -
   *    in beiden Fällen bleibt die Auswahl im Dialog frei änderbar. */
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

  function buildDatalists() {
    const schuelerDatalist = $("schueler-datalist");
    schuelerDatalist.innerHTML = "";
    schuelerLabelToId.clear();
    for (const s of schildSchueler) {
      const label = schuelerLabel(s);
      schuelerLabelToId.set(label, s.id);
      const opt = document.createElement("option");
      opt.value = label;
      schuelerDatalist.appendChild(opt);
    }

    const kursDatalist = $("kurs-datalist");
    kursDatalist.innerHTML = "";
    kursLabelToId.clear();
    for (const k of schildKurse) {
      const label = kursLabel(k);
      kursLabelToId.set(label, k.id);
      const opt = document.createElement("option");
      opt.value = label;
      kursDatalist.appendChild(opt);
    }
  }

  /**
   * Lädt nur die Kursliste (inkl. aktueller Teilnehmerzahlen aus dem eingebetteten `schueler[]`) neu,
   * ohne den kompletten "Schild-Daten laden"-Schritt (Schüler/Klassen/Kursarten/Jahrgänge) zu wiederholen
   * - schneller und reicht aus, um die "Kurse ohne Forms-Wahl"-Vergleichsbasis nach einer Übertragung
   * aktuell zu halten. Wird automatisch am Ende von Schritt 6 (Übertragung) aufgerufen; zusätzlich manuell
   * über den "Kursbelegung aktualisieren"-Button in Schritt 8 (z.B. nach Splits auf der Wartungsseite).
   */
  async function refreshKursBelegung() {
    if (!abschnittId) return false;
    try {
      schildKurse = await SvwsApi.getKurse(abschnittId);
      kursById = new Map(schildKurse.map((k) => [k.id, k]));
      pruneStaleKursMatches();
      buildDatalists();
      populateKurseOhneWahlFilters();
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

  // ---------- 3. Forms-Datei laden ----------

  async function onFormsFileSelected(evt) {
    const file = evt.target.files[0];
    if (!file) return;
    setStatus($("forms-file-status"), "Lese Datei …", "");
    try {
      formsParsed = await FormsImport.parseWorkbook(file);
      setStatus(
        $("forms-file-status"),
        `${formsParsed.rows.length} Antworten, ${formsParsed.headers.length} Spalten erkannt.`,
        "ok"
      );
      renderFormsPreview();
      renderColumnMapping();
      reveal("forms-mapping-wrapper");
    } catch (err) {
      setStatus($("forms-file-status"), err.message, "error");
    }
  }

  function renderFormsPreview() {
    const wrapper = $("forms-preview-wrapper");
    const table = $("forms-preview-table");
    const { headers, rows } = formsParsed;
    const previewRows = rows.slice(0, 5);
    let html = "<thead><tr>" + headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("") + "</tr></thead><tbody>";
    for (const row of previewRows) {
      html += "<tr>" + headers.map((_, i) => `<td>${escapeHtml(row[i] ?? "")}</td>`).join("") + "</tr>";
    }
    html += "</tbody>";
    table.innerHTML = html;
    wrapper.classList.remove("hidden");
  }

  function renderColumnMapping() {
    const { headers, rows } = formsParsed;
    const suggestion = FormsImport.suggestColumnMapping(headers, rows);
    const nameCol = state.columnMapping.nameCol ?? suggestion.nameCol;
    const courseCols = state.columnMapping.courseCols && state.columnMapping.courseCols.length
      ? state.columnMapping.courseCols
      : suggestion.courseCols;

    const nameContainer = $("forms-name-col-container");
    nameContainer.innerHTML = "";
    headers.forEach((h, idx) => {
      const label = document.createElement("label");
      label.innerHTML = `<input type="radio" name="name-col" value="${idx}" ${idx === nameCol ? "checked" : ""}/> ${escapeHtml(h) || `(Spalte ${idx + 1})`}`;
      nameContainer.appendChild(label);
    });

    const courseContainer = $("forms-course-cols-container");
    courseContainer.innerHTML = "";
    headers.forEach((h, idx) => {
      const label = document.createElement("label");
      label.innerHTML = `<input type="checkbox" name="course-col" value="${idx}" ${courseCols.includes(idx) ? "checked" : ""}/> ${escapeHtml(h) || `(Spalte ${idx + 1})`}`;
      courseContainer.appendChild(label);
    });
  }

  /** Legt für Kurswahl-Spalten ohne bisheriges Kürzel den Standard "S<Spaltennummer>" fest;
   *  bereits vergebene Kürzel (auch bewusst leere) bleiben unangetastet. */
  function ensureDefaultColumnPrefixes(courseCols) {
    for (const idx of courseCols) {
      const key = String(idx);
      if (!(key in state.columnPrefixes)) {
        state.columnPrefixes[key] = FormsImport.defaultColumnPrefix(idx);
      }
    }
  }

  /** Extrahiert Auswahl/Kurstexte (inkl. Kurs-Rewrite-Split und Spaltenkürzel) neu und rendert die davon
   *  abhängigen Tabellen (Schritt 4 + 5) neu. Wird nach jeder Änderung an Spaltenzuordnung, Kurs-Rewrite
   *  oder Spaltenkürzeln aufgerufen. */
  function recomputeSelectionsAndRender() {
    const selections = FormsImport.extractSelections(formsParsed, {
      ...state.columnMapping,
      columnPrefixes: state.columnPrefixes,
      splitDelimiter: state.courseSplitDelimiter,
    });
    studentEntries = groupSelectionsByName(selections);
    distinctCourseTexts = FormsImport.distinctCourseTexts(selections);
    renderStudentMatchTable();
    renderCourseMatchTable();
  }

  function onApplyMapping() {
    const nameCol = Number(document.querySelector('input[name="name-col"]:checked')?.value ?? -1);
    const courseCols = Array.from(document.querySelectorAll('input[name="course-col"]:checked')).map((i) =>
      Number(i.value)
    );
    if (nameCol < 0 || courseCols.length === 0) {
      setStatus($("forms-mapping-status"), "Bitte Namensspalte und mind. eine Kurswahl-Spalte wählen.", "error");
      return;
    }
    state.columnMapping = { nameCol, courseCols };
    ensureDefaultColumnPrefixes(courseCols);
    persist();

    recomputeSelectionsAndRender();

    setStatus(
      $("forms-mapping-status"),
      `${studentEntries.length} eindeutige Namen, ${distinctCourseTexts.length} unterschiedliche Kurswahl-Texte.`,
      "ok"
    );

    renderCourseSplitEditor();
    renderColumnPrefixEditor();
    reveal("section-course-rewrite");
    reveal("section-column-prefixes");
    reveal("section-student-matching");
    reveal("section-missing-students");
    reveal("section-course-matching");
    reveal("section-transfer");
  }

  /** Zeigt das aktuell gespeicherte Trennzeichen an, oder - falls noch keines gesetzt wurde - den
   *  Vorschlag "+" (rein als Anzeige-Hilfe; wirksam wird er erst nach Klick auf "Übernehmen"). */
  function renderCourseSplitEditor() {
    $("course-split-delimiter").value = state.courseSplitDelimiter || FormsImport.DEFAULT_SPLIT_DELIMITER;
  }

  function onApplyCourseSplit() {
    state.courseSplitDelimiter = $("course-split-delimiter").value.trim();
    persist();
    recomputeSelectionsAndRender();
    setStatus(
      $("course-split-status"),
      state.courseSplitDelimiter
        ? `Split aktiv bei "${state.courseSplitDelimiter}" – ${distinctCourseTexts.length} unterschiedliche Kurswahl-Texte.`
        : `Split deaktiviert – ${distinctCourseTexts.length} unterschiedliche Kurswahl-Texte.`,
      "ok"
    );
  }

  function renderColumnPrefixEditor() {
    const container = $("column-prefix-container");
    container.innerHTML = "";
    for (const idx of state.columnMapping.courseCols) {
      const header = formsParsed.headers[idx] || `(Spalte ${idx + 1})`;
      const key = String(idx);
      const value = state.columnPrefixes[key] ?? FormsImport.defaultColumnPrefix(idx);
      const row = document.createElement("div");
      row.className = "column-prefix-row";
      row.innerHTML = `
        <span class="column-prefix-header">${escapeHtml(header)}</span>
        <input type="text" class="column-prefix-input" data-col-idx="${idx}" value="${escapeHtml(value)}" placeholder="(kein Kürzel)" />
      `;
      container.appendChild(row);
    }
  }

  function onApplyColumnPrefixes() {
    document.querySelectorAll(".column-prefix-input").forEach((input) => {
      state.columnPrefixes[input.dataset.colIdx] = input.value.trim();
    });
    persist();
    recomputeSelectionsAndRender();
    setStatus(
      $("column-prefix-status"),
      `Kürzel übernommen – ${distinctCourseTexts.length} unterschiedliche Kurswahl-Texte.`,
      "ok"
    );
  }

  /** Gruppiert Zeilen nach Forms-Namen; bei Mehrfach-Antworten derselben Person
   *  gewinnt die letzte Zeile in der Datei (höchste Zeilennummer = i.d.R. die
   *  zuletzt bearbeitete/eingereichte Antwort bei Forms-Exporten). */
  function groupSelectionsByName(selections) {
    const byName = new Map();
    for (const sel of selections) {
      if (!sel.formsName) continue;
      byName.set(sel.formsName, sel); // spätere Zeilen überschreiben frühere
    }
    return Array.from(byName.values());
  }

  // ---------- 4. Abgleich Schüler ----------

  function confidenceBadge(score, source) {
    if (source === "saved") return `<span class="confidence-badge saved">gespeichert</span>`;
    if (score >= Matching.DEFAULT_AUTO_THRESHOLD) return `<span class="confidence-badge high">${Math.round(score * 100)}%</span>`;
    if (score > 0) return `<span class="confidence-badge low">${Math.round(score * 100)}%</span>`;
    return `<span class="confidence-badge none">kein Treffer</span>`;
  }

  /** Ordnet einen Score/Zustand einer der Filter-Kategorien zu (saved/high/low/none/ignored). */
  function statusCategory(score, source, ignored) {
    if (ignored) return "ignored";
    if (source === "saved") return "saved";
    if (score >= Matching.DEFAULT_AUTO_THRESHOLD) return "high";
    if (score > 0) return "low";
    return "none";
  }

  function getCheckedFilterValues(containerId) {
    return new Set(
      Array.from(document.querySelectorAll(`#${containerId} input:checked`)).map((i) => i.value)
    );
  }

  function applyStudentFilter() {
    const allowed = getCheckedFilterValues("student-status-filter");
    document.querySelectorAll("#student-match-table tbody tr").forEach((tr) => {
      tr.style.display = allowed.has(tr.dataset.status) ? "" : "none";
    });
  }

  function applyCourseFilter() {
    const allowed = getCheckedFilterValues("course-status-filter");
    document.querySelectorAll("#course-match-table tbody tr").forEach((tr) => {
      tr.style.display = allowed.has(tr.dataset.status) ? "" : "none";
    });
  }

  function setStudentFilterOnly(values) {
    document.querySelectorAll("#student-status-filter input").forEach((cb) => {
      cb.checked = values.includes(cb.value);
    });
    applyStudentFilter();
  }

  function setCourseFilterOnly(values) {
    document.querySelectorAll("#course-status-filter input").forEach((cb) => {
      cb.checked = values.includes(cb.value);
    });
    applyCourseFilter();
  }

  function renderStudentMatchTable() {
    const tbody = document.querySelector("#student-match-table tbody");
    tbody.innerHTML = "";
    for (const entry of studentEntries) {
      const tr = document.createElement("tr");
      tr.dataset.formsName = entry.formsName;

      const saved = Matching.lookup(state.schuelerMatching, entry.formsName);
      let inputValue = "";
      let badgeHtml = confidenceBadge(0, null);
      let ignored = false;
      let score = 0;
      let source = null;
      if (saved) {
        ignored = !!saved.ignored;
        inputValue = ignored ? "" : saved.targetLabel || "";
        badgeHtml = ignored ? `<span class="confidence-badge low">ignoriert</span>` : confidenceBadge(1, "saved");
        source = ignored ? null : "saved";
      } else {
        const suggestions = Matching.suggestStudentMatches(entry.formsName, schildSchueler, 1);
        if (suggestions.length && suggestions[0].score > 0.5) {
          inputValue = schuelerLabel(suggestions[0].item);
          score = suggestions[0].score;
          badgeHtml = confidenceBadge(score, null);
        }
      }
      tr.dataset.status = statusCategory(score, source, ignored);

      tr.innerHTML = `
        <td>${escapeHtml(entry.formsName)}</td>
        <td><input type="text" class="match-input student-match-input" list="schueler-datalist" value="${escapeHtml(inputValue)}" ${ignored ? "disabled" : ""}/></td>
        <td class="match-status">${badgeHtml}</td>
        <td><input type="checkbox" class="ignore-checkbox student-ignore" ${ignored ? "checked" : ""}/></td>
      `;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll(".student-match-input").forEach((input) => input.addEventListener("change", onStudentMatchInputChange));
    tbody.querySelectorAll(".student-ignore").forEach((cb) => cb.addEventListener("change", onStudentIgnoreChange));
    applyStudentFilter();
  }

  function onStudentMatchInputChange(evt) {
    const tr = evt.target.closest("tr");
    const formsName = tr.dataset.formsName;
    const label = evt.target.value.trim();
    const id = idFromLabel(label);
    if (label === "") {
      Matching.clearMatch(state.schuelerMatching, formsName);
      evt.target.classList.remove("invalid", "auto");
      tr.querySelector(".match-status").innerHTML = confidenceBadge(0, null);
      tr.dataset.status = "none";
    } else if (id != null && schuelerById.has(id)) {
      Matching.setMatch(state.schuelerMatching, formsName, { targetId: id, targetLabel: label, manual: true });
      evt.target.classList.remove("invalid");
      tr.querySelector(".match-status").innerHTML = confidenceBadge(1, "saved");
      tr.dataset.status = "saved";
    } else {
      evt.target.classList.add("invalid");
      tr.querySelector(".match-status").innerHTML = `<span class="confidence-badge none">ungültig</span>`;
      tr.style.display = ""; // ungültige Eingabe immer sichtbar lassen, unabhängig vom Filter
    }
    persist();
    applyStudentFilter();
  }

  function onStudentIgnoreChange(evt) {
    const tr = evt.target.closest("tr");
    const formsName = tr.dataset.formsName;
    const input = tr.querySelector(".student-match-input");
    if (evt.target.checked) {
      Matching.setIgnored(state.schuelerMatching, formsName, { label: formsName });
      input.value = "";
      input.disabled = true;
      tr.querySelector(".match-status").innerHTML = `<span class="confidence-badge low">ignoriert</span>`;
      tr.dataset.status = "ignored";
    } else {
      Matching.clearMatch(state.schuelerMatching, formsName);
      input.disabled = false;
      tr.querySelector(".match-status").innerHTML = confidenceBadge(0, null);
      tr.dataset.status = "none";
    }
    persist();
    applyStudentFilter();
  }

  function onAutomatchStudents() {
    const names = studentEntries.map((e) => e.formsName);
    const result = Matching.autoMatchStudents(
      names,
      schildSchueler,
      state.schuelerMatching,
      undefined,
      schuelerLabel
    );
    persist();
    renderStudentMatchTable();
    setStatus(
      $("student-match-summary"),
      `${result.matched} automatisch gematcht, ${result.review.length} benötigen manuelle Prüfung.`,
      result.review.length ? "warn" : "ok"
    );
  }

  // ---------- 4a. Schüler ohne Forms-Abgabe ----------

  /** Alle Schild-Schüler-IDs, denen aktuell (Schritt 4) eine nicht-ignorierte Forms-Zeile zugeordnet ist. */
  function getMatchedSchuelerIds() {
    const ids = new Set();
    for (const match of Object.values(state.schuelerMatching)) {
      if (match && !match.ignored && match.targetId != null) ids.add(match.targetId);
    }
    return ids;
  }

  let missingStudentsSort = { key: "name", dir: "asc" };

  function compareMissingStudents(a, b, key) {
    if (key === "id") return a.id - b.id;
    if (key === "klasse") return a.klasse.localeCompare(b.klasse, "de", { numeric: true });
    return a.nachname.localeCompare(b.nachname, "de") || a.vorname.localeCompare(b.vorname, "de");
  }

  function onCheckMissingStudents() {
    const matchedIds = getMatchedSchuelerIds();
    missingStudents = schildSchueler
      .filter((s) => !matchedIds.has(s.id))
      .map((s) => ({
        id: s.id,
        nachname: s.nachname,
        vorname: s.vorname,
        klasse: schuelerIdToKlasse.get(s.id) || "–",
      }));

    renderMissingStudentsKlasseFilter();
    renderMissingStudentsTable();
    setStatus(
      $("missing-students-status"),
      `${missingStudents.length} von ${schildSchueler.length} Schüler:innen ohne zugeordnete Forms-Abgabe.`,
      missingStudents.length ? "warn" : "ok"
    );
  }

  function renderMissingStudentsKlasseFilter() {
    const select = $("missing-students-klasse-filter");
    const previousValue = select.value;
    const klassen = Array.from(new Set(missingStudents.map((s) => s.klasse))).sort((a, b) =>
      a.localeCompare(b, "de", { numeric: true })
    );
    select.innerHTML =
      '<option value="">Alle Klassen</option>' +
      klassen.map((k) => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join("");
    if (klassen.includes(previousValue)) select.value = previousValue;
  }

  function updateMissingStudentsSortIndicators() {
    document.querySelectorAll("#missing-students-table .th-sort-btn").forEach((btn) => {
      const active = btn.dataset.sortKey === missingStudentsSort.key;
      const arrow = active ? (missingStudentsSort.dir === "asc" ? " ▲" : " ▼") : "";
      btn.textContent = btn.dataset.label + arrow;
      btn.classList.toggle("sort-active", active);
    });
  }

  function onMissingStudentsSortClick(evt) {
    const btn = evt.target.closest(".th-sort-btn");
    if (!btn) return;
    const key = btn.dataset.sortKey;
    if (missingStudentsSort.key === key) {
      missingStudentsSort.dir = missingStudentsSort.dir === "asc" ? "desc" : "asc";
    } else {
      missingStudentsSort = { key, dir: "asc" };
    }
    updateMissingStudentsSortIndicators();
    renderMissingStudentsTable();
  }

  function renderMissingStudentsTable() {
    const tbody = document.querySelector("#missing-students-table tbody");
    const selectedKlasse = $("missing-students-klasse-filter").value;
    let rows = selectedKlasse ? missingStudents.filter((s) => s.klasse === selectedKlasse) : missingStudents;
    rows = [...rows].sort((a, b) => {
      const cmp = compareMissingStudents(a, b, missingStudentsSort.key);
      return missingStudentsSort.dir === "asc" ? cmp : -cmp;
    });
    tbody.innerHTML = rows
      .map(
        (s) =>
          `<tr><td>${escapeHtml(s.nachname)}, ${escapeHtml(s.vorname)}</td><td>${s.id}</td><td>${escapeHtml(s.klasse)}</td></tr>`
      )
      .join("");
  }

  // ---------- 5. Abgleich Kurse ----------

  function renderCourseMatchTable() {
    const tbody = document.querySelector("#course-match-table tbody");
    tbody.innerHTML = "";
    for (const courseText of distinctCourseTexts) {
      const tr = document.createElement("tr");
      tr.dataset.courseText = courseText;

      const saved = Matching.lookup(state.kursMatching, courseText);
      let inputValue = "";
      let badgeHtml = confidenceBadge(0, null);
      let ignored = false;
      let score = 0;
      let source = null;
      if (saved) {
        ignored = !!saved.ignored;
        inputValue = ignored ? "" : saved.targetLabel || "";
        badgeHtml = ignored ? `<span class="confidence-badge low">ignoriert</span>` : confidenceBadge(1, "saved");
        source = ignored ? null : "saved";
      } else {
        // Spalten-Kürzel (siehe Schritt 3a) für die Ähnlichkeitssuche ausklammern - es dient nur zur
        // Unterscheidung gleichlautender Texte verschiedener Spalten, nicht zur Kursbezeichnung.
        const searchText = FormsImport.stripKnownPrefix(courseText, state.columnPrefixes);
        const suggestions = Matching.suggestCourseMatches(searchText, schildKurse, 1);
        if (suggestions.length && suggestions[0].score > 0.5) {
          inputValue = kursLabel(suggestions[0].item);
          score = suggestions[0].score;
          badgeHtml = confidenceBadge(score, null);
        }
      }
      tr.dataset.status = statusCategory(score, source, ignored);

      tr.innerHTML = `
        <td>${escapeHtml(courseText)}</td>
        <td><input type="text" class="match-input course-match-input" list="kurs-datalist" value="${escapeHtml(inputValue)}" ${ignored ? "disabled" : ""}/></td>
        <td class="match-status">${badgeHtml}</td>
        <td><input type="checkbox" class="ignore-checkbox course-ignore" ${ignored ? "checked" : ""}/></td>
        <td><button type="button" class="btn-create-kurs-row" title="Neuen Kurs für diesen Forms-Kurstext anlegen">+ Kurs</button></td>
      `;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll(".course-match-input").forEach((input) => input.addEventListener("change", onCourseMatchInputChange));
    tbody.querySelectorAll(".course-ignore").forEach((cb) => cb.addEventListener("change", onCourseIgnoreChange));
    tbody.querySelectorAll(".btn-create-kurs-row").forEach((btn) =>
      btn.addEventListener("click", (evt) => {
        const courseText = evt.target.closest("tr").dataset.courseText;
        const suggestion = FormsImport.stripKnownPrefix(courseText, state.columnPrefixes).trim();
        openCreateKursDialog({
          displayText: courseText,
          kuerzelSuggestion: suggestion,
          bezeichnungSuggestion: suggestion,
          onCreated: (neuerKurs) => {
            Matching.setMatch(state.kursMatching, courseText, {
              targetId: neuerKurs.id,
              targetLabel: kursLabel(neuerKurs),
              manual: true,
            });
            persist();
            renderCourseMatchTable();
            setStatus($("course-match-summary"), `Kurs "${neuerKurs.kuerzel}" angelegt und zugeordnet.`, "ok");
          },
        });
      })
    );
    applyCourseFilter();
  }

  function onCourseMatchInputChange(evt) {
    const tr = evt.target.closest("tr");
    const courseText = tr.dataset.courseText;
    const label = evt.target.value.trim();
    const id = idFromLabel(label);
    if (label === "") {
      Matching.clearMatch(state.kursMatching, courseText);
      evt.target.classList.remove("invalid");
      tr.querySelector(".match-status").innerHTML = confidenceBadge(0, null);
      tr.dataset.status = "none";
    } else if (id != null && kursById.has(id)) {
      Matching.setMatch(state.kursMatching, courseText, { targetId: id, targetLabel: label, manual: true });
      evt.target.classList.remove("invalid");
      tr.querySelector(".match-status").innerHTML = confidenceBadge(1, "saved");
      tr.dataset.status = "saved";
    } else {
      evt.target.classList.add("invalid");
      tr.querySelector(".match-status").innerHTML = `<span class="confidence-badge none">ungültig</span>`;
      tr.style.display = ""; // ungültige Eingabe immer sichtbar lassen, unabhängig vom Filter
    }
    persist();
    applyCourseFilter();
  }

  function onCourseIgnoreChange(evt) {
    const tr = evt.target.closest("tr");
    const courseText = tr.dataset.courseText;
    const input = tr.querySelector(".course-match-input");
    if (evt.target.checked) {
      Matching.setIgnored(state.kursMatching, courseText, { label: courseText });
      input.value = "";
      input.disabled = true;
      tr.querySelector(".match-status").innerHTML = `<span class="confidence-badge low">ignoriert</span>`;
      tr.dataset.status = "ignored";
    } else {
      Matching.clearMatch(state.kursMatching, courseText);
      input.disabled = false;
      tr.querySelector(".match-status").innerHTML = confidenceBadge(0, null);
      tr.dataset.status = "none";
    }
    persist();
    applyCourseFilter();
  }

  function onAutomatchCourses() {
    const result = Matching.autoMatchCourses(
      distinctCourseTexts,
      schildKurse,
      state.kursMatching,
      undefined,
      kursLabel,
      (text) => FormsImport.stripKnownPrefix(text, state.columnPrefixes)
    );
    persist();
    renderCourseMatchTable();
    setStatus(
      $("course-match-summary"),
      `${result.matched} automatisch gematcht, ${result.review.length} benötigen manuelle Prüfung.`,
      result.review.length ? "warn" : "ok"
    );
  }

  /**
   * Öffnet den "Neuen Kurs anlegen"-Dialog generisch für jeden Aufrufer (Schritt 5 Kurs-Matching,
   * Schritt 8 Split-Zielkurs, …). Alle Felder werden nur als editierbarer *Vorschlag* vorbelegt - nichts
   * wird beim Anlegen automatisch/unsichtbar übernommen, der Dialog muss immer aktiv bestätigt werden.
   * @param options.displayText Anzeigetext über dem Formular (Kontext, z.B. der Forms-Kurstext)
   * @param options.kuerzelSuggestion Vorschlag fürs Kürzel-Feld
   * @param options.bezeichnungSuggestion Vorschlag für die Zeugnisbezeichnung (Default: kuerzelSuggestion)
   * @param options.fachId Vorausgewähltes Fach (optional)
   * @param options.kursart Vorbelegte Kursart (optional)
   * @param options.wochenstunden Vorbelegte Wochenstunden (Default 2)
   * @param options.jahrgangIds explizite Jahrgangs-Vorauswahl (optional, sonst generischer Default)
   * @param options.onCreated(neuerKurs) wird nach erfolgreichem Anlegen aufgerufen (Kurs ist bereits in
   *   schildKurse/kursById/den Datalists eingetragen)
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
      buildDatalists();

      const callback = createKursOnCreated;
      closeCreateKursDialog();
      if (callback) callback(neuerKurs);
    } catch (err) {
      setStatus($("create-kurs-status"), err.message, "error");
    } finally {
      $("btn-create-kurs-submit").disabled = false;
    }
  }

  // ---------- 6. Übertragung ----------

  function populateTransferDefaults() {
    const d = state.leistungsdatenDefaults;
    $("default-kursart").value = d.kursartFallback || "";
    $("default-wochenstunden").value = d.wochenstundenFallback ?? 0;
    $("default-umfang").value = d.umfangLernstandsbericht || "V";
    $("default-auf-zeugnis").checked = !!d.aufZeugnis;
    $("default-epochal").checked = !!d.istEpochal;
    $("transfer-start-row").value = state.transferStartRow || "";
  }

  function bindTransferDefaultInputs() {
    const sync = () => {
      state.leistungsdatenDefaults = {
        kursartFallback: $("default-kursart").value.trim(),
        wochenstundenFallback: Number($("default-wochenstunden").value) || 0,
        umfangLernstandsbericht: $("default-umfang").value,
        aufZeugnis: $("default-auf-zeugnis").checked,
        istEpochal: $("default-epochal").checked,
      };
      state.transferStartRow = $("transfer-start-row").value ? Number($("transfer-start-row").value) : null;
      persist();
    };
    [
      "default-kursart",
      "default-wochenstunden",
      "default-umfang",
      "default-auf-zeugnis",
      "default-epochal",
      "transfer-start-row",
    ].forEach((id) => $(id).addEventListener("change", sync));
  }

  /**
   * Übernimmt alle aktuell in der Schüler-Match-Tabelle sichtbaren Werte in die persistente
   * Matching-Tabelle. Nötig, weil ein vorausgefüllter Vorschlag (Konfidenz-Prozent, aber
   * unterhalb der Auto-Match-Schwelle) im Eingabefeld sichtbar ist, ohne dass je ein
   * `change`-Event gefeuert wäre - ohne diesen Schritt würden weder die Übertragungs-Vorschau
   * (Schritt 6) noch "Schüler ohne Forms-Abgabe" (Schritt 4a) diese Zeilen als gematcht erkennen,
   * obwohl sie sichtbar befüllt sind. Gibt die Anzahl neu übernommener Zeilen zurück.
   */
  function commitVisibleStudentMatches() {
    let count = 0;
    document.querySelectorAll("#student-match-table tbody tr").forEach((tr) => {
      const formsName = tr.dataset.formsName;
      if (tr.querySelector(".student-ignore").checked) return;
      const input = tr.querySelector(".student-match-input");
      const label = input.value.trim();
      if (!label) return;
      const id = idFromLabel(label);
      if (id == null || !schuelerById.has(id)) return;
      const existing = Matching.lookup(state.schuelerMatching, formsName);
      if (!existing || existing.targetId !== id) {
        Matching.setMatch(state.schuelerMatching, formsName, { targetId: id, targetLabel: label, manual: false });
        count++;
      }
    });
    persist();
    renderStudentMatchTable();
    return count;
  }

  /** Analog zu `commitVisibleStudentMatches()`, aber für die Kurs-Match-Tabelle (Schritt 5). */
  function commitVisibleCourseMatches() {
    let count = 0;
    document.querySelectorAll("#course-match-table tbody tr").forEach((tr) => {
      const courseText = tr.dataset.courseText;
      if (tr.querySelector(".course-ignore").checked) return;
      const input = tr.querySelector(".course-match-input");
      const label = input.value.trim();
      if (!label) return;
      const id = idFromLabel(label);
      if (id == null || !kursById.has(id)) return;
      const existing = Matching.lookup(state.kursMatching, courseText);
      if (!existing || existing.targetId !== id) {
        Matching.setMatch(state.kursMatching, courseText, { targetId: id, targetLabel: label, manual: false });
        count++;
      }
    });
    persist();
    renderCourseMatchTable();
    return count;
  }

  function commitVisibleMatches() {
    commitVisibleStudentMatches();
    commitVisibleCourseMatches();
  }

  function onSaveStudentMatches() {
    const count = commitVisibleStudentMatches();
    setStatus(
      $("student-match-summary"),
      count > 0 ? `${count} Zuordnung(en) gespeichert.` : "Keine neuen Zuordnungen zu speichern.",
      "ok"
    );
  }

  /**
   * Sammelt alle gematchten Schüler×Kurs-Kombinationen. Dedupliziert dabei bewusst auf
   * (Schüler-ID, Kurs-ID): Verschiedene Forms-Spalten/-Zeilen können auf denselben Schild-Kurs
   * matchen (z.B. zwei Namensschreibweisen derselben Person, oder zwei Wochentags-Spalten mit
   * demselben Kurstext). Ohne Deduplizierung würde derselbe Datensatz zweimal zur Übertragung
   * vorgeschlagen - der SVWS-Server beantwortet einen Batch, der eine solche Dopplung enthält,
   * mit einem Serverfehler (500) für den kompletten Batch.
   */
  /** state.transferStartRow ist eine Excel-Zeilennummer (1-basiert, Kopfzeile = Zeile 1); entry.rowIndex
   *  (aus FormsImport.extractSelections()) ist 0-basiert ab der ersten Datenzeile (= Excel-Zeile 2). Ohne
   *  gesetzten Wert (null/0) kein Filter - alle Zeilen zählen. */
  function transferStartRowIndex() {
    return state.transferStartRow ? state.transferStartRow - 2 : -1;
  }

  function collectMatchedPairs() {
    const pairs = [];
    const seenPairKeys = new Set();
    let duplicates = 0;
    let vorStartzeile = 0;
    const startRowIndex = transferStartRowIndex();
    for (const entry of studentEntries) {
      if (startRowIndex >= 0 && entry.rowIndex < startRowIndex) {
        vorStartzeile++;
        continue;
      }
      const studentMatch = Matching.lookup(state.schuelerMatching, entry.formsName);
      if (!studentMatch || studentMatch.ignored || studentMatch.targetId == null) continue;
      const schueler = schuelerById.get(studentMatch.targetId);
      if (!schueler) continue;
      for (const courseText of entry.courses) {
        const courseMatch = Matching.lookup(state.kursMatching, courseText);
        if (!courseMatch || courseMatch.ignored || courseMatch.targetId == null) continue;
        const kurs = kursById.get(courseMatch.targetId);
        if (!kurs) continue;
        const pairKey = `${schueler.id}|${kurs.id}`;
        if (seenPairKeys.has(pairKey)) {
          duplicates++;
          continue;
        }
        seenPairKeys.add(pairKey);
        pairs.push({ schueler, kurs });
      }
    }
    return { pairs, duplicates, vorStartzeile };
  }

  function getLernabschnittsdatenCached(schuelerId) {
    if (!lernabschnittsdatenCache.has(schuelerId)) {
      lernabschnittsdatenCache.set(schuelerId, SvwsApi.getLernabschnittsdaten(schuelerId, abschnittId));
    }
    return lernabschnittsdatenCache.get(schuelerId);
  }

  async function onComputePreview() {
    const statusEl = $("transfer-preview-status");
    // Cache nur innerhalb EINES Vorschau-Laufs sinnvoll (dedupliziert GETs für Schüler mit mehreren
    // Kurswahlen). Über den Lauf hinaus aufzuheben würde nach einer Übertragung veraltete Daten liefern -
    // frisch angelegte Leistungsdaten würden dann bei einer erneuten Vorschau wieder als "neu" erscheinen,
    // obwohl sie schon existieren, und der Klick auf "Vorschau berechnen" wirkt dadurch wirkungslos.
    lernabschnittsdatenCache.clear();
    commitVisibleMatches();
    const { pairs, duplicates, vorStartzeile } = collectMatchedPairs();
    const startzeileHint = vorStartzeile > 0 ? ` (${vorStartzeile} Personen vor der gewählten Startzeile übersprungen)` : "";
    if (pairs.length === 0) {
      setStatus(statusEl, `Keine gematchten Schüler/Kurs-Kombinationen gefunden${startzeileHint}.`, "warn");
      return;
    }
    const dupHint = duplicates > 0 ? ` (${duplicates} Dopplungen automatisch entfernt)` : "";
    setStatus(statusEl, `Prüfe ${pairs.length} Kombinationen${dupHint}${startzeileHint} gegen bestehende Leistungsdaten …`, "");

    const uniqueSchuelerIds = Array.from(new Set(pairs.map((p) => p.schueler.id)));
    const lernabschnittsdatenBySchueler = new Map();
    let fehler = 0;
    await mapWithConcurrency(uniqueSchuelerIds, 6, async (id) => {
      try {
        const data = await getLernabschnittsdatenCached(id);
        lernabschnittsdatenBySchueler.set(id, data);
      } catch (e) {
        fehler++;
        lernabschnittsdatenBySchueler.set(id, null);
      }
    });

    // Ein gematchter Kurs kann inzwischen (Schritt 8) in Jahrgangs-/Klassenkurse gesplittet worden sein -
    // die betroffene Person hat dann keinen Leistungsdaten-Eintrag mehr in genau diesem Kurs, sondern im
    // jeweiligen Zielkurs. Ohne diesen Rückwärts-Check (resolveUrsprungsKurs(), dieselbe Logik wie bei
    // "Kurse ohne Forms-Wahl") würde eine erneute Übertragung solche Personen fälschlich als "fehlt"
    // erkennen und ihnen einen doppelten, veralteten Leistungsdaten-Eintrag im ursprünglichen Quellkurs
    // anlegen.
    const zielZuQuell = buildSplitZielZuQuellMap();
    transferPreviewRows = pairs.map(({ schueler, kurs }) => {
      const lad = lernabschnittsdatenBySchueler.get(schueler.id);
      const eintraege = lad?.leistungsdaten || [];
      const direkt = eintraege.some((l) => l.kursID === kurs.id);
      const viaSplit = !direkt && eintraege.some((l) => resolveUrsprungsKurs(l.kursID, zielZuQuell) === kurs.id);
      return {
        schuelerId: schueler.id,
        schuelerLabel: schuelerLabel(schueler),
        kursId: kurs.id,
        kursLabel: kursLabel(kurs),
        lernabschnittID: lad ? lad.id : null,
        kurs,
        existing: direkt || viaSplit,
        existingViaSplit: viaSplit,
        fehlerBeimLaden: lad === null,
      };
    });

    renderTransferPreview();
    const neu = transferPreviewRows.filter((r) => !r.existing && !r.fehlerBeimLaden).length;
    const vorhanden = transferPreviewRows.filter((r) => r.existing).length;
    setStatus(
      statusEl,
      `${neu} neu anzulegen, ${vorhanden} bereits vorhanden${fehler ? `, ${fehler} Fehler beim Laden` : ""}.`,
      fehler ? "warn" : "ok"
    );
  }

  function renderTransferPreview() {
    const tbody = document.querySelector("#transfer-preview-table tbody");
    tbody.innerHTML = "";
    for (const row of transferPreviewRows) {
      const tr = document.createElement("tr");
      const disabled = row.existing || row.fehlerBeimLaden;
      const hinweis = row.fehlerBeimLaden
        ? "Fehler beim Laden der Lernabschnittsdaten"
        : row.existingViaSplit
        ? "bereits vorhanden (in Split-Zielkurs)"
        : row.existing
        ? "bereits vorhanden"
        : "neu";
      tr.innerHTML = `
        <td><input type="checkbox" class="transfer-row-checkbox" ${disabled ? "disabled" : "checked"}/></td>
        <td>${escapeHtml(row.schuelerLabel)}</td>
        <td>${escapeHtml(row.kursLabel)}</td>
        <td>${hinweis}</td>
      `;
      if (disabled) tr.style.opacity = "0.55";
      tbody.appendChild(tr);
    }
    $("transfer-preview-counts").textContent = `${transferPreviewRows.length} Kombinationen insgesamt.`;
    $("btn-execute-transfer").disabled = transferPreviewRows.every((r) => r.existing || r.fehlerBeimLaden);
  }

  function onTransferSelectAll(evt) {
    document.querySelectorAll(".transfer-row-checkbox:not(:disabled)").forEach((cb) => (cb.checked = evt.target.checked));
  }

  function buildLeistungsdatenPayload(row) {
    const d = state.leistungsdatenDefaults;
    return {
      lernabschnittID: row.lernabschnittID,
      fachID: row.kurs.idFach ?? null,
      kursID: row.kurs.id,
      kursart: row.kurs.kursartAllg || d.kursartFallback || null,
      wochenstunden: row.kurs.wochenstunden ?? d.wochenstundenFallback ?? 0,
      aufZeugnis: !!d.aufZeugnis,
      istEpochal: !!d.istEpochal,
      umfangLernstandsbericht: d.umfangLernstandsbericht || "V",
      textFachbezogeneLernentwicklung: "",
    };
  }

  // batchWithBisection() kommt aus SharedCode (siehe oben) - Details dort.

  async function onExecuteTransfer() {
    const rows = Array.from(document.querySelectorAll("#transfer-preview-table tbody tr"));
    const toSend = [];
    rows.forEach((tr, idx) => {
      const cb = tr.querySelector(".transfer-row-checkbox");
      if (cb && !cb.disabled && cb.checked) toSend.push(transferPreviewRows[idx]);
    });
    if (toSend.length === 0) return;

    const log = $("transfer-log");
    log.textContent = `Übertrage ${toSend.length} Leistungsdaten-Einträge …\n`;
    $("btn-execute-transfer").disabled = true;

    const batchSize = 50;
    let ok = 0;
    const failedRows = [];
    for (let i = 0; i < toSend.length; i += batchSize) {
      const batch = toSend.slice(i, i + batchSize);
      const batchNum = i / batchSize + 1;
      const result = await batchWithBisection(batch, (subset) =>
        SvwsApi.createLeistungsdatenMultiple(subset.map(buildLeistungsdatenPayload))
      );
      ok += result.ok;
      failedRows.push(...result.failed);
      log.textContent +=
        result.failed.length === 0
          ? `Batch ${batchNum}: ${result.ok} Einträge erfolgreich angelegt.\n`
          : `Batch ${batchNum}: ${result.ok} erfolgreich, ${result.failed.length} fehlgeschlagen (einzeln isoliert).\n`;
      log.scrollTop = log.scrollHeight;
    }

    if (failedRows.length > 0) {
      log.textContent += `\nFehlgeschlagene Einträge im Detail:\n`;
      for (const f of failedRows) {
        log.textContent += `- ${f.item.schuelerLabel} / ${f.item.kursLabel}: ${f.message}\n`;
      }
    }
    log.textContent += `\nFertig: ${ok} erfolgreich, ${failedRows.length} fehlgeschlagen.\n`;
    if (ok > 0) {
      log.textContent += `Aktualisiere Kursbelegung …\n`;
      await refreshKursBelegung();
      log.textContent += `Kursbelegung aktualisiert.\n`;
    }
    log.scrollTop = log.scrollHeight;
    $("btn-execute-transfer").disabled = false;
  }

  // ---------- 7. Speichern / Laden ----------

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
      populateTransferDefaults();
      setStatus($("save-load-status"), "Zustand aus JSON geladen. Bitte erneut verbinden.", "ok");
    } catch (err) {
      setStatus($("save-load-status"), err.message, "error");
    }
  }

  /** Löscht den gesamten gespeicherten Zustand (localStorage) und startet die Seite neu,
   *  damit auch der nicht-persistente Laufzeitzustand (geladene Schild-/Forms-Daten) sauber
   *  zurückgesetzt wird. */
  function onResetState() {
    const sicher = confirm(
      "Wirklich alle gespeicherten Zuordnungen und Einstellungen löschen? Das betrifft auch die auf der " +
        "Wartungsseite (wartung.html) konfigurierten Splits und Filter, da beide Seiten sich denselben " +
        "Speicher teilen. Das kann nicht rückgängig gemacht werden. Schild-Daten und Forms-Datei müssen " +
        "danach erneut geladen werden."
    );
    if (!sicher) return;
    localStorage.removeItem(Storage.STORAGE_KEY);
    location.reload();
  }

  // ---------- 8. Kurse ohne Forms-Wahl ----------
  // Die einzige Nachbereitungs-Kontrolle, die zwingend im Forms-Abgleich (Schritte 3-5) lebende
  // Laufzeitdaten braucht (studentEntries aus der hochgeladenen Excel-Datei) und deshalb - anders als die
  // übrigen, rein auf Schild-Daten arbeitenden Wartungswerkzeuge - hier in index.html bleibt statt auf
  // wartung.html zu wandern. Der Vergleich muss die dort (auf der Wartungsseite) konfigurierten
  // Jahrgangs-/Klassen-Splits rückwärts auflösen können (buildSplitZielZuQuellMap()/resolveUrsprungsKurs()
  // unten, geteilt mit Schritt 6), sonst würde jeder frisch gesplittete Zielkurs fälschlich als "nicht
  // gewählt" gemeldet, obwohl er nur eine interne Aufteilung eines tatsächlich gewählten Kurses ist.

  let kurseOhneWahlResults = []; // [{schuelerId, schuelerLabel, fachLabel, kursart, kursLabel, leistungsdatenId}]
  let kurseOhneWahlSort = { key: "schueler", dir: "asc" };

  /** Zeigt im Vergleich nur Fächer/Kursarten an, die tatsächlich in geladenen Kursen vorkommen (statt des
   *  ganzen Schild-Fächerkatalogs) - hält die Filterliste handhabbar. */
  /** Befüllt die Fach-/Kursart-Filter-Checkboxen. Vorbelegung: die zuletzt gespeicherte Auswahl aus
   *  `state.kurseOhneWahlFilter` (persistiert), falls vorhanden - sonst sind standardmäßig alle
   *  angehakt (wie beim Status-Filter in Schritt 1). */
  function populateKurseOhneWahlFilters() {
    const gespeichertFach = state.kurseOhneWahlFilter.fachIds || [];
    const gespeichertKursart = state.kurseOhneWahlFilter.kursarten || [];

    const fachIdsInKursen = new Set(schildKurse.map((k) => k.idFach).filter((id) => id != null));
    const relevantFaecher = schildFaecher
      .filter((f) => fachIdsInKursen.has(f.id))
      .sort((a, b) => a.kuerzel.localeCompare(b.kuerzel, "de"));
    $("kurse-ohne-wahl-fach-filter").innerHTML = relevantFaecher
      .map((f) => {
        const checked = gespeichertFach.length > 0 ? gespeichertFach.includes(f.id) : true;
        return `<label><input type="checkbox" class="kurse-ohne-wahl-fach-cb" value="${f.id}" ${checked ? "checked" : ""}/> ${escapeHtml(f.kuerzel)}</label>`;
      })
      .join("");

    const kursarten = Array.from(new Set(schildKurse.map((k) => k.kursartAllg).filter(Boolean))).sort();
    $("kurse-ohne-wahl-kursart-filter").innerHTML = kursarten
      .map((ka) => {
        const checked = gespeichertKursart.length > 0 ? gespeichertKursart.includes(ka) : true;
        return `<label><input type="checkbox" class="kurse-ohne-wahl-kursart-cb" value="${escapeHtml(ka)}" ${checked ? "checked" : ""}/> ${escapeHtml(ka)}</label>`;
      })
      .join("");

    document
      .querySelectorAll(".kurse-ohne-wahl-fach-cb, .kurse-ohne-wahl-kursart-cb")
      .forEach((cb) => cb.addEventListener("change", onKurseOhneWahlFilterChange));
    updateKurseOhneWahlSelectAllCheckboxes();
  }

  /** Speichert die aktuelle Fach-/Kursart-Auswahl in `state.kurseOhneWahlFilter` (localStorage + JSON). */
  function persistKurseOhneWahlFilter() {
    state.kurseOhneWahlFilter = {
      fachIds: Array.from(document.querySelectorAll(".kurse-ohne-wahl-fach-cb:checked")).map((cb) => Number(cb.value)),
      kursarten: Array.from(document.querySelectorAll(".kurse-ohne-wahl-kursart-cb:checked")).map((cb) => cb.value),
    };
    persist();
  }

  /** Hält die beiden "alle"-Checkboxen konsistent mit dem Zustand ihrer Gruppe (angehakt nur, wenn
   *  wirklich jede Einzel-Checkbox der Gruppe angehakt ist). */
  function updateKurseOhneWahlSelectAllCheckboxes() {
    const fachCbs = document.querySelectorAll(".kurse-ohne-wahl-fach-cb");
    $("kurse-ohne-wahl-fach-select-all").checked = fachCbs.length > 0 && Array.from(fachCbs).every((cb) => cb.checked);
    const kursartCbs = document.querySelectorAll(".kurse-ohne-wahl-kursart-cb");
    $("kurse-ohne-wahl-kursart-select-all").checked =
      kursartCbs.length > 0 && Array.from(kursartCbs).every((cb) => cb.checked);
  }

  function onKurseOhneWahlFilterChange() {
    persistKurseOhneWahlFilter();
    updateKurseOhneWahlSelectAllCheckboxes();
  }

  function onKurseOhneWahlFachSelectAll(evt) {
    document.querySelectorAll(".kurse-ohne-wahl-fach-cb").forEach((cb) => (cb.checked = evt.target.checked));
    persistKurseOhneWahlFilter();
  }

  function onKurseOhneWahlKursartSelectAll(evt) {
    document.querySelectorAll(".kurse-ohne-wahl-kursart-cb").forEach((cb) => (cb.checked = evt.target.checked));
    persistKurseOhneWahlFilter();
  }

  /** Baut aus den (vollständigen) Zeilen beider Split-Bereiche eine Zielkurs-ID -> Quellkurs-ID -
   *  Abbildung. Enthält auch nie ausgeführte, aber vollständig konfigurierte Zeilen - das ist unschädlich,
   *  da ohne tatsächlich durchgeführten Split ohnehin kein Leistungsdaten-Eintrag mit dieser Kurs-ID
   *  auftauchen kann, die Abbildung also für diesen Fall nie greift. Wird sowohl von "Kurse ohne
   *  Forms-Wahl" (Schritt 8) als auch von der Existenzprüfung in onComputePreview() (Schritt 6) genutzt. */
  function buildSplitZielZuQuellMap() {
    const map = new Map();
    for (const row of [...state.splitJahrgangRows, ...state.splitKlasseRows]) {
      if (row.quellkursId != null && row.zielkursId != null) map.set(row.zielkursId, row.quellkursId);
    }
    return map;
  }

  /** Verfolgt einen Kurs rückwärts über ggf. mehrere Split-Schritte (Jahrgangs- *und* Klassen-Split
   *  können hintereinander angewendet worden sein) bis zum ursprünglichen (nicht selbst aus einem Split
   *  hervorgegangenen) Kurs zurück. Zyklus-Schutz, falls sich Zeilen widersprüchlich überschneiden. */
  function resolveUrsprungsKurs(kursId, zielZuQuell) {
    let current = kursId;
    const besucht = new Set([current]);
    while (zielZuQuell.has(current)) {
      const naechster = zielZuQuell.get(current);
      if (besucht.has(naechster)) break;
      current = naechster;
      besucht.add(current);
    }
    return current;
  }

  async function onRunKurseOhneWahl() {
    const statusEl = $("kurse-ohne-wahl-status");
    if (studentEntries.length === 0) {
      setStatus(statusEl, "Bitte zuerst Schritte 3–5 (Forms-Datei laden, Spaltenzuordnung, Abgleich) durchführen.", "error");
      return;
    }
    const erlaubteFachIds = new Set(
      Array.from(document.querySelectorAll(".kurse-ohne-wahl-fach-cb:checked")).map((cb) => Number(cb.value))
    );
    const erlaubteKursarten = new Set(
      Array.from(document.querySelectorAll(".kurse-ohne-wahl-kursart-cb:checked")).map((cb) => cb.value)
    );
    if (erlaubteFachIds.size === 0 || erlaubteKursarten.size === 0) {
      setStatus(statusEl, "Bitte mindestens ein Fach und eine Kursart auswählen.", "error");
      return;
    }

    // Nur Schüler:innen mit einer nicht-ignorierten Zuordnung aus Schritt 4, inkl. der Menge ihrer
    // gewählten (nicht-ignorierten) Kurs-IDs aus Schritt 5.
    const kandidaten = studentEntries
      .map((entry) => {
        const match = Matching.lookup(state.schuelerMatching, entry.formsName);
        if (!match || match.ignored || match.targetId == null) return null;
        const schueler = schuelerById.get(match.targetId);
        if (!schueler) return null;
        const chosenKursIds = new Set();
        for (const courseText of entry.courses) {
          const courseMatch = Matching.lookup(state.kursMatching, courseText);
          if (courseMatch && !courseMatch.ignored && courseMatch.targetId != null) chosenKursIds.add(courseMatch.targetId);
        }
        return { schueler, chosenKursIds };
      })
      .filter(Boolean);
    if (kandidaten.length === 0) {
      setStatus(statusEl, "Keine gematchten Schüler:innen gefunden (Schritt 4 abgeschlossen?).", "error");
      return;
    }

    const zielZuQuell = buildSplitZielZuQuellMap();

    const progressEl = $("kurse-ohne-wahl-progress");
    const total = kandidaten.length;
    let processed = 0;
    progressEl.max = total;
    progressEl.value = 0;
    progressEl.classList.remove("hidden");
    setStatus(statusEl, `Prüfe 0 / ${total} Schüler:innen …`, "");
    $("btn-run-kurse-ohne-wahl").disabled = true;

    const fachById = new Map(schildFaecher.map((f) => [f.id, f]));
    const results = [];
    let fehler = 0;
    await mapWithConcurrency(kandidaten, 6, async ({ schueler, chosenKursIds }) => {
      try {
        const lad = await SvwsApi.getLernabschnittsdaten(schueler.id, abschnittId);
        for (const eintrag of lad.leistungsdaten || []) {
          if (eintrag.kursID == null) continue; // Klassenunterricht, hier nicht relevant
          if (!erlaubteFachIds.has(eintrag.fachID)) continue;
          if (!erlaubteKursarten.has(eintrag.kursart)) continue;
          // Direkt gewählt ODER über einen (ggf. mehrstufigen) Split aus einem gewählten Kurs
          // hervorgegangen -> kein Treffer.
          const ursprungsKursId = resolveUrsprungsKurs(eintrag.kursID, zielZuQuell);
          if (chosenKursIds.has(eintrag.kursID) || chosenKursIds.has(ursprungsKursId)) continue;
          const kurs = kursById.get(eintrag.kursID);
          const fach = fachById.get(eintrag.fachID);
          results.push({
            schuelerId: schueler.id,
            schuelerLabel: schuelerLabel(schueler),
            fachLabel: fach ? `${fach.kuerzel} – ${fach.bezeichnung || ""}` : `Fach-ID ${eintrag.fachID}`,
            kursart: eintrag.kursart || "",
            kursLabel: kurs ? kursLabel(kurs) : `Kurs-ID ${eintrag.kursID}`,
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

    kurseOhneWahlResults = results;
    progressEl.classList.add("hidden");
    renderKurseOhneWahlTable();
    $("btn-run-kurse-ohne-wahl").disabled = false;
    setStatus(
      statusEl,
      `${results.length} Kurs-Einträge ohne passende Forms-Wahl gefunden${fehler ? ` (${fehler} Schüler:innen konnten nicht geprüft werden)` : ""}.`,
      results.length ? "warn" : "ok"
    );
  }

  function compareKurseOhneWahl(a, b, key) {
    if (key === "id") return a.leistungsdatenId - b.leistungsdatenId;
    if (key === "fach") return a.fachLabel.localeCompare(b.fachLabel, "de");
    if (key === "kursart") return (a.kursart || "").localeCompare(b.kursart || "", "de");
    if (key === "kurs") return a.kursLabel.localeCompare(b.kursLabel, "de");
    return a.schuelerLabel.localeCompare(b.schuelerLabel, "de");
  }

  function updateKurseOhneWahlSortIndicators() {
    document.querySelectorAll("#kurse-ohne-wahl-table .th-sort-btn").forEach((btn) => {
      const active = btn.dataset.sortKey === kurseOhneWahlSort.key;
      const arrow = active ? (kurseOhneWahlSort.dir === "asc" ? " ▲" : " ▼") : "";
      btn.textContent = btn.dataset.label + arrow;
      btn.classList.toggle("sort-active", active);
    });
  }

  function onKurseOhneWahlSortClick(evt) {
    const btn = evt.target.closest(".th-sort-btn");
    if (!btn) return;
    const key = btn.dataset.sortKey;
    if (kurseOhneWahlSort.key === key) kurseOhneWahlSort.dir = kurseOhneWahlSort.dir === "asc" ? "desc" : "asc";
    else kurseOhneWahlSort = { key, dir: "asc" };
    updateKurseOhneWahlSortIndicators();
    renderKurseOhneWahlTable();
  }

  function renderKurseOhneWahlTable() {
    const tbody = document.querySelector("#kurse-ohne-wahl-table tbody");
    const suchtext = $("kurse-ohne-wahl-suche").value.trim().toLowerCase();
    let rows = kurseOhneWahlResults;
    if (suchtext) {
      rows = rows.filter((r) =>
        [r.schuelerLabel, r.fachLabel, r.kursart, r.kursLabel].some((v) => v.toLowerCase().includes(suchtext))
      );
    }
    rows = [...rows].sort((a, b) => {
      const cmp = compareKurseOhneWahl(a, b, kurseOhneWahlSort.key);
      return kurseOhneWahlSort.dir === "asc" ? cmp : -cmp;
    });
    tbody.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td><input type="checkbox" class="kurse-ohne-wahl-row" data-id="${r.leistungsdatenId}" checked /></td>
        <td>${escapeHtml(r.schuelerLabel)}</td>
        <td>${escapeHtml(r.fachLabel)}</td>
        <td>${escapeHtml(r.kursart)}</td>
        <td>${escapeHtml(r.kursLabel)}</td>
        <td>${r.leistungsdatenId}</td>
        <td><button type="button" class="btn-secondary kurse-ohne-wahl-delete-single" data-id="${r.leistungsdatenId}">Löschen</button></td>
      </tr>`
      )
      .join("");
    $("kurse-ohne-wahl-select-all").checked = rows.length > 0;
    $("btn-delete-kurse-ohne-wahl").disabled = rows.length === 0;
  }

  function onKurseOhneWahlSelectAll(evt) {
    document.querySelectorAll(".kurse-ohne-wahl-row").forEach((cb) => (cb.checked = evt.target.checked));
  }

  async function deleteKurseOhneWahlIds(ids) {
    const log = $("kurse-ohne-wahl-log");
    log.textContent = `Lösche ${ids.length} Leistungsdaten-Einträge …\n`;
    $("btn-delete-kurse-ohne-wahl").disabled = true;

    const result = await batchWithBisection(ids, (subset) => SvwsApi.deleteLeistungsdatenMultiple(subset));
    const geloeschtIds = new Set(ids.filter((id) => !result.failed.some((f) => f.item === id)));
    kurseOhneWahlResults = kurseOhneWahlResults.filter((r) => !geloeschtIds.has(r.leistungsdatenId));
    renderKurseOhneWahlTable();

    if (result.failed.length === 0) {
      log.textContent += `${result.ok} Einträge erfolgreich gelöscht.\n`;
      setStatus($("kurse-ohne-wahl-status"), `${result.ok} Einträge gelöscht.`, "ok");
    } else {
      log.textContent += `${result.ok} gelöscht, ${result.failed.length} fehlgeschlagen:\n`;
      for (const f of result.failed) log.textContent += `- Leistungsdaten-ID ${f.item}: ${f.message}\n`;
      setStatus($("kurse-ohne-wahl-status"), `${result.ok} gelöscht, ${result.failed.length} fehlgeschlagen.`, "warn");
    }
    $("btn-delete-kurse-ohne-wahl").disabled = kurseOhneWahlResults.length === 0;
  }

  async function onDeleteKurseOhneWahlSelected() {
    const checked = Array.from(document.querySelectorAll(".kurse-ohne-wahl-row:checked"));
    if (checked.length === 0) return;
    const sicher = confirm(
      `${checked.length} Leistungsdaten-Einträge wirklich unwiderruflich in Schild löschen? Das kann nicht rückgängig gemacht werden.`
    );
    if (!sicher) return;
    await deleteKurseOhneWahlIds(checked.map((cb) => Number(cb.dataset.id)));
  }

  async function onDeleteKurseOhneWahlSingle(evt) {
    const sicher = confirm("Diesen Leistungsdaten-Eintrag wirklich unwiderruflich in Schild löschen? Das kann nicht rückgängig gemacht werden.");
    if (!sicher) return;
    await deleteKurseOhneWahlIds([Number(evt.target.dataset.id)]);
  }

  // ---------- Initialisierung ----------

  function init() {
    populateConnectionFields();
    populateTransferDefaults();
    bindTransferDefaultInputs();

    $("btn-fill-testdata").addEventListener("click", fillTestdata);
    $("btn-connect").addEventListener("click", onConnect);
    $("section-connection").addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && evt.target.tagName === "INPUT") {
        evt.preventDefault();
        onConnect();
      }
    });
    $("btn-load-schild-data").addEventListener("click", onLoadSchildData);
    $("forms-file-input").addEventListener("change", onFormsFileSelected);
    $("btn-apply-mapping").addEventListener("click", onApplyMapping);
    $("btn-apply-course-split").addEventListener("click", onApplyCourseSplit);
    $("btn-apply-column-prefixes").addEventListener("click", onApplyColumnPrefixes);
    $("btn-automatch-students").addEventListener("click", onAutomatchStudents);
    $("btn-save-student-matches").addEventListener("click", onSaveStudentMatches);
    $("btn-check-missing-students").addEventListener("click", onCheckMissingStudents);
    $("missing-students-klasse-filter").addEventListener("change", renderMissingStudentsTable);
    $("missing-students-klasse-filter").addEventListener("input", renderMissingStudentsTable);
    document.querySelector("#missing-students-table thead").addEventListener("click", onMissingStudentsSortClick);
    updateMissingStudentsSortIndicators();
    $("btn-automatch-courses").addEventListener("click", onAutomatchCourses);
    $("create-kurs-form").addEventListener("submit", onCreateKursFormSubmit);
    $("btn-create-kurs-cancel").addEventListener("click", closeCreateKursDialog);
    $("btn-compute-preview").addEventListener("click", onComputePreview);
    $("transfer-select-all").addEventListener("change", onTransferSelectAll);
    $("btn-execute-transfer").addEventListener("click", onExecuteTransfer);
    $("btn-export-json").addEventListener("click", onExportJson);
    $("import-json-input").addEventListener("change", onImportJson);
    $("btn-reset-state").addEventListener("click", onResetState);

    $("btn-refresh-kursbelegung").addEventListener("click", onRefreshKursBelegung);

    $("kurse-ohne-wahl-fach-select-all").addEventListener("change", onKurseOhneWahlFachSelectAll);
    $("kurse-ohne-wahl-kursart-select-all").addEventListener("change", onKurseOhneWahlKursartSelectAll);
    $("btn-run-kurse-ohne-wahl").addEventListener("click", onRunKurseOhneWahl);
    $("kurse-ohne-wahl-select-all").addEventListener("change", onKurseOhneWahlSelectAll);
    $("btn-delete-kurse-ohne-wahl").addEventListener("click", onDeleteKurseOhneWahlSelected);
    $("kurse-ohne-wahl-suche").addEventListener("input", renderKurseOhneWahlTable);
    document.querySelector("#kurse-ohne-wahl-table").addEventListener("click", (evt) => {
      if (evt.target.classList.contains("kurse-ohne-wahl-delete-single")) onDeleteKurseOhneWahlSingle(evt);
    });
    document.querySelector("#kurse-ohne-wahl-table thead").addEventListener("click", onKurseOhneWahlSortClick);
    updateKurseOhneWahlSortIndicators();

    document.querySelectorAll("#student-status-filter input").forEach((cb) => cb.addEventListener("change", applyStudentFilter));
    document.querySelectorAll("#course-status-filter input").forEach((cb) => cb.addEventListener("change", applyCourseFilter));
    $("btn-student-filter-unsicher").addEventListener("click", () => setStudentFilterOnly(["low", "none"]));
    $("btn-student-filter-alle").addEventListener("click", () => setStudentFilterOnly(["saved", "high", "low", "none", "ignored"]));
    $("btn-course-filter-unsicher").addEventListener("click", () => setCourseFilterOnly(["low", "none"]));
    $("btn-course-filter-alle").addEventListener("click", () => setCourseFilterOnly(["saved", "high", "low", "none", "ignored"]));
  }

  document.addEventListener("DOMContentLoaded", init);
})();
