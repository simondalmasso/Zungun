# Zungun ZEP Core Cloudflare Canary

```text
DELIVERY_ID=ZUNGUN-ARQ-ZEP-CF-CANARY-IMPLEMENTATION-20260726-001
VERSION=0.1.0-local
SOURCE_DELIVERY_ID=ZUNGUN-ARQ-ZEP-CORE-IMPLEMENTATION-20260726-006
SOURCE_ARCHIVE_SHA256=f1df15fac64354ad51c297e3e4d0fca1c94e3bad01f1c5383bcb1dc367f133ec
STATUS=LOCAL_IMPLEMENTATION_COMPLETE_TOOLCHAIN_GATE_PENDING
DEPLOYABLE=NO
CLOUDFLARE_WRITE_AUTHORIZED=NO
```

This package is a temporary, stateless Cloudflare Workers canary around the audited ZEP Core delivery 006. It validates message envelopes and exposes no message storage, relay, acknowledgement, routing, queue, or delivery functionality.

## Surface

- `GET /health`
- `POST /v1/messages/validate`

The validation endpoint accepts a closed JSON envelope, decodes canonical Base64 into bytes, invokes the exact vendored ZEP Core validator, and returns a summary without echoing the payload or extensions.

## Security boundary

```text
STORAGE=NONE
SECRETS=NONE
BINDINGS=NONE
CUSTOM_ROUTES=NONE
CORS=DISABLED
PERSISTENCE=NONE
MAX_REQUEST_BODY_BYTES=65536
MAX_DECODED_PAYLOAD_BYTES=48000
```

Requests use strict methods and paths, exact top-level allowlists, fatal UTF-8 decoding, canonical Base64, streaming body limits, content-length consistency, normalized errors, no cache, no CORS, and no reflection of unknown fields.

## Local evidence

The local runtime can execute TypeScript, tests, fuzzing, configuration checks, static scans, and source-identity checks. It cannot currently resolve the npm registry, so `package-lock.json`, `node_modules`, `wrangler types`, and the official `wrangler deploy --dry-run` remain intentionally absent.

The proposed GitHub workflow under `github-plan/` is manual and read-only. It is not authorized for materialization or execution until an independent AUD verdict explicitly permits the exact GitHub transition.

## Required gates before any Cloudflare write

1. Independent audit of this source bundle and GitHub execution plan.
2. Exact, single GitHub materialization commit authorization.
3. Manual workflow evidence: lockfile, dependency tree, tests, fuzz, `wrangler types`, dry-run, hashes.
4. Independent audit of that workflow evidence.
5. Cloudflare account identity, auth, worker name, target and rollback fixed without exposing secrets.
6. Separate explicit Cloudflare write order.
