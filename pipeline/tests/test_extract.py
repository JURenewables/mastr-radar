"""Station 2 tests on a tiny fake export that mimics the real XML (UTF-16, catalogue ids)."""

import zipfile
from datetime import date

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from mastr_radar import extract as ex

EXPORT_DATE = date(2026, 10, 30)

CATALOG = {
    "35": "In Betrieb", "31": "In Planung", "37": "Vorübergehend stillgelegt",
    "38": "Endgültig stillgelegt", "472": "Aktiviert", "473": "Deaktiviert",
    "888": "Windenergie an Land", "889": "Windenergie auf See",
    "640": "Nordsee", "639": "Ostsee", "1405": "Hessen", "1407": "Mecklenburg-Vorpommern",
    "1586": "ENERCON GmbH",
    "517": "Organisation (Unternehmen, Personengesellschaft, juristische Person, Behörde, Verband)",
    "518": "Natürliche Person oder Organisation mit Personenbezug",
}  # fmt: skip

OPERATORS = [
    {"MastrNummer": "ABR1", "Personenart": "517", "Firmenname": "Wind GmbH ＆ Co. KG"},
    {"MastrNummer": "ABR2", "Personenart": "518"},
]

BASE = {
    "EinheitSystemstatus": "472", "EinheitBetriebsstatus": "35", "WindAnLandOderAufSee": "888",
    "Bruttoleistung": "3000.000", "Nettonennleistung": "2900.000",
    "Registrierungsdatum": "2019-02-13", "DatumLetzteAktualisierung": "2024-12-13T10:28:30.81",
    "Inbetriebnahmedatum": "2017-09-01", "Bundesland": "1405", "Landkreis": "Werra-Meißner-Kreis",
    "Gemeinde": "Helsa", "Gemeindeschluessel": "06636200", "Postleitzahl": "34298",
    "Breitengrad": "51.27", "Laengengrad": "9.73", "AnlagenbetreiberMastrNummer": "ABR1",
    "NameStromerzeugungseinheit": "WEA 5", "EegMaStRNummer": "EEG1", "Hersteller": "1586",
    "Typenbezeichnung": "E-115", "Nabenhoehe": "149.08", "Rotordurchmesser": "115.71",
    "NameWindpark": "Windpark Kreuzstein",
}  # fmt: skip

UNITS = {
    "SEE01": {},  # company-owned onshore turbine, everything kept
    "SEE02": {"AnlagenbetreiberMastrNummer": "ABR2"},  # private owner → blanked
    "SEE03": {"WindAnLandOderAufSee": "889", "Seelage": "640", "Bundesland": None,
              "Gemeindeschluessel": None, "Breitengrad": "54.3", "Laengengrad": "6.5"},
    "SEE04": {"WindAnLandOderAufSee": "889", "Seelage": "639", "Bundesland": "1407",
              "Gemeindeschluessel": None, "Breitengrad": "54.6", "Laengengrad": "13.0"},
    "SEE05": {"EinheitBetriebsstatus": "38", "AnlagenbetreiberMastrNummer": None},  # no operator
    "SEE06": {"Breitengrad": "60.0"},  # outside Germany → coords nulled
    "SEE07": {"Gemeindeschluessel": "6636"},  # broken municipality code
    "SEE08": {"EinheitSystemstatus": "473"},  # deactivated → skipped
    "SEE09": {"Inbetriebnahmedatum": "2030-01-01", "EinheitBetriebsstatus": "31",
              "GeplantesInbetriebnahmedatum": "2027-06-30"},  # future COD → nulled
    "SEE10": {"Bruttoleistung": "5.5"},  # tiny turbine
}  # fmt: skip


def _xml(root: str, record: str, rows: list[dict]) -> bytes:
    def rec(d):
        return "".join(f"<{k}>{v}</{k}>" for k, v in d.items() if v is not None)

    body = "".join(f"<{record}>{rec(r)}</{record}>" for r in rows)
    return f"<?xml version='1.0' encoding='UTF-16'?><{root}>{body}</{root}>".encode("utf-16")


def make_export(path, units=UNITS):
    rows = [{"EinheitMastrNummer": uid, **{**BASE, **over}} for uid, over in units.items()]
    cat = [{"Id": k, "Wert": v, "KatalogKategorieId": "1"} for k, v in CATALOG.items()]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("Katalogwerte.xml", _xml("Katalogwerte", "Katalogwert", cat))
        zf.writestr("Marktakteure_1.xml", _xml("Marktakteure", "Marktakteur", OPERATORS))
        zf.writestr("EinheitenWind.xml", _xml("EinheitenWind", "EinheitWind", rows))
    return path


@pytest.fixture
def extracted(tmp_path):
    zp = make_export(tmp_path / "Gesamtdatenexport_20261030.zip")
    out = tmp_path / "units.parquet"
    report = ex.extract(zp, out, export_date=EXPORT_DATE)
    table = pq.read_table(out)
    rows = {r["unit_id"]: r for r in table.to_pylist()}
    return table, rows, report


def test_schema_and_row_count(extracted):
    table, rows, report = extracted
    assert table.schema == ex.UNITS_SCHEMA
    assert "SEE08" not in rows and report.skipped_inactive == 1
    assert report.rows == {"wind_onshore": 7, "wind_offshore": 2}


def test_export_date_stored_in_file(tmp_path):
    zp = make_export(tmp_path / "Gesamtdatenexport_20261030.zip")
    ex.extract(zp, tmp_path / "u.parquet", export_date=EXPORT_DATE)
    assert ex.export_date_of(tmp_path / "u.parquet") == EXPORT_DATE


def test_company_turbine_is_complete(extracted):
    r = extracted[1]["SEE01"]
    assert r["technology"] == "wind_onshore"
    assert r["status"] == "operating"
    assert r["state"] == "Hessen"
    assert (r["municipality_key"], r["district_key"], r["state_key"]) == ("06636200", "06636", "06")
    assert r["operator_name"] == "Wind GmbH & Co. KG"  # full-width ampersand normalised
    assert r["manufacturer"] == "ENERCON GmbH"
    assert r["hub_height_m"] == 149.08
    assert r["size_class"] == "1–10 MW"
    assert r["commissioning_date"] == date(2017, 9, 1)
    assert r["last_updated"] == date(2024, 12, 13)
    assert r["eeg_id"] == "EEG1"
    assert (r["lat"], r["lon"]) == (51.27, 9.73)


def test_private_owner_is_blanked(extracted):
    r = extracted[1]["SEE02"]
    assert r["operator_is_person"] is True
    assert r["name"] is None and r["operator_name"] is None
    assert r["lat"] is None and r["lon"] is None
    assert r["district_key"] == "06636"  # still counted in regional totals


def test_unknown_operator_treated_as_private(extracted):
    _, rows, report = extracted
    assert rows["SEE05"]["operator_is_person"] is True
    assert rows["SEE05"]["lat"] is None
    assert rows["SEE05"]["status"] == "permanently_shut_down"
    assert report.unknown_operator == 1


def test_offshore_regions_from_seelage(extracted):
    rows = extracted[1]
    assert (rows["SEE03"]["state"], rows["SEE03"]["state_key"]) == ("Nordsee (offshore)", "OFF_N")
    assert rows["SEE03"]["district_key"] == "OFF_N"
    # Listed under Mecklenburg-Vorpommern in MaStR, still goes to the sea region (D8).
    assert (rows["SEE04"]["state"], rows["SEE04"]["state_key"]) == ("Ostsee (offshore)", "OFF_O")
    assert rows["SEE04"]["technology"] == "wind_offshore"


def test_bad_values_are_nulled_and_counted(extracted):
    _, rows, report = extracted
    assert rows["SEE06"]["lat"] is None and report.nulled_coords == 1
    assert rows["SEE07"]["municipality_key"] is None and report.invalid_ags == 1
    assert rows["SEE09"]["commissioning_date"] is None
    assert rows["SEE09"]["planned_commissioning_date"] == date(2027, 6, 30)  # future is fine
    assert report.nulled_dates == 1
    assert rows["SEE10"]["size_class"] == "<10 kW"


def test_check_passes(extracted):
    table, _, report = extracted
    warnings = ex.check_units(table, export_date=EXPORT_DATE, min_rows={"wind": 5}, report=report)
    assert warnings == []


def test_check_fails_on_too_few_rows(extracted):
    with pytest.raises(ex.UnitsCheckError, match="expected at least 40,000"):
        ex.check_units(extracted[0], export_date=EXPORT_DATE, min_rows={"wind": 40_000})


def test_check_catches_duplicates_and_privacy_leaks(extracted):
    table = extracted[0]
    dup = pa.concat_tables([table, table.slice(0, 1)])
    with pytest.raises(ex.UnitsCheckError, match="not unique"):
        ex.check_units(dup, export_date=EXPORT_DATE, min_rows={})
    leaky = table.set_column(
        table.schema.get_field_index("lat"), "lat", pa.array([50.0] * table.num_rows)
    )
    with pytest.raises(ex.UnitsCheckError, match="PRIVACY"):
        ex.check_units(leaky, export_date=EXPORT_DATE, min_rows={})


def test_check_catches_unknown_status(tmp_path):
    units = {"SEE01": {"EinheitBetriebsstatus": "99999"}}  # not in the catalogue
    zp = make_export(tmp_path / "Gesamtdatenexport_20261030.zip", units)
    ex.extract(zp, tmp_path / "u.parquet", export_date=EXPORT_DATE)
    with pytest.raises(ex.UnitsCheckError, match="status: invalid values"):
        ex.check_units(pq.read_table(tmp_path / "u.parquet"), export_date=EXPORT_DATE, min_rows={})


def test_row_count_jump_is_a_warning(extracted):
    table = extracted[0]
    warnings = ex.check_units(
        table, export_date=EXPORT_DATE, min_rows={}, previous_rows={"wind_onshore": 100}
    )
    assert any("wind_onshore" in w for w in warnings)
