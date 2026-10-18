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
import re
import urllib.request
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


def fetch_maven_central_bom(group: str, name: str, version: str) -> tuple[str, str, str]:
    """Fetch allow-listed Maven Central BOM metadata if Gradle omitted it from cache."""
    if not name.endswith("-bom"):
        raise ValueError(f"REMOTE_FALLBACK_NOT_ALLOWED:{group}:{name}:{version}")

    relative = f"{group.replace('.', '/')}/{name}/{version}/{name}-{version}.pom"
    url = f"https://repo.maven.apache.org/maven2/{relative}"
    request = urllib.request.Request(url, headers={"User-Agent": "Zungun-Gradle-Verification/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        pom_bytes = response.read(16 * 1024 * 1024 + 1)
    if not pom_bytes or len(pom_bytes) > 16 * 1024 * 1024:
        raise SystemExit(f"INVALID_MAVEN_CENTRAL_POM_SIZE:{group}:{name}:{version}")

    try:
        root = ET.fromstring(pom_bytes)
    except ET.ParseError as error:
        raise SystemExit(f"INVALID_MAVEN_CENTRAL_POM_XML:{group}:{name}:{version}") from error

    def child_text(parent: ET.Element, local_name: str) -> str | None:
        child = next((item for item in list(parent) if item.tag.rsplit("}", 1)[-1] == local_name), None)
        return child.text.strip() if child is not None and child.text else None

    declared_gav = (child_text(root, "groupId"), child_text(root, "artifactId"), child_text(root, "version"))
    if declared_gav != (group, name, version):
        raise SystemExit(
            f"MAVEN_CENTRAL_GAV_MISMATCH:requested={group}:{name}:{version}:observed={declared_gav}"
        )

    checksum_request = urllib.request.Request(
        f"{url}.sha1", headers={"User-Agent": "Zungun-Gradle-Verification/1.0"}
    )
    with urllib.request.urlopen(checksum_request, timeout=30) as response:
        checksum_text = response.read(4096).decode("ascii", errors="strict")
    published_sha1 = re.sub(r"\s+", "", checksum_text).lower()
    if not re.fullmatch(r"[0-9a-f]{40}", published_sha1):
        raise SystemExit(f"INVALID_MAVEN_CENTRAL_SHA1_SIDECAR:{group}:{name}:{version}")
    actual_sha1 = hashlib.sha1(pom_bytes).hexdigest()
    if actual_sha1 != published_sha1:
        raise SystemExit(
            f"MAVEN_CENTRAL_SHA1_MISMATCH:{group}:{name}:{version}:"
            f"expected={published_sha1}:actual={actual_sha1}"
        )

    filename = f"{name}-{version}.pom"
    actual_sha256 = hashlib.sha256(pom_bytes).hexdigest()
    origin = "Maven Central HTTPS POM; exact GAV and published SHA-1 sidecar verified; SHA-256 computed locally"
    return filename, actual_sha256, origin


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

        # Only explicitly allow-listed *-bom coordinates may use this fallback.
        if files:
            resolved_artifacts = [
                (path.name, sha256(path), "Order 077 exact clean-runner cache hash")
                for path in files
            ]
        elif name.endswith("-bom"):
            resolved_artifacts = [fetch_maven_central_bom(group, name, version)]
        else:
            raise SystemExit(f"RESOLVED_ARTIFACTS_NOT_FOUND:{group}:{name}:{version}:{directory}")

        component = indexed.get((group, name, version))
        if component is None:
            component = ET.SubElement(components, Q("component"), {
                "group": group, "name": name, "version": version,
            })
            indexed[(group, name, version)] = component
        artifacts = {node.attrib["name"]: node for node in component.findall(Q("artifact"))}
        for filename, value, origin in resolved_artifacts:
            artifact = artifacts.get(filename)
            if artifact is None:
                artifact = ET.SubElement(component, Q("artifact"), {"name": filename})
                artifacts[filename] = artifact
            hashes = {node.attrib.get("value") for node in artifact.findall(Q("sha256"))}
            if value not in hashes:
                ET.SubElement(artifact, Q("sha256"), {"value": value, "origin": origin})
                added.append((group, name, version, filename, value))

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
