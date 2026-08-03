# Order 072 provenance and boundaries

This directory is a noncanonical recovery candidate based on remote commit `5c49374d5fa54858108cffe437520b793d0cfeb4`.

The historical oracle remains at `canary/zep-core-canary/vendor/zep-core/` and is not modified by this candidate. The candidate build compiles directly from those protected historical source blobs. Root exports are therefore produced from the single historical implementation, not wrappers, aliases, or a second implementation.

Orders 063–067 are isolated under `src/extensions/` and exposed only through `./extensions`. Demo receipts remain reference-only and cannot satisfy the historical opaque verified-receipt boundary without an explicit external verifier.

`CANONICAL=NO`, `MERGE=NO`, `DEPLOY=NO`, `RELEASE=NO`, `PRODUCTION_READY=NO`.
