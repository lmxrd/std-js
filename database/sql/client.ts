/**
 * The standard implementation of the client level, on top of any driver.
 *
 * @module
 */
import { DeferredStack, type DeferredStackElement } from "@stdx/collections";
import type {
  Client,
  ClientOptions,
  Connection,
  Dialect,
  Driver,
  DriverConnection,
  DriverRows,
  DriverSavepoint,
  DriverStatement,
  DriverTransaction,
  ExecuteResult,
  PreparedStatement,
  QueryOptions,
  QueryParameters,
  ResultIterableContext,
  Statement,
  Transaction,
  TransactionOptions,
} from "./core.ts";
import {
  ConnectionError,
  DatabaseError,
  QueryError,
  TransactionError,
} from "./errors.ts";
import { ClientEvent, ClientEventTarget } from "./events.ts";
import { renderStatement } from "./template.ts";
import { createResultIterableContext } from "./utils.ts";

type Callback = () => void | Promise<void>;
type ErrorClass = new (message: string) => DatabaseError;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_STATEMENT_CACHE_SIZE = 100;
const STREAMING_MESSAGE =
  "Cannot run an operation while a query result of the connection is being read: read the result to the end or dispose it first";

function wrapError(error: unknown, ErrorClass: ErrorClass): DatabaseError {
  if (error instanceof DatabaseError) return error;
  const wrapped = new ErrorClass(
    error instanceof Error ? error.message : String(error),
  );
  wrapped.cause = error;
  return wrapped;
}

function transformParams(
  params: unknown,
  transform: ((value: unknown) => unknown) | undefined,
): QueryParameters | undefined {
  if (params === undefined || transform === undefined) {
    return params as QueryParameters | undefined;
  }
  if (Array.isArray(params)) return params.map(transform) as QueryParameters;
  return Object.fromEntries(
    (Object.entries(params as Record<string, unknown>)).map((
      [key, value],
    ) => [key, transform(value)]),
  ) as QueryParameters;
}

async function runTransaction<T>(
  tx: Transaction,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  try {
    const result = await fn(tx);
    if (tx.inTransaction) await tx.commit();
    return result;
  } catch (error) {
    if (tx.inTransaction) {
      // The original error is more relevant than a failing rollback.
      await tx.rollback().catch(() => {});
    }
    throw error;
  }
}

/**
 * Create a lazy result that delegates to another result, which is only
 * created when the result is started, so that checks, such as whether a
 * transaction is still active, run when the query runs. The `done` callback
 * runs once the delegated result is read or disposed. The record type is the
 * given `R`: the delegated result produces records of its own record type.
 */
function delegateResult<R>(
  start: () => Promise<{ result: ResultIterableContext; done?: Callback }>,
): ResultIterableContext<unknown[], R> {
  return createResultIterableContext(async () => {
    const { result, done } = await start();
    const finish = async () => {
      await result[Symbol.asyncDispose]();
      await done?.();
    };
    let columns: string[];
    try {
      columns = await result.columns();
    } catch (error) {
      await finish();
      throw error;
    }
    async function* rows(): AsyncGenerator<unknown[]> {
      try {
        for await (const row of result) yield row.values;
      } finally {
        await finish();
      }
    }
    return { columns, rows: rows() };
  }) as ResultIterableContext<unknown[], R>;
}

/**
 * The state of a driver connection of the pool, kept across acquires.
 *
 * @template IParameters the query parameter types
 */
interface PooledConnection<
  IParameters extends readonly unknown[] | Record<string, unknown> =
    QueryParameters,
> {
  readonly connection: DriverConnection;
  readonly openedAt: number;
  /** The prepared statement cache, in least recently used order */
  readonly statements: Map<string, DriverStatement>;
  /** Operations use the connection one at a time */
  readonly lock: DeferredStack<true>;
  /** The operations waiting for the lock */
  readonly waiting: Set<AbortController>;
  /** Whether a query result is being read */
  streaming: boolean;
  /** The active root transaction */
  transaction?: SqlTransaction<IParameters>;
}

/**
 * Acquire the lock of a connection. While a query result is being read,
 * operations are rejected: the rest of the result is not buffered, as it may
 * not fit in memory.
 */
async function lock<
  IParameters extends readonly unknown[] | Record<string, unknown>,
>(
  pooled: PooledConnection<IParameters>,
): Promise<() => void> {
  if (pooled.streaming) throw new QueryError(STREAMING_MESSAGE);
  const controller = new AbortController();
  pooled.waiting.add(controller);
  let element;
  try {
    element = await pooled.lock.pop({ signal: controller.signal });
  } finally {
    pooled.waiting.delete(controller);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    void element.release();
  };
}

/**
 * Mark a connection as streaming. Operations waiting for its lock would wait
 * until the result is read, which may only happen after they finish, so they
 * are rejected.
 */
function startStreaming<
  IParameters extends readonly unknown[] | Record<string, unknown>,
>(
  pooled: PooledConnection<IParameters>,
): void {
  pooled.streaming = true;
  for (const waiting of pooled.waiting) {
    waiting.abort(new QueryError(STREAMING_MESSAGE));
  }
}

/**
 * Get the cached prepared statement of the SQL, preparing it when it is not
 * cached. Resolves to `undefined` when the driver has no prepared statements
 * or the cache is disabled.
 */
async function cachedStatement<
  IParameters extends readonly unknown[] | Record<string, unknown>,
>(
  pooled: PooledConnection<IParameters>,
  sql: string,
  size: number,
): Promise<DriverStatement | undefined> {
  const { connection, statements } = pooled;
  if (connection.prepare === undefined || size <= 0) return undefined;
  let statement = statements.get(sql);
  if (statement) {
    // Move it to the end, as the most recently used statement.
    statements.delete(sql);
    statements.set(sql, statement);
    return statement;
  }
  statement = await connection.prepare(sql);
  statements.set(sql, statement);
  for (const [key, oldest] of statements) {
    if (statements.size <= size) break;
    statements.delete(key);
    await oldest.deallocate().catch(() => {});
  }
  return statement;
}

/** Remove a statement from the cache, such as after it failed */
async function evictStatement<
  IParameters extends readonly unknown[] | Record<string, unknown>,
>(
  pooled: PooledConnection<IParameters>,
  sql: string,
  statement: DriverStatement,
): Promise<void> {
  if (pooled.statements.get(sql) !== statement) return;
  pooled.statements.delete(sql);
  await statement.deallocate().catch(() => {});
}

/**
 * What a {@linkcode SqlConnection} needs from its client.
 */
interface ConnectionContext {
  readonly dialect: Dialect;
  readonly queryOptions: QueryOptions | undefined;
  readonly transactionOptions: TransactionOptions | undefined;
  /** Wrap an error and dispatch it as an error event */
  error(error: unknown, ErrorClass: ErrorClass, signal?: AbortSignal): unknown;
}

// Accessors to private members, assigned in static blocks of the classes, so
// that the hooks of the client are not part of the public class surface.
let addDeallocateCallback: <
  IParameters extends readonly unknown[] | Record<string, unknown>,
>(
  stmt: SqlPreparedStatement<IParameters>,
  callback: Callback,
) => void;
let addEndCallback: <
  IParameters extends readonly unknown[] | Record<string, unknown>,
>(
  tx: SqlTransaction<IParameters>,
  callback: Callback,
) => void;
let endTransaction: <
  IParameters extends readonly unknown[] | Record<string, unknown>,
>(
  tx: SqlTransaction<IParameters>,
) => Promise<void>;

/**
 * The calls a {@linkcode SqlPreparedStatement} delegates to.
 *
 * @template IParameters the query parameter types
 */
interface PreparedStatementCalls<
  IParameters extends readonly unknown[] | Record<string, unknown> =
    QueryParameters,
> {
  execute(
    params?: IParameters | QueryParameters,
    options?: QueryOptions,
  ): Promise<ExecuteResult>;
  query(
    params?: IParameters | QueryParameters,
    options?: QueryOptions,
  ): ResultIterableContext;
  deallocate(): Promise<void>;
}

/**
 * The prepared statement of the standard client, created by
 * {@linkcode SqlConnection.prepare} or {@linkcode SqlClient.prepare}.
 *
 * @example
 * ```ts
 * import { SqliteClient } from "@stdx/database/drivers/sqlite";
 *
 * await using client = new SqliteClient(":memory:");
 * await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");
 * await client.execute("INSERT INTO users VALUES (1, 'Alice')");
 * await using statement = await client.prepare(
 *   "SELECT name FROM users WHERE id = ?",
 * );
 * console.log(await statement.query([1]).toRecords());
 * // [{ name: "Alice" }]
 * ```
 *
 * @template IParameters the query parameter types, extended by the driver
 */
export class SqlPreparedStatement<
  IParameters extends readonly unknown[] | Record<string, unknown> =
    QueryParameters,
> implements PreparedStatement {
  readonly #sql: string;
  readonly #calls: PreparedStatementCalls<IParameters>;
  readonly #onDeallocate: Callback[] = [];
  #deallocated = false;

  /**
   * Prepared statements are created with {@linkcode SqlConnection.prepare}.
   *
   * @ignore
   */
  constructor(sql: string, calls: PreparedStatementCalls<IParameters>) {
    this.#sql = sql;
    this.#calls = calls;
  }

  get sql(): string {
    return this.#sql;
  }

  get deallocated(): boolean {
    return this.#deallocated;
  }

  #assertUsable(): void {
    if (this.#deallocated) {
      throw new QueryError("Prepared statement is deallocated");
    }
  }

  async deallocate(): Promise<void> {
    if (this.#deallocated) return;
    this.#deallocated = true;
    try {
      await this.#calls.deallocate();
    } finally {
      for (const callback of this.#onDeallocate) await callback();
    }
  }

  async execute(
    params?: IParameters | QueryParameters,
    options?: QueryOptions,
  ): Promise<ExecuteResult> {
    this.#assertUsable();
    return await this.#calls.execute(params, options);
  }

  query<R = Record<string, unknown>>(
    params?: IParameters | QueryParameters,
    options?: QueryOptions,
  ): ResultIterableContext<unknown[], R> {
    return delegateResult<R>(() => {
      this.#assertUsable();
      return Promise.resolve({ result: this.#calls.query(params, options) });
    });
  }

  static {
    addDeallocateCallback = (stmt, callback) =>
      stmt.#onDeallocate.push(callback);
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.deallocate();
  }
}

/**
 * What a {@linkcode SqlTransaction} needs from its connection.
 *
 * @template IParameters the query parameter types
 */
interface TransactionContext<
  IParameters extends readonly unknown[] | Record<string, unknown> =
    QueryParameters,
> {
  readonly connection: SqlConnection<IParameters>;
  readonly transaction: DriverTransaction;
  /** Run a transaction control operation on the connection */
  control<T>(fn: () => Promise<T>): Promise<T>;
  /** Generate a unique savepoint name */
  savepointName(): string;
  /** Whether the connection was lost */
  lost(): boolean;
  /** End the root transaction, after the connection was lost */
  endLost(): void;
}

/**
 * The transaction of the standard client, created by
 * {@linkcode SqlConnection.beginTransaction} or
 * {@linkcode SqlClient.beginTransaction}. Nested transactions are savepoints.
 *
 * @example
 * ```ts
 * import { SqliteClient } from "@stdx/database/drivers/sqlite";
 *
 * await using client = new SqliteClient(":memory:");
 * await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");
 * const transaction = await client.beginTransaction();
 * await transaction.execute("INSERT INTO users VALUES (1, 'Alice')");
 * console.log(transaction.inTransaction); // true
 * await transaction.commit();
 * console.log(transaction.inTransaction); // false
 * // Disposing an active transaction rolls it back instead.
 * ```
 *
 * @template IParameters the query parameter types, extended by the driver
 */
export class SqlTransaction<
  IParameters extends readonly unknown[] | Record<string, unknown> =
    QueryParameters,
> implements Transaction {
  readonly #context: TransactionContext<IParameters>;
  readonly #savepoint?: DriverSavepoint;
  readonly #children: SqlTransaction<IParameters>[] = [];
  readonly #savepoints: { name: string; savepoint: DriverSavepoint }[] = [];
  readonly #onEnd: Callback[] = [];
  #active = true;

  /**
   * Transactions are created with {@linkcode SqlConnection.beginTransaction}.
   *
   * @ignore
   */
  constructor(
    context: TransactionContext<IParameters>,
    savepoint?: DriverSavepoint,
  ) {
    this.#context = context;
    this.#savepoint = savepoint;
  }

  get inTransaction(): boolean {
    return this.#active;
  }

  #assertActive(): void {
    if (!this.#active) {
      throw new TransactionError("Transaction is not active");
    }
    if (this.#context.lost()) {
      // The database rolled the transaction back with the connection.
      this.#invalidate();
      this.#context.endLost();
      throw new ConnectionError(
        "The connection was lost, and the transaction was rolled back",
      );
    }
  }

  async #end(): Promise<void> {
    this.#invalidate();
    for (const callback of this.#onEnd) await callback();
  }

  #invalidate(): void {
    this.#active = false;
    for (const child of this.#children) child.#invalidate();
  }

  async execute(
    sql: Statement,
    params?: IParameters | QueryParameters,
    options?: QueryOptions,
  ): Promise<ExecuteResult> {
    this.#assertActive();
    return await this.#context.connection.execute(sql, params, options);
  }

  query<R = Record<string, unknown>>(
    sql: Statement,
    params?: IParameters | QueryParameters,
    options?: QueryOptions,
  ): ResultIterableContext<unknown[], R> {
    return delegateResult<R>(() => {
      this.#assertActive();
      return Promise.resolve({
        result: this.#context.connection.query(sql, params, options),
      });
    });
  }

  async executeScript(sql: string, options?: QueryOptions): Promise<void> {
    this.#assertActive();
    await this.#context.connection.executeScript(sql, options);
  }

  async prepare(
    sql: string,
    options?: QueryOptions,
  ): Promise<SqlPreparedStatement<IParameters>> {
    this.#assertActive();
    return await this.#context.connection.prepare(sql, options);
  }

  async beginTransaction(
    _options?: TransactionOptions,
  ): Promise<SqlTransaction<IParameters>> {
    this.#assertActive();
    const name = this.#context.savepointName();
    const savepoint = await this.#context.control(() =>
      this.#context.transaction.savepoint(name)
    );
    const child = new SqlTransaction<IParameters>(this.#context, savepoint);
    this.#children.push(child);
    return child;
  }

  async transaction<T>(
    fn: (tx: Transaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    return await runTransaction(await this.beginTransaction(options), fn);
  }

  async commit(_options?: TransactionOptions): Promise<void> {
    this.#assertActive();
    await this.#context.control(() =>
      this.#savepoint
        ? this.#savepoint.release()
        : this.#context.transaction.commit()
    );
    await this.#end();
  }

  async rollback(_options?: TransactionOptions): Promise<void> {
    this.#assertActive();
    try {
      await this.#context.control(() =>
        this.#savepoint
          ? this.#savepoint.rollback()
          : this.#context.transaction.rollback()
      );
    } finally {
      await this.#end();
    }
  }

  async createSavepoint(
    name?: string,
    _options?: TransactionOptions,
  ): Promise<void> {
    this.#assertActive();
    name ??= this.#context.savepointName();
    if (!IDENTIFIER.test(name)) {
      throw new TransactionError(`Invalid savepoint name: ${name}`);
    }
    const savepointName = name;
    const savepoint = await this.#context.control(() =>
      this.#context.transaction.savepoint(savepointName)
    );
    this.#savepoints.push({ name, savepoint });
  }

  async releaseSavepoint(
    name?: string,
    _options?: TransactionOptions,
  ): Promise<void> {
    this.#assertActive();
    if (name !== undefined && !IDENTIFIER.test(name)) {
      throw new TransactionError(`Invalid savepoint name: ${name}`);
    }
    const index = name === undefined
      ? this.#savepoints.length - 1
      : this.#savepoints.findLastIndex((entry) => entry.name === name);
    if (index === -1) {
      throw new TransactionError(
        name === undefined
          ? "There is no savepoint to release"
          : `Unknown savepoint: ${name}`,
      );
    }
    const { savepoint } = this.#savepoints[index];
    await this.#context.control(() => savepoint.release());
    // Releasing a savepoint also releases the savepoints created after it.
    this.#savepoints.splice(index);
  }

  static {
    addEndCallback = (tx, callback) => tx.#onEnd.push(callback);
    endTransaction = (tx) => tx.#end();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#active) await this.rollback();
  }
}

/**
 * The connection of the standard client, acquired with
 * {@linkcode SqlClient.acquire}. Operations run one at a time; an operation
 * started while a query result of the connection is being read rejects with
 * a {@linkcode QueryError}.
 *
 * @example
 * ```ts
 * import { SqliteClient } from "@stdx/database/drivers/sqlite";
 *
 * await using client = new SqliteClient(":memory:");
 * await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");
 * // The connection is held until it is released, which disposing does.
 * await using connection = await client.acquire();
 * await connection.execute("INSERT INTO users VALUES (1, 'Alice')");
 * console.log(await connection.query("SELECT * FROM users").toRecords());
 * // [{ id: 1, name: "Alice" }]
 * ```
 *
 * @template IParameters the query parameter types, extended by the driver
 */
export class SqlConnection<
  IParameters extends readonly unknown[] | Record<string, unknown> =
    QueryParameters,
> implements Connection {
  readonly #context: ConnectionContext;
  readonly #pooled: PooledConnection<IParameters>;
  readonly #release: () => Promise<void>;
  readonly #remove: () => Promise<void>;
  #released = false;
  #savepointId = 0;

  /**
   * Connections are acquired with {@linkcode SqlClient.acquire}.
   *
   * @ignore
   */
  constructor(
    context: ConnectionContext,
    pooled: PooledConnection<IParameters>,
    release: () => Promise<void>,
    remove: () => Promise<void>,
  ) {
    this.#context = context;
    this.#pooled = pooled;
    this.#release = release;
    this.#remove = remove;
  }

  get connected(): boolean {
    return !this.#pooled.connection.closed;
  }

  get released(): boolean {
    return this.#released;
  }

  get dialect(): Dialect {
    return this.#context.dialect;
  }

  get driverConnection(): DriverConnection {
    this.#assertUsable();
    return this.#pooled.connection;
  }

  #assertUsable(): void {
    if (this.#released) throw new ConnectionError("Connection is released");
    this.#assertOpen();
  }

  #assertOpen(): void {
    if (this.#pooled.connection.closed) {
      throw new ConnectionError("Connection is closed");
    }
  }

  #merge(options: QueryOptions | undefined): QueryOptions {
    return { ...this.#context.queryOptions, ...options };
  }

  #cacheSize(options: QueryOptions): number {
    return options.statementCacheSize ?? DEFAULT_STATEMENT_CACHE_SIZE;
  }

  /** Run an operation with the lock of the connection */
  async #run<T>(
    options: QueryOptions,
    ErrorClass: ErrorClass,
    fn: () => Promise<T>,
    assert: () => void = () => this.#assertUsable(),
  ): Promise<T> {
    try {
      options.signal?.throwIfAborted();
      assert();
      const unlock = await lock(this.#pooled);
      try {
        return await fn();
      } finally {
        unlock();
      }
    } catch (error) {
      throw this.#context.error(error, ErrorClass, options.signal);
    }
  }

  /**
   * Create a lazy result, holding the lock of the connection while read. The
   * record type is the given `R`: the rows are mapped to records of it.
   */
  #result<R = Record<string, unknown>>(
    options: QueryOptions,
    start: () => Promise<DriverRows>,
  ): ResultIterableContext<unknown[], R> {
    return createResultIterableContext(async () => {
      try {
        options.signal?.throwIfAborted();
        this.#assertUsable();
        const unlock = await lock(this.#pooled);
        let rows: DriverRows;
        try {
          rows = await start();
        } catch (error) {
          unlock();
          throw error;
        }
        startStreaming(this.#pooled);
        return {
          columns: rows.columns,
          rows: this.#rows(rows, options, () => {
            this.#pooled.streaming = false;
            unlock();
          }),
        };
      } catch (error) {
        throw this.#context.error(error, QueryError, options.signal);
      }
    }) as ResultIterableContext<unknown[], R>;
  }

  async *#rows(
    rows: DriverRows,
    options: QueryOptions,
    done: () => void,
  ): AsyncGenerator<unknown[]> {
    const transform = options.transformOutput;
    try {
      for await (const values of rows) {
        options.signal?.throwIfAborted();
        yield transform ? values.map(transform) : values;
      }
    } catch (error) {
      throw this.#context.error(error, QueryError, options.signal);
    } finally {
      try {
        await rows[Symbol.asyncDispose]();
      } catch {
        // The rows are released with the connection either way.
      }
      done();
    }
  }

  #render(
    statement: Statement,
    params: (IParameters | QueryParameters) | undefined,
    options: QueryOptions,
  ): { sql: string; params: QueryParameters | undefined } {
    const rendered = renderStatement(
      statement,
      params as QueryParameters | undefined,
      (index) => this.#context.dialect.placeholder(index),
    );
    return {
      sql: rendered.sql,
      params: transformParams(rendered.params, options.transformInput),
    };
  }

  /**
   * Run a statement through the prepared statement cache: with the cached
   * native statement when there is one, and with the connection otherwise.
   * A statement whose run fails is evicted from the cache.
   */
  async #runCached<T>(
    sql: Statement,
    params: (IParameters | QueryParameters) | undefined,
    merged: QueryOptions,
    run: (
      statement: DriverStatement | undefined,
      call: { sql: string; params: QueryParameters | undefined },
    ) => Promise<T>,
  ): Promise<T> {
    const call = this.#render(sql, params, merged);
    const statement = await cachedStatement(
      this.#pooled,
      call.sql,
      this.#cacheSize(merged),
    );
    try {
      return await run(statement, call);
    } catch (error) {
      if (statement) await evictStatement(this.#pooled, call.sql, statement);
      throw error;
    }
  }

  async execute(
    sql: Statement,
    params?: IParameters | QueryParameters,
    options?: QueryOptions,
  ): Promise<ExecuteResult> {
    const merged = this.#merge(options);
    return await this.#run(
      merged,
      QueryError,
      () =>
        this.#runCached(sql, params, merged, (statement, call) => {
          const driverOptions = { signal: merged.signal };
          return statement
            ? statement.execute(call.params, driverOptions)
            : this.#pooled.connection.execute(
              call.sql,
              call.params,
              driverOptions,
            );
        }),
    );
  }

  query<R = Record<string, unknown>>(
    sql: Statement,
    params?: IParameters | QueryParameters,
    options?: QueryOptions,
  ): ResultIterableContext<unknown[], R> {
    const merged = this.#merge(options);
    return this.#result<R>(
      merged,
      () =>
        this.#runCached(sql, params, merged, (statement, call) => {
          const driverOptions = { signal: merged.signal };
          return statement
            ? statement.query(call.params, driverOptions)
            : this.#pooled.connection.query(
              call.sql,
              call.params,
              driverOptions,
            );
        }),
    );
  }

  async executeScript(sql: string, options?: QueryOptions): Promise<void> {
    const merged = this.#merge(options);
    await this.#run(
      merged,
      QueryError,
      () =>
        this.#pooled.connection.executeScript(sql, { signal: merged.signal }),
    );
  }

  async ping(): Promise<void> {
    await this.#run({}, ConnectionError, () => this.#pooled.connection.ping());
  }

  async prepare(
    sql: string,
    options?: QueryOptions,
  ): Promise<SqlPreparedStatement<IParameters>> {
    const base = this.#merge(options);
    const { connection } = this.#pooled;
    const native = await this.#run(
      base,
      QueryError,
      async () => await connection.prepare?.(sql),
    );
    const args = (
      params: (IParameters | QueryParameters) | undefined,
      merged: QueryOptions,
    ) =>
      [
        transformParams(params, merged.transformInput),
        { signal: merged.signal },
      ] as const;
    return new SqlPreparedStatement(sql, {
      execute: (params, options) => {
        const merged = { ...base, ...options };
        return this.#run(
          merged,
          QueryError,
          () =>
            native
              ? native.execute(...args(params, merged))
              : connection.execute(sql, ...args(params, merged)),
        );
      },
      query: (params, options) => {
        const merged = { ...base, ...options };
        return this.#result(
          merged,
          () =>
            native
              ? native.query(...args(params, merged))
              : connection.query(sql, ...args(params, merged)),
        );
      },
      // The statement can be deallocated after the connection is released.
      deallocate: async () => {
        if (!native || connection.closed) return;
        await this.#run(
          base,
          QueryError,
          () => native.deallocate(),
          () => this.#assertOpen(),
        );
      },
    });
  }

  async beginTransaction(
    options?: TransactionOptions,
  ): Promise<SqlTransaction<IParameters>> {
    try {
      this.#assertUsable();
    } catch (error) {
      throw this.#context.error(error, ConnectionError);
    }
    const root = this.#pooled.transaction;
    if (root?.inTransaction) return await root.beginTransaction(options);
    const merged = { ...this.#context.transactionOptions, ...options };
    // Transactions are ended by the pool when the connection is released.
    const control = <T>(fn: () => Promise<T>) =>
      this.#run({}, TransactionError, fn, () => this.#assertOpen());
    const transaction = await control(() =>
      this.#pooled.connection.begin(merged)
    );
    const tx = new SqlTransaction({
      connection: this,
      transaction,
      control,
      savepointName: () => `sp_${++this.#savepointId}`,
      lost: () => this.#pooled.connection.closed,
      endLost: () => {
        if (this.#pooled.transaction === tx) {
          endTransaction(tx).catch(() => {});
        }
      },
    });
    addEndCallback(tx, () => {
      if (this.#pooled.transaction === tx) this.#pooled.transaction = undefined;
    });
    this.#pooled.transaction = tx;
    return tx;
  }

  async transaction<T>(
    fn: (tx: Transaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    return await runTransaction(await this.beginTransaction(options), fn);
  }

  async release(): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    await this.#release();
  }

  async remove(): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    await this.#remove();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.release();
  }
}

/**
 * SqlClient
 *
 * The standard implementation of the client level: a pool of connections of
 * any {@linkcode Driver}, with lazy results, SQL templates, nested
 * transactions, prepared statements and a prepared statement cache, events,
 * and value transforms. Drivers export a preconfigured client, such as
 * `SqliteClient`, binding the driver.
 *
 * The connection is opened implicitly by the first operation; closing is
 * explicit.
 *
 * @template IDriver the driver
 * @template IOptions the client options
 * @template IParameters the query parameter types, extended by the driver
 *
 * @example
 * ```ts
 * import { SqlClient } from "@stdx/database/sql";
 * import { SqliteDriver } from "@stdx/database/drivers/sqlite";
 *
 * await using client = new SqlClient(new SqliteDriver(), ":memory:");
 * await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");
 * console.log(await client.query("SELECT * FROM users").toRecords());
 * ```
 */
export class SqlClient<
  IDriver extends Driver = Driver,
  IOptions extends ClientOptions = ClientOptions,
  IParameters extends readonly unknown[] | Record<string, unknown> =
    QueryParameters,
> implements Client<IOptions> {
  readonly #driver: IDriver;
  readonly #connectionUrl: string | URL;
  readonly #options: IOptions;
  readonly eventTarget: ClientEventTarget = new ClientEventTarget();
  readonly #dispatched = new WeakSet<DatabaseError>();
  readonly #idleTimers = new Map<
    PooledConnection<IParameters>,
    ReturnType<typeof setTimeout>
  >();
  readonly #context: ConnectionContext;
  #stack?: DeferredStack<PooledConnection<IParameters>>;
  #opening = 0;
  #connected = false;
  #closed = false;
  #connecting?: Promise<void>;

  /**
   * Create a client for the driver.
   *
   * @param driver the driver
   * @param connectionUrl the connection URL, in the format of the database
   * @param options the client options
   */
  constructor(
    driver: IDriver,
    connectionUrl: string | URL,
    options?: IOptions,
  ) {
    this.#driver = driver;
    this.#connectionUrl = connectionUrl;
    const requested = Math.max(1, options?.poolOptions?.maxSize ?? 1);
    const max = driver.maxConnections;
    this.#options = {
      ...options,
      poolOptions: {
        ...options?.poolOptions,
        maxSize: max === undefined ? requested : Math.min(requested, max),
      },
    } as IOptions;
    this.#context = {
      dialect: driver.dialect,
      queryOptions: this.#options.queryOptions,
      transactionOptions: this.#options.transactionOptions,
      error: (error, ErrorClass, signal) =>
        this.#error(error, ErrorClass, signal),
    };
  }

  /** The driver */
  get driver(): IDriver {
    return this.#driver;
  }

  get connectionUrl(): string | URL {
    return this.#connectionUrl;
  }

  get options(): IOptions {
    return this.#options;
  }

  get connected(): boolean {
    return this.#connected;
  }

  get dialect(): Dialect {
    return this.#driver.dialect;
  }

  #dispatch(type: "connect" | "close" | "acquire" | "release"): void {
    this.eventTarget.dispatchEvent(
      new ClientEvent(type, { detail: { client: this } }),
    );
  }

  #error(
    error: unknown,
    ErrorClass: ErrorClass,
    signal?: AbortSignal,
  ): unknown {
    if (signal?.aborted && error === signal.reason) return error;
    const wrapped = wrapError(error, ErrorClass);
    if (!this.#dispatched.has(wrapped)) {
      this.#dispatched.add(wrapped);
      this.eventTarget.dispatchEvent(
        new ClientEvent("error", { detail: { client: this, error: wrapped } }),
      );
    }
    return wrapped;
  }

  get #poolOptions() {
    return this.#options.poolOptions!;
  }

  /** Whether a connection can be opened without exceeding the pool size */
  get #canOpen(): boolean {
    const stack = this.#stack!;
    return stack.totalCount + this.#opening < stack.maxSize;
  }

  /** Whether a connection has reached its maximum lifetime */
  #expired(pooled: PooledConnection<IParameters>): boolean {
    const { maxLifetime } = this.#poolOptions;
    return maxLifetime !== undefined &&
      Date.now() - pooled.openedAt >= maxLifetime;
  }

  #clearIdleTimer(pooled: PooledConnection<IParameters>): void {
    clearTimeout(this.#idleTimers.get(pooled));
    this.#idleTimers.delete(pooled);
  }

  /** Close the connection once it has been idle for the idle timeout */
  #scheduleIdle(pooled: PooledConnection<IParameters>): void {
    const { idleTimeout } = this.#poolOptions;
    const stack = this.#stack;
    if (idleTimeout === undefined || !stack) return;
    // The connection may have been handed to a waiting acquire instead.
    if (!stack.stack.some((element) => element._value === pooled)) return;
    this.#clearIdleTimer(pooled);
    this.#idleTimers.set(
      pooled,
      setTimeout(() => {
        this.#idleTimers.delete(pooled);
        const element = stack.stack.find((element) =>
          element._value === pooled
        );
        element?.remove().catch(() => {});
      }, idleTimeout),
    );
  }

  /** Connect the driver, within the connect timeout */
  async #connectDriver(): Promise<DriverConnection> {
    const connectionOptions = this.#options.connectionOptions;
    const timeout = connectionOptions?.connectTimeout;
    const controller = new AbortController();
    const timer = timeout === undefined ? undefined : setTimeout(
      () =>
        controller.abort(
          new ConnectionError(`Timed out after ${timeout} ms connecting`),
        ),
      timeout,
    );
    try {
      const connecting = this.#driver.connect(this.#connectionUrl, {
        ...connectionOptions,
        signal: controller.signal,
      });
      const aborted = new Promise<never>((_, reject) =>
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason),
          { once: true },
        )
      );
      try {
        return await Promise.race([connecting, aborted]);
      } catch (error) {
        // A connection that is established after the timeout is closed.
        connecting.then((connection) => connection.close()).catch(() => {});
        throw error;
      }
    } catch (error) {
      throw this.#error(error, ConnectionError);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Open a connection and add it to the pool */
  async #open(): Promise<void> {
    const stack = this.#stack!;
    this.#opening++;
    try {
      const connection = await this.#connectDriver();
      if (!this.#connected || this.#stack !== stack) {
        await connection.close();
        throw new ConnectionError("Client is closed");
      }
      const pooled: PooledConnection<IParameters> = {
        connection,
        openedAt: Date.now(),
        statements: new Map(),
        lock: new DeferredStack<true>({ maxSize: 1 }),
        waiting: new Set(),
        streaming: false,
      };
      pooled.lock.add(true);
      this.#dispatch("connect");
      stack.add(pooled);
      this.#scheduleIdle(pooled);
    } finally {
      this.#opening--;
    }
  }

  /**
   * Open a connection for queued acquires after a connection was removed, as
   * no release will serve them otherwise.
   */
  async #replenish(): Promise<void> {
    if (this.#connected && this.#stack!.queuedCount > 0 && this.#canOpen) {
      // A failure is dispatched as an error event.
      await this.#open().catch(() => {});
    }
  }

  async #release(
    element: DeferredStackElement<PooledConnection<IParameters>>,
    pooled: PooledConnection<IParameters>,
  ): Promise<void> {
    this.#dispatch("release");
    try {
      if (pooled.transaction?.inTransaction) {
        await pooled.transaction.rollback();
      }
    } catch {
      // A connection that can not be reset is broken, and is not reused.
      return await this.#remove(element);
    }
    if (
      pooled.connection.closed || pooled.streaming || this.#expired(pooled)
    ) {
      return await this.#remove(element);
    }
    await element.release();
    this.#scheduleIdle(pooled);
  }

  async #remove(
    element: DeferredStackElement<PooledConnection<IParameters>>,
  ): Promise<void> {
    await element.remove();
    await this.#replenish();
  }

  /** Pop a connection, waiting at most until the deadline */
  async #pop(
    stack: DeferredStack<PooledConnection<IParameters>>,
    deadline: number | undefined,
  ): Promise<DeferredStackElement<PooledConnection<IParameters>>> {
    if (deadline === undefined) return await stack.pop();
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(0, deadline - Date.now()),
    );
    try {
      return await stack.pop({ signal: controller.signal });
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      throw new ConnectionError(
        `Timed out after ${this.#poolOptions.acquireTimeout} ms waiting for a connection`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async connect(): Promise<void> {
    if (this.#connected) return;
    // Concurrent calls share the same attempt.
    this.#connecting ??= this.#start().finally(() => {
      this.#connecting = undefined;
    });
    await this.#connecting;
  }

  async #start(): Promise<void> {
    const { maxSize, acquireTimeout, idleTimeout, maxLifetime } =
      this.#poolOptions;
    const connectTimeout = this.#options.connectionOptions?.connectTimeout;
    const durations = {
      acquireTimeout,
      idleTimeout,
      maxLifetime,
      connectTimeout,
    };
    for (const [name, value] of Object.entries(durations)) {
      if (value !== undefined && !(value >= 0)) {
        throw new RangeError(
          `Cannot connect as '${name}' must be a non-negative number: received ${value}`,
        );
      }
    }
    this.#connected = true;
    this.#closed = false;
    this.#stack = new DeferredStack<PooledConnection<IParameters>>({
      maxSize: maxSize!,
      removeFn: (pooled) => {
        this.#clearIdleTimer(pooled);
        this.#dispatch("close");
        return pooled.connection.close();
      },
    });
    if (this.#poolOptions.lazyInitialization) return;
    try {
      while (this.#canOpen) await this.#open();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (!this.#connected) return;
    this.#connected = false;
    // Closing is best effort: a connection failing to close is gone anyway.
    await this.#stack?.clear(new ConnectionError("Client is closed"))
      .catch(() => {});
  }

  async acquire(): Promise<SqlConnection<IParameters>> {
    const { acquireTimeout } = this.#poolOptions;
    const deadline = acquireTimeout === undefined
      ? undefined
      : Date.now() + acquireTimeout;
    // Connect implicitly, unless the client was closed.
    if (!this.#connected && !this.#closed) await this.connect();
    while (true) {
      if (!this.#connected) throw new ConnectionError("Client is closed");
      const stack = this.#stack!;
      if (stack.availableCount === 0 && this.#canOpen) await this.#open();
      // Waits for a release when the pool is exhausted, and rejects when the
      // client closes or the acquire timeout passes.
      const element = await this.#pop(stack, deadline);
      const pooled = element.value;
      this.#clearIdleTimer(pooled);
      if (pooled.connection.closed || this.#expired(pooled)) {
        await this.#remove(element);
        continue;
      }
      this.#dispatch("acquire");
      return new SqlConnection(
        this.#context,
        pooled,
        () => this.#release(element, pooled),
        () => this.#remove(element),
      );
    }
  }

  async ping(): Promise<void> {
    await using connection = await this.acquire();
    await connection.ping();
  }

  async execute(
    sql: Statement,
    params?: IParameters | QueryParameters,
    options?: QueryOptions,
  ): Promise<ExecuteResult> {
    await using connection = await this.acquire();
    return await connection.execute(sql, params, options);
  }

  query<R = Record<string, unknown>>(
    sql: Statement,
    params?: IParameters | QueryParameters,
    options?: QueryOptions,
  ): ResultIterableContext<unknown[], R> {
    // The connection is acquired when the query runs, and held until the
    // result is fully read or disposed.
    return delegateResult<R>(async () => {
      const connection = await this.acquire();
      return {
        result: connection.query(sql, params, options),
        done: () => connection.release(),
      };
    });
  }

  async executeScript(sql: string, options?: QueryOptions): Promise<void> {
    await using connection = await this.acquire();
    await connection.executeScript(sql, options);
  }

  /**
   * Acquire a connection and create an object that holds it, such as a
   * transaction or a prepared statement: the object releases the connection
   * when it ends, and the connection is released when creating it fails.
   */
  async #holding<T>(
    create: (connection: SqlConnection<IParameters>) => Promise<T>,
    onEnd: (held: T, release: () => Promise<void>) => void,
  ): Promise<T> {
    const connection = await this.acquire();
    try {
      const held = await create(connection);
      onEnd(held, () => connection.release());
      return held;
    } catch (error) {
      await connection.release();
      throw error;
    }
  }

  async prepare(
    sql: string,
    options?: QueryOptions,
  ): Promise<SqlPreparedStatement<IParameters>> {
    // The connection is held until the statement is deallocated.
    return await this.#holding(
      (connection) => connection.prepare(sql, options),
      addDeallocateCallback,
    );
  }

  async beginTransaction(
    options?: TransactionOptions,
  ): Promise<SqlTransaction<IParameters>> {
    // The connection is held until the transaction has ended.
    return await this.#holding(
      (connection) => connection.beginTransaction(options),
      addEndCallback,
    );
  }

  async transaction<T>(
    fn: (tx: Transaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    await using connection = await this.acquire();
    return await connection.transaction(fn, options);
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}
