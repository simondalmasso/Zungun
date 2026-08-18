// Bounded shadow of the public issue's described error-classification path.
export function fromError(e: unknown): object {
  if (e instanceof Error) {
    return { name: 'UnknownError', message: e.message || 'Network connection lost' };
  }
  return { name: 'UnknownError' };
}
