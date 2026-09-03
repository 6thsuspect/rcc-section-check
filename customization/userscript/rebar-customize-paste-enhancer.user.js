// ==UserScript==
// @name         Customize Reinforcement Coordinate & Bar Dia Paste Enhancer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Enhances the Customize Paste dialog in the RCC Section Check web app by reading all existing coordinates (X, Y) and bar diameters present in the active document and displaying them for direct selection.
// @match        http://*/*
// @match        https://*/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    console.log('[RebarPasteEnhancer] Customization Userscript loaded.');

    /**
     * Extracts existing reinforcement coordinates and bar diameters from the page DOM in real-time.
     */
    function scanActiveDocumentRebarData() {
        const coords = [];
        const diameters = new Set();

        // 1. Scan active reinforcement table rows
        const rows = document.querySelectorAll('table tbody tr');
        rows.forEach(row => {
            const inputs = row.querySelectorAll('input[type="number"]');
            const select = row.querySelector('select');

            if (inputs.length >= 2) {
                const xVal = parseFloat(inputs[0].value);
                const yVal = parseFloat(inputs[1].value);

                if (!isNaN(xVal) && !isNaN(yVal)) {
                    coords.push({ x: xVal, y: yVal });
                }
            }

            if (select) {
                const diaVal = parseFloat(select.value);
                if (!isNaN(diaVal) && diaVal > 0) {
                    diameters.add(diaVal);
                }
            }
        });

        // Default standard diameters if none found in table yet
        if (diameters.size === 0) {
            [8, 10, 12, 16, 20, 25, 28, 32, 36, 40].forEach(d => diameters.add(d));
        }

        return {
            coords: coords,
            diameters: Array.from(diameters).sort((a, b) => a - b)
        };
    }

    /**
     * Enhances the "Paste Customized Reinforcement" dialog when opened.
     */
    function enhancePasteDialog(dialogElem) {
        if (dialogElem.querySelector('.rebar-enhancer-panel')) return; // Already injected

        const data = scanActiveDocumentRebarData();

        // Build injected selector panel
        const panel = document.createElement('div');
        panel.className = 'rebar-enhancer-panel';
        panel.style.cssText = `
            margin-top: 10px;
            padding: 10px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 6px;
            font-size: 11.5px;
        `;

        let html = `
            <div style="font-weight: bold; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; color: #38bdf8;">
                Active Document Live Values Picker
            </div>
            <div style="display: flex; gap: 10px; margin-bottom: 8px;">
                <div style="flex: 1;">
                    <label style="display: block; margin-bottom: 2px; color: #94a3b8;">Existing Coordinates (${data.coords.length}):</label>
                    <select id="enhancer-coord-select" multiple style="width: 100%; height: 70px; font-family: monospace; font-size: 11px; background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 4px; padding: 2px;">
                        ${data.coords.map((c, i) => `<option value="${c.x},${c.y}">#${i + 1}: X=${c.x}, Y=${c.y}</option>`).join('')}
                    </select>
                </div>
                <div style="width: 110px;">
                    <label style="display: block; margin-bottom: 2px; color: #94a3b8;">Bar Diameter:</label>
                    <select id="enhancer-dia-select" style="width: 100%; font-family: monospace; font-size: 11px; background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 4px; padding: 4px;">
                        ${data.diameters.map(d => `<option value="${d}">⌀ ${d} mm</option>`).join('')}
                    </select>
                </div>
            </div>
            <button type="button" id="enhancer-insert-btn" style="
                background: #0284c7; color: white; border: none; padding: 4px 10px;
                border-radius: 4px; font-weight: 600; font-size: 11px; cursor: pointer;
            ">
                + Insert Selected Values into Paste Buffer
            </button>
        `;

        panel.innerHTML = html;

        const textarea = dialogElem.querySelector('textarea');
        if (textarea && textarea.parentNode) {
            textarea.parentNode.insertBefore(panel, textarea.nextSibling);

            // Handle insert button click
            panel.querySelector('#enhancer-insert-btn').addEventListener('click', () => {
                const coordSelect = panel.querySelector('#enhancer-coord-select');
                const diaSelect = panel.querySelector('#enhancer-dia-select');
                const selectedDia = diaSelect.value || '20';

                const selectedCoords = Array.from(coordSelect.selectedOptions).map(opt => opt.value);

                if (selectedCoords.length === 0) {
                    alert('Please select at least one coordinate from the list above.');
                    return;
                }

                const insertedLines = selectedCoords.map(coord => `${coord},${selectedDia}`).join('\n');

                if (textarea.value.trim().length > 0) {
                    textarea.value += '\n' + insertedLines;
                } else {
                    textarea.value = insertedLines;
                }

                // Trigger input event so React state updates
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }
    }

    // Observe document for dialog opening
    const observer = new MutationObserver(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="Paste customized reinforcement"]');
        if (dialog) {
            enhancePasteDialog(dialog);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
