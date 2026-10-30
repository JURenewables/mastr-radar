"""Command-line entry point: `uv run mastr-radar <command>`."""

import typer

from mastr_radar import __version__
from mastr_radar.config import load_settings

app = typer.Typer(help="MaStR Radar data pipeline.", no_args_is_help=True)


def _not_yet(step: str, milestone: int) -> None:
    typer.echo(f"'{step}' is not implemented yet (planned for milestone {milestone}).")
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
def download() -> None:
    """Download the MaStR bulk export with open-mastr."""
    _not_yet("download", 2)


@app.command()
def extract() -> None:
    """Turn the downloaded database into slim Parquet files."""
    _not_yet("extract", 3)


@app.command()
def aggregate() -> None:
    """Write the JSON files the website reads."""
    _not_yet("aggregate", 4)


if __name__ == "__main__":
    app()
