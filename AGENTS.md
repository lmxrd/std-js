# AGENTS.md

An extension of the [Deno Standard Library](https://github.com/denoland/std),
published on JSR under the `@stdx` scope.

[CONTRIBUTING.md](./CONTRIBUTING.md) is the source of truth for how work is done
in this repository: the setup, tasks, repository layout, code conventions,
documentation, dependency policy, WASM build, deprecations, commits and
releases. Read it before making changes and follow it. This file only adds what
an agent needs on top of it. The user-facing policies (versioning, deprecation,
platform support) are in [README.md](./README.md).

When you change how the repository works, update CONTRIBUTING.md, and keep
README.md and this file consistent with it.

## Quick reference

```sh
deno task check             # format check (JS + Rust), lint and type-check
deno task test              # full test suite with coverage
deno task fix               # format (JS + Rust) and auto-fix lint rules
deno task build:wasm        # rebuild wasm after changing Rust in _wasm/
mise run check:pre-commit   # everything CI checks, including a publish dry run
```

## Before considering work done

- `deno task check` and `deno task test` pass.
- If you touched Rust code in `_wasm/`, you ran `deno task build:wasm` and
  committed the generated artifacts.
- New functionality has colocated tests, and public modules have a subpath
  export in the package's `deno.json`.
- The package `README.md`, its `deno.json` `description`, and the tables in the
  root `README.md` match the change.
- No new dependencies outside the policy in CONTRIBUTING.md.
- `Releases.md` and package versions are untouched; they are changed by the
  release workflow.

## Agent-specific rules

- Never hand-format code; run `deno task fix`.
- Never redeclare types that an upstream std package already provides.
- Treat the generated `.mjs` bindings in `<package>/_wasm/` as build output:
  change the Rust source and rebuild instead of editing them.
- Commit messages are conventional commits scoped by package
  (`feat(crypto): ...`) and end up in `Releases.md`, so write them for the users
  of the package.
