-- Stale Line Alerts: Pinnacle price snapshots (for diffing) and the alerts
-- that fired when a pick'em app hadn't caught up to a Pinnacle move.

create table if not exists public.stale_line_snapshots (
  prop_id text primary key,       -- Pinnacle's own special id ("pin-<id>")
  player text not null,
  market text not null,
  sport text not null,
  event text not null,
  line numeric not null,
  over_prob numeric not null,     -- devigged, 0-1
  start_time timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.stale_line_alerts (
  id text primary key,            -- "<propId>|<side>|<bookKey>", dedups reruns
  prop_id text not null,
  platform text not null,
  player text not null,
  market text not null,
  side text not null,             -- 'Over' | 'Under'
  line numeric not null,
  sport text not null,
  event text not null,
  start_time timestamptz not null,
  price integer,                  -- null on a flat-payout standard pick
  sharp_win_pct numeric not null,
  breakeven_pct numeric not null,
  edge_pct numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists stale_line_alerts_created_at_idx
  on public.stale_line_alerts (created_at desc);

-- One row per day; caps Odds API spend on stale-line checks.
create table if not exists public.stale_line_budget (
  day text primary key,
  requests_used integer not null default 0
);

-- Service-role access only; no anon policies needed.
alter table public.stale_line_snapshots enable row level security;
alter table public.stale_line_alerts enable row level security;
alter table public.stale_line_budget enable row level security;
