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
- `seq` must be contiguous, start at `1`, and increase by exactly `1`.
- `event_id` must be unique.
- `type` must be exactly one of this closed allowlist:
  `WORKSET_OPENED|CLAIM_ASSIGNED|STOP|TAKEOVER|RISK_ESCALATED|CHECKPOINT_REQUESTED|CHECKPOINT_ACCEPTED|AUDIT_DECIDED|RELEASE_AUTHORIZED|DEPLOYMENT_RECORDED|INCIDENT_RECORDED|WORKSET_CLOSED`
- Any event type outside that allowlist causes `FAIL_CLOSED`.
- Existing lines must never be edited or deleted, except for the one-shot pre-AUD-acceptance bootstrap normalization authorized by `ZUNGUN-AUD-20260731-059-CP001-001`.
- Readers consume at most the latest 20 events.

## Checkpoints

A checkpoint under `/ops/evidence/<CHECKPOINT_ID>.json` must identify the materialized commit, changed paths, validation commands, CI result, runtime-change classification, and all action boundaries. A checkpoint is `PASS` only when the referenced commit and required CI are independently observable on GitHub.

## Release records

Files under `/ops/releases/` record release decisions and boundaries. A record with `status != AUTHORIZED` cannot cause deploy, release, merge, tag, default-branch change, or production mutation.

## Workset-specific execution boundary

- Order 059 remains closed and immutable as the accepted product baseline. Its checkpoint and GAOS-LEAN-BASELINE-001.json release record stay historical and NOT_AUTHORIZED; do not rewrite them to represent another order.
- The currently materialized ORDER-085 workset is represented by CURRENT.json, the append-only event tail, ops/evidence/ORDER-085-CP001.json, and ops/releases/ORDER-085.json.
- ORDER-085 permits edits only on the existing product branch feat/zungun-full-project-v1 and within the exact claim allowlist in CURRENT.json. Preserve fast-forward ancestry from its start HEAD. No new product branch/PR, merge, reset, force-push, rebase, history rewrite, Order 082, or ATM work.
- The ORDER-085 release record authorizes production mutation conditionally, not unconditionally. Every exact-final-head required gate, canonical Owner logo verification, deterministic manifest check, and real production mobile E2E must pass before deployment.
- Production writes must run only through the existing .github/workflows/order-085-mobile-messenger.yml workflow_dispatch and its guarded tools/order083/deploy-production.sh. No direct Wrangler upload, trigger workaround, workflow weakening, or secret disclosure.
- A deployment authorization is not permission to skip verification. An IN_PROGRESS checkpoint is not PASS, and missing or failed required checks remain FAIL_CLOSED.
