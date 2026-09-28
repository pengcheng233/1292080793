/* Schematic pane.
 *
 * Renders the project's schematic sheets as SVG underneath the BOM table, and
 * cross-probes them against the BOM and the board: picking a BOM row highlights
 * the matching schematic symbol (and pans to it), and picking a symbol
 * highlights that row and the footprint on the canvas.
 *
 * The page is a single offline file, so the sheet geometry arrives inside
 * pcbdata.schem (see ecad/AD10sch.js for the record layout). When there is no
 * schematic data at all this pane hides itself and the page looks exactly as it
 * did before - that is the common case for a board exported without a project.
 *
 * Coordinates: schematic space has Y pointing up, SVG has Y pointing down, so
 * every point is mirrored about the content bounding box while it is built.
 * Text is emitted right way up because its position is mirrored along with
 * everything else; only arc angles need their sign flipped.
 */

var schemData = null;
var schemSheets = [];     // [{name, svg, content: {x, y, w, h}, comps: {ref: node}}]
var schemCurrent = -1;
var schemRefIndex = {};   // ref -> [{sheet: i, node: <g>}]
var schemDrag = null;
var schemTextDrag = null;   // {index, node, x0, y0, ux, uy} while moving a label
var schemTextMoved = false; // suppress the comp pick right after a label drag
var schemNetHl = null;      // {svg, id} while a net is highlighted
var schemPickQuiet = false; // one-shot: the highlight event now in flight came
                            // from clicking the symbol itself, so the handler
                            // must not zoom the view onto the part
var schemPickedRef = null;  // last component picked by a click (toggle state)
var schemCurNet = -1;       // net id of the primitive currently being rendered
var schemReady = false;

function schemEsc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function schemNum(v, def) {
  var n = parseFloat(v);
  if (isNaN(n)) return def;
  return n;
}

// Per-primitive stroke width from the file (trailing tuple slot on "a"/"e").
// The stylesheet's default of 2 is a deliberate sheet-wide readability value,
// so only records that are *bolder* than that override it - a test-point ring
// drawn r2/lw3 must come out as AD's fat dot, while lw1 shapes keep the
// default instead of thinning out at fit zoom. Inline style beats the class.
function schemStrokeW(w) {
  w = schemNum(w, 0);
  if (w > 2) {
    return ' style="stroke-width:' + Math.round(w * 100) / 100 + '"';
  }
  return "";
}

/* -------------------------------------------------------------------------
 * Bounding boxes in schematic units.
 * ---------------------------------------------------------------------- */

function schemPrimBox(p, box) {
  var t = p[0];
  var i;
  if (t == "l") {
    schemBoxPoint(box, p[1], p[2]);
    schemBoxPoint(box, p[3], p[4]);
  } else if (t == "r" || t == "s") {
    schemBoxPoint(box, p[1], p[2]);
    schemBoxPoint(box, p[1] + p[3], p[2] + p[4]);
  } else if (t == "a") {
    schemBoxPoint(box, p[1] - p[3], p[2] - p[3]);
    schemBoxPoint(box, p[1] + p[3], p[2] + p[3]);
  } else if (t == "e") {
    schemBoxPoint(box, p[1] - p[3], p[2] - p[4]);
    schemBoxPoint(box, p[1] + p[3], p[2] + p[4]);
  } else if (t == "t") {
    schemBoxPoint(box, p[1], p[2]);
    schemBoxPoint(box, p[1] + p[3] * 0.6 * String(p[4]).length, p[2] + p[3]);
  } else if (t == "p") {
    // The pin runs from (x,y) at the body anchor OUT to the electrical end at
    // x + len*cos(rot), y + len*sin(rot) - the same geometry the renderer
    // draws. Rotation matters: without it left-side pins (rot 180) fall
    // outside the grab box while right-side ones get double-covered.
    var plen = schemNum(p[3], 0);
    var prot = schemNum(p[4], 0) * Math.PI / 180;
    schemBoxPoint(box, p[1], p[2]);
    schemBoxPoint(box,
      schemNum(p[1], 0) + plen * Math.cos(prot),
      schemNum(p[2], 0) + plen * Math.sin(prot));
  } else {
    // pl / pg / b : a flat list of x, y pairs
    for (i = 1; i + 1 < p.length; i += 2) {
      schemBoxPoint(box, p[i], p[i + 1]);
    }
  }
}

function schemBoxPoint(box, x, y) {
  x = schemNum(x, null);
  y = schemNum(y, null);
  if (x === null || y === null) return;
  if (x < box.x0) box.x0 = x;
  if (x > box.x1) box.x1 = x;
  if (y < box.y0) box.y0 = y;
  if (y > box.y1) box.y1 = y;
}

function schemEmptyBox() {
  return {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity};
}

function schemBoxIsEmpty(box) {
  return !(box.x0 <= box.x1 && box.y0 <= box.y1);
}

function schemSheetBox(sh) {
  var box = schemEmptyBox();
  var i, k;
  for (i = 0; i < sh.comps.length; i++) {
    var comp = sh.comps[i];
    if (comp && comp.box) {
      schemBoxPoint(box, comp.box[0], comp.box[1]);
      schemBoxPoint(box, comp.box[2], comp.box[3]);
    }
    schemBoxPoint(box, comp.x, comp.y);
    for (k = 0; k < comp.prim.length; k++) {
      schemPrimBox(comp.prim[k], box);
    }
  }
  for (i = 0; i < sh.gfx.length; i++) {
    schemPrimBox(sh.gfx[i], box);
  }
  var lists = [sh.nets, sh.ports, sh.pwr, sh.texts];
  for (i = 0; i < lists.length; i++) {
    for (k = 0; k < lists[i].length; k++) {
      var o = lists[i][k];
      schemBoxPoint(box, o.x, o.y);
      schemBoxPoint(box, o.x + 20 * String(o.s).length, o.y + 10);
    }
  }
  for (i = 0; i < sh.junct.length; i++) {
    schemBoxPoint(box, sh.junct[i][0], sh.junct[i][1]);
  }
  if (schemBoxIsEmpty(box)) {
    // Nothing readable: fall back to the declared sheet size so the pane is
    // still a pane rather than a collapsed nothing.
    var w = schemNum(sh.w, 0);
    var h = schemNum(sh.h, 0);
    if (w <= 0) w = 1000;
    if (h <= 0) h = 800;
    return {x0: 0, y0: 0, x1: w, y1: h};
  }
  return box;
}

/* -------------------------------------------------------------------------
 * Electrical nets.
 *
 * Wires ("l" segments and "pl" polylines) are conductors. Two wires join when
 * an ENDPOINT (any polyline vertex) of one lands on the other - plain
 * crossings without a shared point stay separate nets, exactly like Altium.
 * Pins, net labels, ports, power ports and junction dots join whichever wire
 * they land on. Tolerance is 2 units so the 1-grid-unit gaps between pin tips
 * and wire ends that real files contain still count as connected.
 * ---------------------------------------------------------------------- */

function schemBuildNets(sh) {
  var TOL = 2;
  var segs = [];
  var gfxSeg = [];
  var i, j, k;
  for (i = 0; i < sh.gfx.length; i++) {
    var g = sh.gfx[i];
    if (g[0] == "l") {
      gfxSeg.push(segs.length);
      segs.push([g[1], g[2], g[3], g[4]]);
    } else if (g[0] == "pl") {
      gfxSeg.push(segs.length);
      segs.push(g.slice(1));
    } else {
      gfxSeg.push(-1);
    }
  }
  var n = segs.length;
  var par = [];
  for (i = 0; i < n; i++) par.push(i);
  function find(a) {
    while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; }
    return a;
  }
  function uni(a, b) {
    a = find(a); b = find(b);
    if (a !== b) par[b] = a;
  }
  function segDist(px, py, s) {
    var best = 1e9;
    // kk, not k: the callers iterate k, and segDist runs mid-loop - sharing
    // the variable made the caller restart forever on multi-segment wires.
    for (var kk = 0; kk + 3 < s.length; kk += 2) {
      var x1 = s[kk], y1 = s[kk + 1], x2 = s[kk + 2], y2 = s[kk + 3];
      var dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      var t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var qx = px - (x1 + t * dx), qy = py - (y1 + t * dy);
      var d = Math.sqrt(qx * qx + qy * qy);
      if (d < best) best = d;
    }
    return best;
  }
  for (i = 0; i < n; i++) {
    for (j = i + 1; j < n; j++) {
      var a = segs[i], b = segs[j], hit = false;
      for (k = 0; k + 1 < a.length && !hit; k += 2) {
        if (segDist(a[k], a[k + 1], b) <= TOL) hit = true;
      }
      for (k = 0; k + 1 < b.length && !hit; k += 2) {
        if (segDist(b[k], b[k + 1], a) <= TOL) hit = true;
      }
      if (hit) uni(i, j);
    }
  }
  // Extra electrical points each become a node, then merge with the wire
  // they land on (if any). Returns the raw node id.
  var extraPts = []; // {node, x, y} - labels, pins, ports, power, junctions
  function attach(x, y) {
    var node = par.length;
    par.push(node);
    for (var s = 0; s < n; s++) {
      if (segDist(x, y, segs[s]) <= TOL) { uni(node, s); break; }
    }
    // Points also join each other directly: a net label often sits straight
    // on a pin tip with no wire between them, and the two must land on one
    // net or clicking the label would light up nothing but itself.
    for (var e2 = 0; e2 < extraPts.length; e2++) {
      var pdx = x - extraPts[e2].x, pdy = y - extraPts[e2].y;
      if (pdx * pdx + pdy * pdy <= TOL * TOL) uni(node, extraPts[e2].node);
    }
    extraPts.push({node: node, x: x, y: y});
    return node;
  }

  var junctNode = [], netsNode = [], portsNode = [], pwrNode = [], pinNode = [];
  for (i = 0; i < sh.junct.length; i++) {
    junctNode.push(attach(sh.junct[i][0], sh.junct[i][1]));
  }
  for (i = 0; i < sh.nets.length; i++) {
    netsNode.push(attach(sh.nets[i].x, sh.nets[i].y));
  }
  for (i = 0; i < sh.ports.length; i++) {
    portsNode.push(attach(sh.ports[i].x, sh.ports[i].y));
  }
  for (i = 0; i < sh.pwr.length; i++) {
    pwrNode.push(attach(sh.pwr[i].x, sh.pwr[i].y));
  }
  for (i = 0; i < sh.comps.length; i++) {
    var comp = sh.comps[i], arr = [];
    for (j = 0; j < comp.prim.length; j++) {
      var p = comp.prim[j];
      if (p[0] !== "p") { arr.push(-1); continue; }
      var rot = schemNum(p[4], 0) * Math.PI / 180;
      arr.push(attach(schemNum(p[1], 0) + schemNum(p[3], 0) * Math.cos(rot),
        schemNum(p[2], 0) + schemNum(p[3], 0) * Math.sin(rot)));
    }
    pinNode.push(arr);
  }
  // Same-name net labels, ports and power ports are ONE net even when no
  // wire joins them - Altium's global net-name semantics. A sheet with two
  // "VCC" labels on separate stubs must light both up, and the loose CHRG
  // label across the sheet belongs with the wired CHRG net.
  var byName = {};
  function nameUnion(list, nodes) {
    for (var i2 = 0; i2 < list.length; i2++) {
      var s = list[i2] && list[i2].s;
      if (!s) continue;
      if (Object.prototype.hasOwnProperty.call(byName, s)) {
        uni(byName[s], nodes[i2]);
      } else {
        byName[s] = nodes[i2];
      }
    }
  }
  nameUnion(sh.nets, netsNode);
  nameUnion(sh.ports, portsNode);
  nameUnion(sh.pwr, pwrNode);
  // Compact union-find roots into dense net ids.
  var ids = {}, next = 0;
  function nid(node) {
    if (node < 0) return -1;
    var r = find(node);
    if (!Object.prototype.hasOwnProperty.call(ids, r)) ids[r] = next++;
    return ids[r];
  }
  var wireNet = [];
  for (i = 0; i < sh.gfx.length; i++) {
    wireNet.push(gfxSeg[i] >= 0 ? nid(gfxSeg[i]) : -1);
  }
  var junctNet = [], netsNet = [], portsNet = [], pwrNet = [];
  for (i = 0; i < junctNode.length; i++) junctNet.push(nid(junctNode[i]));
  for (i = 0; i < netsNode.length; i++) netsNet.push(nid(netsNode[i]));
  for (i = 0; i < portsNode.length; i++) portsNet.push(nid(portsNode[i]));
  for (i = 0; i < pwrNode.length; i++) pwrNet.push(nid(pwrNode[i]));
  var pinNet = [];
  for (i = 0; i < pinNode.length; i++) {
    var row = [];
    for (j = 0; j < pinNode[i].length; j++) row.push(nid(pinNode[i][j]));
    pinNet.push(row);
  }
  // Net id -> name, taken from the labelled members (net label, port, power
  // port). This is what matches the board side: pcbdata.nets carries the same
  // names, so a schematic net and a PCB net cross-probe by name.
  var netNames = [];
  function nameId(list, ids) {
    for (var q = 0; q < list.length; q++) {
      var s2 = list[q] && list[q].s;
      var idv = schemNum(ids[q], -1);
      if (s2 && idv >= 0 && !netNames[idv]) netNames[idv] = s2;
    }
  }
  nameId(sh.nets, netsNet);
  nameId(sh.ports, portsNet);
  nameId(sh.pwr, pwrNet);
  // Unnamed nets still cross-probe: Altium's board side auto-names them
  // Net<REF>_<PIN> after one of their pins, so every pin on an unnamed
  // schematic net contributes that spelling as an alternative name. The
  // board net may be named after ANY of the pins it holds - a two-pin
  // resistor net matches either NetR8_1 or NetU1_5.
  var netAlts = [];
  for (i = 0; i < sh.comps.length; i++) {
    var cref = sh.comps[i].ref;
    var prims = sh.comps[i].prim;
    for (j = 0; j < prims.length; j++) {
      if (prims[j][0] !== "p") continue;
      var pid = schemNum(pinNet[i][j], -1);
      if (pid < 0 || netNames[pid]) continue;
      var pdes = String(prims[j][5] || "").replace(/\s+/g, "");
      if (!cref || !pdes) continue;
      var cand = "Net" + cref + "_" + pdes;
      if (!netAlts[pid]) netAlts[pid] = [];
      if (netAlts[pid].indexOf(cand) < 0) netAlts[pid].push(cand);
    }
  }
  return {wire: wireNet, junct: junctNet, nets: netsNet,
    ports: portsNet, pwr: pwrNet, pin: pinNet, names: netNames,
    alts: netAlts, count: next};
}

/* -------------------------------------------------------------------------
 * SVG building.
 * ---------------------------------------------------------------------- */

/* Browsers clamp font-size in local SVG coordinates (zh-CN builds default to
 * a 10-12px floor): small text blown up ~4x at fit-to-page zoom was the
 * "exported labels overlap" bug. Font size is therefore emitted
 * 1/SCHEM_TEXT_SCALE times larger and undone by a scale() transform, which
 * the clamp never sees - the visual size stays exactly the file's. */
var SCHEM_TEXT_SCALE = 0.1;

function schemTextOpen(cls, tx, ty, size, rot, extra) {
  var tr = "translate(" + tx + "," + ty + ")";
  if (rot) tr += " rotate(" + (-rot) + ")";
  tr += " scale(" + SCHEM_TEXT_SCALE + ")";
  return '<text class="' + cls + '" transform="' + tr + '" x="0" y="0"' +
    ' font-size="' + (size / SCHEM_TEXT_SCALE) + '"' + (extra || "") + ">";
}
function schemTextGetPos(node) {
  var m = (node.getAttribute("transform") || "")
    .match(/translate\(([-\d.eE]+)[, ]([-\d.eE]+)\)/);
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0];
}
function schemTextSetPos(node, tx, ty) {
  var tr = (node.getAttribute("transform") || "")
    .replace(/translate\([^)]*\)/, "translate(" + tx + "," + ty + ")");
  node.setAttribute("transform", tr);
}

function schemPrimSvg(p, sx, sy) {
  var t = p[0];
  var i, pts, d;
  if (t == "l") {
    var net = schemCurNet >= 0 ? ' data-net="' + schemCurNet + '"' : "";
    return '<line class="sch-line"' + net + ' x1="' + sx(p[1]) + '" y1="' + sy(p[2]) +
      '" x2="' + sx(p[3]) + '" y2="' + sy(p[4]) + '"/>';
  }
  if (t == "r" || t == "s") {
    var cls = t == "s" ? "sch-sheetsym" : "sch-rect";
    var out = '<rect class="' + cls + '" x="' + sx(p[1]) + '" y="' +
      sy(p[2] + p[4]) + '" width="' + Math.abs(p[3]) + '" height="' +
      Math.abs(p[4]) + '"/>';
    if (t == "s") {
      var label = p[5] || p[6] || "";
      if (label) {
        out += schemTextOpen("sch-sheetsym-text", sx(p[1] + 2),
            sy(p[2] + p[4] - 2), Math.max(8, Math.abs(p[4]) * 0.12), 0, "") +
          schemEsc(label) + "</text>";
      }
    }
    return out;
  }
  if (t == "a") {
    var a1 = schemNum(p[4], 0) * Math.PI / 180;
    var a2 = schemNum(p[5], 0) * Math.PI / 180;
    var r = Math.abs(p[3]);
    var cx = sx(p[1]);
    var cy = sy(p[2]);
    // Y is mirrored, so the sweep direction flips with it.
    var x1 = cx + r * Math.cos(a1);
    var y1 = cy - r * Math.sin(a1);
    var x2 = cx + r * Math.cos(a2);
    var y2 = cy - r * Math.sin(a2);
    if (Math.abs(a2 - a1) < 0.001) {
      d = "M " + (cx - r) + " " + cy + " a " + r + " " + r + " 0 1 0 " +
        (2 * r) + " 0 a " + r + " " + r + " 0 1 0 " + (-2 * r) + " 0";
      return '<path class="sch-arc" d="' + d + '"' + schemStrokeW(p[6]) + "/>";
    }
    var da = a2 - a1;
    if (da < 0) da += 2 * Math.PI;
    var large = da > Math.PI ? 1 : 0;
    var sweep = 0;
    d = "M " + x1 + " " + y1 + " A " + r + " " + r + " 0 " + large + " " +
      sweep + " " + x2 + " " + y2;
    return '<path class="sch-arc" d="' + d + '"' + schemStrokeW(p[6]) + "/>";
  }
  if (t == "e") {
    return '<ellipse class="sch-ellipse" cx="' + sx(p[1]) + '" cy="' +
      sy(p[2]) + '" rx="' + Math.abs(p[3]) + '" ry="' + Math.abs(p[4]) + '"' +
      schemStrokeW(p[5]) + "/>";
  }
  if (t == "t") {
    // Designators ("d") and parameters ("p") carry a drag handle: they are
    // labels, not part of the symbol, and the user may reposition them.
    var lblScale = 1;
    var mv = "";
    if (p.length > 5 && (p[5] == "d" || p[5] == "p")) {
      // Designators and parameters also read 30% smaller than the file's
      // point size (user preference, matches the net-name shrink).
      lblScale = 0.7;
      mv = ' data-mv="1" data-kind="' + p[5] + '" data-txt="' +
        schemEsc(p[4]) + '"';
    }
    var tx = sx(p[1]), ty = sy(p[2]);
    if (mv) mv += ' data-ox="' + tx + '" data-oy="' + ty + '"';
    return schemTextOpen("sch-text", tx, ty,
        Math.max(3, Math.abs(p[3]) * lblScale), 0, mv) +
      schemEsc(p[4]) + "</text>";
  }
  if (t == "p") {
    var px = schemNum(p[1], 0);
    var py = schemNum(p[2], 0);
    var len = schemNum(p[3], 0);
    var rot = schemNum(p[4], 0) * Math.PI / 180;
    // The pin runs from the body anchor (Location) OUT to the electrical end
    // at Location + len*dir - the connectivity test proved the far end is
    // what lands on wires. Y is mirrored; rot reads as -rot on screen.
    var dx = Math.cos(rot), dy = Math.sin(rot);
    var ex = px + len * dx;
    var ey = py + len * dy;
    var pnet = schemCurNet >= 0 ? ' data-net="' + schemCurNet + '"' : "";
    var out2 = '<line class="sch-pin"' + pnet + ' x1="' + sx(px) + '" y1="' + sy(py) +
      '" x2="' + sx(ex) + '" y2="' + sy(ey) + '"/>';
    var numS = p.length > 5 && p[5] !== undefined ? String(p[5]) : "";
    var nameS = p.length > 6 && p[6] !== undefined ? String(p[6]) : "";
    // Visibility flags (offline converter, prim slots 7/8: number/name).
    // Absent = visible, so AD-side prims without flags keep drawing both.
    var numVis = !(p.length > 7 && p[7] === 0);
    var nameVis = !(p.length > 8 && p[8] === 0);
    if ((numS && numVis) || (nameS && nameVis)) {
      var fsz = Math.min(8, Math.max(5, Math.abs(len) * 0.45));
      // Per-pin custom fonts (offline converter slots 9/10, from
      // Name_CustomFontID / Designator_CustomFontID via the sheet font
      // table) beat the length guess - MCU libraries shrink long pin
      // names this way, and ignoring it stacks them into each other.
      var nameFsz = p.length > 9 && p[9] > 0 ? p[9] : fsz;
      var numFsz = p.length > 10 && p[10] > 0 ? p[10] : fsz;
      var off = numFsz * 0.3 + 0.6;
      var mx = px + len * 0.5 * dx, my = py + len * 0.5 * dy;
      function pinText(x, y, s, anchor, tsz, trot) {
        return schemTextOpen("sch-pin-num", sx(x), sy(y), tsz, trot || 0,
            ' text-anchor="' + anchor + '"') +
          schemEsc(s) + "</text>";
      }
      if (Math.abs(dy) > 0.7) {
        // Vertical pin: like Altium, the name reads bottom-up (rotated 90)
        // just inside the body beside the line. Horizontal names are wider
        // than the 20-unit pin pitch and stack into the neighbours.
        if (nameS && nameVis) {
          if (dy > 0) { // points up: body is below the anchor edge, text hangs in
            out2 += pinText(px + nameFsz * 0.35 + 0.6, py - 0.6, nameS,
              "end", nameFsz, 90);
          } else {      // points down: body is above the anchor edge
            out2 += pinText(px + nameFsz * 0.35 + 0.6, py + 0.6, nameS,
              "start", nameFsz, 90);
          }
        }
        if (numS && numVis) out2 += pinText(mx + off, my, numS,
          "middle", numFsz, 90);
      } else {
        // horizontal pin: number above the line midpoint, name inside the body
        if (numS && numVis) out2 += pinText(mx, my + off, numS, "middle", numFsz);
        if (nameS && nameVis) out2 += pinText(px - dx * 1.5,
          py + nameFsz * 0.3 + 0.6, nameS, dx > 0 ? "end" : "start", nameFsz);
      }
    }
    return out2;
  }
  // pl / pg / b
  pts = [];
  for (i = 1; i + 1 < p.length; i += 2) {
    pts.push(sx(p[i]) + "," + sy(p[i + 1]));
  }
  if (pts.length < 2) return "";
  var plnet = schemCurNet >= 0 ? ' data-net="' + schemCurNet + '"' : "";
  if (t == "pg") {
    return '<polygon class="sch-poly"' + plnet + ' points="' + pts.join(" ") + '"/>';
  }
  return '<polyline class="sch-poly"' + plnet + ' points="' + pts.join(" ") + '"/>';
}

function schemBuildSheet(index) {
  var sh = schemData.sheets[index];
  var box = schemSheetBox(sh);
  var x0 = box.x0;
  var y1 = box.y1;
  var sx = function(x) { return schemNum(x, 0) - x0; };
  var sy = function(y) { return y1 - schemNum(y, 0); };
  var pad = Math.max((box.x1 - box.x0), (box.y1 - box.y0)) * 0.02;
  if (pad <= 0) pad = 10;

  var content = {
    x: -pad,
    y: -pad,
    w: (box.x1 - box.x0) + 2 * pad,
    h: (box.y1 - box.y0) + 2 * pad
  };

  var parts = [];
  parts.push('<svg class="sch-svg" xmlns="http://www.w3.org/2000/svg" ' +
    'preserveAspectRatio="xMidYMid meet" viewBox="' +
    content.x + " " + content.y + " " + content.w + " " + content.h + '">');

  // Sheet area as a faint guide, when the reader managed to get it.
  if (schemNum(sh.w, 0) > 0 && schemNum(sh.h, 0) > 0) {
    parts.push('<rect class="sch-sheetbg" x="' + sx(0) + '" y="' + sy(sh.h) +
      '" width="' + sh.w + '" height="' + sh.h + '"/>');
  }

  var netmap = schemBuildNets(sh);

  var i, k;
  for (i = 0; i < sh.gfx.length; i++) {
    schemCurNet = schemNum(netmap.wire[i], -1);
    parts.push(schemPrimSvg(sh.gfx[i], sx, sy));
  }
  schemCurNet = -1;
  for (i = 0; i < sh.junct.length; i++) {
    var j = sh.junct[i];
    var jnet = schemNum(netmap.junct[i], -1);
    parts.push('<circle class="sch-junction"' +
      (jnet >= 0 ? ' data-net="' + jnet + '"' : "") +
      ' cx="' + sx(j[0]) + '" cy="' +
      sy(j[1]) + '" r="' + Math.max(1.5, schemNum(j[2], 4) / 2) + '"/>');
  }

  // Labels and ports are text objects; they get their own rotation so a net
  // label written up the side of the sheet stays readable.
  parts.push(schemTextSvg(sh.nets, sx, sy, "sch-netlabel", netmap.nets));
  parts.push(schemTextSvg(sh.ports, sx, sy, "sch-port", netmap.ports));
  parts.push(schemTextSvg(sh.texts, sx, sy, "sch-freetext"));

  // Power ports draw a real symbol (circle / earth / bar) with the net name
  // past its far end - text alone made them look like loose labels.
  for (i = 0; i < sh.pwr.length; i++) {
    parts.push(schemPowerSvg(sh.pwr[i], sx, sy, schemNum(netmap.pwr[i], -1)));
  }

  for (i = 0; i < sh.comps.length; i++) {
    parts.push(schemComponentSvg(sh.comps[i], sx, sy, netmap.pin[i]));
  }

  parts.push("</svg>");

  var holder = document.createElement("div");
  holder.className = "sch-holder";
  holder.style.display = index == schemCurrent ? "block" : "none";
  holder.innerHTML = parts.join("");

  var svg = holder.firstChild;
  var entry = {
    name: sh.name,
    holder: holder,
    svg: svg,
    content: content,
    netmap: netmap,
    comps: {},
    boxes: {}
  };

  schemApplyLabelOffsets(holder, sh.name);

  var nodes = holder.querySelectorAll("[data-ref]");
  for (i = 0; i < nodes.length; i++) {
    var ref = nodes[i].getAttribute("data-ref");
    entry.comps[ref] = nodes[i];
    entry.boxes[ref] = schemNodeBox(nodes[i]);
    if (!schemRefIndex[ref]) schemRefIndex[ref] = [];
    schemRefIndex[ref].push({sheet: index, node: nodes[i]});
  }

  schemAttachView(svg, index);
  schemSheets[index] = entry;
  return holder;
}

// Orientation semantics confirmed against the sample file: the stored angle is
// the standard math angle of the stub, 0 = +x, 90 = +y (up), 270 = down. The
// stub must point AWAY from the wire, which is how every power port in the
// sample lands (verified by a wire-proximity survey, see .workbuddy/schtest.js).
var SCHEM_PWR_DIRS = {"0": [1, 0], "90": [0, 1], "180": [-1, 0], "270": [0, -1]};

// Symbol styles seen in the wild: 2 = circle ("power"), 4 = power ground
// (stem + crossbar + three descending lines), 5 = signal ground (two lines),
// anything else falls back to a plain bar. Style 0/1 unknown -> bar too.
function schemPowerSvg(o, sx, sy, netId) {
  var st = schemNum(o.st, 0);
  var d = SCHEM_PWR_DIRS[String(schemNum(o.r, 0))] || [0, 1];
  var x = schemNum(o.x, 0);
  var y = schemNum(o.y, 0);
  var px = -d[1], py = d[0]; // perpendicular
  function ln(ax, ay, bx, by) {
    return '<line class="sch-power-sym" x1="' + sx(ax) + '" y1="' + sy(ay) +
      '" x2="' + sx(bx) + '" y2="' + sy(by) + '"/>';
  }
  var out = "";
  var tip = 6; // where the symbol body ends, past the connection point
  if (st == 2 || st == 3) {
    out += ln(x, y, x + d[0] * 3, y + d[1] * 3);
    out += '<circle class="sch-power-sym" cx="' + sx(x + d[0] * 6.5) +
      '" cy="' + sy(y + d[1] * 6.5) + '" r="3.5"/>';
    tip = 10.5;
  } else if (st == 4 || st == 5) {
    out += ln(x, y, x + d[0] * 6, y + d[1] * 6);
    var bx = x + d[0] * 6, by = y + d[1] * 6;
    out += ln(bx - px * 5, by - py * 5, bx + px * 5, by + py * 5);
    var n = st == 4 ? 3 : 2;
    for (var i = 1; i <= n; i++) {
      var fx = bx + d[0] * i * 2.4, fy = by + d[1] * i * 2.4;
      var hw = 5 - i * 1.4;
      out += ln(fx - px * hw, fy - py * hw, fx + px * hw, fy + py * hw);
    }
    tip = 6 + n * 2.4;
  } else {
    out += ln(x, y, x + d[0] * 6, y + d[1] * 6);
    out += ln(x + d[0] * 6 - px * 5, y + d[1] * 6 - py * 5,
              x + d[0] * 6 + px * 5, y + d[1] * 6 + py * 5);
    tip = 6;
  }
  // Net name past the far end of the symbol, like Altium places it. The base
  // line offset differs per direction so the text clears the last symbol line.
  if (o.s && o.s !== "") {
    var fsz0 = Math.max(4, schemNum(o.z, 8));
    var tx = x + d[0] * (tip + 2), ty = y + d[1] * (tip + 2);
    var anchor = Math.abs(d[1]) > 0.7 ? "middle" : (d[0] > 0 ? "start" : "end");
    var vy;
    if (Math.abs(d[1]) > 0.7) {
      vy = d[1] > 0 ? ty + fsz0 * 0.8 : ty - 1.5; // above / below the symbol
    } else {
      vy = ty + fsz0 * 0.35;
    }
    out += schemTextOpen("sch-power", sx(tx), sy(vy), fsz0, 0,
      ' text-anchor="' + anchor + '"') + schemEsc(o.s) + "</text>";
  }
  if (netId >= 0) {
    // One wrapper carries the net id, so clicking any part of the symbol
    // (lines or name) highlights the net.
    return '<g data-net="' + netId + '">' + out + "</g>";
  }
  return out;
}

function schemTextSvg(list, sx, sy, cls, ids) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var o = list[i];
    // Two item shapes share this helper: plain text arrays
    // ["t", x, y, size, s] (free texts, component primitives) and objects
    // {s, x, y, r, z} (net labels, ports).
    var tx, ty, s, rot, size;
    if (o && o.length) {
      tx = o[1]; ty = o[2]; size = o[3]; s = o[4]; rot = 0;
    } else {
      tx = o.x; ty = o.y; s = o.s; rot = schemNum(o.r, 0);
      size = Math.max(4, schemNum(o.z, 10));
      // Net names read smaller than the sheet default (user asked -30%).
      if (cls == "sch-netlabel" || cls == "sch-port") {
        size = Math.max(3, size * 0.7);
      }
    }
    if (s === undefined || s === "") continue;
    // Net names / ports sit ON a wire: the baseline lands on the conductor
    // and the stroke cuts through the glyphs. Lift the text along its own
    // "up" (perpendicular to the run, valid for rotated labels too).
    if (cls == "sch-netlabel" || cls == "sch-port") {
      var lift = size * 0.2 + 0.6; // just clear the 2-unit stroke, no more
      tx -= lift * Math.sin(rot * Math.PI / 180);
      ty += lift * Math.cos(rot * Math.PI / 180);
    }
    var net = ids && ids[i] >= 0 ? ' data-net="' + ids[i] + '"' : "";
    out.push(schemTextOpen(cls, sx(tx), sy(ty), size, rot, net) +
      schemEsc(s) + "</text>");
  }
  return out.join("");
}

function schemComponentSvg(comp, sx, sy, pinNets) {
  var box = schemEmptyBox();
  var i;
  // The grab/highlight box covers the symbol GRAPHICS only - designators and
  // parameters are separately movable labels and must not be boxed in.
  for (i = 0; i < comp.prim.length; i++) {
    if (comp.prim[i][0] == "t") continue;
    schemPrimBox(comp.prim[i], box);
  }
  if (schemBoxIsEmpty(box)) {
    schemBoxPoint(box, comp.x, comp.y);
    schemBoxPoint(box, comp.x + 60, comp.y + 40);
  }
  // A symbol sits inside its own box; pad it so a thin outline still has
  // something to grab.
  var gx = box.x0 - 2;
  var gy = box.y0 - 2;
  var gw = (box.x1 - box.x0) + 4;
  var gh = (box.y1 - box.y0) + 4;

  var parts = [];
  parts.push('<g class="sch-comp" data-ref="' + schemEsc(comp.ref) + '">');
  parts.push("<title>" + schemEsc(comp.ref +
    (comp.val ? "  " + comp.val : "")) + "</title>");
  parts.push('<rect class="sch-hit" x="' + sx(gx) + '" y="' + sy(gy + gh) +
    '" width="' + gw + '" height="' + gh + '"/>');
  for (i = 0; i < comp.prim.length; i++) {
    schemCurNet = pinNets ? schemNum(pinNets[i], -1) : -1;
    parts.push(schemPrimSvg(comp.prim[i], sx, sy));
  }
  schemCurNet = -1;
  // Only draw our own label when the sheet had no designator text of its own,
  // otherwise every symbol ends up with the reference twice.
  if (!schemHasDesignatorText(comp)) {
    parts.push(schemTextOpen("sch-ref", sx(box.x0), sy(box.y1 + 4),
        Math.max(8, gh * 0.16), 0, "") + schemEsc(comp.ref) + "</text>");
  }
  parts.push("</g>");
  return parts.join("");
}

function schemHasDesignatorText(comp) {
  for (var i = 0; i < comp.prim.length; i++) {
    if (comp.prim[i][0] == "t" && comp.prim[i][4] == comp.ref) {
      return true;
    }
  }
  return false;
}

function schemNodeBox(node) {
  var hit = node.querySelector(".sch-hit");
  if (!hit) return null;
  return {
    x: parseFloat(hit.getAttribute("x")),
    y: parseFloat(hit.getAttribute("y")),
    w: parseFloat(hit.getAttribute("width")),
    h: parseFloat(hit.getAttribute("height"))
  };
}

/* -------------------------------------------------------------------------
 * Pan and zoom.
 * ---------------------------------------------------------------------- */

function schemAttachView(svg, index) {
  var vb = {x: 0, y: 0, w: 0, h: 0};
  svg.__schemVb = vb;
  schemFit(index);

  svg.addEventListener("wheel", function(e) {
    e.preventDefault();
    var rect = svg.getBoundingClientRect();
    var px = e.clientX - rect.left;
    var py = e.clientY - rect.top;
    var factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    schemZoom(index, px, py, factor, rect);
  }, {passive: false});

  svg.addEventListener("mousedown", function(e) {
    if (e.button !== 0) return;
    // A designator/parameter label grabs its own drag, not the pan.
    var lab = e.target.closest ? e.target.closest("[data-mv]") : null;
    if (lab) {
      schemTextDrag = {
        index: index,
        node: lab,
        x: e.clientX,
        y: e.clientY,
        ux: parseFloat(lab.getAttribute("data-ox")),
        uy: parseFloat(lab.getAttribute("data-oy"))
      };
      return;
    }
    schemDrag = {
      index: index,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      vb: {x: vb.x, y: vb.y}
    };
  });

  svg.addEventListener("dblclick", function(e) {
    // Fit-to-sheet is a background gesture: double-clicking a net label or
    // component used to bubble up here and yank the user's zoom away.
    var tgt = e.target;
    if (tgt && tgt !== svg && tgt.closest &&
        (tgt.closest("[data-net]") || tgt.closest(".sch-comp"))) return;
    schemFit(index);
  });

  svg.addEventListener("click", function(e) {
    if (schemDrag && schemDrag.moved) return;
    if (schemTextMoved) { schemTextMoved = false; return; }
    // Clicking a wire, pin, net label, port or power symbol highlights the
    // whole electrical net; clicking again (or empty space) clears it.
    var t = e.target.closest ? e.target.closest("[data-net]") : null;
    if (t) {
      schemToggleNetHl(svg, t.getAttribute("data-net"));
      return;
    }
    schemClearNetHl();
    // Any non-net click also drops the board-side net highlight (the toggle
    // and the clear paths above report through the same channel).
    schemNotifyNet(null);
    var g = e.target.closest ? e.target.closest(".sch-comp") : null;
    // Clicking the picked part a second time, or clicking blank space, clears
    // the selection - in both page flavors. On the main ibom page the
    // selection lives on the BOM side too (currentHighlightedRowId), so the
    // shared clear routine drops the row highlight before the schematic's own.
    var solo = !(typeof refToHandler == "object" && refToHandler);
    if (!g) {
      if (!solo && typeof clearHighlightedFootprints == "function") {
        clearHighlightedFootprints();
      }
      schemHighlight(null);
      schemPickedRef = null;
      return;
    }
    var ref = g.getAttribute("data-ref");
    if (solo) {
      if (schemPickedRef === ref) {
        schemPickedRef = null;
        schemHighlight(null);
        return;
      }
      schemPickedRef = ref;
    }
    schemPick(ref);
  });
}

function schemClearNetHl() {
  if (!schemNetHl) return;
  var els = schemNetHl.svg.querySelectorAll("[data-net]");
  for (var i = 0; i < els.length; i++) {
    els[i].classList.remove("sch-net-hl");
  }
  schemNetHl = null;
}

function schemToggleNetHl(svg, id) {
  if (schemNetHl && schemNetHl.svg === svg && schemNetHl.id === id) {
    schemClearNetHl();
    schemNotifyNet(null);
    return;
  }
  schemClearNetHl();
  var els = svg.querySelectorAll("[data-net]");
  for (var i = 0; i < els.length; i++) {
    if (els[i].getAttribute("data-net") === id) {
      els[i].classList.add("sch-net-hl");
    }
  }
  schemNetHl = {svg: svg, id: id};
  // The board follows: same net name in pcbdata.nets lights tracks and pads.
  schemNotifyNet(schemNetNameOf(id));
}

/* ---- net cross-probe with the board -------------------------------------
 * A schematic net and a PCB net match by NAME (the schematic side reads it
 * from net labels / ports / power ports). The notify goes schem -> board
 * through crossHighlightNetByName (ibom.js, absent on the standalone page);
 * the board reports back by calling schemHighlightNetByName from netClicked.
 * Neither side routes through the other's click path, so no loop. ---------- */

function schemNotifyNet(name) {
  if (typeof crossHighlightNetByName == "function") {
    crossHighlightNetByName(name);
  }
}

function schemNetNameOf(id) {
  var entry = schemSheets[schemCurrent];
  if (!entry || !entry.netmap || !entry.netmap.names) return null;
  var n = entry.netmap.names[schemNum(id, -1)];
  if (n) return n;
  // Unnamed net: pick the auto-name spelling that actually exists on the
  // board, so the click side reports a net the PCB can light up.
  var alts = entry.netmap.alts && entry.netmap.alts[schemNum(id, -1)];
  if (alts && alts.length && typeof pcbdata != "undefined" &&
      pcbdata && pcbdata.nets) {
    for (var i = 0; i < alts.length; i++) {
      for (var j = 0; j < pcbdata.nets.length; j++) {
        if (pcbdata.nets[j] &&
            String(pcbdata.nets[j]).toLowerCase() ===
            String(alts[i]).toLowerCase()) {
          return pcbdata.nets[j];
        }
      }
    }
    return null;
  }
  return n || null;
}

/* Board -> schematic: light the named net's elements on the current sheet.
 * A null/unknown name clears the highlight. Deliberately NOT notifying the
 * board back - the board already knows what it clicked. */
function schemHighlightNetByName(name) {
  if (!schemReady) return;
  if (!name) { schemClearNetHl(); return; }
  var entry = schemSheets[schemCurrent];
  if (!entry || !entry.netmap || !entry.netmap.names) return;
  var names = entry.netmap.names;
  var alts = entry.netmap.alts || [];
  var lower = String(name).toLowerCase();
  var id = -1;
  for (var i = 0; i < names.length && id < 0; i++) {
    if (names[i] && String(names[i]).toLowerCase() == lower) { id = i; break; }
    if (alts[i]) {
      for (var j = 0; j < alts[i].length; j++) {
        if (String(alts[i][j]).toLowerCase() == lower) { id = i; break; }
      }
    }
  }
  if (id < 0) { schemClearNetHl(); return; }
  var sid = String(id);
  if (schemNetHl && schemNetHl.svg === entry.svg && schemNetHl.id === sid) return;
  schemClearNetHl();
  // A net selection replaces any component selection, mirroring the board
  // side where netClicked drops the footprint/BOM selection.
  schemHighlight(null);
  schemPickedRef = null;
  var els = entry.svg.querySelectorAll("[data-net]");
  for (i = 0; i < els.length; i++) {
    if (els[i].getAttribute("data-net") === sid) {
      els[i].classList.add("sch-net-hl");
    }
  }
  schemNetHl = {svg: entry.svg, id: sid};
}

document.addEventListener("mousemove", function(e) {
  if (schemTextDrag) {
    var tentry = schemSheets[schemTextDrag.index];
    if (!tentry) return;
    var trect = tentry.svg.getBoundingClientRect();
    if (trect.width <= 0) return;
    var tvb = tentry.svg.__schemVb;
    // preserveAspectRatio meet: one uniform scale, centered letterbox.
    var tsc = Math.min(trect.width / tvb.w, trect.height / tvb.h);
    // Text position lives in the transform's leading translate (screen-space
    // sx/sy applied at build time), so both axes track the mouse 1:1.
    var nx = schemTextDrag.ux + (e.clientX - schemTextDrag.x) / tsc;
    var ny = schemTextDrag.uy + (e.clientY - schemTextDrag.y) / tsc;
    schemTextSetPos(schemTextDrag.node, nx, ny);
    schemTextMoved = true;
    return;
  }
  if (!schemDrag) return;
  var entry = schemSheets[schemDrag.index];
  if (!entry) return;
  var rect = entry.svg.getBoundingClientRect();
  if (rect.width <= 0) return;
  var dx = e.clientX - schemDrag.x;
  var dy = e.clientY - schemDrag.y;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) schemDrag.moved = true;
  var vb = entry.svg.__schemVb;
  var scale = vb.w / rect.width;
  vb.x = schemDrag.vb.x - dx * scale;
  vb.y = schemDrag.vb.y - dy * scale;
  schemApplyViewBox(schemDrag.index);
});

document.addEventListener("mouseup", function() {
  if (schemTextDrag) {
    var node = schemTextDrag.node;
    // Persist the offset from the built position, keyed by sheet|ref|text.
    try {
      var pos = schemTextGetPos(node);
      var dx = pos[0] - parseFloat(node.getAttribute("data-ox"));
      var dy = pos[1] - parseFloat(node.getAttribute("data-oy"));
      var g = node.closest("[data-ref]");
      var key = "schlbl2:" + (schemSheets[schemTextDrag.index] ?
        schemSheets[schemTextDrag.index].name : "?") + "|" +
        (g ? g.getAttribute("data-ref") : "?") + "|" +
        (node.getAttribute("data-txt") || "");
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        window.localStorage.setItem(key, dx + "," + dy);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch (err) { /* file:// or private mode: offsets stay for this view only */ }
    schemTextDrag = null;
    return;
  }
  schemDrag = null;
});

// Re-apply saved label offsets after a sheet is (re)built.
function schemApplyLabelOffsets(holder, sheetName) {
  var labels;
  try { labels = holder.querySelectorAll("[data-mv]"); } catch (e) { return; }
  for (var i = 0; labels && i < labels.length; i++) {
    var el = labels[i];
    var g = el.closest ? el.closest("[data-ref]") : null;
    // "schlbl2" - v1 keys were poisoned by an early bug that stored absolute
    // positions instead of deltas; ignore everything saved under v1.
    var key = "schlbl2:" + (sheetName || "?") + "|" +
      (g ? g.getAttribute("data-ref") : "?") + "|" +
      (el.getAttribute("data-txt") || "");
    var saved;
    try { saved = window.localStorage.getItem(key); } catch (err) { saved = null; }
    if (saved) {
      var c = saved.split(",");
      if (c.length === 2) {
        var dx = parseFloat(c[0]), dy = parseFloat(c[1]);
        if (!isNaN(dx) && !isNaN(dy)) {
          var pos = schemTextGetPos(el);
          schemTextSetPos(el, pos[0] + dx, pos[1] + dy);
        }
      }
    }
    // The drag anchor must be the position AFTER replaying saved offsets, so
    // mouseup stores a true delta and rebuilds never compound it.
    var np = schemTextGetPos(el);
    el.setAttribute("data-ox", np[0]);
    el.setAttribute("data-oy", np[1]);
  }
}

function schemZoom(index, px, py, factor, rect) {
  var entry = schemSheets[index];
  if (!entry) return;
  var vb = entry.svg.__schemVb;
  var minW = entry.content.w * 0.02;
  var maxW = entry.content.w * 6;
  var nw = vb.w * factor;
  if (nw < minW) nw = minW;
  if (nw > maxW) nw = maxW;
  var real = nw / vb.w;
  var ux = vb.x + (px / rect.width) * vb.w;
  var uy = vb.y + (py / rect.height) * vb.h;
  var nh = vb.h * real;
  vb.x = ux - (ux - vb.x) * real;
  vb.y = uy - (uy - vb.y) * real;
  vb.w = nw;
  vb.h = nh;
  schemApplyViewBox(index);
}

function schemApplyViewBox(index) {
  var entry = schemSheets[index];
  if (!entry) return;
  var vb = entry.svg.__schemVb;
  entry.svg.setAttribute("viewBox",
    vb.x + " " + vb.y + " " + vb.w + " " + vb.h);
}

function schemFit(index) {
  var entry = schemSheets[index];
  if (!entry) return;
  var vb = entry.svg.__schemVb;
  vb.x = entry.content.x;
  vb.y = entry.content.y;
  vb.w = entry.content.w;
  vb.h = entry.content.h;
  schemApplyViewBox(index);
}

/* -------------------------------------------------------------------------
 * Sheet selection.
 * ---------------------------------------------------------------------- */

function schemBuildBar() {
  var bar = document.getElementById("schembar");
  if (!bar) return;
  bar.innerHTML = "";
  if (schemData.sheets.length < 2) {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "";
  for (var i = 0; i < schemData.sheets.length; i++) {
    var b = document.createElement("button");
    b.className = "sch-tab";
    b.textContent = schemData.sheets[i].name;
    b.setAttribute("data-index", i);
    b.onclick = schemTabHandler(i);
    bar.appendChild(b);
  }
}

function schemTabHandler(i) {
  return function() {
    schemShowSheet(i);
  };
}

function schemShowSheet(index) {
  if (index < 0 || index >= schemSheets.length) return;
  schemCurrent = index;
  for (var i = 0; i < schemSheets.length; i++) {
    if (schemSheets[i]) {
      schemSheets[i].holder.style.display = i == index ? "block" : "none";
    }
  }
  var tabs = document.querySelectorAll("#schembar .sch-tab");
  for (i = 0; i < tabs.length; i++) {
    if (parseInt(tabs[i].getAttribute("data-index"), 10) == index) {
      tabs[i].classList.add("depressed");
    } else {
      tabs[i].classList.remove("depressed");
    }
  }
  schemFit(index);
}

/* -------------------------------------------------------------------------
 * Cross probing.
 * ---------------------------------------------------------------------- */

function schemHighlight(refs) {
  var i, k;
  for (i = 0; i < schemSheets.length; i++) {
    if (!schemSheets[i]) continue;
    for (k in schemSheets[i].comps) {
      if (Object.prototype.hasOwnProperty.call(schemSheets[i].comps, k)) {
        schemSheets[i].comps[k].classList.remove("sch-hl");
      }
    }
  }
  if (!refs || refs.length == 0) return;
  for (i = 0; i < refs.length; i++) {
    var list = schemRefIndex[refs[i]];
    if (!list) continue;
    for (k = 0; k < list.length; k++) {
      list[k].node.classList.add("sch-hl");
    }
  }
}

function schemFocus(ref, zoomIn) {
  var list = schemRefIndex[ref];
  if (!list || list.length == 0) return false;
  var target = list[0];
  if (target.sheet != schemCurrent) {
    schemShowSheet(target.sheet);
  }
  var entry = schemSheets[target.sheet];
  var b = entry.boxes[ref];
  if (!b) return true;
  var vb = entry.svg.__schemVb;
  if (zoomIn) {
    // Frame the symbol: at least 30 units of context, at most the whole sheet.
    var w = Math.max(b.w * 8, 30);
    var h = Math.max(b.h * 8, 30);
    if (w > entry.content.w) w = entry.content.w;
    if (h > entry.content.h) h = entry.content.h;
    vb.w = w;
    vb.h = h;
  }
  vb.x = b.x + b.w / 2 - vb.w / 2;
  vb.y = b.y + b.h / 2 - vb.h / 2;
  schemApplyViewBox(target.sheet);
  return true;
}

function schemOnHighlight(args) {
  if (!schemReady) return;
  // A component selection replaces any net highlight; the board side drops
  // its net highlight in exactly these situations (row handler), so the
  // schematic stays in step. No notify needed - the board already knows.
  schemClearNetHl();
  if (!args || !args.refs || args.refs.length == 0) {
    schemHighlight([]);
    return;
  }
  var refs = [];
  for (var i = 0; i < args.refs.length; i++) {
    refs.push(args.refs[i][0]);
  }
  schemHighlight(refs);
  // Cross-probe still switches to the sheet that owns the part, but the
  // viewport is never touched: no auto-zoom, no panning (a zoom used to yank
  // the split-view schematic around on every BOM interaction). The highlight
  // alone shows the selection. An external clear (empty-click on the board)
  // also drops the schematic-side pick state.
  if (refs.length) {
    var list = schemRefIndex[refs[0]];
    if (list && list.length && list[0].sheet != schemCurrent) {
      schemShowSheet(list[0].sheet);
    }
  } else {
    schemPickedRef = null;
  }
}

/* Symbol -> BOM row -> board. refToHandler is built by ibom.js while the BOM
 * table is populated; a reference that is not in the table (a No BOM part, or
 * one filtered out) simply highlights on the sheet alone. */
function schemPick(ref) {
  if (!ref) return;
  if (typeof refToHandler == "object" && refToHandler &&
      refToHandler[ref]) {
    // EventHandler.fire is synchronous, so this one-shot flag is consumed by
    // schemOnHighlight within the same tick. Highlight only - the pane never
    // auto-zooms from either direction anymore.
    schemPickQuiet = true;
    try {
      refToHandler[ref]();
    } finally {
      schemPickQuiet = false;
    }
    // The schematic click selected the row (currentHighlightedRowId is set by
    // createRowHighlightHandler); bring that row into view so the split view
    // shows which BOM line the clicked symbol maps to.
    if (typeof currentHighlightedRowId == "string" && currentHighlightedRowId) {
      var rowEl = document.getElementById(currentHighlightedRowId);
      if (rowEl && rowEl.scrollIntoView) {
        rowEl.scrollIntoView({ block: "nearest" });
      }
    }
  } else {
    schemHighlight([ref]);
  }
}

/* -------------------------------------------------------------------------
 * Left panel view switch: "bom" shows the BOM table, "schem" shows the
 * schematic. The two are mutually exclusive, so a missing or unread schematic
 * can never push the BOM down the way the old 45% split did. The schematic SVG
 * is built lazily on the first switch so it measures against a visible
 * container instead of a display:none box.
 * ---------------------------------------------------------------------- */

var schemHasData = false;
var schemBuilt = false;

function changeLeftPane(which) {
  if (which != "schem" && which != "both") which = "bom";
  var isSchem = (which == "schem");
  var isBoth = (which == "both");
  var bomdiv = document.getElementById("bomdiv");
  if (bomdiv) {
    if (isSchem) bomdiv.classList.add("show-schem");
    else bomdiv.classList.remove("show-schem");
    if (isBoth) bomdiv.classList.add("show-split");
    else bomdiv.classList.remove("show-split");
  }
  // Visibility goes through inline styles, not a CSS class: the pane used to
  // carry a "display: none" attribute that outranked the stylesheet, so the
  // switch appeared to do nothing and left the panel blank.
  var wrap = document.getElementById("bomwrap");
  if (wrap) {
    wrap.style.display = isSchem ? "none" : "";
    // Split mode: the BOM keeps a fixed share of the column and the schematic
    // takes the rest, so neither pane squeezes the other.
    wrap.style.flex = isBoth ? "0 0 " + schemSplitPct + "%" : "";
  }
  var sdiv = document.getElementById("schemdiv");
  if (sdiv) sdiv.style.display = isSchem || isBoth ? "flex" : "none";
  var grip = document.getElementById("schemgrip");
  if (grip) grip.style.display = isBoth ? "block" : "none";
  setLeftPaneBtn("left-bom-btn", which == "bom");
  setLeftPaneBtn("left-split-btn", isBoth);
  setLeftPaneBtn("left-schem-btn", isSchem);
  if (isSchem || isBoth) ensureSchem();
}

function setLeftPaneBtn(id, down) {
  var btn = document.getElementById(id);
  if (!btn) return;
  if (down) btn.classList.add("depressed");
  else btn.classList.remove("depressed");
}

/* Split-view divider: drag to change the BOM share (15%..85%), persisted in
   localStorage so the next session starts where the user left it. */
var schemSplitPct = 55;
try {
  var schemSavedPct = parseFloat(localStorage.getItem("schsplitpct"));
  if (schemSavedPct >= 15 && schemSavedPct <= 85) schemSplitPct = schemSavedPct;
} catch (schemSplitErr) {}

function schemGripMove(e) {
  var bomdiv = document.getElementById("bomdiv");
  if (!bomdiv) return;
  var rect = bomdiv.getBoundingClientRect();
  if (!rect.height) return;
  var pct = (e.clientY - rect.top) / rect.height * 100;
  schemSplitPct = Math.max(15, Math.min(85, pct));
  var wrap = document.getElementById("bomwrap");
  if (wrap) wrap.style.flex = "0 0 " + schemSplitPct + "%";
}

function schemGripDown(e) {
  e.preventDefault();
  var move = function(ev) { schemGripMove(ev); };
  var up = function() {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    try { localStorage.setItem("schsplitpct", String(schemSplitPct)); }
    catch (err) {}
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}

/* The reader's own notes. Always ends with the AD-side build stamp, so the
 * first question ("did the script that wrote this page even have a schematic
 * reader?") is answerable from the page itself. */
function schemDiagLines() {
  var lines = [];
  var notes = (typeof pcbdata != "undefined" && pcbdata && pcbdata.schemdiag) ?
    pcbdata.schemdiag : null;
  if (notes && notes.length) {
    for (var i = 0; i < notes.length; i++) {
      lines.push(String(notes[i]));
    }
  }
  var stamp = (typeof pcbdata != "undefined" && pcbdata) ? pcbdata.adbuild : null;
  lines.push("");
  lines.push("AD 脚本标记: " + (stamp ? stamp : "(无)"));
  return lines;
}

/* Why the pane has nothing to draw. Three distinct causes, and they need
 * different actions from the user, so they must not share one message:
 *   1. the reader ran and found nothing -> its notes are the useful part;
 *   2. the page carries no reader notes AND no build stamp -> the AD session
 *      that wrote it was still running an older compiled script;
 *   3. the reader ran, but produced no data (should not happen - kept so the
 *      pane never falls back to silence). */
function schemExplainEmpty() {
  var notes = (typeof pcbdata != "undefined" && pcbdata && pcbdata.schemdiag) ?
    pcbdata.schemdiag : null;
  var stamp = (typeof pcbdata != "undefined" && pcbdata) ? pcbdata.adbuild : null;
  if (notes && notes.length) {
    return "未读取到原理图。工程里没有可用的 .SchDoc，或者这台 AD 不允许脚本读取原理图。\n" +
      "下面是读取过程的记录（也可悬停此行查看），可复制后回传。";
  }
  if (!stamp) {
    return "本页没有原理图数据，而且导出它的 AD 脚本里没有原理图读取功能 —— 说明 AD 当前" +
      "运行的是上一次编译好的旧脚本（AD 会缓存已编译的脚本，只在启动时重新读取）。\n" +
      "处理办法：完全退出 Altium Designer（不是只关掉图纸），重新打开后再导出一次。\n" +
      "重启后仍然为空，请复制下面的诊断回传。";
  }
  return "原理图读取器已经执行，但没有产出数据。请复制下面的诊断回传。";
}

/* Copy the whole explanation - the reason line plus the reader's notes - so a
 * failure can be reported without transcribing a pane by hand. */
function schemCopyDiag() {
  var why = document.getElementById("schememptywhy");
  var pre = document.getElementById("schemdiagtext");
  var text = ((why && why.textContent) ? why.textContent + "\n\n" : "") +
    ((pre && pre.textContent) ? pre.textContent : "");
  var btn = document.getElementById("schemdiagcopy");
  var done = function(okFlag) {
    if (btn) btn.textContent = okFlag ? "已复制" : "请手动复制";
  };
  try {
    if (typeof navigator != "undefined" && navigator.clipboard &&
        navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function() { done(true); },
        function() { done(schemCopyFallback(text)); });
      return;
    }
  } catch (e) {}
  done(schemCopyFallback(text));
}

/* The page is opened from file://, where the async clipboard API may be
 * refused. Falls back to the textarea trick and, failing that, selects the
 * block so Ctrl+C still works. */
function schemCopyFallback(text) {
  var okFlag = false;
  try {
    if (typeof document != "undefined" && document.body && document.createElement) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "fixed";
      ta.style.left = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      okFlag = document.execCommand("copy");
      document.body.removeChild(ta);
    }
  } catch (e2) {
    okFlag = false;
  }
  if (!okFlag) {
    try {
      var pre = document.getElementById("schemdiagtext");
      if (pre && typeof window != "undefined" && window.getSelection &&
          document.createRange) {
        var r = document.createRange();
        r.selectNodeContents(pre);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
    } catch (e3) {}
  }
  return okFlag;
}

function ensureSchem() {
  var empty = document.getElementById("schemempty");
  if (!schemHasData) {
    // No schematic: say why in the pane itself. The BOM keeps its own view and
    // is never touched - the two panes are mutually exclusive.
    var why = document.getElementById("schememptywhy");
    if (why) why.textContent = schemExplainEmpty();
    var pre = document.getElementById("schemdiagtext");
    if (pre) pre.textContent = schemDiagLines().join("\n");
    var btn = document.getElementById("schemdiagcopy");
    if (btn) btn.textContent = "复制诊断";
    if (empty) {
      empty.style.display = "";
      // Kept as a tooltip too: hovering used to be the only way to read it.
      empty.title = schemDiagLines().join("\n");
    }
    var view = document.getElementById("schemview");
    if (view) view.style.display = "none";
    var bar = document.getElementById("schembar");
    if (bar) bar.style.display = "none";
    schemReady = false;
    return;
  }

  if (empty) empty.style.display = "none";
  var view2 = document.getElementById("schemview");
  if (view2) view2.style.display = "";
  var bar2 = document.getElementById("schembar");
  if (bar2) bar2.style.display = "";

  if (!schemBuilt) {
    buildSchemContent();
    schemBuilt = true;
  } else {
    schemShowSheet(schemCurrent >= 0 ? schemCurrent : 0);
  }
}

function buildSchemContent() {
  var view = document.getElementById("schemview");
  view.innerHTML = "";
  schemSheets = [];
  schemRefIndex = {};
  schemCurrent = 0;

  for (var i = 0; i < schemData.sheets.length; i++) {
    view.appendChild(schemBuildSheet(i));
  }
  schemBuildBar();
  schemShowSheet(0);

  // BOM row -> schematic. Registered once; harmless until the pane exists.
  EventHandler.registerCallback(IBOM_EVENT_TYPES.HIGHLIGHT_EVENT, function(e) {
    schemOnHighlight(e.args);
  });

  schemReady = true;

  if (schemData.diag && schemData.diag.length) {
    var note = document.getElementById("schemnote");
    if (note) note.title = schemData.diag.join("\n");
  }
}

function initSchem() {
  if (!document.getElementById("schemdiv")) return;
  schemData = (typeof pcbdata != "undefined" && pcbdata && pcbdata.schem) ?
    pcbdata.schem : null;
  schemHasData = !!(schemData && schemData.sheets && schemData.sheets.length > 0);
  schemBuilt = false;
  schemReady = false;
  schemCurrent = -1;

  // Default to the BOM; the schematic is reached through the top switch and
  // built lazily so the SVG measures against a visible container.
  changeLeftPane("bom");

  var grip = document.getElementById("schemgrip");
  if (grip) grip.addEventListener("mousedown", schemGripDown);
}
