create table referral_codes (
  user_id uuid primary key references auth.users,
  code text unique not null,
  created_at timestamp default now()
);

create table referrals (
  id uuid primary key default uuid_generate_v4(),
  referrer_id uuid references auth.users not null,
  referred_id uuid references auth.users not null,
  referral_code text not null,
  created_at timestamp default now()
);

-- subscriptions may have multiple rows per user today; add unique for upsert if missing
create unique index if not exists subscriptions_user_id_idx on subscriptions (user_id);
