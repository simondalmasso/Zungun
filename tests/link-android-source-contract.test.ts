import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Android Link scheduling applies WorkManager constraints to both legacy and Link workers',()=>{
  const source=readFileSync('android/runtime/src/main/java/com/zungun/runtime/delivery/CriticalOperationRuntime.kt','utf8');
  assert.ok(source.includes('(if (linkEnabled) OneTimeWorkRequestBuilder<LinkDeliveryWorker>() else OneTimeWorkRequestBuilder<DeliveryWorker>())'));
  assert.ok(source.includes('.setRequiredNetworkType(NetworkType.CONNECTED)'));
  assert.ok(source.includes('.setInputData(workDataOf("operationId" to operationId))'));
});

test('Android runtime observer caches callback snapshots and coordinator consumes fresh cache first',()=>{
  const registry=readFileSync('android/runtime/src/main/java/com/zungun/runtime/link/LinkNetworkWakeRegistry.kt','utf8');
  const coordinator=readFileSync('android/runtime/src/main/java/com/zungun/runtime/link/LinkCoordinator.kt','utf8');
  assert.ok(registry.includes('latestSnapshot = snapshot'));
  assert.ok(registry.includes('fun latest(nowMs: Long): LinkSnapshot?'));
  assert.ok(coordinator.includes('LinkNetworkWakeRegistry.latest(nowMs)?.let { return it }'));
});

test('Zungun facade preserves legacy enqueue and adds Link-aware overload',()=>{
  const source=readFileSync('android/runtime/src/main/java/com/zungun/runtime/Zungun.kt','utf8');
  assert.match(source,/suspend fun enqueue\(context:Context,request:EnqueueRequest\):String/);
  assert.match(source,/deliveryProfile:DeliveryProfileV2/);
});
