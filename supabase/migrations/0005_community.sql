-- Community: usernames and the public review summary.

-- Usernames: letters, digits and underscore only, unique ignoring case.
alter table public.profiles
  add constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]+$');

create unique index profiles_username_lower_key on public.profiles (lower(username));

-- Username changes now go through the API only (it also blocks reserved names like "admin"),
-- so the column-level update grant from migration 0001 is removed.
revoke update (username) on public.profiles from authenticated;

-- Aggregate over visible reviews for the community page. Called only by the API (service role).
create function public.review_summary()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'count', count(*),
    'average', coalesce(round(avg(rating)::numeric, 2), 0),
    'distribution', jsonb_build_object(
      '1', count(*) filter (where rating = 1),
      '2', count(*) filter (where rating = 2),
      '3', count(*) filter (where rating = 3),
      '4', count(*) filter (where rating = 4),
      '5', count(*) filter (where rating = 5))
  )
  from public.reviews
  where status = 'visible';
$$;

revoke execute on function public.review_summary() from public, anon, authenticated;
grant execute on function public.review_summary() to service_role;
