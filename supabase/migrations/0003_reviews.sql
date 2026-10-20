-- reviews: one per user. Writes go through the API, which checks the verified email and rate limits.
create table public.reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references public.profiles (id) on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  body       text not null check (char_length(body) between 1 and 1000),
  status     text not null default 'visible' check (status in ('visible', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reviews_created_idx on public.reviews (created_at desc);

alter table public.reviews enable row level security;
revoke all on public.reviews from anon, authenticated;
grant select on public.reviews to anon, authenticated;

create policy "visible reviews are public" on public.reviews
  for select to anon, authenticated using (status = 'visible');
