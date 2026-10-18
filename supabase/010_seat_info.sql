-- CineVin – migration 010: tra cứu ghế theo dữ liệu thật. Chạy SAU 009. Chạy lại nhiều lần không sao.
--   Nhân viên / quản lý của rạp bấm một ghế trên sơ đồ (suất hôm qua / hôm nay / ngày mai…) → máy chủ trả:
--   khoá ghế đang giữ, vé hiện tại, người mua (tài khoản, SĐT/email che bớt, đã xác thực VNeID), người xem,
--   đơn, thời điểm mua / vào phòng, vé đoàn, lịch sử hoàn. Kỹ thuật không xem được thông tin khách.

create or replace function public._mask_phone(p text) returns text language sql immutable as $$
  select case when p is null then null when length(p) >= 7 then left(p, 3) || repeat('•', length(p) - 6) || right(p, 3) else p end;
$$;
create or replace function public._mask_email(p text) returns text language sql immutable as $$
  select case when p is null then null when position('@' in p) > 3 then left(p, 2) || '•••' || substr(p, position('@' in p)) else p end;
$$;

create or replace function public.seat_info_s(p_token uuid, p_show text, p_seat text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u app_users; s shows; l seat_locks; t tickets; o app_users; vw app_users; g groups; r rooms; out jsonb;
begin
  select * into s from shows where id = p_show;
  if s.id is null then raise exception 'unknown_show'; end if;
  u := _need_cinema(p_token, array['nhanvien', 'quanly'], p_show);
  select * into r from rooms where id = s.room_id;
  select * into l from seat_locks where show_id = p_show and seat = p_seat;
  select * into t from tickets where show_id = p_show and seat = p_seat and status <> 'refunded' order by created_at desc limit 1;
  out := jsonb_build_object(
    'show', jsonb_build_object('id', s.id, 'status', s.status, 'start_at', s.start_at),
    'seat', p_seat,
    'blocked', r.id is not null and p_seat = any(coalesce(r.blocked, '{}')),
    'lock', case when l.show_id is null then null else jsonb_build_object('status', l.status, 'hold_id', l.hold_id, 'until', l.until, 'grp', l.grp) end,
    'refunds', (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'at', x.created_at, 'price', x.price, 'owner', x.owner_user) order by x.created_at desc), '[]'::jsonb)
                from tickets x where x.show_id = p_show and x.seat = p_seat and x.status = 'refunded'));
  if t.code is not null then
    select * into o from app_users where username = t.owner_user;
    select * into vw from app_users where username = t.viewer_user;
    out := out || jsonb_build_object('ticket', jsonb_build_object(
      'code', t.code, 'order_id', t.order_id, 'status', t.status, 'viewer_name', t.viewer_name, 'aud', t.aud, 'verified', t.verified, 'need_doc', t.need_doc,
      'reason', t.reason, 'price', t.price, 'channel', t.channel, 'created_at', t.created_at, 'used_at', t.used_at, 'device_id', t.device_id,
      'order_size', (select count(*) from tickets x where x.show_id = p_show and x.status <> 'refunded'
                       and ((t.owner_user is not null and x.owner_user = t.owner_user) or (t.owner_user is null and x.order_id = t.order_id))),
      'owner', case when o.username is null then null else jsonb_build_object('username', o.username, 'name', o.display_name, 'phone', _mask_phone(o.phone), 'email', _mask_email(o.email),
                 'vneid', o.citizen_key is not null, 'vneid_at', o.vneid_verified_at, 'points', o.points, 'since', o.created_at) end,
      'viewer', case when vw.username is null then null else jsonb_build_object('username', vw.username, 'name', vw.display_name, 'vneid', vw.citizen_key is not null) end));
  end if;
  select * into g from groups where show_id = p_show and p_seat = any(seats) limit 1;
  if g.code is not null then
    out := out || jsonb_build_object('group', jsonb_build_object('code', g.code, 'teacher', g.teacher, 'org', g.org, 'status', g.status, 'counted', g.counted, 'entered', g.entered_count,
      'members', (select count(*) from group_members m where m.group_code = g.code), 'total', g.total, 'seats', g.seats));
  end if;
  return out;
end $$;

-- Toàn bộ vé của một suất (cho bảng tổng hợp bên cạnh sơ đồ)
create or replace function public.show_tickets_s(p_token uuid, p_show text)
returns table (code text, seat text, status text, viewer_name text, aud text, verified boolean, need_doc boolean, price numeric, channel text, created_at timestamptz, used_at timestamptz, owner_user text, owner_name text, viewer_user text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _need_cinema(p_token, array['nhanvien', 'quanly'], p_show);
  return query select t.code, t.seat, t.status, t.viewer_name, t.aud, t.verified, t.need_doc, t.price, t.channel, t.created_at, t.used_at, t.owner_user, o.display_name, t.viewer_user
    from tickets t left join app_users o on o.username = t.owner_user
    where t.show_id = p_show and t.status <> 'refunded' order by t.seat;
end $$;

revoke execute on function public._mask_phone(text), public._mask_email(text) from public, anon, authenticated;
grant execute on function public.seat_info_s(uuid, text, text), public.show_tickets_s(uuid, text) to anon, authenticated;
