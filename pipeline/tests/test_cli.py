from typer.testing import CliRunner

from mastr_radar import __version__
from mastr_radar.cli import app
from mastr_radar.config import load_settings

runner = CliRunner()


def test_version():
    result = runner.invoke(app, ["version"])
    assert result.exit_code == 0
    assert __version__ in result.stdout


def test_settings_load():
    s = load_settings()
    assert s.min_capacity_mw == 1.0
    assert "wind_onshore" in s.technologies
    assert s.output_dir.parts[-3:] == ("web", "public", "data")


def test_unimplemented_steps_fail_clearly():
    result = runner.invoke(app, ["aggregate"])
    assert result.exit_code == 1
    assert "WP7" in result.stdout
