# RoomFindR

RoomFindR is a real-time PG and room booking platform with separate apps for customers, property owners, and administrators. It combines room discovery, booking workflows, owner listings, payments, notifications, ratings, and Supabase-backed availability.

[![CI Pipeline](https://github.com/kommurajesh298-ux/RoomfindR/actions/workflows/ci.yml/badge.svg)](https://github.com/kommurajesh298-ux/RoomfindR/actions/workflows/ci.yml)
[![Deploy Workflow](https://github.com/kommurajesh298-ux/RoomfindR/actions/workflows/deploy.yml/badge.svg)](https://github.com/kommurajesh298-ux/RoomfindR/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

## Apps

| App | Purpose | Local URL |
| --- | --- | --- |
| Customer App | Browse rooms, filter listings, book stays, pay, chat, and manage bookings | <http://localhost:5173> |
| Owner App | Manage properties, bookings, check-ins, settlements, ratings, and notifications | <http://localhost:5174> |
| Admin Panel | Review users, owners, properties, tickets, verification, and platform operations | <http://localhost:5175> |

## Tech Stack

- React 19 and TypeScript
- Vite workspaces for customer, owner, and admin apps
- Supabase Auth, PostgreSQL, storage, realtime, and SQL migrations
- Tailwind CSS, Framer Motion, Lucide icons, and React Router
- Jest, React Testing Library, Playwright, and GitHub Actions

## Project Structure

```text
RoomFindR/
|-- admin-panel/        # Admin management console
|-- customer-app/       # Customer-facing room booking app
|-- owner-app/          # Property owner dashboard
|-- design-system/      # Shared design notes and UI guidance
|-- docs/               # Setup, testing, deployment, and app documentation
|-- infra/              # Production Docker and deployment support
|-- playwright/         # Playwright configuration/support files
|-- scripts/            # Verification, seed, and maintenance scripts
|-- shared/             # Shared app utilities and cross-app assets
|-- sql/                # SQL helpers
|-- supabase/           # Supabase schemas, policies, migrations, and templates
|-- templates/          # Email templates
`-- tests/              # E2E and integration test suites
```

## Quick Start

```bash
npm install
npm run dev:customer
npm run dev:owner
npm run dev:admin
```

Run all three apps together:

```bash
npm run dev:all
```

## Build And Test

```bash
npm run lint:all
npm run build:all
npm run test:all
npm run test:e2e:all
```

Use the focused app scripts when working on one area:

```bash
npm run lint:customer
npm run build:owner
npm run test:admin
```

## Environment

Copy the example environment files and fill in your Supabase, payment, and notification values before running production-like flows.

```bash
cp .env.example .env.local
```

Never commit real secrets. Local `.env` files, build output, APK files, test reports, and dependency folders are ignored by Git.

## Documentation

- [Start Here](./00_START_HERE.md)
- [Manual Testing Guide](./MANUAL_TESTING_GUIDE.md)
- [Testing Guide](./docs/TESTING_GUIDE.md)
- [Customer App E2E Testing](./docs/customer-app/E2E_TESTING.md)
- [Owner App Architecture](./docs/owner-app/ARCHITECTURE.md)
- [Admin Panel Architecture](./docs/admin-panel/ARCHITECTURE.md)
- [Supabase Production Rollout](./docs/SUPABASE_PRODUCTION_ROLLOUT.md)
- [CI/CD Guide](./.github/CICD_GUIDE.md)

## GitHub Links

- [Repository](https://github.com/kommurajesh298-ux/RoomfindR)
- [Issues](https://github.com/kommurajesh298-ux/RoomfindR/issues)
- [Actions](https://github.com/kommurajesh298-ux/RoomfindR/actions)
- [Security](https://github.com/kommurajesh298-ux/RoomfindR/security)

## License

This project is licensed under the [MIT License](./LICENSE).
