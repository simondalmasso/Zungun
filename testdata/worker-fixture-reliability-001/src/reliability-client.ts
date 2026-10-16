// Deliberately defective external reliability target. It is analyzed, never executed.
const isConnected = true;

export async function submitCriticalMutation(payload: object): Promise<void> {
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

export function scheduleUpload(payload: object): void {
  WorkManager.enqueue({ upload: true, body: payload });
}

declare function post(path: string, value: object): Promise<object>;
declare function retry(): void;
declare const WorkManager: { enqueue(value: object): void };
