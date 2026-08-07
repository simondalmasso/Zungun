declare const process: { env: Record<string, string | undefined>; argv: string[]; cwd(): string; exitCode?: number; pid: number; execPath: string; on(event: string, listener: (...args: any[]) => void): void; };
declare const Buffer: { from(value: string | ArrayBuffer | Uint8Array, encoding?: string): any; concat(values: readonly any[]): any; byteLength(value: string): number; };
type Buffer = any;
declare module 'node:assert/strict' { const assert: any; export default assert; export = assert; }
declare module 'node:test' { const test: any; export default test; export const describe: any; }
declare module 'node:crypto' { export const createHash: any; }
interface NodeProcessStdout { write(value: string): void; }
declare namespace process { }
declare module 'node:sqlite' { export class DatabaseSync { constructor(path: string, options?: any); exec(sql: string): void; prepare(sql: string): any; close(): void; } }
declare module 'node:fs' { export const readFileSync: any; export const writeFileSync: any; export const mkdirSync: any; }
declare module 'node:child_process' { export const spawnSync: any; export const execFileSync: any; export const spawn: any; export type ChildProcess = any; }
