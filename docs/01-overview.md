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
6. **Check shear** — switch to the **Shear Check** tab for the shear capacity, link design,
   minimum/maximum reinforcement limits and spacing rules of the same code, entered with its own
   factored (`Vu`, `Pu`) load-case list. The tab recomputes from the shared section, materials
   and reinforcement; nothing in the ULS or SLS modules depends on it.

## 1.2 What the module checks — and what it does not

The module performs a **cross-section strength check at the ultimate limit state**, plus
code detailing checks that can be evaluated from section data (steel percentage, bar
count, spacing, cover).

It does **not** perform member design: load combinations, slenderness amplification,
second-order moments and torsion design are the caller's responsibility; **shear** design is
covered by a separate shear module (the **Shear Check** tab). Where a
code requires member-level input (for example minimum-eccentricity moments, which need
the unsupported length), the module accepts that input and applies the clause, but it
does not derive effective lengths itself. Serviceability is covered for **stress limits** by a
separate SLS module (working-stress / direct-stress method of IS 456:2000 Annex C — concrete
σcbc and reinforcement σst / σsc against the cracked transformed-section stresses) **and for
crack width** by the method of the selected code (IS 456 Annex F; IRC:112 Cl 12.3.4 / EN 1992-2;
IRS Concrete Bridge Code Cl 15.9.8.2), each with a PASS/FAIL verdict against the code's
permissible width for the exposure class. The ULS, SLS and shear modules share the
section, materials and reinforcement but keep **four separate, independently edited load-case
lists** — factored actions for ULS, characteristic (service) actions for the SLS working-stress
check, a further characteristic set for the crack-width check, and a factored (`Vu`, `Pu`) set
for the shear design check. The shear check follows **only** the selected code's shear clauses
(IS 456 Cl 40 & 26.5.1, IRC:112 Cl 10.3 & 16.5, IRS CBC Cl 15.4.3 & 15.6.6) and never modifies
the ULS or SLS results.
