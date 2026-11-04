"""Emit the geography > flags > countries picture items (#407 PR 2).

Reads scripts/flag_country_data.py (names, regions, designs) and data/curated-media/flags/manifest.json
(Commons provenance), then writes data/seed-source/items/geography/geography.flags.countries.NNN.json in
100-item chunks. Items that are not flag pictures (the hand-written flag trivia that predates this set) are
read from the existing files, keep their itemId, and stay first.

Deterministic: item IDs are uuid5 over a fixed namespace and the iso2 code, and wrong answers are chosen with
a fixed hash order, so running the script twice produces identical files.

Run: python scripts/emit_flag_items.py
Then: python scripts/build_item_registry.py
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import uuid
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

from flag_country_data import COUNTRIES, EXTRA_EXPLANATION, SIMILAR_GROUPS, STARTER  # noqa: E402
from seed_source_common import (  # noqa: E402
    ROOT,
    SOURCE_ITEMS_ROOT,
    answer_in_alt_text,
    write_json,
)

FLAG_NAMESPACE = uuid.UUID("5e6f1c1a-4b7d-4a3e-9d2c-407f1a9c0de1")
QUESTION = "Which country's flag is this?"
SCOPE_DIR = SOURCE_ITEMS_ROOT / "geography"
CHUNK_PREFIX = "geography.flags.countries"
CHUNK_SIZE = 100
MANIFEST_PATH = ROOT / "data" / "curated-media" / "flags" / "manifest.json"
WRONG_ANSWER_COUNT = 3


def item_id_for(iso2: str) -> str:
    return str(uuid.uuid5(FLAG_NAMESPACE, f"flag-country:{iso2}"))


def stable_rank(iso2: str, other: str) -> str:
    return hashlib.sha256(f"{FLAG_NAMESPACE}:{iso2}:{other}".encode("utf-8")).hexdigest()


def choose_wrong_answers(iso2: str, region: str, regions: dict[str, str]) -> list[str]:
    """Same-region countries only: look-alikes first (SIMILAR_GROUPS), then a fixed hash order."""
    chosen: list[str] = []
    for group in SIMILAR_GROUPS:
        if iso2 not in group:
            continue
        for other in group:
            if other != iso2 and regions.get(other) == region and other not in chosen:
                chosen.append(other)
    rest = sorted(
        (code for code, code_region in regions.items() if code_region == region and code != iso2 and code not in chosen),
        key=lambda code: stable_rank(iso2, code),
    )
    # Look-alikes are ranked by the hash too so that large groups do not always show the same three.
    chosen.sort(key=lambda code: stable_rank(iso2, code))
    return (chosen + rest)[:WRONG_ANSWER_COUNT]


def load_non_picture_items() -> list[dict]:
    kept: list[dict] = []
    for path in sorted(SCOPE_DIR.glob(f"{CHUNK_PREFIX}*.json")):
        for item in json.loads(path.read_text(encoding="utf-8")):
            if "questionImage" not in item:
                kept.append(item)
    return kept


def build_flag_items() -> list[dict]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    by_iso = {entry["iso2"]: entry for entry in manifest["entries"]}
    names = {row[0]: row[1] for row in COUNTRIES}
    regions = {row[0]: row[2] for row in COUNTRIES}

    unknown_starter = set(STARTER) - set(names)
    if unknown_starter:
        raise SystemExit(f"STARTER has unknown iso2 codes: {sorted(unknown_starter)}")

    items: list[dict] = []
    for iso2, name, region, _commons_file, design in sorted(COUNTRIES, key=lambda row: row[1].casefold()):
        entry = by_iso.get(iso2)
        if entry is None or entry["country"] != name or entry["region"] != region:
            raise SystemExit(f"{iso2}: manifest entry is missing or does not match flag_country_data.py")
        if not entry.get("sourcePageUrl"):
            raise SystemExit(f"{iso2}: manifest entry has no sourcePageUrl; run build_flag_images.mjs first")
        if answer_in_alt_text(name, design):
            raise SystemExit(f"{iso2}: design text must not contain the country name")

        explanation = f"This is the flag of {name}. {design}"
        if iso2 in EXTRA_EXPLANATION:
            explanation = f"{explanation} {EXTRA_EXPLANATION[iso2]}"

        item = {
            "itemId": item_id_for(iso2),
            "category": "geography",
            "navigationKeyword1": "flags",
            "navigationKeyword2": "countries",
            "question": QUESTION,
            "correctAnswer": name,
            "incorrectAnswers": [names[code] for code in choose_wrong_answers(iso2, region, regions)],
            "explanation": explanation,
            "keywords": [region],
            "source": entry["sourcePageUrl"],
            "questionImage": {"key": f"curated:flags/{iso2}", "altText": design},
        }
        if iso2 in STARTER:
            wow_line = STARTER[iso2]
            if len(wow_line) > 140 or any(len(a) > 30 for a in [name, *item["incorrectAnswers"]]):
                raise SystemExit(f"{iso2}: starter wowLine must be <= 140 chars and every answer <= 30 chars")
            item["starterWorld"] = "flags"
            item["wowLine"] = STARTER[iso2]
        items.append(item)
    return items


def main() -> int:
    existing = load_non_picture_items()
    flags = build_flag_items()
    all_items = existing + flags

    for stale in SCOPE_DIR.glob(f"{CHUNK_PREFIX}*.json"):
        stale.unlink()

    chunks = [all_items[i : i + CHUNK_SIZE] for i in range(0, len(all_items), CHUNK_SIZE)]
    for number, chunk in enumerate(chunks, start=1):
        write_json(SCOPE_DIR / f"{CHUNK_PREFIX}.{number:03d}.json", chunk)

    assert re.fullmatch(r"[0-9a-f-]{36}", flags[0]["itemId"])
    print(f"Wrote {len(all_items)} items ({len(existing)} existing, {len(flags)} flag pictures) in {len(chunks)} chunks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
