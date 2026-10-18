-- CineVin – migration 011: loại ghế tự định nghĩa + bảng giá riêng từng rạp. Chạy SAU 010. Chạy lại nhiều lần không sao.
--   Quản lý chuỗi tự tạo loại ghế: tên, số người ngồi (ghế đôi 2, ghế 3, sofa 4…), phụ thu theo hạng rạp A/B,
--   màu, biểu tượng, có bán hay không (bảo trì = không bán). Sơ đồ phòng lưu từng ghế → loại (rooms.seat_map).
--   Giá ghế = giá cơ bản × số người + phụ thu (+ phụ thu phòng 3D/GOLD/IMAX).

create table if not exists public.seat_types (
  id text primary key check (id ~ '^[a-z0-9_]{1,16}$'),
  name text not null,
  persons int not null default 1 check (persons between 1 and 8),
  surcharge_a numeric not null default 0,     -- phụ thu ở rạp hạng A
  surcharge_b numeric not null default 0,     -- phụ thu ở rạp hạng B
  color text not null default 'gray',         -- gray | amber | rose | sky | violet | green | orange
  icon text,                                  -- tên biểu tượng lucide (crown, heart, sofa, users, star, gem, wrench…)
  sellable boolean not null default true,     -- false = không bán (bảo trì, lối đi)
  sort int not null default 100,
  builtin boolean not null default false,
  active boolean not null default true
);
alter table public.seat_types enable row level security;
drop policy if exists "read_all" on public.seat_types; create policy "read_all" on public.seat_types for select to anon, authenticated using (true);
do $$ begin alter publication supabase_realtime add table public.seat_types; exception when duplicate_object then null; end $$;
insert into public.seat_types (id, name, persons, surcharge_a, surcharge_b, color, icon, sellable, sort, builtin) values
  ('std', 'Thường', 1, 0, 0, 'gray', null, true, 1, true),
  ('vip', 'VIP', 1, 5500, 5500, 'amber', 'crown', true, 2, true),
  ('couple', 'Ghế đôi', 2, 26000, 16000, 'rose', 'heart', true, 3, true),
  ('blocked', 'Bảo trì', 1, 0, 0, 'gray', 'wrench', false, 99, true)
on conflict (id) do nothing;

alter table public.rooms add column if not exists seat_map jsonb not null default '{}'::jsonb;   -- {"A1":"vip","F3":"sofa4",…}; thiếu = thường
-- chuyển dữ liệu 009 (vip_seats / couple / blocked) sang seat_map một lần
update public.rooms r set seat_map = coalesce((
    select jsonb_object_agg(k, v) from (
      select unnest(r.vip_seats) k, 'vip' v union all select unnest(r.couple), 'couple' union all select unnest(r.blocked), 'blocked') x), '{}'::jsonb)
  where r.seat_map = '{}'::jsonb and (cardinality(r.vip_seats) > 0 or cardinality(r.couple) > 0 or cardinality(r.blocked) > 0);

create or replace function public.save_seat_type_s(p_token uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; v_id text := p->>'id';
begin
  u := _need(p_token, array['quanly']);
  if u.cinema_id is not null then raise exception 'forbidden'; end if;     -- danh mục dùng chung toàn chuỗi
  if v_id !~ '^[a-z0-9_]{1,16}$' or length(trim(coalesce(p->>'name', ''))) < 1 then raise exception 'bad_input'; end if;
  if v_id in ('std', 'blocked') and coalesce((p->>'sellable')::boolean, v_id = 'std') <> (v_id = 'std') then raise exception 'bad_input'; end if;
  insert into seat_types (id, name, persons, surcharge_a, surcharge_b, color, icon, sellable, sort, active)
  values (v_id, trim(p->>'name'), coalesce((p->>'persons')::int, 1), coalesce((p->>'surcharge_a')::numeric, 0), coalesce((p->>'surcharge_b')::numeric, 0),
          coalesce(p->>'color', 'gray'), nullif(p->>'icon', ''), coalesce((p->>'sellable')::boolean, true), coalesce((p->>'sort')::int, 100), coalesce((p->>'active')::boolean, true))
  on conflict (id) do update set name = excluded.name, persons = excluded.persons, surcharge_a = excluded.surcharge_a, surcharge_b = excluded.surcharge_b,
    color = excluded.color, icon = excluded.icon, sellable = excluded.sellable, sort = excluded.sort, active = excluded.active;
  perform _admin_log(u.username, format('lưu loại ghế %s "%s" (%s người, phụ thu A %s / B %s%s)', v_id, trim(p->>'name'), coalesce((p->>'persons')::int, 1),
    coalesce((p->>'surcharge_a')::numeric, 0), coalesce((p->>'surcharge_b')::numeric, 0), case when coalesce((p->>'sellable')::boolean, true) then '' else ', không bán' end));
end $$;

-- Xoá loại ghế tự tạo: ghế đang mang loại này trở về "thường"
create or replace function public.delete_seat_type_s(p_token uuid, p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['quanly']);
  if u.cinema_id is not null then raise exception 'forbidden'; end if;
  if exists (select 1 from seat_types where id = p_id and builtin) then raise exception 'builtin_type'; end if;
  update rooms r set seat_map = (select coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb) from jsonb_each(r.seat_map) e(k, v) where e.v <> to_jsonb(p_id))
    where exists (select 1 from jsonb_each(r.seat_map) e(k, v) where e.v = to_jsonb(p_id));
  delete from seat_types where id = p_id;
  perform _admin_log(u.username, 'xoá loại ghế ' || p_id);
end $$;

-- Lưu phòng kèm sơ đồ loại ghế; cột 009 (vip_seats/couple/blocked) được suy từ seat_map để tương thích
create or replace function public.save_room_s(p_token uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; v_cid text := p->>'cinema_id'; v_id text := p->>'id'; nr int := (p->>'rows')::int; nc int := (p->>'cols')::int; old rooms; sm jsonb;
begin
  u := _need_mine(p_token, array['quanly', 'kythuat'], v_cid);
  if v_id is null or v_id !~ ('^' || v_cid || '-[A-Za-z0-9]{1,6}$') then raise exception 'bad_room_id'; end if;
  if nr not between 1 and 26 or nc not between 1 and 30 then raise exception 'bad_size'; end if;
  select * into old from rooms where rooms.id = v_id;
  if old.id is not null and (nr < old.rows or nc < old.cols) and exists (
      select 1 from seat_locks l join shows s on s.id = l.show_id
      where s.room_id = v_id and l.status = 'sold' and s.start_at > now()
        and (ascii(left(l.seat, 1)) - 64 > nr or substr(l.seat, 2)::int > nc)) then raise exception 'seats_sold'; end if;
  -- sơ đồ: chỉ giữ ghế trong kích thước, loại tồn tại, khác "std"
  sm := coalesce((select jsonb_object_agg(upper(k), v) from jsonb_each_text(coalesce(p->'seat_map', '{}'::jsonb)) e(k, v)
                  where v <> 'std' and exists (select 1 from seat_types t where t.id = v) and upper(k) ~ '^[A-Z][0-9]{1,2}$'
                    and ascii(upper(left(k, 1))) - 64 <= nr and substr(k, 2)::int <= nc), '{}'::jsonb);
  if p->'seat_map' is null then   -- client cũ (009): dựng từ các mảng
    sm := coalesce((select jsonb_object_agg(k, v) from (
      select upper(x) k, 'vip' v from jsonb_array_elements_text(coalesce(p->'vip_seats', '[]'::jsonb)) x
      union all select upper(x), 'couple' from jsonb_array_elements_text(coalesce(p->'couple', '[]'::jsonb)) x
      union all select upper(x), 'blocked' from jsonb_array_elements_text(coalesce(p->'blocked', '[]'::jsonb)) x) y), '{}'::jsonb);
  end if;
  insert into rooms (id, cinema_id, name, kind, rows, cols, vip, seat_map, vip_seats, couple, blocked, active, note)
  values (v_id, v_cid, coalesce(trim(p->>'name'), v_id), coalesce(p->>'kind', '2D'), nr, nc,
          coalesce((select array_agg(v::int) from jsonb_array_elements_text(p->'vip') v), '{}'), sm,
          coalesce((select array_agg(k order by k) from jsonb_each_text(sm) e(k, v) where v = 'vip'), '{}'),
          coalesce((select array_agg(k order by k) from jsonb_each_text(sm) e(k, v) where v = 'couple'), '{}'),
          coalesce((select array_agg(k order by k) from jsonb_each_text(sm) e(k, v) join seat_types t on t.id = v where not t.sellable), '{}'),
          coalesce((p->>'active')::boolean, true), p->>'note')
  on conflict (id) do update set name = excluded.name, kind = excluded.kind, rows = excluded.rows, cols = excluded.cols, vip = excluded.vip, seat_map = excluded.seat_map,
    vip_seats = excluded.vip_seats, couple = excluded.couple, blocked = excluded.blocked, active = excluded.active, note = excluded.note;
  perform _admin_log(u.username, format('lưu phòng %s (%s, %s×%s, %s ghế đặc biệt%s)', v_id, coalesce(p->>'kind', '2D'), nr, nc,
    (select count(*) from jsonb_each(sm)), case when coalesce((p->>'active')::boolean, true) then '' else ', tạm ngưng' end));
end $$;

-- Bảng giá riêng của rạp (cinemas.prices, cột có từ 006): null = dùng bảng theo hạng A/B
create or replace function public.save_cinema_prices_s(p_token uuid, p_cinema text, p jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; d text; a text;
begin
  u := _need_mine(p_token, array['quanly'], p_cinema);
  if not exists (select 1 from cinemas where id = p_cinema) then raise exception 'unknown_cinema'; end if;
  if p is not null then
    foreach d in array array['weekday', 'wed', 'weekend'] loop
      foreach a in array array['adult', 'u22', 'child', 'senior'] loop
        if jsonb_typeof(p->d->a) <> 'number' or (p->d->>a)::numeric < 0 then raise exception 'bad_input'; end if;
      end loop;
      if (p->d->>'adult')::numeric <= 0 then raise exception 'bad_input'; end if;
    end loop;
  end if;
  update cinemas set prices = p where id = p_cinema;
  perform _admin_log(u.username, case when p is null then 'bỏ bảng giá riêng rạp ' || p_cinema else format('bảng giá riêng rạp %s: người lớn %s / %s / %s', p_cinema, p->'weekday'->>'adult', p->'wed'->>'adult', p->'weekend'->>'adult') end);
end $$;

grant execute on function public.save_seat_type_s(uuid, jsonb), public.delete_seat_type_s(uuid, text), public.save_room_s(uuid, jsonb), public.save_cinema_prices_s(uuid, text, jsonb) to anon, authenticated;
