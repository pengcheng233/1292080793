# InteractiveBOM Suite

An Altium Designer (AD10) add-on that exports an **interactive BOM** and an
**interactive schematic viewer** straight from your PCB project. It is a heavily
customized, feature-expanded fork of
[InteractiveHtmlBomForAD](https://github.com/lianlian33/InteractiveHtmlBomForAD)
— which itself ports
[InteractiveHtmlBom](https://github.com/openscopeproject/InteractiveHtmlBom)
to Altium Designer 10.

On top of the original, this suite adds schematic export, 4K / HiDPI scaling,
net-name annotation, xlsx BOM export, real-PDF silkscreen export, and more.

> 中文文档见 [README.zh-CN.md](README.zh-CN.md)。

## Features

- **Interactive BOM + PCB viewer** — generated directly from Altium Designer
  through a script project (no external BOM tooling required).
- **Offline schematic viewer** — `tools/schdoc2html.js` parses `.SchDoc`
  binaries (OLE compound document + record streams) **without** the AD script
  engine, producing an interactive schematic page that reuses `web/schem.js`.
- **4K / HiDPI adaptation** — both the export dialog (via `config.ini`
  `PanelScale`) and the exported web page (CSS `zoom` auto-scaling) adapt to
  high-resolution displays.
- **Net highlighting** — click a net in the schematic to highlight it
  everywhere.
- **PDF silkscreen export** — the "Silkscreen" toolbar button writes a real
  PDF (top & bottom layers) via a "Save As" dialog instead of relying on the
  browser print dialog.
- **xlsx BOM export** — zero-dependency, hand-written spreadsheet output.

## Installation & Usage

1. Unzip to any folder and **run `Initialize.bat` once**. It generates
   `rootPath.js` and builds `dist\InteractiveBOMSuite.js`.
2. Open **`InteractiveBOMSuite.PrjScr`** in Altium Designer, open your
   `.PcbDoc`, open the *Run Script...* dialog, and run **`main()`**
   (or run `dist\mainWin.js` for the GUI window).
3. To include the schematic, check **"Include schematic (offline SchDoc)"**
   in the export dialog. Output goes to `<PCB dir>\PnPout\<board>.html`.
4. After updating the AD-side scripts, **restart Altium Designer**; after
   updating only the `web/` page files, just re-export the HTML once.

### Offline schematic (no AD script needed)

```bash
node tools/schdoc2html.js                 # default: ..\SCH -> PnPout\Schematic.html
node tools/schdoc2html.js --in=<file|dir> --out=<file>
```

To inject the offline schematic into a previously exported ibom page
(bypasses the empty-schematic issue caused by AD compiling scripts only once
per session):

```bash
node tools/inject_schem.js --in=<exported ibom page> [--schdoc=<file>] [--out=<file>]
```

The injector locates `node.exe` automatically: `config.ini` `[General]`
`NodePath` → `nodejs` under the various `Program Files` →
`%USERPROFILE%\.workbuddy\binaries\node\versions\*`. If it still can't find
Node after switching machines (error `0x80070002`), add
`NodePath=<full path to node.exe>` to the `[General]` section of `config.ini`
and re-export — `config.ini` is read at runtime, so no AD restart is needed.

## Configuration (`config.ini`)

| Key | Meaning |
|---|---|
| `[General] NodePath` | Explicit path to `node.exe` (used by the schematic injector). |
| `[General] PanelScale` | Export-dialog scaling. `auto` (default) adapts to the physical display resolution: 4K → 2.0, ≥2800 px → 1.5, else 1.0. Or a fixed number (0.5–4, where 1 = no scaling). Takes effect when the dialog reopens; restart AD if unchanged. |

## Versions

- **V1.0.00** — initial public release of the renamed suite (schematic +
  copper-net customization). Based on InteractiveHtmlBomForAD (AD10 port of
  InteractiveHtmlBom).
- **V1.0.01** — patch release: the "Silkscreen" button now exports a real
  PDF instead of using the browser print dialog. No new features; only
  `web/util.js`, `web/ibom.js`, and the README changed.

Full changelogs (Chinese):
[版本更新说明_V1.0.01.md](版本更新说明_V1.0.01.md) ·
[版本更新说明_V1.0.00.md](版本更新说明_V1.0.00.md).

Git tags `v1.0.00` and `v1.0.01` mark each release; `main` carries the
latest (V1.0.01).

## Project structure

| Path | Purpose |
|---|---|
| `InteractiveBOMSuite.PrjScr` / `SchemExport.PrjScr` | Altium script projects |
| `Initialize.bat` / `UnInitialize.bat` | Setup / teardown (generates `rootPath.js`, builds `dist`) |
| `dist/` | Built/bundled output consumed by Altium Designer |
| `core/`, `ecad/`, `tools/` | BOM logic, ecad parsing, and schematic tooling |
| `web/` | The interactive viewer front-end (HTML / CSS / JS) |
| `modules-lite/` | Vendored lightweight modules (`json2`, `lz-string`) |
| `PnPout/Schematic.html` | Sample / placeholder schematic output |
| `config.ini` | Runtime configuration (Node path, panel scale) |

## Credits

- Based on [InteractiveHtmlBomForAD](https://github.com/lianlian33/InteractiveHtmlBomForAD)
  by lianlian33, which ports
  [InteractiveHtmlBom](https://github.com/openscopeproject/InteractiveHtmlBom)
  (openscopeproject) to Altium Designer 10.
- License: see the upstream project for the original license terms.
