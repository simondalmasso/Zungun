"""Unit tests for the repository's Agent Skill validation guard."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).with_name("validate-agent-skills.py")
SPEC = importlib.util.spec_from_file_location("validate_agent_skills", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)

SKILL_PATH = validator.ROOT / "skills" / "zungun-satellite-connectivity" / "SKILL.md"
VALID_FRONTMATTER = (
    "---\n"
    "name: zungun-satellite-connectivity\n"
    "description: Validate satellite connectivity skill metadata.\n"
    "---\n"
    "# Body\n"
)


class AgentSkillValidatorTests(unittest.TestCase):
    def test_accepts_valid_frontmatter_matching_directory(self) -> None:
        metadata = validator.parse_frontmatter(SKILL_PATH, VALID_FRONTMATTER)
        self.assertEqual(metadata["name"], "zungun-satellite-connectivity")
        self.assertIn("satellite connectivity", metadata["description"])

    def test_rejects_missing_required_description(self) -> None:
        document = "---\nname: zungun-satellite-connectivity\n---\nBody\n"
        with self.assertRaisesRegex(ValueError, "description"):
            validator.parse_frontmatter(SKILL_PATH, document)

    def test_rejects_duplicate_yaml_keys(self) -> None:
        document = (
            "---\n"
            "name: zungun-satellite-connectivity\n"
            "name: another-skill\n"
            "description: Duplicate key test.\n"
            "---\nBody\n"
        )
        with self.assertRaisesRegex(ValueError, "duplicate key"):
            validator.parse_frontmatter(SKILL_PATH, document)

    def test_rejects_directory_name_mismatch(self) -> None:
        document = VALID_FRONTMATTER.replace(
            "name: zungun-satellite-connectivity",
            "name: a-different-skill",
        )
        with self.assertRaisesRegex(ValueError, "must match skill directory"):
            validator.parse_frontmatter(SKILL_PATH, document)

    def test_accepts_existing_adapter_decision_template_link(self) -> None:
        issues = validator.check_local_links(
            SKILL_PATH,
            "[template](references/adapter-decision-template.md)",
        )
        self.assertEqual(issues, [])

    def test_rejects_missing_relative_link_target(self) -> None:
        issues = validator.check_local_links(
            SKILL_PATH,
            "[missing](references/__intentionally_missing_test_fixture__.md)",
        )
        self.assertTrue(any("does not exist" in issue for issue in issues))

    def test_rejects_links_escaping_repository(self) -> None:
        issues = validator.check_local_links(SKILL_PATH, "[outside](../../../../etc/passwd)")
        self.assertTrue(any("escapes the repository" in issue for issue in issues))


if __name__ == "__main__":
    unittest.main()
