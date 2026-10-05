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
