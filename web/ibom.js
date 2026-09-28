/* DOM manipulation and misc code */

var bomsplit;
var canvassplit;
var bomcolgroup;
// Rows are appended to this element. Declared here instead of relying on the
// browser's implicit id -> window global, which is not available everywhere.
var bombody;
var initDone = false;
var bomSortFunction = null;
var currentSortColumn = null;
var currentSortOrder = null;
var currentHighlightedRowId;
var highlightHandlers = [];
var footprintIndexToHandler = {};
var netsToHandler = {};
// Reference designator -> the row handler that highlights that row. Built as
// the table is populated and read by the schematic pane, which needs to turn a
// picked symbol back into "highlight this BOM row (and its footprints)".
var refToHandler = {};
var highlightedFootprints = [];
var highlightedNet = null;
var lastClicked;

// BOM column customisation: user-chosen order and per-column widths.
// Both are persisted separately so resetting one does not clobber the other.
var bomColumnOrder = [];
var bomColumnWidths = {};
// Minimum width a column may be dragged down to, in CSS pixels.
var BOM_COL_MIN_WIDTH = 24;
// How far the pointer must travel before a header mousedown counts as a drag
// rather than a click on the sort gesture.
var BOM_DRAG_THRESHOLD = 5;
// Width of the grip strip along the right edge of a header that starts a resize.
var BOM_RESIZE_EDGE = 7;
// Width a checkbox column starts with: enough room for the name to stay on one
// line without crowding the data columns. Widening or narrowing it is a drag
// away, and the result is remembered per board.
var BOM_CHECKBOX_WIDTH = "70px";
// Live drag state, non-null while resizing or moving a column.
var bomDragState = null;
// Set for one tick after a drag so the synthetic click that follows mouseup
// does not also trigger sorting.
var bomDragJustEnded = false;
// The active sort is tracked by column id rather than by DOM node, because the
// header row is rebuilt every time the column order changes.
var currentSortColId = null;
// id -> {comparator}, rebuilt alongside the header, used to restore sorting.
var bomColumnById = {};

function dbg(html) {
  dbgdiv.innerHTML = html;
}

// Every BOM column, in the order they appear out of the box, including the row
// number and the checkbox columns — those are movable too, so nothing is pinned.
//
// Default order is
//     Row | <checkboxes> | Description | Value | Footprint | References | Quantity
// with Description leading the data columns instead of upstream's
// References-first layout: with a Chinese Description column the rows are much
// easier to scan when the part name comes first.
// That gives, for example, "贴片电阻 | 10K | R0603 | R1, R2, R3 | 3".
function bomColumnSpecs() {
  var specs = [];
  if (settings.bommode == "netlist") {
    specs.push({
      id: "netname",
      title: "网络名",
      cls: "bom-netname",
      width: "200px",
      comparator: (a, b) => {
        if (a > b) return -1;
        if (a < b) return 1;
        return 0;
      },
    });
    return specs;
  }
  // Build the parts separately so they can be assembled in the new default
  // order without duplicating any of the comparator bodies.
  var referencesSpec = {
    id: "references",
    title: "位号",
    cls: "References",
    width: "180px",
    comparator: (a, b) => {
      var i = 0;
      while (i < a[3].length && i < b[3].length) {
        if (a[3][i] != b[3][i]) return a[3][i] > b[3][i] ? 1 : -1;
        i++;
      }
      return a[3].length - b[3].length;
    },
  };
  var extraSpecs = [];
  for (var i in config.extra_fields) {
    extraSpecs.push({
      id: "extra" + i,
      title: config.extra_fields[i],
      cls: "extra",
      width: "120px",
      comparator: (function(fieldIndex) {
        return (a, b) => {
          var fa = a[4][fieldIndex];
          var fb = b[4][fieldIndex];
          if (fa != fb) return fa > fb ? 1 : -1;
          else return 0;
        }
      })(i),
    });
  }
  specs.push({
    id: "rownum",
    title: "",
    cls: "numCol",
    width: "30px",
    comparator: null,
  });
  for (var checkbox of settings.checkboxes) {
    specs.push({
      id: checkboxColId(checkbox),
      title: checkbox,
      cls: "bom-checkbox",
      width: BOM_CHECKBOX_WIDTH,
      comparator: null,
    });
  }
  specs.push({
    id: "description",
    title: "描述",
    cls: "Description",
    width: "150px",
    comparator: (a, b) => {
      var da = a[6] == null ? "" : a[6];
      var db = b[6] == null ? "" : b[6];
      if (da != db) return da > db ? 1 : -1;
      else return 0;
    },
  });
  specs.push({
    id: "value",
    title: "参数",
    cls: "Value",
    width: "110px",
    comparator: (a, b) => valueCompare(a[5], b[5], a[1], b[1]),
  });
  specs.push({
    id: "footprint",
    title: "封装",
    cls: "Footprint",
    width: "120px",
    comparator: (a, b) => {
      if (a[2] != b[2]) return a[2] > b[2] ? 1 : -1;
      else return 0;
    },
  });
  specs.push(referencesSpec);
  for (var extraSpec of extraSpecs) {
    specs.push(extraSpec);
  }
  if (settings.bommode == "grouped") {
    specs.push({
      id: "quantity",
      title: "数量",
      cls: "Quantity",
      width: "70px",
      comparator: (a, b) => a[3].length - b[3].length,
    });
  }
  return specs;
}

// Apply the stored order to the spec list. Unknown ids are dropped (the column
// set changes with bommode and extra_fields) and newly appeared ids are
// appended in their default position, so a stale stored order never loses a
// column.
function orderedBomColumns() {
  var specs = bomColumnSpecs();
  var byId = {};
  for (var spec of specs) {
    byId[spec.id] = spec;
  }
  var result = [];
  var used = {};
  // Orders saved before the row number and checkbox columns became movable only
  // list the data columns, because those two were pinned to the far left. Keep
  // them there for such an order instead of dropping them to the end.
  var knowsLeading = false;
  for (var id of bomColumnOrder) {
    if (id === "rownum" || String(id).indexOf("checkbox:") === 0) {
      knowsLeading = true;
      break;
    }
  }
  if (bomColumnOrder.length && !knowsLeading) {
    for (var spec of specs) {
      if (spec.id === "rownum" || String(spec.id).indexOf("checkbox:") === 0) {
        result.push(spec);
        used[spec.id] = true;
      }
    }
  }
  for (var id of bomColumnOrder) {
    if (byId[id] && !used[id]) {
      result.push(byId[id]);
      used[id] = true;
    }
  }
  for (var spec of specs) {
    if (!used[spec.id]) {
      result.push(spec);
    }
  }
  return result;
}

function readBomColumnPrefs() {
  var order = readStorage("bomColumnOrder");
  if (order) {
    try {
      var parsed = JSON.parse(order);
      if (Array.isArray(parsed)) {
        bomColumnOrder = parsed;
      }
    } catch (e) { /* ignore malformed setting */ }
  }
  var widths = readStorage("bomColumnWidths");
  if (widths) {
    try {
      var parsedWidths = JSON.parse(widths);
      if (parsedWidths && typeof parsedWidths == "object") {
        bomColumnWidths = parsedWidths;
      }
    } catch (e) { /* ignore malformed setting */ }
  }
}

function resetBomColumns() {
  bomColumnOrder = [];
  bomColumnWidths = {};
  writeStorage("bomColumnOrder", "");
  writeStorage("bomColumnWidths", "");
  if (initDone) {
    populateBomTable();
  }
}

// Paint the column widths onto a <colgroup>. table-layout is fixed, so the
// colgroup is what actually decides the widths; the .bom .<cls> CSS rules are
// only the defaults the colgroup copies are seeded from.
function applyBomColumnWidths() {
  if (!bomcolgroup) {
    return;
  }
  for (var i = 0; i < bomcolgroup.childNodes.length; i++) {
    var col = bomcolgroup.childNodes[i];
    var id = col.getAttribute("data-col-id");
    var width = id ? bomColumnWidths[id] : null;
    col.style.width = width ? width + "px" : (col.getAttribute("data-width") || "");
  }
}

function setBomColumnWidth(id, px) {
  bomColumnWidths[id] = px;
  writeStorage("bomColumnWidths", JSON.stringify(bomColumnWidths));
}

function bomColWidth(col) {
  if (!col) {
    return 0;
  }
  return col.getBoundingClientRect().width || col.offsetWidth || 0;
}

function redrawIfInitDone() {
  if (initDone) {
    redrawCanvas(allcanvas.front);
    redrawCanvas(allcanvas.back);
  }
}

function padsVisible(value) {
  writeStorage("padsVisible", value);
  settings.renderPads = value;
  redrawIfInitDone();
}

// The menu switch is the positive one ("过孔", ticked = drawn). Everything on
// the render side asks the negative question (hideViasMode), so the inversion
// lives here and nowhere else.
function viasVisible(value) {
  writeStorage("viasVisible", value);
  settings.renderVias = value;
  hideVias(!value);
}

function referencesVisible(value) {
  writeStorage("referencesVisible", value);
  settings.renderReferences = value;
  redrawIfInitDone();
}

function valuesVisible(value) {
  writeStorage("valuesVisible", value);
  settings.renderValues = value;
  redrawIfInitDone();
}

// The reference / value text Altium itself placed on the silkscreen. Kept apart
// from referencesVisible / valuesVisible, which own the labels this page draws,
// so the two sources can be shown independently and told apart.
function nativeLabelsVisible(value) {
  writeStorage("nativeLabelsVisible", value);
  settings.renderNativeLabels = value;
  redrawIfInitDone();
}

function tracksVisible(value) {
  writeStorage("tracksVisible", value);
  settings.renderTracks = value;
  redrawIfInitDone();
}

function zonesVisible(value) {
  writeStorage("zonesVisible", value);
  settings.renderZones = value;
  redrawIfInitDone();
}

// One switch for every net name on the board - pad, via and track alike. It used
// to be "track nets" only; util.js seeds the new storage key from the old one so
// an existing board keeps whatever the user had chosen.
function netNamesVisible(value) {
  writeStorage("netNamesVisible", value);
  settings.renderNetNames = value;
  redrawIfInitDone();
}

function dnpOutline(value) {
  writeStorage("dnpOutline", value);
  settings.renderDnpOutline = value;
  redrawIfInitDone();
}

// Show/hide components whose AD Type is "Standard (No BOM)" / "Net Tie (No BOM)".
// Unlike the other filters this one only changes the page: the no-BOM rows and
// footprint indices ship inside pcbdata, so toggling needs no script re-run.
function noBomVisible(value) {
  writeStorage("noBomVisible", value);
  settings.showNoBom = value;
  // The BOM table may not exist yet while settings are being restored; the table
  // is built later from settings.showNoBom, so only rebuild once initialised.
  if (initDone) {
    populateBomTable();
  }
  redrawIfInitDone();
}

function setDarkMode(value) {
  if (value) {
    topmostdiv.classList.add("dark");
  } else {
    topmostdiv.classList.remove("dark");
  }
  writeStorage("darkmode", value);
  settings.darkMode = value;
  redrawIfInitDone();
}

function setFullscreen(value) {
  if (value) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}

function fabricationVisible(value) {
  writeStorage("fabricationVisible", value);
  settings.renderFabrication = value;
  redrawIfInitDone();
}

function silkscreenVisible(value) {
  writeStorage("silkscreenVisible", value);
  settings.renderSilkscreen = value;
  redrawIfInitDone();
}

function setHighlightPin1(value) {
  writeStorage("highlightpin1", value);
  settings.highlightpin1 = value;
  redrawIfInitDone();
}

// ---- Footprint reference / value labels -----------------------------------
// The labels themselves are drawn by drawFootprintLabels() in render.js; these
// are the three menu controls plus their storage.

// One size for every label instead of a size derived from each footprint's
// bounding box.
function setUniformLabelSize(value) {
  writeStorage("uniformLabelSize", value);
  settings.uniformLabelSize = value;
  // [2026-09-25] The sliders show the size that is in effect, so toggling the
  // uniform switch has to refresh them too.
  applyLabelFontSizeInputs();
  redrawIfInitDone();
}

// The sliders are in steps of 0.05mm, which keeps the values readable while
// still covering the whole useful range with the same control.
var LABEL_SIZE_SLIDER_STEP = 20;

function setLabelFontSize(field, value) {
  var mm = value / LABEL_SIZE_SLIDER_STEP;
  if (!(mm > 0)) {
    return;
  }
  if (field === "ref") {
    settings.refFontSize = mm;
    writeStorage("refFontSize", mm);
  } else if (field === "net") {
    // Net names ignore the uniform-size switch: they label copper, not
    // footprints, so there is no per-footprint auto size to fall back to.
    settings.netFontSize = mm;
    writeStorage("netFontSize", mm);
    applyLabelFontSizeInputs();
    redrawIfInitDone();
    return;
  } else {
    settings.valFontSize = mm;
    writeStorage("valFontSize", mm);
  }
  // [2026-09-25] Uniform sizing is the only mode now (the checkbox made way
  // for the "reset font sizes" button), so a slider pick is always effective.
  applyLabelFontSizeInputs();
  redrawIfInitDone();
}

function applyLabelFontSizeInputs() {
  var refSlider = document.getElementById("refFontSize");
  var valSlider = document.getElementById("valFontSize");
  var netSlider = document.getElementById("netFontSize");
  var refOutput = document.getElementById("refFontSizeValue");
  var valOutput = document.getElementById("valFontSizeValue");
  var netOutput = document.getElementById("netFontSizeValue");
  if (refSlider) {
    refSlider.value = Math.round(settings.refFontSize * LABEL_SIZE_SLIDER_STEP);
  }
  if (valSlider) {
    valSlider.value = Math.round(settings.valFontSize * LABEL_SIZE_SLIDER_STEP);
  }
  if (netSlider) {
    netSlider.value = Math.round(settings.netFontSize * LABEL_SIZE_SLIDER_STEP);
  }
  if (refOutput) {
    refOutput.textContent = settings.refFontSize.toFixed(2);
  }
  if (valOutput) {
    valOutput.textContent = settings.valFontSize.toFixed(2);
  }
  if (netOutput) {
    netOutput.textContent = Math.max(0, settings.netFontSize).toFixed(2);
  }
}

// [2026-09-25] "重置字体大小": put all three label sizes back to their
// defaults - references/values to the board's auto median, net names to the
// screen-adaptive default. The stored sizes are cleared, so on another screen
// or window size the adaptive defaults apply again instead of the old picks.
function resetFontSizes() {
  var defSize = defaultLabelFontSize();
  settings.refFontSize = defSize;
  settings.valFontSize = defSize;
  settings.netFontSize = autoNetFontSize();
  removeStorage("refFontSize");
  removeStorage("valFontSize");
  removeStorage("netFontSize");
  setUniformLabelSize(true);
  applyLabelFontSizeInputs();
  redrawIfInitDone();
}

// Put every label back where its footprint wants it. The sizes are left alone.
// The hand-set angles go back too: "Reset labels" undoes every manual change to
// the labels' placement, which includes a spin.
function resetLabelOffsets() {
  settings.labelOffsets = {};
  saveLabelOffsets();
  settings.labelRotations = {};
  saveLabelRotations();
  redrawIfInitDone();
}

function getStoredCheckboxRefs(checkbox) {
  function convert(ref) {
    var intref = parseInt(ref);
    if (isNaN(intref)) {
      for (var i = 0; i < pcbdata.footprints.length; i++) {
        if (pcbdata.footprints[i].ref == ref) {
          return i;
        }
      }
      return -1;
    } else {
      return intref;
    }
  }
  if (!(checkbox in settings.checkboxStoredRefs)) {
    var val = readStorage("checkbox_" + checkbox);
    settings.checkboxStoredRefs[checkbox] = val ? val : "";
  }
  if (!settings.checkboxStoredRefs[checkbox]) {
    return new Set();
  } else {
    return new Set(settings.checkboxStoredRefs[checkbox].split(",").map(r => convert(r)).filter(a => a >= 0));
  }
}

function getCheckboxState(checkbox, references) {
  var storedRefsSet = getStoredCheckboxRefs(checkbox);
  var currentRefsSet = new Set(references.map(r => r[1]));
  // Get difference of current - stored
  var difference = new Set(currentRefsSet);
  for (ref of storedRefsSet) {
    difference.delete(ref);
  }
  if (difference.size == 0) {
    // All the current refs are stored
    return "checked";
  } else if (difference.size == currentRefsSet.size) {
    // None of the current refs are stored
    return "unchecked";
  } else {
    // Some of the refs are stored
    return "indeterminate";
  }
}

function setBomCheckboxState(checkbox, element, references) {
  var state = getCheckboxState(checkbox, references);
  element.checked = (state == "checked");
  element.indeterminate = (state == "indeterminate");
}

function createCheckboxChangeHandler(checkbox, references, row) {
  return function() {
    refsSet = getStoredCheckboxRefs(checkbox);
    var darkenWhenChecked = settings.darkenWhenChecked == checkbox;
    eventArgs = {
      checkbox: checkbox,
      refs: references,
    }
    if (this.checked) {
      // checkbox ticked
      for (var ref of references) {
        refsSet.add(ref[1]);
      }
      if (darkenWhenChecked) {
        row.classList.add("checked");
      }
      eventArgs.state = 'checked';
    } else {
      // checkbox unticked
      for (var ref of references) {
        refsSet.delete(ref[1]);
      }
      if (darkenWhenChecked) {
        row.classList.remove("checked");
      }
      eventArgs.state = 'unchecked';
    }
    settings.checkboxStoredRefs[checkbox] = [...refsSet].join(",");
    writeStorage("checkbox_" + checkbox, settings.checkboxStoredRefs[checkbox]);
    updateCheckboxStats(checkbox);
    EventHandler.emitEvent(IBOM_EVENT_TYPES.CHECKBOX_CHANGE_EVENT, eventArgs);
  }
}

function clearHighlightedFootprints() {
  if (currentHighlightedRowId) {
    document.getElementById(currentHighlightedRowId).classList.remove("highlighted");
    currentHighlightedRowId = null;
    highlightedFootprints = [];
    highlightedNet = null;
  }
}

function createRowHighlightHandler(rowid, refs, net) {
  return function() {
    if (currentHighlightedRowId) {
      if (currentHighlightedRowId == rowid) {
        return;
      }
      document.getElementById(currentHighlightedRowId).classList.remove("highlighted");
    }
    document.getElementById(rowid).classList.add("highlighted");
    currentHighlightedRowId = rowid;
    highlightedFootprints = refs ? refs.map(r => r[1]) : [];
    highlightedNet = net;
    drawHighlights();
    EventHandler.emitEvent(
      IBOM_EVENT_TYPES.HIGHLIGHT_EVENT,
      {
        rowid: rowid,
        refs: refs,
        net: net
      });
  }
}

function entryMatches(entry) {
  if (settings.bommode == "netlist") {
    // entry is just a net name
    return entry.toLowerCase().indexOf(filter) >= 0;
  }
  // check refs
  for (var ref of entry[3]) {
    if (ref[0].toLowerCase().indexOf(filter) >= 0) {
      return true;
    }
  }
  // check extra fields
  for (var i in config.extra_fields) {
    if (entry[4][i].toLowerCase().indexOf(filter) >= 0) {
      return true;
    }
  }
  // check description
  if (entry[6] != null && entry[6].toLowerCase().indexOf(filter) >= 0) {
    return true;
  }
  // check value
  if (entry[1].toLowerCase().indexOf(filter) >= 0) {
    return true;
  }
  // check footprint
  if (entry[2].toLowerCase().indexOf(filter) >= 0) {
    return true;
  }
  return false;
}

function findRefInEntry(entry) {
  return entry[3].filter(r => r[0].toLowerCase() == reflookup);
}

function highlightFilter(s) {
  if (!filter) {
    return s;
  }
  var parts = s.toLowerCase().split(filter);
  if (parts.length == 1) {
    return s;
  }
  var r = "";
  var pos = 0;
  for (var i in parts) {
    if (i > 0) {
      r += '<mark class="highlight">' +
        s.substring(pos, pos + filter.length) +
        '</mark>';
      pos += filter.length;
    }
    r += s.substring(pos, pos + parts[i].length);
    pos += parts[i].length;
  }
  return r;
}

// Locate a row's checkbox cell by column id. Columns can be dragged into any
// order, so childNodes offsets are not usable for this any more.
function findBomCheckboxCell(row, checkboxname) {
  if (!row.childNodes) {
    return null;
  }
  var wanted = checkboxColId(checkboxname);
  for (var cell of row.childNodes) {
    if (cell.getAttribute && cell.getAttribute("data-field") === wanted) {
      return cell;
    }
  }
  return null;
}

function checkboxSetUnsetAllHandler(checkboxname) {
  return function() {
    var allset = true;
    var cell;
    var row;
    for (row of bombody.childNodes) {
      cell = findBomCheckboxCell(row, checkboxname);
      if (!cell) {
        continue;
      }
      var checkbox = cell.childNodes[0];
      if (!checkbox.checked || checkbox.indeterminate) {
        allset = false;
        break;
      }
    }
    for (row of bombody.childNodes) {
      cell = findBomCheckboxCell(row, checkboxname);
      if (!cell) {
        continue;
      }
      var checkbox = cell.childNodes[0];
      checkbox.checked = !allset;
      checkbox.indeterminate = false;
      checkbox.onchange();
    }
  }
}

function createColumnHeader(name, cls, comparator) {
  var th = document.createElement("TH");
  th.innerHTML = name;
  th.classList.add(cls);
  th.style.cursor = "pointer";
  var span = document.createElement("SPAN");
  span.classList.add("sortmark");
  span.classList.add("none");
  th.appendChild(span);
  var handle = document.createElement("DIV");
  handle.className = "bom-resize-handle";
  handle.title = "拖动调整此列宽度";
  th.appendChild(handle);
  th.onclick = function() {
    if (bomDragJustEnded) {
      return;
    }
    var colId = this.getAttribute("data-col-id");
    if (currentSortColumn && this !== currentSortColumn) {
      // Currently sorted by another column
      currentSortColumn.childNodes[1].classList.remove(currentSortOrder);
      currentSortColumn.childNodes[1].classList.add("none");
      currentSortColumn = null;
      currentSortOrder = null;
    }
    if (currentSortColumn && this === currentSortColumn) {
      // Already sorted by this column
      if (currentSortOrder == "asc") {
        // Sort by this column, descending order
        bomSortFunction = comparatorForOrder(comparator, "desc");
        currentSortColumn.childNodes[1].classList.remove("asc");
        currentSortColumn.childNodes[1].classList.add("desc");
        currentSortOrder = "desc";
      } else {
        // Unsort
        bomSortFunction = null;
        currentSortColumn.childNodes[1].classList.remove("desc");
        currentSortColumn.childNodes[1].classList.add("none");
        currentSortColumn = null;
        currentSortOrder = null;
        currentSortColId = null;
      }
    } else {
      // Sort by this column, ascending order
      bomSortFunction = comparator;
      currentSortColumn = this;
      currentSortColumn.childNodes[1].classList.remove("none");
      currentSortColumn.childNodes[1].classList.add("asc");
      currentSortOrder = "asc";
      currentSortColId = colId;
    }
    populateBomBody();
  }
  return th;
}

// The active sort is remembered by column id, because the header row is rebuilt
// every time the column order changes and the old node is thrown away.
function clearSort() {
  if (currentSortColumn && currentSortColumn.childNodes[1]) {
    currentSortColumn.childNodes[1].classList.remove("asc");
    currentSortColumn.childNodes[1].classList.remove("desc");
    currentSortColumn.childNodes[1].classList.add("none");
  }
  bomSortFunction = null;
  currentSortColumn = null;
  currentSortOrder = null;
  currentSortColId = null;
}

function comparatorForOrder(comparator, order) {
  if (order == "desc") {
    return function(a, b) {
      return -comparator(a, b);
    }
  }
  return comparator;
}

// Re-apply the remembered sort to a freshly built header row. Keeping the id
// means dragging a column around no longer loses the sort; if the column has
// disappeared (e.g. bommode change) we fall back to natural order.
function restoreSortMarker(tr) {
  if (!currentSortColId || !currentSortOrder || !bomColumnById[currentSortColId]) {
    clearSort();
    return;
  }
  var target = null;
  for (var cell of tr.childNodes) {
    if (cell.getAttribute && cell.getAttribute("data-col-id") === currentSortColId) {
      target = cell;
      break;
    }
  }
  if (!target) {
    clearSort();
    return;
  }
  currentSortColumn = target;
  if (target.childNodes[1]) {
    target.childNodes[1].classList.remove("none");
    target.childNodes[1].classList.add(currentSortOrder);
  }
  bomSortFunction = comparatorForOrder(
    bomColumnById[currentSortColId].comparator, currentSortOrder);
}

function rebuildBomColgroup(specs) {
  while (bomcolgroup.firstChild) {
    bomcolgroup.removeChild(bomcolgroup.firstChild);
  }
  for (var spec of specs) {
    addBomCol(spec);
  }
  applyBomColumnWidths();
}

function addBomCol(spec) {
  if (!spec) {
    return;
  }
  var col = document.createElement("COL");
  col.id = "bomcol-" + spec.id;
  col.setAttribute("data-col-id", spec.id);
  col.setAttribute("data-cls", spec.cls);
  col.setAttribute("data-width", spec.width);
  bomcolgroup.appendChild(col);
}

function populateBomHeader() {
  while (bomhead.firstChild) {
    bomhead.removeChild(bomhead.firstChild);
  }
  var specs = orderedBomColumns();
  rebuildBomColgroup(specs);
  bomColumnById = {};
  var tr = document.createElement("TR");
  var checkboxCompareClosure = function(checkbox) {
    return (a, b) => {
      var stateA = getCheckboxState(checkbox, a[3]);
      var stateB = getCheckboxState(checkbox, b[3]);
      if (stateA > stateB) return -1;
      if (stateA < stateB) return 1;
      return 0;
    }
  }
  for (var spec of specs) {
    var comparator = spec.comparator;
    if (spec.id.indexOf("checkbox:") === 0) {
      comparator = checkboxCompareClosure(spec.id.substring("checkbox:".length));
    }
    var cell = createColumnHeader(spec.title, spec.cls, comparator);
    cell.setAttribute("data-col-id", spec.id);
    // Mirrors the body cells so print/copy can recognise a column by field
    // instead of by position.
    cell.setAttribute("data-field", spec.id);
    bomColumnById[spec.id] = {
      comparator: comparator,
      cls: spec.cls,
    };
    if (spec.id.indexOf("checkbox:") === 0) {
      // Single click sorts, double click toggles every row — same as upstream.
      cell.onclick = fancyDblClickHandler(
        cell, cell.onclick.bind(cell),
        checkboxSetUnsetAllHandler(spec.id.substring("checkbox:".length)));
    }
    tr.appendChild(cell);
  }
  bomhead.appendChild(tr);
  restoreSortMarker(tr);
  makeBomColumnsReorderable(tr);
}

function checkboxColId(checkbox) {
  return "checkbox:" + checkbox;
}

// All header cells that may be dragged, in visual order. Every column qualifies
// now, including the row number and the checkboxes, so this is simply the header
// row.
function bomGrabCells() {
  var row = bomhead.childNodes[0];
  if (!row) {
    return [];
  }
  return Array.prototype.slice.call(row.childNodes);
}

function setBomColWidthLive(id, px) {
  if (!bomcolgroup) {
    return;
  }
  for (var col of bomcolgroup.childNodes) {
    if (col.getAttribute("data-col-id") === id) {
      col.style.width = px + "px";
      return;
    }
  }
}

function bomDropIndicator() {
  var el = document.getElementById("bomDropIndicator");
  if (!el) {
    el = document.createElement("DIV");
    el.id = "bomDropIndicator";
    el.className = "bom-drop-indicator";
    document.body.appendChild(el);
  }
  return el;
}

function hideBomDropIndicator() {
  var el = document.getElementById("bomDropIndicator");
  if (el) {
    el.style.display = "none";
  }
}

// Insertion index (0..n) for a pointer position: the first grabbable column
// whose midpoint is to the right of the pointer is where the column lands.
function bomDropTargetIndex(clientX) {
  var cells = bomGrabCells();
  for (var i = 0; i < cells.length; i++) {
    var rect = cells[i].getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      return i;
    }
  }
  return cells.length;
}

// Draw the vertical drop marker at the boundary the column would land on.
function showBomDropIndicator(index, clientX) {
  var cells = bomGrabCells();
  var x;
  if (index < cells.length) {
    x = cells[index].getBoundingClientRect().left;
  } else if (cells.length) {
    var last = cells[cells.length - 1].getBoundingClientRect();
    x = last.right;
  } else {
    x = clientX;
  }
  var tableRect = bom.getBoundingClientRect();
  var el = bomDropIndicator();
  // Rect and clientX are visual pixels; the fixed-position indicator's style
  // values are layout pixels, so the page scale factor is divided back out
  // (uiScaleFactor in util.js; a fixed 1 since the UI zoom feature was
  // removed, but keep the division for formula stability).
  var inv = 1 / uiScaleFactor;
  el.style.display = "block";
  el.style.left = (x * inv) + "px";
  el.style.top = (tableRect.top * inv) + "px";
  el.style.height = (tableRect.height * inv) + "px";
}

function applyBomColumnOrder(id, insertIndex) {
  var specs = orderedBomColumns();
  var from = -1;
  for (var i = 0; i < specs.length; i++) {
    if (specs[i].id === id) {
      from = i;
      break;
    }
  }
  if (from === -1) {
    return;
  }
  var moved = specs.splice(from, 1)[0];
  // insertIndex was computed against the list that still contained the dragged
  // column, so removing it first shifts every later position down by one.
  var at = insertIndex > from ? insertIndex - 1 : insertIndex;
  specs.splice(at, 0, moved);
  bomColumnOrder = specs.map(function(s) {
    return s.id;
  });
  writeStorage("bomColumnOrder", JSON.stringify(bomColumnOrder));
}

function endBomDrag() {
  document.body.classList.remove("bom-dragging");
  hideBomDropIndicator();
  bomDragState = null;
}

// Wire up both gestures on one header row. A mousedown within BOM_RESIZE_EDGE
// of the right edge resizes the column; anywhere else moves it. Neither becomes
// active until the pointer clears BOM_DRAG_THRESHOLD, so a plain click still
// sorts, and dragging never leaves the sort marker in a wrong place.
//
// Every column is draggable, the row number and the checkboxes included.
function makeBomColumnsReorderable(tr) {
  for (var i = 0; i < tr.childNodes.length; i++) {
    var cell = tr.childNodes[i];
    if (!cell.getAttribute || !cell.getAttribute("data-col-id")) {
      continue;
    }
    attachBomColumnGesture(cell);
  }
}

function attachBomColumnGesture(th) {
  th.addEventListener("mousemove", function(e) {
    if (bomDragState) {
      return;
    }
    var rect = th.getBoundingClientRect();
    var atEdge = (rect.right - e.clientX) <= BOM_RESIZE_EDGE;
    th.classList.toggle("bom-col-resizing", atEdge);
  });

  th.addEventListener("mouseleave", function() {
    if (!bomDragState) {
      th.classList.remove("bom-col-resizing");
    }
  });

  th.addEventListener("mousedown", function(e) {
    if (e.button !== 0 || bomDragState) {
      return;
    }
    var id = th.getAttribute("data-col-id");
    if (!id) {
      return;
    }
    var handle = th.querySelector(".bom-resize-handle");
    var startedOnHandle = !!(handle && e.target === handle);
    var rect = th.getBoundingClientRect();
    // Grabbing the strip, or anywhere within BOM_RESIZE_EDGE of the right edge,
    // resizes the column; anywhere else reorders it.
    var resizing = startedOnHandle || (rect.right - e.clientX) <= BOM_RESIZE_EDGE;
    var startX = e.clientX;
    var startWidth = bomColWidth(th);
    var moved = false;

    var onMove = function(ev) {
      if (!moved) {
        if (Math.abs(ev.clientX - startX) < BOM_DRAG_THRESHOLD) {
          return;
        }
        moved = true;
        bomDragState = th;
        document.body.classList.add("bom-dragging");
        th.classList.add(resizing ? "bom-col-active-resize" : "bom-col-being-moved");
      }
      ev.preventDefault();
      if (resizing) {
        // startWidth and the pointer delta are visual pixels; the stored and
        // style-applied width is a layout pixel value, so the page scale
        // factor is divided back out (uiScaleFactor in util.js).
        var width = Math.max(BOM_COL_MIN_WIDTH,
          Math.round((startWidth + ev.clientX - startX) / uiScaleFactor));
        setBomColWidthLive(id, width);
        bomColumnWidths[id] = width;
      } else {
        showBomDropIndicator(bomDropTargetIndex(ev.clientX), ev.clientX);
      }
    };

    var onUp = function(ev) {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (!moved) {
        // A click, not a drag.
        th.classList.remove("bom-col-resizing");
        if (startedOnHandle) {
          // Clicking the resize strip must not also sort the column.
          bomDragJustEnded = true;
          setTimeout(function() {
            bomDragJustEnded = false;
          }, 0);
        }
        return;
      }
      ev.preventDefault();
      if (resizing) {
        setBomColumnWidth(id, bomColumnWidths[id]);
        setBomColWidthLive(id, bomColumnWidths[id]);
      } else {
        applyBomColumnOrder(id, bomDropTargetIndex(ev.clientX));
      }
      th.classList.remove("bom-col-being-moved");
      th.classList.remove("bom-col-active-resize");
      endBomDrag();
      // Swallow the click that the browser synthesises after this mouseup.
      bomDragJustEnded = true;
      setTimeout(function() {
        bomDragJustEnded = false;
      }, 0);
      if (!resizing) {
        populateBomTable();
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

function populateBomBody() {
  while (bom.firstChild) {
    bom.removeChild(bom.firstChild);
  }
  highlightHandlers = [];
  footprintIndexToHandler = {};
  netsToHandler = {};
  refToHandler = {};
  currentHighlightedRowId = null;
  var first = true;
  if (settings.bommode == "netlist") {
    bomtable = pcbdata.nets.slice();
  } else {
    // The list follows what the canvas shows. With ALL up every layer is on
    // screen, so every component belongs in the list; "FB" is the combined one.
    switch (innerPanesActive() ? "FB" : settings.canvaslayout) {
      case 'F':
        bomtable = pcbdata.bom.F.slice();
        if (settings.showNoBom && pcbdata.bom.nobomF) {
          bomtable = bomtable.concat(pcbdata.bom.nobomF);
        }
        break;
      case 'FB':
        bomtable = pcbdata.bom.both.slice();
        if (settings.showNoBom && pcbdata.bom.nobom) {
          bomtable = bomtable.concat(pcbdata.bom.nobom);
        }
        break;
      case 'B':
        bomtable = pcbdata.bom.B.slice();
        if (settings.showNoBom && pcbdata.bom.nobomB) {
          bomtable = bomtable.concat(pcbdata.bom.nobomB);
        }
        break;
    }
    if (settings.bommode == "ungrouped") {
      // expand bom table
      expandedTable = []
      for (var bomentry of bomtable) {
        for (var ref of bomentry[3]) {
          expandedTable.push([1, bomentry[1], bomentry[2], [ref], bomentry[4], bomentry[5], bomentry[6]]);
        }
      }
      bomtable = expandedTable;
    }
  }
  if (bomSortFunction) {
    bomtable = bomtable.sort(bomSortFunction);
  }
  // Read the order once: the loop below may run over thousands of rows.
  var columnSpecs = orderedBomColumns();
  for (var i in bomtable) {
    var bomentry = bomtable[i];
    if (filter && !entryMatches(bomentry)) {
      continue;
    }
    var references = null;
    var netname = null;
    var tr = document.createElement("TR");
    var td = document.createElement("TD");
    var rownum = +i + 1;
    tr.id = "bomrow" + rownum;
    if (settings.bommode == "netlist") {
      netname = bomentry;
      td = document.createElement("TD");
      td.setAttribute("data-field", "netname");
      td.innerHTML = highlightFilter(netname ? netname : "&lt;无网络&gt;");
      tr.appendChild(td);
    } else {
      if (reflookup) {
        references = findRefInEntry(bomentry);
        if (references.length == 0) {
          continue;
        }
      } else {
        references = bomentry[3];
      }
      // Every column, in the user's chosen order. Each cell is tagged with the
      // field it holds so the checkbox helpers can find their input by id
      // instead of by a hardcoded childNode offset — which is what lets the
      // checkbox columns be dragged anywhere.
      for (var spec of columnSpecs) {
        if (spec.id == "rownum") {
          td = document.createElement("TD");
          td.setAttribute("data-field", "rownum");
          td.textContent = rownum;
          tr.appendChild(td);
        } else if (spec.id.indexOf("checkbox:") === 0) {
          var checkboxName = spec.id.substring("checkbox:".length);
          td = document.createElement("TD");
          td.setAttribute("data-field", spec.id);
          var input = document.createElement("input");
          input.type = "checkbox";
          input.onchange = createCheckboxChangeHandler(checkboxName, references, tr);
          setBomCheckboxState(checkboxName, input, references);
          if (input.checked && settings.darkenWhenChecked == checkboxName) {
            tr.classList.add("checked");
          }
          td.appendChild(input);
          tr.appendChild(td);
        } else if (spec.id == "quantity") {
          // Quantity
          td = document.createElement("TD");
          td.setAttribute("data-field", "quantity");
          td.textContent = bomentry[3].length;
          tr.appendChild(td);
        } else if (spec.id == "references") {
          // References
          td = document.createElement("TD");
          td.setAttribute("data-field", "references");
          td.innerHTML = highlightFilter(references.map(r => r[0]).join(", "));
          tr.appendChild(td);
        } else if (spec.id == "description") {
          // Description
          td = document.createElement("TD");
          td.setAttribute("data-field", "description");
          td.innerHTML = highlightFilter(bomentry[6] == null ? "" : bomentry[6]);
          tr.appendChild(td);
        } else if (spec.id == "value") {
          // Value
          td = document.createElement("TD");
          td.setAttribute("data-field", "value");
          td.innerHTML = highlightFilter(bomentry[1]);
          tr.appendChild(td);
        } else if (spec.id == "footprint") {
          // Footprint
          td = document.createElement("TD");
          td.setAttribute("data-field", "footprint");
          td.innerHTML = highlightFilter(bomentry[2]);
          tr.appendChild(td);
        } else if (spec.id.indexOf("extra") == 0) {
          // Extra fields
          var fieldIndex = spec.id.substring("extra".length);
          td = document.createElement("TD");
          td.setAttribute("data-field", spec.id);
          td.innerHTML = highlightFilter(bomentry[4][fieldIndex]);
          tr.appendChild(td);
        }
      }
    }
    bom.appendChild(tr);
    var handler = createRowHighlightHandler(tr.id, references, netname);
    // Click-to-highlight (used to be mousemove): hovering swept highlights
    // across the board and, in the split view, yanked the schematic around.
    // A checkbox click inside the row is not a row selection. The wrapper
    // captures `handler` through an IIFE: `handler` is a function-scoped var,
    // so a bare closure would make every row fire the LAST row's handler.
    tr.onclick = (function(h) {
      return function(e) {
        if (e && e.target && e.target.tagName &&
            String(e.target.tagName).toLowerCase() == "input") return;
        h();
      };
    })(handler);
    highlightHandlers.push({
      id: tr.id,
      handler: handler,
    });
    if (references !== null) {
      for (var refIndex of references.map(r => r[1])) {
        footprintIndexToHandler[refIndex] = handler;
      }
      // The schematic pane addresses rows by designator, not by footprint
      // index, so the same handler is registered again under each reference.
      for (var refPair of references) {
        refToHandler[refPair[0]] = handler;
      }
    }
    if (netname !== null) {
      netsToHandler[netname] = handler;
    }
    if ((filter || reflookup) && first) {
      handler();
      first = false;
    }
  }
  EventHandler.emitEvent(
    IBOM_EVENT_TYPES.BOM_BODY_CHANGE_EVENT,
    {
      filter: filter,
      reflookup: reflookup,
      checkboxes: settings.checkboxes,
      bommode: settings.bommode,
    });
}

function highlightPreviousRow() {
  if (!currentHighlightedRowId) {
    highlightHandlers[highlightHandlers.length - 1].handler();
  } else {
    if (highlightHandlers.length > 1 &&
      highlightHandlers[0].id == currentHighlightedRowId) {
      highlightHandlers[highlightHandlers.length - 1].handler();
    } else {
      for (var i = 0; i < highlightHandlers.length - 1; i++) {
        if (highlightHandlers[i + 1].id == currentHighlightedRowId) {
          highlightHandlers[i].handler();
          break;
        }
      }
    }
  }
  smoothScrollToRow(currentHighlightedRowId);
}

function highlightNextRow() {
  if (!currentHighlightedRowId) {
    highlightHandlers[0].handler();
  } else {
    if (highlightHandlers.length > 1 &&
      highlightHandlers[highlightHandlers.length - 1].id == currentHighlightedRowId) {
      highlightHandlers[0].handler();
    } else {
      for (var i = 1; i < highlightHandlers.length; i++) {
        if (highlightHandlers[i - 1].id == currentHighlightedRowId) {
          highlightHandlers[i].handler();
          break;
        }
      }
    }
  }
  smoothScrollToRow(currentHighlightedRowId);
}

function populateBomTable() {
  populateBomHeader();
  populateBomBody();
}

function footprintsClicked(footprintIndexes) {
  var lastClickedIndex = footprintIndexes.indexOf(lastClicked);
  for (var i = 1; i <= footprintIndexes.length; i++) {
    var refIndex = footprintIndexes[(lastClickedIndex + i) % footprintIndexes.length];
    if (refIndex in footprintIndexToHandler) {
      lastClicked = refIndex;
      footprintIndexToHandler[refIndex]();
      smoothScrollToRow(currentHighlightedRowId);
      break;
    }
  }
}

function netClicked(net) {
  // net is an index into pcbdata.nets; resolve the name for the schematic
  // side (null when the click missed every net - that clears the schematic
  // highlight too).
  var netName = (net !== null && net !== undefined && pcbdata.nets &&
    typeof net == "number") ? pcbdata.nets[net] : null;
  if (net in netsToHandler) {
    netsToHandler[net]();
    smoothScrollToRow(currentHighlightedRowId);
  } else {
    clearHighlightedFootprints();
    highlightedNet = net;
    drawHighlights();
  }
  if (typeof schemHighlightNetByName == "function") {
    schemHighlightNetByName(netName);
  }
}

/* Schematic -> board cross-probe: the schematic pane lights a net (wire /
 * label / power port click) and the board follows by name. Unknown names and
 * null clear the board's net highlight. */
function crossHighlightNetByName(name) {
  if (!name || !pcbdata.nets) {
    if (highlightedNet !== null) {
      highlightedNet = null;
      drawHighlights();
    }
    return;
  }
  var lower = String(name).toLowerCase();
  for (var i = 0; i < pcbdata.nets.length; i++) {
    if (pcbdata.nets[i] && String(pcbdata.nets[i]).toLowerCase() == lower) {
      // A net selection replaces the component selection, mirroring what a
      // board-side net click does.
      clearHighlightedFootprints();
      highlightedNet = i;
      drawHighlights();
      return;
    }
  }
  // No board net by that name: the selection moved on, drop the highlight.
  if (highlightedNet !== null) {
    highlightedNet = null;
    drawHighlights();
  }
}

function updateFilter(input) {
  filter = input.toLowerCase();
  populateBomTable();
}

function updateRefLookup(input) {
  reflookup = input.toLowerCase();
  populateBomTable();
}

// Which panes the board canvas is split into. A board with inner copper gets one
// pane per layer, sandwiched between the two faces: F, In1..InN, B. The "all
// layers" switch drops the inner ones again so a 2-layer board (or anyone who
// just wants the faces) keeps the old two-pane look.
function innerPanesActive() {
  return !!(settings.showAllLayers !== false && pcbdata.inners && pcbdata.inners.length);
}

function canvasPaneIds() {
  var list = ["#frontcanvas"];
  if (innerPanesActive()) {
    for (var i = 1; i <= pcbdata.inners.length; i++) {
      list.push("#innercanvas" + i);
    }
  }
  list.push("#backcanvas");
  return list;
}

function evenSizes(n) {
  var sizes = [];
  for (var i = 0; i < n; i++) sizes.push(100 / n);
  return sizes;
}

function setInnerPanesVisible(on) {
  if (!pcbdata.inners) return;
  for (var i = 1; i <= pcbdata.inners.length; i++) {
    var el = document.getElementById("innercanvas" + i);
    if (!el) continue;
    if (on) {
      el.style.display = "";
      el.style.width = "";
      el.style.height = "";
    } else {
      el.style.display = "none";
    }
  }
}

function setInnerPanesClass(cls, add) {
  if (!pcbdata.inners) return;
  for (var i = 1; i <= pcbdata.inners.length; i++) {
    var el = document.getElementById("innercanvas" + i);
    if (!el) continue;
    if (add) {
      el.classList.add(cls);
    } else {
      el.classList.remove(cls);
    }
  }
}

function canvasSplitDirection() {
  return (settings.bomlayout == "left-right") ? "vertical" : "horizontal";
}

function rebuildCanvasSplit() {
  if (canvassplit) {
    canvassplit.destroy();
    canvassplit = null;
  }
  var ids = canvasPaneIds();
  canvassplit = Split(ids, {
    sizes: evenSizes(ids.length),
    gutterSize: 5,
    direction: canvasSplitDirection(),
    onDragEnd: resizeAll
  });
  return canvassplit;
}

// 'F' shows only the top face, 'B' only the bottom one, 'FB' splits the room
// evenly across however many panes exist.
function canvasLayoutSizes(layout) {
  var n = canvasPaneIds().length;
  var sizes = [];
  if (layout == "F") {
    for (var i = 0; i < n; i++) sizes.push(i == 0 ? 100 : 0);
  } else if (layout == "B") {
    for (var k = 0; k < n; k++) sizes.push(k == n - 1 ? 100 : 0);
  } else {
    sizes = evenSizes(n);
  }
  return sizes;
}

// The four canvas-view keys (F / FB / B / ALL) are one exclusive group: exactly
// one of them is pressed at a time. ALL is the odd one out — it is the key that
// shows every layer, which means keeping the inner copper panes in the split.
function setCanvasViewButtons(view) {
  var ids = ["fl-btn", "fb-btn", "bl-btn", "all-btn"];
  var names = ["F", "FB", "B", "ALL"];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (!el) continue;
    if (names[i] == view) el.classList.add("depressed");
    else el.classList.remove("depressed");
  }
}

// Which key is up: ALL whenever the inner panes are showing, otherwise whatever
// of F / FB / B was picked last.
function currentCanvasView() {
  return innerPanesActive() ? "ALL" : (settings.canvaslayout || "FB");
}

// Push the current view to the four buttons, the panes and the split. Boards set
// to bom-only have no canvas panes at all, so there only the button state moves.
function applyCanvasView() {
  var view = currentCanvasView();
  setCanvasViewButtons(view);
  if (settings.bomlayout != "bom-only") {
    setInnerPanesVisible(view == "ALL");
    if (typeof initDone != "undefined" && initDone) {
      rebuildCanvasSplit();
      canvassplit.setSizes(canvasLayoutSizes(view));
    }
  }
  if (typeof initDone != "undefined" && initDone) {
    resizeAll();
  }
}

function allLayersVisible(value) {
  writeStorage("allLayersVisible", value);
  settings.showAllLayers = value;
  var allBox = document.getElementById("allLayersCheckbox");
  if (allBox) allBox.checked = !!value;
  applyCanvasView();
  // The BOM list follows the view now, so turning ALL on or off rebuilds it.
  // populateBomTable is declared further down this file; the typeof guard keeps
  // this pane helper usable on its own (the pane-only harness slices the file).
  if (typeof initDone != "undefined" && initDone && typeof populateBomTable == "function") {
    populateBomTable();
  }
}

// Click handler for the ALL key: show every layer, or drop back to the F / FB /
// B view that was up before. It never stacks on top of one of those three.
function toggleAllLayers() {
  allLayersVisible(!innerPanesActive());
}

function changeCanvasLayout(layout) {
  // Picking F / FB / B puts the inner panes away again, which also releases ALL
  // — the four keys stay mutually exclusive instead of stacking up.
  settings.showAllLayers = false;
  writeStorage("allLayersVisible", false);
  settings.canvaslayout = layout;
  writeStorage("canvaslayout", layout);
  applyCanvasView();
  if (settings.bommode == "netlist") settings.bommode = "grouped";
  changeBomMode(settings.bommode);
}

function populateMetadata() {
  var meta = pcbdata.metadata;
  var company = meta.company || "";
  document.getElementById("title").innerHTML = meta.title;
  // "Rev: 1.1   2024-09-14 14:26:36" — the date used to sit on a line of its
  // own under the revision and cost the header a whole row.
  document.getElementById("revision").innerHTML = "Rev: " + meta.revision +
    (meta.date ? '<span class="revdate">' + meta.date + "</span>" : "");
  document.getElementById("company").innerHTML = company;
  // The date moved up next to the revision, so what is left of that row is the
  // company — and an empty line above the board is just lost canvas.
  document.getElementById("filedate").innerHTML = "";
  var companyRow = document.getElementById("companyrow");
  if (companyRow) {
    companyRow.style.display = company ? "" : "none";
  }
  if (meta.title != "") {
    document.title = meta.title + " BOM";
  }
  // Calculate board stats
  var fp_f = 0, fp_b = 0, pads_f = 0, pads_b = 0, pads_th = 0;
  for (var i = 0; i < pcbdata.footprints.length; i++) {
    if (isBomSkipped(i)) continue;
    var mod = pcbdata.footprints[i];
    if (mod.layer == "F") {
      fp_f++;
    } else {
      fp_b++;
    }
    for (var pad of mod.pads) {
      if (pad.type == "th") {
        pads_th++;
      } else {
        if (pad.layers.includes("F")) {
          pads_f++;
        }
        if (pad.layers.includes("B")) {
          pads_b++;
        }
      }
    }
  }
  document.getElementById("stats-components-front").innerHTML = fp_f;
  document.getElementById("stats-components-back").innerHTML = fp_b;
  document.getElementById("stats-components-total").innerHTML = fp_f + fp_b;
  document.getElementById("stats-groups-front").innerHTML = pcbdata.bom.F.length;
  document.getElementById("stats-groups-back").innerHTML = pcbdata.bom.B.length;
  document.getElementById("stats-groups-total").innerHTML = pcbdata.bom.both.length;
  document.getElementById("stats-smd-pads-front").innerHTML = pads_f;
  document.getElementById("stats-smd-pads-back").innerHTML = pads_b;
  document.getElementById("stats-smd-pads-total").innerHTML = pads_f + pads_b;
  document.getElementById("stats-th-pads").innerHTML = pads_th;
  // Update version string
  document.getElementById("github-link").innerHTML = "InteractiveBOM Suite&nbsp;V1.0.01";
}

// The canvas/BOM split has to start right below the header, and how tall the
// header is is a CSS decision (the compact toolbar). Reading it back keeps the
// two from drifting apart the next time the bar is resized.
function topBarOffset() {
  var topEl = document.getElementById("top");
  return (topEl ? topEl.offsetHeight : 57) + 1;
}

function changeBomLayout(layout) {
  document.getElementById("bom-btn").classList.remove("depressed");
  document.getElementById("lr-btn").classList.remove("depressed");
  document.getElementById("tb-btn").classList.remove("depressed");
  switch (layout) {
    case 'bom-only':
      document.getElementById("bom-btn").classList.add("depressed");
      if (bomsplit) {
        bomsplit.destroy();
        bomsplit = null;
        canvassplit.destroy();
        canvassplit = null;
      }
      document.getElementById("frontcanvas").style.display = "none";
      document.getElementById("backcanvas").style.display = "none";
      setInnerPanesVisible(false);
      document.getElementById("bot").style.height = "";
      break;
    case 'top-bottom':
      document.getElementById("tb-btn").classList.add("depressed");
      setInnerPanesVisible(innerPanesActive());
      document.getElementById("frontcanvas").style.display = "";
      document.getElementById("backcanvas").style.display = "";
      document.getElementById("bot").style.height = "calc(100% - " + topBarOffset() + "px)";
      document.getElementById("bomdiv").classList.remove("split-horizontal");
      document.getElementById("canvasdiv").classList.remove("split-horizontal");
      document.getElementById("frontcanvas").classList.add("split-horizontal");
      document.getElementById("backcanvas").classList.add("split-horizontal");
      setInnerPanesClass("split-horizontal", true);
      if (bomsplit) {
        bomsplit.destroy();
        bomsplit = null;
        canvassplit.destroy();
        canvassplit = null;
      }
      bomsplit = Split(['#bomdiv', '#canvasdiv'], {
        sizes: [50, 50],
        onDragEnd: resizeAll,
        direction: "vertical",
        gutterSize: 5
      });
      rebuildCanvasSplit();
      break;
    case 'left-right':
      document.getElementById("lr-btn").classList.add("depressed");
      setInnerPanesVisible(innerPanesActive());
      document.getElementById("frontcanvas").style.display = "";
      document.getElementById("backcanvas").style.display = "";
      document.getElementById("bot").style.height = "calc(100% - " + topBarOffset() + "px)";
      document.getElementById("bomdiv").classList.add("split-horizontal");
      document.getElementById("canvasdiv").classList.add("split-horizontal");
      document.getElementById("frontcanvas").classList.remove("split-horizontal");
      document.getElementById("backcanvas").classList.remove("split-horizontal");
      setInnerPanesClass("split-horizontal", false);
      if (bomsplit) {
        bomsplit.destroy();
        bomsplit = null;
        canvassplit.destroy();
        canvassplit = null;
      }
      bomsplit = Split(['#bomdiv', '#canvasdiv'], {
        sizes: [50, 50],
        onDragEnd: resizeAll,
        gutterSize: 5
      });
      rebuildCanvasSplit();
  }
  settings.bomlayout = layout;
  writeStorage("bomlayout", layout);
  // Re-apply whatever view is up — which may be ALL — rather than forcing the
  // F / FB / B pick, or changing the BOM layout would drop the inner panes.
  applyCanvasView();
  // Building the list itself is changeBomMode's job; the old path reached it
  // through changeCanvasLayout, so it has to be spelled out here now.
  changeBomMode(settings.bommode);
}

function changeBomMode(mode) {
  document.getElementById("bom-grouped-btn").classList.remove("depressed");
  document.getElementById("bom-ungrouped-btn").classList.remove("depressed");
  var nbl = document.getElementById("bom-netlist-btn"); if(nbl) nbl.classList.remove("depressed");
  switch (mode) {
    case 'grouped':
      document.getElementById("bom-grouped-btn").classList.add("depressed");
      break;
    case 'ungrouped':
      document.getElementById("bom-ungrouped-btn").classList.add("depressed");
      break;
    case 'netlist':
      var nbl2 = document.getElementById("bom-netlist-btn"); if(nbl2) nbl2.classList.add("depressed");
  }
  writeStorage("bommode", mode);
  if (mode != settings.bommode) {
    settings.bommode = mode;
    bomSortFunction = null;
    currentSortColumn = null;
    currentSortOrder = null;
    clearHighlightedFootprints();
  }
  populateBomTable();
}

function focusFilterField() {
  focusInputField(document.getElementById("filter"));
}

function focusRefLookupField() {
  focusInputField(document.getElementById("reflookup"));
}

// Public API used by user.js callbacks; the index is still accepted so callers
// written against upstream keep working, but the cell is found by column id.
function toggleBomCheckbox(bomrowid, checkboxnum) {
  if (!bomrowid || checkboxnum >= settings.checkboxes.length) {
    return;
  }
  var checkbox = findBomCheckboxCell(
    document.getElementById(bomrowid), settings.checkboxes[checkboxnum]);
  if (!checkbox || !checkbox.childNodes[0]) {
    return;
  }
  checkbox = checkbox.childNodes[0];
  checkbox.checked = !checkbox.checked;
  checkbox.indeterminate = false;
  checkbox.onchange();
}

function checkBomCheckbox(bomrowid, checkboxname) {
  if (!bomrowid) {
    return;
  }
  var cell = findBomCheckboxCell(
    document.getElementById(bomrowid), checkboxname);
  if (!cell || !cell.childNodes[0]) {
    return;
  }
  var checkbox = cell.childNodes[0];
  checkbox.checked = true;
  checkbox.indeterminate = false;
  checkbox.onchange();
}

function setBomCheckboxes(value) {
  writeStorage("bomCheckboxes", value);
  settings.checkboxes = value.split(",").filter((e) => e);
  prepCheckboxes();
  populateBomTable();
  populateDarkenWhenCheckedOptions();
}

function setDarkenWhenChecked(value) {
  writeStorage("darkenWhenChecked", value);
  settings.darkenWhenChecked = value;
  populateBomTable();
}

function prepCheckboxes() {
  var table = document.getElementById("checkbox-stats");
  while (table.childElementCount > 1) {
    table.removeChild(table.lastChild);
  }
  if (settings.checkboxes.length) {
    table.style.display = "";
  } else {
    table.style.display = "none";
  }
  for (var checkbox of settings.checkboxes) {
    var tr = document.createElement("TR");
    var td = document.createElement("TD");
    td.innerHTML = checkbox;
    tr.appendChild(td);
    td = document.createElement("TD");
    td.id = "checkbox-stats-" + checkbox;
    var progressbar = document.createElement("div");
    progressbar.classList.add("bar");
    td.appendChild(progressbar);
    var text = document.createElement("div");
    text.classList.add("text");
    td.appendChild(text);
    tr.appendChild(td);
    table.appendChild(tr);
    updateCheckboxStats(checkbox);
  }
}

function populateDarkenWhenCheckedOptions() {
  var container = document.getElementById("darkenWhenCheckedContainer");

  if (settings.checkboxes.length == 0) {
    container.parentElement.style.display = "none";
    return;
  }

  container.innerHTML = '';
  container.parentElement.style.display = "inline-block";

  function createOption(name, displayName) {
    var id = "darkenWhenChecked-" + name;

    var div = document.createElement("div");
    div.classList.add("radio-container");

    var input = document.createElement("input");
    input.type = "radio";
    input.name = "darkenWhenChecked";
    input.value = name;
    input.id = id;
    input.onchange = () => setDarkenWhenChecked(name);
    div.appendChild(input);

    // Preserve the selected element when the checkboxes change
    if (name == settings.darkenWhenChecked) {
      input.checked = true;
    }

    var label = document.createElement("label");
    label.innerHTML = displayName;
    label.htmlFor = id;
    div.appendChild(label);

    container.appendChild(div);
  }
  createOption("", "None");
  for (var checkbox of settings.checkboxes) {
    createOption(checkbox, checkbox);
  }
}

function updateCheckboxStats(checkbox) {
  var checked = getStoredCheckboxRefs(checkbox).size;
  var total = pcbdata.footprints.length - bomSkippedCount();
  var percent = checked * 100.0 / total;
  var td = document.getElementById("checkbox-stats-" + checkbox);
  td.firstChild.style.width = percent + "%";
  td.lastChild.innerHTML = checked + "/" + total + " (" + Math.round(percent) + "%)";
}

// Number of footprints currently excluded from the BOM. When no-BOM parts are being
// shown they no longer count as skipped, so the stats stay consistent with the table.
function bomSkippedCount() {
  var skipped = pcbdata.bom.skipped.length;
  if (settings.showNoBom && pcbdata.bom.nobomComponents) {
    skipped -= pcbdata.bom.nobomComponents.length;
  }
  return skipped;
}

document.onkeydown = function(e) {
  switch (e.key) {
    case "n":
      if (document.activeElement.type == "text") {
        return;
      }
      if (currentHighlightedRowId !== null) {
        checkBomCheckbox(currentHighlightedRowId, "placed");
        highlightNextRow();
        e.preventDefault();
      }
      break;
    case " ":
    case "Spacebar":
      // Turn the label under the pointer (or the one last clicked) by 90
      // degrees. Spacebar is the legacy name in old browsers, and the polyfill
      // in pep.js does not normalise `key`.
      if (document.activeElement.type == "text") {
        return;
      }
      // Space also scrolls the page and toggles any focused button. Both would
      // undo the point of the shortcut, so it is swallowed whenever a label is
      // selected — and only then, so the page keeps behaving normally when no
      // label is picked.
      if (selectedLabel) {
        rotateSelectedLabel();
        redrawIfInitDone();
        e.preventDefault();
      }
      break;
    case "ArrowUp":
      highlightPreviousRow();
      e.preventDefault();
      break;
    case "ArrowDown":
      highlightNextRow();
      e.preventDefault();
      break;
    default:
      break;
  }
  if (e.altKey) {
    switch (e.key) {
      case "f":
        focusFilterField();
        e.preventDefault();
        break;
      case "r":
        focusRefLookupField();
        e.preventDefault();
        break;
      case "z":
        changeBomLayout("bom-only");
        e.preventDefault();
        break;
      case "x":
        changeBomLayout("left-right");
        e.preventDefault();
        break;
      case "c":
        changeBomLayout("top-bottom");
        e.preventDefault();
        break;
      case "v":
        changeCanvasLayout("F");
        e.preventDefault();
        break;
      case "b":
        changeCanvasLayout("FB");
        e.preventDefault();
        break;
      case "n":
        changeCanvasLayout("B");
        e.preventDefault();
        break;
      default:
        break;
    }
    if (e.key >= '1' && e.key <= '9') {
      toggleBomCheckbox(currentHighlightedRowId, parseInt(e.key));
    }
  }
}

function hideNetlistButton() {
  document.getElementById("bom-ungrouped-btn").classList.remove("middle-button");
  document.getElementById("bom-ungrouped-btn").classList.add("right-most-button");
  var nbl3 = document.getElementById("bom-netlist-btn"); if(nbl3) nbl3.style.display = "none";
}

window.onload = function(e) {
  initUtils();
  initRender();
  initStorage();
  initDefaults();
  cleanGutters();
  populateMetadata();
  dbgdiv = document.getElementById("dbg");
  bom = document.getElementById("bombody");
  bombody = bom;
  bomhead = document.getElementById("bomhead");
  bomcolgroup = document.getElementById("bomcolgroup");
  filter = "";
  reflookup = "";
  if (!("nets" in pcbdata)) {
    hideNetlistButton();
  }
  initDone = true;
  prepCheckboxes();
  // Triggers render
  changeBomLayout(settings.bomlayout);
  // Schematic pane. Runs after the layout exists because it adds a class to
  // the BOM panel; hides itself when the export carried no schematic.
  initSchem();

  // Header menus open on click and close on a second click, a click outside,
  // or Escape (see initMenus in util.js).
  initMenus();

  // Users may leave fullscreen without touching the checkbox. Uncheck.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement)
      document.getElementById('fullscreenCheckbox').checked = false;
  });
}

window.onresize = function(e) {
  resizeAll();
};
window.matchMedia("print").addListener(resizeAll);
