# MaStR Radar pipeline

Python pipeline that downloads the Marktstammdatenregister bulk export and
writes the aggregated files the website reads. See `../CLAUDE.md` for the
overall design.

```bash
uv sync
uv run mastr-radar --help
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

Settings live in `config/settings.yaml`.
