# Android runtime

The native Android runtime uses Room and WorkManager to preserve critical operations across offline periods and process or device restart.

## Delivery path

1. `CriticalOperationRuntime.enqueue` validates payload size, deadline and retry budget, derives a stable operation and replay identity, persists the row and `QUEUED` evidence in one Room transaction, then schedules unique work constrained on connectivity.
2. `DeliveryWorker` rechecks terminal state, cancellation, deadline, retry budget, semantic preconditions and current payload policy before transport.
3. A transport-attempt row and evidence are persisted before HTTP begins.
4. `HttpReceiverTransportClient` builds `zungun.operation.v1`, applies a credential from `CredentialProvider`, requires TLS except explicitly permitted emulator/loopback development, and sends the envelope to the configured receiver.
5. HTTP status, response digest, errors and attempt completion are persisted before the local operation changes state.
6. Receiver acceptance without a receipt becomes `RECEIVER_ACCEPTED` or `UNKNOWN` and remains retryable within policy. It is not business-effect success.
7. A returned receipt is accepted only after canonical digest, P-256 signature, key validity/revocation and operation/scope/nonce bindings pass. Then the receipt and evidence are persisted and the operation becomes terminal.

## Dependency boundary

An application installs `DeliveryDependencyProvider` during application startup. It supplies receiver configuration, a credential provider, semantic revalidation and optionally a custom transport or verification-key resolver. This allows WorkManager and boot recovery to reconstruct delivery dependencies after process or device restart.

The sample application accepts endpoint/token/receiver values as explicit launch inputs for emulator evidence and reinstalls them from private sample preferences after restart. Production applications should replace that sample credential storage with their platform security mechanism.
