import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import {
  ConnectionError,
  type ConnectionOptions,
  DatabaseError,
  type Dialect,
  type Driver,
  type DriverConnection,
  type DriverQueryOptions,
  type DriverRows,
  type DriverSavepoint,
  type DriverStatement,
  type DriverTransaction,
  type ExecuteResult,
  type ParameterType,
  QueryError,
  type QueryParameters,
  TransactionError,
  type TransactionOptions,
} from "../../sql/mod.ts";

/**
 * SqliteParameterType
 *
 * The parameter values that the SQLite driver binds: the standard
 * {@linkcode ParameterType}, extended with `Date`s, which are bound as ISO 8601
 * strings. Booleans are bound as `1`/`0`, and binary data from any
 * `ArrayBufferView` or `ArrayBuffer`. Any other value, such as a plain
 * object, is bound as its JSON serialization; bind it with a cast, or
 * serialize it yourself.
 *
 * @example
 * ```ts
 * import type { SqliteParameterType } from "@stdx/database/drivers/sqlite";
 *
 * const values: SqliteParameterType[] = [
 *   "Alice",
 *   1,
 *   true,
 *   new Date("2024-01-02T03:04:05.000Z"),
 *   new Uint8Array([1, 2]),
 * ];
 * console.log(values.length); // 5
 * ```
 */
export type SqliteParameterType = ParameterType | Date;

/**
 * SqliteQueryParameters
 *
 * The parameters to bind to a SQLite statement, either as an ordered array
 * with `?` placeholders, or as a record with `:name`, `@name` and `$name`
 * placeholders. The values are {@linkcode SqliteParameterType}s.
 *
 * @example
 * ```ts
 * import type { SqliteQueryParameters } from "@stdx/database/drivers/sqlite";
 * import { SqliteClient } from "@stdx/database/drivers/sqlite";
 *
 * await using client = new SqliteClient(":memory:");
 * await client.execute("CREATE TABLE users (id INTEGER, at TEXT)");
 * // Positional parameters, with a Date, bound as an ISO 8601 string.
 * const positional: SqliteQueryParameters = [1, new Date()];
 * await client.execute("INSERT INTO users VALUES (?, ?)", positional);
 * // Named parameters.
 * const named: SqliteQueryParameters = { id: 2, at: new Date() };
 * await client.execute("INSERT INTO users VALUES (:id, :at)", named);
 * ```
 */
export type SqliteQueryParameters =
  | SqliteParameterType[]
  | Record<string, SqliteParameterType>;

/**
 * SqliteConnectionOptions
 *
 * Options used when opening the database.
 *
 * @example
 * ```ts
 * import { SqliteDriver } from "@stdx/database/drivers/sqlite";
 *
 * const driver = new SqliteDriver();
 * await using connection = await driver.connect(":memory:", {
 *   // Opened read-only, with foreign keys enforced.
 *   readOnly: true,
 *   enableForeignKeyConstraints: true,
 * });
 * ```
 */
export interface SqliteConnectionOptions extends ConnectionOptions {
  /**
   * Open the database in read-only mode. Defaults to `false`.
   */
  readOnly?: boolean;
  /**
   * Enforce foreign key constraints. Defaults to `true`.
   */
  enableForeignKeyConstraints?: boolean;
  /**
   * The busy timeout in milliseconds, used when the database is locked by
   * another connection. Defaults to `5000`.
   */
  timeout?: number;
  /**
   * Return integers as `bigint` instead of `number`. Defaults to `false`, in
   * which case reading an integer outside of the safe integer range throws.
   */
  readBigInts?: boolean;
}

/**
 * SqliteTransactionOptions
 *
 * The options of a transaction of the SQLite driver.
 *
 * @example
 * ```ts
 * import { SqliteClient } from "@stdx/database/drivers/sqlite";
 *
 * await using client = new SqliteClient(":memory:");
 * // An immediate transaction takes its write lock right away.
 * await using tx = await client.beginTransaction({ behavior: "immediate" });
 * ```
 */
export interface SqliteTransactionOptions extends TransactionOptions {
  /**
   * The locking behavior of the transaction. Defaults to `"deferred"`.
   *
   * @see https://www.sqlite.org/lang_transaction.html
   */
  behavior?: "deferred" | "immediate" | "exclusive";
}

const BEHAVIORS = new Set(["deferred", "immediate", "exclusive"]);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Whitespace and comments, which may follow the statement
const TRAILING = /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?(?:\*\/|$))*$/;

type SqliteValue = null | number | bigint | string | Uint8Array;

function toSqliteValue(value: unknown): SqliteValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  // Binary data is stored as a BLOB of its bytes, without copying.
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (
    typeof value === "number" || typeof value === "bigint" ||
    typeof value === "string"
  ) {
    return value;
  }
  return JSON.stringify(value);
}

// `node:sqlite` takes named parameters as the first argument, which the typings
// only express through overloads.
function toSqliteArgs(params: QueryParameters | undefined): SQLInputValue[] {
  if (params === undefined) return [];
  if (Array.isArray(params)) return params.map(toSqliteValue);
  return [
    Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, toSqliteValue(value)]),
    ),
  ] as unknown as SQLInputValue[];
}

/** Report errors of `node:sqlite` as spec errors */
function wrapError(
  error: unknown,
  ErrorClass: new (message: string) => DatabaseError = QueryError,
): DatabaseError {
  if (error instanceof DatabaseError) return error;
  const wrapped = new ErrorClass(
    error instanceof Error ? error.message : String(error),
  );
  wrapped.cause = error;
  return wrapped;
}

/**
 * The SQL dialect of SQLite: `?` placeholders and double quoted identifiers.
 *
 * @example
 * ```ts
 * import { sqliteDialect } from "@stdx/database/drivers/sqlite";
 *
 * console.log(sqliteDialect.name); // "sqlite"
 * console.log(sqliteDialect.placeholder(0)); // "?"
 * console.log(sqliteDialect.quoteIdentifier("users")); // "\"users\""
 * ```
 */
export const sqliteDialect: Dialect = {
  name: "sqlite",
  placeholder: () => "?",
  quoteIdentifier: (name) => `"${name.replaceAll('"', '""')}"`,
};

/**
 * SqliteDriver
 *
 * The SQLite driver, backed by the built-in `node:sqlite` module.
 *
 * The connection URL is a file path, a `file:` URL, or `:memory:` for an
 * in-memory database. Positional parameters use `?` placeholders, and named
 * parameters use `:name`, `@name` or `$name` placeholders. SQLite has no
 * connection pool, so the driver supports one connection at a time.
 *
 * Applications should in most cases use a {@linkcode SqliteClient}.
 *
 * @example
 * ```ts
 * import { SqliteDriver } from "@stdx/database/drivers/sqlite";
 *
 * const driver = new SqliteDriver();
 * await using connection = await driver.connect(":memory:");
 * await connection.execute("CREATE TABLE users (id INTEGER, name TEXT)");
 * await connection.execute("INSERT INTO users VALUES (?, ?)", [1, "Alice"]);
 * await using rows = await connection.query("SELECT * FROM users");
 * for await (const values of rows) console.log(values);
 * ```
 */
export class SqliteDriver
  implements Driver<SqliteConnectionOptions, SqliteTransactionOptions> {
  readonly dialect: Dialect = sqliteDialect;
  readonly maxConnections = 1;

  connect(
    url: string | URL,
    options?: SqliteConnectionOptions & { signal?: AbortSignal },
  ): Promise<SqliteConnection> {
    try {
      options?.signal?.throwIfAborted();
      const {
        readOnly,
        enableForeignKeyConstraints,
        timeout = 5000,
      } = options ?? {};
      const db = new DatabaseSync(url instanceof URL ? url : url.toString(), {
        ...(readOnly !== undefined && { readOnly }),
        ...(enableForeignKeyConstraints !== undefined &&
          { enableForeignKeyConstraints }),
        timeout,
      });
      return Promise.resolve(
        new SqliteConnection(db, options?.readBigInts ?? false),
      );
    } catch (error) {
      if (options?.signal?.aborted) return Promise.reject(error);
      return Promise.reject(wrapError(error, ConnectionError));
    }
  }
}

/**
 * SqliteConnection
 *
 * A connection of the {@linkcode SqliteDriver}. It also exposes the
 * underlying `node:sqlite` database as {@linkcode SqliteConnection.database},
 * for SQLite features outside of the standard interface.
 *
 * @example
 * ```ts
 * import { SqliteDriver } from "@stdx/database/drivers/sqlite";
 *
 * const driver = new SqliteDriver();
 * await using connection = await driver.connect(":memory:");
 * await connection.execute("CREATE TABLE users (id INTEGER, name TEXT)");
 * const result = await connection.execute(
 *   "INSERT INTO users VALUES (?, ?)",
 *   [1, "Alice"],
 * );
 * console.log(result.lastInsertId); // 1
 * ```
 */
export class SqliteConnection
  implements DriverConnection<SqliteTransactionOptions> {
  readonly #db: DatabaseSync;
  readonly #readBigInts: boolean;
  #totalChanges?: StatementSync;
  // Running a statement resets its running iteration, so while a prepared
  // statement is iterated, it is prepared again for other runs.
  readonly #iterating = new WeakSet<StatementSync>();

  /**
   * Connections are opened with {@linkcode SqliteDriver.connect}.
   *
   * @ignore
   */
  constructor(db: DatabaseSync, readBigInts: boolean) {
    this.#db = db;
    this.#readBigInts = readBigInts;
  }

  get closed(): boolean {
    return !this.#db.isOpen;
  }

  /**
   * The underlying `node:sqlite` database, for functionality outside of the
   * standard interface.
   */
  get database(): DatabaseSync {
    return this.#db;
  }

  #assertOpen(signal?: AbortSignal): void {
    signal?.throwIfAborted();
    if (this.closed) throw new ConnectionError("Connection is closed");
  }

  /** Run a synchronous operation, reporting errors as spec errors */
  #run<T>(
    fn: () => T,
    options?: DriverQueryOptions,
    ErrorClass?: new (message: string) => DatabaseError,
  ): Promise<T> {
    try {
      this.#assertOpen(options?.signal);
      return Promise.resolve(fn());
    } catch (error) {
      if (options?.signal?.aborted) return Promise.reject(error);
      return Promise.reject(wrapError(error, ErrorClass));
    }
  }

  #statement(sql: string): StatementSync {
    const stmt = this.#db.prepare(sql);
    // SQLite only prepares the first statement and ignores the rest.
    const index = sql.indexOf(stmt.sourceSQL);
    if (
      index !== -1 &&
      !TRAILING.test(sql.slice(index + stmt.sourceSQL.length))
    ) {
      throw new QueryError(
        "Cannot run multiple statements at once, use executeScript",
      );
    }
    // `setReturnArrays` is missing from the `node:sqlite` typings.
    (stmt as StatementSync & { setReturnArrays(enabled: boolean): void })
      .setReturnArrays(true);
    stmt.setReadBigInts(this.#readBigInts);
    return stmt;
  }

  /**
   * Run a statement, and return the affected rows and the last inserted id.
   * The `changes` and `lastInsertRowid` of SQLite are only updated by
   * INSERT, UPDATE and DELETE statements, so they are stale after other
   * statements: those affect no rows, and report no inserted id.
   */
  #execute(
    stmt: StatementSync,
    params: QueryParameters | undefined,
  ): ExecuteResult {
    this.#totalChanges ??= this.#db.prepare("SELECT total_changes() AS n");
    const before = this.#totalChanges.get()!.n;
    const { changes, lastInsertRowid } = stmt.run(...toSqliteArgs(params));
    if (this.#totalChanges.get()!.n === before) return { affectedRows: 0 };
    return { affectedRows: Number(changes), lastInsertId: lastInsertRowid };
  }

  /**
   * Query a statement. The first row is read up front, so that errors reject
   * the query.
   */
  #query(
    stmt: StatementSync,
    params: QueryParameters | undefined,
    signal: AbortSignal | undefined,
    done?: () => void,
  ): DriverRows {
    const columns = stmt.columns().map((column) => column.name);
    const iterator = stmt.iterate(...toSqliteArgs(params));
    let first: IteratorResult<unknown>;
    try {
      first = iterator.next();
    } catch (error) {
      done?.();
      throw error;
    }
    let finished = false;
    let consumed = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      iterator.return?.();
      done?.();
    };
    return {
      columns,
      async *[Symbol.asyncIterator]() {
        if (consumed) return;
        consumed = true;
        try {
          let result = first;
          while (!result.done && !finished) {
            yield result.value as unknown[];
            signal?.throwIfAborted();
            result = iterator.next();
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          throw wrapError(error);
        } finally {
          finish();
        }
      },
      [Symbol.asyncDispose]() {
        finish();
        return Promise.resolve();
      },
    };
  }

  close(): Promise<void> {
    if (!this.closed) this.#db.close();
    this.#totalChanges = undefined;
    return Promise.resolve();
  }

  execute(
    sql: string,
    params?: QueryParameters,
    options?: DriverQueryOptions,
  ): Promise<ExecuteResult> {
    return this.#run(
      () => this.#execute(this.#statement(sql), params),
      options,
    );
  }

  query(
    sql: string,
    params?: QueryParameters,
    options?: DriverQueryOptions,
  ): Promise<DriverRows> {
    return this.#run(
      () => this.#query(this.#statement(sql), params, options?.signal),
      options,
    );
  }

  executeScript(sql: string, options?: DriverQueryOptions): Promise<void> {
    return this.#run(() => this.#db.exec(sql), options);
  }

  ping(): Promise<void> {
    return this.#run(
      () => {
        this.#db.prepare("SELECT 1").get();
      },
      undefined,
      ConnectionError,
    );
  }

  begin(options?: SqliteTransactionOptions): Promise<DriverTransaction> {
    return this.#run(
      () => {
        const behavior = options?.behavior ?? "deferred";
        if (!BEHAVIORS.has(behavior)) {
          throw new TransactionError(
            `Invalid transaction behavior: ${behavior}`,
          );
        }
        this.#db.exec(`BEGIN ${behavior.toUpperCase()}`);
        return this.#transaction();
      },
      undefined,
      TransactionError,
    );
  }

  #transaction(): DriverTransaction {
    let active = true;
    const control = (sql: string, end = false) =>
      this.#run(
        () => {
          if (!active) throw new TransactionError("Transaction is not active");
          this.#db.exec(sql);
          if (end) active = false;
        },
        undefined,
        TransactionError,
      );
    return {
      commit: () => control("COMMIT", true),
      rollback: () => control("ROLLBACK", true),
      savepoint: async (name: string): Promise<DriverSavepoint> => {
        if (!IDENTIFIER.test(name)) {
          throw new TransactionError(`Invalid savepoint name: ${name}`);
        }
        await control(`SAVEPOINT ${name}`);
        return this.#savepoint(name, () => active);
      },
      [Symbol.asyncDispose]: async (): Promise<void> => {
        if (active && !this.closed) await control("ROLLBACK", true);
      },
    };
  }

  #savepoint(name: string, transactionActive: () => boolean): DriverSavepoint {
    let active = true;
    const end = (sql: string) =>
      this.#run(
        () => {
          if (!active || !transactionActive()) {
            throw new TransactionError("Savepoint is not active");
          }
          this.#db.exec(sql);
          active = false;
        },
        undefined,
        TransactionError,
      );
    return {
      release: () => end(`RELEASE SAVEPOINT ${name}`),
      rollback: () =>
        end(`ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name}`),
      async [Symbol.asyncDispose]() {
        if (active && transactionActive()) {
          await end(`ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name}`);
        }
      },
    };
  }

  prepare(sql: string): Promise<DriverStatement> {
    return this.#run(() => {
      const stmt = this.#statement(sql);
      let deallocated = false;
      const assertUsable = () => {
        if (deallocated) {
          throw new QueryError("Prepared statement is deallocated");
        }
      };
      // A statement that is being iterated is prepared again for other runs.
      const current = () =>
        this.#iterating.has(stmt) ? this.#statement(sql) : stmt;
      return {
        sql,
        execute: (params, options) =>
          this.#run(() => {
            assertUsable();
            return this.#execute(current(), params);
          }, options),
        query: (params, options) =>
          this.#run(() => {
            assertUsable();
            const target = current();
            if (target !== stmt) {
              return this.#query(target, params, options?.signal);
            }
            this.#iterating.add(stmt);
            return this.#query(
              stmt,
              params,
              options?.signal,
              () => this.#iterating.delete(stmt),
            );
          }, options),
        // Statements are finalized by `node:sqlite` when garbage collected or
        // when the database is closed.
        deallocate: () => {
          deallocated = true;
          return Promise.resolve();
        },
        [Symbol.asyncDispose]() {
          return this.deallocate();
        },
      };
    });
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}
