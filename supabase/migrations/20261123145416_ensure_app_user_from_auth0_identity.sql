-- Provision the internal application identity from the verified Auth0 ID token.
-- The client cannot choose the subject or write directly to app_users.
create or replace function public.ensure_app_user()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  token_claims jsonb := auth.jwt();
  subject text;
  user_email text;
  user_name text;
  application_user_id uuid;
begin
  if token_claims ->> 'role' is distinct from 'authenticated' then
    raise exception 'Authenticated identity token required' using errcode = '28000';
  end if;

  subject := token_claims ->> 'sub';
  user_email := nullif(token_claims ->> 'email', '');
  user_name := nullif(token_claims ->> 'name', '');

  if subject is null or length(trim(subject)) = 0 then
    raise exception 'Identity subject is required' using errcode = '28000';
  end if;

  insert into public.app_users (auth_subject, email, display_name)
  values (subject, user_email, user_name)
  on conflict (auth_subject) do update
    set email = excluded.email,
        display_name = excluded.display_name,
        updated_at = now()
  returning id into application_user_id;

  return application_user_id;
end;
$function$;

revoke all on function public.ensure_app_user() from public, anon;
grant execute on function public.ensure_app_user() to authenticated;
