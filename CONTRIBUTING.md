# Contributing

Thank you for your interest in contributing to stdx. This document covers how to
propose changes, set up the repository, and the rules code in this repository
follows.

## Proposing a change

1. Open an [issue](https://github.com/halvardssm/std-js/issues) that describes
   the addition or change.
2. After getting feedback and approval, open a pull request that links to the
   issue.

Code that is copied from other places must be credited, and is only allowed if
its license allows it.

## Setup

The tools (Deno, and Rust with `rustfmt` and the `wasm32-unknown-unknown`
target) are managed with [mise](https://mise.jdx.dev). Install them with:

```sh
mise install
```

## Tasks

The tasks are defined in both [deno.json](./deno.json) and
[mise.toml](./mise.toml), so `deno task <name>` and `mise run <name>` do the
same thing. CI runs them through mise. When you change a task, change it in both
files.

```sh
deno task check             # format check (JS + Rust), lint and type-check
deno task test              # run the tests with coverage
deno task fix               # format (JS + Rust) and auto-fix lint rules
deno task build:wasm        # build the wasm crates into each package's _wasm/
deno task build:wasm:check  # verify the committed wasm matches the Rust sources
mise run check:pre-commit   # check, build:wasm:check, test and a publish dry run
```

`check` and `fix` also run `cargo fmt`, so they need the Rust toolchain.

Run `deno task check` and `deno task test` before opening a pull request.

## Repository layout

The repository is a Deno workspace of independently versioned packages,
published on JSR under the [`@stdx`](https://jsr.io/@stdx) scope. Each package
is a top-level directory listed in the `workspace` field of the root
`deno.json`:

```
<package>/
  deno.json   # name (@stdx/<package>), version, description, exports map
  README.md   # package docs
  mod.ts      # root module (only when the package has a "." export)
  *.test.ts   # colocated tests
  *.bench.ts  # optional benchmarks
  _wasm/      # generated wasm artifacts (committed)
```

`_tools` holds repository scripts and `_wasm` holds the Rust workspace.

## Code conventions

- Formatting and linting are done by `deno fmt` and `deno lint`, and Rust by
  `cargo fmt`. Do not format by hand; run `deno task fix`.
- New functionality needs colocated tests (`*.test.ts`). Aim for full line
  coverage of code that is not generated.
- Every public module needs a subpath export in the `exports` map of the
  package's `deno.json`.
- JSDoc examples must be valid, type-checkable code that imports from an export
  that exists. They are part of the published docs.
- Use the types of the std package being extended (`@std/xml`, `@std/http`,
  ...). Do not redeclare types that an upstream std package already provides.

## Documentation

When you add a package or change what one does, update:

- the package's `README.md`, which starts with `# @stdx/<package>`, a short
  description, and then the entrypoints or examples;
- the `description` in the package's `deno.json`;
- the root [README.md](./README.md): the "Packages" and "Package status" tables.
  A new package also goes in the `workspace` list of the root `deno.json`.

[Releases.md](./Releases.md) is generated from commit messages when versions are
bumped. Do not edit it by hand.

## Dependencies

For JS, we allow:

- everything under the [@deno](https://jsr.io/@deno) namespace on JSR;
- everything under the [@std](https://jsr.io/@std) namespace on JSR;
- [Standard Schema](https://standardschema.dev):
  [`@standard-schema/spec`](https://jsr.io/@standard-schema/spec) and
  [`@standard-schema/utils`](https://jsr.io/@standard-schema/utils).

Other third-party dependencies are not allowed, so all code must be implemented
in the repository. Imports for other standard specifications, and third-party
libraries for testing, are decided case by case in an issue.

Allowed test dependencies:

- zod: `jsr:@zod/zod@^4`

For modules that compile Rust to WASM, third-party crates may be used if
necessary, decided case by case. Their versions are pinned in the workspace
[Cargo.toml](./_wasm/Cargo.toml).

## WASM

All wasm code is generated from the Rust workspace in the [\_wasm](./_wasm)
folder. Crates are named `<package>_<module>` (e.g. `crypto_hash_argon2`), and
the [build script](./_tools/build_wasm.ts) places each generated lib in
`<package>/_wasm/` based on that prefix. The JS wrappers in the package are the
public API; the generated `.mjs` bindings are an implementation detail.

After changing Rust code, regenerate and commit the artifacts:

```sh
deno task build:wasm
```

CI checks that the committed artifacts match the sources with
`deno task build:wasm:check`.

## Deprecations

When functionality is adopted by JavaScript language APIs, Web Standard APIs or
the Deno STD, mark it with `@deprecated` in its JSDoc, pointing to the
replacement, and add it to [DEPRECATIONS.md](./DEPRECATIONS.md). It is removed
at the earliest after 3 minor versions. See the
[deprecation policy](./README.md#deprecation-policy).

## Commits

Commit messages follow
[conventional commits](https://www.conventionalcommits.org), scoped by package:
`feat(crypto): ...`, `fix(xml): ...`, `chore: ...`. Mark breaking changes with
`!`, e.g. `feat(xml)!: ...`. The messages become the entries in
[Releases.md](./Releases.md), so write them for the users of the package.

Do not bump versions by hand; that happens when releasing.

## Releasing

Maintainers bump the versions and publish the packages to JSR as follows:

1. Trigger the manual GitHub action
   [version bump](https://github.com/halvardssm/std-js/actions/workflows/version_bump.yml).
2. Check the created PR, verify the changes, and merge.
3. Create a [new release](https://github.com/halvardssm/std-js/releases/new),
   with the tag name `release-[date]` (e.g. `release-2024.12.29`) and auto
   generate release notes.
4. Publishing the release triggers the
   [workspace publish](https://github.com/halvardssm/std-js/actions/workflows/workspace_publish.yml)
   workflow, which runs the checks and tests and publishes the packages to JSR.
