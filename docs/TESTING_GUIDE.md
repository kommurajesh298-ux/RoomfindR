# RoomFindR Testing Guide

## Overview

The repo uses a layered approach:

- unit and component tests with Jest
- end-to-end tests with Playwright
- lint checks
- production build checks

Use root scripts when you want to validate the whole monorepo, or app scripts when you are working in one app.

The active Playwright configuration lives at the repo root in `playwright.config.ts`, and the E2E suites live under `tests/`.

## Root commands

```bash
npm run test:all
npm run test:e2e:all
npm run lint:all
npm run build:all
```

## App commands

Customer app:

```bash
cd customer-app
npm test
npm run test:e2e
npm run lint
npm run build
```

Owner app:

```bash
cd owner-app
npm test
npm run test:e2e
npm run lint
npm run build
```

Admin panel:

```bash
cd admin-panel
npm test
npm run test:e2e
npm run lint
npm run build
```

## Current E2E coverage areas

Customer app:

- auth and OTP flows
- public browse, search, and filter flows
- booking and payment flows
- account, bookings, portal, and chat flows
- mobile customer navigation checks

Owner app:

- property creation and room management
- dashboard and transaction flows
- bank verification and advance payout flows
- offers and portal checks

Admin panel:

- owner approval flows
- property moderation flows
- finance, refunds, bookings, and portal checks

Cross-app and backend validation:

- realtime listeners and sync
- booking/payment database integrity
- Android and iOS validation checks
- system-level auth, refund, settlement, and rent flows

## Recommended pre-PR checks

If you changed one app:

1. Run that app's `lint`
2. Run that app's `build`
3. Run the relevant Jest tests
4. Run the relevant Playwright suite if user flows changed

If you changed shared flows like auth, payments, locations, deployment, or SQL:

1. Run `npm run lint:all`
2. Run `npm run build:all`
3. Run the affected app test suites

## Debugging tips

Jest:

```bash
npm test -- --watch
npm test -- --verbose
```

Playwright:

```bash
npm run test:e2e:headed
npm run test:e2e:ui
npx playwright show-report
```

Useful targeted runs from the repo root:

```bash
npx playwright test tests/e2e/customer
npx playwright test tests/e2e/owner
npx playwright test tests/e2e/admin
```

## CI

The repo already contains workflow files in `.github/workflows/`. Local green checks should match what CI expects as closely as possible.
