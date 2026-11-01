"""Solar auctions (contract v1.7 draft): yield model, award numbers, portfolios."""

import pandas as pd
import pytest
import yaml

from mastr_radar import solar_auctions as sa

CFG = yaml.safe_load(sa.YIELD_CONFIG.read_text())


def test_specific_yield():
    fixed = sa.specific_yield(1100, 0, 0, CFG)
    assert fixed == pytest.approx(1100 * 1.12 * 0.85)
    assert sa.specific_yield(1100, 1, 0, CFG) > fixed > sa.specific_yield(1100, 0, 1, CFG)
    assert sa.specific_yield(float("nan"), 0, 0, CFG) is None
    assert sa.specific_yield(300, 0, 0, CFG) is None  # implausible


def test_norm_award():
    assert sa.norm_award("SOL19-1-008") == sa.norm_award("sol19-1/008") == "SOL191008"
    assert sa.norm_award(None) is None


def test_portfolios():
    base = dict(round="R1", bid_date="2025-03-01", state="BY")
    enerparc = dict(base, group="Enerparc", rank_group="Enerparc", district="X")
    rows = [
        # Three capped bids of one group in one district → one 50 MW portfolio.
        dict(enerparc, bidder="A GmbH", kw=20000),
        dict(enerparc, bidder="B GmbH", kw=20000),
        dict(enerparc, bidder="C GmbH", kw=10000),
        # A single bid elsewhere is not a portfolio.
        dict(
            base, group=None, rank_group="Not attributed", bidder="D GmbH", district="Y", kw=50000
        ),
    ]
    pf = sa._portfolios(pd.DataFrame(rows))
    assert pf["by_round"][0]["share_in_portfolios"] == 0.5
    [top] = pf["largest"]
    assert (top["owner"], top["bids"], top["kw"]) == ("Enerparc", 3, 50000)
