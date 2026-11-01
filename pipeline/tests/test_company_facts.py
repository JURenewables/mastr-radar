import json

import pytest

from mastr_radar import company_facts


def test_real_facts_build(tmp_path):
    entries = company_facts.build(tmp_path)
    assert entries[0]["name"] == company_facts.FILE
    d = json.loads((tmp_path / company_facts.FILE).read_text())
    assert d["companies"] and d["events"]
    assert [e["date"] for e in d["events"]] == sorted(e["date"] for e in d["events"])
    company_facts.check(tmp_path)


def test_missing_source_fails(tmp_path):
    p = tmp_path / "f.yaml"
    p.write_text(
        "as_of: '2026-11-01'\ncompanies:\n"
        "  - {group: X, model: ipp, finance: project, note: n, sources: []}\n"
    )
    with pytest.raises(company_facts.FactsCheckError, match="source"):
        company_facts.build(tmp_path, p)
