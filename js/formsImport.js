/**
 * Einlesen der Forms-xlsx-Exportdatei und generischer Spalten-Picker.
 * Bewusst generisch gehalten (keine Speziallogik für ein bestimmtes Umfrage-Layout),
 * damit das Tool für beliebige künftige Forms-Umfragen wiederverwendbar bleibt.
 */
(function (global) {
  "use strict";

  const METADATA_HEADERS = new Set([
    "ID",
    "Startzeit",
    "Fertigstellungszeit",
    "E-Mail",
    "Name",
    "Zeitpunkt der letzten Änderung",
  ]);

  async function parseWorkbook(file) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    if (rows.length === 0) return { headers: [], rows: [] };
    const headers = rows[0].map((h) => String(h ?? "").trim());
    const dataRows = rows.slice(1).filter((r) => r.some((cell) => String(cell ?? "").trim() !== ""));
    return { headers, rows: dataRows, sheetName: firstSheetName };
  }

  function looksLikeShortText(value) {
    const v = String(value ?? "").trim();
    if (v === "") return true; // leere Zellen sind ok (zählen nicht gegen die Heuristik)
    if (v.length > 60) return false;
    if (/^\d{4,}([.,]\d+)?$/.test(v)) return false; // reine (lange) Zahl -> eher kein Kurstext
    if (/^\d{1,2}[./]\d{1,2}[./]\d{2,4}/.test(v)) return false; // Datum
    return true;
  }

  /** Schlägt Namensspalte und Kurswahl-Spalten anhand einfacher Heuristiken vor. */
  function suggestColumnMapping(headers, rows) {
    const nameCol = headers.findIndex((h) => h.toLowerCase() === "name");
    const courseCols = [];
    headers.forEach((header, idx) => {
      if (idx === nameCol) return;
      if (METADATA_HEADERS.has(header)) return;
      const sample = rows.slice(0, 50).map((r) => r[idx]);
      const nonEmpty = sample.filter((v) => String(v ?? "").trim() !== "");
      if (nonEmpty.length === 0) return;
      const allShort = sample.every(looksLikeShortText);
      if (allShort) courseCols.push(idx);
    });
    return { nameCol: nameCol >= 0 ? nameCol : null, courseCols };
  }

  /**
   * Extrahiert pro Zeile den Namen und die Menge der nicht-leeren Kurswahl-Spaltenwerte.
   * @returns {{formsName: string, courses: string[], rowIndex: number}[]}
   */
  function extractSelections(parsed, mapping) {
    const { rows } = parsed;
    const { nameCol, courseCols } = mapping;
    return rows.map((row, rowIndex) => {
      const formsName = nameCol != null ? String(row[nameCol] ?? "").trim() : "";
      const seen = new Set();
      const courses = [];
      for (const colIdx of courseCols) {
        const value = String(row[colIdx] ?? "").trim();
        if (value === "") continue;
        if (seen.has(value)) continue;
        seen.add(value);
        courses.push(value);
      }
      return { formsName, courses, rowIndex };
    });
  }

  function distinctCourseTexts(selections) {
    const set = new Set();
    for (const s of selections) for (const c of s.courses) set.add(c);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
  }

  global.FormsImport = {
    parseWorkbook,
    suggestColumnMapping,
    extractSelections,
    distinctCourseTexts,
    METADATA_HEADERS,
  };
})(window);
