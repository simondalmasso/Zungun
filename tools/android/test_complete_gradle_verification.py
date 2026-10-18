#!/usr/bin/env python3
"""Regression tests for strict Gradle verification metadata completion."""
from __future__ import annotations
import hashlib
import unittest
from pathlib import Path
import importlib.util
from unittest.mock import patch

_module_spec = importlib.util.spec_from_file_location(
    "complete_gradle_verification",
    Path(__file__).with_name("complete-gradle-verification.py"),
)
if _module_spec is None or _module_spec.loader is None:
    raise RuntimeError("GRADLE_VERIFICATION_HELPER_IMPORT_FAILED")
_verification_helper = importlib.util.module_from_spec(_module_spec)
_module_spec.loader.exec_module(_verification_helper)
fetch_maven_central_bom = _verification_helper.fetch_maven_central_bom

def response(body: bytes):
    class FakeResponse:
        def __init__(self, payload: bytes):
            self.payload = payload
        def __enter__(self):
            return self
        def __exit__(self, *_args):
            return False
        def read(self, limit: int = -1):
            return self.payload if limit < 0 else self.payload[:limit]
    return FakeResponse(body)

def pom(group: str, name: str, version: str) -> bytes:
    return ("<project><modelVersion>4.0.0</modelVersion>"
        f"<groupId>{group}</groupId><artifactId>{name}</artifactId><version>{version}</version>"
        "</project>").encode("utf-8")

class MavenCentralBomFallbackTests(unittest.TestCase):
    def test_accepts_exact_gav_and_published_sha1_then_computes_sha256(self):
        group, name, version = "org.jetbrains.kotlin", "kotlin-bom", "1.8.22"
        payload = pom(group, name, version)
        checksum = hashlib.sha1(payload).hexdigest().encode("ascii")
        with patch("urllib.request.urlopen", side_effect=[response(payload), response(checksum)]) as opened:
            filename, value, origin = fetch_maven_central_bom(group, name, version)
        self.assertEqual(filename, "kotlin-bom-1.8.22.pom")
        self.assertEqual(value, hashlib.sha256(payload).hexdigest())
        self.assertIn("exact GAV", origin)
        self.assertEqual(opened.call_count, 2)
        self.assertIn("/org/jetbrains/kotlin/kotlin-bom/1.8.22/", opened.call_args_list[0].args[0].full_url)

    def test_rejects_wrong_declared_gav(self):
        payload = pom("org.attacker", "kotlin-bom", "1.8.22")
        checksum = hashlib.sha1(payload).hexdigest().encode("ascii")
        with patch("urllib.request.urlopen", side_effect=[response(payload), response(checksum)]):
            with self.assertRaisesRegex(SystemExit, "MAVEN_CENTRAL_GAV_MISMATCH"):
                fetch_maven_central_bom("org.jetbrains.kotlin", "kotlin-bom", "1.8.22")

    def test_rejects_mismatched_published_sha1(self):
        payload = pom("org.jetbrains.kotlin", "kotlin-bom", "1.8.22")
        with patch("urllib.request.urlopen", side_effect=[response(payload), response(b"0" * 40)]):
            with self.assertRaisesRegex(SystemExit, "MAVEN_CENTRAL_SHA1_MISMATCH"):
                fetch_maven_central_bom("org.jetbrains.kotlin", "kotlin-bom", "1.8.22")

    def test_remote_fallback_is_restricted_to_bom_coordinates(self):
        with patch("urllib.request.urlopen") as opened:
            with self.assertRaisesRegex(ValueError, "REMOTE_FALLBACK_NOT_ALLOWED"):
                fetch_maven_central_bom("org.example", "arbitrary-library", "1.0")
        opened.assert_not_called()

if __name__ == "__main__":
    unittest.main(verbosity=2)
