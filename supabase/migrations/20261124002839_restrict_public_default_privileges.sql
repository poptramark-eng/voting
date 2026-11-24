-- This Auth0-backed application has no anonymous ballot/read surface yet.
-- Remove existing anon Data API grants and require explicit grants for future objects.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

-- All current application objects are owned by postgres. Future objects created by
-- postgres must receive explicit reviewed grants in their creating migration.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
