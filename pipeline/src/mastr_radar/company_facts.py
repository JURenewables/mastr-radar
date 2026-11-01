"""Hand-checked company facts (config/company_facts.yaml) → auctions/company_facts.json.

Part of station 3. The facts come from cited sources, not from MaStR; the check
makes sure every entry carries a source and uses known codes.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

from mastr_radar.config import PIPELINE_ROOT

FACTS_PATH = PIPELINE_ROOT / "config" / "company_facts.yaml"
FILE = "auctions/company_facts.json"
MODELS = {"develop_sell", "ipp", "mixed", "investor"}
FINANCE = {"project", "corporate", "fund", "mixed", None}
KINDS = {"insolvency", "restructuring", "sales_halt", "exit"}
TECHS = {"wind", "solar", "both"}
URL = re.compile(r"^https://\S+$")


class FactsCheckError(Exception):
    """Raised when company facts break the contract."""


def build(out_dir: Path, facts_path: Path = FACTS_PATH) -> list[dict]:
    raw = yaml.safe_load(facts_path.read_text())
    out = {
        "as_of": raw["as_of"],
        "companies": raw.get("companies", []),
        "events": sorted(raw.get("events", []), key=lambda e: e["date"]),
        "oems": raw.get("oems"),
        "market": raw.get("market"),
    }
    _validate(out)
    path = out_dir / FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    rows = len(out["companies"]) + len(out["events"])
    return [{"name": FILE, "rows": rows, "bytes": path.stat().st_size}]


def check(out_dir: Path) -> None:
    _validate(json.loads((out_dir / FILE).read_text()))


def _validate(d: dict) -> None:
    problems: list[str] = []

    def sources(item: dict, where: str) -> None:
        src = item.get("sources") or []
        if not src:
            problems.append(f"{where}: needs at least one source.")
        problems.extend(f"{where}: bad source {s!r}." for s in src if not URL.match(str(s)))

    for c in d.get("companies", []):
        where = f"company {c.get('group')!r}"
        if c.get("model") not in MODELS:
            problems.append(f"{where}: unknown model {c.get('model')!r}.")
        if c.get("finance") not in FINANCE:
            problems.append(f"{where}: unknown finance {c.get('finance')!r}.")
        if not c.get("note"):
            problems.append(f"{where}: missing note.")
        sources(c, where)
    for e in d.get("events", []):
        where = f"event {e.get('company')!r}"
        if e.get("kind") not in KINDS:
            problems.append(f"{where}: unknown kind {e.get('kind')!r}.")
        if e.get("tech") not in TECHS:
            problems.append(f"{where}: unknown tech {e.get('tech')!r}.")
        if not re.match(r"^\d{4}-\d{2}$", str(e.get("date"))):
            problems.append(f"{where}: date must be YYYY-MM.")
        if not e.get("issue"):
            problems.append(f"{where}: missing issue.")
        sources(e, where)
    oems = d.get("oems")
    if oems:
        sources(oems, "oems")
        for m in oems.get("makers", []):
            if not isinstance(m.get("gw"), (int, float)) or m["gw"] <= 0:
                problems.append(f"oems: bad gw for {m.get('maker')!r}.")
    market = d.get("market") or {}
    for i, o in enumerate(market.get("oversubscription", [])):
        where = f"market.oversubscription[{i}]"
        if o.get("tech") not in {"wind", "solar"}:
            problems.append(f"{where}: unknown tech.")
        if not (0 < o.get("tender_mw", 0) <= o.get("submitted_mw", 0)):
            problems.append(f"{where}: submitted must be ≥ tender > 0.")
        sources({"sources": [o.get("source")] if o.get("source") else []}, where)
    for i, f in enumerate(market.get("facts", [])):
        where = f"market.facts[{i}]"
        if f.get("tech") not in TECHS or not f.get("text"):
            problems.append(f"{where}: needs tech and text.")
        sources({"sources": [f.get("source")] if f.get("source") else []}, where)
    if problems:
        raise FactsCheckError("Company facts check failed:\n- " + "\n- ".join(problems))
