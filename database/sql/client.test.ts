import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import {
  FAILING_URL,
  HANGING_URL,
  type MemoryConnection,
  MemoryDriver,
  type MemoryDriverOptions,
  memorySql,
} from "./_test_utils.ts";
import { SqlClient } from "./client.ts";
import type { ClientOptions } from "./core.ts";
import { ConnectionError, QueryError, TransactionError } from "./errors.ts";
import { sql } from "./template.ts";

function client(
  options?: ClientOptions,
  driverOptions?: MemoryDriverOptions,
  url = "memory://",
): { client: SqlClient<MemoryDriver>; driver: MemoryDriver } {
  const driver = new MemoryDriver(driverOptions);
  return { client: new SqlClient(driver, url, options), driver };
}

function log(driver: MemoryDriver, index = 0): string[] {
  return (driver.connections[index] as MemoryConnection).log;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.test("SqlClient connecting", async (t) => {
  await t.step("connects implicitly once", async () => {
    const { client: c } = client({ poolOptions: { maxSize: 2 } });
    let connects = 0;
    c.eventTarget.addEventListener("connect", () => connects++);
    await Promise.all([
      c.execute(memorySql.execute),
      c.query(memorySql.query).toValues(),
      c.ping(),
    ]);
    assertEquals(connects, 2);
    await c.close();
    // Closing is explicit: it is not undone implicitly.
    await assertRejects(
      () => c.execute(memorySql.execute),
      ConnectionError,
      "closed",
    );
    await c.connect();
    await c.execute(memorySql.execute);
    await c.close();
  });

  await t.step("times out connecting", async () => {
    const { client: c } = client(
      { connectionOptions: { connectTimeout: 20 } },
      undefined,
      HANGING_URL,
    );
    await assertRejects(() => c.connect(), ConnectionError, "20 ms");
    assertFalse(c.connected);
    const { client: invalid } = client({
      connectionOptions: { connectTimeout: -1 },
    });
    await assertRejects(() => invalid.connect(), RangeError);
  });

  await t.step("fails to connect and can be retried", async () => {
    const { client: c } = client(undefined, undefined, FAILING_URL);
    await assertRejects(() => c.connect(), ConnectionError, "refused");
    assertFalse(c.connected);
    await assertRejects(() => c.connect(), ConnectionError);
    assertFalse(c.connected);
  });

  await t.step("fails to acquire when a lazy connect fails", async () => {
    const { client: c } = client(
      { poolOptions: { lazyInitialization: true } },
      undefined,
      FAILING_URL,
    );
    await c.connect();
    await assertRejects(() => c.acquire(), ConnectionError);
    await c.close();
  });

  await t.step("caps the pool at the driver's connections", () => {
    const { client: c } = client({ poolOptions: { maxSize: 4 } }, {
      maxConnections: 1,
    });
    assertEquals(c.options.poolOptions?.maxSize, 1);
    assertEquals(client().client.options.poolOptions?.maxSize, 1);
  });
});

Deno.test("SqlClient queries", async (t) => {
  await t.step("merges the client query options", async () => {
    await using c = client({
      queryOptions: { transformOutput: (value) => `${value}!` },
    }).client;
    const result = c.query(memorySql.parameterQuery, ["a"], {
      transformInput: (value) => `${value}b`,
    });
    assertEquals(await result.toValues(), [["ab!"]]);
  });

  await t.step("renders templates with the driver's dialect", async () => {
    const { client: c, driver } = client({
      queryOptions: { statementCacheSize: 0 },
    });
    await using _ = c;
    assertEquals(c.dialect, driver.dialect);
    assertEquals(
      await c.query(sql`SELECT ${"a"} AS value`).toValues(),
      [["a"]],
    );
    assertEquals(log(driver).at(-1), "query SELECT ? AS value");
  });

  await t.step("types the records at the call site", async () => {
    interface User {
      id: number;
      name: string;
    }
    await using c = client().client;
    const rows = await c.query<User>(memorySql.query).toRecords();
    assertEquals(rows.length, memorySql.count);
    assertEquals(rows.map((row) => row.name.toUpperCase()), [
      "ALICE",
      "BOB",
      "CHARLIE",
    ]);
    assertEquals(await c.query<User>(memorySql.query).firstRecord(), {
      id: 1,
      name: "Alice",
    });
    assertEquals(
      await c.query<User>(memorySql.query).firstValues(),
      [1, "Alice"],
    );
    assertEquals(
      await c.query<User>(memorySql.emptyQuery).firstRecord(),
      undefined,
    );
  });

  await t.step("caches prepared statements", async () => {
    const { client: c, driver } = client();
    await using _ = c;
    for (let i = 0; i < 3; i++) {
      await c.query(memorySql.parameterQuery, [`${i}`]).toValues();
      await c.execute(memorySql.execute);
    }
    const entries = log(driver);
    assertEquals(
      entries.filter((entry) => entry.startsWith("prepare")),
      [
        `prepare ${memorySql.parameterQuery}`,
        `prepare ${memorySql.execute}`,
      ],
    );
  });

  await t.step("evicts the least recently used statement", async () => {
    const { client: c, driver } = client({
      queryOptions: { statementCacheSize: 1 },
    });
    await using _ = c;
    await c.execute(memorySql.execute);
    await c.query(memorySql.query).toValues();
    assert(log(driver).includes(`deallocate ${memorySql.execute}`));
  });

  await t.step("does not cache when disabled", async () => {
    const { client: c, driver } = client({
      queryOptions: { statementCacheSize: 0 },
    });
    await using _ = c;
    await c.execute(memorySql.execute);
    assertFalse(log(driver).some((entry) => entry.startsWith("prepare")));
  });

  await t.step("wraps and dispatches errors once", async () => {
    await using c = client().client;
    const errors: unknown[] = [];
    c.eventTarget.addEventListener(
      "error",
      (event) =>
        errors.push((event as CustomEvent<{ error: unknown }>).detail.error),
    );
    const error = await assertRejects(
      () => c.query("SELEC").toValues(),
      QueryError,
    );
    await assertRejects(() => c.execute("SELEC"), QueryError);
    assertEquals(errors.length, 2);
    assertEquals(errors[0], error);
    // The connection is released after errors.
    await c.ping();
  });
});

Deno.test("SqlClient transactions", async (t) => {
  await t.step("nests with the driver's savepoints", async () => {
    const { client: c, driver } = client();
    await using _ = c;
    await using connection = await c.acquire();
    const tx = await connection.beginTransaction();
    const nested = await connection.beginTransaction();
    await nested.rollback();
    const kept = await tx.beginTransaction();
    await kept.commit();
    await tx.commit();
    assertEquals(log(driver).slice(-6), [
      "begin",
      "savepoint sp_1",
      "rollback to sp_1",
      "savepoint sp_2",
      "release sp_2",
      "commit",
    ]);
  });

  await t.step("validates savepoint names", async () => {
    const { client: c, driver } = client();
    await using _ = c;
    await using tx = await c.beginTransaction();
    await tx.createSavepoint("a");
    await tx.createSavepoint();
    await tx.createSavepoint("b");
    // Releasing a savepoint also releases the ones created after it.
    await tx.releaseSavepoint("a");
    assertEquals(log(driver).at(-1), "release a");
    await assertRejects(() => tx.releaseSavepoint(), TransactionError);
    await assertRejects(() => tx.releaseSavepoint("b"), TransactionError);
    await assertRejects(() => tx.createSavepoint("a b"), TransactionError);
    await assertRejects(
      () => tx.releaseSavepoint("a; DROP TABLE users"),
      TransactionError,
    );
  });

  await t.step("rolls back a transaction left open on release", async () => {
    const { client: c, driver } = client();
    await using _ = c;
    {
      await using connection = await c.acquire();
      await connection.beginTransaction();
    }
    assertEquals(log(driver).slice(-2), ["begin", "rollback"]);
  });

  await t.step("ends a transaction when the connection is lost", async () => {
    const { client: c, driver } = client();
    await using _ = c;
    const tx = await c.beginTransaction();
    (driver.connections[0] as MemoryConnection).loseConnection();
    await assertRejects(
      () => tx.execute(memorySql.execute),
      ConnectionError,
      "transaction was rolled back",
    );
    assertFalse(tx.inTransaction);
    // The pool replaces the lost connection.
    await c.execute(memorySql.execute);
    assertEquals(driver.connections.length, 2);
  });

  await t.step("the wrapper releases the connection", async () => {
    await using c = client().client;
    const result = await c.transaction((tx) =>
      tx.query(memorySql.query).toValues()
    );
    assertEquals(result.length, memorySql.count);
    await (await c.acquire()).release();
  });
});

Deno.test("SqlClient pool", async (t) => {
  await t.step("connections reject after release", async () => {
    await using c = client().client;
    const connection = await c.acquire();
    await connection.release();
    await assertRejects(() => connection.ping(), ConnectionError);
    await assertRejects(
      () => connection.execute(memorySql.execute),
      ConnectionError,
    );
    await assertRejects(
      () => connection.query(memorySql.query).toValues(),
      ConnectionError,
    );
    await assertRejects(() => connection.prepare("SELECT"), ConnectionError);
    await assertRejects(() => connection.beginTransaction(), ConnectionError);
  });

  await t.step("rejects pending acquires when closing", async () => {
    const { client: c } = client();
    const connection = await c.acquire();
    const pending = c.acquire();
    await c.close();
    await assertRejects(() => pending, ConnectionError, "closed");
    // Connections in use are closed too.
    assertFalse(connection.connected);
    await connection.release();
  });

  await t.step("replaces connections lost while idle", async () => {
    const { client: c, driver } = client();
    await using _ = c;
    await c.execute(memorySql.execute);
    (driver.connections[0] as MemoryConnection).loseConnection();
    await c.execute(memorySql.execute);
    assertEquals(driver.connections.length, 2);
  });

  await t.step("does not reuse a connection released while read", async () => {
    const { client: c, driver } = client();
    await using _ = c;
    const connection = await c.acquire();
    await connection.query(memorySql.query).columns();
    await connection.release();
    await c.execute(memorySql.execute);
    assertEquals(driver.connections.length, 2);
  });

  await t.step("acquireTimeout rejects a waiting acquire", async () => {
    await using c = client({ poolOptions: { acquireTimeout: 20 } }).client;
    const connection = await c.acquire();
    await assertRejects(() => c.acquire(), ConnectionError, "20 ms");
    await connection.release();
    // A leaked query result makes acquire fail instead of hang.
    await c.query(memorySql.query).columns();
    await assertRejects(() => c.execute(memorySql.execute), ConnectionError);
  });

  await t.step("idleTimeout closes idle connections", async () => {
    await using c = client({
      poolOptions: { maxSize: 2, idleTimeout: 10 },
    }).client;
    let closes = 0;
    c.eventTarget.addEventListener("close", () => closes++);
    await c.connect();
    const inUse = await c.acquire();
    await wait(50);
    assertEquals(closes, 1);
    assert(inUse.connected);
    await inUse.release();
    await wait(50);
    assertEquals(closes, 2);
    const next = await c.acquire();
    assert(next.connected);
    await next.release();
  });

  await t.step("maxLifetime replaces old connections", async () => {
    const { client: c, driver } = client({ poolOptions: { maxLifetime: 10 } });
    await using _ = c;
    await c.execute(memorySql.execute);
    await wait(30);
    await c.execute(memorySql.execute);
    assertEquals(driver.connections.length, 2);
    assert(driver.connections[0].closed);
  });

  await t.step("rejects invalid options", async () => {
    for (
      const poolOptions of [
        { acquireTimeout: -1 },
        { idleTimeout: Number.NaN },
        { maxLifetime: -5 },
      ]
    ) {
      const { client: c } = client({ poolOptions });
      await assertRejects(() => c.connect(), RangeError);
      assertFalse(c.connected);
    }
  });
});
