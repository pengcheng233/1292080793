@echo off

@set path=%~dp0
@cd /d %~dp0
@set str=%path:\=\\%
@echo var CURRENT_PATH = "%str%";>rootPath.js

@copy /b rootPath.js+modules-lite\json2.js+modules-lite\lz-string.js+core\config.js+core\newstroke_font.js+ecad\AD10.js+ecad\AD10sch.js+core\ibom.js+tools\inPcb.js dist\InteractiveBOMSuite.js

@copy /b rootPath.js+modules-lite\json2.js+ecad\AD10sch.js+tools\schem_export_main.js dist\SchemExport.js

@rem pause
