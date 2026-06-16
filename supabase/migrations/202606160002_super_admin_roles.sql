alter table public.profiles
drop constraint if exists profiles_role_check;

alter table public.profiles
add constraint profiles_role_check
check (role in ('super_admin', 'admin', 'manager', 'employee'));

update public.profiles
set role = 'super_admin'
where employee_id = 'ADMIN001'
  and role = 'admin';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('super_admin', 'admin'), false);
$$;

create or replace function public.is_manager_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('super_admin', 'admin', 'manager'), false);
$$;

create or replace function public.get_dashboard_totals()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with visible_entries as (
    select *
    from public.timesheet_entries
    where user_id = auth.uid() or public.is_manager_or_admin()
  )
  select jsonb_build_object(
    'hours', coalesce(sum(total_hours) filter (
      where date_trunc('month', work_date::timestamp) = date_trunc('month', now())
    ), 0),
    'overtime', coalesce(sum(overtime) filter (
      where date_trunc('month', work_date::timestamp) = date_trunc('month', now())
    ), 0),
    'billable', coalesce(sum(total_hours) filter (where billable), 0),
    'pending', count(*) filter (where approval_status = 'Submitted'),
    'employees', (
      select count(*)
      from public.profiles
      where active and role not in ('super_admin', 'admin')
    )
  )
  from visible_entries;
$$;

create or replace function public.review_timesheet_entry(
  p_id uuid,
  p_approval_status text,
  p_approval_comment text
)
returns public.timesheet_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  reviewer public.profiles;
  result public.timesheet_entries;
begin
  select * into reviewer
  from public.profiles
  where id = auth.uid() and active and role in ('super_admin', 'admin');

  if reviewer.id is null then
    raise exception 'Only admins can approve entries.';
  end if;

  if p_approval_status not in ('Approved', 'Rejected', 'Submitted') then
    raise exception 'Invalid approval status.';
  end if;

  update public.timesheet_entries
  set approval_status = p_approval_status,
      approval_comment = coalesce(trim(p_approval_comment), ''),
      approved_by = reviewer.name,
      approved_at = now()
  where id = p_id
  returning * into result;

  if result.id is null then
    raise exception 'Timesheet entry not found.';
  end if;

  return result;
end;
$$;
