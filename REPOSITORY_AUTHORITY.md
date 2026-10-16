# Repository authority and cutover record

**Cutover snapshot:** 2026-10-16  
**Authority:** GitHub  
**Mirror direction:** GitHub → GitLab

## Canonical locations

- **CANON:** https://github.com/simondalmasso/Zungun
- **LEGACY / MIRROR TARGET:** https://gitlab.com/simondalmasso/Zungun

GitHub is the source of truth for source code, branches, issues, pull requests, CI evidence, tags, releases, and documentation. GitLab is retained for continuity as a downstream mirror. Development and release decisions must not originate from GitLab.

## Verified state at cutover

| Check | GitHub canonical | GitLab legacy |
|---|---|---|
| Default branch | `recovery/remote-toolchain-v1` | `recovery/remote-toolchain-v1` |
| Default-branch HEAD at cutover | `73d400c82fb62015b1710593084e8fe15139f692` | `13d6745217672da16985d815c427aa4c953de227` |
| Branches | 21 | 11 |
| Tags | No tags reported in GitLab | 0 |
| Root tree | Full product tree (534 entries in recursive tree) | Only `.github/`, `canary/`, and `RECOVERY.md` |

The GitLab default-branch HEAD is the first parent of the GitHub canonical HEAD. All 11 GitLab branch names exist on GitHub; 10 branch tips match and the default branch is behind. No GitLab-only branch tip or tag was found in the checked refs. GitLab metadata says the initial GitHub import finished, but the imported state is stale; that is not evidence of continuous mirroring.

**Mirror status at cutover: `NOT_SYNCHRONIZED`.** Do not describe GitLab as a live mirror until a successful synchronization is observed.

The GitHub combined-status endpoint returned no status checks for the cutover HEAD. The latest visible GitHub Actions runs were for the older `13d6745` and `669d7f1` commits. This record does not claim that the current HEAD is CI-green or production-verified.

## Automated mirror

The workflow [`.github/workflows/gitlab-legacy-mirror.yml`](.github/workflows/gitlab-legacy-mirror.yml) has been added to keep GitLab downstream from GitHub. It mirrors branches and tags only; it does not mirror issues, merge requests, settings, or releases. It uses an atomic, non-force push. Before pushing, it checks that every existing GitLab branch and tag is also present in GitHub, that GitLab branch tips are ancestors of their canonical counterparts, and that same-named tags point to the same object. If a GitLab-only ref or divergence is found, the workflow fails closed and preserves that ref. It never prunes or force-pushes refs; branch/tag deletions require a separate audit.

The workflow is deliberately disabled until its repository variable and secret are configured. This avoids a misleading success or an unauthenticated write attempt before setup.

### One-time activation

1. In GitLab, create a **fine-grained personal access token** restricted to project `simondalmasso/Zungun`, with only **Code → Download** and **Code → Push** permissions and an expiry date. Do not grant API access. If fine-grained tokens are unavailable in the account UI, stop and choose a project-scoped alternative; do not paste a token into chat.
2. In GitHub, open **Settings → Secrets and variables → Actions → Secrets** and add secret `GITLAB_MIRROR_TOKEN` with that token as its value.
3. In GitHub **Settings → Secrets and variables → Actions → Variables**, add repository variable `GITLAB_MIRROR_ENABLED` with value `true`.
4. Run **Actions → GitLab legacy mirror → Run workflow** once. Then verify the run succeeds and GitLab's `recovery/remote-toolchain-v1` reaches the current GitHub HEAD, the product directories appear in GitLab's tree, and all shared branch tips match.

Token reference: [GitLab fine-grained personal access tokens](https://docs.gitlab.com/auth/tokens/fine_grained_access_tokens/). GitLab's native pull-mirror feature is listed for Premium/Ultimate; this GitHub Actions path avoids that tier dependency. The workflow does not need GitHub write permission.

Until the workflow has completed successfully, GitLab is a stale legacy archive, not a verified live mirror. Do not manually commit to GitLab while it is intended to be downstream.

## Operating rules

- GitHub is the only write authority for product development.
- GitLab is downstream-only. Do not create independent feature branches, releases, or production deployments there.
- Before any future reconciliation, compare branch tips and tags first. Preserve any newly discovered GitLab-only commits before changing refs; never force-push on assumption.
- The current GitHub default branch retains the historical name `recovery/remote-toolchain-v1`. This migration does not rename it or change branch-protection settings.
- Repository authority does not imply deployment approval. Production claims require separate, current evidence.
- The product descriptions differ between providers. This migration preserves the canonical GitHub positioning and does not silently change the product thesis; decide any positioning changes separately.
