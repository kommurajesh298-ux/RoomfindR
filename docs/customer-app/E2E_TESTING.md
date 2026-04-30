# Customer App E2E Testing

## Overview

Playwright is used for customer-facing flow coverage.

## Current coverage areas

- public browse and search filters
- booking and payment flows
- account and bookings flows
- chat and resident portal flows
- mobile customer checks

## Commands

Run all customer E2E tests:

```bash
npx playwright test tests/e2e/customer
```

Run headed mode:

```bash
npx playwright test tests/e2e/customer --headed
```

Run UI mode:

```bash
npx playwright test tests/e2e/customer --ui
```

Run a specific file:

```bash
npx playwright test tests/e2e/customer/public-browse.spec.ts
```

## Configuration notes

See the root `playwright.config.ts` for:

- base URL
- test directories
- retries
- screenshot and video behavior

## Debugging tips

1. Use UI mode for interactive debugging.
2. Use headed mode when visual behavior matters.
3. Check `test-results/` for screenshots and artifacts after failures.
4. Use `npx playwright show-report` to inspect the last run.

## Writing new tests

Add new customer specs under `tests/e2e/customer/` and keep tests isolated from each other. Prefer stable selectors and avoid hardcoded waits.
