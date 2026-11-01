"""Estimated wind yield of a turbine at its location (contract v1.6 draft).

DWD 200 m wind grid → mean speed and Weibull shape at hub height → generic
power curve from rated power and rotor diameter → full-load hours, the EEG
quality factor (Gütefaktor) against the EEG reference site, and the
correction factor (Korrekturfaktor) the award value is multiplied with.

These are estimates for comparing sites, not yield reports.
"""

from __future__ import annotations

import math
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import requests
import yaml

CONFIG = Path(__file__).resolve().parents[2] / "config" / "wind_yield.yaml"
SPEEDS = np.arange(0.25, 30.0, 0.5)  # m/s, bin centres of 0.5 m/s


def load_config() -> dict:
    return yaml.safe_load(CONFIG.read_text())


# --- Wind grid --------------------------------------------------------------


def fetch_grids(cache_dir: Path, cfg: dict | None = None) -> int:
    """Download the DWD grid zips once (they never change). Returns new files."""
    cfg = cfg or load_config()
    cache_dir.mkdir(parents=True, exist_ok=True)
    new = 0
    for name in cfg["dwd"]["files"].values():
        path = cache_dir / name
        if not path.exists():
            r = requests.get(cfg["dwd"]["base_url"] + name, timeout=300)
            r.raise_for_status()
            path.write_bytes(r.content)
            new += 1
    return new


def _read_asc(path: Path) -> tuple[dict, np.ndarray]:
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.endswith(".asc"))
        raw = z.read(name)
    head = raw.split(b"\n", 6)
    hdr = {line.split()[0].decode().lower(): float(line.split()[1]) for line in head[:6]}
    grid = np.array(head[6].split(), dtype=np.int16)
    return hdr, grid.reshape(int(hdr["nrows"]), int(hdr["ncols"]))


@dataclass
class WindGrid:
    hdr: dict
    v100: np.ndarray
    v80: np.ndarray
    k80: np.ndarray
    crs: str

    @classmethod
    def load(cls, cache_dir: Path, cfg: dict | None = None) -> WindGrid:
        """Read the grids, keeping a compact .npz copy next to the zips."""
        cfg = cfg or load_config()
        files = cfg["dwd"]["files"]
        npz = cache_dir / "dwd_wind_grids.npz"
        if npz.exists():
            d = np.load(npz)
            hdr = {
                k: float(d[f"hdr_{k}"])
                for k in ("ncols", "nrows", "xllcorner", "yllcorner", "cellsize")
            }
            return cls(hdr, d["v100"], d["v80"], d["k80"], cfg["dwd"]["crs"])
        hdr, v100 = _read_asc(cache_dir / files["v100"])
        _, v80 = _read_asc(cache_dir / files["v80"])
        _, k80 = _read_asc(cache_dir / files["k80"])
        np.savez_compressed(
            npz,
            v100=v100,
            v80=v80,
            k80=k80,
            **{
                f"hdr_{k}": hdr[k] for k in ("ncols", "nrows", "xllcorner", "yllcorner", "cellsize")
            },
        )
        return cls(hdr, v100, v80, k80, cfg["dwd"]["crs"])

    def sample(self, lon: np.ndarray, lat: np.ndarray) -> dict[str, np.ndarray]:
        """Mean speed at 80 and 100 m (m/s) and Weibull k at each point; NaN outside."""
        from pyproj import Transformer

        x, y = Transformer.from_crs("EPSG:4326", self.crs, always_xy=True).transform(lon, lat)
        cs, nrows = self.hdr["cellsize"], int(self.hdr["nrows"])
        col = np.floor((np.asarray(x) - self.hdr["xllcorner"]) / cs).astype(int)
        row = nrows - 1 - np.floor((np.asarray(y) - self.hdr["yllcorner"]) / cs).astype(int)
        ok = (col >= 0) & (col < int(self.hdr["ncols"])) & (row >= 0) & (row < nrows)
        out = {}
        for key, arr, scale in (
            ("v100", self.v100, 10),
            ("v80", self.v80, 10),
            ("k80", self.k80, 1000),
        ):
            vals = np.full(len(col), np.nan)
            vals[ok] = arr[row[ok], col[ok]]
            vals[vals <= 0] = np.nan
            out[key] = vals / scale
        return out


# --- Yield model ------------------------------------------------------------


def power_curve(rated_kw: float, rotor_m: float, cfg: dict) -> np.ndarray:
    """Generic power curve (kW per speed bin)."""
    pc = cfg["power_curve"]
    area = math.pi * (rotor_m / 2) ** 2
    p = np.minimum(
        rated_kw, 0.5 * pc["air_density"] * area * pc["power_coefficient"] * SPEEDS**3 / 1000
    )
    p[(pc["cut_in_ms"] > SPEEDS) | (pc["cut_out_ms"] < SPEEDS)] = 0.0
    return p


def annual_energy_kwh(curve: np.ndarray, mean_speed: float, k: float) -> float:
    """Gross annual energy for a Weibull wind distribution with this mean and shape."""
    c = mean_speed / math.gamma(1 + 1 / k)
    pdf = (k / c) * (SPEEDS / c) ** (k - 1) * np.exp(-((SPEEDS / c) ** k))
    return float(8760 * np.sum(curve * pdf * 0.5))


def reference_speed(hub_m: float, cfg: dict) -> float:
    r = cfg["reference_site"]
    return (
        r["speed_ms"]
        * math.log(hub_m / r["roughness_m"])
        / math.log(r["height_m"] / r["roughness_m"])
    )


def correction_factor(quality_pct: float, year: int, state: str | None, cfg: dict) -> float:
    """Korrekturfaktor for a quality factor in %, by the EEG table of the bid year."""
    tables = sorted(cfg["correction_tables"].values(), key=lambda t: t["from_year"])
    table = next((t for t in reversed(tables) if year >= t["from_year"]), tables[0])
    pts = sorted((float(q), float(f)) for q, f in table["points"].items())
    if "low_step_states" in table and state not in table["low_step_states"]:
        pts = [p for p in pts if p[0] >= table["floor_elsewhere"]]
    qs, fs = zip(*pts, strict=True)
    return float(np.interp(quality_pct, qs, fs))


def turbine_yield(
    rated_kw: float, rotor_m: float, hub_m: float, site: dict[str, float], cfg: dict
) -> dict | None:
    """Estimated net full-load hours and quality factor (%), or None if implausible."""
    if not all(np.isfinite([rated_kw, rotor_m, hub_m, site["v100"], site["v80"], site["k80"]])):
        return None
    lo, hi = cfg["plausible"]["specific_power_w_m2"]
    sp = rated_kw * 1000 / (math.pi * (rotor_m / 2) ** 2)
    if not lo <= sp <= hi or hub_m <= 0:
        return None
    a_lo, a_hi = cfg["shear_exponent_range"]
    alpha = min(a_hi, max(a_lo, math.log(site["v100"] / site["v80"]) / math.log(100 / 80)))
    v_hub = site["v100"] * (hub_m / 100) ** alpha
    curve = power_curve(rated_kw, rotor_m, cfg)
    gross = annual_energy_kwh(curve, v_hub, site["k80"])
    ref = annual_energy_kwh(curve, reference_speed(hub_m, cfg), cfg["reference_site"]["weibull_k"])
    flh_gross = gross / rated_kw
    f_lo, f_hi = cfg["plausible"]["gross_full_load_hours"]
    if not f_lo <= flh_gross <= f_hi or ref <= 0:
        return None
    return {
        "wind_ms": round(v_hub, 2),
        "flh": flh_gross * (1 - cfg["losses"]),
        "quality_pct": 100 * gross / ref,
    }
