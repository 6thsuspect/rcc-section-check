# 1. Overview

**RCC Section Check** verifies the adequacy of a reinforced-concrete cross-section
subjected to a factored axial load `Pu` together with bending moments `Mux` and `Muy`
about two perpendicular centroidal axes. Capacity is computed from first principles —
plane-section strain compatibility integrated over the actual geometry — rather than from
shape-specific design charts. Any solid or hollow section that can be described by
boundary coordinates can therefore be checked: standard rectangles and circles,
bridge-pier ovals and chamfered shapes, T, I and L sections, boxes, and wall piers.

The module produces the full three-dimensional **P–Mx–My interaction surface** of the
section, plots the interaction diagrams with every applied load case overlaid, reports a
utilisation ratio per load case, and evaluates the detailing and material rules of the
selected Indian design code.

## 1.1 Analysis workflow

1. **Define the section** — pick a predefined shape ([§4](04-predefined-sections.md)) or
   enter boundary coordinates directly ([§3.1](03-section-definition.md)), then place
   reinforcement bars by coordinate with individual diameters (§3.3).
2. **Assign materials** — concrete grade and reinforcement grade from the lists the
   selected code permits (§3.4).
3. **Select the design code** — IS 456:2000, IRC 112 or IRS Concrete Bridge Code. The
   stress–strain models, partial safety factors, interaction rules and detailing checks
   switch together with this selection ([§2](02-design-codes.md)).
4. **Enter load cases** — any number of (`Pu`, `Mux`, `Muy`) triplets (§3.5).
5. **Review results** — interaction diagrams, utilisation per load case, and the
   clause-compliance table with pass/fail status ([§10](10-outputs.md)).

## 1.2 What the module checks — and what it does not

The module performs a **cross-section strength check at the ultimate limit state**, plus
code detailing checks that can be evaluated from section data (steel percentage, bar
count, spacing, cover).

It does **not** perform member design: load combinations, slenderness amplification,
second-order moments and shear/torsion design are the caller's responsibility. Where a
code requires member-level input (for example minimum-eccentricity moments, which need
the unsupported length), the module accepts that input and applies the clause, but it
does not derive effective lengths itself. Serviceability checks (crack width, stress
limits) are outside scope in this revision.
