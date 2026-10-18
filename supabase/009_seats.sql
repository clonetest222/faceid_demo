-- CineVin – migration 009: sơ đồ ghế theo từng ghế. Chạy SAU 008. Chạy lại nhiều lần không sao.
--   Mỗi ghế có loại: thường · VIP · ghế đôi (couple/sweetbox, phụ thu) · bảo trì (không bán).
--   rooms.vip (hàng VIP, 006) vẫn được đọc để tương thích; bản sửa mới ghi theo từng ghế.
alter table public.rooms add column if not exists vip_seats text[] not null default '{}';
alter table public.rooms add column if not exists couple text[] not null default '{}';

create or replace function public.save_room_s(p_token uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; v_cid text := p->>'cinema_id'; v_id text := p->>'id'; nr int := (p->>'rows')::int; nc int := (p->>'cols')::int; old rooms;
  seats_of text[];
begin
  u := _need_mine(p_token, array['quanly', 'kythuat'], v_cid);
  if v_id is null or v_id !~ ('^' || v_cid || '-[A-Za-z0-9]{1,6}$') then raise exception 'bad_room_id'; end if;
  if nr not between 1 and 26 or nc not between 1 and 30 then raise exception 'bad_size'; end if;
  select * into old from rooms where rooms.id = v_id;
  if old.id is not null and (nr < old.rows or nc < old.cols) and exists (
      select 1 from seat_locks l join shows s on s.id = l.show_id
      where s.room_id = v_id and l.status = 'sold' and s.start_at > now()
        and (ascii(left(l.seat, 1)) - 64 > nr or substr(l.seat, 2)::int > nc)) then raise exception 'seats_sold'; end if;
  insert into rooms (id, cinema_id, name, kind, rows, cols, vip, vip_seats, couple, blocked, active, note)
  values (v_id, v_cid, coalesce(trim(p->>'name'), v_id), coalesce(p->>'kind', '2D'), nr, nc,
          coalesce((select array_agg(v::int) from jsonb_array_elements_text(p->'vip') v), '{}'),
          coalesce((select array_agg(upper(v)) from jsonb_array_elements_text(p->'vip_seats') v), '{}'),
          coalesce((select array_agg(upper(v)) from jsonb_array_elements_text(p->'couple') v), '{}'),
          coalesce((select array_agg(upper(v)) from jsonb_array_elements_text(p->'blocked') v), '{}'),
          coalesce((p->>'active')::boolean, true), p->>'note')
  on conflict (id) do update set name = excluded.name, kind = excluded.kind, rows = excluded.rows, cols = excluded.cols, vip = excluded.vip,
    vip_seats = excluded.vip_seats, couple = excluded.couple, blocked = excluded.blocked, active = excluded.active, note = excluded.note;
  perform _admin_log(u.username, format('lưu phòng %s (%s, %s×%s, VIP %s, đôi %s, bảo trì %s%s)', v_id, coalesce(p->>'kind', '2D'), nr, nc,
    coalesce(jsonb_array_length(p->'vip_seats'), 0), coalesce(jsonb_array_length(p->'couple'), 0), coalesce(jsonb_array_length(p->'blocked'), 0),
    case when coalesce((p->>'active')::boolean, true) then '' else ', tạm ngưng' end));
end $$;
grant execute on function public.save_room_s(uuid, jsonb) to anon, authenticated;
