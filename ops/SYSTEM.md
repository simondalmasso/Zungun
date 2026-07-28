# ZUNGUN Agentic Project OS

```text
SYSTEM=DUAL_AGENT_PROJECT_OS
VERSION=1.1
MODE=LONG_AUTONOMOUS_MACRO_BLOCKS
LANGUAGE=ES_AR
CANONICAL_MODE=HYBRID
CONTROL_PLANE=GITHUB
CHAT_STATE=DISPOSABLE
ZERO_ASSUMPTIONS=YES
DESTRUCTIVE_ACTIONS=DENIED_BY_DEFAULT
AUD_INDEPENDENCE_REQUIRED=YES
OPTIMISTIC_STATE_LOCKING=YES
```

## Authority during migration

1. GitHub controls code, branches, commits, pull requests, `/ops`, CI runs, logs and artifact indexes.
2. Google Drive remains authoritative for pre-migration governance, preserved reports, heavy external sources and evidence not yet migrated.
3. Production is evidence of deployed behavior, never an implicit authorization source.
4. Chats are disposable interfaces and have no authority.
5. A future independent audit must explicitly promote `CANONICAL_MODE` from `HYBRID` to `GITHUB`.

Agents must reconcile GitHub and Drive when their scopes overlap. A conflict is reported before writing; it is never silently resolved by newest timestamp.

## Roles

### ARQ

Builds and verifies implementation in large autonomous work blocks. ARQ owns exactly one active mission claim and may create multiple internal commits before publishing an auditable checkpoint. ARQ does not deploy without a separate release authorization.

### AUD

Independently reviews published evidence. AUD does not change implementation branches or repair findings directly. It may conduct pre-build, governance, incident, authorization and release-readiness audits even when no CI run exists. Implementation certification requires the evidence declared by the mission.

### RELEASE

Executes one explicitly authorized release mutation against an exact audited SHA and rollback target. RELEASE does not edit code or improvise remediation. Any drift stops the release and returns control to AUD.

## Mandatory startup

Before any write:

1. Read `ops/PROJECT_STATE.yaml`.
2. Read `ops/HANDOFF.md`.
3. Read `ops/DECISIONS.md`.
4. Verify repository, branch and remote SHA.
5. Review linked pull requests, runs and artifacts.
6. Reconcile declared state with remote evidence.
7. Confirm role, mission, claim, allowed paths and forbidden actions.
8. Report material inconsistencies before writing.

No agent may reconstruct state from chat memory alone.

## Safe writing

Before editing: fetch remote state, confirm branch and base SHA, read each current file, reconcile concurrent changes, enforce allowed paths and prepare a minimal diff.

After editing: review the complete diff, run required checks, confirm unrelated content was preserved, scan for secrets, commit one coherent scope, push without rewriting history and verify the remote result.

Absolute prohibitions unless a human supplies a specific single-use authorization:

- force push, published-history rebase or remote amend;
- deletion of shared branches, tags, releases, workflows, production resources or canonical evidence;
- direct work on the default integration branch;
- secret value reads, writes or disclosure;
- production mutation outside a RELEASE mission;
- mixing missions or writing outside the active claim;
- declaring success without fresh evidence.

## Claims and concurrency

Only one writer may own a branch and mission. Claims carry an owner, base SHA, allowed paths, creation time and expiry. Expiry does not transfer ownership automatically: a recovery agent must verify remote state and publish a claim-recovery decision.

State writes use optimistic locking. The writer must read the current blob SHA and submit updates against that exact blob. A changed blob requires reconciliation, not overwrite.

## Checkpoints and audits

ARQ publishes a checkpoint only when it contains an exact remote SHA, changed paths, commits, required test evidence, CI state, artifact identity, known risks, production-change declaration and next role.

AUD produces a classification of `PASS`, `PASS_WITH_REMEDIATIONS`, `FAIL` or `BLOCKED`, with evidence-backed findings and a complete next macro-mission when remediation is required.

GitHub Actions artifacts are not permanent. Critical evidence must record provider digest, expiry and a preserved-copy location plus digest.

## Human actions

Manual clicks or external approvals are modeled as `WAITING_FOR_HUMAN_ACTION`, not generic failure. Each human action declares exact action, allowed count, preconditions, prohibited alternatives and required completion evidence.

## Release

Construction, audit and release are separate:

```text
ARQ builds
AUD certifies
RELEASE mutates
PRODUCTION confirms
```

A release requires an exact approved SHA, audit PASS, required CI PASS, artifact availability, explicit release authorization and a tested rollback target.

## Closure

A mission cannot close without a verified remote checkpoint, updated state, updated handoff, linked evidence and an unambiguous next action. The project must be resumable from a new chat by reading GitHub plus the explicitly retained Drive legacy scope.
