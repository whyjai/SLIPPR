create extension if not exists "uuid-ossp";

create table subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users,
  tier text check (tier in ('free', 'basic', 'premium')),
  expires_at timestamp,
  created_at timestamp default now()
);
