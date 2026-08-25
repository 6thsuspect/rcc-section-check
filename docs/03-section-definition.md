# 3. Defining the section

## 3.1 Boundary coordinates (custom sections)

A custom section is entered as an ordered table of boundary vertices (`x`, `y`) in
millimetres, in any convenient coordinate system — the module never requires the origin
to be at the centroid. The polygon is closed automatically from the last vertex back to
the first. On entry the module:

- verifies the polygon is **simple** (no self-intersecting edges) and has non-zero area;
- re-orders vertices **counter-clockwise** if entered clockwise (sign of the shoelace
  area);
- computes area, centroid and second moments by Green's-theorem line integrals
  ([§5.2](05-methodology.md)), then translates all geometry to **centroidal axes** — all
  moments are applied and reported about these axes;
- renders a scaled preview so the user can confirm the shape before analysis.

Example (700 × 500 mm chamfered pier, origin at lower-left corner):

```
Vertex   x (mm)   y (mm)
  1         0        0
  2       700        0
  3       700      300
  4       500      500
  5       200      500
  6         0      300
```

→ Ag = 3.10 × 10⁵ mm², centroid G at (350.0, 226.3) mm from the input origin.

## 3.2 Openings and voids

Hollow sections carry one or more **void polygons** in addition to the outer boundary.
Each void must lie wholly inside the outer boundary and must not intersect another void.
Internally a void is treated as negative area: its contribution is subtracted in every
geometric and stress integral. Predefined box and hollow-circular shapes
([§4](04-predefined-sections.md)) generate their void polygon automatically.

## 3.3 Reinforcement input

Reinforcement is a table of discrete bars, one row per bar:

| Column | Symbol | Unit | Notes |
|---|---|---|---|
| Bar x-coordinate | `xb` | mm | Centre of bar, same coordinate system as the boundary table |
| Bar y-coordinate | `yb` | mm | Centre of bar |
| Diameter | `dia` | mm | Per-bar; standard list 8, 10, 12, 16, 20, 25, 28, 32, 36, 40 (IS 1786). Mixed diameters in one section are allowed. |

The steel grade is a single, section-wide selection (§3.4). Bars are treated as point
areas at their centres; the concrete displaced by each bar in the compression zone is
deducted automatically (§5.4), so the user never adjusts for it.

Bulk tools — "generate bars along an edge at spacing s, offset c" and "generate N bars on
a circle of radius r" — fill the same table; every generated bar remains individually
editable.

## 3.4 Materials

Two dropdowns, filtered by the selected design code (grade availability and any
code-specific caps are given in §6–§8):

| Input | Options | Governs |
|---|---|---|
| Concrete grade | M20 … M90 | `fck` = characteristic cube strength (N/mm²); the concrete stress–strain model of §5.3 |
| Reinforcement grade | Fe415 / Fe415D / Fe500 / Fe500D / Fe550 / Fe550D / Fe600 | `fy` = characteristic 0.2%-proof stress (N/mm²) per IS 1786; `Es` = 2.0 × 10⁵ N/mm² |

## 3.5 Load cases

Loads are entered as **factored (ultimate) design actions** — the module applies material
partial safety factors internally but never load factors. Any number of rows:

| Column | Unit | Sign convention |
|---|---|---|
| Case name | — | Free text, echoed in the report |
| Axial load `Pu` | kN | Compression positive, tension negative |
| Moment `Mux` | kN·m | About the centroidal X axis; positive puts the +Y face in compression |
| Moment `Muy` | kN·m | About the centroidal Y axis; positive puts the +X face in compression |

> **Note — slender members.** For slender columns the entered moments must already
> include the additional / second-order moments required by the selected code (IS 456
> Cl. 39.7, IRC 112 Cl. 11, IRS CBC slender-column rules). The module flags the
> slenderness limits (§6–§8) when the user supplies member length, but moment
> magnification is performed upstream of this check.
