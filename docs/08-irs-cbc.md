# 8. Code compliance — IRS Concrete Bridge Code (1997)

Provisions implemented when **Design code = IRS CBC** is selected. Basis: Indian Railway
Standard *Code of Practice for Plain, Reinforced & Prestressed Concrete for General
Bridge Construction*, Second Revision 1997, Reprint 2014 (A&C 1–13), Advance Correction
Slips up to ACS-8 (2019). The code is closely modelled on BS 5400-4, with `fck` defined
as the **28-day 150 mm cube strength** (Table 2, Cl 5.1), so BS `fcu`-based coefficients
carry over numerically.

> **Verification status.** Clause numbers below were checked against available copies of
> the code text; items tagged **[verify]** appear only as scanned figures/tables in
> those copies and must be confirmed against a print original before release. (The
> independent second-pass verification that was run for IS 456 and IRC 112 could not be
> completed for this chapter.)

## 8.1 Design philosophy & factors

Limit state code (Cl 10.1); this module performs the **ULS of rupture** check
(Cl 10.3.1). Cl 15.6.1.4 additionally requires columns with moments to satisfy the SLS
cracking check of Cl 10.2.1(a) — out of scope here, flagged in the report.

| Item | Clause | Value |
|---|---|---|
| γm concrete / steel (ULS) | Cl 12.4.3 | **1.5 / 1.15** |
| Characteristic strengths | Cl 12.1, 5.1.1, 15.2.4.3 | fck = 28-day cube; fy = yield / 0.2% proof per IS spec |
| Load factors | Cl 11.3.1, Table 12 | γfL on loads per IRS Bridge Rules; **no γf3 on load effects** (unlike BS 5400) |
| Design life | Cl 15.1.3 | 100 yr inland / 80 yr coastal / 50 yr in sea |

## 8.2 Section-analysis assumptions (Cl 15.6.3.2, mirrors Cl 15.4.2.1)

| Assumption | Clause | Requirement |
|---|---|---|
| Plane sections | 15.6.3.2(a) | linear strain field |
| Concrete stress | 15.6.3.2(b) | **Fig 4A parabola–rectangle with γm = 1.5**, or a uniform **0.4·fck** block where the compression zone is rectangular/circular |
| Ultimate strain | 15.6.3.2(b) | **εcu = 0.0035** |
| Concrete tension | 15.6.3.2(c) | ignored |
| Steel stress | 15.6.3.2(d) | Fig 4B with γm = 1.15 |
| Non-rectangular shapes | **15.6.3.2.1** | "derived from first principles using the preceding assumptions" — exactly the tool's fiber analysis |

**Fig 4A (Cl 12.3.1, ACS-8):** parabola from ε = 0 to ε₀ = **2.44 × 10⁻⁴·√(fck/γm)**,
then plateau at **0.67·fck/γm = 0.447·fck**, up to εcu = 0.0035; initial tangent modulus
5.5·√(fck/γm) kN/mm² [verify against a print original — reconstructed from a poor scan].
The 0.4·fck uniform block is the *simplified alternative* only; do not confuse the two,
and never mix with IS 456's 0.36·fck/0.42·xu geometry.

**Fig 4B (steel):** design tensile strength **0.87·fy**; design **compressive** stress
capped at

```
fyc = fy / (γm + fy/2000)        (Cl 15.6.3.3)
```

| fy | 250 | 415 | 500 | 550 |
|---|---|---|---|---|
| 0.87·fy | 217.5 | 361.1 | 435.0 | 478.5 |
| fyc | 196.1 | 305.7 | 357.1 | 386.0 |

Es = 200 kN/mm² (Cl 4.5.3). Implemented as bilinear elastic–plastic with the tension
plateau 0.87·fy and the compression cap fyc.

## 8.3 Columns (Cl 15.6)

| Check | Clause | Requirement |
|---|---|---|
| Column vs wall | 15.6.1.1 / 15.7.1.1 | column if larger dimension ≤ **4 ×** smaller |
| Short column | 15.6.1.1 | **le/h < 12** each plane |
| Effective height | 15.6.1.2, Table 18 | per Table 18 (factors follow BS 5400-4 Table 11: 0.70–2.30·lo [verify — scanned table]) |
| Slenderness limit | 15.6.1.3 | le/h ≤ **40**; ≤ **30** if not restrained in position at one end |
| Nominal eccentricity, minor-axis uniaxial | **15.6.3.1** | moment increased by P·e_nom, **e_nom = 0.05·h ≤ 20 mm** |
| Nominal eccentricity, biaxial | **15.6.4** | each axis: **e_nom = 0.03·h ≤ 20 mm** (note: *capped* at 20 mm, unlike IS 456's 20 mm *floor*) |
| Uniaxial capacity formulas | 15.6.3.3 (eqs 14/15), 15.6.3.4 | rectangular closed forms on the 0.4·fck block — used as hand-check only; the engine integrates Fig 4A |
| **Biaxial interaction** | **15.6.4, eq 16** | **(Mx/Mux)^αn + (My/Muy)^αn ≤ 1.0** for symmetric rect/circular columns. (In eq 16's notation Mux/Muy are the *capacities* at the applied axial load.) |
| αn | Table 19 | P/Puz = ≤0.2 / 0.4 / 0.6 / ≥0.8 → αn = **1.00 / 1.33 / 1.67 / 2.00**, linear interpolation [verify interpolation note] |
| Puz | eq 17 | **Puz = 0.45·fck·Ac + fyc·Asc** |
| Other section shapes | 15.6.4 (final sentence) | design per 15.6.3.2 first principles — **the tool's fiber surface is itself the code-compliant check**; eq 16 is reported only for symmetric rect/circular sections |
| Slender columns | 15.6.5.2–15.6.5.4 (eqs 18–22) | additional moments, e.g. biaxial: Mtx = Mix + (P·hy/1750)(lex/hy)²(1 − 0.0035·lex/hy) — applied upstream; the tool flags le/h ≥ 12 |
| Shear / cracking | 15.6.6 / 15.6.7 | out of scope; flagged in report |

## 8.4 Reinforcement limits & detailing

| Requirement | Clause | Value |
|---|---|---|
| Min longitudinal steel | **15.9.4.1** | Asc ≥ **lesser of 1.0% of section or 0.15·P/fy** |
| Min bars / dia / spacing | 15.9.4.1 | ≥ **4** bars (rect), ≥ **6** (circular); ⌀ ≥ **12 mm**; periphery spacing ≤ **300 mm** |
| Max longitudinal steel | **15.9.5.2** | ≤ **6%** vertically cast / 8% horizontally cast; laps 8% / 10% |
| Ties | 15.9.4.3 | ⌀ ≥ ¼ largest bar; spacing ≤ **12 ×** smallest bar ⌀; corner/alternate bars restrained (≤ 135°); others within 150 mm |
| One steel grade per member | 15.9.3.1 | main bars one type/grade |

## 8.5 Cover, grades, durability

**Clear cover** (Cl 15.9.2.2; measured to outermost steel incl. binders per 15.9.2.1);
maximum cover 75 mm (Cl 15.9.2.4). Columns by exposure (Cl 5.4.1 classes):

| Member | Moderate | Severe | Extreme |
|---|---|---|---|
| Column | **50 mm** | **75 mm** | **75 mm** |

**Concrete grades** (Table 2, Cl 5.1): M20–M60 offered. Durability minima (Cl 5.4.4,
Table 4(b)): important bridges M30/M35/M40; other bridges & substructures M20/M25/M30
(moderate/severe/extreme); max w/c 0.45/0.40/0.35; min cementitious 300/350/400 kg/m³.

**Steel grades** (Cl 4.5.1 with ACS-3/ACS-7): IS 432 Fe 250; IS 1786 HYSD/TMT Fe 415–
Fe 550 (all permissible for longitudinal steel — the only fy cap in the code text is
415 N/mm² for **shear/link** reinforcement); IS 16651 stainless (ACS-7). Seismic zones
III–V: HYSD bars need min 14.5% elongation (ACS-3 note) — surfaced as a warning.
Fe 600 is **not** offered under IRS CBC.

## 8.6 Loads

Characteristic loads per IRS Bridge Rules (Cl 11.1); ULS combinations 1–4 with γfL per
Table 12 (e.g. DL 1.25, SIDL 2.00, LL 1.75/1.40, EP 1.70). The user enters already-
factored `Pu, Mux, Muy`; the tool checks section strength only.
