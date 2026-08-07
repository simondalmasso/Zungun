declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  cwd(): string;
  exitCode?: number;
  pid: number;
  execPath: string;
  on(event: string, listener: (...args: any[]) => void): void;
};
declare const Buffer: {
  from(value: string | ArrayBuffer | Uint8Array, encoding?: string): any;
  concat(values: readonly any[]): any;
  byteLength(value: string): number;
  alloc(size: number): any;
};
type Buffer = any;
declare module 'node:assert/strict' { const assert: any; export default assert; export = assert; }
declare module 'node:test' { const test: any; export default test; export const describe: any; export const before: any; export const after: any; }
declare module 'node:crypto' {
  export const createHash: any; export const createSign: any; export const createVerify: any;
  export const generateKeyPairSync: any; export const randomUUID: any; export const randomBytes: any;
  export const createPrivateKey: any; export const createPublicKey: any; export const timingSafeEqual: any;
}
declare module 'node:fs' {
  export const readFileSync: any; export const writeFileSync: any; export const existsSync: any;
  export const mkdirSync: any; export const chmodSync: any; export const rmSync: any; export const mkdtempSync: any;
  export const readdirSync: any; export const statSync: any; export const cpSync: any;
  export const renameSync: any; export const openSync: any; export const fsyncSync: any;
  export const closeSync: any; export const unlinkSync: any; export const realpathSync: any;
}
declare module 'node:path' { export const join: any; export const resolve: any; export const dirname: any; export const basename: any; export const extname: any; export const relative: any; export const sep: any; }
declare module 'node:os' { export const tmpdir: any; }
declare module 'node:url' { export const fileURLToPath: any; export const URL: any; }
declare module 'node:http' { export const createServer: any; export const request: any; export type IncomingMessage = any; export type ServerResponse = any; }
declare module 'node:sqlite' { export class DatabaseSync { constructor(path: string, options?: any); exec(sql: string): void; prepare(sql: string): any; close(): void; }
}
declare module 'node:child_process' { export const spawnSync: any; export const execFileSync: any; export const spawn: any; export type ChildProcess = any; }
declare module 'node:zlib' { export const gzipSync: any; }
