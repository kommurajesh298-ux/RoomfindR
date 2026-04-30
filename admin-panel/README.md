# RoomFindR Admin Panel

Command center for managing the RoomFindR ecosystem.

## Features
- **Admin Authentication**: Multi-layered security with Firebase Auth + Custom Claims.
- **Owner Verification**: Document review and approval workflow for new partners.
- **Property Moderation**: Platform-wide listing monitoring and verification.
- **Real-time Updates**: Instant notifications for pending items and user reports.
- **Audit Logging**: Comprehensive trail of all administrative actions.

## Tech Stack
- React 19 + TypeScript
- Vite + Tailwind CSS 4
- Firebase (Auth, Firestore, Storage)
- Fragment Motion & React Icons

## Getting Started

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Setup Environment**
   Ensure `.env.development` is populated with Firebase keys.

3. **Run Development Server**
   ```bash
   npm run dev
   ```
   The panel will be available at `http://localhost:5175`.

## Architecture
See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed design patterns.
