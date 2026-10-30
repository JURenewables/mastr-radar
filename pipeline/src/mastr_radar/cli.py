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


def _not_yet(step: str, wp: int) -> None:
    typer.echo(f"'{step}' is not implemented yet (planned for WP{wp}).")
    raise typer.Exit(code=1)


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
def extract() -> None:
    """Station 2: read the export zip into units.parquet."""
    _not_yet("extract", 6)


@app.command()
def aggregate() -> None:
    """Station 3: write the files the website reads."""
    _not_yet("aggregate", 7)


if __name__ == "__main__":
    app()
