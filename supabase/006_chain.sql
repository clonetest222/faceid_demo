-- CineVin – migration 006: chuỗi nhiều rạp. Chạy SAU 005. Chạy lại nhiều lần không sao.
--   Tỉnh/Thành → Rạp (mã 3 số) → Phòng → Suất. Giá vé theo rạp (bảng giá jsonb).
--   Nhân viên / quản lý rạp gắn cinema_id; quản lý chuỗi cinema_id = null.
--   Mọi hàm soát vé, bán vé, thêm suất kiểm "đúng rạp" ở máy chủ (wrong_cinema).

create table if not exists public.cinemas (
  id text primary key,                 -- mã rạp 3 số, đi vào mã suất và QR vé
  name text not null, city text not null, district text, address text, hotline text,
  tier text not null default 'B',      -- hạng giá A (Hà Nội, TP.HCM) / B (tỉnh)
  prices jsonb,                        -- bảng giá riêng (ghi đè hạng) – tuỳ chọn
  active boolean not null default true
);
create table if not exists public.rooms (
  id text primary key,                 -- <mã rạp>-R1
  cinema_id text not null references public.cinemas(id) on delete cascade,
  name text not null, kind text not null default '2D' check (kind in ('2D', '3D', 'GOLD')),
  rows int not null, cols int not null, vip int[] not null default '{}'
);
alter table public.shows add column if not exists cinema_id text;
alter table public.shows add column if not exists format text;
create index if not exists shows_cinema_time on public.shows (cinema_id, start_at);
alter table public.app_users add column if not exists cinema_id text;
alter table public.cinemas enable row level security;
alter table public.rooms enable row level security;
drop policy if exists "read_all" on public.cinemas; create policy "read_all" on public.cinemas for select to anon, authenticated using (true);
drop policy if exists "read_all" on public.rooms;   create policy "read_all" on public.rooms for select to anon, authenticated using (true);

-- Tài khoản demo theo rạp
update public.app_users set cinema_id = '086' where username = 'nhanvien' and cinema_id is null;
insert into public.app_users (username, pass_hash, role, display_name, cinema_id)
values ('quanlyvinh', extensions.crypt('quanlyvinh123', extensions.gen_salt('bf', 8)), 'quanly', 'Trần Quốc Bảo', '086')
on conflict (username) do nothing;

-- Phiên: thêm rạp của tài khoản
create or replace function public._session_json(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('token', s.token, 'username', u.username, 'role', u.role, 'name', u.display_name, 'expires_at', s.expires_at,
    'email', u.email, 'phone', u.phone, 'citizen_key', u.citizen_key, 'dob', u.dob, 'vneid_verified_at', u.vneid_verified_at,
    'vneid_method', u.vneid_method, 'points', u.points, 'confirm_every', u.confirm_every, 'cinema_id', u.cinema_id)
  from sessions s join app_users u on u.username = s.username where s.token = p_token;
$$;

-- Danh mục rạp/phòng: máy nào mở web cũng gửi lên, chỉ chèn khi chưa có (idempotent)
create or replace function public.ensure_cinemas(p_cinemas jsonb, p_rooms jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into cinemas (id, name, city, district, address, hotline, tier)
  select x->>'id', x->>'name', x->>'city', x->>'district', x->>'address', x->>'hotline', coalesce(x->>'tier', 'B')
  from jsonb_array_elements(p_cinemas) x on conflict (id) do nothing;
  insert into rooms (id, cinema_id, name, kind, rows, cols, vip)
  select x->>'id', x->>'cinema_id', x->>'name', coalesce(x->>'kind', '2D'), (x->>'rows')::int, (x->>'cols')::int,
         coalesce((select array_agg(v::int) from jsonb_array_elements_text(x->'vip') v), '{}')
  from jsonb_array_elements(p_rooms) x on conflict (id) do nothing;
end $$;

-- mã rạp của phòng "<rạp>-<phòng>"; phòng kiểu cũ "R1" không thuộc rạp nào (null)
create or replace function public._room_cinema(p_room text)
returns text language sql immutable as $$
  select case when p_room like '%-%' then split_part(p_room, '-', 1) end;
$$;

-- Lịch: ghi thêm cinema_id, format
create or replace function public.ensure_schedule(p_shows jsonb, p_sold jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into shows (id, film_id, room_id, cinema_id, format, start_at, end_at)
  select x->>'id', x->>'film_id', x->>'room_id', coalesce(x->>'cinema_id', _room_cinema(x->>'room_id')), x->>'format', (x->>'start_at')::timestamptz, (x->>'end_at')::timestamptz
  from jsonb_array_elements(p_shows) x
  on conflict (id) do nothing;
  insert into seat_locks (show_id, seat, status)
  select x->>'show_id', x->>'seat', 'sold' from jsonb_array_elements(p_sold) x
  where exists (select 1 from shows s where s.id = x->>'show_id' and s.created_at > now() - interval '1 minute')
  on conflict do nothing;
end $$;

-- Rạp của một suất / một vé
create or replace function public._show_cinema(p_show text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(cinema_id, _room_cinema(room_id)) from shows where id = p_show;
$$;
-- Kiểm nhân sự đúng rạp: tài khoản gắn rạp chỉ thao tác suất của rạp đó
create or replace function public._need_cinema(p_token uuid, p_roles text[], p_show text)
returns public.app_users language plpgsql stable security definer set search_path = public as $$
declare u app_users; c text;
begin
  u := _need(p_token, p_roles);
  c := _show_cinema(p_show);
  if u.cinema_id is not null and c is not null and c <> u.cinema_id then raise exception 'wrong_cinema'; end if;
  return u;
end $$;

create or replace function public.admit_ticket_s(p_token uuid, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare sh text;
begin
  select show_id into sh from tickets where code = p_code;
  perform _need_cinema(p_token, array['nhanvien', 'quanly'], sh);
  return admit_ticket(p_code);
end $$;

create or replace function public.admit_many_s(p_token uuid, p_codes text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare c text; out jsonb := '{}'::jsonb; sh text;
begin
  foreach c in array p_codes loop
    select show_id into sh from tickets where code = c;
    perform _need_cinema(p_token, array['nhanvien', 'quanly'], sh);
    out := out || jsonb_build_object(c, admit_ticket(c));
  end loop;
  return out;
end $$;

create or replace function public.scan_member_s(p_token uuid, p_group text, p_card text)
returns text language plpgsql security definer set search_path = public as $$
declare sh text;
begin
  select show_id into sh from groups where code = p_group;
  perform _need_cinema(p_token, array['nhanvien', 'quanly'], sh);
  return scan_member(p_group, p_card);
end $$;

create or replace function public.add_show_s(p_token uuid, p_id text, p_film text, p_room text, p_start timestamptz, p_end timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare u app_users; c text := _room_cinema(p_room); r text;
begin
  u := _need(p_token, array['quanly']);
  if u.cinema_id is not null and c is not null and u.cinema_id <> c then raise exception 'wrong_cinema'; end if;
  r := add_show(p_id, p_film, p_room, p_start, p_end);
  if r is null then update shows set cinema_id = c, format = (select case kind when '3D' then '3D Phụ đề' when 'GOLD' then '2D Phụ đề · Phòng GOLD' else '2D Phụ đề' end from rooms where id = p_room) where id = p_id; end if;
  return r;
end $$;

-- Quản lý tạo tài khoản kèm rạp; quản lý rạp chỉ tạo nhân viên cho rạp mình
drop function if exists public.create_user(uuid, text, text, text, text);
create or replace function public.create_user(p_token uuid, p_user text, p_pass text, p_name text, p_role text, p_cinema text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare u app_users;
begin
  u := _need(p_token, array['quanly']);
  if p_role not in ('khach', 'nhanvien', 'quanly') then raise exception 'bad_role'; end if;
  if lower(trim(p_user)) !~ '^[a-z0-9_.]{3,32}$' then raise exception 'bad_username'; end if;
  if length(coalesce(p_pass, '')) < 6 then raise exception 'weak_password'; end if;
  if u.cinema_id is not null and (p_cinema is null or p_cinema <> u.cinema_id or p_role = 'khach') then raise exception 'wrong_cinema'; end if;
  if p_cinema is not null and not exists (select 1 from cinemas where id = p_cinema) then raise exception 'unknown_cinema'; end if;
  insert into app_users (username, pass_hash, role, display_name, cinema_id)
  values (lower(trim(p_user)), extensions.crypt(p_pass, extensions.gen_salt('bf', 8)), p_role, left(trim(p_name), 60), case when p_role = 'khach' then null else p_cinema end);
exception when unique_violation then raise exception 'username_taken';
end $$;

drop function if exists public.list_users(uuid);
create or replace function public.list_users(p_token uuid)
returns table (username text, role text, display_name text, cinema_id text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['quanly']);
  return query select a.username, a.role, a.display_name, a.cinema_id, a.created_at from app_users a
    where u.cinema_id is null or a.cinema_id = u.cinema_id order by a.role desc, a.username;
end $$;

-- Doanh thu theo rạp trong ngày (cho tổng quan chuỗi)
create or replace function public.chain_stats(p_token uuid, p_day date)
returns table (cinema_id text, shows int, sold int, cap int, revenue numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _need(p_token, array['quanly']);
  return query
    select c.id, count(distinct s.id)::int,
      (select count(*)::int from seat_locks l join shows s2 on s2.id = l.show_id where coalesce(s2.cinema_id, _room_cinema(s2.room_id)) = c.id and l.status = 'sold' and (s2.start_at at time zone 'Asia/Ho_Chi_Minh')::date = p_day),
      (select coalesce(sum(r.rows * r.cols), 0)::int from shows s3 join rooms r on r.id = s3.room_id where coalesce(s3.cinema_id, _room_cinema(s3.room_id)) = c.id and (s3.start_at at time zone 'Asia/Ho_Chi_Minh')::date = p_day),
      (select coalesce(sum(t.price), 0) from tickets t join shows s4 on s4.id = t.show_id where coalesce(s4.cinema_id, _room_cinema(s4.room_id)) = c.id and t.status <> 'refunded' and (s4.start_at at time zone 'Asia/Ho_Chi_Minh')::date = p_day)
    from cinemas c left join shows s on coalesce(s.cinema_id, _room_cinema(s.room_id)) = c.id and (s.start_at at time zone 'Asia/Ho_Chi_Minh')::date = p_day
    group by c.id order by c.id;
end $$;

revoke execute on function public._room_cinema(text), public._show_cinema(text), public._need_cinema(uuid, text[], text) from public, anon, authenticated;
grant execute on function public.ensure_cinemas(jsonb, jsonb), public.create_user(uuid, text, text, text, text, text), public.list_users(uuid), public.chain_stats(uuid, date) to anon, authenticated;
do $$ begin
  alter publication supabase_realtime add table public.cinemas; exception when duplicate_object then null; end $$;
