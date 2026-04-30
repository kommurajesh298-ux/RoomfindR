# Contributing to RoomFindR

## Scope

RoomFindR is a monorepo with three apps:

- `customer-app`
- `owner-app`
- `admin-panel`

Most changes should stay scoped to one app unless they intentionally affect shared flows.

## Local setup

```bash
npm ci
```

Useful root commands:

```bash
npm run dev:all
npm run lint:all
npm run build:all
npm run test:all
```

Useful app-level commands:

```bash
cd customer-app && npm run lint && npm run build
cd owner-app && npm run lint && npm run build
cd admin-panel && npm run lint && npm run build
```

## Workflow

1. Create a focused branch.
2. Keep changes scoped and easy to review.
3. Update docs when behavior or setup changes.
4. Run the relevant lint, build, and test commands before opening a PR.

## Code expectations

- Prefer small, safe refactors over broad rewrites.
- Do not commit secrets, production credentials, or private keys.
- Keep app-specific logic inside the correct app folder.
- Reuse shared patterns already established in the repo.

## Pull request checklist

- [ ] Change is scoped and explained clearly
- [ ] Relevant app builds successfully
- [ ] Relevant lint command passes
- [ ] Relevant tests were run, or any gaps are called out
- [ ] Docs were updated if setup, behavior, or deployment changed

## Commit guidance

Conventional commit style is preferred:

```text
feat: add owner refund summary
fix: correct customer location label
docs: update admin auth notes
refactor: extract shared favorites service
test: add property details coverage
```

## Reporting issues

When reporting a bug, include:

1. What happened
2. What you expected
3. Steps to reproduce
4. App affected
5. Screenshots or logs when helpful

## Documentation rule

If you touch auth, payments, deployment, environment variables, or mobile build flows, check `docs/` in the same PR and update anything that became stale.
