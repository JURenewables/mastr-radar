"""Pipeline settings, loaded from config/settings.yaml."""

from dataclasses import dataclass
from pathlib import Path

import yaml

PIPELINE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = PIPELINE_ROOT.parent
DEFAULT_CONFIG = PIPELINE_ROOT / "config" / "settings.yaml"


@dataclass(frozen=True)
class Settings:
    min_capacity_mw: float
    technologies: tuple[str, ...]
    data_dir: Path
    output_dir: Path


def load_settings(path: Path = DEFAULT_CONFIG) -> Settings:
    raw = yaml.safe_load(path.read_text())
    return Settings(
        min_capacity_mw=float(raw["min_capacity_mw"]),
        technologies=tuple(raw["technologies"]),
        data_dir=REPO_ROOT / raw["data_dir"],
        output_dir=REPO_ROOT / raw["output_dir"],
    )
