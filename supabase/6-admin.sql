-- Where's The Vibe: admin history, profile edits that need approval,
-- free events and fuller descriptions.
-- Run AFTER 5-friend-alerts.sql. Paste into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once.

-- True when the request comes from the server (the admin tools), not the app.
create or replace function public.is_service_role()
returns boolean language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
      or coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') = 'service_role';
$$;

-- ---------- Admin history ----------
-- Every approve, decline, edit and delete made in Approvals.
create table if not exists public.admin_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  action text not null,
  target_id uuid,
  title text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_log_created_at on public.admin_log (created_at desc);
alter table public.admin_log enable row level security;
-- No policies: only the server reads and writes this table.

-- When a brand or DJ was last approved or declined.
alter table public.profiles add column if not exists creator_reviewed_at timestamptz;

-- ---------- Profile edits need approval ----------
-- Once a brand or DJ is approved, changes to their public details are saved
-- here and only go live when approved in Approvals.
create table if not exists public.profile_edits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  changes jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create unique index if not exists profile_edits_one_pending on public.profile_edits (user_id) where status = 'pending';
alter table public.profile_edits enable row level security;

drop policy if exists "Read own edits" on public.profile_edits;
create policy "Read own edits" on public.profile_edits
  for select using (auth.uid() = user_id);
drop policy if exists "Send own edits" on public.profile_edits;
create policy "Send own edits" on public.profile_edits
  for insert with check (auth.uid() = user_id and status = 'pending' and reviewed_at is null);
drop policy if exists "Change own pending edit" on public.profile_edits;
create policy "Change own pending edit" on public.profile_edits
  for update using (auth.uid() = user_id and status = 'pending')
  with check (auth.uid() = user_id and status = 'pending' and reviewed_at is null);
drop policy if exists "Withdraw own pending edit" on public.profile_edits;
create policy "Withdraw own pending edit" on public.profile_edits
  for delete using (auth.uid() = user_id and status = 'pending');

-- Approved brands and DJs can't change their public details directly.
-- Only the admin tools (the server) can, which is how approvals and your own
-- edits are applied.
create or replace function public.profiles_lock_approved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_service_role() then
    return new;
  end if;
  if old.account_type in ('brand', 'dj') and old.creator_status = 'approved' and new.account_type <> 'fan' and (
       new.display_name is distinct from old.display_name
    or new.brand_name is distinct from old.brand_name
    or new.username is distinct from old.username
    or new.bio is distinct from old.bio
    or new.avatar_path is distinct from old.avatar_path
    or new.instagram is distinct from old.instagram
    or new.account_type is distinct from old.account_type
  ) then
    raise exception 'Profile changes need approval' using errcode = 'P0001', hint = 'needs_approval';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_lock_approved on public.profiles;
create trigger profiles_lock_approved
  before update on public.profiles
  for each row execute function public.profiles_lock_approved();

-- ---------- Event submissions: free events and fuller descriptions ----------
alter table public.event_submissions add column if not exists price_type text not null default 'paid';
alter table public.event_submissions drop constraint if exists event_submissions_price_type_check;
alter table public.event_submissions add constraint event_submissions_price_type_check
  check (price_type in ('paid', 'free', 'free_before'));
alter table public.event_submissions add column if not exists free_before text;
alter table public.event_submissions add column if not exists start_time text;
alter table public.event_submissions add column if not exists end_time text;
alter table public.event_submissions add column if not exists lineup text;
alter table public.event_submissions add column if not exists music text;
alter table public.event_submissions add column if not exists dress_code text;
alter table public.event_submissions add column if not exists city text;

-- Room for a proper description.
alter table public.event_submissions drop constraint if exists event_submissions_description_check;
alter table public.event_submissions add constraint event_submissions_description_check
  check (description is null or char_length(description) <= 2000);

-- Only the admin tools delete submissions and uploaded events.
drop policy if exists "Delete own submissions" on public.event_submissions;
