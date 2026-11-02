# Kfe Studio

A mobile-friendly sewing library for tracking fabric, patterns, and future projects. Collections such as “Home” and “Studio” can be shared with other accounts.

## Stack

- Next.js and TypeScript for the responsive web app and installable PWA.
- Supabase Auth and PostgreSQL for accounts, shared data, and row-level access control.
- The database uses explicit collection membership and Row Level Security (RLS); client-side code uses only the Supabase publishable key.

## Set up Supabase

1. In your Supabase project, open **SQL Editor**, create a query, paste the contents of each file in [`supabase/migrations/`](supabase/migrations), in filename order, and run them one at a time. This creates the tables, grants, triggers, and RLS policies used by the app. If you already set up the database, run only the migration(s) you have not applied yet.
2. In **Project Settings → API Keys**, copy the **Project URL** and **publishable key**. Do not use a secret or `service_role` key in this browser app.
3. Copy `.env.example` to `.env.local` and fill in those two values. `.env.local` is ignored by Git; do not commit it.
4. In **Authentication → URL Configuration**, set the local site URL to `http://localhost:3000`. If email confirmation is enabled, confirm the signup email before signing in.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Add the app to a phone’s home screen from its browser menu for an app-like experience.

## How it works

- Create an account, then make collections for different places or purposes.
- Add fabrics with their current quantity and patterns with useful notes.
- Create future projects and associate an owned pattern and fabric with a planned quantity.
- Choose metres or yards in Settings. Each saved quantity keeps its unit if the preference changes.
- Choose English or French in Settings; the language preference follows your account across devices.
- Share a collection by entering the email address already registered to the recipient’s Kfe Studio account. The invited account gets editor access.

Collections synchronize between signed-in devices through Supabase. This requires an internet connection; offline editing and automatic merge are not implemented. Supabase’s free-plan limits and terms can change, so check the current pricing and backup important data.
