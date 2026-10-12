import { type ClientOptions, SqlClient } from "../../sql/mod.ts";
import {
  type SqliteConnectionOptions,
  SqliteDriver,
  type SqliteQueryParameters,
  type SqliteTransactionOptions,
} from "./driver.ts";

/**
 * SqliteClientOptions
 *
 * The options that a {@linkcode SqliteClient} is constructed with. The
 * `connectionOptions` and `transactionOptions` are the SQLite specific ones.
 *
 * @example
 * ```ts
 * import type { SqliteClientOptions } from "@stdx/database/drivers/sqlite";
 * import { SqliteClient } from "@stdx/database/drivers/sqlite";
 *
 * const options: SqliteClientOptions = {
 *   connectionOptions: { readOnly: true },
 *   transactionOptions: { behavior: "deferred" },
 *   poolOptions: { maxSize: 1 },
 * };
 * await using client = new SqliteClient(":memory:", options);
 * console.log(client.options.poolOptions?.maxSize); // 1
 * ```
 */
export interface SqliteClientOptions
  extends ClientOptions<SqliteConnectionOptions, SqliteTransactionOptions> {}

/**
 * SqliteClient
 *
 * The standard client with the {@linkcode SqliteDriver}, backed by the
 * built-in `node:sqlite` module. See {@linkcode SqliteDriver} for the
 * connection URL and placeholder formats.
 *
 * SQLite has no connection pool, so the pool is emulated with a single
 * connection: `maxSize` is always `1`, and acquiring waits until the
 * connection is released. This keeps transactions isolated, and makes
 * `:memory:` databases behave like a single database.
 *
 * The parameters of its query methods are typed as
 * {@linkcode SqliteQueryParameters}: the standard parameter types, extended
 * with `Date`s, which are bound as ISO 8601 strings.
 *
 * @example
 * ```ts
 * import { SqliteClient } from "@stdx/database/drivers/sqlite";
 *
 * await using client = new SqliteClient(":memory:");
 * await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");
 * await client.transaction(async (tx) => {
 *   await tx.execute("INSERT INTO users VALUES (?, ?)", [1, "Alice"]);
 * });
 * console.log(await client.query("SELECT * FROM users").toRecords());
 * ```
 */
export class SqliteClient
  extends SqlClient<SqliteDriver, SqliteClientOptions, SqliteQueryParameters> {
  /**
   * Create a SQLite client.
   *
   * @param connectionUrl a file path, a `file:` URL, or `:memory:`
   * @param options the client options
   */
  constructor(connectionUrl: string | URL, options?: SqliteClientOptions) {
    super(new SqliteDriver(), connectionUrl, options);
  }
}
