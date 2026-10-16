# 10. Outputs & report

## 10.0 Figure controls

Every figure (section preview, P–M diagram, Mx–My contour and the shear link diagram) carries:

- **Zoom in / zoom out / fit-to-view** buttons plus drag-to-pan, implemented through the
  SVG viewBox so hover readouts stay correct at any zoom level — the same control strip on
  every figure, including the shear link cross-section / link-elevation diagram (the shear
  figure includes the detailing legend and the detailing-status line, so the print copy and
  the screen stay identical);
- a **label toolbar** on the section preview: labels on/off, font size (A−/A+), and
  label colour (preset swatches + free colour picker). Labels shown: bar numbers and the
  centroid marker G(x̄, ȳ);
- a **neutral-axis toggle** on the section preview: for the selected load case the
  governing neutral axis of the capacity state (at P = Pu along the demand direction) is
  drawn as a dash-dot line with the compression zone shaded; the caption reports the NA
  angle.

### Branding

The application logo — a dark drafting tile carrying the reinforced concrete section (boundary,
closed stirrup with its two hooks, and the eight main bars) — is one piece of artwork on three
surfaces. The rectangular section is centered: 120 units of tile on either side and 70 above and
below, with the section's own axes on the centre lines of the tile, so the drawing mirrors about
both axes and no element sits closer to one edge than to its opposite (the stirrup's hooks and
the drop shadow are the artwork's own detail and stay as drawn).

- the **app title mark** in the header (`AppLogo` in `src/components/Logo.tsx`);
- the **printed report header**: the same drawing, emitted into the title line by
  `logoSvgMarkup()`, laid out beside the heading by the `.head` rules in the report stylesheet;
- the **browser tab**: `public/favicon.svg`, with `public/favicon-32.png` for browsers without
  SVG favicons and `public/apple-touch-icon.png` for home-screen pinning.

`npm run icons` regenerates the two PNGs from the same geometry after any change to the mark
(`scripts/make-favicons.mjs` draws it with edge-antialiased signed-distance fields and encodes
the PNG with `node:zlib`), and `src/components/__tests__/branding.test.tsx` checks that the
component, the favicon and the rasteriser still describe the same drawing, and measures the
artwork's box from the markup to hold the section centered with equal margins. The document's
`theme-color` is the tile colour.

## 10.1 On-screen results

The header bar carries the three check tabs (ULS / SLS / Shear) in one row together with,
to their right, the status readout of the open tab and the **Import project**,
**Export project** and **PDF report** buttons. The readout reports the same tab-specific
values shown in the panels below; because its content is wider on some tabs than others, it
is gated on the width of the action area itself (a container query, `statusReadoutCls` /
`statusPillCls` in `src/components/ui.tsx`) rather than on the viewport: the full readout
appears when that area can hold it beside the buttons, the compact verdict pill stands in
when it cannot, and the three buttons — always in one non-shrinking group — never wrap, so
the row is laid out identically whichever tab is selected. All three tabs render the readout
through the one `HeaderStatus` component, so the three cannot drift apart. The three check
buttons themselves are drawn as independent buttons in the style of the action buttons beside
them (`SegButton variant="button"` = the shared `headerBtnCls`), not as a segmented control: the
open module is not marked by a filled or bordered tab — it is carried by `aria-pressed` for
assistive technology and by the module's own panels below.

The header adapts rather than overlaps, and it never scrolls sideways — the app root clips
overflow, so anything that did not wrap would be lost rather than scrolled to. The three checks
sit in a wrapping flex row (`SegGroup`), the row itself is `flex-wrap` with
`justify-content: space-between`, and the action area keeps a min-content floor so it takes a
line of its own instead of squeezing the buttons. Below 600 px (`max-[600px]:…`, i.e. an
`@media (max-width: 600px)` query — the breakpoint is written out in the class names so it is
visible in the markup and asserted by `src/components/__tests__/appHeader.test.tsx`) the header
compacts: the check row takes a full line under the title, the word "Check" leaves the labels
(`display: none`; the buttons keep their full accessible name through `aria-label`), the
buttons lose padding and type and take a tighter icon gap, and the action buttons wrap onto the
line below the checks. The header buttons also carry a pressed state that reads under a finger
(`:active` fires during a tap, where there is no hover) with the browser's double-tap-zoom delay
removed (`touch-manipulation`); buttons outside the header keep `btnCls` / `btnPrimaryCls` as
they were.

- **Interaction diagrams**, each with every load case overlaid as a point:
  - P–Mx and P–My uniaxial diagrams;
  - P–Mres diagram in the resultant-moment plane of each load case
    (`θM = atan2(Muy, Mux)`);
  - Mx–My capacity contour at each load case's axial load.
- **Results table** per load case: `Pu`, `Mux`, `Muy`, `MRd` at `Pu`, utilisation U
  (rigorous, [§5.5](05-methodology.md)), simplified power-law value (per §6–§8),
  governing neutral-axis depth and angle, and verdict (**PASS** / **FAIL**).
- **Clause compliance panel**: every check of the selected code (§6–§8) with its clause
  number, computed value, limit, and status.
- **Section dashboard**: `Ag`, centroid, `Ixx`, `Iyy`, `Ixy`, `Asc`, p%, bar count,
  `Puz`.
- **Shear tab**: per shear case the design shear force, nominal shear stress, the concrete
  shear strength used, the web-crushing limit, the concrete resistance, the required and
  provided Asv/sv, the maximum spacing and the VEd/VRd utilisation with a PASS/FAIL verdict;
  a summary strip with the governing case and the provided-vs-required comparison; the full
  step-by-step calculation of the selected case (clause, expression, substituted value) and
  the shear clause-compliance table.
- **Shear reinforcement diagram + stirrup detailing editor** (`fig-shear`, full width under
  the shear inputs): the *same* cross-section as the section preview — outline, voids, every
  longitudinal bar at its own coordinates and diameter, the clear cover of each face and the
  resolved link ring — drawn with the intermediate legs and cross-ties of the current
  arrangement, next to a member elevation carrying the provided link spacing. The editor
  beside it sets the link type (auto / rectangular / circular), the arrangement (automatic
  from the bars, or manual) and the ⌀, leg count and spacing that feed the resistance check,
  lists every member with its section coordinate in mm, and reports each arrangement that
  cannot be built with its reason — entered positions are never moved or clamped.

  Line styles are shared by the drawing, the legend and the editor rows: solid blue = the
  closed outer link (2 legs in Asv), dashed blue = an intermediate leg (counted in Asv),
  dash-dot ink = a cross-tie (restrains a bar, not counted in Asv), filled black = tension
  bars, hollow = other bars, light dotted = the shear plane at the effective depth d.

  Members are placed on the **coordinates of the main reinforcement**: the bar table is read as
  columns of bars sharing a line, a column that carries a bar in the bottom layer and a bar in
  the top layer takes an intermediate leg (so the leg connects the two reinforcement layers,
  standing on that bar column, with its hooks turned towards the bars it engages), and the bars
  a leg cannot cover — the side-face bars of a deep section — are covered by cross-ties. Each
  member is drawn from one horizontal run of the link ring to the other with the longitudinal
  bars drawn over it, so the connections read correctly; the editor lists, for every member, the
  bars it is hooked around, and a member that lines up with none of them is reported (the
  anchorage then depends on its hooks alone) rather than moved. The automatic arrangement never
  adds a member that would double one of the ring's own runs or sit closer than the minimum
  clear spacing, so it always passes the detailing validation it is checked against.

  Every numeric field in the editor — each member position and the leg count — is editable
  with the **mouse wheel** as well as the keyboard: one notch steps the value by the field's own
  step (10 mm for a member position, one leg for the leg count), the step is taken from the
  value on screen so no notch can be rounded away, the field's own limits and validation are
  the ones that apply, the diagram and the check results follow the notch immediately, and the
  page is held still while the wheel is over the field (elsewhere it scrolls as usual, and
  keyboard typing is untouched).

  The drawing is a detailing view: it never by itself certifies compliance. The values shown
  (Asv, Asv/sv, sv,max, VEd/VRd) all come from the selected code's check run on the same
  inputs — the caption reports the components of the provided Asv as drawn (⌀, area per leg,
  number of legs = 2 ring + internal, spacing) beside the required value, and names the source
  of the arrangement (`auto from n bars`), so the graphical arrangement and the calculation
  parameters can be compared at a glance.

### Footer

A single line — **© 2025 Arvind Singh Rawat. All Rights Reserved.** — sits at the foot of the app,
below the workspace and outside its scrolling region, so it stays visible whatever is scrolled.
The year is the one in the notice, not today's date (a plain string in `src/App.tsx`; it is not
derived from the clock).

## 10.2 Report

The **PDF report** button (header bar) builds a self-contained print document — all figures
embedded as inline SVG at fit-to-view scale — and opens the print dialog ("Save as PDF"
produces the file). *How* it gets there is the job of `src/reportDelivery.ts`, because a print
window is not always available and is refused silently: the report goes to a window of its own
when the browser allows one, otherwise to a hidden 0 × 0 frame in this page (no permission
needed — this is what makes the button work inside an embedded preview, where a popup is never
granted), and only if printing is blocked outright does it arrive as a downloaded HTML file,
with a note in the header saying so. A route is only used once the report document has really
loaded in it (a fresh window loads `about:blank` first) and the print waits for the document to
lay out; a route that never loads is dropped — the window closed, the frame removed — and the
next one takes over. Contents, so an independent reviewer can follow the check without the
software:

1. Header: selected code and edition, date, method statement line.
2. Input echo: materials, the nominal cover of each concrete face (outer faces, and the
   void faces where they are set independently) with the link diameter, member length,
   partial factors, boundary-vertex table, void polygons, bar table, load-case table.
3. Section properties: Ag, centroid, Ixx/Iyy/Ixy, Asc, p%, bounding box.
4. Design material parameters: fcd, εc2, εcu, n, fyd (and fyc where applicable), pivot
   rules, surface mesh — the full basis for reproducing the interaction diagram.
5. Axial & **flexural section capacity**: rigorous Puz, simplified Puz, Pt, and the
   pure-bending capacities ±Mx0, ±My0.
6. Per-case calculation blocks: applied actions, resultant demand and its direction,
   axial-range check, uniaxial capacities Mux1/Muy1 at Pu, MRd along the demand
   direction, rigorous utilisation with the arithmetic shown, and the simplified
   power-law evaluation (Puz, Pu/Puz, αn, both terms, sum) — plus a verdict.
7. Figures: section sketch (with bar marks, centroidal axes and the governing neutral
   axis), P–M diagram and Mx–My contour, as displayed for the selected case.
8. Interaction-diagram data tables: the sampled P–M capacity curve and the Mx–My
   contour coordinates (NA angle, Mx, My) so the plots are independently checkable.
9. Clause-compliance table with computed value, limit, clause reference and status —
   including checks that passed, so the reviewer sees what was covered, not only what
   failed.
10. **Shear design check**: the shear inputs used (direction, tension face, section b/d/Asl,
    provided links), the link type and arrangement (automatic or manual, with every
    intermediate leg and cross-tie position), the effective leg count and Asv, the worst
    required Asv/sv and web-crushing utilisation, the per-case shear table, the link diagram
    and the step-by-step calculation with its compliance table for the governing case.
11. Method statement and disclaimer.
