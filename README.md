# Vault

A dark-themed cloud storage UI built with **React**, **Vite**, **TypeScript**, and **Supabase**. This version covers **authentication** and **albums** (no file uploads yet).

## Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com/) project

## Supabase setup

1. Create a project in the Supabase dashboard.
2. Open **SQL Editor** and run the script in [`supabase/schema.sql`](supabase/schema.sql). It creates:
   - Tables: `profiles`, `albums`, `items`
   - Row Level Security policies
   - A trigger that inserts a `profiles` row when a user signs up
3. Under **Authentication → Providers**, ensure **Email** is enabled.
4. Under **Project Settings → API**, copy the **Project URL** and **anon public** key.

## Local environment

Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from **Project Settings → API** (the anon key is safe to use in the browser; `.env` is gitignored).

If your database was created before the `profiles_insert_own` policy existed, run [`supabase/migrations/20260320220000_profiles_insert_policy.sql`](supabase/migrations/20260320220000_profiles_insert_policy.sql) in the SQL Editor so client-side profile upserts work.

**Email confirmation:** If **Authentication → Providers → Email → Confirm email** is enabled, new users must confirm before login. For local testing you can disable confirmation or use the confirmation link from the email log.

## Scripts

| Command   | Description        |
| --------- | ------------------ |
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |

## App structure

- `src/lib/supabase.ts` — Supabase client (session persistence enabled)
- `src/context/` — Auth provider and `useAuth` hook
- `src/pages/` — Home, Login, Register, Dashboard
- `src/components/` — Layout, album grid/cards, create-album modal

## Routes

| Path | Description |
| ---- | ----------- |
| `/` | Landing (redirects to dashboard if signed in) |
| `/login` | Email/password sign-in |
| `/register` | Sign up |
| `/dashboard` | Albums (protected) |
