-- CineVin – migration 008: quản trị chuỗi. Chạy SAU 007. Chạy lại nhiều lần không sao.
--   Cơ sở & phòng: thêm/sửa/xoá, phòng bảo trì, ghế khoá, loại phòng IMAX.
--   Kho phim dùng chung + phân phối phim cho từng cơ sở.
--   Suất chiếu: đổi giờ / đổi phòng / huỷ suất (hoàn tiền vào thẻ quà tặng của từng khách).
--   Vai trò kỹ thuật (phòng chiếu, ghế); nhật ký đăng nhập và thao tác quản trị trong audit_logs.

-- ---------- vai trò kỹ thuật ----------
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role in ('khach', 'nhanvien', 'kythuat', 'quanly'));
insert into public.app_users (username, pass_hash, role, display_name, cinema_id)
values ('kythuat', extensions.crypt('kythuat123', extensions.gen_salt('bf', 8)), 'kythuat', 'Hoàng Văn Kỹ', '086')
on conflict (username) do nothing;

-- ---------- phòng: loại IMAX, ghế khoá, bảo trì ----------
alter table public.rooms drop constraint if exists rooms_kind_check;
alter table public.rooms add constraint rooms_kind_check check (kind in ('2D', '3D', 'GOLD', 'IMAX'));
alter table public.rooms add column if not exists blocked text[] not null default '{}';   -- ghế hỏng/bảo trì: không bán
alter table public.rooms add column if not exists active boolean not null default true;   -- false = phòng tạm ngưng
alter table public.rooms add column if not exists note text;
alter table public.shows add column if not exists status text not null default 'on';     -- on | cancelled
alter table public.shows add column if not exists cancel_reason text;

-- ---------- kho phim & phân phối ----------
create table if not exists public.films (
  id text primary key, title text not null, rating text not null default 'P' check (rating in ('P', 'K', 'T13', 'T16', 'T18')),
  dur int not null default 100 check (dur between 30 and 300), genre text, img text, active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.cinema_films (
  cinema_id text not null references public.cinemas(id) on delete cascade,
  film_id text not null references public.films(id) on delete cascade,
  active boolean not null default true,
  primary key (cinema_id, film_id)
);
alter table public.films enable row level security;
alter table public.cinema_films enable row level security;
drop policy if exists "read_all" on public.films;        create policy "read_all" on public.films for select to anon, authenticated using (true);
drop policy if exists "read_all" on public.cinema_films; create policy "read_all" on public.cinema_films for select to anon, authenticated using (true);
do $$ begin alter publication supabase_realtime add table public.films; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.cinema_films; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.rooms; exception when duplicate_object then null; end $$;

-- Kho phim mẫu: chỉ chèn khi chưa có; phim mẫu được phân phối cho mọi rạp (chỉ lần đầu – quản lý bỏ phân phối thì giữ nguyên)
create or replace function public.ensure_films(p_films jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into films (id, title, rating, dur, genre, img)
  select x->>'id', x->>'title', coalesce(x->>'rating', 'P'), coalesce((x->>'dur')::int, 100), x->>'genre', x->>'img'
  from jsonb_array_elements(p_films) x on conflict (id) do nothing;
  insert into cinema_films (cinema_id, film_id)
  select c.id, x->>'id' from cinemas c cross join jsonb_array_elements(p_films) x on conflict do nothing;
end $$;

-- ---------- quyền theo rạp ----------
create or replace function public._need_mine(p_token uuid, p_roles text[], p_cinema text)
returns public.app_users language plpgsql stable security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, p_roles);
  if u.cinema_id is not null and (p_cinema is null or p_cinema <> u.cinema_id) then raise exception 'wrong_cinema'; end if;
  return u;
end $$;
create or replace function public._admin_log(p_user text, p_msg text)
returns void language sql security definer set search_path = public as $$
  insert into audit_logs (type, msg, ok) values ('admin', left('@' || p_user || ': ' || p_msg, 300), true);
$$;

-- ---------- cơ sở ----------
create or replace function public.save_cinema_s(p_token uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; v_id text := p->>'id';
begin
  u := _need_mine(p_token, array['quanly'], v_id);
  if v_id !~ '^[0-9]{3}$' then raise exception 'bad_cinema_id'; end if;
  if length(trim(coalesce(p->>'name', ''))) < 3 or length(trim(coalesce(p->>'city', ''))) < 2 then raise exception 'bad_input'; end if;
  if u.cinema_id is not null and not exists (select 1 from cinemas where cinemas.id = p->>'id') then raise exception 'wrong_cinema'; end if;
  insert into cinemas (id, name, city, district, address, hotline, tier, active)
  values (v_id, trim(p->>'name'), trim(p->>'city'), p->>'district', p->>'address', p->>'hotline', coalesce(p->>'tier', 'B'), coalesce((p->>'active')::boolean, true))
  on conflict (id) do update set name = excluded.name, city = excluded.city, district = excluded.district, address = excluded.address, hotline = excluded.hotline, tier = excluded.tier, active = excluded.active;
  perform _admin_log(u.username, format('lưu cơ sở %s %s', v_id, trim(p->>'name')));
end $$;

create or replace function public.delete_cinema_s(p_token uuid, p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['quanly']);
  if u.cinema_id is not null then raise exception 'forbidden'; end if;
  if exists (select 1 from tickets t join shows s on s.id = t.show_id where coalesce(s.cinema_id, _room_cinema(s.room_id)) = p_id) then raise exception 'cinema_in_use'; end if;
  delete from seat_locks where show_id in (select id from shows where coalesce(cinema_id, _room_cinema(room_id)) = p_id);
  delete from shows where coalesce(cinema_id, _room_cinema(room_id)) = p_id;
  update app_users set cinema_id = null where cinema_id = p_id;
  delete from cinemas where id = p_id;
  perform _admin_log(u.username, 'xoá cơ sở ' || p_id);
end $$;

-- ---------- phòng (quản lý hoặc kỹ thuật của rạp) ----------
create or replace function public.save_room_s(p_token uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; v_cid text := p->>'cinema_id'; v_id text := p->>'id'; nr int := (p->>'rows')::int; nc int := (p->>'cols')::int; old rooms;
begin
  u := _need_mine(p_token, array['quanly', 'kythuat'], v_cid);
  if v_id is null or v_id !~ ('^' || v_cid || '-[A-Za-z0-9]{1,6}$') then raise exception 'bad_room_id'; end if;
  if nr not between 1 and 26 or nc not between 1 and 30 then raise exception 'bad_size'; end if;
  select * into old from rooms where rooms.id = v_id;
  if old.id is not null and (nr < old.rows or nc < old.cols) and exists (
      select 1 from seat_locks l join shows s on s.id = l.show_id
      where s.room_id = v_id and l.status = 'sold' and s.start_at > now()
        and (ascii(left(l.seat, 1)) - 64 > nr or substr(l.seat, 2)::int > nc)) then raise exception 'seats_sold'; end if;
  insert into rooms (id, cinema_id, name, kind, rows, cols, vip, blocked, active, note)
  values (v_id, v_cid, coalesce(trim(p->>'name'), v_id), coalesce(p->>'kind', '2D'), nr, nc,
          coalesce((select array_agg(v::int) from jsonb_array_elements_text(p->'vip') v), '{}'),
          coalesce((select array_agg(upper(v)) from jsonb_array_elements_text(p->'blocked') v), '{}'),
          coalesce((p->>'active')::boolean, true), p->>'note')
  on conflict (id) do update set name = excluded.name, kind = excluded.kind, rows = excluded.rows, cols = excluded.cols, vip = excluded.vip,
    blocked = excluded.blocked, active = excluded.active, note = excluded.note;
  perform _admin_log(u.username, format('lưu phòng %s (%s, %s×%s, khoá %s ghế%s)', v_id, coalesce(p->>'kind', '2D'), nr, nc,
    coalesce(jsonb_array_length(p->'blocked'), 0), case when coalesce((p->>'active')::boolean, true) then '' else ', tạm ngưng' end));
end $$;

create or replace function public.delete_room_s(p_token uuid, p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _need_mine(p_token, array['quanly'], _room_cinema(p_id));
  if exists (select 1 from tickets t join shows s on s.id = t.show_id where s.room_id = p_id and t.status <> 'refunded' and s.end_at > now()) then raise exception 'room_in_use'; end if;
  delete from seat_locks where show_id in (select id from shows where room_id = p_id);
  delete from shows where room_id = p_id;
  delete from rooms where id = p_id;
  perform _admin_log(u.username, 'xoá phòng ' || p_id);
end $$;

-- ---------- phim ----------
create or replace function public.save_film_s(p_token uuid, p jsonb, p_cinemas text[] default null)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; v_id text := p->>'id';
begin
  u := _need(p_token, array['quanly']);
  if u.cinema_id is not null then raise exception 'forbidden'; end if;   -- kho phim dùng chung: quản lý chuỗi
  if v_id !~ '^[a-z0-9_]{1,20}$' or length(trim(coalesce(p->>'title', ''))) < 1 then raise exception 'bad_input'; end if;
  insert into films (id, title, rating, dur, genre, img, active)
  values (v_id, trim(p->>'title'), coalesce(p->>'rating', 'P'), coalesce((p->>'dur')::int, 100), p->>'genre', nullif(p->>'img', ''), coalesce((p->>'active')::boolean, true))
  on conflict (id) do update set title = excluded.title, rating = excluded.rating, dur = excluded.dur, genre = excluded.genre, img = excluded.img, active = excluded.active;
  if p_cinemas is not null then
    insert into cinema_films (cinema_id, film_id, active) select c.id, v_id, c.id = any(p_cinemas) from cinemas c
    on conflict (cinema_id, film_id) do update set active = excluded.active;
  end if;
  perform _admin_log(u.username, format('lưu phim %s "%s" (%s)', v_id, trim(p->>'title'), coalesce(p->>'rating', 'P')));
end $$;

create or replace function public.set_film_cinema_s(p_token uuid, p_film text, p_cinema text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _need_mine(p_token, array['quanly'], p_cinema);
  insert into cinema_films (cinema_id, film_id, active) values (p_cinema, p_film, p_active)
  on conflict (cinema_id, film_id) do update set active = excluded.active;
  perform _admin_log(u.username, format('%s phim %s %s rạp %s', case when p_active then 'phân phối' else 'bỏ' end, p_film, case when p_active then 'cho' else 'khỏi' end, p_cinema));
end $$;

-- ---------- suất: thêm (kiểm phân phối + phòng hoạt động), đổi, huỷ ----------
create or replace function public.add_show_s(p_token uuid, p_id text, p_film text, p_room text, p_start timestamptz, p_end timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare u app_users; c text := _room_cinema(p_room); r text; rm rooms;
begin
  u := _need(p_token, array['quanly']);
  if u.cinema_id is not null and c is not null and u.cinema_id <> c then raise exception 'wrong_cinema'; end if;
  select * into rm from rooms where id = p_room;
  if rm.id is not null and not rm.active then raise exception 'room_inactive'; end if;
  if exists (select 1 from cinema_films cf where cf.cinema_id = c and cf.film_id = p_film and not cf.active) then raise exception 'film_not_at_cinema'; end if;
  if exists (select 1 from films f where f.id = p_film and not f.active) then raise exception 'film_inactive'; end if;
  r := add_show(p_id, p_film, p_room, p_start, p_end);
  if r is null then update shows set cinema_id = c, format = (select case kind when '3D' then '3D Phụ đề' when 'GOLD' then '2D Phụ đề · Phòng GOLD' when 'IMAX' then 'IMAX 2D' else '2D Phụ đề' end from rooms where id = p_room) where id = p_id;
    perform _admin_log(u.username, format('thêm suất %s phim %s phòng %s lúc %s', p_id, p_film, p_room, to_char(p_start at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI'))); end if;
  return r;
end $$;

-- Đổi giờ / đổi phòng. Trả về mã suất bị trùng (null = đã đổi). Đã bán vé thì chỉ đổi giờ, không đổi phòng (ghế theo phòng).
create or replace function public.update_show_s(p_token uuid, p_id text, p_room text, p_start timestamptz, p_end timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare u app_users; s shows; c shows; rm rooms;
begin
  select * into s from shows where id = p_id;
  if s.id is null then raise exception 'unknown_show'; end if;
  u := _need_mine(p_token, array['quanly'], coalesce(s.cinema_id, _room_cinema(s.room_id)));
  if _room_cinema(p_room) is distinct from coalesce(s.cinema_id, _room_cinema(s.room_id)) then raise exception 'wrong_cinema'; end if;
  if s.status = 'cancelled' then raise exception 'show_cancelled'; end if;
  select * into rm from rooms where id = p_room;
  if rm.id is not null and not rm.active then raise exception 'room_inactive'; end if;
  if p_room <> s.room_id and exists (select 1 from tickets t where t.show_id = p_id and t.status <> 'refunded') then raise exception 'has_tickets'; end if;
  select * into c from shows x where x.room_id = p_room and x.id <> p_id and x.status = 'on' and x.start_at < p_end and x.end_at > p_start limit 1;
  if found then return c.id; end if;
  update shows set room_id = p_room, start_at = p_start, end_at = p_end,
    format = coalesce((select case kind when '3D' then '3D Phụ đề' when 'GOLD' then '2D Phụ đề · Phòng GOLD' when 'IMAX' then 'IMAX 2D' else '2D Phụ đề' end from rooms where id = p_room), format)
  where id = p_id;
  perform _admin_log(u.username, format('đổi suất %s → phòng %s lúc %s', p_id, p_room, to_char(p_start at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI')));
  return null;
end $$;

-- Huỷ suất: mọi vé còn hiệu lực được hoàn vào thẻ quà tặng của người mua; nhả hết ghế. Trả về số vé đã hoàn.
create or replace function public.cancel_show_s(p_token uuid, p_id text, p_reason text default null)
returns int language plpgsql security definer set search_path = public as $$
declare u app_users; s shows; t tickets; n int := 0;
begin
  select * into s from shows where id = p_id;
  if s.id is null then raise exception 'unknown_show'; end if;
  u := _need_mine(p_token, array['quanly'], coalesce(s.cinema_id, _room_cinema(s.room_id)));
  if s.status = 'cancelled' then raise exception 'show_cancelled'; end if;
  for t in select * from tickets where show_id = p_id and status = 'valid' loop
    if refund_ticket(t.code) then
      n := n + 1;
      if t.owner_user is not null then
        insert into vouchers (code, kind, amount, owner_user, expires_at)
        values ('GC' || upper(substr(md5(random()::text || t.code), 1, 6)), 'gift', t.price, t.owner_user, now() + interval '180 days');
      end if;
    end if;
  end loop;
  delete from seat_locks where show_id = p_id;
  update shows set status = 'cancelled', cancel_reason = left(p_reason, 200) where id = p_id;
  perform _admin_log(u.username, format('huỷ suất %s (%s): hoàn %s vé%s', p_id, coalesce(p_reason, 'không ghi lý do'), n, case when n > 0 then ' vào thẻ quà tặng' else '' end));
  return n;
end $$;

-- ---------- tài khoản: thêm vai trò kỹ thuật ----------
create or replace function public.create_user(p_token uuid, p_user text, p_pass text, p_name text, p_role text, p_cinema text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare u app_users;
begin
  u := _need(p_token, array['quanly']);
  if p_role not in ('khach', 'nhanvien', 'kythuat', 'quanly') then raise exception 'bad_role'; end if;
  if lower(trim(p_user)) !~ '^[a-z0-9_.]{3,32}$' then raise exception 'bad_username'; end if;
  if length(coalesce(p_pass, '')) < 6 then raise exception 'weak_password'; end if;
  if u.cinema_id is not null and (p_cinema is null or p_cinema <> u.cinema_id or p_role = 'khach') then raise exception 'wrong_cinema'; end if;
  if p_cinema is not null and not exists (select 1 from cinemas where id = p_cinema) then raise exception 'unknown_cinema'; end if;
  insert into app_users (username, pass_hash, role, display_name, cinema_id)
  values (lower(trim(p_user)), extensions.crypt(p_pass, extensions.gen_salt('bf', 8)), p_role, left(trim(p_name), 60), case when p_role = 'khach' then null else p_cinema end);
  perform _admin_log(u.username, format('tạo tài khoản @%s (%s%s)', lower(trim(p_user)), p_role, case when p_cinema is not null and p_role <> 'khach' then ', rạp ' || p_cinema else '' end));
exception when unique_violation then raise exception 'username_taken';
end $$;

-- ---------- nhật ký đăng nhập ----------
create or replace function public.login(p_user text, p_pass text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u app_users; t uuid;
begin
  u := _find_user(p_user);
  if u.username is null or u.pass_hash <> extensions.crypt(p_pass, u.pass_hash) then raise exception 'invalid_login'; end if;
  delete from sessions where username = u.username and expires_at < now();
  insert into sessions (username) values (u.username) returning token into t;
  insert into audit_logs (type, msg, ok) values ('login', format('@%s đăng nhập bằng mật khẩu (%s%s)', u.username, u.role, case when u.cinema_id is not null then ', rạp ' || u.cinema_id else '' end), true);
  return _session_json(t);
end $$;

revoke execute on function public._need_mine(uuid, text[], text), public._admin_log(text, text) from public, anon, authenticated;
grant execute on function public.ensure_films(jsonb), public.save_cinema_s(uuid, jsonb), public.delete_cinema_s(uuid, text), public.save_room_s(uuid, jsonb), public.delete_room_s(uuid, text),
  public.save_film_s(uuid, jsonb, text[]), public.set_film_cinema_s(uuid, text, text, boolean), public.update_show_s(uuid, text, text, timestamptz, timestamptz), public.cancel_show_s(uuid, text, text),
  public.create_user(uuid, text, text, text, text, text), public.login(text, text) to anon, authenticated;
