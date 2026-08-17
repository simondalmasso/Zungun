#!/usr/bin/env python3
"""Add exact SHA-256 entries for explicitly declared Gradle metadata artifacts.

Gradle can resolve platform/BOM metadata without emitting it during a broad
--write-verification-metadata pass. This tool reads a bounded GAV allow-list,
locates only those resolved artifacts in the clean runner cache, and adds their
actual SHA-256 values to verification-metadata.xml. It never creates trusted
artifact patterns and therefore preserves strict dependency verification.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import xml.etree.ElementTree as ET

NS = "https://schema.gradle.org/dependency-verification"
ET.register_namespace("", NS)
Q = lambda name: f"{{{NS}}}{name}"
ALLOWED_SUFFIXES = {".pom", ".module", ".jar", ".aar"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--metadata", required=True, type=Path)
    parser.add_argument("--components", required=True, type=Path)
    parser.add_argument("--merge-from", type=Path)
    parser.add_argument("--gradle-user-home", required=True, type=Path)
    args = parser.parse_args()

    requested = []
    for raw in args.components.read_text().splitlines():
        value = raw.strip()
        if not value or value.startswith("#"):
            continue
        parts = value.split(":")
        if len(parts) != 3 or not all(parts):
            raise SystemExit(f"INVALID_GAV:{value}")
        requested.append(tuple(parts))
    if not requested:
        raise SystemExit("EMPTY_COMPONENT_ALLOWLIST")

    generated_tree = ET.parse(args.metadata)
    if args.merge_from is not None:
        tree = ET.parse(args.merge_from)
        root = tree.getroot()
        components = root.find(Q("components"))
        generated_components = generated_tree.getroot().find(Q("components"))
        if components is None or generated_components is None:
            raise SystemExit("VERIFICATION_COMPONENTS_MISSING")

        indexed_target = {
            (node.attrib["group"], node.attrib["name"], node.attrib["version"]): node
            for node in components.findall(Q("component"))
        }
        for source_component in generated_components.findall(Q("component")):
            key = (
                source_component.attrib["group"],
                source_component.attrib["name"],
                source_component.attrib["version"],
            )
            target_component = indexed_target.get(key)
            if target_component is None:
                target_component = ET.SubElement(components, Q("component"), dict(source_component.attrib))
                indexed_target[key] = target_component
            target_artifacts = {
                node.attrib["name"]: node for node in target_component.findall(Q("artifact"))
            }
            for source_artifact in source_component.findall(Q("artifact")):
                target_artifact = target_artifacts.get(source_artifact.attrib["name"])
                if target_artifact is None:
                    target_artifact = ET.SubElement(target_component, Q("artifact"), dict(source_artifact.attrib))
                    target_artifacts[source_artifact.attrib["name"]] = target_artifact
                existing = {
                    (node.tag, tuple(sorted(node.attrib.items())))
                    for node in target_artifact
                }
                for source_hash in source_artifact:
                    identity = (source_hash.tag, tuple(sorted(source_hash.attrib.items())))
                    if identity not in existing:
                        ET.SubElement(target_artifact, source_hash.tag, dict(source_hash.attrib))
                        existing.add(identity)
    else:
        tree = generated_tree
        root = tree.getroot()
        components = root.find(Q("components"))
        if components is None:
            raise SystemExit("VERIFICATION_COMPONENTS_MISSING")

    indexed = {
        (node.attrib["group"], node.attrib["name"], node.attrib["version"]): node
        for node in components.findall(Q("component"))
    }
    cache_root = args.gradle_user_home / "caches/modules-2/files-2.1"
    added = []
    for group, name, version in requested:
        directory = cache_root / group / name / version
        files = sorted(
            path for path in directory.rglob("*")
            if path.is_file() and path.suffix in ALLOWED_SUFFIXES
        ) if directory.is_dir() else []
        if not files:
            raise SystemExit(f"RESOLVED_ARTIFACTS_NOT_FOUND:{group}:{name}:{version}:{directory}")
        component = indexed.get((group, name, version))
        if component is None:
            component = ET.SubElement(components, Q("component"), {
                "group": group, "name": name, "version": version,
            })
            indexed[(group, name, version)] = component
        artifacts = {node.attrib["name"]: node for node in component.findall(Q("artifact"))}
        for path in files:
            artifact = artifacts.get(path.name)
            if artifact is None:
                artifact = ET.SubElement(component, Q("artifact"), {"name": path.name})
                artifacts[path.name] = artifact
            value = sha256(path)
            hashes = {node.attrib.get("value") for node in artifact.findall(Q("sha256"))}
            if value not in hashes:
                ET.SubElement(artifact, Q("sha256"), {
                    "value": value,
                    "origin": "Order 077 exact clean-runner cache hash",
                })
                added.append((group, name, version, path.name, value))

    # Stable ordering keeps the committed evidence reviewable and reproducible.
    children = sorted(
        list(components),
        key=lambda node: (node.attrib["group"], node.attrib["name"], node.attrib["version"]),
    )
    components[:] = children
    for component in children:
        component[:] = sorted(component, key=lambda node: node.attrib["name"])
    ET.indent(tree, space="   ")
    tree.write(args.metadata, encoding="UTF-8", xml_declaration=True)
    print(f"EXACT_COMPONENTS={len(requested)} ADDED_HASHES={len(added)}")
    for row in added:
        print(":".join(row[:3]), row[3], row[4])


if __name__ == "__main__":
    main()
