# @stdx/database/sql

The SQL package contains a standard interface for SQL based databases.

Inspired by [rust sqlx](https://docs.rs/sqlx/latest/sqlx/index.html) and
[go sql](https://pkg.go.dev/database/sql). The full specification is available
in [RFC_SQL.md](../RFC_SQL.md).

The goal for this package is to have a standard interface for SQL-like database
clients that can be used in Deno, Node and other JS runtimes. Applications use a
driver with its preconfigured client, such as
[`@stdx/database/drivers/sqlite`](../README.md); this entrypoint is meant for
driver authors and for applications that wire up a driver with the standard
client themselves.

## Design

The specification has two levels, as in Go's `database/sql/driver` and
`database/sql`; see [the specification](../RFC_SQL.md#specification) for the
details:

- **Driver level**: the minimal interface a database driver implements:
  connecting, and executing, querying, preparing and transactions on a single
  connection. Its types are `Driver` and `DriverConnection`, with their
  `DriverRows`, `DriverStatement` and `DriverTransaction`, and the `Dialect`
  (see [core.ts](./core.ts))
- **Client level**: the user facing interface: pooling, nested transactions, SQL
  templates, lazy results, prepared statement caching, events and options. It is
  implemented once, generically on top of any driver, by the standard
  `SqlClient` ([client.ts](./client.ts)), so that its behavior is the same for
  every database. Drivers do not implement it, but export a preconfigured client
  bound to their driver, such as `SqliteClient`

The client level is composed of small capability interfaces, such as
`Connectable`, `Queryable`, `Preparable`, `Transactionable`, `Poolable`,
`Eventable` and `Dialectable`, so that tools can depend only on the capabilities
they need (see [core.ts](./core.ts)).

Key properties of the design:

- All methods are async, except the client level `query`, which returns a lazy
  result whose consuming methods resolve to promises
- Pooling is implicit: a `Client` always manages a connection pool, tuned with
  the `poolOptions` in its constructor options. It defaults to a single
  connection (`maxSize` of `1`) and becomes a connection pool when `maxSize` is
  raised
- The query surface is minimal: `execute` for statements and `query` for queries
  returning a lazy `ResultIterableContext`
- Everything holding a resource (the `Client`, a `Connection` acquired from the
  pool, a `Transaction`, a `PreparedStatement`, and the query result context) is
  `AsyncDisposable` and works with `await using`

## Usage

The examples use the SQLite driver, but every driver implementing the interfaces
is used the same way:

```ts
import { SqliteClient } from "@stdx/database/drivers/sqlite";

await using client = new SqliteClient(":memory:");
await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");
await client.execute("INSERT INTO users VALUES (1, 'Alice')");

console.log(await client.query("SELECT * FROM users").toRecords());
// [{ id: 1, name: "Alice" }]
```

The connection is opened by the first operation; calling `connect()` connects
eagerly, for example to report connection errors early. The connection is closed
by calling `close()`, or automatically at the end of the scope when using
[AsyncDispose](https://github.com/tc39/proposal-explicit-resource-management).

### Queries

The query methods are defined in [core.ts](./core.ts) (`Queryable`):

- `execute(sql, params?, options?)`: Executes a single SQL statement, and
  resolves to the `affectedRows` (rows inserted, updated or deleted, `0` for
  other statements) and the `lastInsertId`, if the database reports it
- `query(sql, params?, options?)`: Returns a lazy `ResultIterableContext` for a
  single SQL statement, which is both an async iterable of rows and provides
  `columns()`, `toValues()`, `toRecords()`, `firstValues()` and `firstRecord()`.
  The query runs when the result is consumed, and holds its connection until it
  is fully read or disposed. The record type of the result is given at the call
  site as a type parameter, and the driver's parameter types, which may extend
  the standard ones, are given by its client
- `executeScript(sql, options?)`: Executes a script of one or more statements
  without parameters, such as a migration

The placeholder style of the parameters (`?`, `$1`, `:name`, ...) and the
mapping of values depend on the driver.

```ts
import { sql } from "@stdx/database/sql";
import { SqliteClient } from "@stdx/database/drivers/sqlite";

interface User {
  id: number;
  name: string;
}

await using client = new SqliteClient(":memory:");
await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");

// Iterate lazily
for await (const row of client.query("SELECT * FROM users")) {
  console.log(row.toRecord());
}

// Or collect, with the record type given at the call site
console.log(await client.query<User>("SELECT * FROM users").toRecords());

// Or take the first row, which consumes the result
console.log(await client.query<User>("SELECT * FROM users").firstRecord());
// { id: 1, name: "Alice" }

// SQL templates render the placeholders of the database
const name = "Alice";
await client.execute(sql`INSERT INTO users VALUES (${1}, ${name})`);
```

The rows are streamed and not kept in memory, so a result can be consumed once:
iterated or collected. The result is `AsyncDisposable`: disposing stops fetching
and releases the underlying connection.

### Prepared statements

Prepared statements are created with `prepare` (`Preparable`):

```ts
import { SqliteClient } from "@stdx/database/drivers/sqlite";

await using client = new SqliteClient(":memory:");
await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");
await using stmt = await client.prepare("SELECT * FROM users WHERE id = ?");
console.log(await stmt.query([1]).toRecords());
// disposed (deallocated) at the end of the scope
```

### Transactions

Transactions are created with `beginTransaction` or the `transaction` wrapper
(`Transactionable`):

```ts
import { SqliteClient } from "@stdx/database/drivers/sqlite";

await using client = new SqliteClient(":memory:");
await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");
await using tx = await client.beginTransaction();
await tx.execute("INSERT INTO users VALUES (1, 'Alice')");
await tx.commit();
// if the scope ends without a commit, the transaction is rolled back
```

```ts
import { SqliteClient } from "@stdx/database/drivers/sqlite";

await using client = new SqliteClient(":memory:");
await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");
const result = await client.transaction(async (tx) => {
  await tx.execute("INSERT INTO users VALUES (1, 'Alice')");
  return await tx.query("SELECT * FROM users").toRecords();
});
```

Transactions can be nested: calling `beginTransaction` or `transaction` on an
active transaction creates a savepoint. Committing a nested transaction releases
the savepoint, and rolling it back rolls back to the savepoint, leaving the
enclosing transaction active. Nesting only applies on the same connection —
`client.transaction()` inside a transaction acquires a separate connection and
starts an independent transaction.

### Pooling

A `Client` always manages a pool of connections, tuned with `poolOptions`:

- `lazyInitialization` (default `false`): connections are only created when
  acquired and no idle connection is available
- `maxSize` (default `1`): the maximum amount of connections. With the default,
  the client behaves like a single connection; it becomes a connection pool when
  raised
- `acquireTimeout`: how long `acquire` waits for a connection, in milliseconds
- `idleTimeout`: how long a connection may be idle before it is closed, in
  milliseconds
- `maxLifetime`: the maximum age of a connection, in milliseconds

Query methods automatically acquire a connection and release it when the
operation completes. A `query` result acquires its connection when the query
runs, and holds it until the result is fully read or disposed.
`beginTransaction` and `prepare` hold a pooled connection until the transaction
is finished or the prepared statement is deallocated. A connection can also be
held manually:

```ts
import { SqliteClient } from "@stdx/database/drivers/sqlite";

await using client = new SqliteClient(":memory:");
await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");
await using connection = await client.acquire();
await connection.execute("INSERT INTO users VALUES (2, 'Bob')");
// released back to the pool at the end of the scope
```

### Events

The following events can be subscribed to (see [events.ts](./events.ts)):

- `connect`: dispatched when a connection is established
- `close`: dispatched when a connection is about to be closed
- `error`: dispatched when an error is triggered
- `acquire` / `release` (client only): dispatched when a connection is acquired
  from or released back to the pool

All events carry a `client` detail with the object that dispatched the event;
`error` events additionally carry the `error`.

## Implementation

> This section is for implementing the driver level for a database.

A driver implements the [driver level](../RFC_SQL.md#driver-level): a `Driver`
with a `Dialect`, and its `DriverConnection`, `DriverRows`, `DriverStatement`
and `DriverTransaction` (see [core.ts](./core.ts)). The client level does not
need to be implemented: the standard `SqlClient` works on top of any driver, and
a driver usually exports a preconfigured client bound to it:

```ts ignore
import type { ClientOptions } from "@stdx/database/sql";
import { SqlClient } from "@stdx/database/sql";

export class MyDriver implements Driver {
  /* connect, and run statements on a single connection */
}

export class MyClient extends SqlClient<MyDriver> {
  constructor(url: string | URL, options?: ClientOptions) {
    super(new MyDriver(), url, options);
  }
}
```

Helper utilities for driver authors are available in [utils.ts](./utils.ts) and
[template.ts](./template.ts):

- `createResultIterableContext(source)`: builds a lazy, single-pass
  `ResultIterableContext` from the columns and rows of a started query
- `renderStatement(statement, params, placeholder)`: renders SQL text or a
  `SqlTemplate` with the placeholders of the database
- `getObjectFromRow(row)`: maps a row to a record

### Testing

The `@stdx/database/sql/testing` entrypoint contains two conformance suites. A
driver that passes the driver suite, and whose client passes the client suite,
is compliant with the specification:

```ts ignore
import { testClient, testDriver } from "@stdx/database/sql/testing";

Deno.test("MyDriver conformance", async (t) => {
  await testDriver(t, new MyDriver(), url, sql);
});

Deno.test("MyClient conformance", async (t) => {
  await testClient(t, (options) => new MyClient(url, options), sql);
});
```

Both suites take the `TestSql` statements of the database dialect, such as a
query selecting a string parameter. `testDriver` tests the driver level against
a URL, so that a library that only implements a driver can verify it;
`testClient` tests the client level with a factory creating a client, so that
the standard implementation over a driver, and alternative implementations, can
be verified.

The suites also check parameter binding, SQL templates, value transforms,
aborting with an `AbortSignal`, error types, nested transactions, events and the
pooling behavior.
