# ZUNGUN control-plane decisions

## D-001 — Hybrid migration first

**Status:** accepted  
**Decision:** Introduce GitHub `/ops` as the control plane while retaining Drive authority for pre-migration governance and preserved evidence. GitHub becomes sole authority only after an independent migration audit.

## D-002 — Isolated bootstrap branch

**Status:** accepted  
**Decision:** Build the first `/ops` scaffold on `feat/agentic-os-v1-bootstrap`. Do not modify the active implementation branch, production or Cloudflare.

## D-003 — No self-referential commit field

**Status:** accepted  
**Decision:** `verified_remote_sha` identifies the implementation checkpoint verified by the state, not the commit containing the state file itself. Every reader independently verifies the current control-branch head through GitHub.

## D-004 — Expiring claims with explicit recovery

**Status:** accepted  
**Decision:** Every writer claim includes timestamps and expiry. An expired claim is not inherited automatically; claim recovery requires remote reconciliation and a recorded decision.

## D-005 — Independent AUD and explicit RELEASE

**Status:** accepted  
**Decision:** AUD must be contextually independent from ARQ for implementation certification. RELEASE is a separate role and may perform only the exact mutation authorized by a PASS audit.

## D-006 — Human actions are first-class states

**Status:** accepted  
**Decision:** Manual dispatches, approvals and external interventions use `WAITING_FOR_HUMAN_ACTION` with single-use scope and completion evidence, rather than generic `BLOCKED`.

## D-007 — Critical artifact preservation

**Status:** accepted  
**Decision:** Checkpoints record artifact digest and expiry. Evidence required beyond provider retention must be copied to an approved preservation surface with a second digest.

## D-008 — Optimistic state locking

**Status:** accepted  
**Decision:** Updates to canonical state files require the previously read Git blob SHA. Concurrent changes are reconciled and never overwritten blindly.
