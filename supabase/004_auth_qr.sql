-- CineVin – migration 004: đăng nhập tài khoản/mật khẩu + phân quyền + QR vé ký bởi máy chủ.
-- Chạy SAU schema.sql, 002, 003. Chạy lại nhiều lần không sao.
--
-- Vai trò: khach (mua vé, vé đoàn) · nhanvien (soát vé, bán tại quầy) · quanly (tất cả + suất chiếu, kiểm thử, tài khoản).
-- Mật khẩu băm bcrypt (pgcrypto). Bảng app_users / sessions / app_secrets bật RLS và KHÔNG có policy:
-- web (publishable key) không đọc được, chỉ đi qua các hàm bên dưới.
-- Mọi hàm nhạy cảm nhận p_token và tự kiểm tra vai trò ở máy chủ – ẩn nút trên giao diện chỉ là phụ.

create extension if not exists pgcrypto with schema extensions;

-- ---------- tài khoản & phiên ----------
create table if not exists public.app_users (
  username text primary key check (username ~ '^[a-z0-9_.]{3,32}$'),
  pass_hash text not null,
  role text not null check (role in ('khach', 'nhanvien', 'quanly')),
  display_name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.sessions (
  token uuid primary key default gen_random_uuid(),
  username text not null references public.app_users(username) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
create index if not exists sessions_user on public.sessions (username);
create table if not exists public.app_secrets (k text primary key, v bytea not null);
alter table public.app_users enable row level security;
alter table public.sessions enable row level security;
alter table public.app_secrets enable row level security;

insert into public.app_secrets (k, v) values ('qr', extensions.gen_random_bytes(32)) on conflict (k) do nothing;

-- Tài khoản demo (mật khẩu ghi trong README – đổi khi triển khai thật)
insert into public.app_users (username, pass_hash, role, display_name) values
  ('khach',    extensions.crypt('khach123',    extensions.gen_salt('bf', 8)), 'khach',    'Nguyễn Văn An'),
  ('giaovien', extensions.crypt('giaovien123', extensions.gen_salt('bf', 8)), 'khach',    'Phạm Thu Hà'),
  ('nhanvien', extensions.crypt('nhanvien123', extensions.gen_salt('bf', 8)), 'nhanvien', 'Lê Minh Tuấn'),
  ('quanly',   extensions.crypt('quanly123',   extensions.gen_salt('bf', 8)), 'quanly',   'Ngô Thị Lan')
on conflict (username) do nothing;

-- vé gắn với tài khoản mua (để chỉ chủ vé lấy được QR động)
alter table public.tickets add column if not exists owner_user text;
create index if not exists tickets_owner on public.tickets (owner_user);

-- nhật ký xác thực thêm loại 'qr' (soát QR) và 'login'
alter table public.verifications drop constraint if exists verifications_kind_check;
alter table public.verifications add constraint verifications_kind_check
  check (kind in ('faceid', 'vneid', 'nfc', 'passkey', 'doc', 'qr', 'login'));

-- ---------- hàm nội bộ ----------
create or replace function public._me(p_token uuid)
returns public.app_users language sql stable security definer set search_path = public as $$
  select u.* from sessions s join app_users u on u.username = s.username
  where s.token = p_token and s.expires_at > now();
$$;
-- Kiểm tra vai trò, sai thì báo lỗi 'not_logged_in' / 'forbidden'
create or replace function public._need(p_token uuid, p_roles text[])
returns public.app_users language plpgsql stable security definer set search_path = public as $$
declare u app_users;
begin
  select * into u from _me(p_token);
  if u.username is null then raise exception 'not_logged_in'; end if;
  if not (u.role = any(p_roles)) then raise exception 'forbidden'; end if;
  return u;
end $$;
create or replace function public._session_json(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('token', s.token, 'username', u.username, 'role', u.role, 'name', u.display_name, 'expires_at', s.expires_at)
  from sessions s join app_users u on u.username = s.username where s.token = p_token;
$$;

-- ---------- đăng nhập / đăng ký ----------
create or replace function public.login(p_user text, p_pass text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u app_users; t uuid;
begin
  select * into u from app_users where username = lower(trim(p_user));
  if u.username is null or u.pass_hash <> extensions.crypt(p_pass, u.pass_hash) then raise exception 'invalid_login'; end if;
  delete from sessions where username = u.username and expires_at < now();
  insert into sessions (username) values (u.username) returning token into t;
  return _session_json(t);
end $$;

create or replace function public.register(p_user text, p_pass text, p_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare t uuid; v_user text := lower(trim(p_user));
begin
  if v_user !~ '^[a-z0-9_.]{3,32}$' then raise exception 'bad_username'; end if;
  if length(coalesce(p_pass, '')) < 6 then raise exception 'weak_password'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'bad_name'; end if;
  insert into app_users (username, pass_hash, role, display_name)
  values (v_user, extensions.crypt(p_pass, extensions.gen_salt('bf', 8)), 'khach', left(trim(p_name), 60));
  insert into sessions (username) values (v_user) returning token into t;
  return _session_json(t);
exception when unique_violation then raise exception 'username_taken';
end $$;

create or replace function public.session_info(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select _session_json(p_token) where (select username from _me(p_token)) is not null;
$$;

create or replace function public.logout(p_token uuid)
returns void language sql security definer set search_path = public as $$
  delete from sessions where token = p_token;
$$;

-- quản lý xem / tạo tài khoản nhân viên
create or replace function public.list_users(p_token uuid)
returns table (username text, role text, display_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _need(p_token, array['quanly']);
  return query select u.username, u.role, u.display_name, u.created_at from app_users u order by u.role desc, u.username;
end $$;

create or replace function public.create_user(p_token uuid, p_user text, p_pass text, p_name text, p_role text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _need(p_token, array['quanly']);
  if p_role not in ('khach', 'nhanvien', 'quanly') then raise exception 'bad_role'; end if;
  if lower(trim(p_user)) !~ '^[a-z0-9_.]{3,32}$' then raise exception 'bad_username'; end if;
  if length(coalesce(p_pass, '')) < 6 then raise exception 'weak_password'; end if;
  insert into app_users (username, pass_hash, role, display_name)
  values (lower(trim(p_user)), extensions.crypt(p_pass, extensions.gen_salt('bf', 8)), p_role, left(trim(p_name), 60));
exception when unique_violation then raise exception 'username_taken';
end $$;

-- ---------- khách: bán vé gắn chủ, hoàn vé của chính mình ----------
create or replace function public.sell_order_u(p_token uuid, p_show text, p_hold text, p_tickets jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  perform sell_order(p_show, p_hold, p_tickets);
  -- vé bán tại quầy không gắn tài khoản; vé online gắn người mua
  update tickets set owner_user = u.username
  where code in (select x->>'code' from jsonb_array_elements(p_tickets) x) and coalesce(channel, '') <> 'Quầy';
  return true;
end $$;

create or replace function public.refund_ticket_u(p_token uuid, p_code text)
returns boolean language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  if u.role = 'khach' and not exists (select 1 from tickets where code = p_code and owner_user = u.username) then raise exception 'forbidden'; end if;
  return refund_ticket(p_code);
end $$;

create or replace function public.create_group_u(p_token uuid, p_code text, p_show text, p_seats text[], p_teacher text, p_teacher_key text, p_org text, p_total numeric, p_members jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform _need(p_token, array['khach', 'quanly']);
  return create_group(p_code, p_show, p_seats, p_teacher, p_teacher_key, p_org, p_total, p_members);
end $$;

-- ---------- QR động: mã đổi mỗi 15 giây, ký HMAC bằng khoá chỉ máy chủ có ----------
-- Dạng: CV1.<mã vé>.<số khung 15 giây>.<12 ký tự chữ ký>
create or replace function public._qr_sig(p_code text, p_win bigint)
returns text language sql stable security definer set search_path = public, extensions as $$
  select left(encode(extensions.hmac(convert_to(p_code || '.' || p_win, 'UTF8'), (select v from app_secrets where k = 'qr'), 'sha256'), 'hex'), 12);
$$;

-- p_back > 0: tạo mã của khung cũ hơn (chỉ quản lý, để kiểm thử QR hết hạn / ảnh chụp màn hình)
create or replace function public.ticket_qr(p_token uuid, p_code text, p_back int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u app_users; t tickets; w bigint := floor(extract(epoch from now()) / 15);
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  select * into t from tickets where code = p_code;
  if t.code is null then raise exception 'unknown_ticket'; end if;
  if u.role = 'khach' and coalesce(t.owner_user, '') <> u.username then raise exception 'forbidden'; end if;
  if p_back <> 0 and u.role <> 'quanly' then raise exception 'forbidden'; end if;
  w := w - greatest(p_back, 0);
  return jsonb_build_object('payload', 'CV1.' || t.code || '.' || w || '.' || _qr_sig(t.code, w),
    'status', t.status, 'issued_at', to_timestamp(w * 15), 'next_at', to_timestamp((w + 1) * 15));
end $$;

-- Máy soát vé kiểm QR: chữ ký đúng và chưa quá 30 giây (khung hiện tại hoặc 2 khung trước)
create or replace function public.verify_qr(p_token uuid, p_payload text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; parts text[]; v_code text; v_win bigint; now_win bigint := floor(extract(epoch from now()) / 15);
        st text; age int; v_id bigint;
begin
  u := _need(p_token, array['nhanvien', 'quanly']);
  parts := string_to_array(trim(p_payload), '.');
  if array_length(parts, 1) = 4 and parts[1] = 'CV1' and parts[3] ~ '^[0-9]{1,12}$' then
    v_code := upper(parts[2]); v_win := parts[3]::bigint;
    age := ((now_win - v_win) * 15)::int;
    if parts[4] <> _qr_sig(v_code, v_win) or v_win > now_win then st := 'forged';
    elsif now_win - v_win > 2 then st := 'expired';
    else st := 'ok'; end if;
  else
    v_code := upper(trim(p_payload)); st := 'static'; age := null;
  end if;
  insert into verifications (kind, ok, account_name, method, detail)
  values ('qr', st = 'ok', u.display_name, 'soát QR', jsonb_build_object('status', st, 'code', v_code, 'age_seconds', age))
  returning id into v_id;
  return jsonb_build_object('status', st, 'code', v_code, 'age_seconds', age, 'record_id', v_id);
end $$;

-- ---------- nhân viên / quản lý: soát vé ----------
create or replace function public.admit_ticket_s(p_token uuid, p_code text)
returns text language plpgsql security definer set search_path = public as $$
begin perform _need(p_token, array['nhanvien', 'quanly']); return admit_ticket(p_code); end $$;

create or replace function public.scan_member_s(p_token uuid, p_group text, p_card text)
returns text language plpgsql security definer set search_path = public as $$
begin perform _need(p_token, array['nhanvien', 'quanly']); return scan_member(p_group, p_card); end $$;

create or replace function public.member_spot_s(p_token uuid, p_card text, p_ok boolean)
returns void language plpgsql security definer set search_path = public as $$
begin perform _need(p_token, array['nhanvien', 'quanly']); perform member_spot(p_card, p_ok); end $$;

create or replace function public.group_update_s(p_token uuid, p_code text, p_counted int, p_face_ok boolean, p_face_score int, p_finish boolean)
returns void language plpgsql security definer set search_path = public as $$
begin perform _need(p_token, array['nhanvien', 'quanly']); perform group_update(p_code, p_counted, p_face_ok, p_face_score, p_finish); end $$;

-- ---------- quản lý ----------
create or replace function public.add_show_s(p_token uuid, p_id text, p_film text, p_room text, p_start timestamptz, p_end timestamptz)
returns text language plpgsql security definer set search_path = public as $$
begin perform _need(p_token, array['quanly']); return add_show(p_id, p_film, p_room, p_start, p_end); end $$;

create or replace function public.reset_demo_s(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
begin perform _need(p_token, array['quanly']); perform reset_demo(); end $$;

create or replace function public.reset_citizen_face_s(p_token uuid, p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin perform _need(p_token, array['quanly']); perform reset_citizen_face(p_key); end $$;

-- ---------- quyền gọi hàm ----------
-- Hàm cũ ghi dữ liệu nhạy cảm: thu hồi khỏi web, chỉ còn đi qua bản có kiểm tra vai trò
revoke execute on function public.admit_ticket(text), public.scan_member(text, text), public.member_spot(text, boolean),
  public.group_update(text, int, boolean, int, boolean), public.add_show(text, text, text, timestamptz, timestamptz),
  public.reset_demo(), public.reset_citizen_face(text), public.refund_ticket(text),
  public.create_group(text, text, text[], text, text, text, numeric, jsonb) from anon, authenticated;
revoke execute on function public._me(uuid), public._need(uuid, text[]), public._session_json(uuid), public._qr_sig(text, bigint) from public, anon, authenticated;
grant execute on function public.login(text, text), public.register(text, text, text), public.session_info(uuid), public.logout(uuid),
  public.list_users(uuid), public.create_user(uuid, text, text, text, text),
  public.sell_order_u(uuid, text, text, jsonb), public.refund_ticket_u(uuid, text),
  public.create_group_u(uuid, text, text, text[], text, text, text, numeric, jsonb),
  public.ticket_qr(uuid, text, int), public.verify_qr(uuid, text),
  public.admit_ticket_s(uuid, text), public.scan_member_s(uuid, text, text), public.member_spot_s(uuid, text, boolean),
  public.group_update_s(uuid, text, int, boolean, int, boolean),
  public.add_show_s(uuid, text, text, text, timestamptz, timestamptz), public.reset_demo_s(uuid), public.reset_citizen_face_s(uuid, text)
  to anon, authenticated;

-- Dọn dữ liệu kiểm thử tải cũ (436 vé, 1119 khoá ghế) để bắt đầu sạch
select public.reset_demo();
