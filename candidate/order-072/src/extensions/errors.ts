// PROVENANCE: RECONSTRUCTED_FROM_ORDER; extension-only errors deliberately do not shadow ZepError/fail.
export type ExtensionErrorCode = 'INSUFFICIENT_EVIDENCE' | 'TAMPER_DETECTED' | 'KIT_INVALID';

export class ExtensionError extends Error {
  readonly name = 'ExtensionError';
  constructor(readonly code: ExtensionErrorCode, message: string) { super(message); }
}

export function failExtension(code: ExtensionErrorCode, message: string): never {
  throw new ExtensionError(code, message);
}
