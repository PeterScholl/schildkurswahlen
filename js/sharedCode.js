/**
 * Wirklich zustandslose Hilfsfunktionen, die bislang identisch in js/app.js *und* js/wartung.js
 * standen (Copy-Paste-Duplikat). Bewusst NUR Funktionen hier, die ausschließlich von ihren Parametern
 * abhängen - alles, was Datei-lokalen Laufzeit-Zustand braucht (z.B. `state`, `schildKurse`, `kursById`,
 * den "Neuen Kurs anlegen"-Dialog, Verbindungsaufbau), bleibt bewusst pro Seite dupliziert, siehe
 * PLANUNG.md. Von beiden Seiten per <script>-Tag eingebunden (nach svwsApi.js, vor app.js/wartung.js).
 */
(function (global) {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function reveal(id) { $(id).classList.remove("hidden"); }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /** Extrahiert die in eckigen Klammern kodierte ID aus einem Datalist-Label (z.B. "Müller, Anna [42]"). */
  function idFromLabel(label) {
    const m = /\[(\d+)\]\s*$/.exec(label || "");
    return m ? Number(m[1]) : null;
  }

  function kursLabel(k) {
    const zeugnis = k.bezeichnungZeugnis ? ` – ${k.bezeichnungZeugnis}` : "";
    return `${k.kuerzel}${zeugnis} [${k.id}]`;
  }

  /** @param schuelerIdToKlasse Map Schüler-ID -> Klassen-Kürzel (aus KlassenDaten.schueler[] gebaut) -
   *  Parameter statt Closure-Zugriff, da beide Seiten ihre eigene, unabhängig geladene Map pflegen. */
  function schuelerLabel(s, schuelerIdToKlasse) {
    const jahrgang = s.jahrgang || "";
    const klasse = (schuelerIdToKlasse && schuelerIdToKlasse.get(s.id)) || "";
    let suffix = "";
    if (jahrgang && klasse) suffix = ` (${jahrgang}-${klasse})`;
    else if (jahrgang || klasse) suffix = ` (${jahrgang || klasse})`;
    return `${s.nachname}, ${s.vorname}${suffix} [${s.id}]`;
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

  /**
   * Führt `apiCall(items)` aus (typischerweise ein Batch-Create/-Delete). Der SVWS-Server beantwortet
   * einen Batch offenbar transaktional: Enthält er auch nur einen ungültigen Datensatz, schlägt der
   * GESAMTE Batch mit 500 fehl - auch die unproblematischen Einträge. Ein fehlgeschlagener Batch wird
   * deshalb bei einem Fehler rekursiv halbiert, bis entweder ein Teil-Batch durchgeht oder der/die
   * einzelne(n) problematische(n) Einträge isoliert sind. `items` können beliebige Objekte sein (nicht
   * nur fertige Payloads) - `apiCall` entscheidet, wie daraus der eigentliche Request-Body wird;
   * `failed[].item` bleibt dabei die ursprüngliche Objektreferenz.
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

  /** Jahrgänge, die bei "Neuen Kurs anlegen" standardmäßig vorausgewählt werden (sofern in Schild
   *  vorhanden) - deckt Sek I und Oberstufe gleichermaßen ab. */
  const DEFAULT_JAHRGANG_KUERZEL = new Set(["05", "06", "07", "08", "09", "10", "EF", "Q1", "Q2"]);

  /** HTML für den Info-Hinweis bei einem Netzwerkfehler (siehe setStatus() unten) - weist auf mögliche
   *  Ursachen hin (Server generell nicht erreichbar, oder von Firefox' "Local Network Access" blockiert),
   *  ohne eine davon zu behaupten. Domainname kommt bewusst aus `window.location.hostname` statt fest
   *  einprogrammiert, damit der Hinweis auch in anderen Umgebungen (z.B. localhost) stimmt. */
  function networkErrorHintHtml() {
    const host = escapeHtml(window.location.hostname || "diese Seite");
    return (
      '<details class="network-error-hint">' +
      "<summary>Server nicht erreichbar? Mögliche Ursache prüfen</summary>" +
      "<p>Das kann schlicht bedeuten, dass der Server gerade nicht läuft oder nicht erreichbar ist. " +
      'Es kann aber auch an Firefox\' "Local Network Access" liegen: Neuere Firefox-Versionen blockieren ' +
      "standardmäßig den Zugriff auf Adressen im lokalen/privaten Netzwerk (z.B. localhost, 192.168.x.x), " +
      "sofern diese Seite dafür keine Ausnahme hat.</p>" +
      "<p><strong>Falls das zutrifft:</strong></p>" +
      "<ol>" +
      "<li>Firefox-Adressleiste: <code>about:config</code> öffnen, Warnhinweis bestätigen</li>" +
      "<li>Nach <code>network.lna.skip-domains</code> suchen</li>" +
      `<li>Dort <code>${host}</code> eintragen (bei mehreren Domains mit Komma trennen)</li>` +
      "<li>Seite neu laden</li>" +
      "</ol>" +
      '<p>Alternativ: <code>about:preferences#privacy</code> → Berechtigungen → "Lokale Netzwerkgeräte" ' +
      'prüfen, ob diese Seite dort auf "Blockieren" statt "Zulassen" steht.</p>' +
      "</details>"
    );
  }

  /** @param err optional: der aufgefangene Fehler, falls `kind === "error"`. Stammt er aus einem
   *  Netzwerkfehler (SvwsApi.isNetworkError()), wird direkt hinter der Statuszeile ein aufklappbarer
   *  Hinweis mit möglichen Ursachen eingefügt (siehe networkErrorHintHtml()). */
  function setStatus(el, text, kind, err) {
    el.textContent = text;
    el.className = "status-msg" + (kind ? " " + kind : "");
    if (el.nextElementSibling && el.nextElementSibling.classList.contains("network-error-hint")) {
      el.nextElementSibling.remove();
    }
    if (kind === "error" && global.SvwsApi && global.SvwsApi.isNetworkError(err)) {
      el.insertAdjacentHTML("afterend", networkErrorHintHtml());
    }
  }

  global.SharedCode = {
    $,
    reveal,
    escapeHtml,
    idFromLabel,
    kursLabel,
    schuelerLabel,
    mapWithConcurrency,
    batchWithBisection,
    DEFAULT_JAHRGANG_KUERZEL,
    networkErrorHintHtml,
    setStatus,
  };
})(window);
