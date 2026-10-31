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
class Settings:
    min_capacity_mw: float
    technologies: tuple[str, ...]
    data_dir: Path
    output_dir: Path
    download: DownloadSettings
    crosscheck: CrosscheckSettings

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"


def load_settings(path: Path = DEFAULT_CONFIG) -> Settings:
    raw = yaml.safe_load(path.read_text())
    dl = raw["download"]
    cc = raw["crosscheck"]
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
    )
