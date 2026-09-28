
function getConfig(non) {
	var iniFileName = CURRENT_PATH + "config.ini";
	var config = {};
	if (FileExists(iniFileName)) {
		var iniFile = TIniFile.Create(iniFileName);
		config.PcbOutlineMech1 = iniFile.ReadBool("General", "PcbOutlineMech1", false);
		config["htmlConfig"] = {
			"redraw_on_drag": iniFile.ReadBool("HtmlDefaults", "ContinuousRedrawOnDrag", true),
			"bom_view": "left-right", 
			"layer_view": "FB",
			"show_silkscreen": iniFile.ReadBool("HtmlDefaults", "ShowSilkscreen", true),
			"checkboxes": iniFile.ReadString("HtmlDefaults", "HtmlCheckboxes", "Sourced"),
			"dark_mode": iniFile.ReadBool("HtmlDefaults", "DarkMode", false),
			"highlight_pin1": iniFile.ReadBool("HtmlDefaults", "HighlightPin1", false),
			"show_pads": iniFile.ReadBool("HtmlDefaults", "ShowFootprintPads", true),
			"show_fabrication": iniFile.ReadBool("HtmlDefaults", "ShowFabricationLayer", false),
			// Web menu presets carried into the exported page (util.js reads
			// these as first-load defaults; the browser's localStorage wins).
			"show_references": iniFile.ReadBool("HtmlDefaults", "ShowReferences", true),
			"show_values": iniFile.ReadBool("HtmlDefaults", "ShowValues", true),
			"show_native_labels": iniFile.ReadBool("HtmlDefaults", "ShowNativeLabels", true),
			"show_tracks": iniFile.ReadBool("HtmlDefaults", "ShowTracks", true),
			"show_zones": iniFile.ReadBool("HtmlDefaults", "ShowZones", true),
			"show_net_names": iniFile.ReadBool("HtmlDefaults", "ShowNetNames", true),
			"show_vias": iniFile.ReadBool("HtmlDefaults", "ShowVias", true),
			"show_nobom": iniFile.ReadBool("HtmlDefaults", "ShowNoBom", false),
			"extra_fields": [], 
			"board_rotation": iniFile.ReadInteger("HtmlDefaults", "PcbRotation", 36)
		};
		config["include"] = {
			"vias": iniFile.ReadBool("General", "IncludeVias", false),
			// Nets feed pad/track net labels and the PCB<->schematic highlight,
			// so they stay on unless explicitly switched off.
			"nets": iniFile.ReadBool("General", "IncludeNets", true),
			"polyHatched": false,  // a group of tracks and arcs( arc to tracks), very slow.
			// Inner copper layers (MidLayer1..16 / InternalPlane1..8). Off keeps
			// the export smaller and faster on 2-layer boards.
			"inner": iniFile.ReadBool("General", "IncludeInner", true),
			// Reading the schematic costs an extra pass over the project and
			// opens every .SchDoc, so it can be switched off. On by default: a
			// failed read degrades to "no schematic pane", never to a failed
			// export, so there is little reason to disable it up front.
			"schematic": iniFile.ReadBool("General", "IncludeSchematic", true)
		};
		if (iniFile.ReadBool("General", "IncludeTracksAndSolidPolygons", false)) {
			config["include"]["tracks"] = true;
			config["include"]["polys"] = true;
		} else {
			config["include"]["tracks"] = false;
			config["include"]["polys"] = false;
		}

		config["bomFilter"] = {
			"skipempty": iniFile.ReadBool("General", "BlacklistEmpty", true),
			"skiponepad": iniFile.ReadBool("General", "Blacklist1Pad", true),
			"skipth": iniFile.ReadBool("General", "BlacklistTh", false),
			// "Standard (No BOM)" / "Net Tie (No BOM)" components are hidden from AD's
			// own Bill of Materials dialog, so hide them here too by default.
			"skipnobom": iniFile.ReadBool("General", "BlacklistNoBOM", true)
		}

		iniFile.Free;
	} else {
		config.PcbOutlineMech1 = false;
		config["htmlConfig"] = {
			"redraw_on_drag": true,
			"bom_view": "left-right",
			"layer_view": "FB",
			"show_silkscreen": true,
			"checkboxes": "Sourced",
			"dark_mode": false,
			"highlight_pin1": false,
			"show_pads": true,
			"show_fabrication": false,
			"show_references": true,
			"show_values": true,
			"show_native_labels": true,
			"show_tracks": true,
			"show_zones": true,
			"show_net_names": true,
			"show_vias": true,
			"show_nobom": false,
			"extra_fields": [],
			// "extra_fields": ["PartNum"],   //add ibom html column
			"board_rotation": 0
		};

		config["include"] = {
			"tracks": false, // not support arc for now, so parse one arc to a few tracks. slow.
			"vias": false,  // so many objects in pcbdata slow down the speed of generating bom.
			"nets": true,
			"polys": false,
			"polyHatched": false,  // a group of tracks and arcs( arc to tracks), very slow.
			"inner": true,
			"schematic": true
		};

		config["bomFilter"] = {
			"skipempty": true,
			"skiponepad": true,
			"skipth": false,
			"skipnobom": true
		}
	}
	return config;
} 

