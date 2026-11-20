"""Survival maths on synthetic data with a known answer."""
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline"))
from lifetable import MAX_AGE, life_table, smr  # noqa: E402


def constant_hazard_population(q: float, n0: float = 1_000_000):
    """Deterministic stationary population with a constant annual probability q.

    With mid-year exposure P_x = (N_x + N_{x+1}) / 2 and deaths D_x = N_x - N_{x+1},
    the actuarial conversion must give back exactly q at every age.
    """
    N = [n0 * (1 - q) ** x for x in range(MAX_AGE + 1)]
    D = [N[x] - N[x + 1] for x in range(MAX_AGE)]
    P = [(N[x] + N[x + 1]) / 2 for x in range(MAX_AGE)]
    return D, P


def test_constant_hazard_recovers_q_and_median():
    q = 0.05
    D, P = constant_hazard_population(q)
    t = life_table(D, P)
    assert all(abs(qx - q) < 1e-12 for qx in t.q)
    assert abs(t.S[20] - (1 - q) ** 20) < 1e-12
    # S(x) = 0.95^x crosses 0.5 at ln(0.5)/ln(0.95) = 13.51; linear interpolation between 13 and 14.
    exact = math.log(0.5) / math.log(1 - q)
    assert abs(t.median - exact) < 0.02
    assert t.median_lo < t.median < t.median_hi
    assert t.median_observed_share == 1.0


def test_known_step_hazard():
    # q = 0 until age 10, then 0.2 a year: S(10) = 1, S(13) = 0.512, S(14) = 0.4096 → median in (13, 14).
    N = [1000.0] * 11
    for _ in range(10, MAX_AGE):
        N.append(N[-1] * 0.8)
    D = [N[x] - N[x + 1] for x in range(MAX_AGE)]
    P = [(N[x] + N[x + 1]) / 2 for x in range(MAX_AGE)]
    t = life_table(D, P)
    assert t.S[10] == 1.0
    assert abs(t.S[13] - 0.512) < 1e-9
    assert 13 < t.median < 14
    assert abs(t.median - (13 + (0.512 - 0.5) / (0.512 - 0.4096))) < 1e-9


def test_borrowed_ages_are_flagged():
    q = 0.1
    D, P = constant_hazard_population(q, n0=10_000)
    P_young_only = [p if x < 8 else 0 for x, p in enumerate(P)]
    D_young_only = [d if x < 8 else 0 for x, d in enumerate(D)]
    ref = [0.1] * MAX_AGE
    t = life_table(D_young_only, P_young_only, ref_q=ref)
    assert t.observed[:8] == [True] * 8 and not any(t.observed[8:])
    assert abs(t.median - math.log(0.5) / math.log(0.9)) < 0.05
    assert t.median_observed_share == 1.0  # median 6.6 < 8 observed ages
    t2 = life_table(D[:3] + [0] * 37, P[:3] + [0] * 37, ref_q=ref)
    assert t2.median_observed_share < 0.5


def test_confidence_band_narrows_with_sample_size():
    random.seed(1)
    widths = []
    for n0 in (2_000, 200_000):
        D, P = constant_hazard_population(0.06, n0)
        t = life_table(D, P)
        widths.append(t.median_hi - t.median_lo)
    assert widths[1] < widths[0] / 5


def test_smr_index():
    D, P = constant_hazard_population(0.05)
    ref_m = [d / p for d, p in zip(D, P)]
    s = smr(D, P, ref_m)
    assert abs(s["index"] - 100) < 1e-9
    s2 = smr([d * 1.3 for d in D], P, ref_m)
    assert abs(s2["index"] - 130) < 1e-9 and s2["lo"] < 130 < s2["hi"]
