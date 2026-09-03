# Customization Guide: Reinforcement Coordinate & Bar Dia Paste Enhancer

This folder contains user-defined scripts, extensions, and external tools designed to enhance the **"Customize reinforcement coordinate and bar dia Paste"** feature without modifying any core application or repository code.

---

## Behavior Overview

### Problem Addressed
Standard paste tools often show static or generic field prompts (e.g. `X, Y, Dia`) without displaying actual values already present in the active drawing, document, or dataset.

### Desired Solution
When opening the **Customize Paste** option, the customization script inspects the active document, drawing, or sheet in **real time** to extract:
1. **All existing bar coordinates** (X, Y, Z or bar-centre fields).
2. **All existing bar diameters** (or rebar sizes present in the active model/sheet).

The user can view, filter, select, and paste these live values directly into target locations or buffer fields without manual typing.

---

## Available Customization Mechanisms

| Mechanism / Extension | Target Environment | File Location | Key Capabilities |
| :--- | :--- | :--- | :--- |
| **AutoLISP Extension** | AutoCAD / BricsCAD / ZWCAD | `autolisp/customize_rebar_paste.lsp` | Real-time drawing entity scan, attribute inspection (`DIA`, `BAR_SIZE`), DCL selection palette |
| **Python API Script** | Revit / Standalone CAD API / GUI | `python/rebar_paste_customizer.py` | Real-time dataset parsing, interactive Tkinter GUI table with multi-select coordinate & diameter formatting |
| **VBA Macro Module** | Excel BBS / AutoCAD VBA | `vba/modRebarCustomizePaste.bas` | Live worksheet/drawing scan, deduplication, automated paste buffer builder |
| **Browser UserScript** | Web Application UI | `userscript/rebar-customize-paste-enhancer.user.js` | DOM MutationObserver, live active document DOM picker injected directly into the modal UI |

---

## Installation & Execution Instructions

### 1. AutoLISP (`customize_rebar_paste.lsp`)
1. Open AutoCAD / BricsCAD / ZWCAD.
2. Type `APPLOAD` and select `customization/autolisp/customize_rebar_paste.lsp`.
3. Type `CustomizeRebarPaste` in the command prompt.
4. The script scans all rebar entities, attributes, and circles in real-time and prints/displays all existing X, Y, Z coordinates and bar diameters for immediate pasting.

### 2. Python Script (`rebar_paste_customizer.py`)
1. Ensure Python 3.x is installed.
2. Run the customization tool:
   ```bash
   python3 customization/python/rebar_paste_customizer.py
   ```
3. The interactive window displays all live coordinates and diameters from the active document dataset with instant clipboard formatting.

### 3. VBA Module (`modRebarCustomizePaste.bas`)
1. Open Microsoft Excel or AutoCAD VBA Editor (`Alt + F11`).
2. Go to **File > Import File...** and select `customization/vba/modRebarCustomizePaste.bas`.
3. Run `ShowCustomizeRebarPasteDialog`.

### 4. Browser UserScript (`rebar-customize-paste-enhancer.user.js`)
1. Install Tampermonkey or Violentmonkey extension in Chrome / Firefox / Edge.
2. Create a new user script and paste the contents of `customization/userscript/rebar-customize-paste-enhancer.user.js`.
3. Open the web app and click **Paste**. The modal will now include a **Live Values Picker** listing all existing document coordinates and bar diameters in real time.

---

## Compliance with Constraints
- **Zero Core Code Modifications**: The core application files in `src/` remain completely untouched.
- **Real-Time Data Reading**: All scripts query the active drawing/document/DOM at runtime when the dialog/command is invoked.
