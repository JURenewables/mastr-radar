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


# --- WP10: the other technologies ---

CATALOG_MORE = {
    "2495": "Solare Strahlungsenergie", "853": "Freiflächensolaranlage",
    "852": "Gebäudesolaranlage", "3058": "Steckerfertige Solaranlage (sog. Balkonkraftwerk)",
    "524": "Batterie", "525": "Pumpspeicher", "3002": "Wasserstoffspeicher",
    "727": "Lithium-Batterie", "735": "Biogas", "1065": "Laufwasseranlage",
}  # fmt: skip


def make_full_export(path):
    cat = [
        {"Id": k, "Wert": v, "KatalogKategorieId": "1"}
        for k, v in {**CATALOG, **CATALOG_MORE}.items()
    ]
    common = {k: v for k, v in BASE.items() if k not in ("WindAnLandOderAufSee", "Hersteller")}
    solar = [
        {"EinheitMastrNummer": "SEE_S1", **common, "ArtDerSolaranlage": "853"},
        {"EinheitMastrNummer": "SEE_S3", **common, "ArtDerSolaranlage": "852",
         "Inbetriebnahmedatum": "1975-01-01"},
        {"EinheitMastrNummer": "SEE_S2", **common, "ArtDerSolaranlage": "3058",
         "Bruttoleistung": "0.8", "AnlagenbetreiberMastrNummer": "ABR2"},
    ]  # fmt: skip
    storage = [
        {"EinheitMastrNummer": "SEE_B1", **common, "Technologie": "524",
         "Batterietechnologie": "727", "SpeMastrNummer": "SSE1"},
        {"EinheitMastrNummer": "SEE_B2", **common, "Technologie": "525", "SpeMastrNummer": "SSE2"},
        {"EinheitMastrNummer": "SEE_B3", **common, "Technologie": "3002"},
        {"EinheitMastrNummer": "SEE_B4", **common, "Technologie": "524", "SpeMastrNummer": "SSE3",
         "Inbetriebnahmedatum": "1990-05-01"},
    ]  # fmt: skip
    plants = [
        {"MaStRNummer": "SSE1", "NutzbareSpeicherkapazitaet": "2500.000"},
        # Plant with two units: 48 000 kWh → 24 000 kWh each (8 h on 3 MW).
        {
            "MaStRNummer": "SSE2",
            "NutzbareSpeicherkapazitaet": "48000.000",
            "VerknuepfteEinheitenMaStRNummern": "SEE_B2, SEE_B9",
        },
        # 3 MW battery with 1 000 000 kWh = 333 h: a registration error.
        {"MaStRNummer": "SSE3", "NutzbareSpeicherkapazitaet": "1000000.000"},
    ]
    biomass = [{"EinheitMastrNummer": "SEE_M1", **common, "Hauptbrennstoff": "735"}]
    hydro = [{"EinheitMastrNummer": "SEE_H1", **common, "ArtDerWasserkraftanlage": "1065"}]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("Katalogwerte.xml", _xml("Katalogwerte", "Katalogwert", cat))
        zf.writestr("Marktakteure_1.xml", _xml("Marktakteure", "Marktakteur", OPERATORS))
        zf.writestr("EinheitenSolar_1.xml", _xml("EinheitenSolar", "EinheitSolar", solar))
        zf.writestr(
            "EinheitenStromSpeicher_1.xml",
            _xml("EinheitenStromSpeicher", "EinheitStromSpeicher", storage),
        )
        zf.writestr(
            "AnlagenStromSpeicher_1.xml",
            _xml("AnlagenStromSpeicher", "AnlageStromSpeicher", plants),
        )
        zf.writestr("EinheitenBiomasse.xml", _xml("EinheitenBiomasse", "EinheitBiomasse", biomass))
        zf.writestr("EinheitenWasser.xml", _xml("EinheitenWasser", "EinheitWasser", hydro))
    return path


@pytest.fixture
def full(tmp_path):
    zp = make_full_export(tmp_path / "Gesamtdatenexport_20261030.zip")
    out = tmp_path / "units.parquet"
    report = ex.extract(
        zp, out, export_date=EXPORT_DATE, sources=("solar", "storage", "biomass", "hydro")
    )
    table = pq.read_table(out)
    return table, {r["unit_id"]: r for r in table.to_pylist()}, report


def test_all_technologies(full):
    table, rows, report = full
    assert report.rows == {"solar": 3, "storage": 4, "biomass": 1, "hydro": 1}
    ex.check_units(table, export_date=EXPORT_DATE, min_rows={})


def test_solar_types(full):
    rows = full[1]
    assert rows["SEE_S1"]["solar_type"] == "ground_mounted"
    assert rows["SEE_S2"]["solar_type"] == "balcony"
    assert rows["SEE_S2"]["size_class"] == "<10 kW"
    assert rows["SEE_S2"]["lat"] is None  # private owner


def test_storage_types_and_capacity(full):
    rows = full[1]
    assert rows["SEE_B1"]["storage_technology"] == "battery"
    assert rows["SEE_B1"]["battery_technology"] == "Lithium-Batterie"
    assert rows["SEE_B1"]["storage_capacity_kwh"] == 2500.0  # linked via SpeMastrNummer
    assert rows["SEE_B2"]["storage_technology"] == "pumped_hydro"
    assert rows["SEE_B2"]["storage_capacity_kwh"] == 24_000.0  # plant split over 2 units
    assert rows["SEE_B3"]["storage_technology"] == "other"  # hydrogen
    assert rows["SEE_B3"]["storage_capacity_kwh"] is None


def test_biomass_and_hydro_details(full):
    rows = full[1]
    assert rows["SEE_M1"]["fuel"] == "Biogas"
    assert rows["SEE_H1"]["hydro_type"] == "Laufwasseranlage"
    assert rows["SEE_M1"]["solar_type"] is None


def test_unknown_solar_type_fails_check(tmp_path):
    zp = tmp_path / "Gesamtdatenexport_20261030.zip"
    cat = [{"Id": k, "Wert": v, "KatalogKategorieId": "1"} for k, v in CATALOG.items()]
    rec = {"EinheitMastrNummer": "SEE_X", **BASE, "ArtDerSolaranlage": "77777"}
    with zipfile.ZipFile(zp, "w") as zf:
        zf.writestr("Katalogwerte.xml", _xml("Katalogwerte", "Katalogwert", cat))
        zf.writestr("Marktakteure_1.xml", _xml("Marktakteure", "Marktakteur", OPERATORS))
        zf.writestr("EinheitenSolar_1.xml", _xml("EinheitenSolar", "EinheitSolar", [rec]))
    ex.extract(zp, tmp_path / "u.parquet", export_date=EXPORT_DATE, sources=("solar",))
    with pytest.raises(ex.UnitsCheckError, match="solar_type: invalid values"):
        ex.check_units(pq.read_table(tmp_path / "u.parquet"), export_date=EXPORT_DATE, min_rows={})


def test_quality_rules(full):
    _, rows, report = full
    assert rows["SEE_B4"]["storage_capacity_kwh"] is None  # 333 h per kW: implausible
    assert report.nulled_storage_capacity == 1
    assert rows["SEE_B4"]["commissioning_date"] is None  # battery before 2000
    assert rows["SEE_S3"]["commissioning_date"] is None  # solar before 1983
    assert rows["SEE_S1"]["commissioning_date"] == date(2017, 9, 1)
    assert report.implausible_commissioning == 2


def test_check_catches_impossible_dates(full):
    table = full[0]
    idx = table.schema.get_field_index("commissioning_date")
    bad = table.set_column(idx, "commissioning_date", pa.array([date(1970, 1, 1)] * table.num_rows))
    with pytest.raises(ex.UnitsCheckError, match=r"solar: commissioning dates before 1983-01-01"):
        ex.check_units(bad, export_date=EXPORT_DATE, min_rows={})


def test_operator_register(tmp_path):
    """The company register keeps organisations with their office, never persons."""
    from mastr_radar import extract as ex

    zip_path = tmp_path / "export.zip"
    actors = (
        "<Marktakteure>"
        "<Marktakteur><MastrNummer>ABR1</MastrNummer><Personenart>517</Personenart>"
        "<Firmenname>Windpark Test GmbH</Firmenname><Strasse>Hauptstr.</Strasse>"
        "<Hausnummer>1</Hausnummer><Postleitzahl>12345</Postleitzahl><Ort>Ort</Ort>"
        "<Registergericht>900</Registergericht><Registernummer>HRA 1</Registernummer></Marktakteur>"
        "<Marktakteur><MastrNummer>ABR2</MastrNummer><Personenart>518</Personenart>"
        "<Strasse>Privatweg</Strasse></Marktakteur>"
        "</Marktakteure>"
    )
    catalog = (
        "<Katalogwerte><Katalogwert><Id>517</Id><Wert>Organisation</Wert></Katalogwert>"
        "<Katalogwert><Id>518</Id><Wert>Natürliche Person</Wert></Katalogwert>"
        "<Katalogwert><Id>900</Id><Wert>Amtsgericht Teststadt</Wert></Katalogwert></Katalogwerte>"
    )
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("Marktakteure_1.xml", actors.encode("utf-16"))
        zf.writestr("Katalogwerte.xml", catalog.encode("utf-16"))
    out = tmp_path / "operators.parquet"
    assert ex.write_operator_register(zip_path, out) == 1
    row = pq.read_table(out).to_pylist()[0]
    assert row["name"] == "Windpark Test GmbH" and row["register_court"] == "Amtsgericht Teststadt"
    ex.check_operator_register(out, 1)
    with pytest.raises(ex.UnitsCheckError):
        ex.check_operator_register(out, 5)
