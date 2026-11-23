revoke all on function public.create_organization(text, text) from anon;
revoke all on function public.has_org_role(uuid, public.organization_member_role[]) from anon;
revoke all on function public.is_active_org_member(uuid) from anon;

grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.has_org_role(uuid, public.organization_member_role[]) to authenticated;
grant execute on function public.is_active_org_member(uuid) to authenticated;