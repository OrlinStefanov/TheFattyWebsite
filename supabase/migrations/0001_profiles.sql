-- profiles: one row per auth user, holds the role.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text unique check (char_length(username) between 3 and 30),
  role       text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Default Supabase grants are broad. Start from nothing, then grant the minimum.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
-- Column-level grant: users can change their username, never their role.
grant update (username) on public.profiles to authenticated;

create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());

create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Create a 'user' profile whenever someone signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill users that signed up before this migration.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;
