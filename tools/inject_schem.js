// Inject the offline-parsed schematic into an AD-exported MAIN ibom page.
//
// Why: the main page (web/ibom.html -> PnPout export) already renders
// pcbdata.schem through web/schem.js, but that data used to come from the
// AD-side reader, which suffers the "AD compiles a script once per session"
// trap and can silently ship an empty schematic. This tool parses the
// .SchDoc binary directly (tools/schdoc2html.js) and REPLACES the schem
// block inside the exported page, leaving BOM / PCB data untouched.
//
// Called automatically by the AD dialog (mainWin.js) when "Include schematic"
// is checked; can also be run by hand:
//   node tools/inject_schem.js --in=<exported ibom page>
//        [--schdoc=<file.SchDoc|folder>] [--out=<file>] [--units=0.254]
//
// Payload forms handled:
//   var pcbdata = JSON.parse(LZString.decompressFromBase64("..."))   (AD export)
//   var pcbdata = {...};                                             (plain)
// The compressed form is replaced with plain JSON (larger file, simpler tool).
//
// --schdoc defaults to the first *.SchDoc found next to the input page, then
// walking up parent directories (project root keeps SchDocs next to PnPout/).
// Every .SchDoc found becomes one schematic sheet. --out defaults to in-place
// (the premerge backup lives in work\backups\).
//
// After running, reload the page and use the left-pane "原理图" switch.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { parseSchDoc } = require(path.join(__dirname, "schdoc2html.js"));

// web/lz-string.js is the full implementation (compress AND decompress) and
// exports LZString under node; modules-lite/lz-string.js only compresses.
function loadLZ() {
  const lz = require(path.join(ROOT, "web", "lz-string.js"));
  if (!lz || !lz.decompressFromBase64) {
    throw new Error("could not load LZString from web/lz-string.js");
  }
  return lz;
}

const SKIP_DIR = /(^|[\\/])(pnputil|backup|history|old|\.git|\.svn|node_modules)([\\/]|$)/i;

// Search dir, then up to 3 parent levels; non-recursive. Returns the first
// level that contains .SchDoc files (board dir -> project dir covers AD
// layouts), or [] when nothing is found.
function findSchDocs(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 4; i++, dir = path.dirname(dir)) {
    if (SKIP_DIR.test(dir + path.sep)) continue;
    let hits;
    try {
      hits = fs.readdirSync(dir).filter(f => /\.schdoc$/i.test(f));
    } catch (e) { continue; }
    if (hits.length) return hits.sort().map(f => path.join(dir, f));
  }
  return [];
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const hit = args.find(a => a.startsWith("--" + name + "="));
    return hit ? hit.slice(name.length + 3) : def;
  };
  const inPath = opt("in");
  if (!inPath || !fs.existsSync(inPath)) {
    console.log("usage: node tools/inject_schem.js --in=<exported page> " +
      "[--schdoc=<f|folder>] [--out=<f>]");
    return 1;
  }
  const outPath = opt("out", inPath);

  // ---- locate the .SchDoc(s) -----------------------------------------------
  let schPaths = [];
  const schArg = opt("schdoc");
  if (schArg) {
    const st = fs.statSync(schArg);
    if (st.isDirectory()) schPaths = findSchDocs(schArg);
    else schPaths = [schArg];
  } else {
    schPaths = findSchDocs(path.dirname(path.resolve(inPath)));
  }
  schPaths = schPaths.filter(p => fs.existsSync(p));
  if (!schPaths.length) {
    console.log("no .SchDoc found near " + inPath + " - pass --schdoc=<file>");
    return 1;
  }

  // ---- parse the page payload ---------------------------------------------
  let html = fs.readFileSync(inPath, "utf8");
  const mComp = html.match(
    /var pcbdata = JSON\.parse\(LZString\.decompressFromBase64\("([A-Za-z0-9+/=]+)"\)\)/);
  // The plain form is extracted with a brace-balanced scan: a regex up to
  // </script> runs past the payload whenever the export keeps more code in
  // the same script block (e.g. ";var storage;..."), so re-injecting an
  // already-converted page failed to decode the JSON.
  let mPlain = null;
  if (!mComp) {
    const pstart = html.indexOf("var pcbdata = {");
    if (pstart >= 0) {
      const body0 = pstart + "var pcbdata = ".length;
      let depth = 0, inStr = false, esc = false, pend = -1;
      for (let i = body0; i < html.length; i++) {
        const c = html[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) { pend = i + 1; break; } }
      }
      if (pend > 0) {
        mPlain = { start: pstart, end: pend, text: html.slice(body0, pend) };
      }
    }
  }
  if (!mComp && !mPlain) {
    console.log("could not find 'var pcbdata = ...' in " + inPath);
    return 1;
  }
  let pcbdata;
  try {
    pcbdata = JSON.parse(mComp ? loadLZ().decompressFromBase64(mComp[1])
                               : mPlain.text);
  } catch (e) {
    console.log("failed to decode pcbdata (" + e.message + ")");
    return 1;
  }

  // ---- offline parse, same shape the AD reader would have produced --------
  const data = { units: 0.254, diag: [], sheets: [] };
  for (const p of schPaths) {
    const one = parseSchDoc(p);
    data.sheets.push.apply(data.sheets, one.sheets);
    data.diag.push.apply(data.diag, one.diag);
  }

  const hadSchem = !!(pcbdata.schem && pcbdata.schem.sheets &&
    pcbdata.schem.sheets.length);
  pcbdata.schem = data;

  // ---- write back with the same script-safe escaping -----------------------
  function jsonForScript(s) {
    return String(s)
      .replace(/</g, () => "\\u003c")
      .replace(/>/g, () => "\\u003e")
      .replace(/&/g, () => "\\u0026")
      .replace(/\u2028/g, () => "\\u2028")
      .replace(/\u2029/g, () => "\\u2029");
  }
  const payload = jsonForScript(JSON.stringify(pcbdata));
  if (mComp) {
    // Function replacement: a plain string would misread "$&"-style runs in
    // the payload as replacement syntax and corrupt the JSON.
    html = html.replace(mComp[0], () => "var pcbdata = " + payload);
  } else {
    // Span replacement keeps whatever follows the payload (the export may
    // continue with more code in the same script block).
    html = html.slice(0, mPlain.start) + "var pcbdata = " + payload +
      html.slice(mPlain.end);
  }

  fs.writeFileSync(outPath, html, "utf8");
  const comps = data.sheets.reduce((n, s) => n + s.comps.length, 0);
  const wires = data.sheets.reduce((n, s) =>
    n + s.gfx.filter(g => g[0] === "l" || g[0] === "pl").length, 0);
  console.log((hadSchem ? "REPLACED" : "ADDED") + " pcbdata.schem from " +
    schPaths.length + " SchDoc(s): " + schPaths.map(p => path.basename(p))
      .join(", "));
  console.log("sheets: " + data.sheets.length + ", components: " + comps +
    ", wires: " + wires);
  console.log("wrote : " + outPath + " (" + fs.statSync(outPath).size + " bytes)");
  return 0;
}

// Runnable directly (CLI) and requireable (tests): main() returns the exit
// code instead of calling process.exit so tests can run it in-process.
if (require.main === module) process.exit(main());
module.exports = { main };
