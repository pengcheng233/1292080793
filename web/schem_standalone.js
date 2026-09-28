/* Standalone bootstrap for the schematic-only export.
 *
 * This file is concatenated into the page after web/schem.js. schem.js only
 * declares functions and module-scope globals (schemData, schemSheets, ...); it
 * never runs anything at load time, so loading order is: page data -> schem.js
 * -> this file. This file then sets the globals schem.js expects and drives the
 * build, without the BOM switch the full ibom page uses (there is no BOM here).
 *
 * ES3 only (Altium-era JScript): no let/const, no arrow functions, no template
 * literals, no trailing commas, no for...of. */

/* Shims so buildSchemContent()'s EventHandler.registerCallback call is a no-op
 * in this page - there is no BOM to cross-probe from here, so we simply ignore
 * the subscription. They must exist before ensureSchem() runs. */
var IBOM_EVENT_TYPES = { HIGHLIGHT_EVENT: "highlight" };
var EventHandler = { registerCallback: function () {} };

/* Designator search box: highlight every component whose reference designator
 * contains the typed text (case-insensitive), and pan to the first match. */
function schemSearch(v) {
  v = String(v == null ? "" : v).trim().toUpperCase();
  if (!v) {
    schemHighlight([]);
    return;
  }
  var refs = [];
  if (typeof schemRefIndex != "undefined" && schemRefIndex) {
    for (var k in schemRefIndex) {
      if (!Object.prototype.hasOwnProperty.call(schemRefIndex, k)) continue;
      if (String(k).toUpperCase().indexOf(v) >= 0) refs.push(k);
    }
  }
  schemHighlight(refs);
  if (refs.length) schemFocus(refs[0], true);
}

/* The only entry point the page needs. It mirrors initSchem() from schem.js but
 * skips the "default to BOM" step, because a standalone page is schematic-only.
 * It then calls ensureSchem(), which builds the SVG or explains why there is
 * none. */
function schemStandaloneInit() {
  var div = document.getElementById("schemdiv");
  if (!div) return;
  schemData = (typeof pcbdata != "undefined" && pcbdata && pcbdata.schem) ?
    pcbdata.schem : null;
  schemHasData = !!(schemData && schemData.sheets && schemData.sheets.length > 0);
  schemBuilt = false;
  schemReady = false;
  schemCurrent = -1;
  // Show the schematic directly; ensureSchem does the rest.
  ensureSchem();
}

if (typeof window != "undefined" && window.addEventListener) {
  window.addEventListener("DOMContentLoaded", schemStandaloneInit);
} else if (typeof document != "undefined") {
  schemStandaloneInit();
}
