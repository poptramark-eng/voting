create index organization_invitations_invited_by_idx
  on public.organization_invitations(invited_by);
create index organization_invitations_accepted_by_idx
  on public.organization_invitations(accepted_by)
  where accepted_by is not null;
create index organization_invitations_revoked_by_idx
  on public.organization_invitations(revoked_by)
  where revoked_by is not null;
