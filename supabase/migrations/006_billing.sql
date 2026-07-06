-- Stripe billing columns + auto-provisioning of profile/free-tier rows.

alter table subscriptions
  add column if not exists status text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists price_id text,
  add column if not exists updated_at timestamptz default now();

create index if not exists subscriptions_stripe_customer_idx
  on subscriptions (stripe_customer_id);

-- On new auth user: create a profile row and a free-tier subscription so the
-- app has a consistent record no matter how the account was created.
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
