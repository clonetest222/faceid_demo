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
