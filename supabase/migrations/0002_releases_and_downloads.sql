-- releases: one row per published APK version (the file itself lives in Cloudflare R2).
create table public.releases (
  id         uuid primary key default gen_random_uuid(),
  version    text not null unique,
  r2_key     text not null,
  size_bytes bigint check (size_bytes > 0),
  notes      text,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

-- At most one current release.
create unique index releases_one_current on public.releases (is_current) where is_current;

alter table public.releases enable row level security;
revoke all on public.releases from anon, authenticated;
grant select on public.releases to anon, authenticated;

create policy "releases are public" on public.releases
  for select to anon, authenticated using (true);

-- download_events: analytics log. Written and read only by the API (service role).
create table public.download_events (
  id         bigint generated always as identity primary key,
  release_id uuid references public.releases (id) on delete set null,
  ts         timestamptz not null default now(),
  country    text,
  device     text,
  ua_family  text,
  referrer   text,
  ip_hash    text -- salted hash, never the raw IP
);

create index download_events_ts_idx on public.download_events (ts);
create index download_events_release_idx on public.download_events (release_id);

-- RLS on with no policies and no grants: invisible to the anon/authenticated keys.
alter table public.download_events enable row level security;
revoke all on public.download_events from anon, authenticated;
