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
