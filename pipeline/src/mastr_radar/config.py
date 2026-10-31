"""Pipeline settings, loaded from config/settings.yaml."""

from dataclasses import dataclass
from pathlib import Path

import yaml

PIPELINE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = PIPELINE_ROOT.parent
DEFAULT_CONFIG = PIPELINE_ROOT / "config" / "settings.yaml"


@dataclass(frozen=True)
class DownloadSettings:
    page_url: str
    max_attempts: int
    backoff_seconds: float
    timeout_seconds: float
    max_age_days: int
    min_size_bytes: int
    required_files: tuple[str, ...]


@dataclass(frozen=True)
class CrosscheckSettings:
    url: str
    timeout_seconds: float
    tolerance_pct: float
    series: dict[str, str]


@dataclass(frozen=True)
class MonitorSettings:
    first_year: int
    targets_2030_mw: dict[str, float]
    point_min_kw: float
    repowering_age_years: int


@dataclass(frozen=True)
class HubSettings:
    keep_days: int
    smard_base_url: str
    smard_regions: tuple[str, ...]
    smard_generation: dict[str, int]
    smard_demand: int
    smard_residual_load: int
    dwd: dict[str, str]


@dataclass(frozen=True)
class Settings:
    min_capacity_mw: float
    technologies: tuple[str, ...]
    data_dir: Path
    output_dir: Path
    download: DownloadSettings
    crosscheck: CrosscheckSettings
    monitor: MonitorSettings
    hub: HubSettings
    auction_rounds: tuple[dict, ...] = ()

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"


def load_settings(path: Path = DEFAULT_CONFIG) -> Settings:
    raw = yaml.safe_load(path.read_text())
    dl = raw["download"]
    cc = raw["crosscheck"]
    mo = raw["monitor"]
    hub = raw["hub"]
    return Settings(
        min_capacity_mw=float(raw["min_capacity_mw"]),
        technologies=tuple(raw["technologies"]),
        data_dir=REPO_ROOT / raw["data_dir"],
        output_dir=REPO_ROOT / raw["output_dir"],
        download=DownloadSettings(
            page_url=dl["page_url"],
            max_attempts=int(dl["max_attempts"]),
            backoff_seconds=float(dl["backoff_seconds"]),
            timeout_seconds=float(dl["timeout_seconds"]),
            max_age_days=int(dl["max_age_days"]),
            min_size_bytes=int(dl["min_size_bytes"]),
            required_files=tuple(dl["required_files"]),
        ),
        crosscheck=CrosscheckSettings(
            url=cc["url"],
            timeout_seconds=float(cc["timeout_seconds"]),
            tolerance_pct=float(cc["tolerance_pct"]),
            series=dict(cc["series"]),
        ),
        monitor=MonitorSettings(
            first_year=int(mo["first_year"]),
            targets_2030_mw={k: float(v) for k, v in mo["targets_2030_mw"].items()},
            point_min_kw=float(mo["point_min_kw"]),
            repowering_age_years=int(mo["repowering_age_years"]),
        ),
        hub=HubSettings(
            keep_days=int(hub["keep_days"]),
            smard_base_url=hub["smard"]["base_url"],
            smard_regions=tuple(hub["smard"]["regions"]),
            smard_generation={k: int(v) for k, v in hub["smard"]["generation"].items()},
            smard_demand=int(hub["smard"]["demand"]),
            smard_residual_load=int(hub["smard"]["residual_load"]),
            dwd=dict(hub["dwd"]),
        ),
        auction_rounds=tuple(dict(r) for r in raw.get("auctions", {}).get("onshore_rounds", [])),
    )
