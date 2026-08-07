declare module 'node:fs' {
  export const accessSync: any;
  export const appendFileSync: any;
  export const copyFileSync: any;
  export const createReadStream: any;
  export const createWriteStream: any;
  export const lstatSync: any;
  export const readFile: any;
  export const writeFile: any;
  export const symlinkSync: any;
}
declare module 'node:fs/promises' {
  export const access: any;
  export const readFile: any;
  export const writeFile: any;
  export const mkdir: any;
  export const rm: any;
  export const readdir: any;
  export const stat: any;
}
declare module 'node:path' {
  export const normalize: any;
  export const isAbsolute: any;
  export const parse: any;
  export const format: any;
  export const delimiter: any;
}
declare module 'node:os' {
  export const homedir: any;
  export const platform: any;
}
declare module 'node:url' {
  export const pathToFileURL: any;
}
declare module 'node:crypto' {
  export const createHmac: any;
  export const createCipheriv: any;
  export const createDecipheriv: any;
  export const scryptSync: any;
  export const pbkdf2Sync: any;
  export const randomInt: any;
  export const webcrypto: any;
}
declare module 'node:http' {
  export const get: any;
}
declare module 'node:https' {
  export const request: any;
  export const get: any;
}
declare module 'node:stream' {
  export class Readable { static from(value: any): any; }
  export class Writable {}
  export class Transform {}
  export const pipeline: any;
}
declare module 'node:events' {
  export class EventEmitter { on(event: string, listener: (...args: any[]) => void): this; emit(event: string, ...args: any[]): boolean; }
}
declare module 'node:util' {
  export const promisify: any;
}
declare module 'node:timers/promises' {
  export const setTimeout: any;
}
declare module 'node:module' {
  export const builtinModules: readonly string[];
}
declare module 'node:process' {
  const processValue: any;
  export default processValue;
}
declare module 'node:buffer' {
  export const Buffer: any;
}
