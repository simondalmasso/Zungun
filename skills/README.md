# Zungun Agent Skills

This directory contains portable, task-oriented instructions for AI agents. A skill is guidance, not an implementation, credential, hardware capability, or proof of live connectivity.

## Available skills

- [Zungun Satellite Connectivity](zungun-satellite-connectivity/SKILL.md) — discover and classify satellite/NTN paths, research official provider interfaces, design transport adapters, preserve Zungun delivery assurance, and define staged verification.

## Evidence boundary

The satellite skill is a new integration playbook. It does not mean the repository already includes a satellite modem driver, a provider integration, a live satellite session, a generic satellite API, or hardware-in-the-loop verification. Any such capability must be evidenced independently.

## Adding a skill

Every skill must live in its own directory and start with a SKILL.md containing YAML frontmatter with a unique directory-matching name and a useful description. Keep SKILL.md under 500 lines and put deep detail in supporting references. Add supporting references only when they improve the workflow. Keep instructions scoped, reviewable, source-backed, and safe for agents to consume as untrusted input. See the [Agent Skills specification](https://agentskills.io/specification) and [MCP Skills extension specification](https://skills.extensions.modelcontextprotocol.io/specification/stable/skills).


## Automated validation

Changes to `skills/**` run `.github/workflows/validate-agent-skills.yml`. The workflow parses frontmatter with a duplicate-key-rejecting YAML loader, checks required metadata and directory/name agreement, enforces repository length limits, and verifies relative Markdown links. This guard validates repository structure; it does not prove provider capability, radio connectivity, or hardware delivery.
