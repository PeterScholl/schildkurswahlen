/**
 * Orchestrierung: verdrahtet die UI mit SvwsApi, FormsImport, Matching und Storage.
 * Hält den nicht-persistenten Laufzeit-Zustand (geladene Schild-/Forms-Daten);
 * der persistente Zustand liegt in `state` (siehe storage.js) und wird bei jeder
 * relevanten Änderung über Storage.scheduleSave(state) gesichert.
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
  let createKursTargetCourseText = null; // welcher Kurswahl-Text hat den "Kurs anlegen"-Dialog geöffnet

  let missingStudents = []; // [{id, nachname, vorname, klasse}] – Schild-Schüler ohne Forms-Zuordnung

  let formsParsed = null; // { headers, rows }
  let studentEntries = []; // [{formsName, courses, rowIndex}] – ein Eintrag pro eindeutigem Forms-Namen
  let distinctCourseTexts = [];

  let schuelerLabelToId = new Map(); // für Datalist-Auflösung
  let kursLabelToId = new Map();

  let transferPreviewRows = []; // [{schuelerId, schuelerLabel, kursId, kursLabel, lernabschnittID, existing, fach, kurs}]
  let lernabschnittsdatenCache = new Map(); // schuelerId -> Promise<lernabschnittsdaten>

  // ---------- Hilfsfunktionen ----------

  function $(id) { return document.getElementById(id); }

  function setStatus(el, text, kind) {
    el.textContent = text;
    el.className = "status-msg" + (kind ? " " + kind : "");
  }

  function reveal(id) { $(id).classList.remove("hidden"); }

  function persist() { Storage.scheduleSave(state); }

  function schuelerLabel(s) {
    const jahrgang = s.jahrgang || "";
    const klasse = schuelerIdToKlasse.get(s.id) || "";
    let suffix = "";
    if (jahrgang && klasse) suffix = ` (${jahrgang}-${klasse})`;
    else if (jahrgang || klasse) suffix = ` (${jahrgang || klasse})`;
    return `${s.nachname}, ${s.vorname}${suffix} [${s.id}]`;
  }

  function kursLabel(k) {
    const zeugnis = k.bezeichnungZeugnis ? ` – ${k.bezeichnungZeugnis}` : "";
    return `${k.kuerzel}${zeugnis} [${k.id}]`;
  }

  /** Wie kursLabel(), aber mit Schülerzahl in Klammern (für Schritt 8 "Split in Jahrgangskurse") -
   *  die Zahl kommt aus dem eingebetteten `schueler[]`-Array der zuletzt geladenen Kursdaten. */
  function kursLabelMitAnzahl(k) {
    const zeugnis = k.bezeichnungZeugnis ? ` – ${k.bezeichnungZeugnis}` : "";
    const anzahl = (k.schueler || []).length;
    return `${k.kuerzel}${zeugnis} (${anzahl}) [${k.id}]`;
  }

  /** Extrahiert die in eckigen Klammern kodierte ID aus einem Datalist-Label. */
  function idFromLabel(label) {
    const m = /\[(\d+)\]\s*$/.exec(label || "");
    return m ? Number(m[1]) : null;
  }

  async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    async function run() {
      while (cursor < items.length) {
        const idx = cursor++;
        results[idx] = await worker(items[idx], idx);
      }
    }
    const runners = Array.from({ length: Math.min(limit, items.length) }, run);
    await Promise.all(runners);
    return results;
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
      setStatus($("connect-status"), err.message, "error");
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
      reveal("section-nachbereitung");
      buildDatalists();
      populateCreateKursDialogOptions();
      renderSplitJahrgangTable();
    } catch (err) {
      setStatus(statusEl, err.message, "error");
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

  /** Jahrgänge, die bei "Neuen Kurs anlegen" standardmäßig vorausgewählt werden (sofern in Schild
   *  vorhanden) - deckt Sek I und Oberstufe gleichermaßen ab, damit ein neu angelegter AG-/Wahlkurs
   *  nicht durch eine fehlende Jahrgangszuordnung von regulären Kursen abweicht. */
  const DEFAULT_JAHRGANG_KUERZEL = new Set(["05", "06", "07", "08", "09", "10", "EF", "Q1", "Q2"]);

  /** Baut die Jahrgangs-Checkboxen im "Neuen Kurs anlegen"-Dialog neu auf, inkl. Standard-Vorauswahl.
   *  Wird bei jedem Öffnen des Dialogs aufgerufen, damit eine vorherige manuelle Auswahl nicht hängen
   *  bleibt. */
  function renderCreateKursJahrgaenge() {
    const container = $("create-kurs-jahrgaenge-container");
    container.innerHTML = schildJahrgaenge
      .map((j) => {
        const label = j.kuerzel || j.kuerzelStatistik || `#${j.id}`;
        const vergleichsKuerzel = (j.kuerzel || j.kuerzelStatistik || "").trim().toUpperCase();
        const checked = DEFAULT_JAHRGANG_KUERZEL.has(vergleichsKuerzel);
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

    buildKursDatalistMitAnzahl();
  }

  /** Separate Datalist mit Schülerzahl je Kurs (für Schritt 8 "Split in Jahrgangskurse"), aus
   *  buildDatalists() ausgelagert, da sie nach jedem Kurs-Neuanlegen einzeln neu aufgebaut werden muss. */
  function buildKursDatalistMitAnzahl() {
    const datalist = $("kurs-datalist-anzahl");
    datalist.innerHTML = schildKurse.map((k) => `<option value="${escapeHtml(kursLabelMitAnzahl(k))}"></option>`).join("");
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

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
      btn.addEventListener("click", (evt) => openCreateKursDialog(evt.target.closest("tr").dataset.courseText))
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
   * Öffnet den "Neuen Kurs anlegen"-Dialog für einen bestimmten Forms-Kurstext (z.B. "S18 Judo").
   * Kürzel/Zeugnisbezeichnung werden mit dem Text ohne Spalten-Kürzel vorbelegt (siehe Schritt 3a) -
   * das Kürzel dient nur der internen Unterscheidung, nicht als sinnvoller Kurs-Name in Schild.
   */
  function openCreateKursDialog(courseText) {
    createKursTargetCourseText = courseText;
    const suggestion = FormsImport.stripKnownPrefix(courseText, state.columnPrefixes).trim();
    $("create-kurs-source-text").textContent = courseText;
    $("create-kurs-kuerzel").value = suggestion;
    $("create-kurs-bezeichnung").value = suggestion;
    $("create-kurs-fach").value = "";
    $("create-kurs-kursart").value = "";
    $("create-kurs-wochenstunden").value = 2;
    $("create-kurs-sichtbar").checked = true;
    renderCreateKursJahrgaenge();
    setStatus($("create-kurs-status"), "", "");
    $("create-kurs-dialog").showModal();
    $("create-kurs-kuerzel").focus();
  }

  function closeCreateKursDialog() {
    $("create-kurs-dialog").close();
    createKursTargetCourseText = null;
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

      if (createKursTargetCourseText) {
        Matching.setMatch(state.kursMatching, createKursTargetCourseText, {
          targetId: neuerKurs.id,
          targetLabel: kursLabel(neuerKurs),
          manual: true,
        });
        persist();
        renderCourseMatchTable();
      }

      closeCreateKursDialog();
      setStatus(
        $("course-match-summary"),
        `Kurs "${neuerKurs.kuerzel}" angelegt und zugeordnet.`,
        "ok"
      );
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
      persist();
    };
    ["default-kursart", "default-wochenstunden", "default-umfang", "default-auf-zeugnis", "default-epochal"].forEach(
      (id) => $(id).addEventListener("change", sync)
    );
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
  function collectMatchedPairs() {
    const pairs = [];
    const seenPairKeys = new Set();
    let duplicates = 0;
    for (const entry of studentEntries) {
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
    return { pairs, duplicates };
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
    const { pairs, duplicates } = collectMatchedPairs();
    if (pairs.length === 0) {
      setStatus(statusEl, "Keine gematchten Schüler/Kurs-Kombinationen gefunden.", "warn");
      return;
    }
    const dupHint = duplicates > 0 ? ` (${duplicates} Dopplungen automatisch entfernt)` : "";
    setStatus(statusEl, `Prüfe ${pairs.length} Kombinationen${dupHint} gegen bestehende Leistungsdaten …`, "");

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

    transferPreviewRows = pairs.map(({ schueler, kurs }) => {
      const lad = lernabschnittsdatenBySchueler.get(schueler.id);
      const existing = !!(lad?.leistungsdaten || []).some((l) => l.kursID === kurs.id);
      return {
        schuelerId: schueler.id,
        schuelerLabel: schuelerLabel(schueler),
        kursId: kurs.id,
        kursLabel: kursLabel(kurs),
        lernabschnittID: lad ? lad.id : null,
        kurs,
        existing,
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

  /**
   * Führt `apiCall(items)` aus (typischerweise ein Batch-Create/-Delete). Der SVWS-Server beantwortet
   * einen Batch offenbar transaktional: Enthält er auch nur einen ungültigen Datensatz (z.B. eine
   * Dopplung), schlägt der GESAMTE Batch mit 500 fehl - auch die unproblematischen Einträge. Um das
   * nicht auf Kosten gültiger Einträge gehen zu lassen, wird ein fehlgeschlagener Batch bei einem Fehler
   * rekursiv halbiert, bis entweder ein Teil-Batch durchgeht oder der/die einzelne(n) problematische(n)
   * Einträge isoliert sind. `items` können beliebige Objekte sein (nicht nur fertige Payloads) - `apiCall`
   * entscheidet, wie daraus der eigentliche Request-Body wird; `failed[].item` bleibt dabei die
   * ursprüngliche Objektreferenz, damit der Aufrufer sie z.B. für Folgeaktionen wiedererkennen kann.
   */
  async function batchWithBisection(items, apiCall) {
    if (items.length === 0) return { ok: 0, failed: [] };
    try {
      await apiCall(items);
      return { ok: items.length, failed: [] };
    } catch (err) {
      if (items.length === 1) {
        return { ok: 0, failed: [{ item: items[0], message: err.message }] };
      }
      const mid = Math.ceil(items.length / 2);
      const left = await batchWithBisection(items.slice(0, mid), apiCall);
      const right = await batchWithBisection(items.slice(mid), apiCall);
      return { ok: left.ok + right.ok, failed: [...left.failed, ...right.failed] };
    }
  }

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
      "Wirklich alle gespeicherten Zuordnungen und Einstellungen löschen? Das kann nicht rückgängig " +
        "gemacht werden. Schild-Daten und Forms-Datei müssen danach erneut geladen werden."
    );
    if (!sicher) return;
    localStorage.removeItem(Storage.STORAGE_KEY);
    location.reload();
  }

  // ---------- 8. Nachbereitung ----------

  let checkLeererKursResults = []; // [{schuelerId, schuelerLabel, fachLabel, kursart, leistungsdatenId}]

  async function onRunCheckLeererKurs() {
    if (schildSchueler.length === 0) {
      setStatus($("check-leerer-kurs-status"), "Bitte zuerst in Schritt 2 Schild-Daten laden.", "error");
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
    renderCheckLeererKursTable();
    $("btn-run-check-leerer-kurs").disabled = false;
    setStatus(
      statusEl,
      `${results.length} betroffene Leistungsdaten-Einträge gefunden${fehler ? ` (${fehler} Schüler:innen konnten nicht geprüft werden)` : ""}.`,
      results.length ? "warn" : "ok"
    );
  }

  function renderCheckLeererKursTable() {
    const tbody = document.querySelector("#check-leerer-kurs-table tbody");
    tbody.innerHTML = checkLeererKursResults
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
    $("check-leerer-kurs-select-all").checked = checkLeererKursResults.length > 0;
    $("btn-delete-check-leerer-kurs").disabled = checkLeererKursResults.length === 0;
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

  // ---------- 8b. Split in Jahrgangskurse ----------

  function jahrgangOptionsHtml(selectedId) {
    const optionen = ['<option value="">(wählen)</option>'].concat(
      schildJahrgaenge.map((j) => {
        const label = j.kuerzel || j.kuerzelStatistik || `#${j.id}`;
        return `<option value="${j.id}" ${j.id === selectedId ? "selected" : ""}>${escapeHtml(label)}</option>`;
      })
    );
    return optionen.join("");
  }

  function renderSplitJahrgangTable() {
    const tbody = document.querySelector("#split-jahrgang-table tbody");
    tbody.innerHTML = state.splitJahrgangRows
      .map((row, idx) => {
        const quellkurs = row.quellkursId != null ? kursById.get(row.quellkursId) : null;
        const quellkursValue = quellkurs ? kursLabelMitAnzahl(quellkurs) : "";
        return `
        <tr data-row-idx="${idx}">
          <td><input type="text" class="split-quellkurs-input" list="kurs-datalist-anzahl" value="${escapeHtml(quellkursValue)}" placeholder="Kurs wählen" /></td>
          <td><select class="split-jahrgang-select">${jahrgangOptionsHtml(row.jahrgangId)}</select></td>
          <td><input type="text" class="split-zielkurs-input" list="kurs-datalist-anzahl" value="${escapeHtml(row.zielkursText || "")}" placeholder="Kürzel (neu oder vorhanden)" /></td>
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
    state.splitJahrgangRows[idx].zielkursText = evt.target.value.trim();
    persist();
  }

  function onSplitJahrgangAddRow() {
    state.splitJahrgangRows.push({ quellkursId: null, jahrgangId: null, zielkursText: "" });
    persist();
    renderSplitJahrgangTable();
  }

  /** "+ Jahrgang": fügt direkt unter der Zeile eine neue Zeile mit demselben Quellkurs ein, damit sich
   *  ein Kurs bequem auf mehrere Jahrgänge/Zielkurse aufteilen lässt, ohne den Quellkurs neu wählen zu müssen. */
  function onSplitJahrgangAddBelow(evt) {
    const idx = splitJahrgangRowIndex(evt);
    const quelle = state.splitJahrgangRows[idx];
    state.splitJahrgangRows.splice(idx + 1, 0, { quellkursId: quelle.quellkursId, jahrgangId: null, zielkursText: "" });
    persist();
    renderSplitJahrgangTable();
  }

  function onSplitJahrgangRemoveRow(evt) {
    const idx = splitJahrgangRowIndex(evt);
    state.splitJahrgangRows.splice(idx, 1);
    persist();
    renderSplitJahrgangTable();
  }

  /** Baut aus einem Quell-Leistungsdaten-Eintrag den Payload für den Zielkurs: Noten-/Zeugnisrelevante
   *  Felder werden vom Quelleintrag übernommen (nichts an Bewertungsstand geht verloren), Kursart,
   *  Wochenstunden und Kursleitung kommen vom Zielkurs selbst (das ist ja jetzt der maßgebliche Kurs). */
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

  /** Löst das Zielkurs-Feld einer Zeile auf: bekannter Kurs (per Datalist-Auswahl, `[id]`-Suffix) wird
   *  direkt verwendet, ansonsten wird ein neuer Kurs mit dem eingetippten Kürzel angelegt (Fach/Kursart/
   *  Wochenstunden vom Quellkurs übernommen, Jahrgang auf genau den dieser Zeile beschränkt). */
  async function resolveOrCreateZielkurs(row, quellkurs, jahrgang, log) {
    const zielId = idFromLabel(row.zielkursText);
    if (zielId != null && kursById.has(zielId)) {
      return kursById.get(zielId);
    }
    const kuerzel = row.zielkursText.trim();
    if (!kuerzel) return null;
    const payload = {
      idSchuljahresabschnitt: abschnittId,
      kuerzel,
      kursartAllg: quellkurs.kursartAllg,
      idFach: quellkurs.idFach ?? null,
      bezeichnungZeugnis: quellkurs.bezeichnungZeugnis || kuerzel,
      wochenstunden: quellkurs.wochenstunden ?? 0,
      istSichtbar: true,
      idJahrgaenge: [jahrgang.id],
      schienen: [],
    };
    const neuerKurs = await SvwsApi.createKurs(payload);
    schildKurse.push(neuerKurs);
    kursById.set(neuerKurs.id, neuerKurs);
    buildKursDatalistMitAnzahl();
    row.zielkursText = kursLabelMitAnzahl(neuerKurs);
    log.textContent += `  Zielkurs "${kuerzel}" neu angelegt (ID ${neuerKurs.id}, Jahrgang ${jahrgang.kuerzel || jahrgang.kuerzelStatistik}).\n`;
    return neuerKurs;
  }

  async function onExecuteSplitJahrgang() {
    const log = $("split-jahrgang-log");
    const statusEl = $("split-jahrgang-status");
    const progressEl = $("split-jahrgang-progress");
    log.textContent = "";

    const rows = state.splitJahrgangRows.filter(
      (r) => r.quellkursId != null && r.jahrgangId != null && r.zielkursText && r.zielkursText.trim()
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

      let zielkurs;
      try {
        zielkurs = await resolveOrCreateZielkurs(row, quellkurs, jahrgang, log);
      } catch (err) {
        log.textContent += `  FEHLER beim Anlegen des Zielkurses: ${err.message}\n`;
        gesamtFehler++;
        continue;
      }
      if (!zielkurs) {
        log.textContent += `  Kein Zielkurs-Kürzel angegeben, übersprungen.\n`;
        continue;
      }
      if (zielkurs.id === quellkurs.id) {
        log.textContent += `  Quellkurs und Zielkurs sind identisch, übersprungen.\n`;
        continue;
      }

      const kandidaten = (quellkurs.schueler || []).filter((s) => {
        const voll = schuelerById.get(s.id);
        return voll && voll.idJahrgang === jahrgang.id;
      });
      const ausserhalbFilter = (quellkurs.schueler || []).length - kandidaten.length;
      if (kandidaten.length === 0) {
        log.textContent += `  Keine passenden Schüler:innen im Quellkurs gefunden${
          ausserhalbFilter ? ` (${ausserhalbFilter} Schüler:innen im Kurs sind nicht im aktuell geladenen Status-Filter enthalten)` : ""
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

      // Neu im Zielkurs anlegen. Ein fehlgeschlagener Create darf NICHT dazu führen, dass der
      // Quelleintrag trotzdem gelöscht wird - sonst verliert die Person die Fachbelegung komplett.
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

    progressEl.classList.add("hidden");
    persist();
    renderSplitJahrgangTable();
    $("btn-split-jahrgang-execute").disabled = false;
    setStatus(
      statusEl,
      `Fertig: ${gesamtVerschoben} Schüler:innen verschoben${gesamtFehler ? `, ${gesamtFehler} Fehler (siehe Protokoll)` : ""}.`,
      gesamtFehler ? "warn" : "ok"
    );
  }

  // ---------- Initialisierung ----------

  function init() {
    populateConnectionFields();
    populateTransferDefaults();
    bindTransferDefaultInputs();

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

    $("btn-run-check-leerer-kurs").addEventListener("click", onRunCheckLeererKurs);
    $("check-leerer-kurs-select-all").addEventListener("change", onCheckLeererKursSelectAll);
    $("btn-delete-check-leerer-kurs").addEventListener("click", onDeleteCheckLeererKurs);

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
    });
    renderSplitJahrgangTable();

    document.querySelectorAll("#student-status-filter input").forEach((cb) => cb.addEventListener("change", applyStudentFilter));
    document.querySelectorAll("#course-status-filter input").forEach((cb) => cb.addEventListener("change", applyCourseFilter));
    $("btn-student-filter-unsicher").addEventListener("click", () => setStudentFilterOnly(["low", "none"]));
    $("btn-student-filter-alle").addEventListener("click", () => setStudentFilterOnly(["saved", "high", "low", "none", "ignored"]));
    $("btn-course-filter-unsicher").addEventListener("click", () => setCourseFilterOnly(["low", "none"]));
    $("btn-course-filter-alle").addEventListener("click", () => setCourseFilterOnly(["saved", "high", "low", "none", "ignored"]));
  }

  document.addEventListener("DOMContentLoaded", init);
})();
