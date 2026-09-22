# 4. Predefined section library

Predefined shapes are parametric front-ends to the same engine: each generates a
boundary-vertex table ([§3.1](03-section-definition.md)) and a default bar layout, both
of which the user can then edit freely — a predefined section is never a separate
analysis path.

## 4.1 Parameters and generated geometry

| Shape | Parameters (mm) | Generated boundary | Default bar layout |
|---|---|---|---|
| **Rectangle** | `B, D` | 4 vertices: (0,0) (B,0) (B,D) (0,D) | 4 corner bars + bars distributed along each face at ≤ 300 mm spacing (user sets count per face) |
| **Circle** | `D` | Regular polygon, default 64 segments (radius error < 0.15%); segment count user-adjustable 36–120 | Circular reinforcement arrangements (uniform ring, alternate bars, bundles, triples, layered rings) on pitch-circle radius `r = D/2 − c − ⌀tie − ⌀bar/2`, `c` = governing face cover (§4.2); see §4.3 |
| **Tee** | `bf, tf, bw, D` | 8 vertices tracing flange and web | Bars along flange top/bottom faces and web faces; corner bars at all re-entrant corners |
| **I-shape** | `bf1, tf1, bf2, tf2, tw, D` | 12 vertices; unequal flanges allowed | Bars in both flanges + web face bars |
| **Angle (L)** | `B, D, tw, tf` | 6 vertices | Bars along both legs, corner bar at the heel |
| **Box** | `B, D, tw, tf` | Outer rectangle + inner void rectangle (§3.2) | Two layers: outer-face bars at their face's cover and inner-face (void-side) bars at the void face's cover, both at ≤ 300 mm spacing |
| **Hollow circle** | `Do, Di` | Outer + inner polygonised circles | Same circular arrangements as solid circle; layered rings for inner/outer faces |

## 4.2 Automatic bar placement rule

For every predefined shape the default bar layout is generated with a common offset rule —
the bar centre sits at:

```
offset from a concrete face = cnom(face) + ⌀tie + ⌀bar/2
```

where `cnom(face)` = the nominal clear cover entered for **the face the bar lies
against** ([§3.6](03-section-definition.md): bottom / right / top / left, plus the
void's own faces in hollow sections, defaulting from the selected code's exposure
table and linked to one value when all faces are equal), `⌀tie` = tie/link
diameter (default 8 mm), `⌀bar` = longitudinal bar diameter. The datum is the
*outside of the links*, as in IRC 112 Cl. 14.3.2.1 and IRS CBC
Cl. 15.9.2.1/15.9.2.2, so a generated layout's achieved cover to the link barrel
equals the entered value. A bar's face is decided by geometry — a lining bar in a
top slab reads `cnom(top)`, one in a cell wall reads `cnom(left)`/`cnom(right)`,
and one hanging under an internal void reads that void's bottom-face value — and
corner bars are set back by the same offset from both meeting faces.

Rings that are equidistant from several faces (circular sections, and the outer
ring of every shape at its corner bars) use the **governing**, i.e. largest, face
cover, so one symmetric layout satisfies every face at once.

Automatic generated layouts now remain linked to their face association. Changing an
outer or void-face cover immediately recalculates every automatic bar from the section
geometry, the controlling face, ⌀tie and ⌀bar; changing a bar diameter or a parametric
section dimension follows the same relationship. Hand-edited coordinate rows are marked
`manual` and are deliberately left untouched by later cover changes. The cover panel still
provides **Apply cover to layout** for an explicit regeneration and **Snap bars to cover**
for a deliberate one-off correction.

Generated layouts always satisfy the minimum bar count of the selected code (e.g. 4 bars
for a rectangular column, 6 for circular under IS 456 Cl. 26.5.3.1). After generation the
layout is an ordinary bar table — §3.3 editing and [§9](09-validation.md) validation
apply unchanged.

## 4.3 Circular reinforcement arrangements

When the section is a **circle** or **hollow circle**, the *Circular reinforcement* panel
offers arrangement options that all write into the same `x, y, dia` bar table:

| Arrangement | Description | Principal inputs |
|---|---|---|
| **Uniform ring** | N bars equally spaced on one pitch circle | Bar ⌀, N, start angle, optional angular spacing |
| **Alternate bars** | Bars of two diameters alternating around the ring | Bar ⌀, alternate ⌀, N, start angle |
| **Bundle bars** | Groups of 2+ bars at each peripheral location | Bar ⌀, bars/bundle, number of bundles, start angle |
| **Triple bars** | Three bars at each location (equilateral cluster) | Bar ⌀, number of groups, centre-to-centre spacing within group |
| **Layered reinforcement** | Multiple concentric rings at independent radii | Per layer: radius (or auto), ⌀, N, start angle, spacing; **Add layer** for any count |

The *Cover* input of this panel is not a separate value: it mirrors the nominal cover
entered in [§3.6](03-section-definition.md) and shows the **governing radial value** —
`max` over the four outer faces (and over the four void faces for the inner ring) — since
one radius serves all of them. The ring therefore sits at
`r = R − radialCover − ⌀tie − ⌀bar/2`; changing any face cover in the cover panel changes
this radius, and *Generate layout* / **Auto-update** regenerate the table with it. Because
the ring is placed at the largest face cover, the audit records a positive margin on the
faces whose own cover is smaller.

Coordinates of every individual bar (including those inside a bundle or triple) are
computed automatically. The panel checks that bars stay inside the concrete envelope and
flags clear-spacing violations. Live-update keeps the bar table and section diagram in
sync; every generated bar remains editable in the reinforcement table afterwards.
