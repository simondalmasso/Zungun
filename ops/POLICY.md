# GAOS LEAN Policy — Zungun

`/ops` is the active operational control plane for Zungun after the materialization of Order 059.

## Read set

Every ARQ or AUD execution must read only this bounded active set before acting:

1. `/ops/POLICY.md`.
2. `/ops/CURRENT.json`.
3. The last 20 records of `/ops/EVENTS.ndjson`.
4. The checkpoint referenced by `CURRENT.json`.
5. The real remote repository HEAD, its GitHub Actions result, and the real remote platform state relevant to the requested action.

Issues, chats, prior Drive ledgers, superseded branches, and older evidence remain immutable history. They are not operational authority after this control plane is materialized.

## Authority and conflict resolution

- `/ops/CURRENT.json` is the sole active declared state.
- `/ops/EVENTS.ndjson` is append-only history; later sequence numbers supersede earlier operational claims without rewriting them.
- The latest checkpoint is evidence, not permission.
- Real remote HEAD, CI, and platform state override stale cached values.
- A human owner instruction may authorize a transition, but the transition is active only after it is represented in `/ops/CURRENT.json` and appended to `/ops/EVENTS.ndjson`.
- Any contradiction, missing required file, malformed JSON, sequence gap, HEAD drift, failing or absent required CI, or unverifiable platform target causes `FAIL_CLOSED` and no material action.

## Worksets and claims

- Only one workset and one material claim may be active in `CURRENT.json`.
- The claim defines role, branch, base SHA, allowed paths, forbidden paths, and action boundaries.
- ARQ may work autonomously only within the active workset.
- AUD is triggered once at a material checkpoint; no intermediate handoffs or audits are required.
- Changes outside the active allowed paths require a new human-authorized workset transition.

## Event protocol

Each line of `/ops/EVENTS.ndjson` is one complete JSON object with:

- `schema_version`, `seq`, `event_id`, `at`, `project`, `workset_id`, `actor`, `type`, and `data`.
- `seq` must be a strictly increasing positive integer.
- `event_id` must be unique.
- Existing lines must never be edited or deleted; new facts are appended.
- Readers consume at most the latest 20 events.

## Checkpoints

A checkpoint under `/ops/evidence/<CHECKPOINT_ID>.json` must identify the materialized commit, changed paths, validation commands, CI result, runtime-change classification, and all action boundaries. A checkpoint is `PASS` only when the referenced commit and required CI are independently observable on GitHub.

## Release records

Files under `/ops/releases/` record release decisions and boundaries. A record with `status != AUTHORIZED` cannot cause deploy, release, merge, tag, default-branch change, or production mutation.

## Current workset boundary

- Mission base SHA: `5c49374d5fa54858108cffe437520b793d0cfeb4`.
- Implementation branch: `feat/gaos-lean-product-baseline-v1`.
- Allowed paths: `/ops/**`, `README.md`, `docs/**`, `tools/**`, `.github/workflows/**`, `evidence/order057/**`.
- Forbidden: runtime source changes, dependency version changes, default-branch changes, Cloudflare writes, merge, deploy, release, or production changes.
- This workset must preserve runtime behavior and fail closed on scope drift.
