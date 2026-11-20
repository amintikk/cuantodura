"""Period life tables for cars, as in demography.

For one group and each age x in completed years:
  m_x = D_x / P_x       D: definitive de-registrations (claves 3 and 4) during the 12-month
                        window with age x; P: cars of age x registered at mid-window.
  q_x = m_x / (1 + m_x / 2)   probability of being de-registered within the year of age
                        (actuarial conversion: P at mid-year already lacks half the year's deaths).
  S(x) = prod_{j<x} (1 - q_j)  share still registered at exact age x.

Confidence intervals: Greenwood's variance with the log(-log) transform, using
n_j = P_j + D_j / 2 cars at risk. The median's interval is read off the band.

Ages with too little exposure (fewer than `min_exposure` cars) borrow the hazard of a
reference table (segment, brand or all cars). They are flagged; a median that depends
mostly on borrowed ages is not published as an observed value.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

Z = 1.959964
MAX_AGE = 40  # ages 0..39; S is reported up to exact age 40


@dataclass
class LifeTable:
    deaths: list[float]
    exposure: list[float]
    q: list[float]
    S: list[float]            # S[0..MAX_AGE], S[0] = 1
    lo: list[float]
    hi: list[float]
    observed: list[bool]      # q_x estimated from the group itself (not borrowed)
    median: float | None = None
    median_lo: float | None = None
    median_hi: float | None = None
    median_observed_share: float = 0.0
    extra: dict = field(default_factory=dict)

    def at(self, age: float) -> float:
        """S at a (possibly fractional) age, linear between whole ages."""
        if age <= 0:
            return 1.0
        if age >= MAX_AGE:
            return self.S[MAX_AGE]
        i = int(age)
        f = age - i
        return self.S[i] * (1 - f) + self.S[i + 1] * f


def _crossing(curve: list[float], level: float = 0.5) -> float | None:
    for x in range(1, len(curve)):
        if curve[x] <= level < curve[x - 1] or curve[x] <= level <= curve[x - 1] and curve[x - 1] != curve[x]:
            a, b = curve[x - 1], curve[x]
            return x - 1 + (a - level) / (a - b) if a != b else float(x)
    return None


def life_table(deaths, exposure, ref_q=None, min_exposure: float = 50.0) -> LifeTable:
    D = [float(deaths[i]) if i < len(deaths) else 0.0 for i in range(MAX_AGE)]
    P = [float(exposure[i]) if i < len(exposure) else 0.0 for i in range(MAX_AGE)]
    q: list[float] = []
    obs: list[bool] = []
    for x in range(MAX_AGE):
        if P[x] >= min_exposure:
            m = D[x] / P[x]
            q.append(min(1.0, m / (1 + m / 2)))
            obs.append(True)
        else:
            q.append(ref_q[x] if ref_q is not None else 0.0)
            obs.append(False)
    S = [1.0]
    for x in range(MAX_AGE):
        S.append(S[-1] * (1 - q[x]))
    lo, hi = [1.0], [1.0]
    acc = 0.0
    for x in range(MAX_AGE):
        if obs[x] and q[x] < 1:
            n = P[x] + D[x] / 2
            acc += q[x] / (n * (1 - q[x]))
        s = S[x + 1]
        if 0 < s < 1 and acc > 0:
            v = acc / (math.log(s) ** 2)
            w = Z * math.sqrt(v)
            lo.append(s ** math.exp(w))
            hi.append(s ** math.exp(-w))
        else:
            lo.append(s)
            hi.append(s)
    t = LifeTable(D, P, q, S, lo, hi, obs)
    t.median = _crossing(S)
    t.median_lo = _crossing(lo)
    t.median_hi = _crossing(hi)
    if t.median is not None:
        # Share of the cumulative hazard up to the median that comes from the group's own data.
        upto = int(math.ceil(t.median))
        H = [-math.log(1 - q[x]) if q[x] < 1 else 0.0 for x in range(upto)]
        tot = sum(H)
        t.median_observed_share = sum(h for h, o in zip(H, obs) if o) / tot if tot else 0.0
    return t


def smr(deaths, exposure, ref_m, ages=range(MAX_AGE)) -> dict:
    """Standardised de-registration ratio: observed / expected at the reference age-specific rates.

    Returned as an index where 100 = same rate as the reference for cars of the same age.
    95 % interval from Byar's approximation to the Poisson distribution.
    """
    O = sum(float(deaths[x]) for x in ages if x < len(deaths))
    E = sum(float(exposure[x]) * ref_m[x] for x in ages if x < len(exposure))
    if E <= 0:
        return {"index": None, "lo": None, "hi": None, "observed": O, "expected": E}
    lo = O * (1 - 1 / (9 * O) - Z / (3 * math.sqrt(O))) ** 3 / E if O > 0 else 0.0
    O1 = O + 1
    hi = O1 * (1 - 1 / (9 * O1) + Z / (3 * math.sqrt(O1))) ** 3 / E
    return {"index": 100 * O / E, "lo": 100 * lo, "hi": 100 * hi, "observed": O, "expected": E}


def rates(deaths, exposure) -> list[float]:
    return [float(deaths[x]) / float(exposure[x]) if x < len(exposure) and exposure[x] > 0 else 0.0
            for x in range(MAX_AGE)]
