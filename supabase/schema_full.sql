-- CineVin – schema đầy đủ (gộp 21 file, sinh bởi tools/build-schema.mjs 2026-10-25).
-- Cài mới: dán toàn bộ file này vào Supabase SQL Editor và chạy MỘT lần (mọi lệnh đều idempotent, chạy lại không sao).
-- Dự án đã chạy các migration lẻ: chỉ cần chạy các file còn thiếu theo thứ tự số (xem README).
-- Khoá: mọi bảng dữ liệu có PRIMARY KEY id bigint identity (019); mã nghiệp vụ (tên đăng nhập, mã vé, mã rạp…) là UNIQUE / khoá text có chủ đích.

-- ============================================================================
-- schema.sql
-- ============================================================================
-- CineVin – schema Supabase (chạy một lần trong SQL Editor).
-- Nguyên tắc: web dùng publishable key (vai trò anon) chỉ được ĐỌC bảng;
-- mọi thao tác GHI đi qua hàm security definer bên dưới để bảo toàn dữ liệu khi nhiều máy dùng cùng lúc.
-- Bản demo chưa có đăng nhập nhân viên; khi triển khai thật cần thêm Supabase Auth + kiểm tra vai trò trong từng hàm.

create table if not exists public.shows (
  id text primary key,
  film_id text not null,
  room_id text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,           -- = bắt đầu + thời lượng + 15 phút dọn phòng
  created_at timestamptz not null default now()
);
create index if not exists shows_room_time on public.shows (room_id, start_at);

-- Một dòng = một ghế đang giữ hoặc đã bán. Khoá chính (show_id, seat) đảm bảo không bao giờ bán trùng ghế.
create table if not exists public.seat_locks (
  show_id text not null references public.shows(id) on delete cascade,
  seat text not null,
  status text not null check (status in ('held', 'sold')),
  hold_id text,
  until timestamptz,
  grp boolean not null default false,
  primary key (show_id, seat)
);
create index if not exists seat_locks_hold on public.seat_locks (hold_id);

create table if not exists public.tickets (
  code text primary key,
  order_id text,
  device_id text,
  show_id text not null references public.shows(id) on delete cascade,
  seat text not null,
  viewer_name text,
  aud text,
  verified boolean not null default false,
  need_doc boolean not null default false,
  reason text,
  price numeric not null default 0,
  status text not null default 'valid' check (status in ('valid', 'used', 'refunded')),
  channel text,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index if not exists tickets_show on public.tickets (show_id);

create table if not exists public.groups (
  code text primary key,
  show_id text not null references public.shows(id) on delete cascade,
  seats text[] not null,
  teacher text, teacher_key text, org text,
  total numeric not null default 0,
  status text not null default 'valid' check (status in ('valid', 'used')),
  counted int not null default 0,
  entered_count int,
  face_ok boolean not null default false,
  face_score int,
  created_at timestamptz not null default now()
);
create table if not exists public.group_members (
  card text primary key,
  group_code text not null references public.groups(code) on delete cascade,
  idx int not null,
  name text not null, dob date not null, cls text,
  entered boolean not null default false,
  entered_at timestamptz,
  spot boolean
);
create index if not exists group_members_group on public.group_members (group_code);

-- Nhật ký kiểm tra độ tuổi / soát vé (bằng chứng khi thanh tra). Không lưu ảnh, không lưu số giấy tờ.
create table if not exists public.audit_logs (
  id bigserial primary key,
  t timestamptz not null default now(),
  type text not null,
  msg text not null,
  ok boolean not null default true
);

-- ---------- RLS: anon chỉ được đọc ----------
alter table public.shows enable row level security;
alter table public.seat_locks enable row level security;
alter table public.tickets enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.audit_logs enable row level security;
do $$ declare t text; begin
  foreach t in array array['shows','seat_locks','tickets','groups','group_members','audit_logs'] loop
    execute format('drop policy if exists "read_all" on public.%I', t);
    execute format('create policy "read_all" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- ---------- Hàm ghi (security definer) ----------
-- Lịch chiếu cố định trong ngày: máy đầu tiên mở web sẽ tạo, các máy sau bỏ qua (idempotent).
create or replace function public.ensure_schedule(p_shows jsonb, p_sold jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into shows (id, film_id, room_id, start_at, end_at)
  select x->>'id', x->>'film_id', x->>'room_id', (x->>'start_at')::timestamptz, (x->>'end_at')::timestamptz
  from jsonb_array_elements(p_shows) x
  on conflict (id) do nothing;
  insert into seat_locks (show_id, seat, status)
  select x->>'show_id', x->>'seat', 'sold' from jsonb_array_elements(p_sold) x
  where exists (select 1 from shows s where s.id = x->>'show_id' and s.created_at > now() - interval '1 minute')
  on conflict do nothing;
end $$;

-- Giữ một ghế. Trả về false nếu ghế đã có người giữ/bán. Tự dọn khoá hết hạn.
create or replace function public.hold_seat(p_show text, p_seat text, p_hold text, p_until timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from seat_locks where show_id = p_show and seat = p_seat and status = 'held' and until < now();
  insert into seat_locks (show_id, seat, status, hold_id, until) values (p_show, p_seat, 'held', p_hold, p_until);
  return true;
exception when unique_violation then
  return false;
end $$;

create or replace function public.release_seat(p_show text, p_seat text, p_hold text)
returns void language sql security definer set search_path = public as $$
  delete from seat_locks where show_id = p_show and seat = p_seat and status = 'held' and hold_id = p_hold;
$$;

create or replace function public.release_hold(p_hold text)
returns void language sql security definer set search_path = public as $$
  delete from seat_locks where hold_id = p_hold and status = 'held';
$$;

-- Bán một đơn: mọi ghế phải đang được chính đơn này giữ và còn hạn; ghi vé trong cùng giao dịch.
create or replace function public.sell_order(p_show text, p_hold text, p_tickets jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare n_need int := jsonb_array_length(p_tickets); n_ok int;
begin
  update seat_locks set status = 'sold', until = null
  where show_id = p_show and hold_id = p_hold and status = 'held' and until >= now()
    and seat in (select x->>'seat' from jsonb_array_elements(p_tickets) x);
  get diagnostics n_ok = row_count;
  if n_ok <> n_need then raise exception 'hold_expired'; end if;
  insert into tickets (code, order_id, device_id, show_id, seat, viewer_name, aud, verified, need_doc, reason, price, channel)
  select x->>'code', x->>'order_id', x->>'device_id', p_show, x->>'seat', x->>'viewer_name', x->>'aud',
         coalesce((x->>'verified')::boolean, false), coalesce((x->>'need_doc')::boolean, false), x->>'reason',
         coalesce((x->>'price')::numeric, 0), x->>'channel'
  from jsonb_array_elements(p_tickets) x;
  return true;
end $$;

create or replace function public.refund_ticket(p_code text)
returns boolean language plpgsql security definer set search_path = public as $$
declare t tickets;
begin
  update tickets set status = 'refunded' where code = p_code and status = 'valid' returning * into t;
  if not found then return false; end if;
  delete from seat_locks where show_id = t.show_id and seat = t.seat;
  return true;
end $$;

-- Soát vé: chỉ một máy cho vào được (tránh hai cửa cùng quét một vé). Trả về trạng thái trước khi quét.
create or replace function public.admit_ticket(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare prev text;
begin
  select status into prev from tickets where code = p_code for update;
  if prev is null then return 'none'; end if;
  if prev = 'valid' then update tickets set status = 'used', used_at = now() where code = p_code; end if;
  return prev;
end $$;

create or replace function public.add_show(p_id text, p_film text, p_room text, p_start timestamptz, p_end timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare c shows;
begin
  select * into c from shows where room_id = p_room and start_at < p_end and end_at > p_start limit 1;
  if found then return c.id; end if;
  insert into shows (id, film_id, room_id, start_at, end_at) values (p_id, p_film, p_room, p_start, p_end);
  return null;
end $$;

-- Vé đoàn: khoá cả khối ghế + ghi đơn + ghi danh sách trong một giao dịch.
create or replace function public.create_group(p_code text, p_show text, p_seats text[], p_teacher text, p_teacher_key text, p_org text, p_total numeric, p_members jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from seat_locks where show_id = p_show and status = 'held' and until < now() and seat = any(p_seats);
  insert into seat_locks (show_id, seat, status, grp) select p_show, s, 'sold', true from unnest(p_seats) s;
  insert into groups (code, show_id, seats, teacher, teacher_key, org, total) values (p_code, p_show, p_seats, p_teacher, p_teacher_key, p_org, p_total);
  insert into group_members (card, group_code, idx, name, dob, cls)
  select x->>'card', p_code, (x->>'idx')::int, x->>'name', (x->>'dob')::date, x->>'cls' from jsonb_array_elements(p_members) x;
  return true;
exception when unique_violation then
  return false;
end $$;

-- Quét thẻ học sinh: nguyên tử, nên hai máy quét cùng thẻ thì chỉ một máy thành công.
create or replace function public.scan_member(p_group text, p_card text)
returns text language plpgsql security definer set search_path = public as $$
declare m group_members;
begin
  select * into m from group_members where card = p_card for update;
  if not found or m.group_code <> p_group then return 'foreign'; end if;
  if m.entered then return 'dup'; end if;
  update group_members set entered = true, entered_at = now() where card = p_card;
  return 'ok';
end $$;

create or replace function public.member_spot(p_card text, p_ok boolean)
returns void language sql security definer set search_path = public as $$
  update group_members set spot = p_ok where card = p_card;
$$;

create or replace function public.group_update(p_code text, p_counted int, p_face_ok boolean, p_face_score int, p_finish boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update groups set
    counted = coalesce(p_counted, counted),
    face_ok = coalesce(p_face_ok, face_ok),
    face_score = coalesce(p_face_score, face_score),
    status = case when p_finish then 'used' else status end,
    entered_count = case when p_finish then coalesce(p_counted, (select count(*) from group_members m where m.group_code = p_code and m.entered)) else entered_count end
  where code = p_code;
end $$;

create or replace function public.add_log(p_type text, p_msg text, p_ok boolean)
returns void language sql security definer set search_path = public as $$
  insert into audit_logs (type, msg, ok) values (left(p_type, 20), left(p_msg, 300), p_ok);
$$;

-- Dọn dữ liệu demo (chỉ dùng khi muốn làm lại từ đầu)
create or replace function public.reset_demo()
returns void language sql security definer set search_path = public as $$
  delete from audit_logs where true; delete from group_members where true; delete from groups where true; delete from tickets where true; delete from seat_locks where true; delete from shows where true;
$$;

revoke all on all functions in schema public from public;
grant execute on function public.ensure_schedule, public.hold_seat, public.release_seat, public.release_hold, public.sell_order,
  public.refund_ticket, public.admit_ticket, public.add_show, public.create_group, public.scan_member, public.member_spot,
  public.group_update, public.add_log, public.reset_demo to anon, authenticated;

-- ---------- Realtime ----------
do $$ declare t text; begin
  foreach t in array array['shows','seat_locks','tickets','groups','group_members','audit_logs'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- ============================================================================
-- 002_verification.sql
-- ============================================================================
-- CineVin – migration 002: lưu & kiểm chứng kết quả quét FaceID / VNeID / NFC / passkey.
-- Chạy SAU schema.sql, một lần, trong SQL Editor.
--
-- Hai phía tách bạch:
--   mock_citizens  = CSDL dân cư MÔ PHỎNG (phía Bộ Công an). Chứa ảnh gốc dạng vector 128 số.
--                    Không có policy đọc → web không lấy được vector; chỉ hàm face_check so khớp ở máy chủ.
--   verifications  = nhật ký xác thực của RẠP. Chỉ kết quả (đạt/không, độ tương đồng, phương thức, thời điểm),
--                    không có ảnh, không có vector. Đây là bằng chứng "đã quét, đã lưu".

create table if not exists public.mock_citizens (
  key text primary key,
  name text not null,
  dob date not null,
  id_number text not null,
  face_template float8[],
  template_source text,
  template_at timestamptz
);
alter table public.mock_citizens enable row level security;   -- không tạo policy select: anon không đọc được

insert into public.mock_citizens (key, name, dob, id_number) values
  ('an',   'Nguyễn Văn An', '2004-03-12', '040204001234'),
  ('binh', 'Trần Thị Bình', '2011-08-20', '040311005678'),
  ('cuc',  'Lê Thị Cúc',    '1958-01-05', '040158009012'),
  ('gv',   'Phạm Thu Hà',   '1990-11-02', '040190003456')
on conflict (key) do nothing;

create table if not exists public.verifications (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('faceid', 'vneid', 'nfc', 'passkey', 'doc')),
  ok boolean not null,
  citizen_key text,
  account_name text,
  device_id text,
  method text,
  liveness boolean,
  score int,
  distance numeric,
  detail jsonb
);
create index if not exists verifications_time on public.verifications (created_at desc);
alter table public.verifications enable row level security;
drop policy if exists "read_all" on public.verifications;
create policy "read_all" on public.verifications for select to anon, authenticated using (true);

-- Trạng thái ảnh gốc từng hồ sơ (không lộ vector)
create or replace function public.citizen_status()
returns table (key text, name text, dob date, has_template boolean, template_source text, template_at timestamptz)
language sql security definer set search_path = public as $$
  select key, name, dob, face_template is not null, template_source, template_at from mock_citizens order by key;
$$;

-- So khớp khuôn mặt PHÍA MÁY CHỦ. Lần đầu hồ sơ chưa có ảnh gốc → lưu làm ảnh gốc (mô phỏng ảnh đã có trong CSDL).
create or replace function public.face_check(p_key text, p_descriptor float8[], p_device text, p_account text, p_method text, p_liveness boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c mock_citizens; d float8 := 0; i int; v_ok boolean; v_score int; v_id bigint; v_at timestamptz;
begin
  if array_length(p_descriptor, 1) is distinct from 128 then raise exception 'descriptor_must_have_128_values'; end if;
  select * into c from mock_citizens where key = p_key for update;
  if not found then raise exception 'unknown_citizen'; end if;
  if c.face_template is null then
    update mock_citizens set face_template = p_descriptor, template_source = p_method, template_at = now() where key = p_key;
    insert into verifications (kind, ok, citizen_key, account_name, device_id, method, liveness, score, distance, detail)
    values ('faceid', true, p_key, p_account, p_device, p_method, p_liveness, 100, 0, jsonb_build_object('enrolled', true))
    returning id, created_at into v_id, v_at;
    return jsonb_build_object('ok', true, 'enrolled', true, 'distance', 0, 'score', 100, 'id', v_id, 'saved_at', v_at, 'name', c.name, 'dob', c.dob);
  end if;
  for i in 1..128 loop d := d + (c.face_template[i] - p_descriptor[i]) ^ 2; end loop;
  d := sqrt(d);
  v_ok := d <= 0.5;
  v_score := greatest(0, round((1 - d * d / 2) * 100));
  insert into verifications (kind, ok, citizen_key, account_name, device_id, method, liveness, score, distance, detail)
  values ('faceid', v_ok, p_key, p_account, p_device, p_method, p_liveness, v_score, round(d::numeric, 3), jsonb_build_object('enrolled', false))
  returning id, created_at into v_id, v_at;
  return jsonb_build_object('ok', v_ok, 'enrolled', false, 'distance', round(d::numeric, 3), 'score', v_score, 'id', v_id, 'saved_at', v_at, 'name', c.name, 'dob', c.dob);
end $$;

-- Ghi kết quả các kiểu xác thực khác (VNeID, NFC, passkey, kiểm tra giấy tờ). Trả về id + thời điểm lưu.
create or replace function public.log_verification(p_kind text, p_ok boolean, p_key text, p_account text, p_device text, p_method text, p_detail jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_at timestamptz;
begin
  insert into verifications (kind, ok, citizen_key, account_name, device_id, method, detail)
  values (p_kind, p_ok, p_key, left(p_account, 80), left(p_device, 40), left(p_method, 60), p_detail)
  returning id, created_at into v_id, v_at;
  return jsonb_build_object('id', v_id, 'saved_at', v_at);
end $$;

-- "Đọc chip CCCD" mô phỏng: trả dữ liệu hồ sơ như chip trả về sau khi qua BAC/PACE (web thật không đọc được chip).
create or replace function public.mock_chip_read(p_key text)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('name', name, 'dob', dob, 'id_number', id_number) from mock_citizens where key = p_key;
$$;

-- Xoá ảnh gốc của một hồ sơ để thử đăng ký lại (chỉ dùng cho demo)
create or replace function public.reset_citizen_face(p_key text)
returns void language sql security definer set search_path = public as $$
  update mock_citizens set face_template = null, template_source = null, template_at = null where key = p_key;
$$;

-- reset_demo dọn luôn nhật ký xác thực
create or replace function public.reset_demo()
returns void language sql security definer set search_path = public as $$
  delete from audit_logs where true; delete from group_members where true; delete from groups where true; delete from tickets where true; delete from seat_locks where true; delete from shows where true; delete from verifications where true;
  update mock_citizens set face_template = null, template_source = null, template_at = null where true;
$$;

revoke all on function public.citizen_status, public.face_check, public.log_verification, public.mock_chip_read, public.reset_citizen_face from public;
grant execute on function public.citizen_status, public.face_check, public.log_verification, public.mock_chip_read, public.reset_citizen_face, public.reset_demo to anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table public.verifications;
exception when duplicate_object then null; end $$;

-- ============================================================================
-- 003_fix_reset.sql
-- ============================================================================
-- 003: sửa reset_demo (Supabase chặn DELETE không có WHERE khi gọi qua API)
-- và xoá luôn ảnh gốc khuôn mặt mô phỏng để kiểm thử lại từ đầu.
create or replace function public.reset_demo()
returns void language sql security definer set search_path = public as $$
  delete from audit_logs where true; delete from group_members where true; delete from groups where true;
  delete from tickets where true; delete from seat_locks where true; delete from shows where true;
  delete from verifications where true;
  update mock_citizens set face_template = null, template_source = null, template_at = null where true;
$$;
grant execute on function public.reset_demo to anon, authenticated;

-- ============================================================================
-- 004_auth_qr.sql
-- ============================================================================
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
drop function if exists public.list_users(uuid);   -- 006 đổi kiểu trả về; chạy lại file gộp không lỗi
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

drop function if exists public.refund_ticket_u(uuid, text);   -- 005 đổi kiểu trả về
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

-- ============================================================================
-- 005_customer.sql
-- ============================================================================
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

-- ---------- người đi cùng có tài khoản: vé gắn vào tài khoản bạn, tuổi lấy từ hồ sơ VNeID của bạn ----------
alter table public.tickets add column if not exists viewer_user text;
create index if not exists tickets_viewer on public.tickets (viewer_user);

-- Người mua tra bạn đi cùng theo email / tên đăng nhập / SĐT: chỉ trả tên, đã xác thực chưa, tuổi tại ngày chiếu (không trả ngày sinh, email)
create or replace function public.companion_check(p_token uuid, p_id text, p_show text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me app_users; f app_users; s shows; age int;
begin
  me := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  f := _find_user(p_id);
  if f.username is null then raise exception 'companion_unknown'; end if;
  if f.username = me.username then raise exception 'companion_self'; end if;
  if f.role <> 'khach' then raise exception 'companion_unknown'; end if;
  select * into s from shows where id = p_show;
  age := case when f.citizen_key is null then null else extract(year from age(coalesce(s.start_at, now()), f.dob))::int end;
  return jsonb_build_object('username', f.username, 'name', f.display_name, 'verified', f.citizen_key is not null, 'age', age);
end $$;

-- Bán đơn: với vé gắn bạn đi cùng, máy chủ tự chốt verified / need_doc / tên theo hồ sơ của bạn đó
create or replace function public._apply_companions(p_owner text, p_show text, p_tickets jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare x jsonb; f app_users; s shows; fm text; min_age int; age int;
begin
  select * into s from shows where id = p_show;
  for x in select * from jsonb_array_elements(p_tickets) loop
    continue when coalesce(x->>'viewer_user', '') = '';
    select * into f from app_users where username = x->>'viewer_user';
    if f.username is null or f.username = p_owner then raise exception 'companion_unknown'; end if;
    if f.citizen_key is not null then
      age := extract(year from age(s.start_at, f.dob))::int;
      fm := s.film_id; min_age := case fm when 'f3' then 13 when 'f4' then 16 when 'f5' then 18 else 0 end;
      if age < min_age then raise exception 'companion_underage'; end if;
      update tickets set viewer_user = f.username, viewer_name = f.display_name, verified = true, need_doc = false, reason = null where code = x->>'code';
    else
      update tickets set viewer_user = f.username, viewer_name = f.display_name, verified = false,
        need_doc = case when (select film_id from shows where id = p_show) in ('f3', 'f4', 'f5') then true else need_doc end,
        reason = 'Bạn đi cùng chưa xác thực VNeID – kiểm tra giấy tờ tại cửa' where code = x->>'code';
    end if;
  end loop;
end $$;

-- QR vé: bạn đi cùng cũng lấy được QR vé của mình (ghi đè ticket_qr của 004)
create or replace function public.ticket_qr(p_token uuid, p_code text, p_back int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u app_users; t tickets; w bigint := floor(extract(epoch from now()) / 15);
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  select * into t from tickets where code = p_code;
  if t.code is null then raise exception 'unknown_ticket'; end if;
  if u.role = 'khach' and coalesce(t.owner_user, '') <> u.username and coalesce(t.viewer_user, '') <> u.username then raise exception 'forbidden'; end if;
  if p_back <> 0 and u.role <> 'quanly' then raise exception 'forbidden'; end if;
  w := w - greatest(p_back, 0);
  return jsonb_build_object('payload', 'CV1.' || t.code || '.' || w || '.' || _qr_sig(t.code, w),
    'status', t.status, 'issued_at', to_timestamp(w * 15), 'next_at', to_timestamp((w + 1) * 15));
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
  perform _apply_companions(u.username, p_show, p_tickets);
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
    from tickets t join app_users a on a.username = coalesce(t.viewer_user, t.owner_user) join shows s on s.id = t.show_id
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
  public.order_tickets(uuid, text), public.admit_many_s(uuid, text[]), public.companion_check(uuid, text, text)
  to anon, authenticated;
revoke execute on function public._apply_companions(text, text, jsonb) from public, anon, authenticated;

-- ============================================================================
-- 006_chain.sql
-- ============================================================================
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

-- ============================================================================
-- 007_promo.sql
-- ============================================================================
-- CineVin – migration 007: mã khuyến mãi dùng chung (promo) mỗi khách dùng một lần, không "cháy" sau người đầu tiên.
--   Thẻ quà tặng (gift) vẫn dùng một lần. Chạy SAU 006. Chạy lại nhiều lần không sao.

create table if not exists public.voucher_uses (
  code text not null references public.vouchers(code) on delete cascade,
  username text not null,
  used_at timestamptz not null default now(),
  primary key (code, username)
);
alter table public.voucher_uses enable row level security;
-- mã promo đã bị đánh dấu dùng bởi người đầu tiên → chuyển sang bảng lượt dùng
insert into public.voucher_uses (code, username, used_at)
select code, used_by, used_at from public.vouchers where kind = 'promo' and owner_user is null and used_at is not null and used_by is not null
on conflict do nothing;
update public.vouchers set used_at = null, used_by = null where kind = 'promo' and owner_user is null;

-- promo: hợp lệ nếu người này chưa dùng; gift: chưa dùng và đúng chủ
create or replace function public._voucher_ok(v public.vouchers, p_user text)
returns boolean language sql stable as $$
  select v.code is not null
    and (v.expires_at is null or v.expires_at > now())
    and case when v.kind = 'promo' and v.owner_user is null
             then not exists (select 1 from voucher_uses x where x.code = v.code and x.username = p_user)
             else v.used_at is null and (v.owner_user is null or v.owner_user = p_user) end;
$$;

create or replace function public.voucher_check(p_token uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; v vouchers;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  select * into v from vouchers where code = upper(trim(p_code));
  if v.code is null then raise exception 'voucher_unknown'; end if;
  if v.expires_at is not null and v.expires_at < now() then raise exception 'voucher_expired'; end if;
  if v.owner_user is not null and v.owner_user <> u.username then raise exception 'voucher_not_yours'; end if;
  if not _voucher_ok(v, u.username) then raise exception 'voucher_used'; end if;
  return jsonb_build_object('code', v.code, 'kind', v.kind, 'amount', v.amount, 'percent', v.percent, 'expires_at', v.expires_at);
end $$;

drop function if exists public.my_vouchers(uuid);
create or replace function public.my_vouchers(p_token uuid)
returns table (code text, kind text, amount numeric, percent int, expires_at timestamptz, used_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  return query select v.code, v.kind, v.amount, v.percent, v.expires_at,
      case when v.kind = 'promo' and v.owner_user is null then (select x.used_at from voucher_uses x where x.code = v.code and x.username = u.username) else v.used_at end
    from vouchers v
    where v.owner_user = u.username or (v.owner_user is null and v.kind = 'promo' and (v.expires_at is null or v.expires_at > now()))
    order by 6 nulls first, v.created_at desc;
end $$;

create or replace function public.sell_order_u(p_token uuid, p_show text, p_hold text, p_tickets jsonb, p_voucher text default null, p_points int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; v vouchers; gross numeric; disc numeric := 0; pts int := 0; paid numeric; earn int;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  select coalesce(sum((x->>'price')::numeric), 0) into gross from jsonb_array_elements(p_tickets) x;
  if p_voucher is not null and p_voucher <> '' then
    select * into v from vouchers where code = upper(trim(p_voucher)) for update;
    if not _voucher_ok(v, u.username) then raise exception 'voucher_invalid'; end if;
    disc := case when v.kind = 'gift' then least(v.amount, gross) else round(gross * v.percent / 100) end;
  end if;
  pts := least(greatest(coalesce(p_points, 0), 0), u.points, floor((gross - disc) / 1000)::int);
  paid := greatest(0, gross - disc - pts * 1000);
  perform sell_order(p_show, p_hold, p_tickets);
  update tickets set owner_user = u.username
  where code in (select x->>'code' from jsonb_array_elements(p_tickets) x) and coalesce(channel, '') <> 'Quầy';
  perform _apply_companions(u.username, p_show, p_tickets);
  if v.code is not null then
    if v.kind = 'promo' and v.owner_user is null then insert into voucher_uses (code, username) values (v.code, u.username);
    else update vouchers set used_at = now(), used_by = u.username where code = v.code; end if;
  end if;
  earn := case when u.role = 'khach' then floor(paid * 0.05 / 1000)::int else 0 end;
  update app_users set points = points - pts + earn where username = u.username;
  insert into audit_logs (type, msg, ok) values ('pay', format('@%s thanh toán %s đ (giảm %s đ, dùng %s điểm, +%s điểm)', u.username, paid, disc, pts, earn), true);
  return jsonb_build_object('gross', gross, 'discount', disc, 'points_used', pts, 'paid', paid, 'points_earned', earn, 'points', u.points - pts + earn);
end $$;

revoke execute on function public._voucher_ok(public.vouchers, text) from public, anon, authenticated;
grant execute on function public.voucher_check(uuid, text), public.my_vouchers(uuid), public.sell_order_u(uuid, text, text, jsonb, text, int) to anon, authenticated;

-- ============================================================================
-- 008_admin.sql
-- ============================================================================
-- CineVin – migration 008: quản trị chuỗi. Chạy SAU 007. Chạy lại nhiều lần không sao.
--   Cơ sở & phòng: thêm/sửa/xoá, phòng bảo trì, ghế khoá, loại phòng IMAX.
--   Kho phim dùng chung + phân phối phim cho từng cơ sở.
--   Suất chiếu: đổi giờ / đổi phòng / huỷ suất (hoàn tiền vào thẻ quà tặng của từng khách).
--   Vai trò kỹ thuật (phòng chiếu, ghế); nhật ký đăng nhập và thao tác quản trị trong audit_logs.

-- ---------- vai trò kỹ thuật ----------
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role in ('khach', 'nhanvien', 'kythuat', 'phucvu', 'quanly'));   -- 'phucvu' thêm ở 016, ghi sẵn để chạy lại không lỗi
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

-- ============================================================================
-- 009_seats.sql
-- ============================================================================
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

-- ============================================================================
-- 010_seat_info.sql
-- ============================================================================
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

-- ============================================================================
-- 011_seat_types.sql
-- ============================================================================
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

-- ============================================================================
-- 012_zero.sql
-- ============================================================================
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

-- ============================================================================
-- 013_fixed_price.sql
-- ============================================================================
-- CineVin – migration 013: giá cứng cho loại ghế. Chạy SAU 012. Chạy lại nhiều lần không sao.
--   Mỗi loại ghế chọn một trong hai cách tính: (a) giá cơ bản × số người + phụ thu (như cũ), (b) GIÁ CỨNG theo hạng rạp A/B –
--   giá cuối cùng cho cả ghế (ghế đôi = cả cặp), không phụ thuộc ngày / đối tượng / loại phòng.
alter table public.seat_types add column if not exists fixed_a numeric;   -- null = không dùng giá cứng
alter table public.seat_types add column if not exists fixed_b numeric;

create or replace function public.save_seat_type_s(p_token uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; v_id text := p->>'id';
begin
  u := _need(p_token, array['quanly']);
  if u.cinema_id is not null then raise exception 'forbidden'; end if;
  if v_id !~ '^[a-z0-9_]{1,16}$' or length(trim(coalesce(p->>'name', ''))) < 1 then raise exception 'bad_input'; end if;
  if v_id in ('std', 'blocked') and coalesce((p->>'sellable')::boolean, v_id = 'std') <> (v_id = 'std') then raise exception 'bad_input'; end if;
  if (p->>'fixed_a') is not null and (p->>'fixed_a')::numeric <= 0 then raise exception 'bad_input'; end if;
  if (p->>'fixed_b') is not null and (p->>'fixed_b')::numeric <= 0 then raise exception 'bad_input'; end if;
  insert into seat_types (id, name, persons, surcharge_a, surcharge_b, fixed_a, fixed_b, color, icon, sellable, sort, active)
  values (v_id, trim(p->>'name'), coalesce((p->>'persons')::int, 1), coalesce((p->>'surcharge_a')::numeric, 0), coalesce((p->>'surcharge_b')::numeric, 0),
          (p->>'fixed_a')::numeric, (p->>'fixed_b')::numeric,
          coalesce(p->>'color', 'gray'), nullif(p->>'icon', ''), coalesce((p->>'sellable')::boolean, true), coalesce((p->>'sort')::int, 100), coalesce((p->>'active')::boolean, true))
  on conflict (id) do update set name = excluded.name, persons = excluded.persons, surcharge_a = excluded.surcharge_a, surcharge_b = excluded.surcharge_b,
    fixed_a = excluded.fixed_a, fixed_b = excluded.fixed_b, color = excluded.color, icon = excluded.icon, sellable = excluded.sellable, sort = excluded.sort, active = excluded.active;
  perform _admin_log(u.username, format('lưu loại ghế %s "%s" (%s người, %s%s)', v_id, trim(p->>'name'), coalesce((p->>'persons')::int, 1),
    case when (p->>'fixed_a') is not null then format('giá cứng A %s / B %s', p->>'fixed_a', p->>'fixed_b') else format('phụ thu A %s / B %s', coalesce((p->>'surcharge_a')::numeric, 0), coalesce((p->>'surcharge_b')::numeric, 0)) end,
    case when coalesce((p->>'sellable')::boolean, true) then '' else ', không bán' end));
end $$;
grant execute on function public.save_seat_type_s(uuid, jsonb) to anon, authenticated;

-- ============================================================================
-- 014_own_identity.sql
-- ============================================================================
-- CineVin – migration 014: xác thực VNeID / FaceID theo CHÍNH CHỦ tài khoản. Chạy SAU 013. Chạy lại nhiều lần không sao.
--   Trước: chọn một hồ sơ dân cư mẫu. Nay: người dùng khai họ tên, ngày sinh, số căn cước của mình (mô phỏng app VNeID
--   trả hồ sơ thật về), khuôn mặt của chính họ được ghi làm ảnh gốc; đăng nhập VNeID = số căn cước + khuôn mặt.
--   Hồ sơ của tài khoản có key = 'u_<tên đăng nhập>' trong mock_citizens. Hồ sơ mẫu (an, binh, cuc, gv) chỉ còn cho kiểm thử.

create or replace function public.register_citizen_s(p_token uuid, p_name text, p_dob date, p_id_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; k text;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'kythuat', 'quanly']);
  k := 'u_' || u.username;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'bad_input'; end if;
  if p_dob is null or p_dob > current_date - interval '5 years' or p_dob < current_date - interval '110 years' then raise exception 'bad_dob'; end if;
  if p_id_number !~ '^[0-9]{12}$' then raise exception 'bad_id_number'; end if;
  if exists (select 1 from mock_citizens where id_number = p_id_number and key <> k) then raise exception 'id_taken'; end if;
  if u.citizen_key is not null and u.citizen_key <> k then raise exception 'already_linked'; end if;
  insert into mock_citizens (key, name, dob, id_number) values (k, trim(p_name), p_dob, p_id_number)
  on conflict (key) do update set name = excluded.name, dob = excluded.dob, id_number = excluded.id_number,
    -- đổi ngày sinh / số căn cước = người khác → phải chụp lại ảnh gốc
    face_template = case when mock_citizens.dob = excluded.dob and mock_citizens.id_number = excluded.id_number then mock_citizens.face_template end,
    template_source = case when mock_citizens.dob = excluded.dob and mock_citizens.id_number = excluded.id_number then mock_citizens.template_source end,
    template_at = case when mock_citizens.dob = excluded.dob and mock_citizens.id_number = excluded.id_number then mock_citizens.template_at end;
  return jsonb_build_object('key', k, 'name', trim(p_name), 'dob', p_dob, 'has_template', (select face_template is not null from mock_citizens where key = k));
end $$;

-- Đăng nhập VNeID: số căn cước (hoặc tên đăng nhập / email / SĐT) + khuôn mặt so với ảnh gốc của chính chủ
create or replace function public.login_vneid2(p_id text, p_descriptor float8[], p_device text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; r jsonb; t uuid;
begin
  if p_id ~ '^[0-9]{12}$' then
    select a.* into u from app_users a join mock_citizens c on c.key = a.citizen_key where c.id_number = p_id limit 1;
  else u := _find_user(p_id); end if;
  if u.username is null then raise exception 'vneid_not_linked'; end if;
  if u.citizen_key is null then raise exception 'face_not_linked'; end if;
  if (select face_template is null from mock_citizens where key = u.citizen_key) then raise exception 'face_not_enrolled'; end if;
  r := face_check(u.citizen_key, p_descriptor, p_device, 'Đăng nhập VNeID @' || u.username, 'VNeID', true);
  insert into verifications (kind, ok, citizen_key, account_name, device_id, method, score, detail)
  values ('login', (r->>'ok')::boolean, u.citizen_key, u.display_name, p_device, 'VNeID', (r->>'score')::int, jsonb_build_object('user', u.username, 'face_record', r->'id'));
  if not (r->>'ok')::boolean then return jsonb_build_object('ok', false, 'error', 'face_mismatch', 'score', r->'score', 'distance', r->'distance'); end if;
  insert into sessions (username) values (u.username) returning token into t;
  insert into audit_logs (type, msg, ok) values ('login', format('@%s đăng nhập bằng VNeID + khuôn mặt (%s)', u.username, u.role), true);
  return _session_json(t) || jsonb_build_object('ok', true, 'score', r->'score');
end $$;

-- Nhân viên tra hồ sơ khách (khách quên vé, kiểm tuổi bằng FaceID): số căn cước / SĐT / email / tên đăng nhập → hồ sơ để đối chiếu khuôn mặt
create or replace function public.citizen_lookup_s(p_token uuid, p_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u app_users; c mock_citizens;
begin
  perform _need(p_token, array['nhanvien', 'quanly']);
  if p_id ~ '^[0-9]{12}$' then
    select a.* into u from app_users a join mock_citizens x on x.key = a.citizen_key where x.id_number = p_id limit 1;
  else u := _find_user(p_id); end if;
  if u.username is null or u.citizen_key is null then raise exception 'vneid_not_linked'; end if;
  select * into c from mock_citizens where key = u.citizen_key;
  return jsonb_build_object('key', c.key, 'name', c.name, 'dob', c.dob, 'username', u.username, 'has_template', c.face_template is not null);
end $$;

-- reset_demo: xoá luôn hồ sơ định danh của tài khoản kiểm thử đã bị xoá
create or replace function public.reset_demo()
returns void language sql security definer set search_path = public as $$
  delete from audit_logs where true; delete from group_members where true; delete from groups where true;
  delete from tickets where true; delete from seat_locks where true; delete from shows where true;
  delete from verifications where true;
  delete from vouchers where kind = 'gift'; delete from voucher_uses where true;
  delete from app_users where role = 'khach' and (display_name in ('Khách Kiểm Thử', 'Khách Kiểm Tuổi', 'Bạn Chưa Xác Thực') or username ~ '^(kt|smu)[a-z0-9]+$');
  delete from mock_citizens where key like 'u\_%' and not exists (select 1 from app_users a where a.citizen_key = mock_citizens.key);
  update app_users set points = 120 where role = 'khach';
  update mock_citizens set face_template = null, template_source = null, template_at = null where true;
$$;

grant execute on function public.register_citizen_s(uuid, text, date, text), public.login_vneid2(text, float8[], text), public.citizen_lookup_s(uuid, text), public.reset_demo() to anon, authenticated;

-- ============================================================================
-- 015_price_tiers.sql
-- ============================================================================
-- CineVin – migration 015: bảng giá hạng A / hạng B sửa được. Chạy SAU 014. Chạy lại nhiều lần không sao.
--   Hạng giá của cơ sở (A = thành phố lớn, B = tỉnh) trước đây cố định trong mã; nay quản lý chuỗi tự đặt
--   (ví dụ hạng A người lớn ngày thường 115.000 → 150.000). Cơ sở có bảng giá riêng (006/011) vẫn ưu tiên bảng riêng.
create table if not exists public.price_tiers (
  id text primary key check (id in ('A', 'B')),
  name text not null,
  prices jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.price_tiers enable row level security;
drop policy if exists "read_all" on public.price_tiers; create policy "read_all" on public.price_tiers for select to anon, authenticated using (true);
do $$ begin alter publication supabase_realtime add table public.price_tiers; exception when duplicate_object then null; end $$;
insert into public.price_tiers (id, name, prices) values
  ('A', 'Hạng A (Thành phố)', '{"weekday":{"adult":115000,"child":68000,"senior":83000,"u22":70000},"wed":{"adult":79000,"child":68000,"senior":79000,"u22":70000},"weekend":{"adult":135000,"child":68000,"senior":93000,"u22":70000},"vip":5500,"couple":26000,"gold":60000,"imax":80000,"s3d":{"weekday":32000,"weekend":53000},"holiday":11000}'::jsonb),
  ('B', 'Hạng B (Cơ bản)', '{"weekday":{"adult":70000,"child":50000,"senior":50000,"u22":60000},"wed":{"adult":60000,"child":50000,"senior":60000,"u22":60000},"weekend":{"adult":85000,"child":58000,"senior":58000,"u22":60000},"vip":5500,"couple":16000,"gold":40000,"imax":60000,"s3d":{"weekday":32000,"weekend":32000},"holiday":11000}'::jsonb)
on conflict (id) do nothing;

create or replace function public.save_price_tier_s(p_token uuid, p_tier text, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; d text; a text;
begin
  u := _need(p_token, array['quanly']);
  if u.cinema_id is not null then raise exception 'forbidden'; end if;   -- hạng giá dùng chung toàn chuỗi
  if p_tier not in ('A', 'B') then raise exception 'bad_input'; end if;
  foreach d in array array['weekday', 'wed', 'weekend'] loop
    foreach a in array array['adult', 'u22', 'child', 'senior'] loop
      if jsonb_typeof(p->d->a) <> 'number' or (p->d->>a)::numeric < 0 then raise exception 'bad_input'; end if;
    end loop;
    if (p->d->>'adult')::numeric <= 0 then raise exception 'bad_input'; end if;
  end loop;
  update price_tiers set prices = p, updated_at = now() where id = p_tier;
  perform _admin_log(u.username, format('bảng giá hạng %s: người lớn %s / %s / %s', p_tier, p->'weekday'->>'adult', p->'wed'->>'adult', p->'weekend'->>'adult'));
end $$;
grant execute on function public.save_price_tier_s(uuid, text, jsonb) to anon, authenticated;

-- ============================================================================
-- 016_hr.sql
-- ============================================================================
-- CineVin – migration 016: quản lý nhân viên & tài khoản. Chạy SAU 015. Chạy lại nhiều lần không sao.
--   Hồ sơ nhân viên (ngày sinh, SĐT, email, chức vụ, cơ sở, hợp đồng, lương), vai trò phục vụ, khoá tài khoản,
--   ca làm việc (phân ca theo ngày/tuần/tháng, nhân viên xác nhận), chấm công vào/ra (có FaceID), nghỉ phép / tăng ca,
--   thưởng / vi phạm, thống kê hiệu suất (vé bán tại quầy theo nhân viên) → lương ước tính. Log đăng nhập / quản trị đã có (008).

-- ---------- tài khoản: hồ sơ nhân viên, khoá, vai trò phục vụ ----------
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role in ('khach', 'nhanvien', 'kythuat', 'phucvu', 'quanly'));
alter table public.app_users add column if not exists active boolean not null default true;
alter table public.app_users add column if not exists position text;           -- chức vụ hiển thị: Bán vé, Soát vé, Kỹ thuật, Phục vụ, Quản lý ca…
alter table public.app_users add column if not exists department text;         -- phòng ban: Quầy, Phòng chiếu, Sảnh…
alter table public.app_users add column if not exists hired_at date;
alter table public.app_users add column if not exists contract_type text;      -- thử việc | chính thức | thời vụ
alter table public.app_users add column if not exists contract_until date;
alter table public.app_users add column if not exists hourly_rate numeric not null default 0;     -- đ/giờ
alter table public.app_users add column if not exists salary_base numeric not null default 0;     -- lương cứng/tháng
alter table public.app_users add column if not exists bonus_pct numeric not null default 0;       -- % doanh thu quầy thưởng
alter table public.app_users add column if not exists insurance boolean not null default false;
alter table public.app_users add column if not exists notes text;
alter table public.tickets add column if not exists sold_by text;              -- nhân viên bán tại quầy (hiệu suất)
create index if not exists tickets_sold_by on public.tickets (sold_by, created_at);

-- tài khoản bị khoá → mọi hàm có token từ chối
create or replace function public._need(p_token uuid, p_roles text[])
returns public.app_users language plpgsql stable security definer set search_path = public as $$
declare u app_users;
begin
  select * into u from _me(p_token);
  if u.username is null then raise exception 'not_logged_in'; end if;
  if not coalesce(u.active, true) then raise exception 'account_disabled'; end if;
  if not (u.role = any(p_roles)) then raise exception 'forbidden'; end if;
  return u;
end $$;
create or replace function public.login(p_user text, p_pass text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u app_users; t uuid;
begin
  u := _find_user(p_user);
  if u.username is null or u.pass_hash <> extensions.crypt(p_pass, u.pass_hash) then raise exception 'invalid_login'; end if;
  if not coalesce(u.active, true) then raise exception 'account_disabled'; end if;
  delete from sessions where username = u.username and expires_at < now();
  insert into sessions (username) values (u.username) returning token into t;
  insert into audit_logs (type, msg, ok) values ('login', format('@%s đăng nhập bằng mật khẩu (%s%s)', u.username, u.role, case when u.cinema_id is not null then ', rạp ' || u.cinema_id else '' end), true);
  return _session_json(t);
end $$;

-- vé bán tại quầy ghi nhân viên bán (hiệu suất); chạy sau sell_order_u của 007
create or replace function public.sell_order_u(p_token uuid, p_show text, p_hold text, p_tickets jsonb, p_voucher text default null, p_points int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; v vouchers; gross numeric; disc numeric := 0; pts int := 0; paid numeric; earn int;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  select coalesce(sum((x->>'price')::numeric), 0) into gross from jsonb_array_elements(p_tickets) x;
  if p_voucher is not null and p_voucher <> '' then
    select * into v from vouchers where code = upper(trim(p_voucher)) for update;
    if not _voucher_ok(v, u.username) then raise exception 'voucher_invalid'; end if;
    disc := case when v.kind = 'gift' then least(v.amount, gross) else round(gross * v.percent / 100) end;
  end if;
  pts := least(greatest(coalesce(p_points, 0), 0), u.points, floor((gross - disc) / 1000)::int);
  paid := greatest(0, gross - disc - pts * 1000);
  perform sell_order(p_show, p_hold, p_tickets);
  update tickets set owner_user = u.username
  where code in (select x->>'code' from jsonb_array_elements(p_tickets) x) and coalesce(channel, '') <> 'Quầy';
  update tickets set sold_by = u.username where code in (select x->>'code' from jsonb_array_elements(p_tickets) x) and u.role <> 'khach';
  perform _apply_companions(u.username, p_show, p_tickets);
  if v.code is not null then
    if v.kind = 'promo' and v.owner_user is null then insert into voucher_uses (code, username) values (v.code, u.username);
    else update vouchers set used_at = now(), used_by = u.username where code = v.code; end if;
  end if;
  earn := case when u.role = 'khach' then floor(paid * 0.05 / 1000)::int else 0 end;
  update app_users set points = points - pts + earn where username = u.username;
  insert into audit_logs (type, msg, ok) values ('pay', format('@%s thanh toán %s đ (giảm %s đ, dùng %s điểm, +%s điểm)', u.username, paid, disc, pts, earn), true);
  return jsonb_build_object('gross', gross, 'discount', disc, 'points_used', pts, 'paid', paid, 'points_earned', earn, 'points', u.points - pts + earn);
end $$;

-- ---------- bảng ca, chấm công, nghỉ phép, thưởng / vi phạm ----------
create table if not exists public.shifts (
  id bigserial primary key,
  cinema_id text not null references public.cinemas(id) on delete cascade,
  username text not null,
  day date not null,
  start_at timestamptz not null, end_at timestamptz not null,
  kind text not null default 'sang',        -- sang | chieu | toi | khac
  duty text not null default 'quay',        -- quay | soatve | kythuat | phucvu | quanly
  status text not null default 'planned' check (status in ('planned', 'confirmed', 'declined', 'cancelled')),
  note text, created_by text, created_at timestamptz not null default now()
);
create index if not exists shifts_cinema_day on public.shifts (cinema_id, day);
create index if not exists shifts_user_day on public.shifts (username, day);
create table if not exists public.attendance (
  id bigserial primary key,
  shift_id bigint references public.shifts(id) on delete cascade,
  username text not null,
  check_in timestamptz, check_out timestamptz,
  method text,                               -- face | manual | qr
  late_min int not null default 0,
  face_record bigint, note text,
  unique (shift_id, username)
);
create table if not exists public.leaves (
  id bigserial primary key,
  username text not null, cinema_id text,
  kind text not null default 'nghi' check (kind in ('nghi', 'tangca')),
  day_from date not null, day_to date not null,
  hours numeric,                             -- tăng ca: số giờ
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by text, created_at timestamptz not null default now()
);
create table if not exists public.staff_notes (
  id bigserial primary key,
  username text not null,
  kind text not null check (kind in ('reward', 'violation')),
  amount numeric not null default 0,         -- thưởng (+) / phạt (−) đ
  note text, created_by text, created_at timestamptz not null default now()
);
alter table public.shifts enable row level security; alter table public.attendance enable row level security;
alter table public.leaves enable row level security; alter table public.staff_notes enable row level security;
do $$ begin alter publication supabase_realtime add table public.shifts; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.attendance; exception when duplicate_object then null; end $$;

create or replace function public._staff_scope(u public.app_users, p_cinema text) returns boolean language sql immutable as $$
  select u.cinema_id is null or u.cinema_id = p_cinema;
$$;

-- Danh sách nhân sự (không gồm khách), tìm theo tên / tài khoản / SĐT / email / chức vụ; quản lý rạp chỉ thấy rạp mình
create or replace function public.staff_list_s(p_token uuid, p_q text default null)
returns table (username text, role text, display_name text, cinema_id text, phone text, email text, dob date, "position" text, department text, active boolean, hired_at date,
  contract_type text, contract_until date, hourly_rate numeric, salary_base numeric, bonus_pct numeric, insurance boolean, notes text, vneid boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare u app_users; q text := lower(coalesce(p_q, ''));
begin
  u := _need(p_token, array['quanly']);
  return query select a.username, a.role, a.display_name, a.cinema_id, a.phone, a.email, a.dob, a.position, a.department, a.active, a.hired_at,
      a.contract_type, a.contract_until, a.hourly_rate, a.salary_base, a.bonus_pct, a.insurance, a.notes, a.citizen_key is not null, a.created_at
    from app_users a where a.role <> 'khach' and (u.cinema_id is null or a.cinema_id = u.cinema_id)
      and (q = '' or lower(coalesce(a.display_name, '')) like '%' || q || '%' or a.username like '%' || q || '%' or coalesce(a.phone, '') like '%' || q || '%'
           or lower(coalesce(a.email, '')) like '%' || q || '%' or lower(coalesce(a.position, '')) like '%' || q || '%' or a.role like '%' || q || '%')
    order by a.active desc, a.role desc, a.display_name;
end $$;

-- Thêm / sửa nhân viên: hồ sơ + tài khoản. p.username bắt buộc; tạo mới cần p.pass; sửa có thể kèm p.pass để đặt lại mật khẩu
create or replace function public.staff_save_s(p_token uuid, p jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare u app_users; un text := lower(trim(p->>'username')); r text := coalesce(p->>'role', 'nhanvien'); cid text := nullif(p->>'cinema_id', ''); ex app_users;
begin
  u := _need(p_token, array['quanly']);
  if r not in ('nhanvien', 'kythuat', 'phucvu', 'quanly') then raise exception 'bad_role'; end if;
  if un !~ '^[a-z0-9_.]{3,32}$' then raise exception 'bad_username'; end if;
  if length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'bad_input'; end if;
  if u.cinema_id is not null and (cid is null or cid <> u.cinema_id) then raise exception 'wrong_cinema'; end if;
  if cid is not null and not exists (select 1 from cinemas where id = cid) then raise exception 'unknown_cinema'; end if;
  if (p->>'phone') is not null and (p->>'phone') <> '' and regexp_replace(p->>'phone', '[^0-9]', '', 'g') !~ '^0[0-9]{9}$' then raise exception 'bad_phone'; end if;
  select * into ex from app_users where username = un;
  if ex.username is null then
    if length(coalesce(p->>'pass', '')) < 6 then raise exception 'weak_password'; end if;
    insert into app_users (username, pass_hash, role, display_name, cinema_id) values (un, extensions.crypt(p->>'pass', extensions.gen_salt('bf', 8)), r, left(trim(p->>'name'), 60), cid);
    perform _admin_log(u.username, format('thêm nhân viên @%s (%s%s)', un, r, case when cid is not null then ', rạp ' || cid else '' end));
  else
    if ex.role = 'khach' then raise exception 'bad_role'; end if;
    if u.cinema_id is not null and ex.cinema_id <> u.cinema_id then raise exception 'wrong_cinema'; end if;
    if ex.username = u.username and (r <> u.role or coalesce((p->>'active')::boolean, true) = false) then raise exception 'bad_input'; end if;   -- không tự hạ quyền / tự khoá
    if length(coalesce(p->>'pass', '')) >= 6 then update app_users set pass_hash = extensions.crypt(p->>'pass', extensions.gen_salt('bf', 8)) where username = un;
      perform _admin_log(u.username, 'đặt lại mật khẩu @' || un); end if;
    perform _admin_log(u.username, format('sửa nhân viên @%s (%s%s%s)', un, r, case when cid is not null then ', rạp ' || cid else '' end, case when coalesce((p->>'active')::boolean, true) then '' else ', KHOÁ' end));
  end if;
  update app_users set role = r, display_name = left(trim(p->>'name'), 60), cinema_id = cid, phone = nullif(regexp_replace(coalesce(p->>'phone', ''), '[^0-9]', '', 'g'), ''),
    email = nullif(lower(trim(coalesce(p->>'email', ''))), ''), dob = (p->>'dob')::date, position = nullif(p->>'position', ''), department = nullif(p->>'department', ''),
    active = coalesce((p->>'active')::boolean, true), hired_at = (p->>'hired_at')::date, contract_type = nullif(p->>'contract_type', ''), contract_until = (p->>'contract_until')::date,
    hourly_rate = coalesce((p->>'hourly_rate')::numeric, 0), salary_base = coalesce((p->>'salary_base')::numeric, 0), bonus_pct = coalesce((p->>'bonus_pct')::numeric, 0),
    insurance = coalesce((p->>'insurance')::boolean, false), notes = nullif(p->>'notes', '')
  where username = un;
  if not coalesce((p->>'active')::boolean, true) then delete from sessions where username = un; end if;
exception when unique_violation then raise exception 'email_taken';
end $$;

-- Tài khoản (kể cả khách): tìm, khoá / mở, đặt lại mật khẩu – quản lý chuỗi; quản lý rạp chỉ nhân sự rạp mình
create or replace function public.account_list_s(p_token uuid, p_q text default null, p_role text default null)
returns table (username text, role text, display_name text, cinema_id text, phone text, email text, active boolean, vneid boolean, points int, created_at timestamptz, last_login timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare u app_users; q text := lower(coalesce(p_q, ''));
begin
  u := _need(p_token, array['quanly']);
  return query select a.username, a.role, a.display_name, a.cinema_id, a.phone, a.email, a.active, a.citizen_key is not null, a.points, a.created_at,
      (select max(s.expires_at) - interval '7 days' from sessions s where s.username = a.username)
    from app_users a where (u.cinema_id is null or a.cinema_id = u.cinema_id) and (p_role is null or a.role = p_role)
      and (q = '' or lower(coalesce(a.display_name, '')) like '%' || q || '%' or a.username like '%' || q || '%' or coalesce(a.phone, '') like '%' || q || '%' or lower(coalesce(a.email, '')) like '%' || q || '%')
    order by a.created_at desc limit 200;
end $$;
create or replace function public.account_set_s(p_token uuid, p_user text, p_active boolean default null, p_pass text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare u app_users; ex app_users;
begin
  u := _need(p_token, array['quanly']);
  select * into ex from app_users where username = p_user;
  if ex.username is null then raise exception 'unknown_user'; end if;
  if u.cinema_id is not null and (ex.role = 'khach' or ex.cinema_id <> u.cinema_id) then raise exception 'wrong_cinema'; end if;
  if ex.username = u.username and p_active = false then raise exception 'bad_input'; end if;
  if p_active is not null then update app_users set active = p_active where username = p_user; if not p_active then delete from sessions where username = p_user; end if;
    perform _admin_log(u.username, format('%s tài khoản @%s', case when p_active then 'mở' else 'khoá' end, p_user)); end if;
  if p_pass is not null then if length(p_pass) < 6 then raise exception 'weak_password'; end if;
    update app_users set pass_hash = extensions.crypt(p_pass, extensions.gen_salt('bf', 8)) where username = p_user; perform _admin_log(u.username, 'đặt lại mật khẩu @' || p_user); end if;
end $$;

-- Ca làm việc
create or replace function public.shift_save_s(p_token uuid, p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare u app_users; st app_users; cid text := p->>'cinema_id'; s_at timestamptz := (p->>'start_at')::timestamptz; e_at timestamptz := (p->>'end_at')::timestamptz; sid bigint := (p->>'id')::bigint;
begin
  u := _need(p_token, array['quanly']);
  if not _staff_scope(u, cid) then raise exception 'wrong_cinema'; end if;
  select * into st from app_users where username = p->>'username';
  if st.username is null or st.role = 'khach' then raise exception 'unknown_user'; end if;
  if st.cinema_id is not null and st.cinema_id <> cid then raise exception 'wrong_cinema'; end if;
  if s_at is null or e_at is null or e_at <= s_at or e_at - s_at > interval '14 hours' then raise exception 'bad_input'; end if;
  if exists (select 1 from shifts x where x.username = st.username and x.status <> 'cancelled' and x.id is distinct from sid and x.start_at < e_at and x.end_at > s_at) then raise exception 'shift_overlap'; end if;
  if sid is null then
    insert into shifts (cinema_id, username, day, start_at, end_at, kind, duty, note, created_by)
    values (cid, st.username, (s_at at time zone 'Asia/Ho_Chi_Minh')::date, s_at, e_at, coalesce(p->>'kind', 'sang'), coalesce(p->>'duty', 'quay'), p->>'note', u.username) returning id into sid;
  else
    update shifts set username = st.username, day = (s_at at time zone 'Asia/Ho_Chi_Minh')::date, start_at = s_at, end_at = e_at, kind = coalesce(p->>'kind', kind), duty = coalesce(p->>'duty', duty), note = p->>'note', status = 'planned' where id = sid and cinema_id = cid;
  end if;
  perform _admin_log(u.username, format('phân ca @%s %s %s–%s (%s)', st.username, to_char(s_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM'), to_char(s_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'), to_char(e_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'), coalesce(p->>'duty', 'quay')));
  return sid;
end $$;
create or replace function public.shift_delete_s(p_token uuid, p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; s shifts;
begin
  u := _need(p_token, array['quanly']);
  select * into s from shifts where id = p_id; if s.id is null then return; end if;
  if not _staff_scope(u, s.cinema_id) then raise exception 'wrong_cinema'; end if;
  delete from shifts where id = p_id;
  perform _admin_log(u.username, format('xoá ca #%s của @%s', p_id, s.username));
end $$;
-- Nhân viên xác nhận / từ chối ca của mình
create or replace function public.shift_confirm_s(p_token uuid, p_id bigint, p_ok boolean)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['nhanvien', 'kythuat', 'phucvu', 'quanly']);
  update shifts set status = case when p_ok then 'confirmed' else 'declined' end where id = p_id and username = u.username;
  if not found then raise exception 'forbidden'; end if;
end $$;
-- Lịch ca trong khoảng ngày (quản lý: cả rạp; nhân viên: ca của mình), kèm chấm công
create or replace function public.shifts_list_s(p_token uuid, p_from date, p_to date, p_cinema text default null)
returns table (id bigint, cinema_id text, username text, display_name text, role text, day date, start_at timestamptz, end_at timestamptz, kind text, duty text, status text, note text,
  check_in timestamptz, check_out timestamptz, late_min int, att_method text)
language plpgsql stable security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['nhanvien', 'kythuat', 'phucvu', 'quanly']);
  return query select s.id, s.cinema_id, s.username, a.display_name, a.role, s.day, s.start_at, s.end_at, s.kind, s.duty, s.status, s.note, t.check_in, t.check_out, coalesce(t.late_min, 0), t.method
    from shifts s join app_users a on a.username = s.username left join attendance t on t.shift_id = s.id
    where s.day between p_from and p_to and s.status <> 'cancelled'
      and (case when u.role = 'quanly' then (u.cinema_id is null or s.cinema_id = u.cinema_id) and (p_cinema is null or s.cinema_id = p_cinema) else s.username = u.username end)
    order by s.day, s.start_at, a.display_name;
end $$;
-- Chấm công: vào / ra ca của mình (FaceID: kèm bản ghi face_check); quản lý có thể chấm hộ
create or replace function public.attend_s(p_token uuid, p_shift bigint, p_action text, p_method text default 'manual', p_face_record bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; s shifts; late int := 0; a attendance;
begin
  u := _need(p_token, array['nhanvien', 'kythuat', 'phucvu', 'quanly']);
  select * into s from shifts where id = p_shift; if s.id is null then raise exception 'unknown_shift'; end if;
  if s.username <> u.username and not (u.role = 'quanly' and _staff_scope(u, s.cinema_id)) then raise exception 'forbidden'; end if;
  if p_action = 'in' then
    if now() < s.start_at - interval '2 hours' then raise exception 'too_early'; end if;
    late := greatest(0, floor(extract(epoch from (now() - s.start_at)) / 60))::int;
    insert into attendance (shift_id, username, check_in, method, late_min, face_record) values (s.id, s.username, now(), p_method, late, p_face_record)
    on conflict (shift_id, username) do update set check_in = coalesce(attendance.check_in, excluded.check_in), method = excluded.method, late_min = coalesce(attendance.late_min, excluded.late_min), face_record = coalesce(excluded.face_record, attendance.face_record);
    if s.status = 'planned' then update shifts set status = 'confirmed' where id = s.id; end if;
  elsif p_action = 'out' then
    update attendance set check_out = now() where shift_id = s.id and username = s.username and check_in is not null;
    if not found then raise exception 'not_checked_in'; end if;
  else raise exception 'bad_input'; end if;
  select * into a from attendance where shift_id = s.id;
  insert into audit_logs (type, msg, ok) values ('attend', format('@%s %s ca #%s %s (%s%s)', s.username, case when p_action = 'in' then 'vào' else 'ra' end, s.id, to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'), p_method, case when late > 0 then ', trễ ' || late || ' phút' else '' end), true);
  return jsonb_build_object('check_in', a.check_in, 'check_out', a.check_out, 'late_min', a.late_min);
end $$;
-- Nghỉ phép / tăng ca: nhân viên gửi, quản lý duyệt
create or replace function public.leave_request_s(p_token uuid, p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare u app_users; lid bigint; f date := (p->>'day_from')::date; t date := (p->>'day_to')::date;
begin
  u := _need(p_token, array['nhanvien', 'kythuat', 'phucvu', 'quanly']);
  if f is null or t is null or t < f then raise exception 'bad_input'; end if;
  insert into leaves (username, cinema_id, kind, day_from, day_to, hours, reason) values (u.username, u.cinema_id, coalesce(p->>'kind', 'nghi'), f, t, (p->>'hours')::numeric, p->>'reason') returning id into lid;
  return lid;
end $$;
create or replace function public.leave_decide_s(p_token uuid, p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; l leaves;
begin
  u := _need(p_token, array['quanly']);
  select * into l from leaves where id = p_id; if l.id is null then raise exception 'bad_input'; end if;
  if not _staff_scope(u, l.cinema_id) then raise exception 'wrong_cinema'; end if;
  if p_status not in ('approved', 'rejected', 'pending') then raise exception 'bad_input'; end if;
  update leaves set status = p_status, decided_by = u.username where id = p_id;
  perform _admin_log(u.username, format('%s đơn %s #%s của @%s', case p_status when 'approved' then 'duyệt' when 'rejected' then 'từ chối' else 'mở lại' end, case when l.kind = 'nghi' then 'nghỉ phép' else 'tăng ca' end, p_id, l.username));
end $$;
create or replace function public.leaves_list_s(p_token uuid, p_from date, p_to date)
returns table (id bigint, username text, display_name text, cinema_id text, kind text, day_from date, day_to date, hours numeric, reason text, status text, decided_by text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['nhanvien', 'kythuat', 'phucvu', 'quanly']);
  return query select l.id, l.username, a.display_name, l.cinema_id, l.kind, l.day_from, l.day_to, l.hours, l.reason, l.status, l.decided_by, l.created_at
    from leaves l join app_users a on a.username = l.username
    where l.day_to >= p_from and l.day_from <= p_to
      and (case when u.role = 'quanly' then (u.cinema_id is null or l.cinema_id = u.cinema_id or l.cinema_id is null) else l.username = u.username end)
    order by l.status = 'pending' desc, l.created_at desc;
end $$;
-- Thưởng / vi phạm
create or replace function public.staff_note_s(p_token uuid, p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare u app_users; st app_users; nid bigint;
begin
  u := _need(p_token, array['quanly']);
  select * into st from app_users where username = p->>'username';
  if st.username is null or st.role = 'khach' then raise exception 'unknown_user'; end if;
  if not _staff_scope(u, st.cinema_id) then raise exception 'wrong_cinema'; end if;
  if (p->>'kind') not in ('reward', 'violation') then raise exception 'bad_input'; end if;
  insert into staff_notes (username, kind, amount, note, created_by) values (st.username, p->>'kind', abs(coalesce((p->>'amount')::numeric, 0)), p->>'note', u.username) returning id into nid;
  perform _admin_log(u.username, format('%s @%s: %s (%s đ)', case when p->>'kind' = 'reward' then 'khen thưởng' else 'vi phạm' end, st.username, coalesce(p->>'note', ''), abs(coalesce((p->>'amount')::numeric, 0))));
  return nid;
end $$;
-- Hiệu suất + lương ước tính trong khoảng ngày: ca, giờ, trễ, vé quầy, doanh thu quầy, thưởng, phạt
create or replace function public.staff_stats_s(p_token uuid, p_from date, p_to date)
returns table (username text, display_name text, role text, cinema_id text, "position" text, shifts int, confirmed int, hours numeric, late_count int, late_min int, absent int,
  tickets int, revenue numeric, rewards numeric, violations numeric, notes jsonb, hourly_rate numeric, salary_base numeric, bonus_pct numeric, leaves_approved int)
language plpgsql stable security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['quanly']);
  return query select a.username, a.display_name, a.role, a.cinema_id, a.position,
      (select count(*)::int from shifts s where s.username = a.username and s.day between p_from and p_to and s.status <> 'cancelled'),
      (select count(*)::int from shifts s where s.username = a.username and s.day between p_from and p_to and s.status = 'confirmed'),
      (select coalesce(round(sum(extract(epoch from (coalesce(t.check_out, least(s.end_at, now())) - t.check_in)) / 3600)::numeric, 1), 0) from shifts s join attendance t on t.shift_id = s.id where s.username = a.username and s.day between p_from and p_to and t.check_in is not null),
      (select count(*)::int from shifts s join attendance t on t.shift_id = s.id where s.username = a.username and s.day between p_from and p_to and t.late_min > 5),
      (select coalesce(sum(t.late_min), 0)::int from shifts s join attendance t on t.shift_id = s.id where s.username = a.username and s.day between p_from and p_to),
      (select count(*)::int from shifts s left join attendance t on t.shift_id = s.id where s.username = a.username and s.day between p_from and p_to and s.status <> 'cancelled' and s.end_at < now() and t.check_in is null),
      (select count(*)::int from tickets t where t.sold_by = a.username and t.status <> 'refunded' and (t.created_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to),
      (select coalesce(sum(t.price), 0) from tickets t where t.sold_by = a.username and t.status <> 'refunded' and (t.created_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to),
      (select coalesce(sum(n.amount), 0) from staff_notes n where n.username = a.username and n.kind = 'reward' and (n.created_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to),
      (select coalesce(sum(n.amount), 0) from staff_notes n where n.username = a.username and n.kind = 'violation' and (n.created_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to),
      (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'amount', n.amount, 'note', n.note, 'at', n.created_at, 'by', n.created_by) order by n.created_at desc), '[]'::jsonb) from staff_notes n where n.username = a.username and (n.created_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to),
      a.hourly_rate, a.salary_base, a.bonus_pct,
      (select count(*)::int from leaves l where l.username = a.username and l.status = 'approved' and l.day_to >= p_from and l.day_from <= p_to)
    from app_users a where a.role <> 'khach' and a.active and (u.cinema_id is null or a.cinema_id = u.cinema_id)
    order by a.cinema_id nulls first, a.display_name;
end $$;

-- tạo tài khoản (008/014) nhận thêm vai trò phục vụ
create or replace function public.create_user(p_token uuid, p_user text, p_pass text, p_name text, p_role text, p_cinema text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare u app_users;
begin
  u := _need(p_token, array['quanly']);
  if p_role not in ('khach', 'nhanvien', 'kythuat', 'phucvu', 'quanly') then raise exception 'bad_role'; end if;
  if lower(trim(p_user)) !~ '^[a-z0-9_.]{3,32}$' then raise exception 'bad_username'; end if;
  if length(coalesce(p_pass, '')) < 6 then raise exception 'weak_password'; end if;
  if u.cinema_id is not null and (p_cinema is null or p_cinema <> u.cinema_id or p_role = 'khach') then raise exception 'wrong_cinema'; end if;
  if p_cinema is not null and not exists (select 1 from cinemas where id = p_cinema) then raise exception 'unknown_cinema'; end if;
  insert into app_users (username, pass_hash, role, display_name, cinema_id)
  values (lower(trim(p_user)), extensions.crypt(p_pass, extensions.gen_salt('bf', 8)), p_role, left(trim(p_name), 60), case when p_role = 'khach' then null else p_cinema end);
  perform _admin_log(u.username, format('tạo tài khoản @%s (%s%s)', lower(trim(p_user)), p_role, case when p_cinema is not null and p_role <> 'khach' then ', rạp ' || p_cinema else '' end));
exception when unique_violation then raise exception 'username_taken';
end $$;
-- nhân viên demo: phục vụ
insert into public.app_users (username, pass_hash, role, display_name, cinema_id, position)
values ('phucvu', extensions.crypt('phucvu123', extensions.gen_salt('bf', 8)), 'phucvu', 'Đỗ Thị Hạnh', '086', 'Phục vụ sảnh')
on conflict (username) do nothing;
update public.app_users set position = coalesce(position, case role when 'nhanvien' then 'Bán vé & soát vé' when 'kythuat' then 'Kỹ thuật phòng chiếu' when 'quanly' then case when cinema_id is null then 'Quản lý hệ thống' else 'Quản lý cơ sở' end end),
  hourly_rate = case when hourly_rate = 0 then case role when 'quanly' then 60000 when 'kythuat' then 40000 else 30000 end else hourly_rate end,
  hired_at = coalesce(hired_at, '2025-01-06'), contract_type = coalesce(contract_type, 'chính thức')
where role <> 'khach';

revoke execute on function public._staff_scope(public.app_users, text) from public, anon, authenticated;
grant execute on function public.staff_list_s(uuid, text), public.staff_save_s(uuid, jsonb), public.account_list_s(uuid, text, text), public.account_set_s(uuid, text, boolean, text),
  public.shift_save_s(uuid, jsonb), public.shift_delete_s(uuid, bigint), public.shift_confirm_s(uuid, bigint, boolean), public.shifts_list_s(uuid, date, date, text),
  public.attend_s(uuid, bigint, text, text, bigint), public.leave_request_s(uuid, jsonb), public.leave_decide_s(uuid, bigint, text), public.leaves_list_s(uuid, date, date),
  public.staff_note_s(uuid, jsonb), public.staff_stats_s(uuid, date, date), public.create_user(uuid, text, text, text, text, text), public.login(text, text), public.sell_order_u(uuid, text, text, jsonb, text, int) to anon, authenticated;

-- ============================================================================
-- 017_account.sql
-- ============================================================================
-- CineVin – migration 017: sửa từng tài khoản ở "Tài khoản & quyền". Chạy SAU 016. Chạy lại nhiều lần không sao.
--   Đổi họ tên, vai trò (phân quyền: khách ↔ nhân viên / kỹ thuật / phục vụ / quản lý), cơ sở, khoá / mở, đặt lại mật khẩu.
--   Quản lý chuỗi: mọi tài khoản (trừ tự hạ quyền / tự khoá). Quản lý cơ sở: chỉ nhân sự rạp mình, không nâng lên quản lý chuỗi.
create or replace function public.account_update_s(p_token uuid, p jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare u app_users; ex app_users; un text := lower(trim(p->>'username')); r text := p->>'role'; cid text := nullif(p->>'cinema_id', ''); act boolean := coalesce((p->>'active')::boolean, true);
begin
  u := _need(p_token, array['quanly']);
  select * into ex from app_users where username = un;
  if ex.username is null then raise exception 'unknown_user'; end if;
  r := coalesce(r, ex.role);
  if r not in ('khach', 'nhanvien', 'kythuat', 'phucvu', 'quanly') then raise exception 'bad_role'; end if;
  if r = 'khach' then cid := null; end if;
  if u.cinema_id is not null then
    if ex.role = 'khach' and r = 'khach' then raise exception 'wrong_cinema'; end if;             -- quản lý rạp không quản lý khách
    if (ex.cinema_id is not null and ex.cinema_id <> u.cinema_id) or (r <> 'khach' and cid <> u.cinema_id) then raise exception 'wrong_cinema'; end if;
    if r = 'quanly' and cid is null then raise exception 'forbidden'; end if;                      -- không tạo quản lý chuỗi
  end if;
  if ex.username = u.username and (r <> u.role or not act or cid is distinct from u.cinema_id) then raise exception 'bad_input'; end if;   -- không tự đổi quyền / tự khoá
  if cid is not null and not exists (select 1 from cinemas where id = cid) then raise exception 'unknown_cinema'; end if;
  if length(coalesce(p->>'pass', '')) > 0 then
    if length(p->>'pass') < 6 then raise exception 'weak_password'; end if;
    update app_users set pass_hash = extensions.crypt(p->>'pass', extensions.gen_salt('bf', 8)) where username = un;
    delete from sessions where username = un and token <> p_token;
    perform _admin_log(u.username, 'đặt lại mật khẩu @' || un);
  end if;
  update app_users set display_name = coalesce(nullif(left(trim(p->>'name'), 60), ''), display_name), role = r, cinema_id = cid, active = act where username = un;
  if not act then delete from sessions where username = un; end if;
  perform _admin_log(u.username, format('tài khoản @%s: %s%s%s', un, r, case when cid is not null then ', rạp ' || cid else '' end, case when act then '' else ', KHOÁ' end));
end $$;
grant execute on function public.account_update_s(uuid, jsonb) to anon, authenticated;

-- ============================================================================
-- 018_shift_request.sql
-- ============================================================================
-- CineVin – migration 018: nhân viên tự đăng ký ca. Chạy SAU 017. Chạy lại nhiều lần không sao.
--   Nhân viên chọn ngày + ca (sáng / chiều / tối / tuỳ chỉnh) + vị trí → ca ở trạng thái "requested";
--   quản lý duyệt (confirmed) hoặc từ chối (declined) trên bảng ca / tab chấm công.
alter table public.shifts drop constraint if exists shifts_status_check;
alter table public.shifts add constraint shifts_status_check check (status in ('requested', 'planned', 'confirmed', 'declined', 'cancelled'));

create or replace function public.shift_request_s(p_token uuid, p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare u app_users; s_at timestamptz := (p->>'start_at')::timestamptz; e_at timestamptz := (p->>'end_at')::timestamptz; sid bigint; cid text;
begin
  u := _need(p_token, array['nhanvien', 'kythuat', 'phucvu', 'quanly']);
  cid := coalesce(u.cinema_id, p->>'cinema_id');
  if cid is null or not exists (select 1 from cinemas where id = cid) then raise exception 'unknown_cinema'; end if;
  if s_at is null or e_at is null or e_at <= s_at or e_at - s_at > interval '14 hours' then raise exception 'bad_input'; end if;
  if s_at < now() - interval '1 hour' then raise exception 'bad_input'; end if;
  if exists (select 1 from shifts x where x.username = u.username and x.status not in ('cancelled', 'declined') and x.start_at < e_at and x.end_at > s_at) then raise exception 'shift_overlap'; end if;
  insert into shifts (cinema_id, username, day, start_at, end_at, kind, duty, status, note, created_by)
  values (cid, u.username, (s_at at time zone 'Asia/Ho_Chi_Minh')::date, s_at, e_at, coalesce(p->>'kind', 'sang'), coalesce(p->>'duty', 'quay'), 'requested', p->>'note', u.username) returning id into sid;
  insert into audit_logs (type, msg, ok) values ('attend', format('@%s đăng ký ca %s %s–%s (%s)', u.username, to_char(s_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM'), to_char(s_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'), to_char(e_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'), coalesce(p->>'duty', 'quay')), true);
  return sid;
end $$;

create or replace function public.shift_approve_s(p_token uuid, p_id bigint, p_ok boolean)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; s shifts;
begin
  u := _need(p_token, array['quanly']);
  select * into s from shifts where id = p_id; if s.id is null then raise exception 'unknown_shift'; end if;
  if not _staff_scope(u, s.cinema_id) then raise exception 'wrong_cinema'; end if;
  update shifts set status = case when p_ok then 'confirmed' else 'declined' end where id = p_id;
  perform _admin_log(u.username, format('%s ca #%s @%s %s', case when p_ok then 'duyệt' else 'từ chối' end, p_id, s.username, to_char(s.start_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI')));
end $$;
grant execute on function public.shift_request_s(uuid, jsonb), public.shift_approve_s(uuid, bigint, boolean) to anon, authenticated;

-- ============================================================================
-- 019_keys.sql
-- ============================================================================
-- CineVin – migration 019: chuẩn hoá khoá. Chạy SAU 018. Chạy lại nhiều lần không sao.
--   Trước: nhiều bảng dùng khoá tự nhiên dạng text làm primary key (tên đăng nhập, mã vé, mã voucher, mã đoàn, thẻ học sinh, hồ sơ dân cư,
--   khoá ghế ghép (suất, ghế)). Nay: mọi bảng dữ liệu có PRIMARY KEY số tự tăng (id bigint identity); mã nghiệp vụ giữ làm UNIQUE
--   để các hàm / QR / URL vẫn dùng được; bổ sung FOREIGN KEY còn thiếu và chỉ mục.
--   Giữ khoá text có chủ đích (mã nghiệp vụ ngắn, in trên vé / URL, không đổi): cinemas.id (mã rạp 3 số), rooms.id (<rạp>-R1),
--   films.id, shows.id (YYYYMMDD-<rạp>-n), seat_types.id, price_tiers.id ('A'/'B'), sessions.token (uuid), app_secrets.k.

-- Đổi PK text → id identity, giữ cột cũ là UNIQUE; FK đang trỏ tới cột cũ được tháo ra rồi gắn lại vào UNIQUE
create or replace function public._repoint_pk(p_table text, p_col text, p_fks jsonb)
returns void language plpgsql as $$
declare pk text; f jsonb;
begin
  execute format('alter table public.%I add column if not exists id bigint generated always as identity', p_table);
  select c.conname into pk from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = ('public.' || p_table)::regclass and c.contype = 'p' and a.attname = p_col;
  if pk is null then return; end if;   -- đã chuẩn hoá
  for f in select * from jsonb_array_elements(p_fks) loop
    execute format('alter table public.%I drop constraint if exists %I', f->>'table', f->>'name');
  end loop;
  execute format('alter table public.%I drop constraint %I', p_table, pk);
  execute format('alter table public.%I add primary key (id)', p_table);
  execute format('alter table public.%I add constraint %I unique (%I)', p_table, p_table || '_' || p_col || '_key', p_col);
  for f in select * from jsonb_array_elements(p_fks) loop
    execute format('alter table public.%I add constraint %I foreign key (%I) references public.%I(%I) on delete %s', f->>'table', f->>'name', f->>'col', p_table, p_col, coalesce(f->>'on', 'cascade'));
  end loop;
end $$;
-- Khoá ghép → id identity + UNIQUE (vẫn báo unique_violation khi giữ ghế trùng)
create or replace function public._composite_to_id(p_table text, p_cols text)
returns void language plpgsql as $$
declare pk text;
begin
  execute format('alter table public.%I add column if not exists id bigint generated always as identity', p_table);
  select conname into pk from pg_constraint where conrelid = ('public.' || p_table)::regclass and contype = 'p';
  if pk is null or pk = p_table || '_pkey' and exists (select 1 from pg_attribute a join pg_constraint c on a.attrelid = c.conrelid and a.attnum = any(c.conkey) where c.conname = pk and a.attname = 'id') then return; end if;
  execute format('alter table public.%I drop constraint %I', p_table, pk);
  execute format('alter table public.%I add primary key (id)', p_table);
  execute format('alter table public.%I add constraint %I unique (%s)', p_table, p_table || '_natural_key', p_cols);
end $$;

select public._repoint_pk('app_users', 'username', '[{"table":"sessions","name":"sessions_username_fkey","col":"username","on":"cascade"}]'::jsonb);
select public._repoint_pk('tickets', 'code', '[]'::jsonb);
select public._repoint_pk('vouchers', 'code', '[{"table":"voucher_uses","name":"voucher_uses_code_fkey","col":"code","on":"cascade"}]'::jsonb);
select public._repoint_pk('groups', 'code', '[{"table":"group_members","name":"group_members_group_code_fkey","col":"group_code","on":"cascade"}]'::jsonb);
select public._repoint_pk('group_members', 'card', '[]'::jsonb);
select public._repoint_pk('mock_citizens', 'key', '[]'::jsonb);
select public._composite_to_id('seat_locks', 'show_id, seat');
select public._composite_to_id('voucher_uses', 'code, username');
select public._composite_to_id('cinema_films', 'cinema_id, film_id');
drop function public._repoint_pk(text, text, jsonb);
drop function public._composite_to_id(text, text);

-- Khoá ngoại còn thiếu (NOT VALID: không kiểm dữ liệu cũ, áp cho dữ liệu mới)
do $$
declare r record;
begin
  for r in select * from (values
    ('app_users', 'app_users_cinema_fkey', 'cinema_id', 'cinemas', 'id', 'set null'),
    ('app_users', 'app_users_citizen_fkey', 'citizen_key', 'mock_citizens', 'key', 'set null'),
    ('shows', 'shows_cinema_fkey', 'cinema_id', 'cinemas', 'id', 'cascade'),
    ('tickets', 'tickets_owner_fkey', 'owner_user', 'app_users', 'username', 'set null'),
    ('tickets', 'tickets_viewer_fkey', 'viewer_user', 'app_users', 'username', 'set null'),
    ('tickets', 'tickets_sold_by_fkey', 'sold_by', 'app_users', 'username', 'set null'),
    ('vouchers', 'vouchers_owner_fkey', 'owner_user', 'app_users', 'username', 'cascade'),
    ('voucher_uses', 'voucher_uses_user_fkey', 'username', 'app_users', 'username', 'cascade'),
    ('shifts', 'shifts_user_fkey', 'username', 'app_users', 'username', 'cascade'),
    ('attendance', 'attendance_user_fkey', 'username', 'app_users', 'username', 'cascade'),
    ('leaves', 'leaves_user_fkey', 'username', 'app_users', 'username', 'cascade'),
    ('leaves', 'leaves_cinema_fkey', 'cinema_id', 'cinemas', 'id', 'set null'),
    ('staff_notes', 'staff_notes_user_fkey', 'username', 'app_users', 'username', 'cascade')
  ) as t(tbl, name, col, ref, refcol, act) loop
    if not exists (select 1 from pg_constraint where conname = r.name) then
      execute format('alter table public.%I add constraint %I foreign key (%I) references public.%I(%I) on delete %s not valid', r.tbl, r.name, r.col, r.ref, r.refcol, r.act);
    end if;
  end loop;
end $$;

-- Realtime: khi PK không còn là mã nghiệp vụ, sự kiện DELETE chỉ mang PK → gửi đủ hàng cũ để client xoá đúng ghế / vé / đoàn
alter table public.seat_locks replica identity full;
alter table public.tickets replica identity full;
alter table public.groups replica identity full;
alter table public.group_members replica identity full;

-- Chỉ mục cho truy vấn thường dùng
create index if not exists tickets_show on public.tickets (show_id, status);
create index if not exists tickets_owner on public.tickets (owner_user, created_at);
create index if not exists seat_locks_show on public.seat_locks (show_id);
create index if not exists shows_start on public.shows (start_at);
create index if not exists audit_logs_time on public.audit_logs (t desc);
create index if not exists audit_logs_type on public.audit_logs (type, t desc);
create index if not exists verifications_citizen on public.verifications (citizen_key, created_at desc);
create index if not exists sessions_user on public.sessions (username);
create index if not exists app_users_email on public.app_users (lower(email));
create index if not exists app_users_phone on public.app_users (phone);
create index if not exists app_users_role on public.app_users (role, cinema_id);

-- ============================================================================
-- 020_films_cgv.sql
-- ============================================================================
-- CineVin – migration 020: kho phim demo lấy từ cgv.vn ngày 25/10/2026 (27 phim đang chiếu + 33 phim sắp chiếu). Chạy SAU 019. Chạy lại nhiều lần không sao.
--   Thêm cột mô tả cho bảng films (ngày khởi chiếu, trạng thái, tóm tắt, đạo diễn, diễn viên, ảnh ngang…) và nạp 60 phim; phân phối cho mọi cơ sở.
--   Ảnh poster / ảnh ngang trỏ tới CDN của CGV – chỉ dùng cho demo học tập. Sinh bởi report_work (gen.py) từ js/films-cgv.js.
alter table public.films add column if not exists release_at date;
alter table public.films add column if not exists status text not null default 'now' check (status in ('now', 'soon'));
alter table public.films add column if not exists synopsis text;
alter table public.films add column if not exists director text;
alter table public.films add column if not exists cast_names text;
alter table public.films add column if not exists lang text;
alter table public.films add column if not exists backdrop text;
alter table public.films add column if not exists unrated boolean not null default false;   -- CGV chưa công bố nhãn → tạm P
alter table public.films add column if not exists hot boolean not null default false;
alter table public.films add column if not exists source text;                              -- 'cgv' = dữ liệu demo nạp từ cgv.vn

insert into public.films (id, title, rating, dur, genre, img, backdrop, release_at, status, synopsis, director, cast_names, lang, unrated, hot, source) values
  ('f1', 'Shaun The Sheep: “Quái Lạ” Ghé Nhà', 'P', 81, 'Gia đình, Hài, Hoạt Hình, Phiêu Lưu', 'https://static-cgv.vncdn.vn/media/catalog/product/4/7/470wx700h-shaun.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/1/0/1080wx650h-shaun.jpg', '2026-10-16', 'now', 'Ông chủ mất tích và một sinh vật bí ẩn xuất hiện trong rừng, cả đàn cừu lên đường tìm kiếm', null, null, null, false, true, 'cgv'),
  ('f2', 'Ngự Miêu Phá Án', 'K', 98, 'Hoạt Hình, Phiêu Lưu', 'https://static-cgv.vncdn.vn/media/catalog/product/4/7/470wx700h-royal.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/1/2/1280wx720h-royalcat.jpg', '2026-10-30', 'now', 'Tại thành cổ Kim Lăng, Triển Ngao - cận vệ thân tín của Khấu Tướng Quân - cùng chàng thiếu niên Bao Chửng, Cẩm Mao Thử và Khấu Châu, con gái của Khấu Tướng Quân, hợp sức điều tra chân tướng, phá giải những vụ án bí ẩn và từng bước khám phá một âm mưu.', null, null, null, false, true, 'cgv'),
  ('f3', 'Gia Đình x Điệp Viên Mã: Trắng (Chiếu Lại)', 'T13', 111, 'Hài, Hành Động, Hoạt Hình', 'https://static-cgv.vncdn.vn/media/catalog/product/m/a/main_poster_original_size_.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/m/a/main_poster_original_size_.jpg', '2026-10-23', 'now', 'Bộ phim là phần phim điện ảnh của series anime nổi tiếng Spy x Family.', null, null, null, false, true, 'cgv'),
  ('f4', 'Án Mạng Karaoke', 'T16', 96, 'Hài, Hồi hộp', 'https://static-cgv.vncdn.vn/media/catalog/product/_/n/_n_m_ng_karaoke_-_kc_30.10.2026_-_kt_chu_n_1_.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/_/n/_n_m_ng_karaoke_-_kc_30.10.2026_-_kt_chu_n_1_.jpg', '2026-10-26', 'now', 'Một người hàng xóm mê hát karaoke bất ngờ bị sát hại trong căn homestay thiền biệt lập trên núi, khiến chuyến hành hương của một xóm nhỏ bị biến thành trò chơi đầu trí bất đắc dĩ.', null, null, null, false, true, 'cgv'),
  ('f5', 'Trại Buôn Người', 'T18', 135, 'Hành Động, Hồi hộp', 'https://static-cgv.vncdn.vn/media/catalog/product/3/5/350x495-tbn.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/t/r/trailer_thumbnail.jpg', '2026-09-25', 'now', 'Vì cứu em gái sa bẫy buôn người ở biên giới miền Tây, Ny (Steven Nguyễn) cùng bạn thân bị bắt làm nô dịch trong sào huyệt lừa đảo tàn bạo.', null, null, null, false, true, 'cgv'),
  ('f6', 'Quỷ Ăn Tạng 4: Hổ Tinh', 'T18', 111, 'Hài, Hành Động, Kinh Dị', 'https://static-cgv.vncdn.vn/media/catalog/product/p/o/poster-cgv_up.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/t/y/ty4-teaser-poster.jpg', '2026-10-16', 'now', 'Cuộc gặp gỡ đầu tiên giữa Yak và Trung sĩ Paphan khi cả hai dấn thân vào một nhiệm vụ sinh tử: truy tìm một người đàn ông mất tích. Dẫn đầu toán quân tiến sâu vào vùng hiểm địa âm u, họ phải đối mặt với Hổ tinh ăn thịt người vùng Khao Khwang.', null, null, null, false, false, 'cgv'),
  ('f7', 'Verity: Bí Mật Bị Chôn Vùi', 'T18', 117, 'Hồi hộp, Tâm Lý', 'https://static-cgv.vncdn.vn/media/catalog/product/1/0/1080x1350_2_.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/t/h/thumb_4.jpg', '2026-10-16', 'now', 'Được chuyển thể từ cuốn tiểu thuyết bán chạy nhất của Colleen Hoover, Bí Mật Bị Chôn Vùi( Verity) phim giật gân tâm lý đầy lôi cuốn này xoay quanh nữ nhà văn nổi tiếng Verity Crawford và Lowen Ashleigh, một nhà văn đang chật vật.', null, null, null, false, false, 'cgv'),
  ('f8', 'Cõi Nguyền', 'T18', 89, 'Kinh Dị', 'https://static-cgv.vncdn.vn/media/catalog/product/3/5/350x495-curse.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/6/4/640x396-curse.jpg', '2026-10-23', 'now', 'Dựa trên loạt truyền thuyết đô thị gây chấn động Nhật Bản, Cõi Nguyền bắt nguồn từ lời nguyền của một người phụ nữ kỳ bí đã ám cô gái trẻ tên Riko chỉ với một dòng tin nhắn: “Tất cả mọi người đều đáng chết”.', null, null, null, false, false, 'cgv'),
  ('f9', 'Bambi: Lãnh Địa Săn Mồi', 'T16', 80, 'Hồi hộp, Kinh Dị', 'https://static-cgv.vncdn.vn/media/catalog/product/b/t/btr_alternate_470x700.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/b/t/btr_alternate_1800x1200.jpg', '2026-10-23', 'now', 'Bambi, một chú nai bị đột biến sau khi nai mẹ bị thợ săn sát hại và môi trường sống bị ô nhiễm nghiêm trọng. Trở thành một sinh vật khổng lồ và hung dữ, Bambi bắt đầu hành trình trả thù con người.', null, null, null, false, false, 'cgv'),
  ('f10', 'Oán Linh Đòi Mạng', 'T18', 98, 'Bí ẩn, Kinh Dị, Tâm Lý', 'https://static-cgv.vncdn.vn/media/catalog/product/m/a/main_poster_1.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/m/a/main_poster_1.jpg', '2026-10-23', 'now', 'Với mong muốn mang lại một cuộc sống tốt đẹp hơn cho vợ (Titi Kamal) và các con, Tomy quyết định gánh một khoản vay thế chấp lớn để mua căn nhà trong mơ tại khu phức hợp dân cư cao cấp mang tên Perumahan Laddaland.', null, null, null, false, false, 'cgv'),
  ('f11', 'Ngọn Đồi Hoa Hồng Anh', 'K', 91, 'Hoạt Hình', 'https://static-cgv.vncdn.vn/media/catalog/product/o/u/outlined_poster_from-up-on-poppy-hill.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/o/u/outlined_poster_from-up-on-poppy-hill.jpg', '2026-10-16', 'now', 'Umi Matsuzaki là chị cả trong gia đình có ba anh em. Mỗi sáng cô đều kéo cờ tưởng niệm người cha đã mất trong chiến tranh.Umi tham gia cùng Shun Kazama trong nỗ lực bảo tồn nơi này và cả hai dần trở nên thân thiết.', null, null, null, false, false, 'cgv'),
  ('f12', 'Phim Street Fighter', 'T16', 119, 'Hành Động', 'https://static-cgv.vncdn.vn/media/catalog/product/s/t/stf_teasergoodguys_470x700.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/s/t/stf_teasergoodguys_470x700.jpg', '2026-10-16', 'now', 'Lấy bối cảnh năm 1993, Ryu và Ken, hai đấu sĩ từng xa cách bị kéo trở lại chiến đấu khi Chun-Li chiêu mộ họ tham gia giải Chiến Binh Thế Giới đầy khốc liệt. Nhưng đằng sau đó là một âm mưu chết chóc, buộc họ phải đối đầu với nhau và quá khứ của chính mình', null, null, null, false, false, 'cgv'),
  ('f13', 'Án Mạng Xém Hoàn Hảo', 'T18', 124, 'Hài', 'https://static-cgv.vncdn.vn/media/catalog/product/3/5/350x495-amxhh_.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/6/4/640x396-amxhh.jpg', '2026-10-09', 'now', 'Trinh, cô nàng TikToker ngôn tình triệu view, tỉnh dậy giữa phim trường lạnh lẽo với cái đầu đau như búa bổ, mất trí nhớ và phát hiện xác của Yến (diễn viên) – tình địch đang bị nghi ngờ có gì mờ ám với diễn viên Khang (chồng sắp cưới).', null, null, null, false, false, 'cgv'),
  ('f14', 'Người Mẹ Khác', 'T18', 93, 'Kinh Dị', 'https://static-cgv.vncdn.vn/media/catalog/product/o/t/otm_redstanding_470x700.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/o/t/otm_redstanding_470x700.jpg', '2026-10-09', 'now', 'Tại ngôi nhà của mình, Bela dần hình thành một mối liên kết kỳ lạ với một thực thể bí ẩn mang vẻ ngoài giống hệt mẹ cô bé đến đáng sợ.', null, null, null, false, false, 'cgv'),
  ('f15', 'Cá Voi Nuốt Chửng', 'T13', 106, 'Hồi hộp, Kinh Dị', 'https://static-cgv.vncdn.vn/media/catalog/product/p/o/poster_ca_voi_nuot_chung_1.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/p/o/poster_ca_voi_nuot_chung_1.jpg', '2026-10-16', 'now', 'Sau cái chết của cha mình (Josh Brolin), Jay Gardiner (Austin Abrams) lặn xuống vùng biển ngoài khơi bờ biển miền Trung California để tìm kiếm hài cốt của ông, nhưng bất ngờ bị một con cá nhà táng khổng lồ nuốt chửng.', null, null, null, false, false, 'cgv'),
  ('f16', 'Chuyện Công Chúa Kaguya', 'K', 138, 'Hoạt Hình', 'https://static-cgv.vncdn.vn/media/catalog/product/o/u/outlined_poster_the-tale-of-the-princess-kaguya.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/o/u/outlined_poster_the-tale-of-the-princess-kaguya.jpg', '2026-10-09', 'now', 'Một đôi vợ chồng già chăm chỉ sống ở vùng quê ven thành phố. Một ngày nọ, trong rừng tre, ông lão thấy một cây tre phát sáng kỳ lạ và phát hiện bên trong là một bé gái nhỏ. Ông đưa cô bé về nuôi nấng như con ruột.', null, null, null, false, false, 'cgv'),
  ('f17', 'Avengers: Hồi Kết - Phiên Bản Đặc Biệt (Chiếu Lại)', 'T13', 183, 'Hành Động, Khoa Học Viễn Tưởng, Phiêu Lưu', 'https://static-cgv.vncdn.vn/media/catalog/product/e/n/encore_alt_1sht_-_rgb_online_only.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/e/n/encore_alt_1sht_-_rgb_online_only.jpg', '2026-09-25', 'now', 'Phần kết hoành tráng của Infinity Saga sẽ trở lại rạp chiếu với Avengers: Hồi Kết - Phiên Bản Đặc Biệt vào ngày 25/09/2026.', null, null, null, false, false, 'cgv'),
  ('f18', 'Blue Lock: Cuộc Chiến Của Những Tiền Đạo', 'K', 127, 'Hành Động, Tâm Lý', 'https://static-cgv.vncdn.vn/media/catalog/product/4/7/470x700-bluelock-la.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/4/7/470x700-bluelock-la.jpg', '2026-10-09', 'now', 'Theo chân 300 cầu thủ bóng đá trung học tham gia những vòng tuyển chọn khắc nghiệt tại một cơ sở huấn luyện bí mật, nơi chỉ một người duy nhất có thể vươn lên trở thành tiền đạo xuất sắc nhất thế giới.', null, null, null, false, false, 'cgv'),
  ('f19', 'Trái Tim Quái Thú', 'T13', 101, 'Hành Động', 'https://static-cgv.vncdn.vn/media/catalog/product/4/7/470x700-heartofthebeast.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/6/4/640x310-heartofthebeast.jpg', '2026-10-02', 'now', 'Sau một vụ tai nạn máy bay kinh hoàng, sĩ quan Lực lượng Đặc nhiệm James Belmont (Brad Pitt) và chú chó chiến đấu Odin bị mắc kẹt giữa vùng hoang dã sâu thẳm của Alaska. Từ đó, họ buộc phải cùng nhau bước vào cuộc chiến sinh tồn khốc liệt.', null, null, null, false, false, 'cgv'),
  ('f20', 'Scotty: Giải Cứu Hoàng Thượng', 'P', 80, 'Gia đình, Hoạt Hình, Phiêu Lưu', 'https://static-cgv.vncdn.vn/media/catalog/product/4/7/470wx700h-scotty.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/1/7/1760wx1040h-scotty.jpg', '2026-10-02', 'now', 'Scotty - một chú mèo hoang vốn quen sống trong lãnh địa của mình bất ngờ bị kéo vào cuộc phiêu lưu bất đắc dĩ cùng Katie, một cô mèo nhà.', null, null, null, false, false, 'cgv'),
  ('f21', 'The Odyssey', 'T16', 173, 'Hành Động, Thần thoại', 'https://static-cgv.vncdn.vn/media/catalog/product/o/d/ody_horseposter_470x700.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/o/d/ody_horseposter_1800x1200.jpg', '2026-07-17', 'now', 'Lấy cảm hứng từ thần thoại Hy Lạp, trong đó Matt Damon vào vai Odysseus, người anh hùng mất 10 năm trở về quê nhà sau cuộc chiến thành Troy.', null, null, null, false, false, 'cgv'),
  ('f22', '[Rerun] Phim Shin – Cậu Bé Bút Chì: Kỳ Kỳ Quái Quái! Kỳ Nghỉ Yêu Quái Của Tớ', 'P', 101, 'Hoạt Hình, Thần thoại', 'https://static-cgv.vncdn.vn/media/catalog/product/4/7/470wx700h-shin.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/1/0/1080wx608h-shin.jpg', '2026-10-09', 'now', 'Lấy bối cảnh mùa hè tại Akita, bộ phim theo chân Shin và gia đình Nohara trong chuyến về quê đầy háo hức. Tuy nhiên, một sự kiện kỳ lạ đã đưa cả gia đình lạc vào Xứ sở Yêu quái bí ẩn – nơi con người không được phép đặt chân tới.', null, null, null, false, false, 'cgv'),
  ('f23', 'Khóa Chặt Cửa Nào Suzume', 'P', 122, 'Hoạt Hình, Phiêu Lưu', 'https://static-cgv.vncdn.vn/media/catalog/product/p/o/poster_khoa_chat_cua_nao_suzum_1.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/p/o/poster_khoa_chat_cua_nao_suzum_1.jpg', '2026-10-02', 'now', 'Suzume vô tình gặp một chàng trai trẻ đến thị trấn nơi cô sinh sống với mục đích tìm kiếm "một cánh cửa". Để bảo vệ Nhật Bản khỏi thảm họa, những cánh cửa rải rác khắp nơi phải được đóng lại, Suzume cũng có khả năng đóng cửa đặc biệt này.', null, null, null, false, false, 'cgv'),
  ('f24', 'Bát Tiên ! Truy Tìm Lưu Ly Đăng', 'K', 144, 'Hoạt Hình, Thần thoại', 'https://static-cgv.vncdn.vn/media/catalog/product/3/5/350x495-battien.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/3/5/350x495-battien.jpg', '2026-09-11', 'now', 'Tám phàm nhân với tám giấc mộng đổi đời đã thực hiện một phi vụ liều lĩnh: đột nhập chốn Bồng Lai để đánh cắp bảo vật.', null, null, null, false, false, 'cgv'),
  ('f25', 'Vùng Đất Quỷ Dữ', 'T18', 94, 'Hành Động, Kinh Dị', 'https://static-cgv.vncdn.vn/media/catalog/product/4/7/470x700-residentevil_1.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/1/9/1920x1080-resident_1.jpg', '2026-09-18', 'now', 'Một phiên bản Resident Evil mới trở lại đầy kịch tính và kinh hoàng từ bộ óc quái kiệt của đạo diễn Zach Cregger đứng sau “Weapons” & “Barbarian”.', null, null, null, false, false, 'cgv'),
  ('f26', 'Pháo Hoa Lúc Bình Minh', 'P', 76, 'Hoạt Hình', 'https://static-cgv.vncdn.vn/media/catalog/product/4/7/470x700-dawn.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/4/7/470x700-dawn.jpg', '2026-09-25', 'now', 'Xưởng pháo hoa truyền thống Obinata, di sản hơn 300 năm của gia đình Keitaro, nay đứng trước bờ vực bị xóa sổ bởi làn sóng quy hoạch đô thị.', null, null, null, false, false, 'cgv'),
  ('f27', 'Chiikawa: Bí Mật Đảo Người Cá', 'P', 99, 'Hoạt Hình', 'https://static-cgv.vncdn.vn/media/catalog/product/3/5/350x495-chiikawa.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/6/4/640x396-chiikawa.jpg', '2026-08-28', 'now', 'Bộ ba Chiikawa, Hachiware và Usagi nhận được một lời mời tham gia chuyến đi đến hòn đảo đặc biệt với những phần thưởng và đồ ăn miễn phí.', null, null, null, false, false, 'cgv'),
  ('f28', 'Clayface', 'T18', 108, 'Hồi hộp, Kinh Dị', 'https://static-cgv.vncdn.vn/media/catalog/product/v/n/vn_clayface_alt-9.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/v/n/vn_clayface_alt-9.jpg', '2026-10-30', 'soon', '“Clayface” hé lộ sự sa ngã kinh hoàng của một người đàn ông từ ngôi sao Hollywood đang lên trở thành một con quái vật đầy thù hận, trong một câu chuyện khám phá sự mất mát bản sắc và nhân tính, tình yêu độc hại, và mặt tối của tham vọng khoa học.', null, null, null, false, false, 'cgv'),
  ('f29', 'Chị Chị Em Em 3', 'T18', 122, 'Tâm Lý, Tình cảm', 'https://static-cgv.vncdn.vn/media/catalog/product/3/5/350x495_5_.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/6/4/640x396_1_3.jpg', '2026-10-30', 'soon', 'Văn Tài - công tử con quan lớn quyền thế - chuẩn bị cưới Thị Mầu, tiểu thư nổi tiếng tài sắc nhất vùng. Tưởng đây là cuộc hôn nhân môn đăng hộ đối được cả làng mong chờ, nhưng trớ trêu thay Văn Tài lại say đắm Thị Liễu - người chị họ đến từ phương Nam.', null, null, null, false, false, 'cgv'),
  ('f30', 'Phim Điện Ảnh Về Bộ Đôi Anh Hùng 2026: Kamen Rider Zeztz & Siêu Cảnh Sát Vũ Trụ Gavan Infinity', 'P', 96, 'Hành Động, Khoa Học Viễn Tưởng, Phiêu Lưu', 'https://static-cgv.vncdn.vn/media/catalog/product/k/a/kamen_rider_zeztz_gavan_localized_main_adaptation_web_470_x_700-.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/t/h/thumbnail_doublemovie.jpg', '2026-10-30', 'soon', 'Trụ sở Cảnh sát Quốc gia bị đánh bom, Yorozu Baku (Zeztz) trở thành nghi phạm số một và bị truy nã toàn quốc. Odaka Kensei (Nox) quyết tâm tìm ra kẻ đứng sau – Kamen Rider Mugen.', null, null, null, true, false, 'cgv'),
  ('f31', 'Mộ Đom Đóm (Chiếu Lại)', 'K', 89, 'Hoạt Hình', 'https://static-cgv.vncdn.vn/media/catalog/product/4/7/470wx700h-modomdom.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/1/0/1080wx650h-modomdom.jpg', '2026-10-30', 'soon', 'Hai anh em Seita và Setsuko mất mẹ sau cuộc thả bom dữ dội của không quân Mỹ. Cả hai phải vật lộn để tồn tại ở Nhật Bản hậu Thế chiến II. Nhưng xã hội khắc nghiệt và chúng vật lộn tìm kiếm thức ăn cũng như thoát khỏi những khó khăn giữa chiến tranh.', null, null, null, false, false, 'cgv'),
  ('f32', 'Bò Sữa Bay', 'P', 110, 'Hài, Hành Động, Tâm Lý', 'https://static-cgv.vncdn.vn/media/catalog/product/t/e/teaser_poster_bsb_digital_2.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/t/e/teaser_poster_bsb_digital_2.jpg', '2026-11-06', 'soon', 'Vào những năm 90, một trang trại bò sữa đang nghiên cứu một công thức sữa độc quyền có thể chữa lành vết thương, trẻ hóa và nhiều công dụng đặc biệt khác. Để thoát nghèo, một nhóm công nhân quyết định đánh cắp công thức sữa ấy.', null, null, null, true, false, 'cgv'),
  ('f33', 'Godzilla Trừ Không', 'P', 110, 'Hành Động', 'https://static-cgv.vncdn.vn/media/catalog/product/o/r/original_size.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/b/a/banner_1920x1080px_.jpg', '2026-11-06', 'soon', 'Đã hai năm kể từ cuộc chiến, đất nước đang đấu tranh để phục hồi và họ cuối cùng đã lấy lại được cuộc sống thường nhật. Ngay khi nhân loại cố bám giữ sự yên bình mong manh vừa giành lại được, thì một mối đe dọa mới xuất hiện, nghiền nát tất cả hy vọng.', null, null, null, true, false, 'cgv'),
  ('f34', 'Thiên Đường Tăm Tối', 'P', 110, 'Hồi hộp, Tâm Lý', 'https://static-cgv.vncdn.vn/media/catalog/product/p/l/pl-teaser_poster-social.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/p/l/pl_teaser_thumbnail.jpg', '2026-11-06', 'soon', 'Xoay quanh hành trình bi thương của So-young - một người mẹ bất ngờ mất đi đứa con của mình. Giữa nỗi đau tận cùng, So-young tìm thấy niềm an ủi khi kết nối với hình ảnh cậu con trai Sun-woo đã mất tích thông qua kính AR.', null, null, null, true, false, 'cgv'),
  ('f35', 'Đơn Hàng Ma Ám', 'P', 110, 'Kinh Dị', 'https://static-cgv.vncdn.vn/media/catalog/product/d/h/dhm_mainposter_470x700.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/d/h/dhm_mainposter_470x700.jpg', '2026-11-06', 'soon', 'Khi nhận hàng online trở thành án tử!', null, null, null, true, false, 'cgv'),
  ('f36', 'Chàng Mèo Mang Mũ', 'P', 110, 'Gia đình, Hài, Hoạt Hình, Phiêu Lưu', 'https://static-cgv.vncdn.vn/media/catalog/product/p/o/poster_chang_meo_mang_mu_1.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/p/o/poster_chang_meo_mang_mu_1.jpg', '2026-11-06', 'soon', 'CHÀNG MÈO MANG MŨ (THE CAT IN THE HAT)', null, null, null, true, false, 'cgv'),
  ('f37', 'Ngày Con Còn Mẹ', 'P', 110, 'Gia đình, Tâm Lý', 'https://static-cgv.vncdn.vn/media/catalog/product/4/7/470wx700h-nccm_2.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/1/0/1080wx608h-nccm_1.jpg', '2026-11-11', 'soon', 'Khai thác góc nhìn chân thật về "đứa con thừa", NGÀY CON CÒN MẸ là hành trình giằng xé nhưng ấm áp, nhắc nhở chúng ta học cách tha thứ và yêu thương khi mọi thứ vẫn còn kịp.', null, null, null, true, false, 'cgv'),
  ('f38', 'Ebenezer Phép Màu Đêm Giáng Sinh', 'P', 110, 'Thần thoại', 'https://static-cgv.vncdn.vn/media/catalog/product/4/7/470x700-ebenezer.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/4/7/470x700-ebenezer.jpg', '2026-11-13', 'soon', 'Tháng 11 này, Johnny Depp sẽ hóa thân thành Ebenezer Scrooge. Một cái tên quen thuộc và một câu chuyện chưa từng được kể.', null, null, null, true, false, 'cgv'),
  ('f39', 'Đấu Trường Sinh Tử: Bình Minh Ngày Chiêu Quân', 'P', 110, 'Hành Động, Khoa Học Viễn Tưởng, Phiêu Lưu, Thần thoại', 'https://static-cgv.vncdn.vn/media/catalog/product/7/0/700wx1000h-hunger.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/7/0/700wx1000h-hunger.jpg', '2026-11-20', 'soon', 'Được chuyển thể từ cuốn tiểu thuyết cùng tên, Đấu Trường Sinh Tử: Bình Minh Ngày Chiêu Quân sẽ đưa khán giả trở lại Panem 24 năm trước những sự kiện trong phần phim Đấu Trường Sinh Tử đầu tiên, bắt đầu vào buổi sáng diễn ra Lễ Chiêu Quân lần thứ 50.', null, null, null, true, false, 'cgv'),
  ('f40', 'Trại Giam Hạnh Phúc', 'P', 110, 'Gia đình, Hài, Tâm Lý', 'https://static-cgv.vncdn.vn/media/catalog/product/3/5/350x495-tghp.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/6/4/640x396-tghp.jpg', '2026-11-20', 'soon', 'Phúc (Tuấn Trần), từ một giáo viên hiền lành, tốt bụng vì muốn cứu em gái (Sally Hồng Anh) mà trở thành sát nhân, phải vào tù.', null, null, null, true, false, 'cgv'),
  ('f41', 'Mẹ Mìn', 'P', 110, 'Bí ẩn, Hồi hộp, Tâm Lý', 'https://static-cgv.vncdn.vn/media/catalog/product/m/_/m_m_n_-_teaser_poster_-_dkkc_23102026.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/m/_/m_m_n_-_teaser_poster_-_dkkc_23102026.jpg', '2026-11-27', 'soon', 'MẸ MÌN – một nhân vật bí ẩn – có khả năng ban phát điều ước cho mọi người, nhưng điều ước nào cũng sẽ đi kèm điều kiện của nó.', null, null, null, true, false, 'cgv'),
  ('f42', 'Gặp Gỡ Thông Gia: Dâu Mới Trình Làng', 'P', 110, 'Hài', 'https://static-cgv.vncdn.vn/media/catalog/product/4/7/470x700-fil.png', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/1/8/1800x1200-fil_1.jpg', '2026-11-27', 'soon', 'Henry, con trai của Greg Focker đưa bạn gái mình, một chuyên gia đàm phán con tin của FBI về ra mắt gia đình. Mọi chuyện bắt đầu trở nên rối rắm khi Henry tiết lộ kế hoạch cầu hôn, khiến Greg không khỏi lo lắng và kéo theo hàng loạt tình huống dở khóc.', null, null, null, true, false, 'cgv'),
  ('f43', 'Hexe: Thế Giới Phép Thuật', 'P', 110, 'Gia đình, Hài, Hoạt Hình, Phiêu Lưu, Thần thoại', 'https://static-cgv.vncdn.vn/media/catalog/product/h/e/hexed_007c_g_vie-vn_70x100_.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/h/e/hexed_007c_g_vie-vn_70x100_.jpg', '2026-11-27', 'soon', 'Trong “Hexe – Thế giới Phép Thuật”, cô thiếu nữ bốc đồng và có phần khác biệt Billie (lồng tiếng bởi Hailee Steinfeld) bất ngờ phát hiện mình sở hữu những năng lực phép thuật bí ẩn. Khi sức mạnh ấy được giải phóng, Billie bị cuốn vào một hành trình kỳ ảo.', null, null, null, true, false, 'cgv'),
  ('f44', 'Đêm Hung Tàn 2', 'P', 110, 'Hài, Hành Động', 'https://static-cgv.vncdn.vn/media/catalog/product/v/n/vn2_teaser_470x700.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/v/n/vn2_teaser_470x700.jpg', '2026-12-04', 'soon', 'Để cứu lấy Giáng Sinh, Ông Già Noel phải tìm lại niềm tin bên trong mình vào lòng tốt và gọi đến sự chi viện vào phút chót từ người mà chẳng tên phản diện nào muốn đụng độ: Bà Già Noel', null, null, null, true, false, 'cgv'),
  ('f45', 'Con Mắt Thứ Ba', 'P', 110, 'Kinh Dị', 'https://static-cgv.vncdn.vn/media/catalog/product/c/o/con_m_t_th_ba_-_up.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/c/o/con_m_t_th_ba_-_up.jpg', '2026-12-04', 'soon', 'Một kẻ cuồng tín sau cơn đau đầu dữ dội phát hiện ra mình có một con mắt dọc trên trán. Những vụ sát nhân hàng loạt. Những hồn ma bóng quỷ lẩn khuất trong đời sống. Những nỗi sợ rình rập từ ám ảnh quá khứ. Sợi Chỉ Đỏ là gì, và sẽ kết nối tất cả thế nào?', null, null, null, true, false, 'cgv'),
  ('f46', 'Dune: Hành Tinh Cát - Phần Ba', 'P', 110, 'Hành Động, Khoa Học Viễn Tưởng', 'https://static-cgv.vncdn.vn/media/catalog/product/v/n/vn_dune3_vert_tsr_2764x4096_intl.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/v/n/vn_dune3_vert_tsr_2764x4096_intl.jpg', '2026-12-18', 'soon', 'Dune: Hành Tinh Cát - Phần Ba dựa trên cuốn tiểu thuyết Cứu Tinh Xứ Cát của tác giả Frank Herbert, mang đến màn ảnh chương cuối vĩ đại trong bộ ba phim Dune: Hành Tinh Cát của Villeneuve.', null, null, null, true, false, 'cgv'),
  ('f47', 'Avengers: Ngày Tận Thế', 'P', 110, 'Hành Động, Khoa Học Viễn Tưởng, Phiêu Lưu', 'https://static-cgv.vncdn.vn/media/catalog/product/a/p/applepie_sdcc_poster_vietnam.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/a/p/applepie_sdcc_poster_vietnam.jpg', '2026-12-18', 'soon', 'Avengers: Doomsday theo chân những người hùng được yêu mến đến từ ba vũ trụ khác nhau, khi họ bị cuốn vào một hành trình va chạm sinh tử và phải đối mặt với một mối đe dọa mang tính sống còn chưa từng có trong lịch sử.', null, null, null, true, false, 'cgv'),
  ('f48', 'Huyết Thống', 'P', 110, 'Kinh Dị', 'https://static-cgv.vncdn.vn/media/catalog/product/3/5/350x495-ht_1.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/6/4/640x396-ht_1.jpg', '2026-12-25', 'soon', 'Hai người đàn ông với hai niềm tin và phương cách khác nhau nhưng cùng chung một mục đích cứu lấy đứa trẻ vô tội. Nhưng "nợ máu trả máu", chính cái nghiệp báo không đứt đã đánh thức một oán linh cực kì nguy hiểm trở lại dương thế.', null, null, null, true, false, 'cgv'),
  ('f49', 'Người Mẹ Xấu', 'P', 110, 'Hành Động, Tâm Lý', 'https://static-cgv.vncdn.vn/media/catalog/product/3/5/350x495-nmx.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/6/4/640x396-nmx.jpg', '2026-12-31', 'soon', 'Hành trình đầy éo le và khốc liệt của hai mẹ con bị xếp vào thành phần “bất hảo” trong xã hội. Khi người con muốn hoàn lương, một ân oán của người mẹ khiến anh phải bước vào trận chiến dữ dội nhất.', null, null, null, true, false, 'cgv'),
  ('f50', 'Phim Angry Birds 3', 'P', 110, 'Hoạt Hình', 'https://static-cgv.vncdn.vn/media/catalog/product/4/7/470x700-angry_bird.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/1/9/1920x1080-angry.jpg', '2027-01-01', 'soon', 'Dịp lễ này, Red sẽ phải đối đầu với thử thách nhọc nhằn nhất đời mình: vừa học cách làm cha, vừa giải cứu thế giới!', null, null, null, true, false, 'cgv'),
  ('f51', 'Trên Con Đường Mới', 'P', 110, 'Hành Động, Tình cảm', 'https://static-cgv.vncdn.vn/media/catalog/product/t/r/tr_n_con_ng_m_i_-_dkkc_01.01.2027_-_kt_chu_n.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/t/r/tr_n_con_ng_m_i_-_dkkc_01.01.2027_-_kt_chu_n.jpg', '2027-01-01', 'soon', 'Trung – một người đàn ông mang theo quá khứ nhiều biến động – bước vào hành trình tìm kiếm một con đường mới giữa thế giới của tiền bạc, quyền lực, tội phạm và những ràng buộc gia đình.', null, null, null, true, false, 'cgv'),
  ('f52', 'Cộng Trừ Nhân Chia', 'P', 110, 'Hồi hộp, Tâm Lý', 'https://static-cgv.vncdn.vn/media/catalog/product/3/5/350x495-ctnc.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/1/9/1920x1080-ctnc.jpg', null, 'soon', 'Một nữ sinh chuyển đến một ngôi trường quốc tế danh tiếng. Cô liên tiếp vướng vào nhiều vụ việc đau lòng và chứng kiến nhiều hiện tượng kì bí.', null, null, null, true, false, 'cgv'),
  ('f53', 'Chuyến Đi Nhớ Đời', 'P', 110, 'Gia đình', 'https://static-cgv.vncdn.vn/media/catalog/product/3/5/350x495-c_.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/6/4/640x396-c_.jpg', '2026-11-06', 'soon', 'Từ một chuyến đi biển định mệnh, Hoàng và cậu con trai tinh nghịch An bị cuốn vào cơn bão, mắc kẹt trên hoang đảo và buộc phải cùng nhau sinh tồn.', null, null, null, true, false, 'cgv'),
  ('f54', 'Kỷ Băng Hà: Điểm Bùng Nổ', 'P', 110, 'Hài, Hoạt Hình, Phiêu Lưu', 'https://static-cgv.vncdn.vn/media/catalog/product/0/1/01_geyser_domtsr_1sht_vie.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/0/1/01_geyser_domtsr_1sht_vie.jpg', null, 'soon', 'Kỷ Băng Hà: Điểm Bùng Nổ do John Donkin (Kỷ băng hà: Cuộc phiêu lưu của Buck Wild) đạo diễn và Lori Forte (Kỷ Băng Hà & Kỷ Băng Hà: Trời Sập) đảm nhận vai trò nhà sản xuất. Bộ phim dự kiến khởi chiếu tại các rạp chiếu phim từ ngày 05.02.2027.', null, null, null, true, false, 'cgv'),
  ('f55', 'Thám Tử Kiên: Lời Nguyền Hoàng Kim', 'P', 110, 'Tâm Lý', 'https://static-cgv.vncdn.vn/media/catalog/product/3/5/350x495-ttk_1.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/6/4/640x396-ttk_1.jpg', '2027-02-06', 'soon', 'Khi đang điều tra cái chết bí ẩn tại tửu lầu Thanh Trúc, Thám Tử Kiên vô tình phát hiện một lời nguyền man rợ đang khiến cả kinh thành nhuốm máu. 
Đằng sau lời nguyền đó là một sứ mệnh mà Kiên cũng chưa từng nghĩ đến.', null, null, null, true, false, 'cgv'),
  ('f56', 'Loạn Thế', 'P', 110, 'Hành Động', 'https://static-cgv.vncdn.vn/media/catalog/product/4/7/470wx700h-loanthe.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/1/0/1080wx608h-loanthe.jpg', '2027-02-06', 'soon', 'Một thời đại nghĩa hiệp sắp mở ra.', null, null, null, true, false, 'cgv'),
  ('f57', 'Điều Còn Lại', 'P', 110, 'Hồi hộp, Tâm Lý', 'https://static-cgv.vncdn.vn/media/catalog/product/r/e/remain_vert_tsr_2764x4096_intl.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/r/e/remain_vert_tsr_2764x4096_intl.jpg', null, 'soon', 'Khi Tate Gordon, một kiến trúc sư sống khép kín, chuyển đến một thị trấn ven biển nhỏ để hoàn thành dự án mới nhất, anh tình cờ gặp một cô gái trẻ đầy cuốn hút. Sự xuất hiện của cô khiến Tate dần bước ra khỏi vỏ bọc của mình.', null, null, null, true, false, 'cgv'),
  ('f58', 'Chiến Bào', 'P', 110, 'Lịch Sử', 'https://static-cgv.vncdn.vn/media/catalog/product/c/h/chien_bao_-_cong_bo_-_poster.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/c/h/chie_n-ba_o_-_cong_bo_16x9.jpg', null, 'soon', 'CHIẾN BÀO sẽ đưa khán giả xuyên không về thế kỷ 15, chứng kiến giai đoạn đầu gian truân của Bình Định Vương Lê Lợi và Hội thề Lũng Nhai. Một bức tranh điện ảnh hứa hẹn sẽ cực kỳ hoành tráng, mãn nhãn và trọn vẹn cảm xúc về sự đoàn kết dân tộc.', null, null, null, true, false, 'cgv'),
  ('f59', 'Werwulf Ma Sói', 'P', 110, 'Kinh Dị', 'https://static-cgv.vncdn.vn/media/catalog/product/w/e/wer_teaser_470x700.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/w/e/wer_teaser_470x700.jpg', '2027-02-26', 'soon', 'Hãy sẵn sàng chứng kiến tác phẩm dữ dội và ám ảnh nhất từ trước đến nay của Robert Eggers. Focus Features mang đến bộ phim kinh dị mới với tên gọi WERWULF MA SÓI - câu chuyện rùng rợn về đức tin, sự đọa đày và con quỷ ẩn sâu trong mỗi con người.', null, null, null, true, false, 'cgv'),
  ('f60', 'Gatto: Cuộc Phiêu Lưu Của Mèo Nero', 'P', 110, 'Hài, Hoạt Hình, Phiêu Lưu', 'https://static-cgv.vncdn.vn/media/catalog/product/g/a/gatto_001a_g_vie-vn_70x100_.jpg', 'https://static-cgv.vncdn.vn/media/catalog/product/cache/1/small_image/600x314/a134659ca47b28f7b266e1777fbf870f/g/a/gatto_001a_g_vie-vn_70x100_.jpg', '2027-03-05', 'soon', 'Sau nhiều năm tìm cách sinh tồn giữa thành phố Venice - Ý chằng chịt kênh đào và đầy rẫy những quan niệm mê tín, chú mèo Nero bắt đầu tự hỏi liệu mình đã thực sự sống đúng với những kiếp đời của mình hay chưa.', null, null, null, true, false, 'cgv')
on conflict (id) do update set title = excluded.title, rating = excluded.rating, dur = excluded.dur, genre = excluded.genre, img = excluded.img, backdrop = excluded.backdrop,
  release_at = excluded.release_at, status = excluded.status, synopsis = excluded.synopsis, director = excluded.director, cast_names = excluded.cast_names, lang = excluded.lang,
  unrated = excluded.unrated, hot = excluded.hot, source = 'cgv', active = true;

-- phân phối cho mọi cơ sở (chỉ chèn thiếu, giữ lựa chọn của quản lý)
insert into public.cinema_films (cinema_id, film_id)
select c.id, f.id from public.cinemas c cross join public.films f where f.source = 'cgv'
on conflict (cinema_id, film_id) do nothing;

-- ensure_films (008): giữ nguyên hành vi chỉ chèn khi chưa có; phim mẫu cũ f1–f5 của bản trước (nếu còn) đã được thay bằng dữ liệu CGV ở trên.

-- ============================================================================
-- 021_guest.sql
-- ============================================================================
-- CineVin – migration 021: mua vé KHÔNG CẦN TÀI KHOẢN (khách vãng lai), xác nhận email bằng mã OTP của Supabase Auth, gửi vé về email.
-- Chạy SAU 020. Chạy lại nhiều lần không sao.
--   • Khách chọn suất, chọn ghế (giữ ghế không cần đăng nhập) → ở bước thanh toán nhập email + họ tên (SĐT tuỳ chọn)
--     → guest_email_check(): kiểm định dạng, CHẶN EMAIL DÙNG MỘT LẦN (bảng email_blocklist), email đã có tài khoản thật → mời đăng nhập
--     → web gọi Supabase Auth signInWithOtp → Supabase gửi mã 6 số (SMTP tuỳ chỉnh = Gmail của bạn)
--     → verifyOtp → guest_verify_auth() đọc email đã xác minh trong JWT → tài khoản khách ẩn (g_<băm email>, guest = true, 0 điểm) + phiên 2 giờ.
--   • Chế độ demo (otp_mode = 'demo', mặc định khi chưa cấu hình SMTP): máy chủ tự sinh mã, trả về cho web hiện trên trang.
--   • Thanh toán xong, khách có email nhận MAIL VÉ: xếp vào mail_outbox; Edge Function `send-mail` (supabase/functions/send-mail)
--     lấy bằng mail_take(), gửi qua SMTP Gmail, báo kết quả bằng mail_mark(). Chưa deploy function → mail 'pending', web vẫn xem được nội dung.
--   • Tra cứu vé: mã vé / mã đơn + email → phiên khách 2 giờ → QR, mua thêm, hoàn vé.
--   • Đăng ký tài khoản bằng đúng email đã mua vãng lai → vé chuyển sang tài khoản mới.
-- BẬT GỬI MAIL THẬT (xem README mục "Mua vé không cần tài khoản"): Authentication → Emails → SMTP Settings (Gmail + mật khẩu ứng dụng),
--   Authentication → Emails → Templates → Magic Link thêm {{ .Token }}, deploy Edge Function send-mail với secret SMTP_USER / SMTP_PASS, rồi:
--   update app_config set v = 'auth' where k = 'otp_mode';
--   update app_config set v = 'https://clonetest222.github.io/faceid_demo/' where k = 'site_url';
--   Theo dõi mail: select id, to_email, status, error, created_at from mail_outbox order by id desc;

alter table public.app_users add column if not exists guest boolean not null default false;

create table if not exists public.app_config (k text primary key, v text);
alter table public.app_config enable row level security;
insert into public.app_config (k, v) values
  ('site_url', 'https://clonetest222.github.io/faceid_demo/'),
  ('otp_mode', 'demo')                                   -- 'demo' (mã hiện trên trang) | 'auth' (Supabase Auth gửi mã qua SMTP đã cấu hình)
on conflict (k) do nothing;
delete from public.app_config where k in ('mail_from', 'mail_provider');   -- bản trước (Brevo/Resend) không dùng nữa
drop function if exists public.mail_dispatch(); drop function if exists public.mail_sync(); drop function if exists public.mail_ready();
drop function if exists public.guest_start(text, text, text); drop function if exists public.guest_otp_send(text, text, text);

create table if not exists public.mail_outbox (
  id bigint generated always as identity primary key,
  to_email text not null, to_name text, username text,
  subject text not null, html text not null,
  kind text not null default 'ticket', ref text,                 -- ref = mã đơn
  status text not null default 'pending' check (status in ('pending', 'queued', 'sent', 'failed')),
  request_id bigint, error text,
  created_at timestamptz not null default now(), sent_at timestamptz
);
-- 'skipped' = địa chỉ thử nghiệm (example.com, .test, .invalid…): chỉ lưu để xem trên web, không gửi (tránh mail bật lại khi chạy kiểm thử trên máy chủ thật)
alter table public.mail_outbox drop constraint if exists mail_outbox_status_check;
alter table public.mail_outbox add constraint mail_outbox_status_check check (status in ('pending', 'queued', 'sent', 'failed', 'skipped'));
create index if not exists mail_outbox_user on public.mail_outbox (username, id desc);
alter table public.mail_outbox enable row level security;   -- không policy: chỉ qua hàm

-- email dùng một lần: chặn theo tên miền (và tên miền con)
create table if not exists public.email_blocklist (domain text primary key, note text, created_at timestamptz not null default now());
alter table public.email_blocklist enable row level security;
insert into public.email_blocklist (domain, note) select d, 'email dùng một lần' from unnest(array[
  '10minutemail.com','10minutemail.net','10minemail.com','10mail.org','20minutemail.com','minuteinbox.com','tempmail.com','temp-mail.org','temp-mail.io',
  'tempmail.net','tempmail.plus','tempmail.dev','tempmail.ninja','tempmailo.com','tempmailaddress.com','tempr.email','tempail.com','tempemail.co','tempinbox.com',
  'tempsky.com','tmpmail.org','tmpmail.net','tmail.ws','tmails.net','mailtemp.net','mailtemp.top','mail-temp.com','emltmp.com','mytemp.email',
  'guerrillamail.com','guerrillamail.net','guerrillamail.org','guerrillamail.biz','guerrillamail.de','guerrillamail.info','guerrillamailblock.com','sharklasers.com','grr.la','spam4.me',
  'mailinator.com','mailinator.net','maildrop.cc','yopmail.com','yopmail.fr','yopmail.net','cool.fr.nf','jetable.fr.nf','nospam.ze.tc','nomail.xl.cx',
  'mega.zik.dj','speed.1s.fr','courriel.fr.nf','moncourrier.fr.nf','monemail.fr.nf','monmail.fr.nf','discard.email','dispostable.com','fakeinbox.com','fakemail.net',
  'getnada.com','nada.email','mohmal.com','mohmal.in','throwawaymail.com','throwam.com','trashmail.com','trashmail.me','trashmail.net','trash-mail.com',
  'kurzepost.de','objectmail.com','proxymail.eu','rcpt.at','wegwerfmail.de','wegwerfmail.net','wegwerfmail.org','mailnesia.com','mailcatch.com','mintemail.com',
  'burnermail.io','emailondeck.com','inboxkitten.com','harakirimail.com','spamgourmet.com','mailexpire.com','mailsac.com','emailfake.com','generator.email','crazymailing.com',
  '33mail.com','anonbox.net','luxusmail.org','1secmail.com','1secmail.net','1secmail.org','esiix.com','wwjmp.com','xojxe.com','yoggm.com',
  'dropmail.me','spymail.one','firemailbox.club','mailpoof.com','emailtemporanea.com','correotemporal.org','mailnull.com','spamfree24.org','mailtothis.com','bupmail.com',
  'zetmail.com','getairmail.com','mailhazard.com','inboxbear.com','pokemail.net','spam.la','mailme.lv','instantemailaddress.com','moakt.com','moakt.cc',
  'disbox.net','eyepaste.com','meltmail.com','incognitomail.com','mailforspam.com','spamherelots.com','mailzilla.com','filzmail.com','deadaddress.com','emailsensei.com',
  'mailscrap.com','jnxjn.com','cuvox.de','dayrep.com','einrot.com','fleckens.hu','gustr.com','jourrapide.com','rhyta.com','superrito.com','teleworm.us','armyspy.com'
]) d on conflict (domain) do nothing;

-- kiểm tra email: định dạng + không thuộc danh sách dùng một lần
create or replace function public._email_check(p_email text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text := nullif(lower(trim(coalesce(p_email, ''))), ''); d text;
begin
  if v is null or v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_email'; end if;
  d := split_part(v, '@', 2);
  if exists (select 1 from email_blocklist b where d = b.domain or d like '%.' || b.domain) then raise exception 'email_disposable'; end if;
  return v;
end $$;

-- yêu cầu mua vãng lai đang chờ xác nhận: tên/SĐT khách khai + (chế độ demo) mã băm bcrypt, 10 phút, 5 lần thử
create table if not exists public.email_otps (
  id bigint generated always as identity primary key,
  email text not null, code_hash text not null default '', name text, phone text,
  attempts int not null default 0, expires_at timestamptz not null, used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.email_otps alter column code_hash set default '';
create index if not exists email_otps_email on public.email_otps (email, id desc);
alter table public.email_otps enable row level security;

-- phiên: thêm cờ khách vãng lai
create or replace function public._session_json(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('token', s.token, 'username', u.username, 'role', u.role, 'name', u.display_name, 'expires_at', s.expires_at,
    'email', u.email, 'phone', u.phone, 'citizen_key', u.citizen_key, 'dob', u.dob, 'vneid_verified_at', u.vneid_verified_at,
    'vneid_method', u.vneid_method, 'points', u.points, 'confirm_every', u.confirm_every, 'cinema_id', u.cinema_id, 'guest', u.guest)
  from sessions s join app_users u on u.username = s.username where s.token = p_token;
$$;

-- tạo / dùng lại tài khoản khách theo email (dùng chung cho hai chế độ)
create or replace function public._guest_session(p_email text, p_name text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare u app_users; t uuid; v_user text; v_phone text := p_phone;
begin
  select * into u from app_users where lower(email) = p_email;
  if u.username is not null and not u.guest then raise exception 'email_registered'; end if;
  if u.username is not null and not coalesce(u.active, true) then raise exception 'account_disabled'; end if;
  if v_phone is not null and exists (select 1 from app_users where phone = v_phone and username is distinct from u.username) then v_phone := null; end if;
  if u.username is null then
    v_user := 'g_' || left(md5(p_email), 12);
    insert into app_users (username, pass_hash, role, display_name, email, phone, points, guest)
    values (v_user, extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf', 8)), 'khach', coalesce(nullif(p_name, ''), 'Khách'), p_email, v_phone, 0, true);
  else
    v_user := u.username;
    update app_users set display_name = coalesce(nullif(p_name, ''), display_name), phone = coalesce(v_phone, phone) where username = v_user;
  end if;
  delete from sessions where username = v_user and expires_at < now();
  insert into sessions (username, expires_at) values (v_user, now() + interval '2 hours') returning token into t;
  insert into audit_logs (type, msg, ok) values ('login', format('Khách vãng lai %s (%s) xác nhận email, bắt đầu thanh toán', coalesce(p_name, ''), p_email), true);
  return _session_json(t);
end $$;

-- ---------- bước 1: kiểm tra email + ghi tên/SĐT; chế độ demo thì sinh mã luôn ----------
create or replace function public.guest_email_check(p_email text, p_name text, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_email text; v_name text := left(trim(coalesce(p_name, '')), 60); v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  u app_users; mode text; code text; exp timestamptz := now() + interval '10 minutes';
begin
  v_email := _email_check(p_email);
  if length(v_name) < 2 then raise exception 'bad_name'; end if;
  if v_phone is not null and v_phone !~ '^(\+84|0)[0-9]{9}$' then raise exception 'bad_phone'; end if;
  select * into u from app_users where lower(email) = v_email;
  if u.username is not null and not u.guest then raise exception 'email_registered'; end if;   -- đã có tài khoản → đăng nhập
  if u.username is not null and not coalesce(u.active, true) then raise exception 'account_disabled'; end if;
  if (select count(*) from email_otps where email = v_email and created_at > now() - interval '10 minutes') >= 3 then raise exception 'too_many_requests'; end if;
  select v into mode from app_config where k = 'otp_mode'; mode := coalesce(mode, 'demo');
  update email_otps set used_at = now() where email = v_email and used_at is null;   -- yêu cầu cũ hết hiệu lực
  if mode = 'demo' then
    code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    insert into email_otps (email, code_hash, name, phone, expires_at) values (v_email, extensions.crypt(code, extensions.gen_salt('bf', 6)), v_name, v_phone, exp);
    insert into audit_logs (type, msg, ok) values ('login', format('Mã xác nhận (demo) cho %s', v_email), true);
    return jsonb_build_object('email', v_email, 'mode', 'demo', 'expires_at', exp, 'demo_code', code);
  end if;
  insert into email_otps (email, name, phone, expires_at) values (v_email, v_name, v_phone, now() + interval '1 hour');
  insert into audit_logs (type, msg, ok) values ('login', format('Yêu cầu mã xác nhận Supabase Auth cho %s', v_email), true);
  return jsonb_build_object('email', v_email, 'mode', 'auth', 'expires_at', exp);
end $$;

-- ---------- bước 2 (demo): nhập mã do máy chủ sinh ----------
create or replace function public.guest_verify(p_email text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_email text := lower(trim(coalesce(p_email, ''))); o email_otps;
begin
  select * into o from email_otps where email = v_email and used_at is null and code_hash <> '' order by id desc limit 1;
  if o.id is null then raise exception 'otp_missing'; end if;
  if o.expires_at < now() then raise exception 'otp_expired'; end if;
  if o.attempts >= 5 then raise exception 'otp_locked'; end if;
  if o.code_hash <> extensions.crypt(regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), o.code_hash) then
    -- sai mã: trả về ok=false (không raise, để lần thử được ghi lại – raise sẽ huỷ cả update)
    update email_otps set attempts = attempts + 1 where id = o.id;
    return jsonb_build_object('ok', false, 'error', 'otp_wrong', 'attempts_left', 5 - o.attempts - 1);
  end if;
  update email_otps set used_at = now() where id = o.id;
  return _guest_session(v_email, o.name, o.phone);
end $$;

-- ---------- bước 2 (auth): web đã verifyOtp với Supabase Auth → JWT có email đã xác minh ----------
create or replace function public.guest_verify_auth()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare claims jsonb; v_email text; o email_otps;
begin
  begin claims := current_setting('request.jwt.claims', true)::jsonb; exception when others then claims := null; end;
  v_email := lower(trim(coalesce(claims ->> 'email', '')));
  if v_email = '' or coalesce(claims ->> 'role', '') <> 'authenticated' then raise exception 'not_logged_in'; end if;
  v_email := _email_check(v_email);
  select * into o from email_otps where email = v_email and used_at is null and code_hash = '' order by id desc limit 1;   -- tên/SĐT đã khai ở bước 1
  if o.id is not null then update email_otps set used_at = now() where id = o.id; end if;
  return _guest_session(v_email, o.name, o.phone);
end $$;

-- ---------- đăng ký bằng email đã mua vãng lai → chuyển vé sang tài khoản mới ----------
create or replace function public.register(p_user text, p_pass text, p_name text, p_email text default null, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare t uuid; g text; v_user text := lower(trim(p_user)); v_email text := nullif(lower(trim(p_email)), ''); v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
begin
  if v_user !~ '^[a-z0-9_.]{3,32}$' then raise exception 'bad_username'; end if;
  if v_user like 'g\_%' then raise exception 'bad_username'; end if;
  if length(coalesce(p_pass, '')) < 6 then raise exception 'weak_password'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'bad_name'; end if;
  if v_email is not null then v_email := _email_check(v_email); end if;
  if v_phone is not null and v_phone !~ '^(\+84|0)[0-9]{9}$' then raise exception 'bad_phone'; end if;
  if v_email is not null then select username into g from app_users where lower(email) = v_email and guest; end if;
  if v_email is not null and g is null and exists (select 1 from app_users where lower(email) = v_email) then raise exception 'email_taken'; end if;
  if v_phone is not null and exists (select 1 from app_users where phone = v_phone and username is distinct from g) then raise exception 'phone_taken'; end if;
  if exists (select 1 from app_users where username = v_user) then raise exception 'username_taken'; end if;
  if g is not null then update app_users set email = null, phone = null where username = g; end if;    -- nhường email/SĐT cho tài khoản mới
  insert into app_users (username, pass_hash, role, display_name, email, phone)
  values (v_user, extensions.crypt(p_pass, extensions.gen_salt('bf', 8)), 'khach', left(trim(p_name), 60), v_email, v_phone);
  if g is not null then
    -- chuyển vé TRƯỚC khi xoá tài khoản khách (khoá ngoại on delete set null – xoá trước thì vé mất chủ)
    update tickets set owner_user = v_user where owner_user = g;
    update tickets set viewer_user = v_user where viewer_user = g;
    update mail_outbox set username = v_user where username = g;
    delete from app_users where username = g;
    insert into audit_logs (type, msg, ok) values ('login', format('@%s tạo tài khoản từ khách vãng lai %s – vé đã chuyển sang', v_user, v_email), true);
  end if;
  insert into sessions (username) values (v_user) returning token into t;
  return _session_json(t);
exception when unique_violation then raise exception 'username_taken';
end $$;

-- ---------- mail vé ----------
create or replace function public._mail_ticket_html(p_order text, p_name text)
returns text language plpgsql stable security definer set search_path = public as $$
declare rows_html text; head record; site text; total numeric;
begin
  select coalesce(f.title, s.film_id) as film, c.name as cinema, c.address, r.name as room, s.format,
         to_char(s.start_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') as hm,
         to_char(s.start_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') as dmy
    into head
    from tickets t join shows s on s.id = t.show_id
    left join films f on f.id = s.film_id left join rooms r on r.id = s.room_id left join cinemas c on c.id = coalesce(s.cinema_id, r.cinema_id)
    where t.order_id = p_order limit 1;
  if not found then return null; end if;
  select string_agg(format('<tr><td style="padding:8px 12px;border-top:1px solid #eee;font-family:monospace;font-weight:600">%s</td><td style="padding:8px 12px;border-top:1px solid #eee">%s</td><td style="padding:8px 12px;border-top:1px solid #eee;font-family:monospace">%s</td><td style="padding:8px 12px;border-top:1px solid #eee;text-align:right">%s đ</td></tr>',
                           t.seat, coalesce(t.viewer_name, ''), t.code, replace(to_char(t.price, 'FM999,999,999'), ',', '.')), '' order by t.seat), sum(t.price)
    into rows_html, total from tickets t where t.order_id = p_order and t.status <> 'refunded';
  select v into site from app_config where k = 'site_url';
  return format($h$<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#e11d48;color:#fff;border-radius:16px 16px 0 0;padding:18px 20px;font-size:20px;font-weight:700">CineVin · Vé xem phim</div>
  <div style="background:#fff;border-radius:0 0 16px 16px;padding:20px">
    <p style="margin:0 0 12px">Xin chào <b>%s</b>, cảm ơn bạn đã đặt vé. Đây là vé của bạn, đưa mã QR ở link bên dưới cho nhân viên khi vào rạp.</p>
    <h2 style="margin:16px 0 4px;font-size:18px">%s</h2>
    <p style="margin:0;color:#52525b">%s · %s · %s</p>
    <p style="margin:4px 0 16px;color:#52525b">Suất <b style="color:#18181b">%s</b> ngày <b style="color:#18181b">%s</b> · phòng %s</p>
    <table style="width:100%%;border-collapse:collapse;font-size:14px"><thead><tr style="text-align:left;color:#52525b"><th style="padding:6px 12px">Ghế</th><th style="padding:6px 12px">Người xem</th><th style="padding:6px 12px">Mã vé</th><th style="padding:6px 12px;text-align:right">Giá</th></tr></thead><tbody>%s</tbody></table>
    <p style="margin:12px 0 0;text-align:right;font-weight:700">Tổng %s đ · mã đơn <span style="font-family:monospace">%s</span></p>
    <p style="margin:20px 0 0"><a href="%s#/tracuu?ma=%s" style="display:inline-block;background:#e11d48;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600">Mở vé &amp; mã QR</a></p>
    <p style="margin:12px 0 0;font-size:12px;color:#71717a">QR đổi mỗi 15 giây nên không in được – mở link này trên điện thoại khi tới rạp (nhập email để xác nhận). Vé mua online hoàn được trước giờ chiếu 30 phút trong mục Vé của tôi.</p>
  </div>
  <p style="margin:12px 0 0;text-align:center;font-size:12px;color:#a1a1aa">CineVin · Đồ án Nhóm 05 ĐH Vinh · mail tự động, không trả lời</p>
</div></body></html>$h$,
    coalesce(p_name, 'bạn'), head.film, coalesce(head.cinema, 'CineVin'), coalesce(head.address, ''), coalesce(head.format, '2D'),
    head.hm, head.dmy, coalesce(head.room, '?'), coalesce(rows_html, ''), replace(to_char(coalesce(total, 0), 'FM999,999,999'), ',', '.'), p_order,
    coalesce(site, 'https://clonetest222.github.io/faceid_demo/'), p_order);
end $$;

-- địa chỉ thử nghiệm: không gửi thật
create or replace function public._email_is_test(p text)
returns boolean language sql immutable as $$ select lower(coalesce(p, '')) ~ '@(example\.(com|org|net)|[a-z0-9.-]+\.(test|invalid|localhost|example))$' $$;
-- Xếp mail vé cho đơn p_order vào outbox (Edge Function send-mail sẽ lấy đi gửi)
create or replace function public._mail_order(p_user text, p_order text)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users; h text; subj text;
begin
  select * into u from app_users where username = p_user;
  if u.email is null then return; end if;
  h := _mail_ticket_html(p_order, u.display_name); if h is null then return; end if;
  select format('Vé CineVin · %s · %s', coalesce(f.title, s.film_id), to_char(s.start_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM')) into subj
    from tickets t join shows s on s.id = t.show_id left join films f on f.id = s.film_id where t.order_id = p_order limit 1;
  insert into mail_outbox (to_email, to_name, username, subject, html, kind, ref, status)
  values (u.email, u.display_name, u.username, subj, h, 'ticket', p_order, case when _email_is_test(u.email) then 'skipped' else 'pending' end);
end $$;

-- Thanh toán (ghi đè bản 016): khách vãng lai không tích/dùng điểm; có email thì xếp mail vé
create or replace function public.sell_order_u(p_token uuid, p_show text, p_hold text, p_tickets jsonb, p_voucher text default null, p_points int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u app_users; v vouchers; gross numeric; disc numeric := 0; pts int := 0; paid numeric; earn int;
begin
  u := _need(p_token, array['khach', 'nhanvien', 'quanly']);
  select coalesce(sum((x->>'price')::numeric), 0) into gross from jsonb_array_elements(p_tickets) x;
  if p_voucher is not null and p_voucher <> '' then
    select * into v from vouchers where code = upper(trim(p_voucher)) for update;
    if not _voucher_ok(v, u.username) then raise exception 'voucher_invalid'; end if;
    disc := case when v.kind = 'gift' then least(v.amount, gross) else round(gross * v.percent / 100) end;
  end if;
  pts := case when u.guest then 0 else least(greatest(coalesce(p_points, 0), 0), u.points, floor((gross - disc) / 1000)::int) end;
  paid := greatest(0, gross - disc - pts * 1000);
  perform sell_order(p_show, p_hold, p_tickets);
  update tickets set owner_user = u.username
  where code in (select x->>'code' from jsonb_array_elements(p_tickets) x) and coalesce(channel, '') <> 'Quầy';
  update tickets set sold_by = u.username where code in (select x->>'code' from jsonb_array_elements(p_tickets) x) and u.role <> 'khach';
  perform _apply_companions(u.username, p_show, p_tickets);
  if v.code is not null then
    if v.kind = 'promo' and v.owner_user is null then insert into voucher_uses (code, username) values (v.code, u.username);
    else update vouchers set used_at = now(), used_by = u.username where code = v.code; end if;
  end if;
  earn := case when u.role = 'khach' and not u.guest then floor(paid * 0.05 / 1000)::int else 0 end;
  update app_users set points = points - pts + earn where username = u.username;
  insert into audit_logs (type, msg, ok) values ('pay', format('@%s thanh toán %s đ (giảm %s đ, dùng %s điểm, +%s điểm)%s', u.username, paid, disc, pts, earn, case when u.guest then ' – khách vãng lai ' || u.email else '' end), true);
  if u.role = 'khach' and u.email is not null then perform _mail_order(u.username, p_hold); end if;
  return jsonb_build_object('gross', gross, 'discount', disc, 'points_used', pts, 'paid', paid, 'points_earned', earn, 'points', u.points - pts + earn,
    'mailed_to', case when u.role = 'khach' then u.email end);
end $$;

-- Edge Function send-mail (service role) lấy mail chờ gửi của chủ phiên p_token (đánh dấu 'queued'); thử lại được mail 'failed'
drop function if exists public.mail_take(uuid, text);
create or replace function public.mail_take(p_token uuid, p_ref text default null)
returns table (id bigint, to_email text, to_name text, subject text, html text)
language plpgsql security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['khach']);
  return query update mail_outbox m set status = 'queued', request_id = coalesce(m.request_id, 0) + 1
    where m.username = u.username and m.status in ('pending', 'failed') and (p_ref is null or m.ref = p_ref)
    returning m.id, m.to_email, m.to_name, m.subject, m.html;
end $$;

-- Edge Function báo kết quả gửi (chỉ service_role gọi được)
create or replace function public.mail_mark(p_id bigint, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
declare claims jsonb;
begin
  begin claims := current_setting('request.jwt.claims', true)::jsonb; exception when others then claims := null; end;
  if coalesce(claims ->> 'role', '') <> 'service_role' then raise exception 'forbidden'; end if;
  update mail_outbox set status = case when p_ok then 'sent' else 'failed' end, error = case when p_ok then null else left(p_error, 300) end, sent_at = case when p_ok then now() else sent_at end where id = p_id;
end $$;

-- Mail vé của tôi (xem lại nội dung / trạng thái trên web). Bản trước trả cột khác → phải drop rồi tạo lại
drop function if exists public.my_mails(uuid, text);
create or replace function public.my_mails(p_token uuid, p_ref text default null)
returns table (id bigint, to_email text, subject text, html text, status text, error text, ref text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare u app_users;
begin
  u := _need(p_token, array['khach']);
  return query select m.id, m.to_email, m.subject, m.html, m.status, m.error, m.ref, m.created_at from mail_outbox m
    where m.username = u.username and m.kind = 'ticket' and (p_ref is null or m.ref = p_ref) order by m.id desc limit 20;
end $$;

-- ---------- tra cứu vé: mã vé / mã đơn + email → phiên khách 2 giờ ----------
create or replace function public.lookup_order(p_code text, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tickets; u app_users; tok uuid; v_code text := upper(trim(p_code)); v_email text := lower(trim(p_email));
begin
  select * into t from tickets where code = v_code or order_id = v_code order by created_at desc limit 1;
  if t.code is null then raise exception 'unknown_ticket'; end if;
  select * into u from app_users where username = t.owner_user;
  if u.username is null or lower(coalesce(u.email, '')) <> v_email then raise exception 'unknown_ticket'; end if;   -- không lộ vé của người khác
  if not u.guest then raise exception 'use_login'; end if;
  if not coalesce(u.active, true) then raise exception 'account_disabled'; end if;
  delete from sessions where username = u.username and expires_at < now();
  insert into sessions (username, expires_at) values (u.username, now() + interval '2 hours') returning token into tok;
  insert into audit_logs (type, msg, ok) values ('login', format('Khách vãng lai %s tra cứu vé %s', v_email, v_code), true);
  return _session_json(tok) || jsonb_build_object('order', t.order_id, 'ticket', t.code);
end $$;

-- Quản lý: thêm/bớt tên miền email bị chặn; đổi chế độ mã xác nhận
create or replace function public.blocklist_set_s(p_token uuid, p_domain text, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare d text := lower(trim(coalesce(p_domain, '')));
begin
  perform _need(p_token, array['quanly']);
  if d !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then raise exception 'bad_input'; end if;
  if p_on then insert into email_blocklist (domain, note) values (d, 'quản lý thêm') on conflict (domain) do nothing; else delete from email_blocklist where domain = d; end if;
end $$;
create or replace function public.otp_mode()
returns text language sql stable security definer set search_path = public as $$ select coalesce((select v from app_config where k = 'otp_mode'), 'demo') $$;

grant execute on function public.guest_email_check(text, text, text), public.guest_verify(text, text), public.guest_verify_auth(), public.lookup_order(text, text),
  public.my_mails(uuid, text), public.register(text, text, text, text, text), public.sell_order_u(uuid, text, text, jsonb, text, int),
  public.blocklist_set_s(uuid, text, boolean), public.otp_mode() to anon, authenticated;
grant execute on function public.mail_take(uuid, text), public.mail_mark(bigint, boolean, text) to service_role;
revoke execute on function public.mail_take(uuid, text), public.mail_mark(bigint, boolean, text) from public, anon, authenticated;
revoke execute on function public._mail_order(text, text), public._mail_ticket_html(text, text), public._email_check(text), public._guest_session(text, text, text) from public, anon, authenticated;

