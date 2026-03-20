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
- `src/lib/albumQueries.ts` — Album fetch with item counts (`items(count)`)
- `src/context/` — Auth provider, `useAuth`, toasts (`ToastProvider` / `useToast`)
- `src/pages/` — Home, Login, Register, Dashboard
- `src/components/albums/` — Grid, cards, create/rename/delete modals, card menu (⋯)

### Albums

- Create, rename, and delete albums (delete uses a confirmation modal)
- Item counts per album (from Supabase)
- Toasts for create / rename / delete
- Optimistic UI for create, rename, and delete

## Vercel (SPA routing)

[`vercel.json`](vercel.json) uses **`rewrites`** so unknown paths fall back to **`/index.html`**, while real files under **`dist/`** (for example **`/assets/*.js`**) are still served as static assets first.

Do **not** use a legacy **`routes`** catch‑all that sends every request to **`/`**—that can make the browser request **`/assets/...js`** and receive **HTML** instead of JavaScript (MIME error → blank/black screen).

In the Vercel project settings, use the **Vite** preset (or set **Output Directory** to **`dist`**).

**Environment variables:** Add **`VITE_SUPABASE_URL`** and **`VITE_SUPABASE_ANON_KEY`** to the Vercel project (Production and Preview). If they are missing at build time, older code passed empty strings into `createClient`, which **throws at import time** and produced a blank page. The client now uses safe placeholders when env is missing so the UI still loads; you’ll see an **EnvBanner** until credentials are set.

## Routes

| Path | Description |
| ---- | ----------- |
| `/` | Landing (redirects to dashboard if signed in) |
| `/login` | Email/password sign-in |
| `/register` | Sign up |
| `/dashboard` | Albums (protected) |
