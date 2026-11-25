from datetime import date

import pandas as pd
import pytest

from mastr_radar import outlook, runup
from mastr_radar.auctions import parse_round_page


def test_permit_deadline_parsed():
    html = (
        "<p>Gebotstermin ist der 1. August 2026 .</p><p>Teilnahmeberechtigt sind Projekte mit "
        "Genehmigungen nach dem BImSchG , die bis zum 6. Juli 2026 erteilt und dem "
        "Marktstammdatenregister gemeldet wurden.</p>"
    )
    p = parse_round_page(html)
    assert p["bid_date"] == "2026-08-01" and p["permit_deadline"] == "2026-07-06"


def test_weekly_and_summary():
    d = pd.Series(pd.to_datetime(["2019-01-08", "2019-01-09", "2019-01-20"]))
    w = runup._weekly(d, pd.Series([1000.0, 2000.0, 500.0]), date(2019, 2, 1))
    assert w["weeks"][0] == "2019-01-07" and w["units"][:2] == [2, 1] and w["mw"][0] == 3.0
    s = runup._summary([-60, -10, -3, 5])
    assert s["n"] == 4 and s["share_before_bid"] == 0.75 and s["share_last_8_weeks"] == 0.5


def test_outlook_check_rejects_broken_dates():
    good = {
        "repowering": {
            "old": {"units": 2000},
            "points": [1, 2, 3, 4],
            "districts": {str(i): [1, 1, 1] for i in range(150)},
        },
        "auction_outlook": {
            "wind": {
                "next_bid_dates": ["2027-02-01", "2027-05-01", "2027-08-01", "2027-11-01"],
                "permitted_pool_mw": 1,
            }
        },
    }
    outlook.check_data(good)
    good["auction_outlook"]["wind"]["next_bid_dates"] = [
        "2027-05-01",
        "2027-02-01",
        "2027-08-01",
        "2027-11-01",
    ]
    with pytest.raises(outlook.OutlookCheckError):
        outlook.check_data(good)
