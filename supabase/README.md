# Supabase setup

## 1. Run the migrations
Supabase dashboard → **SQL Editor** → New query. Paste and run each file **in order**:

1. `migrations/0001_profiles.sql`
2. `migrations/0002_releases_and_downloads.sql`
3. `migrations/0003_reviews.sql`

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

## 4. Test the API with Scalar
1. Sign in as your admin to get an access token. Quick way: in the SQL-free route, use the Supabase REST call
   `POST {SUPABASE_URL}/auth/v1/token?grant_type=password` with header `apikey: <anon key>` and body `{"email": "...", "password": "..."}`; copy `access_token`.
2. `npm run dev` in `api/`, open http://localhost:3000/docs, paste the token into the Bearer auth field, run `GET /api/admin/ping`. Expect 200; a normal user gets 403.
