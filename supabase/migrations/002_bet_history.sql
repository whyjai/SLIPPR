create table bet_history (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users,
  date timestamp default now(),
  slip jsonb,
  result text,
  roi decimal
);
