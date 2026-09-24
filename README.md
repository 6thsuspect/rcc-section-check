# RCC Section Check

Biaxial **P–Mx–My interaction analysis** of arbitrary reinforced-concrete sections, with
clause-level compliance to **IS 456:2000**, **IRC:112-2020** and the **IRS Concrete
Bridge Code (1997)**.

The user provides a factored axial load and bending moments about two perpendicular
axes; the section is defined either by **custom boundary coordinates** (polygon vertices,
with optional voids) plus **rebar coordinates** (x, y, ⌀ per bar), or from a predefined
library (rectangle, circle, T, I, L, box, hollow circle). Nominal **clear cover is entered
independently for each concrete face** — bottom / right / top / left, plus the four faces of
any internal void — and every bar layout, check and report entry honours that face's value. The engine generates the full
interaction surface by strain-compatibility analysis of the actual geometry, draws the
P–M diagram and the Mx–My capacity contour with every load case overlaid, and reports a
utilisation ratio plus the selected code's clause checks.

Two top-bar modules share the same section, materials and reinforcement: the **ULS Check**
(ultimate P–Mx–My interaction and capacity) and the **SLS Check** (serviceability limits — the
IS 456:2000 Annex C working-stress method for concrete σcbc and reinforcement σst / σsc against
the cracked transformed-section stresses, **plus a crack-width check** by the method of the
selected code, each with PASS/FAIL per case). **Load cases are entered separately for each
check** — the ULS panel holds factored actions, the SLS panel holds characteristic (service)
actions for the stress check, and the crack-width check has its own service load-case list; the
three lists edit independently and switching tabs changes none of them.

### Crack-width check (SLS tab)
The crack-width check reuses the cracked-section tension-steel stress σs, neutral-axis depth and
effective depth from the SLS stress solve, and applies the method of the selected code:
- **IS 456:2000** — Annex F surface formula `w = 3·a_cr·ε_m / (1 + 2(a_cr − c_min)/(h − x))`,
  permissible width by exposure (Cl 35.3.2: 0.3 / 0.2 / 0.1 mm).
- **IRC:112-2020** — Cl 12.3.4 (EN 1992-2) `w_k = s_r,max·(ε_sm − ε_cm)`, Table 12.1 limits.
- **IRS Concrete Bridge Code 1997** — Cl 15.9.8.2 (BS 8110-2 basis), Table 10 limits.
Only the exposure class and load duration are entered; section, cover, bar size and depth come
from the shared inputs. Crack width is evaluated on its **own** characteristic (service) load-case
list (Load Cases panel under the crack-width heading), independent of the factored ULS list and
the SLS stress list. The result, permissible width, utilisation and clause update automatically.

## Stack

Vite · React 19 · TypeScript · Tailwind CSS v4 · Vitest

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine regression suite (verified worked-example values)
npm run build      # type-check + production build
```

## Layout

```
docs/                     Full specification (12 chapters, clause-verified)
src/engine/               Code-agnostic analysis kernel
  types.ts                Shared types (units: N, mm internally)
  geometry.ts             Shoelace properties, polygon validity, scanline chords
  materials.ts            Parabola–rectangle concrete + piecewise steel laws
  codes.ts                IS 456 / IRC 112 / IRS CBC parameter registry
  integrator.ts           Strain-plane pivots + exact Gauss scanline integration
  surface.ts              Interaction surface, contours, utilisation, case check
  sections.ts             Predefined parametric section generators
  cover.ts                Per-face cover model, bar offsets, cover audit + snap
  checks.ts               Clause compliance checks per code
  sls.ts                  SLS working-stress check (σcbc / σst, transformed section)
  crackWidth.ts           SLS crack-width check per code (IS 456 Annex F / IRC:112 / IRS CBC)
  __tests__/              Golden regression tests (docs/11 worked example)
src/components/           Editors, section preview, charts, results panels
  CoverPanel.tsx          Per-face cover inputs, schematic and layout actions
  SLSResults.tsx          SLS stress table, summary and calculation panels
  CrackWidth.tsx          SLS crack-width inputs, per-case results and calculation panels
src/App.tsx               State + analysis pipeline wiring (ULS + SLS modules)
```

## Engineering notes

- The rigorous surface utilisation (radial demand/capacity in the Mx–My plane at
  constant Pu) governs the verdict; the code's simplified power-law interaction
  (IS 456 Cl 39.6 / IRC 112 Cl 8.3.2 / IRS CBC Cl 15.6.4 eq 16) is computed and
  reported alongside for traceability.
- Cover is a **per-face** driving datum measured to the outside of the links: an automatic
  bar sits `cover(face) + ⌀tie + ⌀bar/2` from its associated face, a bar lining an internal
  void uses that void's own cover (blank = inherit the matching outer face), and circular
  rings take the governing (largest) face cover. Cover, bar diameter and section edits update
  automatic geometry live; coordinate-table edits switch only the edited rows to `manual`,
  which are audited but not overwritten — see `docs/03` §3.6 and `docs/04` §4.2.
- Loads are entered **already factored**; material partial safety factors are applied
  internally by the code stress blocks. Second-order / slenderness moments must be
  included upstream (the tool flags the slenderness screens).
- The engine reproduces the independently verified reference case (450 × 600, M30,
  Fe500, 12 ⌀25 — docs/11) within ±2% on all capacities; see the test suite.

**Disclaimer:** design aid only — the engineer of record remains responsible for the
design, code applicability and clause interpretation. See `docs/README.md`.
