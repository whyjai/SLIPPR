create table profiles (
  id uuid primary key references auth.users,
  email text not null,
  created_at timestamp default now()
);
