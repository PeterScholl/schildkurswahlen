/**
 * Fuzzy-Matching zwischen Forms-Daten (Namen, Kurstexte) und Schild-Objekten
 * (Schüler, Kurse) sowie Verwaltung der persistenten Matching-Tabellen.
 *
 * Die Matching-Tabellen selbst sind einfache Objekte (kein eigener State hier),
 * damit sie problemlos in Storage.js gespeichert/geladen werden können:
 *   table[normalisierterSchlüssel] = { targetId, targetLabel, manual, ignored }
 */
(function (global) {
  "use strict";

  const UMLAUT_MAP = { ä: "ae", ö: "oe", ü: "ue", Ä: "ae", Ö: "oe", Ü: "ue", ß: "ss" };

  function normalizeText(str) {
    return String(str ?? "")
      .replace(/[äöüÄÖÜß]/g, (m) => UMLAUT_MAP[m])
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenSet(str) {
    return new Set(normalizeText(str).split(" ").filter(Boolean));
  }

  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      [prev, curr] = [curr, prev];
    }
    return prev[n];
  }

  function levenshteinRatio(a, b) {
    if (a === "" && b === "") return 1;
    const dist = levenshtein(a, b);
    return 1 - dist / Math.max(a.length, b.length, 1);
  }

  function jaccard(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 0;
    let intersection = 0;
    for (const x of setA) if (setB.has(x)) intersection++;
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /** Ähnlichkeit zweier Texte, 0..1. Kombiniert Zeichen- und Token-Ähnlichkeit,
   *  damit sowohl Tippfehler als auch vertauschte Wortreihenfolgen (z.B.
   *  "Nachname, Vorname" vs. "Vorname Nachname") gut erkannt werden. */
  function similarity(a, b) {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const lr = levenshteinRatio(na, nb);
    const jac = jaccard(tokenSet(a), tokenSet(b));
    return Math.max(lr, jac, (lr + jac) / 2);
  }

  function normalizeKey(str) {
    return normalizeText(str);
  }

  function toVariants(x) {
    return (Array.isArray(x) ? x : [x]).filter((v) => v != null && v !== "");
  }

  /** Höchste Ähnlichkeit von `query` zu irgendeiner der `variants` (0, falls keine vorhanden). */
  function bestSimilarity(query, variants) {
    if (variants.length === 0) return 0;
    return Math.max(...variants.map((v) => similarity(query, v)));
  }

  /**
   * Generische Kandidatensuche: liefert die besten `limit` Treffer, absteigend sortiert.
   * `variantsFn` darf einen einzelnen String oder ein Array von Textvarianten liefern
   * (z.B. Kürzel UND Zeugnisbezeichnung eines Kurses) - es zählt die beste Übereinstimmung,
   * damit ein exaktes Kürzel-Match nicht durch eine lange, abweichende Zeugnisbezeichnung
   * verwässert wird.
   */
  function suggestMatches(query, candidates, variantsFn, limit = 5) {
    return candidates
      .map((item) => ({ item, score: bestSimilarity(query, toVariants(variantsFn(item))) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  function suggestStudentMatches(formsName, schuelerListe, limit = 5) {
    return suggestMatches(formsName, schuelerListe, (s) => `${s.nachname} ${s.vorname}`, limit);
  }

  function suggestCourseMatches(formsCourseText, kursListe, limit = 5) {
    return suggestMatches(formsCourseText, kursListe, (k) => [k.kuerzel, k.bezeichnungZeugnis], limit);
  }

  function lookup(table, key) {
    const normKey = normalizeKey(key);
    return table[normKey];
  }

  function setMatch(table, key, { targetId, targetLabel, manual = true }) {
    const normKey = normalizeKey(key);
    table[normKey] = { targetId, targetLabel, manual, ignored: false };
  }

  function setIgnored(table, key, { label } = {}) {
    const normKey = normalizeKey(key);
    table[normKey] = { targetId: null, targetLabel: label ?? key, manual: true, ignored: true };
  }

  function clearMatch(table, key) {
    const normKey = normalizeKey(key);
    delete table[normKey];
  }

  const DEFAULT_AUTO_THRESHOLD = 0.82;

  /**
   * Führt für alle `queries` (Strings) ein Auto-Matching gegen `candidates` durch.
   * Bereits vorhandene (gespeicherte oder ignorierte) Einträge in `table` werden
   * nicht angetastet. Neue Einträge werden nur bei Score >= threshold automatisch
   * übernommen (manual: false); alle anderen bleiben unbeantwortet und werden in
   * der Rückgabe als `review` mit Kandidatenliste aufgeführt.
   */
  function autoMatch(queries, candidates, variantsFn, labelFn, table, threshold = DEFAULT_AUTO_THRESHOLD) {
    const result = { matched: 0, review: [] };
    const seen = new Set();
    for (const query of queries) {
      const normKey = normalizeKey(query);
      if (seen.has(normKey)) continue;
      seen.add(normKey);
      if (table[normKey]) continue; // bereits gematcht oder ignoriert -> unverändert lassen
      const suggestions = suggestMatches(query, candidates, variantsFn, 5);
      const best = suggestions[0];
      if (best && best.score >= threshold) {
        table[normKey] = {
          targetId: best.item.id,
          targetLabel: labelFn(best.item),
          manual: false,
          ignored: false,
        };
        result.matched++;
      } else {
        result.review.push({ query, suggestions });
      }
    }
    return result;
  }

  /**
   * @param labelFn optionale Funktion zur Beschriftung eines Treffers beim Autospeichern
   *   in der Tabelle. Sollte dasselbe Format wie die Datalist-Optionen des Aufrufers
   *   verwenden (inkl. z.B. `[id]`-Suffix), damit spätere manuelle Änderungen im UI
   *   konsistent aufgelöst werden können.
   */
  function autoMatchStudents(formsNames, schuelerListe, table, threshold, labelFn) {
    const variantsFn = (s) => `${s.nachname} ${s.vorname}`;
    return autoMatch(formsNames, schuelerListe, variantsFn, labelFn || variantsFn, table, threshold);
  }

  function autoMatchCourses(courseTexts, kursListe, table, threshold, labelFn) {
    const variantsFn = (k) => [k.kuerzel, k.bezeichnungZeugnis];
    const defaultLabelFn = (k) => `${k.kuerzel || ""} ${k.bezeichnungZeugnis || ""}`.trim();
    return autoMatch(courseTexts, kursListe, variantsFn, labelFn || defaultLabelFn, table, threshold);
  }

  global.Matching = {
    normalizeText,
    normalizeKey,
    similarity,
    suggestMatches,
    suggestStudentMatches,
    suggestCourseMatches,
    lookup,
    setMatch,
    setIgnored,
    clearMatch,
    autoMatch,
    autoMatchStudents,
    autoMatchCourses,
    DEFAULT_AUTO_THRESHOLD,
  };
})(window);
