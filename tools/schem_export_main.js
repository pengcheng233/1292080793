/// Standalone schematic -> interactive HTML exporter (Altium side).
///
/// This is a SECOND, self-contained entry point. It is deliberately NOT part of
/// dist/InteractiveBOMSuite.js: Altium compiles a script project once per
/// session and then keeps running the compiled copy, so a rebuilt bundle
/// silently keeps executing the previous code until AD is restarted - and while
/// that is true the schematic reader is simply absent from the export.
///
/// This file lives in its own script project (SchemExport.PrjScr) and is
/// concatenated with ecad/AD10sch.js + modules-lite/json2.js by
/// .workbuddy/build_schem_export.js into dist/SchemExport.js. Opening that
/// project for the first time compiles THIS code, so there is no older compiled
/// copy to be tripped by.
///
/// Run it from Altium with:  DXP -> Run Script...  ->  procedure  SchemExport
///
/// It reads the focused project's .SchDoc files through the same reader the BOM
/// tool uses (AD10sch.js) and writes one standalone page next to the board:
///
///     <board folder>\PnPout\Schematic.html
///
/// The page is a single offline file: the schematic as SVG, with pan/zoom,
/// sheet tabs, click-to-highlight and a designator search box. It does not need
/// the BOM, the board or Altium to be open afterwards.
///
/// ES3 AND ASCII ONLY. Two separate scanners bite here:
///
///   * The engine is an ES3-era JScript. No let/const, no arrow functions, no
///     template literals, no trailing commas, no for...of. A parse error comes
///     back as a bare "catastrophic failure" with no line number.
///
///   * The engine reads this file as the system ANSI codepage (CP936 on a
///     Chinese Windows), NOT as UTF-8. A UTF-8 Chinese character is 3 bytes, so
///     the bytes re-pair on GBK boundaries and a stray lead byte ends up in
///     front of the closing quote of the literal, swallowing it -> the parser
///     reports "unterminated string constant" (and the whole script dies).
///     Keep this file 100% ASCII. Write Chinese as \uXXXX escapes, exactly the
///     way core/ibom.js does it (see its showmessage near the Excel fallback).
///
/// Live guards: .workbuddy/wsh_parse_check.js (ES3) and
/// .workbuddy/asciify_adside.js --check (ASCII). build_schem_export.js runs both
/// over the assembled bundle and refuses to write a non-ASCII dist file.

var SCHEM_EXPORT_VERSION = "schem-export 2026-09-23";

/// ---------------------------------------------------------------------------
/// File I/O. Copied from core/ibom.js so this script stands alone; the names are
/// kept identical because ecad/AD10sch.js's debugSchematic() calls save2file().
/// ---------------------------------------------------------------------------

function loadfile(filename) {
    var stm = new ActiveXObject("Adodb.Stream");
    stm.Type = 2;
    stm.Mode = 3;
    stm.Open();
    stm.Charset = "utf-8";
    stm.Position = stm.Size;

    var fso = new ActiveXObject("Scripting.FileSystemObject");
    var s = "";
    if (fso.FileExists(filename)) {
        stm.LoadFromFile(filename);
        s = stm.ReadText();
    }
    stm.flush();
    stm.Close();
    return s;
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

/// ---------------------------------------------------------------------------
/// Page assembly.
/// ---------------------------------------------------------------------------

/// Splice a slot with a FUNCTION replacement, never a string one.
///
/// A dollar sign in a *string* replacement is a substitution pattern: $&
/// expands to the matched text, the dollar-backslash form to the surrounding
/// text, and $$ (two dollars) to a literal dollar. web/pep.js used to contain
/// $&& and the splice
/// it into the slot token again, which commented out the rest of the line and
/// killed the whole page. A function replacement disables all of that, so this
/// side is immune to whatever a future payload contains.
function schemSlot(html, slot, payload) {
    // Replace every occurrence (a slot token may legitimately appear more than
    // once, e.g. the board title in both <title> and the top bar). A RegExp with
    // the "g" flag does that; a bare string to String.replace would only touch
    // the first. The slot text holds no regex metacharacters.
    var re = new RegExp(slot, "g");
    return html.replace(re, function () { return payload; });
}

/// Escape the three characters that could end the <script> element early, plus
/// the two line separators JSON.stringify leaves raw. The payload is emitted as
/// a JS literal ("var pcbdata = ... ;"), and U+2028/U+2029 are legal in JSON but
/// not inside an ES5 string literal - a schematic note containing one would take
/// the whole page down. Everything here is ASCII, so this file stays parseable.
function schemJsonForScript(s) {
    return String(s)
        .replace(/</g, function () { return "\\u003c"; })
        .replace(/>/g, function () { return "\\u003e"; })
        .replace(/&/g, function () { return "\\u0026"; })
        .replace(/\u2028/g, function () { return "\\u2028"; })
        .replace(/\u2029/g, function () { return "\\u2029"; });
}

function schemFileNameOf(path) {
    var s = String(path);
    var i = s.lastIndexOf("\\");
    if (i < 0) { i = s.lastIndexOf("/"); }
    return i < 0 ? s : s.substring(i + 1);
}

function schemBaseNameOf(path) {
    var n = schemFileNameOf(path);
    var i = n.lastIndexOf(".");
    return i > 0 ? n.substring(0, i) : n;
}

/// Where the export goes, and what to call it. The board's own folder is the
/// same place the BOM tool writes to, so the two exports sit together; with no
/// board open it falls back to the tool's own folder.
function schemExportTarget() {
    var folder = "";
    var title = "Schematic";
    try {
        var b = PCBServer.GetCurrentPCBBoard();
        if (b !== null && typeof b != "undefined" && b.FileName) {
            folder = ExtractFilePath(b.FileName);
            title = schemBaseNameOf(b.FileName);
        }
    } catch (e) {
        folder = "";
    }
    if (folder == "") {
        folder = CURRENT_PATH;
    }
    return { "folder": folder, "title": title };
}

function schemBuildPage(data) {
    var filepath = CURRENT_PATH + "web\\";
    var html = loadfile(filepath + "schem_standalone.html");
    if (html == "") {
        return null;
    }

    var payload = {};
    payload["adbuild"] = SCHEM_EXPORT_VERSION + " / " +
        (typeof SCH_BUILD_STAMP == "undefined" ? "(no stamp)" : SCH_BUILD_STAMP);
    if (data) {
        payload["schem"] = data;
    } else {
        // Keep the reader's notes so the page can say *why* there is nothing,
        // instead of showing a blank pane.
        var notes = [SCHEM_EXPORT_VERSION + ": \u8BFB\u53D6\u5668\u6CA1\u6709\u4EA7\u51FA\u6570\u636E"];
        var diag = schDiagLog();
        for (var i = 0; i < diag.length; i++) {
            notes.push(diag[i]);
        }
        payload["schemdiag"] = notes;
    }

    var json = schemJsonForScript(JSON.stringify(payload));
    var stamp = SCHEM_EXPORT_VERSION +
        (typeof SCH_BUILD_STAMP == "undefined" ? "" : " / " + SCH_BUILD_STAMP);
    var target = schemExportTarget();

    html = schemSlot(html, "///SCHEMCSS///", loadfile(filepath + "schem_standalone.css"));
    html = schemSlot(html, "///SCHEMJS///", loadfile(filepath + "schem.js"));
    html = schemSlot(html, "///STANDALONEJS///", loadfile(filepath + "schem_standalone.js"));
    html = schemSlot(html, "///PCBDATA///", json);
    html = schemSlot(html, "///TITLE///", target["title"]);
    html = schemSlot(html, "///ADBUILD///", stamp);
    return html;
}

/// ---------------------------------------------------------------------------
/// Entry point. Altium lists this in the Run Script dialog.
/// ---------------------------------------------------------------------------

function SchemExport() {
    var lines = [];
    lines.push("InteractiveBOM Suite - \u72EC\u7ACB\u539F\u7406\u56FE\u5BFC\u51FA");
    lines.push(SCHEM_EXPORT_VERSION);
    lines.push("");

    var data = null;
    try {
        data = parseSchematic(null);
    } catch (e) {
        data = null;
        lines.push("\u8BFB\u53D6\u539F\u7406\u56FE\u65F6\u629B\u51FA\u5F02\u5E38: " + e.message);
    }

    if (data) {
        lines.push("\u8BFB\u53D6\u5230 " + data["sheets"].length + " \u5F20\u56FE\u9875:");
        for (var i = 0; i < data["sheets"].length; i++) {
            var sh = data["sheets"][i];
            lines.push("  " + sh["name"] + ": " + sh["comps"].length +
                " \u4E2A\u5143\u4EF6, " + sh["gfx"].length + " \u4E2A\u56FE\u5F62");
        }
    } else {
        lines.push("\u6CA1\u6709\u8BFB\u53D6\u5230\u539F\u7406\u56FE\u6570\u636E\u3002\u9875\u9762\u4ECD\u7136\u4F1A\u751F\u6210\uFF0C\u5E76\u5199\u660E\u539F\u56E0\u3002");
        var diag = schDiagLog();
        for (var d = 0; d < diag.length && d < 12; d++) {
            lines.push("  " + diag[d]);
        }
    }

    var target = schemExportTarget();
    var outfile = target["folder"] + "PnPout\\Schematic.html";

    var html = null;
    try {
        html = schemBuildPage(data);
    } catch (e2) {
        html = null;
        lines.push("\u751F\u6210\u9875\u9762\u5931\u8D25: " + e2.message);
    }

    if (html === null) {
        lines.push("");
        lines.push("\u7F3A\u5C11\u9875\u9762\u6A21\u677F: " + CURRENT_PATH + "web\\schem_standalone.html");
        showmessage(lines.join("\r\n"));
        return;
    }

    try {
        save2file(html, outfile, false);
        lines.push("");
        lines.push("\u5DF2\u5199\u51FA: " + outfile);
    } catch (e3) {
        outfile = "<\u5199\u51FA\u5931\u8D25: " + e3.message + ">";
        lines.push("");
        lines.push(outfile);
    }

    try {
        var commandline = "explorer.exe \"" + outfile + "\"";
        RunApplication(commandline);
    } catch (e4) {
    }

    showmessage(lines.join("\r\n"));
}
