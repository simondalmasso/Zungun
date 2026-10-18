#!/usr/bin/env python3
"""Apply the exact, reviewed supplemental Gradle checksum entries semantically.

The patch can stop applying when the metadata XML is reordered or merged. This
tool reads only added SHA-256 entries from the reviewed patch, preserves their
exact GAV/artifact/hash association, and inserts those same facts idempotently.
It never computes or invents trust hashes.
"""
from __future__ import annotations

import argparse
import re
import xml.etree.ElementTree as ET
from pathlib import Path

NS = "https://schema.gradle.org/dependency-verification"
ET.register_namespace("", NS)
Q = lambda name: f"{{{NS}}}{name}"
COMPONENT = re.compile(r'<component\s+group="([^"]+)"\s+name="([^"]+)"\s+version="([^"]+)"')
ARTIFACT = re.compile(r'<artifact\s+name="([^"]+)"')
SHA256 = re.compile(r'<sha256\s+value="([0-9a-f]{64})')


def parse_supplement(patch_text: str) -> set[tuple[str, str, str, str, str]]:
    """Return exact (group, name, version, artifact filename, sha256) additions."""
    component: tuple[str, str, str] | None = None
    artifact: str | None = None
    expected: set[tuple[str, str, str, str, str]] = set()
    for raw in patch_text.splitlines():
        if raw.startswith(("diff --git ", "index ", "--- ", "+++ ", "@@")):
            continue
        if not raw or raw[0] not in " +":
            continue
        prefix, body = raw[0], raw[1:]
        component_match = COMPONENT.search(body)
        if component_match:
            component = component_match.groups()
            artifact = None
        artifact_match = ARTIFACT.search(body)
        if artifact_match:
            artifact = artifact_match.group(1)
        sha_match = SHA256.search(body)
        if prefix == "+" and sha_match:
            if component is None or artifact is None:
                raise ValueError("SUPPLEMENT_SHA256_WITHOUT_GAV_ARTIFACT_CONTEXT")
            expected.add((*component, artifact, sha_match.group(1)))
        if re.search(r"</artifact\s*>", body):
            artifact = None
        if re.search(r"</component\s*>", body):
            component = None
            artifact = None
    if not expected:
        raise ValueError("EMPTY_GRADLE_VERIFICATION_SUPPLEMENT")
    return expected


def verify_supplement_present(metadata_path: Path, patch_path: Path) -> None:
    """Fail closed unless each reviewed checksum is present under its exact GAV/artifact."""
    expected = parse_supplement(patch_path.read_text(encoding="utf-8"))
    root = ET.parse(metadata_path).getroot()
    indexed = {
        (node.attrib["group"], node.attrib["name"], node.attrib["version"]): node
        for node in root.findall(f".//{Q('component')}")
    }
    missing = []
    for group, name, version, filename, digest in sorted(expected):
        component = indexed.get((group, name, version))
        artifact = None if component is None else next(
            (item for item in component.findall(Q("artifact")) if item.attrib.get("name") == filename),
            None,
        )
        hashes = set() if artifact is None else {
            item.attrib.get("value") for item in artifact.findall(Q("sha256"))
        }
        if digest not in hashes:
            missing.append(f"{group}:{name}:{version}:{filename}:{digest}")
    if missing:
        raise SystemExit("SUPPLEMENT_ENTRIES_MISSING:" + "|".join(missing))


def apply_supplement(metadata_path: Path, patch_path: Path) -> int:
    expected = parse_supplement(patch_path.read_text(encoding="utf-8"))
    tree = ET.parse(metadata_path)
    root = tree.getroot()
    components = root.find(Q("components"))
    if components is None:
        raise SystemExit("VERIFICATION_COMPONENTS_MISSING")
    indexed = {
        (node.attrib["group"], node.attrib["name"], node.attrib["version"]): node
        for node in components.findall(Q("component"))
    }
    added = 0
    for group, name, version, filename, digest in sorted(expected):
        key = (group, name, version)
        component = indexed.get(key)
        if component is None:
            component = ET.SubElement(components, Q("component"), {
                "group": group, "name": name, "version": version,
            })
            indexed[key] = component
        artifact = next(
            (item for item in component.findall(Q("artifact")) if item.attrib.get("name") == filename),
            None,
        )
        if artifact is None:
            artifact = ET.SubElement(component, Q("artifact"), {"name": filename})
        known = {item.attrib.get("value") for item in artifact.findall(Q("sha256"))}
        if digest not in known:
            ET.SubElement(artifact, Q("sha256"), {
                "value": digest,
                "origin": "Reviewed ORDER-080 supplemental patch; exact SHA-256 retained",
            })
            added += 1
    children = sorted(
        list(components),
        key=lambda node: (node.attrib.get("group", ""), node.attrib.get("name", ""), node.attrib.get("version", "")),
    )
    components[:] = children
    for component in children:
        component[:] = sorted(component, key=lambda node: node.attrib.get("name", ""))
    ET.indent(tree, space="   ")
    tree.write(metadata_path, encoding="UTF-8", xml_declaration=True)
    verify_supplement_present(metadata_path, patch_path)
    return added


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--patch", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    if args.check_only:
        verify_supplement_present(args.metadata, args.patch)
        print("SUPPLEMENT_ENTRIES_PRESENT=PASS")
    else:
        added = apply_supplement(args.metadata, args.patch)
        print(f"SUPPLEMENT_EXPECTED={len(parse_supplement(args.patch.read_text(encoding='utf-8')))} ADDED_SHA256={added}")


if __name__ == "__main__":
    main()
