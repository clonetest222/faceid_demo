-- CineVin – migration 005: hồ sơ khách hàng đầy đủ.
-- Chạy SAU 004. Chạy lại nhiều lần không sao.
--   • Đăng ký: họ tên, email, SĐT, mật khẩu. Đăng nhập bằng tên đăng nhập / email / SĐT + mật khẩu,
--     bằng FaceID (so khớp khuôn mặt ở máy chủ với hồ sơ VNeID đã liên kết) hoặc bằng VNeID (mô phỏng).
--   • Liên kết VNeID lưu TRÊN MÁY CHỦ (citizen_key, ngày sinh, thời điểm) → đổi thiết bị vẫn còn;
--     một hồ sơ VNeID chỉ gắn được một tài khoản.
--   • Điểm thưởng, voucher (thẻ quà tặng khi hoàn vé, mã khuyến mãi) tính ở máy chủ khi thanh toán.
--   • Vào rạp không cần vé: nhân viên tra vé theo hồ sơ VNeID sau khi khách xác thực FaceID.

alter table public.app_users
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists citizen_key text,
  add column if not exists dob date,
  add column if not exists vneid_verified_at timestamptz,
  add column if not exists vneid_method text,
  add column if not exists points int not null default 120,
  add column if not exists confirm_every boolean not null default false;
create unique index if not exists app_users_email on public.app_users (lower(email)) where email is not null;
create unique index if not exists app_users_phone on public.app_users (phone) where phone is not null;
create unique index if not exists app_users_citizen on public.app_users (citizen_key) where citizen_key is not null;

create table if not exists public.vouchers (
  code text primary key,
  kind text not null check (kind in ('gift', 'promo')),
  amount numeric not null default 0,      -- thẻ quà tặng: số tiền
  percent int not null default 0,         -- khuyến mãi: % giảm
  owner_user text,                        -- thẻ quà tặng: chỉ chủ dùng được; null = ai cũng dùng
  expires_at timestamptz,
  used_at timestamptz, used_by text,
  created_at timestamptz not null default now()
);
alter table public.vouchers enable row level security;   -- không policy: web chỉ đi qua hàm
insert into public.vouchers (code, kind, percent, expires_at) values ('CHAONHOM05', 'promo', 10, '2027-12-31')
on conflict (code) do nothing;

-- ---------- phiên: trả về đủ hồ sơ ----------
create or replace function public._session_json(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('token', s.token, 'username', u.username, 'role', u.role, 'name', u.display_name, 'expires_at', s.expires_at,
    'email', u.email, 'phone', u.phone, 'citizen_key', u.citizen_key, 'dob', u.dob, 'vneid_verified_at', u.vneid_verified_at,
    'vneid_method', u.vneid_method, 'points', u.points, 'confirm_every', u.confirm_every)
  from sessions s join app_users u on u.username = s.username where s.token = p_token;
$$;

-- tìm tài khoản theo tên đăng nhập / email / SĐT
create or replace function public._find_user(p_id text)
returns public.app_users language sql stable security definer set search_path = public as $$
  select * from app_users
  where username = lower(trim(p_id)) or lower(email) = lower(trim(p_id)) or phone = regexp_replace(p_id, '[^0-9+]', '', 'g')
  limit 1;
$$;

create or replace function public.login(p_user text, p_pass text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u app_users; t uuid;
begin
  u := _find_user(p_user);
  if u.username is null or u.pass_hash <> extensions.crypt(p_pass, u.pass_hash) then raise exception 'invalid_login'; end if;
  delete from sessions where username = u.username and expires_at < now();
  insert into sessions (username) values (u.username) returning token into t;
  return _session_json(t);
end $$;

drop function if exists public.register(text, text, text);
create or replace function public.register(p_user text, p_pass text, p_name text, p_email text default null, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare t uuid; v_user text := lower(trim(p_user)); v_email text := nullif(lower(trim(p_email)), ''); v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
begin
  if v_user !~ '^[a-z0-9_.]{3,32}$' then raise exception 'bad_username'; end if;
  if length(coalesce(p_pass, '')) < 6 then raise exception 'weak_password'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'bad_name'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_email'; end if;
  if v_phone is not null and v_phone !~ '^(\+84|0)[0-9]{9}$' then raise exception 'bad_phone'; end if;
  if v_email is not null and exists (select 1 from app_users where lower(email) = v_email) then raise exception 'email_taken'; end if;
  if v_phone is not null and exists (select 1 from app_users where phone = v_phone) then raise exception 'phone_taken'; end if;
  insert into app_users (username, pass_hash, role, display_name, email, phone)
  values (v_user, extensions.crypt(p_pass, extensions.gen_salt('bf', 8)), 'khach', left(trim(p_name), 60), v_email, v_phone);
  insert into sessions (username) values (v_user) returning token into t;
  return _session_json(t);
exception when unique_violation then raise exception 'username_taken';
end $$;

-- ---------- liên kết VNeID (lưu máy chủ) ----------
create or replace function public.link_vneid(p_token uuid, p_key text, p_method text, p_face_record bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; c mock_citizens;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  select * into c from mock_citizens where key = p_key;
  if c.key is null then raise exception 'unknown_citizen'; end if;
  if exists (select 1 from app_users where citizen_key = p_key and username <> u.username) then raise exception 'citizen_taken'; end if;
  update app_users set citizen_key = p_key, dob = c.dob, display_name = c.name, vneid_verified_at = now(), vneid_method = left(p_method, 60) where username = u.username;
  insert into verifications (kind, ok, citizen_key, account_name, method, detail)
  values ('vneid', true, p_key, c.name, 'liên kết tài khoản @' || u.username, jsonb_build_object('face_record', p_face_record, 'user', u.username));
  return _session_json(p_token);
end $$;

create or replace function public.unlink_vneid(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  update app_users set citizen_key = null, dob = null, vneid_verified_at = null, vneid_method = null where username = u.username;
  return _session_json(p_token);
end $$;

create or replace function public.set_pref(p_token uuid, p_confirm_every boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  update app_users set confirm_every = coalesce(p_confirm_every, confirm_every) where username = u.username;
  return _session_json(p_token);
end $$;

-- ---------- đăng nhập bằng FaceID: so khớp ở máy chủ với ảnh gốc của hồ sơ VNeID đã liên kết ----------
create or replace function public.login_face(p_user text, p_descriptor float8[], p_device text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; r jsonb; t uuid;
begin
  u := _find_user(p_user);
  if u.username is null then raise exception 'invalid_login'; end if;
  if u.citizen_key is null then raise exception 'face_not_linked'; end if;
  if (select face_template is null from mock_citizens where key = u.citizen_key) then raise exception 'face_not_enrolled'; end if;
  r := face_check(u.citizen_key, p_descriptor, p_device, 'Đăng nhập @' || u.username, 'camera', true);
  insert into verifications (kind, ok, citizen_key, account_name, device_id, method, score, detail)
  values ('login', (r->>'ok')::boolean, u.citizen_key, u.display_name, p_device, 'FaceID', (r->>'score')::int, jsonb_build_object('user', u.username, 'face_record', r->'id'));
  -- không raise: raise sẽ huỷ luôn bản ghi "đăng nhập thất bại" ở trên (cần giữ để truy vết)
  if not (r->>'ok')::boolean then return jsonb_build_object('ok', false, 'error', 'face_mismatch', 'score', r->'score', 'distance', r->'distance'); end if;
  insert into sessions (username) values (u.username) returning token into t;
  return _session_json(t) || jsonb_build_object('ok', true, 'score', r->'score');
end $$;

-- ---------- đăng nhập bằng VNeID (mô phỏng cổng VNeID trả về hồ sơ đã đồng ý chia sẻ) ----------
create or replace function public.login_vneid(p_key text, p_device text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; t uuid;
begin
  select * into u from app_users where citizen_key = p_key;
  if u.username is null then raise exception 'vneid_not_linked'; end if;
  insert into verifications (kind, ok, citizen_key, account_name, device_id, method, detail)
  values ('login', true, p_key, u.display_name, p_device, 'VNeID', jsonb_build_object('user', u.username));
  insert into sessions (username) values (u.username) returning token into t;
  return _session_json(t);
end $$;

-- ---------- voucher & điểm ----------
create or replace function public.voucher_check(p_token uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; v vouchers;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  select * into v from vouchers where code = upper(trim(p_code));
  if v.code is null then raise exception 'voucher_unknown'; end if;
  if v.used_at is not null then raise exception 'voucher_used'; end if;
  if v.expires_at is not null and v.expires_at < now() then raise exception 'voucher_expired'; end if;
  if v.owner_user is not null and v.owner_user <> u.username then raise exception 'voucher_not_yours'; end if;
  return jsonb_build_object('code', v.code, 'kind', v.kind, 'amount', v.amount, 'percent', v.percent, 'expires_at', v.expires_at);
end $$;

create or replace function public.my_vouchers(p_token uuid)
returns table (code text, kind text, amount numeric, percent int, expires_at timestamptz, used_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  return query select v.code, v.kind, v.amount, v.percent, v.expires_at, v.used_at from vouchers v
    where v.owner_user = u.username or (v.owner_user is null and v.kind = 'promo' and v.used_at is null and (v.expires_at is null or v.expires_at > now()))
    order by v.used_at nulls first, v.created_at desc;
end $$;

-- Thanh toán: tổng = giá vé − voucher − điểm (1 điểm = 1.000 đ); cộng 5% điểm thưởng. Trả về số tiền thực trả.
drop function if exists public.sell_order_u(uuid, text, text, jsonb);
create or replace function public.sell_order_u(p_token uuid, p_show text, p_hold text, p_tickets jsonb, p_voucher text default null, p_points int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; v vouchers; gross numeric; disc numeric := 0; pts int := 0; paid numeric; earn int;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  select coalesce(sum((x->>'price')::numeric), 0) into gross from jsonb_array_elements(p_tickets) x;
  if p_voucher is not null and p_voucher <> '' then
    select * into v from vouchers where code = upper(trim(p_voucher)) for update;
    if v.code is null or v.used_at is not null or (v.expires_at is not null and v.expires_at < now()) or (v.owner_user is not null and v.owner_user <> u.username) then raise exception 'voucher_invalid'; end if;
    disc := case when v.kind = 'gift' then least(v.amount, gross) else round(gross * v.percent / 100) end;
  end if;
  pts := least(greatest(coalesce(p_points, 0), 0), u.points, floor((gross - disc) / 1000)::int);
  paid := greatest(0, gross - disc - pts * 1000);
  perform sell_order(p_show, p_hold, p_tickets);
  update tickets set owner_user = u.username
  where code in (select x->>'code' from jsonb_array_elements(p_tickets) x) and coalesce(channel, '') <> 'Quầy';
  if v.code is not null then update vouchers set used_at = now(), used_by = u.username where code = v.code; end if;
  earn := case when u.role = 'khach' then floor(paid * 0.05 / 1000)::int else 0 end;
  update app_users set points = points - pts + earn where username = u.username;
  insert into audit_logs (type, msg, ok) values ('pay', format('@%s thanh toán %s đ (giảm %s đ, dùng %s điểm, +%s điểm)', u.username, paid, disc, pts, earn), true);
  return jsonb_build_object('gross', gross, 'discount', disc, 'points_used', pts, 'paid', paid, 'points_earned', earn, 'points', u.points - pts + earn);
end $$;

-- Hoàn vé: tiền vào thẻ quà tặng của chính chủ (đổi kiểu trả về → phải drop trước)
drop function if exists public.refund_ticket_u(uuid, text);
create or replace function public.refund_ticket_u(p_token uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; t tickets; g text;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  select * into t from tickets where code = p_code;
  if t.code is null then raise exception 'unknown_ticket'; end if;
  if u.role = 'khach' and coalesce(t.owner_user, '') <> u.username then raise exception 'forbidden'; end if;
  if not refund_ticket(p_code) then return null; end if;
  g := 'GC' || upper(substr(md5(random()::text), 1, 6));
  insert into vouchers (code, kind, amount, owner_user, expires_at) values (g, 'gift', t.price, coalesce(t.owner_user, u.username), now() + interval '180 days');
  return jsonb_build_object('gift', g, 'amount', t.price);
end $$;

-- ---------- vào rạp không cần vé: tra vé hôm nay theo hồ sơ VNeID ----------
create or replace function public.tickets_by_citizen(p_token uuid, p_key text)
returns table (code text, show_id text, seat text, viewer_name text, status text, need_doc boolean, owner_user text, username text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _need(p_token, array['nhanvien', 'quanly']);
  return query select t.code, t.show_id, t.seat, t.viewer_name, t.status, t.need_doc, t.owner_user, a.username
    from tickets t join app_users a on a.username = t.owner_user join shows s on s.id = t.show_id
    where a.citizen_key = p_key and t.status = 'valid' and s.end_at > now() and s.start_at < now() + interval '12 hours'
    order by s.start_at;
end $$;

-- ---------- một QR cho cả đơn: quét bất kỳ vé nào → cả đơn (cùng chủ tài khoản, cùng suất) ----------
create or replace function public.order_tickets(p_token uuid, p_code text)
returns table (code text, seat text, viewer_name text, status text, need_doc boolean, verified boolean, reason text, aud text)
language plpgsql stable security definer set search_path = public as $$
declare t tickets;
begin
  perform _need(p_token, array['nhanvien', 'quanly']);
  select * into t from tickets where tickets.code = p_code;
  if t.code is null then return; end if;
  return query select x.code, x.seat, x.viewer_name, x.status, x.need_doc, x.verified, x.reason, x.aud from tickets x
    where x.show_id = t.show_id and x.status <> 'refunded'
      and ((t.owner_user is not null and x.owner_user = t.owner_user) or (t.owner_user is null and x.order_id = t.order_id))
    order by x.seat;
end $$;

-- Cho vào nhiều vé một lần (mỗi vé vẫn nguyên tử: hai cửa cùng quét thì chỉ một cửa thành công)
create or replace function public.admit_many_s(p_token uuid, p_codes text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare c text; out jsonb := '{}'::jsonb;
begin
  perform _need(p_token, array['nhanvien', 'quanly']);
  foreach c in array p_codes loop out := out || jsonb_build_object(c, admit_ticket(c)); end loop;
  return out;
end $$;

alter table public.verifications drop constraint if exists verifications_kind_check;
alter table public.verifications add constraint verifications_kind_check
  check (kind in ('faceid', 'vneid', 'nfc', 'passkey', 'doc', 'qr', 'login'));

revoke execute on function public._find_user(text) from public, anon, authenticated;
grant execute on function public.login(text, text), public.register(text, text, text, text, text),
  public.link_vneid(uuid, text, text, bigint), public.unlink_vneid(uuid), public.set_pref(uuid, boolean),
  public.login_face(text, float8[], text), public.login_vneid(text, text),
  public.voucher_check(uuid, text), public.my_vouchers(uuid), public.sell_order_u(uuid, text, text, jsonb, text, int),
  public.refund_ticket_u(uuid, text), public.tickets_by_citizen(uuid, text),
  public.order_tickets(uuid, text), public.admit_many_s(uuid, text[])
  to anon, authenticated;
