"""Every ```python block of docs/integration.md, checked against this package.

docs/integration.md is a copy-paste guide, so its snippets have to stay valid against the SDK
that is in the tree right now (S29). The TypeScript half of the guide is type checked by
packages/sdk/src/docs-snippets.test.ts; this is the Python half.

Level of checking applied here, stated so nobody mistakes it for more:

1. ``compile(source, name, "exec")`` - the block is valid Python for the interpreter running the
   suite, including indentation and f-strings.
2. every ``import adgate...`` / ``from adgate... import x`` in the block is resolved: the module
   is imported and each imported name must exist on it. A snippet that names a helper the SDK
   removed therefore fails here as soon as the import goes with it.
3. every attribute read off one of those imported names (``Decision.serve``) must exist on the
   real object.

What is NOT checked: the block is never EXECUTED, so nothing here opens a socket, and the types
inside a function body are not inferred - that is what the TypeScript half does for its own
snippets and what mypy does for the SDK itself.

The doc lives outside the installed package, so every test skips when it is not on disk (an
installed sdist, a wheel).
"""

from __future__ import annotations

import ast
import importlib
import re
from pathlib import Path

import pytest

DOC = Path(__file__).resolve().parents[3] / "docs" / "integration.md"
FENCE = re.compile(r"^```python\n(.*?)^```$", re.MULTILINE | re.DOTALL)

pytestmark = pytest.mark.skipif(
    not DOC.exists(), reason="docs/integration.md is not part of an installed package"
)


def _snippets() -> list[tuple[str, str]]:
    """(name, source) for every ```python block, in document order."""
    blocks = FENCE.findall(DOC.read_text()) if DOC.exists() else []
    return [(f"integration.md#python-{index + 1}", block) for index, block in enumerate(blocks)]


SNIPPETS = _snippets()
IDS = [name for name, _ in SNIPPETS]


def test_the_doc_still_has_python_snippets():
    """A regex that stops matching must fail rather than pass an empty list."""
    assert len(SNIPPETS) >= 3


@pytest.mark.parametrize(("name", "source"), SNIPPETS, ids=IDS)
def test_snippet_compiles(name, source):
    compile(source, name, "exec")


def _adgate_imports(name: str, source: str) -> dict[str, object]:
    """{local name: imported object} for everything the snippet takes from adgate."""
    bound: dict[str, object] = {}
    for node in ast.walk(ast.parse(source, name)):
        if isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module != "adgate" and not module.startswith("adgate."):
                continue
            imported = importlib.import_module(module)
            for alias in node.names:
                assert hasattr(imported, alias.name), f"{module} has no {alias.name}"
                bound[alias.asname or alias.name] = getattr(imported, alias.name)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "adgate" or alias.name.startswith("adgate."):
                    bound[alias.asname or alias.name] = importlib.import_module(alias.name)
    return bound


@pytest.mark.parametrize(("name", "source"), SNIPPETS, ids=IDS)
def test_snippet_imports_resolve(name, source):
    """Every name the snippet imports from adgate exists on the module it names."""
    assert _adgate_imports(name, source), f"{name} imports nothing from adgate"


@pytest.mark.parametrize(("name", "source"), SNIPPETS, ids=IDS)
def test_snippet_uses_real_members(name, source):
    """`Decision.serve` and friends: an attribute read off an imported name must exist."""
    bound = _adgate_imports(name, source)
    for node in ast.walk(ast.parse(source, name)):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            owner = bound.get(node.value.id)
            if owner is not None:
                assert hasattr(owner, node.attr), f"{node.value.id} has no {node.attr}"
