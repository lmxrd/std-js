import type { ResultIterableContext, ResultObject } from "./core.ts";
import { QueryError } from "./errors.ts";

/**
 * Row
 *
 * A single row as returned by a database driver, before it is mapped to a
 * record. This is the low-level row protocol that drivers use to construct a
 * {@linkcode ResultIterableContext} with {@linkcode createResultIterableContext}.
 *
 * @example
 * ```ts
 * import type { Row } from "@stdx/database/sql";
 *
 * const row: Row = {
 *   columns: ["id", "name"],
 *   values: [1, "Alice"],
 *   // Column types, when the driver reports them.
 *   meta: { types: ["INTEGER", "TEXT"] },
 * };
 * console.log(row.values[1]); // "Alice"
 * ```
 */
export interface Row {
  /**
   * The column names, in the same order as the values
   */
  columns: string[];
  /**
   * The values, in the same order as the columns
   */
  values: unknown[];
  /**
   * Additional information about the row, such as the column types. The
   * content depends on the driver and database.
   */
  meta?: Record<string, unknown>;
}

/**
 * Map a single {@linkcode Row} to a record mapping column names to values.
 *
 * If there are more columns than values, the missing values are `undefined`.
 * If there are more values than columns, the extra values are ignored.
 *
 * @param row the row to map
 *
 * @example
 * ```ts
 * import { getObjectFromRow } from "@stdx/database/sql";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(
 *   getObjectFromRow({ columns: ["a", "b"], values: ["c", 1] }),
 *   { a: "c", b: 1 },
 * );
 * ```
 */
export function getObjectFromRow(row: Row): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  const { columns, values } = row;
  for (let i = 0; i < columns.length; i++) {
    record[columns[i]] = values[i];
  }
  return record;
}

/**
 * ResultSource
 *
 * The result of a query as produced by a driver, from which
 * {@linkcode createResultIterableContext} creates a
 * {@linkcode ResultIterableContext}.
 *
 * @example
 * ```ts
 * import type { ResultSource } from "@stdx/database/sql";
 *
 * const source: ResultSource = {
 *   // The columns are known before the first row.
 *   columns: ["id", "name"],
 *   // The rows are read lazily.
 *   rows: (async function* () {
 *     yield [1, "Alice"];
 *   })(),
 * };
 * console.log(source.columns); // ["id", "name"]
 * ```
 */
export interface ResultSource {
  /**
   * The column names of the result, known before the first row. Only empty
   * for a result without rows when the database does not report the columns
   * without rows.
   */
  columns: string[];
  /**
   * The values of the rows, in the order of the columns. The rows are read
   * lazily, and the iterator is returned early when the result is disposed,
   * so that the driver can clean up, such as in a `finally` block.
   */
  rows: AsyncIterable<unknown[]>;
}

/**
 * Create a lazy, single-pass {@linkcode ResultIterableContext}. This is a
 * helper for driver authors implementing the query methods.
 *
 * The query is started with `start` when the result is first consumed, or
 * when its columns are requested. Starting reads the first row, so that the
 * query runs and errors are thrown, and so that the cleanup of the rows
 * iterator runs when the result is disposed. Rows are not kept in memory, so
 * the result can be consumed once: consuming it again rejects with a
 * {@linkcode QueryError}. Disposing a result that was never started does not
 * start it.
 *
 * @param start starts the query and resolves to its source
 * @returns the result context
 *
 * @example
 * ```ts
 * import { createResultIterableContext } from "@stdx/database/sql";
 * import { assertEquals } from "@std/assert";
 *
 * async function* rows() {
 *   yield [1, "Alice"];
 * }
 *
 * const ctx = createResultIterableContext(() =>
 *   Promise.resolve({ columns: ["id", "name"], rows: rows() })
 * );
 * assertEquals(await ctx.columns(), ["id", "name"]);
 * assertEquals(await ctx.toRecords(), [{ id: 1, name: "Alice" }]);
 * ```
 */
export function createResultIterableContext(
  start: () => Promise<ResultSource>,
): ResultIterableContext {
  interface Started {
    columns: string[];
    iterator: AsyncIterator<unknown[]>;
    first: IteratorResult<unknown[]>;
  }
  let started: Promise<Started> | undefined;
  let consumed = false;
  let disposed = false;

  function begin(): Promise<Started> {
    return started ??= (async () => {
      const source = await start();
      const iterator = source.rows[Symbol.asyncIterator]();
      return {
        columns: source.columns,
        iterator,
        first: await iterator.next(),
      };
    })();
  }

  function assertUsable(): void {
    if (disposed) throw new QueryError("The result is disposed");
  }

  async function* rows(): AsyncGenerator<ResultObject> {
    assertUsable();
    if (consumed) {
      throw new QueryError(
        "The result has already been consumed: a result can be iterated or collected once",
      );
    }
    consumed = true;
    const { columns, iterator, first } = await begin();
    let result = first;
    try {
      while (!result.done) {
        const values = result.value;
        yield { values, toRecord: () => getObjectFromRow({ columns, values }) };
        if (disposed) return;
        result = await iterator.next();
      }
    } finally {
      // Stops the source when the iteration ends early.
      if (!result.done) await iterator.return?.();
    }
  }

  async function collect<T>(map: (row: ResultObject) => T): Promise<T[]> {
    const values: T[] = [];
    for await (const row of rows()) values.push(map(row));
    return values;
  }

  async function firstRow<T>(
    map: (row: ResultObject) => T,
  ): Promise<T | undefined> {
    assertUsable();
    if (consumed) {
      throw new QueryError(
        "The result has already been consumed: a result can be iterated or collected once",
      );
    }
    consumed = true;
    const { columns, iterator, first } = await begin();
    try {
      if (first.done) return undefined;
      const values = first.value;
      return map({
        values,
        toRecord: () => getObjectFromRow({ columns, values }),
      });
    } finally {
      // The remaining rows are not read, so the source is stopped.
      if (!first.done) await iterator.return?.();
    }
  }

  return {
    [Symbol.asyncIterator]: rows,
    async [Symbol.asyncDispose](): Promise<void> {
      if (disposed) return;
      disposed = true;
      if (!started) return;
      try {
        await (await started).iterator.return?.();
      } catch {
        // The query failed to start, so there is nothing to clean up.
      }
    },
    async columns(): Promise<string[]> {
      assertUsable();
      return (await begin()).columns;
    },
    toValues: () => collect((row) => row.values),
    toRecords: () => collect((row) => row.toRecord()),
    firstValues: () => firstRow((row) => row.values),
    firstRecord: () => firstRow((row) => row.toRecord()),
  };
}
