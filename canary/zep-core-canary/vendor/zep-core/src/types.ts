export type DeliveryState =
  | 'QUEUED'
  | 'ELIGIBLE'
  | 'SENDING'
  | 'ACCEPTED'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'UNKNOWN'
  | 'ACKNOWLEDGED'
  | 'PERMANENTLY_REJECTED'
  | 'EXPIRED'
  | 'FAILED';

export type ReceiptPolicy = 'END_RECIPIENT_ACK';
export type ReceiptKind =
  | 'TRANSPORT_ACCEPTED'
  | 'NEXT_HOP_STORED'
  | 'END_RECIPIENT_ACKNOWLEDGED';

export type ExtensionPrimitive = null | string | number | boolean;
export interface ExtensionArray extends ReadonlyArray<ExtensionValue> {}
export interface ExtensionObject { readonly [key: string]: ExtensionValue; }
export type ExtensionValue = ExtensionPrimitive | ExtensionArray | ExtensionObject;

export interface LogicalMessageInput {
  readonly zepVersion: '0.1';
  readonly messageId: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly recipientIds: readonly string[];
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly priority: 0 | 1 | 2 | 3;
  readonly contentType: string;
  readonly payload: Uint8Array;
  readonly receiptPolicy: ReceiptPolicy;
  readonly messageCommitment: string;
  readonly extensions?: unknown;
}

export interface LogicalMessage extends Omit<LogicalMessageInput, 'extensions'> {
  /** Returns a defensive copy on every access. */
  readonly payload: Uint8Array;
  /** Deep-normalized and deeply frozen JSON-like values only. */
  readonly extensions?: ExtensionObject;
}

export interface Fragment {
  readonly messageId: string;
  readonly messageCommitment: string;
  readonly fragmentIndex: number;
  readonly fragmentCount: number;
  readonly byteOffset: number;
  readonly fragmentPayload: Uint8Array;
  readonly authenticated: boolean;
  readonly expiresAtMs: number;
}

export interface Receipt {
  readonly receiptId: string;
  readonly messageId: string;
  readonly messageCommitment: string;
  readonly recipientId: string;
  readonly receiptKind: ReceiptKind;
  readonly observedAtMs: number;
  readonly adapterId: string;
  readonly externalReference?: string;
  readonly authenticated: boolean;
}


export interface ReceiptVerifier {
  /** Returns true only when the receipt authentication proof is valid for this exact message. */
  verify(message: LogicalMessage, receipt: Receipt): boolean;
}

/** Opaque runtime-branded proof produced only by verifyEndRecipientReceipt. */
export interface VerifiedEndRecipientReceipt {
  readonly receipt: Receipt;
}

export interface TransitionRecord {
  readonly sequence: number;
  readonly messageId: string;
  readonly fromState: DeliveryState;
  readonly toState: DeliveryState;
  readonly atMs: number;
  readonly attemptId: string | null;
  readonly adapterId: string | null;
  readonly reasonCode: string | null;
  readonly evidenceReference: string | null;
}

export interface RecipientAcknowledgementRecord {
  readonly sequence: number;
  readonly messageId: string;
  readonly recipientId: string;
  readonly atMs: number;
  readonly adapterId: string;
  readonly receiptId: string;
}

export type Eligibility = 'ALLOWED' | 'DENIED' | 'UNKNOWN';

export interface TransportCapabilities {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly maximumPayloadBytes: number;
  readonly supportsBinary: boolean;
  readonly supportsFragmentation: boolean;
  readonly supportsTransportReceipt: boolean;
  readonly supportsEndRecipientReceipt: boolean;
  readonly supportsCancel: boolean;
  readonly supportsBackground: boolean;
  readonly supportsStoreAndForward: boolean;
  readonly requiresUserPresence: boolean;
  readonly requiresExternalHardware: boolean;
  readonly requiresOperatorEntitlement: boolean;
  readonly availabilityClass: number;
  readonly expectedLatencyClass: number;
  /** Deterministic conservative completion estimate used for deadline feasibility. */
  readonly estimatedCompletionDurationMs: number;
  readonly monetaryCostClass: number;
  readonly energyCostClass: number;
  readonly privacyMetadataClass: number;
  readonly currentEligibility: Eligibility;
  readonly duplicateSafe: boolean;
}

export type SendResult =
  | { readonly kind: 'accepted'; readonly acceptedAtMs: number; readonly externalReference?: string; readonly receiptExpectation?: string }
  | { readonly kind: 'temporarilyUnavailable'; readonly reasonCode: string; readonly retryAfterMs?: number }
  | { readonly kind: 'permanentlyRejected'; readonly reasonCode: string }
  | { readonly kind: 'acknowledged'; readonly receipt: Receipt }
  | { readonly kind: 'unknown'; readonly reasonCode: string; readonly externalReference?: string };

export interface AdapterContext {
  readonly nowMs: number;
}

export interface AttemptContext extends AdapterContext {
  readonly attemptId: string;
  readonly idempotencyKey: string;
  readonly deadlineMs: number;
}

export interface ReceiveContext extends AdapterContext {
  readonly limit: number;
}

export type TransportAvailability = 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN';

export interface TransportStatus {
  readonly adapterId: string;
  readonly observedAtMs: number;
  readonly availability: TransportAvailability;
  readonly currentEligibility: Eligibility;
  readonly reasonCode?: string;
  readonly estimatedReadyAtMs?: number;
}

export type ReceivedItem =
  | { readonly kind: 'fragment'; readonly fragment: Fragment }
  | { readonly kind: 'receipt'; readonly receipt: Receipt };

export interface ReceiveBatch {
  readonly cursor: string | null;
  readonly items: readonly ReceivedItem[];
  readonly observedAtMs: number;
  readonly hasMore: boolean;
}

export type CancelResult =
  | { readonly kind: 'cancelled'; readonly cancelledAtMs: number }
  | { readonly kind: 'unsupported'; readonly reasonCode: string }
  | { readonly kind: 'unknown'; readonly reasonCode: string };

export interface TransportAdapter {
  capabilities(context: AdapterContext): Promise<TransportCapabilities>;
  status(context: AdapterContext): Promise<TransportStatus>;
  send(fragment: Fragment, context: AttemptContext): Promise<SendResult>;
  receive(cursor: string | null, context: ReceiveContext): Promise<ReceiveBatch>;
  cancel(messageId: string, attemptId: string, context: AdapterContext): Promise<CancelResult>;
}


export interface RouteRequirements {
  readonly fragmentBytes: number;
  readonly fragmentCount: number;
  readonly requiresBinary: boolean;
  readonly requiresFragmentation: boolean;
  readonly requiresTransportReceipt: boolean;
  readonly requiresEndRecipientReceipt: boolean;
}

export interface RoutePolicy {
  readonly version: string;
  readonly maximumMonetaryCostClass: number;
  readonly maximumEnergyCostClass: number;
  readonly maximumPrivacyMetadataClass: number;
  readonly allowedAdapterIds?: ReadonlySet<string>;
  readonly disabledAdapterIds?: ReadonlySet<string>;
  readonly acceptsDuplicationRisk: boolean;
}

export interface RouteScoreInputs {
  readonly availabilityClass: number;
  readonly expectedLatencyClass: number;
  readonly estimatedCompletionDurationMs: number;
  readonly monetaryCostClass: number;
  readonly energyCostClass: number;
  readonly privacyMetadataClass: number;
  readonly priority: number;
}

export interface RouteDecision {
  readonly adapterId: string;
  readonly policyVersion: string;
  readonly score: number;
  readonly estimatedCompletionAtMs: number;
  readonly scoreInputs: RouteScoreInputs;
}
