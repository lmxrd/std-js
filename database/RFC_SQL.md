# RFC: @stdx/database/sql - Standardized SQL Database Interface Specification

This RFC proposes a standardized interface for SQL-like database drivers.

## Overview

In the ever-evolving landscape of web development, the need for robust,
efficient, and standardized database connectivity is paramount. SQL-based
databases remain a cornerstone of data storage and retrieval in countless
applications, ranging from small-scale personal projects to large-scale
enterprise systems. However, the current ecosystem of JavaScript database
drivers for SQL-based databases is highly fragmented, leading to inconsistent
and often incompatible interfaces across different drivers.

Similar effort has been made in the
[Go ecosystem](https://pkg.go.dev/database/sql), and can therefore be used for
guidance.

Like Go's `database/sql/driver` and `database/sql`, the specification has two
levels: a minimal **driver level**, implemented by database drivers and
JavaScript runtimes, and a user facing **client level**, implemented once on top
of any driver and used by applications and tools, such as migration tools and
query builders.

The specification is shown using TypeScript. The interfaces, the standard
implementation of the client level, helper utilities and conformance test suites
are implemented in the [`@stdx/database`](https://jsr.io/@stdx/database)
package, published on [JSR](https://jsr.io/). Drivers do not need to import the
types to be compliant, as long as they follow the specification, but are
encouraged to.

## Purpose

The primary purpose of this specification is to define a universal interface
that allows developers to interact with SQL-based databases in a consistent
manner, regardless of the underlying database management system (DBMS). By
providing a standardized interface, this specification aims to:

- Simplify Development: Reduce the complexity for developers who need to
  interact with multiple SQL databases, enabling them to switch between
  different databases with minimal code changes.
- Enhance Interoperability: Foster greater compatibility between applications
  and database drivers, promoting a more seamless integration process.
- Improve Maintainability: Provide a clear and consistent framework that
  simplifies the maintenance and updating of database interaction code.

### Motivation

The motivation for this RFC comes from creating applications and scripts using
the database drivers available. Comparing the signatures of the different
database drivers, we see that they vary greatly and have little to no coherent
usage. Thus the motivation is to create a coherent base interface (that can be
extended, see [here](#extending-the-interfaces)) that can be implemented across
database drivers.

Below there is a comparison of how to execute a query in the different drivers
taken from the respective readmes.

**Node: mysql** ([link](https://github.com/mysqljs/mysql))

```ts ignore
var mysql = require("mysql");

var connection = mysql.createConnection({
  host: "localhost",
  user: "me",
  password: "secret",
  database: "my_db",
});
connection.connect();
connection.query("SELECT 1 + 1 AS solution", function (error, results, fields) {
  if (error) throw error;
  console.log("The solution is: ", results[0].solution);
});
connection.end();
```

**Node: mysql2** ([link](https://github.com/sidorares/node-mysql2))

```ts ignore
import mysql from "mysql2/promise";

const connection = await mysql.createConnection({
  host: "localhost",
  user: "root",
  database: "test",
});
const [results, fields] = await connection.query("SELECT 1 + 1 AS solution");
console.log(results[0]);
connection.end();
```

**Node: sqlite3** ([link](https://github.com/TryGhost/node-sqlite3))

```ts ignore
const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database(":memory:");

db.serialize(() => {
  db.get("SELECT 1 + 1 AS solution", (err, row) => {
    console.log(row);
  });
});

db.close();
```

**Node: better-sqlite3** ([link](https://github.com/WiseLibs/better-sqlite3))

```ts ignore
import Database from "better-sqlite3";
const db = new Database("foobar.db", options);

const row = db.prepare("SELECT 1 + 1 AS solution").get(userId);
console.log(row.solution);
```

**Node: pg** ([link](https://github.com/brianc/node-postgres))

```ts ignore
import pg from "pg";
const { Client } = pg;
const client = new Client();
await client.connect();

const res = await client.query("SELECT 1 + 1 AS solution");
console.log(res.rows[0].solution);
await client.end();
```

**Node: postgres** ([link](https://github.com/porsager/postgres))

```ts ignore
import postgres from "postgres";

const sql = postgres({
  /* options */
});
const res = await sql`SELECT 1 + 1 AS solution`;
console.log(res[0].solution);
```

**Deno: mysql** ([link](https://github.com/denodrivers/mysql/))

```ts ignore
import { Client } from "https://deno.land/x/mysql/mod.ts";
const client = await new Client().connect({
  hostname: "127.0.0.1",
  username: "root",
  db: "dbname",
  password: "password",
});
const res = await client.query(`SELECT 1 + 1 AS solution`);
console.log(res.rows[0].solution);
```

**Deno: sqlite** ([link](https://github.com/denodrivers/sqlite3))

```ts ignore
import { Database } from "jsr:@db/sqlite@0.11";

const db = new Database("test.db");

const [solution] = db.prepare("SELECT 1 + 1 AS solution").value<[string]>()!;
console.log(solution);
db.close();
```

**Deno: postgres** ([link](https://github.com/denodrivers/postgres))

```ts ignore
import { Client } from "https://deno.land/x/postgres/mod.ts";
const client = new Client({
  user: "user",
  database: "test",
  hostname: "localhost",
  port: 5432,
});
await client.connect();
const result = await client.queryObject`SELECT 1 + 1 AS solution`;
console.log(result.rows[0].solution);
await client.end();
```

## Scope

This specification covers the essential components and functionalities required
for interacting with SQL-based databases through a standardized interface. It
includes, but is not limited to:

- Connection management
- Connection pooling
- Query execution and streaming results
- Transaction handling, including nested transactions
- Prepared statements, parameterized queries and SQL templates
- Error handling and reporting
- The SQL dialect information needed by tools

> Other functionalities such as subscriptions would be out of scope for the
> first version, but would be considered for upcoming spec releases.

## Goals and Non-Goals

- Define a minimal interface for database drivers, small enough for every
  database and JavaScript runtime to implement, such as on top of `node:sqlite`
  and `bun:sqlite`.
- Define a user facing interface for applications and tools, such as migration
  tools and query builders, that is implemented once on top of any driver, so
  that its behavior is the same for every database.
- Ensure that the interfaces are flexible enough to support both basic and
  advanced SQL database functionalities, and that they can be extended for
  functionality that is not included in the specs.
- Promote the adoption of the standardized interface within the developer
  community, across database vendors and JavaScript runtimes.
- This specification does not aim to replace existing database drivers but
  rather to provide a layer of standardization that can be implemented by them.
- It does not cover non-SQL databases or seek to address database-specific
  optimizations and extensions that fall outside the scope of standard SQL
  operations. This should be handled by the respective drivers.

## Audience

This RFC is intended for:

- **Driver authors and JavaScript runtimes**, who implement the
  [driver level](#driver-level).
- **Tool authors**, such as of migration tools and query builders, who depend on
  the [client level](#client-level) capabilities they need.
- **Application developers**, who use a client.

## Design Principles

1. **Two levels, as in Go.** Like Go's `database/sql/driver` and `database/sql`,
   the specification has two levels:
   - The **driver level** is the minimal interface a database driver implements:
     connecting, and executing, querying, preparing and transactions on a single
     connection.
   - The **client level** is the user facing interface: pooling, nested
     transactions, SQL templates, lazy results, prepared statement caching,
     events and options. It is implemented once, generically on top of any
     driver, by the standard implementation in `@stdx/database/sql`. Drivers do
     not implement it, so its behavior is the same for every database.
2. **Async only.** All methods resolve to a `Promise`, except the client level
   `query`, which returns a lazy result whose consuming methods resolve to
   promises. Synchronous databases implement the driver level by wrapping their
   operations in resolved promises.
3. **Minimal driver level.** Every method of the driver level is a requirement
   for every database and runtime, so it only contains what can not be built on
   top of it. Optional capabilities, such as native prepared statements, are
   detected at run time.
4. **The client level never generates SQL.** Everything that needs database
   specific SQL, such as beginning transactions, savepoints and pinging, is a
   driver method, as only the driver knows its database. The client level only
   runs the SQL of the user, and renders the placeholders of SQL templates with
   the driver's dialect.
5. **Small capabilities for tools.** Tools depend on small capability
   interfaces, such as `Queryable` (`execute`, `query`, `executeScript`), rather
   than on a client class, so that they work with any implementation.
6. **Explicit Resource Management.** Every object holding a resource
   (connection, transaction, prepared statement, result) is asynchronously
   disposable and works with `await using`. Disposing performs the safe cleanup
   action: close, release, rollback, deallocate or stop fetching respectively.
7. **Portable by templates and dialects, not by mappings.** The placeholder
   style and the mapping of values are database specific and are not
   standardized. Portable SQL is written as [SQL templates](#sql-templates),
   whose placeholders are rendered from the [dialect](#dialect) of the driver.

## Specification

The specification defines:

- [Common types](#common-types), used by both levels: parameters, execute
  results, SQL templates, options and errors
- The [driver level](#driver-level), implemented by drivers
- The [client level](#client-level), implemented by the standard implementation
  on top of any driver, and used by applications and tools

```
applications, migration tools, query builders
                    │  Client level: Client, Connection, Transaction,
                    │  PreparedStatement, ResultIterableContext
         SqlClient (standard implementation, @stdx/database/sql)
                    │  Driver level: Driver, DriverConnection, DriverRows,
                    │  DriverStatement, DriverTransaction, Dialect
    drivers: SQLite, Postgres, MySQL, ... (node:sqlite, bun:sqlite, ...)
```

### Common Types

#### Parameters

The parameters to bind to a SQL statement are passed as an ordered array or as a
record of named parameters, depending on the placeholder style supported by the
database. The recommended parameter types are:

```ts ignore
type ParameterType =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | ArrayBufferView
  | ArrayBuffer;

type QueryParameters = ParameterType[] | Record<string, ParameterType>;
```

Drivers must at minimum support `string`, and should support the full
recommended set, which are the types JavaScript runtimes bind natively. The
parameter type may be extended with database specific types, such as `Date`. A
driver that extends the parameter types exports them, and its preconfigured
client is typed with them, so that the extension reaches the whole client level:
the client, its connections, transactions and prepared statements.

The placeholder style (for example `?`, `$1` or `:name`) and the mapping of
values to and from database types are database specific, and are not
standardized. Drivers must document both.

#### Execute Result

```ts ignore
interface ExecuteResult {
  affectedRows: number | undefined;
  lastInsertId?: number | bigint | string;
}
```

- `affectedRows` is the number of rows inserted, updated or deleted by the
  statement. Statements that modify no rows, such as `SELECT` or `CREATE TABLE`,
  report `0`; it is `undefined` only if the database does not report the number.
- `lastInsertId` is the id of the last inserted row, when the database reports
  it, such as the SQLite `rowid` or the MySQL auto increment id. Databases
  without insert ids, such as Postgres, use `RETURNING` instead.

#### SQL Templates

Statements can be written as tagged templates with the `sql` tag. The tag
creates a `SqlTemplate`, which keeps the SQL text and the interpolated values
apart, independent of the placeholder style of the database:

```ts ignore
interface SqlTemplate {
  readonly strings: readonly string[];
  readonly values: readonly ParameterType[];
}

type Statement = string | SqlTemplate;

await client.query(sql`SELECT * FROM users WHERE id = ${id}`).toRecords();
```

- The client level `execute` and `query` accept a `SqlTemplate` in place of SQL
  text. It renders the placeholders with the [dialect](#dialect) of the driver,
  and binds the values as parameters. Values must never be inserted into the SQL
  text.
- A template carries its values, so passing parameters with a template must
  reject with a `QueryError`.
- `prepare` only accepts SQL text, as a prepared statement is executed with new
  values each time.
- The driver level only receives SQL text and parameters.
- Further template features, such as composing fragments, are left to
  extensions.

#### Options

```ts ignore
interface ConnectionOptions {
  connectTimeout?: number; // ms
  [key: string]: unknown; // driver specific
}

interface QueryOptions {
  signal?: AbortSignal;
  transformInput?: (value: unknown) => unknown;
  transformOutput?: (value: unknown) => unknown;
  statementCacheSize?: number; // default: 100
}

interface TransactionOptions {
  [key: string]: unknown; // driver specific, such as isolation levels
}

interface PoolOptions {
  lazyInitialization?: boolean; // default: false
  maxSize?: number; // default: 1
  acquireTimeout?: number; // ms
  idleTimeout?: number; // ms
  maxLifetime?: number; // ms
}

interface ClientOptions {
  connectionOptions?: ConnectionOptions;
  queryOptions?: QueryOptions;
  transactionOptions?: TransactionOptions;
  poolOptions?: PoolOptions;
}
```

- `connectionOptions` are passed to the driver when connecting. `connectTimeout`
  is the standard timeout for establishing a connection; other connection
  options are driver specific.
- `queryOptions` are merged into every query of the client level, with the
  method level options taking precedence. The driver level only receives the
  `signal`.
- When the `signal` is aborted, the query must stop as soon as the database
  allows, release the connection, and reject with the abort reason. Databases
  with a synchronous API can only stop before a statement runs and between rows,
  while databases with a cancel mechanism should cancel the running statement.
- `transformInput` and `transformOutput` transform every parameter and every
  result value, and are applied by the client level.
- `statementCacheSize` is the size of the
  [prepared statement cache](#prepared-statements) of each connection; `0`
  disables it.
- The pool options are described in [Pooling](#pooling).

#### Errors

All errors thrown by a compliant implementation of either level extend
`DatabaseError`:

| Error              | Thrown when                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `DatabaseError`    | Base class for all database errors                                                       |
| `ConnectionError`  | The connection could not be established, was closed, or is not alive                     |
| `QueryError`       | A query or statement could not be executed, or a deallocated prepared statement was used |
| `TransactionError` | A transaction operation failed, or an inactive transaction was used                      |

Drivers must reject with these classes, or database specific subclasses such as
`PostgresQueryError`, so that tools using the driver level directly get
consistent errors. The client level passes them through.

### Driver Level

The driver level is implemented by database drivers. It is intentionally
minimal: a driver connects, and runs statements on a single connection.

#### Driver

```ts ignore
interface Driver<IOptions extends ConnectionOptions = ConnectionOptions> {
  readonly dialect: Dialect;
  readonly maxConnections?: number;
  connect(
    url: string | URL,
    options?: IOptions & { signal?: AbortSignal },
  ): Promise<DriverConnection>;
}
```

- `connect` opens a connection. The `url` is interpreted according to the
  connection URI format of the database, such as the libpq connection URI for
  Postgres; drivers should support the parameters of that format where they
  apply, and document the ones they support. Options take precedence over
  parameters in the URL.
- When the `signal` aborts, for example because the `connectTimeout` passed,
  connecting must stop and reject with the abort reason.
- A failed connect rejects with a `ConnectionError`.
- `maxConnections` is the maximum number of connections the driver supports at
  the same time, such as `1` for SQLite, which has no connection pool. The
  client level caps its pool size at it.

#### Dialect

```ts ignore
interface Dialect {
  readonly name: string;
  placeholder(index: number): string;
  quoteIdentifier(name: string): string;
}
```

The dialect describes the SQL syntax of the database, which tools can not
discover otherwise:

- `name` identifies the dialect, such as `"sqlite"` or `"postgres"`, for tools
  that generate dialect specific SQL, such as `RETURNING` or `ON CONFLICT`.
- `placeholder` renders the placeholder of the parameter at the zero-based
  index, such as `?` in SQLite or `$1` in Postgres. The client level uses it to
  render SQL templates, and query builders to generate parameterized SQL.
- `quoteIdentifier` quotes and escapes an identifier, such as a table or column
  name, for example `"users"` in Postgres and SQLite, or `` `users` `` in MySQL.

#### DriverConnection

```ts ignore
interface DriverConnection extends AsyncDisposable {
  readonly closed: boolean;
  close(): Promise<void>;
  execute(
    sql: string,
    params?: QueryParameters,
    options?: { signal?: AbortSignal },
  ): Promise<ExecuteResult>;
  query(
    sql: string,
    params?: QueryParameters,
    options?: { signal?: AbortSignal },
  ): Promise<DriverRows>;
  executeScript(sql: string, options?: { signal?: AbortSignal }): Promise<void>;
  begin(options?: TransactionOptions): Promise<DriverTransaction>;
  ping(): Promise<void>;
  prepare?(sql: string): Promise<DriverStatement>;
}
```

- `closed` is `true` once the connection is closed, either by `close()` or
  because it was lost. Disposing the connection closes it; `close()` is
  idempotent. After closing, all methods reject with a `ConnectionError`.
- `execute` and `query` run exactly one statement. Running several statements in
  one call is not portable (most databases only allow it without parameters, if
  at all), so drivers may reject it, and must not silently ignore statements.
- `execute` resolves to an [execute result](#execute-result).
- `query` resolves to the [rows](#driverrows) once the statement runs, so that
  errors, such as invalid SQL, reject the promise.
- `executeScript` runs a script of one or more statements without parameters,
  such as a migration, and resolves when all have run. Databases without native
  support for running several statements must emulate it, as only the driver
  knows the syntax well enough to split a script.
- `begin` begins a transaction, with database specific options such as the
  isolation level, and resolves to a [transaction](#drivertransaction). The
  statements of the transaction run on the connection.
- `ping` checks that the connection is alive, and rejects with a
  `ConnectionError` if not.
- `prepare` is optional and creates a native
  [prepared statement](#driverstatement). Without it, the client level runs the
  SQL of a prepared statement each time.
- A connection runs one operation at a time, and is not used concurrently by the
  client level. While rows are being read, the connection is busy: drivers
  should not buffer the rest of the rows to run other operations, as they may
  not fit in memory, and may reject such operations with a `QueryError` instead.

#### DriverRows

```ts ignore
interface DriverRows extends AsyncIterable<unknown[]>, AsyncDisposable {
  readonly columns: string[];
}
```

- `columns` contains the column names of the result. They must be known when the
  rows resolve, also when there are no rows. Only when the database does not
  report the columns without rows may they be empty for an empty result, which
  the driver must document.
- Iterating yields the values of each row, in the order of the columns. The rows
  are streamed, and can be iterated once.
- Disposing the rows, or ending the iteration early, stops fetching and frees
  the connection.

#### DriverStatement

```ts ignore
interface DriverStatement extends AsyncDisposable {
  readonly sql: string;
  execute(
    params?: QueryParameters,
    options?: { signal?: AbortSignal },
  ): Promise<ExecuteResult>;
  query(
    params?: QueryParameters,
    options?: { signal?: AbortSignal },
  ): Promise<DriverRows>;
  deallocate(): Promise<void>;
}
```

- A native prepared statement of a connection, executed and queried as the
  connection methods, with new parameters each time.
- `deallocate` releases the statement in the database, and is idempotent.
  Disposing the statement deallocates it. Using a deallocated statement rejects
  with a `QueryError`.

#### DriverTransaction

```ts ignore
interface DriverTransaction extends AsyncDisposable {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  savepoint(name: string): Promise<DriverSavepoint>;
}

interface DriverSavepoint extends AsyncDisposable {
  release(): Promise<void>;
  rollback(): Promise<void>;
}
```

- `commit` and `rollback` end the transaction begun with `begin`. Calling either
  after the transaction ended rejects with a `TransactionError`. Disposing an
  active transaction rolls it back.
- `savepoint` creates a savepoint with the given name, which is a plain unquoted
  identifier, in the syntax of the database, such as `SAVEPOINT` in most
  databases or `SAVE TRANSACTION` in MSSQL.
- `release` releases the savepoint, keeping its changes, and `rollback` rolls
  back to it and releases it. Calling either after the savepoint ended, or after
  its transaction ended, rejects with a `TransactionError`. Disposing an active
  savepoint rolls back to it.
- The client level builds nested transactions on top of savepoints.

### Client Level

The client level is the user facing interface. The standard implementation in
`@stdx/database/sql` implements it on top of any driver:

```ts ignore
const client = new SqlClient(new SqliteDriver(), ":memory:", options);
```

Drivers export a preconfigured client with the standard signature, such as
`new SqliteClient(url, options)`, which binds the driver. Alternative
implementations of the client level are possible, and must pass the
[client conformance suite](#conformance).

#### Capability Interfaces

The client level is composed of small capability interfaces. Tools depend on the
capabilities they need, so that they work with any implementation:

| Interface         | Members                                              | Description                                                                      |
| ----------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Queryable`       | `execute()`, `query()`, `executeScript()`            | Runs statements, queries and scripts. Query builders and migration tools use it. |
| `Preparable`      | `prepare()`                                          | Creates prepared statements.                                                     |
| `Transactionable` | `beginTransaction()`, `transaction()`                | Creates transactions, nested as savepoints.                                      |
| `Pingable`        | `ping()`                                             | Checks that the connection is alive.                                             |
| `Connectable`     | `connectionUrl`, `connected`, `connect()`, `close()` | Connection lifecycle.                                                            |
| `Poolable`        | `acquire()`                                          | Acquires a connection from the pool.                                             |
| `Eventable`       | `eventTarget`                                        | Dispatches events.                                                               |
| `Dialectable`     | `dialect`                                            | Exposes the [dialect](#dialect) of the driver, for query builders.               |

#### Queryable

```ts ignore
interface Queryable {
  execute(
    sql: Statement,
    params?: QueryParameters,
    options?: QueryOptions,
  ): Promise<ExecuteResult>;
  query<R = Record<string, unknown>>(
    sql: Statement,
    params?: QueryParameters,
    options?: QueryOptions,
  ): ResultIterableContext<unknown[], R>;
  executeScript(sql: string, options?: QueryOptions): Promise<void>;
}
```

- `execute` and `query` accept SQL text or a [SQL template](#sql-templates), and
  run exactly one statement.
- `query` returns a lazy [result](#result-context). Its `R` type parameter
  determines the record type of the result, given at the call site, such as
  `query<User>(...)`: the records are of the given type, without validating the
  values against it.
- `executeScript` runs a script without parameters.

#### Result Context

```ts ignore
interface ResultObject<V = unknown[], R = Record<string, unknown>> {
  values: V;
  toRecord: () => R;
}

interface ResultIterableContext<
  V extends unknown[] = unknown[],
  R = Record<string, V[number]>,
> extends AsyncIterable<ResultObject<V, R>>, AsyncDisposable {
  columns(): Promise<string[]>;
  toValues(): Promise<V[]>;
  toRecords(): Promise<R[]>;
  firstValues(): Promise<V | undefined>;
  firstRecord(): Promise<R | undefined>;
}
```

- The result is lazy: `query` returns it synchronously, and the query runs when
  the result is first consumed, or when its columns are requested. Errors, such
  as invalid SQL or a lost connection, are thrown by the consuming methods.
- `columns()` resolves to the column names, without consuming the rows.
- Iterating streams the rows, and `toValues` and `toRecords` collect them.
- `firstValues()` and `firstRecord()` resolve to the first row as values or as a
  record respectively, or `undefined` when there are no rows, and consume the
  result: the remaining rows are not read.
- The rows are not kept in memory, so a result can be consumed once: either
  iterated or collected. Consuming it again rejects with a `QueryError`. This
  keeps the memory use of streaming a massive result constant.
- A started result holds its connection until all rows are read or the result is
  disposed, so a started result that is not needed must be read or disposed.
- Disposing stops fetching and releases the connection. Disposing a result that
  was never started does not run the query.
- The result is deliberately not awaitable (it has no `then` method), as
  thenables are unwrapped implicitly by `await` and by async functions that
  return them.

#### Prepared Statements

```ts ignore
interface Preparable {
  prepare(sql: string, options?: QueryOptions): Promise<PreparedStatement>;
}

interface PreparedStatement extends AsyncDisposable {
  readonly sql: string;
  readonly deallocated: boolean;
  deallocate(): Promise<void>;
  execute(params?, options?): Promise<ExecuteResult>;
  query<R = Record<string, unknown>>(
    params?,
    options?,
  ): ResultIterableContext<unknown[], R>;
}
```

- `prepare` creates a prepared statement on a connection. It uses the native
  prepared statement of the driver when available, and otherwise runs the SQL
  each time.
- `deallocate` is idempotent, and disposing deallocates. Using a deallocated
  statement rejects with a `QueryError`.
- In addition, `execute` and `query` transparently cache native prepared
  statements per connection, keyed by their SQL text, in an LRU cache of
  `statementCacheSize` statements (default `100`, `0` disables it), so that
  repeated statements, including SQL templates, are only prepared once.

#### Transactions

```ts ignore
interface Transactionable {
  beginTransaction(options?: TransactionOptions): Promise<Transaction>;
  transaction<T>(
    fn: (tx: Transaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
}

interface Transaction
  extends AsyncDisposable, Queryable, Preparable, Transactionable {
  readonly inTransaction: boolean;
  commit(options?: TransactionOptions): Promise<void>;
  rollback(options?: TransactionOptions): Promise<void>;
  createSavepoint(name?: string, options?: TransactionOptions): Promise<void>;
  releaseSavepoint(name?: string, options?: TransactionOptions): Promise<void>;
}
```

- `transaction` begins a transaction, runs the callback, and commits on success.
  If the callback throws, the transaction is rolled back and the error is
  rethrown.
- Using a committed, rolled back or otherwise inactive transaction rejects with
  a `TransactionError`. Disposing an active transaction rolls it back.
- Calling `beginTransaction()` or `transaction()` on an active transaction
  creates a savepoint instead of a new transaction. Committing the nested
  transaction releases the savepoint, and rolling it back rolls back to it; the
  enclosing transaction stays active.
- Ending a transaction, or rolling back to a savepoint, invalidates the nested
  transactions created after it.
- Nested transactions and named savepoints are created with the driver's
  savepoints. Generated savepoint names are plain unquoted identifiers, such as
  `sp_1`, and names given to `createSavepoint` must be plain identifiers too.
- When the connection of an active transaction is lost, the database rolled the
  transaction back, so the transaction is ended and its operations reject with a
  `ConnectionError`, instead of running on a new connection.
- Nesting only applies on the same connection. Calling `Client.transaction()`
  inside a transaction acquires a separate connection; with a pool size of `1`,
  this waits for the transaction to end, which an `acquireTimeout` turns into an
  error.

#### Client

```ts ignore
interface Client
  extends
    Connectable,
    Pingable,
    Queryable,
    Preparable,
    Transactionable,
    Poolable,
    Eventable,
    Dialectable,
    AsyncDisposable {
  readonly options: ClientOptions;
}

class SqlClient<IDriver extends Driver = Driver> implements Client {
  constructor(driver: IDriver, url: string | URL, options?: ClientOptions);
  readonly driver: IDriver;
}
```

- The client manages a [pool](#pooling) of driver connections. Its query methods
  acquire a connection for the duration of the operation, and release it after;
  a `query` result holds its connection until it is read or disposed, and
  transactions and prepared statements hold theirs until they end.
- The connection is opened implicitly by the first operation. Calling
  `connect()` is optional, and connects eagerly, for example to report
  connection errors early. Concurrent connects share one attempt.
- Closing is explicit: once `close()` is called, operations reject with a
  `ConnectionError` until `connect()` is called again. Disposing the client
  closes it.

#### Connection

```ts ignore
interface Poolable {
  acquire(): Promise<Connection>;
}

interface Connection
  extends
    Pingable,
    Queryable,
    Preparable,
    Transactionable,
    Dialectable,
    AsyncDisposable {
  readonly connected: boolean;
  readonly released: boolean;
  readonly driverConnection: DriverConnection;
  release(): Promise<void>;
  remove(): Promise<void>;
}
```

- A connection acquired from the pool, held until it is released. Disposing it
  releases it.
- `release()` returns it to the pool, rolling back a transaction left open.
  `remove()` closes it instead, for a broken connection. Both are idempotent.
- `driverConnection` gives access to the driver level connection for driver
  specific features, such as Postgres `LISTEN`, while the connection is
  acquired. Using the connection after it is released rejects with a
  `ConnectionError`.
- Operations on a connection run one at a time. An operation started while a
  result of the connection is being read rejects with a `QueryError`, as the
  rest of the result is not buffered.

#### Pooling

- `maxSize` is the maximum number of connections, `1` by default, which makes
  the client behave like a single connection. It is capped at the
  `maxConnections` of the driver, and the options reflect the actual size.
- `lazyInitialization`: when enabled, connections are only opened when acquired
  and no idle connection is available. Otherwise, connecting opens `maxSize`
  connections up front.
- `acquire()` waits when the pool is exhausted, until a connection is released
  or removed. `acquireTimeout` limits the wait, after which `acquire()` rejects
  with a `ConnectionError`; it also turns leaked results into errors.
- `idleTimeout` closes connections that have been idle for that long; new
  connections are opened when needed again.
- `maxLifetime` closes connections that reached that age, instead of reusing
  them, once they are no longer in use.
- Closing the client closes all connections and rejects pending acquires.

#### Events

The client dispatches events on its `eventTarget`. Driver connections do not
dispatch events.

| Event     | Dispatched when                                |
| --------- | ---------------------------------------------- |
| `connect` | A connection of the pool is established        |
| `close`   | A connection of the pool is about to be closed |
| `error`   | An error is thrown by an operation             |
| `acquire` | A connection is acquired from the pool         |
| `release` | A connection is released back to the pool      |

All events carry a detail with a `client` property containing the client.
`error` events additionally carry the `error`.

### Extending the Interfaces

The interfaces are meant to be extended with database specific methods, which
follow
[Deno's Style Guide for methods](https://docs.deno.com/runtime/contributing/style_guide/#exported-functions%3A-max-2-args%2C-put-the-rest-into-an-options-object):

> 1. A function takes 0-2 required arguments, plus (if necessary) an options
>    object (so max 3 total).
> 2. Optional parameters should generally go into the options object.
> 3. The 'options' argument is the only argument that is a `Record` type
>    `Object`.

Driver specific features are exposed on the driver connection, and on
preconfigured client subclasses. Extension examples: SQL template fragments,
`queryOne` convenience wrappers, subscriptions, and database specific features
such as SQLite backups or Postgres `LISTEN`/`NOTIFY`.

## Implementation

### Drivers

A driver implements the [driver level](#driver-level): a `Driver` with a
`Dialect`, and its `DriverConnection`, `DriverRows`, `DriverStatement` and
`DriverTransaction`. It should export a preconfigured client:

```ts ignore
export class SqliteDriver implements Driver {/* ... */}

export class SqliteClient extends SqlClient<SqliteDriver> {
  constructor(url: string | URL, options?: ClientOptions) {
    super(new SqliteDriver(), url, options);
  }
}
```

The driver level maps closely onto the database APIs of the JavaScript runtimes:

| Driver level                  | `node:sqlite`                 | `bun:sqlite`                 |
| ----------------------------- | ----------------------------- | ---------------------------- |
| `Driver.connect`              | `new DatabaseSync(path)`      | `new Database(path)`         |
| `DriverConnection.execute`    | `prepare(sql).run()`          | `prepare(sql).run()`         |
| `DriverConnection.query`      | `prepare(sql).iterate()`      | `prepare(sql).iterate()`     |
| `DriverRows.columns`          | `columns()`                   | `columnNames`                |
| `executeScript`               | `exec(sql)`                   | `run(sql)`                   |
| `begin`, `commit`, `rollback` | `exec("BEGIN")`, ...          | `run("BEGIN")`, ...          |
| `savepoint`                   | `exec("SAVEPOINT sp_1")`, ... | `run("SAVEPOINT sp_1")`, ... |
| `ping`                        | `prepare("SELECT 1").get()`   | `query("SELECT 1").get()`    |
| `prepare`                     | `prepare(sql)`                | `prepare(sql)`               |
| `close`                       | `close()`                     | `close()`                    |

### Conformance

The `@stdx/database/sql/testing` entrypoint contains two conformance suites:

- `testDriver(t, driver, url, sql)` tests the driver level, so that a library
  that only implements a driver can verify it.
- `testClient(t, createClient, sql)` tests the client level, with a factory
  creating a client, such as `() => new SqlClient(driver, url)`, so that the
  standard implementation over a driver, and alternative implementations, can be
  verified.

A driver that passes the driver suite, and whose client passes the client suite,
is compliant with this specification.

## Examples

Query (the connection is opened by the first operation):

```ts ignore
await using client = new SqliteClient(":memory:");

await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");

const result = client.query("SELECT id, name FROM users");
console.log(await result.columns());
// ["id", "name"]
console.log(await result.toRecords());
// [{ id: 1, name: "Alice" }]
```

Streaming a large result, with constant memory use:

```ts ignore
for await (const row of client.query("SELECT * FROM events")) {
  console.log(row.toRecord());
}
```

SQL templates, with placeholders rendered by the driver's dialect:

```ts ignore
const { affectedRows, lastInsertId } = await client.execute(
  sql`INSERT INTO users (name) VALUES (${name})`,
);
```

A query builder or migration tool depending on capabilities only:

```ts ignore
async function migrate(db: Queryable & Transactionable, scripts: string[]) {
  await db.transaction(async (tx) => {
    for (const script of scripts) await tx.executeScript(script);
  });
}
```

Prepared statement, with the placeholder style of the database:

```ts ignore
await using stmt = await client.prepare("SELECT * FROM users WHERE id = ?");
console.log(await stmt.query([1]).toRecords());
```

Transactions:

```ts ignore
const users = await client.transaction(async (tx) => {
  await tx.execute("INSERT INTO users (name) VALUES ('Alice')");
  return await tx.query("SELECT * FROM users").toRecords();
});
```

A held connection, with access to the driver connection:

```ts ignore
await using connection = await client.acquire();
await connection.execute("INSERT INTO users (name) VALUES ('Bob')");
const native = connection.driverConnection;
// released back to the pool at the end of the scope
```

Using the driver level directly:

```ts ignore
const driver = new SqliteDriver();
await using connection = await driver.connect(":memory:");
await connection.execute("CREATE TABLE users (id INTEGER, name TEXT)");
await using rows = await connection.query("SELECT * FROM users");
for await (const values of rows) console.log(values);
```

## Acknowledgment

Thanks to [kt3k](https://github.com/kt3k) and
[iuioiua](https://github.com/iuioiua) from the Deno team for support
