---
name: repo-tooling-guardrails
description: Guardrails for the Makefile, CI workflows, generated files and package management in this monorepo. Use this whenever you edit the Makefile or .github/workflows, add a "fail if out of date" / drift check, write a recipe that redirects output into a committed file, run `make generate`, install or add a JS dependency or CLI (shadcn, openapi-ts, anything via npm/npx/pnpm), or notice a lockfile change. Consult it even for a one-line Makefile tweak — the bugs it prevents are all one-liners.
---

# Repo tooling guardrails

## 1. Drift checks must see untracked files

`git diff --exit-code` only compares *tracked* files. A generator that emits a
brand-new file (a new operation → a new file under
`apps/web/src/lib/api/gen`) leaves it untracked, the diff is empty, and CI
passes with a stale contract.

Use `git status --porcelain -- <paths>` and fail when the output is non-empty;
it reports modified, deleted **and** untracked files. `make check` is the
reference implementation — copy its shape for any new "generated code is
committed" check.

## 2. Never redirect straight into a committed file

`cmd > file` truncates `file` *before* `cmd` runs. If `cmd` then fails (a Go
compile error during `make openapi`), the working tree is left with a 0-byte
`openapi/openapi.yaml` and the next step generates a client from nothing.

Write to a temp file next to the target and `mv` it into place only on
success; remove the temp file and exit non-zero on failure. See the `openapi`
target.

## 3. Generated files

- The Go code is the source of truth. After changing an operation (including
  adding a documented error response), run `make generate` and commit
  `openapi/openapi.yaml` and `apps/web/src/lib/api/gen` in the same change.
- Never edit generated files by hand; `git add` new ones.
- Run `make check` before declaring an API change done.
- sqlc is pinned twice: `SQLC` in the Makefile and `sqlc-version` in the CI
  contract job. Bump both together, or CI regenerates different code and fails.
- The generated client validates every response against the contract at
  runtime (`zod.gen.ts`). Adding a response field is compatible; removing or
  retyping one breaks web builds that predate it, so treat that as a breaking
  API change. Form limits come from `zod.gen.ts` too: never hard-code a
  `maxLength` in a form schema.
- `make generate` covers three outputs: `apps/api/internal/db/dbgen` (sqlc),
  `openapi/openapi.yaml` and `apps/web/src/lib/api/gen`. A changed query needs
  it as much as a changed operation.

## 4. pnpm only

The workspace is pnpm (`packageManager` in the root `package.json`,
`pnpm-lock.yaml`). A stray `npm install <pkg>` at the root writes a
`package-lock.json` describing dependencies the root manifest doesn't declare;
that confuses Dependabot, `setup-node` caching and Next.js's workspace-root
inference, and invites the next person to use npm.

- Add dependencies with `pnpm --filter web add <pkg>`. The root holds only
  repo-wide tooling (`turbo`); `apps/api/package.json` has scripts and no dependencies.
- One-off CLIs: `pnpm dlx <tool>` (e.g. `pnpm dlx shadcn@latest add …` run from
  `apps/web`), never `npm install`/`npx` at the repo root.
- `package-lock.json` and `yarn.lock` are git-ignored; if one appears, delete
  it rather than committing it.
- JS/TS lint and format are Oxlint + oxfmt. Don't add Biome, ESLint or Prettier.

## 5. Turborepo tasks

- Tasks run with a filtered environment (strict mode). When a build or
  typecheck starts reading a new variable, add it to that task's `env` in
  `turbo.json`; otherwise the task doesn't see it in CI and the cache doesn't
  vary with it, so a stale build can be replayed for a different config.
- Only cache tasks whose result depends on files inside their own package.
  Anything that writes elsewhere (`make generate` → `openapi/`), talks to the
  database (`migrate`) or must always run (`dev`) stays uncached or in Make.
- `build` `outputs` must cover everything the task produces (`.next/**`,
  `bin/**`), or a cache hit restores nothing.
- A Go-side task is a script in `apps/api/package.json` plus an entry in `turbo.json`.

## Checklist

- [ ] New/changed drift check uses `git status --porcelain`, scoped to paths.
- [ ] No recipe redirects directly into a tracked file.
- [ ] `make generate` run and outputs staged after any API contract change.
- [ ] Only `pnpm-lock.yaml` changed among lockfiles.
- [ ] `make -n <target>` (dry run) reads correctly after Makefile edits.
