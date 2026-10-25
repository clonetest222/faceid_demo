-- CineVin – migration 022: MẪU PHÒNG CHIẾU (IMAX, Dolby, 4DX, Luxury, Grand… + tuỳ chỉnh).
-- Chạy SAU 021. Chạy lại nhiều lần không sao.
--   • rooms.layout jsonb: { preset: 'imax' | 'dolby' | '4dx' | 'luxury' | 'grand' | 'standard', blocks: [6,14,6], aisle, pitch, rowSpacing, rise,
--     screen: {width,height,bottom,curveRadius (m, 0 = phẳng)}, room: {wall,floor,ceiling,…}, materials, lighting, seatStyle, fovTarget } – chỉ ghi phần khác mẫu.
--     Web (js/data.js ROOM_PRESETS) tự điền phần còn lại; null = suy mẫu từ loại phòng (IMAX → imax, GOLD → dolby, còn lại tiêu chuẩn).
--   • Lối đi 2D (khách, quầy, thiết kế) và phòng 3D (Seat3D) dựng theo blocks của layout → sơ đồ, 3D, chấm góc nhìn khớp nhau.
--   • save_room_s nhận thêm p->'layout' (object hoặc null); mọi kiểm tra cũ (ghế đã bán, loại ghế…) giữ nguyên.
alter table public.rooms add column if not exists layout jsonb;

create or replace function public.save_room_s(p_token uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; v_cid text := p->>'cinema_id'; v_id text := p->>'id'; nr int := (p->>'rows')::int; nc int := (p->>'cols')::int; old rooms; sm jsonb; bad text;
  lay jsonb := case when jsonb_typeof(p->'layout') = 'object' then p->'layout' else null end;
begin
  u := _need_mine(p_token, array['quanly', 'kythuat'], v_cid);
  if v_id is null or v_id !~ ('^' || v_cid || '-[A-Za-z0-9]{1,6}$') then raise exception 'bad_room_id'; end if;
  if nr not between 1 and 26 or nc not between 1 and 30 then raise exception 'bad_size'; end if;
  if lay is not null and length(lay::text) > 8000 then raise exception 'bad_layout'; end if;
  select * into old from rooms where rooms.id = v_id;
  if old.id is not null and (nr < old.rows or nc < old.cols) and exists (
      select 1 from seat_locks l join shows s on s.id = l.show_id
      where s.room_id = v_id and l.status = 'sold' and s.start_at > now()
        and (ascii(left(l.seat, 1)) - 64 > nr or substr(l.seat, 2)::int > nc)) then raise exception 'seats_sold'; end if;
  sm := coalesce((select jsonb_object_agg(upper(k), v) from jsonb_each_text(coalesce(p->'seat_map', '{}'::jsonb)) e(k, v)
                  where v <> 'std' and exists (select 1 from seat_types t where t.id = v) and upper(k) ~ '^[A-Z][0-9]{1,2}$'
                    and ascii(upper(left(k, 1))) - 64 <= nr and substr(k, 2)::int <= nc), '{}'::jsonb);
  if p->'seat_map' is null then
    sm := coalesce((select jsonb_object_agg(k, v) from (
      select upper(x) k, 'vip' v from jsonb_array_elements_text(coalesce(p->'vip_seats', '[]'::jsonb)) x
      union all select upper(x), 'couple' from jsonb_array_elements_text(coalesce(p->'couple', '[]'::jsonb)) x
      union all select upper(x), 'blocked' from jsonb_array_elements_text(coalesce(p->'blocked', '[]'::jsonb)) x) y), '{}'::jsonb);
  end if;
  select string_agg(distinct l.seat, ', ' order by l.seat) into bad
  from seat_locks l join shows s on s.id = l.show_id
  where s.room_id = v_id and s.status = 'on' and s.end_at > now()
    and l.seat in (select k from jsonb_each_text(sm) e(k, v) join seat_types t on t.id = v where not t.sellable);
  if bad is not null then raise exception 'seat_sold_blocked %', bad; end if;
  insert into rooms (id, cinema_id, name, kind, rows, cols, vip, seat_map, vip_seats, couple, blocked, active, note, layout)
  values (v_id, v_cid, coalesce(trim(p->>'name'), v_id), coalesce(p->>'kind', '2D'), nr, nc,
          coalesce((select array_agg(v::int) from jsonb_array_elements_text(p->'vip') v), '{}'), sm,
          coalesce((select array_agg(k order by k) from jsonb_each_text(sm) e(k, v) where v = 'vip'), '{}'),
          coalesce((select array_agg(k order by k) from jsonb_each_text(sm) e(k, v) where v = 'couple'), '{}'),
          coalesce((select array_agg(k order by k) from jsonb_each_text(sm) e(k, v) join seat_types t on t.id = v where not t.sellable), '{}'),
          coalesce((p->>'active')::boolean, true), p->>'note', lay)
  on conflict (id) do update set name = excluded.name, kind = excluded.kind, rows = excluded.rows, cols = excluded.cols, vip = excluded.vip, seat_map = excluded.seat_map,
    vip_seats = excluded.vip_seats, couple = excluded.couple, blocked = excluded.blocked, active = excluded.active, note = excluded.note,
    layout = case when p ? 'layout' then excluded.layout else rooms.layout end;
  perform _admin_log(u.username, format('lưu phòng %s (%s, %s×%s, %s ghế đặc biệt%s%s)', v_id, coalesce(p->>'kind', '2D'), nr, nc,
    (select count(*) from jsonb_each(sm)), case when coalesce((p->>'active')::boolean, true) then '' else ', tạm ngưng' end,
    case when lay->>'preset' is not null then ', mẫu ' || (lay->>'preset') else '' end));
end $$;
grant execute on function public.save_room_s(uuid, jsonb) to anon, authenticated;

-- Xoá phim khỏi kho (quản lý chuỗi). Còn suất sắp chiếu / đang chiếu hoặc đã có vé → film_in_use (hãy Ngừng chiếu thay vì xoá).
-- Không còn gì ràng buộc thì xoá luôn các suất cũ / đã huỷ không vé của phim, phân phối (cascade) và phim.
create or replace function public.delete_film_s(p_token uuid, p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; f films;
begin
  u := _need(p_token, array['quanly']);
  if u.cinema_id is not null then raise exception 'forbidden'; end if;
  select * into f from films where id = p_id;
  if f.id is null then raise exception 'unknown_film'; end if;
  if exists (select 1 from shows s where s.film_id = p_id and s.status <> 'cancelled' and s.end_at > now()) then raise exception 'film_in_use'; end if;
  if exists (select 1 from tickets t join shows s on s.id = t.show_id where s.film_id = p_id) then raise exception 'film_in_use'; end if;
  delete from seat_locks where show_id in (select id from shows where film_id = p_id);
  delete from shows where film_id = p_id;
  delete from films where id = p_id;
  perform _admin_log(u.username, format('xoá phim %s "%s"', p_id, f.title));
end $$;
grant execute on function public.delete_film_s(uuid, text) to anon, authenticated;

-- Thêm suất vào chỗ của một suất ĐÃ HUỶ: suất huỷ không chiếm phòng nữa (trước đây mọi suất kể cả đã huỷ đều tính trùng).
create or replace function public.add_show(p_id text, p_film text, p_room text, p_start timestamptz, p_end timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare c shows;
begin
  select * into c from shows where room_id = p_room and status <> 'cancelled' and start_at < p_end and end_at > p_start limit 1;
  if found then return c.id; end if;
  insert into shows (id, film_id, room_id, start_at, end_at) values (p_id, p_film, p_room, p_start, p_end);
  return null;
end $$;
