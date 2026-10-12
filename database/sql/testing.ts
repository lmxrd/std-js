/**
 * Reusable test suites that verify a SQL driver implements the interfaces from
 * `@stdx/database/sql`.
 *
 * @module
 */

import {
  assert,
  assertEquals,
  assertFalse,
  assertRejects,
  assertThrows,
} from "@std/assert";
import {
  assertIsClient,
  assertIsConnection,
  assertIsDialect,
  assertIsDriver,
  assertIsDriverConnection,
  assertIsPreparedStatement,
  assertIsTransaction,
} from "./asserts.ts";
import type {
  Client,
  ClientOptions,
  Connectable,
  Connection,
  ConnectionOptions,
  Driver,
  Pingable,
  Poolable,
  Preparable,
  Queryable,
  SqlTemplate,
  Transactionable,
} from "./core.ts";
import {
  ConnectionError,
  DatabaseError,
  QueryError,
  TransactionError,
} from "./errors.ts";
import type { ClientEventTarget, Eventable } from "./events.ts";

/**
 * A factory creating a fresh instance for each test step. Test steps mutate
 * the instances they are given, so a fresh instance must be created per step.
 *
 * @template T the instance type
 *
 * @example
 * ```ts
 * import type { Factory } from "@stdx/database/sql/testing";
 * import { SqliteClient } from "@stdx/database/drivers/sqlite";
 *
 * // A fresh client for every test step.
 * const create: Factory<SqliteClient> = () => new SqliteClient(":memory:");
 * ```
 */
export type Factory<T> = () => T | Promise<T>;

/**
 * TestSql
 *
 * The SQL statements used by the conformance test suite. The statements are
 * dialect specific and must be provided by the driver author.
 *
 * @example
 * ```ts
 * import { sql } from "@stdx/database/sql";
 * import type { TestSql } from "@stdx/database/sql/testing";
 *
 * // The statements of the database dialect under test.
 * const sqlite: TestSql = {
 *   execute: "CREATE TABLE IF NOT EXISTS users (id INTEGER, name TEXT)",
 *   query:
 *     "SELECT 1 AS id, 'Alice' AS name UNION ALL SELECT 2, 'Bob'",
 *   columns: ["id", "name"],
 *   count: 2,
 *   parameterQuery: "SELECT ? AS value",
 *   emptyQuery: "SELECT 1 AS id, 'Alice' AS name WHERE 1 = 0",
 *   parameterTemplate: (value) => sql`SELECT ${value} AS value`,
 * };
 * ```
 */
export interface TestSql {
  /**
   * A SQL statement that can be executed without returning rows, for example
   * a `CREATE TABLE` statement
   */
  execute: string;
  /**
   * A SQL query returning the rows described by
   * {@linkcode TestSql.columns} and {@linkcode TestSql.count}
   */
  query: string;
  /**
   * The expected column names of {@linkcode TestSql.query}
   */
  columns: string[];
  /**
   * The expected number of rows of {@linkcode TestSql.query}
   */
  count: number;
  /**
   * A SQL query selecting the single string parameter it is given, as a
   * column named `value`, for example `SELECT ? AS value` or
   * `SELECT $1::text AS value`
   */
  parameterQuery: string;
  /**
   * A SQL query returning the columns of {@linkcode TestSql.columns}, but no
   * rows, for example `SELECT id, name FROM users WHERE 1 = 0`
   */
  emptyQuery: string;
  /**
   * Create a {@linkcode SqlTemplate} selecting the single string value it is
   * given, as a column named `value`, for example
   * ``(value) => sql`SELECT ${value} AS value` `` or
   * ``(value) => sql`SELECT ${value}::text AS value` ``
   */
  parameterTemplate: (value: string) => SqlTemplate;
}

/**
 * A statement that is invalid in every SQL dialect
 */
const INVALID_SQL = "THIS IS NOT VALID SQL";

/**
 * Assert that the promise only settles after the action has run
 */
async function assertWaitsFor(
  promise: Promise<unknown>,
  action: () => PromiseLike<void>,
  message: string,
): Promise<void> {
  const order: string[] = [];
  const settled = promise.then(
    () => void order.push("settled"),
    () => void order.push("settled"),
  );
  // Let the pending work run, so a promise that does not wait settles first.
  await new Promise((resolve) => setTimeout(resolve, 0));
  order.push("action");
  await action();
  await settled;
  assertEquals(order, ["action", "settled"], message);
}

/**
 * Test the {@linkcode Connectable} capability.
 *
 * @param t the test context
 * @param create a factory creating a fresh instance
 *
 * @example
 * ```ts ignore
 * import { testConnectable } from "@stdx/database/sql/testing";
 * import { MyClient } from "./my_client.ts";
 *
 * Deno.test("MyClient connectable", async (t) => {
 *   await testConnectable(t, () => new MyClient(url));
 * });
 * ```
 */
export async function testConnectable(
  t: Deno.TestContext,
  create: Factory<Connectable>,
): Promise<void> {
  await t.step("connects and closes", async () => {
    const connectable = await create();
    assertFalse(connectable.connected);
    await connectable.connect();
    assert(connectable.connected);
    await connectable.close();
    assertFalse(connectable.connected);
  });

  await t.step("connect is idempotent", async () => {
    const connectable = await create();
    await connectable.connect();
    await connectable.connect();
    assert(connectable.connected);
    await connectable.close();
  });

  await t.step("concurrent connects share the connection", async () => {
    const connectable = await create();
    await Promise.all([connectable.connect(), connectable.connect()]);
    assert(connectable.connected);
    await connectable.close();
    assertFalse(connectable.connected);
  });

  await t.step("close is idempotent", async () => {
    const connectable = await create();
    await connectable.connect();
    await connectable.close();
    await connectable.close();
    assertFalse(connectable.connected);
  });

  await t.step("async dispose closes", async () => {
    const connectable = await create();
    await connectable.connect();
    await connectable[Symbol.asyncDispose]();
    assertFalse(connectable.connected);
  });
}

/**
 * Test the {@linkcode Pingable} capability.
 *
 * @param t the test context
 * @param create a factory creating a fresh, connectable instance
 *
 * @example
 * ```ts ignore
 * import { testPingable } from "@stdx/database/sql/testing";
 * import { MyClient } from "./my_client.ts";
 *
 * Deno.test("MyClient pingable", async (t) => {
 *   await testPingable(t, () => new MyClient(url));
 * });
 * ```
 */
export async function testPingable(
  t: Deno.TestContext,
  create: Factory<Pingable & Connectable>,
): Promise<void> {
  await t.step("ping while connected", async () => {
    const pingable = await create();
    await pingable.connect();
    await pingable.ping();
    await pingable.close();
  });

  await t.step("ping connects implicitly", async () => {
    const pingable = await create();
    await pingable.ping();
    assert(pingable.connected);
    await pingable.close();
  });

  await t.step("ping throws after close", async () => {
    const pingable = await create();
    await pingable.connect();
    await pingable.close();
    await assertRejects(async () => {
      await pingable.ping();
    }, ConnectionError);
  });
}

/**
 * Test the {@linkcode Queryable} capability.
 *
 * @param t the test context
 * @param create a factory creating a fresh, connectable instance
 * @param sql the SQL statements to test with
 *
 * @example
 * ```ts ignore
 * import { testQueryable } from "@stdx/database/sql/testing";
 * import { MyClient } from "./my_client.ts";
 *
 * Deno.test("MyClient queryable", async (t) => {
 *   await testQueryable(t, () => new MyClient(url), sql);
 * });
 * ```
 */
export async function testQueryable(
  t: Deno.TestContext,
  create: Factory<Connectable & Queryable>,
  sql: TestSql,
): Promise<void> {
  await t.step("execute", async () => {
    const queryable = await create();
    await queryable.connect();
    // The statement does not modify rows.
    const result = await queryable.execute(sql.execute);
    assert(
      result.affectedRows === undefined || result.affectedRows === 0,
      "execute must report 0 or undefined affected rows for statements that modify no rows",
    );
    await queryable.close();
  });

  await t.step("connects implicitly on first use", async () => {
    const queryable = await create();
    await queryable.execute(sql.execute);
    assert(queryable.connected);
    await queryable.close();

    const other = await create();
    assertEquals((await other.query(sql.query).toValues()).length, sql.count);
    assert(other.connected);
    await other.close();
  });

  await t.step("rejects after close", async () => {
    const queryable = await create();
    await queryable.connect();
    await queryable.close();
    await assertRejects(async () => {
      await queryable.execute(sql.execute);
    }, ConnectionError);
    await assertRejects(async () => {
      await queryable.query(sql.query).toValues();
    }, ConnectionError);
    await assertRejects(async () => {
      await queryable.executeScript(sql.execute);
    }, ConnectionError);
  });

  await t.step("query returns a result", async () => {
    const queryable = await create();
    await queryable.connect();
    const result = queryable.query(sql.query);
    assertEquals(await result.columns(), sql.columns);
    assertEquals((await result.toValues()).length, sql.count);
    await queryable.close();
  });

  await t.step("query is lazy", async () => {
    const queryable = await create();
    await queryable.connect();
    // Errors are thrown when the result is consumed.
    const result = queryable.query(INVALID_SQL);
    await assertRejects(() => result.toValues(), QueryError);
    // A result that is never consumed does not run.
    await queryable.query(INVALID_SQL)[Symbol.asyncDispose]();
    await queryable.close();
  });

  await t.step("query reports the columns of an empty result", async () => {
    const queryable = await create();
    await queryable.connect();
    const result = queryable.query(sql.emptyQuery);
    assertEquals(await result.columns(), sql.columns);
    assertEquals(await result.toValues(), []);
    await queryable.close();
  });

  await t.step("query can be iterated", async () => {
    const queryable = await create();
    await queryable.connect();
    let count = 0;
    for await (const row of queryable.query(sql.query)) {
      assertEquals(Object.keys(row.toRecord()), sql.columns);
      count++;
    }
    assertEquals(count, sql.count);
    await queryable.close();
  });

  await t.step("query results can be consumed once", async () => {
    const queryable = await create();
    await queryable.connect();
    const result = queryable.query(sql.query);
    assertEquals((await result.toRecords()).length, sql.count);
    await assertRejects(() => result.toValues(), QueryError, "consumed");
    await assertRejects(async () => {
      for await (const _row of result) {
        // Not reached
      }
    }, QueryError);
    // The columns are still available.
    assertEquals(await result.columns(), sql.columns);
    await queryable.close();
  });

  await t.step(
    "firstValues and firstRecord return the first row or undefined",
    async () => {
      const queryable = await create();
      await queryable.connect();
      const [expectedRecord] = await queryable.query(sql.query).toRecords();
      assertEquals(
        await queryable.query(sql.query).firstRecord(),
        expectedRecord,
      );
      const [expectedValues] = await queryable.query(sql.query).toValues();
      assertEquals(
        await queryable.query(sql.query).firstValues(),
        expectedValues,
      );
      // An empty result resolves to undefined.
      assertEquals(
        await queryable.query(sql.emptyQuery).firstRecord(),
        undefined,
      );
      assertEquals(
        await queryable.query(sql.emptyQuery).firstValues(),
        undefined,
      );
      // Taking the first row consumes the result.
      const result = queryable.query(sql.query);
      await result.firstValues();
      await assertRejects(() => result.toValues(), QueryError, "consumed");
      const record = queryable.query(sql.query);
      await record.firstRecord();
      await assertRejects(() => record.toValues(), QueryError, "consumed");
      await queryable.close();
    },
  );

  await t.step("binds parameters", async () => {
    const queryable = await create();
    await queryable.connect();
    const result = queryable.query(sql.parameterQuery, ["a"]);
    assertEquals(await result.columns(), ["value"]);
    assertEquals(await result.toValues(), [["a"]]);
    await queryable.close();
  });

  await t.step("runs SQL templates", async () => {
    const queryable = await create();
    await queryable.connect();
    assertEquals(
      await queryable.query(sql.parameterTemplate("a")).toValues(),
      [["a"]],
    );
    const result = await queryable.execute(sql.parameterTemplate("b"));
    assertEquals(result.affectedRows ?? 0, 0);
    // Templates carry their own values.
    await assertRejects(async () => {
      await queryable.execute(sql.parameterTemplate("c"), ["d"]);
    }, QueryError);
    await queryable.close();
  });

  await t.step("invalid statements throw a QueryError", async () => {
    const queryable = await create();
    await queryable.connect();
    await assertRejects(async () => {
      await queryable.query(INVALID_SQL).toValues();
    }, QueryError);
    await assertRejects(async () => {
      await queryable.execute(INVALID_SQL);
    }, QueryError);
    // The connection is still usable after an error.
    await queryable.execute(sql.execute);
    await queryable.close();
  });

  await t.step("transforms input and output values", async () => {
    const queryable = await create();
    await queryable.connect();
    const result = queryable.query(sql.parameterQuery, ["a"], {
      transformInput: (value) => `${value}b`,
      transformOutput: (value) =>
        typeof value === "string" ? value.toUpperCase() : value,
    });
    assertEquals(await result.toValues(), [["AB"]]);
    await queryable.close();
  });

  await t.step("rejects with the reason of an aborted signal", async () => {
    const queryable = await create();
    await queryable.connect();
    const reason = new Error("aborted");
    const signal = AbortSignal.abort(reason);
    assertEquals(
      await assertRejects(() =>
        queryable.query(sql.query, [], { signal }).toValues()
      ),
      reason,
    );
    assertEquals(
      await assertRejects(() => queryable.execute(sql.execute, [], { signal })),
      reason,
    );
    assertEquals(
      await assertRejects(() =>
        queryable.executeScript(sql.execute, { signal })
      ),
      reason,
    );
    await queryable.close();
  });

  if (sql.count > 1) {
    await t.step("stops iterating when the signal aborts", async () => {
      const queryable = await create();
      await queryable.connect();
      const controller = new AbortController();
      const result = queryable.query(sql.query, [], {
        signal: controller.signal,
      });
      await result.columns();
      controller.abort(new Error("aborted"));
      assertEquals(
        await assertRejects(() => result.toValues()),
        controller.signal.reason,
      );
      // The connection is still usable after an abort.
      await queryable.execute(sql.execute);
      await queryable.close();
    });
  }

  await t.step("disposing a result stops fetching", async () => {
    const queryable = await create();
    await queryable.connect();
    const result = queryable.query(sql.query);
    await result.columns();
    await result[Symbol.asyncDispose]();
    await assertRejects(() => result.toValues(), QueryError, "disposed");
    await queryable.execute(sql.execute);
    await queryable.close();
  });

  await t.step("executes scripts", async () => {
    const queryable = await create();
    await queryable.connect();
    await queryable.executeScript(`${sql.execute};\n${sql.execute};`);
    await assertRejects(async () => {
      await queryable.executeScript(INVALID_SQL);
    }, QueryError);
    await queryable.execute(sql.execute);
    await queryable.close();
  });
}

/**
 * Test the {@linkcode Preparable} capability.
 *
 * @param t the test context
 * @param create a factory creating a fresh, connectable instance
 * @param sql the SQL statements to test with
 *
 * @example
 * ```ts ignore
 * import { testPreparable } from "@stdx/database/sql/testing";
 * import { MyClient } from "./my_client.ts";
 *
 * Deno.test("MyClient preparable", async (t) => {
 *   await testPreparable(t, () => new MyClient(url), sql);
 * });
 * ```
 */
export async function testPreparable(
  t: Deno.TestContext,
  create: Factory<Connectable & Preparable>,
  sql: TestSql,
): Promise<void> {
  await t.step("prepare, query, execute and deallocate", async () => {
    const preparable = await create();
    await preparable.connect();
    const stmt = await preparable.prepare(sql.query);
    assertIsPreparedStatement(stmt);
    assertEquals(stmt.sql, sql.query);
    assertFalse(stmt.deallocated);

    assertEquals((await stmt.query().toValues()).length, sql.count);

    const result = await stmt.execute();
    assert(
      typeof result === "object" &&
        (result.affectedRows === undefined || result.affectedRows === 0),
      "execute must report 0 or undefined affected rows for statements that modify no rows",
    );

    await stmt.deallocate();
    assert(stmt.deallocated);
    await stmt.deallocate();
    await assertRejects(async () => {
      await stmt.query().toValues();
    }, QueryError);
    await assertRejects(async () => {
      await stmt.execute();
    }, QueryError);
    await preparable.close();
  });

  await t.step("prepared statements are reusable with parameters", async () => {
    const preparable = await create();
    await preparable.connect();
    const stmt = await preparable.prepare(sql.parameterQuery);
    assertEquals(await stmt.query(["a"]).toValues(), [["a"]]);
    assertEquals(await stmt.query(["b"]).toValues(), [["b"]]);
    await stmt.deallocate();
    await preparable.close();
  });

  await t.step("invalid statements throw a QueryError", async () => {
    const preparable = await create();
    await preparable.connect();
    // Databases without native prepared statements fail on execution.
    await assertRejects(async () => {
      const stmt = await preparable.prepare(INVALID_SQL);
      await stmt.query().toValues();
    }, QueryError);
    await preparable.close();
  });

  await t.step("prepare connects implicitly", async () => {
    const preparable = await create();
    const stmt = await preparable.prepare(sql.query);
    assertEquals((await stmt.query().toValues()).length, sql.count);
    await stmt.deallocate();
    await preparable.close();
  });

  await t.step("prepare rejects after close", async () => {
    const preparable = await create();
    await preparable.connect();
    await preparable.close();
    await assertRejects(async () => {
      await preparable.prepare(sql.query);
    }, ConnectionError);
  });

  await t.step("async dispose deallocates", async () => {
    const preparable = await create();
    await preparable.connect();
    const stmt = await preparable.prepare(sql.query);
    await stmt[Symbol.asyncDispose]();
    assert(stmt.deallocated);
    await preparable.close();
  });
}

/**
 * Test the {@linkcode Transactionable} capability.
 *
 * @param t the test context
 * @param create a factory creating a fresh, connectable instance
 * @param sql the SQL statements to test with
 *
 * @example
 * ```ts ignore
 * import { testTransactionable } from "@stdx/database/sql/testing";
 * import { MyClient } from "./my_client.ts";
 *
 * Deno.test("MyClient transactionable", async (t) => {
 *   await testTransactionable(t, () => new MyClient(url), sql);
 * });
 * ```
 */
export async function testTransactionable(
  t: Deno.TestContext,
  create: Factory<Connectable & Transactionable>,
  sql: TestSql,
): Promise<void> {
  await t.step("begin and commit", async () => {
    const transactionable = await create();
    await transactionable.connect();
    const tx = await transactionable.beginTransaction();
    assertIsTransaction(tx);
    assert(tx.inTransaction);
    await tx.execute(sql.execute);
    assertEquals((await tx.query(sql.query).toValues()).length, sql.count);
    await tx.commit();
    assertFalse(tx.inTransaction);
    await assertRejects(async () => {
      await tx.execute(sql.execute);
    }, TransactionError);
    await assertRejects(async () => {
      await tx.commit();
    }, TransactionError);
    await transactionable.close();
  });

  await t.step("rollback", async () => {
    const transactionable = await create();
    await transactionable.connect();
    const tx = await transactionable.beginTransaction();
    await tx.execute(sql.execute);
    await tx.rollback();
    assertFalse(tx.inTransaction);
    await assertRejects(async () => {
      await tx.query(sql.query).toValues();
    }, TransactionError);
    await assertRejects(async () => {
      await tx.rollback();
    }, TransactionError);
    await transactionable.close();
  });

  await t.step("savepoints", async () => {
    const transactionable = await create();
    await transactionable.connect();
    const tx = await transactionable.beginTransaction();
    await tx.createSavepoint("sp");
    await tx.execute(sql.execute);
    await tx.releaseSavepoint("sp");
    await tx.commit();
    await transactionable.close();
  });

  await t.step("savepoints with generated names", async () => {
    const transactionable = await create();
    await transactionable.connect();
    const tx = await transactionable.beginTransaction();
    await tx.createSavepoint();
    await tx.execute(sql.execute);
    await tx.releaseSavepoint();
    await tx.commit();
    await transactionable.close();
  });

  await t.step("nested transactions create savepoints", async () => {
    const transactionable = await create();
    await transactionable.connect();
    const outer = await transactionable.beginTransaction();
    await outer.execute(sql.execute);

    const inner = await outer.beginTransaction();
    assertIsTransaction(inner);
    assert(inner.inTransaction);
    await inner.execute(sql.execute);
    await inner.rollback();
    assertFalse(inner.inTransaction);

    assert(
      outer.inTransaction,
      "The outer transaction must still be active after a nested rollback",
    );
    assertEquals((await outer.query(sql.query).toValues()).length, sql.count);
    await outer.commit();
    assertFalse(outer.inTransaction);
    await transactionable.close();
  });

  await t.step("nested transaction wrapper commits the savepoint", async () => {
    const transactionable = await create();
    await transactionable.connect();
    const outer = await transactionable.beginTransaction();
    const result = await outer.transaction(async (inner) => {
      assertIsTransaction(inner);
      assert(inner.inTransaction);
      await inner.execute(sql.execute);
      return "nested";
    });
    assertEquals(result, "nested");
    assert(
      outer.inTransaction,
      "The outer transaction must still be active after a nested commit",
    );
    await outer.commit();
    await transactionable.close();
  });

  await t.step("ending a transaction invalidates nested ones", async () => {
    const transactionable = await create();
    await transactionable.connect();
    const outer = await transactionable.beginTransaction();
    const nested = await outer.beginTransaction();
    const deeper = await nested.beginTransaction();
    await nested.rollback();
    assertFalse(deeper.inTransaction);
    await assertRejects(async () => {
      await deeper.query(sql.query).toValues();
    }, TransactionError);
    assert(outer.inTransaction);

    const other = await outer.beginTransaction();
    await outer.commit();
    assertFalse(other.inTransaction);
    await assertRejects(async () => {
      await other.commit();
    }, TransactionError);
    await transactionable.close();
  });

  await t.step("beginTransaction rejects after close", async () => {
    const transactionable = await create();
    await transactionable.connect();
    await transactionable.close();
    await assertRejects(async () => {
      await transactionable.beginTransaction();
    }, DatabaseError);
  });

  await t.step("transaction wrapper commits on success", async () => {
    const transactionable = await create();
    await transactionable.connect();
    const result = await transactionable.transaction(async (tx) => {
      assert(tx.inTransaction);
      await tx.execute(sql.execute);
      return "done";
    });
    assertEquals(result, "done");
    await transactionable.close();
  });

  await t.step("transaction wrapper rolls back on error", async () => {
    const transactionable = await create();
    await transactionable.connect();
    await assertRejects(async () => {
      await transactionable.transaction(async (tx) => {
        await tx.execute(sql.execute);
        throw new Error("expected error");
      });
    });
    await transactionable.close();
  });

  await t.step("async dispose rolls back an active transaction", async () => {
    const transactionable = await create();
    await transactionable.connect();
    const tx = await transactionable.beginTransaction();
    await tx[Symbol.asyncDispose]();
    assertFalse(tx.inTransaction);
    await transactionable.close();
  });
}

/**
 * Test the events of an `Eventable` connectable object. The `connect` and
 * `close` events must be dispatched with the dispatching object available as
 * the `client` in the event detail.
 *
 * @param t the test context
 * @param create a factory creating a fresh, connectable instance
 *
 * @example
 * ```ts ignore
 * import { testEventable } from "@stdx/database/sql/testing";
 * import { MyClient } from "./my_client.ts";
 *
 * Deno.test("MyClient eventable", async (t) => {
 *   await testEventable(t, () => new MyClient(url));
 * });
 * ```
 */
export async function testEventable(
  t: Deno.TestContext,
  create: Factory<Connectable & Eventable<ClientEventTarget>>,
): Promise<void> {
  await t.step(
    "dispatches connect and close events with the client",
    async () => {
      const source = await create();
      const eventTarget: EventTarget = source.eventTarget;
      let connectClient: unknown;
      let closeClient: unknown;
      eventTarget.addEventListener("connect", (event) => {
        connectClient = (event as CustomEvent<{ client?: unknown }>).detail
          ?.client;
      });
      eventTarget.addEventListener("close", (event) => {
        closeClient = (event as CustomEvent<{ client?: unknown }>).detail
          ?.client;
      });
      await source.connect();
      await source.close();
      assertEquals(connectClient, source);
      assertEquals(closeClient, source);
    },
  );
}

/**
 * Test the {@linkcode Poolable} capability.
 *
 * @param t the test context
 * @param create a factory creating a fresh, connectable instance
 *
 * @example
 * ```ts ignore
 * import { testPoolable } from "@stdx/database/sql/testing";
 * import { MyClient } from "./my_client.ts";
 *
 * Deno.test("MyClient poolable", async (t) => {
 *   await testPoolable(t, () => new MyClient(url));
 * });
 * ```
 */
export async function testPoolable(
  t: Deno.TestContext,
  create: Factory<Connectable & Poolable>,
): Promise<void> {
  await t.step("acquire returns a connected connection", async () => {
    const poolable = await create();
    await poolable.connect();
    const connection = await poolable.acquire();
    assertIsConnection(connection);
    assert(connection.connected);
    assertFalse(connection.released);
    await connection.release();
    assert(connection.released);
    await poolable.close();
  });

  await t.step("acquire connects implicitly", async () => {
    const poolable = await create();
    const connection = await poolable.acquire();
    assert(connection.connected);
    await connection.release();
    await poolable.close();
  });

  await t.step("acquire rejects after close", async () => {
    const poolable = await create();
    await poolable.connect();
    await poolable.close();
    await assertRejects(async () => {
      await poolable.acquire();
    }, ConnectionError);
  });

  await t.step("release is idempotent", async () => {
    const poolable = await create();
    await poolable.connect();
    const connection = await poolable.acquire();
    await connection.release();
    await connection.release();
    assert(connection.released);
    await poolable.close();
  });

  await t.step("remove disposes and closes the connection", async () => {
    const poolable = await create();
    await poolable.connect();
    const connection = await poolable.acquire();
    await connection.remove();
    assert(connection.released);
    assertFalse(connection.connected);
    await poolable.close();
  });

  await t.step("async dispose releases", async () => {
    const poolable = await create();
    await poolable.connect();
    const connection = await poolable.acquire();
    await connection[Symbol.asyncDispose]();
    assert(connection.released);
    await poolable.close();
  });
}

/**
 * Test the pooling behavior of a {@linkcode Client}: the pool size, and the
 * connections held by the query, prepare and transaction methods.
 *
 * @param t the test context
 * @param create a factory creating a fresh client
 * @param sql the SQL statements to test with
 *
 * @example
 * ```ts ignore
 * import { testPool } from "@stdx/database/sql/testing";
 * import { MyClient } from "./my_client.ts";
 *
 * Deno.test("MyClient pool", async (t) => {
 *   await testPool(t, () => new MyClient(url), sql);
 * });
 * ```
 */
export async function testPool(
  t: Deno.TestContext,
  create: Factory<Client>,
  sql: TestSql,
): Promise<void> {
  /** Acquire all connections but one, and return a release function */
  async function exhaust(
    client: Client,
    keep = 1,
  ): Promise<() => Promise<void>> {
    const maxSize = client.options.poolOptions?.maxSize ?? 1;
    const held: Connection[] = [];
    for (let i = 0; i < maxSize - keep; i++) held.push(await client.acquire());
    return async () => {
      for (const poolClient of held) await poolClient.release();
    };
  }

  await t.step("acquire waits when the pool is exhausted", async () => {
    const client = await create();
    await client.connect();
    const releaseAll = await exhaust(client);
    const last = await client.acquire();
    const pending = client.acquire();
    await assertWaitsFor(
      pending,
      () => last.release(),
      "acquire must wait for a release",
    );
    const next = await pending;
    assert(next.connected);
    await next.release();
    await releaseAll();
    await client.close();
  });

  await t.step("acquire waits for a removed connection", async () => {
    const client = await create();
    await client.connect();
    const releaseAll = await exhaust(client);
    const last = await client.acquire();
    const pending = client.acquire();
    await assertWaitsFor(
      pending,
      () => last.remove(),
      "acquire must wait for a removal",
    );
    const next = await pending;
    assert(next.connected);
    await next.release();
    await releaseAll();
    await client.close();
  });

  await t.step("query holds the connection until fetched", async () => {
    const client = await create();
    await client.connect();
    const releaseAll = await exhaust(client);
    const result = client.query(sql.query);
    // Running the query acquires the connection.
    await result.columns();
    const pending = client.acquire();
    await assertWaitsFor(
      pending,
      () => result[Symbol.asyncDispose](),
      "query must hold the connection",
    );
    await (await pending).release();
    await (await client.acquire()).release();
    await releaseAll();
    await client.close();
  });

  await t.step("prepare holds the connection until deallocated", async () => {
    const client = await create();
    await client.connect();
    const releaseAll = await exhaust(client);
    const stmt = await client.prepare(sql.query);
    const pending = client.acquire();
    await assertWaitsFor(
      pending,
      () => stmt.deallocate(),
      "prepare must hold the connection",
    );
    await (await pending).release();
    await releaseAll();
    await client.close();
  });

  await t.step(
    "beginTransaction holds the connection until finished",
    async () => {
      const client = await create();
      await client.connect();
      const releaseAll = await exhaust(client);
      const tx = await client.beginTransaction();
      const pending = client.acquire();
      await assertWaitsFor(
        pending,
        () => tx.commit(),
        "beginTransaction must hold the connection",
      );
      await (await pending).release();
      await releaseAll();
      await client.close();
    },
  );
}

/**
 * Test the {@linkcode Connection}s acquired from a {@linkcode Client}.
 *
 * @param t the test context
 * @param create a factory creating a fresh client
 * @param sql the SQL statements to test with
 *
 * @example
 * ```ts ignore
 * import { testConnection } from "@stdx/database/sql/testing";
 * import { MyClient } from "./my_client.ts";
 *
 * Deno.test("MyClient connection", async (t) => {
 *   await testConnection(t, () => new MyClient(url), sql);
 * });
 * ```
 */
export async function testConnection(
  t: Deno.TestContext,
  create: Factory<Client>,
  sql: TestSql,
): Promise<void> {
  await t.step("exposes the driver connection while acquired", async () => {
    const client = await create();
    const connection = await client.acquire();
    assertIsConnection(connection);
    assertIsDriverConnection(connection.driverConnection);
    await connection.release();
    assertThrows(() => connection.driverConnection, ConnectionError);
    await client.close();
  });

  await t.step("rejects operations while a result is read", async () => {
    const client = await create();
    const connection = await client.acquire();
    const result = connection.query(sql.query);
    await result.columns();
    await assertRejects(async () => {
      await connection.execute(sql.execute);
    }, QueryError);
    assertEquals((await result.toValues()).length, sql.count);
    // The connection is available again once the result is read.
    await connection.execute(sql.execute);
    await connection.release();
    await client.close();
  });

  await t.step("runs operations one at a time", async () => {
    const client = await create();
    const connection = await client.acquire();
    // Operations wait for each other; only a result being read rejects the
    // operations waiting for it.
    await Promise.all([
      connection.execute(sql.execute),
      connection.executeScript(sql.execute),
      connection.ping(),
      connection.execute(sql.execute),
    ]);
    assertEquals(
      await connection.query(sql.parameterQuery, ["a"]).toValues(),
      [["a"]],
    );
    await connection.release();
    await client.close();
  });
}

/**
 * Run the conformance suite of the client level against a {@linkcode Client}
 * implementation, such as the standard `SqlClient` over a driver.
 *
 * @param t the test context
 * @param createClient creates a fresh client with the given options, such as
 * `(options) => new SqlClient(driver, url, options)`
 * @param sql the SQL statements to test with
 *
 * @example
 * ```ts ignore
 * import { SqlClient } from "@stdx/database/sql";
 * import { testClient } from "@stdx/database/sql/testing";
 *
 * Deno.test("client conformance", async (t) => {
 *   await testClient(t, (options) => new SqlClient(driver, url, options), sql);
 * });
 * ```
 */
export async function testClient(
  t: Deno.TestContext,
  createClient: (options?: ClientOptions) => Client | Promise<Client>,
  sql: TestSql,
): Promise<void> {
  const create = () => createClient();
  // A pool of at least two connections, if the client supports it.
  const createPool = () => createClient({ poolOptions: { maxSize: 2 } });

  await t.step("is a client", async () => {
    const client = await create();
    assertIsClient(client);
    assertIsDialect(client.dialect);
    await client.close();
  });

  await t.step("connectable", (t) => testConnectable(t, create));
  await t.step("pingable", (t) => testPingable(t, create));
  await t.step("queryable", (t) => testQueryable(t, create, sql));
  await t.step("preparable", (t) => testPreparable(t, create, sql));
  await t.step("transactionable", (t) => testTransactionable(t, create, sql));
  await t.step("poolable", (t) => testPoolable(t, create));
  await t.step("eventable", (t) => testEventable(t, create));
  await t.step("connection", (t) => testConnection(t, create, sql));
  await t.step("pool", (t) => testPool(t, createPool, sql));

  await t.step("pool events", async (t) => {
    await t.step(
      "dispatches acquire and release events with the client",
      async () => {
        const client = await create();
        await client.connect();
        const eventTarget: EventTarget = client.eventTarget;
        let acquireClient: unknown;
        let releaseClient: unknown;
        eventTarget.addEventListener("acquire", (event) => {
          acquireClient = (event as CustomEvent<{ client?: unknown }>).detail
            ?.client;
        });
        eventTarget.addEventListener("release", (event) => {
          releaseClient = (event as CustomEvent<{ client?: unknown }>).detail
            ?.client;
        });
        const connection = await client.acquire();
        await connection.release();
        assertEquals(acquireClient, client);
        assertEquals(releaseClient, client);
        await client.close();
      },
    );
  });

  await t.step("connection initialization", async (t) => {
    await t.step("connects all connections up front", async () => {
      const client = await createClient({
        poolOptions: { maxSize: 2, lazyInitialization: false },
      });
      let connects = 0;
      client.eventTarget.addEventListener("connect", () => connects++);
      await client.connect();
      assertEquals(connects, client.options.poolOptions?.maxSize ?? 1);
      await client.close();
    });

    await t.step("lazily connects on acquire", async () => {
      const client = await createClient({
        poolOptions: { maxSize: 2, lazyInitialization: true },
      });
      let connects = 0;
      client.eventTarget.addEventListener("connect", () => connects++);
      await client.connect();
      assertEquals(connects, 0);
      const connection = await client.acquire();
      assertEquals(connects, 1);
      assert(connection.connected);
      await connection.release();
      await client.close();
    });
  });

  await t.step("query methods release the pooled connection", async (t) => {
    await t.step("query", async () => {
      const client = await create();
      await client.query(sql.query).toValues();
      // The connection is idle again, so it can be acquired manually.
      const connection = await client.acquire();
      assert(connection.connected);
      await connection.release();
      await client.close();
    });

    await t.step("execute", async () => {
      const client = await create();
      await client.execute(sql.execute);
      const connection = await client.acquire();
      assert(connection.connected);
      await connection.release();
      await client.close();
    });
  });
}

/**
 * Run the conformance suite of the driver level against a {@linkcode Driver}
 * implementation.
 *
 * @param t the test context
 * @param driver the driver
 * @param url the connection URL
 * @param sql the SQL statements to test with
 * @param options the connection options
 *
 * @example
 * ```ts ignore
 * import { testDriver } from "@stdx/database/sql/testing";
 *
 * Deno.test("driver conformance", async (t) => {
 *   await testDriver(t, new MyDriver(), url, sql);
 * });
 * ```
 */
export async function testDriver(
  t: Deno.TestContext,
  driver: Driver,
  url: string | URL,
  sql: TestSql,
  options?: ConnectionOptions,
): Promise<void> {
  const connect = () => driver.connect(url, options);

  await t.step("is a driver", () => {
    assertIsDriver(driver);
    assert(driver.dialect.name.length > 0, "The dialect must have a name");
    assertEquals(typeof driver.dialect.placeholder(0), "string");
    assert(
      driver.dialect.quoteIdentifier("users").includes("users"),
      "quoteIdentifier must contain the identifier",
    );
    if (driver.maxConnections !== undefined) {
      assert(driver.maxConnections >= 1, "maxConnections must be at least 1");
    }
  });

  await t.step("connects and closes", async () => {
    const connection = await connect();
    assertIsDriverConnection(connection);
    assertFalse(connection.closed);
    await connection.close();
    assert(connection.closed);
    await connection.close();

    const disposed = await connect();
    await disposed[Symbol.asyncDispose]();
    assert(disposed.closed);
  });

  await t.step("rejects operations after close", async () => {
    const connection = await connect();
    await connection.close();
    await assertRejects(() => connection.execute(sql.execute), ConnectionError);
    await assertRejects(() => connection.query(sql.query), ConnectionError);
    await assertRejects(
      () => connection.executeScript(sql.execute),
      ConnectionError,
    );
    await assertRejects(() => connection.begin(), ConnectionError);
    await assertRejects(() => connection.ping(), ConnectionError);
  });

  await t.step("pings", async () => {
    await using connection = await connect();
    await connection.ping();
  });

  await t.step("executes statements", async () => {
    await using connection = await connect();
    const result = await connection.execute(sql.execute);
    assert(
      result.affectedRows === undefined || result.affectedRows === 0,
      "execute must report 0 or undefined affected rows for statements that modify no rows",
    );
  });

  await t.step("queries rows", async () => {
    await using connection = await connect();
    await using rows = await connection.query(sql.query);
    assertEquals(rows.columns, sql.columns);
    let count = 0;
    for await (const values of rows) {
      assertEquals(values.length, sql.columns.length);
      count++;
    }
    assertEquals(count, sql.count);
  });

  await t.step("reports the columns of an empty result", async () => {
    await using connection = await connect();
    await using rows = await connection.query(sql.emptyQuery);
    assertEquals(rows.columns, sql.columns);
    assertEquals(await Array.fromAsync(rows), []);
  });

  await t.step("binds parameters", async () => {
    await using connection = await connect();
    await using rows = await connection.query(sql.parameterQuery, ["a"]);
    assertEquals(rows.columns, ["value"]);
    assertEquals(await Array.fromAsync(rows), [["a"]]);
  });

  await t.step("invalid statements reject with a QueryError", async () => {
    await using connection = await connect();
    await assertRejects(() => connection.execute(INVALID_SQL), QueryError);
    await assertRejects(() => connection.query(INVALID_SQL), QueryError);
    // The connection is still usable after an error.
    await connection.execute(sql.execute);
  });

  await t.step("frees the connection when rows are not read", async () => {
    await using connection = await connect();
    const rows = await connection.query(sql.query);
    for await (const _values of rows) break;
    await rows[Symbol.asyncDispose]();
    await connection.execute(sql.execute);

    const unread = await connection.query(sql.query);
    await unread[Symbol.asyncDispose]();
    await connection.execute(sql.execute);
  });

  await t.step("executes scripts", async () => {
    await using connection = await connect();
    await connection.executeScript(`${sql.execute};\n${sql.execute};`);
    await assertRejects(
      () => connection.executeScript(INVALID_SQL),
      QueryError,
    );
    await connection.execute(sql.execute);
  });

  await t.step("rejects with the reason of an aborted signal", async () => {
    await using connection = await connect();
    const reason = new Error("aborted");
    const signal = AbortSignal.abort(reason);
    assertEquals(
      await assertRejects(() =>
        connection.execute(sql.execute, [], { signal })
      ),
      reason,
    );
    assertEquals(
      await assertRejects(() => connection.query(sql.query, [], { signal })),
      reason,
    );
    assertEquals(
      await assertRejects(() =>
        connection.executeScript(sql.execute, { signal })
      ),
      reason,
    );
  });

  await t.step("transactions", async (t) => {
    await t.step("commit", async () => {
      await using connection = await connect();
      const tx = await connection.begin();
      await connection.execute(sql.execute);
      await tx.commit();
      await assertRejects(() => tx.commit(), TransactionError);
      await assertRejects(() => tx.rollback(), TransactionError);
    });

    await t.step("rollback", async () => {
      await using connection = await connect();
      const tx = await connection.begin();
      await tx.rollback();
      await assertRejects(() => tx.commit(), TransactionError);
    });

    await t.step("dispose rolls back", async () => {
      await using connection = await connect();
      {
        await using _tx = await connection.begin();
      }
      // A new transaction can begin.
      const tx = await connection.begin();
      await tx.commit();
    });

    await t.step("savepoints", async () => {
      await using connection = await connect();
      const tx = await connection.begin();
      const released = await tx.savepoint("sp_1");
      await connection.execute(sql.execute);
      await released.release();
      await assertRejects(() => released.release(), TransactionError);

      const rolledBack = await tx.savepoint("sp_2");
      await connection.execute(sql.execute);
      await rolledBack.rollback();
      await assertRejects(() => rolledBack.rollback(), TransactionError);

      {
        await using _savepoint = await tx.savepoint("sp_3");
      }
      await tx.commit();
      await assertRejects(() => tx.savepoint("sp_4"), TransactionError);
    });
  });

  await t.step("prepared statements", async () => {
    await using connection = await connect();
    if (connection.prepare === undefined) return;
    const stmt = await connection.prepare(sql.parameterQuery);
    assertEquals(stmt.sql, sql.parameterQuery);
    {
      await using rows = await stmt.query(["a"]);
      assertEquals(await Array.fromAsync(rows), [["a"]]);
    }
    {
      await using rows = await stmt.query(["b"]);
      assertEquals(await Array.fromAsync(rows), [["b"]]);
    }
    const result = await stmt.execute(["c"]);
    assertEquals(typeof result, "object");
    await stmt.deallocate();
    await stmt.deallocate();
    await assertRejects(() => stmt.query(["a"]), QueryError);
    await assertRejects(() => stmt.execute(["a"]), QueryError);

    const disposed = await connection.prepare(sql.query);
    await disposed[Symbol.asyncDispose]();
    await assertRejects(() => disposed.query(), QueryError);
  });
}
