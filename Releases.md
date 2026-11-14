### 2026.10.07

#### @stdx/cli 0.1.2 (patch)

- feat(cli): added global flags, examples and shared type helpers
- docs(cli): documented Node.js compatibility

#### @stdx/collections 0.2.0 (minor)

- docs(collections): updated README

#### @stdx/database 0.2.0 (minor)

- docs(database): updated README

#### @stdx/event 0.1.3 (patch)

- docs(event): updated README

#### @stdx/ffi 0.1.2 (patch)

- docs(ffi): documented Node.js compatibility with dlopen shim example

#### @stdx/fs 0.1.2 (patch)

- docs(fs): documented Node.js compatibility

#### @stdx/validation 0.1.4 (patch)

- docs(validation): updated README

#### @stdx/zip 0.1.2 (patch)

- docs(zip): documented Node.js compatibility

### 2026.10.04a

#### @stdx/assert 0.1.2 (patch)

- docs(assert): added package description
- docs(assert): added missing JSDoc

#### @stdx/cli 0.1.1 (patch)

- docs(cli): added package description
- docs(cli): added missing JSDoc

#### @stdx/collections 0.1.1 (patch)

- docs(collections): added package description
- docs(collections): added missing JSDoc

#### @stdx/crypto 0.2.1 (patch)

- docs(crypto): added package description
- docs(crypto): added missing JSDoc

#### @stdx/database 0.1.1 (patch)

- docs(database): added package description
- docs(database): added missing JSDoc

#### @stdx/encoding 0.1.2 (patch)

- docs(encoding): added package description
- docs(encoding): added missing JSDoc

#### @stdx/event 0.1.2 (patch)

- docs(event): added package description
- docs(event): added missing JSDoc

#### @stdx/ffi 0.1.1 (patch)

- docs(ffi): added package description
- docs(ffi): added missing JSDoc

#### @stdx/fs 0.1.1 (patch)

- docs(fs): added package description
- docs(fs): added missing JSDoc

#### @stdx/http 0.1.1 (patch)

- docs(http): added package description
- docs(http): added missing JSDoc

#### @stdx/json 0.1.2 (patch)

- docs(json): added package description
- docs(json): added missing JSDoc

#### @stdx/lexer 0.1.1 (patch)

- docs(lexer): added package description
- docs(lexer): added missing JSDoc

#### @stdx/types 0.1.2 (patch)

- docs(types): added package description
- docs(types): added missing JSDoc

#### @stdx/validation 0.1.3 (patch)

- docs(validation): added package description

#### @stdx/xml 0.1.3 (patch)

- docs(xml): added package description

#### @stdx/zip 0.1.1 (patch)

- docs(zip): added package description
- docs(zip): added missing JSDoc

### 2026.10.04

#### @stdx/assert 0.1.1

- First release under the `@stdx` scope, previously published as
  `@stdext/assert`.

#### @stdx/cli 0.1.0

- First release under the `@stdx` scope, previously published as `@stdext/cli`.

#### @stdx/collections 0.1.0

- First release under the `@stdx` scope, previously published as
  `@stdext/collections`.

#### @stdx/crypto 0.2.0

- First release under the `@stdx` scope, previously published as
  `@stdext/crypto`.

#### @stdx/database 0.1.0

- First release under the `@stdx` scope, previously published as
  `@stdext/database`.

#### @stdx/encoding 0.1.1

- First release under the `@stdx` scope, previously published as
  `@stdext/encoding`.

#### @stdx/event 0.1.1

- First release under the `@stdx` scope, previously published as
  `@stdext/event`.

#### @stdx/ffi 0.1.0

- First release under the `@stdx` scope, previously published as `@stdext/ffi`.

#### @stdx/fs 0.1.0

- First release under the `@stdx` scope, previously published as `@stdext/fs`.

#### @stdx/http 0.1.0

- First release under the `@stdx` scope, previously published as `@stdext/http`.

#### @stdx/json 0.1.1

- First release under the `@stdx` scope, previously published as `@stdext/json`.

#### @stdx/lexer 0.1.0

- First release under the `@stdx` scope, previously published as
  `@stdext/lexer`.

#### @stdx/types 0.1.1

- First release under the `@stdx` scope, previously published as
  `@stdext/types`.

#### @stdx/validation 0.1.2

- First release under the `@stdx` scope, previously published as
  `@stdext/validation`.

#### @stdx/xml 0.1.2

- First release under the `@stdx` scope, previously published as `@stdext/xml`.

#### @stdx/zip 0.1.0

- First release under the `@stdx` scope, previously published as `@stdext/zip`.

### Releases under the `@stdext` scope

The packages were published under the `@stdext` scope until 2026.10.04. The
sections below list those releases.

### 2026.10.04

#### @stdext/assert 0.1.1 (patch)

- fix(assert): Added message as option argument to asserts, and added object
  asserts

#### @stdext/cli 0.1.2 (patch)

- feat(cli): added further options to command
- feat(cli): added command
- feat(cli): Added cli module with parseArgs

#### @stdext/collections 0.3.0 (minor)

- feat(collections)!: fix DeferredStack release, add clear and abortable pop
- feat(collections): add deferred stack
- fix(collections): added release and remove callbacks

#### @stdext/crypto 0.2.0 (minor)

- feat(crypto)!: add HMAC and SCRAM, align module interfaces
- fix(crypto): password verification
- fix(crypto): Fixed errors due to changes in deno types
- chore(crypto): change ts-ignore to ts-expect-error

#### @stdext/database 0.3.0 (minor)

- feat(database): added docs and examples
- feat(database)!: refactored code
- feat(database)!: refactored spec
- feat(database)!: align the Postgres driver with the spec
- feat(database)!: align the SQLite driver with the spec
- feat(database)!: align the SQL spec and core with runtime APIs
- feat(database): add Postgres driver
- feat(database)!: add core driver classes, extend conformance suite, rewrite
  SQLite driver
- fix(database): implemented validation
- docs(database): document the drivers and the runtime aligned API
- docs(database): adjusted RFC according to discussion
- docs(database): Moved the RFC
- chore(database): removed postgres driver and cleaned up tests

#### @stdext/encoding 0.1.1 (patch)

- feat(encoding): add binary reader and writer

#### @stdext/event 0.1.3 (patch)

- feat(event): added docs and tests

#### @stdext/ffi 0.1.2 (patch)

- feat(ffi): added docs and tests

#### @stdext/fs 0.1.2 (patch)

- feat(fs): added docs and tests

#### @stdext/json 0.1.1 (patch)

- feat(json): Added JSON Schema
- fix(json): Added exports and format types
- chore(json): fix lint

#### @stdext/types 0.1.1 (patch)

- feat(types): added new constructor type helper and added examples to existing
  type helpers
- feat(types): added type and improved documentation

#### @stdext/validation 0.1.4 (patch)

- feat(validation): added more helpers
- feat(validation): refactor validation
- feat(validation): added fluent validation api
- feat(validation): Added tests and jsdoc - thanks AI
- feat(validation): Implemented a basic validator implementing StandardSchemaV1,
  StandardJSONSchemaV1 and JSONSchema
- feat(validation): added validation namespace, and standard compliant validator
- fix(validation): Improved docs and tests
- chore(validation): Added jsdoc and improved readme - thanks AI

#### @stdext/zip 0.1.2 (patch)

- feat(zip): add zip and unzip for archives and directories
- fix(zip): replace with std

### 2026.10.03

#### @stdext/assert 0.1.1 (patch)

- fix(assert): Added message as option argument to asserts, and added object
  asserts

#### @stdext/collections 0.0.5 (patch)

- feat(collections)!: fix DeferredStack release, add clear and abortable pop
- feat(collections): add deferred stack
- fix(collections): added release and remove callbacks

#### @stdext/crypto 0.1.1 (patch)

- feat(crypto)!: add HMAC and SCRAM, align module interfaces
- fix(crypto): password verification
- fix(crypto): Fixed errors due to changes in deno types
- chore(crypto): change ts-ignore to ts-expect-error

#### @stdext/database 0.0.1 (patch)

- feat(database): added docs and examples
- feat(database)!: refactored code
- feat(database)!: refactored spec
- feat(database)!: align the Postgres driver with the spec
- feat(database)!: align the SQLite driver with the spec
- feat(database)!: align the SQL spec and core with runtime APIs
- feat(database): add Postgres driver
- feat(database)!: add core driver classes, extend conformance suite, rewrite
  SQLite driver
- docs(database): document the drivers and the runtime aligned API
- docs(database): adjusted RFC according to discussion
- docs(database): Moved the RFC
- chore(database): removed postgres driver and cleaned up tests

#### @stdext/encoding 0.1.1 (patch)

- feat(encoding): add binary reader and writer

#### @stdext/event 0.1.0 (minor)

- feat(event): added docs and tests

#### @stdext/ffi 0.0.1 (patch)

- feat(ffi): added docs and tests

#### @stdext/fs 0.0.1 (patch)

- feat(fs): added docs and tests

#### @stdext/json 0.1.1 (patch)

- feat(json): Added JSON Schema
- fix(json): Added exports and format types
- chore(json): fix lint

#### @stdext/types 0.1.1 (patch)

- feat(types): added new constructor type helper and added examples to existing
  type helpers
- feat(types): added type and improved documentation

#### @stdext/validation 0.1.0 (minor)

- feat(validation): Added tests and jsdoc - thanks AI
- feat(validation): Implemented a basic validator implementing StandardSchemaV1,
  StandardJSONSchemaV1 and JSONSchema
- feat(validation): added validation namespace, and standard compliant validator
- chore(validation): Added jsdoc and improved readme - thanks AI

### 2026.10.02

#### @stdext/crypto 0.1.1 (patch)

- fix(crypto): password verification
- fix(crypto): Fixed errors due to changes in deno types

#### @stdext/json 0.1.1 (patch)

- feat(json): Added JSON Schema
- fix(json): Added exports and format types
- chore(json): fix lint

#### @stdext/types 0.1.1 (patch)

- feat(types): added new constructor type helper and added examples to existing
  type helpers

#### @stdext/validation 0.1.0 (minor)

- feat(validation): Added tests and jsdoc - thanks AI
- feat(validation): Implemented a basic validator implementing StandardSchemaV1,
  StandardJSONSchemaV1 and JSONSchema
- feat(validation): added validation namespace, and standard compliant validator
- chore(validation): Added jsdoc and improved readme - thanks AI

### 2026.08.14

#### @stdext/crypto 0.1.1 (patch)

- fix(crypto): Fixed errors due to changes in deno types

#### @stdext/json 0.1.1 (patch)

- feat(json): Added JSON Schema
- fix(json): Added exports and format types
- chore(json): fix lint

#### @stdext/types 0.1.1 (patch)

- feat(types): added new constructor type helper and added examples to existing
  type helpers

#### @stdext/validation 0.1.0 (minor)

- feat(validation): Added tests and jsdoc - thanks AI
- feat(validation): Implemented a basic validator implementing StandardSchemaV1,
  StandardJSONSchemaV1 and JSONSchema
- feat(validation): added validation namespace, and standard compliant validator
- chore(validation): Added jsdoc and improved readme - thanks AI

### 2024.12.29a

#### @stdext/assert 0.1.0 (minor)

- BREAKING(*): bump all versions to minor 1.0

#### @stdext/crypto 0.1.0 (minor)

- BREAKING(*): bump all versions to minor 1.0

#### @stdext/encoding 0.1.0 (minor)

- BREAKING(*): bump all versions to minor 1.0

#### @stdext/http 0.1.0 (minor)

- BREAKING(*): bump all versions to minor 1.0

#### @stdext/json 0.1.0 (minor)

- BREAKING(*): bump all versions to minor 1.0

#### @stdext/lexer 0.1.0 (minor)

- BREAKING(*): bump all versions to minor 1.0

#### @stdext/types 0.1.0 (minor)

- BREAKING(*): bump all versions to minor 1.0

### 2024.12.29

#### @stdext/crypto 0.0.7 (patch)

- fix(crypto): Improved throw messages

### 2024.10.15

#### @stdext/assert 0.0.2 (patch)

- feat(assert): updated readme

#### @stdext/crypto 0.0.6 (patch)

- feat(crypto): updated readme

#### @stdext/encoding 0.0.6 (patch)

- feat(encoding): updated readme

#### @stdext/http 0.0.6 (patch)

- feat(http): updated readme

#### @stdext/json 0.0.2 (patch)

- feat(json): updated readme

#### @stdext/lexer 0.0.2 (patch)

- feat(lexer): updated readme

#### @stdext/types 0.0.2 (patch)

- feat(types): updated readme

### 2024.10.15

#### @stdext/collections 0.0.5 (patch)

- feat(collections): add deferred stack
- fix(collections): added release and remove callbacks

### 2024.05.06

#### @stdext/crypto 0.0.5 (patch)

- refactor(crypto/hash): crypto hash to allign with the signature of WebCrypto
- feat(crypto/hash): added scrypt hashing algorithm

### 2024.04.29

#### @stdext/crypto 0.0.3 (patch)

- feat(crypto): added package
- feat(crypto/hash): added argon2 hash
- feat(crypto/hash): added bcrypt hash

#### @stdext/http 0.0.3 (patch)

- feat(http): added package
- feat(http/header): added IANA HTTP headers
- feat(http/method): added IANA HTTP methods

### 2024.04.28

#### @stdext/encoding 0.0.2 (patch)

- chore(core): added documentation

### 2024.04.28

#### @stdext/encoding 0.0.1 (patch)

- feat(encoding): added package
- feat(encoding/hex): added hexdump
