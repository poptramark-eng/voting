-- Never expose invitation token hashes through the public Data API.
revoke all on public.organization_invitations from public, anon, authenticated;
drop policy if exists "organization managers can read invitations" on public.organization_invitations;

create or replace function private.list_organization_invitations(target_org uuid)
returns table (
  id uuid,
  email text,
  role public.organization_member_role,
  status text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if target_org is null
     or not private.has_org_role(
       target_org,
       array['OWNER','ADMIN']::public.organization_member_role[]
     ) then
    raise exception 'Only active organization OWNERs and ADMINs can view invitations'
      using errcode = '42501';
  end if;

  return query
  select i.id, i.email, i.role,
    case
      when i.status = 'PENDING' and i.expires_at <= now() then 'EXPIRED'
      else i.status
    end,
    i.expires_at,
    i.created_at
  from public.organization_invitations i
  where i.organization_id = target_org
  order by i.created_at desc
  limit 100;
end;
$function$;

create or replace function public.list_organization_invitations(target_org uuid)
returns table (
  id uuid,
  email text,
  role public.organization_member_role,
  status text,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select * from private.list_organization_invitations(target_org);
$function$;

revoke all on function private.list_organization_invitations(uuid) from public, anon, authenticated;
grant execute on function private.list_organization_invitations(uuid) to authenticated;
revoke all on function public.list_organization_invitations(uuid) from public, anon;
grant execute on function public.list_organization_invitations(uuid) to authenticated;
