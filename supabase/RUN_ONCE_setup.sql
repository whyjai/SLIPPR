-- ============================================================================
-- SLIPPR — one-shot database setup.
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run more than once (every statement is idempotent).
-- Covers migrations 004–007 + the constraints the app code requires.
-- ============================================================================

create extension if not exists "uuid-ossp";

-- ---- profiles (needed by the new-user trigger) -----------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users,
  email text,
  created_at timestamptz default now()
);

-- ---- subscriptions (Pro tier + Stripe linkage) -----------------------------
create table if not exists public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users,
  tier text check (tier in ('free', 'basic', 'premium')),
  expires_at timestamptz,
  created_at timestamptz default now()
);

-- Billing columns (no-op if the table already had them).
alter table public.subscriptions
  add column if not exists status text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists price_id text,
  add column if not exists updated_at timestamptz default now();

-- One row per user — REQUIRED for the app's upsert(onConflict: user_id).
create unique index if not exists subscriptions_user_id_key
  on public.subscriptions (user_id);
create index if not exists subscriptions_stripe_customer_idx
  on public.subscriptions (stripe_customer_id);

-- ---- board + odds cache (005) ----------------------------------------------
create table if not exists public.leg_boards (
  window_key text primary key,
  generated_at timestamptz not null default now(),
  source text not null,
  payload jsonb not null
);
create index if not exists leg_boards_generated_at_idx
  on public.leg_boards (generated_at desc);

create table if not exists public.odds_scans (
  scan_key text primary key,
  fetched_at timestamptz not null default now(),
  legs jsonb not null
);
create index if not exists odds_scans_fetched_at_idx
  on public.odds_scans (fetched_at desc);

alter table public.leg_boards enable row level security;
alter table public.odds_scans enable row level security;

-- ---- verified track record / CLV (007) -------------------------------------
create table if not exists public.pick_results (
  id text primary key,
  window_key text not null,
  sport text not null,
  market text not null,
  event text not null,
  pick text not null,
  book text,
  entry_odds integer not null,
  entry_implied numeric not null,
  fair_prob numeric not null,
  confidence integer not null,
  grade text not null,
  closing_odds integer,
  closing_implied numeric,
  clv numeric,
  result text default 'pending' check (result in ('pending','win','loss','push','void')),
  start_time timestamptz,
  graded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pick_results_result_idx on public.pick_results (result);
create index if not exists pick_results_created_idx on public.pick_results (created_at desc);

alter table public.pick_results enable row level security;
drop policy if exists pick_results_public_read on public.pick_results;
create policy pick_results_public_read
  on public.pick_results for select using (true);

-- ---- auto-provision profile + free subscription on signup (006) ------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  insert into public.subscriptions (user_id, tier)
  values (new.id, 'free')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Done. Tables: profiles, subscriptions, leg_boards, odds_scans, pick_results.
