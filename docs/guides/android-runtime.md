# Android Critical Operation Runtime

The Android library persists operations and evidence in Room, uses atomic database transactions, schedules controlled delivery with WorkManager, restores pending work after process death or reboot, applies TTL and retry budgets, invokes semantic revalidation before delayed execution, and verifies ECDSA receipts independently.

The sample application demonstrates offline enqueue, durable recovery, duplicate delivery, ambiguity and verified completion. See `android/sample` and the external AAR consumer under `android/external-consumer`.
