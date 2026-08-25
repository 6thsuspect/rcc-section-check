# 2. Design codes & scope

The design code is a single top-level selection. It is not a cosmetic label: the
selection swaps the concrete stress block, the material partial safety factors, the
strain limits, the simplified biaxial interaction rule, the detailing checks, and the
exposure/cover tables **as one consistent set**. Mixing provisions across codes is
deliberately impossible.

| Selector | Code | Typical use | Companion documents |
|---|---|---|---|
| `IS 456` | IS 456:2000 (R2021) — Plain and Reinforced Concrete, with SP 16 design aids | Buildings and general structures | SP 16, IS 1786, IS 13920 (seismic detailing, outside scope) |
| `IRC 112` | IRC:112-2020 — Code of Practice for Concrete Road Bridges | Highway bridge substructures and superstructures | IRC:6 (loads), IS 1786 |
| `IRS CBC` | IRS Concrete Bridge Code, 1997 (with correction slips) — Indian Railway Standard | Railway bridges | IRS Bridge Rules (loads), IS 1786 |

## 2.1 What changes with the code selection

| | **IS 456:2000** | **IRC:112-2020** | **IRS CBC 1997** |
|---|---|---|---|
| Concrete design curve | Parabola–rectangle, peak 0.446·fck (Cl 38.1/Fig 21) | Parabola–rectangle, fcd = 0.67·fck/γc = 0.447·fck; grade-dependent εc2/εcu2/n above M60 (Table 6.5) | Fig 4A parabola–rectangle, peak 0.447·fck, parabola end 2.44×10⁻⁴·√(fck/γm) |
| εc2 / εcu (≤ M60) | 0.0020 / 0.0035 | 0.0020 / 0.0035 | ≈ 0.0011–0.0015 (grade-dep.) / 0.0035 |
| γc / γs | 1.5 / 1.15 (Cl 36.4.2.1) | 1.5 / 1.15 basic (Cl 6.4.2.8, 6.2.2) | 1.5 / 1.15 (Cl 12.4.3) |
| Steel model | SP-16 piecewise (HYSD), plateau 0.87·fy | Bilinear, fyd = fyk/1.15; optional inclined branch to εud = 0.9·εuk | Bilinear, tension 0.87·fy; compression capped at fyc = fy/(γm + fy/2000) (Cl 15.6.3.3) |
| Simplified biaxial rule | Cl 39.6: αn from Pu/Puz (0.2→1.0, 0.8→2.0); Puz = 0.45fck·Ac + 0.75fy·Asc | Cl 8.3.2: a from NEd/NRd (0.1/0.7/1.0 → 1.0/1.5/2.0); circular a = 2; NRd = Ac·fcd + As·fyd | Cl 15.6.4 eq 16: αn per Table 19 (1.0/1.33/1.67/2.0); Puz = 0.45fck·Ac + fyc·Asc |
| Min./nominal eccentricity | e_min = l/500 + D/30 **≥ 20 mm** (Cl 25.4) | no general e_min; imperfection e_i = 15 + l0/800 **≤ 50 mm** (Cl 11.3.2.2, one direction) | e_nom = 0.03·h **≤ 20 mm** each axis, biaxial (Cl 15.6.4) |
| Min. longitudinal steel | 0.8% of gross (Cl 26.5.3.1(a)) | max(0.10·NEd/fyd, 0.002·Ac) (Cl 16.2.2) | lesser of 1.0% or 0.15·P/fy (Cl 15.9.4.1) |
| Max. steel / periphery spacing | 6% (warn > 4%) / 300 mm | 4% (8% laps) / 200 mm | 6% vert. cast (8% laps) / 300 mm |
| Concrete grades offered | M20–M80 (Table 2 Amd 4; warn > M60) | M20–M90 (Table 6.4) | M20–M60 (Table 2) |
| Steel grades offered | Fe250–Fe600 | Fe415–Fe600 (Table 18.1) | Fe250–Fe550 (Cl 4.5.1) |

Full clause-by-clause requirements: [§6](06-is456.md), [§7](07-irc112.md),
[§8](08-irs-cbc.md).

## 2.2 Scope boundaries

- The module checks **ULS section strength** (axial + biaxial bending) and section-level
  detailing rules. Load combinations are formed upstream per IS 875/IS 1893, IRC:6, or
  IRS Bridge Rules as applicable.
- Slenderness classification is reported when member geometry is supplied; second-order
  moment amplification is the caller's responsibility
  ([§3.5](03-section-definition.md)).
- Prestressed sections, composite sections, and confinement-based ductility checks are
  out of scope for revision A.
