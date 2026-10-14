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

Three top-bar modules share the same section, materials and reinforcement: the **ULS Check**
(ultimate P–Mx–My interaction and capacity), the **SLS Check** (serviceability limits — the
IS 456:2000 Annex C working-stress method for concrete σcbc and reinforcement σst / σsc against
the cracked transformed-section stresses, **plus a crack-width check** by the method of the
selected code) and the **Shear Check** (shear capacity, link design, minimum/maximum limits and
spacing per the selected code). Each check keeps its own PASS/FAIL verdict. **Load cases are
entered separately for each check** — the ULS panel holds factored actions, the SLS panel holds
characteristic (service) actions for the stress check, the crack-width check has its own service
list, and the shear check has its own factored `Vu`/`Pu` list; the four lists edit independently
and switching tabs changes none of them.

### Shear design check (Shear tab)
The shear tab runs the shear method of the selected code, independently of the ULS and SLS
modules, on its own factored load-case list of (`Vu`, `Pu`) pairs:
- **IS 456:2000** — nominal shear stress τv = `Vu/(b·d)` (Cl 40.1) against the design shear
  strength of concrete τc from **Table 19** (Cl 40.2.1), with the axial-compression multiplier
  δ = 1 + 3Pu/(Ag·fck) ≤ 1.5 (Cl 40.2.2) and the near-support enhancement 2d/av (Cl 40.3);
  stirrups carry `Vus = Vu − τc·b·d` (Cl 40.4); τc,max from **Table 20** (Cl 40.2.3);
  minimum stirrups `Asv/(b·sv) ≥ 0.4/(0.87·fy)` (Cl 26.5.1.6); spacing ≤ min(0.75·d, 300 mm)
  (Cl 26.5.1.5).
- **IRC:112-2020** — members without links: `VRd,c = [0.12·K·(100·ρl·fck)^(1/3) + 0.15·σcp]·bw·d`,
  K = 1 + √(200/d) ≤ 2 (Cl 10.3.2); variable strut inclination θ (cot θ = 1.0…2.5, user-set):
  `VRd,s = (Asw/s)·z·fywd·cot θ` and `VRd,max = αcw·bw·z·ν1·fcd/(cot θ + tan θ)` (Cl 10.3.3.2);
  minimum shear reinforcement ρw = 0.072·√fck/fyk (Cl 10.3.3.5 / 16.5.2); spacing ≤ 0.75·d
  (Cl 16.5.2).
- **IRS Concrete Bridge Code 1997** — shear stress `v = V/(b·d)` against the ultimate shear
  stress in concrete βs·vc (Table 15 × Table 16 depth factor βs = (500/d)^(1/4) ≥ 0.70), links
  per Table 14 (`Asv ≥ 0.4·b·sv/(0.87·fyv)` when v ≤ βs·vc, else
  `Asv ≥ b·sv·(v + 0.4 − βs·vc)/(0.87·fyv)`, fyv ≤ 415 N/mm²), v ≤ min(0.75·√fck, 4.75 N/mm²)
  (Cl 15.4.3.1), columns enhanced by (1 + 0.05·P/Ac) (Cl 15.6.6), spacing ≤ 0.75·d.

b, d and Asl come from the section and bar table (with manual overrides), the tension face is
selectable, and every result is shown as a step-by-step calculation with clause references plus
a per-case PASS/FAIL verdict and a provided-vs-required reinforcement comparison.

#### Link detailing & the shear reinforcement diagram
The shear tab carries its own reinforcement diagram and stirrup editor, next to the results:

- the figure **replicates the main cross-section** — outline, voids, every longitudinal bar at
  its own coordinate and diameter, the clear cover of each face — and adds the resolved link
  ring, the intermediate legs and the cross-ties, with a member elevation showing the provided
  link spacing (`fig-shear`, same drawing framework, zoom controls and print capture as the
  other figures);
- the drawing shows the *connections*: **solid blue** = the closed outer link that encloses the
  bar cage (2 legs in Asv), **dashed blue** = an intermediate leg on a bar column (in Asv),
  **dash-dot ink** = a cross-tie (restrains a bar, not counted in Asv), **filled black** =
  tension bars, **hollow** = other bars, light dotted = the shear plane at the effective depth d.
  A member is drawn from one horizontal run of the link ring to the other and the longitudinal
  bars are drawn over it, so a leg meets the bars it hooks and reads as a connection — no
  disconnected stubs, dashes are phase-matched so they do not alias into solid lines, and the
  figure caption carries how the provided Asv is made up (`n legs = 2 ring + m internal`);
- the **link type** (auto / rectangular / circular), **arrangement** (automatic from the bar
  layout, or manual) and the ⌀, effective leg count and spacing are inputs; the effective legs
  and `Asv = n·⌀²π/4` feed the resistance check, and changing them changes the results — the
  figure and the editor both state the arrangement the check ran on, and no design equation is
  modified for the drawing;
- the members are placed on the **actual coordinates of the main reinforcement**, not at
  arbitrary positions. The bar table is read as *columns*: bars sharing a coordinate across the
  width (a leg's line) or across the depth (a cross-tie's line). A column carrying a bar in the
  bottom layer **and** a bar in the top layer takes an **intermediate leg** — so an internal leg
  really connects the bottom reinforcement to the top reinforcement, riding along that column —
  and its hook tails turn towards the bar each end is anchored on. The bars a leg cannot cover
  (the side-face bars of a deep section, or a level the ring and the legs leave beyond the
  150 mm restraint limit) are covered by **cross-ties**. Every member reports the bars it is
  hooked around; one that lines up with none of them is reported rather than moved. The
  arrangement is re-derived whenever the section, the cover or the bars change;
- the **editor** adds, removes, repositions (in mm) and mirrors legs and cross-ties, switches a
  member between the two orientations, distributes positions evenly, shows the clear spacing
  between members and the resulting `Asv`, `Asv/sv` and code minimum; and
- every arrangement is **validated, never silently changed**: positions outside the section, a
  leg or tie that does not cross the ring, a member duplicating one of the ring's own legs, too
  small a clear gap, a ring that does not fit inside the section with the entered cover, and any
  bar left unrestrained are each reported with their reason. The drawing is a detailing view —
  compliance always comes from the code check on the same inputs.

### Crack-width check (SLS tab)
The crack-width check reuses the cracked-section tension-steel stress σs, neutral-axis depth and
effective depth from the SLS stress solve, and applies the method of the selected code:
- **IS 456:2000** — Annex F surface formula `w = 3·a_cr·ε_m / (1 + 2(a_cr − c_min)/(h − x))`,
  permissible width by exposure (Cl 35.3.2: 0.3 / 0.2 / 0.1 mm).
- **IRC:112-2020** — Cl 12.3.4 (EN 1992-2) `w_k = s_r,max·(ε_sm − ε_cm)`, Table 12.1 limits.
- **IRS Concrete Bridge Code 1997** — Cl 15.9.8.2 (BS 8110-2 basis), Table 10 limits.
Only the exposure class and load duration are entered; section, cover, bar size and depth come
from the shared inputs. Crack width is evaluated on its **own** characteristic (service) load-case
list, and the load cases together with the exposure-class and load-duration inputs sit in the
**left input column, immediately after the SLS Load Cases panel** — independent of the factored
ULS list and the SLS stress list. The result, permissible width, utilisation and clause update
automatically.

## Branding

The application logo is the bar/section lattice of the header mark on the ink tile: SVG at
`public/favicon.svg` (browser tab, with `prefers-color-scheme` inversion for dark tab strips),
`public/favicon-32.png` fallback and `public/apple-touch-icon.png` for home-screen pinning.
Regenerate the PNGs after any change to the mark with `npm run icons` (dependency-free — the
geometry in `scripts/make-favicons.mjs` mirrors the SVG).

## Stack

Vite · React 19 · TypeScript · Tailwind CSS v4 · Vitest

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine regression suite (verified worked-example values)
npm run build      # type-check + production build
npm run icons      # regenerate favicon PNGs from the logo geometry
```

## Layout

```
docs/                     Full specification (12 chapters, clause-verified)
public/                   Application logo: favicon.svg + generated PNG fallbacks
scripts/                  make-favicons.mjs — renders the logo PNGs (npm run icons)
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
  shear.ts                Shear design check per code (capacity, links, limits, spacing)
  stirrups.ts             Link ring, automatic leg/tie arrangement, resolution + validation
  __tests__/              Golden regression tests (docs/11 worked example)
src/components/           Editors, section preview, charts, results panels
  CoverPanel.tsx          Per-face cover inputs, schematic and layout actions
  SLSResults.tsx          SLS stress table, summary and calculation panels
  CrackWidth.tsx          SLS crack-width inputs, per-case results and calculation panels
  Shear.tsx               Shear inputs, load cases, reinforcement diagram + stirrup editor,
                          results and calculation panels
src/App.tsx               State + analysis pipeline wiring (ULS + SLS + shear modules)
```

## Engineering notes

- The rigorous surface utilisation (radial demand/capacity in the Mx–My plane at
  constant Pu) governs the verdict; the code's simplified power-law interaction
  (IS 456 Cl 39.6 / IRC 112 Cl 8.3.2 / IRS CBC Cl 15.6.4 eq 16) is computed and
  reported alongside for traceability.
- The shear diagram and the stirrup editor share one resolved link layout (`engine/stirrups.ts`)
  with the shear check, so the drawn legs, the effective `Asv` and the reported numbers can
  never disagree; entered member positions are kept exactly as typed and reported with their
  reason when they cannot be built.
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
