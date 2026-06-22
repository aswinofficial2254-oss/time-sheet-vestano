create or replace function public.delete_timesheet_entry(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_role text;
begin
  select role
  into current_role
  from public.profiles
  where id = auth.uid();

  delete from public.timesheet_entries
  where id = p_id
    and (
      current_role = 'super_admin'
      or (
        user_id = auth.uid()
        and approval_status <> 'Approved'
      )
    );

  if not found then
    raise exception 'This entry cannot be deleted.';
  end if;

  return true;
end;
$$;

