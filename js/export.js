/**
 * Export von Ergebnis-/Abgleich-Tabellen als CSV oder XLSX - eigenständiges Modul (window.ExportUtils),
 * von index.html und wartung.html gleichermaßen eingebunden (analog zu sharedCode.js/svwsApi.js). Für
 * XLSX wird die ohnehin schon für den Forms-Import vendorte SheetJS-Bibliothek (js/vendor/xlsx.full.min.js)
 * wiederverwendet - kein eigener ZIP/OOXML-Schreiber nötig, aber wartung.html muss die Datei dafür
 * zusätzlich einbinden (index.html tut das für den Forms-Import bereits).
 *
 * Liest den Tabelleninhalt direkt aus dem DOM (nicht aus dem zugrundeliegenden Ergebnis-Array) - exportiert
 * also immer genau das, was gerade sichtbar ist (inkl. aktiver Spaltenkopf-Filter/Sortierung, ohne dass
 * jede Tabelle dafür ihre eigene Export-Logik bräuchte). Rein interaktive/dekorative Elemente
 * (Auswahl-Checkboxen, Aktions-Buttons wie "Löschen"/"Übernehmen", Spaltenfilter-Popover, die (i)-Info-
 * Overlays) werden automatisch herausgefiltert, ebenso Spalten, die dadurch komplett leer würden (z.B. eine
 * reine Checkbox-Auswahlspalte) - kein manuelles Konfigurieren pro Tabelle nötig.
 */
(function (global) {
  "use strict";

  function normalizeWhitespace(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  /** Text einer Kopfzeilen-Zelle: entfernt Spaltenfilter-Popover (.col-filter-wrap, samt dem darin
   *  versteckten Checkbox-Popover) sowie reine Steuerelemente (input/select, z.B. ein Klassen-Filter-
   *  Dropdown im Spaltenkopf) - behält aber z.B. Sortier-Buttons (.th-sort-btn), deren Text die
   *  eigentliche Spaltenüberschrift ist. */
  function headerCellText(th) {
    const clone = th.cloneNode(true);
    clone.querySelectorAll(".col-filter-wrap, input, select").forEach((el) => el.remove());
    return normalizeWhitespace(clone.textContent);
  }

  /** Text einer Datenzelle: entfernt interaktive/dekorative Elemente (Auswahl-Checkboxen, Buttons,
   *  die (i)-Info-Overlays samt ihrer versteckten Liste) - keine exportierbaren Daten. */
  function bodyCellText(td) {
    const clone = td.cloneNode(true);
    clone.querySelectorAll(".info-popover, input, button, select").forEach((el) => el.remove());
    return normalizeWhitespace(clone.textContent);
  }

  /** Liest eine Tabelle vollständig aus dem aktuellen DOM-Stand und liefert {headers, rows}. Spalten, die
   *  nach dem Entfernen der interaktiven Elemente sowohl im Kopf als auch in jeder Datenzeile leer sind
   *  (z.B. eine reine Auswahl-Checkbox-Spalte oder eine reine Aktions-Button-Spalte ohne Überschrift),
   *  werden automatisch entfernt. */
  function readTable(table) {
    const headers = Array.from(table.querySelectorAll("thead th")).map(headerCellText);
    const rows = Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
      Array.from(tr.children).map(bodyCellText)
    );

    const leereSpalten = headers
      .map((_, i) => i)
      .filter((i) => !headers[i] && rows.every((row) => !row[i]));
    const behalten = headers.map((_, i) => i).filter((i) => !leereSpalten.includes(i));

    return {
      headers: behalten.map((i) => headers[i] || ""),
      rows: rows.map((row) => behalten.map((i) => row[i] || "")),
    };
  }

  /** Zeitstempel für Dateinamen, analog zu Storage.exportJson(). */
  function dateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** Ein CSV-Feld nach RFC 4180, Trennzeichen Semikolon (deutsche Excel-Konvention - mit Komma als
   *  Trennzeichen reißt Excel unter deutscher Gebietsschema-Einstellung sonst jede Zeile in eine einzige
   *  Spalte statt sie zu splitten, siehe dieselbe Semikolon-Entscheidung schon bei der Untis-Dateierkennung). */
  function csvField(value) {
    const str = String(value ?? "");
    if (/[;"\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  function buildCsv(headers, rows) {
    const lines = [headers, ...rows].map((row) => row.map(csvField).join(";"));
    // Führendes UTF-8-BOM, damit Excel unter Windows die Umlaute korrekt anzeigt (ohne BOM interpretiert
    // Excel eine per Doppelklick geöffnete .csv sonst oft als ANSI/Windows-1252).
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  /** @param table das <table>-Element, dessen aktueller Inhalt exportiert werden soll
   *  @param filenameBase Dateiname ohne Endung/Zeitstempel, z.B. "leere-kurse" */
  function exportTableToCsv(table, filenameBase) {
    const { headers, rows } = readTable(table);
    const blob = new Blob([buildCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `${filenameBase}-${dateStamp()}.csv`);
  }

  /** Wie exportTableToCsv(), aber als echte .xlsx-Datei über die vendorte SheetJS-Bibliothek (muss auf der
   *  aufrufenden Seite per <script src="js/vendor/xlsx.full.min.js"> eingebunden sein - meldet sich sonst
   *  in der Konsole statt einen kryptischen Fehler zu werfen). */
  function exportTableToXlsx(table, filenameBase) {
    if (typeof global.XLSX === "undefined") {
      console.error('XLSX-Export nicht möglich: js/vendor/xlsx.full.min.js ist auf dieser Seite nicht eingebunden.');
      return;
    }
    const { headers, rows } = readTable(table);
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Export");
    const arrayBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const blob = new Blob([arrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    downloadBlob(blob, `${filenameBase}-${dateStamp()}.xlsx`);
  }

  /** Fügt direkt oberhalb der Tabelle (bzw. ihres .table-scroll-Wrappers, falls vorhanden) rechtsbündig
   *  zwei kompakte Icon-Buttons für CSV-/XLSX-Export ein - der einzige Aufruf, den eine Seite pro Tabelle
   *  braucht (kein HTML-Markup pro Tabelle nötig). Still no-op, wenn `table` nicht existiert (z.B. Feature
   *  in einer älteren Version der Seite nicht vorhanden) statt einen Fehler zu werfen.
   *  @param table das <table>-Element (nicht dessen ID)
   *  @param filenameBase Dateiname ohne Endung/Zeitstempel, z.B. "leere-kurse" */
  function attachExportButtons(table, filenameBase) {
    if (!table) return;
    const bar = document.createElement("div");
    bar.className = "table-export-bar";
    bar.innerHTML =
      '<button type="button" class="export-btn" title="Als CSV-Datei exportieren">⬇ CSV</button>' +
      '<button type="button" class="export-btn" title="Als Excel-Datei (XLSX) exportieren">⬇ XLSX</button>';
    const [csvBtn, xlsxBtn] = bar.querySelectorAll("button");
    csvBtn.addEventListener("click", () => exportTableToCsv(table, filenameBase));
    xlsxBtn.addEventListener("click", () => exportTableToXlsx(table, filenameBase));

    const anchor = table.closest(".table-scroll") || table;
    anchor.parentNode.insertBefore(bar, anchor);
  }

  global.ExportUtils = {
    exportTableToCsv,
    exportTableToXlsx,
    attachExportButtons,
  };
})(window);
