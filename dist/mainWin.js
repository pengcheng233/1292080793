
function startWin() {
    mainWin.Show();
}

// [2026-09-24] Panel DPI scale -----------------------------------------------
// The Borland script form carries fixed 96-DPI geometry (452x452) straight
// from mainWin.dfm, so on 4K / high-DPI screens the dialog looks tiny.
// The whole form (geometry + fonts) is rescaled every time it is shown,
// always starting from the ORIGINAL dfm values, so re-shows never stack.
// config.ini [General] PanelScale:
//   empty / 0 / invalid  -> 1.5 (safe default, still fine on 1080p)
//   auto                 -> judged from the physical resolution of the
//                           sharpest display via WMI (>=3600 -> 2.0,
//                           >=2800 -> 1.5, else 1.0)
//   a number (1, 1.5, 2) -> used as-is, clamped to [0.5, 4]; 1 disables
// ACCESS RULES (learned on real AD, see version notes 2026-09-24):
//   - indexing Components[i] raises DISP_E_BADPARAMCOUNT in AD's JScript
//     ("wrong parameter count"), so NO indexed traversal is used;
//   - controls are reached the proven way: owner bracket mainWin["Name"]
//     (same access mainWinShow relies on), with an eval() bare-global
//     fallback, plus a guarded Enumerator sweep over .Components as a net;
//   - every single access is wrapped: the dialog must never fail to open,
//     and a failed geometry write only triggers a one-time hint message.
var PANEL_SCALE_DEFAULT = 1.5;
var panelScaleSaved = null;     // name -> { geom: [l,t,w,h] | null, fh: n | null }
var panelScaleFormSize = null;  // [ClientWidth, ClientHeight] captured once
var panelScaleChecked = false;  // first-apply self-check done

// Every visual component of mainWin.dfm except the non-visual TSaveDialog.
var PANEL_CONTROLS = [
    "PageControl1", "TabSheet1",
    "GroupBox1", "BtnSave", "TEditCurrentPcbPath", "StaticText1",
    "GroupBox3", "CbIncludeTracksAndSolidPolygons", "CbIncludeVias",
    "CbIncludeInner", "CbIncludeNets", "CbIncludeSchematic",
    "GroupBox4", "CbBlacklistEmpty", "CbBlacklist1Pad", "CbBlacklistTh",
    "CbBlacklistNoBOM", "GenerateBom", "GroupBox10", "RBtnKeepOutLayer",
    "RBtnMech1", "TabSheet2",
    "CbDarkMode", "CbShowFootprintPads", "CbShowFabricationLayer",
    "CbShowSilkscreen", "CbHighlightFirstPin", "CbContinuousRedrawOnDrag",
    "CbShowReferences", "CbShowValues", "CbShowTracks", "CbShowZones",
    "CbShowNetNames", "CbShowVias", "CbShowNativeLabels", "CbShowNoBom",
    "TTrackBarRotation", "GroupBox5", "TEditHtmlCheckboxes", "StaticText2",
    "TTextRotation", "GroupBox6", "RBtnBomOnly", "RBtnBomLeftDrawingRight",
    "RBtnBomTopDrawingBottom", "GroupBox7", "RBtnFrontAndBack",
    "RBtnFrontOnly", "RBtnBackOnly"
];

function panelDetectScale() {
    // Physical resolution of the sharpest connected display, -1 on failure.
    try {
        var wmi = GetObject("winmgmts:\\\\.\\root\\cimv2");
        var monitors = wmi.ExecQuery(
            "SELECT CurrentHorizontalResolution FROM Win32_VideoController");
        var maxW = 0;
        var it = new Enumerator(monitors);
        for (; !it.atEnd(); it.moveNext()) {
            var w = it.item().CurrentHorizontalResolution;
            if (w != null && w > maxW) { maxW = w; }
        }
        if (maxW >= 3600) { return 2.0; }
        if (maxW >= 2800) { return 1.5; }
        if (maxW > 0) { return 1.0; }
        return -1;
    } catch (eWmi) {
        return -1;
    }
}

function panelGetScale() {
    var raw = "";
    try {
        var iniFile = TIniFile.Create(CURRENT_PATH + "config.ini");
        raw = iniFile.ReadString("General", "PanelScale", "");
        iniFile.Free;
    } catch (eIni) {
        raw = "";
    }
    if (raw == null) { raw = ""; }
    raw = String(raw);
    while (raw.length > 0 && raw.charAt(0) == " ") {
        raw = raw.substring(1);
    }
    while (raw.length > 0 && raw.charAt(raw.length - 1) == " ") {
        raw = raw.substring(0, raw.length - 1);
    }
    if (raw == "") { return PANEL_SCALE_DEFAULT; }
    if (raw.toLowerCase() == "auto") {
        var detected = panelDetectScale();
        return (detected > 0) ? detected : PANEL_SCALE_DEFAULT;
    }
    var value = parseFloat(raw);
    if (isNaN(value) || value <= 0) { return PANEL_SCALE_DEFAULT; }
    if (value < 0.5) { value = 0.5; }
    if (value > 4) { value = 4; }
    return value;
}

/// Capture (mode 0) or rescale (mode 1) ONE control. Never raises.
/// Missing geometry must be treated as "no geometry": in plain JS reading an
/// absent property yields undefined instead of raising, so values validated
/// with isFinite only - otherwise NaN would be written back later.
function panelDoCtl(ctrl, key, mode, saved, f) {
    try {
        if (ctrl == null || key == null || key == "") { return; }
        if (mode == 0) {
            var geom = null;
            var fh = null;
            try {
                var gl = ctrl.Left, gt = ctrl.Top, gw = ctrl.Width, gh = ctrl.Height;
                if (typeof gl == "number" && isFinite(gl) &&
                    typeof gt == "number" && isFinite(gt) &&
                    typeof gw == "number" && isFinite(gw) &&
                    typeof gh == "number" && isFinite(gh)) {
                    geom = [gl, gt, gw, gh];
                }
            } catch (eGeom) { geom = null; }
            try {
                var fhv = ctrl.Font.Height;
                if (typeof fhv == "number" && isFinite(fhv)) { fh = fhv; }
            } catch (eFont) { fh = null; }
            if (geom != null || fh != null) {
                saved[key] = { geom: geom, fh: fh };
            }
        } else {
            var rec = saved[key];
            if (rec != null) {
                if (rec.geom != null) {
                    try {
                        ctrl.Left = Math.round(rec.geom[0] * f);
                        ctrl.Top = Math.round(rec.geom[1] * f);
                        ctrl.Width = Math.round(rec.geom[2] * f);
                        ctrl.Height = Math.round(rec.geom[3] * f);
                    } catch (eSet) {}
                }
                if (rec.fh != null) {
                    try { ctrl.Font.Height = Math.round(rec.fh * f); }
                    catch (eSetF) {}
                }
            }
        }
    } catch (eCtl) {}
}

/// Bonus net: walk owned components via Enumerator (NEVER indexed access,
/// which raises DISP_E_BADPARAMCOUNT on real AD). Covers anything not
/// reachable through PANEL_CONTROLS. Never raises.
function panelSweep(ctrl, mode, saved, f, seen) {
    try {
        if (ctrl == null) { return; }
        var name = "";
        try { name = ctrl.Name; } catch (eName) { name = ""; }
        var fresh = false;
        if (name != "" && !seen[name]) {
            seen[name] = true;
            fresh = true;
        }
        if (fresh) { panelDoCtl(ctrl, name, mode, saved, f); }
        try {
            var it = new Enumerator(ctrl.Components);
            for (; !it.atEnd(); it.moveNext()) {
                panelSweep(it.item(), mode, saved, f, seen);
            }
        } catch (eEnum) {}
    } catch (eSweep) {}
}

/// Primary path: the dfm inventory, resolved as mainWin["Name"] (the proven
/// owner-bracket access) with an eval() bare-global fallback. Never raises.
function panelVisitNameList(mode, saved, f) {
    for (var i = 0; i < PANEL_CONTROLS.length; i++) {
        var key = PANEL_CONTROLS[i];
        try {
            var ctl = mainWin[key];
            if (ctl == null) { ctl = eval(key); }
            panelDoCtl(ctl, key, mode, saved, f);
        } catch (eSkip) {}
    }
}

/// Called from mainWinShow: rescale the form per config.ini [General] PanelScale.
/// Originals are captured once per script session (JS globals reset whenever
/// AD recompiles the script, which is also when the form is rebuilt), so a
/// changed PanelScale takes effect on the next dialog open without stacking.
function panelApplyScale() {
    var f = panelGetScale();
    if (f == 1) { return; }
    if (panelScaleSaved == null) {
        panelScaleSaved = {};
        panelScaleFormSize = null;
        try {
            var cw = mainWin.ClientWidth;
            var ch = mainWin.ClientHeight;
            if (typeof cw == "number" && isFinite(cw) &&
                typeof ch == "number" && isFinite(ch)) {
                panelScaleFormSize = [cw, ch];
            }
        } catch (eForm) {
            panelScaleFormSize = null;
        }
        var seenCap = {};
        panelSweep(mainWin, 0, panelScaleSaved, f, seenCap);
        panelVisitNameList(0, panelScaleSaved, f);
    }
    var seenApp = {};
    panelSweep(mainWin, 1, panelScaleSaved, f, seenApp);
    panelVisitNameList(1, panelScaleSaved, f);
    if (panelScaleFormSize != null) {
        try {
            mainWin.ClientWidth = Math.round(panelScaleFormSize[0] * f);
            mainWin.ClientHeight = Math.round(panelScaleFormSize[1] * f);
        } catch (eForm2) {}
    }
    if (!panelScaleChecked && panelScaleFormSize != null) {
        panelScaleChecked = true;
        try {
            if (mainWin.ClientWidth == panelScaleFormSize[0]) {
                showmessage("\u9762\u677f\u7f29\u653e\u672a\u751f\u6548\uff1a" +
                    "\u811a\u672c\u5f15\u64ce\u62d2\u7edd\u4e86\u5c3a\u5bf8" +
                    "\u5199\u5165\u3002\n\u8bf7\u628a\u672c\u7a97\u53e3\u622a" +
                    "\u56fe\u53d1\u7ed9 AI\uff0c\u6539\u7528 DFM \u76f4\u63a5" +
                    "\u653e\u5927\u65b9\u6848\u3002");
            }
        } catch (eChk) {}
    }
}

function mainWinShow(Sender) {
    // [2026-09-24] rescale for high-DPI; must never break the export dialog
    try { panelApplyScale(); } catch (eScale) {}
    var iniFileName = CURRENT_PATH + "config.ini";

    if (FileExists(iniFileName)) {
        var iniFile = TIniFile.Create(iniFileName);
        if (PCBServer != null) {
            PCBServer.PreProcess;
            var currentPcb = PCBServer.GetCurrentPCBBoard();

            if (currentPcb != null) {
                var currentPath = ExtractFilePath(currentPcb.FileName);
                var filename = currentPath + "PnPout\\" + ExtractFileName(currentPcb.FileName).split(".")[0] + ".html";
                TEditCurrentPcbPath.Text = filename;
            } else {
                TEditCurrentPcbPath.Text = iniFile.ReadString("General", "Directory", "");
            }

            PCBServer.PostProcess;
        } else {
            TEditCurrentPcbPath.Text = iniFile.ReadString("General", "Directory", "");
        }
        CbIncludeTracksAndSolidPolygons.Checked = iniFile.ReadBool("General", "IncludeTracksAndSolidPolygons", false);
        CbIncludeVias.Checked = iniFile.ReadBool("General", "IncludeVias", false);
        CbIncludeSchematic.Checked = iniFile.ReadBool("General", "IncludeSchematic", true);
        CbIncludeNets.Checked = iniFile.ReadBool("General", "IncludeNets", true);
        CbIncludeInner.Checked = iniFile.ReadBool("General", "IncludeInner", true);

        CbBlacklistEmpty.Checked = iniFile.ReadBool("General", "BlacklistEmpty", true);
        CbBlacklist1Pad.Checked = iniFile.ReadBool("General", "Blacklist1Pad", true);
        CbBlacklistTh.Checked = iniFile.ReadBool("General", "BlacklistTh", true);
        CbBlacklistNoBOM.Checked = iniFile.ReadBool("General", "BlacklistNoBOM", true);
        if (iniFile.ReadBool("General", "PcbOutlineMech1", false)) {
            RBtnMech1.Checked = true;
            RBtnKeepOutLayer.Checked = false;
        } else {
            RBtnMech1.Checked = false;
            RBtnKeepOutLayer.Checked = true;
        }

        CbDarkMode.Checked = iniFile.ReadBool("HtmlDefaults", "DarkMode", false);
        CbShowFootprintPads.Checked = iniFile.ReadBool("HtmlDefaults", "ShowFootprintPads", true);
        CbShowFabricationLayer.Checked = iniFile.ReadBool("HtmlDefaults", "ShowFabricationLayer", false);
        CbShowSilkscreen.Checked = iniFile.ReadBool("HtmlDefaults", "ShowSilkscreen", true);
        CbHighlightFirstPin.Checked = iniFile.ReadBool("HtmlDefaults", "HighlightPin1", false);
        CbContinuousRedrawOnDrag.Checked = iniFile.ReadBool("HtmlDefaults", "ContinuousRedrawOnDrag", true);

        CbShowReferences.Checked = iniFile.ReadBool("HtmlDefaults", "ShowReferences", true);
        CbShowValues.Checked = iniFile.ReadBool("HtmlDefaults", "ShowValues", true);
        CbShowNativeLabels.Checked = iniFile.ReadBool("HtmlDefaults", "ShowNativeLabels", true);
        CbShowTracks.Checked = iniFile.ReadBool("HtmlDefaults", "ShowTracks", true);
        CbShowZones.Checked = iniFile.ReadBool("HtmlDefaults", "ShowZones", true);
        CbShowNetNames.Checked = iniFile.ReadBool("HtmlDefaults", "ShowNetNames", true);
        CbShowVias.Checked = iniFile.ReadBool("HtmlDefaults", "ShowVias", true);
        CbShowNoBom.Checked = iniFile.ReadBool("HtmlDefaults", "ShowNoBom", false);
        TTrackBarRotation.Position = (iniFile.ReadInteger("HtmlDefaults", "PcbRotation", 0) + 180)/5;
        TTextRotation.Caption = [TTrackBarRotation.Position * 5 - 180, String.fromCharCode(176)].join("");

        TEditHtmlCheckboxes.Text = iniFile.ReadString("HtmlDefaults", "HtmlCheckboxes", "Sourced");
        RBtnBomOnly.Checked = iniFile.ReadBool("HtmlDefaults", "BomViewOnly", false);
        RBtnBomLeftDrawingRight.Checked = iniFile.ReadBool("HtmlDefaults", "BomViewLeftDrawingRight", true);
        RBtnBomTopDrawingBottom.Checked = iniFile.ReadBool("HtmlDefaults", "BomViewTopDrawingBottom", false);
        RBtnFrontOnly.Checked = iniFile.ReadBool("HtmlDefaults", "PcbLayerFrontOnly", false);
        RBtnFrontAndBack.Checked = iniFile.ReadBool("HtmlDefaults", "PcbLayerFrontAndBack", true);
        RBtnBackOnly.Checked = iniFile.ReadBool("HtmlDefaults", "PcbLayerBackOnly", false);

        iniFile.Free;
    } else {
        if (PCBServer != null) {
            PCBServer.PreProcess;
            var currentPcb = PCBServer.GetCurrentPCBBoard();

            if (currentPcb != null) {
                var currentPath = ExtractFilePath(currentPcb.FileName);
                var filename = currentPath + "PnPout\\" + ExtractFileName(currentPcb.FileName).split(".")[0] + ".html";
                TEditCurrentPcbPath.Text = filename;
            } else {
                TEditCurrentPcbPath.Text = "";
            }

            PCBServer.PostProcess;
        } else {
            TEditCurrentPcbPath.Text = "";
        }

        CbBlacklistEmpty.Checked = true;
        CbBlacklist1Pad.Checked = true;
        CbBlacklistTh.Checked = true;
        CbBlacklistNoBOM.Checked = true;

        CbIncludeTracksAndSolidPolygons.Checked = false;
        CbIncludeVias.Checked = false;
        CbIncludeNets.Checked = true;
        CbIncludeInner.Checked = true;
        CbIncludeSchematic.Checked = true;

        CbBlacklistEmpty.Checked = true;
        CbBlacklist1Pad.Checked = true;
        RBtnKeepOutLayer.Checked = true;
        RBtnMech1.Checked = false;

        CbDarkMode.Checked = false;
        CbShowFootprintPads.Checked = true;
        CbShowFabricationLayer.Checked = false;
        CbShowSilkscreen.Checked = true;
        CbHighlightFirstPin.Checked = false;
        CbContinuousRedrawOnDrag.Checked = true;

        TTrackBarRotation.Position = 36;
        TTextRotation.Caption = [0, String.fromCharCode(176)].join("");

        TEditHtmlCheckboxes.Text = "Sourced";
        RBtnBomOnly.Checked = false;
        RBtnBomLeftDrawingRight.Checked = true;
        RBtnBomTopDrawingBottom.Checked = false;
        RBtnFrontOnly.Checked = false;
        RBtnFrontAndBack.Checked = true;
        RBtnBackOnly.Checked = false;
    }
}

function GenerateBomClick(Sender) {
    var iniFileName = CURRENT_PATH + "config.ini";
    setValueToInifile(iniFileName);

    // var config = getConfig();
    var config = {};
    config.include = {};
    config.htmlConfig = {};
    config.bomFilter = {};
    config.bomFilter["skipempty"] = CbBlacklistEmpty.Checked;
    config.bomFilter["skiponepad"] = CbBlacklist1Pad.Checked;
    config.bomFilter["skipth"] = CbBlacklistTh.Checked;
    config.bomFilter["skipnobom"] = CbBlacklistNoBOM.Checked;

    config.htmlConfig["extra_fields"] = []; 
    config.htmlConfig["redraw_on_drag"] = CbContinuousRedrawOnDrag.Checked;

    if (RBtnMech1.Checked) {
        config.PcbOutlineMech1 = true;
    } else {
        config.PcbOutlineMech1 = false;
    }
    
    if (RBtnBomOnly.Checked) {
        config.htmlConfig["bom_view"] = "bom-only";
    } else if (RBtnBomLeftDrawingRight.Checked) {
        config.htmlConfig["bom_view"] = "left-right";
    } else if (RBtnBomTopDrawingBottom.Checked) {
        config.htmlConfig["bom_view"] = "top-bottom";
    }

    if (RBtnFrontOnly.Checked) {
        config.htmlConfig["layer_view"] = "F";
    } else if (RBtnFrontAndBack.Checked) {
        config.htmlConfig["layer_view"] = "FB";
    } else if (RBtnBackOnly.Checked) {
        config.htmlConfig["layer_view"] = "B";
    }
    
    config.htmlConfig["show_silkscreen"] = CbShowSilkscreen.Checked;
    config.htmlConfig["checkboxes"] = TEditHtmlCheckboxes.Text;
    config.htmlConfig["dark_mode"] = CbDarkMode.Checked;
    config.htmlConfig["highlight_pin1"] = CbHighlightFirstPin.Checked;
    config.htmlConfig["show_pads"] = CbShowFootprintPads.Checked;
    config.htmlConfig["show_fabrication"] = CbShowFabricationLayer.Checked;
    config.htmlConfig["show_references"] = CbShowReferences.Checked;
    config.htmlConfig["show_values"] = CbShowValues.Checked;
    config.htmlConfig["show_native_labels"] = CbShowNativeLabels.Checked;
    config.htmlConfig["show_tracks"] = CbShowTracks.Checked;
    config.htmlConfig["show_zones"] = CbShowZones.Checked;
    config.htmlConfig["show_net_names"] = CbShowNetNames.Checked;
    config.htmlConfig["show_vias"] = CbShowVias.Checked;
    config.htmlConfig["show_nobom"] = CbShowNoBom.Checked;
    // config.htmlConfig["extra_fields"] = [];
    config.htmlConfig["board_rotation"] = TTrackBarRotation.Position * 5 - 180;

    config.include["tracks"] = CbIncludeTracksAndSolidPolygons.Checked;
    config.include["polys"] = CbIncludeTracksAndSolidPolygons.Checked;
    config.include["polyHatched"] = false;
    config.include["vias"] = CbIncludeVias.Checked;
    config.include["nets"] = CbIncludeNets.Checked;
    config.include["inner"] = CbIncludeInner.Checked;
    config.include["schematic"] = CbIncludeSchematic.Checked;

    var filename = getSaveDir(TEditCurrentPcbPath.Text);
    if (filename == "") {
        return;
    }

    var pcb = parsePcb(config);
    if (!pcb) {
        return;
    };

    var extra_data;

    pcb.pcbdata["bom"] = pickBom(pcb, config, extra_data);
    pcb.pcbdata["ibom_version"] = "v2.3";

    var s = JSON.stringify(pcb.pcbdata);
    var b = LZStr.compressToBase64(s);

    b = 'var pcbdata = JSON.parse(LZString.decompressFromBase64("' + b + '"))';

    // Unique id per export. The page compares it against localStorage and
    // lets the dialog presets win whenever it sees a NEW id (otherwise old
    // toggles from any earlier page would shadow the dialog forever).
    config.htmlConfig["page_id"] = String((new Date()).getTime()) + "_" +
        String(Math.floor(Math.random() * 100000));
    var config_js = "var config = " + JSON.stringify(config.htmlConfig);
    var html = generateFile(b, config_js);
    save2file(html, filename, false);

    if (CbIncludeSchematic.Checked) {
        injectSchematicOffline(filename);
    }

    try {
        var commandline = "explorer.exe " + ExtractFilePath(filename);
        var errcode = RunApplication(commandline);
    }
    catch(e) {
        showmessage(e.message);
    };
}

/// Accumulate one module into a grouped row table keyed by itemkey.
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

/// Flatten a grouped row table into the BOM row array format.
function rowsToArray(rows) {
    var out = [];
    for (var i in rows) {
        rows[i][6] = rows[i].description || "";
        delete rows[i].description;
        out.push(rows[i]);
    }
    return out;
}

function pickBom(pcb, config, extra_data) {
    // type (list, dict, dict) -> dict
    // return: dict of BOM tables (qty, value, footprint, refs) and dnp components
    var extra_data = arguments[2] ? arguments[2] : {}; 

    var res = {};
    var extras = [];
    var modules = pcb.modules;
    var rows = {};  // { itemkey: [quantity, comment, footprint, designator, extras] }
    var rowsB = {};
    var rowsF = {};
    var skippedComponents = [];
    // "Standard (No BOM)" / "Net Tie (No BOM)" parts are collected separately so the
    // generated page can toggle them on later without re-running this script.
    var noBomRows = {};
    var noBomRowsF = {};
    var noBomRowsB = {};
    var noBomComponents = [];
    var count = modules.length;
    for (var i = 0; i < count; i++) {
        if (skipComponent(modules[i], config)) {
            skippedComponents.push(i);
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

    // Parallel tables for the no-BOM parts, merged in by the page on demand.
    res.nobom = rowsToArray(noBomRows);
    res.nobomF = rowsToArray(noBomRowsF);
    res.nobomB = rowsToArray(noBomRowsB);
    res.nobomComponents = noBomComponents;
    
    res.skipped = skippedComponents;
    return res;
}


function BtnSaveClick(Sender) {
    SaveDialog1.InitialDir = ExtractFilePath(TEditCurrentPcbPath.Text);
    if (SaveDialog1.Execute) {
        TEditCurrentPcbPath.Text = SaveDialog1.Filename;
    }
}

function TTrackBarRotationChange(Sender) {
    TTextRotation.Caption = [TTrackBarRotation.Position * 5 - 180, String.fromCharCode(176)].join("");
}


function setValueToInifile(iniFileName) {
    var iniFile = TIniFile.Create(iniFileName);
    iniFile.WriteString("General", "Directory", TEditCurrentPcbPath.Text);
    iniFile.WriteBool("General", "IncludeTracksAndSolidPolygons", CbIncludeTracksAndSolidPolygons.Checked);
    iniFile.WriteBool("General", "IncludeVias", CbIncludeVias.Checked);
    iniFile.WriteBool("General", "IncludeNets", CbIncludeNets.Checked);
    iniFile.WriteBool("General", "IncludeInner", CbIncludeInner.Checked);
    iniFile.WriteBool("General", "BlacklistEmpty", CbBlacklistEmpty.Checked);
    iniFile.WriteBool("General", "Blacklist1Pad", CbBlacklist1Pad.Checked);
    iniFile.WriteBool("General", "BlacklistTh", CbBlacklistTh.Checked);
    iniFile.WriteBool("General", "BlacklistNoBOM", CbBlacklistNoBOM.Checked);
    iniFile.WriteBool("General", "PcbOutlineMech1", RBtnMech1.Checked);

    iniFile.WriteBool("HtmlDefaults", "DarkMode", CbDarkMode.Checked);
    iniFile.WriteBool("HtmlDefaults", "ShowFootprintPads", CbShowFootprintPads.Checked);
    iniFile.WriteBool("HtmlDefaults", "ShowFabricationLayer", CbShowFabricationLayer.Checked);
    iniFile.WriteBool("HtmlDefaults", "ShowSilkscreen", CbShowSilkscreen.Checked);
    iniFile.WriteBool("HtmlDefaults", "HighlightPin1", CbHighlightFirstPin.Checked);
    iniFile.WriteBool("HtmlDefaults", "ContinuousRedrawOnDrag", CbContinuousRedrawOnDrag.Checked);
    iniFile.WriteBool("HtmlDefaults", "ShowReferences", CbShowReferences.Checked);
    iniFile.WriteBool("HtmlDefaults", "ShowValues", CbShowValues.Checked);
    iniFile.WriteBool("HtmlDefaults", "ShowNativeLabels", CbShowNativeLabels.Checked);
    iniFile.WriteBool("HtmlDefaults", "ShowTracks", CbShowTracks.Checked);
    iniFile.WriteBool("HtmlDefaults", "ShowZones", CbShowZones.Checked);
    iniFile.WriteBool("HtmlDefaults", "ShowNetNames", CbShowNetNames.Checked);
    iniFile.WriteBool("HtmlDefaults", "ShowVias", CbShowVias.Checked);
    iniFile.WriteBool("HtmlDefaults", "ShowNoBom", CbShowNoBom.Checked);
    iniFile.WriteInteger("HtmlDefaults", "PcbRotation", (TTrackBarRotation.Position * 5 - 180));
    iniFile.WriteString("HtmlDefaults", "HtmlCheckboxes", TEditHtmlCheckboxes.Text);
    iniFile.WriteBool("HtmlDefaults", "BomViewOnly", RBtnBomOnly.Checked);
    iniFile.WriteBool("HtmlDefaults", "BomViewLeftDrawingRight", RBtnBomLeftDrawingRight.Checked);
    iniFile.WriteBool("HtmlDefaults", "BomViewTopDrawingBottom", RBtnBomTopDrawingBottom.Checked);
    iniFile.WriteBool("HtmlDefaults", "PcbLayerFrontOnly", RBtnFrontOnly.Checked);
    iniFile.WriteBool("HtmlDefaults", "PcbLayerFrontAndBack", RBtnFrontAndBack.Checked);
    iniFile.WriteBool("HtmlDefaults", "PcbLayerBackOnly", RBtnBackOnly.Checked);
    iniFile.Free;
}

/// One-click schematic: after the page is written, shell out to node and let
/// tools/inject_schem.js parse the .SchDoc binary offline (no AD schematic
/// reader involved - immune to the "AD compiles a script once per session"
/// trap) and splice pcbdata.schem into the exported page in place.
function injectSchematicOffline(htmlFilename) {
    var tool = injectFindTool();
    if (tool == "") {
        showmessage("\u627e\u4e0d\u5230 inject_schem.js\uff0c\u67e5\u627e\u76ee\u5f55\uff1a\n" + CURRENT_PATH);
        return;
    }
    var nodeExe = injectFindNode();
    var cmdline = "\"" + nodeExe + "\" \"" + tool + "\" --in=\"" +
        htmlFilename + "\"";
    try {
        var shell = new ActiveXObject("WScript.Shell");
        // 0 = hidden window, true = wait for node to finish. Exit code 0
        // means the page now carries the schematic.
        var code = shell.Run(cmdline, 0, true);
        if (code != 0) {
            showmessage("\u539f\u7406\u56fe\u6ce8\u5165\u5931\u8d25\uff08\u9000\u51fa\u7801 " + code + "\uff09\u3002\n" +
                "\u8bf7\u624b\u52a8\u8fd0\u884c\u4ee5\u67e5\u770b\u539f\u56e0\uff1a\n" + cmdline);
        }
    } catch (e) {
        var errCode = (e.number === undefined) ? -1 : (e.number >>> 0);
        var errMsg = "\u539f\u7406\u56fe\u6ce8\u5165\u51fa\u9519 " +
            (errCode < 0 ? "" : "(0x" + errCode.toString(16) + ") ") +
            (e.message ? e.message : "(\u65e0\u4fe1\u606f\uff0c\u901a\u5e38\u8868\u793a\u672a\u627e\u5230\u53ef\u6267\u884c\u6587\u4ef6)");
        if (errCode == 0x80070002) {
            errMsg += "\n\n" +
                "\u7cfb\u7edf\u627e\u4e0d\u5230\u547d\u4ee4\u91cc\u7684 node.exe\u3002\n" +
                "\u89e3\u51b3\u529e\u6cd5\uff08\u4efb\u9009\u4e00\uff09\uff1a\n" +
                "1. \u5b89\u88c5 Node.js \u540e\u91cd\u542f AD\uff1b\n" +
                "2. \u5728 config.ini \u7684 [General] \u8282\u52a0\u4e00\u884c\uff08\u586b\u5b9e\u9645\u8def\u5f84\uff09\uff1a\n" +
                "   NodePath=C:\\Program Files\\nodejs\\node.exe\n" +
                "config.ini \u4e0e\u672c\u811a\u672c\u540c\u76ee\u5f55\uff0c\u6539\u5b8c\u540e\u91cd\u65b0\u5bfc\u51fa\u4e00\u6b21\u5373\u53ef\u3002";
        }
        errMsg += "\n\n\u547d\u4ee4\uff1a\n" + cmdline;
        showmessage(errMsg);
    }
}

/// Locate tools\inject_schem.js: CURRENT_PATH first, then up to 3 parent
/// directories (covers CURRENT_PATH pointing at a subdir or odd roots).
function injectFindTool() {
    var dir = CURRENT_PATH;
    for (var i = 0; i < 4; i++) {
        var candidate = dir + "tools\\inject_schem.js";
        if (FileExists(candidate)) {
            return candidate;
        }
        dir = dir.replace(/\\[^\\]+\\$/, "\\");
    }
    return "";
}

/// Resolve the node executable WITHOUT relying on PATH: AD is usually
/// started from a shortcut whose environment does not carry the shell's
/// PATH additions (or was started before node was installed / PATH was
/// updated), so a bare "node" in Run() fails with 0x80070002.
/// Order: config.ini override, nodejs install locations resolved from
/// environment variables (works on any machine and user name),
/// WorkBuddy managed runtimes under %USERPROFILE%, bare "node" last.
function injectFindNode() {
    var candidates = [];
    try {
        var iniFile = TIniFile.Create(CURRENT_PATH + "config.ini");
        var configured = iniFile.ReadString("General", "NodePath", "");
        iniFile.Free;
        if (configured != "") {
            candidates.push(configured);
        }
    } catch (eIni) {}
    var shell = null;
    try {
        shell = new ActiveXObject("WScript.Shell");
    } catch (eShell) {}
    var userProfile = "";
    if (shell != null) {
        var envNames = ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"];
        for (var i = 0; i < envNames.length; i++) {
            try {
                var base = shell.ExpandEnvironmentStrings("%" + envNames[i] + "%");
                if (base != "" && base.charAt(0) != "%") {
                    candidates.push(base + "\\nodejs\\node.exe");
                }
            } catch (eEnv) {}
        }
        try {
            userProfile = shell.ExpandEnvironmentStrings("%USERPROFILE%");
            if (userProfile.charAt(0) == "%") {
                userProfile = "";
            }
        } catch (eUsr) {}
    }
    if (userProfile != "") {
        candidates.push(userProfile +
            "\\AppData\\Local\\Programs\\nodejs\\node.exe");
        // WorkBuddy keeps node under .workbuddy\binaries\node\versions\<ver>\
        // - a machine may hold several versions, so collect every one found.
        try {
            var fso = new ActiveXObject("Scripting.FileSystemObject");
            var wbDir = userProfile + "\\.workbuddy\\binaries\\node\\versions";
            if (fso.FolderExists(wbDir)) {
                var sub = new Enumerator(fso.GetFolder(wbDir).SubFolders);
                for (; !sub.atEnd(); sub.moveNext()) {
                    var exe = sub.item().Path + "\\node.exe";
                    if (fso.FileExists(exe)) {
                        candidates.push(exe);
                    }
                }
            }
        } catch (eWb) {}
    }
    // Literal fallbacks in case the environment lookup came back empty.
    candidates.push("C:\\Program Files\\nodejs\\node.exe");
    candidates.push("C:\\Program Files (x86)\\nodejs\\node.exe");
    for (var j = 0; j < candidates.length; j++) {
        if (FileExists(candidates[j])) {
            return candidates[j];
        }
    }
    return "node";
}

function getSaveDir(text) {
    var fso = new ActiveXObject("Scripting.FileSystemObject");
    var filename = text.replace("/", "\\");
    var arr = filename.split("\\");
    var len = arr.length - 1;

    if (!fso.FolderExists(arr[0])) {
        showmessage("\u76ee\u5f55\u9519\u8bef");
        return "";
    }

    for (var i = 0; i <= len; i++) {
        if (arr[i] == "") {
            showmessage("\u76ee\u5f55\u9519\u8bef");
            return "";
        }
    }

    return filename;
}

