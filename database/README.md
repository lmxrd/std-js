# @stdx/database

[![JSR](https://jsr.io/badges/@stdx/database)](https://jsr.io/@stdx/database)
[![JSR Score](https://jsr.io/badges/@stdx/database/score)](https://jsr.io/@stdx/database)
[![Weekly downloads](https://jsr.io/badges/@stdx/database/weekly-downloads)](https://jsr.io/@stdx/database)
[![Total downloads](https://jsr.io/badges/@stdx/database/total-downloads)](https://jsr.io/@stdx/database)

The database package contains a standard interface for SQL databases, and
drivers implementing it for SQLite. It draws inspiration from
[go std/database](https://pkg.go.dev/database).

Applications use one of the [drivers](#drivers), which all share the same
interface:

```ts
import { SqliteClient } from "@stdx/database/drivers/sqlite";

interface User {
  id: number;
  name: string;
}

await using client = new SqliteClient(":memory:");
await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");
await client.execute("INSERT INTO users VALUES (?, ?)", [1, "Alice"]);
// The record type of the result is given at the call site.
console.log(await client.query<User>("SELECT * FROM users").toRecords());
// [{ id: 1, name: "Alice" }]
// The first row, or undefined when there are no rows.
console.log(await client.query<User>("SELECT * FROM users").firstRecord());
// { id: 1, name: "Alice" }
```

## Entrypoints

### Root

`@stdx/database` re-exports the SQL interface and its standard implementation,
with the drivers and the conformance test suite as namespaces:

```ts
import { sql, SqlClient, sqlite, testing } from "@stdx/database";

await using client = new sqlite.SqliteClient(":memory:");
```

### Sql

The SQL entrypoint contains the standard interface for SQL databases, as
specified in [RFC_SQL.md](./RFC_SQL.md): the types, the standard client level
implementation (`SqlClient`), helper utilities for driver authors, and a
conformance test suite. It is meant for driver authors and alternative client
implementations; applications use a driver. See [database/sql](./sql/README.md)
for more details.

### Drivers

Drivers implementing the [database/sql](./sql/README.md) specification, which
has two levels: a minimal **driver level**, implemented by the drivers, and a
user facing **client level**, implemented once by the standard `SqlClient` on
top of any driver. Each driver exports its `Driver` and a preconfigured client
bound to it, such as `SqliteClient`, which behaves the same for every database.

A driver implements a `Dialect`, and connects and runs statements on a single
connection: `DriverConnection`, with its `DriverRows`, `DriverStatement` and
`DriverTransaction`. The client level adds pooling, nested transactions, SQL
templates, lazy results, prepared statement caching, events and options. Driver
authors verify their implementation with the conformance suites of
[`@stdx/database/sql/testing`](./sql/README.md#testing); no base classes are
required.

#### SQLite

`@stdx/database/drivers/sqlite`, backed by the built-in `node:sqlite` module.
The connection URL is a file path, a `file:` URL, or `:memory:`. Parameters use
`?` placeholders, or `:name`, `@name` and `$name` placeholders with a record.

- SQLite has no connection pool, so `SqliteClient` emulates it with a single
  connection: `maxSize` is always `1`, and acquiring waits for the connection.
  This keeps transactions isolated, and makes `:memory:` behave as one database.
- Connections wait up to 5 seconds for locks held by other connections to the
  same file (`connectionOptions.timeout`).
- Integers are returned as `number` (or `bigint` with
  `connectionOptions.readBigInts`), `BLOB`s as `Uint8Array`. Booleans are bound
  as `1`/`0`, and, as an extension, `Date`s as ISO 8601 strings. `execute`
  reports the `rowid` of inserted rows as `lastInsertId`.
- The parameters of the query methods are typed as `SqliteQueryParameters`,
  exported by the driver: the standard `QueryParameters`, extended with `Date`s,
  which are bound as ISO 8601 strings.

```ts
import { SqliteClient } from "@stdx/database/drivers/sqlite";

await using client = new SqliteClient(":memory:");
await client.execute("CREATE TABLE users (id INTEGER, name TEXT)");
await client.execute("INSERT INTO users VALUES (?, ?)", [1, "Alice"]);
console.log(await client.query("SELECT * FROM users").toRecords());
// [{ id: 1, name: "Alice" }]
```
