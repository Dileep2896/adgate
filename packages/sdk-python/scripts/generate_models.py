"""Regenerate src/adgate/models.py from the JSON Schemas in packages/schemas/json.

The Zod schemas in packages/schemas are the API contract (docs/api.md); their JSON Schema
export is the only thing this SDK reads, so the Python models can never drift from the TS
ones. Run it from packages/sdk-python:

    python -m scripts.generate_models          # writes src/adgate/models.py
    python -m scripts.generate_models --check  # exit 1 when the checked-in file is stale

The generated file is checked in (tests/test_models_generated.py fails when it is stale)
so that installing the package needs neither node nor datamodel-code-generator.

Four deterministic steps:

1. Combine every <Name>.schema.json into one document under "$defs" (sorted by name), so a
   single module comes out with one class per contract schema.
2. Deduplicate: a nested subschema that is structurally identical to a top-level schema
   becomes a "$ref" to it, so EvaluateResponse.classification is the Classification model
   instead of a copy. A nested schema whose class name would collide with a DIFFERENT
   top-level schema is qualified with its owner (an inline "Creative" inside AuditRecord
   would become AuditRecordCreative), so a contract name always means the contract schema
   of that name and never an inline look-alike that happened to be read first.
3. Hoist: a titled subschema that appears with one and the same shape in several schemas
   (AdvertiserDomain, DisclosurePosition, PolicyCap ...) becomes its own "$def" and every
   occurrence a "$ref", so the module has one AdvertiserDomain and not five numbered
   copies. Names come from the titles the Zod schemas already carry (--use-title-as-name),
   so AuditRecord.creative is AuditCreative exactly as it is in TypeScript.
4. Run datamodel-code-generator with the builtin formatter (no black/isort, so the output
   does not move when a formatter is upgraded) and replace its header with ours.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SCHEMA_DIR = PACKAGE_ROOT.parent / "schemas" / "json"
DEFAULT_OUTPUT = PACKAGE_ROOT / "src" / "adgate" / "models.py"

COMBINED_TITLE = "AdgateContract"
COMMAND = "python -m scripts.generate_models"

HEADER = f"""\
# This file is GENERATED. Do not edit it by hand.
#
# Source:  packages/schemas/json/*.schema.json (the Zod contract in packages/schemas)
# Command: {COMMAND}
#
# pydantic v2 models for the adgate API contract (docs/api.md). Regenerate after any
# schema change; tests/test_models_generated.py fails while this file is stale.
"""

# Flags are part of the output: changing one changes every model, so they live here and
# nowhere else (the staleness test re-runs this exact command).
CODEGEN_ARGS = [
    "--input-file-type",
    "jsonschema",
    "--output-model-type",
    "pydantic_v2.BaseModel",
    "--target-python-version",
    "3.10",
    "--use-standard-collections",
    "--use-union-operator",
    "--use-annotated",
    "--use-schema-description",
    "--use-field-description",
    "--collapse-root-models",
    "--reuse-model",
    "--use-title-as-name",
    "--use-subclass-enum",
    "--disable-timestamp",
    "--formatters",
    "builtin",
]


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def strip_string_formats(node: Any) -> Any:
    """Drop "format": "date-time".

    docs/api.md puts ISO 8601 UTC STRINGS on the wire and IsoTimestamp already pins the exact
    spelling with a pattern. Left in place, the format makes datamodel-code-generator emit
    AwareDatetime, which (a) cannot carry that pattern - pydantic raises "Unable to apply
    constraint 'pattern' ... for schema of type 'datetime'" on the first validation - and
    (b) would re-render every timestamp the gateway signed. Strings round trip byte for byte.
    """
    if isinstance(node, list):
        return [strip_string_formats(item) for item in node]
    if not isinstance(node, dict):
        return node
    return {
        key: strip_string_formats(value)
        for key, value in node.items()
        if not (key == "format" and value == "date-time")
    }


def load_schemas(schema_dir: Path) -> dict[str, dict[str, Any]]:
    """Every <Name>.schema.json in the directory, keyed by Name, sorted by name."""
    schemas: dict[str, dict[str, Any]] = {}
    for path in sorted(schema_dir.glob("*.schema.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        document.pop("$schema", None)
        schemas[path.name[: -len(".schema.json")]] = strip_string_formats(document)
    if not schemas:
        raise SystemExit(f"no *.schema.json files in {schema_dir}")
    return schemas


def _body(schema: dict[str, Any]) -> str:
    """A schema without its description: the same shape described twice is one model."""
    return _canonical({key: value for key, value in schema.items() if key != "description"})


def _class_name(key: str) -> str:
    """How datamodel-code-generator names the model of an untitled property: snake -> Camel."""
    return "".join(part[:1].upper() + part[1:] for part in key.split("_"))


# Keywords whose subschemas describe the same value as their parent, so a property name hint
# travels through them (a nullable object is `anyOf: [ {...}, { type: null } ]`).
TRANSPARENT_KEYWORDS = ("anyOf", "oneOf", "allOf", "items")


def _link(defs: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Replace every subschema that repeats a $def with a $ref to that $def."""
    by_body: dict[str, str] = {}
    for name, schema in defs.items():
        by_body.setdefault(_body(schema), name)
    top_level = set(defs)

    def rewrite(node: Any, owner: str, hint: str | None, root: bool = False) -> Any:
        if isinstance(node, list):
            return [rewrite(item, owner, hint) for item in node]
        if not isinstance(node, dict):
            return node
        referenced = None if root else by_body.get(_body(node))
        if referenced is not None and referenced != owner:
            ref: dict[str, Any] = {"$ref": f"#/$defs/{referenced}"}
            if "description" in node:
                ref["description"] = node["description"]
            return ref
        rewritten: dict[str, Any] = {}
        for key, value in node.items():
            if key == "properties" and isinstance(value, dict):
                rewritten[key] = {k: rewrite(v, owner, k) for k, v in value.items()}
            else:
                carried = hint if key in TRANSPARENT_KEYWORDS else None
                rewritten[key] = rewrite(value, owner, carried)
        title = rewritten.get("title")
        if isinstance(title, str):
            if title in top_level and title != owner:
                rewritten["title"] = f"{owner}{title}"
        elif hint is not None and ("properties" in rewritten or "enum" in rewritten):
            derived = _class_name(hint)
            if derived in top_level and derived != owner:
                rewritten["title"] = f"{owner}{derived}"
        return rewritten

    return {name: rewrite(schema, name, None, root=True) for name, schema in defs.items()}


def _shared_titles(defs: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Titled subschemas that always describe the same shape: one $def each, in walk order."""
    seen: dict[str, list[dict[str, Any]]] = {}

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return
        title = node.get("title")
        if isinstance(title, str) and title not in defs:
            seen.setdefault(title, []).append(node)
        for value in node.values():
            walk(value)

    for schema in defs.values():
        walk(schema)
    hoisted: dict[str, dict[str, Any]] = {}
    for title, occurrences in seen.items():
        if len({_body(occurrence) for occurrence in occurrences}) == 1:
            hoisted[title] = occurrences[0]
    return hoisted


def build_combined(schemas: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """One JSON Schema document holding every contract schema under $defs."""
    defs = _link(schemas)
    defs = _link(dict(sorted({**defs, **_shared_titles(defs)}.items())))
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": COMBINED_TITLE,
        "type": "object",
        "$defs": defs,
    }


def run_codegen(combined: dict[str, Any]) -> str:
    """datamodel-code-generator over the combined document, as raw generated source."""
    with tempfile.TemporaryDirectory() as directory:
        work = Path(directory)
        source = work / "adgate-contract.schema.json"
        source.write_text(json.dumps(combined, indent=2, sort_keys=False) + "\n", encoding="utf-8")
        target = work / "models.py"
        result = subprocess.run(  # a fixed argv, no shell
            [
                sys.executable,
                "-m",
                "datamodel_code_generator",
                "--input",
                str(source),
                "--output",
                str(target),
                *CODEGEN_ARGS,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            sys.stderr.write(result.stdout + result.stderr)
            raise SystemExit("datamodel-codegen failed")
        if "Failed to format code" in result.stderr:
            sys.stderr.write(result.stderr)
            raise SystemExit("datamodel-codegen emitted unformatted (invalid) code")
        return target.read_text(encoding="utf-8")


ROOT_MODEL_RE = re.compile(
    rf"^class {COMBINED_TITLE}\(BaseModel\):\n(?:    .*\n|\n)*?(?=\nclass |\Z)",
    re.MULTILINE,
)


def post_process(generated: str) -> str:
    """Our header, no wrapper model, and a sorted __all__. Deterministic for a given input."""
    body = generated
    body = re.sub(r"\A(?:#.*\n)+", "", body)  # datamodel-codegen's own header
    body, removed = ROOT_MODEL_RE.subn("", body)
    if removed != 1:
        raise SystemExit(f"expected exactly one {COMBINED_TITLE} wrapper model, found {removed}")
    body = re.sub(r"\n{4,}", "\n\n\n", body).strip("\n")
    names = sorted(set(re.findall(r"^class (\w+)\(", body, re.MULTILINE)))
    exported = "\n".join(f'    "{name}",' for name in names)
    return f"{HEADER}\n{body}\n\n\n__all__ = [\n{exported}\n]\n"


def generate(schema_dir: Path) -> str:
    return post_process(run_codegen(build_combined(load_schemas(schema_dir))))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--schemas", type=Path, default=DEFAULT_SCHEMA_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--check",
        action="store_true",
        help="do not write; exit 1 when the file on disk differs",
    )
    args = parser.parse_args(argv)

    rendered = generate(args.schemas)
    if args.check:
        current = args.output.read_text(encoding="utf-8") if args.output.exists() else ""
        if current == rendered:
            print(f"{args.output} is up to date")
            return 0
        print(f"{args.output} is STALE: run {COMMAND}", file=sys.stderr)
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    print(f"wrote {args.output} ({rendered.count(chr(10))} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
