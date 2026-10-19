-- CineVin – migration 012: ghế bảo trì không bao giờ bán được; đặt lại dữ liệu về 0 sạch hơn. Chạy SAU 011. Chạy lại nhiều lần không sao.
--   hold_seat từ chối ghế không bán (bảo trì…) ở máy chủ, không chỉ ở giao diện.
--   save_room_s không cho đánh dấu bảo trì ghế đã bán cho suất sắp chiếu (phải hoàn/đổi vé trước).
--   reset_demo xoá thêm thẻ quà tặng, lượt dùng mã khuyến mãi, tài khoản kiểm thử; điểm thưởng về mặc định.

create or replace function public._seat_sellable(p_show text, p_seat text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select coalesce(t.sellable, true) and not (p_seat = any(coalesce(r.blocked, '{}')))
    from shows s join rooms r on r.id = s.room_id
    left join seat_types t on t.id = r.seat_map->>p_seat
    where s.id = p_show), true);
$$;

create or replace function public.hold_seat(p_show text, p_seat text, p_hold text, p_until timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not _seat_sellable(p_show, p_seat) then return false; end if;   -- ghế bảo trì / không bán
  delete from seat_locks where show_id = p_show and seat = p_seat and status = 'held' and until < now();
  insert into seat_locks (show_id, seat, status, hold_id, until) values (p_show, p_seat, 'held', p_hold, p_until);
  return true;
exception when unique_violation then
  return false;
end $$;

create or replace function public.save_room_s(p_token uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; v_cid text := p->>'cinema_id'; v_id text := p->>'id'; nr int := (p->>'rows')::int; nc int := (p->>'cols')::int; old rooms; sm jsonb; bad text;
begin
  u := _need_mine(p_token, array['quanly', 'kythuat'], v_cid);
  if v_id is null or v_id !~ ('^' || v_cid || '-[A-Za-z0-9]{1,6}$') then raise exception 'bad_room_id'; end if;
  if nr not between 1 and 26 or nc not between 1 and 30 then raise exception 'bad_size'; end if;
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
  -- ghế sắp bị đánh dấu "không bán" mà đã bán / đang giữ cho suất sắp chiếu → từ chối, nêu rõ ghế
  select string_agg(distinct l.seat, ', ' order by l.seat) into bad
  from seat_locks l join shows s on s.id = l.show_id
  where s.room_id = v_id and s.status = 'on' and s.end_at > now()
    and l.seat in (select k from jsonb_each_text(sm) e(k, v) join seat_types t on t.id = v where not t.sellable);
  if bad is not null then raise exception 'seat_sold_blocked %', bad; end if;
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

-- Đặt lại dữ liệu demo về 0: suất, ghế, vé, đoàn, nhật ký, xác thực, thẻ quà tặng, lượt mã khuyến mãi, tài khoản kiểm thử; điểm về mặc định
create or replace function public.reset_demo()
returns void language sql security definer set search_path = public as $$
  delete from audit_logs where true; delete from group_members where true; delete from groups where true;
  delete from tickets where true; delete from seat_locks where true; delete from shows where true;
  delete from verifications where true;
  delete from vouchers where kind = 'gift'; delete from voucher_uses where true;
  delete from app_users where role = 'khach' and (display_name in ('Khách Kiểm Thử', 'Khách Kiểm Tuổi', 'Bạn Chưa Xác Thực') or username ~ '^(kt|smu)[a-z0-9]+$');
  update app_users set points = 120 where role = 'khach';
  update mock_citizens set face_template = null, template_source = null, template_at = null where true;
$$;
grant execute on function public.reset_demo to anon, authenticated;
grant execute on function public.hold_seat(text, text, text, timestamptz), public.save_room_s(uuid, jsonb) to anon, authenticated;
revoke execute on function public._seat_sellable(text, text) from public, anon, authenticated;
