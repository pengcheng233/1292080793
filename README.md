# InteractiveBOM Suite V1.0.01

Altium Designer 交互式 BOM / 原理图一站式导出套件。基于
[InteractiveHtmlBomForAD](https://github.com/lianlian33/InteractiveHtmlBomForAD)
（[InteractiveHtmlBom](https://github.com/openscopeproject/InteractiveHtmlBom) 的 AD10 移植版）
深度定制升级，与最初版本相比新增原理图导出、4K 适配、网络名标注、xlsx BOM 等
大量功能，详见《版本更新说明_V1.0.01.md》。

### 安装和使用 Installation and Usage 
 1. 运行一次 Initialize.bat（自动生成 rootPath.js，并拼接出 dist\InteractiveBOMSuite.js）。
 <font color=#00008B>Run Initialize.bat once (generates rootPath.js and builds dist\InteractiveBOMSuite.js).</font>
 2. 用AD打开InteractiveBOMSuite.PrjScr, 打开pcb文件，打开Run Script...窗口，运行main()函数，生成ibom。
 <font color=#00008B>Open InteractiveBOMSuite.PrjScr in AD, open a pcbdoc and open *Run Script...* dialog then run main() function to generate ibom.</font>
 3. 关于脚本安装和运行的细节，请善用搜索...
  <font color=#00008B>For more details about running scripts in AD, please search on Internet...</font>

#### Link to original project for more info.

* [InteractiveHtmlBom](https://github.com/openscopeproject/InteractiveHtmlBom)

### 离线原理图（不依赖 AD 脚本）Offline schematic

`tools/schdoc2html.js` 直接解析 `.SchDoc` 二进制（OLE 复合文档 + 记录流），不经过
AD 脚本引擎，产出可交互原理图页面（复用 `web/schem.js` 渲染器）：

```
node tools/schdoc2html.js                     # 默认 ..\SCH -> PnPout\Schematic.html
node tools/schdoc2html.js --in=<文件或目录> --out=<文件>
```

主 ibom 页面（AD 导出的 BOM+PCB 完整页）如需原理图，用注入器把离线解析结果
替换进页面的 `pcbdata.schem`（绕开「AD 一个会话只编译一次脚本」导致的空原理图）：

```
node tools/inject_schem.js --in=<导出的 ibom 页面> [--schdoc=<文件>] [--out=<文件>]
```

**一键流程（推荐）**：勾选导出对话框 General 页「Include schematic (offline SchDoc)」
后点 GenerateBom——写完页面会自动调用上面的注入器，一步产出带原理图的完整页面。
`--schdoc` 缺省从导出页目录逐级向上找 `.SchDoc`（板目录→工程目录），每找到一个
`.SchDoc` 生成一张原理图页；`--out` 缺省原地写回。
注入后刷新页面，左栏「原理图」开关即可查看。

注入器需要 node.exe，按此顺序自动查找：config.ini `[General]` 的 `NodePath` →
各 Program Files 下的 nodejs → `%USERPROFILE%\.workbuddy\binaries\node\versions\*`。
换新电脑后若仍找不到（报 0x80070002），在 config.ini 的 `[General]` 节加一行
`NodePath=<node.exe 完整路径>` 再重新导出即可（config.ini 是运行时读取的，不用重启 AD）。

导出对话框在 4K/高分屏上偏小时，用 config.ini `[General]` 节的 `PanelScale`
控制面板缩放：`auto`（默认）按显示器物理分辨率自适应（4K→2.0、≥2800→1.5、
其余 1.0）；也可填固定数字（如 1.5、2，1=不缩放，范围 0.5–4）。改完重开
对话框生效；若无变化重启 AD。

支持：元件图形/引脚（含可见位）/导线/网络标号/电源端口/中文(GBK)、同名网络归并、
点击网络高亮、位号参数拖动（localStorage 记忆）。限制：内嵌图片跳过；
GBK 尾字节恰为 `|` 的属性串会解析错该条（样本未遇到）。

