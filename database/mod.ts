/**
 * The standard interface for SQL databases, with SQLite drivers.
 *
 * The root module re-exports the SQL entrypoint: the standard interface and
 * its implementation, the {@linkcode SqlClient}, the errors, the types and
 * the tagged template query builder. The drivers are exported as namespaces,
 * such as `sqlite`, and the conformance test suite as `testing`.
 *
 * @example
 * ```ts
 * import { sqlite } from "@stdx/database";
 *
 * await using client = new sqlite.SqliteClient(":memory:");
 * await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");
 * await client.execute("INSERT INTO users VALUES (1, 'Alice')");
 * console.log(await client.query("SELECT * FROM users").toRecords());
 * // [{ id: 1, name: "Alice" }]
 * ```
 *
 * @example
 * ```ts
 * import { sqlite } from "@stdx/database";
 *
 * interface User {
 *   id: number;
 *   name: string;
 * }
 *
 * await using client = new sqlite.SqliteClient(":memory:");
 * await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");
 * await client.execute("INSERT INTO users VALUES (1, 'Alice')");
 * // The record type of the result is given at the call site.
 * const user = await client.query<User>("SELECT * FROM users").firstRecord();
 * console.log(user?.name.toUpperCase()); // "ALICE"
 * ```
 *
 * @module
 */
export * from "./sql/mod.ts";
export * as sqlite from "./drivers/sqlite/mod.ts";
export * as testing from "./sql/testing.ts";
