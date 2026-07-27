declare module 'node:test' {
  export interface TestContext { readonly name: string; }
  export default function test(name: string, fn: (t: TestContext) => void | Promise<void>): void;
}
declare module 'node:assert/strict' {
  interface Assert {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): asserts value;
    match(value: string, regexp: RegExp, message?: string): void;
  }
  const assert: Assert;
  export default assert;
}
