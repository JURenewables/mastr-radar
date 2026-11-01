from datetime import date

import pandas as pd

from mastr_radar import market_risk


def test_backlog_and_exposure():
    rounds = [
        {
            "id": "R1",
            "bid_date": "2022-05-01",
            "published": "2022-06-01",
            "avg_ct": 5.9,
            "ceiling_ct": 5.88,
        },
        {
            "id": "R2",
            "bid_date": "2025-05-01",
            "published": "2025-06-01",
            "avg_ct": 6.8,
            "ceiling_ct": 7.35,
        },
        {
            "id": "R3",
            "bid_date": "2026-05-01",
            "published": "2026-06-01",
            "avg_ct": 5.0,
            "ceiling_ct": 7.25,
        },
    ]
    aw = pd.DataFrame(
        [
            ("R1", "A", 1000, 1000),
            ("R1", "B", 500, 0),  # past the deadline, never built
            ("R2", "B", 2000, 500),
            ("R3", "A", 3000, None),
        ],
        columns=["round", "group", "kw", "kw_operating"],
    )
    facts = {
        "events": [
            {
                "company": "B Corp",
                "group": "B",
                "kind": "insolvency",
                "date": "2026-01",
                "tech": "wind",
            }
        ]
    }
    d = market_risk._tech(rounds, aw, facts, date(2026, 10, 30), 36, "wind")
    assert d["past_deadline_unbuilt_kw"] == 500
    assert d["unbuilt_kw"] == 1500 + 3000
    assert d["exposure"][0]["unbuilt_kw"] == 2000
    assert d["price_peak"]["avg_ct"] == 6.8 and d["price_last"]["avg_ct"] == 5.0
    market_risk.check_data({"wind": d})
