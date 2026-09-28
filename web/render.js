/* PCB rendering code */

var emptyContext2d = document.createElement("canvas").getContext("2d");

/* ---- Footprint reference / value labels ------------------------------------
 * drawFootprintLabels() paints the reference and value of every footprint on
 * top of the silkscreen. Everything there is in board millimetres, so a "font
 * size" is really a height in mm and has to be scaled by the zoom to become
 * pixels.
 *
 * Two things about it are user controlled:
 *
 *  - the size. `settings.uniformLabelSize` gives every label the same height;
 *    with it off the height is derived from the footprint bounding box, which
 *    is what the original plugin did and why small parts used to end up with
 *    much smaller text than large ones.
 *  - the position. A label can be dragged around by hand; the nudge is stored
 *    in board millimetres and keyed by reference designator, because footprint
 *    indices shift whenever the board is edited and re-exported.
 *  - the angle. A label can also be spun in place, 90 degrees at a time, for
 *    boards where a part sits rotated and the text has to follow it. The extra
 *    angle is stored per label alongside the nudge, and it turns about the
 *    label's own anchor so the nudge does not have to be recomputed.
 */

var LABEL_FIELDS = ["ref", "val"];
// Which line of the footprint box each field sits on, as a fraction of its
// height. Same values the original plugin used; the sign puts the reference
// above the centre and the value below it.
var LABEL_ROWS = { ref: -0.25, val: 0.3 };
// How far the space bar turns a label, in degrees, per press.
var LABEL_ROTATION_STEP = 90;
// Extra slack around a label when testing whether it was grabbed, in CSS px.
var LABEL_HIT_PADDING = 6;
// Rough advance width of one glyph in the label font, as a fraction of the
// font size. Only used to size the grab area, so it needs no precision.
var LABEL_GLYPH_WIDTH = 0.34;

// Where each drawn label ended up, in board millimetres, rebuilt on every
// background draw so the hit test can never disagree with what is on screen.
// Keyed by layer, since only the layer under the pointer is relevant.
var labelHitList = { F: [], B: [] };

// The label the space bar will spin: set by hovering one, or by grabbing one
// and letting go, and cleared when the pointer moves off every label. Stored as
// {ref, field} rather than the hit object because the hit list is rebuilt on
// every draw and the old object would go stale.
var selectedLabel = null;

// A label is the selected one while the pointer is on it, and stays selected
// after a click so the space bar can be pressed without holding the mouse
// perfectly still.
function sameLabel(a, b) {
  return !!a && !!b && a.ref === b.ref && a.field === b.field;
}

function labelSelection() {
  return selectedLabel;
}

// Rotate whichever label is selected. Returns true when something changed, so
// the key handler only redraws when there is a reason to.
function rotateSelectedLabel(step) {
  if (!selectedLabel) return false;
  rotateLabel(selectedLabel.ref, selectedLabel.field, step);
  return true;
}

// Box, rotation and the size the old auto-sizing would pick, shared by the
// drawing code and the hit test.
function footprintLabelMetrics(fp) {
  var bw = 2, bh = 2, ang = 0;
  if (fp.bbox) {
    bw = fp.bbox.size[0] || 2;
    bh = fp.bbox.size[1] || 2;
    if (fp.bbox.angle) ang = fp.bbox.angle;
    else if (bh > bw * 1.3) ang = 90;
  }
  var horiz = (ang % 180 === 0);
  var boxW = horiz ? bw : bh;
  var boxH = horiz ? bh : bw;
  var fs = Math.min(0.5, boxH * 0.32, boxW * 0.18);
  if (fs < 0.22) fs = 0.22;
  return { boxW: boxW, boxH: boxH, ang: ang, autoSize: fs * 1.5 };
}

// `manual` is the size from the menu; a non-positive value means "not set",
// which keeps a page from breaking on a hand-edited or imported settings file.
function labelFontSize(metrics, manual) {
  if (settings.uniformLabelSize && manual > 0) {
    return manual;
  }
  return metrics.autoSize;
}

// Default size for the uniform mode: the median of the automatic sizes, so
// switching to a uniform size makes about half the labels smaller and half
// bigger instead of blowing up the dense end of the board. Rounded to the
// slider step.
function defaultLabelFontSize() {
  var sizes = [];
  for (var i = 0; i < pcbdata.footprints.length; i++) {
    var fp = pcbdata.footprints[i];
    if (!fp.center) continue;
    if (!fp.ref && !fp.val) continue;
    if (isBomSkipped(i)) continue;
    sizes.push(footprintLabelMetrics(fp).autoSize);
  }
  if (sizes.length === 0) {
    return 0.5;
  }
  sizes.sort(function(a, b) { return a - b; });
  return Math.round(sizes[Math.floor(sizes.length / 2)] * 20) / 20;
}

// settings.labelOffsets is missing on settings imported from an older page.
function labelOffsetTable() {
  if (!settings.labelOffsets || typeof settings.labelOffsets != "object") {
    settings.labelOffsets = {};
  }
  return settings.labelOffsets;
}

function labelOffset(ref, field) {
  var entry = ref ? labelOffsetTable()[ref] : null;
  var o = entry ? entry[field] : null;
  return o ? [o[0] || 0, o[1] || 0] : [0, 0];
}

// `persist` stays false during a drag: the offset changes on every pointermove
// and is written to storage once, when the drag ends.
function setLabelOffset(ref, field, x, y, persist) {
  if (!ref) return;
  var table = labelOffsetTable();
  if (!table[ref]) table[ref] = {};
  table[ref][field] = [x, y];
  if (persist) {
    saveLabelOffsets();
  }
}

function saveLabelOffsets() {
  writeStorage("labelOffsets", JSON.stringify(settings.labelOffsets || {}));
}

// Rotation lives in its own table rather than being folded into the offset, so
// an offset written by an older page keeps working and the two features can be
// reset independently. Keyed by reference then field, exactly like the offsets.
function labelRotationTable() {
  if (!settings.labelRotations || typeof settings.labelRotations != "object") {
    settings.labelRotations = {};
  }
  return settings.labelRotations;
}

function labelRotation(ref, field) {
  var entry = ref ? labelRotationTable()[ref] : null;
  var deg = entry ? entry[field] : 0;
  // Anything not a finite number is treated as "not rotated" rather than
  // letting a hand-edited settings file produce NaN transforms.
  return (typeof deg === "number" && isFinite(deg)) ? deg : 0;
}

function setLabelRotation(ref, field, deg) {
  if (!ref) return;
  var table = labelRotationTable();
  if (!table[ref]) table[ref] = {};
  table[ref][field] = deg;
  saveLabelRotations();
}

function saveLabelRotations() {
  writeStorage("labelRotations", JSON.stringify(settings.labelRotations || {}));
}

// Forget one label's angle, putting it back in line with its footprint.
function clearLabelRotation(ref, field) {
  var table = labelRotationTable();
  if (!ref || !table[ref]) return;
  delete table[ref][field];
  if (Object.keys(table[ref]).length === 0) {
    delete table[ref];
  }
  saveLabelRotations();
}

// Space bar: turn a label by one step. Returns the new angle so the caller can
// decide whether anything needs redrawing.
function rotateLabel(ref, field, step) {
  if (!ref) return 0;
  var turn = (typeof step === "number") ? step : LABEL_ROTATION_STEP;
  var deg = labelRotation(ref, field) + turn;
  // Keep the stored angle in [0, 360) so repeated presses do not grow without
  // bound and the stored value stays readable.
  deg = ((deg % 360) + 360) % 360;
  setLabelRotation(ref, field, deg);
  return deg;
}

// Forget one label's nudge, restoring it to where the footprint puts it.
function clearLabelOffset(ref, field) {
  var table = labelOffsetTable();
  if (!ref || !table[ref]) return;
  delete table[ref][field];
  if (Object.keys(table[ref]).length === 0) {
    delete table[ref];
  }
  saveLabelOffsets();
}

// Closest label to a board-space point, or null. Coordinates are board
// millimetres while the slack has to be visible on screen, hence mmPerPx.
function labelHitScan(layer, x, y, mmPerPx) {
  var list = labelHitList[layer];
  if (!list) return null;
  var pad = LABEL_HIT_PADDING * mmPerPx;
  var found = null;
  var foundScore = Infinity;
  for (var i = 0; i < list.length; i++) {
    var h = list[i];
    var halfH = Math.max(h.size * 0.75, pad);
    var halfW = Math.max(h.size * LABEL_GLYPH_WIDTH * h.len, pad);
    if (h.rotated) {
      var swap = halfW;
      halfW = halfH;
      halfH = swap;
    }
    var dx = Math.abs(x - h.x) - halfW;
    var dy = Math.abs(y - h.y) - halfH;
    if (dx > 0 || dy > 0) continue;
    // Negative inside the box, so the most central candidate wins. "<=" lets
    // the value label, drawn after the reference, win an exact overlap.
    var score = dx + dy;
    if (score <= foundScore) {
      found = h;
      foundScore = score;
    }
  }
  return found;
}

// Inverse of prepareCanvas(): a pointer position in CSS pixels to board
// millimetres on the given layer.
function canvasPixelRatio() {
  // Effective raster density: devicePixelRatio times the page scale factor
  // (uiScaleFactor in util.js; a fixed 1 since the UI zoom feature was
  // removed). Keeping the multiplication makes the mapping formula survive
  // any future re-introduction of a page-level zoom.
  return devicePixelRatio * uiScaleFactor;
}

// Pointer position in canvas backing pixels. Everything is measured in visual
// pixels - clientX and getBoundingClientRect() are both visual, and the
// canvas's own width/rect ratio converts between them. e.offsetX is deliberately
// avoided: under the UI scale feature (body CSS zoom) Chromium reports offsetX
// in visual pixels while the canvas raster is sized from layout pixels, so the
// old ratio*offsetX maths drifted by the zoom factor and grew across the board
// - clicks landed on the neighbour net whenever the scale was not 100%
// (2026-09-24 fix; measured-ratio conversion is immune to either convention).
function cursorCanvasPx(e, layerdict) {
  var crect = layerdict.bg.getBoundingClientRect();
  var ratio = layerdict.bg.width / (crect.width || 1);
  return [
    (e.clientX - crect.left) * ratio,
    (e.clientY - crect.top) * ratio,
  ];
}

function boardPoint(e, layerdict) {
  var t = layerdict.transform;
  var b = cursorCanvasPx(e, layerdict);
  var x, y;
  if (layerdict.layer == "B") {
    x = (b[0] / t.zoom - t.panx + t.x) / -t.s;
  } else {
    x = (b[0] / t.zoom - t.panx - t.x) / t.s;
  }
  y = (b[1] / t.zoom - t.y - t.pany) / t.s;
  return rotateVector([x, y], -settings.boardRotation);
}

// Board millimetres per CSS pixel, for turning a screen-sized grab area into a
// board-space one. Rotation and mirror preserve lengths, so only the scale and
// the zoom matter.
function boardMmPerPixel(layerdict) {
  return canvasPixelRatio() / (layerdict.transform.s * layerdict.transform.zoom);
}

function deg2rad(deg) {
  return deg * Math.PI / 180;
}

function calcFontPoint(linepoint, text, offsetx, offsety, tilt) {
  var point = [
    linepoint[0] * text.width + offsetx,
    linepoint[1] * text.height + offsety
  ];
  // This approximates pcbnew behavior with how text tilts depending on horizontal justification
  point[0] -= (linepoint[1] + 0.5 * (1 + text.justify[0])) * text.height * tilt;
  return point;
}

function drawText(ctx, text, color) {
  if (!text || !Array.isArray(text.pos)) return;
  // Reference / value text that Altium itself placed on the silkscreen. It is a
  // different thing from the labels this page generates (drawFootprintLabels):
  // it sits wherever the footprint puts it and cannot be dragged, so it answers
  // to a switch of its own instead of riding on References / Values - unchecking
  // References hides the generated labels and leaves Altium's text alone.
  // Only an explicit `false` hides it, so a page whose settings predate the
  // switch keeps drawing them.
  if (("ref" in text || "val" in text) && settings.renderNativeLabels === false) {
    return;
  }
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = text.thickness;
  if ("svgpath" in text) {
    ctx.stroke(new Path2D(text.svgpath));
    ctx.restore();
    return;
  }
  ctx.translate(...text.pos);
  ctx.translate(text.thickness * 0.5, 0);
  var angle = -text.angle;
  if (text.attr.includes("mirrored")) {
    ctx.scale(-1, 1);
    angle = -angle;
  }
  var tilt = 0;
  if (text.attr.includes("italic")) {
    tilt = 0.125;
  }
  var interline = text.height * 1.5 + text.thickness;
  var txt = text.text.split("\n");
  // KiCad ignores last empty line.
  if (txt[txt.length - 1] == '') txt.pop();
  ctx.rotate(deg2rad(angle));
  var offsety = (1 - text.justify[1]) / 2 * text.height; // One line offset
  offsety -= (txt.length - 1) * (text.justify[1] + 1) / 2 * interline; // Multiline offset
  for (var i in txt) {
    var lineWidth = text.thickness + interline / 2 * tilt;
    for (var j = 0; j < txt[i].length; j++) {
      if (txt[i][j] == '\t') {
        var fourSpaces = 4 * pcbdata.font_data[' '].w * text.width;
        lineWidth += fourSpaces - lineWidth % fourSpaces;
      } else {
        if (txt[i][j] == '~') {
          j++;
          if (j == txt[i].length)
            break;
        }
        lineWidth += pcbdata.font_data[txt[i][j]].w * text.width;
      }
    }
    var offsetx = -lineWidth * (text.justify[0] + 1) / 2;
    var inOverbar = false;
    for (var j = 0; j < txt[i].length; j++) {
      if (txt[i][j] == '\t') {
        var fourSpaces = 4 * pcbdata.font_data[' '].w * text.width;
        offsetx += fourSpaces - offsetx % fourSpaces;
        continue;
      } else if (txt[i][j] == '~') {
        j++;
        if (j == txt[i].length)
          break;
        if (txt[i][j] != '~') {
          inOverbar = !inOverbar;
        }
      }
      var glyph = pcbdata.font_data[txt[i][j]];
      if (inOverbar) {
        var overbarStart = [offsetx, -text.height * 1.4 + offsety];
        var overbarEnd = [offsetx + text.width * glyph.w, overbarStart[1]];

        if (!lastHadOverbar) {
          overbarStart[0] += text.height * 1.4 * tilt;
          lastHadOverbar = true;
        }
        ctx.beginPath();
        ctx.moveTo(...overbarStart);
        ctx.lineTo(...overbarEnd);
        ctx.stroke();
      } else {
        lastHadOverbar = false;
      }
      for (var line of glyph.l) {
        ctx.beginPath();
        ctx.moveTo(...calcFontPoint(line[0], text, offsetx, offsety, tilt));
        for (var k = 1; k < line.length; k++) {
          ctx.lineTo(...calcFontPoint(line[k], text, offsetx, offsety, tilt));
        }
        ctx.stroke();
      }
      offsetx += glyph.w * text.width;
    }
    offsety += interline;
  }
  ctx.restore();
}

function drawedge(ctx, scalefactor, edge, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1 / scalefactor, edge.width);
  ctx.lineCap = "round";
  if ("svgpath" in edge) {
    ctx.stroke(new Path2D(edge.svgpath));
  } else {
    ctx.beginPath();
    if (edge.type == "segment") {
      ctx.moveTo(...edge.start);
      ctx.lineTo(...edge.end);
    }
    if (edge.type == "rect") {
      ctx.moveTo(...edge.start);
      ctx.lineTo(edge.start[0], edge.end[1]);
      ctx.lineTo(...edge.end);
      ctx.lineTo(edge.end[0], edge.start[1]);
      ctx.lineTo(...edge.start);
    }
    if (edge.type == "arc") {
      ctx.arc(
        ...edge.start,
        edge.radius,
        deg2rad(edge.startangle),
        deg2rad(edge.endangle));
    }
    if (edge.type == "circle") {
      ctx.arc(
        ...edge.start,
        edge.radius,
        0, 2 * Math.PI);
      ctx.closePath();
    }
    if (edge.type == "curve") {
      ctx.moveTo(...edge.start);
      ctx.bezierCurveTo(...edge.cpa, ...edge.cpb, ...edge.end);
    }
    ctx.stroke();
  }
}

function getChamferedRectPath(size, radius, chamfpos, chamfratio) {
  // chamfpos is a bitmask, left = 1, right = 2, bottom left = 4, bottom right = 8
  var path = new Path2D();
  var width = size[0];
  var height = size[1];
  var x = width * -0.5;
  var y = height * -0.5;
  var chamfOffset = Math.min(width, height) * chamfratio;
  path.moveTo(x, 0);
  if (chamfpos & 4) {
    path.lineTo(x, y + height - chamfOffset);
    path.lineTo(x + chamfOffset, y + height);
    path.lineTo(0, y + height);
  } else {
    path.arcTo(x, y + height, x + width, y + height, radius);
  }
  if (chamfpos & 8) {
    path.lineTo(x + width - chamfOffset, y + height);
    path.lineTo(x + width, y + height - chamfOffset);
    path.lineTo(x + width, 0);
  } else {
    path.arcTo(x + width, y + height, x + width, y, radius);
  }
  if (chamfpos & 2) {
    path.lineTo(x + width, y + chamfOffset);
    path.lineTo(x + width - chamfOffset, y);
    path.lineTo(0, y);
  } else {
    path.arcTo(x + width, y, x, y, radius);
  }
  if (chamfpos & 1) {
    path.lineTo(x + chamfOffset, y);
    path.lineTo(x, y + chamfOffset);
    path.lineTo(x, 0);
  } else {
    path.arcTo(x, y, x, y + height, radius);
  }
  path.closePath();
  return path;
}

function getOblongPath(size) {
  return getChamferedRectPath(size, Math.min(size[0], size[1]) / 2, 0, 0);
}

// A few primitive kinds (keepouts, board cutouts) reach us as bare objects with
// neither an svgpath nor a polygon ring. They cannot be drawn, so they are
// counted and skipped instead of taking the whole page down.
var undrawableShapes = [];

function noteUndrawableShape(shape) {
  undrawableShapes.push(shape);
}

function getPolygonsPath(shape) {
  if (shape.path2d) {
    return shape.path2d;
  }
  if ("svgpath" in shape) {
    shape.path2d = new Path2D(shape.svgpath);
  } else if (shape.polygons && shape.polygons.length) {
    var path = new Path2D();
    for (var polygon of shape.polygons) {
      path.moveTo(...polygon[0]);
      for (var i = 1; i < polygon.length; i++) {
        path.lineTo(...polygon[i]);
      }
      path.closePath();
    }
    shape.path2d = path;
  } else {
    noteUndrawableShape(shape);
    return null;
  }
  return shape.path2d;
}

function drawPolygonShape(ctx, shape, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.07;
  ctx.fillStyle = 'transparent';
  if (!("svgpath" in shape)) {
    ctx.translate(...shape.pos);
    ctx.rotate(deg2rad(-shape.angle));
  }
  var p = getPolygonsPath(shape);
  if (!p) {
    ctx.restore();
    return;
  }
  ctx.fill(p);
  ctx.stroke(p);
  ctx.restore();
}

function drawDrawing(ctx, scalefactor, drawing, color) {
  // Some footprints (e.g. AD buzzer/mic outlines) export drawing as an array of
  // segment objects instead of a single shape. Recurse into it.
  if (Array.isArray(drawing)) {
    for (var item of drawing) {
      drawDrawing(ctx, scalefactor, item, color);
    }
    return;
  }
  if (!drawing || drawing.type === undefined) return;
  if (["segment", "arc", "circle", "curve"].includes(drawing.type)) {
    drawedge(ctx, scalefactor, drawing, color);
  } else if (drawing.type == "polygon") {
    drawPolygonShape(ctx, drawing, color);
  } else {
    drawText(ctx, drawing, color);
  }
}

function getCirclePath(radius) {
  var path = new Path2D();
  path.arc(0, 0, radius, 0, 2 * Math.PI);
  path.closePath();
  return path;
}

function getCachedPadPath(pad) {
  if (!pad.path2d) {
    // if path2d is not set, build one and cache it on pad object
    if (pad.shape == "rect") {
      pad.path2d = new Path2D();
      pad.path2d.rect(...pad.size.map(c => -c * 0.5), ...pad.size);
    } else if (pad.shape == "oval") {
      pad.path2d = getOblongPath(pad.size);
    } else if (pad.shape == "circle") {
      pad.path2d = getCirclePath(pad.size[0] / 2);
    } else if (pad.shape == "roundrect") {
      pad.path2d = getChamferedRectPath(pad.size, pad.radius, 0, 0);
    } else if (pad.shape == "chamfrect") {
      pad.path2d = getChamferedRectPath(pad.size, pad.radius, pad.chamfpos, pad.chamfratio)
    } else if (pad.shape == "custom") {
      pad.path2d = getPolygonsPath(pad);
    }
  }
  return pad.path2d;
}

function drawPad(ctx, pad, color, outline) {
  ctx.save();
  ctx.translate(...pad.pos);
  ctx.rotate(deg2rad(pad.angle));
  if (pad.offset) {
    ctx.translate(...pad.offset);
  }
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  var path = getCachedPadPath(pad);
  if (!path) {
    ctx.restore();
    return;
  }
  if (outline) {
    ctx.stroke(path);
  } else {
    ctx.fill(path);
  }
  ctx.restore();
}

// Negative flag on purpose: every drawing site asks "is this via to be
// skipped". The menu switch is the positive one (viasVisible in ibom.js) and is
// the single place that inverts.
var hideViasMode = false;
function hideVias(checked) { hideViasMode = checked; redrawIfInitDone(); }
function drawPadHole(ctx, pad, padHoleColor) {
  if (pad.type != "th") return;
  if (hideViasMode && pad.drillsize && pad.drillsize[0] <= 0.6) return;
  ctx.save();
  ctx.translate(...pad.pos);
  ctx.rotate(deg2rad(pad.angle));
  ctx.fillStyle = padHoleColor;
  if (pad.drillshape == "oblong") {
    ctx.fill(getOblongPath(pad.drillsize));
  } else {
    ctx.fill(getCirclePath(pad.drillsize[0] / 2));
  }
  ctx.restore();
}

function drawFootprint(ctx, layer, scalefactor, footprint, padColor, padHoleColor, outlineColor, highlight, outline) {
  if (highlight) {
    // draw bounding box
    if (footprint.layer == layer) {
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.translate(...footprint.bbox.pos);
      ctx.rotate(deg2rad(-footprint.bbox.angle));
      ctx.translate(...footprint.bbox.relpos);
      ctx.fillStyle = padColor;
      ctx.fillRect(0, 0, ...footprint.bbox.size);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = padColor;
      ctx.strokeRect(0, 0, ...footprint.bbox.size);
      ctx.restore();
    }
  }
  // draw drawings
  for (var drawing of footprint.drawings) {
    if (drawing.layer == layer) {
      drawDrawing(ctx, scalefactor, drawing.drawing, padColor);
    }
  }
  // draw pads
  if (settings.renderPads) {
    for (var pad of footprint.pads) {
      if (pad.layers.includes(layer)) {
        if (hideViasMode && pad.drillsize && pad.drillsize[0] <= 0.6) continue;
        drawPad(ctx, pad, padColor, outline);
        if (pad.pin1 && settings.highlightpin1) {
          drawPad(ctx, pad, outlineColor, true);
        }
      }
    }
    for (var pad of footprint.pads) {
      drawPadHole(ctx, pad, padHoleColor);
    }
  }
}

function drawEdgeCuts(canvas, scalefactor) {
  var ctx = canvas.getContext("2d");
  var edgecolor = getComputedStyle(topmostdiv).getPropertyValue('--pcb-edge-color');
  for (var edge of pcbdata.edges) {
    drawedge(ctx, scalefactor, edge, edgecolor);
  }
}

// Whether footprint `i` is kept out of the BOM table right now.
// `bom.skipped` covers every blacklist rule at once (empty comment, single pad,
// through-hole, and "Standard (No BOM)"). The no-BOM ones have their own index
// list so the page can pull them back in on demand: when `settings.showNoBom` is
// on, they are treated as normal parts everywhere.
function isBomSkipped(i) {
  if (!pcbdata.bom || !pcbdata.bom.skipped) return false;
  if (pcbdata.bom.skipped.indexOf(i) === -1) return false;
  if (settings.showNoBom && pcbdata.bom.nobomComponents &&
      pcbdata.bom.nobomComponents.indexOf(i) !== -1) {
    return false;
  }
  return true;
}

function drawFootprintLabels(canvas, layer, scalefactor) {
  var ctx = canvas.getContext("2d");
  // Read from CSS rather than hardcoding black: the dark theme overrides the
  // variable, so the labels stay readable on a dark board. Falling back to the
  // light theme's value keeps the labels visible if the variable is missing
  // (an older ibom.css next to a newer render.js).
  var labelColor = getComputedStyle(topmostdiv)
    .getPropertyValue('--component-label-color').trim() || '#111111';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // The back layer is mirrored around the footprint centre, so an x offset
  // expressed in the footprint's own frame flips sign.
  var mirror = (layer === 'B') ? -1 : 1;
  var hits = [];
  for (var i = 0; i < pcbdata.footprints.length; i++) {
    var fp = pcbdata.footprints[i];
    if (fp.layer !== layer) continue;
    if (!fp.center) continue;
    if (isBomSkipped(i)) continue;
    if (!(fp.ref && settings.renderReferences) &&
        !(fp.val && settings.renderValues)) continue;
    var m = footprintLabelMetrics(fp);
    var cx = fp.center[0], cy = fp.center[1];
    var a = deg2rad(m.ang);
    var sinA = Math.sin(a), cosA = Math.cos(a);
    for (var fi = 0; fi < LABEL_FIELDS.length; fi++) {
      var field = LABEL_FIELDS[fi];
      var text = fp[field];
      if (!text) continue;
      if (field === "ref" && !settings.renderReferences) continue;
      if (field === "val" && !settings.renderValues) continue;
      var fs = labelFontSize(m,
        field === "ref" ? settings.refFontSize : settings.valFontSize);
      // Distance from the footprint centre to this line, in the rotated frame.
      var row = LABEL_ROWS[field] * m.boxH;
      var off = labelOffset(fp.ref, field);
      var extra = labelRotation(fp.ref, field);
      ctx.save();
      // The offset is added to the board-space translate, so it survives the
      // footprint rotation and the back layer mirror without extra maths.
      ctx.translate(cx + off[0], cy + off[1]);
      if (layer === 'B') { ctx.scale(-1, 1); }
      ctx.rotate(a);
      // Spin the label about its own anchor. The baseline point is shifted into
      // local space first, because translate/rotate would otherwise turn the
      // label around the footprint rather than around the text itself.
      ctx.translate(0, row);
      ctx.rotate(deg2rad(extra));
      ctx.font = "bold " + fs + "px sans-serif";
      ctx.lineWidth = 0;
      ctx.fillStyle = labelColor;
      ctx.fillText(text, 0, 0);
      ctx.restore();
      // Same point in board millimetres, for the drag hit test: rotate (0, row)
      // then mirror x. Recorded while drawing so the two can never drift.
      // Footprints without a reference have no stable key, so they are drawn
      // but kept out of the hit list: grabbing one would swallow the pan and
      // store an offset under an empty key that no re-export would ever match.
      if (fp.ref) {
        hits.push({
          ref: fp.ref,
          field: field,
          x: cx + off[0] - row * sinA * mirror,
          y: cy + off[1] + row * cosA,
          size: fs,
          len: text.length,
          // The grab box has to follow the spin too: a quarter-turned label is
          // tall and narrow, and the hit test swaps width/height on this flag.
          rotated: ((m.ang + extra) % 180) !== 0,
        });
      }
    }
  }
  labelHitList[layer] = hits;
}

// Net-name label height in board millimetres. A stored value of 0 (never
// set / imported from an older settings file) keeps the historical 0.1mm.
function netLabelFontSize() {
  var v = parseFloat(settings.netFontSize);
  return (v > 0) ? v : 0.1;
}

// Name every pad that belongs to a net. Free vias live in this list too - the
// AD parser puts them in footprintNoBom.pads - so pads and vias are named by one
// pass and, above that, by one switch.
// Layer membership comes from the pad itself (pad.layers), NOT from the
// footprint: every free via and free pad hangs off one virtual footprint that
// is permanently stamped layer="F", so filtering by fp.layer left the back
// side - and every through-hole pad of a front-side component - unnamed.
function drawPadNetLabels(canvas, layer, scalefactor) {
  if (!pcbdata.nets) return;
  var ctx = canvas.getContext("2d");
  var fs = netLabelFontSize();
  ctx.font = fs + "px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = '#ffffff';
  for (var i = 0; i < pcbdata.footprints.length; i++) {
    var fp = pcbdata.footprints[i];
    for (var j = 0; j < fp.pads.length; j++) {
      var pad = fp.pads[j];
      // Same test drawPad() uses: a via the Hide Vias switch removed is not on
      // the board any more, so its name goes with it.
      if (hideViasMode && pad.drillsize && pad.drillsize[0] <= 0.6) continue;
      if (!pad.layers || pad.layers.indexOf(layer) < 0) continue;
      if (pad.net === undefined || pad.net === 0) continue;
      var netName = pcbdata.nets[pad.net];
      if (!netName) continue;
      var x = pad.pos[0], y = pad.pos[1];
      ctx.save();
      ctx.translate(x, y);
      if (layer === 'B') { ctx.scale(-1, 1); }
      ctx.fillText(netName, 0, 0);
      ctx.restore();
    }
  }
}

// Inner layers hold no footprints, so drawPadNetLabels above never reaches their
// vias. Same walk instead, over the separately exported pcbdata.vias (see
// ecad/AD10.js): a via is named only on the layers it actually crosses, and the
// Hide Vias switch takes its name away with its shape - the one link the pad
// labels keep too.
function drawInnerViaNetLabels(canvas, layer, scalefactor) {
  if (!pcbdata.nets || !pcbdata.vias || !pcbdata.vias.length) return;
  var ctx = canvas.getContext("2d");
  var fs = netLabelFontSize();
  ctx.font = fs + "px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = '#ffffff';
  for (var via of pcbdata.vias) {
    if (hideViasMode && via.drillsize && via.drillsize[0] <= 0.6) continue;
    if (via.net === undefined || via.net === 0) continue;
    var netName = pcbdata.nets[via.net];
    if (!netName) continue;
    if (!viaTouchesInnerLayer(via, layer)) continue;
    ctx.save();
    ctx.translate(via.pos[0], via.pos[1]);
    ctx.fillText(netName, 0, 0);
    ctx.restore();
  }
}

// Draw the net name next to copper tracks, mirroring drawPadNetLabels.
// A board holds thousands of segments, so labels are thinned out: short
// segments are skipped and two labels of the same net must stay MIN_GAP apart,
// which leaves roughly one readable label per net per region.
function drawTrackNetLabels(canvas, layer, scalefactor) {
  if (!pcbdata.nets) return;
  var tracks = copperList(layer, "tracks");
  if (!tracks) return;
  var ctx = canvas.getContext("2d");
  var fs = netLabelFontSize();
  ctx.font = fs + "px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = '#ffffff';

  var MIN_SEG = 0.6;   // mm, ignore stubs too short to label
  var MIN_GAP = 2.0;   // mm, minimum spacing between two labels of one net
  var labelled = {};   // net index -> [[x, y], ...]

  for (var i = 0; i < tracks.length; i++) {
    var track = tracks[i];
    if (!track) continue;
    if (track.net === undefined || track.net === 0) continue;
    var netName = pcbdata.nets[track.net];
    if (!netName) continue;
    if (!track.start || !track.end) continue;   // arcs keep start/end too

    var dx = track.end[0] - track.start[0];
    var dy = track.end[1] - track.start[1];
    if (dx * dx + dy * dy < MIN_SEG * MIN_SEG) continue;

    var x = (track.start[0] + track.end[0]) / 2;
    var y = (track.start[1] + track.end[1]) / 2;

    var pts = labelled[track.net];
    if (pts === undefined) {
      pts = labelled[track.net] = [];
    }
    var crowded = false;
    for (var k = 0; k < pts.length; k++) {
      var ox = pts[k][0] - x;
      var oy = pts[k][1] - y;
      if (ox * ox + oy * oy < MIN_GAP * MIN_GAP) {
        crowded = true;
        break;
      }
    }
    if (crowded) continue;
    pts.push([x, y]);

    ctx.save();
    ctx.translate(x, y);
    if (layer === 'B') { ctx.scale(-1, 1); }
    ctx.fillText(netName, 0, 0);
    ctx.restore();
  }
}

function drawFootprints(canvas, layer, scalefactor, highlight) {
  // Inner layers carry copper only: no pads, no outlines, no labels.
  if (isInnerLayer(layer)) return;
  var ctx = canvas.getContext("2d");
  ctx.lineWidth = 3 / scalefactor;
  var style = getComputedStyle(topmostdiv);
  var padColor = style.getPropertyValue('--pad-color');
  var padHoleColor = style.getPropertyValue('--pad-hole-color');
  var outlineColor = style.getPropertyValue('--pin1-outline-color');
  if (highlight) {
    padColor = style.getPropertyValue('--pad-color-highlight');
    outlineColor = style.getPropertyValue('--pin1-outline-color-highlight');
  }
  for (var i = 0; i < pcbdata.footprints.length; i++) {
    var mod = pcbdata.footprints[i];
    var outline = settings.renderDnpOutline && isBomSkipped(i);
    if (!highlight || highlightedFootprints.includes(i)) {
      drawFootprint(ctx, layer, scalefactor, mod, padColor, padHoleColor, outlineColor, highlight, outline);
    }
  }
}

function drawBgLayer(layername, canvas, layer, scalefactor, edgeColor, polygonColor, textColor) {
  var ctx = canvas.getContext("2d");
  if (!pcbdata[layername] || !pcbdata[layername][layer]) return;
  for (var d of pcbdata[layername][layer]) {
    if (["segment", "arc", "circle", "curve", "rect"].includes(d.type)) {
      drawedge(ctx, scalefactor, d, edgeColor);
    } else if (d.type == "polygon") {
      drawPolygonShape(ctx, d, polygonColor);
    } else {
      drawText(ctx, d, textColor);
    }
  }
}

// Vias belong to no single layer: a through via shows on every inner layer it
// crosses, a blind/buried one only inside its own span. The export carries the
// raw layer ids (pcbdata.vias), so the reach is decided here.
function viaTouchesInnerLayer(via, layer) {
  var info = innerLayerData[layer];
  if (!info) return false;
  if (via.through) return true;
  var id = info.layerid;
  if (id === undefined || id === null || via.start === undefined || via.stop === undefined) {
    // Nothing to compare: draw it rather than hide copper behind a guess.
    return true;
  }
  var lo = Math.min(via.start, via.stop);
  var hi = Math.max(via.start, via.stop);
  return id >= lo && id <= hi;
}

function drawInnerVias(canvas, layer, scalefactor, highlight) {
  if (!pcbdata.vias || !pcbdata.vias.length) return;
  // Same rule as drawNets: in the highlight pass the per-via net filter below
  // restricts output to highlightedNet, so pads being switched off must not
  // keep a highlighted net's inner-layer vias dark.
  if (!settings.renderPads && !highlight) return;
  var ctx = canvas.getContext("2d");
  var style = getComputedStyle(topmostdiv);
  var padColor = style.getPropertyValue(highlight ? '--pad-color-highlight' : '--pad-color');
  var holeColor = style.getPropertyValue('--pad-hole-color');
  for (var via of pcbdata.vias) {
    if (hideViasMode && via.drillsize && via.drillsize[0] <= 0.6) continue;
    if (highlight && via.net !== highlightedNet) continue;
    if (!viaTouchesInnerLayer(via, layer)) continue;
    drawPad(ctx, via, padColor, false);
    if (via.drillsize) {
      ctx.save();
      ctx.translate(...via.pos);
      ctx.fillStyle = holeColor;
      ctx.fill(getCirclePath(via.drillsize[0] / 2));
      ctx.restore();
    }
  }
}

// Board inner copper layers (pcbdata.inners), one entry per sandwiched layer.
// The rest of the renderer keys everything by layer id ("F" / "B"), so each inner
// layer gets a key of its own ("In1"..) and its copper is looked up here instead
// of in pcbdata.tracks / pcbdata.zones. Nothing on those layers is a footprint,
// a pad or a silkscreen drawing, which is why every per-footprint draw below
// steps aside for them.
var innerLayerData = {};
var innerLayerOrder = [];
var allLayerDicts = [];

function isInnerLayer(layer) {
  return Object.prototype.hasOwnProperty.call(innerLayerData, layer);
}

function copperList(layer, kind) {
  if (isInnerLayer(layer)) {
    return innerLayerData[layer][kind];
  }
  if (!pcbdata[kind]) return null;
  return pcbdata[kind][layer];
}

function drawTracks(canvas, layer, color, highlight) {
  ctx = canvas.getContext("2d");
  ctx.lineCap = "round";
  var tracks = copperList(layer, "tracks");
  if (!tracks) return;
  for(var track of tracks) {
    if (highlight && highlightedNet != track.net) continue;
    ctx.beginPath();
    ctx.moveTo(...track.start);
    ctx.lineTo(...track.end);
    ctx.strokeStyle = color;
    ctx.lineWidth = track.width;
    ctx.stroke();
  }
}

function drawZones(canvas, layer, color, highlight) {
  ctx = canvas.getContext("2d");
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineJoin = "round";
  var zones = copperList(layer, "zones");
  if (!zones) return;
  for(var zone of zones) {
    if (!zone.path2d) {
      zone.path2d = getPolygonsPath(zone);
    }
    if (!zone.path2d) continue;
    if (highlight && highlightedNet != zone.net) continue;
    ctx.fill(zone.path2d);
    if (zone.width > 0) {
      ctx.lineWidth = zone.width;
      ctx.stroke(zone.path2d);
    }
  }
}

function clearCanvas(canvas, color = null) {
  var ctx = canvas.getContext("2d");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  ctx.restore();
}

function drawNets(canvas, layer, highlight) {
  var style = getComputedStyle(topmostdiv);
  // The highlight pass ignores the base visibility switches: inside
  // drawTracks/drawZones a highlight request already filters down to
  // highlightedNet only, so letting it through when its switch is off just
  // lights up the clicked net's own copper. Without this, hiding tracks made
  // a pour click feel dead - the hit registered but nothing but the zone
  // tint changed (2026-09-24 fix).
  if (settings.renderTracks || highlight) {
    var trackColor = style.getPropertyValue(highlight ? '--track-color-highlight' : '--track-color');
    drawTracks(canvas, layer, trackColor, highlight);
  }
  if (settings.renderZones || highlight) {
    var zoneColor = style.getPropertyValue(highlight ? '--zone-color-highlight' : '--zone-color');
    drawZones(canvas, layer, zoneColor, highlight);
  }
  if (highlight && settings.renderPads) {
    var padColor = style.getPropertyValue('--pad-color-highlight');
    var padHoleColor = style.getPropertyValue('--pad-hole-color');
    var ctx = canvas.getContext("2d");
    for (var footprint of pcbdata.footprints) {
      // draw pads
      var padDrawn = false;
      for (var pad of footprint.pads) {
        if (highlightedNet != pad.net) continue;
        if (pad.layers.includes(layer)) {
          drawPad(ctx, pad, padColor, false);
          padDrawn = true;
        }
      }
      if (padDrawn) {
        // redraw all pad holes because some pads may overlap
        for (var pad of footprint.pads) {
          drawPadHole(ctx, pad, padHoleColor);
        }
      }
    }
  }
}

// Net name labels are drawn on the silk canvas, which sits *below* the highlight
// canvas. A highlighted net would therefore be painted over its own label, so the
// labels are drawn twice: once in the background pass, and again on the highlight
// canvas after the highlight is painted (see drawHighlightsOnLayer).
//
// One switch owns all of them: footprint pads, the free vias that reach the page
// as pads (see ecad/AD10.js) and the copper tracks. It sits outside the Pads and
// Tracks switches on purpose - those hide *shapes*, this one hides *names*, and
// chaining them would make the name switch appear dead whenever a shape switch
// was off. The one link kept is Hide Vias: a via that is gone from the board must
// not leave its name floating in empty space.
// Inner layers hold no footprints at all, so their pads pass is skipped and the
// separately exported vias are named instead; their tracks go through the shared
// pass below.
function drawNetLabels(canvas, layer, scalefactor) {
  if (!settings.renderNetNames) return;
  if (isInnerLayer(layer)) {
    drawInnerViaNetLabels(canvas, layer, scalefactor);
  } else {
    drawPadNetLabels(canvas, layer, scalefactor);
  }
  drawTrackNetLabels(canvas, layer, scalefactor);
}

function drawHighlightsOnLayer(canvasdict, clear = true) {
  if (clear) {
    clearCanvas(canvasdict.highlight);
  }
  if (highlightedFootprints.length > 0) {
    drawFootprints(canvasdict.highlight, canvasdict.layer,
      canvasdict.transform.s * canvasdict.transform.zoom, true);
  }
  if (highlightedNet !== null) {
    drawNets(canvasdict.highlight, canvasdict.layer, true);
    if (isInnerLayer(canvasdict.layer)) {
      drawInnerVias(canvasdict.highlight, canvasdict.layer,
        canvasdict.transform.s * canvasdict.transform.zoom, true);
    }
    drawNetLabels(canvasdict.highlight, canvasdict.layer, canvasdict.transform.s);
  }
}

function drawHighlights() {
  if (!allLayerDicts.length) {
    if (allcanvas && allcanvas.front) drawHighlightsOnLayer(allcanvas.front);
    if (allcanvas && allcanvas.back) drawHighlightsOnLayer(allcanvas.back);
    return;
  }
  for (var layerdict of allLayerDicts) {
    drawHighlightsOnLayer(layerdict);
  }
}

function drawBackground(canvasdict, clear = true) {
  if (clear) {
    clearCanvas(canvasdict.bg);
    clearCanvas(canvasdict.fab);
    clearCanvas(canvasdict.silk);
  }

  drawNets(canvasdict.bg, canvasdict.layer, false);
  drawFootprints(canvasdict.bg, canvasdict.layer,
    canvasdict.transform.s * canvasdict.transform.zoom, false);
  // Inner layers carry no footprints, but they do carry vias.
  if (isInnerLayer(canvasdict.layer)) {
    drawInnerVias(canvasdict.bg, canvasdict.layer,
      canvasdict.transform.s * canvasdict.transform.zoom, false);
  }

  drawEdgeCuts(canvasdict.bg, canvasdict.transform.s);

  var style = getComputedStyle(topmostdiv);
  var edgeColor = style.getPropertyValue('--silkscreen-edge-color');
  var polygonColor = style.getPropertyValue('--silkscreen-polygon-color');
  var textColor = style.getPropertyValue('--silkscreen-text-color');
  if (settings.renderSilkscreen) {
    drawBgLayer(
      "silkscreen", canvasdict.silk, canvasdict.layer,
      canvasdict.transform.s * canvasdict.transform.zoom,
      edgeColor, polygonColor, textColor);
  }

  // Auto-draw ref + value labels on top of silkscreen (drawn last so not covered)
  drawFootprintLabels(canvasdict.silk, canvasdict.layer, canvasdict.transform.s);
  drawNetLabels(canvasdict.silk, canvasdict.layer, canvasdict.transform.s);
  edgeColor = style.getPropertyValue('--fabrication-edge-color');
  polygonColor = style.getPropertyValue('--fabrication-polygon-color');
  textColor = style.getPropertyValue('--fabrication-text-color');
  if (settings.renderFabrication) {
    drawBgLayer(
      "fabrication", canvasdict.fab, canvasdict.layer,
      canvasdict.transform.s * canvasdict.transform.zoom,
      edgeColor, polygonColor, textColor);
  }
}

function prepareCanvas(canvas, flip, transform) {
  var ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  var fontsize = 1.55;
  ctx.scale(transform.zoom, transform.zoom);
  ctx.translate(transform.panx, transform.pany);
  if (flip) {
    ctx.scale(-1, 1);
  }
  ctx.translate(transform.x, transform.y);
  ctx.rotate(deg2rad(settings.boardRotation));
  ctx.scale(transform.s, transform.s);
}

function prepareLayer(canvasdict) {
  var flip = (canvasdict.layer == "B");
  for (var c of ["bg", "fab", "silk", "highlight"]) {
    prepareCanvas(canvasdict[c], flip, canvasdict.transform);
  }
}

function rotateVector(v, angle) {
  angle = deg2rad(angle);
  return [
    v[0] * Math.cos(angle) - v[1] * Math.sin(angle),
    v[0] * Math.sin(angle) + v[1] * Math.cos(angle)
  ];
}

function applyRotation(bbox) {
  var corners = [
    [bbox.minx, bbox.miny],
    [bbox.minx, bbox.maxy],
    [bbox.maxx, bbox.miny],
    [bbox.maxx, bbox.maxy],
  ];
  corners = corners.map((v) => rotateVector(v, settings.boardRotation));
  return {
    minx: corners.reduce((a, v) => Math.min(a, v[0]), Infinity),
    miny: corners.reduce((a, v) => Math.min(a, v[1]), Infinity),
    maxx: corners.reduce((a, v) => Math.max(a, v[0]), -Infinity),
    maxy: corners.reduce((a, v) => Math.max(a, v[1]), -Infinity),
  }
}

function recalcLayerScale(layerdict, width, height) {
  var bbox = applyRotation(pcbdata.edges_bbox);
  var scalefactor = 0.98 * Math.min(
    width / (bbox.maxx - bbox.minx),
    height / (bbox.maxy - bbox.miny)
  );
  if (scalefactor < 0.1) {
    scalefactor = 1;
  }
  layerdict.transform.s = scalefactor;
  var flip = (layerdict.layer == "B");
  if (flip) {
    layerdict.transform.x = -((bbox.maxx + bbox.minx) * scalefactor + width) * 0.5;
  } else {
    layerdict.transform.x = -((bbox.maxx + bbox.minx) * scalefactor - width) * 0.5;
  }
  layerdict.transform.y = -((bbox.maxy + bbox.miny) * scalefactor - height) * 0.5;
  for (var c of ["bg", "fab", "silk", "highlight"]) {
    canvas = layerdict[c];
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = (width / canvasPixelRatio()) + "px";
    canvas.style.height = (height / canvasPixelRatio()) + "px";
  }
}

// One broken layer must never take the rest of the board down with it - an
// exception used to stop the redraw loop here, leaving every later layer blank
// and aborting page init before the schematic was ever built.
var layerFailures = [];

function drawLayerGuarded(fn, layerdict, arg1, arg2, arg3) {
  try {
    fn(layerdict, arg1, arg2, arg3);
  } catch (e) {
    layerFailures.push((layerdict && layerdict.layer ? layerdict.layer : "?") +
      ": " + (e && e.message ? e.message : String(e)));
  }
}

function redrawCanvas(layerdict) {
  drawLayerGuarded(prepareLayer, layerdict);
  drawLayerGuarded(drawBackground, layerdict);
  drawLayerGuarded(drawHighlightsOnLayer, layerdict);
}

// Skipped shapes and failed layers are reported instead of being swallowed:
// the page tells you what it dropped.
function reportRenderProblems() {
  var lines = [];
  if (undrawableShapes.length) {
    lines.push(undrawableShapes.length +
      " 个无法绘制的图形被跳过（缺少坐标数据，通常来自 Keepout / 板挖空图元）");
  }
  if (layerFailures.length) {
    lines.push("层绘制失败: " + layerFailures.join("; "));
  }
  if (!lines.length) return;
  var box = document.getElementById("dbg");
  if (!box) return;
  box.textContent = lines.join("  |  ");
  box.style.display = "block";
}

// Repaint both sides. The space bar acts on a label whose layer we do not track
// (the selected label is just {ref, field}), so redrawing only the layer under
// the pointer would leave the other side stale.
function redrawAllLayers() {
  if (!allcanvas) return;
  for (var layerdict of allLayerDicts) {
    if (layerdict) redrawCanvas(layerdict);
  }
  reportRenderProblems();
}

function resizeCanvas(layerdict) {
  var div = layerdict.div;
  if (!div) {
    var canvasdivid = {
      "F": "frontcanvas",
      "B": "backcanvas"
    } [layerdict.layer];
    div = document.getElementById(canvasdivid);
  }
  if (!div) return;
  var width = div.clientWidth * canvasPixelRatio();
  var height = div.clientHeight * canvasPixelRatio();
  recalcLayerScale(layerdict, width, height);
  redrawCanvas(layerdict);
}

function resizeAll() {
  for (var layerdict of allLayerDicts) {
    if (layerdict) resizeCanvas(layerdict);
  }
  reportRenderProblems();
}

function pointWithinDistanceToSegment(x, y, x1, y1, x2, y2, d) {
  var A = x - x1;
  var B = y - y1;
  var C = x2 - x1;
  var D = y2 - y1;

  var dot = A * C + B * D;
  var len_sq = C * C + D * D;
  var dx, dy;
  if (len_sq == 0) {
    // start and end of the segment coincide
    dx = x - x1;
    dy = y - y1;
  } else {
    var param = dot / len_sq;
    var xx, yy;
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }
    dx = x - xx;
    dy = y - yy;
  }
  return dx * dx + dy * dy <= d * d;
}

function pointWithinPad(x, y, pad) {
  var v = [x - pad.pos[0], y - pad.pos[1]];
  v = rotateVector(v, -pad.angle);
  if (pad.offset) {
    v[0] -= pad.offset[0];
    v[1] -= pad.offset[1];
  }
  return emptyContext2d.isPointInPath(getCachedPadPath(pad), ...v);
}

function netHitScan(layer, x, y) {
  var inner = isInnerLayer(layer);
  // Check track segments (only tracks with net assigned)
  if (settings.renderTracks) {
    var tracks = copperList(layer, "tracks");
    if (tracks) {
      for (var track of tracks) {
        if (track.net && pointWithinDistanceToSegment(x, y, ...track.start, ...track.end, track.width / 2)) {
          return track.net;
        }
      }
    }
  }
  // Check pads (only pads with net assigned). Inner layers have no pads.
  if (settings.renderPads && !inner) {
    for (var footprint of pcbdata.footprints) {
      for(var pad of footprint.pads) {
        if (pad.net && pad.layers.includes(layer) && pointWithinPad(x, y, pad)) {
          return pad.net;
        }
      }
    }
  }
  // Vias on an inner layer: those layers have no pads, so this is the only way a
  // via can be picked there. They sit above the pour, hence before the zone scan.
  if (inner && settings.renderPads && pcbdata.vias) {
    for (var via of pcbdata.vias) {
      if (!via.net) continue;
      if (hideViasMode && via.drillsize && via.drillsize[0] <= 0.6) continue;
      if (!viaTouchesInnerLayer(via, layer)) continue;
      var radius = ((via.size && via.size[0]) ? via.size[0] : 0.6) / 2;
      var dx = x - via.pos[0], dy = y - via.pos[1];
      if (dx * dx + dy * dy <= radius * radius) {
        return via.net;
      }
    }
  }
  // Check copper pours (zones) last: they sit underneath tracks and pads, and
  // a click that lands on a poured net's own track/pad should prefer it. Zone
  // polygons share the board coordinate space (Y already flipped), so the same
  // point works with an identity-transform offscreen context.
  if (settings.renderZones) {
    var zones = copperList(layer, "zones");
    if (zones) {
      for (var zone of zones) {
        if (!zone.net) continue;
        var zonepath = getPolygonsPath(zone);
        if (!zonepath) continue;
        if (emptyContext2d.isPointInPath(zonepath, x, y)) {
          return zone.net;
        }
      }
    }
  }
  return null;
}

function pointWithinFootprintBbox(x, y, bbox) {
  var v = [x - bbox.pos[0], y - bbox.pos[1]];
  v = rotateVector(v, bbox.angle);
  return bbox.relpos[0] <= v[0] && v[0] <= bbox.relpos[0] + bbox.size[0] &&
         bbox.relpos[1] <= v[1] && v[1] <= bbox.relpos[1] + bbox.size[1];
}

function bboxHitScan(layer, x, y) {
  var result = [];
  for (var i = 0; i < pcbdata.footprints.length; i++) {
    var footprint = pcbdata.footprints[i];
    if (footprint.layer == layer) {
      if (pointWithinFootprintBbox(x, y, footprint.bbox)) {
        result.push(i);
      }
    }
  }
  return result;
}

function handlePointerDown(e, layerdict) {
  if (e.button != 0 && e.button != 1) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();

  if (!e.hasOwnProperty("offsetX")) {
    // The polyfill doesn't set this properly
    e.offsetX = e.pageX - e.currentTarget.offsetLeft;
    e.offsetY = e.pageY - e.currentTarget.offsetTop;
  }

  layerdict.pointerStates[e.pointerId] = {
    distanceTravelled: 0,
    lastX: e.offsetX,
    lastY: e.offsetY,
    // Backing-pixel position for pan/zoom anchoring; lastX/lastY stay in
    // offsetX units for the travel threshold and pinch distance ratios.
    lastBx: cursorCanvasPx(e, layerdict)[0],
    lastBy: cursorCanvasPx(e, layerdict)[1],
    downTime: Date.now(),
  };

  // Grabbing a label moves that label instead of panning the board. The
  // decision is made here, on the way down, because the label that was under
  // the pointer is the one the user meant to grab even if the pointer then
  // wanders off it.
  var v = boardPoint(e, layerdict);
  var grabbed = labelHitScan(layerdict.layer, v[0], v[1],
    boardMmPerPixel(layerdict));
  if (grabbed) {
    // Clicking a label also selects it, so the space bar works right after a
    // click without requiring the pointer to stay on the text.
    selectedLabel = { ref: grabbed.ref, field: grabbed.field };
  }
  layerdict.labelDrag = grabbed ? {
    label: grabbed,
    startX: v[0],
    startY: v[1],
    base: labelOffset(grabbed.ref, grabbed.field),
  } : null;
}

// Highlight a label as grabbable while the pointer hovers it and nothing is
// being dragged, so the labels look movable instead of only being so.
// The cursor has to be set on the canvases as well as the container: the
// canvases sit on top, the stylesheet gives them their own `crosshair`, and so
// the container's cursor is never the one on screen.
function handleLabelHover(e, layerdict, div) {
  if (!e.hasOwnProperty("offsetX")) {
    e.offsetX = e.pageX - e.currentTarget.offsetLeft;
    e.offsetY = e.pageY - e.currentTarget.offsetTop;
  }
  var v = boardPoint(e, layerdict);
  var hit = labelHitScan(layerdict.layer, v[0], v[1],
    boardMmPerPixel(layerdict));
  // Hovering a label selects it, which is what the space bar acts on. Moving off
  // every label clears the selection so space cannot spin something off-screen.
  if (hit) {
    selectedLabel = { ref: hit.ref, field: hit.field };
  } else if (sameLabel(selectedLabel, layerdict.lastHoverLabel)) {
    selectedLabel = null;
  }
  layerdict.lastHoverLabel = hit ? { ref: hit.ref, field: hit.field } : null;
  // A different cursor while hovering tells the user the label is grabbable;
  // the space bar is advertised in the menu hint instead, since a cursor cannot
  // say "press space".
  var cursor = hit ? "move" : "";
  if (layerdict.hoverCursor === cursor) {
    return;
  }
  layerdict.hoverCursor = cursor;
  for (var element of [div, layerdict.bg, layerdict.fab, layerdict.silk,
                       layerdict.highlight]) {
    if (element) {
      element.style.cursor = cursor;
    }
  }
}

// Double-clicking a label drops its nudge, putting it back where the footprint
// wants it. A spin is undone at the same time, so "double click to put it back"
// means fully back rather than back-but-still-sideways.
function handleLabelDoubleClick(e, layerdict) {
  if (!e.hasOwnProperty("offsetX")) {
    e.offsetX = e.pageX - e.currentTarget.offsetLeft;
    e.offsetY = e.pageY - e.currentTarget.offsetTop;
  }
  var v = boardPoint(e, layerdict);
  var hit = labelHitScan(layerdict.layer, v[0], v[1],
    boardMmPerPixel(layerdict));
  if (hit) {
    clearLabelOffset(hit.ref, hit.field);
    clearLabelRotation(hit.ref, hit.field);
    redrawCanvas(layerdict);
  }
}

function handleMouseClick(e, layerdict) {
  if (!e.hasOwnProperty("offsetX")) {
    // The polyfill doesn't set this properly
    e.offsetX = e.pageX - e.currentTarget.offsetLeft;
    e.offsetY = e.pageY - e.currentTarget.offsetTop;
  }

  var v = boardPoint(e, layerdict);
  if ("nets" in pcbdata) {
    var net = netHitScan(layerdict.layer, ...v);
    if (net !== highlightedNet) {
      netClicked(net);
    }
  }
  if (highlightedNet === null) {
    var footprints = bboxHitScan(layerdict.layer, ...v);
    if (footprints.length > 0) {
      footprintsClicked(footprints);
    } else if (currentHighlightedRowId) {
      // An empty spot of the board drops the selection, the same way an
      // empty click on the schematic pane does. The empty highlight event
      // also clears the schematic pane's own highlight/pick state.
      clearHighlightedFootprints();
      drawHighlights();
      EventHandler.emitEvent(IBOM_EVENT_TYPES.HIGHLIGHT_EVENT, { refs: [] });
    }
  }
}

function handlePointerLeave(e, layerdict) {
  e.preventDefault();
  e.stopPropagation();

  if (layerdict.labelDrag) {
    saveLabelOffsets();
    layerdict.labelDrag = null;
  }
  if (layerdict.hoverCursor) {
    layerdict.hoverCursor = "";
  }

  if (!settings.redrawOnDrag) {
    redrawCanvas(layerdict);
  }

  delete layerdict.pointerStates[e.pointerId];
}

function resetTransform(layerdict) {
  layerdict.transform.panx = 0;
  layerdict.transform.pany = 0;
  layerdict.transform.zoom = 1;
  redrawCanvas(layerdict);
}

function handlePointerUp(e, layerdict) {
  if (!e.hasOwnProperty("offsetX")) {
    // The polyfill doesn't set this properly
    e.offsetX = e.pageX - e.currentTarget.offsetLeft;
    e.offsetY = e.pageY - e.currentTarget.offsetTop;
  }

  e.preventDefault();
  e.stopPropagation();

  if (layerdict.labelDrag) {
    // A drag in progress ends here, whether the pointer moved or not. Writing
    // storage once per drag instead of once per pointermove keeps the drag
    // smooth on large boards.
    saveLabelOffsets();
    layerdict.labelDrag = null;
  }

  if (e.button == 2) {
    // Reset pan and zoom on right click.
    resetTransform(layerdict);
    layerdict.anotherPointerTapped = false;
    return;
  }

  // We haven't necessarily had a pointermove event since the interaction started, so make sure we update this now
  var ptr = layerdict.pointerStates[e.pointerId];
  ptr.distanceTravelled += Math.abs(e.offsetX - ptr.lastX) + Math.abs(e.offsetY - ptr.lastY);

  if (e.button == 0 && ptr.distanceTravelled < 10 && Date.now() - ptr.downTime <= 500) {
    if (Object.keys(layerdict.pointerStates).length == 1) {
      if (layerdict.anotherPointerTapped) {
        // This is the second pointer coming off of a two-finger tap
        resetTransform(layerdict);
      } else {
        // This is just a regular tap
        handleMouseClick(e, layerdict);
      }
      layerdict.anotherPointerTapped = false;
    } else {
      // This is the first finger coming off of what could become a two-finger tap
      layerdict.anotherPointerTapped = true;
    }
  } else {
    if (!settings.redrawOnDrag) {
      redrawCanvas(layerdict);
    }
    layerdict.anotherPointerTapped = false;
  }

  delete layerdict.pointerStates[e.pointerId];
}

function handlePointerMove(e, layerdict) {
  if (!layerdict.pointerStates.hasOwnProperty(e.pointerId)) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();

  if (!e.hasOwnProperty("offsetX")) {
    // The polyfill doesn't set this properly
    e.offsetX = e.pageX - e.currentTarget.offsetLeft;
    e.offsetY = e.pageY - e.currentTarget.offsetTop;
  }

  var thisPtr = layerdict.pointerStates[e.pointerId];

  var dx = e.offsetX - thisPtr.lastX;
  var dy = e.offsetY - thisPtr.lastY;

  // If this number is low on pointer up, we count the action as a click
  thisPtr.distanceTravelled += Math.abs(dx) + Math.abs(dy);

  var pointerCount = Object.keys(layerdict.pointerStates).length;
  if (layerdict.labelDrag) {
    if (pointerCount == 1) {
      // Move the grabbed label and leave the board where it is. The offset
      // tracks the pointer in board millimetres, so it follows the cursor
      // exactly at any zoom, rotation or mirroring.
      var v = boardPoint(e, layerdict);
      setLabelOffset(
        layerdict.labelDrag.label.ref, layerdict.labelDrag.label.field,
        layerdict.labelDrag.base[0] + v[0] - layerdict.labelDrag.startX,
        layerdict.labelDrag.base[1] + v[1] - layerdict.labelDrag.startY,
        false);
      thisPtr.lastX = e.offsetX;
      thisPtr.lastY = e.offsetY;
      redrawCanvas(layerdict);
      return;
    }
    // A second pointer means the user wants to pinch-zoom, so the label goes
    // back to the pan/zoom path.
    saveLabelOffsets();
    layerdict.labelDrag = null;
  }

  var b = cursorCanvasPx(e, layerdict);
  if (Object.keys(layerdict.pointerStates).length == 1) {
    // This is a simple drag. Pan deltas are taken in canvas backing pixels so
    // the board tracks the pointer exactly at any UI scale - e.offsetX mixes
    // unit conventions under body CSS zoom (see cursorCanvasPx).
    layerdict.transform.panx += (b[0] - thisPtr.lastBx) / layerdict.transform.zoom;
    layerdict.transform.pany += (b[1] - thisPtr.lastBy) / layerdict.transform.zoom;
  } else if (Object.keys(layerdict.pointerStates).length == 2) {
    var otherPtr = Object.values(layerdict.pointerStates).filter((ptr) => ptr != thisPtr)[0];

    var oldDist = Math.sqrt(Math.pow(thisPtr.lastX - otherPtr.lastX, 2) + Math.pow(thisPtr.lastY - otherPtr.lastY, 2));
    var newDist = Math.sqrt(Math.pow(e.offsetX - otherPtr.lastX, 2)     + Math.pow(e.offsetY - otherPtr.lastY, 2));

    var scaleFactor = newDist/oldDist;

    if (scaleFactor != NaN) {
      layerdict.transform.zoom *= scaleFactor;

      var zoomd = (1 - scaleFactor) / layerdict.transform.zoom;
      layerdict.transform.panx += otherPtr.lastBx * zoomd;
      layerdict.transform.pany += otherPtr.lastBy * zoomd;
    }
  }

  thisPtr.lastX = e.offsetX;
  thisPtr.lastY = e.offsetY;
  thisPtr.lastBx = b[0];
  thisPtr.lastBy = b[1];

  if (settings.redrawOnDrag) {
    redrawCanvas(layerdict);
  }
}

function handleMouseWheel(e, layerdict) {
  e.preventDefault();
  e.stopPropagation();
  var t = layerdict.transform;
  var wheeldelta = e.deltaY;
  if (e.deltaMode == 1) {
    // FF only, scroll by lines
    wheeldelta *= 30;
  } else if (e.deltaMode == 2) {
    wheeldelta *= 300;
  }
  var m = Math.pow(1.1, -wheeldelta / 40);
  // Limit amount of zoom per tick.
  if (m > 2) {
    m = 2;
  } else if (m < 0.5) {
    m = 0.5;
  }
  t.zoom *= m;
  var zoomd = (1 - m) / t.zoom;
  // Zoom around the cursor in backing pixels (visual-space measurement, see
  // cursorCanvasPx) so the point under the wheel stays put at any UI scale.
  var b = cursorCanvasPx(e, layerdict);
  t.panx += b[0] * zoomd;
  t.pany += b[1] * zoomd;
  redrawCanvas(layerdict);
}

function addMouseHandlers(div, layerdict) {
  div.addEventListener("pointerdown", function(e) {
    handlePointerDown(e, layerdict);
  });
  div.addEventListener("pointermove", function(e) {
    // Hover feedback only while no button is down; anything else is a drag.
    if (Object.keys(layerdict.pointerStates).length === 0) {
      handleLabelHover(e, layerdict, div);
    }
    handlePointerMove(e, layerdict);
  });
  div.addEventListener("pointerup", function(e) {
    handlePointerUp(e, layerdict);
  });
  // Not part of the pointer contract, so it is a plain DOM listener.
  div.addEventListener("dblclick", function(e) {
    handleLabelDoubleClick(e, layerdict);
  });
  var pointerleave = function(e) {
    handlePointerLeave(e, layerdict);
  }
  div.addEventListener("pointercancel", pointerleave);
  div.addEventListener("pointerleave", pointerleave);
  div.addEventListener("pointerout", pointerleave);

  div.onwheel = function(e) {
    handleMouseWheel(e, layerdict);
  }
  for (var element of [div, layerdict.bg, layerdict.fab, layerdict.silk, layerdict.highlight]) {
    element.addEventListener("contextmenu", function(e) {
      e.preventDefault();
    }, false);
  }
}

function setRedrawOnDrag(value) {
  settings.redrawOnDrag = value;
  writeStorage("redrawOnDrag", value);
}

function setBoardRotation(value) {
  settings.boardRotation = value * 5;
  writeStorage("boardRotation", settings.boardRotation);
  document.getElementById("rotationDegree").textContent = settings.boardRotation;
  resizeAll();
}

// inner-layer read model: every draw below keys copper by layer id, and an inner
// layer answers with its own tracks/zones instead of the faces' ones.
// Readable label for a layer name coming out of Altium ("MidLayer2", "Plane1").
function innerLayerLabel(name, idx) {
  var n = name || "";
  var isPlane = /^plane/i.test(n);
  if (!isPlane && !/mid/i.test(n)) return n;
  // Read the capture off the match itself. RegExp.$1 (the legacy static) looks
  // shorter but is a global last-match snapshot: any other regex call in
  // between, or a build step that doubles "$", silently turns the label into
  // "中间层undefined".
  var num = /(\d+)/.exec(n);
  return (isPlane ? "\u5185\u7535\u5c42" : "\u4e2d\u95f4\u5c42") + (num ? num[1] : idx);
}

// One canvas stack per inner layer, inserted between the two faces so the split
// can hand every layer its own pane. Mirrors the markup of #frontcanvas.
function createInnerLayerViews(inners) {
  var back = document.getElementById("backcanvas");
  if (!back || !back.parentNode) return [];
  var made = [];
  for (var i = 0; i < inners.length; i++) {
    var idx = i + 1;
    var id = "innercanvas" + idx;
    if (document.getElementById(id)) continue;
    var wrapper = document.createElement("div");
    wrapper.id = id;
    wrapper.className = "split";
    wrapper.setAttribute("touch-action", "none");
    wrapper.style.overflow = "hidden";
    var inner = document.createElement("div");
    inner.style.position = "relative";
    inner.style.width = "100%";
    inner.style.height = "100%";
    ["bg", "fab", "slk", "hl"].forEach(function(suffix, z) {
      var c = document.createElement("canvas");
      c.id = "In" + idx + "_" + suffix;
      c.style.position = "absolute";
      c.style.left = "0";
      c.style.top = "0";
      c.style.zIndex = String(z);
      inner.appendChild(c);
    });
    var label = document.createElement("div");
    label.className = "inner-layer-label";
    label.textContent = innerLayerLabel(inners[i].name, idx);
    inner.appendChild(label);
    wrapper.appendChild(inner);
    back.parentNode.insertBefore(wrapper, back);
    made.push(id);
  }
  return made;
}

function newLayerDict(layer) {
  return {
    transform: {
      x: 0,
      y: 0,
      s: 1,
      panx: 0,
      pany: 0,
      zoom: 1,
    },
    pointerStates: {},
    anotherPointerTapped: false,
    labelDrag: null,
    hoverCursor: "",
    bg: document.getElementById(layer + "_bg"),
    fab: document.getElementById(layer + "_fab"),
    silk: document.getElementById(layer + "_slk"),
    highlight: document.getElementById(layer + "_hl"),
    layer: layer,
    div: null,
  };
}

function initRender() {
  innerLayerData = {};
  innerLayerOrder = [];
  allLayerDicts = [];
  if (pcbdata.inners && pcbdata.inners.length) {
    createInnerLayerViews(pcbdata.inners);
    for (var i = 0; i < pcbdata.inners.length; i++) {
      var layerkey = "In" + (i + 1);
      innerLayerData[layerkey] = {
        name: pcbdata.inners[i].name || ("Layer" + (i + 1)),
        layerid: pcbdata.inners[i].layerid,
        tracks: pcbdata.inners[i].tracks || [],
        zones: pcbdata.inners[i].zones || []
      };
      innerLayerOrder.push(layerkey);
    }
  }
  allcanvas = {
    front: newLayerDict("F"),
    back: newLayerDict("B")
  };
  allcanvas.front.div = document.getElementById("frontcanvas");
  allcanvas.back.div = document.getElementById("backcanvas");
  allLayerDicts = [allcanvas.front];
  for (var k = 0; k < innerLayerOrder.length; k++) {
    var dict = newLayerDict(innerLayerOrder[k]);
    dict.div = document.getElementById("innercanvas" + (k + 1));
    allcanvas[innerLayerOrder[k]] = dict;
    allLayerDicts.push(dict);
  }
  allLayerDicts.push(allcanvas.back);
  for (var layerdict of allLayerDicts) {
    if (layerdict && layerdict.div) {
      addMouseHandlers(layerdict.div, layerdict);
    }
  }
}
