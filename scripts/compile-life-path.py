#!/usr/bin/env python3
"""Compile data/life-paths/{ISO3}.life-path.yaml → .json for the web app."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.stderr.write("PyYAML required: pip install pyyaml\n")
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
LIFE_PATHS = ROOT / "data" / "life-paths"


def compile_one(iso3: str) -> Path:
    src = LIFE_PATHS / f"{iso3}.life-path.yaml"
    if not src.exists():
        raise FileNotFoundError(src)
    spec = yaml.safe_load(src.read_text(encoding="utf-8"))
    out = LIFE_PATHS / f"{iso3}.life-path.json"
    out.write_text(
        json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "iso3",
        nargs="*",
        help="ISO3 code(s), e.g. EST. Default: all *.life-path.yaml except TEMPLATE.",
    )
    args = parser.parse_args()
    codes = [c.upper() for c in args.iso3] if args.iso3 else [
        p.name.split(".", 1)[0]
        for p in sorted(LIFE_PATHS.glob("*.life-path.yaml"))
        if not p.name.startswith("TEMPLATE")
    ]
    for code in codes:
        path = compile_one(code)
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
