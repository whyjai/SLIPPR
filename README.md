# SLIPPR

AI-powered parlay slips with a 10-model council, sharp vs public insights, and predatory line warnings — refreshed 8× daily.

## Stack

- Next.js 16 · TypeScript · Tailwind
- Supabase (auth, subscriptions, bet history)
- Resend (daily slip emails)
- Vercel (hosting + cron)

## Local dev

```bash
cp .env.example .env.local
# fill in Supabase + Resend keys
npm install
npm run dev
```

- Landing: [http://localhost:3000](http://localhost:3000)
- Dashboard: [http://localhost:3000/dashboard](http://localhost:3000/dashboard)

## Database

Run `supabase/setup.sql` in the Supabase SQL Editor.

## Deploy

Push to [github.com/whyjai/SLIPPR](https://github.com/whyjai/SLIPPR) and import on Vercel with env vars from `.env.example`.
