// Offline .SchDoc -> interactive HTML converter. NO Altium, NO script engine.
//
// Why: the AD-side X2 reader returned "56 components, 0 graphics" - the sheet
// object walk never produced wires/labels, and AD only compiles a script once
// per session, so every experiment costs an AD restart. This tool reads the
// .SchDoc binary directly instead:
//
//   OLE Compound File (CFB) -> stream "FileHeader"
//   -> records: <len:u32le> + property string + NUL (len includes the NUL)
//   -> |RECORD=n|KEY=VALUE|...  (verified byte-by-byte against a real file,
//      see .workbuddy/schdoc_probe.js for the derivation)
//
// Record types below are EMPIRICAL (file says "Binary File Version 5.0"), not
// copied from any reference table - the dumps that identified them are in
// schdoc_probe.js. Coordinates are absolute, in 1/100 inch (= 10 mil = 0.254 mm),
// Y up - the same model ecad/AD10sch.js feeds web/schem.js, which mirrors Y.
//
// Usage:
//   node tools/schdoc2html.js                    # work\SCH -> PnPout\Schematic.html
//   node tools/schdoc2html.js --in=<f|folder> --out=<file> [--json=<file>]
//
// Companion tool: tools/inject_schem.js replaces pcbdata.schem inside an
// AD-exported main ibom page with the payload parsed here, so the full
// BOM+PCB page shows the schematic without the AD script reader.
//
// Known limits: font sizes come from the RECORD=31 font table; images
// (RECORD=30) are skipped; models (44/45/46/48) only feed the footprint column.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const VERSION = "schdoc2html 2026-09-23";
const UNITS = 0.254; // mm per schematic unit (1/100 inch)

// ---------------------------------------------------------------- CFB reader ---

const SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

function cfbRead(buf) {
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIG[i]) throw new Error("not an OLE compound file (signature)");
  }
  const sectorSize = 1 << buf.readUInt16LE(30);
  const miniSize = 1 << buf.readUInt16LE(32);
  const miniCutoff = buf.readUInt32LE(56);
  const sectorOff = n => sectorSize + n * sectorSize; // header is sector 0

  const fatSectors = [];
  for (let i = 0; i < 109; i++) {
    const v = buf.readUInt32LE(76 + i * 4);
    if (v !== 0xFFFFFFFF && v !== 0xFFFFFFFE) fatSectors.push(v);
  }
  let difat = buf.readUInt32LE(68), guard = 0;
  while (difat !== 0xFFFFFFFE && difat !== 0xFFFFFFFF && guard++ < 4096) {
    const off = sectorOff(difat);
    for (let i = 0; i < sectorSize / 4 - 1; i++) {
      const v = buf.readUInt32LE(off + i * 4);
      if (v !== 0xFFFFFFFF && v !== 0xFFFFFFFE) fatSectors.push(v);
    }
    difat = buf.readUInt32LE(off + sectorSize - 4);
  }
  const fat = [];
  for (const s of fatSectors) {
    const off = sectorOff(s);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(buf.readUInt32LE(off + i * 4));
  }
  function chain(start) {
    const out = [];
    let s = start, g = 0;
    while (s < 0xFFFFFFFA && g++ < 1e7) { out.push(s); s = fat[s]; }
    return out;
  }
  const readRegular = (start, size) =>
    Buffer.concat(chain(start).map(sectorOff).map(o => buf.slice(o, o + sectorSize))).slice(0, size);

  const dirBuf = Buffer.concat(chain(buf.readUInt32LE(48))
    .map(sectorOff).map(o => buf.slice(o, o + sectorSize)));
  const entries = [];
  for (let i = 0; i + 128 <= dirBuf.length; i += 128) {
    const nameLen = dirBuf.readUInt16LE(i + 64);
    if (nameLen < 2 || nameLen > 64) continue;
    entries.push({
      name: dirBuf.slice(i, i + nameLen - 2).toString("utf16le"),
      type: dirBuf.readUInt8(i + 66),
      start: dirBuf.readUInt32LE(i + 116),
      size: dirBuf.readUInt32LE(i + 120),
    });
  }
  const root = entries.find(e => e.type === 5);
  const miniFat = [];
  if (root && buf.readUInt32LE(60) !== 0xFFFFFFFE) {
    chain(buf.readUInt32LE(60)).forEach(s => {
      const off = sectorOff(s);
      for (let i = 0; i < sectorSize / 4; i++) miniFat.push(buf.readUInt32LE(off + i * 4));
    });
  }
  const miniStream = root ? readRegular(root.start, root.size) : Buffer.alloc(0);
  function readMini(start, size) {
    const parts = [];
    let s = start, g = 0;
    while (s < 0xFFFFFFFA && g++ < 1e6) {
      parts.push(miniStream.slice(s * miniSize, s * miniSize + miniSize));
      s = miniFat[s];
    }
    return Buffer.concat(parts).slice(0, size);
  }
  const streams = {};
  for (const e of entries) {
    if (e.type !== 2) continue;
    streams[e.name] = (e.size < miniCutoff) ? readMini(e.start, e.size)
                                            : readRegular(e.start, e.size);
  }
  return streams;
}

// ------------------------------------------------------------ record reader ---

function readRecords(data) {
  const out = [];
  let p = 0;
  while (p + 4 <= data.length) {
    const len = data.readUInt32LE(p);
    p += 4;
    if (len < 1 || p + len > data.length) { out.push({ trunc: true, props: {} }); break; }
    out.push({ props: parseProps(data.slice(p, p + len - 1)) }); // drop the NUL
    p += len;
  }
  return out;
}

// Property strings are raw ANSI bytes, not UTF-8: Chinese text is stored as
// GBK on a zh-CN system, and decoding the whole body as UTF-8 turns every such
// character into U+FFFD (the diamonds the user saw). So keep the bytes as
// latin1, split on the ASCII separators, then decode each VALUE on demand:
// a "%UTF8%Key" pair holds UTF-8 bytes, anything else with high bytes is GBK.
const GBK_DECODER = (() => {
  try { return new TextDecoder("gbk"); } catch (e) { return null; }
})();

function decodePropValue(key, latin1) {
  if (!/[\x80-\xFF]/.test(latin1)) return latin1;
  const buf = Buffer.from(latin1, "latin1");
  if (key.indexOf("%UTF8%") === 0) return buf.toString("utf8");
  return GBK_DECODER ? GBK_DECODER.decode(buf) : latin1;
}

function parseProps(body) {
  const s = body.toString("latin1");
  const props = {};
  for (const part of s.split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq);
    props[key] = decodePropValue(key, part.slice(eq + 1));
  }
  return props;
}

// Property keys arrive in mixed case ("Location.X", "Text", "OWNERINDEX", ...),
// so every lookup falls back to a case-insensitive scan after the exact ones.
// A key may also be stored twice - plain (ANSI/mojibake) and "%UTF8%Key" (real
// UTF-8) - and the UTF-8 copy wins.
function get(pr, k) {
  if (pr["%UTF8%" + k] !== undefined) return pr["%UTF8%" + k];
  if (pr[k] !== undefined) return pr[k];
  const kl = k.toLowerCase();
  for (const key in pr) {
    if (key.length === k.length && key.toLowerCase() === kl) return pr[key];
  }
  return undefined;
}
function text(props, keys) {
  for (const k of keys) { const v = get(props, k); if (v !== undefined) return v; }
  return "";
}
function num(props, keys, def) {
  const s = text(props, keys);
  if (s === "") return def;
  const n = parseFloat(s);
  return isNaN(n) ? def : n;
}
function has(props, keys) {
  return keys.some(k => get(props, k) !== undefined);
}

// --------------------------------------------------------------- SchDoc model ---

function flatPoints(props, count) {
  const pts = [];
  for (let i = 1; i <= count; i++) {
    const x = num(props, ["X" + i], null);
    const y = num(props, ["Y" + i], null);
    if (x === null || y === null) break;
    pts.push(x, y);
  }
  return pts;
}

function polyRecord(props, tag2) {
  const n = num(props, ["LOCATIONCOUNT"], 0);
  const pts = flatPoints(props, n);
  if (pts.length < 4) return null;
  // two points -> a plain line, three or more -> a polyline (same tuple either
  // way: tag, then a flat x,y list; the renderer treats them identically)
  return [pts.length === 4 ? "l" : "pl"].concat(pts);
}

function rectRecord(props) {
  const x = num(props, ["LOCATION.X"], null);
  const y = num(props, ["LOCATION.Y"], null);
  const cx = num(props, ["CORNER.X"], null);
  const cy = num(props, ["CORNER.Y"], null);
  if (x === null || y === null || cx === null || cy === null) return null;
  return ["r", x, y, cx - x, cy - y];
}

function arcRecord(props) {
  const x = num(props, ["LOCATION.X"], null);
  const y = num(props, ["LOCATION.Y"], null);
  const r = num(props, ["RADIUS"], 0);
  if (x === null || y === null || r <= 0) return null;
  const a1 = num(props, ["STARTANGLE"], 0);
  const a2 = num(props, ["ENDANGLE"], 0);
  // LineWidth rides along (trailing slot): the test-point ring is r2/lw3 -
  // nearly a solid dot in AD, a hairline without it (2026-09-24).
  const lw = num(props, ["LINEWIDTH"], 0);
  if (Math.abs(a2 - a1) >= 360) {
    // full circle: an SVG arc with identical endpoints draws nothing, so emit
    // it as the ellipse the renderer can draw
    return ["e", x, y, r, r, lw];
  }
  return ["a", x, y, Math.round(r), Math.round(a1), Math.round(a2), lw];
}

function ellipseRecord(props) {
  const x = num(props, ["LOCATION.X"], null);
  const y = num(props, ["LOCATION.Y"], null);
  const rx = num(props, ["RADIUS"], 0);
  if (x === null || y === null || rx <= 0) return null;
  // AD never defaults a missing SecondaryRadius to the X radius: the ellipse
  // prints flat (ry=0) and therefore invisible. The test-point symbol's
  // radius-19 halo (Radius=19, no SecondaryRadius - 6 of them on this sheet)
  // is exactly that: Altium's own PDF print has no trace of it, while the old
  // ry=rx fallback invented big phantom circles the AD page never showed
  // (2026-09-24 fix). Skip instead of inventing.
  const ry = num(props, ["SECONDARYRADIUS"], 0);
  if (ry <= 0) return null;
  return ["e", x, y, Math.round(rx), Math.round(ry), num(props, ["LINEWIDTH"], 0)];
}

// ------------------------------------------------------------------ converter ---

function primBox(p, box) {
  const t = p[0];
  const pt = (x, y) => {
    if (x < box[0]) box[0] = x;
    if (x > box[2]) box[2] = x;
    if (y < box[1]) box[1] = y;
    if (y > box[3]) box[3] = y;
  };
  if (t === "l") { pt(p[1], p[2]); pt(p[3], p[4]); }
  else if (t === "r" || t === "s") { pt(p[1], p[2]); pt(p[1] + p[3], p[2] + p[4]); }
  else if (t === "a") { pt(p[1] - p[3], p[2] - p[3]); pt(p[1] + p[3], p[2] + p[3]); }
  else if (t === "e") { pt(p[1] - p[3], p[2] - p[4]); pt(p[1] + p[3], p[2] + p[4]); }
  else if (t === "t") { pt(p[1], p[2]); pt(p[1] + p[3] * 0.6 * String(p[4]).length, p[2] + p[3]); }
  else { for (let i = 1; i + 1 < p.length; i += 2) pt(p[i], p[i + 1]); }
}

function parseSchDoc(file) {
  const streams = cfbRead(fs.readFileSync(file));
  const fh = streams["FileHeader"];
  if (!fh) throw new Error("no FileHeader stream in " + file);
  const recs = readRecords(fh);

  const diag = [];
  const counts = {};
  const sh = {
    name: path.basename(file).replace(/\.[Ss]ch[Dd]oc$/, ""),
    w: 0, h: 0,
    comps: [], gfx: [], nets: [], ports: [], pwr: [], texts: [], junct: [],
  };
  const fontSizes = {};
  const byOwner = {}; // owner file-index -> comp
  const templateOwners = {}; // RECORD=39 headers: children are title-block art
  let unnamed = 0, skippedImage = 0;

  // pass 1: sheet props + font table + components
  for (let i = 0; i < recs.length; i++) {
    const pr = recs[i].props;
    const t = parseInt(pr["RECORD"], 10);
    if (isNaN(t)) continue;
    counts[t] = (counts[t] || 0) + 1;
    if (t === 31) {
      sh.w = num(pr, ["CUSTOMX"], 0);
      sh.h = num(pr, ["CUSTOMY"], 0);
      for (let f = 1; f <= 32; f++) {
        const sz = num(pr, ["SIZE" + f], 0);
        if (sz > 0) fontSizes[f] = sz; // FONTID is 1-based (FontIdCount=9, IDs seen 1..9)
      }
    } else if (t === 39) {
      // RECORD=39: the sheet template (A4.SchDot et al). Its children - the
      // title-block table lines, "=title" placeholder texts and the logo
      // image - follow the same OwnerIndex = headerIndex-1 convention as
      // component children. AD marks the record IsNotAccesible and never
      // plots it as circuit content; neither do we.
      templateOwners[i - 1] = true;
    } else if (t === 1) {
      const comp = {
        ref: "", val: "", fp: "",
        x: num(pr, ["LOCATION.X"], 0),
        y: num(pr, ["LOCATION.Y"], 0),
        rot: num(pr, ["ORIENTATION"], 0) * 90,
        box: null, prim: [],
      };
      byOwner[i - 1] = comp; // children link by OWNERINDEX; the header record is not counted
      sh.comps.push(comp);
    }
  }

  const fontOf = pr => {
    const id = num(pr, ["FONTID"], -1);
    return fontSizes[id] !== undefined ? fontSizes[id] : 10;
  };
  // pass 2: everything else, routed to its owner or to the sheet
  for (let i = 0; i < recs.length; i++) {
    const pr = recs[i].props;
    const t = parseInt(pr["RECORD"], 10);
    if (isNaN(t)) continue;
    const owned = get(pr, "OWNERINDEX") !== undefined;
    if (owned && templateOwners[parseInt(get(pr, "OWNERINDEX"), 10)]) {
      continue; // title-block art: table lines, placeholder texts, logo image
    }
    const owner = owned ? byOwner[parseInt(get(pr, "OWNERINDEX"), 10)] : null;
    const primOut = owner ? owner.prim : sh.gfx;

    if (t === 2) { // pin
      if (!owner) continue;
      // Location is the electrical end (wires land on it); the pin extends
      // PinLength in the direction given by the two low bits, degrees CCW.
      // PinConglomerate bit 3 = pin name visible, bit 4 = pin number visible
      // (sample: R/C 32-35 both hidden, TP 40-42 name-only, diode/transistor
      // 48-51 number-only, ICs 56-62 both shown; matches the original sheet).
      const cong = num(pr, ["PINCONGLOMERATE"], 0);
      // Per-pin custom text fonts (Altium NAME_CUSTOMFONTID etc.) resolved
      // through the sheet font table; 0 = not customized - the renderer then
      // keeps its length-based guess. MCU-style libraries deliberately shrink
      // long pin names this way.
      const pinFont = key => {
        const id = num(pr, [key], 0);
        return id > 0 && fontSizes[id] !== undefined ? fontSizes[id] : 0;
      };
      owner.prim.push(["p", num(pr, ["LOCATION.X"], 0), num(pr, ["LOCATION.Y"], 0),
        num(pr, ["PINLENGTH"], 0), (cong & 3) * 90,
        text(pr, ["DESIGNATOR"]), text(pr, ["NAME"]),
        (cong & 0x10) ? 1 : 0, (cong & 0x08) ? 1 : 0,
        pinFont("NAME_CUSTOMFONTID"), pinFont("DESIGNATOR_CUSTOMFONTID")]);
    } else if (t === 34) { // designator
      if (!owner) continue;
      owner.ref = text(pr, ["TEXT"]);
      // Altium auto-places designators; when the record carries its own
      // position, use it so the label sits exactly where the original does.
      // (The renderer skips its own label when a prim already spells the ref.)
      if (has(pr, ["LOCATION.X"])) {
        owner.prim.push(["t", num(pr, ["LOCATION.X"], 0), num(pr, ["LOCATION.Y"], 0),
          fontOf(pr), text(pr, ["TEXT"]), "d"]); // d = designator, draggable
      }
    } else if (t === 41) { // parameter
      const nm = text(pr, ["NAME"]);
      const hidden = text(pr, ["ISHIDDEN"]) === "T";
      if (owner) {
        if (nm === "Comment" || nm === "Value") owner.val = text(pr, ["TEXT"]);
        // Comments/params that Altium placed explicitly draw at that spot;
        // hidden ones stay out of the picture.
        if (!hidden && has(pr, ["LOCATION.X"])) {
          owner.prim.push(["t", num(pr, ["LOCATION.X"], 0), num(pr, ["LOCATION.Y"], 0),
            fontOf(pr), text(pr, ["TEXT"]), "p"]); // p = parameter, draggable
        }
      }
      // sheet-level parameters (CurrentTime, ...) are metadata: skip
    } else if (t === 45) { // footprint model
      if (owner && text(pr, ["MODELTYPE"]) === "PCBLIB") {
        const fp = text(pr, ["MODELNAME"]) || text(pr, ["MODELDATAFILEENTITY0"]);
        if (fp && !owner.fp) owner.fp = fp;
      }
    } else if (t === 27 || t === 16 || t === 15) { // wire / bus
      const rec = polyRecord(pr);
      if (rec) primOut.push(rec);
    } else if (t === 13) { // two-point line: component-symbol graphics (the
      // 116 straight strokes inside transistors/MOSFETs/ics). Keys are the
      // mixed-case Location.X/Corner.X pair; get() handles the casing.
      const x1 = num(pr, ["LOCATION.X"], null);
      const y1 = num(pr, ["LOCATION.Y"], null);
      const x2 = num(pr, ["CORNER.X"], null);
      const y2 = num(pr, ["CORNER.Y"], null);
      if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
        primOut.push(["l", x1, y1, x2, y2]);
      }
    } else if (t === 6) { // polyline drawing
      const rec = polyRecord(pr);
      if (rec) primOut.push(rec);
    } else if (t === 7) { // polygon
      const n = num(pr, ["LOCATIONCOUNT"], 0);
      const pts = flatPoints(pr, n);
      if (pts.length >= 6) primOut.push(["pg"].concat(pts));
    } else if (t === 14) { // rectangle
      const rec = rectRecord(pr);
      if (rec) primOut.push(rec);
    } else if (t === 12) { // arc / circle
      const rec = arcRecord(pr);
      if (rec) primOut.push(rec);
    } else if (t === 8) { // ellipse - or, in other file versions, a port
      if (has(pr, ["RADIUS"])) {
        const rec = ellipseRecord(pr);
        if (rec) primOut.push(rec);
      } else if (!owned) {
        const s = text(pr, ["NAME"]) || text(pr, ["TEXT"]);
        if (s) sh.ports.push({ s: s, x: num(pr, ["LOCATION.X"], 0),
          y: num(pr, ["LOCATION.Y"], 0), r: num(pr, ["ORIENTATION"], 0) * 90,
          st: num(pr, ["STYLE"], 0) });
      }
    } else if (t === 4 || t === 17 || t === 18 || t === 25) {
      const s = text(pr, ["TEXT"]);
      if (s === "") continue;
      const x = num(pr, ["LOCATION.X"], null);
      const y = num(pr, ["LOCATION.Y"], null);
      if (x === null || y === null) continue;
      if (t === 25 || t === 18) { // net label
        if (owner) owner.prim.push(["t", x, y, fontOf(pr), s]);
        else sh.nets.push({ s: s, x: x, y: y, r: num(pr, ["ORIENTATION"], 0) * 90,
          z: fontOf(pr) });
      } else if (t === 17) { // power port
        if (owner) owner.prim.push(["t", x, y, fontOf(pr), s]);
        else sh.pwr.push({ s: s, x: x, y: y, r: num(pr, ["ORIENTATION"], 0) * 90,
          st: num(pr, ["STYLE"], 0), z: fontOf(pr) });
      } else { // free text
        (owner ? owner.prim : sh.texts).push(["t", x, y, fontOf(pr), s]);
      }
    } else if (t === 23 || t === 29) { // junction
      if (!owned) {
        sh.junct.push([num(pr, ["LOCATION.X"], 0), num(pr, ["LOCATION.Y"], 0), 4]);
      }
    } else if (t === 11) { // sheet symbol
      if (!owned) {
        let w = num(pr, ["XSIZE"], num(pr, ["CORNER.X"], 0) - num(pr, ["LOCATION.X"], 0));
        let h = num(pr, ["YSIZE"], num(pr, ["CORNER.Y"], 0) - num(pr, ["LOCATION.Y"], 0));
        if (w <= 0) w = 100;
        if (h <= 0) h = 60;
        sh.gfx.push(["s", num(pr, ["LOCATION.X"], 0), num(pr, ["LOCATION.Y"], 0), w, h,
          text(pr, ["SHEETNAME", "NAME"]), text(pr, ["FILENAME"])]);
      }
    } else if (t === 30) { // embedded image - nothing to draw it with yet
      skippedImage++;
    }
    // 44/46/48 (model containers/params), 10/13/19/21/22/24/33/39: no drawn
    // geometry needed from them today.
  }

  // finish components: value fallback, bounding box
  for (const comp of sh.comps) {
    if (!comp.val) comp.val = "";
    if (comp.ref === "") unnamed++;
    let box = [Infinity, Infinity, -Infinity, -Infinity];
    box[0] = Math.min(box[0], comp.x); box[1] = Math.min(box[1], comp.y);
    box[2] = Math.max(box[2], comp.x); box[3] = Math.max(box[3], comp.y);
    for (const p of comp.prim) primBox(p, box);
    comp.box = (box[0] <= box[2] && box[1] <= box[3]) ? box.map(Math.round) : null;
  }

  diag.push("records=" + recs.length +
    " comps=" + sh.comps.length + " pins=" + counts[2] +
    " wires=" + counts[27] + " netlabels=" + counts[25] + " powerports=" + counts[17]);
  if (unnamed) diag.push("components without a designator: " + unnamed);
  if (skippedImage) diag.push("embedded images skipped: " + skippedImage);
  const unmapped = Object.keys(counts)
    .filter(t => ["1","2","4","6","7","8","11","12","13","14","15","16","17","18","23","25",
                  "27","29","30","31","34","39","41","44","45","46","48"].indexOf(t) < 0);
  if (unmapped.length) diag.push("record types left unread: " + unmapped.join(","));

  return { units: UNITS, diag: diag, sheets: [sh] };
}

// ------------------------------------------------------------- page assembly ---

function schemSlot(html, slot, payload) {
  const re = new RegExp(slot, "g");
  return html.replace(re, function () { return payload; });
}

function jsonForScript(s) {
  return String(s)
    .replace(/</g, function () { return "\\u003c"; })
    .replace(/>/g, function () { return "\\u003e"; })
    .replace(/&/g, function () { return "\\u0026"; })
    .replace(/\u2028/g, function () { return "\\u2028"; })
    .replace(/\u2029/g, function () { return "\\u2029"; });
}

function buildPage(pcbdata, title) {
  const web = path.join(ROOT, "web");
  let html = fs.readFileSync(path.join(web, "schem_standalone.html"), "utf8");
  const payload = jsonForScript(JSON.stringify(pcbdata));
  html = schemSlot(html, "///SCHEMCSS///", fs.readFileSync(path.join(web, "schem_standalone.css"), "utf8"));
  html = schemSlot(html, "///SCHEMJS///", fs.readFileSync(path.join(web, "schem.js"), "utf8"));
  html = schemSlot(html, "///STANDALONEJS///", fs.readFileSync(path.join(web, "schem_standalone.js"), "utf8"));
  html = schemSlot(html, "///PCBDATA///", payload);
  html = schemSlot(html, "///TITLE///", title);
  html = schemSlot(html, "///ADBUILD///", VERSION + " (offline)");
  return html;
}

// ----------------------------------------------------------------------- main ---

function main() {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const hit = args.find(a => a.startsWith("--" + name + "="));
    return hit ? hit.slice(name.length + 3) : def;
  };
  const inPath = opt("in", path.join(ROOT, "..", "SCH"));
  const outPath = opt("out", path.join(ROOT, "PnPout", "Schematic.html"));

  let files = [];
  if (fs.statSync(inPath).isDirectory()) {
    files = fs.readdirSync(inPath).filter(f => /\.schdoc$/i.test(f))
      .sort().map(f => path.join(inPath, f));
  } else {
    files = [inPath];
  }
  if (!files.length) { console.log("no .SchDoc under " + inPath); process.exit(1); }

  const data = { units: UNITS, diag: [], sheets: [] };
  for (const f of files) {
    const one = parseSchDoc(f);
    data.sheets.push.apply(data.sheets, one.sheets);
    data.diag.push.apply(data.diag, one.diag);
    console.log(path.basename(f) + ": " + one.diag.join("; "));
  }

  const pcbdata = {
    adbuild: VERSION + " (offline, no Altium)",
    schem: data,
  };
  const title = data.sheets.length === 1 ? data.sheets[0].name : path.basename(inPath);
  const html = buildPage(pcbdata, title);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf8");
  console.log("");
  console.log("sheets: " + data.sheets.length + ", components: " +
    data.sheets.reduce((n, s) => n + s.comps.length, 0));
  console.log("wrote : " + outPath + " (" + fs.statSync(outPath).size + " bytes)");
  if (process.env.SCHDOC_JSON) {
    fs.writeFileSync(process.env.SCHDOC_JSON, JSON.stringify(data), "utf8");
    console.log("json  : " + process.env.SCHDOC_JSON);
  }
}

module.exports = { parseSchDoc: parseSchDoc, buildPage: buildPage, readRecords: readRecords, parseProps: parseProps, cfbRead: cfbRead };
if (require.main === module) main();
