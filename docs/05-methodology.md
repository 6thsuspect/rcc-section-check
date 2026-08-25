# 5. Analysis methodology

## 5.1 Assumptions

- Plane sections remain plane: strain varies linearly over the section,
  `ε(x, y) = ε0 + κx·y − κy·x`.
- Perfect bond: steel strain equals concrete strain at the bar location.
- Tensile strength of concrete is ignored.
- Concrete and steel follow the design (factored) stress–strain relations of the selected
  code (§5.3); ultimate strain limits follow the code's pivot rules (§5.2).
- Bars are point areas at their centres; displaced concrete under compressive stress is
  deducted at each bar (§5.4).

## 5.2 Geometry and strain limits

Section properties are computed exactly from the boundary polygon by Green's-theorem line
integrals (shoelace formulas). With vertices `(xi, yi)`, `i = 1…n`, indices cyclic and
`wi = xi·y(i+1) − x(i+1)·yi`:

```
A  = ½ Σ wi
x̄  = (1/6A) Σ (xi + x(i+1)) · wi
ȳ  = (1/6A) Σ (yi + y(i+1)) · wi
```

Second moments `Ixx`, `Iyy`, `Ixy` follow from the analogous cubic sums; void polygons
contribute with negative `wi` (opposite winding). These exact integrals also serve as the
reference against which the stress-integration mesh is verified at run time.

At the ultimate limit state the admissible strain planes fan around three pivots. This
single rule reproduces each code's strain limits for bending, combined
bending–compression, and pure compression:

- **Pivot A** — the tension-steel strain limit (code-dependent; e.g. no explicit limit
  under IS 456 beyond the minimum-ductility strain at yield, `εud` under IRC 112 when the
  strain-hardening branch is used).
- **Pivot B** — extreme compression fibre at `εcu` (0.0035 for fck ≤ 60 N/mm² in all
  three codes) while the neutral axis lies inside or below the section.
- **Pivot C** — when the whole section is in compression, the strain plane rotates about
  an interior point at `εc2` (0.002), located at `(1 − εc2/εcu)·h ≈ 3h/7` from the
  compressed face, so pure axial compression is limited to `εc2` everywhere. IS 456
  Cl. 38.1(b) expresses the same rule as ε ≤ 0.0035 − 0.75·ε(least compressed fibre) at
  the highly compressed fibre.

```
   compressed face ──►  ε = 0.0035  (pivot B)
        │        ╲      ╱
        │         ╲    ╱ c (full compression,
   3h/7 ┼──── C ●  ╲  ╱   pivots about C at εc2)
        │       b ╲ ╲╱
        │          ╲╱╲
        │          ╱╲ ╲
   steel row ── A ●  ╲ ╲
   tension  ◄──┘      ╲ b: NA inside section
   limit         a: pivots about A
```

## 5.3 Material models by code

The engine exposes one stress-block interface (`src/engine/codes.ts`); each code plugs
in its own parameters:

| | IS 456:2000 | IRC:112-2020 | IRS CBC 1997 |
|---|---|---|---|
| Concrete model | Parabola–rectangle (Cl 38.1/Fig 21); peak `0.446·fck`; rectangular-equivalent `0.36·fck·xu` at `0.42·xu` used for hand verification only | Parabola–rectangle (Cl 6.4.2.8, Eqs 6.21–22); `fcd = 0.67·fck/γc = 0.447·fck`; grade-dependent `εc2`, `εcu2`, `n` above M60 per Table 6.5 / Annexure A2.2 | Fig 4A parabola–rectangle; peak `0.67·fck/γm = 0.447·fck`; parabola end `ε₀ = 2.44×10⁻⁴·√(fck/γm)`. (The uniform `0.4·fck` block is the code's simplified alternative for rectangular/circular zones only — not used by the engine) |
| `εc2 / εcu` (fck ≤ 60) | 0.0020 / 0.0035 | 0.0020 / 0.0035 | `ε₀` (≈ 0.0011–0.0015) / 0.0035 |
| γc, γs | 1.5, 1.15 | 1.5, 1.15 (basic & seismic; 1.2/1.0 accidental) | 1.5, 1.15 |
| Steel model | Fe250 bilinear at `0.87·fy`; HYSD per SP 16 Table A piecewise from `0.8·fyd` | Bilinear at `fyk/1.15`, horizontal top branch (default) or inclined to `εud = 0.9·εuk` | Bilinear: tension plateau `0.87·fy`; **compression capped at `fyc = fy/(γm + fy/2000)`** (Cl 15.6.3.3) |

Exact clause references and the values enforced per grade are tabulated in
[§6](06-is456.md), [§7](07-irc112.md), [§8](08-irs-cbc.md).

## 5.4 Interaction-surface generation

The engine sweeps the orientation and depth of the neutral axis and integrates the code
stress blocks over the actual geometry:

1. **Orientation loop.** The neutral-axis direction θ steps through [0°, 360°) (default
   48 steps; adaptive refinement near re-entrant corners of unsymmetric sections).
2. **Depth loop.** For each θ, the neutral-axis position sweeps from pure tension to pure
   compression (default 100 steps, graded finer near the balanced region), each position
   paired with the governing pivot rule of §5.2 to fix the strain plane.
3. **Concrete integration.** The compressed region is decomposed into strain iso-bands
   parallel to the neutral axis by polygon clipping; the stress resultant of each band is
   integrated in closed form for the rectangular part of the diagram and by 3-point Gauss
   quadrature per band for the parabolic part. This is exact for the section shape — no
   fiber-mesh approximation of the boundary — and typically needs 40–80 bands.
4. **Steel summation.** Each bar contributes `Ab·[σs(εb) − σc(εb)]`, the second term
   removing the concrete stress displaced by the bar when it lies in the compression
   zone.
5. **Resultants.** Each strain plane yields one point
   `(P, Mx, My) = (∫σ dA, ∫σ·y dA, −∫σ·x dA)` about the centroid; the set of points over
   both loops forms the closed interaction surface.

```
for θ in orientations(0 … 2π, n_θ):          # neutral-axis direction
    for c in depths(pure_tension … pure_compression, n_c):
        plane   = strain_plane(θ, c, pivots(code, f_ck))   # ε0, κ per pivot rule
        F_conc  = integrate_concrete(polygon, voids, plane, stress_block(code))
        F_steel = Σ_bars A_b · ( σ_s(ε(bar)) − σ_c_displaced(ε(bar)) )
        surface.add( P  = F_conc.N  + F_steel.N,
                     Mx = F_conc.Mx + F_steel.Mx,
                     My = F_conc.My + F_steel.My )

capacity(P_u, θ_M):                          # 2-D slice used for the diagrams
    root-find c such that P(θ*, c) = P_u     # Brent's method on the depth axis
    return (Mx, My) at the solved plane
```

## 5.5 Capacity check and utilisation

For each load case the engine takes the horizontal slice of the surface at `P = Pu` — a
closed Mx–My capacity contour — and measures the demand point against it radially:

```
U = |OD| / |OC|
```

where `O` = origin of the moment plane at `P = Pu`; `D` = demand point `(Mux, Muy)`;
`C` = intersection of ray OD with the capacity contour. **U ≤ 1.00 → section adequate**
for that case. The same radial measure on the P–M plane governs when the axial load
itself exceeds the surface (`Pu` greater than P at every contour).

In parallel, the selected code's **simplified** biaxial check (power-law interaction,
§6–§8) is evaluated and reported alongside — it is the clause auditors recognise, and any
disagreement with the rigorous surface is flagged. The rigorous value governs the
pass/fail verdict; the simplified value is reported for traceability.

As axial load rises toward `Puz`, the Mx–My contour shrinks and becomes more rounded —
the behaviour the power-law exponent `αn` approximates in the simplified code checks.

## 5.6 Numerical parameters and robustness

**Defaults.** Neutral-axis orientations n_θ = 40 (range 24–72); strain-profile samples
per orientation n_c = 90 (range 50–200); circles polygonised at 64 segments (radius
error < 0.15%).

**Constant-P slices by inverse interpolation.** P is monotone non-decreasing along each
orientation's sweep (positive material tangent stiffness; plateaus can occur once all
steel has yielded — the implementation clamps tiny numerical wiggles to keep the
sequence monotone). A contour at any P is therefore a per-orientation binary search +
linear interpolation on the precomputed sweep — no re-integration. Where root-finding
on a live profile is preferred (report-grade exactness), Brent's method is used — never
Newton, because the derivative is discontinuous at steel-yield onsets, at the εc2/εcu
block boundary, and at polygon vertices. Tolerances: |P − P_target| ≤ max(0.1 kN,
10⁻⁴·Puz); parameter tolerance 10⁻⁴·h.

**Interpolation safety.** The ULS interaction surface from plane-section analysis with
concave stress–strain laws is convex, so chord interpolation between computed points is
conservative for capacity; orientation refinement bounds the chord error.

**Degenerate cases.**

- P near Puz: the Mx–My contour collapses toward a point; below a 0.5 kN·m radius the
  verdict is driven by the axial ratio to avoid 0/0.
- Pure bending (P = 0) falls out of the interpolation naturally; P = 0 is included in
  the P-level grid so reported pure-bending values are exact.
- Bars exactly on the neutral axis carry zero stress; the displaced-concrete deduction
  applies only at compressive bar strain.
- Very thin compression zones keep a minimum of one integration band between adjacent
  breakpoints; the Gauss points are interior, so vertex-grazing scanlines cannot occur.

**QA assertions (regression suite).**

- Pure-compression resultant matches σc(εc2)·Ac + Σ As·σs(εc2) exactly.
- Pure-tension capacity equals 0.87·fy·Asc.
- Rectangle capacities match the verified worked example (§11) within ±2%.
- Symmetric sections give symmetric contours (±1%).
- Exact Green's-theorem section properties match hand values for rectangle, hexagonal
  pier and box-with-void.
