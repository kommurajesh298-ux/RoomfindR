# CI/CD Guide

## Overview

This repository uses GitHub Actions for workspace-aware linting, unit tests, Playwright E2E coverage, and production build artifact generation.

Current workflows:

- `ci.yml`: lint, unit test, and build validation
- `e2e.yml`: root Playwright suite
- `nightly.yml`: scheduled cross-browser Playwright run
- `deploy.yml`: production build artifacts for all three apps

## Workflow Summary

### `ci.yml`

Triggers:

- push to `main`, `master`, or `develop`
- pull requests targeting `main`, `master`, or `develop`

What it does:

- installs the root workspace once with `npm ci`
- runs `npm run lint:all`
- runs app Jest suites in parallel with npm workspaces
- runs `npm run build:all`

### `e2e.yml`

Triggers:

- push to `main`, `master`, or `develop`
- pull requests targeting `main`, `master`, or `develop`
- manual dispatch

What it does:

- installs workspace dependencies
- installs Playwright browsers
- runs the root Playwright suite with `npm run test:e2e:all`
- uploads Playwright artifacts on failure

### `nightly.yml`

Triggers:

- daily at `02:00 UTC`
- manual dispatch

What it does:

- runs the root Playwright suite with `E2E_CROSS_BROWSER=1`
- uploads Playwright artifacts on failure

### `deploy.yml`

Triggers:

- push to `main`
- manual dispatch

What it does:

- installs workspace dependencies
- builds all three apps
- uploads the three `dist` folders as artifacts

This workflow prepares release artifacts only. It does not deploy to Vercel, Netlify, AWS, or any other hosting target yet.

## Local Commands

Run the same checks locally from the repo root:

```bash
npm ci
npm run lint:all
npm run build:all
npm run test:e2e:all
```

Per-app unit tests:

```bash
npm --workspace customer-app test
npm --workspace owner-app test
npm --workspace admin-panel test
```

## Required GitHub Setup

Recommended repository settings:

- enable branch protection on `main`
- require the `lint-and-build` and `unit-tests` jobs from `ci.yml`
- require the `playwright` job from `e2e.yml`

## Notes

- The old Firebase-emulator workflow has been removed because this repo now uses Supabase-based flows.
- The root Playwright config is `playwright.config.ts`, and the active E2E suite lives under `tests/`.
- Workflow dependency caching is based on the root `package-lock.json`.
