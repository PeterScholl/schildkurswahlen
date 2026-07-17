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
  let schuelerById = new Map();
  let kursById = new Map();
  let schuelerIdToKlasse = new Map(); // Schüler-ID -> Klassen-Kürzel, aus KlassenDaten.schueler[] gebaut

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
    const klasse = s.jahrgang ? ` (${s.jahrgang})` : "";
    return `${s.nachname}, ${s.vorname}${klasse} [${s.id}]`;
  }

  function kursLabel(k) {
    const zeugnis = k.bezeichnungZeugnis ? ` – ${k.bezeichnungZeugnis}` : "";
    return `${k.kuerzel}${zeugnis} [${k.id}]`;
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

      $("schild-data-counts").textContent =
        `${schildSchueler.length} Schüler (gefiltert), ${schildKurse.length} Kurse, ${schildFaecher.length} Fächer, ${schildKlassen.length} Klassen geladen.`;
      setStatus(statusEl, "Fertig." + klassenHinweis, klassenHinweis ? "warn" : "ok");
      reveal("section-forms-import");
      buildDatalists();
    } catch (err) {
      setStatus(statusEl, err.message, "error");
    }
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
    persist();

    const selections = FormsImport.extractSelections(formsParsed, state.columnMapping);
    studentEntries = groupSelectionsByName(selections);
    distinctCourseTexts = FormsImport.distinctCourseTexts(selections);

    setStatus(
      $("forms-mapping-status"),
      `${studentEntries.length} eindeutige Namen, ${distinctCourseTexts.length} unterschiedliche Kurswahl-Texte.`,
      "ok"
    );

    renderStudentMatchTable();
    renderCourseMatchTable();
    reveal("section-student-matching");
    reveal("section-missing-students");
    reveal("section-course-matching");
    reveal("section-transfer");
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
        const suggestions = Matching.suggestCourseMatches(courseText, schildKurse, 1);
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
      `;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll(".course-match-input").forEach((input) => input.addEventListener("change", onCourseMatchInputChange));
    tbody.querySelectorAll(".course-ignore").forEach((cb) => cb.addEventListener("change", onCourseIgnoreChange));
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
      kursLabel
    );
    persist();
    renderCourseMatchTable();
    setStatus(
      $("course-match-summary"),
      `${result.matched} automatisch gematcht, ${result.review.length} benötigen manuelle Prüfung.`,
      result.review.length ? "warn" : "ok"
    );
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
   * Legt `rows` als Batch an. Der SVWS-Server beantwortet einen Batch offenbar transaktional:
   * Enthält er auch nur einen ungültigen Datensatz (z.B. Dopplung, die trotz Deduplizierung
   * durch einen abweichenden Datenstand entstanden ist), schlägt der GESAMTE Batch mit 500 fehl
   * - auch die 49 unproblematischen Einträge. Um das nicht auf Kosten gültiger Einträge gehen zu
   * lassen, wird ein fehlgeschlagener Batch bei einem Fehler rekursiv halbiert, bis entweder ein
   * Teil-Batch durchgeht oder der/die einzelne(n) problematische(n) Datensätze isoliert sind.
   */
  async function createBatchWithBisection(rows) {
    if (rows.length === 0) return { ok: 0, failed: [] };
    try {
      await SvwsApi.createLeistungsdatenMultiple(rows.map(buildLeistungsdatenPayload));
      return { ok: rows.length, failed: [] };
    } catch (err) {
      if (rows.length === 1) {
        return { ok: 0, failed: [{ row: rows[0], message: err.message }] };
      }
      const mid = Math.ceil(rows.length / 2);
      const left = await createBatchWithBisection(rows.slice(0, mid));
      const right = await createBatchWithBisection(rows.slice(mid));
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
      const result = await createBatchWithBisection(batch);
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
        log.textContent += `- ${f.row.schuelerLabel} / ${f.row.kursLabel}: ${f.message}\n`;
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

  // ---------- Initialisierung ----------

  function init() {
    populateConnectionFields();
    populateTransferDefaults();
    bindTransferDefaultInputs();

    $("btn-connect").addEventListener("click", onConnect);
    $("btn-load-schild-data").addEventListener("click", onLoadSchildData);
    $("forms-file-input").addEventListener("change", onFormsFileSelected);
    $("btn-apply-mapping").addEventListener("click", onApplyMapping);
    $("btn-automatch-students").addEventListener("click", onAutomatchStudents);
    $("btn-save-student-matches").addEventListener("click", onSaveStudentMatches);
    $("btn-check-missing-students").addEventListener("click", onCheckMissingStudents);
    $("missing-students-klasse-filter").addEventListener("change", renderMissingStudentsTable);
    $("missing-students-klasse-filter").addEventListener("input", renderMissingStudentsTable);
    document.querySelector("#missing-students-table thead").addEventListener("click", onMissingStudentsSortClick);
    updateMissingStudentsSortIndicators();
    $("btn-automatch-courses").addEventListener("click", onAutomatchCourses);
    $("btn-compute-preview").addEventListener("click", onComputePreview);
    $("transfer-select-all").addEventListener("change", onTransferSelectAll);
    $("btn-execute-transfer").addEventListener("click", onExecuteTransfer);
    $("btn-export-json").addEventListener("click", onExportJson);
    $("import-json-input").addEventListener("change", onImportJson);
    $("btn-reset-state").addEventListener("click", onResetState);

    document.querySelectorAll("#student-status-filter input").forEach((cb) => cb.addEventListener("change", applyStudentFilter));
    document.querySelectorAll("#course-status-filter input").forEach((cb) => cb.addEventListener("change", applyCourseFilter));
    $("btn-student-filter-unsicher").addEventListener("click", () => setStudentFilterOnly(["low", "none"]));
    $("btn-student-filter-alle").addEventListener("click", () => setStudentFilterOnly(["saved", "high", "low", "none", "ignored"]));
    $("btn-course-filter-unsicher").addEventListener("click", () => setCourseFilterOnly(["low", "none"]));
    $("btn-course-filter-alle").addEventListener("click", () => setCourseFilterOnly(["saved", "high", "low", "none", "ignored"]));
  }

  document.addEventListener("DOMContentLoaded", init);
})();
