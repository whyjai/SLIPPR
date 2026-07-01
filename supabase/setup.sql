-- ParlayGuard full schema — run once in Supabase SQL Editor
-- Dashboard → SQL → New query → paste → Run

create extension if not exists "uuid-ossp";

-- Subscriptions (free / basic / premium)
create table if not exists subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users,
  tier text check (tier in ('free', 'basic', 'premium')),
  expires_at timestamp,
  created_at timestamp default now()
);

create unique index if not exists subscriptions_user_id_idx on subscriptions (user_id);

-- Bet history
create table if not exists bet_history (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users,
  date timestamp default now(),
  slip jsonb,
  result text,
  roi decimal
);

-- Referral codes + referral log
create table if not exists referral_codes (
  user_id uuid primary key references auth.users,
  code text unique not null,
  created_at timestamp default now()
);

create table if not exists referrals (
  id uuid primary key default uuid_generate_v4(),
  referrer_id uuid references auth.users not null,
  referred_id uuid references auth.users not null,
  referral_code text not null,
  created_at timestamp default now()
);

-- User profiles (email for premium cron delivery)
create table if not exists profiles (
  id uuid primary key references auth.users,
  email text not null,
  created_at timestamp default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;

  insert into public.subscriptions (user_id, tier)
  values (new.id, 'free')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Row Level Security (basic)
alter table subscriptions enable row level security;
alter table bet_history enable row level security;
alter table profiles enable row level security;
alter table referral_codes enable row level security;
alter table referrals enable row level security;

create policy "Users read own subscription"
  on subscriptions for select using (auth.uid() = user_id);

create policy "Users read own bet history"
  on bet_history for select using (auth.uid() = user_id);

create policy "Users read own profile"
  on profiles for select using (auth.uid() = id);

create policy "Users read own referral code"
  on referral_codes for select using (auth.uid() = user_id);
