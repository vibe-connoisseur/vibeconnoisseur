-- Where's The Vibe: brand and DJ profiles, follows, posts, reports and blocks.
-- Run AFTER setup.sql. Paste into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once.

-- ---------- Profiles: brand / DJ fields ----------

alter table public.profiles drop constraint if exists profiles_account_type_check;
alter table public.profiles add constraint profiles_account_type_check
  check (account_type in ('fan', 'brand', 'dj'));

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists creator_status text not null default 'none';
alter table public.profiles add column if not exists terms_accepted_at timestamptz;

alter table public.profiles drop constraint if exists profiles_creator_status_check;
alter table public.profiles add constraint profiles_creator_status_check
  check (creator_status in ('none', 'pending', 'approved', 'rejected'));
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9._]{3,30}$');
alter table public.profiles drop constraint if exists profiles_bio_length;
alter table public.profiles add constraint profiles_bio_length
  check (bio is null or char_length(bio) <= 300);

create unique index if not exists profiles_username_key on public.profiles (lower(username));

-- People can edit their own profile, but only these columns. Approval
-- (creator_status) can only be changed by the admin tools.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, account_type, brand_name, instagram, username, bio, avatar_path,
  favourite_types, favourite_areas, open_with_favourites, reminder_day_before, reminder_on_day,
  terms_accepted_at, updated_at)
  on public.profiles to authenticated;

-- Switching to Brand or DJ sends the profile for approval; switching back
-- to a normal account clears it.
create or replace function public.profiles_creator_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.account_type = 'fan' then
    new.creator_status := 'none';
  elsif tg_op = 'INSERT' or old.account_type is distinct from new.account_type
        or old.creator_status in ('none', 'rejected') then
    if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
       and coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') <> 'service_role' then
      new.creator_status := 'pending';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_creator_status on public.profiles;
create trigger profiles_creator_status
  before insert or update of account_type on public.profiles
  for each row execute function public.profiles_creator_status();

-- ---------- Follows ----------

create table if not exists public.follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  creator_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, creator_id),
  check (follower_id <> creator_id)
);
create index if not exists follows_creator_idx on public.follows (creator_id);

alter table public.follows enable row level security;
drop policy if exists "Own follows" on public.follows;
create policy "Own follows" on public.follows
  for all using (auth.uid() = follower_id) with check (auth.uid() = follower_id);

-- ---------- Posts (photos and videos) ----------

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  caption text check (caption is null or char_length(caption) <= 2200),
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) between 1 and 10),
  created_at timestamptz not null default now()
);
create index if not exists posts_creator_idx on public.posts (creator_id, created_at desc);

create or replace function public.is_approved_creator(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = uid and account_type in ('brand', 'dj') and creator_status = 'approved');
$$;

alter table public.posts enable row level security;
drop policy if exists "Anyone can see approved creators' posts" on public.posts;
create policy "Anyone can see approved creators' posts" on public.posts
  for select using (public.is_approved_creator(creator_id));
drop policy if exists "Approved creators post" on public.posts;
create policy "Approved creators post" on public.posts
  for insert with check (auth.uid() = creator_id and public.is_approved_creator(auth.uid()));
drop policy if exists "Creators delete own posts" on public.posts;
create policy "Creators delete own posts" on public.posts
  for delete using (auth.uid() = creator_id);

-- ---------- Public profiles with counts ----------
-- Only approved brands and DJs, and only public fields.

drop view if exists public.creator_profiles;
create view public.creator_profiles as
  select
    p.id,
    p.username,
    coalesce(nullif(p.brand_name, ''), p.display_name, p.username) as name,
    p.account_type,
    p.bio,
    p.avatar_path,
    lower(regexp_replace(coalesce(p.instagram, ''), '^@', '')) as instagram,
    p.created_at,
    (select count(*) from public.follows f where f.creator_id = p.id)::int as followers_count,
    (select count(*) from public.follows f where f.follower_id = p.id)::int as following_count,
    (select count(*) from public.posts po where po.creator_id = p.id)::int as posts_count
  from public.profiles p
  where p.account_type in ('brand', 'dj') and p.creator_status = 'approved';

grant select on public.creator_profiles to anon, authenticated;

-- ---------- Reports and blocks (required by Apple for user posts) ----------

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  post_id uuid references public.posts (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 2 and 300),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  check (post_id is not null or profile_id is not null)
);
alter table public.reports enable row level security;
drop policy if exists "Report as yourself" on public.reports;
create policy "Report as yourself" on public.reports
  for insert with check (auth.uid() = reporter_id and status = 'open');

create table if not exists public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
alter table public.blocks enable row level security;
drop policy if exists "Own blocks" on public.blocks;
create policy "Own blocks" on public.blocks
  for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- ---------- Photo and video storage ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Upload own media" on storage.objects;
create policy "Upload own media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Delete own media" on storage.objects;
create policy "Delete own media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
