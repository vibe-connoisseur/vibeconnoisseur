-- Where's The Vibe: friends (mutual follows), sharing saved events with
-- friends, and phone tokens for push notifications.
-- Run AFTER setup.sql, 2-social.sql and 3-reminders.sql.
-- Paste into Supabase > SQL Editor > New query > Run. Safe to run more than once.

-- Anyone can now have a username so friends can find them, and choose
-- whether friends see what they save.
alter table public.profiles add column if not exists share_activity boolean not null default true;
grant update (share_activity) on public.profiles to authenticated;

-- People search: only the public basics, only for signed-in users.
drop view if exists public.people;
create view public.people as
  select
    p.id,
    p.username,
    coalesce(nullif(p.brand_name, ''), nullif(p.display_name, ''), p.username) as name,
    p.account_type,
    (p.account_type in ('brand', 'dj') and p.creator_status = 'approved') as is_creator,
    p.avatar_path
  from public.profiles p
  where p.username is not null;

revoke all on public.people from anon;
grant select on public.people to authenticated;

-- Follows: people can also see who follows them (friend requests).
drop policy if exists "See who follows me" on public.follows;
create policy "See who follows me" on public.follows
  for select using (auth.uid() = creator_id);

-- Friends = both follow each other.
create or replace function public.is_friend(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.follows where follower_id = a and creator_id = b)
     and exists (select 1 from public.follows where follower_id = b and creator_id = a);
$$;

create or replace function public.shares_activity(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select share_activity from public.profiles where id = uid), false);
$$;

-- Friends can see each other's saved events, unless sharing is switched off.
alter table public.saved_events add column if not exists notified_at timestamptz;

drop policy if exists "Friends see shared saves" on public.saved_events;
create policy "Friends see shared saves" on public.saved_events
  for select using (
    auth.uid() is not null
    and public.is_friend(user_id, auth.uid())
    and public.shares_activity(user_id)
    and not exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = saved_events.user_id)
  );

-- Phone tokens for push notifications. Only the server reads and writes these.
create table if not exists public.device_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null default 'ios',
  updated_at timestamptz not null default now()
);
create index if not exists device_tokens_user_idx on public.device_tokens (user_id);
alter table public.device_tokens enable row level security;
