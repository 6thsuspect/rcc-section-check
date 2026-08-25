# 9. Input validation rules

Validation runs before every analysis. **Errors** block the run; **Warnings** are listed
on screen and carried verbatim into the report's remarks section.

| # | Rule | Check | Basis | Severity |
|---|---|---|---|---|
| V1 | Polygon validity | ≥ 3 vertices; non-zero area (\|A\| > 100 mm²); no self-intersection (pairwise segment test); duplicate consecutive vertices merged (< 0.1 mm); holes strictly inside the outer ring and mutually disjoint; orientation auto-corrected (outer CCW, holes CW) | — | Error |
| V2 | Bars inside net section | Ray-casting point-in-polygon: bar centre inside the outer ring and outside every void; distance to nearest boundary ≥ ⌀/2 (bar fully embedded) | — | Error |
| V3 | Cover achieved | Distance from bar centre to nearest boundary ≥ cnom + ⌀tie + ⌀bar/2, with cnom from the selected code's exposure table (IS 456 Table 16 / Cl 26.4.2.1; IRC 112 Table 14.2; IRS CBC Cl 15.9.2.2) | per code | Warning (Error if < ⌀/2 + 10 mm) |
| V4 | Bar clear spacing | Clear gap = centre distance − (⌀₁+⌀₂)/2 ≥ code minimum: IS 456 Cl 26.3.2 ≥ max(⌀larger, dg + 5 mm); IRC 112 Cl 15.2.1 ≥ max(⌀, dg + 10 mm, 20 mm); IRS CBC Cl 15.9.8 ≥ max(⌀, dg + 5 mm) | per code | Error |
| V5 | Duplicate / overlapping bars | Identical coordinates → duplicate; centre distance < (⌀₁+⌀₂)/2 → overlap. Bundles must be entered as one equivalent bar | — | Error |
| V6 | Minimum steel | IS 456: ≥ 0.8% gross (option: of area required); IRC 112: ≥ max(0.10·NEd/fyd, 0.002·Ac); IRS CBC: ≥ lesser of 1.0% or 0.15·P/fy | §6–§8 | Error |
| V7 | Maximum steel | IS 456: ≤ 6% (warn > 4%); IRC 112: ≤ 4% (8% laps); IRS CBC: ≤ 6% vertical cast (8% horizontal; laps 8/10%) | §6–§8 | Error (warn band first) |
| V8 | Minimum bar count | ≥ 4 rectangular/polygonal (corner coverage), ≥ 6 circular | §6–§8 | Error |
| V9 | Minimum bar diameter | ⌀ ≥ 12 mm for column longitudinal bars | §6–§8 | Warning |
| V10 | Periphery spacing | ≤ 300 mm (IS 456, IRS CBC); ≤ 200 mm (IRC 112). Evaluated as a nearest-neighbour approximation on the bar set | §6–§8 | Warning |
| V11 | Grade availability | Dropdowns filtered per code (IS 456 M20–M80 with > M60 warning; IRC 112 M20–M90; IRS CBC M20–M60, steel ≤ Fe550). Switching codes re-validates current selections | §6–§8 | Error |
| V12 | Geometry sanity | Predefined-shape parameter constraints (§4.1); overall dimension ≥ 100 mm; aspect-ratio > 4 flagged "wall — column detailing rules may not apply" (IRC 112 Cl 16.2.1 / IRS CBC Cl 15.6.1.1) | §4 | Error / Warning |
| V13 | Load sanity | 1–100 cases; \|Pu\| ≤ 10⁶ kN; \|M\| ≤ 10⁶ kN·m; case names unique | — | Error |

Implementation notes:

- V1/V2/V5/V13 and the polygon checks are implemented in `src/engine/geometry.ts` and
  `src/App.tsx` (issues panel); V6–V10 in `src/engine/checks.ts` (compliance table).
- The point-in-polygon, self-intersection and shoelace routines are unit-tested against
  hand-computed sections (`src/engine/__tests__/engine.test.ts`).
