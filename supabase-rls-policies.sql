-- Supabase setup for Forge.
-- Run this in Supabase SQL Editor after creating/authenticating the project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  updated_at timestamptz default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists updated_at timestamptz default now();

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  room_name text not null default 'Untitled room',
  is_group boolean not null default false,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.room_members add column if not exists role text;
alter table public.room_members add column if not exists created_at timestamptz default now();

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

alter table public.messages add column if not exists sender_id uuid;
alter table public.messages add column if not exists text text;
alter table public.messages add column if not exists created_at timestamptz default now();

alter table public.rooms add column if not exists room_name text;
alter table public.rooms add column if not exists is_group boolean default false;
alter table public.rooms add column if not exists description text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rooms'
      and column_name = 'name'
  ) then
    update public.rooms
    set room_name = coalesce(room_name, name)
    where room_name is null;

    update public.rooms
    set name = coalesce(name, room_name, 'Untitled room')
    where name is null;

    alter table public.rooms alter column name set default 'Untitled room';
  end if;
end $$;

update public.rooms
set room_name = 'Untitled room'
where room_name is null;

update public.rooms
set is_group = false
where is_group is null;

update public.room_members
set role = 'member'
where role is null;

update public.room_members
set created_at = now()
where created_at is null;

update public.messages
set created_at = now()
where created_at is null;

alter table public.rooms alter column room_name set default 'Untitled room';
alter table public.rooms alter column room_name set not null;
alter table public.rooms alter column is_group set default false;
alter table public.rooms alter column is_group set not null;
alter table public.room_members alter column role set default 'member';
alter table public.room_members alter column role set not null;
alter table public.room_members alter column created_at set default now();
alter table public.room_members alter column created_at set not null;
alter table public.messages alter column created_at set default now();
alter table public.messages alter column created_at set not null;

create index if not exists profiles_email_idx on public.profiles (lower(email));
create index if not exists room_members_user_id_idx on public.room_members (user_id);
create index if not exists room_members_room_id_idx on public.room_members (room_id);
create index if not exists messages_room_created_idx on public.messages (room_id, created_at);

insert into public.profiles (id, email, full_name, updated_at)
select
  users.id,
  users.email,
  coalesce(users.raw_user_meta_data->>'full_name', split_part(users.email, '@', 1), 'Member'),
  now()
from auth.users
where users.email is not null
on conflict (id) do update
set
  email = excluded.email,
  full_name = coalesce(public.profiles.full_name, excluded.full_name),
  updated_at = now();

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, updated_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1), 'Member'),
    now()
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;

create trigger on_auth_user_created_profile
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_user_profile();

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;

create or replace function public.is_room_member(target_room_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_members rm
    where rm.room_id = target_room_id
      and rm.user_id = auth.uid()
  );
$$;

grant execute on function public.is_room_member(uuid) to authenticated;

create or replace function public.search_users_by_email(search_email text)
returns table (
  id uuid,
  email text,
  full_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if length(trim(coalesce(search_email, ''))) < 3 then
    return;
  end if;

  insert into public.profiles (id, email, full_name, updated_at)
  select
    users.id,
    users.email,
    coalesce(users.raw_user_meta_data->>'full_name', split_part(users.email, '@', 1), 'Member'),
    now()
  from auth.users
  where users.email ilike '%' || trim(search_email) || '%'
    and users.email is not null
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    updated_at = now();

  return query
  select
    users.id,
    users.email::text,
    coalesce(profiles.full_name, users.raw_user_meta_data->>'full_name', split_part(users.email, '@', 1), 'Member')::text
  from auth.users
  left join public.profiles on profiles.id = users.id
  where users.id <> auth.uid()
    and users.email ilike '%' || trim(search_email) || '%'
  order by users.email
  limit 8;
end;
$$;

grant execute on function public.search_users_by_email(text) to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "room_members_select_own_memberships" on public.room_members;
drop policy if exists "room_members_select_room_participants" on public.room_members;
drop policy if exists "room_members_insert_self_or_room_member" on public.room_members;
drop policy if exists "rooms_select_member_rooms" on public.rooms;
drop policy if exists "rooms_insert_authenticated" on public.rooms;
drop policy if exists "messages_select_room_members" on public.messages;
drop policy if exists "messages_insert_room_members_as_self" on public.messages;
drop policy if exists "messages_update_own_room_messages" on public.messages;
drop policy if exists "messages_delete_own_room_messages" on public.messages;

create policy "profiles_select_authenticated"
on public.profiles
for select
to authenticated
using (true);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "rooms_select_member_rooms"
on public.rooms
for select
to authenticated
using (
  public.is_room_member(rooms.id)
);

create policy "rooms_insert_authenticated"
on public.rooms
for insert
to authenticated
with check (true);

create policy "room_members_select_room_participants"
on public.room_members
for select
to authenticated
using (
  public.is_room_member(room_members.room_id)
);

create policy "room_members_insert_self_or_room_member"
on public.room_members
for insert
to authenticated
with check (
  user_id = auth.uid()
  or public.is_room_member(room_members.room_id)
);

create policy "messages_select_room_members"
on public.messages
for select
to authenticated
using (
  public.is_room_member(messages.room_id)
);

create policy "messages_insert_room_members_as_self"
on public.messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and public.is_room_member(messages.room_id)
);

create policy "messages_update_own_room_messages"
on public.messages
for update
to authenticated
using (
  sender_id = auth.uid()
  and public.is_room_member(messages.room_id)
)
with check (
  sender_id = auth.uid()
  and public.is_room_member(messages.room_id)
);

create policy "messages_delete_own_room_messages"
on public.messages
for delete
to authenticated
using (
  sender_id = auth.uid()
  and public.is_room_member(messages.room_id)
);

create or replace function public.create_direct_chat(friend_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  existing_room_id uuid;
  new_room_id uuid;
  friend_email text;
  friend_name text;
  has_room_name boolean;
  has_name boolean;
  has_member_role boolean;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if friend_user_id is null or friend_user_id = current_user_id then
    raise exception 'Choose another user to chat with';
  end if;

  select email, full_name into friend_email, friend_name
  from public.profiles
  where id = friend_user_id;

  if friend_email is null then
    raise exception 'Friend profile not found';
  end if;

  select rm1.room_id into existing_room_id
  from public.room_members rm1
  join public.room_members rm2 on rm2.room_id = rm1.room_id
  join public.rooms r on r.id = rm1.room_id
  where rm1.user_id = current_user_id
    and rm2.user_id = friend_user_id
    and r.is_group = false
    and (
      select count(*)
      from public.room_members rm_count
      where rm_count.room_id = rm1.room_id
    ) = 2
  limit 1;

  if existing_room_id is not null then
    return existing_room_id;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rooms'
      and column_name = 'room_name'
  ) into has_room_name;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rooms'
      and column_name = 'name'
  ) into has_name;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'room_members'
      and column_name = 'role'
  ) into has_member_role;

  if has_room_name and has_name then
    insert into public.rooms (name, room_name, is_group, description)
    values (
      coalesce(friend_name, split_part(friend_email, '@', 1), 'Direct chat'),
      coalesce(friend_name, split_part(friend_email, '@', 1), 'Direct chat'),
      false,
      'Private one-to-one conversation'
    )
    returning id into new_room_id;
  elsif has_room_name then
    insert into public.rooms (room_name, is_group, description)
    values (
      coalesce(friend_name, split_part(friend_email, '@', 1), 'Direct chat'),
      false,
      'Private one-to-one conversation'
    )
    returning id into new_room_id;
  elsif has_name then
    insert into public.rooms (name, is_group, description)
    values (
      coalesce(friend_name, split_part(friend_email, '@', 1), 'Direct chat'),
      false,
      'Private one-to-one conversation'
    )
    returning id into new_room_id;
  else
    insert into public.rooms default values
    returning id into new_room_id;
  end if;

  if has_member_role then
    insert into public.room_members (room_id, user_id, role)
    values
      (new_room_id, current_user_id, 'owner'),
      (new_room_id, friend_user_id, 'member')
    on conflict do nothing;
  else
    insert into public.room_members (room_id, user_id)
    values
      (new_room_id, current_user_id),
      (new_room_id, friend_user_id)
    on conflict do nothing;
  end if;

  return new_room_id;
end;
$$;

grant execute on function public.create_direct_chat(uuid) to authenticated;
