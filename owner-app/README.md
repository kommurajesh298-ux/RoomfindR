# RoomFindr Owner App

Property management and booking system for PG/hostel owners. This is the owner-facing application for the RoomFindr platform.

## Tech Stack
- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- Firebase 12.8.0

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```

2. Run development server:
   ```bash
   npm run dev
   ```

## Environment Variables
Create `.env.development` and `.env.production` files:
```env
VITE_APP_NAME=RoomFindr Owner
VITE_FIREBASE_API_KEY=your_key
VITE_FIREBASE_PROJECT_ID=roomfindr-caacc
VITE_IS_PRODUCTION=false
```

## Folder Structure
- `src/components`: Reusable UI components
- `src/contexts`: React Context providers (Auth, Owner)
- `src/pages`: Application pages (Signup, Login, Dashboard)
- `src/services`: Firebase and business logic services
- `src/types`: TypeScript interfaces
- `src/utils`: Helper functions
