import json

import pytest

from mastr_radar import players


def test_real_players_build(tmp_path):
    (tmp_path / "auctions").mkdir()
    (tmp_path / "auctions" / "onshore.json").write_text(
        json.dumps(
            {
                "dynamics": {"groups": [{"group": "UKA", "mw": 2745, "status": "steady"}]},
                "fleet": {"groups": [{"group": "UKA", "mw": 1006}]},
            }
        )
    )
    players.build(tmp_path)
    d = json.loads((tmp_path / players.FILE).read_text())
    uka = next(p for p in d["players"] if p["name"] == "UKA")
    assert uka["germany"]["wind_awarded_mw"] == 2745 and uka["germany"]["wind_fleet_mw"] == 1006
    players.check(tmp_path)


def test_missing_reason_fails():
    bad = {
        "players": [{"name": "X", "type": "ipp", "momentum": "forward", "sources": ["https://a.b"]}]
    }
    with pytest.raises(players.PlayersCheckError, match="why"):
        players.check_data(bad)
