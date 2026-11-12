-- Where's The Vibe: "3 days before" reminder setting.
-- Run AFTER setup.sql and 2-social.sql. Paste into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once.

alter table public.profiles add column if not exists reminder_three_days boolean not null default false;

grant update (reminder_three_days) on public.profiles to authenticated;
