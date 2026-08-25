# RCC Section Check

Biaxial **P–Mx–My interaction analysis** of arbitrary reinforced-concrete sections, with
clause-level compliance to **IS 456:2000**, **IRC:112-2020** and the **IRS Concrete
Bridge Code (1997)**.

The user provides a factored axial load and bending moments about two perpendicular
axes; the section is defined either by **custom boundary coordinates** (polygon vertices,
with optional voids) plus **rebar coordinates** (x, y, ⌀ per bar), or from a predefined
library (rectangle, circle, T, I, L, box, hollow circle). The engine generates the full
interaction surface by strain-compatibility analysis of the actual geometry, draws the
P–M diagram and the Mx–My capacity contour with every load case overlaid, and reports a
utilisation ratio plus the selected code's clause checks.

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
  checks.ts               Clause compliance checks per code
  __tests__/              Golden regression tests (docs/11 worked example)
src/components/           Editors, section preview, charts, results panels
src/App.tsx               State + analysis pipeline wiring
```

## Engineering notes

- The rigorous surface utilisation (radial demand/capacity in the Mx–My plane at
  constant Pu) governs the verdict; the code's simplified power-law interaction
  (IS 456 Cl 39.6 / IRC 112 Cl 8.3.2 / IRS CBC Cl 15.6.4 eq 16) is computed and
  reported alongside for traceability.
- Loads are entered **already factored**; material partial safety factors are applied
  internally by the code stress blocks. Second-order / slenderness moments must be
  included upstream (the tool flags the slenderness screens).
- The engine reproduces the independently verified reference case (450 × 600, M30,
  Fe500, 12 ⌀25 — docs/11) within ±2% on all capacities; see the test suite.

**Disclaimer:** design aid only — the engineer of record remains responsible for the
design, code applicability and clause interpretation. See `docs/README.md`.
