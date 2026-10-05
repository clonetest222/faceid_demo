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
