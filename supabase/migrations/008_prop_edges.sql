-- Prop Edges: DFS pick'em / soft-book props vs devigged sharp lines.
-- Separate from odds_scans so leg-board's "latest scan" fallback never reads
-- prop payloads.

create table if not exists public.prop_edge_scans (
  scan_key text primary key,
  generated_at timestamptz not null default now(),
  payload jsonb not null
);

create index if not exists prop_edge_scans_generated_at_idx
  on public.prop_edge_scans (generated_at desc);

-- Service-role access only; no anon policies needed.
alter table public.prop_edge_scans enable row level security;
