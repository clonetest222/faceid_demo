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
