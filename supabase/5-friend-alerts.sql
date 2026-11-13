-- Where's The Vibe: friend request notifications.
-- Run AFTER 4-friends.sql. Paste into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once.

-- Remembers when someone was last notified about a person, so removing and
-- re-adding a friend can't be used to send the same alert over and over.
create table if not exists public.push_log (
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (sender_id, recipient_id, kind)
);
alter table public.push_log enable row level security;
-- No policies: only the server reads and writes this table.
