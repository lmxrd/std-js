import { assertEquals, assertRejects } from "@std/assert";
import { QueryError } from "./errors.ts";
import {
  createResultIterableContext,
  getObjectFromRow,
  type ResultSource,
} from "./utils.ts";

Deno.test("getObjectFromRow", async (t) => {
  await t.step("empty row", () => {
    assertEquals(getObjectFromRow({ columns: [], values: [] }), {});
  });

  await t.step("filled row", () => {
    assertEquals(
      getObjectFromRow({ columns: ["a", "b"], values: ["c", 1] }),
      { a: "c", b: 1 },
    );
  });

  await t.step("more columns than values", () => {
    assertEquals(
      getObjectFromRow({ columns: ["a", "b"], values: ["c"] }),
      { a: "c", b: undefined },
    );
  });

  await t.step("more values than columns", () => {
    assertEquals(
      getObjectFromRow({ columns: ["a"], values: ["c", 1] }),
      { a: "c" },
    );
  });
});

function source(
  columns: string[],
  ...values: unknown[][]
): { start: () => Promise<ResultSource>; log: string[] } {
  const log: string[] = [];
  async function* rows(): AsyncGenerator<unknown[]> {
    try {
      for (const row of values) {
        log.push(`read ${row}`);
        yield row;
      }
    } finally {
      log.push("closed");
    }
  }
  return {
    start: () => {
      log.push("started");
      return Promise.resolve({ columns, rows: rows() });
    },
    log,
  };
}

Deno.test("createResultIterableContext", async (t) => {
  await t.step("is lazy", async () => {
    const { start, log } = source(["a"], [1]);
    const ctx = createResultIterableContext(start);
    assertEquals(log, []);
    assertEquals(await ctx.toValues(), [[1]]);
    assertEquals(log, ["started", "read 1", "closed"]);
  });

  await t.step("columns are known without rows", async () => {
    const { start } = source(["id", "name"]);
    const ctx = createResultIterableContext(start);
    assertEquals(await ctx.columns(), ["id", "name"]);
    assertEquals(await ctx.toValues(), []);
  });

  await t.step("columns do not consume the rows", async () => {
    const { start } = source(["id", "name"], [1, "Alice"], [2, "Bob"]);
    const ctx = createResultIterableContext(start);
    assertEquals(await ctx.columns(), ["id", "name"]);
    assertEquals(
      await ctx.toRecords(),
      [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
    );
  });

  await t.step("iterates rows as records", async () => {
    const { start } = source(["a"], ["b"]);
    const collected = [];
    for await (const row of createResultIterableContext(start)) {
      collected.push({ values: row.values, record: row.toRecord() });
    }
    assertEquals(collected, [{ values: ["b"], record: { a: "b" } }]);
  });

  await t.step("can be consumed once", async () => {
    const { start } = source(["a"], ["b"]);
    const ctx = createResultIterableContext(start);
    assertEquals(await ctx.toValues(), [["b"]]);
    await assertRejects(() => ctx.toValues(), QueryError, "consumed");
    await assertRejects(() => ctx.toRecords(), QueryError, "consumed");
    await assertRejects(async () => {
      for await (const _row of ctx) {
        // Not reached
      }
    }, QueryError);
    assertEquals(await ctx.columns(), ["a"]);
  });

  await t.step("firstValues and firstRecord read the first row", async () => {
    const { start, log } = source(["a"], [1], [2]);
    const ctx = createResultIterableContext(start);
    assertEquals(await ctx.firstValues(), [1]);
    assertEquals(log, ["started", "read 1", "closed"]);
    const { start: start2, log: log2 } = source(["a"], [1], [2]);
    const ctx2 = createResultIterableContext(start2);
    assertEquals(await ctx2.firstRecord(), { a: 1 });
    assertEquals(log2, ["started", "read 1", "closed"]);
  });

  await t.step(
    "firstValues and firstRecord are undefined without rows",
    async () => {
      const { start, log } = source(["a"]);
      const ctx = createResultIterableContext(start);
      assertEquals(await ctx.firstValues(), undefined);
      assertEquals(log, ["started", "closed"]);
      const { start: start2, log: log2 } = source(["a"]);
      const ctx2 = createResultIterableContext(start2);
      assertEquals(await ctx2.firstRecord(), undefined);
      assertEquals(log2, ["started", "closed"]);
    },
  );

  await t.step("firstValues and firstRecord consume the result", async () => {
    const { start } = source(["a"], [1]);
    const ctx = createResultIterableContext(start);
    assertEquals(await ctx.firstValues(), [1]);
    await assertRejects(() => ctx.firstValues(), QueryError, "consumed");
    await assertRejects(() => ctx.firstRecord(), QueryError, "consumed");
    await assertRejects(() => ctx.toValues(), QueryError, "consumed");
    // The columns are still available.
    assertEquals(await ctx.columns(), ["a"]);
    const { start: start2 } = source(["a"], [1]);
    const ctx2 = createResultIterableContext(start2);
    assertEquals(await ctx2.firstRecord(), { a: 1 });
    await assertRejects(() => ctx2.firstValues(), QueryError, "consumed");
  });

  await t.step("stops the source when the iteration ends early", async () => {
    const { start, log } = source(["a"], [1], [2], [3]);
    for await (const _row of createResultIterableContext(start)) break;
    assertEquals(log, ["started", "read 1", "closed"]);
  });

  await t.step("dispose stops the source", async () => {
    const { start, log } = source(["a"], [1], [2]);
    const ctx = createResultIterableContext(start);
    await ctx.columns();
    await ctx[Symbol.asyncDispose]();
    assertEquals(log, ["started", "read 1", "closed"]);
    await assertRejects(() => ctx.toValues(), QueryError, "disposed");
    await assertRejects(() => ctx.columns(), QueryError, "disposed");
    await ctx[Symbol.asyncDispose]();
  });

  await t.step("dispose before starting does not start", async () => {
    const { start, log } = source(["a"], [1]);
    const ctx = createResultIterableContext(start);
    await ctx[Symbol.asyncDispose]();
    assertEquals(log, []);
  });

  await t.step("start errors are thrown when consumed", async () => {
    const ctx = createResultIterableContext(() =>
      Promise.reject(new Error("invalid"))
    );
    await assertRejects(() => ctx.columns(), Error, "invalid");
    await assertRejects(() => ctx.toValues(), Error, "invalid");
    // Disposing a result that failed to start is a no-op.
    await ctx[Symbol.asyncDispose]();
  });
});
