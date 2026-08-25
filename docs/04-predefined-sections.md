# 4. Predefined section library

Predefined shapes are parametric front-ends to the same engine: each generates a
boundary-vertex table ([§3.1](03-section-definition.md)) and a default bar layout, both
of which the user can then edit freely — a predefined section is never a separate
analysis path.

## 4.1 Parameters and generated geometry

| Shape | Parameters (mm) | Generated boundary | Default bar layout |
|---|---|---|---|
| **Rectangle** | `B, D` | 4 vertices: (0,0) (B,0) (B,D) (0,D) | 4 corner bars + bars distributed along each face at ≤ 300 mm spacing (user sets count per face) |
| **Circle** | `D` | Regular polygon, default 64 segments (radius error < 0.15%); segment count user-adjustable 36–120 | N ≥ 6 bars equally spaced on pitch-circle radius `r = D/2 − cnom − ⌀tie − ⌀bar/2` |
| **Tee** | `bf, tf, bw, D` | 8 vertices tracing flange and web | Bars along flange top/bottom faces and web faces; corner bars at all re-entrant corners |
| **I-shape** | `bf1, tf1, bf2, tf2, tw, D` | 12 vertices; unequal flanges allowed | Bars in both flanges + web face bars |
| **Angle (L)** | `B, D, tw, tf` | 6 vertices | Bars along both legs, corner bar at the heel |
| **Box** | `B, D, tw, tf` | Outer rectangle + inner void rectangle (§3.2) | Two layers: outer-face bars and inner-face (void-side) bars, both at ≤ 300 mm spacing |
| **Hollow circle** | `Do, Di` | Outer + inner polygonised circles | Single or double ring, equally spaced |

## 4.2 Automatic bar placement rule

For every predefined shape the default bar layout is generated with a common offset rule —
the bar centre sits at:

```
offset from concrete face = cnom + ⌀tie + ⌀bar/2
```

where `cnom` = nominal clear cover (user input, defaulted from the selected code's
exposure table), `⌀tie` = tie/link diameter (default 8 mm), `⌀bar` = longitudinal bar
diameter. Corner bars are set back by the same offset from both meeting faces.

Generated layouts always satisfy the minimum bar count of the selected code (e.g. 4 bars
for a rectangular column, 6 for circular under IS 456 Cl. 26.5.3.1). After generation the
layout is an ordinary bar table — §3.3 editing and [§9](09-validation.md) validation
apply unchanged.
