-- Where's The Vibe: accounts, saved events and event submissions.
-- Paste this whole file into Supabase > SQL Editor > New query, then Run.
-- Safe to run more than once.

-- Profiles: one row per account, created automatically on sign-up.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  account_type text not null default 'fan' check (account_type in ('fan', 'brand')),
  brand_name text,
  instagram text,
  favourite_types text[] not null default '{}',
  favourite_areas text[] not null default '{}',
  open_with_favourites boolean not null default false,
  reminder_day_before boolean not null default true,
  reminder_on_day boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Saved events, synced across devices.
create table if not exists public.saved_events (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_key text not null,
  event jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, event_key)
);

-- Events uploaded by brands. Nothing is public until approved.
create table if not exists public.event_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  title text not null check (char_length(title) between 3 and 140),
  event_type text not null,
  event_date date not null,
  location text not null check (char_length(location) between 4 and 200),
  age_range text not null default '18+',
  price text,
  ticket_url text,
  description text check (char_length(description) <= 600),
  tags text,
  instagram text,
  contact_email text,
  flyer_path text,
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.profiles enable row level security;
alter table public.saved_events enable row level security;
alter table public.event_submissions enable row level security;

drop policy if exists "Own profile" on public.profiles;
create policy "Own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Own saved events" on public.saved_events;
create policy "Own saved events" on public.saved_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Read own submissions" on public.event_submissions;
create policy "Read own submissions" on public.event_submissions
  for select using (auth.uid() = user_id);

drop policy if exists "Submit as pending" on public.event_submissions;
create policy "Submit as pending" on public.event_submissions
  for insert with check (auth.uid() = user_id and status = 'pending' and reviewed_at is null);

-- Flyer images: anyone can view, signed-in users upload into their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flyers', 'flyers', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "Upload own flyers" on storage.objects;
create policy "Upload own flyers" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'flyers' and (storage.foldername(name))[1] = auth.uid()::text);
