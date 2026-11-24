-- PostgreSQL's global default for new functions grants EXECUTE to PUBLIC.
-- A schema-specific default ACL cannot revoke a privilege granted globally, so
-- remove that global default for objects created by the application migration owner.
alter default privileges for role postgres
  revoke execute on functions from public;
