-- Security hardening (2026-09-28).
--
-- 1. pick_results was readable by anyone holding the public anon key, including
--    pending picks, which are today's Pro board. The app reads this table with
--    the service-role key, so the public policy only needs settled picks.
drop policy if exists pick_results_public_read on public.pick_results;
create policy pick_results_public_read
  on public.pick_results for select
  using (result <> 'pending');

-- 2. RUN_ONCE_setup.sql created profiles/subscriptions without RLS. With RLS
--    off, the anon key can read and WRITE them (e.g. set its own tier to
--    premium). Idempotent: safe to run even if setup.sql already did this.
alter table public.subscriptions enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "Users read own subscription" on public.subscriptions;
create policy "Users read own subscription"
  on public.subscriptions for select using (auth.uid() = user_id);

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
  on public.profiles for select using (auth.uid() = id);

-- No insert/update/delete policies: only the server (service role, Stripe
-- webhook) writes these tables.
