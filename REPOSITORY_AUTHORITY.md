# Repository authority and cutover record

**Cutover snapshot:** 2026-10-16  
**Authority:** GitHub  
**Mirror direction:** GitHub → GitLab (GitLab pull mirror)

## Canonical locations

- **CANON:** https://github.com/simondalmasso/Zungun
- **LEGACY / MIRROR TARGET:** https://gitlab.com/simondalmasso/Zungun

GitHub is the source of truth for source code, branches, issues, pull requests, CI evidence, tags, releases, and documentation. GitLab is retained for continuity and as a downstream mirror target. Development and release decisions must not originate from GitLab.

## Verified state at cutover

| Check | GitHub canonical | GitLab legacy |
|---|---|---|
| Default branch | `recovery/remote-toolchain-v1` | `recovery/remote-toolchain-v1` |
| Default-branch HEAD | `73d400c82fb62015b1710593084e8fe15139f692` | `13d6745217672da16985d815c427aa4c953de227` |
| Branches | 21 | 11 |
| Tags | Not checked in this snapshot | 0 |
| Root tree | Full product tree (534 entries in recursive tree) | Only `.github/`, `canary/`, and `RECOVERY.md` |

The GitLab default-branch HEAD is the first parent of the GitHub canonical HEAD. All 11 GitLab branch names exist on GitHub; 10 branch tips match and the default branch is behind. No GitLab-only branch tip or tag was found in the checked refs. The GitLab project metadata says the initial GitHub import finished, but its imported state is stale; that is not evidence of continuous mirroring.

**Mirror status at cutover: `NOT_SYNCHRONIZED`.** Do not describe GitLab as a live mirror until a successful pull-mirror update is observed.

The GitHub combined-status endpoint returned no status checks for the cutover HEAD. The latest visible GitHub Actions runs were for the older `13d6745` and `669d7f1` commits. This record does not claim that the current HEAD is CI-green or production-verified.

## Required mirror configuration

Configure this in GitLab project settings:

1. Open **Settings → Repository → Mirroring repositories**.
2. Add `https://github.com/simondalmasso/Zungun.git` as a **Pull** mirror. The direction must be GitHub → GitLab; do not configure a GitLab push mirror back into GitHub.
3. Use read-only access only if GitLab requires authentication. Do not give the mirror write access to GitHub.
4. Keep overwrite-diverged-branches disabled unless a later audit proves it is necessary. The checked branch tips are fast-forwardable or identical.
5. Run a sync and verify that GitLab's `recovery/remote-toolchain-v1` reaches the GitHub canonical HEAD, the product directories appear in GitLab's tree, and the shared branch tips match.

After successful verification, update the mirror status in this file to `SYNCHRONIZED` and record the resulting GitLab HEAD and verification time. Until then, GitLab is a stale legacy archive, not a verified live mirror.

## Operating rules

- GitHub is the only write authority for product development.
- GitLab is downstream-only. Do not create independent feature branches, releases, or production deployments there.
- Before any future reconciliation, compare branch tips and tags first. Preserve any newly discovered GitLab-only commits before changing refs; never force-push on assumption.
- The current GitHub default branch retains the historical name `recovery/remote-toolchain-v1`. This migration does not rename it or change branch-protection settings.
- Repository authority does not imply deployment approval. Production claims require separate, current evidence.
