-- Verified track record: every published leg is logged at entry price, its
-- closing line is captured when the event starts, and it's graded win/loss
-- after settlement. Closing Line Value (CLV) is the honest, un-fakeable proof
-- that the board beats the market over time.

create table if not exists public.pick_results (
  id text primary key,                 -- board leg id
  window_key text not null,            -- board window it was published in
  sport text not null,
  market text not null,
  event text not null,
  pick text not null,
  book text,
  -- Prices, as American odds + implied %
  entry_odds integer not null,
  entry_implied numeric not null,
  fair_prob numeric not null,          -- council/devig consensus at publish
  confidence integer not null,
  grade text not null,
  -- Closing line (captured at event start)
  closing_odds integer,
  closing_implied numeric,
  clv numeric,                         -- closing_implied - entry_implied (points beaten)
  -- Settlement
  result text default 'pending' check (result in ('pending','win','loss','push','void')),
  start_time timestamptz,
  graded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists pick_results_result_idx on public.pick_results (result);
create index if not exists pick_results_created_idx on public.pick_results (created_at desc);

alter table public.pick_results enable row level security;

-- Public read of the aggregate track record (transparency is the product).
drop policy if exists pick_results_public_read on public.pick_results;
create policy pick_results_public_read
  on public.pick_results for select
  using (true);
