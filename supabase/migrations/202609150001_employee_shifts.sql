alter table public.profiles
  add column if not exists shift_start_time time not null default '09:00',
  add column if not exists shift_end_time time not null default '17:30';

alter table public.profiles
  drop constraint if exists profiles_shift_time_check;

alter table public.profiles
  add constraint profiles_shift_time_check
  check (shift_start_time < shift_end_time);
