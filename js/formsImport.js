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

  /** Standard-Kürzel für eine Kurswahl-Spalte, falls noch kein eigenes vergeben wurde. */
  function defaultColumnPrefix(colIdx) {
    return `S${colIdx + 1}`;
  }

  /**
   * Extrahiert pro Zeile den Namen und die Menge der nicht-leeren Kurswahl-Spaltenwerte.
   * Ist für eine Spalte ein Kürzel in `mapping.columnPrefixes` hinterlegt (Schlüssel = Spaltenindex
   * als String), wird es dem Zellwert vorangestellt - so lässt sich z.B. "Rudern" aus Spalte 7 beim
   * Matching von "Rudern" aus Spalte 9 unterscheiden (unterschiedliche Kürzel) oder bewusst
   * zusammenfassen (gleiches Kürzel). Ein leeres Kürzel lässt den Wert unverändert.
   * @returns {{formsName: string, courses: string[], rowIndex: number}[]}
   */
  function extractSelections(parsed, mapping) {
    const { rows } = parsed;
    const { nameCol, courseCols, columnPrefixes = {} } = mapping;
    return rows.map((row, rowIndex) => {
      const formsName = nameCol != null ? String(row[nameCol] ?? "").trim() : "";
      const seen = new Set();
      const courses = [];
      for (const colIdx of courseCols) {
        const value = String(row[colIdx] ?? "").trim();
        if (value === "") continue;
        const prefix = (columnPrefixes[String(colIdx)] ?? "").trim();
        const finalValue = prefix ? `${prefix} ${value}` : value;
        if (seen.has(finalValue)) continue;
        seen.add(finalValue);
        courses.push(finalValue);
      }
      return { formsName, courses, rowIndex };
    });
  }

  function distinctCourseTexts(selections) {
    const set = new Set();
    for (const s of selections) for (const c of s.courses) set.add(c);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
  }

  /**
   * Entfernt ein bekanntes Spalten-Kürzel (siehe Schritt 3a) samt trennendem Leerzeichen vom Anfang
   * eines Kurswahl-Textes, sofern vorhanden. Wird für die Ähnlichkeitssuche gegen Schild-Kurse in
   * Schritt 5 gebraucht: das Kürzel dient nur zur Unterscheidung gleichlautender Texte aus
   * verschiedenen Spalten und hat mit der eigentlichen Kursbezeichnung nichts zu tun - es würde die
   * Matching-Ähnlichkeit sonst künstlich verschlechtern. Als Speicherschlüssel in der Matching-Tabelle
   * bleibt weiterhin der volle (mit Kürzel versehene) Text in Verwendung.
   */
  function stripKnownPrefix(text, columnPrefixes) {
    for (const prefix of Object.values(columnPrefixes || {})) {
      const p = String(prefix ?? "").trim();
      if (p && text.startsWith(`${p} `)) return text.slice(p.length + 1);
    }
    return text;
  }

  global.FormsImport = {
    parseWorkbook,
    suggestColumnMapping,
    extractSelections,
    distinctCourseTexts,
    defaultColumnPrefix,
    stripKnownPrefix,
    METADATA_HEADERS,
  };
})(window);
