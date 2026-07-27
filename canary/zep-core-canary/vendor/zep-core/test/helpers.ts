import type {
  AdapterContext,
  AttemptContext,
  CancelResult,
  LogicalMessageInput,
  ReceiveBatch,
  ReceiveContext,
  SendResult,
  TransportAdapter,
  TransportCapabilities,
  TransportStatus,
  Fragment,
  LogicalMessage,
  Receipt,
  ReceiptVerifier,
  RouteRequirements,
} from '../src/index.js';

export function message(overrides: Partial<LogicalMessageInput> = {}): LogicalMessageInput {
  return {
    zepVersion: '0.1',
    messageId: '00000000000000000000000000000001',
    conversationId: 'conversation-1',
    senderId: 'sender-1',
    recipientIds: ['recipient-1'],
    createdAtMs: 1000,
    expiresAtMs: 61000,
    priority: 1,
    contentType: 'text/plain;charset=utf-8',
    payload: new TextEncoder().encode('hola'),
    receiptPolicy: 'END_RECIPIENT_ACK',
    messageCommitment: 'mc:test:0001',
    ...overrides,
  };
}

export function capability(overrides: Partial<TransportCapabilities> = {}): TransportCapabilities {
  return {
    adapterId: 'BLE_DIRECT',
    adapterVersion: '0.1-test',
    maximumPayloadBytes: 1024,
    supportsBinary: true,
    supportsFragmentation: true,
    supportsTransportReceipt: true,
    supportsEndRecipientReceipt: true,
    supportsCancel: true,
    supportsBackground: true,
    supportsStoreAndForward: false,
    requiresUserPresence: false,
    requiresExternalHardware: false,
    requiresOperatorEntitlement: false,
    availabilityClass: 3,
    expectedLatencyClass: 1,
    estimatedCompletionDurationMs: 1000,
    monetaryCostClass: 0,
    energyCostClass: 1,
    privacyMetadataClass: 1,
    currentEligibility: 'ALLOWED',
    duplicateSafe: true,
    ...overrides,
  };
}

export class CompleteTestAdapter implements TransportAdapter {
  async capabilities(_context: AdapterContext): Promise<TransportCapabilities> { return capability(); }
  async status(context: AdapterContext): Promise<TransportStatus> {
    return { adapterId: 'BLE_DIRECT', observedAtMs: context.nowMs, availability: 'AVAILABLE', currentEligibility: 'ALLOWED' };
  }
  async send(_fragment: Fragment, context: AttemptContext): Promise<SendResult> {
    return { kind: 'accepted', acceptedAtMs: context.nowMs, externalReference: 'accepted-1' };
  }
  async receive(_cursor: string | null, context: ReceiveContext): Promise<ReceiveBatch> {
    return { cursor: null, items: [], observedAtMs: context.nowMs, hasMore: false };
  }
  async cancel(_messageId: string, _attemptId: string, context: AdapterContext): Promise<CancelResult> {
    return { kind: 'cancelled', cancelledAtMs: context.nowMs };
  }
}


export const testReceiptVerifier: ReceiptVerifier = Object.freeze({
  verify(_message: LogicalMessage, receipt: Receipt): boolean {
    return receipt.authenticated === true;
  },
});

export function routeRequirements(overrides: Partial<RouteRequirements> = {}): RouteRequirements {
  return {
    fragmentBytes: 4,
    fragmentCount: 1,
    requiresBinary: true,
    requiresFragmentation: false,
    requiresTransportReceipt: false,
    requiresEndRecipientReceipt: true,
    ...overrides,
  };
}
