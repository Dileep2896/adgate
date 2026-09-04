"""src/adgate/models.py must be exactly what the schemas generate right now.

This is the check that makes a checked-in generated file safe: change a Zod schema without
running `python -m scripts.generate_models` and CI fails here, so the Python models can never
quietly drift from the TypeScript contract.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:  # running pytest from anywhere but the package root
    sys.path.insert(0, str(PACKAGE_ROOT))

from scripts.generate_models import (  # noqa: E402 - after the sys.path line above
    DEFAULT_OUTPUT,
    DEFAULT_SCHEMA_DIR,
    main,
)

generator_installed = pytest.mark.skipif(
    importlib.util.find_spec("datamodel_code_generator") is None
    or not DEFAULT_SCHEMA_DIR.is_dir(),
    reason="needs the dev extra (datamodel-code-generator) and packages/schemas/json",
)


@generator_installed
def test_models_are_not_stale(tmp_path: Path) -> None:
    regenerated = tmp_path / "models.py"

    assert main(["--output", str(regenerated)]) == 0
    assert regenerated.read_bytes() == DEFAULT_OUTPUT.read_bytes(), (
        "src/adgate/models.py is stale: run `python -m scripts.generate_models`"
    )


@generator_installed
def test_the_check_mode_agrees(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--check"]) == 0
    assert "up to date" in capsys.readouterr().out


@generator_installed
def test_the_check_mode_fails_on_a_stale_file(tmp_path: Path) -> None:
    stale = tmp_path / "models.py"
    stale.write_text("# hand written\n")

    assert main(["--check", "--output", str(stale)]) == 1


def test_the_generated_header_names_the_command() -> None:
    header = DEFAULT_OUTPUT.read_text().splitlines()[:6]
    assert header[0] == "# This file is GENERATED. Do not edit it by hand."
    assert "packages/schemas/json/*.schema.json" in header[2]
    assert "python -m scripts.generate_models" in header[3]
