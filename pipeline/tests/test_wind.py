"""Yield model (contract v1.6 draft)."""

import pytest

from mastr_radar import wind

CFG = wind.load_config()


def test_reference_site_quality_is_100():
    """A turbine at the EEG reference site has a quality factor of 100 %."""
    hub = 140.0
    v = wind.reference_speed(hub, CFG)
    # A site whose 80/100 m speeds follow the same log profile, Rayleigh distribution.
    v100 = wind.reference_speed(100, CFG)
    v80 = wind.reference_speed(80, CFG)
    y = wind.turbine_yield(5000, 150, hub, {"v100": v100, "v80": v80, "k80": 2.0}, CFG)
    assert v == pytest.approx(6.45 * 1.0487, rel=0.01)
    assert y["quality_pct"] == pytest.approx(100, abs=3)  # power law vs log profile
    assert 2000 < y["flh"] < 4000


def test_implausible_turbine_is_skipped():
    site = {"v100": 6.5, "v80": 6.2, "k80": 2.0}
    assert wind.turbine_yield(5000, 30, 140, site, CFG) is None  # 7 kW/m²
    assert wind.turbine_yield(5000, 150, 140, {**site, "v100": float("nan")}, CFG) is None


@pytest.mark.parametrize(
    ("quality", "year", "state", "factor"),
    [
        (100, 2025, "Niedersachsen", 1.00),
        (85, 2025, "Niedersachsen", 1.115),
        (150, 2025, "Hessen", 0.79),
        (170, 2025, "Hessen", 0.79),
        (50, 2025, "Bayern", 1.55),  # southern region: 50 % step
        (50, 2025, "Hessen", 1.42),  # elsewhere floored at 60 %
        (60, 2020, "Bayern", 1.29),  # EEG 2017 table ends at 70 %
        (60, 2022, "Bayern", 1.35),
    ],
)
def test_correction_factor(quality, year, state, factor):
    assert wind.correction_factor(quality, year, state, CFG) == pytest.approx(factor, abs=0.001)
