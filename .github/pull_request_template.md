## What and why

<!-- What changes, and what problem it solves. Link the issue if there is one. -->

## How it was verified

<!-- Commands run, manual checks, screenshots for UI changes. Say what was NOT tested. -->

## Checklist

- [ ] `make test lint` passes
- [ ] API contract changed? `make generate` was run and `openapi/` plus `apps/web/src/lib/api/gen` are committed (`make check` passes)
- [ ] New migration? It is a new file, and its `Down` only undoes its own `Up`
- [ ] New environment variable? Added to the `.env.example`, validated at startup, listed in `docs/`, and in `turbo.json` if a build or typecheck reads it
- [ ] `docs/` updated where behaviour changed
- [ ] No tokens, emails or request bodies are logged
