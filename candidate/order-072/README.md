<!-- ORDER: ZUNGUN-AUD-ARQ-ORACLE-RESTORATION-071 -->
# Zungun TypeScript oracle restoration 071

This local branch restores the historical TypeScript oracle from remote commit `13d6745217672da16985d815c427aa4c953de227` using exact Git blobs. The package root (`@zungun/zep-core`) exposes exactly the historical 49 runtime exports. Orders 063–067 remain available only through `@zungun/zep-core/extensions`.

The extension surface imports the historical `LogicalMessage`, `DeliveryStateMachine`, receipt verifier/token, routing, validation, fragment, UNKNOWN-retry and safe-error APIs. It does not define a second envelope or state machine. Demo receipt references are explicitly non-production and cannot alter acknowledgement state without the historical verifier boundary and opaque `VerifiedEndRecipientReceipt` token.

This is a local remediation candidate for AUD review. It is not a canonical declaration, deployment, Android runtime, durable production receiver, database, managed service, or production cryptographic implementation.

## Verification

```text
npm ci
npm run verify:deep
```

The integrated gate runs the exact historical suite and fuzz corpus, extension tests and fuzz, root/extension export checks, V01–V10 differential tests, static no-network/no-database checks, kit/tamper/browser checks, and a packed external consumer for both entrypoints.

## Package entrypoints

```js
import * as oracle from '@zungun/zep-core';            // exact historical 49
import * as demo from '@zungun/zep-core/extensions';  // reference/demo extensions
```

The CLI remains extension-only:

```text
zungun-demo wo-2841 --out ./evidence
zungun-demo control-room --out ./zungun-demo-kit
zungun-demo verify-kit ./zungun-demo-kit --json
```


## Remote candidate status

`CANONICAL=NO`; `MERGE=NO`; `DEPLOY=NO`; `RELEASE=NO`. The package is a recovery candidate only.
