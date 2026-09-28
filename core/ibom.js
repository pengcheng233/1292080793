/// ibom.js
///
 
/*
module = {
    "angle": xx,
    "itemkey": xx,
    "soldertype": xx,
    "footprint": {xx..}
    "comment": {xx..}
}
*/
function skipComponent(m, config, extra_data) {
    // config = config || {};
    // config.bomFilter.skiplist = [];
    // config.bomFilter.skipvirtual = true;
    // config.bomFilter.dnpfield = true;
    // config.bomFilter.skiplayer = true;

    // extra_data = extra_data || {};
    // var re = /^[A-Z]*/g;
    // var ref_prefix = re.exec(m["component"].ref);
    // if (m["component"].ref in config.bomFilter.skiplist) {
    //     return true;
    // }
    // if (ref_prefix + "*" in config.bomFilter.skiplist) {
    //     return true;
    // } 
    // skip component with empty comment
    if (config.bomFilter.skipempty && m["component"].val in {"DNP": 1, "": 2, "~": 3}) {
        return true;
    }
    // skip virtual components
    // if (config.bomFilter.skipvirtual && m["component"].attr == "virtual") {
    //     return true;
    // }
    // skip components with one pad
    if (config.bomFilter.skiponepad && m["footprint"].pads.length <= 1) {
        return true;
    }
    // skip components with dnp field not empty
    // if (config.bomFilter.dnpfield && extra_data[m["component"].ref][config.dnpfield]) {
    //     return true;
    // }
    // skip th components
    if (config.bomFilter.skipth && m.soldertype == "th") {
        return true;
    }
    // skip components whose AD Type is "Standard (No BOM)" / "Net Tie (No BOM)".
    // These are excluded from AD's own Bill of Materials dialog (e.g. test points),
    // so they must not show up here either.
    if (config.bomFilter.skipnobom !== false && m["component"].nobom) {
        return true;
    }
    // skip components on layer, "F" or "B"
    // if (config.bomFilter.skiplayer == m["component"].layer) {
    //     return true;
    // }
}


/// Accumulate one module into a grouped row table keyed by itemkey.
/// Mirrors the grouping in generateBom() so the no-BOM table has exactly the same
/// shape as the visible ones ([qty, val, footprint, refs, extras, parsedValue, description]).
function accumulateRow(rows, module, index, config, extras) {
    var key = module.itemkey;
    if (!Object.prototype.hasOwnProperty.call(rows, key)) {
        rows[key] = [1, module["component"].val, module["component"].footprint,
                     [[module["component"].ref, index]], extras.slice()];
        rows[key].description = module["component"].description || "";
    } else {
        rows[key][0]++;
        rows[key][3].push([module["component"].ref, index]);
    }
}

/// Accumulate one module into the per-layer tables (F / B) of a no-BOM row set.
function accumulateLayerRow(rowsF, rowsB, module, index) {
    var key = module.itemkey;
    var target = (module["component"].layer == "F") ? rowsF : rowsB;
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
        target[key] = [1, module["component"].val, module["component"].footprint,
                       [[module["component"].ref, index]]];
    } else {
        target[key][0]++;
        target[key][3].push([module["component"].ref, index]);
    }
}

/// Flatten a grouped row table into the BOM row array format, moving the staged
/// description onto index [6].
function rowsToArray(rows) {
    var out = [];
    for (var i in rows) {
        rows[i][6] = rows[i].description || "";
        delete rows[i].description;
        out.push(rows[i]);
    }
    return out;
}

function sortModules(modules) {    function mergeModules (iBegin, iMid, iEnd) {
        var tmp = [];
        var j = iBegin;
        var n = iMid;
        var k = iMid + 1;
        while (j <= n && k <= iEnd) {

            // sort: smd > th
            if (modules[j].soldertype != modules[k].soldertype) {
                if (modules[j].soldertype == "smd") {
                    tmp.push(modules[j]);
                    j++;
                    continue;
                }
                if (modules[k].soldertype == "smd") {
                    tmp.push(modules[k]);
                    k++;
                    continue;
                }
            }

            // sort by itemkey
            if (modules[j].itemkey > modules[k].itemkey) {   ///  <
                tmp.push(modules[j]);
                j++;
            } else if (modules[j].itemkey == modules[k].itemkey) {
                if (modules[j]["component"].ref.length < modules[k]["component"].ref.length) {
                    tmp.push(modules[j]);
                    j++;
                } else if (modules[j]["component"].ref.length == modules[k]["component"].ref.length && modules[j]["component"].ref < modules[k]["component"].ref) {
                    tmp.push(modules[j]);
                    j++;
                } else {
                    tmp.push(modules[k]);
                    k++;
                }
            } else {
                tmp.push(modules[k]);
                k++;
            }
        }   

        while (j <= n) {
            tmp.push(modules[j]);
            j++;
        }   

        while (k <= iEnd) {
            tmp.push(modules[k]);
            k++;
        }   

        k = tmp.length;
        for (var i = 0; i < k; i++) {
            if (modules[iBegin + i]["component"].ref != tmp[i]["component"].ref) {
                modules[iBegin + i] = tmp[i];
            }
        }       
    }

    var len = modules.length;
    var dt = 1;
    while (dt < len) {
        var i = 0;
        while (i < len - dt) {
            if (i + 2 * dt < len) {
                mergeModules(i, i + dt - 1, i + 2 * dt - 1);
            } else {
                mergeModules(i, i + dt - 1, len - 1);
            }
            i = i + 2 * dt;
        }
        dt = 2 * dt;
    }
    return modules;
};


function generateBom(pcb, config, extra_data) {
    // type (list, dict, dict) -> dict
    // return: dict of BOM tables (qty, value, footprint, refs) and dnp components
    var extra_data = arguments[2] ? arguments[2] : {}; 

    var res = {};
    var extras = [];
    var modules = pcb.modules;
    var rows = {};  // { itemkey: [quantity, comment, footprint, designator, extras] }
    var rowsB = {};
    var rowsF = {};
    // Components whose AD Type is "Standard (No BOM)" / "Net Tie (No BOM)" are kept
    // in their own table instead of being dropped. When the BOM is generated with
    // skipping enabled they stay out of the visible tables, but the data is still
    // emitted so the page can toggle them on later without re-running the script.
    var noBomRows = {};
    var noBomRowsF = {};
    var noBomRowsB = {};
    var skippedComponents = [];
    var noBomComponents = [];
    var count = modules.length;
    for (var i = 0; i < count; i++) {
        if (skipComponent(modules[i], config)) {
            skippedComponents.push(i);
            // Distinguish "excluded because of its AD Type" from the other blacklist
            // rules: only the former is user-toggleable in the generated page.
            if (modules[i]["component"].nobom) {
                noBomComponents.push(i);
                accumulateRow(noBomRows, modules[i], i, config, []);
                accumulateLayerRow(noBomRowsF, noBomRowsB, modules[i], i);
            }
            continue;
        }
    
        //   extra_data =
        //    {
        //       ref1: {
        //         field_name1: field_value1,
        //         field_name2: field_value2,
        //         ...
        //         },
        //       ref2: ...
        //    }
        if (!Object.prototype.hasOwnProperty.call(rows, modules[i].itemkey)) {

            if (Object.prototype.hasOwnProperty.call(extra_data, modules[i]["component"].ref)) {
                for (var field_name in extra_data[modules[i]["component"].ref]) {
                    extras.push(extra_data[modules[i]["component"].ref][field_name]);  // extras = [field_value1, field_value2 ...]    
                }   
            } else {
                for (var k = config["htmlConfig"].extra_fields.length - 1; k >= 0; k--) {
                    extras.push("");
                }
            }     

            rows[modules[i].itemkey] = [1, modules[i]["component"].val, modules[i]["component"].footprint, [[modules[i]["component"].ref, i]], extras];
            rows[modules[i].itemkey].description = modules[i]["component"].description || "";
            extras = [];
        } else {
            rows[modules[i].itemkey][0]++;
            rows[modules[i].itemkey][3].push([modules[i]["component"].ref, i]);
        }

        if (modules[i]["component"].layer == "F") {
            if (!Object.prototype.hasOwnProperty.call(rowsF, modules[i].itemkey)) {
                rowsF[modules[i].itemkey] = [1, modules[i]["component"].val, modules[i]["component"].footprint, [[modules[i]["component"].ref, i]] ];
            } else {
                rowsF[modules[i].itemkey][0]++;
                rowsF[modules[i].itemkey][3].push([modules[i]["component"].ref, i]);    
            }
        } else {
            if (!Object.prototype.hasOwnProperty.call(rowsB, modules[i].itemkey)) {
                rowsB[modules[i].itemkey] = [1, modules[i]["component"].val, modules[i]["component"].footprint, [[modules[i]["component"].ref, i]] ];
            } else {
                rowsB[modules[i].itemkey][0]++;
                rowsB[modules[i].itemkey][3].push([modules[i]["component"].ref, i]);    
            }
        }
    }

    res.both = rowsToArray(rows);

    res.F = []
    for (var i in rowsF) {
        rowsF[i].push(rows[i][4]); // add extras
        rowsF[i][6] = rows[i][6];
        res.F.push(rowsF[i]);
    }

    res.B = []
    for (var i in rowsB) {
        rowsB[i].push(rows[i][4]); 
        rowsB[i][6] = rows[i][6];
        res.B.push(rowsB[i]);
    }

    // "No BOM" components, emitted as a parallel set of tables. The page merges
    // these in on demand, so the toggle works without re-running the script.
    res.nobom = rowsToArray(noBomRows);
    res.nobomF = rowsToArray(noBomRowsF);
    res.nobomB = rowsToArray(noBomRowsB);
    res.nobomComponents = noBomComponents;

    res.skipped = skippedComponents;
    return res;
}


/// ---------------------------------------------------------------------------
/// Default BOM as a spreadsheet, written beside the generated HTML.
///
/// A browser cannot be told where to save a file (the download attribute
/// forbids path hints, and the File System Access API only accepts a directory
/// the user picked by hand), so the only way to guarantee the BOM lands in the
/// same folder as the HTML is to write it from here.
///
/// A spreadsheet COM server produces the file format for us: Excel if it is
/// installed, otherwise WPS - WPS registers KET.Application and answers to the
/// same object model. If neither is present we fall back to CSV rather than
/// leaving the user with nothing.
///
/// Every cell is text apart from Quantity. A footprint like 0603 or a value
/// like 100 would otherwise be coerced to a number, losing its leading zeros.
/// ---------------------------------------------------------------------------
var SPREADSHEET_PROGIDS = ["Excel.Application", "KET.Application", "Ket.Application", "ET.Application"];
var BOM_HEADER = ["\u4f4d\u53f7", "\u63cf\u8ff0", "\u53c2\u6570\u503c", "\u5c01\u88c5", "\u6570\u91cf"];
var BOM_COL_WIDTHS = [26, 34, 16, 20, 8];

/// Pull the BOM table out of the parsed board and flatten it into plain rows.
/// Entry layout comes from rowsToArray(): [qty, value, footprint, refs, extras,
/// _, description], where refs is an array of [ref, moduleIndex] pairs.
function bomRowsForExport(pcb) {
    var table = pcb.pcbdata["bom"]["both"];
    var rows = [];
    for (var i = 0; i < table.length; i++) {
        var e = table[i];
        var refs = [];
        for (var j = 0; j < e[3].length; j++) {
            refs.push(e[3][j][0]);
        }
        rows.push([
            refs.join(", "),
            e[6] == null ? "" : String(e[6]),
            e[1] == null ? "" : String(e[1]),
            e[2] == null ? "" : String(e[2]),
            e[3].length
        ]);
    }
    return rows;
}

function createSpreadsheetApp() {
    for (var i = 0; i < SPREADSHEET_PROGIDS.length; i++) {
        try {
            return new ActiveXObject(SPREADSHEET_PROGIDS[i]);
        } catch (e) {
            // Not installed - try the next ProgID.
        }
    }
    return null;
}

function writeBomXlsx(rows, path) {
    var app = createSpreadsheetApp();
    if (!app) {
        return false;
    }

    // If the server has no workbook open we started it ourselves, so we may
    // hide it and shut it down afterwards. Otherwise it is the user's own
    // session: leave the window visible and only close the book we added.
    var selfStarted = false;
    try {
        selfStarted = (app.Workbooks.Count == 0);
    } catch (e0) {
    }
    if (selfStarted) {
        try { app.Visible = false; } catch (e1) {
        }
    }
    try { app.DisplayAlerts = false; } catch (e2) {
    }

    var wb = null;
    var ok = false;
    try {
        wb = app.Workbooks.Add();
        // Workbooks.Add() can arrive with several sheets depending on the
        // user's template; keep exactly one.
        while (wb.Worksheets.Count > 1) {
            wb.Worksheets.Item(wb.Worksheets.Count).Delete();
        }
        var ws = wb.Worksheets.Item(1);
        try { ws.Name = "BOM"; } catch (e3) {
        }

        var c;
        // Text format for every column except Quantity. This has to be set
        // before the values are written, otherwise Excel has already decided
        // what the cell type is.
        for (c = 1; c < BOM_HEADER.length; c++) {
            ws.Columns.Item(c).NumberFormat = "@";
        }
        for (c = 0; c < BOM_HEADER.length; c++) {
            ws.Cells.Item(1, c + 1).Value = BOM_HEADER[c];
        }
        for (var r = 0; r < rows.length; r++) {
            for (c = 0; c < rows[r].length; c++) {
                ws.Cells.Item(r + 2, c + 1).Value = rows[r][c];
            }
        }
        for (c = 0; c < BOM_COL_WIDTHS.length; c++) {
            ws.Columns.Item(c + 1).ColumnWidth = BOM_COL_WIDTHS[c];
        }
        ws.Rows.Item(1).Font.Bold = true;
        try {
            var win = app.ActiveWindow;
            if (win) {
                win.SplitRow = 1;
                win.FreezePanes = true;
            }
        } catch (e4) {
            // Freezing is cosmetic - never let it fail the export.
        }

        var lastCol = String.fromCharCode(64 + BOM_HEADER.length);
        ws.Range("A1:" + lastCol + (rows.length + 1)).AutoFilter();

        wb.SaveAs(path, 51);
        ok = true;
    } catch (e5) {
        ok = false;
    }

    try {
        if (wb) {
            wb.Close(false);
        }
    } catch (e6) {
    }
    if (selfStarted) {
        try { app.Quit(); } catch (e7) {
        }
    }
    return ok;
}

function csvCell(value) {
    var s = String(value);
    if (s.indexOf(",") != -1 || s.indexOf("\"") != -1 ||
        s.indexOf("\n") != -1 || s.indexOf("\r") != -1) {
        s = "\"" + s.replace(/"/g, "\"\"") + "\"";
    }
    return s;
}

function writeBomCsv(rows, path) {
    var lines = [];
    var cells = [];
    var c, r;
    for (c = 0; c < BOM_HEADER.length; c++) {
        cells.push(csvCell(BOM_HEADER[c]));
    }
    lines.push(cells.join(","));
    for (r = 0; r < rows.length; r++) {
        cells = [];
        for (c = 0; c < rows[r].length; c++) {
            cells.push(csvCell(rows[r][c]));
        }
        lines.push(cells.join(","));
    }
    // noBOM=false keeps the UTF-8 byte order mark: without it Excel reads the
    // file as the local ANSI code page and mangles every Chinese character.
    save2file(lines.join("\r\n"), path, false);
    return true;
}

function exportDefaultBom(pcb, basePath) {
    var rows = bomRowsForExport(pcb);
    if (rows.length == 0) {
        return;
    }
    if (writeBomXlsx(rows, basePath + "-BOM.xlsx")) {
        return;
    }
    writeBomCsv(rows, basePath + "-BOM.csv");
    showmessage("\u672a\u627e\u5230 Excel / WPS \u7ec4\u4ef6\uff0cBOM \u5df2\u6539\u7528 CSV \u683c\u5f0f\u5bfc\u51fa\uff1a\n" +
                basePath + "-BOM.csv");
}

function save2file(src, filename, noBOM) {
    var noBOM = arguments[2] ? arguments[2] : false; 
    var fso = new ActiveXObject("Scripting.FileSystemObject"); 
    var filename = filename.replace("/", "\\");
    var arrFolder = filename.split("\\");
    var len = arrFolder.length - 1;
    var folder = "";
    if (arrFolder[len] == "") {
        showmessage("path error");
        return;
    }
    for (var i = 0; i < len; i++) {
        if (arrFolder[i] == "") {
            showmessage("path error");
            return;
        }
        folder = folder + arrFolder[i];
        if (!fso.FolderExists(folder)) {
            fso.CreateFolder(folder);
        }
        folder = folder + "\\"; 
    }
    // var folder = ExtractFilePath(filename);
    // if (!fso.FolderExists(folder)) {
    //     fso.CreateFolder(folder);
    // } 

    if (fso.FileExists(filename)) {
        try {
            fso.DeleteFile(filename, true);
        }
        catch (e) {
            showmessage(e.message);
        }
    }

    var stm = new ActiveXObject("Adodb.Stream");
    stm.Type = 2;
    stm.Mode = 3;
    stm.Open();
    stm.Charset = "utf-8";
    
    stm.Position = stm.Size;
    stm.WriteText(src);
    
    if (noBOM) {
        // remove the BOM head
        stm.Position = 3;
        var newstm = new ActiveXObject("Adodb.Stream");
        newstm.Mode = 3;
        newstm.Type = 1;
        newstm.Open();
        stm.CopyTo(newstm);
        newstm.SaveToFile(filename, 2);      
        newstm.flush();
        newstm.Close();
    } else {
        stm.SaveToFile(filename, 2);      
        stm.flush();
        stm.Close();     
    }
}

function loadfile(filename) {
    var stm = new ActiveXObject("Adodb.Stream");
    stm.Type = 2;
    stm.Mode = 3;
    stm.Open();
    stm.Charset = "utf-8";
    stm.Position = stm.Size;

    var fso = new ActiveXObject("Scripting.FileSystemObject"); 
    if (!fso.FileExists(filename)) {
        s = "";
    }
    else {
        stm.LoadFromFile(filename);
        var s = stm.ReadText();    
    }
    stm.flush();
    stm.Close();
    return s;
}


function generateFile(compressed_pcbdata, config_js) {
    var filepath = CURRENT_PATH + "web\\";

    var html = loadfile(filepath + "ibom.html");
    html = html.replace("///CSS///", loadfile(filepath + "ibom.css"));
    html = html.replace("///SPLITJS///", loadfile(filepath + "split.js"));
    html = html.replace("///LZ-STRING///", loadfile(filepath + "lz-string.js"));
    html = html.replace("///POINTER_EVENTS_POLYFILL///", loadfile(filepath + "pep.js"));
    html = html.replace("///CONFIG///", config_js);
    html = html.replace("///PCBDATA///", compressed_pcbdata);
    html = html.replace("///UTILJS///", loadfile(filepath + "util.js"));
    html = html.replace("///RENDERJS///", loadfile(filepath + "render.js"));
    html = html.replace("///SCHEMJS///", loadfile(filepath + "schem.js"));
    html = html.replace("///IBOMJS///", loadfile(filepath + "ibom.js"));

    html = html.replace("///USERCSS///", loadfile(filepath + "user.css"));
    html = html.replace("///USERJS///", loadfile(filepath + "user.js"));
    html = html.replace("///USERHEADER///", loadfile(filepath + "userheader.html"));
    html = html.replace("///USERFOOTER///", loadfile(filepath + "userfooter.html"));
   
    return html;
}


function loadExtraData(filename) {
    var s = loadfile(filename);
    if (s == "") {
        return {};
    }
    var d = JSON.parse(s);
    //d = {"123": "C1,C2", "332": "R1"}

    //    {
    //       ref1: {
    //         field_name1: field_value1,
    //         field_name2: field_value2,
    //         ...
    //         },
    //       ref2: ...
    //    }
    var extra_data = {};
    for (var key in d) {
        var ref = d[key].split(",")[0];
        extra_data[ref] = {};
        extra_data[ref]["Num."] = key;
    }
    return extra_data;
}


function main() {
    var config = getConfig();
    var pcb = parsePcb(config);
    if (!pcb) {
        return;
    };
    
    var filename = pcb.boardpath + "PnPout\\" + "extra_data.txt";
    // var extra_data = loadExtraData(filename);
    var extra_data;

    // --- Description column diagnostics -----------------------------------
    // Run debugDescription() from the Run Script dialog to see every property AD
    // exposes for one component. Keep this block until the column is verified.
    // --- Schematic -------------------------------------------------------
    // Optional third view. Reading it walks the project's .SchDoc files and
    // opens each one, which is a completely different COM surface from the
    // board; parseSchematic() never throws and returns null when it cannot get
    // anywhere, and in that case the page is produced exactly as before, with
    // no schematic pane at all. Nothing below depends on this succeeding.
    try {
        var schem = parseSchematic(config);
        if (schem) {
            pcb.pcbdata["schem"] = schem;
        } else {
            // Nothing to draw, but keep the reader's notes: the page shows them
            // so the reason for the missing pane is visible instead of silent.
            pcb.pcbdata["schemdiag"] = schDiagLog();
        }
    }
    catch(e) {
    }

    // Which AD-side build wrote this page. A page without this key was produced
    // by a script compiled before the schematic reader existed, which is the
    // one failure mode the page cannot see for itself (AD caches the compiled
    // script project for the whole session, so a rebuild needs an AD restart).
    // typeof, not a bare reference: it must not throw in that older script.
    pcb.pcbdata["adbuild"] =
        (typeof SCH_BUILD_STAMP == "undefined") ? "" : SCH_BUILD_STAMP;

    pcb.pcbdata["bom"] = generateBom(pcb, config, extra_data);
    pcb.pcbdata["ibom_version"] = "v2.3";

    // var t1 = new Date().getTime();

    var s = JSON.stringify(pcb.pcbdata);
    // var t2 = new Date().getTime();
    var b = LZStr.compressToBase64(s);
    // var t3 = new Date().getTime();
    // showmessage("t1: "+String(t1-t0)+"   t2: "+String(t2-t1)+"   t3: "+String(t3-t2));

    b = 'var pcbdata = JSON.parse(LZString.decompressFromBase64("' + b + '"))';

    // Unique id per export; the page lets this export's dialog presets win
    // over stale localStorage whenever it sees a new id (see util.js).
    config["htmlConfig"]["page_id"] = String((new Date()).getTime()) + "_" +
        String(Math.floor(Math.random() * 100000));
    var config_js = "var config = " + JSON.stringify(config.htmlConfig);
    var html = generateFile(b, config_js);
    var base = pcb.boardpath + "PnPout\\" + pcb.boardname.split(".")[0];
    filename = base + ".html";
    save2file(html, filename, false);

    // Deliberately no BOM write here. Tried it: call exportDefaultBom(pcb, base)
    // below and it writes <board>-BOM.xlsx through a spreadsheet COM object. It
    // works only where such an object exists, which is not every machine, and a
    // missing one turns every export into a failure the user cannot act on. The
    // BOM therefore leaves the tool from the page instead - the toolbar button
    // offers a real "Save as" dialog, and the .xlsx the page builds is written by
    // the page's own zip writer, so nothing has to be installed locally.
    // exportDefaultBom() above is kept, unused, for anyone who wants it back.

    try {
        var commandline = "explorer.exe " + ExtractFilePath(filename);
        var errcode = RunApplication(commandline);
    }
    catch(e) {
        showmessage(e.message);
    };
}


/// ---------------------------------------------------------------------------
/// DIAGNOSTIC: run this from AD's "Run Script..." dialog to find out which
/// property actually holds the AD Bill-of-Materials "Description" value.
///
/// It inspects the first few components of the open PCB and reports, for each
/// of them, the value of every description-related property plus the full list
/// of property names AD exposes. Paste the resulting text back for analysis.
///
/// Usage: Run Script... -> select this project -> choose debugDescription
/// ---------------------------------------------------------------------------
function debugDescription() {
    var config = getConfig();
    var MAX_REPORT = 5;   // how many components to dump in detail

    if (PCBServer == null) {
        showmessage("Please open a PCB document");
        return;
    }
    PCBServer.PreProcess;
    var board = resolvePcbBoard();
    if (board == null) {
        showmessage("ERROR: Current document is not a PCB document");
        return;
    }

    var Iter = board.BoardIterator_Create;
    Iter.AddFilter_ObjectSet(MkSet(eComponentObject));
    Iter.AddFilter_LayerSet(AllLayers);
    Iter.AddFilter_Method(eProcessAll);

    var lines = [];
    var total = 0;
    var Prim = Iter.FirstPCBObject;
    var firstRef = "";
    while (Prim != null) {
        total++;
        if (total <= MAX_REPORT) {
            var ref = "";
            try { ref = Prim.Name.Text; } catch (e) { ref = "?"; }
            if (firstRef == "") { firstRef = ref; }
            lines.push("================ " + ref + " ================");
            lines.push(describeComponentProps(Prim));
            lines.push("---- all property names ----");
            lines.push(enumComponentPropNames(Prim));
            lines.push("");
        }
        Prim = Iter.NextPCBObject;
    }
    board.BoardIterator_Destroy(Iter);
    PCBServer.PostProcess;

    var header = [
        "InteractiveBOM Suite - Description diagnostic",
        "components on board: " + total,
        "detail dumped for first " + Math.min(MAX_REPORT, total),
        "first ref: " + firstRef,
        "",
        "NOTE: if every description property is empty here, the PCB has no",
        "schematic sync data and the Description column cannot be filled.",
        ""
    ].join("\r\n");

    var text = header + lines.join("\r\n");

    // write next to the board so it is easy to find, and also show a snippet
    var outfile;
    try {
        outfile = ExtractFilePath(board.FileName) + "PnPout\\description_debug.txt";
        save2file(text, outfile, false);
    } catch (e) {
        outfile = "<could not save: " + e.message + ">";
    }

    showmessage("Diagnostic written to:\n" + outfile + "\n\n" +
                "First component (" + firstRef + "):\n\n" +
                lines.slice(0, Math.min(lines.length, 18)).join("\n"));
}

