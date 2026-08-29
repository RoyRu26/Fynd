# Fynd

Fynd is a production-oriented second-hand marketplace application.

## Architecture

Mobile:
- React Native
- Expo
- TypeScript
- Expo Router

Backend:
- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage
- Supabase Realtime
- Supabase Edge Functions

State and validation:
- TanStack Query for server state
- Zustand for local UI state
- React Hook Form for forms
- Zod for validation

Payments will use Stripe Connect.

## Engineering Rules

- TypeScript strict mode.
- Do not use `any` unless absolutely necessary.
- Do not modify unrelated files.
- Keep business logic out of React components.
- Database access belongs in feature API/service modules.
- Use TanStack Query for server state.
- Use Zod for input validation.
- All database schema changes must use migrations.
- Every exposed database table must use Row Level Security.
- Never expose server secrets to the mobile app.
- Treat all client input as untrusted.
- Money must be stored as integer minor units.
- Critical operations must be transactional and server-controlled.
- Run type checking and linting after changes.