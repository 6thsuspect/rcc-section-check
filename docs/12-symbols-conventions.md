# 12. Symbols, units & sign conventions

## 12.1 Units

Internally the engine works in N and mm. The user interface accepts and reports geometry
in **mm**, axial loads in **kN**, moments in **kN·m**, stresses in **N/mm² (MPa)**,
strains dimensionless.

## 12.2 Sign conventions

- Axial load: **compression positive**, tension negative.
- Right-handed centroidal axes: X to the right, Y upward in the section view, Z out of
  the section (member axis).
- `Mx` positive when it compresses the +Y face; `My` positive when it compresses the +X
  face. Interaction surfaces are generated for all four moment quadrants, so unsymmetric
  sections (T, L) are handled without any symmetry assumption.
- Compressive stresses and strains are reported positive in concrete; steel stress
  carries the sign of its strain.

## 12.3 Symbols

| Symbol | Meaning | Unit |
|---|---|---|
| `fck` | Characteristic compressive (cube) strength of concrete | N/mm² |
| `fy` / `fyk` | Characteristic yield / 0.2%-proof stress of reinforcement | N/mm² |
| `fcd`, `fyd` | Design strengths after partial safety factors | N/mm² |
| `Es` | Modulus of elasticity of steel (2.0 × 10⁵) | N/mm² |
| `Ag` / `Ac` | Gross concrete area / net concrete area (Ag − Asc) | mm² |
| `Asc` | Total area of longitudinal reinforcement | mm² |
| `p` | Reinforcement percentage, 100·Asc/Ag | % |
| `Pu` / `NEd` | Factored applied axial load (IS·IRS / IRC notation) | kN |
| `Mux`, `Muy` / `MEdx`, `MEdy` | Factored applied moments about centroidal X, Y | kN·m |
| `Mux1`, `Muy1` / `MRdx`, `MRdy` | Uniaxial moment capacities at the applied axial load | kN·m |
| `Puz` / `NRd` | Pure axial (squash) capacity | kN |
| `αn` / `a` | Biaxial interaction exponent | — |
| `εcu`, `εc2` | Ultimate and plateau compressive strains of concrete | — |
| `xu` | Neutral-axis depth from the most compressed fibre | mm |
| `emin` | Minimum eccentricity | mm |
| `U` | Utilisation ratio (demand / capacity), §5.5 | — |
