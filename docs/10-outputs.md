# 10. Outputs & report

## 10.0 Figure controls

Every figure (section preview, P–M diagram, Mx–My contour) carries:

- **Zoom in / zoom out / fit-to-view** buttons plus drag-to-pan, implemented through the
  SVG viewBox so hover readouts stay correct at any zoom level;
- a **label toolbar** on the section preview: labels on/off, font size (A−/A+), and
  label colour (preset swatches + free colour picker). Labels shown: bar numbers and the
  centroid marker G(x̄, ȳ);
- a **neutral-axis toggle** on the section preview: for the selected load case the
  governing neutral axis of the capacity state (at P = Pu along the demand direction) is
  drawn as a dash-dot line with the compression zone shaded; the caption reports the NA
  angle.

## 10.1 On-screen results

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

## 10.2 Report

The **PDF report** button (header bar) builds a self-contained print document in a new
window — all figures embedded as inline SVG at fit-to-view scale — and opens the print
dialog ("Save as PDF" produces the file). Contents, so an independent reviewer can
follow the check without the software:

1. Header: selected code and edition, date, method statement line.
2. Input echo: materials, cover/tie, member length, partial factors, boundary-vertex
   table, void polygons, bar table, load-case table.
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
10. Method statement and disclaimer.
