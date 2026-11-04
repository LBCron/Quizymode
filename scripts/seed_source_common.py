from __future__ import annotations

import csv
import json
import subprocess
import re
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ITEMS_ROOT = ROOT / "data" / "seed-source" / "items"
SOURCE_COLLECTIONS_ROOT = ROOT / "data" / "seed-source" / "collections" / "public"
REGISTRY_ROOT = ROOT / "data" / "seed-source" / "_registry"
DEV_SELECTION_PATH = ROOT / "data" / "seed-dev" / "selection.json"
SEED_DEV_ITEMS_ROOT = ROOT / "data" / "seed-dev" / "items"
SEED_DEV_COLLECTIONS_ROOT = ROOT / "data" / "seed-dev" / "collections"
CURATED_ASSETS_ROOT = ROOT / "src" / "Quizymode.Web" / "src" / "assets" / "curated"
QUESTION_IMAGE_KEY_PATTERN = re.compile(r"^curated:[a-z0-9-]+(/[a-z0-9-]+)+$")
QUESTION_IMAGE_KEY_MAX = 100
QUESTION_IMAGE_ALT_MAX = 300
TAXONOMY_YAML_PATH = ROOT / "docs" / "quizymode_taxonomy.yaml"
TAXONOMY_SEED_SQL_PATH = ROOT / "docs" / "quizymode_taxonomy_seed.sql"
SITEMAP_PATH = ROOT / "src" / "Quizymode.Web" / "public" / "sitemap.xml"
SITEMAP_BASE_URL = "https://www.quizymode.com"

# Static app pages: (path, lastmod, changefreq, priority)
_STATIC_PAGES: list[tuple[str, str, str, str]] = [
    ("/",           "2026-04-09", "weekly",  "1.0"),
    ("/categories", "2026-04-12", "weekly",  "0.9"),
    ("/collections","2026-04-12", "weekly",  "0.8"),
    ("/about",      "2026-04-12", "monthly", "0.7"),
    ("/ideas",      "2026-04-09", "weekly",  "0.8"),
    ("/roadmap",    "2026-01-20", "monthly", "0.6"),
    ("/feedback",   "2026-03-30", "monthly", "0.6"),
    ("/privacy",    "2026-04-03", "yearly",  "0.3"),
    ("/terms",      "2026-04-03", "yearly",  "0.3"),
]


@dataclass(frozen=True)
class Scope:
    category: str
    navigation_keyword1: str
    navigation_keyword2: str
    shard: str | None = None


@dataclass
class SourceItem:
    item_id: str
    category: str
    navigation_keyword1: str
    navigation_keyword2: str
    question: str
    correct_answer: str
    incorrect_answers: list[str]
    explanation: str | None
    keywords: list[str] | None
    source: str | None
    path: Path
    index: int
    # Curated question picture (#407): {"key": "curated:flags/fr", "altText": "..."} or None.
    question_image: dict[str, str] | None = None
    # Curated explanation picture (#403): same shape; shown only after the answer is revealed.
    explanation_image: dict[str, str] | None = None
    # Starter quiz (#462): "world" and one-line wow fact, set together or not at all.
    starter_world: str | None = None
    wow_line: str | None = None


STARTER_WORLDS = ("flags", "genai", "space", "animals", "food", "time", "body", "places")
MAX_WOW_LINE_LENGTH = 140


@dataclass
class PublicCollection:
    collection_id: str
    name: str
    description: str | None
    item_ids: list[str]
    path: Path


@dataclass(frozen=True)
class TaxonomyScope:
    category: str
    navigation_keyword1: str
    navigation_keyword2: str


def parse_scope_from_path(path: Path) -> Scope:
    parts = path.stem.split(".")
    if len(parts) < 3:
        raise ValueError(f"Unsupported seed filename format: {path}")

    shard: str | None = None
    if len(parts) == 4 and parts[3].isdigit():
        shard = parts[3]
        parts = parts[:3]
    elif len(parts) != 3:
        raise ValueError(f"Unsupported seed filename format: {path}")

    nav2 = re.sub(r"-p\d+$", "", parts[2])
    return Scope(parts[0], parts[1], nav2, shard)


def normalize_question(text: str) -> str:
    return " ".join(text.lower().split())


def question_image_key(item: SourceItem) -> str:
    """Image key used in item identity; empty string for text-only items."""
    return (item.question_image or {}).get("key", "")


def question_identity(question: str, image: dict[str, Any] | None) -> tuple[str, str]:
    """An item is identified by its normalized question text plus its question image key (#407)."""
    key = image.get("key", "") if isinstance(image, dict) else ""
    return normalize_question(question), str(key)


def parse_image(value: Any, where: str, field: str) -> dict[str, str] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{where}: {field} must be an object with key and altText.")
    return {
        "key": str(value.get("key", "")).strip(),
        "altText": str(value.get("altText", "")).strip(),
    }


def parse_question_image(value: Any, where: str) -> dict[str, str] | None:
    return parse_image(value, where, "questionImage")


def parse_explanation_image(value: Any, where: str) -> dict[str, str] | None:
    return parse_image(value, where, "explanationImage")


def curated_asset_path(key: str) -> Path:
    """Source .webp path for a curated image key such as 'curated:flags/fr'."""
    return CURATED_ASSETS_ROOT / (key.removeprefix("curated:") + ".webp")


def answer_in_alt_text(answer: str, alt: str) -> bool:
    """True when a word in the alt text starts with the answer.

    Only the left side is bounded: 'Oman' is not found inside 'Roman', but demonyms that start with the
    answer ('Omani', 'Cuban', 'Mexican') are caught.
    """
    if not answer:
        return False
    return re.search(rf"(?<![^\W_]){re.escape(answer)}", alt, re.IGNORECASE) is not None


def _validate_image_reference(
    image: dict[str, str], where: str, field: str
) -> tuple[list[str], str]:
    """Key format, asset existence and alt text shape shared by both picture slots; returns (errors, alt)."""
    errors: list[str] = []
    key = image.get("key", "")
    alt = image.get("altText", "")

    if len(key) > QUESTION_IMAGE_KEY_MAX or not QUESTION_IMAGE_KEY_PATTERN.match(key):
        errors.append(
            f"{where}: {field}.key '{key}' must look like 'curated:folder/name' "
            f"(lowercase letters, digits, hyphens; max {QUESTION_IMAGE_KEY_MAX} characters)."
        )
    elif not curated_asset_path(key).is_file():
        errors.append(
            f"{where}: {field}.key '{key}' has no asset at "
            f"src/Quizymode.Web/src/assets/curated/{key.removeprefix('curated:')}.webp."
        )

    if not alt or len(alt) > QUESTION_IMAGE_ALT_MAX or any(ord(ch) < 32 or 127 <= ord(ch) <= 159 for ch in alt):
        errors.append(
            f"{where}: {field}.altText is required (1-{QUESTION_IMAGE_ALT_MAX} characters, "
            f"no line breaks or control characters)."
        )
        return errors, ""
    return errors, alt


def validate_question_image(item: SourceItem) -> list[str]:
    image = item.question_image
    if image is None:
        return []

    where = f"{item.path} item {item.index}"
    errors, alt = _validate_image_reference(image, where, "questionImage")
    if alt and answer_in_alt_text(item.correct_answer, alt):
        errors.append(f"{where}: questionImage.altText must not contain the correct answer.")
    return errors


def validate_explanation_image(item: SourceItem) -> list[str]:
    """The explanation picture is only shown after reveal, so its alt text may name the answer (#403)."""
    image = item.explanation_image
    if image is None:
        return []

    where = f"{item.path} item {item.index}"
    errors, _ = _validate_image_reference(image, where, "explanationImage")
    if not (item.explanation or "").strip():
        errors.append(f"{where}: explanationImage requires a non-empty explanation.")
    return errors


def is_guid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


def question_prefix(text: str, limit: int = 50) -> str:
    collapsed = " ".join(text.split())
    return collapsed[:limit]


def canonicalize_item_payload(item: SourceItem) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "itemId": item.item_id,
        "category": item.category,
        "navigationKeyword1": item.navigation_keyword1,
        "navigationKeyword2": item.navigation_keyword2,
        "question": item.question,
        "correctAnswer": item.correct_answer,
        "incorrectAnswers": item.incorrect_answers,
    }
    if item.explanation:
        payload["explanation"] = item.explanation
    if item.keywords:
        payload["keywords"] = item.keywords
    if item.source:
        payload["source"] = item.source
    if item.question_image:
        payload["questionImage"] = {
            "key": item.question_image["key"],
            "altText": item.question_image["altText"],
        }
    if item.explanation_image:
        payload["explanationImage"] = {
            "key": item.explanation_image["key"],
            "altText": item.explanation_image["altText"],
        }
    if item.starter_world:
        payload["starterWorld"] = item.starter_world
    if item.wow_line:
        payload["wowLine"] = item.wow_line
    return payload


def validate_starter_fields(item: SourceItem) -> list[str]:
    where = f"{item.path} item {item.index}"
    errors: list[str] = []
    if (item.starter_world is None) != (item.wow_line is None):
        errors.append(f"{where}: starterWorld and wowLine must be set together.")
    if item.starter_world is not None and item.starter_world not in STARTER_WORLDS:
        errors.append(f"{where}: starterWorld must be one of {', '.join(STARTER_WORLDS)}.")
    if item.wow_line is not None and len(item.wow_line) > MAX_WOW_LINE_LENGTH:
        errors.append(f"{where}: wowLine must be at most {MAX_WOW_LINE_LENGTH} characters.")
    if item.wow_line is not None and any(ch in item.wow_line for ch in "\r\n\t"):
        errors.append(f"{where}: wowLine must be a single line.")
    return errors


def load_source_items(source_root: Path = SOURCE_ITEMS_ROOT) -> list[SourceItem]:
    items: list[SourceItem] = []
    for path in sorted(source_root.rglob("*.json")):
        scope = parse_scope_from_path(path)
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            raise ValueError(f"{path}: expected a JSON array.")

        for index, item in enumerate(raw):
            if not isinstance(item, dict):
                raise ValueError(f"{path} item {index}: expected an object.")

            item_id = str(item.get("itemId", "")).strip()
            if not item_id:
                raise ValueError(f"{path} item {index}: missing itemId.")
            if not is_guid(item_id):
                raise ValueError(f"{path} item {index}: itemId must be a GUID.")

            items.append(
                SourceItem(
                    item_id=item_id,
                    category=str(item.get("category", scope.category)).strip(),
                    navigation_keyword1=str(item.get("navigationKeyword1", scope.navigation_keyword1)).strip(),
                    navigation_keyword2=str(item.get("navigationKeyword2", scope.navigation_keyword2)).strip(),
                    question=str(item.get("question", "")).strip(),
                    correct_answer=str(item.get("correctAnswer", "")).strip(),
                    incorrect_answers=[str(value).strip() for value in item.get("incorrectAnswers", [])],
                    explanation=_optional_str(item.get("explanation")),
                    keywords=_optional_string_list(item.get("keywords")),
                    source=_optional_str(item.get("source")),
                    path=path,
                    index=index,
                    question_image=parse_question_image(item.get("questionImage"), f"{path} item {index}"),
                    explanation_image=parse_explanation_image(item.get("explanationImage"), f"{path} item {index}"),
                    starter_world=_optional_str(item.get("starterWorld")),
                    wow_line=_optional_str(item.get("wowLine")),
                )
            )

    return items


def load_public_collections(collections_root: Path = SOURCE_COLLECTIONS_ROOT) -> list[PublicCollection]:
    if not collections_root.exists():
        return []

    collections: list[PublicCollection] = []
    for path in sorted(collections_root.rglob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{path}: expected an object.")

        collections.append(
            PublicCollection(
                collection_id=str(raw.get("collectionId", "")).strip(),
                name=str(raw.get("name", "")).strip(),
                description=_optional_str(raw.get("description")),
                item_ids=[str(value).strip() for value in raw.get("itemIds", [])],
                path=path,
            )
        )

    return collections


def validate_source(
    items: list[SourceItem],
    collections: list[PublicCollection],
) -> list[str]:
    errors: list[str] = []
    seen_item_ids: dict[str, SourceItem] = {}
    seen_questions: dict[tuple[str, str], SourceItem] = {}
    taxonomy_scopes = load_taxonomy_scopes()

    for item in items:
        scope = parse_scope_from_path(item.path)
        if not is_guid(item.item_id):
            errors.append(f"{item.path} item {item.index}: itemId must be a GUID.")
        if item.category != scope.category:
            errors.append(f"{item.path} item {item.index}: category does not match filename scope.")
        if item.navigation_keyword1 != scope.navigation_keyword1:
            errors.append(f"{item.path} item {item.index}: navigationKeyword1 does not match filename scope.")
        if item.navigation_keyword2 != scope.navigation_keyword2:
            errors.append(f"{item.path} item {item.index}: navigationKeyword2 does not match filename scope.")
        taxonomy_scope = TaxonomyScope(
            category=item.category,
            navigation_keyword1=item.navigation_keyword1,
            navigation_keyword2=item.navigation_keyword2,
        )
        if taxonomy_scope not in taxonomy_scopes:
            errors.append(
                f"{item.path} item {item.index}: "
                f"'{item.category}' / '{item.navigation_keyword1}' / '{item.navigation_keyword2}' "
                f"is missing from docs/quizymode_taxonomy.yaml."
            )
        if not item.question:
            errors.append(f"{item.path} item {item.index}: question is required.")
        if not item.correct_answer:
            errors.append(f"{item.path} item {item.index}: correctAnswer is required.")
        errors.extend(validate_question_image(item))
        errors.extend(validate_explanation_image(item))
        errors.extend(validate_starter_fields(item))

        existing_id = seen_item_ids.get(item.item_id)
        if existing_id is not None:
            errors.append(
                f"Duplicate itemId '{item.item_id}' found in {existing_id.path} and {item.path}."
            )
        else:
            seen_item_ids[item.item_id] = item

        normalized = question_identity(item.question, item.question_image)
        existing_q = seen_questions.get(normalized)
        if existing_q is not None:
            image_note = f" with picture '{normalized[1]}'" if normalized[1] else ""
            errors.append(
                f"Duplicate question '{item.question}'{image_note} found in {existing_q.path}#{existing_q.index} and {item.path}#{item.index}."
            )
        else:
            seen_questions[normalized] = item

    known_item_ids = set(seen_item_ids)
    for collection in collections:
        if not collection.collection_id:
            errors.append(f"{collection.path}: collectionId is required.")
        elif not is_guid(collection.collection_id):
            errors.append(f"{collection.path}: collectionId must be a GUID.")
        if not collection.name:
            errors.append(f"{collection.path}: name is required.")
        missing = [item_id for item_id in collection.item_ids if item_id not in known_item_ids]
        if missing:
            errors.append(f"{collection.path}: missing itemIds referenced: {', '.join(missing)}")

    return errors


def write_items_bundle(items: list[SourceItem], path: Path = REGISTRY_ROOT / "items-bundle.json") -> None:
    REGISTRY_ROOT.mkdir(parents=True, exist_ok=True)
    write_json(path, [canonicalize_item_payload(item) for item in items])


def _load_committed_source_file_dates() -> dict[str, str]:
    try:
        result = subprocess.run(
            ["git", "show", "HEAD:data/seed-source/_registry/source-file-index.json"],
            capture_output=True,
            text=True,
            cwd=ROOT,
            check=False,
        )
    except FileNotFoundError:
        result = subprocess.CompletedProcess(args=[], returncode=1, stdout="")

    if result.returncode != 0:
        try:
            raw_index = json.loads((REGISTRY_ROOT / "source-file-index.json").read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return {}
    else:
        try:
            raw_index = json.loads(result.stdout)
        except json.JSONDecodeError:
            return {}

    files = raw_index.get("files", [])
    if not isinstance(files, list):
        return {}

    dates: dict[str, str] = {}
    for entry in files:
        if not isinstance(entry, dict):
            continue
        path = entry.get("path")
        modified_at = entry.get("modifiedAt")
        if isinstance(path, str) and isinstance(modified_at, str):
            dates[path] = modified_at
    return dates


def _get_dirty_source_paths() -> set[str]:
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain=v1", "--untracked-files=all", "--", "data/seed-source/items/"],
            capture_output=True,
            text=True,
            cwd=ROOT,
            check=False,
        )
    except FileNotFoundError:
        return set()

    dirty_paths: set[str] = set()
    for raw_line in result.stdout.splitlines():
        if len(raw_line) < 4:
            continue
        path_text = raw_line[3:].strip()
        if " -> " in path_text:
            path_text = path_text.rsplit(" -> ", 1)[1].strip()
        dirty_paths.add(path_text.replace("\\", "/"))
    return dirty_paths


def _get_last_committed_file_date(path: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%cI", "--", path.relative_to(ROOT).as_posix()],
            capture_output=True,
            text=True,
            cwd=ROOT,
            check=False,
        )
    except FileNotFoundError:
        return None

    if result.returncode != 0:
        return None

    text = result.stdout.strip()
    return text or None


def _get_file_git_dates(paths: list[Path], current_modified_at: str | None = None) -> dict[Path, str | None]:
    """Return stable modifiedAt values for source files.

    Unchanged files keep the value already committed in source-file-index.json.
    Dirty or newly tracked files receive the current generation timestamp.
    Missing entries fall back to the file's last git commit date.
    """
    from datetime import datetime, timezone

    dates: dict[Path, str | None] = {}
    committed_dates = _load_committed_source_file_dates()
    dirty_paths = _get_dirty_source_paths()
    if current_modified_at is None:
        current_modified_at = datetime.now(timezone.utc).isoformat()

    for path in paths:
        relative_path = path.relative_to(ROOT).as_posix()
        if relative_path in dirty_paths:
            dates[path] = current_modified_at
            continue

        committed_date = committed_dates.get(relative_path)
        if committed_date is not None:
            dates[path] = committed_date
            continue

        dates[path] = _get_last_committed_file_date(path)
    return dates


def write_source_file_index(
    items: list[SourceItem],
    path: Path = REGISTRY_ROOT / "source-file-index.json",
) -> None:
    from collections import defaultdict
    from datetime import datetime, timezone

    by_source: dict[Path, list[SourceItem]] = defaultdict(list)
    for item in items:
        by_source[item.path].append(item)

    source_paths = sorted(by_source.keys())
    generated_at = datetime.now(timezone.utc).isoformat()
    git_dates = _get_file_git_dates(source_paths, generated_at)

    files = []
    for source_path in source_paths:
        scope = parse_scope_from_path(source_path)
        files.append({
            "path": source_path.relative_to(ROOT).as_posix(),
            "category": scope.category,
            "nav1": scope.navigation_keyword1,
            "nav2": scope.navigation_keyword2,
            "itemCount": len(by_source[source_path]),
            "modifiedAt": git_dates.get(source_path),
        })

    index = {
        "generatedAt": generated_at,
        "totalItems": len(items),
        "files": files,
    }
    write_json(path, index)


def write_sitemap(
    items: list[SourceItem],
    path: Path = SITEMAP_PATH,
    base_url: str = SITEMAP_BASE_URL,
) -> None:
    from collections import defaultdict
    from datetime import datetime, timezone

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # One git log call for all source files
    source_paths = sorted({item.path for item in items})
    raw_dates = _get_file_git_dates(source_paths)

    # L2 dates: (category, nav1, nav2) -> max date across all contributing source files
    l2_dates: dict[tuple[str, str, str], str] = {}
    for source_path in source_paths:
        raw = raw_dates.get(source_path)
        date = raw[:10] if raw else today
        scope = parse_scope_from_path(source_path)
        key = (scope.category, scope.navigation_keyword1, scope.navigation_keyword2)
        if key not in l2_dates or date > l2_dates[key]:
            l2_dates[key] = date

    # L1 dates: max of all L2 dates under (category, nav1)
    l1_dates: dict[tuple[str, str], str] = defaultdict(str)
    for (cat, nav1, _), date in l2_dates.items():
        if date > l1_dates[(cat, nav1)]:
            l1_dates[(cat, nav1)] = date

    # Category dates: max of all L1 dates under category
    cat_dates: dict[str, str] = defaultdict(str)
    for (cat, _), date in l1_dates.items():
        if date > cat_dates[cat]:
            cat_dates[cat] = date

    def url_block(loc: str, lastmod: str, changefreq: str, priority: str) -> str:
        return (
            "  <url>\n"
            f"    <loc>{base_url}{loc}</loc>\n"
            f"    <lastmod>{lastmod}</lastmod>\n"
            f"    <changefreq>{changefreq}</changefreq>\n"
            f"    <priority>{priority}</priority>\n"
            "  </url>"
        )

    blocks: list[str] = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']

    for page_path, lastmod, changefreq, priority in _STATIC_PAGES:
        blocks.append(url_block(page_path, lastmod, changefreq, priority))

    for cat in sorted(cat_dates):
        blocks.append(url_block(f"/categories/{cat}", cat_dates[cat], "weekly", "0.8"))
        cat_l1s = sorted(nav1 for (c, nav1) in l1_dates if c == cat)
        for nav1 in cat_l1s:
            blocks.append(url_block(f"/categories/{cat}/{nav1}", l1_dates[(cat, nav1)], "weekly", "0.7"))
            cat_l2s = sorted(nav2 for (c, n1, nav2) in l2_dates if c == cat and n1 == nav1)
            for nav2 in cat_l2s:
                blocks.append(url_block(f"/categories/{cat}/{nav1}/{nav2}", l2_dates[(cat, nav1, nav2)], "weekly", "0.6"))

    blocks.append("</urlset>")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(blocks) + "\n", encoding="utf-8")


def write_item_registry(items: list[SourceItem], path: Path = REGISTRY_ROOT / "item-index.csv") -> None:
    REGISTRY_ROOT.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "ItemId",
                "Category",
                "NavigationKeyword1",
                "NavigationKeyword2",
                "QuestionPrefix50",
                "SourceFile",
            ]
        )
        for item in sorted(items, key=lambda entry: (entry.category, entry.navigation_keyword1, entry.navigation_keyword2, entry.question, entry.item_id)):
            writer.writerow(
                [
                    item.item_id,
                    item.category,
                    item.navigation_keyword1,
                    item.navigation_keyword2,
                    question_prefix(item.question),
                    item.path.relative_to(ROOT).as_posix(),
                ]
            )


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def regenerate_taxonomy_seed_sql() -> None:
    subprocess.run(
        ["dotnet", "run", "--configuration", "Release", "--project", "tools/Quizymode.TaxonomySqlGen"],
        cwd=ROOT,
        check=True,
    )


def wipe_directory(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def next_sharded_file_path(category: str, nav1: str, nav2: str, existing_paths: set[Path], root: Path = SOURCE_ITEMS_ROOT) -> Path:
    base = root / category / f"{category}.{nav1}.{nav2}.json"
    if base not in existing_paths and not base.exists():
        return base

    counter = 2
    while True:
        candidate = root / category / f"{category}.{nav1}.{nav2}.{counter:02d}.json"
        if candidate not in existing_paths and not candidate.exists():
            return candidate
        counter += 1


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _optional_string_list(value: Any) -> list[str] | None:
    if value is None:
        return None
    if not isinstance(value, list):
        raise ValueError("Expected a list of strings.")
    result = [str(item).strip() for item in value if str(item).strip()]
    return result or None


def load_taxonomy_scopes(taxonomy_path: Path = TAXONOMY_YAML_PATH) -> set[TaxonomyScope]:
    scopes: set[TaxonomyScope] = set()
    current_category: str | None = None
    current_l1: str | None = None
    in_root_keywords = False
    in_l1_keywords = False

    for raw_line in taxonomy_path.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue

        indent = len(raw_line) - len(raw_line.lstrip(" "))
        stripped = raw_line.strip()

        if indent == 0 and stripped.endswith(":"):
            current_category = stripped[:-1].strip()
            current_l1 = None
            in_root_keywords = False
            in_l1_keywords = False
            continue

        if current_category is None:
            continue

        if indent == 2 and stripped == "keywords:":
            in_root_keywords = True
            in_l1_keywords = False
            current_l1 = None
            continue

        if indent == 4 and in_root_keywords and stripped.endswith(":"):
            current_l1 = stripped[:-1].strip()
            in_l1_keywords = False
            continue

        if indent == 6 and current_l1 is not None and stripped == "keywords:":
            in_l1_keywords = True
            continue

        if indent == 8 and in_l1_keywords and current_l1 is not None and ":" in stripped:
            l2_slug = stripped.split(":", 1)[0].strip()
            scopes.add(
                TaxonomyScope(
                    category=current_category,
                    navigation_keyword1=current_l1,
                    navigation_keyword2=l2_slug,
                )
            )

    return scopes
