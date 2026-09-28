/// ecad/AD10sch.js -- schematic reader for Altium Designer 10.
///
/// Reads every .SchDoc of the current project so the generated page can show
/// the schematic next to the BOM and the board, with the three views linked.
///
/// WHY EVERY SINGLE READ HERE IS WRAPPED:
///   The schematic object model (SchServer / ISch_*) is a different COM surface
///   from the PCB one the rest of this tool reads, and neither the enumeration
///   constants nor several property names are guaranteed across AD builds. One
///   unguarded access aborts the whole export with AD's usual unhelpful
///   "catastrophic failure" and no line number. So nothing in this file is
///   allowed to throw: lookups go through schGet()/schConst()/schEach(), and
///   parseSchematic() returns null instead of raising. On null the page is
///   generated exactly as before, just without a schematic pane, and the
///   reasons are recorded in the diag list so they can be reported back.
///
/// OUTPUT SHAPE (consumed by web/schem.js):
///   { units: <mm per coordinate unit>,
///     diag:  [<string>],
///     sheets: [ { name, w, h,
///                 comps: [{ref, val, fp, x, y, rot, box, prim:[]}],
///                 gfx: [], nets: [], ports: [], pwr: [], texts: [], junct: [] } ] }
///   Primitive records are arrays whose first element is the type:
///     l  line       [t, x1, y1, x2, y2]
///     r  rect       [t, x, y, w, h]
///     pl polyline   [t, x1, y1, x2, y2, ...]
///     pg polygon    [t, x1, y1, x2, y2, ...]
///     b  bezier     [t, x1, y1, x2, y2, ...]
///     a  arc        [t, cx, cy, r, a1, a2]
///     e  ellipse    [t, cx, cy, rx, ry]
///     t  text       [t, x, y, size, "text"]
///     p  pin        [t, x, y, len, rot, "number", "name"]
///     s  sheet sym  [t, x, y, w, h, "name", "file"]
///
/// ES3 ONLY -- this file is concatenated into the Borland script bundle.
/// No let/const, no arrow functions, no template strings, no trailing commas.

/// 1 schematic coordinate unit is 1/100 inch = 10 mil.
var SCH_MM_PER_UNIT = 0.254;
/// Safety valve. A sheet with more primitives than this is truncated rather
/// than producing a page that takes minutes to render.
var SCH_MAX_OBJECTS = 30000;
/// Cap on how much diag text is kept; it is embedded in the page.
var SCH_MAX_DIAG = 40;
/// Build stamp of the AD-side script. Written into every exported page. Its
/// ABSENCE from a page is the one thing the page cannot otherwise detect:
/// AD compiles the script project once per session, so an export made by an AD
/// that was not restarted after a rebuild comes from the previous code. Without
/// this marker such a page shows an empty schematic pane with no explanation.
/// Bump the date when the reader changes.
var SCH_BUILD_STAMP = "schem 2026-09-23 11:00";

var schDiag = [];

function schLog(msg) {
    if (schDiag.length < SCH_MAX_DIAG) {
        schDiag.push(msg);
    }
}

/// First value from an object, trying each candidate property name in turn.
/// Returns null when the object is missing or every name fails.
function schGet(obj, names) {
    if (obj === null || typeof obj == "undefined") {
        return null;
    }
    for (var i = 0; i < names.length; i++) {
        try {
            var v = obj[names[i]];
            if (v !== null && typeof v != "undefined") {
                return v;
            }
        } catch (e) {
        }
    }
    return null;
}

function schNum(v, def) {
    if (v === null || typeof v == "undefined") {
        return def;
    }
    try {
        var n = parseFloat(v);
        if (isNaN(n)) {
            return def;
        }
        return n;
    } catch (e) {
        return def;
    }
}

function schStr(v) {
    if (v === null || typeof v == "undefined") {
        return "";
    }
    try {
        return String(v);
    } catch (e) {
        return "";
    }
}

/// Coordinates are integers in schematic units; sub-unit precision is noise.
function schInt(v, def) {
    var n = schNum(v, null);
    if (n === null) {
        return def;
    }
    return Math.round(n);
}

/// First enumeration constant that exists in this AD build. Callers pass a list
/// of spellings because the schematic object set is not named identically in
/// every build; the first one that resolves wins, null means none of them is
/// defined here and that particular walk is skipped.
function schConst(names) {
    for (var i = 0; i < names.length; i++) {
        try {
            var v = schConstOne(names[i]);
            if (v !== null && typeof v != "undefined") {
                return v;
            }
        } catch (e) {
        }
    }
    return null;
}

/// One constant, referenced literally. Reading a name this build does not
/// define raises, which is catchable, so the whole table can sit behind the
/// caller's try block -- and unlike eval() the engine resolves a literal the
/// same way it resolves eComponentObject over in the PCB reader. eval() was
/// the first attempt here and it is not dependable in a .PrjScr document.
function schConstOne(name) {
    if (name == "eSchComponent") { return eSchComponent; }
    if (name == "eSchComponentObject") { return eSchComponentObject; }
    if (name == "eSchWire") { return eSchWire; }
    if (name == "eSchWireObject") { return eSchWireObject; }
    if (name == "eSchBus") { return eSchBus; }
    if (name == "eSchBusEntry") { return eSchBusEntry; }
    if (name == "eSchJunction") { return eSchJunction; }
    if (name == "eSchNetLabel") { return eSchNetLabel; }
    if (name == "eSchNetlabel") { return eSchNetLabel; }
    if (name == "eSchLabel") { return eSchLabel; }
    if (name == "eSchPort") { return eSchPort; }
    if (name == "eSchPowerObject") { return eSchPowerObject; }
    if (name == "eSchPowerPort") { return eSchPowerObject; }
    if (name == "eSchText") { return eSchText; }
    if (name == "eSchTextFrame") { return eSchTextFrame; }
    if (name == "eSchNote") { return eSchTextFrame; }
    if (name == "eSchSheetSymbol") { return eSchSheetSymbol; }
    if (name == "eSchLine") { return eSchLine; }
    if (name == "eSchLineObject") { return eSchLine; }
    if (name == "eSchRectangle") { return eSchRectangle; }
    if (name == "eSchRect") { return eSchRectangle; }
    if (name == "eSchRectangleObject") { return eSchRectangle; }
    if (name == "eSchRoundRectangle") { return eSchRoundRectangle; }
    if (name == "eSchPolyLine") { return eSchPolyLine; }
    if (name == "eSchPolyline") { return eSchPolyLine; }
    if (name == "eSchPolygon") { return eSchPolygon; }
    if (name == "eSchBezier") { return eSchBezier; }
    if (name == "eSchArc") { return eSchArc; }
    if (name == "eSchEllipticalArc") { return eSchEllipticalArc; }
    if (name == "eSchEllipse") { return eSchEllipse; }
    if (name == "eSchPin") { return eSchPin; }
    if (name == "eSchDesignator") { return eSchDesignator; }
    if (name == "eSchComponentDesignator") { return eSchDesignator; }
    if (name == "eSchComment") { return eSchComment; }
    if (name == "eSchComponentComment") { return eSchComment; }
    if (name == "eSchParameter") { return eSchParameter; }
    if (name == "eProcessAll") { return eProcessAll; }
    return null;
}

/// [x, y] of an object, or null.
function schPoint(obj) {
    var loc = schGet(obj, ["Location", "GetState_Location"]);
    if (loc === null) {
        return null;
    }
    var x = schInt(schGet(loc, ["X", "x"]), null);
    var y = schInt(schGet(loc, ["Y", "y"]), null);
    if (x === null || y === null) {
        return null;
    }
    return [x, y];
}

/// [x, y] of the far end of a wire/bus, or null.
function schEndPoint(obj) {
    var loc = schGet(obj, ["EndLocation", "GetState_EndLocation"]);
    if (loc === null) {
        return null;
    }
    var x = schInt(schGet(loc, ["X", "x"]), null);
    var y = schInt(schGet(loc, ["Y", "y"]), null);
    if (x === null || y === null) {
        return null;
    }
    return [x, y];
}

/// [x1, y1, x2, y2] bounding box in schematic units, or null.
function schBox(obj) {
    var r = schGet(obj, ["BoundingRectangle", "GetState_BoundingRectangle",
                         "BoundingRect", "GetState_BoundingRect"]);
    if (r === null) {
        return null;
    }
    var x1 = schInt(schGet(r, ["x1", "X1", "Left", "left"]), null);
    var y1 = schInt(schGet(r, ["y1", "Y1", "Bottom", "bottom"]), null);
    var x2 = schInt(schGet(r, ["x2", "X2", "Right", "right"]), null);
    var y2 = schInt(schGet(r, ["y2", "Y2", "Top", "top"]), null);
    if (x1 === null || y1 === null || x2 === null || y2 === null) {
        return null;
    }
    return [x1, y1, x2, y2];
}

/// Text of a label-ish object. ISch_* text objects hold their string in Text,
/// ports lean on Name, and some builds only expose GetState_ variants.
function schTextOf(obj) {
    var v = schGet(obj, ["Text", "Name", "Designator", "GetState_Text"]);
    return schStr(v);
}

/// Rotation in degrees, 0 when unavailable.
function schRot(obj) {
    var v = schGet(obj, ["Orientation", "Rotation", "GetState_Orientation"]);
    return schNum(v, 0);
}

/// Whether this build is honouring the type filter. A walk over one object type
/// must return only that type; a build that accepts AddFilter_ObjectSet and then
/// ignores it hands back the whole sheet, and because the readers cannot tell a
/// pin from a line the same object would be emitted once per object type - a
/// component symbol read eleven times over. schCountObjects() below is what
/// notices that, and once it has, the walks stop.
var schFilterBroken = false;

/// How many objects the container holds in total, or -1 when it cannot be
/// counted. Compared against each type walk's own count: a filtered walk that
/// returns at least as many objects as the container has cannot have been
/// filtered at all.
function schCountObjects(container) {
    var iter = schIteratorCreate(container);
    if (iter === null) {
        return -1;
    }
    var n = 0;
    try {
        var o = iter.FirstSchObject;
        while (o !== null && typeof o != "undefined") {
            n++;
            if (n > SCH_MAX_OBJECTS) {
                break;
            }
            try {
                o = iter.NextSchObject;
            } catch (e) {
                break;
            }
        }
    } catch (e) {
    }
    try {
        container.SchIterator_Destroy(iter);
    } catch (e) {
    }
    return n;
}

/// An iterator over a container, or null. Some builds expose
/// SchIterator_Create as a method to call, others answer a plain member read;
/// reading a real method yields the function itself, which is not an iterator,
/// so that case is rejected here rather than failing somewhere less obvious.
function schIteratorCreate(container) {
    var iter = null;
    try {
        iter = container.SchIterator_Create();
    } catch (e) {
        iter = null;
    }
    if (iter === null || typeof iter == "undefined") {
        try {
            iter = container.SchIterator_Create;
        } catch (e2) {
            iter = null;
        }
    }
    if (iter === null || typeof iter == "undefined" ||
        typeof iter == "function") {
        return null;
    }
    return iter;
}

/// Create an iterator over one object type. null when the container cannot be
/// iterated or the constant is missing in this build.
function schIterator(container, constNames) {
    var iter = schIteratorCreate(container);
    if (iter === null) {
        return null;
    }
    var set = schConst(constNames);
    if (set === null) {
        schLog("missing constant " + constNames[0]);
        return null;
    }
    try {
        iter.AddFilter_ObjectSet(MkSet(set));
    } catch (e) {
        schLog("filter rejected for " + constNames[0] + ": " + e.message);
        return null;
    }
    try {
        iter.AddFilter_Method(eProcessAll);
    } catch (e) {
    }
    return iter;
}

/// Walks that are being checked against the container's object count. Zero when
/// the walk is a component's own symbol, where the probe would be meaningless.
var schProbeTotal = 0;

/// Walk one object type, handing each object to cb. Returns the count.
function schEach(container, constNames, cb, budget) {
    if (schFilterBroken) {
        return 0;
    }
    var iter = schIterator(container, constNames);
    if (iter === null) {
        return 0;
    }
    var n = 0;
    var limit = budget === null || typeof budget == "undefined" ?
                SCH_MAX_OBJECTS : budget;
    try {
        var o = iter.FirstSchObject;
        while (o !== null && typeof o != "undefined") {
            try {
                cb(o);
            } catch (e) {
            }
            n++;
            if (n >= limit) {
                schLog("truncated at " + limit + " objects (" + constNames[0] + ")");
                break;
            }
            try {
                o = iter.NextSchObject;
            } catch (e) {
                break;
            }
        }
    } catch (e) {
        schLog("walk failed for " + constNames[0] + ": " + e.message);
    }
    try {
        container.SchIterator_Destroy(iter);
    } catch (e) {
    }
    // A walk that saw the whole container was not filtered. Only meaningful for
    // a sheet, and only when the sheet holds more than one object.
    if (schProbeTotal > 1 && n >= schProbeTotal) {
        schFilterBroken = true;
        schLog("object filter ignored by this build (" + constNames[0] +
               " returned all " + n + " objects)");
    }
    return n;
}

/// Polyline-ish objects expose their vertices as Location[i]/LocationCount.
function schVertexList(obj) {
    var count = schNum(schGet(obj, ["LocationCount", "PointCount",
                                    "GetState_LocationCount"]), 0);
    var pts = [];
    for (var i = 0; i < count; i++) {
        var p = null;
        try {
            p = obj.Location(i);
        } catch (e) {
            try {
                p = obj.GetState_Location(i);
            } catch (e2) {
                p = null;
            }
        }
        if (p === null) {
            continue;
        }
        var x = schInt(schGet(p, ["X", "x"]), null);
        var y = schInt(schGet(p, ["Y", "y"]), null);
        if (x === null || y === null) {
            continue;
        }
        pts.push(x, y);
    }
    return pts;
}

/// ---------------------------------------------------------------------------
/// Primitives. These are the graphical atoms: they make up both a component
/// symbol (read from the component's own iterator) and the free drawing on a
/// sheet (read from the document iterator).
/// ---------------------------------------------------------------------------

function schReadLine(o, out) {
    var a = schPoint(o);
    var b = schEndPoint(o);
    if (a === null || b === null) {
        return;
    }
    out.push(["l", a[0], a[1], b[0], b[1]]);
}

function schReadRect(o, out) {
    var box = schBox(o);
    if (box !== null) {
        out.push(["r", box[0], box[1], box[2] - box[0], box[3] - box[1]]);
        return;
    }
    var a = schPoint(o);
    var b = schEndPoint(o);
    if (a === null || b === null) {
        return;
    }
    out.push(["r", a[0], a[1], b[0] - a[0], b[1] - a[1]]);
}

function schReadVertices(o, out, tag) {
    var pts = schVertexList(o);
    if (pts.length >= 4) {
        var rec = [tag];
        for (var i = 0; i < pts.length; i++) {
            rec.push(pts[i]);
        }
        out.push(rec);
    }
}

function schReadArc(o, out) {
    var c = schPoint(o);
    if (c === null) {
        return;
    }
    var r = schNum(schGet(o, ["Radius", "GetState_Radius"]), null);
    if (r === null || r <= 0) {
        return;
    }
    var a1 = schNum(schGet(o, ["StartAngle", "GetState_StartAngle"]), 0);
    var a2 = schNum(schGet(o, ["EndAngle", "GetState_EndAngle"]), 0);
    out.push(["a", c[0], c[1], Math.round(r), Math.round(a1), Math.round(a2)]);
}

function schReadEllipse(o, out) {
    var c = schPoint(o);
    if (c === null) {
        return;
    }
    var rx = schNum(schGet(o, ["Radius", "SecondaryRadius", "XRadius",
                               "GetState_Radius"]), 0);
    var ry = schNum(schGet(o, ["SecondaryRadius", "Radius", "YRadius",
                               "GetState_SecondaryRadius"]), 0);
    if (rx <= 0) {
        rx = 10;
    }
    if (ry <= 0) {
        ry = rx;
    }
    out.push(["e", c[0], c[1], Math.round(rx), Math.round(ry)]);
}

function schReadText(o, out) {
    var s = schTextOf(o);
    if (s == "") {
        return;
    }
    var p = schPoint(o);
    if (p === null) {
        return;
    }
    var size = schNum(schGet(o, ["FontSize", "Size", "TextHeight",
                                 "GetState_FontSize"]), 0);
    if (size <= 0) {
        size = 8;
    }
    out.push(["t", p[0], p[1], Math.round(size), s]);
}

function schReadPin(o, out) {
    var p = schPoint(o);
    if (p === null) {
        return;
    }
    var len = schNum(schGet(o, ["PinLength", "Length", "GetState_PinLength"]), 0);
    var num = schStr(schGet(o, ["Designator", "PinDesignator",
                                "GetState_Designator"]));
    var name = schStr(schGet(o, ["Name", "PinName", "GetState_Name", "Text"]));
    var rot = schRot(o);
    out.push(["p", p[0], p[1], Math.round(len), Math.round(rot), num, name]);
}

/// Everything that can appear inside a component symbol. The count probe is
/// switched off around these walks: they run on the component's own container,
/// which holds only the symbol, so "saw everything" there means nothing.
function schReadComponentPrimitives(comp, out) {
    var probe = schProbeTotal;
    schProbeTotal = 0;
    schEach(comp, ["eSchLine", "eSchLineObject"], function(o) {
        schReadLine(o, out);
    }, null);
    schEach(comp, ["eSchRectangle", "eSchRect", "eSchRectangleObject"], function(o) {
        schReadRect(o, out);
    }, null);
    schEach(comp, ["eSchRoundRectangle"], function(o) {
        schReadRect(o, out);
    }, null);
    schEach(comp, ["eSchPolyLine", "eSchPolyline"], function(o) {
        schReadVertices(o, out, "pl");
    }, null);
    schEach(comp, ["eSchPolygon"], function(o) {
        schReadVertices(o, out, "pg");
    }, null);
    schEach(comp, ["eSchBezier"], function(o) {
        schReadVertices(o, out, "b");
    }, null);
    schEach(comp, ["eSchArc"], function(o) {
        schReadArc(o, out);
    }, null);
    schEach(comp, ["eSchEllipticalArc"], function(o) {
        schReadArc(o, out);
    }, null);
    schEach(comp, ["eSchEllipse"], function(o) {
        schReadEllipse(o, out);
    }, null);
    schEach(comp, ["eSchPin"], function(o) {
        schReadPin(o, out);
    }, null);
    // Designator/comment/parameter texts live inside the component too; they
    // carry the on-sheet positions, which is where a reader expects to find
    // "R1" and "10K" rather than at an invented offset.
    schEach(comp, ["eSchDesignator", "eSchComponentDesignator"], function(o) {
        schReadText(o, out);
    }, null);
    schEach(comp, ["eSchComment", "eSchComponentComment"], function(o) {
        schReadText(o, out);
    }, null);
    schEach(comp, ["eSchParameter"], function(o) {
        schReadText(o, out);
    }, null);
    schEach(comp, ["eSchText"], function(o) {
        schReadText(o, out);
    }, null);
    schProbeTotal = probe;
}

function schReadComponents(sheet, out) {
    return schEach(sheet, ["eSchComponent", "eSchComponentObject"], function(o) {
        var des = schGet(o, ["Designator"]);
        var ref = schTextOf(des);
        if (ref == "") {
            ref = schStr(schGet(o, ["Name", "DesignatorText"]));
        }
        if (ref == "") {
            return;
        }
        // A pin carries a Designator too ("1", "A"). When the type filter could
        // not be applied the walk sees pins as well as components, and a real
        // designator always starts with a letter, so this is what separates
        // them. Without it every pin becomes a phantom component.
        if (!/^[A-Za-z]/.test(ref)) {
            return;
        }
        var val = "";
        var comment = schGet(o, ["Comment"]);
        if (comment !== null) {
            val = schTextOf(comment);
        }
        if (val == "") {
            val = schStr(schGet(o, ["ComponentDescription", "Description",
                                    "GetState_Description"]));
        }
        var fp = schStr(schGet(o, ["Footprint", "CurrentFootprint",
                                   "GetState_Footprint"]));
        var p = schPoint(o);
        if (p === null) {
            p = [0, 0];
        }
        var comp = {
            "ref": ref,
            "val": val,
            "fp": fp,
            "x": p[0],
            "y": p[1],
            "rot": Math.round(schRot(o)),
            "box": schBox(o),
            "prim": []
        };
        schReadComponentPrimitives(o, comp["prim"]);
        out.push(comp);
    }, null);
}

/// ---------------------------------------------------------------------------
/// Sheet level objects: wiring, labels, ports, free text, drawing.
/// ---------------------------------------------------------------------------

function schReadSheetObjects(sheet, sh) {
    var gfx = sh["gfx"];

    var nWire = schEach(sheet, ["eSchWire", "eSchWireObject"], function(o) {
        schReadLine(o, gfx);
    }, null);
    var nBus = schEach(sheet, ["eSchBus"], function(o) {
        schReadLine(o, gfx);
    }, null);
    schEach(sheet, ["eSchBusEntry"], function(o) {
        schReadLine(o, gfx);
    }, null);

    schEach(sheet, ["eSchJunction"], function(o) {
        var p = schPoint(o);
        if (p === null) {
            return;
        }
        var size = schNum(schGet(o, ["Size", "Radius", "GetState_Size"]), 4);
        sh["junct"].push([p[0], p[1], Math.round(size)]);
    }, null);

    schEach(sheet, ["eSchNetLabel", "eSchNetlabel", "eSchLabel"], function(o) {
        var s = schTextOf(o);
        var p = schPoint(o);
        if (s == "" || p === null) {
            return;
        }
        sh["nets"].push({"s": s, "x": p[0], "y": p[1], "r": Math.round(schRot(o))});
    }, null);

    schEach(sheet, ["eSchPort"], function(o) {
        var s = schTextOf(o);
        var p = schPoint(o);
        if (s == "" || p === null) {
            return;
        }
        sh["ports"].push({"s": s, "x": p[0], "y": p[1],
                          "r": Math.round(schRot(o)),
                          "st": schNum(schGet(o, ["Style", "GetState_Style"]), 0)});
    }, null);

    schEach(sheet, ["eSchPowerObject", "eSchPowerPort"], function(o) {
        var s = schTextOf(o);
        var p = schPoint(o);
        if (s == "" || p === null) {
            return;
        }
        sh["pwr"].push({"s": s, "x": p[0], "y": p[1],
                        "r": Math.round(schRot(o)),
                        "st": schNum(schGet(o, ["Style", "GetState_Style"]), 0)});
    }, null);

    schEach(sheet, ["eSchText", "eSchTextFrame", "eSchNote"], function(o) {
        schReadText(o, sh["texts"]);
    }, null);

    schEach(sheet, ["eSchSheetSymbol"], function(o) {
        var p = schPoint(o);
        if (p === null) {
            return;
        }
        var w = schInt(schGet(o, ["XSize", "Width"]), 0);
        var h = schInt(schGet(o, ["YSize", "Height"]), 0);
        if (w <= 0) {
            w = 100;
        }
        if (h <= 0) {
            h = 60;
        }
        var nm = schStr(schGet(o, ["SheetName", "Name", "Designator"]));
        var file = schStr(schGet(o, ["FileName", "SheetFileName"]));
        gfx.push(["s", p[0], p[1], w, h, nm, file]);
    }, null);

    // Free drawing that does not belong to a component.
    schEach(sheet, ["eSchLine", "eSchLineObject"], function(o) {
        schReadLine(o, gfx);
    }, null);
    schEach(sheet, ["eSchRectangle", "eSchRect"], function(o) {
        schReadRect(o, gfx);
    }, null);
    schEach(sheet, ["eSchPolyLine", "eSchPolyline"], function(o) {
        schReadVertices(o, gfx, "pl");
    }, null);
    schEach(sheet, ["eSchPolygon"], function(o) {
        schReadVertices(o, gfx, "pg");
    }, null);
    schEach(sheet, ["eSchBezier"], function(o) {
        schReadVertices(o, gfx, "b");
    }, null);
    schEach(sheet, ["eSchArc"], function(o) {
        schReadArc(o, gfx);
    }, null);
    schEach(sheet, ["eSchEllipse"], function(o) {
        schReadEllipse(o, gfx);
    }, null);

    return nWire + nBus;
}

/// Sheet extents in schematic units. Used only to place the sheet border and
/// to give the page a fallback area when a sheet is nearly empty.
function schSheetSize(sheet) {
    var w = schNum(schGet(sheet, ["XSize", "SheetWidth", "DocWidth"]), 0);
    var h = schNum(schGet(sheet, ["YSize", "SheetHeight", "DocHeight"]), 0);
    if (w <= 0 || h <= 0) {
        var box = schBox(sheet);
        if (box !== null) {
            w = box[2] - box[0];
            h = box[3] - box[1];
        }
    }
    return [Math.round(w), Math.round(h)];
}

function schReadSheet(sheet, name) {
    var size = schSheetSize(sheet);
    var sh = {
        "name": name,
        "w": size[0],
        "h": size[1],
        "comps": [],
        "gfx": [],
        "nets": [],
        "ports": [],
        "pwr": [],
        "texts": [],
        "junct": []
    };
    // Total object count is what the per-type walks are checked against, so it
    // has to be known before the first of them runs.
    var total = schCountObjects(sheet);
    schProbeTotal = total;
    var nComp = schReadComponents(sheet, sh["comps"]);
    var nWire = schReadSheetObjects(sheet, sh);
    schProbeTotal = 0;
    schLog(name + ": " + nComp + " components, " + nWire + " wires, " +
           sh["gfx"].length + " graphics, " + sh["nets"].length + " net labels" +
           (total < 0 ? "" : ", sheet holds " + total + " objects"));
    return sh;
}

/// ---------------------------------------------------------------------------
/// Project / document plumbing.
/// ---------------------------------------------------------------------------

function schFileNameOf(path) {
    var parts = String(path).split("\\");
    var last = parts[parts.length - 1];
    var slash = last.split("/");
    return slash[slash.length - 1];
}

function schNormPath(p) {
    return String(p).replace(/\//g, "\\").toLowerCase();
}

function schEndsWith(s, suffix) {
    s = String(s).toLowerCase();
    return s.length >= suffix.length &&
           s.indexOf(suffix) == s.length - suffix.length;
}

/// Logical documents of the focused project whose name ends in .ext, as
/// [{path, doc}]. doc is the project's own document object, which is the one
/// thing Client.ShowDocument wants.
///
/// Empty when there is no focused project, which is normal: a board opened on
/// its own belongs to no project, and that is exactly the case the folder scan
/// below exists for. Shared with the PCB reader, which uses it to find the
/// board when the active document is something else.
function projectDocumentPaths(ext) {
    var out = [];
    var ws = null;
    try {
        ws = GetWorkspace();
    } catch (e) {
        ws = null;
    }
    if (ws === null || typeof ws == "undefined") {
        return out;
    }
    var prj = null;
    try {
        prj = ws.DM_FocusedProject();
    } catch (e) {
        prj = null;
    }
    if (prj === null || typeof prj == "undefined") {
        return out;
    }
    var count = 0;
    try {
        count = prj.DM_LogicalDocumentCount();
    } catch (e) {
        return out;
    }
    var suffix = "." + String(ext).toLowerCase();
    for (var i = 0; i < count; i++) {
        var doc = null;
        try {
            doc = prj.DM_LogicalDocuments(i);
        } catch (e) {
            continue;
        }
        if (doc === null || typeof doc == "undefined") {
            continue;
        }
        var path = schStr(schGet(doc, ["DM_FullPath"]));
        if (path == "" || !schEndsWith(path, suffix)) {
            continue;
        }
        out.push({"path": path, "doc": doc});
    }
    return out;
}

/// Files ending in .ext in folder and its first couple of levels, skipping the
/// folders this tool and source control fill up. This is how a board that is
/// not part of a project still finds its schematics: they simply live next to
/// it.
function schFolderDocs(folder, ext, depth) {
    var out = [];
    var fso = null;
    try {
        fso = new ActiveXObject("Scripting.FileSystemObject");
    } catch (e) {
        fso = null;
    }
    if (fso === null) {
        schLog("cannot list folders: no FileSystemObject");
        return out;
    }
    var skip = "|pnput|backup|history|.git|.svn|node_modules|";
    var suffix = "." + String(ext).toLowerCase();

    function walk(dir, left) {
        var f = null;
        try {
            f = fso.GetFolder(dir);
        } catch (e) {
            return;
        }
        var files = null;
        try {
            files = new Enumerator(f.Files);
        } catch (e) {
            files = null;
        }
        if (files !== null) {
            for (; !files.atEnd(); files.moveNext()) {
                var it = null;
                try {
                    it = files.item();
                } catch (e) {
                    continue;
                }
                var nm = "";
                try {
                    nm = String(it.Name);
                } catch (e) {
                    continue;
                }
                if (!schEndsWith(nm, suffix)) {
                    continue;
                }
                try {
                    out.push(String(it.Path));
                } catch (e) {
                }
            }
        }
        if (left <= 0) {
            return;
        }
        var subs = null;
        try {
            subs = new Enumerator(f.SubFolders);
        } catch (e) {
            subs = null;
        }
        if (subs === null) {
            return;
        }
        for (; !subs.atEnd(); subs.moveNext()) {
            var sd = null;
            try {
                sd = subs.item();
            } catch (e) {
                continue;
            }
            var sn = "", sp = "";
            try {
                sn = String(sd.Name).toLowerCase();
                sp = String(sd.Path);
            } catch (e) {
                continue;
            }
            if (skip.indexOf("|" + sn + "|") >= 0) {
                continue;
            }
            walk(sp, left - 1);
        }
    }

    try {
        walk(folder, depth);
    } catch (e) {
        schLog("folder scan failed: " + e.message);
    }
    return out;
}

/// The schematic document on screen, or null. Two spellings, because the
/// accessor is not the same in every build.
function schCurrentSheet() {
    var sheet = null;
    try {
        sheet = SchServer.GetCurrentSchDocument();
    } catch (e) {
        sheet = null;
    }
    if (sheet === null || typeof sheet == "undefined") {
        try {
            sheet = SchServer.GetCurrentDocument();
        } catch (e) {
            sheet = null;
        }
    }
    if (sheet === null || typeof sheet == "undefined") {
        return null;
    }
    return sheet;
}

/// Path of a document object, however this build spells it.
function schDocPath(doc) {
    return schStr(schGet(doc, ["FileName", "DocumentName", "DM_FullPath",
                               "ItemName"]));
}

/// Every schematic worth reading, best candidate first:
///
///   1. the one on screen - it is open, so reading it cannot fail to open it
///   2. the focused project's schematics - the normal case
///   3. the .SchDoc files beside the board - for a board with no project
///
/// Entries are {path, name, sheet}, where sheet is already the open document
/// when there is one, saving a round trip through the opening APIs.
function schCandidateDocs(boardFolder) {
    var list = [];
    var seen = {};

    function add(path, sheet, doc) {
        if (path === null || typeof path == "undefined") {
            return;
        }
        path = String(path);
        if (path == "") {
            return;
        }
        if (sheet === null || typeof sheet == "undefined") {
            sheet = null;
        }
        if (doc === null || typeof doc == "undefined") {
            doc = null;
        }
        var key = schNormPath(path);
        var at = seen[key];
        if (typeof at != "undefined") {
            // The same file reached from another route: all it can add is the
            // already-open document and the project document object, both of
            // which save a round trip through the opening APIs.
            if (sheet !== null && list[at]["sheet"] === null) {
                list[at]["sheet"] = sheet;
            }
            if (doc !== null && list[at]["doc"] === null) {
                list[at]["doc"] = doc;
            }
            return;
        }
        seen[key] = list.length;
        list.push({
            "path": path,
            "name": schFileNameOf(path),
            "sheet": sheet,
            "doc": doc
        });
    }

    var cur = schCurrentSheet();
    if (cur !== null) {
        var curPath = schDocPath(cur);
        if (curPath != "" && schEndsWith(curPath, ".schdoc")) {
            add(curPath, cur, null);
            schLog("schematic on screen: " + schFileNameOf(curPath));
        }
    }

    var prj = projectDocumentPaths("schdoc");
    for (var i = 0; i < prj.length; i++) {
        add(prj[i]["path"], null, prj[i]["doc"]);
    }
    schLog("project schematics: " + prj.length);

    if (boardFolder != "") {
        var files = schFolderDocs(boardFolder, "schdoc", 2);
        for (i = 0; i < files.length; i++) {
            add(files[i], null, null);
        }
        schLog("schematics beside the board: " + files.length);
    }

    if (list.length == 0) {
        schLog("nothing to read: no schematic open, no focused project with " +
               "one, and no .SchDoc beside the board");
    }
    return list;
}

/// A schematic document has to be open before SchServer will hand it over, and
/// which call opens it is not the same in every build, so the routes are tried
/// in turn. Whatever comes back is checked against the path that was asked for:
/// without that check a failing route quietly answers with whichever document
/// is already open, and that one sheet would then be read once per candidate,
/// each copy under a different name.
///
/// Set once a nameless document has been taken, so a build that hides the
/// document name still yields one sheet rather than one per candidate.
var schUnverifiedSheet = false;

function schOpenSchematic(entry) {
    if (entry["sheet"] !== null) {
        return entry["sheet"];
    }
    var wanted = schNormPath(entry["path"]);

    function byPath() {
        var c = null;
        try {
            c = SchServer.GetSchDocumentByPath(entry["path"]);
        } catch (e) {
            c = null;
        }
        return c;
    }

    function accept(cand, how) {
        if (cand === null || typeof cand == "undefined") {
            return null;
        }
        var got = schDocPath(cand);
        if (got == "") {
            if (schUnverifiedSheet) {
                schLog(entry["name"] + ": " + how + " answered with a nameless " +
                       "document, ignored");
                return null;
            }
            schUnverifiedSheet = true;
            schLog(entry["name"] + ": taken via " + how + " (no name to check)");
            return cand;
        }
        if (schNormPath(got) != wanted) {
            schLog(entry["name"] + ": " + how + " answered with " +
                   schFileNameOf(got) + ", ignored");
            return null;
        }
        schLog(entry["name"] + ": opened via " + how);
        return cand;
    }

    function tryRoute(open, how) {
        try {
            open();
        } catch (e) {
            schLog(entry["name"] + ": " + how + " failed: " + e.message);
            return null;
        }
        var c = accept(byPath(), how + " + GetSchDocumentByPath");
        if (c === null) {
            c = accept(schCurrentSheet(), how + " + current document");
        }
        return c;
    }

    var sheet = accept(byPath(), "GetSchDocumentByPath");
    if (sheet !== null) {
        return sheet;
    }

    if (entry["doc"] !== null) {
        sheet = tryRoute(function() {
            Client.ShowDocument(entry["doc"]);
        }, "ShowDocument");
        if (sheet !== null) {
            return sheet;
        }
    }
    sheet = tryRoute(function() {
        Client.OpenDocument("SCH", entry["path"]);
    }, "OpenDocument(SCH)");
    if (sheet !== null) {
        return sheet;
    }
    sheet = tryRoute(function() {
        ResetParameters();
        AddStringParameter("ObjectKind", "Document");
        AddStringParameter("FileName", entry["path"]);
        RunProcess("WorkspaceManager:OpenObject");
    }, "OpenObject");
    if (sheet !== null) {
        return sheet;
    }
    sheet = tryRoute(function() {
        SchServer.LoadDocument(entry["path"]);
    }, "LoadDocument");
    if (sheet !== null) {
        return sheet;
    }

    schLog(entry["name"] + ": could not be opened, skipped");
    return null;
}

/// The reader's notes. A caller whose read produced nothing still wants to be
/// able to say why, so the page can show it instead of silently dropping the
/// pane.
function schDiagLog() {
    return schDiag.slice(0);
}

/// Reads every schematic of the focused project.
/// Returns null when there is nothing usable -- callers treat that as "page
/// without a schematic pane" rather than an error.
function parseSchematic(config) {
    schDiag = [];
    var res = null;
    try {
        if (config && config["include"] &&
            config["include"]["schematic"] === false) {
            schLog("schematic disabled in config.ini");
            return null;
        }
        if (typeof SchServer == "undefined" || SchServer === null) {
            schLog("SchServer not available in this AD build");
            return null;
        }
        // The board folder is the third discovery route: .SchDoc files sitting
        // beside the board, for a board with no focused project. Derive it from
        // the open PCB board when one exists; otherwise discovery falls back to
        // the on-screen document and the focused project only.
        var boardFolder = "";
        try {
            var b = PCBServer.GetCurrentPCBBoard();
            if (b !== null && typeof b != "undefined" && b.FileName) {
                boardFolder = ExtractFilePath(b.FileName);
            }
        } catch (e) {
            boardFolder = "";
        }
        var docs = schCandidateDocs(boardFolder);
        if (docs.length == 0) {
            schLog("no schematic document found (on screen, in project, or " +
                   "beside the board)");
            return null;
        }
        var sheets = [];
        for (var i = 0; i < docs.length; i++) {
            var sheet = null;
            try {
                sheet = schOpenSchematic(docs[i]);
            } catch (e) {
                schLog(docs[i]["name"] + ": open threw: " + e.message);
                sheet = null;
            }
            if (sheet === null) {
                continue;
            }
            var sh = null;
            try {
                sh = schReadSheet(sheet, docs[i]["name"]);
            } catch (e) {
                schLog(docs[i]["name"] + ": read threw: " + e.message);
                sh = null;
            }
            if (sh === null) {
                continue;
            }
            if (sh["comps"].length == 0 && sh["gfx"].length == 0) {
                schLog(docs[i]["name"] + ": no objects read, skipped");
                continue;
            }
            sheets.push(sh);
        }
        if (sheets.length == 0) {
            schLog("no schematic sheet produced any data");
            return null;
        }
        res = {
            "units": SCH_MM_PER_UNIT,
            "diag": schDiag.slice(0),
            "sheets": sheets
        };
    } catch (e) {
        schLog("parseSchematic aborted: " + e.message);
        return null;
    }
    return res;
}

/// Diagnostic entry point: run from AD's "Run Script..." dialog. Writes what
/// this build exposes for the first schematic document to
/// <project>\PnPout\schematic_debug.txt and shows a short summary.
function debugSchematic() {
    schDiag = [];
    var lines = [];
    lines.push("InteractiveBOM Suite - schematic diagnostic");
    lines.push("");
    try {
        var data = parseSchematic(null);
        if (data === null) {
            lines.push("RESULT: no schematic data");
        } else {
            lines.push("RESULT: " + data["sheets"].length + " sheet(s)");
            for (var i = 0; i < data["sheets"].length; i++) {
                var sh = data["sheets"][i];
                lines.push("  " + sh["name"] + ": " + sh["comps"].length +
                           " components, " + sh["gfx"].length + " graphics, " +
                           sh["nets"].length + " net labels, " +
                           sh["ports"].length + " ports, " +
                           sh["pwr"].length + " power ports, " +
                           sh["texts"].length + " texts, " +
                           sh["junct"].length + " junctions");
                for (var k = 0; k < sh["comps"].length && k < 5; k++) {
                    lines.push("    " + sh["comps"][k]["ref"] + " = " +
                               sh["comps"][k]["val"] + "  prim=" +
                               sh["comps"][k]["prim"].length);
                }
            }
        }
    } catch (e) {
        lines.push("RESULT: threw " + e.message);
    }
    lines.push("");
    lines.push("---- diag ----");
    for (var d = 0; d < schDiag.length; d++) {
        lines.push(schDiag[d]);
    }
    var text = lines.join("\r\n");
    var outfile = "";
    try {
        var board = PCBServer.GetCurrentPCBBoard();
        if (board !== null) {
            outfile = ExtractFilePath(board.FileName) + "PnPout\\schematic_debug.txt";
        }
    } catch (e) {
    }
    if (outfile == "") {
        outfile = CURRENT_PATH + "PnPout\\schematic_debug.txt";
    }
    try {
        save2file(text, outfile, false);
    } catch (e) {
        outfile = "<could not save: " + e.message + ">";
    }
    showmessage("Schematic diagnostic written to:\n" + outfile + "\n\n" +
                lines.slice(0, Math.min(lines.length, 20)).join("\n"));
}
