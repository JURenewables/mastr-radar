"""Command-line entry point: `uv run mastr-radar <command>`."""

import logging
from pathlib import Path

import typer

from mastr_radar import __version__
from mastr_radar import download as dl
from mastr_radar.config import load_settings

app = typer.Typer(help="MaStR Radar data pipeline.", no_args_is_help=True)


@app.callback()
def _setup() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


@app.command()
def version() -> None:
    """Print the pipeline version."""
    typer.echo(__version__)


@app.command()
def config() -> None:
    """Show the active settings."""
    s = load_settings()
    typer.echo(f"data_dir:        {s.data_dir}")
    typer.echo(f"output_dir:      {s.output_dir}")
    typer.echo(f"min_capacity_mw: {s.min_capacity_mw}")
    typer.echo(f"technologies:    {', '.join(s.technologies)}")


@app.command()
def download(
    url: str = typer.Option(None, help="Export URL. Default: newest link on the MaStR page."),
    skip_crc: bool = typer.Option(False, help="Skip the slow integrity check (local use only)."),
) -> None:
    """Station 1: download the MaStR bulk export (resumable) and check it."""
    s = load_settings()
    if url:
        source_url = url
        export_date = dl.export_date_from_name(Path(url))
    else:
        source_url, export_date = dl.fetch_export_url(
            s.download.page_url, s.download.timeout_seconds
        )
    dest = s.raw_dir / f"Gesamtdatenexport_{export_date:%Y%m%d}.zip"
    typer.echo(f"Export {export_date}: {source_url}")

    result = None
    if dest.exists():
        typer.echo(f"Already downloaded: {dest}")
    else:
        try:
            result = dl.download_file(
                source_url,
                dest,
                max_attempts=s.download.max_attempts,
                backoff_seconds=s.download.backoff_seconds,
                timeout_seconds=s.download.timeout_seconds,
            )
        except dl.DownloadError as exc:
            typer.echo(f"FAILED: {exc}", err=True)
            raise typer.Exit(code=1) from exc
        typer.echo(
            f"Downloaded {result.size_bytes:,} bytes in {result.duration_seconds:.0f} s "
            f"({result.attempts} attempt(s))."
        )
    _check_and_write_meta(dest, source_url, result, verify_crc=not skip_crc)


@app.command("check-download")
def check_download(
    path: Path = typer.Argument(..., exists=True, dir_okay=False),
    skip_crc: bool = typer.Option(False, help="Skip the slow integrity check."),
) -> None:
    """Station 1 check only, on an existing export zip."""
    _check_and_write_meta(path, None, None, verify_crc=not skip_crc)


def _check_and_write_meta(path: Path, source_url, result, *, verify_crc: bool) -> None:
    s = load_settings()
    try:
        check = dl.check_export(path, s.download, verify_crc=verify_crc)
    except dl.ExportCheckError as exc:
        typer.echo(f"CHECK FAILED: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    meta = dl.write_meta(
        path.parent / "download_meta.json", path, source_url=source_url, check=check, result=result
    )
    typer.echo(
        f"Check passed: {meta['files_checked']} files checked, export date {meta['export_date']}."
    )


@app.command()
def extract(
    zip_path: Path = typer.Argument(None, help="Export zip. Default: newest in data/raw."),
    source: list[str] = typer.Option(None, help="Source types to extract. Default: all."),
) -> None:
    """Station 2: read the export zip into units.parquet and check it."""
    import pyarrow.parquet as pq

    from mastr_radar import extract as ex

    s = load_settings()
    if zip_path is None:
        zips = sorted(s.raw_dir.glob("Gesamtdatenexport_*.zip"))
        if not zips:
            typer.echo("No export zip in data/raw. Run `mastr-radar download` first.", err=True)
            raise typer.Exit(code=1)
        zip_path = zips[-1]
    export_date = dl.export_date_from_name(zip_path)
    out = s.data_dir / "extract" / "units.parquet"
    report_path = out.with_name("extract_report.json")
    previous = ex.read_previous_rows(report_path)

    cfg = ex.load_columns_config()
    source = source or list(cfg["sources"])
    report = ex.extract(zip_path, out, export_date=export_date, sources=tuple(source), cfg=cfg)
    min_rows = {src: cfg["sources"][src]["min_rows"] for src in source}
    try:
        warnings = ex.check_units(
            pq.read_table(out),
            export_date=export_date,
            min_rows=min_rows,
            report=report,
            previous_rows=previous,
        )
    except ex.UnitsCheckError as exc:
        typer.echo(f"CHECK FAILED: {exc}", err=True)
        out.unlink(missing_ok=True)  # a broken station must not feed the next one
        raise typer.Exit(code=1) from exc
    ex.write_report(report_path, report)
    for w in warnings:
        typer.echo(f"WARNING: {w}")
    typer.echo(f"Check passed: {dict(report.rows)} → {out}")


@app.command()
def aggregate() -> None:
    """Station 3: build the files the website reads, then check them."""
    from mastr_radar import aggregate as ag

    s = load_settings()
    units = s.data_dir / "extract" / "units.parquet"
    if not units.exists():
        typer.echo("No units.parquet. Run `mastr-radar extract` first.", err=True)
        raise typer.Exit(code=1)
    manifest = ag.build(
        units,
        s.output_dir,
        operator_name_min_kw=s.min_capacity_mw * 1000,
        monitor_settings=s.monitor,
    )
    try:
        ag.check_explorer_files(s.output_dir, units)
    except ag.ExplorerCheckError as exc:
        typer.echo(f"CHECK FAILED: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(f"Check passed: as of {manifest['as_of']} → {s.output_dir}")

    # Outside cross-check: warns only, never fails the run.
    from datetime import date

    from mastr_radar import crosscheck

    result = crosscheck.run(
        s.output_dir / "kpis.json",
        date.fromisoformat(manifest["as_of"]),
        s.crosscheck,
        s.data_dir / "reports" / "crosscheck.json",
    )
    for row in result["rows"]:
        typer.echo(
            f"Energy-Charts {row['technology']}: ours {row['ours_gw']} GW, "
            f"theirs {row['energy_charts_gw']} GW ({row['diff_pct']:+}%)"
        )
    for w in result["warnings"]:
        typer.echo(f"WARNING: {w}")


@app.command("hub-fetch")
def hub_fetch() -> None:
    """Hub H1: download SMARD series for the last 12 months (cached)."""
    from datetime import date

    from mastr_radar import hub

    s = load_settings()
    n = hub.fetch_smard(s.hub, s.data_dir / "hub" / "smard", date.today())
    typer.echo(f"SMARD: {n} files downloaded.")


@app.command("hub-build")
def hub_build() -> None:
    """Hub H2: build day files in web/public/data/days/, then check them."""
    from datetime import date

    from mastr_radar import hub

    s = load_settings()
    result = hub.build_days(s.hub, s.data_dir / "hub" / "smard", s.output_dir, date.today())
    try:
        hub.check_days(s.output_dir, s.hub)
    except hub.HubCheckError as exc:
        typer.echo(f"CHECK FAILED: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(f"Check passed: {result['written']} days ({result['first']} – {result['last']}).")
    if result["skipped"]:
        typer.echo(f"WARNING: skipped incomplete days: {', '.join(result['skipped'][-5:])}")


@app.command()
def summary() -> None:
    """Print a Markdown run summary (headline numbers, cross-check) for GitHub."""
    from mastr_radar import report

    s = load_settings()
    typer.echo(report.markdown_summary(s.output_dir, s.data_dir / "reports" / "crosscheck.json"))


if __name__ == "__main__":
    app()
