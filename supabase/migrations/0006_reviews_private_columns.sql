-- The API reads reviews with the service role and returns only public fields. Direct access with the
-- public anon key would also expose each review's user_id (the author's account id), so remove it.
drop policy if exists "visible reviews are public" on public.reviews;
revoke select on public.reviews from anon, authenticated;
