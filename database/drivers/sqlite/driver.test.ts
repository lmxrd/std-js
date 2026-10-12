import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import {
  ConnectionError,
  QueryError,
  sql as tag,
  TransactionError,
} from "../../sql/mod.ts";
import { testClient, testDriver, type TestSql } from "../../sql/testing.ts";
import { SqliteClient, SqliteDriver } from "./mod.ts";

const sql: TestSql = {
  execute: "CREATE TABLE IF NOT EXISTS users (id INTEGER, name TEXT)",
  query:
    "SELECT 1 AS id, 'Alice' AS name UNION ALL SELECT 2, 'Bob' UNION ALL SELECT 3, 'Charlie'",
  columns: ["id", "name"],
  count: 3,
  parameterQuery: "SELECT ? AS value",
  emptyQuery: "SELECT 1 AS id, 'Alice' AS name WHERE 0",
  parameterTemplate: (value) => tag`SELECT ${value} AS value`,
};

Deno.test("SqliteDriver conformance", async (t) => {
  await testDriver(t, new SqliteDriver(), ":memory:", sql);
});

Deno.test("SqliteClient conformance", async (t) => {
  await testClient(t, (options) => new SqliteClient(":memory:", options), sql);
});

Deno.test("SqliteDriver", async (t) => {
  await t.step("has the SQLite dialect", () => {
    const { dialect, maxConnections } = new SqliteDriver();
    assertEquals(dialect.name, "sqlite");
    assertEquals(dialect.placeholder(3), "?");
    assertEquals(dialect.quoteIdentifier('a"b'), '"a""b"');
    assertEquals(maxConnections, 1);
  });

  await t.step("rejects multiple statements", async () => {
    await using connection = await new SqliteDriver().connect(":memory:");
    const statements = "CREATE TABLE a (x); CREATE TABLE b (x)";
    await assertRejects(
      () => connection.execute(statements),
      QueryError,
      "multiple",
    );
    await assertRejects(
      () => connection.query(statements),
      QueryError,
      "multiple",
    );
    await assertRejects(
      () => connection.prepare(statements),
      QueryError,
      "multiple",
    );
    // Trailing whitespace and comments are not statements
    await connection.execute("CREATE TABLE c (x); -- comment\n /* block */ \n");
    await connection.execute("CREATE TABLE d (x); /* unterminated");
  });

  await t.step("reports affected rows and inserted ids", async () => {
    await using connection = await new SqliteDriver().connect(":memory:");
    assertEquals(
      await connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, a)"),
      { affectedRows: 0 },
    );
    await connection.execute("CREATE TABLE log (a)");
    await connection.execute(
      "CREATE TRIGGER logged AFTER INSERT ON t BEGIN INSERT INTO log VALUES (new.a); END",
    );
    assertEquals(await connection.execute("INSERT INTO t (a) VALUES (1)"), {
      affectedRows: 1,
      lastInsertId: 1,
    });
    assertEquals(await connection.execute("INSERT INTO t VALUES (10, 2)"), {
      affectedRows: 1,
      lastInsertId: 10,
    });
    // Statements that modify no rows do not report the previous values
    assertEquals(await connection.execute("SELECT a FROM t"), {
      affectedRows: 0,
    });
    assertEquals(
      await connection.execute("UPDATE t SET a = 3 WHERE a > 5"),
      { affectedRows: 0 },
    );
  });

  await t.step("prepared statements run while being iterated", async () => {
    await using connection = await new SqliteDriver().connect(":memory:");
    await connection.execute("CREATE TABLE t (a)");
    await connection.execute("INSERT INTO t VALUES (1), (2), (3)");
    const stmt = await connection.prepare("SELECT a FROM t WHERE a >= ?");
    await using first = await stmt.query([1]);
    await using second = await stmt.query([2]);
    assertEquals(await Array.fromAsync(first), [[1], [2], [3]]);
    assertEquals(await Array.fromAsync(second), [[2], [3]]);

    const insert = await connection.prepare("INSERT INTO t VALUES (?)");
    const select = await connection.prepare("SELECT a FROM t");
    await using rows = await select.query();
    assertEquals((await insert.execute([4])).affectedRows, 1);
    assertEquals((await Array.fromAsync(rows)).length, 4);
  });

  await t.step("transactions and savepoints", async () => {
    await using connection = await new SqliteDriver().connect(":memory:");
    await connection.execute("CREATE TABLE t (a)");
    const tx = await connection.begin({ behavior: "immediate" });
    await connection.execute("INSERT INTO t VALUES (1)");
    const savepoint = await tx.savepoint("sp_1");
    await connection.execute("INSERT INTO t VALUES (2)");
    await savepoint.rollback();
    await tx.commit();
    {
      await using rows = await connection.query("SELECT a FROM t");
      assertEquals(await Array.fromAsync(rows), [[1]]);
    }
    await assertRejects(
      // deno-lint-ignore no-explicit-any
      () => connection.begin({ behavior: "bogus" as any }),
      TransactionError,
    );
    const other = await connection.begin();
    await assertRejects(() => other.savepoint("a b"), TransactionError);
    await other.rollback();
  });

  await t.step("opens files and read-only databases", async () => {
    const dir = await Deno.makeTempDir();
    try {
      const url = new URL(`file://${dir}/test.db`);
      {
        await using connection = await new SqliteDriver().connect(url);
        assert(connection.database.isOpen);
        await connection.execute("CREATE TABLE t (a)");
      }
      await using connection = await new SqliteDriver().connect(url, {
        readOnly: true,
        timeout: 10,
        enableForeignKeyConstraints: false,
      });
      await assertRejects(
        () => connection.execute("INSERT INTO t VALUES (1)"),
        QueryError,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("waits for locks held by other connections", async () => {
    const dir = await Deno.makeTempDir();
    try {
      const path = `${dir}/test.db`;
      const driver = new SqliteDriver();
      await using writer = await driver.connect(path);
      await writer.execute("CREATE TABLE t (a)");
      const tx = await writer.begin({ behavior: "immediate" });
      await using other = await driver.connect(path, { timeout: 20 });
      await assertRejects(
        () => other.execute("INSERT INTO t VALUES (1)"),
        QueryError,
        "locked",
      );
      await tx.commit();
      assertEquals(
        (await other.execute("INSERT INTO t VALUES (1)")).affectedRows,
        1,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("rejects connecting to an invalid path", async () => {
    await assertRejects(
      () => new SqliteDriver().connect("/nonexistent/dir/test.db"),
      ConnectionError,
    );
  });
});

Deno.test("SqliteClient", async (t) => {
  await t.step("binds parameters and maps values", async () => {
    await using client = new SqliteClient(":memory:");
    await client.execute(
      "CREATE TABLE t (i INTEGER, r REAL, s TEXT, b BLOB, n, bool, d, j)",
    );
    const date = new Date("2024-01-02T03:04:05.000Z");
    assertEquals(
      await client.execute(
        "INSERT INTO t VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        // Dates are not a standard parameter type, but are bound as ISO strings.
        [
          1,
          1.5,
          "s",
          new Uint8Array([1, 2]),
          undefined,
          true,
          date,
          null,
        ],
      ),
      { affectedRows: 1, lastInsertId: 1 },
    );
    await client.execute(
      "INSERT INTO t (i, s) VALUES (:i, :s)",
      { i: 2, s: "named" },
    );
    const result = client.query("SELECT * FROM t ORDER BY i");
    assertEquals(await result.columns(), [
      "i",
      "r",
      "s",
      "b",
      "n",
      "bool",
      "d",
      "j",
    ]);
    assertEquals(await result.toValues(), [
      [1, 1.5, "s", new Uint8Array([1, 2]), null, 1, date.toISOString(), null],
      [2, null, "named", null, null, null, null, null],
    ]);
  });

  await t.step("binds binary data from any buffer", async () => {
    await using client = new SqliteClient(":memory:");
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = client.query("SELECT ?, ?, ?, ?", [
      bytes,
      bytes.buffer,
      new DataView(bytes.buffer, 1, 2),
      new Uint16Array([0x0201]),
    ]);
    assertEquals(await result.toValues(), [[
      bytes,
      bytes,
      new Uint8Array([2, 3]),
      new Uint8Array([1, 2]),
    ]]);
  });

  await t.step("encodes other values as JSON", async () => {
    await using client = new SqliteClient(":memory:");
    const result = client.query("SELECT ? AS a", ["x"], {
      transformInput: () => ({ a: 1 }),
    });
    assertEquals(await result.toValues(), [['{"a":1}']]);
  });

  await t.step("reads big integers", async () => {
    await using client = new SqliteClient(":memory:", {
      connectionOptions: { readBigInts: true },
    });
    assertEquals(
      await client.query("SELECT ? AS a", [2n ** 62n]).toValues(),
      [[2n ** 62n]],
    );
  });

  await t.step("streams rows lazily", async () => {
    await using client = new SqliteClient(":memory:");
    let count = 0;
    for await (
      const _row of client.query(
        "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c LIMIT 1000) SELECT x FROM c",
      )
    ) {
      if (++count === 10) break;
    }
    assertEquals(count, 10);
    await client.ping();
  });

  await t.step("runs SQL templates and scripts", async () => {
    await using client = new SqliteClient(":memory:");
    await client.executeScript(`
      CREATE TABLE t (a, b);
      -- Comments are allowed
      INSERT INTO t VALUES (1, 'x');
    `);
    const b = "y";
    assertEquals(
      (await client.execute(tag`INSERT INTO t VALUES (${2}, ${b})`))
        .affectedRows,
      1,
    );
    assertEquals(
      await client.query(tag`SELECT a FROM t WHERE b = ${b}`).toValues(),
      [[2]],
    );
  });

  await t.step(
    "transactions persist commits and discard rollbacks",
    async () => {
      await using client = new SqliteClient(":memory:");
      await client.execute("CREATE TABLE t (a INTEGER)");
      await client.transaction(async (tx) => {
        await tx.execute("INSERT INTO t VALUES (1)");
        await assertRejects(() =>
          tx.transaction(async (nested) => {
            await nested.execute("INSERT INTO t VALUES (2)");
            throw new Error("rollback nested");
          })
        );
        await tx.transaction(async (kept) => {
          await kept.execute("INSERT INTO t VALUES (3)");
        });
      }, { behavior: "immediate" });
      await assertRejects(
        () =>
          client.transaction(async (tx) => {
            await tx.execute("INSERT INTO t VALUES (4)");
            throw new Error("rollback");
          }),
        Error,
        "rollback",
      );
      assertEquals(
        await client.query("SELECT a FROM t ORDER BY a").toValues(),
        [[1], [3]],
      );
    },
  );

  await t.step("emulates the pool with a single connection", async () => {
    await using client = new SqliteClient(":memory:", {
      poolOptions: { maxSize: 4, acquireTimeout: 10 },
    });
    assertEquals(client.options.poolOptions?.maxSize, 1);
    {
      await using connection = await client.acquire();
      await connection.execute("CREATE TABLE t (a)");
      await assertRejects(() => client.acquire(), ConnectionError);
    }
    // The in-memory database is shared by all acquires.
    assertEquals(await client.query("SELECT * FROM t").columns(), ["a"]);
  });

  await t.step("fails to connect with an invalid path", async () => {
    const client = new SqliteClient("/nonexistent/dir/test.db");
    await assertRejects(() => client.connect(), ConnectionError);
    assertFalse(client.connected);
  });
});
