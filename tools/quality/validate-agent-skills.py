#!/usr/bin/env python3
"""Validate Agent Skills metadata and local links without executing skill content."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

import yaml
from yaml.constructor import ConstructorError
from yaml.nodes import MappingNode

ROOT = Path(__file__).resolve().parents[2]
SKILLS_ROOT = ROOT / "skills"
FRONTMATTER_RE = re.compile(r"\\A---[ \\t]*\\r?\\n(.*?)\\r?\\n---[ \\t]*(?:\\r?\\n|\\Z)", re.DOTALL)
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
LINK_RE = re.compile(r"(?<!!)\\[[^\\]]*\\]\\(([^)]+)\\)")


class UniqueKeyLoader(yaml.SafeLoader):
    """Safe YAML loader that rejects duplicate keys instead of silently overriding them."""

    def construct_mapping(self, node: MappingNode, deep: bool = False) -> dict:
        if not isinstance(node, MappingNode):
            raise ConstructorError(None, None, "expected a YAML mapping", node.start_mark)

        self.flatten_mapping(node)
        mapping = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            try:
                duplicate = key in mapping
            except TypeError as exc:
                raise ConstructorError(
                    "while constructing a mapping",
                    node.start_mark,
                    "found an unhashable mapping key",
                    key_node.start_mark,
                ) from exc
            if duplicate:
                raise ConstructorError(
                    "while constructing a mapping",
                    node.start_mark,
                    f"duplicate key {key!r}",
                    key_node.start_mark,
                )
            mapping[key] = self.construct_object(value_node, deep=deep)
        return mapping


def parse_frontmatter(path: Path, text: str) -> dict:
    match = FRONTMATTER_RE.match(text)
    if not match:
        raise ValueError("SKILL.md must begin with YAML frontmatter delimited by ---")

    try:
        metadata = yaml.load(match.group(1), Loader=UniqueKeyLoader)
    except yaml.YAMLError as exc:
        raise ValueError(f"invalid YAML frontmatter: {exc}") from exc

    if not isinstance(metadata, dict):
        raise ValueError("frontmatter must be a YAML mapping")
    if not all(isinstance(key, str) for key in metadata):
        raise ValueError("frontmatter keys must be strings")
    for required in ("name", "description"):
        if required not in metadata:
            raise ValueError(f"frontmatter is missing required field {required!r}")

    name = metadata["name"]
    description = metadata["description"]
    if not isinstance(name, str) or not name:
        raise ValueError("frontmatter name must be a non-empty string")
    if len(name) > 64:
        raise ValueError("name exceeds the 64-character limit")
    if not NAME_RE.fullmatch(name):
        raise ValueError("name must use lowercase letters, digits, and single hyphens only")
    if name != path.parent.name:
        raise ValueError(f"name {name!r} must match skill directory {path.parent.name!r}")
    if not isinstance(description, str) or not description.strip():
        raise ValueError("frontmatter description must be a non-empty string")
    if len(description) > 1024:
        raise ValueError("frontmatter description exceeds 1024 characters")
    if "\n" in description:
        raise ValueError("frontmatter description must be a single line")
    return metadata


def check_local_links(skill_file: Path, source: str) -> list[str]:
    issues: list[str] = []
    repo_root = ROOT.resolve()
    for match in LINK_RE.finditer(source):
        target = match.group(1).strip()
        if target.startswith("<") and ">" in target:
            target = target[1 : target.index(">")]
        else:
            target = target.split(maxsplit=1)[0]

        parsed = urlsplit(target)
        if parsed.scheme or target.startswith("//") or not parsed.path:
            continue

        local_path = (skill_file.parent / unquote(parsed.path)).resolve()
        if not local_path.is_relative_to(repo_root):
            issues.append(f"relative Markdown link escapes the repository: {target!r}")
        elif not local_path.is_file():
            issues.append(f"relative Markdown link target does not exist: {target!r}")
    return issues


def main() -> int:
    if not SKILLS_ROOT.is_dir():
        print("ERROR: skills/ directory is missing", file=sys.stderr)
        return 1

    skill_dirs = sorted(path for path in SKILLS_ROOT.iterdir() if path.is_dir())
    if not skill_dirs:
        print("ERROR: no skill directories found under skills/", file=sys.stderr)
        return 1

    errors: list[str] = []
    seen_names: set[str] = set()
    validated = 0

    for skill_dir in skill_dirs:
        skill_file = skill_dir / "SKILL.md"
        label = skill_file.relative_to(ROOT).as_posix()
        if not skill_file.is_file():
            errors.append(f"{label}: every direct child directory under skills/ must contain SKILL.md")
            continue

        try:
            source = skill_file.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            errors.append(f"{label}: cannot read UTF-8 content: {exc}")
            continue

        try:
            metadata = parse_frontmatter(skill_file, source)
        except ValueError as exc:
            errors.append(f"{label}: {exc}")
            continue

        name = metadata["name"]
        if name in seen_names:
            errors.append(f"{label}: duplicate skill name {name!r}")
        seen_names.add(name)

        line_count = len(source.splitlines())
        if line_count > 500:
            errors.append(f"{label}: {line_count} lines exceeds the 500-line repository limit")

        body = FRONTMATTER_RE.sub("", source, count=1).strip()
        if not body:
            errors.append(f"{label}: skill body is empty")

        errors.extend(f"{label}: {issue}" for issue in check_local_links(skill_file, source))
        if not any(error.startswith(f"{label}:") for error in errors):
            print(f"OK {label}: name={name}, {line_count} lines, {len(metadata['description'])} description chars")
        validated += 1

    if errors:
        print("\n".join(f"ERROR: {error}" for error in errors), file=sys.stderr)
        print(f"Skill validation failed: {len(errors)} issue(s), {validated} skill file(s) inspected.", file=sys.stderr)
        return 1

    print(f"Skill validation passed: {validated} skill(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
