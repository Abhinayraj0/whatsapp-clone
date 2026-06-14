-- Production RLS for authenticated room membership isolation.
-- Assumed tables:
-- public.profiles(id uuid primary key references auth.users(id), email text, full_name text, updated_at timestamptz)
-- public.rooms(id uuid primary key, room_name text, is_group boolean, description text, created_at timestamptz)
-- public.room_members(room_id uuid references public.rooms(id), user_id uuid references auth.users(id), role text, created_at timestamptz)
-- public.messages(id uuid primary key, room_id uuid references public.rooms(id), sender_id uuid references auth.users(id), text text, created_at timestamptz)

alter table public.rooms
add column if not exists room_name text;

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
  end if;
end $$;

alter table public.rooms
alter column room_name set default 'Untitled room';

update public.rooms
set room_name = 'Untitled room'
where room_name is null;

alter table public.rooms
alter column room_name set not null;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = auth.uid());

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

create policy "room_members_select_own_memberships"
on public.room_members
for select
to authenticated
using (user_id = auth.uid());

create policy "rooms_select_member_rooms"
on public.rooms
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members rm
    where rm.room_id = rooms.id
      and rm.user_id = auth.uid()
  )
);

create policy "messages_select_room_members"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.room_members rm
    where rm.room_id = messages.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "messages_insert_room_members_as_self"
on public.messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.room_members rm
    where rm.room_id = messages.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "messages_update_own_room_messages"
on public.messages
for update
to authenticated
using (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.room_members rm
    where rm.room_id = messages.room_id
      and rm.user_id = auth.uid()
  )
)
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.room_members rm
    where rm.room_id = messages.room_id
      and rm.user_id = auth.uid()
  )
);

create policy "messages_delete_own_room_messages"
on public.messages
for delete
to authenticated
using (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.room_members rm
    where rm.room_id = messages.room_id
      and rm.user_id = auth.uid()
  )
);
