/* Utility functions */

var storagePrefix = 'KiCad_HTML_BOM__' + pcbdata.metadata.title + '__' +
  pcbdata.metadata.revision + '__#';
var storage;

function initStorage(key) {
  try {
    window.localStorage.getItem("blank");
    storage = window.localStorage;
  } catch (e) {
    // localStorage not available
  }
  if (!storage) {
    try {
      window.sessionStorage.getItem("blank");
      storage = window.sessionStorage;
    } catch (e) {
      // sessionStorage also not available
    }
  }
}

function readStorage(key) {
  if (storage) {
    return storage.getItem(storagePrefix + key);
  } else {
    return null;
  }
}

function writeStorage(key, value) {
  if (storage) {
    storage.setItem(storagePrefix + key, value);
  }
}

// [2026-09-25] Forget a stored value so the adaptive default takes over again
// (used by the "reset font sizes" button).
function removeStorage(key) {
  if (storage) {
    storage.removeItem(storagePrefix + key);
  }
}

// ---------------------------------------------------------------------------
// Canvas/DOM scale factor. The page-level UI zoom (body zoom with an auto
// mode and a settings-menu control) was removed on user request; the factor
// stays a fixed 1 but survives because render.js multiplies it into the
// canvas raster size and ibom.js divides visual measurements by it.
var uiScaleFactor = 1;

// ---------------------------------------------------------------------------
// Header menus: click to open, click again to close, click outside or Escape
// to dismiss. The menus used to open on hover, which fired while the cursor
// merely travelled across the header and kept slamming the settings panel
// open. Hover now only tints the button (see ibom.css); the .open class is
// the only channel that reveals the content. One menu open at a time.
// Called once from ibom.js after the DOM is ready.
function initMenus() {
  function closeAll(except) {
    var open = document.querySelectorAll(".menu.open");
    for (var i = 0; i < open.length; i++) {
      if (open[i] !== except) {
        open[i].classList.remove("open");
      }
    }
  }
  var btns = document.querySelectorAll(
    ".menu > .menubtn, .menu > .statsbtn, .menu > .iobtn");
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener("click", function(e) {
      var menu = e.currentTarget.parentElement;
      var wasOpen = menu.classList.contains("open");
      closeAll();
      if (!wasOpen) {
        menu.classList.add("open");
      }
    });
  }
  document.addEventListener("click", function(e) {
    // Clicks inside a menu - toggles, sliders, text boxes, action buttons -
    // keep it open; only a click landing outside every menu dismisses.
    if (e.target.closest && e.target.closest(".menu")) {
      return;
    }
    closeAll();
  });
  document.addEventListener("keydown", function(e) {
    if (e.key == "Escape") {
      closeAll();
    }
  });
}

function fancyDblClickHandler(el, onsingle, ondouble) {
  return function() {
    if (el.getAttribute("data-dblclick") == null) {
      el.setAttribute("data-dblclick", 1);
      setTimeout(function() {
        if (el.getAttribute("data-dblclick") == 1) {
          onsingle();
        }
        el.removeAttribute("data-dblclick");
      }, 200);
    } else {
      el.removeAttribute("data-dblclick");
      ondouble();
    }
  }
}

function smoothScrollToRow(rowid) {
  document.getElementById(rowid).scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "nearest"
  });
}

function focusInputField(input) {
  input.scrollIntoView(false);
  input.focus();
  input.select();
}

function copyToClipboard() {
  var text = '';
  for (var node of bomhead.childNodes[0].childNodes) {
    if (node.firstChild) {
      text = text + node.firstChild.nodeValue;
    }
    if (node != bomhead.childNodes[0].lastChild) {
      text += '\t';
    }
  }
  text += '\n';
  for (var row of bombody.childNodes) {
    for (var cell of row.childNodes) {
      for (var node of cell.childNodes) {
        if (node.nodeName == "INPUT") {
          if (node.checked) {
            text = text + '✓';
          }
        } else if (node.nodeName == "MARK") {
          text = text + node.firstChild.nodeValue;
        } else {
          text = text + node.nodeValue;
        }
      }
      if (cell != row.lastChild) {
        text += '\t';
      }
    }
    text += '\n';
  }
  var textArea = document.createElement("textarea");
  textArea.classList.add('clipboard-temp');
  textArea.value = text;

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    if (document.execCommand('copy')) {
      console.log('Bom copied to clipboard.');
    }
  } catch (err) {
    console.log('Can not copy to clipboard.');
  }

  document.body.removeChild(textArea);
}

function removeGutterNode(node) {
  for (var i = 0; i < node.childNodes.length; i++) {
    if (node.childNodes[i].classList &&
      node.childNodes[i].classList.contains("gutter")) {
      node.removeChild(node.childNodes[i]);
      break;
    }
  }
}

function cleanGutters() {
  removeGutterNode(document.getElementById("bot"));
  removeGutterNode(document.getElementById("canvasdiv"));
}

var units = {
  prefixes: {
    giga: ["G", "g", "giga", "Giga", "GIGA"],
    mega: ["M", "mega", "Mega", "MEGA"],
    kilo: ["K", "k", "kilo", "Kilo", "KILO"],
    milli: ["m", "milli", "Milli", "MILLI"],
    micro: ["U", "u", "micro", "Micro", "MICRO", "μ", "µ"], // different utf8 μ
    nano: ["N", "n", "nano", "Nano", "NANO"],
    pico: ["P", "p", "pico", "Pico", "PICO"],
  },
  unitsShort: ["R", "r", "Ω", "F", "f", "H", "h"],
  unitsLong: [
    "OHM", "Ohm", "ohm", "ohms",
    "FARAD", "Farad", "farad",
    "HENRY", "Henry", "henry"
  ],
  getMultiplier: function(s) {
    if (this.prefixes.giga.includes(s)) return 1e9;
    if (this.prefixes.mega.includes(s)) return 1e6;
    if (this.prefixes.kilo.includes(s)) return 1e3;
    if (this.prefixes.milli.includes(s)) return 1e-3;
    if (this.prefixes.micro.includes(s)) return 1e-6;
    if (this.prefixes.nano.includes(s)) return 1e-9;
    if (this.prefixes.pico.includes(s)) return 1e-12;
    return 1;
  },
  valueRegex: null,
}

function initUtils() {
  var allPrefixes = units.prefixes.giga
                    .concat(units.prefixes.mega)
                    .concat(units.prefixes.kilo)
                    .concat(units.prefixes.milli)
                    .concat(units.prefixes.micro)
                    .concat(units.prefixes.nano)
                    .concat(units.prefixes.pico);
  var allUnits = units.unitsShort.concat(units.unitsLong);
  units.valueRegex = new RegExp("^([0-9\.]+)" +
                         "\\s*(" + allPrefixes.join("|") + ")?" +
                         "(" + allUnits.join("|") + ")?" +
                         "(\\b.*)?$", "");
  units.valueAltRegex = new RegExp("^([0-9]*)" +
                         "(" + units.unitsShort.join("|") + ")?" +
                         "([GgMmKkUuNnPp])?" +
                         "([0-9]*)" +
                         "(\\b.*)?$", "");
  for (var bom_type of ["both", "F", "B", "nobom", "nobomF", "nobomB"]) {
    if (!pcbdata.bom[bom_type]) continue;
    for (var row of pcbdata.bom[bom_type]) {
      if (row.length < 7) row.push("");   // [6] = description column
      row.push(parseValue(row[1], row[3][0][0]));
    }
  }
}

function parseValue(val, ref) {
  var inferUnit = (unit, ref) => {
    if (unit) {
      unit = unit.toLowerCase();
      if (unit == 'Ω' || unit == "ohm" || unit == "ohms") {
        unit = 'r';
      }
      unit = unit[0];
    } else {
      ref = /^([a-z]+)\d+$/i.exec(ref);
      if (ref) {
        ref = ref[1].toLowerCase();
        if (ref == "c") unit = 'f';
        else if (ref == "l") unit = 'h';
        else if (ref == "r" || ref == "rv") unit = 'r';
        else unit = null;
      }
    }
    return unit;
  };
  val = val.replace(/,/g, "");
  var match = units.valueRegex.exec(val);
  var unit;
  if (match) {
    val = parseFloat(match[1]);
    if (match[2]) {
      val = val * units.getMultiplier(match[2]);
    }
    unit = inferUnit(match[3], ref);
    if (!unit) return null;
    else return {
      val: val,
      unit: unit,
      extra: match[4],
    }
  }
  match = units.valueAltRegex.exec(val);
  if (match && (match[1] || match[4])) {
    val = parseFloat(match[1] + "." + match[4]);
    if (match[3]) {
      val = val * units.getMultiplier(match[3]);
    }
    unit = inferUnit(match[2], ref);
    if (!unit) return null;
    else return {
      val: val,
      unit: unit,
      extra: match[5],
    }
  }
  return null;
}

function valueCompare(a, b, stra, strb) {
  if (a === null && b === null) {
    // Failed to parse both values, compare them as strings.
    if (stra != strb) return stra > strb ? 1 : -1;
    else return 0;
  } else if (a === null) {
    return 1;
  } else if (b === null) {
    return -1;
  } else {
    if (a.unit != b.unit) return a.unit > b.unit ? 1 : -1;
    else if (a.val != b.val) return a.val > b.val ? 1 : -1;
    else if (a.extra != b.extra) return a.extra > b.extra ? 1 : -1;
    else return 0;
  }
}

function validateSaveImgDimension(element) {
  var valid = false;
  var intValue = 0;
  if (/^[1-9]\d*$/.test(element.value)) {
    intValue = parseInt(element.value);
    if (intValue <= 16000) {
      valid = true;
    }
  }
  if (valid) {
    element.classList.remove("invalid");
  } else {
    element.classList.add("invalid");
  }
  return intValue;
}

function saveImage(layer) {
  var width = validateSaveImgDimension(document.getElementById("render-save-width"));
  var height = validateSaveImgDimension(document.getElementById("render-save-height"));
  var bgcolor = null;
  if (!document.getElementById("render-save-transparent").checked) {
    var style = getComputedStyle(topmostdiv);
    bgcolor = style.getPropertyValue("background-color");
  }
  if (!width || !height) return;

  // Prepare image
  var canvas = document.createElement("canvas");
  var layerdict = {
    transform: {
      x: 0,
      y: 0,
      s: 1,
      panx: 0,
      pany: 0,
      zoom: 1,
    },
    bg: canvas,
    fab: canvas,
    silk: canvas,
    highlight: canvas,
    layer: layer,
  }
  // Do the rendering
  recalcLayerScale(layerdict, width, height);
  prepareLayer(layerdict);
  clearCanvas(canvas, bgcolor);
  drawBackground(layerdict, false);
  drawHighlightsOnLayer(layerdict, false);

  // Save image
  var imgdata = canvas.toDataURL("image/png");

  var filename = pcbdata.metadata.title;
  if (pcbdata.metadata.revision) {
    filename += `.${pcbdata.metadata.revision}`;
  }
  filename += `.${layer}.png`;
  saveFile(filename, dataURLtoBlob(imgdata));
}

function renderLayerToImage(layer, width, height) {
  var canvas = document.createElement("canvas");
  var layerdict = {
    transform: { x: 0, y: 0, s: 1, panx: 0, pany: 0, zoom: 1 },
    bg: canvas, fab: canvas, silk: canvas, highlight: canvas,
    layer: layer,
  };
  recalcLayerScale(layerdict, width, height);
  prepareLayer(layerdict);
  clearCanvas(canvas, "#ffffff");
  drawBackground(layerdict, false);
  drawHighlightsOnLayer(layerdict, false);
  return canvas.toDataURL("image/png");
}

// ---------------------------------------------------------------------------
// Silkscreen -> PDF export
//
// The PDF is written by hand for the same reason the .xlsx above is: this page
// is a single offline file and cannot fetch a PDF library. Keeping the file to
// nothing but JPEG image streams (DCTDecode) and a page tree makes that small
// enough to do from scratch. Even the sheet caption is drawn into the canvas
// before encoding, so no font object appears anywhere in the file.
//
// The old approach opened a blank tab with the two sheets and fired
// window.print(), expecting the browser dialog's "Save as PDF" destination.
// That chain broke too often - the dialog never appearing, embedded browsers
// without a working print pipeline - and left the user stranded on a bare
// about:blank page. The button now produces the PDF itself and hands it to the
// same "Save as" helper the BOM export uses.
// ---------------------------------------------------------------------------

function printSilkscreen() {
  try {
    var bbox = applyRotation(pcbdata.edges_bbox);
    var bw = bbox.maxx - bbox.minx;
    var bh = bbox.maxy - bbox.miny;
    var landscape = bw > bh;
    var maxW = landscape ? 4800 : 3600;
    var maxH = landscape ? 3600 : 4800;
    var scale = Math.min(maxW / bw, maxH / bh);
    var imgW = Math.round(bw * scale);
    var imgH = Math.round(bh * scale);
    // One layer per A4 sheet. The caption lives in a band above the board so
    // the drawing can never run under the text, and it is drawn with canvas
    // text - embedding a PDF font would be the only non-image content otherwise.
    function renderOne(layer, label) {
      var capH = Math.max(48, Math.round(imgH * 0.03));
      var board = document.createElement("canvas");
      board.width = imgW;
      board.height = imgH - capH;
      var ld = { transform: { x: 0, y: 0, s: 1, panx: 0, pany: 0, zoom: 1 }, bg: board, fab: board, silk: board, highlight: board, layer: layer };
      recalcLayerScale(ld, imgW, imgH - capH);
      prepareLayer(ld);
      clearCanvas(board, "#ffffff");
      drawBackground(ld, false);
      var out = document.createElement("canvas");
      out.width = imgW;
      out.height = imgH;
      var ctx = out.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, imgW, imgH);
      ctx.fillStyle = "#000000";
      ctx.font = "bold " + Math.max(24, Math.round(capH * 0.55)) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, imgW / 2, capH / 2);
      ctx.drawImage(board, 0, capH);
      // JPEG (not PNG): DCTDecode lets the PDF embed the bytes as-is.
      return out.toDataURL("image/jpeg", 0.92);
    }
    var title = pcbdata.metadata.title || "Silkscreen";
    var layers = [
      { layer: "F", label: title + " - Top (F)" },
      { layer: "B", label: title + " - Bottom (B)" },
    ];
    for (var i = 0; i < layers.length; i++) {
      layers[i].jpeg = atob(renderOne(layers[i].layer, layers[i].label).split(",")[1]);
      layers[i].w = imgW;
      layers[i].h = imgH;
    }
    // A4 in PostScript points (1mm = 72/25.4pt) with the same 10mm margins the
    // printed sheet used.
    var PW = landscape ? 841.89 : 595.28;
    var PH = landscape ? 595.28 : 841.89;
    var M = 28.35;
    var n = layers.length;
    var chunks = [];
    var offset = 0;
    var offsets = [];
    function push(s) { chunks.push(s); offset += s.length; }
    // Header comment bytes are >127 on purpose: they mark the file as binary
    // so line-ending translation must leave it alone.
    push("%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n");
    // Object layout: 1 = catalog, 2 = page tree, then per sheet a page object,
    // its content stream and its image xobject at 3+i*3, +1 and +2.
    offsets[1] = offset;
    push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    var kids = [];
    for (var i = 0; i < n; i++) kids.push((3 + i * 3) + " 0 R");
    offsets[2] = offset;
    push("2 0 obj\n<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + n + " >>\nendobj\n");
    for (var i = 0; i < n; i++) {
      var im = layers[i];
      var p = 3 + i * 3;               // page object
      var c = p + 1;                   // content stream
      var x = p + 2;                   // image xobject
      // Letterbox the sheet inside the printable box, centred - an image that
      // does not match A4's aspect ratio never leaves its page.
      var fit = Math.min((PW - 2 * M) / im.w, (PH - 2 * M) / im.h);
      var dw = im.w * fit;
      var dh = im.h * fit;
      var dx = ((PW - dw) / 2).toFixed(2);
      var dy = ((PH - dh) / 2).toFixed(2);
      var content = "q\n" + dw.toFixed(2) + " 0 0 " + dh.toFixed(2) + " " + dx + " " + dy + " cm\n/Im1 Do\nQ\n";
      offsets[p] = offset;
      push(p + " 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PW + " " + PH + "] /Resources << /XObject << /Im1 " + x + " 0 R >> >> /Contents " + c + " 0 R >>\nendobj\n");
      offsets[c] = offset;
      push(c + " 0 obj\n<< /Length " + content.length + " >>\nstream\n" + content + "endstream\nendobj\n");
      offsets[x] = offset;
      push(x + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + im.w + " /Height " + im.h + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + im.jpeg.length + " >>\nstream\n" + im.jpeg + "\nendstream\nendobj\n");
    }
    var total = 2 + n * 3;
    var xrefStart = offset;
    var xref = "xref\n0 " + (total + 1) + "\n0000000000 65535 f \n";
    for (var i = 1; i <= total; i++) {
      xref += ("0000000000" + offsets[i]).slice(-10) + " 00000 n \n";
    }
    push(xref);
    push("trailer\n<< /Size " + (total + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF");
    // Every char of the joined string is < 256, so it maps 1:1 onto bytes.
    var whole = chunks.join("");
    var bytes = new Uint8Array(whole.length);
    for (var i = 0; i < whole.length; i++) bytes[i] = whole.charCodeAt(i) & 0xff;
    var mime = "application/pdf";
    var blob = new Blob([bytes], { type: mime });
    if (!saveFileAs(xlsxSafeName(title, "Silkscreen") + "-Silkscreen.pdf", blob, {
      pickerId: "interactivehtmlbom-silkscreen",
      mime: mime,
      extension: ".pdf",
      description: "PDF 文档"
    })) {
      alert(DOWNLOAD_FALLBACK_HINT);
    }
  } catch(e) { alert("错误：" + e.message); }
}

// ---------------------------------------------------------------------------
// BOM -> Excel (.xlsx) export
//
// The generated page is a single offline file, so it cannot fetch a spreadsheet
// library. It does not need one either: an .xlsx is a zip archive of XML parts,
// and a zip may *store* its entries instead of deflating them. A CRC32 plus the
// zip record layout below is therefore all it takes.
//
// Row numbers and the checkbox columns are dropped, as the old printout did -
// they carry no information in a spreadsheet. They are recognised by their
// data-field rather than by a fixed index, because the user may have dragged any
// column anywhere.
// ---------------------------------------------------------------------------

var zipCrcTable = null;

function zipCrc32(bytes) {
  if (!zipCrcTable) {
    var t = [], n, k, c;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[n] = c >>> 0;
    }
    zipCrcTable = t;
  }
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) {
    crc = zipCrcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Hand-rolled on purpose: TextEncoder is not guaranteed in the older embedded
// browsers this page sometimes gets opened in.
function utf8Bytes(str) {
  var out = [], i, c, c2;
  for (i = 0; i < str.length; i++) {
    c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
    } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length &&
               str.charCodeAt(i + 1) >= 0xDC00 && str.charCodeAt(i + 1) <= 0xDFFF) {
      c2 = str.charCodeAt(++i);
      c = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
      out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F),
               0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    } else {
      out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
  }
  return new Uint8Array(out);
}

function zipU16(arr, v) { arr.push(v & 0xFF, (v >>> 8) & 0xFF); }
function zipU32(arr, v) {
  arr.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF);
}

// entries: [{name: string, data: Uint8Array}] -> Uint8Array holding a zip whose
// entries are all stored (method 0), so no compressor is involved.
function zipStore(entries) {
  var out = [], central = [], offset = 0, i, j;
  for (i = 0; i < entries.length; i++) {
    var name = utf8Bytes(entries[i].name);
    var data = entries[i].data;
    var crc = zipCrc32(data);
    zipU32(out, 0x04034B50);   // local file header
    zipU16(out, 20);           // version needed to extract
    zipU16(out, 0x0800);       // flags: file names are UTF-8
    zipU16(out, 0);            // method 0 = stored
    zipU16(out, 0);            // modification time
    zipU16(out, 0x21);         // modification date, 1980-01-01
    zipU32(out, crc);
    zipU32(out, data.length);  // compressed size
    zipU32(out, data.length);  // uncompressed size
    zipU16(out, name.length);
    zipU16(out, 0);            // extra field length
    for (j = 0; j < name.length; j++) out.push(name[j]);
    for (j = 0; j < data.length; j++) out.push(data[j]);

    zipU32(central, 0x02014B50);  // central directory header
    zipU16(central, 20);          // version made by
    zipU16(central, 20);          // version needed
    zipU16(central, 0x0800);
    zipU16(central, 0);
    zipU16(central, 0);
    zipU16(central, 0x21);
    zipU32(central, crc);
    zipU32(central, data.length);
    zipU32(central, data.length);
    zipU16(central, name.length);
    zipU16(central, 0);           // extra field
    zipU16(central, 0);           // comment
    zipU16(central, 0);           // disk number start
    zipU16(central, 0);           // internal attributes
    zipU32(central, 0);           // external attributes
    zipU32(central, offset);      // offset of this entry's local header
    for (j = 0; j < name.length; j++) central.push(name[j]);

    offset += 30 + name.length + data.length;
  }
  var cdStart = out.length;
  for (i = 0; i < central.length; i++) out.push(central[i]);
  zipU32(out, 0x06054B50);        // end of central directory
  zipU16(out, 0);                 // this disk
  zipU16(out, 0);                 // disk with the central directory
  zipU16(out, entries.length);
  zipU16(out, entries.length);
  zipU32(out, central.length);
  zipU32(out, cdStart);
  zipU16(out, 0);                 // comment length
  return new Uint8Array(out);
}

// Control characters are not legal in XML 1.0, and a BOM description taken from
// a schematic is not guaranteed to be clean text.
function xmlEscape(s) {
  return String(s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xlsxColName(n) {
  var s = "";
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = (n - 1 - r) / 26;
  }
  return s;
}

// Excel rejects a sheet name containing []:*?/\ or longer than 31 characters.
function xlsxSafeName(name, fallback) {
  var s = String(name == null ? "" : name).replace(/[\\\/:*?"<>|\[\]]/g, "_");
  s = s.replace(/^\s+|\s+$/g, "");
  return s.length ? s : fallback;
}

var XLSX_STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '</fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function xlsxSheetXml(header, rows, numericFields) {
  var ncols = header.length;
  var lastRow = rows.length + 1;
  var lastCell = ncols > 0 ? xlsxColName(ncols) + lastRow : "A1";
  var out = [], r, c, ref, val, w;

  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
  out.push('<dimension ref="A1:' + lastCell + '"/>');
  // Freeze the header row: a BOM is long and the titles scroll away otherwise.
  out.push('<sheetViews><sheetView workbookViewId="0">' +
           '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
           '</sheetView></sheetViews>');
  out.push('<sheetFormatPr defaultRowHeight="15"/>');
  // Width per column, guessed from the widest cell so nothing opens squashed.
  out.push('<cols>');
  for (c = 0; c < ncols; c++) {
    w = String(header[c]).length + 2;
    for (r = 0; r < rows.length; r++) {
      if (rows[r][c] != null && String(rows[r][c]).length + 2 > w) {
        w = String(rows[r][c]).length + 2;
      }
    }
    if (w < 8) { w = 8; }
    if (w > 60) { w = 60; }
    out.push('<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + w +
             '" customWidth="1"/>');
  }
  out.push('</cols>');
  out.push('<sheetData>');
  out.push('<row r="1">');
  for (c = 0; c < ncols; c++) {
    out.push('<c r="' + xlsxColName(c + 1) + '1" s="1" t="inlineStr">' +
             '<is><t xml:space="preserve">' + xmlEscape(header[c]) + '</t></is></c>');
  }
  out.push('</row>');
  for (r = 0; r < rows.length; r++) {
    out.push('<row r="' + (r + 2) + '">');
    for (c = 0; c < ncols; c++) {
      ref = xlsxColName(c + 1) + (r + 2);
      val = rows[r][c] == null ? "" : String(rows[r][c]);
      if (numericFields && numericFields[c] && /^-?\d+(\.\d+)?$/.test(val)) {
        out.push('<c r="' + ref + '"><v>' + val + '</v></c>');
      } else {
        out.push('<c r="' + ref + '" t="inlineStr">' +
                 '<is><t xml:space="preserve">' + xmlEscape(val) + '</t></is></c>');
      }
    }
    out.push('</row>');
  }
  out.push('</sheetData>');
  if (ncols > 0) {
    out.push('<autoFilter ref="A1:' + lastCell + '"/>');
  }
  out.push('</worksheet>');
  return out.join("");
}

function xlsxBytes(sheetName, header, rows, numericFields) {
  // The sheet name is validated here, not by the caller: Excel rejects illegal
  // characters and anything longer than 31 characters outright.
  var safe = xlsxSafeName(sheetName, "BOM");
  if (safe.length > 31) { safe = safe.slice(0, 31); }
  var parts = [
    ["[Content_Types].xml",
     '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
     '<Default Extension="xml" ContentType="application/xml"/>' +
     '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
     '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
     '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
     '</Types>'],
    ["_rels/.rels",
     '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
     '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
     '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
     '</Relationships>'],
    ["xl/workbook.xml",
     '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
     '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
     'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
     '<sheets><sheet name="' + xmlEscape(safe) + '" sheetId="1" r:id="rId1"/></sheets>' +
     '</workbook>'],
    ["xl/_rels/workbook.xml.rels",
     '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
     '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
     '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
     '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
     '</Relationships>'],
    ["xl/styles.xml", XLSX_STYLES],
    ["xl/worksheets/sheet1.xml", xlsxSheetXml(header, rows, numericFields)]
  ];
  var entries = [];
  for (var i = 0; i < parts.length; i++) {
    entries.push({ name: parts[i][0], data: utf8Bytes(parts[i][1]) });
  }
  return zipStore(entries);
}

// Read the visible BOM table back out of the DOM.
function bomSheetFromDom() {
  var head = document.getElementById("bomhead");
  var body = document.getElementById("bombody");
  var header = [], fields = [], rows = [];

  function keep(cell) {
    var f = cell.getAttribute ? cell.getAttribute("data-field") : null;
    return f != null && f !== "rownum" && f.indexOf("checkbox:") !== 0;
  }
  function text(node) {
    return String(node.textContent == null ? "" : node.textContent)
      .replace(/^\s+|\s+$/g, "");
  }

  if (head) {
    var htr = head.querySelector("tr");
    if (htr) {
      var hcells = htr.querySelectorAll("th");
      for (var i = 0; i < hcells.length; i++) {
        if (!keep(hcells[i])) continue;
        header.push(text(hcells[i]));
        fields.push(hcells[i].getAttribute("data-field"));
      }
    }
  }
  if (body) {
    var trs = body.querySelectorAll("tr");
    for (var r = 0; r < trs.length; r++) {
      var cells = trs[r].querySelectorAll("td");
      var row = [];
      for (var c = 0; c < cells.length; c++) {
        if (!keep(cells[c])) continue;
        row.push(text(cells[c]));
      }
      rows.push(row);
    }
  }
  return { header: header, rows: rows, fields: fields };
}

function exportBom() {
  try {
    var sheet = bomSheetFromDom();
    if (sheet.header.length === 0) {
      alert("BOM 为空，没有可导出的内容。");
      return;
    }
    // Only Quantity becomes a real number so Excel can sum and sort it. Every
    // other column stays text on purpose - a footprint like "0603" must not
    // turn into the number 603.
    var numeric = [];
    for (var i = 0; i < sheet.fields.length; i++) {
      numeric.push(sheet.fields[i] === "quantity");
    }
    var title = (pcbdata && pcbdata.metadata && pcbdata.metadata.title) || "BOM";
    var bytes = xlsxBytes(xlsxSafeName(title, "BOM"), sheet.header, sheet.rows, numeric);
    var mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    var blob = new Blob([bytes], {type: mime});
    // Go through the "Save as" helper so the workbook can be put next to the
    // page it was exported from instead of being trapped in the download
    // folder. Wherever the picker is unavailable the helper quietly falls back
    // to a plain download, so this can never make the button stop working.
    // saveFileAs returns false when no dialog was possible at all, and in that
    // path nothing has told the user where the file went.
    if (!saveFileAs(xlsxSafeName(title, "BOM") + "-BOM.xlsx", blob, {
      pickerId: "interactivehtmlbom-bom",
      mime: mime,
      extension: ".xlsx",
      description: "Excel 工作簿"
    })) {
      alert(DOWNLOAD_FALLBACK_HINT);
    }
  } catch(e) { alert("导出错误：" + e.message); }
}

function saveSettings() {
  var data = {
    type: "InteractiveHtmlBom settings",
    version: 1,
    pcbmetadata: pcbdata.metadata,
    settings: settings,
  }
  var blob = new Blob([JSON.stringify(data, null, 4)], {type: "application/json"});
  saveFile(`${pcbdata.metadata.title}.settings.json`, blob);
}

function loadSettings() {
  var input = document.createElement("input");
  input.type = "file";
  input.accept = ".settings.json";
  input.onchange = function(e) {
    var file = e.target.files[0];
    var reader = new FileReader();
    reader.onload = readerEvent => {
      var content = readerEvent.target.result;
      var newSettings;
      try {
        newSettings = JSON.parse(content);
      } catch(e) {
        alert("所选文件不是 InteractiveHtmlBom 设置文件。");
        return;
      }
      if (newSettings.type != "InteractiveHtmlBom settings") {
        alert("所选文件不是 InteractiveHtmlBom 设置文件。");
        return;
      }
      var metadataMatches = newSettings.hasOwnProperty("pcbmetadata");
      if (metadataMatches) {
        for (var k in pcbdata.metadata) {
          if (!newSettings.pcbmetadata.hasOwnProperty(k) || newSettings.pcbmetadata[k] != pcbdata.metadata[k]) {
            metadataMatches = false;
          }
        }
      }
      if (!metadataMatches) {
        var currentMetadata = JSON.stringify(pcbdata.metadata, null, 4);
        var fileMetadata = JSON.stringify(newSettings.pcbmetadata, null, 4);
        if (!confirm(
          `Settins file metadata does not match current metadata.\n\n` +
          `Page metadata:\n${currentMetadata}\n\n` +
          `Settings file metadata:\n${fileMetadata}\n\n` +
          `Press OK if you would like to import settings anyway.`)) {
          return;
        }
      }
      overwriteSettings(newSettings.settings);
    }
    reader.readAsText(file, 'UTF-8');
  }
  input.click();
}

function overwriteSettings(newSettings) {
  initDone = false;
  // A settings file written before the rename carries "Track nets" and no
  // "Net names" key at all. Carry the old choice over instead of letting
  // Object.assign leave the default in place, which would switch every net name
  // back on behind the user's back.
  if (newSettings.renderNetNames === undefined &&
      newSettings.renderTrackNets !== undefined) {
    newSettings.renderNetNames = newSettings.renderTrackNets;
  }
  Object.assign(settings, newSettings);
  writeStorage("bomlayout", settings.bomlayout);
  writeStorage("bommode", settings.bommode);
  writeStorage("canvaslayout", settings.canvaslayout);
  writeStorage("bomCheckboxes", settings.checkboxes.join(","));
  document.getElementById("bomCheckboxes").value = settings.checkboxes.join(",");
  for (var checkbox of settings.checkboxes) {
    writeStorage("checkbox_" + checkbox, settings.checkboxStoredRefs[checkbox]);
  }
  writeStorage("darkenWhenChecked", settings.darkenWhenChecked);
  padsVisible(settings.renderPads);
  document.getElementById("padsCheckbox").checked = settings.renderPads;
  // Files written before the switch was renamed carry no renderVias key at
  // all; `!== false` then leaves vias visible, which is the old behaviour.
  viasVisible(settings.renderVias !== false);
  document.getElementById("hideViasCheckbox").checked = settings.renderVias !== false;
  fabricationVisible(settings.renderFabrication);
  document.getElementById("fabricationCheckbox").checked = settings.renderFabrication;
  silkscreenVisible(settings.renderSilkscreen);
  document.getElementById("silkscreenCheckbox").checked = settings.renderSilkscreen;
  referencesVisible(settings.renderReferences);
  document.getElementById("referencesCheckbox").checked = settings.renderReferences;
  valuesVisible(settings.renderValues);
  document.getElementById("valuesCheckbox").checked = settings.renderValues;
  // An imported file may predate the native switch; Object.assign then left the
  // value initDefaults() picked, and `!== false` keeps it visible either way.
  nativeLabelsVisible(settings.renderNativeLabels !== false);
  document.getElementById("nativeLabelsCheckbox").checked =
    settings.renderNativeLabels !== false;
  tracksVisible(settings.renderTracks);
  document.getElementById("tracksCheckbox").checked = settings.renderTracks;
  zonesVisible(settings.renderZones);
  document.getElementById("zonesCheckbox").checked = settings.renderZones;
  netNamesVisible(settings.renderNetNames !== false);
  document.getElementById("netNamesCheckbox").checked =
    settings.renderNetNames !== false;
  dnpOutline(settings.renderDnpOutline);
  document.getElementById("dnpOutlineCheckbox").checked = settings.renderDnpOutline;
  // Same for the ALL toggle: an imported file may predate it, and `!== false`
  // keeps a board whose inner panes were switched off switched off.
  allLayersVisible(settings.showAllLayers !== false);
  noBomVisible(settings.showNoBom);
  document.getElementById("noBomCheckbox").checked = settings.showNoBom;
  setRedrawOnDrag(settings.redrawOnDrag);
  document.getElementById("dragCheckbox").checked = settings.redrawOnDrag;
  setDarkMode(settings.darkMode);
  document.getElementById("darkmodeCheckbox").checked = settings.darkMode;
  setHighlightPin1(settings.highlightpin1);
  document.getElementById("highlightpin1Checkbox").checked = settings.highlightpin1;
  writeStorage("boardRotation", settings.boardRotation);
  document.getElementById("boardRotation").value = settings.boardRotation / 5;
  document.getElementById("rotationDegree").textContent = settings.boardRotation;
  // Label sizes and positions. An imported file may predate them, in which case
  // Object.assign left the values initDefaults() picked in place; a zero size
  // still has to be replaced because it would fall back to per-footprint
  // sizing behind the user's back.
  // [2026-09-25] The uniform-size checkbox is gone (replaced by the "reset
  // font sizes" button): uniform sizing is the only mode now, so an imported
  // "false" is ignored on purpose.
  setUniformLabelSize(true);
  if (!(settings.refFontSize > 0)) {
    settings.refFontSize = defaultLabelFontSize();
  }
  if (!(settings.valFontSize > 0)) {
    settings.valFontSize = defaultLabelFontSize();
  }
  if (!(settings.netFontSize > 0)) {
    settings.netFontSize = autoNetFontSize();
  }
  writeStorage("refFontSize", settings.refFontSize);
  writeStorage("valFontSize", settings.valFontSize);
  if (!settings.labelOffsets || typeof settings.labelOffsets != "object") {
    settings.labelOffsets = {};
  }
  saveLabelOffsets();
  // An imported settings file may predate the manual angles entirely.
  if (!settings.labelRotations || typeof settings.labelRotations != "object") {
    settings.labelRotations = {};
  }
  saveLabelRotations();
  applyLabelFontSizeInputs();
  initDone = true;
  prepCheckboxes();
  changeBomLayout(settings.bomlayout);
}

function saveFile(filename, blob) {
  var link = document.createElement("a");
  var objurl = URL.createObjectURL(blob);
  link.download = filename;
  link.href = objurl;
  link.click();
}

// saveFile() can only drop a file in the browser's download folder - a page has
// no say in the path. Chromium adds a real "Save as" dialog through the File
// System Access API, which is the only way to put an exported file somewhere
// else (such as the folder the page itself lives in).
//
// Treat it strictly as an upgrade, never as a requirement:
//   - it exists only in Chromium, not Firefox or Safari;
//   - Chromium exposes it to secure origins, and a page opened straight from
//     disk is normally refused until the user enables
//     chrome://flags/#file-system-access and grants "Local file system" to the
//     page in its site settings.
// So every refusal - unsupported browser, refused origin, revoked permission,
// cancelled dialog handled separately - ends in the ordinary download. The
// button must keep working even where the dialog never appears.
//
// But never fall back SILENTLY. A download nobody asked for looks exactly like a
// failed export to whoever pressed the button, which is the whole reason this
// file exists. When there is no dialog, say where the file went and how to get
// a dialog back.
var DOWNLOAD_FALLBACK_HINT =
  "浏览器不允许这一页选择保存位置，文件已保存到“下载”文件夹。\n\n" +
  "想自己指定目录（例如与本 HTML 页面放在一起）：\n" +
  "用 Chrome 或 Edge 打开本页，地址栏输入 chrome://flags/#file-system-access\n" +
  "启用该选项并重启浏览器，之后点击 BOM 按钮会弹出“另存为”对话框。\n" +
  "选过一次之后，浏览器会记住那个文件夹，下次默认就在那里。";

function pickerAvailable() {
  try {
    return typeof window !== "undefined" &&
      typeof window.showSaveFilePicker === "function";
  } catch(e) {
    return false;
  }
}

function saveFileAs(filename, blob, options) {
  if (!pickerAvailable()) {
    saveFile(filename, blob);
    return false;
  }

  var opts = {suggestedName: filename};
  // "id" makes the browser reopen the folder last used for this id, so once the
  // BOM has been saved beside the page, that folder is proposed again next time
  // rather than wherever the browser happens to start.
  if (options && options.pickerId) {
    opts.id = options.pickerId;
  }
  if (options && options.mime) {
    var accept = {};
    accept[options.mime] = [options.extension];
    opts.types = [{description: options.description || "File", accept: accept}];
  }

  var request;
  try {
    // Called synchronously on purpose: the API needs transient user activation,
    // and awaiting anything first would consume the click.
    request = window.showSaveFilePicker(opts);
  } catch(e) {
    saveFile(filename, blob);
    return false;
  }

  var write = function(handle) {
    return handle.createWritable().then(function(writable) {
      return Promise.resolve(writable.write(blob)).then(function() {
        return writable.close();
      });
    });
  };
  var failed = function(e) {
    // Dismissing the dialog is a deliberate "no" - do not download anyway, and
    // do not explain anything either: the user just cancelled on purpose.
    if (e && e.name === "AbortError") {
      return;
    }
    // Anything else means the picker is unusable here after all, so hand the
    // file over the way that always works - and say so, since a download nobody
    // asked for is indistinguishable from a silent failure.
    saveFile(filename, blob);
    alert(DOWNLOAD_FALLBACK_HINT);
  };

  Promise.resolve(request).then(write).then(null, failed);
  return true;
}

function dataURLtoBlob(dataurl) {
  var arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
      bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
  while(n--){
      u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], {type:mime});
}

var settings = {
  canvaslayout: "default",
  bomlayout: "default",
  bommode: "grouped",
  checkboxes: [],
  checkboxStoredRefs: {},
  darkMode: false,
  highlightpin1: false,
  redrawOnDrag: true,
  boardRotation: 0,
  renderPads: true,
  // Vias and via-like through pads. The menu switch reads positively ("过孔"),
  // the render side asks hideViasMode = !renderVias.
  renderVias: true,
  renderReferences: true,
  renderValues: true,
  // The reference / value text Altium itself placed on the silkscreen. Separate
  // from renderReferences / renderValues, which own the labels this page
  // generates, so the two sources can be shown and hidden independently.
  renderNativeLabels: true,
  renderSilkscreen: true,
  renderFabrication: true,
  renderDnpOutline: false,
  renderTracks: true,
  renderZones: true,
  // Net names on pads, vias and tracks. Was renderTrackNets / "Track nets",
  // which named tracks only - see the migration in initDefaults().
  renderNetNames: true,
  showNoBom: false,
  // Footprint reference / value labels. With uniformLabelSize the two sizes
  // below are used for every label; otherwise each label is sized from its
  // footprint. labelOffsets holds the hand-placed nudges and labelRotations the
  // hand-set angles (degrees, 90 at a time), both keyed by reference.
  uniformLabelSize: true,
  refFontSize: 0,
  valFontSize: 0,
  // Net-name label height in mm; 0 = never set, render keeps the old 0.1mm.
  netFontSize: 0,
  labelOffsets: {},
  labelRotations: {},
}

function initDefaults() {
  // AD's JScript serializes boolean false as 0 in the embedded config
  // ("show_tracks":0) while true stays true. These dialog presets mean
  // "on unless the export dialog explicitly turned them off", so a bare
  // `!== false` check misreads 0 as "key absent" and ticks the box anyway.
  // undefined (old pages without the key) stays at the visible default.
  function dialogPresetOn(key) {
    return config[key] === undefined ? true : !!config[key];
  }
  // Each export embeds a unique config.page_id. When it differs from the one
  // stored by the last page this browser opened, the page is a NEW export and
  // the export dialog's presets win over whatever localStorage was left
  // behind (file:// pages share ONE localStorage bucket, so a toggle from any
  // earlier board would otherwise shadow the dialog's checkboxes forever).
  // The winning values are then persisted, so in-page tweaks still survive a
  // plain reload of the same exported file.
  var storedPageId = readStorage("pageId");
  var freshExport = (typeof config.page_id == "string" && config.page_id !== "" &&
    storedPageId !== config.page_id);
  if (freshExport) {
    writeStorage("pageId", config.page_id);
    writeStorage("bomlayout", config.bom_view);
    writeStorage("canvaslayout", config.layer_view);
    if (config.checkboxes) {
      writeStorage("bomCheckboxes", config.checkboxes);
    }
  }
  settings.bomlayout = readStorage("bomlayout");
  if (settings.bomlayout === null) {
    settings.bomlayout = config.bom_view;
  }
  if (!['bom-only', 'left-right', 'top-bottom'].includes(settings.bomlayout)) {
    settings.bomlayout = config.bom_view;
  }
  settings.bommode = readStorage("bommode");
  if (settings.bommode === null) {
    settings.bommode = "grouped";
  }
  if (!["grouped", "ungrouped", "netlist"].includes(settings.bommode)) {
    settings.bommode = "grouped";
  }
  settings.canvaslayout = readStorage("canvaslayout");
  if (settings.canvaslayout === null) {
    settings.canvaslayout = config.layer_view;
  }
  var bomCheckboxes = readStorage("bomCheckboxes");
  if (bomCheckboxes === null) {
    bomCheckboxes = config.checkboxes;
  }
  settings.checkboxes = bomCheckboxes.split(",").filter((e) => e);
  document.getElementById("bomCheckboxes").value = bomCheckboxes;

  settings.darkenWhenChecked = readStorage("darkenWhenChecked") || "";
  populateDarkenWhenCheckedOptions();
  readBomColumnPrefs();

  function initBooleanSetting(storageString, def, elementId, func) {
    var b;
    if (freshExport) {
      // New export: the dialog's preset is authoritative. Persist it so a
      // reload of this same file (pageId now matches) keeps the value.
      b = def;
      writeStorage(storageString, b ? "true" : "false");
    } else {
      b = readStorage(storageString);
      if (b === null) {
        b = def;
      } else {
        b = (b == "true");
      }
    }
    document.getElementById(elementId).checked = b;
    func(b);
  }

  initBooleanSetting("padsVisible", config.show_pads, "padsCheckbox", padsVisible);
  // Vias are the positive switch here ("过孔", ticked = drawn); the element
  // keeps its old "hideVias" id because older exported pages look it up too.
  // Defaults to on: that is how the board looked before the switch existed.
  // The show_* config keys come from the AD export dialog; !== false keeps
  // pages without them (offline schematic, old data) at the visible default.
  initBooleanSetting("viasVisible", dialogPresetOn("show_vias"), "hideViasCheckbox", viasVisible);
  initBooleanSetting("fabricationVisible", config.show_fabrication, "fabricationCheckbox", fabricationVisible);
  initBooleanSetting("silkscreenVisible", config.show_silkscreen, "silkscreenCheckbox", silkscreenVisible);
  initBooleanSetting("referencesVisible", dialogPresetOn("show_references"),
    "referencesCheckbox", referencesVisible);
  initBooleanSetting("valuesVisible", dialogPresetOn("show_values"),
    "valuesCheckbox", valuesVisible);
  // Altium's own silkscreen ref/val text used to be ruled by the References /
  // Values switches. It has its own now, so on the first load after the update
  // seed it from the old keys and the board keeps looking exactly as it did.
  var nativeLabelsDefault = dialogPresetOn("show_native_labels");
  if (readStorage("nativeLabelsVisible") === null) {
    if (readStorage("referencesVisible") === "false" ||
        readStorage("valuesVisible") === "false") {
      nativeLabelsDefault = false;
    }
  }
  initBooleanSetting("nativeLabelsVisible", nativeLabelsDefault,
    "nativeLabelsCheckbox", nativeLabelsVisible);
  if ("tracks" in pcbdata) {
    initBooleanSetting("tracksVisible", dialogPresetOn("show_tracks"), "tracksCheckbox", tracksVisible);
    initBooleanSetting("zonesVisible", dialogPresetOn("show_zones"), "zonesCheckbox", zonesVisible);
  } else {
    document.getElementById("tracksAndZonesCheckboxes").style.display = "none";
    tracksVisible(false);
    zonesVisible(false);
  }
  // The net-name switch is registered outside that block because it names pads
  // and vias too, and a board with no track data still has both. It used to be
  // "Track nets"; seed the new key from the old one once so an existing board
  // keeps the choice the user already made.
  var netNamesDefault = dialogPresetOn("show_net_names");
  if (readStorage("netNamesVisible") === null) {
    var legacyNetNames = readStorage("trackNetsVisible");
    if (legacyNetNames !== null) {
      netNamesDefault = (legacyNetNames == "true");
    }
  }
  initBooleanSetting("netNamesVisible", netNamesDefault, "netNamesCheckbox",
    netNamesVisible);
  initBooleanSetting("dnpOutline", false, "dnpOutlineCheckbox", dnpOutline);
  if ("nobomComponents" in pcbdata.bom) {
    initBooleanSetting("noBomVisible", !!config.show_nobom, "noBomCheckbox", noBomVisible);
  } else {
    document.getElementById("noBomCheckbox").disabled = true;
  }
  initBooleanSetting("redrawOnDrag", config.redraw_on_drag, "dragCheckbox", setRedrawOnDrag);
  // The ALL button only means something once the board has inner copper;
  // without it the button stays hidden so nothing appears dead. It is a plain
  // button rather than a checkbox, so the stored value is read by hand instead
  // of going through initBooleanSetting (which drives an input's .checked).
  var allLayersBtn = document.getElementById("all-btn");
  // Pages exported before the ALL button exist still carry the old
  // label + checkbox; keep those working rather than leaving a dead control.
  var allLayersWrapper = document.getElementById("allLayersWrapper");
  if (allLayersBtn) {
    if (pcbdata.inners && pcbdata.inners.length) {
      allLayersBtn.style.display = "";
      var storedAllLayers = readStorage("allLayersVisible");
      allLayersVisible(storedAllLayers === null ? true : (storedAllLayers == "true"));
    } else {
      settings.showAllLayers = false;
      allLayersBtn.style.display = "none";
    }
  } else if (allLayersWrapper) {
    if (pcbdata.inners && pcbdata.inners.length) {
      allLayersWrapper.style.display = "";
      initBooleanSetting("allLayersVisible", true, "allLayersCheckbox",
        allLayersVisible);
    } else {
      settings.showAllLayers = false;
      allLayersWrapper.style.display = "none";
    }
  }
  initBooleanSetting("darkmode", config.dark_mode, "darkmodeCheckbox", setDarkMode);
  initBooleanSetting("highlightpin1", config.highlight_pin1, "highlightpin1Checkbox", setHighlightPin1);
  settings.boardRotation = readStorage("boardRotation");
  if (settings.boardRotation === null) {
    settings.boardRotation = config.board_rotation * 5;
  } else {
    settings.boardRotation = parseInt(settings.boardRotation);
  }
  document.getElementById("boardRotation").value = settings.boardRotation / 5;
  document.getElementById("rotationDegree").textContent = settings.boardRotation;

  // Footprint label size and hand-placed positions. The size defaults to the
  // median of the automatic per-footprint sizes (see defaultLabelFontSize) so
  // that switching to a uniform size does not make most labels bigger than
  // they already are.
  // [2026-09-25] The uniform-size checkbox is gone (replaced by the "reset
  // font sizes" button): uniform sizing is the only mode now.
  setUniformLabelSize(true);
  settings.labelOffsets = {};
  var storedLabelOffsets = readStorage("labelOffsets");
  if (storedLabelOffsets) {
    try {
      var parsedOffsets = JSON.parse(storedLabelOffsets);
      if (parsedOffsets && typeof parsedOffsets == "object") {
        settings.labelOffsets = parsedOffsets;
      }
    } catch (e) { /* ignore malformed setting */ }
  }
  settings.labelRotations = {};
  var storedLabelRotations = readStorage("labelRotations");
  if (storedLabelRotations) {
    try {
      var parsedRotations = JSON.parse(storedLabelRotations);
      if (parsedRotations && typeof parsedRotations == "object") {
        settings.labelRotations = parsedRotations;
      }
    } catch (e) { /* ignore malformed setting */ }
  }
  var defaultLabelSize = defaultLabelFontSize();
  var storedRefFontSize = parseFloat(readStorage("refFontSize"));
  var storedValFontSize = parseFloat(readStorage("valFontSize"));
  settings.refFontSize = isNaN(storedRefFontSize) ? defaultLabelSize
    : storedRefFontSize;
  settings.valFontSize = isNaN(storedValFontSize) ? defaultLabelSize
    : storedValFontSize;
  // Net names: the default follows the screen (0.1mm on a 1080p-ish window,
  // up to 0.2mm at full 4K - matching what users pick by hand); a stored
  // value always wins.
  var storedNetFontSize = parseFloat(readStorage("netFontSize"));
  settings.netFontSize = isNaN(storedNetFontSize) ? autoNetFontSize()
    : storedNetFontSize;
  applyLabelFontSizeInputs();
}

// Default net-name label height: 0.1mm scaled by the window width with 1920
// as the reference (clamped to 1..2), rounded to the 0.05mm slider step.
// Same reference the removed page zoom used; purely a starting value - any
// slider pick is stored and takes over.
function autoNetFontSize() {
  var w = (window.innerWidth && window.innerWidth > 0) ? window.innerWidth : 1920;
  var k = w / 1920;
  if (k < 1) {
    k = 1;
  }
  if (k > 2) {
    k = 2;
  }
  return Math.round(0.1 * k * 20) / 20;
}

// Helper classes for user js callbacks.

const IBOM_EVENT_TYPES = {
  ALL: "all",
  HIGHLIGHT_EVENT: "highlightEvent",
  CHECKBOX_CHANGE_EVENT: "checkboxChangeEvent",
  BOM_BODY_CHANGE_EVENT: "bomBodyChangeEvent",
}

const EventHandler = {
  callbacks: {},
  init: function() {
    for (eventType of Object.values(IBOM_EVENT_TYPES))
      this.callbacks[eventType] = [];
  },
  registerCallback: function(eventType, callback) {
    this.callbacks[eventType].push(callback);
  },
  emitEvent: function(eventType, eventArgs) {
    event = {
      eventType: eventType,
      args: eventArgs,
    }
    var callback;
    for(callback of this.callbacks[eventType])
      callback(event);
    for(callback of this.callbacks[IBOM_EVENT_TYPES.ALL])
      callback(event);
  }
}
EventHandler.init();
