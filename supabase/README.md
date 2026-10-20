# Supabase setup

## 1. Run the migrations
Supabase dashboard → **SQL Editor** → New query. Paste and run each file **in order**:

1. `migrations/0001_profiles.sql`
2. `migrations/0002_releases_and_downloads.sql`
3. `migrations/0003_reviews.sql`
4. `migrations/0004_download_analytics.sql` (the admin dashboard's stats function)

Each file is meant to run once. If one fails, fix the cause and rerun only that file after dropping what it half-created.

## 2. Create your admin account
Dashboard → **Authentication → Users → Add user** (email + password, tick *Auto Confirm User*).
The signup trigger creates the profile with role `user`. Promote it once, in the SQL Editor:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'YOUR-EMAIL-HERE');
```

The role can only be changed this way. The API never accepts a role from a client.

## 3. Auth settings
Dashboard → **Authentication**:
- **Providers → Email**: keep *Confirm email* on.
- **URL Configuration**: Site URL = `https://orlinstefanov.github.io/TheFattyWebsite/` (adjust to your Pages URL); add the same under Redirect URLs, plus `http://localhost:*` for local testing.
- **SMTP** (before public launch): the built-in mailer is heavily rate-limited. Add Resend SMTP credentials.

## 4. Sign in to the admin page
The API serves the admin pages itself, so the session cookie is first-party and HttpOnly (no token ever reaches browser JavaScript).
1. Set `SUPABASE_ANON_KEY` (Project Settings -> API, the **anon / publishable** key) in `api/.env` locally and in the Render service's environment. It is used by the API only; it is not in the website.
2. Open the site's **Admin** link (`admin.html`). It wakes the API (with an animation), then redirects to `<API>/admin/`. Sign in with the admin account.
   Locally: `npm run dev` in `api/` and open http://localhost:3000/admin/.
   A normal user sees "No access"; the API enforces this too (403).

## 5. Test the API with Scalar (optional)
`npm run dev` in `api/`, open http://localhost:3000/docs. The Bearer field accepts a Supabase `access_token`; get one by calling
`POST {SUPABASE_URL}/auth/v1/token?grant_type=password` with header `apikey: <anon key>`. Don't paste passwords into chats or tickets.

## 6. Hardening checklist (Supabase dashboard)
- **Authentication -> Sign In / Providers -> Email**: turn **Allow new users to sign up** off until the community page exists, so nobody can create accounts with the public anon key.
- Use a long unique password for the admin account and enable MFA if you can.
- Optionally purge old `download_events` rows (for example older than 180 days).
