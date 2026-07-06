-- Board persistence: generated boards survive serverless cold starts and
-- odds scans are shared across the 8 daily refresh windows (API quota).

create table if not exists public.leg_boards (
  window_key text primary key,
  generated_at timestamptz not null default now(),
  source text not null,
  payload jsonb not null
);

create table if not exists public.odds_scans (
  scan_key text primary key,
  fetched_at timestamptz not null default now(),
  legs jsonb not null
);

create index if not exists odds_scans_fetched_at_idx
  on public.odds_scans (fetched_at desc);

-- Service-role access only; no anon policies needed.
alter table public.leg_boards enable row level security;
alter table public.odds_scans enable row level security;
