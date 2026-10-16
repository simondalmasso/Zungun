# Repository authority and migration record

**Review date:** 2026-10-16  
**Authority:** GitHub  
**GitLab status:** legacy snapshot; no mirror is configured or intended.

## Canonical locations

- **CANON:** https://github.com/simondalmasso/Zungun
- **LEGACY REFERENCE:** https://gitlab.com/simondalmasso/Zungun

GitHub is the sole source of truth for source code, branches, issues, pull requests, CI evidence, tags, releases and documentation. GitLab is retained only as a historical reference. Do not develop, release, or make repository-authority decisions from GitLab. No mirror automation should be enabled or recreated without a new explicit decision.

## Verified comparison

| Check | GitHub canonical | GitLab legacy snapshot |
|---|---|---|
| Default branch | recovery/remote-toolchain-v1 | recovery/remote-toolchain-v1 |
| HEAD at start of this reconciliation | 09f64d238fcfdc9f718b640196e7098982c8f350 | 13d6745217672da16985d815c427aa4c953de227 |
| Branches | 21 | 11 |
| Tags | GitHub branch/tag state not changed by this reconciliation | 0 tags reported |
| Product tree | Full product tree, including Link, Android runtime, receiver, Witness, proof and verification documentation | Root tree is limited to .github/, canary/, and RECOVERY.md; no root README |
| GitLab description | Delivery Assurance product direction now documented in canonical README | Older description: Android SDK for durable, idempotent delivery under intermittent/low-bandwidth/satellite networks |

At the observed snapshot, GitLab's default-branch HEAD is an ancestor of the GitHub canonical history and is behind it. All eleven GitLab branch names exist on GitHub. Ten branch tips match; the GitLab default branch tip is the one that is stale. GitHub also has product branches absent from the GitLab branch list. The checked GitLab repository reports no tags.

File-level comparison of the GitLab default branch against the current GitHub tree found 69 GitLab tree entries (56 files), no GitLab-only paths, and 55/56 matching file blob hashes. RECOVERY.md is the sole content mismatch and was intentionally updated on GitHub to supersede recovery-only authority flags and state that GitLab is not a mirror target. The different .github directory tree hashes reflect workflow/documentation changes, not missing GitLab-only files. This establishes that the visible GitLab default-branch file tree is present in GitHub; it does not prove every historical branch commit or all GitLab metadata/settings were migrated.

GitLab's import metadata still points at the old GitHub path https://github.com/simonkey888/Zungun.git. That metadata is not an active migration or synchronization mechanism.

The current GitHub HEAD after this documentation-only update is recorded by the commit history; the latest combined-status query returned no status checks. No code-test or production-pass claim is made for this update.

## Current migration decision

- GitHub stays canonical.
- GitLab is **not** a live mirror, and no mirroring workflow is to run.
- The GitHub-only product tree is authoritative. Do not overwrite it with the reduced GitLab snapshot.
- Preserve the GitLab canary/recovery files as historical evidence unless a separate audit proves they are obsolete; do not delete them merely because GitLab is legacy.
- The repository's default branch is still named recovery/remote-toolchain-v1. The name is historical and not ideal for a mature product repository, but this update does not change repository settings or rename branches.
- Repository authority is not deployment approval. Production, paid demand, external certification and partner claims require separate current evidence.

## Product direction

The canonical product hypothesis is **Zungun Delivery Assurance**: backend-agnostic delivery semantics for critical Android app operations, with Link for planning and transfer and Witness for evidence continuity. This is a hypothesis under validation, not a claim of market leadership or necessary infrastructure. See [the strategic assessment](docs/strategy/delivery-assurance-assessment.md).

## Security note

A GitLab project metadata response exposed a runner-registration token field during this audit. The value is intentionally not reproduced here. If the runner token is still active, revoke/rotate it in GitLab and review any runners registered with it. Do not paste tokens into issues, commits or chat.