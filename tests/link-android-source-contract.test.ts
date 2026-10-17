import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function compact(value: string): string { return value.replace(/\s+/g, ''); }

test('Android Link scheduling applies WorkManager constraints to both legacy and Link workers', () => {
  const source = compact(readFileSync('android/runtime/src/main/java/com/zungun/runtime/delivery/CriticalOperationRuntime.kt', 'utf8'));
  assert.ok(source.includes('(if(linkEnabled)OneTimeWorkRequestBuilder<LinkDeliveryWorker>()elseOneTimeWorkRequestBuilder<DeliveryWorker>())'));
  assert.ok(source.includes('.setRequiredNetworkType(NetworkType.CONNECTED)'));
  assert.ok(source.includes('.setInputData(workDataOf("operationId"tooperationId))'));
});

test('Android runtime observer caches callback snapshots and coordinator consumes fresh cache first', () => {
  const registry = compact(readFileSync('android/runtime/src/main/java/com/zungun/runtime/link/LinkNetworkWakeRegistry.kt', 'utf8'));
  const coordinator = compact(readFileSync('android/runtime/src/main/java/com/zungun/runtime/link/LinkCoordinator.kt', 'utf8'));
  assert.ok(registry.includes('latestSnapshot=snapshot'));
  assert.ok(registry.includes('funlatest(nowMs:Long):LinkSnapshot?'));
  assert.ok(coordinator.includes('LinkNetworkWakeRegistry.latest(nowMs)?.let{returnit}'));
});

test('Zungun facade preserves legacy enqueue and adds Link-aware overload', () => {
  const source = compact(readFileSync('android/runtime/src/main/java/com/zungun/runtime/Zungun.kt', 'utf8'));
  assert.ok(source.includes('suspendfunenqueue(context:Context,request:EnqueueRequest):String'));
  assert.ok(source.includes('deliveryProfile:DeliveryProfileV2'));
});
