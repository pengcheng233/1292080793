
/// AD10.js
/// 
// function Normalize(coord) {
//     return Math.round(0.0254 * coord / 100) / 100;
// }

// function RoundNum(num) {
//     return Math.round(num * 100) / 100;
// }

Number.prototype.round = function anonymFun_round(n) {
    var n = n || 2;
    if (n == 2 || n < 0) {
        return Math.round(this * 100) / 100;
    }
    var d = Math.pow(10, n);
    return Math.round(this * d) / d;
};


function rotatePoint(cPoint, rPoint, angle) {
    var rad = Degrees2Radians(angle);
    return [
        ((rPoint[0] - cPoint[0]) * Math.cos(rad) - (rPoint[1] - cPoint[1]) * Math.sin(rad) + cPoint[0]).round(), 
        -((rPoint[0] - cPoint[0]) * Math.sin(rad) + (rPoint[1] - cPoint[1]) * Math.cos(rad) + cPoint[1]).round()
    ];
}


function get_bbox(Prim) {

    function get_component_bbox(Component) {
        var bbox = {};
        var x0, y0, x1, y1;
        x0 = CoordToMMs(Component.BoundingRectangleNoNameCommentForSignals.Left);
        y0 = CoordToMMs(Component.BoundingRectangleNoNameCommentForSignals.Bottom);
        x1 = CoordToMMs(Component.BoundingRectangleNoNameCommentForSignals.Right);
        y1 = CoordToMMs(Component.BoundingRectangleNoNameCommentForSignals.Top);
        bbox["pos"] = [x0.round(), -y1.round()]; // 
        bbox["relpos"] = [0, 0];
        bbox["angle"] = 0;
        bbox["size"] = [(x1 - x0).round(), (y1 - y0).round()];
        bbox["center"] = [(x0 + bbox.size[0] / 2).round(), -(y0 + bbox.size[1] / 2).round()];
        return bbox;
    }

    function get_text_bbox(Text) {
        var bbox = {};
        var x0, y0, x1, y1;
        x0 = CoordToMMs(Text.BoundingRectangleForSelection.Left);
        y0 = CoordToMMs(Text.BoundingRectangleForSelection.Bottom);
        x1 = CoordToMMs(Text.BoundingRectangleForSelection.Right);
        y1 = CoordToMMs(Text.BoundingRectangleForSelection.Top);
        
        // bbox["pos"] = [x0, -y1];
        // bbox["relpos"] = [0, 0];
        // bbox["angle"] = 0;
        bbox["size"] = [(x1 - x0).round(), (y1 - y0).round()];

        bbox["center"] = [(x0 + bbox.size[0] / 2).round(), -(y0 + bbox.size[1] / 2).round()];

        return bbox;
    }

    switch (Prim.ObjectId) {
        case eComponentObject:
            return get_component_bbox(Prim);
            break;
        case eTextObject:
            return get_text_bbox(Prim);
            break;

        default:
    }
}

/// 
/// Hands back the board to export even when the active document is not the PCB
/// (for example, the user runs the export while a schematic is focused). Falls
/// back to the focused PCB first, then walks the project's logical documents for
/// a .PcbDoc, opens it, and asks PCBServer for the board. Returns null when no
/// PCB can be resolved, so the caller can still report a clean failure.
function resolvePcbBoard() {
    try {
        var b = PCBServer.GetCurrentPCBBoard();
        if (b !== null && typeof b != "undefined") {
            return b;
        }
    } catch (e) {}

    try {
        var ws = GetWorkspace();
        if (ws === null || typeof ws == "undefined") {
            return null;
        }
        var prj = ws.DM_FocusedProject();
        if (prj === null || typeof prj == "undefined") {
            return null;
        }
        var count = prj.DM_LogicalDocumentCount();
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
            var path = "";
            try {
                path = doc.DM_FullPath;
            } catch (e2) {}
            if (path == "" || path == null) {
                continue;
            }
            if (!/\.pcbdoc$/i.test(path)) {
                continue;
            }
            // Prefer fetching the board by path: it works without stealing the
            // user's active document (so a schematic they are editing stays in
            // front). Only fall back to activating the PCB if that is unavailable.
            try {
                Client.OpenDocument("PCB", path);
            } catch (e3) {}
            try {
                var b2 = PCBServer.GetPCBBoardByPath(path);
                if (b2 !== null && typeof b2 != "undefined") {
                    return b2;
                }
            } catch (e4) {}
            try {
                var opened = Client.OpenDocument("PCB", path);
                if (opened !== null && typeof opened != "undefined") {
                    Client.ShowDocument(opened);
                }
                var b3 = PCBServer.GetCurrentPCBBoard();
                if (b3 !== null && typeof b3 != "undefined") {
                    return b3;
                }
            } catch (e5) {}
        }
    } catch (e) {}

    return null;
}

function parsePcb(config) {
    //"use strict";
    var pcb = {}; 
    pcb["pcbdata"] = {};
    pcb["tracks"] = [];
    pcb["texts"] = [];
    pcb["pads"] = [];
    pcb["vias"] = [];
    pcb["arcs"] = [];
    pcb["modules"] = [];
    pcb["fills"] = [];
    pcb["regions"] = [];
    pcb["polygons"] = [];
    pcb["netmap"] = {};
    pcb["netcount"] = 0;

    pcb["pos"] = [];

    pcb["Layers"] = {};
    
    if (config.PcbOutlineMech1) {
        pcb.Layers.OUTLINE_LAYER = eMechanical1;
    } else {
        pcb.Layers.OUTLINE_LAYER = String2Layer("Keep Out Layer");
    }
    
    pcb.Layers.INFO_LAYER = eMechanical2;
    pcb.Layers.TOP_DIMENSIONS_LAYER = eMechanical11;
    pcb.Layers.BOT_DIMENSIONS_LAYER = eMechanical12;
    pcb.Layers.TOP_MECH_BODY_LAYER = eMechanical13;
    pcb.Layers.BOT_MECH_BODY_LAYER = eMechanical14;
    pcb.Layers.TOP_COURTYARD_LAYER = eMechanical15;
    pcb.Layers.BOT_COURTYARD_LAYER = eMechanical16;
    pcb.Layers.UNUSED_LAYERS = MkSet(eMechanical3, eMechanical4, eMechanical5, eMechanical6, eMechanical7, eMechanical8, eMechanical9, eMechanical10);
    pcb.Layers.TOP_OVERLAY_LAYER = String2Layer("Top Overlay");
    pcb.Layers.BOT_OVERLAY_LAYER = String2Layer("Bottom Overlay");
    pcb.Layers.TOP_SOLDERMASK_LAYER = String2Layer("Top Solder Mask");
    pcb.Layers.BOT_SOLDERMASK_LAYER = String2Layer("Bottom Solder Mask");
    pcb.Layers.TOP_PASTE_LAYER = String2Layer("Top Paste");
    pcb.Layers.BOT_PASTE_LAYER = String2Layer("Bottom Paste");
    pcb.Layers.DRILL_GUIDE_LAYER = String2Layer("Drill Guide");
    pcb.Layers.DRILL_DRAWING_LAYER = String2Layer("Drill Drawing");
    pcb.Layers.KEEP_OUT_LAYER = String2Layer("Keep Out Layer");
    pcb.Layers.MULTI_LAYER = String2Layer("Multi Layer");

    /// Resolve a primitive's net name to its index in pcb.netmap, registering
    /// the name on first sight. Returns undefined when the primitive carries no
    /// net. Shared by tracks, arcs, vias, fills and regions so that net
    /// highlighting and click-to-select-net work on copper, not just on pads.
    /// (Pads keep their own original net logic in parsePad.)
    function getNetIndex(Prim) {
        // include.nets is the dialog switch: off means no net names travel with
        // the page at all (smaller file, no net labels or net highlighting).
        if (!config.include.nets) { return undefined; }
        try {
            if (!Prim.Net) {
                return undefined;
            }
            var nm = Prim.Net.Name;
            if (!nm || nm.length == 0) {
                return undefined;
            }
            if (!pcb.netmap[nm]) {
                pcb.netcount++;
                pcb.netmap[nm] = pcb.netcount;
            }
            return pcb.netmap[nm];
        } catch (e) {
            return undefined;
        }
    }

    function parseTrack(Prim) {
        var res = {};
        var start = [CoordToMMs(Prim.x1).round(), -CoordToMMs(Prim.y1).round()];
        var end = [CoordToMMs(Prim.x2).round(), -CoordToMMs(Prim.y2).round()];
        res["layer"] = Prim.Layer;
        if (Prim.InPolygon) {
            res["type"] = "polygon";
            res["svgpath"] = ["M", start, "L", end].join(" ");
        } else {
            res["type"] = "segment";
            res["start"] = start;
            res["end"] = end;
            res["width"] = CoordToMMs(Prim.Width).round();
        } 

        var netIdx = getNetIndex(Prim);
        if (netIdx !== undefined) {
            res["net"] = netIdx;
        }

        return res;
    }

    function parseArc(Prim) {
        var res = {};
        var width = CoordToMMs(Prim.LineWidth).round();
        function arc2path(cx, cy, radius, startangle, endangle) {
            var startrad = Degrees2Radians(startangle);
            var endrad = Degrees2Radians(endangle);
            var start = [cx + (radius * Math.cos(startrad)), cy + (radius * Math.sin(startrad))];
            var end = [cx + (radius * Math.cos(endrad)), cy + (radius * Math.sin(endrad))];

            if (start[0] == end[0] && start[1] == end[1]) {
                var d = ["M", cx - radius, -cy, "a", radius, radius, 0, 1, 0, 2*radius, 0, "a", radius, radius, 0, 1, 0, -2*radius, 0].join(" ");
                return d;
            }

            var da = startangle > endangle ? endangle - startangle + 360 : endangle - startangle;
            var largeArcFlag = da <= 180 ? "0" : "1";
            var sweepFlag = 0;
            var d = ["M", start[0].round(), -start[1].round(), "A", radius, radius, 0, largeArcFlag, sweepFlag, end[0].round(), -end[1].round()].join(" ");

            return d;            
        }

        function arc2tracks(cx, cy, radius, startangle, endangle) {
            var da = startangle > endangle ? endangle - startangle + 360 : endangle - startangle;
            var n;
            if (da <= 90 && da >= 0) {
                n = 4;
            } else if (da <= 180 && da > 90) {
                n = 8;
            } else if (da <= 270 && da > 180) {
                n = 16;
            } else if (da <= 360 && da > 270) {
                n = 32;
            }

            var o = [cx + radius, cy];
            // var start = rotatePoint([cx, cy], o, startangle);

            var points = [];
            var step = da / n;
            for (var i = 0; i <= n; i++) {
                points.push(rotatePoint([cx, cy], o, startangle + i * step));
            }

            var tracks = [];
            var len = points.length - 1;
            if (Prim.InPolygon) {
                for (var i = 0; i < len; i++) {
                    tracks.push({
                        "type": "polygon",
                        // "svgpath": ["M", points[i+0][0], -points[i+0][1], points[i+1][0], -points[i+1][1]].join(" "),
                        "svgpath": ["M", points[i+0], points[i+1]].join(" "),
                        "layer": Prim.Layer
                    })
                }   
            } else {
                for (var i = 0; i < len; i++) {
                    tracks.push({
                        "type": "segment",
                        // "start": [points[i+0][0], -points[i+0][1]],
                        // "end": [points[i+1][0], -points[i+1][1]],
                        "start": points[i+0],
                        "end": points[i+1],
                        "layer": Prim.Layer,
                        "width": width
                    })
                }     
            }

            return tracks;
        }

        var netIdx = getNetIndex(Prim);

        // if (Prim.IsFreePrimitive && (Prim.Layer == eTopLayer || Prim.Layer == eBottomLayer)) {
        if (Prim.Layer == eTopLayer || Prim.Layer == eBottomLayer) {
            var arcTracks = arc2tracks(CoordToMMs(Prim.XCenter), CoordToMMs(Prim.YCenter), CoordToMMs(Prim.Radius), Prim.StartAngle, Prim.EndAngle);
            if (netIdx !== undefined) {
                for (var t = 0; t < arcTracks.length; t++) {
                    arcTracks[t]["net"] = netIdx;
                }
            }
            return arcTracks;
        } else {
            res["type"] = "arc";
            res["width"] = width;
            res["startangle"] = -Prim.EndAngle.round();
            res["endangle"] = -Prim.StartAngle.round();
            res["start"] = [CoordToMMs(Prim.XCenter).round(), -CoordToMMs(Prim.YCenter).round()];
            res["radius"] = CoordToMMs(Prim.Radius).round();
            res["layer"] = Prim.Layer;
            if (netIdx !== undefined) {
                res["net"] = netIdx;
            }
            return res;
        }
    }

    // 90% done
    function parsePad(Prim) {
        var pads = [];
        var res = {};
        var layers = [];

        if (Prim.Layer == eTopLayer) {
            layers.push("F");
            res["type"] = "smd";
            res["size"] = [CoordToMMs(Prim.TopXSize).round(), CoordToMMs(Prim.TopYSize).round()];
        }
        else if (Prim.Layer == eBottomLayer) {
            layers.push("B");
            res["type"] = "smd";
            res["size"] = [CoordToMMs(Prim.BotXSize).round(), CoordToMMs(Prim.BotYSize).round()];
        }
        else {
            layers.splice(0, 0, "F", "B");
            res["type"] = "th";
            res["size"] = [CoordToMMs(Prim.TopXSize).round(), CoordToMMs(Prim.TopYSize).round()];  
        }

        res["layers"] = layers;
        res["pos"] = [CoordToMMs(Prim.x).round(), -CoordToMMs(Prim.y).round()]; 
        res["angle"] = -Prim.Rotation.round();
        
        // not done 
        if (Prim.Layer == eMultiLayer) {
            switch (Prim.TopShape) {
                case 1:  //  Round in AD
                    res["shape"] = (res["size"][0] == res["size"][1]) ? "circle" : "oval";  // done
                    break;
                case 2:  //  Rectangular in AD
                    res["shape"] = "rect";  // done
                    break;
                case 3:  // Octagonal in AD
                    res["shape"] = "chamfrect";  // not done,  it is circle for now  
                    break;
                case 9:  // Rounded Rectangle in AD
                    res["shape"] = "roundrect";  // 
                    break;
                default:
                    res["shape"] = "custom";  // not done, is it necessary?
            }

            switch (Prim.BotShape) {
                case 1: 
                    res["shape"] = (res["size"][0] == res["size"][1]) ? "circle" : "oval"; 
                    break;
                case 2:
                    res["shape"] = "rect";
                    break;
                case 3:
                    res["shape"] = "chamfrect"; 
                    break;
                case 9:
                    res["shape"] = "roundrect";
                    break;
                default:
                    res["shape"] = "custom";
            }    
        } 
        else {
            switch (Prim.ShapeOnLayer(Prim.Layer)) {
                case 1: 
                    res["shape"] = (res["size"][0] == res["size"][1]) ? "circle" : "oval"; 
                    break;
                case 2:
                    res["shape"] = "rect";
                    break;
                case 3:
                    res["shape"] = "chamfrect";  
                    break;
                case 9:
                    res["shape"] = "roundrect";
                    break;
                default:
                    res["shape"] = "custom";
            }           
        }   

        if (res["shape"] == "chamfrect") {  // not done
            res["radius"] = (Math.min(res["size"][0], res["size"][1]) * 0.5).round();
            res["chamfpos"] = res["pos"];
            res["chamfratio"] = 0.5;  

        } else if (res["shape"] == "roundrect") {
            res["radius"] = CoordToMMs(Prim.CornerRadius(Prim.Layer)).round();  //  smd ? th ?
        }

        if ("A1".indexOf(Prim.Name) != -1) {
            res["pin1"] = 1;
        }

        if (res["type"] == "th") {
            switch (Prim.HoleType) {
                case 0: // circle
                    res["drillsize"] = [CoordToMMs(Prim.HoleSize).round(), CoordToMMs(Prim.HoleSize).round()];
                    res["drillshape"] = "circle";
                    break;
                case 1: // square, but not supported in kicad, so do as circle
                    res["drillsize"] = [CoordToMMs(Prim.HoleSize).round(), CoordToMMs(Prim.HoleSize).round()];
                    res["drillshape"] = "circle";
                    break;
                case 2: // slot
                    res["drillsize"] = [CoordToMMs(Prim.HoleWidth).round(), CoordToMMs(Prim.HoleSize).round()];
                    res["drillshape"] = "oblong"; 
                    break;
                default:  //
            }
        }

        res["offset"] =  [CoordToMMs(Prim.XPadOffset(Prim.Layer)).round(), -CoordToMMs(Prim.YPadOffset(Prim.Layer)).round()];
        if (res["offset"][0] == 0 && res["offset"][1] == 0) {
            delete res["offset"];
        }



        try {
            if (config.include.nets && Prim.InNet && Prim.Net) {
                var nm = Prim.Net.Name;
                if (nm && nm.length > 0) {
                    if (!pcb.netmap[nm]) { pcb.netcount++; pcb.netmap[nm] = pcb.netcount; }
                    res["net"] = pcb.netmap[nm];
                }
            }
        } catch (e) {}

        pads.push(res);

        return pads;
    }

    // 75% done
    function parseVia(Prim) {
        var vias = [];
        var res = {};
        var layers = [];

        var viaLayer; 
        if (Prim.StartLayer.LayerID == eTopLayer && Prim.StopLayer.LayerID != eBottomLayer) {
            viaLayer = eTopLayer;
            layers.push("F");
            res["type"] = "smd";
            res["size"] = [CoordToMMs(Prim.StackSizeOnLayer(eTopLayer)).round(), CoordToMMs(Prim.StackSizeOnLayer(eTopLayer)).round()];
        } 
        else if (Prim.StartLayer.LayerID != eBottomLayer && Prim.StopLayer.LayerID == eTopLayer) {
            viaLayer = eTopLayer;
            layers.push("F");
            res["type"] = "smd";
            res["size"] = [CoordToMMs(Prim.StackSizeOnLayer(eTopLayer)).round(), CoordToMMs(Prim.StackSizeOnLayer(eTopLayer)).round()];
        } 
        else if (Prim.StartLayer.LayerID == eTopLayer && Prim.StopLayer.LayerID == eTopLayer) {
            viaLayer = eTopLayer;
            layers.push("F");
            res["type"] = "smd";
            res["size"] = [CoordToMMs(Prim.StackSizeOnLayer(eTopLayer)).round(), CoordToMMs(Prim.StackSizeOnLayer(eTopLayer)).round()];
        } 
        else if (Prim.StartLayer.LayerID == eBottomLayer && Prim.StopLayer.LayerID != eTopLayer) {
            viaLayer = eBottomLayer;
            layers.push("B");
            res["type"] = "smd";
            res["size"] = [CoordToMMs(Prim.StackSizeOnLayer(eBottomLayer)).round(), CoordToMMs(Prim.StackSizeOnLayer(eBottomLayer)).round()];
        } 
        else if (Prim.StartLayer.LayerID != eTopLayer && Prim.StopLayer.LayerID == eBottomLayer) {
            viaLayer = eBottomLayer;
            layers.push("B");
            res["type"] = "smd";
            res["size"] = [CoordToMMs(Prim.StackSizeOnLayer(eBottomLayer)).round(), CoordToMMs(Prim.StackSizeOnLayer(eBottomLayer)).round()];
        } 
        else if (Prim.StartLayer.LayerID == eBottomLayer && Prim.StopLayer.LayerID == eBottomLayer) {
            viaLayer = eBottomLayer;
            layers.push("B");
            res["type"] = "smd";
            res["size"] = [CoordToMMs(Prim.StackSizeOnLayer(eBottomLayer)).round(), CoordToMMs(Prim.StackSizeOnLayer(eBottomLayer)).round()];
        } 
        else if (Prim.StartLayer.LayerID == eTopLayer && Prim.StopLayer.LayerID == eBottomLayer) {
            viaLayer = eMultiLayer;
            layers.splice(0, 0, "F", "B");
            res["type"] = "th";
            res["size"] = [CoordToMMs(Prim.Size).round(), CoordToMMs(Prim.Size).round()];  
        } 
        else if (Prim.StartLayer.LayerID == eBottomLayer && Prim.StopLayer.LayerID == eTopLayer) {
            viaLayer = eMultiLayer;
            layers.splice(0, 0, "F", "B");
            res["type"] = "th";
            res["size"] = [CoordToMMs(Prim.Size).round(), CoordToMMs(Prim.Size).round()];  
        } else {
            viaLayer = "inner";
        }

        res["layers"] = layers;
        res["pos"] = [CoordToMMs(Prim.x).round(), -CoordToMMs(Prim.y).round()];
        res["angle"] = 0; 
        
        res["shape"] = "circle";

        if (res["type"] == "th") {
            res["drillsize"] = [CoordToMMs(Prim.HoleSize).round(), CoordToMMs(Prim.HoleSize).round()];
            res["drillshape"] = "circle";
        }

        // Vias are rendered as pads (free vias land in footprintNoBom.pads), so a
        // net here also gives them the pad net-name label for free.
        var netIdx = getNetIndex(Prim);
        if (netIdx !== undefined) {
            res["net"] = netIdx;
        }

        vias.push(res);

        return vias;
    }

    // 99% done
    function parseFill(Prim) {
        var res = {};

        if (Prim.IsKeepout) {
            return res;
        }
        var angle = Prim.Rotation;
        var corner1 = [CoordToMMs(Prim.X1Location), CoordToMMs(Prim.Y1Location)];
        var corner3 = [CoordToMMs(Prim.X2Location), CoordToMMs(Prim.Y2Location)];
        var width = corner3[0] - corner1[0];
        var height = corner3[1] - corner1[1];
        var pos = [corner1[0] + width / 2, corner1[1] + height / 2];
        var corner2 = [corner1[0], corner3[1]];
        var corner4 = [corner3[0], corner1[1]];
        var tcorner1 = rotatePoint(pos, corner1, angle);
        var tcorner2 = rotatePoint(pos, corner2, angle);
        var tcorner3 = rotatePoint(pos, corner3, angle);
        var tcorner4 = rotatePoint(pos, corner4, angle);

        // res["svgpath"] =  ["M", tcorner1[0], -tcorner1[1], "L", tcorner2[0], -tcorner2[1], "L", tcorner3[0], -tcorner3[1], "L", tcorner4[0], -tcorner4[1], "Z"].join(" ");
        res["svgpath"] =  ["M", tcorner1, "L", tcorner2, "L", tcorner3, "L", tcorner4, "Z"].join(" ");
        res["type"] = "polygon";
        res["layer"] = Prim.Layer;

        var netIdx = getNetIndex(Prim);
        if (netIdx !== undefined) {
            res["net"] = netIdx;
        }


        // if (!Prim.IsFreePrimitive) {
        //     res['free'] = false;
        // }
        return res;
    }

    // 55% done
    function parseRegion(Prim, pourNetIdx) {
        var res = {};
        var polygons = [];
        var count = Prim.MainContour.Count;
        var holes_svg = [];
        if (Prim.Kind == 0 && !Prim.IsKeepout) {    // Kind "Board Cutout" not done (Tracks on KeepOutLayer can do it).
            for (var i = 1; i <= count; i++) {
                polygons.push([CoordToMMs(Prim.MainContour.x(i)).round(), -CoordToMMs(Prim.MainContour.y(i)).round()].join(" "));
            }      
            
            count = Prim.HoleCount;
            for (var k = 0; k < count; k++) {
                var hole = [];
                for (var i = 1; i <= Prim.Holes(k).Count; i++) {
                    hole.push([CoordToMMs(Prim.Holes(k).x(i)).round(), -CoordToMMs(Prim.Holes(k).y(i)).round()].join(" "));
                }
                holes_svg.push(["M", hole.shift(), "L", hole.join("L"), "Z "].join(""));
            }
        } else {
            return res;
        }

        res["type"] = "polygon";
        res["svgpath"] = ["M", polygons.shift(), "L", polygons.join("L"), "Z "].join("") + holes_svg.join("");
        res["layer"] = Prim.Layer;

        var netIdx = getNetIndex(Prim);
        if (netIdx === undefined && pourNetIdx !== undefined) {
            // Region primitives of a polygon pour often carry no net of their
            // own; fall back to the net of the pour object being parsed.
            netIdx = pourNetIdx;
        }
        if (netIdx !== undefined) {
            res["net"] = netIdx;
        }

        return res;
    }

    // 50% done
    function parsePoly(Polygon) {
        var drawings = [];
        // var count = Polygon.PointCount; 
        // for (var i = 0; i <= count; i++) {
        //     if (Polygon.Segments(i).Kind == ePolySegmentArc) {
        //         polygons.push({"x": CoordToMMs(Polygon.Segments(i).cx), "y": CoordToMMs(-Polygon.Segments(i).cy)});
        //     }
        //     else {
        //         polygons.push({"x": CoordToMMs(Polygon.Segments(i).vx), "y": CoordToMMs(-Polygon.Segments(i).vy)});
        //     }           
        // }   
        var hatched_drawings = [];
        // The pour object itself always carries the assigned net, while its
        // inner primitives may not - keep it as the fallback for all of them.
        var pourNetIdx = getNetIndex(Polygon);

        var Iter = Polygon.GroupIterator_Create;
        var Prim = Iter.FirstPCBObject;
        while (Prim != null) {
            switch (Prim.ObjectId) {
                case eArcObject:
                    hatched_drawings = hatched_drawings.concat(parseArc(Prim));
                    break;
                case eTrackObject:
                    hatched_drawings.push(parseTrack(Prim));
                    break;
                case eRegionObject:
                    drawings.push(parseRegion(Prim, pourNetIdx));
                    break;
            }
            Prim = Iter.NextPCBObject;
        }

        var len = hatched_drawings.length;
        if (len > 1) {
            var hatchedAll2One = {};
            var pathArr = [];
            for (var i = 0; i < len; i++) {
                pathArr.push(hatched_drawings[i].svgpath);
            }
            hatchedAll2One["width"] = CoordToMMs(Polygon.TrackSize).round();
            hatchedAll2One["type"] = "polygon"
            hatchedAll2One["svgpath"] = pathArr.join(" ");
            hatchedAll2One["layer"] = hatched_drawings[0].layer;
            // The merge flattens many hatched segments into one shape, so carry the
            // net over from whichever segment still knows it.
            for (var h = 0; h < len; h++) {
                if (hatched_drawings[h].net !== undefined) {
                    hatchedAll2One["net"] = hatched_drawings[h].net;
                    break;
                }
            }
            if (hatchedAll2One["net"] === undefined && pourNetIdx !== undefined) {
                hatchedAll2One["net"] = pourNetIdx;
            }
            drawings.push(hatchedAll2One);
        }
        return drawings;
    }

    // 95% done
    function parseEdges(pcb) {
        var edges = [];
        var default_width = CoordToMMs(MilsToCoord(5)).round();
        var bbox = {};
        bbox["minx"] = CoordToMMs(pcb.board.BoardOutline.BoundingRectangle.Left).round();
        bbox["miny"] = -CoordToMMs(pcb.board.BoardOutline.BoundingRectangle.Top).round();
        bbox["maxx"] = CoordToMMs(pcb.board.BoardOutline.BoundingRectangle.Right).round();
        bbox["maxy"] = -CoordToMMs(pcb.board.BoardOutline.BoundingRectangle.Bottom).round();
    
        // boardoutline edges 
        // var k;
        // var count = pcb.board.BoardOutline.PointCount
        // for (var i = 0; i < count; i++) {
        //     k = i + 1;
        //     edges.push({});
        //     if (pcb.board.BoardOutline.Segments(i).Kind == ePolySegmentLine) {
        //         if (k == pcb.board.BoardOutline.PointCount) {
        //             k = 0;
        //         }
        //         edges[i]["start"] = [CoordToMMs(pcb.board.BoardOutline.Segments(i).vx).round(), -CoordToMMs(pcb.board.BoardOutline.Segments(i).vy).round()];
        //         edges[i]["end"] = [CoordToMMs(pcb.board.BoardOutline.Segments(k).vx).round(), -CoordToMMs(pcb.board.BoardOutline.Segments(k).vy).round()];
        //         edges[i]["type"] = "segment";
        //         edges[i]["width"] = default_width;
        //         edges[i]["layer"] = pcb.Layers.OUTLINE_LAYER;
        //     }
        //     else {
        //         edges[i]["start"] = [CoordToMMs(pcb.board.BoardOutline.Segments(i).cx).round(), -CoordToMMs(pcb.board.BoardOutline.Segments(i).cy).round()];
        //         edges[i]["startangle"] = -pcb.board.BoardOutline.Segments(i).Angle2;
        //         edges[i]["endangle"] = -pcb.board.BoardOutline.Segments(i).Angle1;
        //         edges[i]["type"] = "arc";
        //         edges[i]["radius"] = CoordToMMs(pcb.board.BoardOutline.Segments(i).Radius).round();
        //         edges[i]["width"] = default_width;
        //         edges[i]["layer"] = pcb.Layers.OUTLINE_LAYER;
        //     }
        // }

        var Iter, Prim;
        Iter = pcb.board.BoardIterator_Create;
        Iter.AddFilter_ObjectSet(MkSet(eArcObject, eTrackObject));
        Iter.AddFilter_LayerSet(MkSet(pcb.Layers.OUTLINE_LAYER));
        Iter.AddFilter_Method(eProcessAll);
        Prim = Iter.FirstPCBObject;
        while (Prim != null) {
            switch (Prim.ObjectId) {
                case eArcObject:
                    edges.push(parseArc(Prim));
                    break;
                case eTrackObject:
                    edges.push(parseTrack(Prim));
                    break;
            }
            Prim = Iter.NextPCBObject;
        }
        pcb.board.BoardIterator_Destroy(Iter);

        pcb.pcbdata["edges"] = edges;
        pcb.pcbdata["edges_bbox"] = bbox;
    }

    function getMetadata(pcb) {
        var res = {};
        res["title"] = ChangeFileExt(pcb.boardname, "");
        res["revision"] = "";
        res["company"] = "";

        var fso = new ActiveXObject("Scripting.FileSystemObject"); 
        var boardfile = fso.GetFile(pcb.board.FileName);
        var d = new Date(boardfile.DateLastModified);
        
        res["date"] = [d.getFullYear() , d.getMonth() + 1, d.getDate()].join("-") + " " + [d.getHours(), d.getMinutes(), d.getSeconds()].join(":");
        return res;
    }

    // 90% done  // use the KiCad's font , not support chinese char.
    function parseText(Prim) {
        var res = {};
        if (Prim.IsHidden) {
            return res;
        }
        else if (Prim.TextKind == eText_BarCode) {
            return res;  //  an API in AD called ConvetToStrokeArray, how to use it?
        }

        var len = Prim.Text.length;
        if (len == 0) {
            return res;
        }

        res["attr"] = [];
        if (Prim.MirrorFlag) {
            res.attr.push("mirrored");
        }
        if (Prim.Italic) {
            res.attr.push("italic");
        }
        if (Prim.Bold) {
            res.attr.push("bold");
        }
        if (Prim.Inverted) {
            res.attr.push("inverted");
        }
        res["type"] = "text";
        res["text"] = Prim.Text;
        res["angle"] = Prim.Rotation.round();
        res["layer"] = Prim.Layer;

        var bbox = get_bbox(Prim);
        res["pos"] = bbox["center"];

        if (Prim.TextKind == 0) {
            res["thickness"] = CoordToMMs(Prim.Width).round();
            res["height"] = CoordToMMs(Prim.Size).round();
            res["width"] = res["height"].round(); // single char's width in kicad
        } else if (Prim.TextKind == 1) {
            res["height"] = CoordToMMs(Prim.TTFTextHeight * 0.6).round();
            res["width"] = CoordToMMs(Prim.TTFTextWidth * 0.9 / len).round();
            res["thickness"] = CoordToMMs(res["height"] * 0.1).round();
        }

        // res["horiz_justify"] = 0; // center align, tag 2.3
        res["justify"] = [0, 0];  //

        if (Prim.IsDesignator) {
            res["ref"] = 1;
        }
        if (Prim.IsComment) {
            res["val"] = 1;
        }

        return res;
    }


    /// Read the component's Description, mirroring AD's Bill of Materials "Description" column.
    /// IPCB_Component exposes it as SourceDescription; the plain "Description" property does
    /// not exist, and JScript returns undefined (rather than throwing) for unknown COM
    /// properties, so every candidate is probed and only truthy results are accepted.
    function getComponentDescription(Component) {
        var candidates = [
            "SourceDescription",
            "GetState_SourceDescription",
            "Description",
            "GetState_Description",
            "FootprintDescription",
            "GetState_FootprintDescription"
        ];
        for (var i = 0; i < candidates.length; i++) {
            try {
                var v = Component[candidates[i]];
                if (typeof v === "function") {
                    v = v.call(Component);
                }
                if (v !== null && v !== undefined && String(v).length > 0) {
                    return String(v);
                }
            } catch (e) {
                // this candidate is unavailable on this AD version, try the next one
            }
        }
        return "";
    }

    /// Diagnostic helper: dump every description-ish property AD exposes on a component,
    /// plus the names of all its own properties, so we can find where the AD "Description"
    /// column actually lives. Only used by main() when config.DebugDescription is enabled.
    function describeComponentProps(Component) {
        var names = [
            "SourceDescription", "GetState_SourceDescription",
            "Description", "GetState_Description",
            "FootprintDescription", "GetState_FootprintDescription",
            "SourceLibReference", "GetState_SourceLibReference",
            "SourceDesignator", "GetState_SourceDesignator",
            "SourceComponentLibrary", "GetState_SourceComponentLibrary",
            "Comment", "Name", "Pattern"
        ];
        var out = [];
        for (var i = 0; i < names.length; i++) {
            var v, err = "";
            try {
                v = Component[names[i]];
                if (typeof v === "function") {
                    v = v.call(Component);
                }
                if (v !== null && v !== undefined && typeof v === "object" && v.Text !== undefined) {
                    v = v.Text;   // IPCB_Text-like objects (Name / Comment) carry their string in .Text
                }
            } catch (e) {
                v = "<error>";
                err = " (" + e.message + ")";
            }
            // An absent property yields undefined, which would render as the literal
            // string "undefined" and look like a real value. Label it explicitly.
            var shown;
            if (v === undefined) {
                shown = "<undefined>";
            } else if (v === null) {
                shown = "<null>";
            } else {
                shown = "[" + String(v) + "]";
            }
            out.push(names[i] + "=" + shown + err);
        }
        return out.join("\n");
    }

    /// Enumerate every enumerable property name on the component object, so we can spot
    /// description-like fields we did not guess. Returns a comma-separated name list.
    function enumComponentPropNames(Component) {
        var list = [];
        try {
            for (var k in Component) {
                list.push(k);
            }
        } catch (e) {
            return "<enumeration failed: " + e.message + ">";
        }
        try {
            if (typeof Component.GetHashCode === "function") { /* touch nothing */ }
        } catch (e2) {}
        return list.sort().join(", ");
    }

    /// Read the component's Type (AD's Component Kind) as displayed in the component
    /// inspector: Standard / Standard (No BOM) / Mechanical / Graphical / Net Tie / Jumper.
    /// IPCB_Component exposes it as ComponentKind (GetState_ComponentKind), returning a
    /// TComponentKind enum. Different AD versions render the value either as the enum name
    /// ("eComponentKind_Standard_NoBOM") or as its ordinal integer, so the raw value is
    /// returned untouched and interpreted by componentKindExcludedFromBom().
    function getComponentKind(Component) {
        var candidates = ["ComponentKind", "GetState_ComponentKind"];
        for (var i = 0; i < candidates.length; i++) {
            try {
                var v = Component[candidates[i]];
                if (typeof v === "function") {
                    v = v.call(Component);
                }
                if (v !== null && v !== undefined && String(v).length > 0) {
                    return String(v);
                }
            } catch (e) {
                // unavailable on this AD version, try the next candidate
            }
        }
        return "";
    }

    /// TComponentKind ordinals (RT_Workspace / System API constants):
    ///   0 Standard           1 Mechanical        2 Graphical
    ///   3 NetTie_BOM         4 NetTie_NoBOM       5 Standard_NoBOM      6 OwnerDraw
    /// Both "Standard (No BOM)" and "Net Tie (No BOM)" must be kept out of the BOM.
    /// Anything unrecognised is treated as included, so an unexpected value can never
    /// silently drop real parts.
    function componentKindExcludedFromBom(kind) {
        if (!kind) {
            return false;
        }
        // enum-name form: eComponentKind_Standard_NoBOM / eComponentKind_NetTie_NoBOM,
        // and the inspector's display form "Standard (No BOM)" / "Net Tie (No BOM)".
        // Normalise away spaces and underscores so both match.
        var s = String(kind).toLowerCase().replace(/[\s_]+/g, "");
        if (s.indexOf("nobom") >= 0) {
            return true;
        }
        // ordinal form
        if (/^\d+$/.test(s)) {
            var n = parseInt(s, 10);
            return n == 4 || n == 5;
        }
        return false;
    }

    // 91% done
    function parseComponent(Component) {
        var res = {};
        var oFootprint = {};
        var oComponent = {};
        var pads = [];

        var Iter, Prim;
        var isSMD = true;
        Iter = Component.GroupIterator_Create;
        Iter.AddFilter_ObjectSet(MkSet(ePadObject));
        Iter.AddFilter_LayerSet(AllLayers);
        Prim = Iter.FirstPCBObject;
        while (Prim != null) {
            pads = pads.concat(parsePad(Prim));
            if (isSMD && Prim.Layer == eMultiLayer) {
                isSMD = false;
            }
            Prim = Iter.NextPCBObject;
        }
        Component.GroupIterator_Destroy(Iter);

        oFootprint["drawings"] = [];
        Iter = Component.GroupIterator_Create;
        Iter.AddFilter_ObjectSet(MkSet(eTrackObject, eArcObject, eFillobject, eRegionObject));
        Iter.AddFilter_LayerSet(MkSet(eTopLayer, eBottomLayer));
        Prim = Iter.FirstPCBObject;
        while (Prim != null) {
            if (Prim.Layer == eTopLayer) {
                switch (Prim.ObjectId) {
                    case eTrackObject:
                        oFootprint["drawings"].push({"layer": "F", "drawing": parseTrack(Prim)});
                        break;
                    case eArcObject:
                        oFootprint["drawings"].push({"layer": "F", "drawing": parseArc(Prim)});
                        break;
                    case eFillobject:
                        oFootprint["drawings"].push({"layer": "F", "drawing": parseFill(Prim)});
                        break;
                    case eRegionObject:
                        oFootprint["drawings"].push({"layer": "F", "drawing": parseRegion(Prim)});
                        break;
                    default:
                }
            } 
            else if (Prim.Layer == eBottomLayer) {
                switch (Prim.ObjectId) {
                    case eTrackObject:
                        oFootprint["drawings"].push({"layer": "B", "drawing": parseTrack(Prim)});
                        break;
                    case eArcObject:
                        oFootprint["drawings"].push({"layer": "B", "drawing": parseArc(Prim)});
                        break;
                    case eFillobject:
                        oFootprint["drawings"].push({"layer": "B", "drawing": parseFill(Prim)});
                        break;
                    case eRegionObject:
                        oFootprint["drawings"].push({"layer": "B", "drawing": parseRegion(Prim)});
                        break;
                    default:
                }
            }
            Prim = Iter.NextPCBObject;
        }
        Component.GroupIterator_Destroy(Iter);

        var bbox = get_bbox(Component);
        oFootprint["center"] = bbox.center;
        delete bbox.center;
        oFootprint["bbox"] = bbox;
        oFootprint["pads"] = pads;
        oFootprint["ref"] = Component.Name.Text;
        oFootprint["val"] = Component.Comment.Text;
        if (Component.Layer == eTopLayer) {
            oFootprint["layer"] = "F";
        }
        else {
            oFootprint["layer"] = "B";
        }

        res["footprint"] = oFootprint;

        oComponent["ref"] = oFootprint.ref;
        oComponent["val"] = Component.Comment.Text;
        oComponent["footprint"] = Component.Pattern;
        oComponent["layer"] = oFootprint["layer"];
        oComponent["attr"] = null;

        // Component Description -> the "Description" column of AD's Bill of Materials dialog.
        // NOTE: IPCB_Component has NO plain "Description" property. The schematic component's
        // Description is exposed as SourceDescription (IPCB_Component.GetState_SourceDescription),
        // which is populated when the PCB is synced from the schematic via the Update command.
        // FootprintDescription is the *footprint's* description, not the component's, so it is
        // only used as a last resort.
        var desc = getComponentDescription(Component);
        oComponent["description"] = desc ? String(desc) : "";

        // Component Type, as shown in the inspector. Components whose Type is
        // "Standard (No BOM)" or "Net Tie (No BOM)" are excluded from AD's own
        // Bill of Materials dialog, so expose the flag for skipComponent().
        var kind = getComponentKind(Component);
        oComponent["componentkind"] = kind;
        oComponent["nobom"] = componentKindExcludedFromBom(kind);

        res["angle"] = Component.Rotation.round();
        res["itemkey"] = ["k", oComponent["footprint"], oComponent["val"]].join("");
        
        if (isSMD) {
            res["soldertype"] = "smd";
        }
        else {
            res["soldertype"] = "th";
        }

        res["component"] = oComponent;

        return res;
    }

    //======
    function parseDrawingsOnLayers(drawings, f_layer, b_layer) {
        var front = [];
        var back = [];
        for (var i = drawings.length - 1; i >= 0; i--) {
            if (drawings[i].layer == f_layer) {
                front.push(drawings[i]);
            }
            else if (drawings[i].layer == b_layer) {
                back.push(drawings[i]);
            }
        }
        return {"F": front, "B": back};
    }

    // parse_board
    if (PCBServer == null) {
        showmessage("Please open a PCB document");
        return false;
    }
    PCBServer.PreProcess;
    var board = resolvePcbBoard();
    if (board == null) {
        showmessage("ERROR:Current document is not a PCB document");
        return false;
    }
    pcb["board"] = board;
    pcb["boardpath"] = ExtractFilePath(board.FileName);
    pcb["boardname"] = ExtractFileName(board.FileName);

    pcb.pcbdata["metadata"] = getMetadata(pcb);

    parseEdges(pcb);

    pcb.pos.push(CoordToMMs(board.XOrigin).round());
    pcb.pos.push(CoordToMMs(board.YOrigin).round());

    var Iter, Prim; 
    Iter = pcb.board.BoardIterator_Create;
    Iter.AddFilter_ObjectSet(MkSet(eComponentObject));
    Iter.AddFilter_LayerSet(AllLayers);
    Iter.AddFilter_Method(eProcessAll);
    Prim = Iter.FirstPCBObject;
    while (Prim != null) {
        pcb.modules.push(parseComponent(Prim));
        Prim = Iter.NextPCBObject;
    }
    pcb.board.BoardIterator_Destroy(Iter);

    // parse freepads , all free pads mounted to a footprintNoBom to be rendered
    var footprintNoBom = {};
    footprintNoBom["bbox"] = {"pos": [0, 0], "relpos": [0, 0], "size": [0, 0], "angle": 0};
    footprintNoBom["center"] = [0, 0];
    footprintNoBom["ref"] = "";
    footprintNoBom["layer"] = "F";
    footprintNoBom["drawings"] = [];
    footprintNoBom["pads"] = [];

    Iter = pcb.board.BoardIterator_Create; 
    Iter.AddFilter_ObjectSet(MkSet(ePadObject, eViaObject));
    Iter.AddFilter_LayerSet(AllLayers);
    Iter.AddFilter_Method(eProcessAll);
    Prim = Iter.FirstPCBObject;
    while (Prim != null) {
        if (Prim.IsFreePrimitive) {
            switch (Prim.ObjectId) {
                case ePadObject:
                    footprintNoBom.pads = footprintNoBom.pads.concat(parsePad(Prim));
                    break;
                case eViaObject:
                    if (config.include.vias) {
                        footprintNoBom.pads = footprintNoBom.pads.concat(parseVia(Prim));
                    }
                    break;
                default:
            }
        }
        Prim = Iter.NextPCBObject;
    }
    pcb.board.BoardIterator_Destroy(Iter);

    pcb.modules = sortModules(pcb.modules);

    var kk = pcb.modules.length;
    pcb.pcbdata["footprints"] = [];
    for (var n = 0; n < kk; n++) {
        pcb.pcbdata["footprints"].push(pcb.modules[n].footprint);
    }
    pcb.pcbdata.footprints.push(footprintNoBom);

    // parse_drawings
    var drawings = [];
    Iter = pcb.board.BoardIterator_Create;
    Iter.AddFilter_ObjectSet(MkSet(eTextObject, eTrackObject, eArcObject, eFillobject, eRegionObject));
    Iter.AddFilter_LayerSet(MkSet(pcb.Layers.TOP_OVERLAY_LAYER, pcb.Layers.BOT_OVERLAY_LAYER));
    Iter.AddFilter_Method(eProcessAll);
    Prim = Iter.FirstPCBObject;
    while (Prim != null) {
        switch (Prim.ObjectId) {
            case eTextObject:
                pcb.texts.push(parseText(Prim));
                break;
            case eTrackObject:
                pcb.tracks.push(parseTrack(Prim));
                break;
            case eArcObject:
                pcb.arcs.push(parseArc(Prim));
                break;
            case eFillobject:
                pcb.fills.push(parseFill(Prim));
                break;
            case eRegionObject:
                pcb.regions.push(parseRegion(Prim));
                break;                  
            default:
        }
        Prim = Iter.NextPCBObject;
    }
    pcb.board.BoardIterator_Destroy(Iter);

    drawings = drawings.concat(pcb.texts, pcb.tracks, pcb.arcs, pcb.fills, pcb.regions);
    pcb.pcbdata["silkscreen"] = parseDrawingsOnLayers(drawings, pcb.Layers.TOP_OVERLAY_LAYER, pcb.Layers.BOT_OVERLAY_LAYER);
    // pcb.pcbdata["fabrication"] = parseDrawingsOnLayers(drawings, pcb.Layers.TOP_DIMENSIONS_LAYER, pcb.Layers.BOT_DIMENSIONS_LAYER);
    pcb.pcbdata["fabrication"] = {
        "F": [],
        "B": []
    };
    
    // ---------------------------------------------------------------------
    // Inner copper layers.
    //
    // The classic render only knows two faces, so every mid layer/plane used to
    // be dropped on the floor here. Collect them as an extra list instead, one
    // entry per layer, for the page to sandwich between the faces.
    //
    // Deliberately separate from the face pass above: this whole area is
    // wrapped in guards so a board that has no inner copper - or an Altium build
    // that answers none of the layer probes - still exports exactly as before.
    // ---------------------------------------------------------------------

    // Candidate inner copper layer ids. The enum is tried first because it does
    // not care about the UI language; the string probe is the fallback for
    // builds where this particular constant set is missing.
    function innerCopperCandidates() {
        var list = [];
        var probe;
        probe = [
            ["MidLayer1", 0], ["MidLayer2", 0], ["MidLayer3", 0], ["MidLayer4", 0],
            ["MidLayer5", 0], ["MidLayer6", 0], ["MidLayer7", 0], ["MidLayer8", 0],
            ["MidLayer9", 0], ["MidLayer10", 0], ["MidLayer11", 0], ["MidLayer12", 0],
            ["MidLayer13", 0], ["MidLayer14", 0], ["MidLayer15", 0], ["MidLayer16", 0],
            ["Plane1", 0], ["Plane2", 0], ["Plane3", 0], ["Plane4", 0],
            ["Plane5", 0], ["Plane6", 0], ["Plane7", 0], ["Plane8", 0]
        ];
        // eMidLayer1..16 / eInternalPlane1..8 - unknown identifiers throw at run
        // time here, so each one is probed on its own.
        var ids = [];
        try { ids.push(eMidLayer1); } catch (e) { ids.push(null); }
        try { ids.push(eMidLayer2); } catch (e) { ids.push(null); }
        try { ids.push(eMidLayer3); } catch (e) { ids.push(null); }
        try { ids.push(eMidLayer4); } catch (e) { ids.push(null); }
        try { ids.push(eMidLayer5); } catch (e) { ids.push(null); }
        try { ids.push(eMidLayer6); } catch (e) { ids.push(null); }
        try { ids.push(eMidLayer7); } catch (e) { ids.push(null); }
        try { ids.push(eMidLayer8); } catch (e) { ids.push(null); }
        try { ids.push(eMidLayer9); } catch (e) { ids.push(null); }
        try { ids.push(eMidLayer10); } catch (e) { ids.push(null); }
        try { ids.push(eMidLayer11); } catch (e) { ids.push(null); }
        try { ids.push(eMidLayer12); } catch (e) { ids.push(null); }
        try { ids.push(eMidLayer13); } catch (e) { ids.push(null); }
        try { ids.push(eMidLayer14); } catch (e) { ids.push(null); }
        try { ids.push(eMidLayer15); } catch (e) { ids.push(null); }
        try { ids.push(eMidLayer16); } catch (e) { ids.push(null); }
        try { ids.push(eInternalPlane1); } catch (e) { ids.push(null); }
        try { ids.push(eInternalPlane2); } catch (e) { ids.push(null); }
        try { ids.push(eInternalPlane3); } catch (e) { ids.push(null); }
        try { ids.push(eInternalPlane4); } catch (e) { ids.push(null); }
        try { ids.push(eInternalPlane5); } catch (e) { ids.push(null); }
        try { ids.push(eInternalPlane6); } catch (e) { ids.push(null); }
        try { ids.push(eInternalPlane7); } catch (e) { ids.push(null); }
        try { ids.push(eInternalPlane8); } catch (e) { ids.push(null); }
        for (var i = 0; i < ids.length; i++) {
            if (ids[i] === null || ids[i] === undefined) { continue; }
            if (ids[i] == eTopLayer || ids[i] == eBottomLayer) { continue; }
            list.push({ id: ids[i], name: probe[i][0] });
        }
        if (list.length == 0) {
            for (var n = 1; n <= 16; n++) {
                try {
                    var mid = String2Layer("Mid Layer " + n);
                    if (mid !== undefined && mid !== null && mid != eNoLayer) {
                        list.push({ id: mid, name: "MidLayer" + n });
                    }
                } catch (e) {}
            }
            for (var k = 1; k <= 8; k++) {
                try {
                    var pl = String2Layer("Internal Plane " + k);
                    if (pl !== undefined && pl !== null && pl != eNoLayer) {
                        list.push({ id: pl, name: "Plane" + k });
                    }
                } catch (e) {}
            }
        }
        return list;
    }

    // One board walk with no layer filter, bucketed by layer id. Only ids that
    // are already known to be copper are kept, so silkscreen/paste/mechanical
    // never leak into a layer view.
    function collectCopperByLayer() {
        var buckets = {};
        var Iter = pcb.board.BoardIterator_Create;
        if (config.include.tracks && !config.include.polys) {
            Iter.AddFilter_ObjectSet(MkSet(eTrackObject, eArcObject));
        } else if (config.include.polys && !config.include.tracks) {
            Iter.AddFilter_ObjectSet(MkSet(eFillobject, eRegionObject, ePolyObject));
        } else if (config.include.polys && config.include.tracks) {
            Iter.AddFilter_ObjectSet(MkSet(eFillobject, eRegionObject, ePolyObject, eArcObject, eTrackObject));
        } else {
            // No face-copper requested: this walk can still run for the inner
            // layers alone (include.inner), so it needs the full object set.
            Iter.AddFilter_ObjectSet(MkSet(eTrackObject, eArcObject, eFillobject, eRegionObject, ePolyObject));
        }
        Iter.AddFilter_Method(eProcessAll);
        Iter.AddFilter_LayerSet(AllLayers);
        var Prim = Iter.FirstPCBObject;
        while (Prim != null) {
            if (!(Prim.InComponent || Prim.InPolygon)) {
                var key = String(Prim.Layer);
                if (!buckets[key]) { buckets[key] = { tracks: [], polygons: [] }; }
                switch (Prim.ObjectId) {
                    case eTrackObject:
                        buckets[key].tracks.push(parseTrack(Prim));
                        break;
                    case eArcObject:
                        if (Prim.IsFreePrimitive) {
                            buckets[key].tracks = buckets[key].tracks.concat(parseArc(Prim));
                        }
                        break;
                    case eFillobject:
                        buckets[key].polygons.push(parseFill(Prim));
                        break;
                    case eRegionObject:
                        buckets[key].polygons.push(parseRegion(Prim));
                        break;
                    case ePolyObject:
                        if ((Prim.PolyHatchStyle != ePolySolid) && (!config.include.polyHatched)) {
                            break;
                        }
                        buckets[key].polygons = buckets[key].polygons.concat(parsePoly(Prim));
                        break;
                    default:
                }
            }
            Prim = Iter.NextPCBObject;
        }
        pcb.board.BoardIterator_Destroy(Iter);
        return buckets;
    }

    // Fallback for Altium builds where skipping the layer filter yields nothing:
    // one short filtered walk per candidate layer. Slower, only used if needed.
    function collectCopperOnLayer(layerId) {
        var out = { tracks: [], polygons: [] };
        var Iter = pcb.board.BoardIterator_Create;
        if (config.include.tracks && !config.include.polys) {
            Iter.AddFilter_ObjectSet(MkSet(eTrackObject, eArcObject));
        } else if (config.include.polys && !config.include.tracks) {
            Iter.AddFilter_ObjectSet(MkSet(eFillobject, eRegionObject, ePolyObject));
        } else if (config.include.polys && config.include.tracks) {
            Iter.AddFilter_ObjectSet(MkSet(eFillobject, eRegionObject, ePolyObject, eArcObject, eTrackObject));
        } else {
            // Same reason as collectCopperByLayer: the fallback walk must also
            // serve an inner-only export.
            Iter.AddFilter_ObjectSet(MkSet(eTrackObject, eArcObject, eFillobject, eRegionObject, ePolyObject));
        }
        Iter.AddFilter_LayerSet(MkSet(layerId));
        Iter.AddFilter_Method(eProcessAll);
        var Prim = Iter.FirstPCBObject;
        while (Prim != null) {
            if (!(Prim.InComponent || Prim.InPolygon)) {
                switch (Prim.ObjectId) {
                    case eTrackObject:
                        out.tracks.push(parseTrack(Prim));
                        break;
                    case eArcObject:
                        if (Prim.IsFreePrimitive) {
                            out.tracks = out.tracks.concat(parseArc(Prim));
                        }
                        break;
                    case eFillobject:
                        out.polygons.push(parseFill(Prim));
                        break;
                    case eRegionObject:
                        out.polygons.push(parseRegion(Prim));
                        break;
                    case ePolyObject:
                        if ((Prim.PolyHatchStyle != ePolySolid) && (!config.include.polyHatched)) {
                            break;
                        }
                        out.polygons = out.polygons.concat(parsePoly(Prim));
                        break;
                    default:
                }
            }
            Prim = Iter.NextPCBObject;
        }
        pcb.board.BoardIterator_Destroy(Iter);
        return out;
    }

    // Primitives such as keepouts and board cutouts come back from the region
    // parser as bare objects: no outline, nothing drawable. Shipping them once
    // broke the whole page render, so they are dropped at the source. Written
    // as a plain loop because these files must stay ES3.
    function keepUsable(list, kind) {
        var keep = [];
        for (var i = 0; i < list.length; i++) {
            var d = list[i];
            if (!d) { continue; }
            if (kind == "zone") {
                if (d.svgpath === undefined && d.polygons === undefined) { continue; }
            } else {
                if (d.start === undefined || d.end === undefined) { continue; }
            }
            keep.push(d);
        }
        return keep;
    }

    function layerIdOf(layerObj) {
        try {
            if (layerObj && layerObj.LayerID !== undefined) { return layerObj.LayerID; }
        } catch (e) {}
        return undefined;
    }

    // Vias are cross-layer by nature, so the copper walk above cannot bucket
    // them. They are collected once with their layer span, and the page decides
    // which inner layers each one reaches.
    function collectVias() {
        var out = [];
        if (!config.include.vias) { return out; }
        var Iter = pcb.board.BoardIterator_Create;
        Iter.AddFilter_ObjectSet(MkSet(eViaObject));
        Iter.AddFilter_LayerSet(AllLayers);
        Iter.AddFilter_Method(eProcessAll);
        var Prim = Iter.FirstPCBObject;
        while (Prim != null) {
            try {
                var parsed = parseVia(Prim);
                if (parsed && parsed.length) {
                    var v = parsed[0];
                    v["start"] = layerIdOf(Prim.StartLayer);
                    v["stop"] = layerIdOf(Prim.StopLayer);
                    if (v["start"] !== undefined && v["stop"] !== undefined &&
                        ((v["start"] == eTopLayer && v["stop"] == eBottomLayer) ||
                         (v["start"] == eBottomLayer && v["stop"] == eTopLayer))) {
                        v["through"] = true;
                    }
                    // A via always has a drill, even when the parsed pad came back
                    // as "smd" (blind/buried), so the page can punch the hole.
                    try {
                        if (v["drillsize"] === undefined) {
                            var hole = CoordToMMs(Prim.HoleSize).round();
                            v["drillsize"] = [hole, hole];
                            v["drillshape"] = "circle";
                        }
                    } catch (e) {}
                    out.push(v);
                }
            } catch (e) {}
            Prim = Iter.NextPCBObject;
        }
        pcb.board.BoardIterator_Destroy(Iter);
        return out;
    }

    function exportInnerLayers() {
        try {
            // include.inner gates the inner-layer sweep; the via collection
            // below stays on its own switch, so a board that only wants vias
            // still gets them (pcbdata.vias is the page's primary via source).
            var cand = config.include.inner ? innerCopperCandidates() : [];
            var buckets = null;
            if (cand.length > 0) {
                try { buckets = collectCopperByLayer(); } catch (e) { buckets = null; }
            }
            var usedFallback = false;
            var inners = [];
            for (var i = 0; i < cand.length; i++) {
                var tracks = null;
                var zones = null;
                try {
                    var key = String(cand[i].id);
                    if (buckets && buckets[key]) {
                        tracks = buckets[key].tracks;
                        zones = buckets[key].polygons;
                    } else {
                        var one = collectCopperOnLayer(cand[i].id);
                        usedFallback = true;
                        tracks = one.tracks;
                        zones = one.polygons;
                    }
                } catch (e) {
                    tracks = null;
                    zones = null;
                }
                if (!tracks || !zones) { continue; }
                tracks = keepUsable(tracks, "track");
                zones = keepUsable(zones, "zone");
                if (tracks.length == 0 && zones.length == 0) { continue; }
                // Same tail-first order the face arrays use, so painting is
                // identical whichever path produced the layer.
                inners.push({
                    name: cand[i].name,
                    layerid: cand[i].id,
                    tracks: tracks.reverse(),
                    zones: zones.reverse()
                });
            }
            var vias = [];
            try { vias = collectVias(); } catch (e) { vias = []; }
            if (vias.length) { pcb.pcbdata["vias"] = vias; }
            if (inners.length) {
                pcb.pcbdata["inners"] = inners;
                pcb.pcbdata["innersdiag"] = inners.length + " layer(s)" +
                    (usedFallback ? " (per-layer walk)" : " (single walk)") +
                    ", " + vias.length + " via(s)";
            } else if (config.include.inner) {
                pcb.pcbdata["innersdiag"] = (cand.length == 0)
                    ? "no inner layer id resolved"
                    : "no inner copper on " + cand.length + " candidate layer(s)";
            }
        } catch (e) {
            pcb.pcbdata["innersdiag"] = "inner export failed: " + (e.description || String(e));
        }
    }

    // rough handling tracks and zones, not done
    Iter = pcb.board.BoardIterator_Create;

    if (config.include.tracks && !config.include.polys) {
        Iter.AddFilter_ObjectSet(MkSet(eTrackObject, eArcObject));
    } else if (config.include.polys && !config.include.tracks) {
        Iter.AddFilter_ObjectSet(MkSet(eFillobject, eRegionObject, ePolyObject));
    } else if (config.include.polys && config.include.tracks) {
        Iter.AddFilter_ObjectSet(MkSet(eFillobject, eRegionObject, ePolyObject, eArcObject, eTrackObject));
    } else {
        Iter.AddFilter_ObjectSet(MkSet());
    }

    Iter.AddFilter_LayerSet(MkSet(eTopLayer, eBottomLayer));
    Iter.AddFilter_Method(eProcessAll);
    var draws = {};
    draws["tracks"] = [];
    draws["polygons"] = [];
    draws["arcs"] = [];
    Prim = Iter.FirstPCBObject;
    while (Prim != null) {
        if (Prim.InComponent || Prim.InPolygon) {
            Prim = Iter.NextPCBObject;
            continue; 
        }

        switch (Prim.ObjectId) {
            case eTrackObject:
                draws.tracks.push(parseTrack(Prim));
                break;
            case eArcObject:
                if (Prim.IsFreePrimitive) {
                    draws.tracks = draws.tracks.concat(parseArc(Prim));
                } else {
                    // draws.arcs.push(parseArc(Prim));
                }
                break;
            case eFillobject:
                draws.polygons.push(parseFill(Prim));
                break;
            case eRegionObject:
                draws.polygons.push(parseRegion(Prim));
                break;    
            case ePolyObject:
                if ((Prim.PolyHatchStyle != ePolySolid) && (!config.include.polyHatched)) {
                    break; 
                }
                draws.polygons = draws.polygons.concat(parsePoly(Prim));
                break;                   
            default:
        }    
        Prim = Iter.NextPCBObject;
    }
    pcb.board.BoardIterator_Destroy(Iter);

    if (config.include.tracks || config.include.polys || config.include.inner) {
        if (config.include.tracks || config.include.polys) {
            pcb.pcbdata["tracks"] = parseDrawingsOnLayers(draws.tracks, eTopLayer, eBottomLayer);
            pcb.pcbdata["zones"] = parseDrawingsOnLayers(draws.polygons, eTopLayer, eBottomLayer);
        }
        exportInnerLayers();
    }

    var str_text = [];
    for (var i = pcb.texts.length - 1; i >= 0; i--) {
        str_text.push(pcb.texts[i].text);
    }
    pcb.pcbdata.font_data = parseTextToNewStrokeFont(str_text.join(""));

    PCBServer.PostProcess;

    pcb.pcbdata["nets"] = [];
    if (config.include.nets) {
        for (var nm in pcb.netmap) {
            pcb.pcbdata["nets"][pcb.netmap[nm]] = nm;
        }
    }


    return pcb;
} 
// var t0 = new Date().getTime();
// var pcb = parsePcb();
