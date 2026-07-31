export type D1Value = null | number | string | ArrayBuffer | ArrayBufferView;

export interface D1Meta {
  readonly changes?: number;
  readonly rows_read?: number;
  readonly rows_written?: number;
  readonly last_row_id?: number;
  readonly changed_db?: boolean;
}

export interface D1Result<T = Record<string, unknown>> {
  readonly success: boolean;
  readonly results: readonly T[];
  readonly meta: D1Meta;
  readonly error?: string;
}

export interface D1PreparedStatement {
  bind(...values: readonly D1Value[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = readonly unknown[]>(options?: { readonly columnNames?: boolean }): Promise<readonly T[]>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: readonly D1PreparedStatement[]): Promise<readonly D1Result<T>[]>;
}
