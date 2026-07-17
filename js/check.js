/**
 * Nachbereitungs-Kontrollen (Schritt 8): rein fachliche Prüf-Logik auf bereits in Schild vorhandenen
 * Daten, unabhängig vom Forms-Abgleich. Bewusst analog zu matching.js/formsImport.js als reine
 * Funktionen ohne eigenen Zustand und ohne API-Zugriff gehalten - das Holen der Daten (Lernabschnitts-
 * daten je Schüler:in) übernimmt app.js, hier steckt nur die Analyse, damit sie sich isoliert testen
 * lässt und künftige weitere Kontrollen sich leicht ergänzen lassen.
 */
(function (global) {
  "use strict";

  /**
   * Findet Leistungsdaten-Einträge eines Lernabschnitts, die eine Kursart tragen (also ursprünglich
   * einem Kurs zugeordnet sein sollten), deren Kurs-Verknüpfung aber fehlt oder ins Leere zeigt. Zwei
   * Varianten davon sind aufgefallen:
   *   1. `kursID` ist tatsächlich leer (`null`), obwohl eine Kursart gesetzt ist.
   *   2. `kursID` ist gesetzt, verweist aber auf keinen der aktuell in Schild vorhandenen Kurse (`
   *      gueltigeKursIds`) - eine hängende Fremdschlüssel-Referenz, die in Schild selbst als leeres
   *      Kurs-Feld angezeigt wird, obwohl der Datensatz technisch eine `kursID` trägt. Das passiert z.B.,
   *      wenn zwei Leistungsdaten-Einträge für dasselbe Fach mit unterschiedlicher `kursID` existieren
   *      (Duplikat) und einer der beiden Kurse zwischenzeitlich in Schild gelöscht wurde.
   * Reiner Klassenunterricht hat üblicherweise weder `kursart` noch `kursID` gesetzt und wird hier bewusst
   * NICHT gemeldet - erst das Zusammentreffen "Kursart vorhanden, aber Kurs fehlt/existiert nicht" ist
   * auffällig.
   * @param gueltigeKursIds Set<number> der aktuell in Schild existierenden Kurs-IDs (z.B. aus `kursById`)
   * @returns Array der betroffenen Leistungsdaten-Objekte (unverändert, inkl. `id`)
   */
  function findeLeistungsdatenMitLeeremKurs(lernabschnittsdaten, gueltigeKursIds) {
    if (!lernabschnittsdaten) return [];
    const gueltig = gueltigeKursIds || new Set();
    return (lernabschnittsdaten.leistungsdaten || []).filter((l) => {
      const hatKursart = l.kursart != null && String(l.kursart).trim() !== "";
      if (!hatKursart) return false;
      if (l.kursID == null) return true;
      return !gueltig.has(l.kursID);
    });
  }

  /** Registry aller Nachbereitungs-Kontrollen, für eine generische Bedienoberfläche in Schritt 8. */
  const CHECKS = {
    leistungsdatenLeererKurs: {
      id: "leistungsdatenLeererKurs",
      label: "Leistungsdaten mit leerem Kurs (Kursart gesetzt, aber Kurs fehlt oder existiert nicht mehr)",
      findIssues: findeLeistungsdatenMitLeeremKurs,
    },
  };

  global.Check = {
    findeLeistungsdatenMitLeeremKurs,
    CHECKS,
  };
})(window);
