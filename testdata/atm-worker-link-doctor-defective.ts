// Intentionally defective reliability fixture for ATM worker qualification.
// This file must never be executed; Link Doctor consumes it as untrusted text only.

const isConnected = true;

export async function sendCriticalMutation(payload: unknown): Promise<void> {
  if (!isConnected) return;
  console.log('authorization payload', payload);
  try {
    await post('/critical-mutation', { body: payload });
  } catch (error) {
    if (String(error).includes('timeout')) {
      throw new Error('FAILED');
    }
    retry();
  }
}

export function scheduleBackgroundUpload(payload: unknown): void {
  WorkManager.enqueue({ upload: true, body: payload });
}

declare function post(path: string, value: unknown): Promise<unknown>;
declare function retry(): void;
declare const WorkManager: { enqueue(value: unknown): void };
